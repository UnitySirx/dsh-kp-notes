/* rk-study · host/delete —— 从 host.js 第 1027-1183 行原样切出 */
/* ctx.fs 没有 delete/unlink/rmdir API, 所以「删除」这一类操作只能用 node:fs —— 这是刻意保留的:
 * 每个删除入口(deleteFile / deleteDir)在动手之前都先过 assertInsideRoot(), 用 ctx.fs 的规范化目标
 * 确认「真的要删的东西在 root 之内」; pruneEmptyDirs 只碰由这些已校验路径推导出来的空目录。
 * 除此之外不再新增裸 node:fs。 */
import { existsSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';

import { MARKDOWN_RE } from './constants.js?v=40';
import { resolveTarget, rootTargetOf } from './fsguard.js?v=40';
import { listDirSafe } from './templates.js?v=40';
import { isQuestionStorePath, noteStorePath, normalizeRelPath, questionPathFor } from './util.js?v=40';
import { safePath } from './write.js?v=40';

/* --------------------------------------------------------------- deleting */

/** 目录路径守卫: 必须位于笔记根目录内, 且不能是被排除的目录(plugin/node_modules/.git…). 只做字符串判定。 */
export function safeDirPath(config, relDir) {
	const clean = normalizeRelPath(relDir);
	if (clean === '' || clean.split('/').includes('..')) return null;
	const abs = `${config.root}/${clean}`;
	if (!abs.startsWith(`${config.root}/`)) return null;
	const first = clean.split('/')[0];
	if ((config.exclude || []).includes(first)) return null;
	return abs;
}

/**
 * 删除前的真实包含复核: ctx.fs 没有 delete/unlink API, 所以删除仍然走 node:fs,
 * 但**先**用规范化目标确认目标确实在 root 之内 —— 只靠字符串前缀挡不住指向外面的符号链接。
 * 越界或解析不了时抛错, 调用方按参数错误回报。
 */
export async function assertInsideRoot(ctx, config, abs, relPath, signal) {
	const rootTarget = await rootTargetOf(ctx, config, signal);
	const target = rootTarget ? await resolveTarget(ctx, abs, signal) : null;
	if (!rootTarget || !target || !ctx.fs.contains(rootTarget, target)) throw new Error(`invalid path: ${relPath}`);
	return target;
}

export function isExcludedPath(config, relPath) {
	const first = String(relPath ?? '').split('/')[0];
	return (config.exclude || []).includes(first);
}

/**
 * 小节文件的序号: notes/<章>/NN-标题.md → NN; 知识点文件(NN-MM-*)与题目文件返回 null.
 */
export function sectionOrderOfPath(config, relPath) {
	const rel = noteStorePath(config, relPath);
	if (!rel) return null;
	const base = rel.slice(rel.lastIndexOf('/') + 1);
	if (/^\d+-\d+-/.test(base)) return null;
	const match = /^(\d+)-/.exec(base);
	return match ? Number(match[1]) : null;
}

/** notes/<章>… → questions/<章>…(题目目录镜像); 非 notes 路径返回 null */
export function questionDirFor(config, relDir) {
	const clean = normalizeRelPath(relDir);
	const prefix = `${config.noteDir}/`;
	if (!clean.startsWith(prefix)) return null;
	const rest = clean.slice(prefix.length);
	if (rest === '' || rest.split('/').includes('..')) return null;
	return `${config.questionDir}/${rest}`;
}

/** 清理题目目录(questions/)下被删空的目录, 从最深的往上 */
export function pruneEmptyDirs(config, relPaths) {
	const dirs = new Set();
	for (const rel of relPaths) {
		if (!isQuestionStorePath(config, rel)) continue;
		let dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
		while (dir && dir !== config.questionDir && dir.startsWith(`${config.questionDir}/`)) {
			dirs.add(dir);
			const cut = dir.lastIndexOf('/');
			if (cut <= 0) break;
			dir = dir.slice(0, cut);
		}
	}
	const pruned = [];
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
		const abs = `${config.root}/${dir}`;
		try {
			if (readdirSync(abs).length === 0) {
				rmdirSync(abs);
				pruned.push(dir);
			}
		} catch {
			/* 目录不存在或无法删除: 跳过 */
		}
	}
	return pruned;
}

/**
 * 删除一个笔记文件, 并连带删除同一知识点在题目目录(questions/)下的同名文件;
 * 删除小节文件时, 连带删除该小节下的全部知识点文件及其题目文件.
 */
export async function deleteEntry(ctx, config, relPath) {
	const clean = String(relPath ?? '').trim();
	const targets = [clean];
	const related = [];
	if (!isQuestionStorePath(config, clean)) {
		const paired = questionPathFor(config, clean);
		if (paired) targets.push(paired);
		const order = sectionOrderOfPath(config, clean);
		if (order !== null && order > 0) {
			const slash = clean.lastIndexOf('/');
			const dirRel = slash < 0 ? '' : clean.slice(0, slash);
			const entries = await listDirSafe(ctx, config, dirRel);
			const prefix = `${String(order).padStart(2, '0')}-`;
			for (const entry of entries) {
				const entryName = String(entry.name ?? '');
				if (entry.type !== 'file' || !MARKDOWN_RE.test(entryName)) continue;
				if (!entryName.startsWith(prefix) || !/^\d+-\d+-/.test(entryName)) continue;
				const child = dirRel === '' ? entryName : `${dirRel}/${entryName}`;
				if (child === clean) continue;
				targets.push(child);
				const childQuestion = questionPathFor(config, child);
				if (childQuestion) targets.push(childQuestion);
			}
		}
	}
	let removed = false;
	const done = [];
	for (const target of [...new Set(targets)]) {
		const result = await deleteFile(ctx, config, target);
		if (!result.removed) continue;
		removed = true;
		done.push(target);
		if (target !== clean) related.push(target);
	}
	const prunedDirs = pruneEmptyDirs(config, done);
	return { ok: true, path: clean, removed, related, prunedDirs };
}

/** 删除章节目录, 同时删除题目目录(questions/)下的同名目录 */
export async function deleteDirEntry(ctx, config, relDir) {
	const clean = String(relDir ?? '').trim();
	const result = await deleteDir(ctx, config, clean);
	const related = [];
	const mirror = questionDirFor(config, clean);
	if (mirror && mirror !== clean) {
		try {
			const mirrorResult = await deleteDir(ctx, config, mirror);
			if (mirrorResult.removed) related.push(mirrorResult.dir);
		} catch {
			/* 题目目录不存在或不是目录: 忽略 */
		}
	}
	return { ...result, related };
}

/** 删除一个笔记文件(只允许删除根目录内的 markdown). */
export async function deleteFile(ctx, config, relPath) {
	const abs = safePath(ctx, config, relPath);
	if (!abs || isExcludedPath(config, relPath)) throw new Error(`invalid path: ${relPath}`);
	await assertInsideRoot(ctx, config, abs, relPath);
	if (!existsSync(abs)) return { ok: true, path: relPath, removed: false };
	if (!statSync(abs).isFile()) throw new Error(`not a file: ${relPath}`);
	unlinkSync(abs);
	return { ok: true, path: relPath, removed: true };
}

/** 删除整章目录(含其下所有小节/知识点/题目文件). */
export async function deleteDir(ctx, config, relDir) {
	const abs = safeDirPath(config, relDir);
	if (!abs) throw new Error(`invalid dir: ${relDir}`);
	await assertInsideRoot(ctx, config, abs, relDir);
	if (!existsSync(abs)) return { ok: true, dir: relDir, removed: false };
	if (!statSync(abs).isDirectory()) throw new Error(`not a directory: ${relDir}`);
	rmSync(abs, { recursive: true, force: true });
	return { ok: true, dir: relDir, removed: true };
}

/* rk-study · host/delete —— 从 host.js 第 1027-1183 行原样切出 */
/* 这里**不做真正的删除**: 每个「删除」入口都是把目标**移到当前画布根目录下的 .remove/ 里**
 * (deleteFile = renameSync 单个文件, deleteDir = renameSync 整个目录, 内容/题目块 = 另存一份
 * markdown 片段)。**一次删除 = .remove 下新建的一个日期桶目录(名字就是删除当天的 YYYYMMDD), 桶里保留原来的相对路径结构**:
 *   .remove/20261004/notes/01-第一章/01-01-甲.md
 * 桶与桶之间互不相干, 所以既不会覆盖(每删一次都留一份, 捞得回来), 也不会把不同次删除的东西
 * 混进同一条路径(先删整个章节、之后又删它里面某个知识点, 后者进的是它自己那个桶)。
 * .remove 以点开头, lib/scan.js 与 lib/util.js 扫描时都会跳过它, 不会出现在画布/思维导图里。
 * ctx.fs 没有 delete/unlink API, 移动只能用 node:fs —— 这是刻意保留的: 每个入口在动手之前
 * 都先过 assertInsideRoot(), 用 ctx.fs 的规范化目标确认「要移走的东西在 root 之内」;
 * pruneEmptyDirs 只碰由这些已校验路径推导出来的空目录。除此之外不再新增裸 node:fs。 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';

import { MARKDOWN_RE } from './constants.js?v=52';
import { resolveTarget, rootTargetOf } from './fsguard.js?v=52';
import { listDirSafe } from './templates.js?v=52';
import { isQuestionStorePath, noteStorePath, normalizeRelPath, questionPathFor } from './util.js?v=52';
import { safePath } from './write.js?v=52';

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
	return first === REMOVE_DIR || (config.exclude || []).includes(first);
}

/* --------------------------------------------------- 删除 = 移到 .remove */

/** 回收目录名: 画布根目录下以点开头, 扫描时会跳过 */
export const REMOVE_DIR = '.remove';

/** 当前一级画布的回收目录绝对路径: <root>/.remove */
export function removeBoxFor(config) {
	return `${config.root}/${REMOVE_DIR}`;
}

/** 桶目录名: 删除当天的本地日期 20261004(一天里删多次就往后排成 20261004-2、-3) */
function removeStamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * 为「这一次删除 / 移出」挑一个桶目录名: <box>/<当天日期 20261004>; 同一天里再来一次就 -2、-3 排下去。
 * box 就是某个 .remove 目录 —— 画布内的删除是 <画布根>/.remove, 一级画布「移出列表」是 <同层>/.remove。
 * **一次删除只调用一次**: 这次要搬走的东西(连带的小节/知识点/题目)都用同一个桶,
 * 桶内部因此只会有「这一次」的东西。这里只挑名字, 不建目录(等第一个东西真的搬进来时再建)。
 */
export function bucketNameIn(box, stamp) {
	const base = stamp || removeStamp();
	let candidate = `${box}/${base}`;
	let index = 1;
	while (existsSync(candidate)) {
		index += 1;
		candidate = `${box}/${base}-${index}`;
	}
	return candidate;
}

/** 画布内的删除: 桶就在 <画布根>/.remove 下 */
export function removeBucketFor(config, stamp) {
	return bucketNameIn(removeBoxFor(config), stamp);
}

/** 桶目录的显示名(= 它在 .remove 下那一层目录名), 给前端提示用 */
export function removeBucketName(bucket) {
	const parts = String(bucket ?? '').split('/');
	return parts[parts.length - 1] || '';
}

/**
 * 把 abs 搬进桶里(保留相对路径), 返回相对 .remove 的路径(形如 20261004/notes/01-甲.md)。
 * bucket 省略时自己新开一个桶; 一次删除里搬多个文件时, 由调用方把同一个 bucket 传进来。
 */
export function moveIntoRemove(config, relPath, abs, bucket) {
	const box = removeBoxFor(config);
	const clean = normalizeRelPath(relPath);
	const root = bucket || removeBucketFor(config);
	const dest = `${root}/${clean}`;
	const cut = dest.lastIndexOf('/');
	if (cut > 0) mkdirSync(dest.slice(0, cut), { recursive: true });
	renameSync(abs, dest);
	return dest.slice(box.length + 1);
}

/**
 * 内容级删除(题目 / 知识点块是文件里的一段, 没有文件可移): 把被删掉的这段 markdown
 * 另存成 <root>/.remove/<桶>/<原相对路径>.removed-<题号>.md, 开头留一行注释说明来处。
 * 和文件删除一样进日期桶: 同一道题删两次就是两个桶里各一份, 谁也不覆盖谁。
 */
export function saveRemovedText(config, relPath, text, order, bucket) {
	const body = String(text ?? '').trim();
	if (body === '') return null;
	const box = removeBoxFor(config);
	const root = bucket || removeBucketFor(config);
	const clean = normalizeRelPath(relPath);
	const slash = clean.lastIndexOf('/');
	const dir = slash < 0 ? '' : `${clean.slice(0, slash)}/`;
	const base = slash < 0 ? clean : clean.slice(slash + 1);
	const dot = base.lastIndexOf('.');
	const stem = dot > 0 ? base.slice(0, dot) : base;
	const tag = Number.isFinite(order) && order > 0 ? `-${Math.round(order)}` : '';
	const dest = `${root}/${dir}${stem}.removed${tag}.md`;
	const cut = dest.lastIndexOf('/');
	if (cut > 0) mkdirSync(dest.slice(0, cut), { recursive: true });
	const header = `<!-- rk-study: 从 ${clean} 删除的一段内容${tag ? ` #${tag.slice(1)}` : ''}, ${new Date().toISOString()} -->`;
	writeFileSync(dest, `${header}\n\n${body}\n`, 'utf8');
	return dest.slice(box.length + 1);
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
	/* 这次删除要搬走的一切(本体 + 连带的小节/知识点/题目)都进**同一个桶** */
	const bucket = removeBucketFor(config);
	let removed = false;
	const done = [];
	let movedTo = null;
	for (const target of [...new Set(targets)]) {
		const result = await deleteFile(ctx, config, target, bucket);
		if (!result.removed) continue;
		removed = true;
		done.push(target);
		if (movedTo === null) movedTo = result.movedTo || null;
		if (target !== clean) related.push(target);
	}
	const prunedDirs = pruneEmptyDirs(config, done);
	return { ok: true, path: clean, removed, related, prunedDirs, movedTo, box: REMOVE_DIR, bucket: removeBucketName(bucket) };
}

/** 删除章节目录, 同时删除题目目录(questions/)下的同名目录(两份都进同一个桶) */
export async function deleteDirEntry(ctx, config, relDir) {
	const clean = String(relDir ?? '').trim();
	const bucket = removeBucketFor(config);
	const result = await deleteDir(ctx, config, clean, bucket);
	const related = [];
	const mirror = questionDirFor(config, clean);
	if (mirror && mirror !== clean) {
		try {
			const mirrorResult = await deleteDir(ctx, config, mirror, bucket);
			if (mirrorResult.removed) related.push(mirrorResult.dir);
		} catch {
			/* 题目目录不存在或不是目录: 忽略 */
		}
	}
	return { ...result, related, box: REMOVE_DIR, bucket: removeBucketName(bucket) };
}

/** 删除一个笔记文件(只允许删除根目录内的 markdown); bucket 由调用方决定, 省略则新开一个桶. */
export async function deleteFile(ctx, config, relPath, bucket) {
	const abs = safePath(ctx, config, relPath);
	if (!abs || isExcludedPath(config, relPath)) throw new Error(`invalid path: ${relPath}`);
	await assertInsideRoot(ctx, config, abs, relPath);
	if (!existsSync(abs)) return { ok: true, path: relPath, removed: false };
	if (!statSync(abs).isFile()) throw new Error(`not a file: ${relPath}`);
	const movedTo = moveIntoRemove(config, relPath, abs, bucket);
	return { ok: true, path: relPath, removed: true, movedTo, box: REMOVE_DIR, bucket: removeBucketName(bucket) || String(movedTo ?? '').split('/')[0] };
}

/**
 * 把「这次删掉的目录带走了哪个 uid」记进桶里: <画布>/.remove/<桶>/.rk-uids.json。
 * 点开头的文件, 扫描 / 画布都看不见; 恢复(把目录移回去)时能凭它认回原来的身份。
 */
export function stashUids(config, bucket, mapping) {
	const entries = Object.entries(mapping && typeof mapping === 'object' ? mapping : {});
	if (entries.length === 0) return null;
	const clean = String(bucket ?? '').replace(/^\/+|\/+$/g, '');
	if (clean === '' || clean.includes('..')) return null;
	const dest = `${removeBoxFor(config)}/${clean}/.rk-uids.json`;
	mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
	writeFileSync(dest, `${JSON.stringify({ at: new Date().toISOString(), uids: Object.fromEntries(entries) }, null, '\t')}\n`, 'utf8');
	return `${clean}/.rk-uids.json`;
}

/** 读回某个桶里记着的号; 没有 / 坏了返回 {} */
export function readStashedUids(config, bucket) {
	const clean = String(bucket ?? '').replace(/^\/+|\/+$/g, '');
	if (clean === '' || clean.includes('..')) return {};
	try {
		const data = JSON.parse(readFileSync(`${removeBoxFor(config)}/${clean}/.rk-uids.json`, 'utf8'));
		return data && typeof data.uids === 'object' && data.uids ? data.uids : {};
	} catch {
		return {};
	}
}

/** 删除整章目录(含其下所有小节/知识点/题目文件); bucket 由调用方决定, 省略则新开一个桶. */
export async function deleteDir(ctx, config, relDir, bucket) {
	const abs = safeDirPath(config, relDir);
	if (!abs) throw new Error(`invalid dir: ${relDir}`);
	await assertInsideRoot(ctx, config, abs, relDir);
	if (!existsSync(abs)) return { ok: true, dir: relDir, removed: false };
	if (!statSync(abs).isDirectory()) throw new Error(`not a directory: ${relDir}`);
	const movedTo = moveIntoRemove(config, relDir, abs, bucket);
	return { ok: true, dir: relDir, removed: true, movedTo, box: REMOVE_DIR, bucket: removeBucketName(bucket) || String(movedTo ?? '').split('/')[0] };
}

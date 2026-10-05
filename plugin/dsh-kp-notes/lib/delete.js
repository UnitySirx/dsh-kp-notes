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

import { MARKDOWN_RE, MAX_DEPTH, MAX_FILES, MEDIA_DIR_SUFFIX, MEDIA_LEGACY_PARENT_DIR, MEDIA_PARENT_DIR } from './constants.js?v=81';
import { resolveTarget, rootTargetOf } from './fsguard.js?v=81';
import { listDirSafe } from './templates.js?v=81';
import { isQuestionStorePath, noteStorePath, normalizeRelPath, questionPathFor } from './util.js?v=81';
import { safePath } from './write.js?v=81';

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
 * 打扫一个笔记文件时, 它引用的素材要怎么处理 —— 素材统一收在
 * <正文目录>/.media/<小节uid>.assestfiles/ 里(见 host 半 mediaHomeFor; 老库里那层还叫 media/):
 *   - 删的是**小节**(连带它的知识点 / 题目): 这一份素材目录属于这个小节, 整个搬进同一个桶 ——
 *     图跟着小节走, 想恢复时把桶里的东西移回去, 正文里的相对路径照旧能找到图;
 *   - 删的是单个知识点 / 题目: 那份素材目录是**整个小节共用**的, 所以只搬「这篇笔记引用、
 *     而画布里别的笔记已经不再引用」的那几个文件(别的笔记还在用的留着, 免得把它们弄丢);
 *   - 搬走之后空掉的 <uid>.assestfiles/ 与它上面那层 .media/(老库: media/)顺手清掉.
 */

/** 正文里的素材引用: …/.media/<uid>.assestfiles/<文件名>(笔记里存的是相对这篇笔记的路径) */
const MEDIA_REF_RE = /[^\s()"'<>[\]|]*\.assestfiles\/[^\s()"'<>[\]|]+/g;

/** 把 relPath(相对路径) 与它引用的素材路径拼起来, 吃掉 ./ 与 ../, 得到 root 相对路径 */
function joinRel(dir, ref) {
	const stack = [];
	for (const part of `${dir}/${ref}`.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
}

/** 一篇笔记的正文引用了哪些素材(root 相对路径) */
export function mediaRefsOf(text, relPath) {
	const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
	const out = new Set();
	for (const hit of String(text ?? '').match(MEDIA_REF_RE) ?? []) {
		const rel = joinRel(dir, hit);
		if (rel !== '' && rel.includes('/')) out.add(rel);
	}
	return out;
}

/** 素材路径所在的那些目录: <uid>.assestfiles/ 与它上面那层 .media/(老库: media/)(都可能空掉) */
function mediaDirsOf(rel) {
	const out = [];
	let dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
	while (dir !== '' && dir.endsWith(MEDIA_DIR_SUFFIX)) {
		out.push(dir);
		const cut = dir.lastIndexOf('/');
		if (cut <= 0) break;
		dir = dir.slice(0, cut);
	}
	if (dir === MEDIA_PARENT_DIR || dir.endsWith(`/${MEDIA_PARENT_DIR}`) || dir === MEDIA_LEGACY_PARENT_DIR || dir.endsWith(`/${MEDIA_LEGACY_PARENT_DIR}`)) out.push(dir);
	return out;
}

/** 画布里别的笔记还有没有引用这个素材(按文件名在 markdown 正文里找) —— 扫不完就当还在用, 保守留着 */
async function mediaStillReferenced(ctx, config, name) {
	const queue = [[config.noteDir, 0], [config.questionDir, 0]];
	let scanned = 0;
	while (queue.length > 0) {
		const [relDir, depth] = queue.shift();
		if (depth > MAX_DEPTH) continue;
		for (const entry of await listDirSafe(ctx, config, relDir)) {
			const entryName = String(entry.name ?? '');
			if (entryName.startsWith('.') || (config.exclude || []).includes(entryName)) continue;
			const rel = relDir === '' ? entryName : `${relDir}/${entryName}`;
			if (entry.type === 'directory') {
				if (entryName.endsWith(MEDIA_DIR_SUFFIX) || entryName === MEDIA_PARENT_DIR || entryName === MEDIA_LEGACY_PARENT_DIR) continue;
				queue.push([rel, depth + 1]);
				continue;
			}
			if (!MARKDOWN_RE.test(entryName)) continue;
			scanned += 1;
			if (scanned > MAX_FILES) return true;
			try {
				if (readFileSync(`${config.root}/${rel}`, 'utf8').includes(name)) return true;
			} catch {
				/* 读不动就当没引用 */
			}
		}
	}
	return false;
}

/** 把这次删掉的笔记引用的素材搬进桶(whole = 删的是小节 ⇒ 它的素材目录整份跟着走) */
async function moveMediaIntoBucket(ctx, config, refs, bucket, whole) {
	const moved = [];
	const dirs = new Set();
	for (const rel of refs) {
		const abs = `${config.root}/${rel}`;
		let isFile = false;
		try {
			isFile = statSync(abs).isFile();
		} catch {
			isFile = false;
		}
		if (!isFile) continue;
		const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
		if (whole) {
			dirs.add(dirRel);
			continue;
		}
		if (await mediaStillReferenced(ctx, config, rel.slice(rel.lastIndexOf('/') + 1))) continue;
		try {
			moved.push(moveIntoRemove(config, rel, abs, bucket));
		} catch {
			/* 搬不动就算了: 留在原地比丢掉好 */
		}
	}
	for (const dirRel of dirs) {
		const abs = `${config.root}/${dirRel}`;
		try {
			if (!statSync(abs).isDirectory()) continue;
			moved.push(moveIntoRemove(config, dirRel, abs, bucket));
		} catch {
			/* 目录不在 / 搬不动: 跳过 */
		}
	}
	if (moved.length === 0) return moved;
	const empties = new Set();
	for (const rel of refs) for (const dir of mediaDirsOf(rel)) empties.add(dir);
	for (const dir of [...empties].sort((a, b) => b.length - a.length)) {
		try {
			if (readdirSync(`${config.root}/${dir}`).length === 0) rmdirSync(`${config.root}/${dir}`);
		} catch {
			/* 目录不在 / 不空 / 删不掉: 跳过 */
		}
	}
	return moved;
}

/**
 * 删除一个笔记文件, 并连带删除同一知识点在题目目录(questions/)下的同名文件;
 * 删除小节文件时, 连带删除该小节下的全部知识点文件及其题目文件.
 * 被删掉的笔记**引用的素材**(.media/<小节uid>.assestfiles/…)也跟着进同一个桶, 见下面 mediaDirsToMove.
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
	const list = [...new Set(targets)];
	/* 动手之前先把这些笔记引用的素材记下来(搬走之后文件就读不到了) */
	const mediaRefs = new Set();
	for (const target of list) {
		const abs = safePath(ctx, config, target);
		if (!abs || !MARKDOWN_RE.test(target)) continue;
		try {
			for (const rel of mediaRefsOf(readFileSync(abs, 'utf8'), target)) mediaRefs.add(rel);
		} catch {
			/* 读不动就算了: 素材只是留在原地, 不会少东西 */
		}
	}
	/* 这次删除要搬走的一切(本体 + 连带的小节/知识点/题目)都进**同一个桶** */
	const bucket = removeBucketFor(config);
	let removed = false;
	const done = [];
	let movedTo = null;
	for (const target of list) {
		const result = await deleteFile(ctx, config, target, bucket);
		if (!result.removed) continue;
		removed = true;
		done.push(target);
		if (movedTo === null) movedTo = result.movedTo || null;
		if (target !== clean) related.push(target);
	}
	const prunedDirs = pruneEmptyDirs(config, done);
	const media = removed && mediaRefs.size > 0 ? await moveMediaIntoBucket(ctx, config, mediaRefs, bucket, sectionOrderOfPath(config, clean) !== null) : [];
	return { ok: true, path: clean, removed, related, prunedDirs, media, movedTo, box: REMOVE_DIR, bucket: removeBucketName(bucket) };
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

/**
 * 把一个 root 下 .remove/ 所有桶里记着的号合并读出来(键是绝对路径)。
 * 桶名就是时间戳, 名字升序 = 时间升序, 后面的覆盖前面的 —— 路径重名时以最近一次删除留下的号为准。
 */
export function readAllStashedUids(root) {
	const base = String(root ?? '').replace(/\/+$/, '');
	if (base === '') return {};
	let names = [];
	try {
		names = readdirSync(`${base}/${REMOVE_DIR}`).filter((name) => !name.startsWith('.')).sort();
	} catch {
		return {};
	}
	const out = {};
	for (const name of names) Object.assign(out, readStashedUids({ root: base }, name));
	return out;
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

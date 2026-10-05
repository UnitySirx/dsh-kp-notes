/* rk-study · host/uid —— 每个实体的「唯一编号」: 一个号只发一次, 永不复用
 *
 * 用户要的是: 不同的一级画布、章节、小节、知识点、题目各自有一个**唯一且不会重复**的编号,
 * 这样「删掉一个同名的、又建了一个同名的」这种事, 从身份上就不可能再混起来 ——
 * 路径只是路径, 认人靠 uid。
 *
 * 编号长这样: 类型前缀 + 4 位起、递增的数字
 *   c0001  一级画布 (canvas)
 *   h0007  章节     (chapter, notes/01-第一章 这样的目录)
 *   s0012  小节     (section, notes/01-第一章/01-第一节.md)
 *   p0031  知识点   (point,   notes/01-第一章/01-01-知识点.md)
 *   q0002  题目     (question, 题目文件里的一个 ## 题目 N 块)
 * 号只增不减: 删掉某个东西时, 它的号**跟着一起离开**(见 dropUids), 但计数器不动;
 * 于是在同一个位置重建同名东西时会拿到一个**新号**, 老号永远只属于原来那个东西。
 *
 * 号存在哪:
 *   - 目录(canvas / chapter)没有 frontmatter 可写, 记在**学习库**的号池文件
 *     <库>/.config/rk-study-uids.json 的 `uids`(绝对路径 -> uid);
 *     发号计数器 `seq`(每类下一个号)仍在 <库>/.config/rk-study.json 里;
 *   - 文件(section / point / question)另有办法把 uid 写进 markdown 的 frontmatter,
 *     这里只负责发号, 落盘由调用方决定(见 routes.js / write.js)。
 * 之所以不放画布自己的 .config: 插件一直保持「单张画布不写盘、笔记目录干干净净」这条规矩。
 *
 * 读写全部走 libconfig 的 readLibConfig / writeLibConfig / readUidStore / writeUidStore
 * (带 1 秒缓存, 只认白名单键), 这里不碰 node:fs —— 也就没有越界写盘的可能。
 */

import { readLibConfig, writeLibConfig, readUidStore, writeUidStore } from './libconfig.js?v=90';

/** 五类实体; 前缀既是类型标记, 也方便 grep(比如找出所有 h0007 的引用) */
export const UID_PREFIX = { canvas: 'c', chapter: 'h', section: 's', point: 'p', question: 'q' };

const KIND_OF_PREFIX = { c: 'canvas', h: 'chapter', s: 'section', p: 'point', q: 'question' };

/** 上限: 一个库里每种实体十万级足够; 也是防手滑写脏配置 */
const MAX_SEQ = 999999999;

const UID_RE = /^([chspq])(\d{4,9})$/;

/** 把号写成 c0001 / h0007 这样; 数字超过 4 位自然变长(不会截断) */
export function formatUid(kind, number) {
	const prefix = UID_PREFIX[kind];
	if (!prefix) throw new Error(`bad-uid-kind: ${kind}`);
	const value = Math.floor(Number(number));
	if (!Number.isFinite(value) || value < 1 || value > MAX_SEQ) throw new Error(`bad-uid-number: ${number}`);
	return `${prefix}${String(value).padStart(4, '0')}`;
}

/** 这个字符串是不是(某类的)合法 uid; kind 省略时任何一类都算 */
export function isUid(value, kind) {
	const hit = UID_RE.exec(String(value ?? ''));
	if (!hit) return false;
	return kind === undefined ? true : KIND_OF_PREFIX[hit[1]] === kind;
}

/** 取号里的数字, 不是合法 uid 时返回 0 */
export function uidNumber(value) {
	const hit = UID_RE.exec(String(value ?? ''));
	return hit ? Number(hit[2]) : 0;
}

/** 取号所属的类别, 不是合法 uid 时返回 '' */
export function uidKind(value) {
	const hit = UID_RE.exec(String(value ?? ''));
	return hit ? KIND_OF_PREFIX[hit[1]] : '';
}

function cleanList(paths) {
	const out = [];
	for (const raw of Array.isArray(paths) ? paths : []) {
		const text = String(raw ?? '');
		if (text === '' || out.indexOf(text) >= 0) continue;
		out.push(text);
	}
	return out;
}

/**
 * 给一批路径发号(已经发过的原样返回)。**一次调用只写一次配置**, 所以扫描时补号、
 * 新建一整章时补号, 都不会一个文件写一次盘。
 * 返回 { 绝对路径: uid }; 传入空数组时原样返回 {}, 不写盘。
 */
export async function ensureUids(ctx, lib, kind, paths) {
	const list = cleanList(paths);
	const out = {};
	if (list.length === 0) return out;
	if (!UID_PREFIX[kind]) throw new Error(`bad-uid-kind: ${kind}`);
	const config = await readLibConfig(ctx, lib, true);
	const uids = { ...(await readUidStore(ctx, lib, true)) };
	let next = Math.max(0, Math.min(MAX_SEQ, Math.floor(Number((config.seq || {})[kind]) || 0)));
	const patch = {};
	for (const abs of list) {
		const hit = uids[abs];
		if (isUid(hit, kind)) {
			out[abs] = hit;
			continue;
		}
		next += 1;
		const uid = formatUid(kind, next);
		uids[abs] = uid;
		patch[abs] = uid;
		out[abs] = uid;
	}
	if (Object.keys(patch).length > 0) {
		await writeLibConfig(ctx, lib, { seq: { [kind]: next } });
		await writeUidStore(ctx, lib, patch);
	}
	return out;
}

/** 只读地查一批路径的号; 没发过的不会出现在结果里(不会顺手发号) */
export async function uidsFor(ctx, lib, paths) {
	const list = cleanList(paths);
	const out = {};
	if (list.length === 0) return out;
	const uids = await readUidStore(ctx, lib);
	for (const abs of list) {
		if (isUid(uids[abs])) out[abs] = uids[abs];
	}
	return out;
}

/**
 * 把号跟着实体搬家(插件自己改名时用: renameChapter / 改名画布)。
 * 返回搬过去的 uid; 原来没号就返回 ''。
 */
export async function moveUid(ctx, lib, fromAbs, toAbs) {
	const from = String(fromAbs ?? '');
	const to = String(toAbs ?? '');
	if (from === '' || to === '' || from === to) return '';
	const uids = await readUidStore(ctx, lib, true);
	const hit = uids[from];
	if (!isUid(hit)) return '';
	await writeUidStore(ctx, lib, { [from]: null, [to]: hit });
	return hit;
}

/**
 * 实体离开(删除 / 移出列表)时把它的号从「当前路径表」里摘掉 —— 计数器不回退,
 * 所以以后在同一个位置重建同名东西时会拿到新号; 老号只属于原来那个东西。
 * (删除时调用方还会把号记进 .remove 的桶里, 见 delete.js, 这样恢复时能认回来。)
 * 返回**被摘掉的** { 路径: uid }。
 */
export async function dropUids(ctx, lib, paths) {
	const list = cleanList(paths);
	const out = {};
	if (list.length === 0) return out;
	const table = await readUidStore(ctx, lib, true);
	const patch = {};
	for (const abs of list) {
		if (!isUid(table[abs])) continue;
		out[abs] = table[abs];
		patch[abs] = null;
	}
	if (Object.keys(patch).length === 0) return out;
	await writeUidStore(ctx, lib, patch);
	return out;
}

/**
 * 认回一批号(从 .remove 桶里的 .rk-uids.json 恢复时用): 只有当某个路径**现在没有号**
 * 且候选号跟类别的前缀对得上时才写。返回真正认回来的 { 路径: uid }。
 */
export async function adoptUids(ctx, lib, mapping) {
	const entries = mapping && typeof mapping === 'object' ? Object.entries(mapping) : [];
	if (entries.length === 0) return {};
	const uids = { ...(await readUidStore(ctx, lib, true)) };
	const patch = {};
	for (const [abs, uid] of entries) {
		const key = String(abs ?? '');
		if (key === '' || !isUid(uid)) continue;
		if (isUid(uids[key])) continue;
		uids[key] = String(uid);
		patch[key] = String(uid);
	}
	if (Object.keys(patch).length === 0) return {};
	await writeUidStore(ctx, lib, patch);
	return patch;
}

/** 当前路径表(绝对路径 -> uid)的副本; 给扫描/画布列表一次性取用 */
/** 从 markdown 文本的 frontmatter 里读 uid（限定 kind；认不出来返回空串）。 */
export function uidFromText(text, kind) {
	const raw = typeof text === 'string' ? text : '';
	if (raw === '') return '';
	const lines = raw.split(/\r?\n/);
	if (lines.length === 0 || lines[0].trim() !== '---') return '';
	for (let i = 1; i < lines.length && i < 400; i += 1) {
		const line = lines[i].trim();
		if (line === '---') break;
		const match = /^uid\s*[:：]\s*(.*)$/.exec(line);
		if (match) {
			const value = match[1].trim().replace(/^["']|["']$/g, '');
			return isUid(value, kind) ? value : '';
		}
	}
	return '';
}

/** 把 uid 写进 markdown 的 frontmatter（已经有了就替换；没有 frontmatter 就在开头补一个）。 */
export function withUidText(text, uid) {
	const raw = typeof text === 'string' ? text : String(text ?? '');
	if (!isUid(uid)) return raw;
	const lines = raw.split(/\r?\n/);
	if (lines.length > 0 && lines[0].trim() === '---') {
		let end = -1;
		for (let i = 1; i < lines.length; i += 1) {
			if (lines[i].trim() === '---') {
				end = i;
				break;
			}
			if (/^uid\s*[:：]/.test(lines[i].trim())) {
				lines[i] = `uid: ${uid}`;
				return lines.join('\n');
			}
		}
		if (end > 0) {
			lines.splice(end, 0, `uid: ${uid}`);
			return lines.join('\n');
		}
	}
	const body = raw.replace(/^\n+/, '');
	return body === '' ? `---\nuid: ${uid}\n---\n` : `---\nuid: ${uid}\n---\n\n${body}`;
}

/** 只发一个号、不记路径 —— 给写进文件 frontmatter 的小节/知识点用（章节/画布仍用 ensureUids 记路径）。 */
export async function takeUid(ctx, lib, kind) {
	if (!UID_PREFIX[kind]) throw new Error(`bad-uid-kind: ${kind}`);
	const config = await readLibConfig(ctx, lib, true);
	const next = Math.max(0, Math.min(MAX_SEQ, Math.floor(Number((config.seq || {})[kind]) || 0))) + 1;
	await writeLibConfig(ctx, lib, { seq: { [kind]: next } });
	return formatUid(kind, next);
}

/** 认一个已经写在文件里的号：把计数器抬到它之上，保证以后不会再发同一个号。 */
export async function adoptUid(ctx, lib, kind, uid) {
	if (!isUid(uid, kind)) return '';
	const number = uidNumber(uid);
	const config = await readLibConfig(ctx, lib, true);
	const current = Math.max(0, Math.min(MAX_SEQ, Math.floor(Number((config.seq || {})[kind]) || 0)));
	if (number > current) await writeLibConfig(ctx, lib, { seq: { [kind]: number } });
	return uid;
}

export async function uidTable(ctx, lib) {
	const table = await readUidStore(ctx, lib);
	const out = {};
	for (const [abs, uid] of Object.entries(table)) {
		if (isUid(uid)) out[abs] = uid;
	}
	return out;
}

/** 每类下一个号的快照(调试 / 测试用) */
export async function uidSeq(ctx, lib) {
	const config = await readLibConfig(ctx, lib);
	const out = {};
	for (const kind of Object.keys(UID_PREFIX)) {
		out[kind] = Math.max(0, Math.floor(Number((config.seq || {})[kind]) || 0));
	}
	return out;
}

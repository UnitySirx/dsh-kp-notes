/* 学习库(画布存放目录)自己的配置: <库>/.config/rk-study.json
 *
 * 只有**学习库那一级**写这个文件 —— 例如 <学习库>/.config/rk-study.json。
 * 单张画布自己不再写盘(画布名 = 目录名, 模板在 .templates/), 所以笔记目录里干干净净。
 *
 * 目录名固定 `.config`, 文件名固定 `rk-study.json`: 配置跟着笔记走(git 同步、换浏览器/换机器都还在)。
 * 文件很小, 读写直接用 node:fs 同步完成, 读结果按路径缓存 1 秒。
 *
 * 顶层只有这几个键(白名单, 客户端随手塞的东西不会进笔记目录):
 *   version  : 1
 *   ui       : 字号 / 配色(整套皮肤) / 卡片逐项配色
 *   zoom     : 每张画布的视野(缩放 + 平移), 键是 "roots"(一级画布) 或画布绝对路径
 *   canvases : 列表里的画布 [{ path, name }](「＋ 新建学习画布」建过的)
 *   removed  : —— 也搬走了, 见下面那一段
 *   uid      : 这个学习库自己的编号(形如 c0001, 见 uid.js)
 *   seq      : 每类实体「已经发到几号」{ canvas, chapter, section, point, question } —— 只增不减, 号永不复用
 *
 * 两份「机器账本」搬到了同目录下各自的文件, 这份配置只留界面设置:
 *   - `uids`(绝对路径 -> 编号) ⇒ rk-study-uids.json, 见下面 readUidStore / writeUidStore
 *   - `removed`(移出列表的墓碑, 绝对路径数组) ⇒ rk-study-removed.json, 见 readRemovedStore / writeRemovedStore
 * 它们都是按实体条数长大的账本(几百上千条), 混在界面配置里又长又难读。
 * 老版本混在这份文件里的同名老键**照读**(向后兼容), 第一次写它们时把老键摘掉 ——
 * 迁移是一次性、无损的, 号一个都不变、墓碑一条都不丢。
 * `uids` 里值写 null 表示「这个路径的号没了(删了/改名了)」; removed 是整份名单, 写就是替换。
 */

import { CACHE_TTL_MS, CONFIG_DIR, CONFIG_FILE, REMOVED_FILE, UIDS_FILE } from './constants.js?v=71';

const cache = new Map();
/* 号池单独缓存: 键是 <库>/.config/rk-study-uids.json 的绝对路径 */
const uidCache = new Map();
/* 移出列表单独缓存: 键是 <库>/.config/rk-study-removed.json 的绝对路径 */
const removedCache = new Map();
/** 插件卸载时清掉这份模块级缓存(由 routes.js 的 ctx.effect 调用)。 */
export function clearLibConfigCache() {
	cache.clear();
	uidCache.clear();
	removedCache.clear();
}
/* 上限只是防手滑: 一个库几百张画布绰绰有余, 也不会让文件无限膨胀 */
const MAX_ZOOM_KEYS = 400;
const MAX_CANVASES = 1000;
const MAX_REMOVED = 1000;
const MAX_UIDS = 20000;
const MAX_SEQ = 999999999;
const UID_RE = /^[chspq]\d{4,9}$/;
const SEQ_KEYS = ['canvas', 'chapter', 'section', 'point', 'question'];
const MAX_SCALE = 4;
const MIN_SCALE = 0.05;
const FONT_MIN = 60;
const FONT_MAX = 260;

export function configDirOf(lib) {
	const clean = String(lib ?? '').replace(/\/+$/, '');
	return clean === '' ? '' : `${clean}/${CONFIG_DIR}`;
}

export function configPathOf(lib) {
	const dir = configDirOf(lib);
	return dir === '' ? '' : `${dir}/${CONFIG_FILE}`;
}

/** 号池文件: <库>/.config/rk-study-uids.json */
export function uidConfigPathOf(lib) {
	const dir = configDirOf(lib);
	return dir === '' ? '' : `${dir}/${UIDS_FILE}`;
}

/** 移出列表文件: <库>/.config/rk-study-removed.json */
export function removedConfigPathOf(lib) {
	const dir = configDirOf(lib);
	return dir === '' ? '' : `${dir}/${REMOVED_FILE}`;
}

function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanPath(value) {
	const text = String(value ?? '').trim();
	if (text.length === 0 || text.length > 512) return '';
	if (text.charAt(0) !== '/' || text.includes('..') || text.includes('\n') || text.includes('\t')) return '';
	return text.replace(/\/+$/, '') || '/';
}

function cleanLabel(value, fallback) {
	const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
	const label = text === '' ? fallback : text;
	return label.slice(0, 60);
}

/* 视野: { x, y, scale }; 比例范围就是画布自己的上下限, 这里放宽一点只防脏数据 */
function cleanView(raw) {
	if (!isObject(raw)) return null;
	return {
		x: Math.round(clampNumber(raw.x, -1000000, 1000000, 0)),
		y: Math.round(clampNumber(raw.y, -1000000, 1000000, 0)),
		scale: Math.round(clampNumber(raw.scale, MIN_SCALE, MAX_SCALE, 1) * 10000) / 10000,
	};
}

function cleanZoom(raw) {
	const out = {};
	if (!isObject(raw)) return out;
	let count = 0;
	for (const [key, value] of Object.entries(raw)) {
		if (count >= MAX_ZOOM_KEYS) break;
		const name = String(key ?? '').trim();
		if (name === '') continue;
		if (value === null) {
			out[name] = null; /* null = 删掉这一条(画布改名/删除后清掉旧键) */
			count += 1;
			continue;
		}
		const view = cleanView(value);
		if (!view) continue;
		out[name] = view;
		count += 1;
	}
	return out;
}

function cleanCanvases(raw) {
	if (!Array.isArray(raw)) return null;
	const out = [];
	for (const item of raw) {
		if (out.length >= MAX_CANVASES) break;
		if (!isObject(item)) continue;
		const path = cleanPath(item.path);
		if (path === '') continue;
		out.push({ path, name: cleanLabel(item.name, path.split('/').pop() || path) });
	}
	return out;
}

function cleanRemoved(raw) {
	if (!Array.isArray(raw)) return null;
	const out = [];
	for (const item of raw) {
		if (out.length >= MAX_REMOVED) break;
		const path = cleanPath(item);
		if (path === '' || out.indexOf(path) >= 0) continue;
		out.push(path);
	}
	return out;
}

function cleanUi(raw) {
	const out = {};
	if (!isObject(raw)) return out;
	if ('fontScale' in raw) out.fontScale = Math.round(clampNumber(raw.fontScale, FONT_MIN, FONT_MAX, 100));
	if (typeof raw.skin === 'string' && /^[a-z0-9-]{1,24}$/.test(raw.skin)) out.skin = raw.skin;
	if ('cardColors' in raw) out.cardColors = raw.cardColors !== false;
	return out;
}

/* 发号计数: 只认五类关键字, 值取 0..MAX_SEQ 的整数; 脏值直接丢掉(宁可从 0 开始, 也不发重复号) */
function cleanSeq(raw) {
	const out = {};
	if (!isObject(raw)) return out;
	for (const key of SEQ_KEYS) {
		if (!(key in raw)) continue;
		const value = Math.floor(Number(raw[key]));
		if (Number.isFinite(value) && value >= 0 && value <= MAX_SEQ) out[key] = value;
	}
	return out;
}

/* 路径 -> 编号; null 是「删掉这条」(deepMerge 会把键删掉), 保留原样透传 */
function cleanUids(raw) {
	const out = {};
	if (!isObject(raw)) return out;
	let count = 0;
	for (const [key, value] of Object.entries(raw)) {
		if (count >= MAX_UIDS) break;
		const abs = cleanPath(key);
		if (abs === '') continue;
		if (value === null) {
			out[abs] = null;
			count += 1;
			continue;
		}
		const uid = String(value ?? '');
		if (!UID_RE.test(uid)) continue;
		out[abs] = uid;
		count += 1;
	}
	return out;
}

/* 只认白名单里的顶层键, 并且把值洗干净 */
function cleanTop(patch) {
	const out = {};
	if (!isObject(patch)) return out;
	if ('version' in patch) out.version = 1;
	if ('uid' in patch && UID_RE.test(String(patch.uid ?? ''))) out.uid = String(patch.uid);
	const ui = cleanUi(patch.ui);
	if (Object.keys(ui).length > 0) out.ui = ui;
	if (isObject(patch.zoom)) out.zoom = cleanZoom(patch.zoom);
	const canvases = cleanCanvases(patch.canvases);
	if (canvases) out.canvases = canvases;
	/* removed 也住在自己那份文件里; 这里只认「显式 null = 把老键从这份配置里摘掉」(迁移用) */
	if (patch.removed === null) out.removed = null;
	else {
		const removed = cleanRemoved(patch.removed);
		if (removed) out.removed = removed;
	}
	if (isObject(patch.seq)) out.seq = cleanSeq(patch.seq);
	/* uids 现在住在号池那个文件里; 这里只认「显式 null = 把老键从这份配置里摘掉」(迁移用) */
	if (patch.uids === null) out.uids = null;
	else if (isObject(patch.uids)) out.uids = cleanUids(patch.uids);
	return out;
}

/* 深度合并; 值为 null 表示「删掉这个键」(客户端能撤销单条记录, 比如画布改名后清掉旧路径)。
   注意 null 的删除在**任意深度**都要生效(uids 就是靠它删单条), 所以对象一律递归合并,
   不能因为 base 里还没有这个键就把 patch 的对象整个搬过去 —— 那样里面夹的 null 会留在文件里。 */
function deepMerge(base, patch) {
	const out = { ...(isObject(base) ? base : {}) };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			delete out[key];
			continue;
		}
		if (isObject(value)) out[key] = deepMerge(isObject(out[key]) ? out[key] : {}, value);
		else out[key] = value;
	}
	return out;
}

/* 读某个学习库的配置; 文件不存在、JSON 坏了都返回 {}。fresh 为真时跳过 1 秒缓存。 */
export async function readLibConfig(ctx, lib, fresh) {
	const path = configPathOf(lib);
	if (path === '') return {};
	const hit = cache.get(path);
	if (fresh !== true && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
	let data = {};
	try {
		const target = await ctx.fs.resolve(path);
		if (await ctx.fs.stat(target)) data = cleanTop(JSON.parse(await ctx.fs.readText(target)));
	} catch {
		data = {};
	}
	cache.set(path, { at: Date.now(), data });
	return data;
}

/* 把 patch 深度合并进配置文件(不覆盖同层的其它键), 返回合并后的完整配置; 目录不存在时 ctx.fs 会自己建。 */
export async function writeLibConfig(ctx, lib, patch) {
	const path = configPathOf(lib);
	if (path === '') throw new Error('bad-config-root');
	const merged = deepMerge(await readLibConfig(ctx, lib, true), cleanTop(patch));
	merged.version = 1;
	const target = await ctx.fs.resolve(path);
	await ctx.fs.writeText(target, `${JSON.stringify(merged, null, '\t')}\n`, undefined, undefined, { mode: 'workspace-write', workspaceRoot: lib });
	cache.set(path, { at: Date.now(), data: merged });
	return merged;
}

/* 读号池(绝对路径 -> uid)。文件不存在 / 坏了 ⇒ 回退到老版本的 rk-study.json.uids(还没搬过的库照常认号)。 */
export async function readUidStore(ctx, lib, fresh) {
	const path = uidConfigPathOf(lib);
	if (path === '') return {};
	const hit = uidCache.get(path);
	if (fresh !== true && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
	let data = null;
	try {
		const target = await ctx.fs.resolve(path);
		if (await ctx.fs.stat(target)) {
			const parsed = JSON.parse(await ctx.fs.readText(target));
			data = cleanUids(isObject(parsed) ? parsed.uids : {});
		}
	} catch {
		data = null;
	}
	/* 老键只用来「补缺」: 号池里已经有的为准(它才是删过号的权威), 老配置里还有的照读 ——
	   迁移把老键摘掉之后这段就自然什么都不做。 */
	const legacy = cleanUids((await readLibConfig(ctx, lib, fresh)).uids);
	if (Object.keys(legacy).length > 0) data = { ...legacy, ...(data || {}) };
	else if (data === null) data = {};
	uidCache.set(path, { at: Date.now(), data });
	return data;
}

/* 把一批号写进号池(值 null = 删掉那条); 返回写完之后的完整号表。
   第一次写就把老版本混在 rk-study.json 里的 uids 摘掉 —— 迁移是一次性、无损的。 */
export async function writeUidStore(ctx, lib, patch) {
	const path = uidConfigPathOf(lib);
	if (path === '') throw new Error('bad-config-root');
	const merged = deepMerge(await readUidStore(ctx, lib, true), cleanUids(patch));
	const target = await ctx.fs.resolve(path);
	await ctx.fs.writeText(target, `${JSON.stringify({ version: 1, uids: merged }, null, '\t')}\n`, undefined, undefined, { mode: 'workspace-write', workspaceRoot: lib });
	uidCache.set(path, { at: Date.now(), data: merged });
	if ('uids' in (await readLibConfig(ctx, lib, true))) await writeLibConfig(ctx, lib, { uids: null });
	return merged;
}

/* 读移出列表(绝对路径数组, 墓碑)。这个独立文件一旦建出来它就是权威 ——
 * 哪怕内容是空数组, 也不再并老键: 不然「取消墓碑」会被 rk-study.json 里那条老记录加回来。
 * 文件还没建(老版本)时认老键, 第一次写就迁移过去。 */
export async function readRemovedStore(ctx, lib, fresh) {
	const path = removedConfigPathOf(lib);
	if (path === '') return [];
	const hit = removedCache.get(path);
	if (fresh !== true && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
	let data = null;
	try {
		const target = await ctx.fs.resolve(path);
		if (await ctx.fs.stat(target)) {
			const parsed = JSON.parse(await ctx.fs.readText(target));
			data = cleanRemoved(isObject(parsed) ? parsed.removed : null);
		}
	} catch {
		data = null;
	}
	if (data === null) data = cleanRemoved((await readLibConfig(ctx, lib, fresh)).removed) || [];
	removedCache.set(path, { at: Date.now(), data });
	return data;
}

/* 写移出列表: 客户端送来的是完整名单 ⇒ 整份替换(null / 非数组 = 清空);
   第一次写就把老版本混在 rk-study.json 里的 removed 摘掉。 */
export async function writeRemovedStore(ctx, lib, list) {
	const path = removedConfigPathOf(lib);
	if (path === '') throw new Error('bad-config-root');
	const next = cleanRemoved(list) || [];
	const target = await ctx.fs.resolve(path);
	await ctx.fs.writeText(target, `${JSON.stringify({ version: 1, removed: next }, null, '\t')}\n`, undefined, undefined, { mode: 'workspace-write', workspaceRoot: lib });
	removedCache.set(path, { at: Date.now(), data: next });
	if ('removed' in (await readLibConfig(ctx, lib, true))) await writeLibConfig(ctx, lib, { removed: null });
	return next;
}

export async function configBytesOf(ctx, lib) {
	try {
		const info = await ctx.fs.stat(await ctx.fs.resolve(configPathOf(lib)));
		return info?.size ?? 0;
	} catch {
		return 0;
	}
}

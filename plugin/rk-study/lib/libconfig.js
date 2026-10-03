/* 学习库(画布存放目录)自己的配置: <库>/.config/rk-study.json
 *
 * 只有**学习库那一级**写这个文件 —— 例如 /Users/unitysir/Desktop/WorkNotes/.config/rk-study.json。
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
 *   removed  : 手动「移出列表」的画布(墓碑, 重新扫描也不会加回来)
 */

import { CACHE_TTL_MS, CONFIG_DIR, CONFIG_FILE } from './constants.js?v=41';

const cache = new Map();
/** 插件卸载时清掉这份模块级缓存(由 routes.js 的 ctx.effect 调用)。 */
export function clearLibConfigCache() {
	cache.clear();
}
/* 上限只是防手滑: 一个库几百张画布绰绰有余, 也不会让文件无限膨胀 */
const MAX_ZOOM_KEYS = 400;
const MAX_CANVASES = 1000;
const MAX_REMOVED = 1000;
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

/* 只认白名单里的顶层键, 并且把值洗干净 */
function cleanTop(patch) {
	const out = {};
	if (!isObject(patch)) return out;
	if ('version' in patch) out.version = 1;
	const ui = cleanUi(patch.ui);
	if (Object.keys(ui).length > 0) out.ui = ui;
	if (isObject(patch.zoom)) out.zoom = cleanZoom(patch.zoom);
	const canvases = cleanCanvases(patch.canvases);
	if (canvases) out.canvases = canvases;
	const removed = cleanRemoved(patch.removed);
	if (removed) out.removed = removed;
	return out;
}

/* 深度合并; 值为 null 表示「删掉这个键」(客户端能撤销单条记录, 比如画布改名后清掉旧路径)。 */
function deepMerge(base, patch) {
	const out = { ...(isObject(base) ? base : {}) };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			delete out[key];
			continue;
		}
		if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
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

export async function configBytesOf(ctx, lib) {
	try {
		const info = await ctx.fs.stat(await ctx.fs.resolve(configPathOf(lib)));
		return info?.size ?? 0;
	} catch {
		return 0;
	}
}

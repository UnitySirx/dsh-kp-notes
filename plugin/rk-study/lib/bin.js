/* rk-study · lib/bin.js —— 回收站
 *
 * 删除章节/小节/知识点、以及把画布「移出列表」，都只是把东西搬进 .remove/<桶>/ 里（见 delete.js）。
 * 这里做两件事：
 *   1. 把桶读出来给界面看（listBin / listAllBins）—— 一条记录 = 桶里的一个顶层条目，
 *      原位置 = <桶所属目录>/<桶内相对路径>；
 *   2. 把它搬回去（restoreItem / restoreBucket）—— 原位已经有东西就**拒绝**（绝不覆盖），
 *      搬回去以后按桶里的 .rk-uids.json 认回原来的号，桶空了就把桶目录清掉。
 *
 * 桶有两只来源，界面上要一起看：
 *   · <画布根>/.remove    画布里删掉的章节 / 小节 / 知识点 / 题目片段
 *   · <上一层>/.remove    被「移出列表」的画布（画布目录被挪到了同层的 .remove 里）
 * 所以一级画布那一层会把自己和每张画布的父目录都算上（listAllBins），每条记录带着自己的 box，
 * 恢复时按 box 找回它属于哪个目录。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { removeBoxFor } from './delete.js?v=55';
import { adoptUids } from './uid.js?v=55';

const REMOVE_DIR = '.remove';
const MAX_BUCKETS = 200;
const MAX_ITEMS = 2000;
const MAX_DEPTH = 6;

/** 桶内相对路径：不能是绝对路径、不能有 .. 、不能是点开头的（桶里的 .rk-uids.json 是我们自己的账本） */
function cleanRel(value) {
	const text = String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (text === '') return '';
	for (const part of text.split('/')) {
		if (part === '' || part === '.' || part === '..' || part.startsWith('.')) return '';
	}
	return text;
}

/** 桶名就是一个目录名：单层、不以点开头（正常是 YYYYMMDD，同一天里再来会带 -2） */
function cleanBucket(value) {
	const text = String(value ?? '').replace(/^\/+|\/+$/g, '');
	if (text === '' || text.includes('/') || text.startsWith('.')) return '';
	return text;
}

/** 给人看的桶时间：桶名是删除那天的日期（20261004，同一天再来会带 -2），也容得下带时分秒的老写法 */
function bucketLabel(name) {
	const text = String(name);
	const date = /^(\d{4})(\d{2})(\d{2})(-\d+)?$/.exec(text);
	if (date) return `${date[1]}-${date[2]}-${date[3]}${date[4] || ''}`;
	const full = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(text);
	return full ? `${full[1]}-${full[2]}-${full[3]} ${full[4]}:${full[5]}:${full[6]}` : text;
}

/** 这个目录对应的回收站目录 */
function boxOf(root) {
	const base = String(root ?? '').replace(/\/+$/, '');
	return base === '' || base.charAt(0) !== '/' ? '' : removeBoxFor({ root: base });
}

/** 回收站目录 → 它属于哪个目录；不是 <目录>/.remove 这个形状就返回 '' */
function rootOfBox(box) {
	const text = String(box ?? '').replace(/\/+$/, '');
	if (text === '' || text.charAt(0) !== '/' || !text.endsWith('/' + REMOVE_DIR)) return '';
	return text.slice(0, text.length - REMOVE_DIR.length - 1) || '/';
}

/** 上一层目录（一级画布那一层要把「被移出列表的画布」躺着的那只桶也算进来） */
function parentOfDir(value) {
	const text = String(value ?? '').replace(/\/+$/, '');
	if (text === '' || text.charAt(0) !== '/') return '';
	const cut = text.lastIndexOf('/');
	return cut <= 0 ? '/' : text.slice(0, cut);
}

/** 客户端点名要哪只桶时用它；不合规返回 ''（退回 config.root 那只） */
function cleanBoxPath(value) {
	return rootOfBox(value) === '' ? '' : String(value).replace(/\/+$/, '');
}

/** 桶里记着的号（<box>/<桶>/.rk-uids.json，键是绝对路径）；没有 / 坏了返回 {} */
function readBoxUids(box, bucket) {
	const clean = cleanBucket(bucket);
	if (clean === '' || rootOfBox(box) === '') return {};
	try {
		const data = JSON.parse(readFileSync(`${box}/${clean}/.rk-uids.json`, 'utf8'));
		return data && typeof data.uids === 'object' && data.uids ? data.uids : {};
	} catch {
		return {};
	}
}

/** 一只 .remove 目录里有什么：{ box, root, boxes, buckets: [{ name, at, count, box, root, items: [...] }] } */
export function listBin(config, box) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const root = rootOfBox(useBox);
	if (useBox === '' || root === '') return { box: '', root: '', boxes: [], buckets: [] };
	let names = [];
	try {
		names = readdirSync(useBox).filter((name) => !name.startsWith('.')).sort().reverse();
	} catch {
		return { box: useBox, root, boxes: [useBox], buckets: [] };
	}
	const buckets = [];
	for (const name of names) {
		if (buckets.length >= MAX_BUCKETS) break;
		const dir = `${useBox}/${name}`;
		const stashed = readBoxUids(useBox, name);
		const items = [];
		const walk = (rel, depth) => {
			let entries = [];
			try {
				entries = readdirSync(rel === '' ? dir : `${dir}/${rel}`, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (items.length >= MAX_ITEMS) return;
				if (entry.name.startsWith('.')) continue;
				const item = rel === '' ? entry.name : `${rel}/${entry.name}`;
				const target = `${root}/${item}`;
				const parent = item.includes('/') ? `${root}/${item.slice(0, item.lastIndexOf('/'))}` : root;
				const exists = existsSync(target);
				/* 只列「影子树的根」: 原位没有它、但它的父目录还在 —— 恢复它就是把整棵子树搬回去。
				 * 原位还在的目录是桶留下的空壳容器（里面装的是更深的记录），钻进去继续找。 */
				if (!exists && existsSync(parent)) {
					let size = 0;
					let mtime = 0;
					try {
						const info = statSync(`${dir}/${item}`);
						size = info.isDirectory() ? 0 : info.size;
						mtime = Math.round(info.mtimeMs);
					} catch {
						/* 读不到就留 0 */
					}
					items.push({
						item,
						kind: entry.isDirectory() ? 'dir' : 'file',
						size,
						mtime,
						target,
						uid: stashed[target] || '',
					});
					continue;
				}
				if (exists && entry.isDirectory() && depth + 1 < MAX_DEPTH) walk(item, depth + 1);
			}
		};
		walk('', 0);
		buckets.push({ name, at: bucketLabel(name), count: items.length, box: useBox, root, items });
	}
	return { box: useBox, root, boxes: [useBox], buckets };
}

/**
 * 一级画布那一层看回收站：把「当前这个目录」以及每一张已知画布的父目录都算上
 * —— 画布里删掉的东西躺在 <画布>/.remove，被移出列表的画布躺在 <上一层>/.remove。
 * 同一个名字的桶可能出现在不同目录里，所以每条记录都带着自己的 box。
 */
export function listAllBins(config, extraRoots) {
	const dirs = [];
	const add = (value) => {
		const base = String(value ?? '').replace(/\/+$/, '');
		if (base === '' || base.charAt(0) !== '/') return;
		for (const one of [base, parentOfDir(base)]) {
			if (one === '' || one === '/' || dirs.includes(one)) continue;
			dirs.push(one);
		}
	};
	add(config.root);
	for (const item of Array.isArray(extraRoots) ? extraRoots : []) add(item && typeof item === 'object' ? item.path : item);
	const boxes = [];
	const buckets = [];
	for (const base of dirs) {
		const box = boxOf(base);
		if (box === '' || !existsSync(box)) continue;
		boxes.push(box);
		for (const bucket of listBin({ root: base }, box).buckets) buckets.push(bucket);
	}
	buckets.sort((a, b) => (a.name === b.name ? (a.root < b.root ? -1 : 1) : a.name < b.name ? 1 : -1));
	const root = String(config.root ?? '').replace(/\/+$/, '');
	return { box: boxOf(root), root, boxes, buckets: buckets.slice(0, MAX_BUCKETS) };
}

/**
 * 桶里没有真东西了就清掉它：先删掉里面空掉的容器目录（搬走一条记录，它的父目录往往会空下来），
 * 整桶都空了（只剩我们自己的 .rk-uids.json 也算空）就把桶目录一起删掉。
 */
function pruneTree(box, bucket) {
	const dir = `${box}/${cleanBucket(bucket)}`;
	const isEmpty = (path) => {
		let entries = [];
		try {
			entries = readdirSync(path, { withFileTypes: true });
		} catch {
			return false;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
			if (isEmpty(`${path}/${entry.name}`)) {
				try {
					rmdirSync(`${path}/${entry.name}`);
				} catch {
					/* 清不掉就算了 */
				}
			}
		}
		let rest = [];
		try {
			rest = readdirSync(path);
		} catch {
			return false;
		}
		return rest.every((name) => name.startsWith('.'));
	};
	if (isEmpty(dir)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* 清不掉就算了，不影响恢复本身 */
		}
	}
}

/** 桶全恢复走了，连 .remove 自己都空了就顺手收掉（里面还有别的桶/账本就不动） */
function tidyBox(box) {
	if (box === '' || !existsSync(box)) return;
	try {
		if (readdirSync(box).length === 0) rmdirSync(box);
	} catch {
		/* 收不掉也没关系 */
	}
}

/** 把桶里的一条搬回原位；原位已经有东西就拒绝（不覆盖）。box 省略 = config.root 那只 */
export async function restoreItem(ctx, config, lib, bucket, item, box) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const cleanBox = cleanBucket(bucket);
	const rel = cleanRel(item);
	const root = rootOfBox(useBox);
	if (cleanBox === '' || rel === '' || useBox === '' || root === '') {
		return { ok: false, error: 'bad-path', message: '这条回收站记录不合法' };
	}
	const from = `${useBox}/${cleanBox}/${rel}`;
	const target = `${root}/${rel}`;
	if (!existsSync(from)) return { ok: false, error: 'not-found', message: '这条记录已经不在了' };
	if (existsSync(target)) return { ok: false, error: 'target-exists', message: '原位已经有同名的东西，先给它改名或删掉再恢复' };
	try {
		mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true });
		renameSync(from, target);
	} catch (error) {
		return { ok: false, error: 'restore-failed', message: error instanceof Error ? error.message : String(error) };
	}
	/* 号：桶里的 .rk-uids.json 记着删它时摘下来的号（章节 / 画布这类目录实体的号不在文件里） */
	const uid = readBoxUids(useBox, cleanBox)[target] || '';
	if (uid !== '' && lib) {
		try {
			await adoptUids(ctx, lib, { [target]: uid });
		} catch {
			/* 号认不回来不影响文件已经搬回去 */
		}
	}
	pruneTree(useBox, cleanBox);
	tidyBox(useBox);
	let kind = 'file';
	try {
		kind = statSync(target).isDirectory() ? 'dir' : 'file';
	} catch {
		/* 上面刚搬过去 */
	}
	return { ok: true, bucket: cleanBox, box: useBox, item: rel, target, uid, kind };
}

/**
 * 恢复一整个桶：把桶当成一棵「被删掉的东西的影子树」，从上往下**合并**回去 ——
 * 原位没有的条目整棵搬回去（子树跟着走），原位已经有的目录就往下钻处理它里面的条目，
 * 原位有同名**文件**才算冲突（记进 skipped，绝不覆盖）。
 */
export async function restoreBucket(ctx, config, lib, bucket, box) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const cleanBox = cleanBucket(bucket);
	const root = rootOfBox(useBox);
	if (cleanBox === '' || useBox === '' || root === '') return { ok: false, error: 'bad-path', message: '这个回收站桶不存在' };
	const dir = `${useBox}/${cleanBox}`;
	if (!existsSync(dir)) return { ok: false, error: 'not-found', message: '这个回收站桶已经不在了' };
	const restored = [];
	const skipped = [];
	const merge = async (rel) => {
		let entries = [];
		try {
			entries = readdirSync(rel === '' ? dir : `${dir}/${rel}`, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
		} catch {
			return;
		}
		for (const entry of entries) {
			const item = rel === '' ? entry.name : `${rel}/${entry.name}`;
			const target = `${root}/${item}`;
			if (!existsSync(target)) {
				const result = await restoreItem(ctx, config, lib, cleanBox, item, useBox);
				if (result.ok) restored.push(result);
				else skipped.push({ item, error: result.error, message: result.message });
				continue;
			}
			/* 原位这个目录还在：钻进去合并它里面的条目 */
			if (entry.isDirectory()) await merge(item);
			else skipped.push({ item, error: 'target-exists', message: '原位已经有同名文件' });
		}
	};
	await merge('');
	pruneTree(useBox, cleanBox);
	tidyBox(useBox);
	return { ok: true, bucket: cleanBox, box: useBox, restored, skipped };
}

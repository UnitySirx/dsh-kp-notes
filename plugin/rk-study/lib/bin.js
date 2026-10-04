/* rk-study · lib/bin.js —— 回收站
 *
 * 删除章节/小节/知识点、以及把画布「移出列表」，都只是把东西搬进 .remove/<桶>/ 里（见 delete.js）。
 * 这里做两件事：
 *   1. 把桶读出来给界面看（listBin）—— 一条记录 = 桶里的一个顶层条目，原位置 = <root>/<桶内相对路径>；
 *   2. 把它搬回去（restoreItem / restoreBucket）—— 原位已经有东西就**拒绝**（绝不覆盖），
 *      搬回去以后按桶里的 .rk-uids.json 认回原来的号，桶空了就把桶目录清掉。
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { readStashedUids, removeBoxFor } from './delete.js?v=54';
import { adoptUids } from './uid.js?v=54';

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

/** 桶名就是一个目录名：单层、不以点开头（正常是 YYYY-MM-DD_HHmmss，同一天里再来会带 -2） */
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

/** 回收站里有什么：{ box, root, buckets: [{ name, at, count, items: [{ item, kind, size, mtime, target, uid }] }] } */
export function listBin(config) {
	const box = removeBoxFor(config);
	const root = String(config.root ?? '').replace(/\/+$/, '');
	if (root === '') return { box, root, buckets: [] };
	let names = [];
	try {
		names = readdirSync(box).filter((name) => !name.startsWith('.')).sort().reverse();
	} catch {
		return { box, root, buckets: [] };
	}
	const buckets = [];
	for (const name of names) {
		if (buckets.length >= MAX_BUCKETS) break;
		const dir = `${box}/${name}`;
		const stashed = readStashedUids(config, name);
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
		buckets.push({ name, at: bucketLabel(name), count: items.length, items });
	}
	return { box, root, buckets };
}

/**
 * 桶里没有真东西了就清掉它：先删掉里面空掉的容器目录（搬走一条记录，它的父目录往往会空下来），
 * 整桶都空了（只剩我们自己的 .rk-uids.json 也算空）就把桶目录一起删掉。
 */
function pruneTree(config, bucket) {
	const dir = `${removeBoxFor(config)}/${cleanBucket(bucket)}`;
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

/** 把桶里的一条搬回原位；原位已经有东西就拒绝（不覆盖） */
export async function restoreItem(ctx, config, lib, bucket, item) {
	const cleanBox = cleanBucket(bucket);
	const rel = cleanRel(item);
	if (cleanBox === '' || rel === '') return { ok: false, error: 'bad-path', message: '这条回收站记录不合法' };
	const root = String(config.root ?? '').replace(/\/+$/, '');
	if (root === '') return { ok: false, error: 'bad-path', message: '这个位置没有画布根目录' };
	const from = `${removeBoxFor(config)}/${cleanBox}/${rel}`;
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
	const uid = readStashedUids(config, cleanBox)[target] || '';
	if (uid !== '' && lib) {
		try {
			await adoptUids(ctx, lib, { [target]: uid });
		} catch {
			/* 号认不回来不影响文件已经搬回去 */
		}
	}
	pruneTree(config, cleanBox);
	let kind = 'file';
	try {
		kind = statSync(target).isDirectory() ? 'dir' : 'file';
	} catch {
		/* 上面刚搬过去 */
	}
	return { ok: true, bucket: cleanBox, item: rel, target, uid, kind };
}

/**
 * 恢复一整个桶：把桶当成一棵「被删掉的东西的影子树」，从上往下**合并**回去 ——
 * 原位没有的条目整棵搬回去（子树跟着走），原位已经有的目录就往下钻处理它里面的条目，
 * 原位有同名**文件**才算冲突（记进 skipped，绝不覆盖）。
 */
export async function restoreBucket(ctx, config, lib, bucket) {
	const cleanBox = cleanBucket(bucket);
	if (cleanBox === '') return { ok: false, error: 'bad-path', message: '这个回收站桶不存在' };
	const box = removeBoxFor(config);
	const root = String(config.root ?? '').replace(/\/+$/, '');
	if (root === '') return { ok: false, error: 'bad-path', message: '这个位置没有画布根目录' };
	const dir = `${box}/${cleanBox}`;
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
				const result = await restoreItem(ctx, config, lib, cleanBox, item);
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
	pruneTree(config, cleanBox);
	return { ok: true, bucket: cleanBox, restored, skipped };
}

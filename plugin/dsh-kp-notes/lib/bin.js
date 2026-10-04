/* rk-study · lib/bin.js —— 回收站
 *
 * 删除章节/小节/知识点、以及把画布「移出列表」，都只是把东西搬进 .remove/<桶>/ 里（见 delete.js）。
 * 界面只在两层看它，粒度也各只到一层：
 *   · 根画布（还没进任何画布）—— listRootBins：只列**被移出列表的整只画布**（它们躺在各自父目录的 .remove 里），
 *     恢复一条 = 把一整只画布搬回它的上一层；
 *   · 一级画布（进了某张画布）—— listChapterBin：只看这张画布自己的 .remove，并把记录**按章聚合成一条**
 *     （`01-第一章`），恢复一条 = restoreChapter = 把这一章在**所有桶**里的东西整段合并回去。
 * 一条记录的原位置 = <桶所属目录>/<桶内相对路径>；恢复一律**绝不覆盖**原位已有的东西，
 * 搬回去以后按桶里的 .rk-uids.json 认回原来的号，桶空了就把桶目录（连空掉的 .remove）清掉。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { removeBoxFor } from './delete.js?v=67';
import { adoptUids } from './uid.js?v=67';

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

/** 新格式的桶名：删东西那天的日期（同一天再来带 -2），也容得下带时分秒的老写法 */
function isBucketName(name) {
	const text = String(name ?? '');
	return /^\d{8}(-\d+)?$/.test(text) || /^\d{4}-\d{2}-\d{2}_\d{6}/.test(text);
}

/**
 * 老格式的 .remove（2025 年那阵子）里一条记录的「影子树」：.remove/<相对路径> 就是被搬走的那条记录本身，
 * 名字不是日期而是它当时的相对路径。原位没有它 ⇒ 整条可以搬回去；原位还在 ⇒ 它只是路径上的容器，
 * 钻进去接着找真正被搬走的那些（例如 .remove/notes/01-甲 里的 01-甲）。
 */
function collectLegacy(box, root, rel, depth, stashed, out) {
	if (out.length >= MAX_ITEMS) return;
	const target = `${root}/${rel}`;
	const parent = rel.includes('/') ? `${root}/${rel.slice(0, rel.lastIndexOf('/'))}` : root;
	if (!existsSync(target)) {
		if (!existsSync(parent)) return;
		let kind = 'file';
		let size = 0;
		let mtime = 0;
		try {
			const info = statSync(`${box}/${rel}`);
			kind = info.isDirectory() ? 'dir' : 'file';
			size = info.isDirectory() ? 0 : info.size;
			mtime = Math.round(info.mtimeMs);
		} catch {
			return;
		}
		out.push({ item: rel, kind, size, mtime, target, uid: stashed[target] || '' });
		return;
	}
	if (depth + 1 >= MAX_DEPTH) return;
	let entries = [];
	try {
		entries = readdirSync(`${box}/${rel}`, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		collectLegacy(box, root, `${rel}/${entry.name}`, depth + 1, stashed, out);
	}
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
	const legacy = { items: [] };
	for (const name of names) {
		if (buckets.length >= MAX_BUCKETS) break;
		const dir = `${useBox}/${name}`;
		let isDir = false;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) continue;
		/* 老格式：名字不是日期 ⇒ 它自己就是那条记录，别把它的内容拆成一堆假条目 */
		if (!isBucketName(name)) {
			collectLegacy(useBox, root, name, 0, readBoxUids(useBox, name), legacy.items);
			continue;
		}
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
	if (legacy.items.length > 0) buckets.push({ name: '', at: '旧格式', legacy: true, count: legacy.items.length, box: useBox, root, items: legacy.items });
	return { box: useBox, root, boxes: [useBox], buckets };
}

/** 章节都在 notes/ 下面 */
const CHAPTER_ROOT = 'notes';
const QUESTION_ROOT = 'questions';

/**
 * 一条记录属于哪一章：
 *   · notes/<章目录>/…   ⇒ notes/<章目录>（section / point / 题目片段都并到那一章）
 *   · notes/<章目录>（整章目录被删，kind=dir）⇒ notes/<章目录>
 *   · notes/<文件>（直接躺在 notes/ 下的小节文件）⇒ notes
 *   · questions/<章目录>/…（题目仓库与 notes 平行）⇒ notes/<章目录>，好跟那一章并成一条
 *   · 画布根下的散文件 ⇒ 它自己
 */
function chapterOf(item, kind) {
	const rel = String(item ?? '');
	const first = (value) => {
		const cut = value.indexOf('/');
		return cut < 0 ? value : value.slice(0, cut);
	};
	if (rel === CHAPTER_ROOT) return CHAPTER_ROOT;
	if (rel.startsWith(CHAPTER_ROOT + '/')) {
		const rest = rel.slice(CHAPTER_ROOT.length + 1);
		if (rest.indexOf('/') >= 0) return `${CHAPTER_ROOT}/${first(rest)}`;
		return kind === 'dir' ? `${CHAPTER_ROOT}/${rest}` : CHAPTER_ROOT;
	}
	if (rel.startsWith(QUESTION_ROOT + '/')) {
		const rest = rel.slice(QUESTION_ROOT.length + 1);
		return rest.indexOf('/') >= 0 ? `${CHAPTER_ROOT}/${first(rest)}` : CHAPTER_ROOT;
	}
	return first(rel);
}

/** 这一章在桶里可能有两处：notes/<章> 与平行的 questions/<章> */
function chapterPrefixes(chapter) {
	const rel = String(chapter ?? '');
	if (rel === CHAPTER_ROOT) return [CHAPTER_ROOT, QUESTION_ROOT];
	if (rel.startsWith(CHAPTER_ROOT + '/')) return [`${QUESTION_ROOT}/${rel.slice(CHAPTER_ROOT.length + 1)}`, rel];
	return [rel];
}

/** 章名（去掉 notes/ 前缀，给人看） */
function chapterName(chapter) {
	const rel = String(chapter ?? '');
	if (rel === CHAPTER_ROOT) return CHAPTER_ROOT;
	return rel.startsWith(CHAPTER_ROOT + '/') ? rel.slice(CHAPTER_ROOT.length + 1) : rel;
}

/** 桶名倒序：新的在前；同名桶再按目录排 */
function byBucketDesc(a, b) {
	if (a.name === b.name) return a.root < b.root ? -1 : 1;
	return a.name < b.name ? 1 : -1;
}

/**
 * 根画布那一层看回收站：只列**被移出列表的整只画布**。
 * 画布目录在它**上一层**的 .remove 里，所以这里只翻每张已知画布父目录的那只桶；
 * 画布里删掉的章节躺在 <画布>/.remove（路径里带 notes/），一律不算 —— 那属于一级画布那层。
 */
export function listRootBins(config, extraRoots) {
	const dirs = [];
	const add = (value) => {
		const base = String(value ?? '').replace(/\/+$/, '');
		if (base === '' || base.charAt(0) !== '/') return;
		const parent = parentOfDir(base);
		if (parent === '' || parent === '/' || dirs.includes(parent)) return;
		dirs.push(parent);
	};
	add(config.root);
	for (const item of Array.isArray(extraRoots) ? extraRoots : []) add(item && typeof item === 'object' ? item.path : item);
	const boxes = [];
	const buckets = [];
	for (const base of dirs) {
		const box = boxOf(base);
		if (box === '' || !existsSync(box)) continue;
		boxes.push(box);
		for (const bucket of listBin({ root: base }, box).buckets) {
			/* 只认「顶层整条」= 整只画布：带斜杠的是画布里的东西，notes / questions 是画布内部结构
			 * （画布里删东西也会在被删画布的父目录留桶），这两样都不在这一层出现 */
			const innerRoots = [String(config.noteDir || CHAPTER_ROOT), String(config.questionDir || QUESTION_ROOT)];
			const items = bucket.items.filter((entry) => entry.item.indexOf('/') < 0 && !innerRoots.includes(entry.item));
			if (items.length === 0) continue;
			buckets.push(Object.assign({}, bucket, { count: items.length, items }));
		}
	}
	buckets.sort(byBucketDesc);
	const root = String(config.root ?? '').replace(/\/+$/, '');
	return { mode: 'roots', box: '', root, boxes, buckets: buckets.slice(0, MAX_BUCKETS) };
}

/**
 * 一级画布那一层看回收站：只看这张画布自己的 .remove，并把记录**按章聚合成一条**。
 * 一章一条（同一天删的旧章、后来又删过里面几个小节/知识点/题目片段，都并到这一章上）。
 */
export function listChapterBin(config, box) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const root = rootOfBox(useBox);
	if (useBox === '' || root === '') return { mode: 'chapters', box: '', root: '', chapters: [] };
	const listed = listBin({ root }, useBox);
	const groups = new Map();
	for (const bucket of listed.buckets) {
		const stashed = readBoxUids(useBox, bucket.name);
		for (const entry of bucket.items) {
			const chapter = chapterOf(entry.item, entry.kind);
			if (chapter === '') continue;
			let group = groups.get(chapter);
			if (!group) {
				/* 桶已经是新的在前，所以第一次见到的桶名就是这一章最近一次被动的日期 */
				group = { chapter, name: chapterName(chapter), box: useBox, root, at: bucket.at, atName: bucket.name, count: 0, uid: '', buckets: [], items: [] };
				groups.set(chapter, group);
			}
			group.count += 1;
			if (!group.buckets.includes(bucket.name)) group.buckets.push(bucket.name);
			const uid = entry.uid || stashed[entry.target] || '';
			if (group.uid === '' && uid !== '') group.uid = uid;
			group.items.push(Object.assign({}, entry, { bucket: bucket.name }));
		}
	}
	const chapters = Array.from(groups.values());
	chapters.sort((a, b) => (a.atName === b.atName ? (a.chapter < b.chapter ? -1 : 1) : a.atName < b.atName ? 1 : -1));
	return { mode: 'chapters', box: useBox, root, chapters: chapters.slice(0, MAX_BUCKETS) };
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
	const asked = String(bucket ?? '');
	const cleanBox = asked === '' ? '' : cleanBucket(asked);
	const rel = cleanRel(item);
	const root = rootOfBox(useBox);
	if ((cleanBox === '' && asked !== '') || rel === '' || useBox === '' || root === '') {
		return { ok: false, error: 'bad-path', message: '这条回收站记录不合法' };
	}
	/* bucket === '' = 老格式：记录直接躺在 .remove 下，item 就是它当时的相对路径 */
	const from = cleanBox === '' ? `${useBox}/${rel}` : `${useBox}/${cleanBox}/${rel}`;
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
 * 把一只桶里 prefix 这一支合并回去（prefix === '' 就是整桶）：从上往下合并 ——
 * 原位没有的条目整棵搬回去（子树跟着走），原位已经有的目录就往下钻处理它里面的条目，
 * 原位有同名**文件**才算冲突（记进 skipped，绝不覆盖）。
 */
async function mergeTree(ctx, config, lib, useBox, bucket, root, prefixes) {
	const dir = `${useBox}/${bucket}`;
	const restored = [];
	const skipped = [];
	const list = (Array.isArray(prefixes) ? prefixes : [prefixes]).filter((one) => one !== '' && one !== undefined && one !== null);
	/* 在某一处 prefix 里面，或者仍然是某处 prefix 的祖先目录（那要先走到那一层去） */
	const inside = (item) => list.length === 0 || list.some((prefix) => item === prefix || item.startsWith(prefix + '/'));
	const ancestor = (item) => list.some((prefix) => prefix.startsWith(item + '/') && item !== '');
	const walk = async (rel) => {
		let entries = [];
		try {
			entries = readdirSync(rel === '' ? dir : `${dir}/${rel}`, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
		} catch {
			return;
		}
		for (const entry of entries) {
			const item = rel === '' ? entry.name : `${rel}/${entry.name}`;
			const mine = inside(item);
			if (!mine && !ancestor(item)) continue;
			const target = `${root}/${item}`;
			if (!existsSync(target)) {
				const result = await restoreItem(ctx, config, lib, bucket, item, useBox);
				if (result.ok) restored.push(result);
				else skipped.push({ item, error: result.error, message: result.message });
				continue;
			}
			/* 原位这个目录还在：钻进去合并它里面的条目 */
			if (entry.isDirectory()) await walk(item);
			else if (mine) skipped.push({ item, error: 'target-exists', message: '原位已经有同名文件' });
		}
	};
	await walk('');
	return { restored, skipped };
}

/** 恢复一整个桶（一级画布那层的「整桶」入口） */
export async function restoreBucket(ctx, config, lib, bucket, box) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const cleanBox = cleanBucket(bucket);
	const root = rootOfBox(useBox);
	if (cleanBox === '' || useBox === '' || root === '') return { ok: false, error: 'bad-path', message: '这个回收站桶不存在' };
	if (!existsSync(`${useBox}/${cleanBox}`)) return { ok: false, error: 'not-found', message: '这个回收站桶已经不在了' };
	const { restored, skipped } = await mergeTree(ctx, config, lib, useBox, cleanBox, root, []);
	pruneTree(useBox, cleanBox);
	tidyBox(useBox);
	return { ok: true, bucket: cleanBox, box: useBox, restored, skipped };
}

/**
 * 恢复一整章：把这一章在**所有桶**里的东西合并回去（新桶先来，绝不覆盖原位已有的东西）。
 * 章还在原位时就往里合并（补回删掉的小节/知识点/题目片段）；整章都没了就把整棵搬回来。
 */
export async function restoreChapter(ctx, config, lib, box, chapter) {
	const useBox = cleanBoxPath(box) || boxOf(config.root);
	const rel = cleanRel(chapter);
	const root = rootOfBox(useBox);
	if (useBox === '' || root === '' || rel === '') return { ok: false, error: 'bad-path', message: '这一章不合法' };
	let names = [];
	try {
		names = readdirSync(useBox).filter((name) => !name.startsWith('.')).sort().reverse();
	} catch {
		names = [];
	}
	const restored = [];
	const skipped = [];
	let legacy = false;
	for (const name of names) {
		/* 老格式的记录直接躺在 .remove 下，下面那次「整只盒」的合并会一起处理 */
		if (!isBucketName(name)) {
			legacy = true;
			continue;
		}
		const result = await mergeTree(ctx, config, lib, useBox, name, root, chapterPrefixes(rel));
		restored.push(...result.restored);
		skipped.push(...result.skipped);
		pruneTree(useBox, name);
	}
	if (legacy) {
		const result = await mergeTree(ctx, config, lib, useBox, '', root, chapterPrefixes(rel));
		restored.push(...result.restored);
		skipped.push(...result.skipped);
		pruneTree(useBox, '');
	}
	tidyBox(useBox);
	return { ok: true, chapter: rel, box: useBox, root, restored, skipped };
}

/* rk-study · host/routes —— 从 host.js 第 1539-2118 行原样切出 */
import { AsyncLocalStorage } from 'node:async_hooks';
/* 目录改名 / 建目录以外的一切读写都走 ctx.fs(见下面的 rootTarget/fileExists/dirExists/writeFileAt/
 * listNames 等小工具): 那样才会经过 DSH 的沙箱策略, 也才会跟着插件生命周期一起收尾。
 * `renameSync` / `rmdirSync` 是仅有的裸 node:fs —— ctx.fs 没有 rename / 摘空目录的能力, 调用点在动手之前
 * 已经用 ctx.fs 复核过两头都在画布 root 之内(见 renameChapter / renameRoot / removeRoot / migrateLegacyMedia)。 */
import { mkdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';

import { listChapterBin, listRootBins, restoreBucket, restoreChapter, restoreItem } from './bin.js?v=82';
import { ASSET_ROUTE, ASSET_TYPES, CACHE_TTL_MS, CLIENT_DIR, CLIENT_ROUTE, CLIENT_TYPES, CONFIG_DIR, CONFIG_ROUTE, GIT_ROUTE, MARKDOWN_RE, MAX_BODY_BYTES, MAX_BYTES_PER_FILE, MAX_DEPTH, MAX_FILES, MEDIA_DIR_SUFFIX, MEDIA_LEGACY_PARENT_DIR, MEDIA_MAX_BYTES, MEDIA_PARENT_DIR, MEDIA_ROUTE, MEDIA_TYPES, ROOTS_ROUTE, ROUTE, STATE_DIR, STATE_FILE, STATE_ROUTE, TEMPLATE_ROUTE, VENDOR_DIR } from './constants.js?v=82';
import { REMOVE_DIR, deleteDirEntry, deleteEntry, isExcludedPath, questionDirFor, readAllStashedUids, removeBucketFor, removeBucketName, bucketNameIn, safeDirPath, saveRemovedText, stashUids } from './delete.js?v=82';
import { insideRoot, writePolicyOf } from './fsguard.js?v=82';
import { gitCommit, gitMessage, gitModels, gitPull, gitPush, gitStatus } from './git.js?v=82';
import { buildNodes, scanHeadings } from './headings.js?v=82';
import { configBytesOf, configPathOf, readLibConfig, readRemovedStore, writeLibConfig, writeRemovedStore } from './libconfig.js?v=82';
import { parseDocument } from './parse.js?v=82';
import { pointRegion, rebuildPoint } from './points.js?v=82';
import { questionBlockNodes, removeQuestionBlock, saveQuestionBlock, withBlockUid } from './questions.js?v=82';
import { buildCatalog } from './scan.js?v=82';
import { TEMPLATE_FILES, countQuestionItems, filePad, listDirSafe, noteTemplate, pointNumberFor, pointTemplate, questionBlock, questionBlockFromFields, questionFileTemplate, questionTemplate, sanitizeName } from './templates.js?v=82';
import { adoptUid, adoptUids, dropUids, ensureUids, moveUid, takeUid, uidFromText } from './uid.js?v=82';
import { baseName, classifyFile, cleanTitle, countWords, isQuestionStorePath, legacyTemplateDirOf, libraryDirOf, normalizeConfig, normalizeRelPath, notePathFor, noteStorePath, numericPrefix, parseFrontmatter, questionPathFor, sharedTemplateDirOf, stripNumericPrefix, templateDirOf, templatePath, validateRoot } from './util.js?v=82';
import { readBody, safePath, writeMarkdown } from './write.js?v=82';

/* 模板文件很小, 读它不需要跟画布扫描抢上限 */
const TEMPLATE_MAX_BYTES = 256 * 1024;

/* ------------------------------------------------------------------ apply */

export function apply(ctx, rawConfig) {
	const baseConfig = normalizeConfig(rawConfig);

	/* 多学习画布(多根目录): 客户端在每个请求上带 ?root=<绝对路径>。
	 * 只有**学习库那一级**写盘(库根目录下的 .config/rk-study.json, 见 libconfig.js):
	 * 缩放 / 字号 / 配色 / 画布列表都在里面; 单张画布自己一个字节都不写
	 * (画布名 = 目录名; 模板统一放在学习库根目录的 .templates/ 里, 库里的画布自己不再各存一份;
	 *  自带根目录的画布才用自己的 .templates/; 其余设置留在浏览器 localStorage)。
	 * 靠 AsyncLocalStorage 把「这次请求用哪个 root」带进下面所有 helper:
	 * config 与 cache 都是 Proxy —— 读的时候现取当前请求的 root, 所以 ~700 行原样代码一行都不用改。 */
	const als = new AsyncLocalStorage();
	const caches = new Map();

	/* 每个见过的 ?root= 一条缓存记录(扫描结果 + pending)。插件停用时清掉,
	 * 否则停用后这些 promise/数据还挂在内存里。 */
	ctx.effect(
		() => () => {
			caches.clear();
		},
		'rk-study: catalog caches',
	);

	function cacheRecord() {
		const store = als.getStore() || baseConfig;
		let record = caches.get(store.root);
		if (!record) {
			record = { at: 0, data: null, pending: null };
			caches.set(store.root, record);
		}
		return record;
	}

	const config = new Proxy(
		{},
		{
			get: (_target, prop) => (als.getStore() || baseConfig)[prop],
			has: (_target, prop) => prop in (als.getStore() || baseConfig),
		},
	);

	/* 笔记目录缓存也按 root 分桶: { at, data, pending } 的读写都落在该 root 的记录上。 */
	const cache = new Proxy(
		{},
		{
			get: (_target, prop) => cacheRecord()[prop],
			set: (_target, prop, value) => {
				cacheRecord()[prop] = value;
				return true;
			},
		},
	);

	function configFor(req) {
		const store = als.getStore();
		if (store) return store;
		let root = null;
		try {
			root = validateRoot(new URL(String((req && req.url) || '/'), 'http://localhost').searchParams.get('root'));
		} catch {
			root = null;
		}
		return root && root !== baseConfig.root ? { ...baseConfig, root } : baseConfig;
	}

	/* 把「这次请求用哪个 root」绑到本次请求的异步上下文上。 */
	function withRoot(fn) {
		return (req, res) => als.run(configFor(req), () => fn(req, res));
	}

	/* ------------------------------------------------ ctx.fs 小工具
	 * 这一版把裸 node:fs 全部收进 ctx.fs: 读文件、列目录、判断存在、写文件都按 DSH 的
	 * 文件抽象走。ctx.fs.writeText 自己建父目录, 所以 mkdirSync/Sync 那一层也不需要了。 */
	function activeConfig() {
		return als.getStore() || baseConfig;
	}

	async function rootTarget(signal) {
		return ctx.fs.resolve(activeConfig().root, { signal });
	}

	/* uid 发号簿放在**学习库那一级**(同一个库里的画布共用一个号池, 号在库里唯一);
	 * 库下面只有这一张画布时, 画布自己就是自己的库。
	 * 目录类实体(一级画布 / 章节)的号登记在这里; 文件类实体(小节 / 知识点 / 题目)的号写在 markdown 里。 */
	async function uidLibOf(cfg, signal) {
		const lib = await libraryDirOf(ctx, cfg, signal);
		return lib === '' ? cfg.root : lib;
	}

	async function resolveAbs(abs, signal) {
		try {
			return await ctx.fs.resolve(abs, { signal });
		} catch {
			return null;
		}
	}

	async function pathExists(abs, signal) {
		const target = await resolveAbs(abs, signal);
		if (!target) return false;
		try {
			return (await ctx.fs.stat(target, signal)) !== undefined;
		} catch {
			return false;
		}
	}

	async function dirExists(abs, signal) {
		const target = await resolveAbs(abs, signal);
		if (!target) return false;
		try {
			const info = await ctx.fs.stat(target, signal);
			return !!info && info.type === 'directory';
		} catch {
			return false;
		}
	}

	/* 读文本; 文件不存在 / 读不动都返回 null(调用方按「没有」处理) */
	async function readFileText(abs, signal, maxBytes = MAX_BYTES_PER_FILE) {
		const target = await resolveAbs(abs, signal);
		if (!target) return null;
		try {
			const info = await ctx.fs.stat(target, signal);
			if (!info || info.type !== 'file') return null;
			return await ctx.fs.readText(target, signal);
		} catch {
			return null;
		}
	}

	/* 写文本: 父目录由 ctx.fs 自己建; 沙箱策略按目标所在画布给(见 fsguard.js 的取舍说明)。
	 * 画布 root 之外的路径(库共享模板)按它自己的目录算边界。 */
	async function writeFileAt(abs, content, signal, scopeRoot) {
		const target = await ctx.fs.resolve(abs, { signal });
		const policy = scopeRoot ? writePolicyOf({ root: scopeRoot }) : writePolicyOf(activeConfig());
		await ctx.fs.writeText(target, content, undefined, signal, policy);
		return target;
	}

	/* 建目录: ctx.fs 没有 mkdir 能力, 所以先用 resolve+contains 复核在边界之内, 再落 mkdirSync。
	 * 建空目录不能拿 writeText 顶替 —— 会在用户的笔记目录里留下一个空文件。
	 *
	 * 边界默认是「这次请求的 root」, 但有三件事的目标本来就在它之外, 由调用方给出更贴切的 scopeRoot:
	 *   新建画布 / 导入学习库 —— 要建的目录自己就是一个新 root(父目录才是这次操作的边界);
	 *   移出列表 —— 目标在画布同层的 .remove/ 里(画布的父目录才是边界)。
	 * 这是插件「画布可以放在任意目录」这个设计的前提, 取舍说明见 fsguard.js 文件头。 */
	async function mkdirAt(abs, signal, scopeRoot) {
		const scope = typeof scopeRoot === 'string' && scopeRoot !== '' ? scopeRoot : activeConfig().root;
		if (!(await insideRoot(ctx, { ...activeConfig(), root: scope }, abs, signal))) {
			throw new Error(`invalid path: ${abs}`);
		}
		mkdirSync(abs, { recursive: true });
	}

	/* 列直接子项的名字(替代 readdirSync) */
	async function listNames(abs, signal) {
		const target = await resolveAbs(abs, signal);
		if (!target) return [];
		try {
			const entries = await ctx.fs.listDir(target, signal);
			return entries.map((entry) => entry.name);
		} catch {
			return [];
		}
	}

	/* 给目录类实体(章节)补上 uid: 第一次扫描会把还没号的章节一次性登记好(一个库写一次配置),
	 * 所以老笔记不用迁移, 打开一次就都有号了。 */
	async function withChapterUids(data, signal) {
		const chapters = Array.isArray(data && data.chapters) ? data.chapters : [];
		const pairs = [];
		for (const chapter of chapters) {
			const abs = safeDirPath(config, chapter.dir);
			if (abs) pairs.push({ chapter, abs });
		}
		if (pairs.length === 0) return data;
		const lib = await uidLibOf(config, signal);
		/* 恢复: 章节目录从 .remove 桶里搬回来时, 先按路径把原来那个号认回来(号是删它的时候留在桶里的) */
		const stashed = readAllStashedUids(config.root);
		const revives = {};
		for (const item of pairs) if (!item.chapter.uid && stashed[item.abs]) revives[item.abs] = stashed[item.abs];
		if (Object.keys(revives).length > 0) await adoptUids(ctx, lib, revives);
		const uids = await ensureUids(ctx, lib, 'chapter', pairs.map((item) => item.abs));
		for (const item of pairs) {
			const uid = uids[item.abs];
			if (uid) item.chapter.uid = uid;
		}
		return data;
	}

	/* 老笔记补号(不动笔记文件): 小节 / 知识点文件还没有 frontmatter uid 的, 先在号池里按路径登记一个
	 * (只写学习库配置), 打开画布立刻就有号可用; 该文件下次被插件保存时号会搬进 frontmatter,
	 * 号池里那条按路径记的账同时摘掉(见 write.js 的 entityTextWithUid)。 */
	async function withNoteUids(data, signal) {
		const wanted = { section: [], point: [] };
		const chapters = (data && data.chapters) || [];
		for (const chapter of chapters) {
			for (const section of chapter.sections || []) {
				if (!section.uid && section.path && safePath(ctx, config, section.path)) {
					wanted.section.push(section.path);
				}
				for (const point of section.points || []) {
					if (point.uid || !point.path) continue;
					const base = String(point.path).split('/').pop() || '';
					/* 一个文件里的行内知识点也带着 path, 只有名字像知识点文件的才发号 */
					if (classifyFile(base, {}).kind !== 'point') continue;
					if (safePath(ctx, config, point.path)) wanted.point.push(point.path);
				}
			}
		}
		const kinds = [['section', wanted.section], ['point', wanted.point]]
			.filter((item) => item[1].length > 0)
			.map((item) => [item[0], Array.from(new Set(item[1]))]);
		if (kinds.length === 0) return data;
		const lib = await uidLibOf(config, signal);
		/* 恢复: 笔记文件从 .remove 桶里搬回来时, 先按路径把原来的号认回来 */
		const stashed = readAllStashedUids(config.root);
		const revives = {};
		for (const [, list] of kinds) {
			for (const rel of list) {
				const abs = safePath(ctx, config, rel);
				if (abs && !revives[abs] && stashed[abs]) revives[abs] = stashed[abs];
			}
		}
		if (Object.keys(revives).length > 0) await adoptUids(ctx, lib, revives);
		const maps = {};
		for (const [kind, list] of kinds) maps[kind] = await ensureUids(ctx, lib, kind, list.map((rel) => safePath(ctx, config, rel)));
		for (const chapter of chapters) {
			for (const section of chapter.sections || []) {
				const sabs = section.path ? safePath(ctx, config, section.path) : null;
				if (!section.uid && maps.section && sabs && maps.section[sabs]) section.uid = maps.section[sabs];
				for (const point of section.points || []) {
					if (point.uid || !point.path || !maps.point) continue;
					const pabs = safePath(ctx, config, point.path);
					if (pabs && maps.point[pabs]) point.uid = maps.point[pabs];
				}
			}
		}
		return data;
	}

	async function loadCatalog(force, signal) {
		const fresh = cache.data !== null && (force !== true ? Date.now() - cache.at < CACHE_TTL_MS : false);
		if (fresh) return cache.data;
		if (cache.pending && force !== true) return cache.pending;
		const pending = buildCatalog(ctx, config, signal)
			.then((data) => withChapterUids(data, signal))
			.then((data) => withNoteUids(data, signal))
			.then((data) => {
				cache.data = data;
				cache.at = Date.now();
				/* 只在「还是我这一发」的时候清 pending: force 触发第二发时, 旧的 promise 不能把新的抹掉 */
				if (cache.pending === pending) cache.pending = null;
				return data;
			})
			.catch((error) => {
				if (cache.pending === pending) cache.pending = null;
				throw error;
			});
		cache.pending = pending;
		return pending;
	}

	async function loadPoint(relPath, key) {
		const file = await loadFile(relPath, undefined);
		if (!file) return null;
		const region = pointRegion(file.markdown, relPath, key);
		if (region.error) return { ok: false, error: region.error, path: relPath };
		return {
			ok: true,
			path: relPath,
			mode: region.mode,
			title: region.title,
			tags: region.tags,
			body: region.body,
			level: region.level,
			words: countWords(region.body),
			bytes: file.bytes,
		};
	}

	async function loadFile(relPath, signal) {
		const abs = safePath(ctx, config, relPath);
		if (!abs) return null;
		const rootTarget = await ctx.fs.resolve(config.root, { signal });
		let target;
		try {
			target = await ctx.fs.resolve(abs, { signal });
		} catch {
			return null;
		}
		if (!ctx.fs.contains(rootTarget, target)) return null;
		const info = await ctx.fs.stat(target, signal);
		if (!info || info.type !== 'file') return null;
		const markdown = await ctx.fs.readText(target, signal);
		const lines = markdown.split(/\r?\n/);
		const { front } = parseFrontmatter(lines);
		const mode = isQuestionStorePath(config, relPath) ? 'question' : undefined;
		const parsed = parseDocument(markdown, relPath, front, mode);
		return {
			path: relPath,
			bytes: info.size ?? Buffer.byteLength(markdown, 'utf8'),
			markdown,
			frontmatter: front,
			title: parsed.title,
			kind: parsed.kind,
			class: parsed.class,
			order: parsed.order,
			points: parsed.points,
			questions: parsed.questions,
			stats: {
				points: parsed.points.length,
				examples:
					parsed.questions.length +
					parsed.points.reduce(
						(total, point) => total + point.examples.length + point.children.reduce((sum, child) => sum + child.examples.length, 0),
						0,
					),
				words: parsed.words,
			},
		};
	}

	/* 库共享模板文件: 它在画布 root 之外(在学习库那一级), 所以边界按它自己所在目录算。
	 * 形状与 loadFile 一致, 只是没有 updatedAt(ctx.fs 的观察不给 mtime)。 */
	async function loadTemplateFile(relPath, abs, signal) {
		const text = await readFileText(abs, signal, TEMPLATE_MAX_BYTES);
		if (text === null) return null;
		const markdown = text;
		const lines = markdown.split(/\r?\n/);
		const { front } = parseFrontmatter(lines);
		const parsed = parseDocument(markdown, relPath, front, undefined);
		return {
			path: relPath,
			shared: true,
			bytes: Buffer.byteLength(markdown, 'utf8'),
			markdown,
			frontmatter: front,
			title: parsed.title,
			kind: parsed.kind,
			class: parsed.class,
			order: parsed.order,
			points: parsed.points,
			questions: parsed.questions,
			stats: { points: parsed.points.length, examples: parsed.questions.length, words: parsed.words },
		};
	}

	async function saveFile(payload) {
		const relPath = String(payload.path ?? '').trim();
		const markdown = typeof payload.markdown === 'string' ? payload.markdown : null;
		if (markdown === null) throw new Error('markdown is required');
		const sharedFile = await sharedTemplateFile(relPath);
		if (sharedFile !== '') {
			/* 库共享模板(在画布 root 之外、学习库那一级): 边界按它自己那一层算 */
			await writeFileAt(sharedFile, markdown, undefined, sharedFile.slice(0, sharedFile.lastIndexOf('/')));
			cache.data = null;
			return {
				ok: true,
				path: relPath,
				shared: true,
				via: 'fs',
				bytes: Buffer.byteLength(markdown, 'utf8'),
			};
		}
		/* 模板文件的规范路径可能对应老位置(notes/.templates), 落盘时按实际位置写 */
		const localRel = await localTemplateFile(relPath);
		const target = localRel === '' ? relPath : localRel;
		const written = await writeMarkdown(ctx, config, target, markdown);
		cache.data = null;
		return { ok: true, ...written, path: relPath, bytes: Buffer.byteLength(markdown, 'utf8') };
	}

	async function savePoint(payload) {
		const relPath = String(payload.path ?? '')
			.replace(/\\/g, '/')
			.replace(/^\/+/, '')
			.trim();
		const abs = safePath(ctx, config, relPath);
		if (!abs) throw new Error(`bad-path: ${relPath}`);
		if (isQuestionStorePath(config, relPath)) throw new Error('not-a-note');
		const markdown = await readFileText(abs);
		if (markdown === null) throw new Error(`note-not-found: ${relPath}`);
		const next = rebuildPoint(markdown, relPath, {
			key: payload.key,
			title: payload.title,
			body: payload.body,
			tags: payload.tags,
		});
		const written = await writeMarkdown(ctx, config, relPath, next);
		cache.data = null;
		const wanted = cleanTitle(String(payload.title ?? '')) || cleanTitle(String(payload.key ?? ''));
		const region = pointRegion(next, relPath, wanted);
		return {
			ok: true,
			...written,
			path: relPath,
			markdown: next,
			title: region.error ? String(payload.title ?? '') : region.title,
			mode: region.error ? 'file' : region.mode,
			words: countWords(next),
		};
	}

	async function newSection(payload) {
		const dirRel = String(payload.dir ?? '').replace(/^\/+|\/+$/g, '');
		const title = sanitizeName(payload.title, '新小节');
		const entries = await listDirSafe(ctx, config, dirRel);
		let next = 1;
		for (const entry of entries) {
			const prefix = numericPrefix(entry.name);
			if (prefix !== null && prefix >= next) next = prefix + 1;
		}
		const file = `${filePad(next)}-${title}.md`;
		const relPath = dirRel === '' ? file : `${dirRel}/${file}`;
		const markdown = noteTemplate(title, next);
		const written = await writeMarkdown(ctx, config, relPath, markdown);
		cache.data = null;
		return { ok: true, ...written, markdown, order: next, kind: 'section' };
	}

	async function newPoint(payload) {
		const dirRel = String(payload.dir ?? '').replace(/^\/+|\/+$/g, '');
		const title = sanitizeName(payload.title, '新知识点');
		const sectionOrder = Number(payload.section) > 0 ? Number(payload.section) : 1;
		const entries = await listDirSafe(ctx, config, dirRel);
		const order = pointNumberFor(entries, sectionOrder);
		const file = `${filePad(sectionOrder)}-${filePad(order)}-${title}.md`;
		const relPath = dirRel === '' ? file : `${dirRel}/${file}`;
		const markdown = pointTemplate(title, order);
		const written = await writeMarkdown(ctx, config, relPath, markdown);
		cache.data = null;
		return { ok: true, ...written, markdown, order, section: sectionOrder, kind: 'point' };
	}

	async function readNoteTitle(relPath) {
		const abs = safePath(ctx, config, relPath);
		if (!abs) return null;
		try {
			const rootTarget = await ctx.fs.resolve(config.root);
			const target = await ctx.fs.resolve(abs);
			if (!ctx.fs.contains(rootTarget, target)) return null;
			const text = await ctx.fs.readText(target);
			const lines = text.split(/\r?\n/);
			const { front, start } = parseFrontmatter(lines);
			const roots = buildNodes(lines, scanHeadings(lines, start), lines.length);
			const h1 = roots.find((node) => node.level === 1);
			const fromHeading = h1 ? cleanTitle(h1.title) : '';
			if (fromHeading !== '') return fromHeading;
			const fromFront = front && typeof front.title === 'string' ? cleanTitle(front.title) : '';
			return fromFront !== '' ? fromFront : stripNumericPrefix(baseName(relPath));
		} catch {
			return null;
		}
	}

	/**
	 * 在一个知识点下追加一道题:
	 * 题目文件 = questions/<章>/<知识点文件名>.md (镜像路径), 不存在则按骨架创建。
	 */
	async function addQuestion(payload) {
		const noteRel = String(payload.path ?? '')
			.replace(/\\/g, '/')
			.replace(/^\/+/, '')
			.trim();
		const pointRel = noteStorePath(config, noteRel);
		if (!pointRel) throw new Error(`not-a-knowledge-point: ${noteRel}`);
		const noteAbs = safePath(ctx, config, pointRel);
		if (!noteAbs || !(await pathExists(noteAbs))) throw new Error(`note-not-found: ${noteRel}`);
		const target = questionPathFor(config, pointRel);
		if (!target) throw new Error(`not-a-knowledge-point: ${noteRel}`);
		const pointTitle = (await readNoteTitle(pointRel)) ?? stripNumericPrefix(baseName(pointRel));
		let markdown = null;
		const abs = safePath(ctx, config, target);
		if (abs) markdown = await readFileText(abs);
		const created = markdown === null;
		if (created) {
			const order = numericPrefix(baseName(pointRel)) ?? 1;
			markdown = questionFileTemplate(pointTitle, order, pointRel);
		}
		const counts = countQuestionItems(markdown);
		const order = counts.total + 1;
		/* 每道题一个自己的号(写进块里的注释标记): 题目被删掉、重排、换位置, 号都跟着这道题走 */
		const qUid = await takeUid(ctx, await uidLibOf(config), 'question');
		const next = `${String(markdown).replace(/\s*$/, '')}\n\n${withBlockUid(questionBlock(order), qUid)}`;
		const written = await writeMarkdown(ctx, config, target, next);
		cache.data = null;
		return { ok: true, ...written, path: target, point: pointRel, markdown: next, order, created, uid: qUid };
	}

	/** 表单写回一道题: payload.path 可以是知识点路径, 也可以是题目文件路径 */
	async function saveQuestion(payload) {
		const fields = payload.fields || {};
		const kind = fields.kind === 'case' ? 'case' : 'choice';
		const stem = String(fields.stem ?? '').trim();
		if (stem === '') throw new Error('empty-stem');
		const options = (Array.isArray(fields.options) ? fields.options : [])
			.map((option) => ({
				key: String((option && option.key) || '').trim().toUpperCase(),
				text: String((option && option.text) || '').trim(),
			}))
			.filter((option) => option.text !== '');
		if (kind === 'choice') {
			if (options.length < 2) throw new Error('need-two-options');
			const keys = new Set();
			for (const option of options) {
				if (option.key === '' || keys.has(option.key)) throw new Error('bad-option-key');
				keys.add(option.key);
			}
			if (!keys.has(String(fields.answerKey ?? '').trim().toUpperCase())) throw new Error('answer-not-in-options');
		} else if (String(fields.answerText ?? '').trim() === '') {
			throw new Error('empty-answer');
		}
		const given = String(payload.path ?? '')
			.replace(/\\/g, '/')
			.replace(/^\/+/, '')
			.trim();
		const direct = isQuestionStorePath(config, given) ? given : null;
		const pointRel = direct ? notePathFor(config, direct) : noteStorePath(config, given);
		if (!pointRel) throw new Error(`not-a-knowledge-point: ${given}`);
		const target = direct || questionPathFor(config, pointRel);
		if (!target) throw new Error(`not-a-knowledge-point: ${given}`);
		const abs = safePath(ctx, config, target);
		const pointAbs = safePath(ctx, config, pointRel);
		const markdown = abs ? await readFileText(abs) : null;
		const created = markdown === null;
		if (created) {
			if (!pointAbs || !(await pathExists(pointAbs))) throw new Error(`note-not-found: ${pointRel}`);
			const pointTitle = (await readNoteTitle(pointRel)) ?? stripNumericPrefix(baseName(pointRel));
			const order = numericPrefix(baseName(pointRel)) ?? 1;
			markdown = questionFileTemplate(pointTitle, order, pointRel);
		}
		const wanted = Number.isFinite(Number(payload.order)) && Number(payload.order) > 0 ? Math.round(Number(payload.order)) : null;
		/* 改一道题不换身份: 沿用这个位置原来那道题的号(可能写在文件里), 原来没有才发新号 */
		const qLib = await uidLibOf(config);
		const existing = wanted !== null ? questionBlockNodes(markdown).uids[wanted - 1] || '' : '';
		if (existing !== '') await adoptUid(ctx, qLib, 'question', existing);
		const qUid = existing !== '' ? existing : await takeUid(ctx, qLib, 'question');
		const block = questionBlockFromFields({ ...fields, kind, options }, wanted ?? countQuestionItems(markdown).total + 1);
		const next = saveQuestionBlock(markdown, wanted, block, qUid);
		const written = await writeMarkdown(ctx, config, target, next);
		cache.data = null;
		const counts = countQuestionItems(next);
		return {
			ok: true,
			...written,
			uid: qUid,
			path: target,
			point: pointRel,
			markdown: next,
			order: wanted,
			total: counts.total,
			kind,
			created,
		};
	}

	async function deleteQuestion(payload) {
		const relPath = String(payload.path ?? '').trim();
		const abs = safePath(ctx, config, relPath);
		if (!abs || isExcludedPath(config, relPath)) throw new Error(`invalid path: ${relPath}`);
		const rootTarget = await ctx.fs.resolve(config.root);
		let target;
		try {
			target = await ctx.fs.resolve(abs);
		} catch {
			throw new Error(`note-not-found: ${relPath}`);
		}
		if (!ctx.fs.contains(rootTarget, target)) throw new Error(`invalid path: ${relPath}`);
		const info = await ctx.fs.stat(target);
		if (!info || info.type !== 'file') throw new Error(`note-not-found: ${relPath}`);
		const markdown = await ctx.fs.readText(target);
		const trimmed = removeQuestionBlock(markdown, Number(payload.order));
		if (!trimmed) throw new Error(`question-not-found: ${relPath}#${payload.order}`);
		/* 这道题的号不回收: 记进计数器(以后不会再发同一个), 号本身留在删掉的那段文本里 */
		if (trimmed.uid) await adoptUid(ctx, await uidLibOf(config), 'question', trimmed.uid);
		/* 删掉的这一道题不丢: 先另存一份到画布根目录的 .remove/<日期桶>/ 里, 再重写文件 */
		const bucket = removeBucketFor(config);
		const movedTo = saveRemovedText(config, relPath, trimmed.removed, Number(payload.order), bucket);
		/* 片段也记上它的题目号: 回收站里能看出这段题原来是谁; 每次删除各自开桶, 不会冲掉别的桶的账 */
		if (trimmed.uid && movedTo) {
			const itemRel = String(movedTo).slice(String(movedTo).indexOf('/') + 1);
			if (itemRel) stashUids(config, removeBucketName(bucket), { [`${config.root}/${itemRel}`]: trimmed.uid });
		}
		await writeMarkdown(ctx, config, relPath, trimmed.markdown);
		cache.data = null;
		return {
			ok: true,
			path: relPath,
			uid: trimmed.uid || '',
			removed: trimmed.title,
			remaining: trimmed.remaining,
			movedTo,
			box: REMOVE_DIR,
			bucket: removeBucketName(bucket),
			markdown: trimmed.markdown,
		};
	}

	/* 新建章节 = 只建一个目录, 章节名就是目录名 */
	async function newChapter(payload) {
		const parent = String(payload.parent ?? config.noteDir ?? 'notes').replace(/^\/+|\/+$/g, '');
		const title = sanitizeName(payload.title, '新章节');
		const entries = await listDirSafe(ctx, config, parent);
		let next = 1;
		for (const entry of entries) {
			const prefix = numericPrefix(entry.name);
			if (prefix !== null && prefix >= next) next = prefix + 1;
		}
		const dirName = `${String(next).padStart(2, '0')}-${title}`;
		const dirRel = parent === '' ? dirName : `${parent}/${dirName}`;
		const abs = safeDirPath(config, dirRel);
		if (!abs) throw new Error(`invalid dir: ${dirRel}`);
		if (await pathExists(abs)) throw new Error(`dir-exists: ${dirRel}`);
		await mkdirAt(abs);
		/* 章节的号: 目录没有 frontmatter 可写, 记在学习库的发号簿里 */
		const chapterUid = (await ensureUids(ctx, await uidLibOf(config), 'chapter', [abs]))[abs] || '';
		return { ok: true, dir: dirRel, path: dirRel, name: title, order: next, created: true, uid: chapterUid };
	}

	/* 改名: 只换目录名(保留序号前缀), 题目镜像目录一起改, 并同步题目的 point: 前缀 */
	async function renameChapter(payload) {
		const dirRel = String(payload.dir ?? '')
			.replace(/\\/g, '/')
			.replace(/^\/+|\/+$/g, '')
			.trim();
		if (dirRel === '') throw new Error('cannot-rename-root');
		if (isQuestionStorePath(config, dirRel)) throw new Error(`not-a-chapter: ${dirRel}`);
		const segments = dirRel.split('/').filter(Boolean);
		const segment = segments[segments.length - 1];
		const parentRel = segments.slice(0, -1).join('/');
		const order = numericPrefix(segment);
		const input = String(payload.title ?? '').trim();
		if (input === '') throw new Error('empty-name');
		const chapterName = sanitizeName(stripNumericPrefix(input), '');
		if (chapterName === '') throw new Error('empty-name');
		const dirName = order === null ? chapterName : `${String(order).padStart(2, '0')}-${chapterName}`;
		const nextRel = parentRel === '' ? dirName : `${parentRel}/${dirName}`;
		if (nextRel === dirRel) {
			return { ok: true, dir: dirRel, path: dirRel, name: chapterName, unchanged: true, related: [] };
		}
		const oldAbs = safeDirPath(config, dirRel);
		const newAbs = safeDirPath(config, nextRel);
		if (!oldAbs || !newAbs) throw new Error(`invalid dir: ${dirRel}`);
		if (!(await dirExists(oldAbs))) throw new Error(`dir-not-found: ${dirRel}`);
		if (await pathExists(newAbs)) throw new Error(`target-exists: ${nextRel}`);
		renameSync(oldAbs, newAbs);
		/* 号跟着章节走: 路径变了, 身份不变 */
		const chapterUid = await moveUid(ctx, await uidLibOf(config), oldAbs, newAbs);
		const related = [];
		const mirrorOldRel = questionDirFor(config, dirRel);
		const mirrorNewRel = questionDirFor(config, nextRel);
		const mirrorOldAbs = mirrorOldRel ? safeDirPath(config, mirrorOldRel) : null;
		const mirrorNewAbs = mirrorNewRel ? safeDirPath(config, mirrorNewRel) : null;
		if (mirrorOldAbs && mirrorNewAbs && (await dirExists(mirrorOldAbs)) && !(await pathExists(mirrorNewAbs))) {
			renameSync(mirrorOldAbs, mirrorNewAbs);
			related.push(mirrorNewRel);
			for (const file of await listNames(mirrorNewAbs)) {
				if (!MARKDOWN_RE.test(file)) continue;
				const abs = `${mirrorNewAbs}/${file}`;
				const text = await readFileText(abs);
				if (text === null || !text.includes(dirRel)) continue;
				const next = text
					.split('\n')
					.map((line) => (line.trimStart().startsWith('point:') ? line.split(dirRel).join(nextRel) : line))
					.join('\n');
				if (next !== text) await writeFileAt(abs, next, undefined);
			}
		}
		cache.data = null;
		return { ok: true, dir: nextRel, path: nextRel, name: chapterName, related, uid: chapterUid };
	}

	/* 渲染引擎(katex/mermaid)是插件自带资源, 但照样走 ctx.fs 读 —— 统一文件访问入口 */
	async function readBytesAt(abs, maxBytes) {
		const target = await ctx.fs.resolve(abs);
		const info = await ctx.fs.stat(target);
		if (!info || info.type !== 'file') return null;
		const bytes = await ctx.fs.readBytes(target, undefined, maxBytes);
		return bytes && bytes.length > 0 ? Buffer.from(bytes) : null;
	}

	async function sendAsset(res, relPath, head) {
		const dot = relPath.lastIndexOf('.');
		const type = dot >= 0 ? ASSET_TYPES[relPath.slice(dot).toLowerCase()] : undefined;
		let body = null;
		if (type) {
			try {
				body = await readBytesAt(VENDOR_DIR + '/' + relPath, 16 * 1024 * 1024);
			} catch (error) {
				body = null;
			}
		}
		if (!body) {
			sendJson(res, 404, { error: 'asset-not-found', path: relPath });
			return;
		}
		res.writeHead(200, {
			'content-type': type,
			'content-length': String(body.length),
			'cache-control': 'public, max-age=604800',
		});
		if (head) res.end();
		else res.end(body);
	}

	async function sendClientModule(res, relPath, head) {
		const dot = relPath.lastIndexOf('.');
		const type = dot >= 0 ? CLIENT_TYPES[relPath.slice(dot).toLowerCase()] : undefined;
		let body = null;
		if (type) {
			try {
				const target = await ctx.fs.resolve(`${CLIENT_DIR}/${relPath}`);
				const info = await ctx.fs.stat(target);
				if (info && info.type === 'file') {
					const text = await ctx.fs.readText(target);
					body = Buffer.from(text, 'utf8');
				}
			} catch (error) {
				body = null;
			}
		}
		if (!body) {
			sendJson(res, 404, { error: 'client-module-not-found', path: relPath });
			return;
		}
		res.writeHead(200, {
			'content-type': type,
			'content-length': String(body.length),
			/* 客户端模块不缓存: 本地开发时改完文件 ⌘R 就该看到新代码 */
			'cache-control': 'no-store',
		});
		if (head) res.end();
		else res.end(body);
	}

	async function clientHandler(req, res) {
		const method = (req.method ?? 'GET').toUpperCase();
		if (method !== 'GET' && method !== 'HEAD') {
			res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
			return;
		}
		const raw = String(req.url ?? '').slice(CLIENT_ROUTE.length);
		const clean = (raw.split('?')[0] ?? '').split('#')[0];
		let rel = '';
		try {
			rel = decodeURIComponent(clean).replace(/^\/+/, '');
		} catch (error) {
			rel = '';
		}
		if (rel === '' || rel.startsWith('.') || rel.indexOf('..') >= 0 || rel.indexOf('\\') >= 0) {
			sendJson(res, 404, { error: 'client-module-not-found', path: rel });
			return;
		}
		await sendClientModule(res, rel, method === 'HEAD');
	}

	async function assetHandler(req, res) {
		const method = (req.method ?? 'GET').toUpperCase();
		if (method !== 'GET' && method !== 'HEAD') {
			res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
			return;
		}
		const raw = String(req.url ?? '').slice(ASSET_ROUTE.length);
		const clean = (raw.split('?')[0] ?? '').split('#')[0];
		let rel = '';
		try {
			rel = decodeURIComponent(clean).replace(/^\/+/, '');
		} catch (error) {
			rel = '';
		}
		if (rel === '' || rel.startsWith('.') || rel.indexOf('..') >= 0 || rel.indexOf('\\') >= 0) {
			sendJson(res, 404, { error: 'asset-not-found', path: rel });
			return;
		}
		await sendAsset(res, rel, method === 'HEAD');
	}

	/* ------------------------------------------------ 图片素材(见 README「图片素材」)
	 * 编辑器里插图**不写 Base64**: 字节落到「所在小节」旁边的 .media/<小节uid>.assestfiles/ 里, 正文只留相对路径,
	 * 所以笔记整体搬走、用别的编辑器打开都不丢图; 删掉正文里的图片**不会**删文件(盘上那份留着, 想捡回来随时)。
	 *   GET  ?path=<相对 root 的路径>                        → 吐字节(只有 MEDIA_TYPES 里的扩展名放行)
	 *   POST { path:<笔记相对路径>, name, type, data:<base64> } → 落盘, 回 { ok, src, path, name, uid, bytes }
	 * 「所在小节」= 同一章节目录里、小节序号相同、classifyFile 判为 section 的那个 .md;
	 * 题目库(questions/…)先镜像回笔记库(notes/…)一侧再找。找不到就退化成「这个笔记文件自己」。 */

	/* 相对 root 的**任意**文件路径(不能借 write.js 的 safePath —— 那个只放行 markdown) */
	function mediaAbs(rel) {
		const clean = normalizeRelPath(rel);
		if (clean === '' || clean.split('/').includes('..')) return null;
		const root = activeConfig().root;
		const abs = `${root}/${clean}`;
		return abs.startsWith(`${root}/`) ? abs : null;
	}

	function extOf(name) {
		const dot = String(name ?? '').lastIndexOf('.');
		if (dot < 0) return '';
		const ext = String(name).slice(dot).toLowerCase();
		return MEDIA_TYPES[ext] ? ext : '';
	}

	function relDirOf(rel) {
		const clean = normalizeRelPath(rel);
		const cut = clean.lastIndexOf('/');
		return cut < 0 ? '' : clean.slice(0, cut);
	}

	/* markdown 里存的相对路径: 从 fromDir 走到 toRel(如 notes/01-硬件/media/s0001.assestfiles/s0001-1.png) */
	function relativeSrc(fromDir, toRel) {
		const from = String(fromDir ?? '').split('/').filter(Boolean);
		const to = normalizeRelPath(toRel).split('/').filter(Boolean);
		let same = 0;
		while (same < from.length && same < to.length - 1 && from[same] === to[same]) same += 1;
		return new Array(from.length - same).fill('..').concat(to.slice(same)).join('/');
	}

	/* 这个笔记文件归哪个小节管(小节的 uid 就是素材目录名) */
	async function sectionRelForNote(rel, signal) {
		const config = activeConfig();
		const clean = normalizeRelPath(rel);
		const dir = relDirOf(clean);
		const info = classifyFile(baseName(clean), null);
		if (info.kind === 'section' || info.number === null) return clean;
		/* 题目在 questions/ 一侧, 小节在 notes/ 一侧 —— 按目录镜像过去找 */
		let home = dir;
		if (isQuestionStorePath(config, clean)) {
			const q = String(config.questionDir ?? '');
			const n = String(config.noteDir ?? '');
			if (dir === q) home = n;
			else if (dir.startsWith(`${q}/`)) home = n + dir.slice(q.length);
		}
		const homeAbs = safeDirPath(config, home);
		if (!homeAbs) return clean;
		for (const file of await listNames(homeAbs, signal)) {
			if (!MARKDOWN_RE.test(file)) continue;
			const hit = classifyFile(baseName(file), null);
			if (hit.kind === 'section' && hit.number === info.number) return `${home}/${file}`;
		}
		return clean;
	}

	/* 小节 uid + 素材目录(相对 root) */
	async function mediaHomeFor(rel, signal) {
		const config = activeConfig();
		const sectionRel = await sectionRelForNote(rel, signal);
		const sectionAbs = mediaAbs(sectionRel);
		if (!sectionAbs) throw new Error(`invalid path: ${rel}`);
		const text = await readFileText(sectionAbs, signal);
		/* 定到的必须**真是小节**: 认错了就会给题目 / 知识点文件发一个 s 号, 号池就脏了 —— 宁可报错 */
		const hit = classifyFile(baseName(sectionRel), parseFrontmatter(text.split(/\r?\n/)).front);
		if (hit.kind !== 'section') throw new Error(`no-section-for-note: ${rel}`);
		let uid = uidFromText(text, 'section');
		if (uid === '') {
			const lib = await uidLibOf(config, signal);
			uid = (await ensureUids(ctx, lib, 'section', [sectionAbs]))[sectionAbs] || '';
		}
		if (uid === '') throw new Error(`no-section-uid: ${sectionRel}`);
		const dir = relDirOf(sectionRel);
		/* 素材统一收在正文目录下的 .media/ 里: <小节目录>/.media/<小节uid>.assestfiles/<uid>-<序号>.<ext>
		 * (正文里存的相对路径也就带上了 .media/ 这一层, 搬走笔记时整目录一起走, 不丢图) */
		const home = `${MEDIA_PARENT_DIR}/${uid}${MEDIA_DIR_SUFFIX}`;
		return { uid, dir, sectionRel, rel: dir === '' ? home : `${dir}/${home}` };
	}

	/* 老库里的素材目录还叫 media/, 现在改叫 .media/ —— 往一个老小节里第一次插图时, 顺手把这一层搬过去,
	 * 并把正文里那几段路径跟着改(不改的话同一个小节底下会留两份素材目录, 别的编辑器也点不开图)。
	 * 只在这一层确实存在时动手; 搬完把空掉的旧目录摘掉(只删空目录)。 */
	async function migrateLegacyMedia(dir, signal) {
		const prefix = dir === '' ? '' : `${dir}/`;
		const fromAbs = mediaAbs(`${prefix}${MEDIA_LEGACY_PARENT_DIR}`);
		const toAbs = mediaAbs(`${prefix}${MEDIA_PARENT_DIR}`);
		if (!fromAbs || !toAbs || !(await dirExists(fromAbs, signal))) return 0;
		const names = [];
		for (const entry of await listDirSafe(ctx, activeConfig(), `${prefix}${MEDIA_LEGACY_PARENT_DIR}`, signal)) {
			if (entry.type !== 'directory') continue;
			const name = String(entry.name ?? '');
			if (name === '' || name.startsWith('.')) continue;
			const source = `${fromAbs}/${name}`;
			const target = `${toAbs}/${name}`;
			if (await pathExists(target, signal)) {
				/* 新布局下这里已经插过图(目标目录已经在了) ⇒ 逐个文件并过去;
				 * 同名文件留在原地不动 —— 名字一样就是同一张图, 正文里那段路径
				 * 改成 .media/ 之后照旧点得开(见 mediaFind 的三档认图) */
				for (const child of await listDirSafe(ctx, activeConfig(), `${prefix}${MEDIA_LEGACY_PARENT_DIR}/${name}`, signal)) {
					const childName = String(child.name ?? '');
					if (childName === '' || childName.startsWith('.')) continue;
					if (await pathExists(`${target}/${childName}`, signal)) continue;
					renameSync(`${source}/${childName}`, `${target}/${childName}`);
				}
			} else {
				await mkdirAt(toAbs, signal);
				renameSync(source, target);
			}
			names.push(name);
		}
		try {
			if ((await listNames(fromAbs, signal)).length === 0) rmdirSync(fromAbs);
		} catch {
			/* 摘不掉就留着 —— 空目录不进画布, 也不碍事 */
		}
		if (names.length > 0) await rewriteLegacyMediaRefs(names, signal);
		return names.length;
	}

	/* 把正文里的 `media/<uid>.assestfiles/…` 改成 `.media/<uid>.assestfiles/…`:
	 * 只动这一层, 别的字节一个不碰; 走过的文件按 MAX_FILES / MAX_DEPTH 封顶。 */
	async function rewriteLegacyMediaRefs(names, signal) {
		const config = activeConfig();
		const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
		const pattern = new RegExp(`(^|[^.\\w])${MEDIA_LEGACY_PARENT_DIR}/(${escaped})/`, 'g');
		const queue = [[config.noteDir ?? '', 0], [config.questionDir ?? '', 0]];
		const seen = new Set();
		let scanned = 0;
		while (queue.length > 0) {
			const [relDir, depth] = queue.shift();
			if (depth > MAX_DEPTH || seen.has(relDir)) continue;
			seen.add(relDir);
			const abs = relDir === '' ? config.root : mediaAbs(relDir);
			if (!abs || !(await dirExists(abs, signal))) continue;
			for (const name of await listNames(abs, signal)) {
				if (name.startsWith('.') || (config.exclude || []).includes(name)) continue;
				const childAbs = `${abs}/${name}`;
				if (await dirExists(childAbs, signal)) {
					if (!name.endsWith(MEDIA_DIR_SUFFIX)) queue.push([relDir === '' ? name : `${relDir}/${name}`, depth + 1]);
					continue;
				}
				if (!MARKDOWN_RE.test(name) || scanned >= MAX_FILES) continue;
				scanned += 1;
				const text = await readFileText(childAbs, signal);
				if (text === null || text === undefined) continue;
				const next = String(text).replace(pattern, (_hit, pre, name_) => `${pre}${MEDIA_PARENT_DIR}/${name_}/`);
				if (next !== text) await writeFileAt(childAbs, next, signal);
			}
		}
	}

	async function nextMediaName(dirAbs, uid, ext, signal) {
		const pattern = new RegExp(`^${uid}-(\\d+)\\${ext}$`);
		let max = 0;
		for (const name of await listNames(dirAbs, signal)) {
			const hit = pattern.exec(name);
			if (hit) max = Math.max(max, Number(hit[1]) || 0);
		}
		return `${uid}-${max + 1}${ext}`;
	}

	async function mediaUpload(payload) {
		const rel = normalizeRelPath(String(payload.path ?? ''));
		const ext = extOf(payload.name);
		if (rel === '' || rel.split('/').includes('..') || ext === '') throw new Error(`invalid-upload: ${payload.name ?? ''}`);
		const home = await mediaHomeFor(rel);
		const dirAbs = safeDirPath(activeConfig(), home.rel);
		if (!dirAbs) throw new Error(`invalid path: ${home.rel}`);
		/* 这个小节要是有老式 media/ 素材目录, 先把它搬成 .media/(见 migrateLegacyMedia)。
		 * 搬不动也不拦着插图 —— 正文里那段相对路径照旧认得到(见 mediaFind 的兜底找法)。 */
		try {
			await migrateLegacyMedia(home.dir, undefined);
		} catch {
			/* 搬不动就算了 */
		}
		const data = String(payload.data ?? '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
		const bytes = Buffer.from(data, 'base64');
		if (bytes.length === 0) throw new Error('empty-image');
		if (bytes.length > MEDIA_MAX_BYTES) throw new Error('image-too-large');
		const name = await nextMediaName(dirAbs, home.uid, ext);
		const abs = `${dirAbs}/${name}`;
		if (!(await insideRoot(ctx, activeConfig(), abs))) throw new Error(`invalid path: ${abs}`);
		await mkdirAt(dirAbs);
		writeFileSync(abs, bytes);
		const fileRel = `${home.rel}/${name}`;
		cache.data = null;
		/* markdown 里存的是**相对这篇笔记自己的位置**的路径: 笔记在题目库里时就是 ../../notes/… 那种,
		 * 这样 notes/ 与 questions/ 一起搬走(或被别的编辑器打开)都不丢图 */
		return { ok: true, uid: home.uid, name, path: fileRel, src: relativeSrc(relDirOf(rel), fileRel), bytes: bytes.length };
	}

	/* markdown 里存的是**相对笔记所在目录**的路径, 而卡片 / 导图 / 预览 / 编辑器渲染时都不知道那个目录,
	 * 所以认图分三档(结果按 root 缓存, 图只增不改所以缓存不会过期):
	 *   1) 直接当 root 相对路径认(../ 前缀先剥掉) —— 题目在 questions/ 一侧、素材在 notes/ 一侧时正好落到这;
	 *   2) 把路径按 / 切成后缀(文件名不动, 最多留 3 档), 在库里(根 + 一二级子目录, 有上限)找同名后缀
	 *      —— 同目录写法走这: media/<uid>.assestfiles/x.png 与旧的 <uid>.assestfiles/x.png 都能命中;
	 *   3) 再退回「整个相对路径按后缀找一遍」。 */
	const mediaCache = new Map();

	function stripDotParts(rel) {
		return normalizeRelPath(rel)
			.split('/')
			.filter((part) => part !== '' && part !== '.' && part !== '..')
			.join('/');
	}

	async function mediaFind(rel, signal) {
		const clean = stripDotParts(rel);
		if (clean === '') return '';
		const key = `${activeConfig().root}|${clean}`;
		if (mediaCache.has(key)) return mediaCache.get(key);
		let found = '';
		const direct = mediaAbs(clean);
		if (direct && (await pathExists(direct, signal))) found = clean;
		if (found === '') {
			/* 兜底找法: 正文里那张图的相对路径不一定跟当前 root 的叫法一致(换过 root / 从别处搬来的笔记)。
			 * 把相对路径按 `/` 切开, 从最长的开始每次去掉一段前缀(**文件名永不切掉**, 最多 3 档),
			 * 再到 root 及一二级子目录里挨个试 —— 于是这几种写法都能命中:
			 * .media/<uid>.assestfiles/x.png(现在的布局)、media/<uid>.assestfiles/x.png(老库的布局)、
			 * <uid>.assestfiles/x.png(更早的旧布局, 在两种素材目录前后都试一遍)、
			 * notes/01-硬件/.media/<uid>.assestfiles/x.png。 */
			const parts = clean.split('/').filter(Boolean);
			const tails = [];
			for (let cut = 0; cut < parts.length - 1 && tails.length < 3; cut += 1) tails.push(parts.slice(cut).join('/'));
			if (tails.length === 0) tails.push(clean);
			const dirs = [''];
			const rootNames = await listNames(activeConfig().root, signal);
			for (const name of rootNames.slice(0, 200)) {
				if (name.startsWith('.') || activeConfig().exclude.includes(name)) continue;
				dirs.push(name);
			}
			for (const dir of dirs.slice()) {
				const subNames = await listNames(`${activeConfig().root}/${dir}`, signal);
				for (const name of subNames.slice(0, 200)) {
					if (name.startsWith('.') || activeConfig().exclude.includes(name)) continue;
					if (await dirExists(`${activeConfig().root}/${dir}/${name}`)) dirs.push(`${dir}/${name}`);
				}
			}
			const seen = [];
			for (const tail of tails) {
				if (tail === '' || seen.includes(tail)) continue;
				seen.push(tail);
				for (const dir of dirs) {
					const base = dir === '' ? '' : `${dir}/`;
					/* 每个目录下试三种落点: 直接放(更早的旧布局 / 手写)、收在 .media/ 里(现在的布局)、
					 * 收在 media/ 里(老库的布局, 还没被 migrateLegacyMedia 搬过来的) */
					const candidates = [`${base}${tail}`, `${base}${MEDIA_PARENT_DIR}/${tail}`, `${base}${MEDIA_LEGACY_PARENT_DIR}/${tail}`];
					for (const candidate of candidates) {
						const abs = mediaAbs(candidate);
						if (abs && (await pathExists(abs, signal))) {
							found = candidate;
							break;
						}
					}
					if (found !== '') break;
				}
				if (found !== '') break;
			}
		}
		mediaCache.set(key, found);
		return found;
	}

	async function mediaHandler(req, res) {
		const method = (req.method ?? 'GET').toUpperCase();
		const url = new URL(req.url ?? MEDIA_ROUTE, 'http://localhost');
		try {
			if (method === 'GET' || method === 'HEAD') {
				const asked = normalizeRelPath(String(url.searchParams.get('path') ?? ''));
				const type = MEDIA_TYPES[extOf(asked)] || '';
				const rel = type === '' ? '' : await mediaFind(asked);
				const abs = rel === '' ? null : mediaAbs(rel);
				let body = null;
				if (abs) {
					try {
						body = await readBytesAt(abs, MEDIA_MAX_BYTES);
					} catch (error) {
						body = null;
					}
				}
				if (!body) {
					sendJson(res, 404, { error: 'image-not-found', path: rel });
					return;
				}
				res.writeHead(200, {
					'content-type': type,
					'content-length': String(body.length),
					/* 文件名带序号、只增不改, 所以可以长缓存 */
					'cache-control': 'private, max-age=604800, immutable',
				});
				if (method === 'HEAD') res.end();
				else res.end(body);
				return;
			}
			if (method === 'POST') {
				const payload = await readBody(req, MEDIA_MAX_BYTES);
				sendJson(res, 200, await mediaUpload(payload));
				return;
			}
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			const tooLarge = error && error.code === 'RK_BODY_TOO_LARGE';
			sendJson(res, tooLarge ? 413 : 500, {
				error: tooLarge ? 'request-too-large' : 'rk-study-failed',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	function sendJson(res, status, payload) {
		const body = Buffer.from(JSON.stringify(payload), 'utf8');
		res.writeHead(status, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': String(body.length),
			'cache-control': 'no-store',
		});
		res.end(body);
	}

	async function handler(req, res) {
		/* 回收站记录躺在 <目录>/.remove/<桶>/… 里; 一级画布那层可能来自不同目录,
		 * 认号要认到那个目录自己的号池上去。box 不合法就照旧用当前 config。 */
		const binSource = (base, box) => {
			const text = String(box ?? '').replace(/\/+$/, '');
			const suffix = '/.remove';
			if (text === '' || text.charAt(0) !== '/' || !text.endsWith(suffix)) return base;
			const owner = text.slice(0, text.length - suffix.length);
			return owner === '' ? base : Object.assign({}, base, { root: owner });
		};

		const url = new URL(req.url ?? ROUTE, 'http://localhost');
		const method = (req.method ?? 'GET').toUpperCase();

		try {
			if (method === 'GET' || method === 'HEAD') {
				/* 回收站只有两层看它:
				 *   · 一级画布（进了某张画布）—— 只看这张画布自己的 .remove, 记录按章聚合成「整章」;
				 *   · 根画布（还没进任何画布）—— 只列被移出列表的**整只画布**（它们躺在各自父目录的 .remove 里,
				 *     宿主这儿的画布列表就是 STATE_FILE 里的 roots）。 */
				if (url.searchParams.get('bin') === '1') {
					if (url.searchParams.get('mode') !== 'roots') {
						sendJson(res, 200, listChapterBin(config, url.searchParams.get('box')));
						return;
					}
					let known = [];
					try {
						const text = await readFileText(STATE_FILE, undefined, TEMPLATE_MAX_BYTES);
						const parsed = JSON.parse(String(text === null || text === undefined ? '' : text));
						if (parsed && Array.isArray(parsed.roots)) known = parsed.roots.slice();
						if (parsed && typeof parsed.defaultRoot === 'string' && parsed.defaultRoot !== '') known.push({ path: parsed.defaultRoot });
					} catch {
						/* 状态读不到就只按当前这个目录算 */
					}
					sendJson(res, 200, listRootBins(config, known));
					return;
				}
				if (url.searchParams.has('file')) {
					const wanted = url.searchParams.get('file').trim();
					const sharedFile = await sharedTemplateFile(wanted);
					/* 模板文件的规范路径是 .templates/xx.md(老画布可能是 notes/.templates/xx.md):
					 * 命中库共享的那份就直接读库里的, 否则按画布里的实际位置读 */
					const localRel = sharedFile === '' ? await localTemplateFile(wanted) : '';
					const file =
						sharedFile !== ''
							? await loadTemplateFile(wanted, sharedFile)
							: await loadFile(localRel === '' ? wanted : localRel, undefined);
					if (file && localRel !== '' && file.path !== wanted) file.path = wanted;
					if (!file) {
						sendJson(res, 404, { error: 'note-not-found' });
						return;
					}
					sendJson(res, 200, file);
					return;
				}
				if (url.searchParams.has('point')) {
					const relPath = String(url.searchParams.get('point') ?? '').trim();
					const key = String(url.searchParams.get('key') ?? '').trim();
					const info = await loadPoint(relPath, key);
					if (!info) {
						sendJson(res, 404, { error: 'note-not-found' });
						return;
					}
					sendJson(res, info.ok === false ? 400 : 200, info);
					return;
				}
				if (url.searchParams.has('template')) {
					const kind = url.searchParams.get('template');
					const title = sanitizeName(
						url.searchParams.get('title'),
						kind === 'question' ? '新题集' : kind === 'point' ? '新知识点' : '新小节',
					);
					const markdown =
						kind === 'question'
							? questionTemplate(title, 1)
							: kind === 'point'
								? pointTemplate(title, 1)
								: noteTemplate(title, 1);
					sendJson(res, 200, { template: kind, markdown });
					return;
				}
				const data = await loadCatalog(url.searchParams.get('force') === '1', undefined);
				sendJson(res, 200, data);
				return;
			}

			if (method === 'POST') {
				const payload = await readBody(req, MAX_BODY_BYTES);
				const action = String(payload.action ?? '');
				if (action === 'restore') {
					/* box = 这条记录躺在哪只 .remove 里（一级画布那层会来自不同的父目录）; 号池按那个目录算 */
					const source = binSource(config, payload.box);
					const result = await restoreItem(ctx, config, await uidLibOf(source), payload.bucket, payload.item, payload.box);
					cache.data = null;
					caches.delete(config.root);
					sendJson(res, result.ok ? 200 : 400, result);
					return;
				}
				if (action === 'restoreBucket') {
					const source = binSource(config, payload.box);
					const result = await restoreBucket(ctx, config, await uidLibOf(source), payload.bucket, payload.box);
					cache.data = null;
					caches.delete(config.root);
					sendJson(res, 200, result);
					return;
				}
				if (action === 'restoreChapter') {
					/* 一级画布那层的动作: 把这一章在所有桶里的东西整段合并回去 */
					const source = binSource(config, payload.box);
					const result = await restoreChapter(ctx, config, await uidLibOf(source), payload.box, payload.chapter);
					cache.data = null;
					caches.delete(config.root);
					sendJson(res, result.ok ? 200 : 400, result);
					return;
				}
				if (action === 'save') {
					sendJson(res, 200, await saveFile(payload));
					return;
				}
				if (action === 'newSection') {
					sendJson(res, 200, await newSection(payload));
					return;
				}
				if (action === 'newPoint') {
					sendJson(res, 200, await newPoint(payload));
					return;
				}
				if (action === 'addQuestion') {
					sendJson(res, 200, await addQuestion(payload));
					return;
				}
				if (action === 'saveQuestion') {
					sendJson(res, 200, await saveQuestion(payload));
					return;
				}
				if (action === 'savePoint') {
					sendJson(res, 200, await savePoint(payload));
					return;
				}
				if (action === 'newChapter') {
					sendJson(res, 200, await newChapter(payload));
					return;
				}
				if (action === 'renameChapter') {
					sendJson(res, 200, await renameChapter(payload));
					return;
				}
				if (action === 'delete') {
					const rel = String(payload.path ?? '').trim();
					const result = await deleteEntry(ctx, config, rel);
					cache.data = null;
					/* 删掉的笔记把号一起带走(计数器不回退): 号写进这个桶的 .rk-uids.json, 想恢复时还认得回来 */
					const abs = safePath(ctx, config, rel);
					if (result.removed && abs) {
						const dropped = await dropUids(ctx, await uidLibOf(config), [abs]);
						if (Object.keys(dropped).length > 0 && result.bucket) stashUids(config, result.bucket, dropped);
						result.uids = dropped;
					}
					sendJson(res, 200, result);
					return;
				}
				if (action === 'deleteDir') {
					const dir = String(payload.dir ?? '').trim();
					const result = await deleteDirEntry(ctx, config, dir);
					cache.data = null;
					/* 删掉的章节把号一起带走(计数器不回退): 位置不变但重建同名章节会拿到新号。
					 * 摘下来的号写进这个桶的 .rk-uids.json, 想恢复时还认得回来。 */
					const abs = safeDirPath(config, dir);
					if (result.removed && abs) {
						const dropped = await dropUids(ctx, await uidLibOf(config), [abs]);
						if (Object.keys(dropped).length > 0 && result.bucket) stashUids(config, result.bucket, dropped);
						result.uids = dropped;
					}
					sendJson(res, 200, result);
					return;
				}
				if (action === 'deleteQuestion') {
					sendJson(res, 200, await deleteQuestion(payload));
					return;
				}
				sendJson(res, 400, { error: 'unknown-action', action });
				return;
			}

			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			/* body 超限是客户端问题, 该是 413 而不是 500(见 lib/write.js 的 readBody) */
			const tooLarge = error && error.code === 'RK_BODY_TOO_LARGE';
			sendJson(res, tooLarge ? 413 : 500, {
				error: tooLarge ? 'request-too-large' : 'rk-study-failed',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/* 面板的「Git 提交」弹窗: GET = 工作区状态, POST = commit / push */
	/* 编辑器工具栏「模板」菜单的数据源: GET 读(没有就吐默认模板), POST 写回去 */
	/* 库共享模板目录(存在才生效)。 */
	async function sharedTemplateDir() {
		const abs = sharedTemplateDirOf(config);
		if (abs === '') return '';
		return (await dirExists(abs)) ? abs : '';
	}

	/* 该写进哪一份共享模板: 库目录已存在就用它; 库里还没建、但父目录明显是学习库(下面还有别的画布)
	 * 就写进父目录的 .templates(该建就建) —— 库里的画布自己不再各存一份;
	 * 自带根目录的画布(父目录里没有别的画布)返回 '', 走画布自己的 .templates。 */
	async function sharedTemplateTarget() {
		const abs = sharedTemplateDirOf(config);
		if (abs === '') return '';
		const existing = await sharedTemplateDir();
		if (existing !== '') return existing;
		return (await libraryDirOf(ctx, config)) === '' ? '' : abs;
	}

	/* 模板文件的规范路径 .templates/<名字>.md —— 老画布写的是 notes/.templates/<名字>.md, 两种都认。 */
	function templateFileName(relPath) {
		const rel = String(relPath ?? '').replace(/^\/+/, '');
		for (const dir of [templateDirOf(config), legacyTemplateDirOf(config)]) {
			if (dir === '' || !rel.startsWith(`${dir}/`)) continue;
			const name = rel.slice(dir.length + 1);
			if (name !== '' && !name.includes('/') && !name.includes('..')) return name;
		}
		return '';
	}

	/* 画布级模板目录(相对 root): 新的位置是 <画布>/.templates, 老画布是 <画布>/notes/.templates。
	 * 根目录那一份存在就用它; 否则老位置有货就用老位置; 都没有就用新位置(写的时候建出来)。 */
	async function localTemplateDir() {
		const rel = templateDirOf(config);
		if (await dirExists(`${config.root}/${rel}`)) return rel;
		const legacy = legacyTemplateDirOf(config);
		if (legacy !== rel && (await dirExists(`${config.root}/${legacy}`))) return legacy;
		return rel;
	}

	/* 「编辑模板」写回来的路径(传的是规范路径) → 画布里的实际落盘位置 */
	async function localTemplateFile(relPath) {
		const name = templateFileName(relPath);
		return name === '' ? '' : `${await localTemplateDir()}/${name}`;
	}

	/* 规范路径落在库里时就映射到库里那份同名文件: 编辑器读写的是这一份, 画布自己不用再存 */
	async function sharedTemplateFile(relPath) {
		const name = templateFileName(relPath);
		if (name === '') return '';
		const shared = await sharedTemplateDir();
		return shared === '' ? '' : `${shared}/${name}`;
	}

	async function templatesHandler(req, res) {
		const method = String(req.method ?? 'GET').toUpperCase();
		if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
			return;
		}
		if (method === 'POST') {
			const payload = await readBody(req, MAX_BODY_BYTES);
			const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
			const spec = String(payload.key ?? payload.file ?? '').trim();
			const entry = spec === '' ? TEMPLATE_FILES[0] : TEMPLATE_FILES.find((item) => item.key === spec || item.file === spec || item.label === spec);
			if (!entry) {
				sendJson(res, 400, { error: 'template-file-unknown', file: spec, files: TEMPLATE_FILES.map((item) => item.key) });
				return;
			}
			const rel = templatePath(config, entry.file);
			const shared = await sharedTemplateTarget();
			const localDir = await localTemplateDir();
			const abs = shared === '' ? `${config.root}/${localDir}/${entry.file}` : `${shared}/${entry.file}`;
			await writeFileAt(abs, markdown, undefined, shared === '' ? config.root : shared);
			sendJson(res, 200, {
				ok: true,
				key: entry.key,
				path: rel,
				shared: shared !== '',
				bytes: Buffer.byteLength(markdown, 'utf8'),
			});
			return;
		}
		/* 一个文件对应工具栏上的一个菜单(公式 ▾ / 模板 ▾), 一次把两份都读出来。
		 * 找的顺序: 库共享的 <库>/.templates → 画布自己的 <画布>/.templates → 老位置 <画布>/notes/.templates → 内置模板 */
		const shared = await sharedTemplateDir();
		const localRel = await localTemplateDir();
		const home = shared !== '' ? shared : `${config.root}/${localRel}`;
		const files = [];
		for (const entry of TEMPLATE_FILES) {
			const rel = templatePath(config, entry.file);
			let markdown = entry.markdown;
			let exists = false;
			let via = 'builtin';
			const text = await readFileText(`${home}/${entry.file}`, undefined, TEMPLATE_MAX_BYTES);
			if (text !== null) {
				markdown = text;
				exists = true;
				via = shared !== '' ? 'shared' : localRel === templateDirOf(config) ? 'canvas' : 'legacy';
			}
			files.push({ key: entry.key, label: entry.label, file: entry.file, path: rel, exists, via, markdown });
		}
		const dir = shared !== '' ? shared : localRel;
		sendJson(res, 200, { ok: true, dir, shared: shared !== '', via: files[0] ? files[0].via : 'builtin', files });
	}

	async function gitHandler(req, res) {
		const method = (req.method ?? 'GET').toUpperCase();
		try {
			if (method === 'GET' || method === 'HEAD') {
				/* 面板只提交笔记: 默认按 scope 过滤改动, ?scope=notes 只看 noteDir/questionDir */
				const scope = /[?&]scope=notes\b/.test(String(req.url ?? '')) ? 'notes' : 'all';
				sendJson(res, 200, await gitStatus(ctx, config, { scope }));
				return;
			}
			if (method === 'POST') {
				const payload = await readBody(req, MAX_BODY_BYTES);
				const action = String(payload.action ?? '').trim();
				if (action === 'commit') {
					sendJson(res, 200, await gitCommit(ctx, config, { message: payload.message, scope: payload.scope, push: payload.push === true }));
					return;
				}
				if (action === 'push') {
					sendJson(res, 200, await gitPush(ctx, config, { dryRun: payload.dryRun === true }));
					return;
				}
				if (action === 'pull') {
					sendJson(res, 200, await gitPull(ctx, config, {}));
					return;
				}
				if (action === 'message') {
					sendJson(res, 200, await gitMessage(ctx, config, { scope: payload.scope, provider: payload.provider, model: payload.model }));
					return;
				}
				if (action === 'models') {
					sendJson(res, 200, await gitModels(ctx));
					return;
				}
				sendJson(res, 400, { error: 'unknown-action', action });
				return;
			}
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			sendJson(res, 500, { error: 'rk-study-failed', message: error instanceof Error ? error.message : String(error) });
		}
	}

	/* 一级画布: 学习笔记根目录的查询 / 创建。
	 * GET  → 默认根目录 + 建议的父目录(~/Desktop) + 笔记/题目/模板目录名
	 * POST → 在指定绝对路径下建 notes/ + questions/(自带根目录的画布再加 .templates/), 不删任何东西 */
	/* 目录浏览器用: 主目录 / 桌面(取不到就是空串, 客户端会把那个快捷键藏起来)。
	 * 不再 import node:os: HOME 环境变量就是同一个值, 而且这里只当快捷键的默认值用。 */
	function homeDir() {
		const home = typeof process !== 'undefined' && process.env ? process.env.HOME : '';
		return typeof home === 'string' ? home.replace(/\/+$/, '') : '';
	}

	async function suggestParent() {
		const home = homeDir();
		if (home === '') return '';
		const desktop = `${home}/Desktop`;
		return (await dirExists(desktop)) ? desktop : home;
	}

	async function desktopDir() {
		const home = homeDir();
		if (home === '') return '';
		const desktop = `${home}/Desktop`;
		return (await dirExists(desktop)) ? desktop : '';
	}

	async function createRoot(payload) {
		const root = validateRoot(payload && payload.path);
		if (!root) return { ok: false, error: 'bad-path', message: '需要一个绝对路径(不能包含 ..)' };
		try {
			if ((await pathExists(root)) && !(await dirExists(root))) return { ok: false, error: 'not-a-directory', root };
		} catch (error) {
			return { ok: false, error: 'stat-failed', root, message: error instanceof Error ? error.message : String(error) };
		}
		const existed = await pathExists(root);
		if (existed) {
			/* 一级画布不能重名: 目标目录已经是一张画布(有 notes/ questions/ .templates/ 任一个)就拒绝 */
			const wanted = [baseConfig.noteDir, baseConfig.questionDir, templateDirOf({ ...baseConfig, root })].filter(
				(dir) => typeof dir === 'string' && dir !== '',
			);
			let busy = false;
			for (const dir of wanted) {
				if (await pathExists(`${root}/${dir}`)) {
					busy = true;
					break;
				}
			}
			if (busy) return { ok: false, error: 'name-taken', root };
		}
		const created = [];
		const templates = [];
		let sharedDir = '';
		const cfg = { noteDir: baseConfig.noteDir, questionDir: baseConfig.questionDir, templateDir: baseConfig.templateDir, root };
		const rootScope = parentOfPath(root);
		try {
			await mkdirAt(root, undefined, rootScope);
			for (const dir of [cfg.noteDir, cfg.questionDir]) {
				const abs = `${root}/${dir}`;
				if (!(await pathExists(abs))) {
					await mkdirAt(abs, undefined, root);
					created.push(dir);
				}
			}
			/* 模板放哪: ① 显式给的库目录(「画布存放目录」/ 导入的学习库)下面的 .templates;
			 * ② 画布父目录里已有的 .templates(导入进来的笔记库);
			 * ③ 父目录本身就是一个学习库(下面还有别的画布) ⇒ 也用父目录那份(该建就建);
			 * 只有自带根目录的画布(①②③都不成立)才在画布根目录建 .templates ——
			 * 库里的画布共用库那一份, 自己目录下不再各建一份(像 WorkNotes/系统架构师 就没有 .templates)。 */
			const parentTemplates = sharedTemplateDirOf(cfg);
			const lib = validateRoot(payload && payload.library);
			const sharedTarget = lib
				? `${lib}/.templates`
				: parentTemplates !== '' && ((await pathExists(parentTemplates)) || (await libraryDirOf(ctx, cfg)) !== '')
					? parentTemplates
					: '';
			if (sharedTarget !== '') {
				sharedDir = sharedTarget;
				if (!(await pathExists(sharedTarget))) {
					await mkdirAt(sharedTarget, undefined, lib || rootScope);
					created.push(sharedTarget);
				}
				for (const entry of TEMPLATE_FILES) {
					const abs = `${sharedTarget}/${entry.file}`;
					if (await pathExists(abs)) continue;
					await writeFileAt(abs, entry.markdown, undefined, sharedTarget);
					templates.push(abs);
				}
			} else {
				/* 自带根目录的画布: 才建 <画布>/.templates(配置不再落盘, 全在浏览器 localStorage 里) */
				const dir = templateDirOf(cfg);
				const abs = `${root}/${dir}`;
				if (!(await pathExists(abs))) {
					await mkdirAt(abs, undefined, root);
					created.push(dir);
				}
				for (const entry of TEMPLATE_FILES) {
					const rel = templatePath(cfg, entry.file);
					if (await pathExists(`${root}/${rel}`)) continue;
					await writeMarkdown(ctx, cfg, rel, entry.markdown);
					templates.push(rel);
				}
			}
		} catch (error) {
			return { ok: false, error: 'create-failed', root, created, message: error instanceof Error ? error.message : String(error) };
		}
		/* 画布的号: 号池在学习库那一级(库里所有画布共用一个号池), 单张画布就记在自己身上 */
		const canvasUidLib = validateRoot(payload && payload.library) || (await uidLibOf(cfg));
		const canvasUid = (await ensureUids(ctx, canvasUidLib, 'canvas', [root]))[root] || '';
		return { ok: true, root, existed, created, templates, sharedTemplateDir: sharedDir, uid: canvasUid, name: root.split('/').filter(Boolean).pop() || root };
	}

	const LIBRARY_SKIP = new Set(['node_modules', '.git', 'dist', 'build']);
	const LIBRARY_MAX = 200;

	function parentOfPath(abs) {
		const clean = String(abs ?? '').replace(/\/+$/, '');
		const cut = clean.lastIndexOf('/');
		return cut <= 0 ? '/' : clean.slice(0, cut);
	}

	/* 画布名字的合法值: 单层目录名(没有 / 和 \\)、不以 . 开头、去掉换行制表符、最长 60 字 */
	function cleanCanvasName(value) {
		const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
		if (text === '' || text === '.' || text === '..') return '';
		if (text.startsWith('.')) return '';
		if (text.includes('/') || text.includes('\\')) return '';
		return text.slice(0, 60);
	}

	/* 一级画布「改名」= 直接把磁盘上的目录改名 —— 目录名就是画布名, 换浏览器 / 换机器都还在。
	 * 只动名字: 同层目录不能重名(重名返回 name-taken, 客户端提示换一个)。 */
	async function renameRoot(payload) {
		const from = validateRoot(payload && payload.path);
		if (!from) return { ok: false, error: 'bad-path', message: '需要一个绝对路径(不能包含 ..)' };
		const name = cleanCanvasName(payload && payload.name);
		if (name === '') return { ok: false, error: 'bad-name', message: '目录名不能为空、不能含 / 、不能以 . 开头' };
		const target = `${parentOfPath(from)}/${name}`;
		if (target === from) return { ok: true, root: from, name, renamed: false };
		try {
			if (!(await dirExists(from))) return { ok: false, error: 'not-a-directory', root: from };
		} catch (error) {
			return { ok: false, error: 'stat-failed', message: error instanceof Error ? error.message : String(error) };
		}
		if (await pathExists(target)) return { ok: false, error: 'name-taken', root: target };
		try {
			renameSync(from, target);
		} catch (error) {
			return { ok: false, error: 'rename-failed', message: error instanceof Error ? error.message : String(error) };
		}
		caches.delete(from);
		caches.delete(target);
		/* 号跟着画布走: 目录改名了, 身份不变 */
		const renamedUid = await moveUid(ctx, await uidLibOf({ ...baseConfig, root: from }), from, target);
		return { ok: true, root: target, from, name, renamed: true, uid: renamedUid };
	}

	/* 一级画布「移出列表」= 把目录移到同一层 .remove/ 里 —— 点开头, 扫描直接跳过, 内容原样保留,
	 * 想恢复就把目录移回上一层。排布跟「删除章节/知识点」一样: .remove/<当天 YYYYMMDD>/<画布名>, 同一天里移出多个就往后排 -2 / -3 …, 从不覆盖任何东西。 */
	async function removeRoot(payload) {
		const from = validateRoot(payload && payload.path);
		if (!from) return { ok: false, error: 'bad-path', message: '需要一个绝对路径(不能包含 ..)' };
		const parent = parentOfPath(from);
		if (parent === '') return { ok: false, error: 'bad-path', message: '不能移出磁盘根目录' };
		try {
			if (!(await dirExists(from))) return { ok: false, error: 'not-a-directory', root: from };
		} catch (error) {
			return { ok: false, error: 'stat-failed', message: error instanceof Error ? error.message : String(error) };
		}
		const name = from.replace(/\/+$/, '').split('/').pop() || 'canvas';
		const box = `${parent}/.remove`;
		/* 跟画布内的删除同一套: 先按当天日期开一个桶, 画布目录整个放进桶里 */
		const dir = bucketNameIn(box);
		const target = `${dir}/${name}`;
		if (await pathExists(target)) return { ok: false, error: 'remove-full', message: '备份目录里同名太多了' };
		try {
			await mkdirAt(dir, undefined, parent);
			renameSync(from, target);
		} catch (error) {
			return { ok: false, error: 'remove-failed', message: error instanceof Error ? error.message : String(error) };
		}
		caches.delete(from);
		caches.delete(target);
		/* 画布被移出列表: 号从这个库的号池里摘掉(计数器不回退), 但记进这个桶里 —— 想搬回来还能认回身份 */
		const removedUids = await dropUids(ctx, await uidLibOf({ ...baseConfig, root: from }), [from]);
		if (Object.keys(removedUids).length > 0) stashUids({ root: parent }, dir.slice(box.length + 1), removedUids);
		return { ok: true, root: target, from, name, box, bucket: dir.slice(box.length + 1), removed: true, uids: removedUids };
	}

	/* 笔记库目录下面的一级画布 = 直接子目录里带 notes/ 或 questions/ 的那些。
	 * dirs 是全部直接子目录(给导入弹窗当目录浏览器), canvas 标记它是否已经是画布。 */
	async function scanLibrary(root, signal) {
		const canvases = [];
		const dirs = [];
		let entries = [];
		try {
			const target = await ctx.fs.resolve(root, { signal });
			const info = await ctx.fs.stat(target, signal);
			if (!info || info.type !== 'directory') return { canvases, dirs, truncated: false };
			entries = await ctx.fs.listDir(target, signal);
		} catch {
			return { canvases, dirs, truncated: false };
		}
		let truncated = false;
		for (const entry of entries) {
			if (entry.type !== 'directory') continue;
			const name = entry.name;
			if (name === '' || name.startsWith('.') || LIBRARY_SKIP.has(name)) continue;
			if (dirs.length >= LIBRARY_MAX) {
				truncated = true;
				break;
			}
			const abs = `${root}/${name}`;
			const hasNotes = await pathExists(`${abs}/${config.noteDir}`, signal);
			const hasQuestions = await pathExists(`${abs}/${config.questionDir}`, signal);
			const canvas = hasNotes || hasQuestions;
			/* 画布名字就是目录名: 改名 = 重命名目录, 卡片直接显示目录名 */
			const item = { path: abs, name, canvas, hasNotes, hasQuestions };
			dirs.push(item);
			if (canvas) canvases.push(item);
		}
		const byName = (a, b) => a.name.localeCompare(b.name);
		canvases.sort(byName);
		dirs.sort(byName);
		return { canvases, dirs, truncated };
	}

	/* 导入一个笔记库目录: 建好 <库>/.templates(缺哪个内置模板补哪个) + 扫出它下面所有一级画布。
	 * 空目录也行(不存在就建出来); 库本身不会被当成画布(不在库里建 notes/questions)。 */
	async function importRoot(payload) {
		const root = validateRoot(payload && payload.path);
		if (!root) return { ok: false, error: 'bad-path', message: '需要一个绝对路径(不能包含 ..)' };
		try {
			if ((await pathExists(root)) && !(await dirExists(root))) return { ok: false, error: 'not-a-directory', root };
		} catch (error) {
			return { ok: false, error: 'stat-failed', root, message: error instanceof Error ? error.message : String(error) };
		}
		const existed = await pathExists(root);
		const created = [];
		const templates = [];
		/* 这个目录自己就是一张画布(有 notes/ 或 questions/): 直接当成一张画布, 磁盘上什么都不写、也不把它当库 */
		const selfNotes = await pathExists(`${root}/${config.noteDir}`);
		const selfQuestions = await pathExists(`${root}/${config.questionDir}`);
		if (selfNotes || selfQuestions) {
			const selfName = root.split('/').filter(Boolean).pop() || root;
			const selfLib = await uidLibOf({ ...baseConfig, root });
			/* 这张画布可能是从 .remove 桶里搬回来的: 先按路径把原来的号认回来, 再兜底发新号 */
			const selfStash = readAllStashedUids(parentOfPath(root));
			if (selfStash[root]) await adoptUids(ctx, selfLib, { [root]: selfStash[root] });
			const selfUid = (await ensureUids(ctx, selfLib, 'canvas', [root]))[root] || '';
			return {
				ok: true,
				root,
				existed,
				canvas: true,
				created: [],
				templates: [],
				canvases: [{ path: root, name: selfName, canvas: true, hasNotes: selfNotes, hasQuestions: selfQuestions, uid: selfUid }],
				truncated: false,
				name: selfName,
			};
		}
		try {
			await mkdirAt(root, undefined, parentOfPath(root));
			const shared = `${root}/.templates`;
			if (!(await pathExists(shared))) {
				await mkdirAt(shared, undefined, root);
				created.push('.templates');
			}
			for (const entry of TEMPLATE_FILES) {
				const abs = `${shared}/${entry.file}`;
				if (await pathExists(abs)) continue;
				await writeFileAt(abs, entry.markdown, undefined, shared);
				templates.push(`.templates/${entry.file}`);
			}
		} catch (error) {
			return { ok: false, error: 'import-failed', root, created, message: error instanceof Error ? error.message : String(error) };
		}
		const scan = await scanLibrary(root);
		/* 导入进来的画布: 第一次看到就登记好(一个库写一次配置), 老笔记不用迁移 */
		const importedUids = await ensureUids(ctx, root, 'canvas', scan.canvases.map((item) => item.path));
		for (const item of scan.canvases) {
			const uid = importedUids[item.path];
			if (uid) item.uid = uid;
		}
		return {
			ok: true,
			root,
			existed,
			created,
			templates,
			canvases: scan.canvases,
			truncated: scan.truncated,
			name: root.split('/').filter(Boolean).pop() || root,
		};
	}

	async function rootsHandler(req, res) {
		try {
			const method = (req.method || 'GET').toUpperCase();
			if (method === 'GET' || method === 'HEAD') {
				const url = new URL(String(req.url ?? '/'), 'http://localhost');
				const wanted = validateRoot(url.searchParams.get('path'));
				if (wanted) {
					const exists = await pathExists(wanted);
					const isDir = exists ? await dirExists(wanted) : false;
					const scan = isDir ? await scanLibrary(wanted) : { canvases: [], dirs: [], truncated: false };
					const isCanvas =
						exists &&
						((await pathExists(`${wanted}/${config.noteDir}`)) || (await pathExists(`${wanted}/${config.questionDir}`)));
					/* 画布列表带上号: 上一级目录就是学习库, 号池在库那一级 */
					if (scan.canvases.length > 0) {
						const canvasUids = await ensureUids(ctx, wanted, 'canvas', scan.canvases.map((item) => item.path));
						for (const item of scan.canvases) {
							const uid = canvasUids[item.path];
							if (uid) item.uid = uid;
						}
					}
					sendJson(res, 200, {
						ok: true,
						path: wanted,
						parent: parentOfPath(wanted),
						home: homeDir(),
						desktop: await desktopDir(),
						suggestParent: await suggestParent(),
						exists,
						isDir,
						isCanvas,
						hasTemplates: await pathExists(`${wanted}/.templates`),
						templateDir: `${wanted}/.templates`,
						canvases: scan.canvases,
						dirs: scan.dirs,
						truncated: scan.truncated,
						noteDir: config.noteDir,
						questionDir: config.questionDir,
					});
					return;
				}
				sendJson(res, 200, {
					ok: true,
					defaultRoot: baseConfig.root,
					suggestParent: await suggestParent(),
					home: homeDir(),
					desktop: await desktopDir(),
					noteDir: baseConfig.noteDir,
					questionDir: baseConfig.questionDir,
					templateDir: templateDirOf(baseConfig),
					sharedTemplateDir: await sharedTemplateDir(),
				});
				return;
			}
			if (method === 'POST') {
				const payload = await readBody(req, MAX_BODY_BYTES);
				const action = String(payload.action ?? '').trim();
				const result = action === 'rename' ? await renameRoot(payload) : action === 'remove' ? await removeRoot(payload) : action === 'import' ? await importRoot(payload) : await createRoot(payload);
				sendJson(res, result.ok ? 200 : 400, result);
				return;
			}
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			sendJson(res, 500, { error: 'rk-study-failed', message: error instanceof Error ? error.message : String(error) });
		}
	}

	/* 画布那一级的配置只留「视野 / 外观」两类键: zoom(这张画布的视野) 与 ui(字号…) */
	function canvasConfigPatch(body) {
		const keep = {};
		if (body && typeof body === 'object') {
			if (body.ui && typeof body.ui === 'object' && !Array.isArray(body.ui)) keep.ui = body.ui;
			if (body.zoom && typeof body.zoom === 'object' && !Array.isArray(body.zoom)) keep.zoom = body.zoom;
		}
		return keep;
	}

	/* 配置: 学习库那一份在 <库>/.config/rk-study.json(配色 / 画布列表 / 一级画布的视野),
	 * 画布自己那一份在 <画布>/.config/rk-study.json(它自己的视野 / 字号 —— 跟着画布走, 换机器 / 换浏览器照它恢复)。
	 * 移出列表(墓碑)跟号表一样住在同目录自己的文件里: <库>/.config/rk-study-removed.json,
	 * 客户端 POST 名单、GET 时跟配置一起返回(客户端那半只认 config.removed 这一个入口)。
	 * 客户端带 ?root=<绝对路径> 调它; 没带时退回插件自己的默认根目录(也就是默认学习库)。
	 * GET 读一份; POST 是「合并写」(深合并且不覆盖同层的其它键), 返回合并后的完整配置。 */
	async function configHandler(req, res) {
		try {
			const method = (req.method || 'GET').toUpperCase();
			const lib = config.root;
			if (method === 'GET' || method === 'HEAD') {
				const base = await readLibConfig(ctx, lib);
				/* 客户端靠这几个探针判断「这个根还在不在、是不是画布、像不像学习库」:
				 * 根被删掉(临时目录被清 / 移动硬盘拔了)时它好自愈, 别再把配置写进一个幽灵目录。 */
				sendJson(res, 200, {
					ok: true,
					root: lib,
					path: configPathOf(lib),
					exists: await pathExists(lib),
					isCanvas: await pathExists(`${lib}/${baseConfig.noteDir}`),
					hasConfig: await pathExists(configPathOf(lib)),
					hasTemplates: await pathExists(`${lib}/.templates`),
					config: { ...base, removed: await readRemovedStore(ctx, lib) },
				});
				return;
			}
			if (method === 'POST') {
				/* 目标根目录本身必须还在: 学习库被删 / 移动硬盘没挂上 / 临时目录被系统清掉之后,
				 * 客户端还拿着老路径往里写的话, writeLibConfig 会顺手 mkdirSync 把整条路径重建出来
				 * —— 幽灵库静默复活, 用户的视野与字号全落进一个早就没了的目录。这里直接挡掉。 */
				if (!(await pathExists(lib))) {
					sendJson(res, 400, { ok: false, error: 'no-such-root', root: lib, message: `目录不存在: ${lib}` });
					return;
				}
				/* 画布自己(里面有 notes/)也有自己那份配置, 但只收 ui / zoom —— canvases(画布清单) /
				 * removed(移出列表) / uid / seq 属于学习库那一级, 在画布上写会被丢掉(免得两张画布互相覆盖)。 */
				const selfCanvas = await pathExists(`${lib}/${baseConfig.noteDir}`);
				const patch = await readBody(req, MAX_BODY_BYTES);
				const body = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : {};
				const hasRemoved = Object.prototype.hasOwnProperty.call(body, 'removed');
				if (hasRemoved) delete body.removed;
				const merged = await writeLibConfig(ctx, lib, selfCanvas ? canvasConfigPatch(body) : body);
				merged.removed = hasRemoved ? await writeRemovedStore(ctx, lib, patch.removed) : await readRemovedStore(ctx, lib);
				sendJson(res, 200, {
					ok: true,
					root: lib,
					path: configPathOf(lib),
					bytes: await configBytesOf(ctx, lib),
					config: merged,
				});
				return;
			}
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			sendJson(res, 500, { error: 'rk-study-failed', message: error instanceof Error ? error.message : String(error) });
		}
	}

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'prefix',
				path: ASSET_ROUTE,
				handler: assetHandler,
			}),
		'rk-study: vendor assets',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: MEDIA_ROUTE,
				handler: withRoot(mediaHandler),
			}),
		'rk-study: image media',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'prefix',
				path: CLIENT_ROUTE,
				handler: clientHandler,
			}),
		'rk-study: client modules',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: GIT_ROUTE,
				handler: withRoot(gitHandler),
			}),
		'rk-study: git route',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: TEMPLATE_ROUTE,
				handler: withRoot(templatesHandler),
			}),
		'rk-study: template library',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: ROUTE,
				handler: withRoot(handler),
			}),
		'rk-study: notes route',
	);

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: ROOTS_ROUTE,
				handler: rootsHandler,
			}),
		'rk-study: roots route',
	);

	/* 插件级状态: 客户端把它 localStorage 里那四项(画布列表 / 学习库 / 上次停在哪张 / 移出列表)镜像到这里。
	 * 换浏览器、清了缓存、宿主换了端口之后再打开, 客户端先拿这份补齐 —— 「重启系统就得手动导入目录」就是
	 * 这么解掉的。文件刻意不放进任何画布目录(画布那级一个字节都不写), 而是放 DSH 自己的数据目录。 */
	async function stateHandler(req, res) {
		try {
			const method = (req.method || 'GET').toUpperCase();
			if (method === 'GET' || method === 'HEAD') {
				const text = await readFileText(STATE_FILE, undefined, TEMPLATE_MAX_BYTES);
				let state = {};
				try {
					const parsed = JSON.parse(String(text === null || text === undefined ? '' : text));
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
				} catch (problem) {
					state = {};
				}
				sendJson(res, 200, { ok: true, path: STATE_FILE, state });
				return;
			}
			if (method === 'POST') {
				const payload = await readBody(req, MAX_BODY_BYTES);
				const incoming = payload && typeof payload.state === 'object' && payload.state !== null ? payload.state : payload;
				const patch = {};
				if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
					if (Array.isArray(incoming.roots)) {
						patch.roots = incoming.roots
							.filter((item) => item && typeof item.path === 'string' && item.path.charAt(0) === '/')
							.map((item) => ({ path: item.path, name: String(item.name || '') }));
					}
					if (Array.isArray(incoming.removed)) {
						patch.removed = incoming.removed.filter((path) => typeof path === 'string' && path.charAt(0) === '/');
					}
					if (typeof incoming.defaultRoot === 'string') patch.defaultRoot = incoming.defaultRoot;
					/* activeRoot(上次停在哪张画布)不再持久化: 面板每次打开都从「全部画布」这一级开始。
					 * 这里显式忽略它, 写盘前再把老文件里那份删掉(见下面 delete next.activeRoot)。 */
				}
				const previousText = await readFileText(STATE_FILE, undefined, TEMPLATE_MAX_BYTES);
				let previous = {};
				try {
					const parsed = JSON.parse(String(previousText === null || previousText === undefined ? '' : previousText));
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed;
				} catch (problem) {
					previous = {};
				}
				const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
				delete next.activeRoot; /* 旧版存过「上次停在哪张画布」, 现在不读它了, 也不留在文件里 */
				await mkdirAt(STATE_DIR, undefined, parentOfPath(STATE_DIR));
				await writeFileAt(STATE_FILE, JSON.stringify(next, null, '\t') + '\n', undefined, STATE_DIR);
				sendJson(res, 200, { ok: true, path: STATE_FILE, keys: Object.keys(next) });
				return;
			}
			res.writeHead(405, { allow: 'GET, HEAD, POST', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify({ error: 'method-not-allowed', method }));
		} catch (error) {
			sendJson(res, 500, { error: 'rk-study-failed', message: error instanceof Error ? error.message : String(error) });
		}
	}
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: CONFIG_ROUTE,
				handler: withRoot(configHandler),
			}),
		'rk-study: library config',
	);
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: STATE_ROUTE,
				handler: stateHandler,
			}),
		'rk-study: plugin state',
	);

}

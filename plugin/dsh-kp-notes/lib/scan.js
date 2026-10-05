/* rk-study · host/scan —— 从 host.js 第 640-967 行原样切出 */
import { MARKDOWN_RE, MAX_BYTES_PER_FILE, MAX_FILES, MEDIA_DIR_SUFFIX, MEDIA_LEGACY_PARENT_DIR, MEDIA_PARENT_DIR } from './constants.js?v=81';
import { parseDocument } from './parse.js?v=81';
import { baseName, classifyFile, compareText, isQuestionStorePath, notePathFor, numericPrefix, parseFrontmatter, stripNumericPrefix } from './util.js?v=81';
import { uidFromText } from './uid.js?v=81';

/* ------------------------------------------------------------------ scan */

/* 文件时间戳已不再返回: ctx.fs 的观察只给 { version, type, size }(没有 mtime),
 * 而客户端从不读 updatedAt —— 与其再开一个 node:fs 后门, 不如去掉这个字段。 */

export async function scanWorkspace(ctx, config, signal) {
	const files = [];
	const dirs = [];
	const skipped = [];
	let truncated = false;

	/* 素材容器 <小节目录>/media/(老库的写法): 里面**只有** <小节uid>.assestfiles/ 这类目录(或它是空的)。
	 * 判据是「里面全是素材目录」而不是「名字叫 media」—— 用户自己建一个真叫 media 的章节不会被吞掉。
	 * 点开头的东西(.DS_Store —— Finder 一逛就写一个)不算数: 扫描本来就不看它们, 可它要是在 media/ 里
	 * 躺一个, 「里面全是素材目录」这条就不成立, 于是画布上会多出一张空空的 media 卡片.
	 * 现在这层目录改叫 `.media/`(点开头) —— 上面那句 name.startsWith('.') 就把它挡掉了, 这里这条判据
	 * 只剩「老库里还叫 media/ 的那一层」用得上。 */
	async function isMediaHome(target) {
		let names = [];
		try {
			names = await ctx.fs.listDir(target, signal);
		} catch {
			return false;
		}
		return names
			.filter((entry) => !String(entry.name).startsWith('.'))
			.every((entry) => (entry.type === 'directory' ? entry.name.endsWith(MEDIA_DIR_SUFFIX) : !MARKDOWN_RE.test(entry.name)));
	}

	async function walk(target, relPath, depth) {
		if (truncated || depth > config.maxDepth) {
			if (depth > config.maxDepth) truncated = true;
			return;
		}
		let entries;
		try {
			entries = await ctx.fs.listDir(target, signal);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (truncated) return;
			const name = entry.name;
			/* 图片素材目录(<小节uid>.assestfiles, 现在收在各目录的 .media/ 下面; 隐藏目录本来就在下面这行被跳过)
			 * 不进画布: 它跟小节文件同级/同层, 但不是一章 */
			if (name.startsWith('.') || config.exclude.includes(name) || name.endsWith(MEDIA_DIR_SUFFIX)) {
				skipped.push(relPath === '' ? name : `${relPath}/${name}`);
				continue;
			}
			const rel = relPath === '' ? name : `${relPath}/${name}`;
			if (entry.type === 'directory') {
				/* 老库那层 media/ 素材容器不进画布也不下去扫: 免得「一章 media」这种空壳卡片多出来
				 * (`.media/` 那层走不到这儿 —— 上面已经按「点开头」跳过了) */
				if ((name === MEDIA_PARENT_DIR || name === MEDIA_LEGACY_PARENT_DIR) && (await isMediaHome(entry.target))) {
					skipped.push(rel);
					continue;
				}
				/* 空目录也算一个章节: 新建章节只建目录, 不写文件 */
				if (depth >= 2 && !isQuestionStorePath(config, rel)) dirs.push(rel);
				await walk(entry.target, rel, depth + 1);
			} else if (entry.type === 'file' && MARKDOWN_RE.test(name)) {
				if ((entry.size ?? 0) > MAX_BYTES_PER_FILE) {
					skipped.push(`${rel} (too large)`);
					continue;
				}
				if (files.length >= MAX_FILES) {
					truncated = true;
					return;
				}
				files.push({ relPath: rel, name, size: entry.size ?? 0, target: entry.target });
			}
		}
	}

	const rootTarget = await ctx.fs.resolve(config.root, { signal });
	const rootInfo = await ctx.fs.stat(rootTarget, signal);
	if (!rootInfo) return { missing: true, files: [], dirs: [], skipped, truncated: false, rootTarget };

	await walk(rootTarget, '', 1);
	return { missing: false, files, dirs, skipped, truncated, rootTarget };
}

/** 章节名 = 目录名去掉序号前缀; 根目录用其中第一个小节的标题 */
export function chapterNameFor(dirRel, sections) {
	const segment = dirRel === '' ? '' : dirRel.split('/').filter(Boolean).pop();
	if (segment === '') {
		const first = (sections || [])[0];
		return first && first.title ? first.title : '根目录';
	}
	return stripNumericPrefix(segment) || segment;
}

/** 展示用标题: 目录带序号时补上「第 N 章 · 」 */
export function chapterTitleFor(dirRel, name) {
	const segment = dirRel === '' ? '' : dirRel.split('/').filter(Boolean).pop();
	const number = numericPrefix(segment);
	if (number === null) return name;
	return `第 ${number} 章 · ${name}`;
}

export async function buildCatalog(ctx, config, signal) {
	const scan = await scanWorkspace(ctx, config, signal);
	if (scan.missing) {
		return {
			root: config.root,
			generatedAt: new Date().toISOString(),
			missing: true,
			truncated: false,
			orphanQuestions: [],
			skipped: scan.skipped,
			stats: { chapters: 0, sections: 0, points: 0, examples: 0, words: 0, files: 0 },
			chapters: [],
		};
	}

	const byDir = new Map();
	const chapterByDir = new Map();
	let readFailures = 0;

	const toRecord = (entry, text, modeOverride) => {
		const lines = text.split(/\r?\n/);
		const { front } = parseFrontmatter(lines);
		const fileBase = baseName(entry.relPath);
		const classified = classifyFile(fileBase, front);
		const mode = modeOverride || classified.kind;
		const parsed = parseDocument(text, entry.relPath, front, mode);
		const record = {
			path: entry.relPath,
			file: fileBase,
			title: parsed.title,
			kind: mode,
			order: classified.order,
			tags: parsed.tags,
			bytes: entry.size,
			words: parsed.words,
			intro: parsed.intro,
			points: parsed.points,
			questions: parsed.questions,
			frontmatter: front,
			uid: uidFromText(text, mode),
			class: classified,
			parsed,
		};
		record.headings = record.points.length + record.questions.length;
		record.pointsCount = record.points.length;
		record.examplesCount =
			record.questions.length +
			record.points.reduce(
				(total, point) => total + point.examples.length + point.children.reduce((sum, child) => sum + child.examples.length, 0),
				0,
			);
		return record;
	};

	const questionRecords = [];
	for (const entry of scan.files) {
		let text = '';
		try {
			text = await ctx.fs.readText(entry.target, signal);
		} catch {
			readFailures += 1;
			continue;
		}
		/* 题目存储目录: 不是章节, 而是各知识点题目的存放处 */
		if (isQuestionStorePath(config, entry.relPath)) {
			questionRecords.push(toRecord(entry, text, 'question'));
			continue;
		}
		const dirRel = entry.relPath.includes('/') ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/')) : '';
		if (!byDir.has(dirRel)) byDir.set(dirRel, { sections: [], points: [], questions: [] });
		const bucket = byDir.get(dirRel);
		const record = toRecord(entry, text);
		if (record.kind === 'point') bucket.points.push(record);
		else if (record.kind === 'question') bucket.questions.push(record);
		else bucket.sections.push(record);
	}

	/* 每个知识点的题目(来自题目存储目录, 按镜像路径或 frontmatter point: 关联) */
	const questionStore = new Map();
	const unresolved = [];
	questionRecords.forEach((record) => {
		const explicit = record.frontmatter && typeof record.frontmatter.point === 'string' ? record.frontmatter.point.trim() : '';
		const noteRel = explicit !== '' ? explicit : notePathFor(config, record.path);
		if (!noteRel) {
			unresolved.push(record.path);
			return;
		}
		const items = record.parsed.questions.map((item) => ({ ...item, path: record.path }));
		const stored = questionStore.get(noteRel);
		if (stored) {
			stored.items = stored.items.concat(items);
			stored.words += record.words;
		} else {
			questionStore.set(noteRel, { record, items, words: record.words, path: record.path });
		}
	});

	/* 小节对象: 起于小节文件 (标题 + 导读), 再收集属于它的知识点 / 题目文件 */
	const toSection = (record) => ({
		path: record.path,
		file: record.file,
		uid: record.uid || '',
		title: record.title,
		kind: record.kind === 'section' ? 'section' : 'note',
		order: record.order,
		tags: record.tags,
		bytes: record.bytes,
		words: record.words,
		intro: record.intro,
		points: record.points.slice(),
		questions: record.questions.slice(),
		headings: record.headings,
		pointsCount: record.pointsCount,
		examplesCount: record.examplesCount,
		files: [record.path],
	});

	const byOrder = (a, b) => {
		const ao = a.order === null || a.order === undefined ? Number.MAX_SAFE_INTEGER : a.order;
		const bo = b.order === null || b.order === undefined ? Number.MAX_SAFE_INTEGER : b.order;
		if (ao !== bo) return ao - bo;
		return compareText(a.file, b.file);
	};

	/* 只有目录、还没有任何 markdown 的空章节也要出现在地图上 */
	for (const rel of scan.dirs) {
		if (!byDir.has(rel)) byDir.set(rel, { sections: [], points: [], questions: [] });
	}

	const chapters = [];
	for (const [dirRel, bucket] of byDir) {
		const sections = bucket.sections.slice().sort(byOrder).map(toSection);
		const index = new Map();
		sections.forEach((section, position) => {
			if (section.order !== null && section.order !== undefined && !index.has(section.order)) index.set(section.order, position);
		});
		const attach = (record) => {
			const wanted = record.class.number;
			if (wanted !== null && wanted !== undefined && index.has(wanted)) return sections[index.get(wanted)];
			const created = toSection(record);
			created.pseudo = true;
			sections.push(created);
			return created;
		};
		bucket.points.slice().sort(byOrder).forEach((record) => {
			const section = attach(record);
			const point = record.parsed.points[0];
			if (!point) return;
			/* 知识点文件自己的号(写在它 frontmatter 里的 uid)挂到这条知识点上 */
			if (record.uid && !point.uid) point.uid = record.uid;
			if (section.path !== record.path) {
				section.points.push(point);
				section.pointsCount += 1;
				section.examplesCount += record.examplesCount;
				section.words += record.words;
				section.files.push(record.path);
			}
			/* 这个知识点在题目存储目录里的题目文件 */
			const stored = questionStore.get(record.path);
			if (!stored) return;
			point.examples = point.examples.concat(stored.items);
			section.examplesCount += stored.items.length;
			section.words += stored.words;
			if (!section.files.includes(stored.path)) section.files.push(stored.path);
			questionStore.delete(record.path);
		});
		bucket.questions.slice().sort(byOrder).forEach((record) => {
			const section = attach(record);
			if (section.path === record.path) return;
			record.parsed.questions.forEach((question) => section.questions.push(question));
			section.examplesCount += record.parsed.questions.length;
			section.words += record.words;
			section.files.push(record.path);
		});
		sections.forEach((section) => {
			section.headings = section.pointsCount + section.questions.length;
		});
		const stats = {
			sections: sections.length,
			points: sections.reduce((total, section) => total + section.pointsCount, 0),
			examples: sections.reduce((total, section) => total + section.examplesCount, 0),
			words: sections.reduce((total, section) => total + section.words, 0),
		};
		const chapterName = chapterNameFor(dirRel, sections);
		chapters.push({
			id: dirRel === '' ? '~root' : dirRel,
			dir: dirRel,
			rel: dirRel === '' ? '' : `${dirRel}/`,
			name: chapterName,
			title: chapterTitleFor(dirRel, chapterName),
			number: numericPrefix(dirRel === '' ? '' : dirRel.split('/').filter(Boolean).pop()),
			breadcrumb: dirRel.split('/').filter(Boolean).slice(0, -1).join(' / '),
			tags: [],
			intro: '',
			sections,
			stats,
		});
		chapterByDir.set(dirRel, chapters[chapters.length - 1]);
	}

	/* 找不到对应知识点的题目文件: 挂到同名的章节目录下(仍然可见, 不静默丢失) */
	const orphanQuestions = unresolved.slice();
	for (const [noteRel, stored] of questionStore) {
		const slash = noteRel.lastIndexOf('/');
		const dirRel = slash > 0 ? noteRel.slice(0, slash) : '';
		const chapter = chapterByDir.get(dirRel);
		if (!chapter) {
			orphanQuestions.push(stored.path);
			continue;
		}
		const section = toSection(stored.record);
		section.pseudo = true;
		section.points = [];
		section.pointsCount = 0;
		section.questions = stored.items;
		section.headings = stored.items.length;
		section.examplesCount = stored.items.length;
		chapter.sections.push(section);
		chapter.stats.sections += 1;
		chapter.stats.examples += stored.items.length;
		chapter.stats.words += stored.words;
	}

	chapters.sort((a, b) => {
		if (a.dir === '') return 1;
		if (b.dir === '') return -1;
		return compareText(a.dir, b.dir);
	});
	chapters.forEach((chapter, index) => {
		chapter.index = index + 1;
	});

	return {
		root: config.root,
		generatedAt: new Date().toISOString(),
		missing: false,
		truncated: scan.truncated,
		readFailures,
		orphanQuestions: orphanQuestions.slice(0, 40),
		skipped: scan.skipped.slice(0, 40),
		stats: {
			chapters: chapters.length,
			sections: chapters.reduce((total, chapter) => total + chapter.stats.sections, 0),
			points: chapters.reduce((total, chapter) => total + chapter.stats.points, 0),
			examples: chapters.reduce((total, chapter) => total + chapter.stats.examples, 0),
			words: chapters.reduce((total, chapter) => total + chapter.stats.words, 0),
			files: scan.files.length,
		},
		chapters,
	};
}

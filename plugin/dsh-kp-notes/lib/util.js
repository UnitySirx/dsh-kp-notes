/* rk-study · host/util —— 从 host.js 第 66-248 行原样切出 */
import { DEFAULT_EXCLUDE, DEFAULT_NOTE_DIR, DEFAULT_QUESTION_DIR, FENCE_RE, HEADING_RE, MARKDOWN_RE, MAX_DEPTH, NUMERIC_PREFIX_RE, QUESTION_SEGMENT_RE, TYPE_POINT_RE, TYPE_QUESTION_RE, TYPE_SECTION_RE } from './constants.js?v=67';

/* ------------------------------------------------------------------ utils */

/**
 * 客户端传来的相对路径统一成仓库内的写法: 反斜杠转正斜杠、去掉首尾斜杠、去空白。
 * 只做字符串归一化; 是否允许写入由 safePath / safeDirPath 另判。
 * @param {unknown} value - 原始相对路径
 * @returns {string} 归一化后的相对路径('' 表示空)
 */
export function normalizeRelPath(value) {
	return String(value ?? '')
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.trim();
}

export function normalizeDirName(value, fallback) {
	const text = normalizeRelPath(value);
	return text === '' ? fallback : text;
}

/* 客户端可以带 ?root=<绝对路径> 指定这次请求用哪个学习画布(根目录)。
 * 只接受绝对路径: 必须 / 开头、不含 .. 段、长度有限, 归一化掉尾部斜杠与重复斜杠。 */
export function validateRoot(value) {
	const raw = String(value ?? '').trim();
	if (raw === '' || raw.length > 512) return null;
	if (raw.charAt(0) !== '/') return null;
	if (/[\u0000\n\r]/.test(raw)) return null;
	const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
	if (parts.some((part) => part === '..')) return null;
	return `/${parts.join('/')}`;
}

/* 没配 root 时的兜底 = DSH 进程的工作目录(也就是当前会话的工作区), 不再硬编码某台机器的路径。 */
function defaultRootOf() {
	const cwd = typeof process !== 'undefined' && process && typeof process.cwd === 'function' ? process.cwd() : '';
	return cwd === '' ? '/' : cwd;
}

export function normalizeConfig(raw) {
	const input = raw && typeof raw === 'object' ? raw : {};
	const rootRaw = typeof input.root === 'string' && input.root.trim() !== '' ? input.root.trim() : defaultRootOf();
	const exclude = Array.isArray(input.exclude)
		? input.exclude.map((value) => String(value).trim()).filter(Boolean)
		: DEFAULT_EXCLUDE;
	const maxDepth = Number.isFinite(Number(input.maxDepth)) ? Number(input.maxDepth) : MAX_DEPTH;
	const noteDir = normalizeDirName(input.noteDir, DEFAULT_NOTE_DIR);
	const questionDir = normalizeDirName(input.questionDir, DEFAULT_QUESTION_DIR);
	/* 「Git 提交」里让模型写 commit message 用的路由; 留空 = 自动挑第一个 provider 的第一个 model */
	const gitProvider = typeof input.gitProvider === 'string' ? input.gitProvider.trim() : '';
	const gitModel = typeof input.gitModel === 'string' ? input.gitModel.trim() : '';
	/* 编辑器模板库目录(留空 = 画布根目录下的隐藏文件夹 .templates) */
	const templateDir = typeof input.templateDir === 'string' ? input.templateDir.trim() : '';
	return { root: rootRaw.replace(/\/+$/, ''), exclude, maxDepth, noteDir, questionDir, gitProvider, gitModel, templateDir };
}

/* 编辑器工具栏两个菜单读的模板库目录。
 * 默认放在**画布根目录**下的隐藏文件夹 .templates: 扫描器跳过 "." 开头的目录, 所以它不会变成画布上的一张卡,
 * 也不跟笔记混在一起, 用户能在编辑器里直接改。
 * 老画布把模板放在笔记目录下(notes/.templates): 那边有货时 routes.js 会继续用它, 不强迫迁移。 */
export function templateDirOf(config) {
	const custom = String(config.templateDir ?? '').replace(/^\/+/, '').trim();
	if (custom !== '') return custom;
	return '.templates';
}

/* 老位置: 笔记目录下的 .templates。画布根目录那一份不存在、这一份存在时兜底使用(向后兼容)。 */
export function legacyTemplateDirOf(config) {
	return `${String(config.noteDir ?? 'notes').replace(/\/+$/, '')}/.templates`;
}

/* 某个模板库文件在仓库里的相对路径; file 为空时返回目录本身。 */
export function templatePath(config, file) {
	const name = String(file ?? '').replace(/^\/+/, '').trim();
	const dir = templateDirOf(config);
	return name === '' ? dir : `${dir}/${name}`;
}

/* 「笔记库」级共享模板目录 = 画布的父目录下的 .templates。
 * 导入一个库目录时会在那里建好并写入内置模板, 库里的画布共用这一份, 各自 notes/.templates 可以没有。
 * 顶层画布(父目录是 / 或者路径不合法)没有库 => 返回 ''。 */
export function sharedTemplateDirOf(config) {
	const root = String(config.root ?? '').replace(/\/+$/, '');
	const cut = root.lastIndexOf('/');
	if (cut <= 0) return '';
	return `${root.slice(0, cut)}/.templates`;
}

/* 这个画布是不是「学习库里的子画布」= 父目录下还有别的画布(带 notes/ 或 questions/ 的兄弟目录)。
 * 是的话返回库目录(父目录): 模板统一放它下面的 .templates, 这个画布自己不该有 .templates;
 * 自带根目录的画布(父目录里没有别的画布)返回 ''。
 * 目的: 只有「像 WorkNotes 那样的根目录」才有 .templates, 子目录(如 系统架构师)不再各存一份。 */
export async function libraryDirOf(ctx, config, signal) {
	const root = String(config.root ?? '').replace(/\/+$/, '');
	const cut = root.lastIndexOf('/');
	if (cut <= 0) return '';
	const parent = root.slice(0, cut);
	const noteDir = String(config.noteDir ?? 'notes');
	const questionDir = String(config.questionDir ?? 'questions');
	try {
		const parentTarget = await ctx.fs.resolve(parent, signal ? { signal } : undefined);
		for (const entry of await ctx.fs.listDir(parentTarget, signal)) {
			if (entry.type !== 'directory' || entry.name.startsWith('.')) continue;
			const sibling = `${parent}/${entry.name}`;
			if (sibling === root) continue;
			try {
				const note = await ctx.fs.stat(await ctx.fs.resolve(`${sibling}/${noteDir}`, signal ? { signal } : undefined), signal);
				if (note && note.type === 'directory') return parent;
				const question = await ctx.fs.stat(await ctx.fs.resolve(`${sibling}/${questionDir}`, signal ? { signal } : undefined), signal);
				if (question && question.type === 'directory') return parent;
			} catch {
				/* 这个兄弟不是画布 */
			}
		}
	} catch {
		/* 父目录读不了就算了 */
	}
	return '';
}

/*
 * 知识点的题目文件 = 笔记文件在 questionDir 下的镜像路径:
 *   notes/01-架构设计基础/01-01-五大类架构风格.md
 *   → questions/01-架构设计基础/01-01-五大类架构风格.md
 */
export function questionPathFor(config, noteRel) {
	const clean = String(noteRel ?? '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.trim();
	const prefix = `${config.noteDir}/`;
	if (!clean.startsWith(prefix) || !MARKDOWN_RE.test(clean)) return null;
	const rest = clean.slice(prefix.length);
	if (rest === '' || rest.split('/').includes('..')) return null;
	return `${config.questionDir}/${rest}`;
}

export function notePathFor(config, questionRel) {
	const clean = String(questionRel ?? '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.trim();
	const prefix = `${config.questionDir}/`;
	if (!clean.startsWith(prefix) || !MARKDOWN_RE.test(clean)) return null;
	const rest = clean.slice(prefix.length);
	if (rest === '' || rest.split('/').includes('..')) return null;
	return `${config.noteDir}/${rest}`;
}

/** 这个路径是否位于题目存储目录(questionDir)下 */
export function isQuestionStorePath(config, relPath) {
	const clean = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
	return clean === config.questionDir || clean.startsWith(`${config.questionDir}/`);
}

/** 笔记文件相对路径守卫: 必须位于 noteDir 下且是 markdown */
export function noteStorePath(config, relPath) {
	const clean = String(relPath ?? '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.trim();
	const prefix = `${config.noteDir}/`;
	if (!clean.startsWith(prefix) || !MARKDOWN_RE.test(clean)) return null;
	if (clean.split('/').includes('..')) return null;
	return clean;
}

export function stripInline(text) {
	return String(text ?? '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/g, '$1')
		.replace(/[*_]([^*_]+)[*_]/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

export function cleanTitle(text) {
	return stripInline(String(text ?? '').replace(/\s*#+\s*$/, '')).trim();
}

export function countWords(text) {
	const plain = stripInline(text).replace(/\s+/g, '');
	return plain.length;
}

export function baseName(relPath) {
	const file = relPath.slice(relPath.lastIndexOf('/') + 1);
	return file.replace(MARKDOWN_RE, '');
}

export function stripNumericPrefix(text) {
	const match = NUMERIC_PREFIX_RE.exec(String(text ?? '').trim());
	if (!match) return String(text ?? '').trim();
	return match[2].trim() !== '' ? match[2].trim() : match[1];
}

export function numericPrefix(text) {
	const match = NUMERIC_PREFIX_RE.exec(String(text ?? '').trim());
	return match ? Number(match[1]) : null;
}

export function compareText(a, b) {
	return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/*
 * 一个章节目录里, 每个单位是一个文件, 文件名决定它是哪一种:
 *   01-标题.md            小节      (只放标题 + 导读)
 *   01-01-标题.md         知识点    (第 1 个小节下的第 1 个知识点)
 *   01-例题-标题.md        题目      (第 1 个小节下的题目, 一个文件可以放多道题)
 * 章节本身 = 一个目录, 章节名就是目录名 (可直接改名), 不再有「章节说明」文件。
 * 序号规则之外, 还可以用 frontmatter `type: point|question|section` 显式声明。
 */
export function classifyFile(base, front) {
	const raw = String(base ?? '').trim();
	const rest = stripNumericPrefix(raw);
	const number = numericPrefix(raw); // 小节序号
	const order = numericPrefix(rest); // 小节内的知识点 / 题目序号
	const type = String((front && (front.type ?? front.kind)) ?? '').trim().toLowerCase();
	if (TYPE_QUESTION_RE.test(type)) return { kind: 'question', number, order };
	if (TYPE_POINT_RE.test(type)) return { kind: 'point', number, order };
	if (TYPE_SECTION_RE.test(type)) return { kind: 'section', number, order: number === null ? order : number };
	const segments = rest.split(/[-_.、\s:：]+/).filter(Boolean);
	if (segments.some((segment) => QUESTION_SEGMENT_RE.test(segment))) return { kind: 'question', number, order };
	if (order !== null) return { kind: 'point', number, order };
	return { kind: 'section', number, order: number };
}

export function parseFrontmatter(lines) {
	const front = {};
	let index = 0;
	if (lines.length === 0 || lines[0].trim() !== '---') return { front, start: 0 };
	index = 1;
	while (index < lines.length && lines[index].trim() !== '---') {
		const line = lines[index];
		const match = /^([A-Za-z0-9_-]+)\s*[:：]\s*(.*)$/.exec(line);
		if (match) {
			const key = match[1].toLowerCase();
			let value = match[2].trim();
			if (value.startsWith('[') && value.endsWith(']')) {
				front[key] = value
					.slice(1, -1)
					.split(',')
					.map((item) => stripInline(item.replace(/^["']|["']$/g, '')))
					.filter(Boolean);
			} else {
				front[key] = stripInline(value.replace(/^["']|["']$/g, ''));
			}
		}
		index += 1;
	}
	return { front, start: index + 1 };
}

export function collectTags(front, relPath, bodyText) {
	const tags = [];
	const push = (value) => {
		const text = stripInline(value);
		if (text !== '' && text.length <= 24 && !tags.includes(text) && tags.length < 10) tags.push(text);
	};
	const declared = front.tags ?? front.tag ?? front.category ?? front.categories;
	if (Array.isArray(declared)) declared.forEach(push);
	else if (typeof declared === 'string' && declared !== '') declared.split(/[,，、\s]+/).forEach(push);
	const dirs = relPath.split('/').slice(0, -1).filter(Boolean);
	dirs.forEach((dir) => push(stripNumericPrefix(dir)));
	const inline = [];
	let fence = false;
	for (const line of String(bodyText ?? '').split(/\r?\n/)) {
		if (FENCE_RE.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence || HEADING_RE.test(line)) continue;
		const hits = line.match(/(?:^|\s)#([\u4e00-\u9fa5A-Za-z0-9_-]{2,20})/g) ?? [];
		hits.forEach((hit) => inline.push(hit.trim().slice(1)));
	}
	inline.slice(0, 6).forEach(push);
	return tags;
}

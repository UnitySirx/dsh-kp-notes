/* rk-study · host/parse —— 从 host.js 第 403-638 行原样切出 */
import { FENCE_RE, MAX_POINT_CHARS, QUESTION_PATH_RE } from './constants.js?v=52';
import { buildNodes, isAnswerTitle, nodeMarkdown, scanHeadings, splitAnswer, splitAnswerBlock, summarize, subtreeEnd, takeOptions } from './headings.js?v=52';
import { questionBlockNodes, removeQuestionBlock } from './questions.js?v=52';
import { baseName, classifyFile, collectTags, countWords, numericPrefix, parseFrontmatter, stripInline, stripNumericPrefix } from './util.js?v=52';

/* --------------------------------------------------------------- parsing */

export function toItem(node, lines, id) {
	const answerChild = node.children.find((child) => isAnswerTitle(child.title));
	let stemLines;
	let answerLines;
	if (answerChild) {
		stemLines = node.bodyLines;
		answerLines = [`**${answerChild.title}**`, nodeMarkdown(answerChild, lines)];
	} else {
		/* 题目下面自带「### 问题」这类子标题时, 题干与答案要连着子标题一起看 */
		const body = node.children.length > 0 ? nodeMarkdown(node, lines).split('\n') : node.bodyLines;
		const split = splitAnswer(body);
		stemLines = split.stem;
		answerLines = split.answer;
	}
	const withOptions = takeOptions(stemLines);
	const answer = answerLines.join('\n').trim();
	const parsedAnswer = splitAnswerBlock(answer);
	return {
		id,
		title: node.title,
		label: stripInline(node.title),
		stem: withOptions.stem.join('\n').trim(),
		options: withOptions.options,
		answer,
		answerKey: parsedAnswer.answerKey,
		answerText: parsedAnswer.answerText,
		explanation: parsedAnswer.explanation,
		summary: summarize(stemLines),
	};
}

export function tableText(line) {
	const cells = line
		.replace(/^\s*\|/, '')
		.replace(/\|\s*$/, '')
		.split('|')
		.map((cell) => stripInline(cell.trim()))
		.filter((cell) => cell !== '' && !/^:?-{2,}:?$/.test(cell));
	return cells.join(' · ');
}

/** Plain-text excerpt for a point whose body is mostly tables (summarize returns nothing there). */
export function plainExcerpt(markdown, limit) {
	const out = [];
	for (const raw of String(markdown ?? '').split(/\r?\n/)) {
		const line = raw.trim();
		if (line === '' || FENCE_RE.test(line)) continue;
		if (/^[\s|:-]+$/.test(line)) continue;
		if (/^\|/.test(line)) {
			const text = tableText(line);
			if (text !== '') out.push(text);
		} else {
			const text = stripInline(line.replace(/^\s*(?:[-*+]\s+|\d+[.、)]\s+|>\s*)/, ''));
			if (text !== '') out.push(text);
		}
		if (out.join(' ').length >= limit) break;
	}
	return out.join(' ').slice(0, limit);
}

/* 一个知识点 = 一个文件 / 一个顶层标题; 正文里出现的任何标题(`##`、`###`、`####` …)
 * 都留在知识点正文里按普通 markdown 渲染, 不再拆出「子知识点」。
 * 题目只认 questions/ 目录下的文件(以及知识点上手动添加的题目)。 */
export function toPoint(node, lines, id) {
	const bodyEnd = node.children.length > 0 ? subtreeEnd(node.children[node.children.length - 1]) : node.end;
	const body = lines.slice(node.line + 1, bodyEnd).join('\n').trim();
	const bodyText = body.length > MAX_POINT_CHARS ? body.slice(0, MAX_POINT_CHARS) : body;
	return {
		id,
		title: node.title,
		level: node.level,
		summary: summarize(node.bodyLines) || plainExcerpt(bodyText, 160),
		body: bodyText,
		truncated: body.length > MAX_POINT_CHARS,
		examples: [],
		children: [],
	};
}

export function parseDocument(markdown, relPath, front, modeOverride) {
	const lines = markdown.split(/\r?\n/);
	const { start } = parseFrontmatter(lines);
	const marks = scanHeadings(lines, start);
	const roots = buildNodes(lines, marks, lines.length);
	const basename = baseName(relPath);
	const declaredTitle = typeof front.title === 'string' ? front.title.trim() : '';
	const classified = classifyFile(basename, front);
	const mode = modeOverride || classified.kind;

	let top = roots;
	if (top.length === 1 && top[0].level === 1) top = top[0].children;
	else top = top.filter((node) => node.level > 1);
	const headingRoot = roots.find((node) => node.level === 1);
	const fallbackTitle = stripNumericPrefix(stripNumericPrefix(basename));
	const title = declaredTitle !== '' ? declaredTitle : headingRoot?.title ?? fallbackTitle;

	const introEnd = marks.length > 0 ? marks[0].line : lines.length;
	const introLead = lines.slice(start, introEnd).join('\n').trim();
	const introOwn = headingRoot ? headingRoot.bodyLines.join('\n').trim() : '';
	const intro = [introLead, introOwn].filter(Boolean).join('\n\n');

	const points = [];
	const questions = [];

	if (mode === 'point') {
		/* 知识点文件: 整个文件就是一张知识点卡片 */
		const id = `point:${relPath}`;
		let point;
		if (headingRoot) {
			point = toPoint(headingRoot, lines, id);
		} else {
			/* 没有一级标题: 整个文件就是这一张知识点卡片, 里面的标题都留在正文里 */
			const whole = lines.slice(start, lines.length).join('\n').trim();
			point = {
				id,
				title,
				level: 1,
				summary: stripInline(intro).slice(0, 160),
				body: whole.length > MAX_POINT_CHARS ? whole.slice(0, MAX_POINT_CHARS) : whole,
				truncated: whole.length > MAX_POINT_CHARS,
				examples: [],
				children: [],
			};
		}
		point.id = id;
		point.path = relPath;
		point.title = title;
		point.level = 1;
		point.order = classified.order;
		point.kind = 'point';
		/* 顶层例题/题目按文件内的次序编号, 便于按题删除 */
		point.examples.forEach((example, index) => {
			example.order = index + 1;
			example.path = relPath;
		});
		point.children.forEach((child) => {
			(child.examples || []).forEach((example) => {
				example.path = example.path || relPath;
			});
		});
		points.push(point);
	} else if (mode === 'question') {
		/* 题目文件: 一个文件可以放多道题, 每道题一个 `## 题目 N` 标题。
		   这里必须和 removeQuestionBlock 用同一个口径(questionBlockNodes): 显示与删除一致,
		   否则会出现「界面上有这道题、删的时候 question-not-found」的幽灵题。 */
		questionBlockNodes(markdown).blocks.forEach((node, index) => {
			const item = toItem(node, lines, `question:${relPath}#${index + 1}`);
			item.path = relPath;
			item.order = index + 1;
			questions.push(item);
		});
	} else {
		/* 小节 / 章节说明文件: 文件本身的每个顶层标题都是一张行内知识点卡片,
		   标题下面的内容(含更深的标题)都留在这张卡片里 */
		top.forEach((node, index) => {
			const point = toPoint(node, lines, `${relPath}#${index + 1}`);
			/* 行内知识点也属于这个文件, 少了 path 界面上的编辑/删除按钮就没有落点 */
			point.path = relPath;
			point.kind = 'point';
			points.push(point);
		});

		if (points.length === 0 && intro !== '' && mode !== 'section') {
			/* 整个文件就是一条知识点(没有 `## 标题`) —— 也要带上 path, 否则界面上的编辑/删除会失效 */
			points.push({
				id: `${relPath}#1`,
				path: relPath,
				kind: 'point',
				order: 1,
				title,
				level: 2,
				summary: stripInline(intro).slice(0, 160),
				body: intro,
				truncated: false,
				examples: [],
				children: [],
			});
		}
	}

	/* 行内知识点/例题统一补 path: 少了它, 界面上的「编辑」「删除本文件」就没有落点 */
	const stampPath = (items) => {
		items.forEach((item) => {
			if (!item.path) item.path = relPath;
			(item.examples || []).forEach((example) => {
				if (!example.path) example.path = relPath;
			});
			stampPath(item.children || []);
		});
	};
	stampPath(points.concat(questions));

	const words = countWords(markdown);
	const kindFromFront = String(front.type ?? front.kind ?? '').toLowerCase();
	const isQuestionDoc =
		mode === 'question' ||
		/题|exam|quiz|question/.test(kindFromFront) ||
		(questions.length > 0 && points.length === 0) ||
		(points.length === 0 && QUESTION_PATH_RE.test(relPath));
	const orderRaw = front.order ?? front.seq ?? front.rank;
	const order = Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : classified.order ?? numericPrefix(basename);

	return {
		title,
		kind: isQuestionDoc ? 'question' : 'note',
		class: mode,
		number: classified.number,
		order,
		tags: collectTags(front, relPath, markdown),
		intro,
		words,
		points,
		questions,
		frontmatter: front,
	};
}

/* rk-study · host/headings —— 从 host.js 第 250-401 行原样切出 */
import { ANSWER_LINE_RE, ANSWER_TITLE_RE, EXAMPLE_TITLE_RE, FENCE_RE, HEADING_RE, OPTION_RE } from './constants.js?v=86';
import { cleanTitle, stripInline } from './util.js?v=86';

/* -------------------------------------------------------------- headings */

export function scanHeadings(lines, start) {
	const marks = [];
	let fence = false;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];
		if (FENCE_RE.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const match = HEADING_RE.exec(line);
		if (match) marks.push({ level: match[1].length, text: cleanTitle(match[2]), line: index });
	}
	return marks;
}

export function buildNodes(lines, marks, endLine) {
	const roots = [];
	const stack = [];
	for (let index = 0; index < marks.length; index += 1) {
		const mark = marks[index];
		const next = marks[index + 1];
		const node = {
			level: mark.level,
			title: mark.text,
			line: mark.line,
			end: next ? next.line : endLine,
			bodyLines: lines.slice(mark.line + 1, next ? next.line : endLine),
			children: [],
		};
		while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
		if (stack.length > 0) stack[stack.length - 1].children.push(node);
		else roots.push(node);
		stack.push(node);
	}
	return roots;
}

export function subtreeEnd(node) {
	if (node.children.length === 0) return node.end;
	return subtreeEnd(node.children[node.children.length - 1]);
}

export function nodeMarkdown(node, lines) {
	const from = node.line + 1;
	const to = node.children.length > 0 ? subtreeEnd(node) : node.end;
	return lines.slice(from, to).join('\n').trim();
}

export function isExampleTitle(title) {
	const text = String(title ?? '').trim();
	if (text === '') return false;
	if (/^例\s*[0-9一二三四五六七八九十]/.test(text)) return true;
	if (/^q\s*[0-9]/i.test(text)) return true;
	return EXAMPLE_TITLE_RE.test(text);
}

export function isAnswerTitle(title) {
	return ANSWER_TITLE_RE.test(cleanTitle(title));
}

/**
 * 严格的「这行标题本身是一道题」判定: `题目 1` / `例题 2` / `例3` / `选择题 1` 算;
 * 「架构风格 · 题目」「111111 · 题目」这种文件大标题不算 —— 否则文件标题会被当成第一道题。
 * 别要求整串匹配: `题目 1：管道-过滤器` 这种带小标题的也要算。
 */
export const QUESTION_HEADING_RE = /^(?:题目|例题|例|练习|案例(?:分析)?|真题|试题|习题|问答题|简答题|选择题|论文题)(?:\s*[0-9]+|\s*[一二三四五六七八九十]+|\s*[.、,:：)）]|\s+\S|\s*$)/;

export function isQuestionHeading(title) {
	return QUESTION_HEADING_RE.test(cleanTitle(title));
}

export function hasAnswerLine(lines) {
	let fence = false;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		if (ANSWER_LINE_RE.test(line)) return true;
	}
	return false;
}

export function splitAnswer(lines) {
	let fence = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (FENCE_RE.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		if (ANSWER_LINE_RE.test(line)) return { stem: lines.slice(0, index), answer: lines.slice(index) };
	}
	return { stem: lines, answer: [] };
}

/** 把答案块的 markdown 拆成 { 答案字母, 答案正文, 解析 } —— 供表单回填 */
export function splitAnswerBlock(answer) {
	const raw = String(answer ?? '').trim();
	if (raw === '') return { answerKey: '', answerText: '', explanation: '' };
	let answerKey = '';
	let body = raw;
	const key = /^\*\*\s*(?:答案|参考答案|answer)\s*\*\*\s*[：:][ \t]*([^\n]*)/i.exec(raw);
	if (key) {
		answerKey = key[1].trim();
		body = raw.slice(key[0].length).replace(/^[ \t]*\n/, '').trim();
	}
	let explanation = '';
	const explain = /^\*\*\s*(?:解析|说明|explanation)\s*\*\*\s*[：:]/im.exec(body);
	if (explain) {
		const tail = body.slice(explain.index);
		const marker = /^\*\*\s*(?:解析|说明|explanation)\s*\*\*\s*[：:]\s*/i.exec(tail);
		explanation = tail.slice(marker ? marker[0].length : 0).trim();
		body = body.slice(0, explain.index).trim();
	}
	return { answerKey, answerText: body, explanation };
}

export function takeOptions(lines) {
	const options = [];
	let start = -1;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line.trim() === '') {
			if (options.length === 0) continue;
			break;
		}
		const match = OPTION_RE.exec(line);
		if (!match) break;
		options.unshift({ key: match[1].toUpperCase(), text: stripInline(match[2]) });
		start = index;
	}
	if (options.length < 2) return { stem: lines, options: [] };
	const head = lines.slice(0, start).join('\n').trim();
	return { stem: head.split('\n'), options };
}

export function summarize(lines) {
	for (const raw of lines) {
		const line = raw.trim();
		if (line === '' || HEADING_RE.test(line) || FENCE_RE.test(line)) continue;
		if (/^\|/.test(line) || /^[-*+|:\s]+$/.test(line)) continue;
		const text = stripInline(line.replace(/^\s*(?:[-*+]\s+|\d+[.、)]\s+|>\s*)/, ''));
		if (text !== '') return text.slice(0, 160);
	}
	return '';
}

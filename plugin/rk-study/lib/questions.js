/* rk-study · host/questions —— 从 host.js 第 1185-1252 行原样切出 */
import { buildNodes, hasAnswerLine, isQuestionHeading, scanHeadings } from './headings.js?v=48';
import { parseFrontmatter, stripInline } from './util.js?v=48';

export function questionBlockNodes(markdown) {
	const lines = String(markdown ?? '').split(/\r?\n/);
	const { start } = parseFrontmatter(lines);
	const marks = scanHeadings(lines, start);
	const roots = buildNodes(lines, marks, lines.length);
	const blocks = [];
	/* 题目块可以出现在任何层级(## / ### / 甚至 `# 题目 1`), 只要标题本身是一道题;
	   文件自己的大标题(如「架构风格 · 题目」)不算块, 但它下面的标题要继续找。
	   没有标题、只有答案行的朴素写法按「叶子节点」兜底当成一块。 */
	const visit = (node) => {
		if (isQuestionHeading(node.title) || (node.children.length === 0 && hasAnswerLine(node.bodyLines))) {
			blocks.push(node);
			return;
		}
		node.children.forEach(visit);
	};
	roots.forEach(visit);
	blocks.sort((a, b) => a.line - b.line);
	const ranges = blocks.map((node, index) => ({
		from: node.line,
		to: index + 1 < blocks.length ? blocks[index + 1].line : lines.length,
	}));
	return { lines, blocks, ranges };
}

export function removeQuestionBlock(markdown, order) {
	const { lines, blocks, ranges } = questionBlockNodes(markdown);
	if (blocks.length === 0) return null;
	const index = Number.isFinite(order) ? Math.max(0, Math.round(order) - 1) : -1;
	if (index < 0 || index >= blocks.length) return null;
	const range = ranges[index];
	const kept = lines.slice(0, range.from).concat(lines.slice(range.to));
	while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
	if (range.from > 0 && kept.length > 0 && kept[kept.length - 1].trim() !== '') kept.push('');
	return {
		markdown: kept.join('\n'),
		title: stripInline(blocks[index].title),
		/* 被删掉的那一段原文: 调用方会把它另存到画布的 .remove/ 里 */
		removed: lines.slice(range.from, range.to).join('\n').trim(),
		remaining: blocks.length - 1,
	};
}

/** 写回一道题: order 有值且落在范围内 = 替换那一块, 否则追加到文件末尾 */
export function saveQuestionBlock(markdown, order, blockText) {
	const { lines, ranges } = questionBlockNodes(markdown);
	const text = String(blockText ?? '');
	const index = Number.isFinite(order) ? Math.round(order) - 1 : -1;
	let next;
	if (index >= 0 && index < ranges.length) {
		next = lines.slice(0, ranges[index].from).concat(text.split('\n'), lines.slice(ranges[index].to));
	} else {
		next = lines.slice();
		while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
		if (next.length > 0) next.push('');
		next.push(...text.split('\n'));
	}
	return renumberQuestionBlocks(next.join('\n'));
}

/** 统一把每个题目块的标题重排成 `## 题目 1..N`(手改/删除造成的编号漂移顺手修掉) */
export function renumberQuestionBlocks(markdown) {
	const { lines, ranges } = questionBlockNodes(markdown);
	const out = lines.slice();
	for (let index = 0; index < ranges.length; index += 1) {
		const at = ranges[index].from;
		if (/^##\s+/.test(out[at] || '')) out[at] = `## 题目 ${index + 1}`;
	}
	return out.join('\n');
}

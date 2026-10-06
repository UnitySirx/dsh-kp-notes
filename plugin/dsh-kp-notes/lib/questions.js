/* rk-study · host/questions —— 从 host.js 第 1185-1252 行原样切出 */
import { buildNodes, hasAnswerLine, isQuestionHeading, scanHeadings } from './headings.js?v=91';
import { parseFrontmatter, stripInline } from './util.js?v=91';

/* 题目块的身份号: 单独一行挂在标题下面, 形如 `<!-- rk-uid: q0001 -->`。
   为什么单独一行 —— renumberQuestionBlocks 会重写标题行(`## 题目 N`), 号放标题行里会被冲掉;
   注释在渲染出来的笔记里不显示, 对阅读没影响。 */
const BLOCK_UID_RE = /^\s*<!--\s*rk-uid:\s*([chspq]\d{4,9})\s*-->\s*$/;

/** 从一段块文本里读出号(读不到返回 '') */
export function blockUidOf(text) {
	for (const line of String(text ?? '').split(/\r?\n/)) {
		const matched = BLOCK_UID_RE.exec(line);
		if (matched) return matched[1];
	}
	return '';
}

/** 先把块文本里原有的标记行摘干净, 再把号挂到标题行的下一行(没有标题就挂最前面) */
export function withBlockUid(text, uid) {
	const kept = String(text ?? '').split(/\r?\n/).filter((line) => !BLOCK_UID_RE.test(line));
	if (!/^[chspq]\d{4,9}$/.test(String(uid || ''))) return kept.join('\n');
	const marker = `<!-- rk-uid: ${uid} -->`;
	const at = kept.findIndex((line) => /^#{1,6}\s+/.test(line));
	if (at < 0) return [marker].concat(kept).join('\n');
	return kept.slice(0, at + 1).concat([marker], kept.slice(at + 1)).join('\n');
}

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
	/* 每道题自己的号: 就在它那段行里找标记 */
	const uids = blocks.map((node, index) => blockUidOf(lines.slice(node.line, ranges[index].to).join('\n')));
	return { lines, blocks, ranges, uids };
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
		/* 这道题被带走的号(删除片段里也留着标记, 想恢复还能认回来) */
		uid: blockUidOf(lines.slice(range.from, range.to).join('\n')),
		/* 被删掉的那一段原文: 调用方会把它另存到画布的 .remove/ 里 */
		removed: lines.slice(range.from, range.to).join('\n').trim(),
		remaining: blocks.length - 1,
	};
}

/** 写回一道题: order 有值且落在范围内 = 替换那一块, 否则追加到文件末尾。
 * 号取「调用方给的 → 被替换那一块原有的 → 块文本里带的」, 都没有就不挂(调用方另发)。 */
export function saveQuestionBlock(markdown, order, blockText, uid) {
	const { lines, ranges, uids } = questionBlockNodes(markdown);
	const text = String(blockText ?? '');
	const index = Number.isFinite(order) ? Math.round(order) - 1 : -1;
	const kept = String(uid || (index >= 0 && index < uids.length ? uids[index] : '') || blockUidOf(text));
	const marked = withBlockUid(text, kept);
	let next;
	if (index >= 0 && index < ranges.length) {
		next = lines.slice(0, ranges[index].from).concat(marked.split('\n'), lines.slice(ranges[index].to));
	} else {
		next = lines.slice();
		while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
		if (next.length > 0) next.push('');
		next.push(...marked.split('\n'));
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

/* rk-study · host/points —— 从 host.js 第 1254-1366 行原样切出 */
import { buildNodes, isQuestionHeading, scanHeadings, subtreeEnd } from './headings.js?v=90';
import { sanitizeName } from './templates.js?v=90';
import { baseName, cleanTitle, parseFrontmatter, stripInline, stripNumericPrefix } from './util.js?v=90';

/* ------------------------------------------------ knowledge point regions */
export function splitTagsValue(value) {
	if (Array.isArray(value)) return value.map((item) => stripInline(String(item))).filter(Boolean);
	const text = String(value ?? '').trim();
	if (text === '') return [];
	return text
		.split(/[,，、]+/)
		.map((item) => stripInline(item))
		.filter(Boolean);
}

export function findPointNode(roots, wanted) {
	let hit = null;
	const visit = (node) => {
		if (hit) return;
		if (node.level >= 2 && !isQuestionHeading(node.title) && cleanTitle(node.title) === wanted) {
			hit = node;
			return;
		}
		node.children.forEach(visit);
	};
	roots.forEach(visit);
	return hit;
}

/* 一个知识点 = 整个文件(单点文件) 或 文件里的一棵子树(小节文件里的 ## 知识点) */
export function pointRegion(markdown, relPath, key) {
	const lines = String(markdown ?? '').split(/\r?\n/);
	const { front, start } = parseFrontmatter(lines);
	const marks = scanHeadings(lines, start);
	const roots = buildNodes(lines, marks, lines.length);
	const h1 = marks.find((mark) => mark.level === 1) || null;
	const wanted = cleanTitle(String(key ?? ''));
	if (wanted === '') return { error: 'point-key-required' };
	const fileTitle = h1 ? h1.text : front.title || stripNumericPrefix(baseName(relPath));
	if (wanted === cleanTitle(fileTitle) || (front.title && wanted === cleanTitle(front.title))) {
		const from = h1 ? h1.line + 1 : start;
		return {
			mode: 'file',
			title: front.title || fileTitle,
			tags: splitTagsValue(front.tags),
			body: lines.slice(from).join('\n').trim(),
			level: 1,
			line: h1 ? h1.line : -1,
			end: lines.length,
			start,
			lines,
		};
	}
	const hit = findPointNode(roots, wanted);
	if (!hit) return { error: `point-not-found: ${key}` };
	const to = hit.children.length > 0 ? subtreeEnd(hit) : hit.end;
	return {
		mode: 'node',
		title: cleanTitle(hit.title),
		tags: [],
		body: lines.slice(hit.line + 1, to).join('\n').trim(),
		level: hit.level,
		line: hit.line,
		end: to,
		start,
		lines,
	};
}

export function pointBodyLines(body) {
	const rows = String(body ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''));
	while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop();
	return rows;
}

/* 写回: 单点文件保留 frontmatter(只改 title/tags)与 `# 标题`, 子树只换这一棵 */
export function rebuildPoint(markdown, relPath, payload) {
	const region = pointRegion(markdown, relPath, payload.key);
	if (region.error) throw new Error(region.error);
	const title = sanitizeName(payload.title, '');
	if (title === '') throw new Error('empty-title');
	const body = pointBodyLines(payload.body);
	if (region.mode === 'node') {
		const next = region.lines.slice();
		const block = [`${'#'.repeat(region.level)} ${title}`, '', ...body];
		if (body.length > 0) block.push('');
		next.splice(region.line, region.end - region.line, ...block);
		return next.join('\n').replace(/\n*$/, '\n');
	}
	const headLines = region.lines.slice(0, region.start);
	if (region.start > 0) {
		const at = headLines.findIndex((line) => /^title\s*[:：]/.test(line));
		if (at >= 0) headLines[at] = `title: ${title}`;
		else headLines.splice(Math.max(headLines.length - 1, 1), 0, `title: ${title}`);
		if (payload.tags !== undefined) {
			const tags = splitTagsValue(payload.tags);
			const tagLine = tags.length > 0 ? `tags: [${tags.join(', ')}]` : null;
			const tagAt = headLines.findIndex((line) => /^tags?\s*[:：]/.test(line));
			if (tagAt >= 0) {
				if (tagLine) headLines[tagAt] = tagLine;
				else headLines.splice(tagAt, 1);
			} else if (tagLine) headLines.splice(Math.max(headLines.length - 1, 1), 0, tagLine);
		}
	} else {
		headLines.push('---', `title: ${title}`, 'type: point');
		const tags = payload.tags === undefined ? [] : splitTagsValue(payload.tags);
		if (tags.length > 0) headLines.push(`tags: [${tags.join(', ')}]`);
		headLines.push('---');
	}
	const between = region.line >= 0 ? region.lines.slice(region.start, region.line).filter((line) => line.trim() !== '') : [];
	const out = [...headLines, ...between, '', `# ${title}`, ''];
	if (body.length > 0) out.push(...body, '');
	return out.join('\n').replace(/\n{2,}$/, '\n');
}

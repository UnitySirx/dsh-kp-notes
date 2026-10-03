/* rk-study · client/md.js —— markdown 渲染
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createMd(deps) {
	const React = deps.React;
	const h = React.createElement;
	const { useState, useEffect } = React;
	const { MathNode, MermaidBlock, looksLikeMath } = deps || {};
	/* ------------------------------------------------------- markdown md */

	function renderInline(source, keyPrefix) {
		const text = String(source === undefined || source === null ? '' : source);
		const nodes = [];
		let index = 0;
		let counter = 0;
		const pattern = /(\$\$[^$\n]{1,300}\$\$)|(\$(?!\s)[^$\n]{1,300}?(?<!\s)\$(?!\d))|(\\\([^)\n]{1,300}?\\\))|(`[^`]+`)|(!\[[^\]]*\]\([^)]*\))|(\[[^\]]+\]\([^)]*\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)/;
		const nextKey = () => keyPrefix + '-' + (counter += 1);
		while (index < text.length) {
			const rest = text.slice(index);
			const match = pattern.exec(rest);
			if (!match) {
				if (rest !== '') nodes.push(h(React.Fragment, { key: nextKey() }, rest));
				break;
			}
			if (match.index > 0) nodes.push(h(React.Fragment, { key: nextKey() }, rest.slice(0, match.index)));
			const token = match[0];
			const mathToken = token.slice(0, 2) === '$$' || token.charAt(0) === '$' || token.slice(0, 2) === '\\(';
			if (mathToken) {
				const tex = token.slice(0, 2) === '$$' ? token.slice(2, -2) : token.charAt(0) === '$' ? token.slice(1, -1) : token.slice(2, -2);
				if (looksLikeMath(tex)) nodes.push(h(MathNode, { key: nextKey(), tex, display: false }));
				else nodes.push(h(React.Fragment, { key: nextKey() }, token));
			} else if (token.charAt(0) === '`') nodes.push(h('code', { key: nextKey(), className: 'rk-code-inline' }, token.slice(1, -1)));
			else if (token.slice(0, 2) === '![') {
				const parts = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
				nodes.push(h('span', { key: nextKey() }, (parts && parts[1]) || 'image'));
			} else if (token.charAt(0) === '[') {
				const parts = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(token);
				nodes.push(h('a', { key: nextKey(), href: parts ? parts[2] : '#', target: '_blank', rel: 'noreferrer' }, parts ? parts[1] : token));
			} else if (token.slice(0, 2) === '**' || token.slice(0, 2) === '__') nodes.push(h('strong', { key: nextKey() }, token.slice(2, -2)));
			else if (token.slice(0, 2) === '~~') nodes.push(h('del', { key: nextKey() }, token.slice(2, -2)));
			else nodes.push(h('em', { key: nextKey() }, token.slice(1, -1)));
			index += match.index + token.length;
		}
		return nodes;
	}

	function renderFlow(text, key) {
		const lines = String(text === undefined || text === null ? '' : text).split('\n');
		const out = [];
		lines.forEach((line, position) => {
			if (position > 0) out.push(h('br', { key: key + '-br-' + position }));
			renderInline(line, key + '-l' + position).forEach((node) => out.push(node));
		});
		return out;
	}

	function parseTable(rows) {
		const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
		const head = cells(rows[0]);
		const hasSeparator = rows.length > 1 && rows[1].indexOf('-') >= 0 && /^[\s|:-]+$/.test(rows[1]);
		const body = (hasSeparator ? rows.slice(2) : rows.slice(1)).map(cells);
		return { type: 'table', head, rows: body };
	}

	function parseBlocks(markdown) {
		const lines = String(markdown === undefined || markdown === null ? '' : markdown).split(/\r?\n/);
		const blocks = [];
		let index = 0;
		while (index < lines.length) {
			const line = lines[index];
			if (line.trim() === '') {
				index += 1;
				continue;
			}
			const fence = /^\s*(```+|~~~+)(.*)$/.exec(line);
			if (fence) {
				const marker = fence[1].slice(0, 3);
				const lang = fence[2].trim();
				const body = [];
				index += 1;
				while (index < lines.length && lines[index].trim().indexOf(marker) !== 0) {
					body.push(lines[index]);
					index += 1;
				}
				index += 1;
				blocks.push({ type: 'code', lang, text: body.join('\n') });
				continue;
			}
			if (/^\s*\$\$/.test(line)) {
				const first = line.replace(/^\s*\$\$/, '');
				const closeAt = first.indexOf('$$');
				if (closeAt >= 0) {
					blocks.push({ type: 'math', text: first.slice(0, closeAt) });
					index += 1;
					continue;
				}
				const body = [first];
				index += 1;
				while (index < lines.length && lines[index].indexOf('$$') < 0) {
					body.push(lines[index]);
					index += 1;
				}
				if (index < lines.length) {
					body.push(lines[index].slice(0, lines[index].indexOf('$$')));
					index += 1;
				}
				blocks.push({ type: 'math', text: body.join('\n') });
				continue;
			}
			const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
			if (heading) {
				blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
				index += 1;
				continue;
			}
			if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
				blocks.push({ type: 'hr' });
				index += 1;
				continue;
			}
			if (/^\s*>/.test(line)) {
				const body = [];
				while (index < lines.length && /^\s*>/.test(lines[index])) {
					body.push(lines[index].replace(/^\s*>\s?/, ''));
					index += 1;
				}
				blocks.push({ type: 'quote', text: body.join('\n') });
				continue;
			}
			if (/^\s*\|/.test(line)) {
				const rows = [];
				while (index < lines.length && /^\s*\|/.test(lines[index])) {
					rows.push(lines[index]);
					index += 1;
				}
				blocks.push(parseTable(rows));
				continue;
			}
			if (/^\s*(?:[-*+]|\d+[.、)])\s+/.test(line)) {
				const items = [];
				while (index < lines.length && /^\s*(?:[-*+]|\d+[.、)])\s+/.test(lines[index])) {
					const parts = /^([ \t]*)(?:[-*+]|(\d+)[.、)])\s+(.*)$/.exec(lines[index]);
					const indent = parts[1].replace(/\t/g, '  ').length;
					items.push({ depth: Math.min(3, Math.floor(indent / 2)), ordered: Boolean(parts[2]), text: parts[3] });
					index += 1;
				}
				blocks.push({ type: 'list', items });
				continue;
			}
			const para = [];
			while (index < lines.length) {
				const current = lines[index];
				if (current.trim() === '') break;
				if (/^\s*(?:[-*+]|\d+[.、)])\s+/.test(current)) break;
				if (/^\s*\$\$/.test(current)) break;
				if (/^#{1,6}\s/.test(current)) break;
				if (/^\s*>/.test(current) || /^\s*\|/.test(current)) break;
				if (/^\s*(```+|~~~+)/.test(current)) break;
				para.push(current);
				index += 1;
			}
			blocks.push({ type: 'para', text: para.join('\n') });
		}
		return blocks;
	}

	function renderBlock(block, key) {
		if (block.type === 'heading') {
			const level = Math.min(6, Math.max(1, block.level));
			return h('h' + level, { key, className: 'rk-md-h rk-md-h' + level }, renderInline(block.text, key + '-t'));
		}
		if (block.type === 'para') return h('p', { key, className: 'rk-md-p' }, renderFlow(block.text, key));
		if (block.type === 'quote') {
			const paragraphs = block.text.split(/\n{2,}/);
			return h(
				'blockquote',
				{ key, className: 'rk-md-quote' },
				paragraphs.map((part, position) => h('p', { key: key + '-q' + position, className: 'rk-md-p' }, renderFlow(part, key + '-q' + position))),
			);
		}
		if (block.type === 'math') return h('div', { key, className: 'rk-md-diagram' }, h(MathNode, { tex: block.text, display: true }));
		if (block.type === 'code') {
			const lang = String(block.lang || '').toLowerCase();
			if (lang === 'mermaid') return h('div', { key, className: 'rk-md-diagram' }, h(MermaidBlock, { code: block.text }));
			if (lang === 'math' || lang === 'latex' || lang === 'katex' || lang === 'tex') {
				return h('div', { key, className: 'rk-md-diagram' }, h(MathNode, { tex: block.text, display: true }));
			}
			return h('pre', { key, className: 'rk-md-pre' }, h('code', null, block.text));
		}
		if (block.type === 'list') {
			const items = block.items.map((item, position) =>
				h(
					'li',
					{ key: key + '-i' + position, style: { marginLeft: item.depth * 14 + 'px' } },
					renderFlow(item.text, key + '-i' + position),
				),
			);
			return h(block.items.some((item) => item.ordered) ? 'ol' : 'ul', { key, className: 'rk-md-list' }, items);
		}
		if (block.type === 'table') {
			return h(
				'div',
				{ key, className: 'rk-md-tablewrap' },
				h(
					'table',
					{ className: 'rk-md-table' },
					h(
						'thead',
						null,
						h(
							'tr',
							null,
							block.head.map((cell, position) => h('th', { key: key + '-h' + position }, renderInline(cell, key + '-h' + position))),
						),
					),
					h(
						'tbody',
						null,
						block.rows.map((row, rowIndex) =>
							h(
								'tr',
								{ key: key + '-r' + rowIndex },
								block.head.map((_, cellIndex) =>
									h(
										'td',
										{ key: key + '-r' + rowIndex + 'c' + cellIndex },
										renderInline(row[cellIndex] || '', key + '-r' + rowIndex + 'c' + cellIndex),
									),
								),
							),
						),
					),
				),
			);
		}
		if (block.type === 'hr') return h('hr', { key, className: 'rk-md-hr' });
		return null;
	}

	function renderMarkdown(markdown, keyPrefix) {
		const blocks = parseBlocks(markdown);
		if (blocks.length === 0) return null;
		return h(
			React.Fragment,
			null,
			blocks.map((block, index) => renderBlock(block, keyPrefix + '-b' + index)),
		);
	}

	/* 去掉 YAML frontmatter，实时预览里只看正文 */
	function stripFrontmatter(markdown) {
		const text = String(markdown || '');
		if (!/^---\r?\n/.test(text)) return text;
		const rest = text.replace(/^---\r?\n/, '');
		const end = rest.search(/\r?\n---\s*(\r?\n|$)/);
		if (end < 0) return text;
		return rest.slice(end).replace(/^\r?\n---\s*\r?\n?/, '');
	}

	/* 实时预览：输入停顿 ~280ms 后重新渲染(公式/流程图都走同一套渲染器) */
	function LivePreview({ t, value, className }) {
		const [text, setText] = useState(() => String(value || ''));
		useEffect(() => {
			const id = setTimeout(() => setText(String(value || '')), 280);
			return () => clearTimeout(id);
		}, [value]);
		const body = stripFrontmatter(text);
		return h(
			'div',
			{ className: className || 'rk-preview' },
			h('div', { className: 'rk-preview-head' }, h('span', { className: 'rk-dot' }), t('previewLabel')),
			h(
				'div',
				{ className: 'rk-preview-body' },
				body.trim() === ''
					? h('div', { className: 'rk-preview-empty' }, t('previewEmpty'))
					: renderMarkdown(body, 'pv'),
			),
		);
	}

		return { renderInline, renderFlow, parseTable, parseBlocks, renderBlock, renderMarkdown, stripFrontmatter, LivePreview };
}

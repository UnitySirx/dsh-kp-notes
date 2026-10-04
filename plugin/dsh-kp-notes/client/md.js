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

	/* markdown 里 `\X` 是「X 的字面量」(CommonMark), Milkdown 回吐的 snake\_case、a\*b\*c
	 * 都靠这个语义才是对的原样文本。这里先把正文里的 \X 换成私用区掩码, 让 \* \_ 之类
	 * 不再被当成强调定界符, 渲染出的字符串再解回原字符; 代码片段/公式里的反斜杠不动。 */
	const MASK_SHIFT = 0xe000;
	const MASK_ESCAPED = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
	const MASK_CHARS = /[\ue000-\ue0ff]/g;
	const maskChar = (char) => String.fromCharCode(MASK_SHIFT + char.charCodeAt(0));
	const unmaskText = (value) => String(value === undefined || value === null ? '' : value).replace(MASK_CHARS, (char) => String.fromCharCode(char.charCodeAt(0) - MASK_SHIFT));
	const unmaskNode = (node) => {
		if (typeof node === 'string') return unmaskText(node);
		if (Array.isArray(node)) return node.map(unmaskNode);
		if (!node || typeof node !== 'object') return node;
		const props = Object.assign({}, node.props);
		Object.keys(props).forEach((key) => {
			if (key === 'key') return;
			if (key === 'children') return;
			if (typeof props[key] === 'string') props[key] = unmaskText(props[key]);
		});
		if (props.children !== undefined) props.children = unmaskNode(props.children);
		return Object.assign({}, node, { props });
	};
	/* 代码片段 / 行内公式 / 块级公式: 里面的反斜杠是原文, 不参与转义解析。
	 * 定界符自己也可能被转义(\$A_i\$、\`code\`): 那不是真的公式/代码段, 跳过它继续找。 */
	const LITERAL_SPAN = /(`[^`]+`)|(\$\$[^$\n]{1,300}\$\$)|(\$(?!\s)[^$\n]{1,300}?(?<!\s)\$(?!\d))|(\\\([^)\n]{1,300}?\\\))/g;
	function maskEscapes(line) {
		const text = String(line === undefined || line === null ? '' : line);
		if (text.indexOf('\\') < 0) return text;
		let out = '';
		let index = 0;
		LITERAL_SPAN.lastIndex = 0;
		let match = LITERAL_SPAN.exec(text);
		while (match) {
			const span = match[0];
			const opener = span.charAt(0);
			/* 定界符被前面的反斜杠转义 ⇒ 这只是一段普通正文, 按转义规则处理 */
			const openEscaped = match.index > 0 && text.charAt(match.index - 1) === '\\';
			const closeEscaped = opener !== '(' && text.charAt(match.index + span.length - 2) === '\\';
			if (openEscaped || closeEscaped) {
				LITERAL_SPAN.lastIndex = match.index + 1;
				match = LITERAL_SPAN.exec(text);
				continue;
			}
			out += text.slice(index, match.index).replace(MASK_ESCAPED, (whole, char) => maskChar(char));
			out += span;
			index = match.index + span.length;
			match = LITERAL_SPAN.exec(text);
		}
		out += text.slice(index).replace(MASK_ESCAPED, (whole, char) => maskChar(char));
		return out;
	}

	function renderInline(source, keyPrefix) {
		const text = maskEscapes(source);
		const nodes = [];
		let index = 0;
		let counter = 0;
		const pattern = /(\$\$[^$\n]{1,300}\$\$)|(\$(?!\s)[^$\n]{1,300}?(?<!\s)\$(?!\d))|(\\\([^)\n]{1,300}?\\\))|(`[^`]+`)|(!\[[^\]]*\]\([^)]*\))|(\[[^\]]+\]\([^)]*\))|(\*\*[^*]+\*\*)|((?<![0-9A-Za-z_])__[^_]+__(?![0-9A-Za-z_]))|(~~[^~]+~~)|(\*[^*\n]+\*)|((?<![0-9A-Za-z_])_[^_\n]+_(?![0-9A-Za-z_]))/;
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
		return nodes.map(unmaskNode);
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

	/* Milkdown 用的 remark 序列化器是"防御性转义"的: 纯文本里出现 * _ ~ & [ ` | 或行首
	 * 标点, 回吐的 markdown 就会多一个反斜杠(snake_case → snake\_case、a&b → a\&b、
	 * 行首的 - 变成 \-), 原文根本没有这个字符, 预览里却看得见。
	 * 能不能去掉一个反斜杠, 用我们自己的渲染器当裁判: 去掉前后渲染出来的元素/文本/公式
	 * 完全一样才去掉; a\*b\*c、行首 \- 这类"反斜杠真在当语法用"的原样保留。 */
	/* 只有这些标点的反斜杠才考虑去掉: & < > 在别的 markdown 实现里有实体 / HTML 语义,
	 * 去掉可能改变它们在别处的渲染, 一律不动; $ 算在内, 但只有"去掉后渲染成公式"时才去 */
	const ESCAPABLE = '\\`*_{}[]()#+-.!~|$';

	/* 宽松模式下把相邻的"文本片段"接成一条: 去掉一个反斜杠可能让原本的 MathNode 退回文本
	 * (或反过来), 分段方式会变但拼出来的文本一样 ⇒ 也算没变 */
	function appendRelaxedText(out, bare) {
		const last = out.length ? out[out.length - 1] : '';
		if (typeof last === 'string' && last.charAt(0) === 't') out[out.length - 1] = last + bare;
		else out.push('t' + bare);
	}

	function fingerprintNode(node, out, relax, literal) {
		if (node === null || node === undefined || node === false || node === true) return out;
		if (Array.isArray(node)) {
			node.forEach((item) => fingerprintNode(item, out, relax, literal));
			return out;
		}
		const kind = typeof node;
		if (kind === 'string' || kind === 'number') {
			if (relax && !literal) {
				/* 宽松模式: 反斜杠只是转义残留, 当成看不见; 只剩反斜杠的文本节点直接消失。
				 * 代码块/行内代码里不是转义, 一律严格比较(literal) */
				const bare = String(node).replace(/\\/g, '');
				if (!bare) return out;
				appendRelaxedText(out, bare);
				return out;
			}
			out.push('t' + String(node));
			return out;
		}
		if (kind !== 'object') return out;
		const type = node.type;
		const props0 = node.props || {};
		/* 宽松模式: 公式节点按"原文里的 $tex$"算 —— 用来认定"原本当字面量的 $tex$ 变成
		 * 真公式"这一种变化(用户手写内联公式就是要这个效果), 严格模式仍然按公式节点算 */
		if (relax && type === MathNode && props0.tex !== undefined) {
			const tex = String(props0.tex).replace(/\\/g, '');
			appendRelaxedText(out, props0.display ? '$$' + tex + '$$' : '$' + tex + '$');
			return out;
		}
		const name = typeof type === 'string' ? type : (type && (type.displayName || type.name)) || 'frag';
		const props = node.props || {};
		/* 宽松模式下 frag 是透明的: 内容直接接进上层的文本流(空 frag 自然什么也不留),
		 * 免得 frag 边界挡住"文本 ↔ 公式"这一种本该被接受的变化 */
		if (relax && name === 'frag') {
			fingerprintNode(props.children, out, relax, literal);
			return out;
		}
		const marks = [];
		Object.keys(props).forEach((key) => {
			if (key === 'children' || key === 'key') return;
			const value = props[key];
			const valueType = typeof value;
			if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') marks.push(key + '=' + String(value));
		});
		out.push('<' + name + (marks.length ? ' ' + marks.join(' ') : '') + '>');
		fingerprintNode(props.children, out, relax, literal || name === 'code' || name === 'pre');
		out.push('</' + name + '>');
		return out;
	}

	/* 渲染指纹: 只看结构、文本与公式/代码内容(函数型 type 是元素身份, 必须转成名字)
	 * relax = true 时把公式当成原文里的 $tex$、把反斜杠当看不见(见 fingerprintNode) */
	function renderFingerprint(markdown, relax) {
		return fingerprintNode(renderMarkdown(markdown, 'fp'), [], relax).join('\u0001');
	}

	/* 按"字符类"分开试: 一次只去掉某一个字符的全部反斜杠, 渲染指纹不变才采用。
	 * 不能一次性全去掉 —— 文档里只要有一处反斜杠真在当语法用(a\*b\*c 是强调),
	 * 别的字符(snake\_case 的 _、a\~b 的 ~)就会被连坐保住。 */
	const ESCAPE_CLASSES = ESCAPABLE.split('');
	const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
	const escapeForRegExp = (char) => char.replace(REGEX_SPECIAL, '\\$&');
	/* \& 只在不构成实体时才没有语义: \&amp; 去掉会变成实体引用, 渲染就变了 */
	const ENTITY_HEAD = /^(?:#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/;

	function unescapeRedundant(markdown) {
		const text = String(markdown === undefined || markdown === null ? '' : markdown);
		if (text.indexOf('\\') < 0) return text;
		const want = renderFingerprint(text);
		const wantMath = renderFingerprint(text, true);
		let out = text;
		const tryDrop = (pattern, replace, mathTolerant) => {
			const next = out.replace(pattern, replace);
			if (next === out) return false;
			if (renderFingerprint(next) !== want) {
				/* $ 这一类: Milkdown 会把正文里成对的 $ 转义成 \$(unsafe: after:'\$'), 而
				 * 我们自己的渲染器把 $tex$ 当内联公式 —— 去掉后确实渲染成公式就算对。
				 * 别的字符(在当强调/列表/表格语法用的 \* \- \|)没有这个宽松通道。 */
				if (!mathTolerant || renderFingerprint(next, true) !== wantMath) return false;
			}
			out = next;
			return true;
		};
		/* 走两轮: 去掉某一类后, 先前被它挡住的另一类可能又能去掉了 */
		for (let round = 0; round < 2; round += 1) {
			let changed = false;
			ESCAPE_CLASSES.forEach((char) => {
				if (out.indexOf('\\' + char) < 0) return;
				if (tryDrop(new RegExp('\\\\' + escapeForRegExp(char), 'g'), char, char === '$')) changed = true;
			});
			if (out.indexOf('\\&') >= 0) {
				const next = out.replace(/\\&/g, (whole, offset) => (ENTITY_HEAD.test(out.slice(offset + 2)) ? whole : '&'));
				if (next !== out && renderFingerprint(next) === want) {
					out = next;
					changed = true;
				}
			}
			if (!changed) break;
		}
		return out;
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

		return { renderInline, renderFlow, parseTable, parseBlocks, renderBlock, renderMarkdown, stripFrontmatter, unescapeRedundant, renderFingerprint, LivePreview };
}

/* rk-study · client/snippets.js —— markdown 输入助手
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 *
 * 提供:
 *   - parseTemplates(markdown) —— 把「公式模板.md」解析成分组 + 模板
 *   - applySnippet / indentLines —— 把一段文本插到 textarea 光标处(带选区回填)
 *   - snippetKeyDown —— ⌘B 加粗 / ⌘I 斜体 / ⌘M 行内公式 / ⌘⇧M 块级公式 / ⌘K 链接 / ⌘E 代码 / Tab 缩进
 *     外加自己补的编辑键: ⌘/Ctrl + Z 撤销、⇧ 重做(Ctrl+Y 也行)、C 复制、X 剪切、Ctrl+V 粘贴
 *   - MarkdownToolbar —— 一排小按钮 + 「模板」下拉(模板内容来自宿主 /rk-study/templates)
 */
export function createSnippets(deps) {
	const React = deps.React;
	const h = React.createElement;
	const { useCallback, useEffect, useMemo, useRef, useState } = React;

	const TEMPLATE_ROUTE = '/rk-study/templates';
	/* 多学习画布: 模板请求也要带上当前画布的根目录(由 client.js 注入) */
	const rootQuery = typeof deps.rootQuery === 'function' ? deps.rootQuery : ((url) => url);

	/* ------------------------------------------------------------------ 模板解析 */

	const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
	const CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
	const HEAD_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

	/* 「## 分组」+「### 模板名」+ 紧跟的第一个代码块(里面就是要插入的文本)
	 * 代码块比外面长一层时(四个反引号包 ```mermaid)按原样取里面, 用来表达带围栏的模板。 */
	function parseTemplates(markdown) {
		const groups = [];
		let group = null;
		let name = null;
		let fence = null;
		let closed = false;
		let buffer = [];
		const flush = () => {
			if (name) {
				const body = buffer.join('\n').replace(/\s+$/, '');
				if (body.trim() !== '') {
					if (!group) {
						group = { group: '', items: [] };
						groups.push(group);
					}
					group.items.push({ name, body });
				}
			}
			name = null;
			fence = null;
			closed = false;
			buffer = [];
		};
		for (const line of String(markdown ?? '').split('\n')) {
			if (fence) {
				const close = line.match(CLOSE_RE);
				if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
					fence = null;
					closed = true;
					continue;
				}
				buffer.push(line);
				continue;
			}
			const head = line.match(HEAD_RE);
			if (head) {
				const level = head[1].length;
				if (level <= 2) {
					flush();
					group = { group: head[2].trim(), items: [] };
					groups.push(group);
					continue;
				}
				if (level === 3) {
					flush();
					name = head[2].trim();
					continue;
				}
				if (name && !closed) buffer.push(line);
				continue;
			}
			const open = line.match(FENCE_RE);
			if (open) {
				if (name && !closed) fence = { char: open[1][0], len: open[1].length };
				continue;
			}
			if (name && !closed) buffer.push(line);
		}
		flush();
		return groups.filter((item) => item.items.length > 0);
	}

	/* ------------------------------------------------------------------ 插入 */

	/* 内置动作: kind='inline' 用 before/after 包住选区; kind='block' 另起一段插入整块 */
	const ACTIONS = [
		{ id: 'bold', label: 'B', title: 'mdBold', kind: 'inline', before: '**', after: '**', placeholder: '加粗', style: { fontWeight: 700 } },
		{ id: 'italic', label: 'I', title: 'mdItalic', kind: 'inline', before: '*', after: '*', placeholder: '斜体', style: { fontStyle: 'italic' } },
		{ id: 'math', label: '∑', title: 'mdMath', kind: 'inline', before: '$', after: '$', placeholder: 'x = 1' },
		{ id: 'mathBlock', label: '∫', title: 'mdMathBlock', kind: 'block', text: '$$\n\n$$', caret: 3 },
		{ id: 'table', label: '表格', title: 'mdTable', kind: 'block', text: '| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |' },
		{ id: 'flow', label: '流程图', title: 'mdFlow', kind: 'block', text: '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```' },
		{ id: 'list', label: '列表', title: 'mdList', kind: 'block', text: '- 要点一\n- 要点二' },
		{ id: 'quote', label: '引用', title: 'mdQuote', kind: 'block', text: '> 结论' },
		{ id: 'link', label: '链接', title: 'mdLink', kind: 'inline', before: '[', after: '](https://)', placeholder: '说明' },
		{ id: 'code', label: '代码', title: 'mdCode', kind: 'inline', before: '`', after: '`', placeholder: 'code' },
	];

	const findAction = (id) => ACTIONS.find((item) => item.id === id) || null;

	/* handle = { value, onChange, ref } —— ref 指向 textarea, 值由父组件受控 */
	function applySnippet(handle, spec) {
		if (!handle || !spec) return;
		const area = handle.ref ? handle.ref.current : null;
		const current = String(handle.value ?? '');
		let start = current.length;
		let end = current.length;
		if (area && typeof area.selectionStart === 'number' && typeof area.selectionEnd === 'number') {
			start = area.selectionStart;
			end = area.selectionEnd;
		}
		const selected = current.slice(start, end);
		let text = '';
		let caret = start;
		let caretEnd = start;
		if (spec.kind === 'block') {
			const body = typeof spec.text === 'function' ? spec.text(selected) : String(spec.text ?? '');
			const lead = start > 0 && current[start - 1] !== '\n' ? '\n\n' : '';
			const tail = end < current.length && current[end] !== '\n' ? '\n\n' : '';
			text = lead + body + tail;
			const offset = typeof spec.caret === 'number' ? spec.caret : body.length;
			caret = start + lead.length + offset;
			caretEnd = caret;
		} else {
			const body = selected !== '' ? selected : String(spec.placeholder ?? '');
			const lead = String(spec.before ?? '');
			const tail = String(spec.after ?? '');
			text = lead + body + tail;
			caret = start + lead.length;
			caretEnd = caret + body.length;
		}
		if (typeof handle.onChange === 'function') handle.onChange(current.slice(0, start) + text + current.slice(end));
		/* 受控 textarea 要等 React 把新值写回去之后再放光标, 否则会被旧值覆盖 */
		requestAnimationFrame(() => {
			const el = handle.ref ? handle.ref.current : null;
			if (!el) return;
			el.focus();
			try {
				el.setSelectionRange(caret, caretEnd);
			} catch {
				/* 忽略 */
			}
		});
	}

	/* Tab / ⇧Tab: 选中行整体加两格 / 去掉两格 */
	function indentLines(handle, outdent) {
		if (!handle) return;
		const area = handle.ref ? handle.ref.current : null;
		const current = String(handle.value ?? '');
		const start = area ? area.selectionStart : current.length;
		const end = area ? area.selectionEnd : current.length;
		const from = current.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
		let to = current.indexOf('\n', end);
		if (to === -1) to = current.length;
		const block = current.slice(from, to);
		const next = block
			.split('\n')
			.map((line) => (outdent ? line.replace(/^ {1,2}/, '') : '  ' + line))
			.join('\n');
		if (next === block) return;
		const delta = next.length - block.length;
		if (typeof handle.onChange === 'function') handle.onChange(current.slice(0, from) + next + current.slice(to));
		requestAnimationFrame(() => {
			const el = handle.ref ? handle.ref.current : null;
			if (!el) return;
			el.focus();
			const shifted = Math.max(0, Math.min(next.length, end - from + delta));
			try {
				el.setSelectionRange(from + shifted, from + shifted);
			} catch {
				/* 忽略 */
			}
		});
	}

	const KEY_ACTIONS = { b: 'bold', i: 'italic', m: 'math', k: 'link', e: 'code' };

	/* ------------------------------------------- 编辑键(撤销 / 重做 / 复制 / 剪切 / 粘贴)
	 * 部分环境(Tauri/WKWebView)不把 ⌘C/⌘V/⌘X/⌘Z 交给网页、应用的原生菜单又不接管, 这四个键就等于没了。
	 * 所以在这里自己补一套, 且用 document.execCommand 走浏览器自己的编辑管线:
	 * 撤销栈是原生那份、对受控 textarea 也会补发 input 事件让 React 的 onChange 跟上。
	 * 命令不被支持(返回 false)就返回 false, 交回系统 —— 本来能用的环境不受影响。
	 * 粘贴只能靠剪贴板 API(execCommand('paste') 被浏览器禁掉), 因此这里只接 Ctrl+V; ⌘V 仍交给系统,
	 * 免得 WKWebView 的权限框把本来好用的 ⌘V 弄坏。 */
	function execEdit(command) {
		try {
			return document.execCommand(command) === true;
		} catch (error) {
			return false;
		}
	}

	function pasteText(handle, el, text) {
		const current = typeof handle.value === 'string' ? handle.value : String(el.value ?? '');
		const from = typeof el.selectionStart === 'number' ? el.selectionStart : current.length;
		const to = typeof el.selectionEnd === 'number' ? el.selectionEnd : from;
		const merged = current.slice(0, from) + text + current.slice(to);
		if (typeof handle.onChange === 'function') handle.onChange(merged);
		requestAnimationFrame(() => {
			try {
				el.focus();
				const at = from + text.length;
				el.setSelectionRange(at, at);
			} catch (error) {
				/* 元素没了就算了 */
			}
		});
	}

	/* 返回 true 表示已经处理; 返回 false 时调用方(和系统)照旧 */
	function editKeyDown(handle, event) {
		if (!event || event.isComposing === true || event.keyCode === 229) return false;
		const meta = event.metaKey === true;
		const ctrl = event.ctrlKey === true;
		if ((!meta && !ctrl) || event.altKey === true) return false;
		const el = event.target;
		if (!el || typeof el.value !== 'string') return false;
		const key = String(event.key ?? '').toLowerCase();
		if (key === 'z' || key === 'y') {
			const redo = key === 'y' || event.shiftKey === true;
			if (!execEdit(redo ? 'redo' : 'undo')) return false;
			event.preventDefault();
			if (typeof handle.onChange === 'function') handle.onChange(el.value);
			return true;
		}
		if (event.shiftKey === true) return false;
		if (key === 'c' || key === 'x') {
			if (el.selectionEnd <= el.selectionStart) return false;
			if (!execEdit(key === 'c' ? 'copy' : 'cut')) return false;
			event.preventDefault();
			if (key === 'x' && typeof handle.onChange === 'function') handle.onChange(el.value);
			return true;
		}
		if (key === 'v' && ctrl && !meta) {
			event.preventDefault();
			const reading = navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : null;
			if (reading && typeof reading.then === 'function') {
				reading.then((text) => {
					if (typeof text === 'string' && text !== '') pasteText(handle, el, text);
				}).catch(() => {
					/* 读不到剪贴板: 让用户改用 ⌘V */
				});
			}
			return true;
		}
		return false;
	}

	/* 返回 true 表示已经处理(调用方不用再管) */
	function snippetKeyDown(handle, event) {
		if (!event) return false;
		if (editKeyDown(handle, event)) return true;
		if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			indentLines(handle, event.shiftKey === true);
			return true;
		}
		if ((!event.metaKey && !event.ctrlKey) || event.altKey) return false;
		const key = String(event.key ?? '').toLowerCase();
		if (event.shiftKey && key === 'm') {
			event.preventDefault();
			applySnippet(handle, findAction('mathBlock'));
			return true;
		}
		if (event.shiftKey) return false;
		const id = KEY_ACTIONS[key];
		if (!id) return false;
		event.preventDefault();
		applySnippet(handle, findAction(id));
		return true;
	}

	/* ------------------------------------------------------- 模板库(宿主文件) */

	function useTemplates() {
		const [state, setState] = useState({ loading: true, dir: '', files: [], error: null });
		const load = useCallback(async () => {
			try {
				const response = await fetch(rootQuery(TEMPLATE_ROUTE), { headers: { accept: 'application/json' } });
				const data = await response.json().catch(() => null);
				if (data && data.ok && Array.isArray(data.files)) {
					setState({
						loading: false,
						dir: String(data.dir ?? ''),
						error: null,
						files: data.files.map((file) => ({
							key: String(file.key ?? ''),
							label: String(file.label ?? file.file ?? ''),
							file: String(file.file ?? ''),
							path: String(file.path ?? ''),
							exists: file.exists === true,
							markdown: String(file.markdown ?? ''),
						})),
					});
					return;
				}
				setState((prev) => Object.assign({}, prev, { loading: false, error: (data && (data.message || data.error)) || 'HTTP ' + response.status }));
			} catch (error) {
				setState((prev) => Object.assign({}, prev, { loading: false, error: String((error && error.message) || error) }));
			}
		}, []);
		useEffect(() => {
			load();
		}, [load]);
		const files = useMemo(() => state.files.map((file) => Object.assign({}, file, { groups: parseTemplates(file.markdown) })), [state.files]);
		const save = useCallback(
			async (key, markdown) => {
				try {
					const response = await fetch(rootQuery(TEMPLATE_ROUTE), {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ key, markdown }),
					});
					const data = await response.json().catch(() => null);
					if (data && data.ok) {
						await load();
						return { ok: true };
					}
					return { ok: false, error: (data && (data.message || data.error)) || 'HTTP ' + response.status };
				} catch (error) {
					return { ok: false, error: String((error && error.message) || error) };
				}
			},
			[load],
		);
		return Object.assign({}, state, { files, reload: load, save });
	}

	/* ------------------------------------------------------------------ 工具栏 */

	/* 模板库文件表由宿主给(公式模板 / Markdown模板), 一个文件对应工具栏上的一个下拉菜单 */
	const MENU_LABEL = { formula: 'mdFormula', markdown: 'mdTemplates' };

	function MarkdownToolbar(props) {
		const { t, value, onChange, areaRef, onEditTemplates } = props;
		const lib = useTemplates();
		const [open, setOpen] = useState('');
		const boxRef = useRef(null);
		const handle = { value, onChange, ref: areaRef };
		useEffect(() => {
			if (!open) return undefined;
			const onDown = (event) => {
				if (boxRef.current && !boxRef.current.contains(event.target)) setOpen('');
			};
			const onKey = (event) => {
				if (event.key === 'Escape') setOpen('');
			};
			window.addEventListener('pointerdown', onDown, true);
			window.addEventListener('keydown', onKey, true);
			return () => {
				window.removeEventListener('pointerdown', onDown, true);
				window.removeEventListener('keydown', onKey, true);
			};
		}, [open]);
		/* 按钮不能抢走 textarea 的焦点/选区, 否则插入位置就丢了 */
		const keepFocus = (event) => event.preventDefault();
		const renderMenu = (list, file) =>
			h(
				'div',
				{ className: 'rk-md-menu' },
				list.length === 0
					? h('div', { className: 'rk-md-empty' }, lib.error ? t('mdLoadFailed') + '：' + lib.error : t('mdTemplateEmpty'))
					: list.map((group) =>
							h(
								'div',
								{ key: group.group || 'default', className: 'rk-md-group' },
								h('div', { className: 'rk-md-group-name' }, group.group || t('mdTemplates')),
								group.items.map((item) =>
									h(
										'button',
										{
											key: item.name,
											type: 'button',
											className: 'rk-md-item',
											title: item.body,
											onMouseDown: keepFocus,
											onClick: () => {
												applySnippet(handle, { kind: 'block', text: item.body });
												setOpen('');
											},
										},
										item.name,
									),
								),
							),
						),
				h(
					'div',
					{ className: 'rk-md-foot' },
					h('button', { type: 'button', className: 'rk-md-foot-btn', onMouseDown: keepFocus, onClick: () => lib.reload() }, t('mdReloadTemplates')),
					file && file.exists === false
						? h(
								'button',
								{
									type: 'button',
									className: 'rk-md-foot-btn',
									onMouseDown: keepFocus,
									onClick: async () => {
										await lib.save(file.key, file.markdown);
									},
								},
								t('mdCreateTemplates'),
							)
						: null,
					onEditTemplates && file && file.path !== '' && file.exists !== false
						? h(
								'button',
								{
									type: 'button',
									className: 'rk-md-foot-btn',
									onMouseDown: keepFocus,
									onClick: () => {
										setOpen('');
										onEditTemplates(file.path);
									},
								},
								t('mdEditTemplates'),
							)
						: null,
				),
			);
		const drop = (id, label, list, file) =>
			h(
				'div',
				{ className: 'rk-md-wrap' },
				h(
					'button',
					{
						type: 'button',
						className: 'rk-md-btn rk-md-more' + (open === id ? ' is-on' : ''),
						title: label + ' ▾',
						onMouseDown: keepFocus,
						onClick: () => setOpen((prev) => (prev === id ? '' : id)),
					},
					label + ' ▾',
				),
				open === id ? renderMenu(list, file) : null,
			);
		return h(
			'div',
			{ className: 'rk-md-tools' },
			ACTIONS.map((action) =>
				h(
					'button',
					{
						key: action.id,
						type: 'button',
						className: 'rk-md-btn',
						title: t(action.title),
						style: action.style,
						onMouseDown: keepFocus,
						onClick: () => applySnippet(handle, action),
					},
					action.label,
				),
			),
			h('span', { className: 'rk-md-sep' }),
			h(
				'div',
				{ className: 'rk-md-dropzone', ref: boxRef },
				lib.files.length > 0
					? lib.files.map((file) => drop(file.key, t(MENU_LABEL[file.key] || 'mdTemplates'), file.groups, file))
					: drop('templates', t('mdTemplates'), [], null),
			),
		);
	}

	return { MarkdownToolbar, applySnippet, indentLines, parseTemplates, snippetKeyDown, useTemplates };
}

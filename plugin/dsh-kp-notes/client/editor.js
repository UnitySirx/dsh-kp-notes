/* rk-study · client/editor.js —— 编辑器
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createEditor(deps) {
	const React = deps.React;
	const h = React.createElement;
	const { useState, useEffect, useRef, useMemo } = React;
	const { DeleteButton, LivePreview, MarkdownToolbar, snippetKeyDown, milkdown, unescapeRedundant, media } = deps || {};

	/* YAML frontmatter 不能交给富文本编辑器: title / type / tags / order 是插件的元数据,
	 * 让 Milkdown 把 `---` 当成分割线 + 那几行当成段落读进去, 保存时就会被改写掉。
	 * 所以富文本只编辑正文, 头原样存在 ref 里, 保存时再拼回去;
	 * 源码模式仍然显示整篇(头 + 正文), 要改 title/tags 就在那里改 —— 能力没丢。 */
	function splitFront(text) {
		const src = typeof text === 'string' ? text : '';
		const lines = src.split(/\r?\n/);
		if (lines.length === 0 || lines[0].trim() !== '---') return { head: '', body: src };
		for (let index = 1; index < lines.length; index += 1) {
			if (lines[index].trim() === '---') {
				return { head: lines.slice(0, index + 1).join('\n') + '\n', body: lines.slice(index + 1).join('\n') };
			}
		}
		return { head: '', body: src };
	}

	/* 富文本回吐的 markdown 清洗: 空段落会被序列化成单独一行的 <br />,
	 * 连续空行也可能多出来 —— 不清掉的话每编辑一次, 笔记里就多一点这种噪声。
	 * 另外回吐的纯文本会被 remark 加防御性反斜杠(snake\_case), 由 unescapeRedundant
	 * 用渲染器校验后去掉, 见 client/md.js。
	 * 最后一道: 刚插入的图片在富文本里 src 是「本地引用」(blob: 地址, 落盘后才由 media 换成相对
	 * 路径, 见 client/media.js 的两步插图), 往外写之前一律换成相对路径 —— 这里是编辑器侧唯一的
	 * 收口, 富文本 onChange / 源码框 / 换笔记重播种都经过它。 */
	function cleanMarkdown(text) {
		const tidy = String(text || '')
			.split('\n')
			.filter((line) => !/^\s*<br\s*\/?>\s*$/i.test(line))
			.map((line) => line.replace(/[ \t]+$/, ''))
			.join('\n')
			.replace(/\n{3,}/g, '\n\n');
		const cleaned = typeof unescapeRedundant === 'function' ? unescapeRedundant(tidy) : tidy;
		return media && media.toMarkdownSrc ? media.toMarkdownSrc(cleaned) : cleaned;
	}

	function Editor({ state, t, onClose, onSave, saving, onDelete, onError, onEditTemplates, theme }) {
		const opening = splitFront(state.markdown || '');
		const [value, setValue] = useState(() => cleanMarkdown(opening.body));
		const [title, setTitle] = useState(state.title || '');
		const areaRef = useRef(null);
		const headRef = useRef(opening.head);
		const [seed, setSeed] = useState(0);
		const preview = true;
		/* 换了另一篇笔记(mode/path 变了)就重新播种, 免得富文本还停在上一个文件上 */
		const noteKey = (state.mode || '') + '|' + (state.path || state.dir || '');
		const lastKeyRef = useRef(noteKey);
		/* 保存时把 YAML 头原样拼回去; 头后面固定留一个空行(富文本回吐的正文会吃掉它) */
		const savePayload = async () => {
			/* 刚插进来的图片可能还在落盘(见 client/media.js 的两步插图: 选文件只是本地引用,
			 * 插入之后才把字节交给 host), 所以写盘前先等落盘作业跑完; 收口用 strict —— 还挂着
			 * blob 的那张图宁可不写, 文件里绝不会出现 blob: 地址。
			 * 另外源码框是**直接改 value** 的(不像富文本那样过 cleanMarkdown), 粘贴进来的绝对地址
			 * 也靠这道收口换回相对路径(幂等, 相对路径走快路径) —— 文件里一定只有相对路径。 */
			if (media && media.flush) {
				try {
					await media.flush();
				} catch (error) {
					/* 落盘失败: 下面的 strict 收口会把这段图去掉, 不会把 blob 写进文件 */
				}
			}
			const body = media && media.toMarkdownSrc ? media.toMarkdownSrc(value, true) : value;
			const head = headRef.current;
			if (!head) return { value: body, title };
			return { value: head + (body.startsWith('\n') ? body : '\n' + body), title };
		};
		/* 保存按钮 / ⌘S: 等落盘 + 收口(异步)之后再把载荷交给 onSave */
		const submit = () => {
			void savePayload().then((payload) => onSave(payload));
		};
		useEffect(() => {
			if (lastKeyRef.current === noteKey) return;
			lastKeyRef.current = noteKey;
			const next = splitFront(state.markdown || '');
			headRef.current = next.head;
			setValue(cleanMarkdown(next.body));
			setTitle(state.title || '');
			setSeed((prev) => prev + 1);
		}, [noteKey, state.markdown, state.title]);
		/* 所见即所得视图: 默认用 zt-react-milkdown(包放在 vendor/, 由 client/milkdown.js 拉起来)。
		 * 编辑器还在加载或加载失败时, 原样退回「源码 textarea + 实时预览」那一套, 编辑流程不中断。 */
		const useMd = (milkdown && milkdown.useMilkdown) || (() => ({ status: 'failed', Editor: null }));
		const mdState = useMd();
		const [view, setView] = useState('rich');
		const isNew = state.mode === 'newSection' || state.mode === 'newPoint';
		/* 插图落盘(client/media.js): **两步** —— 弹窗里选文件时只拿到一条本地引用(blob: 地址,
		 * 不写盘; 选错重选、选完就关弹窗都不留孤儿图), 等图片真插进正文(下面的 onChange 收到带
		 * blob 的 markdown)才调 media.settleText 把字节交给宿主落到「这篇笔记所在小节」旁边的
		 * 素材目录, 落完正文里换成相对路径 —— 不再写 Base64。新建时还没有文件, 不接管(仍走内置的 Base64)。
		 * maxFileSize 必传: vendor 不传就默认只让传 5MB。
		 * allowedProtocols 必传: vendor 的图片节点只认白名单里的协议(默认没有 blob:), 不补上
		 * 「选图阶段那条本地引用」就会被它当成非法地址静默丢掉 —— 图看得见, markdown 里却没有。 */
		const notePath = !isNew && state.path ? state.path : '';
		const imageUpload = useMemo(
			() =>
				media && notePath
					? {
							upload: (file) => media.upload(file, notePath),
							maxFileSize: media.maxFileSize,
							allowedProtocols: media.allowedProtocols,
					  }
					: undefined,
			[media, notePath],
		);
		const kind = state.kind || '';
		const mdReady = mdState.status === 'ready' && !!mdState.Editor;
		const richMode = !isNew && view === 'rich';
		const rich = richMode && mdReady;
		const waitMd = richMode && mdState.status === 'loading';
		const sourceView = !isNew && !richMode;
		const split = sourceView && preview;
		const wide = rich || waitMd || split;
		/* 编辑器 locale: 宿主 locale 服务会把当前语言写到 <html lang>, 拿不到就看浏览器 */
		const uiLang = String(
			(typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ||
				(typeof navigator !== 'undefined' && navigator.language) ||
				'zh',
		).toLowerCase();
		const mdLocale = uiLang.indexOf('zh') === 0 ? 'zh-CN' : 'en-US';
		/* 焦点在 Milkdown(ProseMirror)里时 keydown 冒泡可能被它吃掉, 所以在捕获阶段兜一层 ⌘S */
		useEffect(() => {
			const onKey = (event) => {
				if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
					event.preventDefault();
					submit();
				}
			};
			document.addEventListener('keydown', onKey, true);
			return () => document.removeEventListener('keydown', onKey, true);
		}, [value, title, onSave]);
		/* 只有题目文件里能插入题目模板 */
		const showTemplates = !isNew && kind === 'question';
		const insert = (snippet) => {
			const area = areaRef.current;
			if (!area) {
				/* 富文本里没有 textarea: 追加到正文末尾, 并换 key 让编辑器用新内容重新播种 */
				setValue((prev) => prev + '\n' + snippet);
				setSeed((prev) => prev + 1);
				return;
			}
			const start = area.selectionStart || 0;
			const end = area.selectionEnd || 0;
			setValue(value.slice(0, start) + snippet + value.slice(end));
			requestAnimationFrame(() => {
				area.focus();
				area.selectionStart = start + snippet.length;
				area.selectionEnd = start + snippet.length;
			});
		};
		const questionSnippet =
			'\n## 题目 1\n\n题干……\n\nA. 选项一\nB. 选项二\nC. 选项三\nD. 选项四\n\n**答案**：A\n**解析**：……\n';
		const modeLabel = state.mode === 'newPoint' ? t('newPoint') : t('newSection');
		const editLabel =
			kind === 'question'
				? t('editQuestionFile')
				: kind === 'point'
					? t('editPoint')
					: t('editSection');
		return h(
			'div',
			{
				className: 'rk-drawer' + (wide ? ' rk-wide' : ''),
				onKeyDown: (event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === 's') {
						event.preventDefault();
						submit();
					}
				},
			},
			h(
				'div',
				{ className: 'rk-drawer-head' },
				h('span', { className: 'rk-dot' }),
				h('b', { style: { fontSize: 13 } }, isNew ? modeLabel : editLabel),
				h('span', { className: 'rk-chip' }, state.path || state.dir || ''),
				isNew ? null : h('span', { className: 'rk-chip' }, (headRef.current + value).length + ' ' + t('chars')),
			!isNew && headRef.current ? h('span', { className: 'rk-chip', title: t('mdFrontKept') }, 'YAML ✓') : null,
				isNew
					? h('span', { style: { marginLeft: 'auto' } }, h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: onClose }, t('close')))
					: h(
							'span',
							{ style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 } },
							mdReady || waitMd
								? h(
									'div',
									{ className: 'rk-seg' },
									h('button', { className: 'rk-seg-item' + (view === 'rich' ? ' rk-on' : ''), type: 'button', onClick: () => setView('rich') }, t('modeMd')),
									h('button', { className: 'rk-seg-item' + (view === 'source' ? ' rk-on' : ''), type: 'button', onClick: () => setView('source') }, t('modeSrc')),
								)
								: null,
							h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: onClose }, t('close')),
						),
			),
			h(
				'div',
				{ className: 'rk-drawer-body' + (split ? ' rk-split' : '') },
				/* 左栏: 新建字段 / 模板行 / 输入助手工具栏 / 源码框 —— 分栏时它和预览各占一列 */
				h(
					'div',
					{ className: 'rk-edit-col' },
				isNew
					? h(
							'div',
							null,
							h('div', { className: 'rk-field' }, h('label', null, '目录'), h('input', { className: 'rk-input', value: state.dir || '', readOnly: true })),
							h(
								'div',
								{ className: 'rk-field', style: { marginTop: 8 } },
								h('label', null, t('title2')),
								h('input', {
									className: 'rk-input',
									value: title,
									placeholder: t('title2'),
									autoFocus: true,
									onChange: (event) => setTitle(event.target.value),
									onKeyDown: (event) => {
										if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
											event.preventDefault();
											submit();
										}
									},
								}),
							),
						)
					: null,
				showTemplates
					? h(
							'div',
							{ className: 'rk-row' },
							kind === 'question'
								? h('button', { className: 'rk-btn', type: 'button', onClick: () => insert(questionSnippet) }, t('insertQuestion'))
								: null,
						)
					: null,
				isNew || richMode ? null : MarkdownToolbar ? h(MarkdownToolbar, { t, value, onChange: setValue, areaRef, onEditTemplates }) : null,
				sourceView
					? h('textarea', {
							className: 'rk-textarea',
							ref: areaRef,
							value: headRef.current + value,
							spellCheck: false,
							onChange: (event) => {
								const next = splitFront(event.target.value);
								headRef.current = next.head;
								setValue(next.body);
							},
							onKeyDown: (event) => {
								if (snippetKeyDown && snippetKeyDown({ value, onChange: setValue, ref: areaRef }, event)) return;
								if ((event.metaKey || event.ctrlKey) && event.key === 's') {
									event.preventDefault();
									submit();
								}
							},
						})
					: null,
				rich || waitMd
					? h(
							'div',
							{ className: 'rk-mdedit' + (waitMd ? ' rk-md-wait' : '') },
							rich
								? h(mdState.Editor, {
										/* 非受控: 父组件每次 onChange 都会重渲染, 再用 value 回写会把光标顶回行首 */
										key: 'rk-md-' + noteKey + ':' + seed,
										defaultValue: value,
										/* 插入图片(或粘贴图片)之后编译器回吐的 markdown 里, 新图还是那条本地引用
										 * (blob: 地址) —— 这时候才把字节落盘, 落完换成相对路径(见 client/media.js)。
										 * 先同步 setValue 一次(编辑中的正文里 blob 原样留着, 图照样显示),
										 * 落盘完成后再 setValue 一次把 value 变成写盘用的相对路径。 */
										onChange: (next) => {
											setValue(cleanMarkdown(next));
											if (media && media.settleText && String(next).indexOf('blob:') >= 0) {
												void media.settleText(next).then((settled) => setValue(cleanMarkdown(settled)));
											}
										},
										imageUpload: imageUpload,
										theme: theme === 'light' ? 'light' : 'dark',
										locale: mdLocale,
										className: 'rk-md-zt',
										placeholder: t('mdPlaceholder'),
									})
								: t('mdLoading'),
						)
					: null,
				),
				split ? h(LivePreview, { t, value }) : null,
			),
			h(
				'div',
				{ className: 'rk-drawer-foot' },
				h(
					'button',
					{ className: 'rk-btn rk-primary', type: 'button', disabled: saving, onClick: () => submit() },
					saving ? t('saving') : t('save'),
				),
				h('span', { className: 'rk-sec-sub' }, '⌘S'),
				!isNew && onDelete
					? h(
							'span',
							{ style: { marginLeft: 'auto' } },
							h(DeleteButton, { t, label: t('delFile'), onError, onConfirm: () => onDelete(state.path) }),
						)
					: null,
			),
		);
	}

		return { Editor };
}

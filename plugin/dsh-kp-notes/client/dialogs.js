/* rk-study · client/dialogs.js —— 弹窗
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createDialogs(deps) {
	const React = deps.React;
	const h = React.createElement;
	const { useState, useRef } = React;
	const { LivePreview, MarkdownToolbar, snippetKeyDown, unescapeRedundant } = deps || {};
	/* 富文本编辑: 用 vendor 里的 zt-react-milkdown(和知识点编辑器抽屉同一套); 包没起来就自动回退源码框 */
	const milkdownMods = (deps && deps.milkdown) || null;
	const useMd = (milkdownMods && milkdownMods.useMilkdown) || (() => ({ status: 'failed', Editor: null }));
	/* 编辑器的界面语言跟宿主 html lang 走(宿主 locale 服务会写这个属性) */
	const mdLocaleOf = () => {
		const lang = (typeof document !== 'undefined' && document.documentElement.getAttribute('lang')) || (typeof navigator !== 'undefined' && navigator.language) || '';
		return /^zh/i.test(lang) ? 'zh-CN' : 'en-US';
	};
	/* Milkdown 把空段落序列化成单独一行的 <br />, 存文件前清掉(和知识点编辑器抽屉同一处理);
	 * 再把 Milkdown 的"防御性转义"(snake\_case / a\&b / \*A\_i\*)清掉, 和抽屉走同一个判官 */
	const squeeze = (text) => {
		const tidy = String(text || '')
			.split('\n')
			.filter((line) => !/^\s*<br\s*\/?>\s*$/i.test(line))
			.map((line) => line.replace(/[ \t]+$/, ''))
			.join('\n')
			.replace(/\n{3,}/g, '\n\n');
		return typeof unescapeRedundant === 'function' ? unescapeRedundant(tidy) : tidy;
	};
	/* 章节名称弹窗: 新建章节 / 给已有章节改名 */
	function NameDialog({ t, title, value, placeholder, onCancel, onSubmit }) {
		const [name, setName] = useState(value || '');
		const submit = () => onSubmit(name);
		return h(
			'div',
			{ className: 'rk-modal', onClick: onCancel },
			h(
				'div',
				{ className: 'rk-modal-card', onClick: (event) => event.stopPropagation() },
				h('div', { className: 'rk-modal-title' }, title),
				h('input', {
					className: 'rk-input',
					autoFocus: true,
					value: name,
					placeholder: placeholder || '',
					onChange: (event) => setName(event.target.value),
					onKeyDown: (event) => {
						if (event.key === 'Enter') submit();
						if (event.key === 'Escape') onCancel();
					},
				}),
				h(
					'div',
					{ className: 'rk-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
					h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: onCancel }, t('cancel')),
					h('button', { className: 'rk-btn rk-primary', type: 'button', onClick: submit }, t('save')),
				),
			),
		);
	}

	const OPTION_LETTERS = 'ABCDEFGH';

	function questionFormFrom(props) {
		const options = Array.isArray(props.options) ? props.options : [];
		const rows = options.length > 0 ? options.map((option) => ({ text: String((option && option.text) || '') })) : [];
		while (rows.length < 4) rows.push({ text: '' });
		const letter = String(props.answerKey || 'A').trim().toUpperCase();
		const known = rows.some((row, index) => OPTION_LETTERS[index] === letter);
		return {
			kind: props.kind === 'case' ? 'case' : 'choice',
			stem: props.stem || '',
			options: rows,
			answerKey: known ? letter : 'A',
			answerText: props.answerText || '',
			explanation: props.explanation || '',
		};
	}

	/** 表单 -> 宿主字段: 丢掉空选项, 选项字母按顺序重排, 正确答案跟着重排 */
	function questionFields(form) {
		const kept = form.options
			.map((row, index) => ({ letter: OPTION_LETTERS[index] || '', text: String(row.text || '').trim() }))
			.filter((row) => row.text !== '');
		const answerAt = kept.findIndex((row) => row.letter === form.answerKey);
		return {
			kind: form.kind === 'case' ? 'case' : 'choice',
			stem: String(form.stem || '').trim(),
			options: kept.map((row, index) => ({ key: OPTION_LETTERS[index] || '', text: row.text })),
			answerKey: OPTION_LETTERS[answerAt >= 0 ? answerAt : 0] || 'A',
			answerText: String(form.answerText || ''),
			explanation: String(form.explanation || ''),
		};
	}

	/* 题目表单的实时预览: 用同一份字段拼出将写进文件的 markdown, 交给同一个渲染器 */
	function questionPreviewMarkdown(form) {
		const fields = questionFields(form);
		const out = [fields.stem === '' ? '_（题干还没写）_' : fields.stem];
		if (fields.kind === 'choice') {
			if (fields.options.length > 0) {
				out.push('');
				fields.options.forEach((option) => out.push(option.key + '. ' + option.text));
			}
			out.push('');
			out.push('**答案**：' + fields.answerKey);
			if (fields.explanation.trim() !== '') {
				out.push('');
				out.push('**解析**：' + fields.explanation.trim());
			}
		} else {
			out.push('');
			out.push('**答案**：');
			out.push('');
			out.push(fields.answerText.trim() === '' ? '_（答案还没写）_' : fields.answerText.trim());
		}
		return out.join('\n');
	}
	function questionProblem(form, t) {
		const fields = questionFields(form);
		if (fields.stem === '') return t('errStem');
		if (fields.kind === 'choice') {
			if (fields.options.length < 2) return t('errOptions');
			if (!fields.options.some((option) => option.key === fields.answerKey)) return t('errAnswer');
		} else if (fields.answerText.trim() === '') {
			return t('errAnswerText');
		}
		return '';
	}

	/** 宿主校验错误 -> 人话 */
	function questionError(message, t) {
		const text = String((message && message.message) || message || '');
		if (text.indexOf('empty-stem') >= 0) return t('errStem');
		if (text.indexOf('need-two-options') >= 0 || text.indexOf('bad-option-key') >= 0) return t('errOptions');
		if (text.indexOf('answer-not-in-options') >= 0) return t('errAnswer');
		if (text.indexOf('empty-answer') >= 0) return t('errAnswerText');
		return text;
	}

	function QuestionDialog({ t, mode, from, form: initial, onCancel, onSubmit, onRaw, onEditTemplates, theme }) {
		const [form, setForm] = useState(() => questionFormFrom(initial || {}));
		const [busy, setBusy] = useState(false);
		const [problem, setProblem] = useState('');
		/* 富文本框(默认) / 源码框: 源码框里 markdown 输入助手(公式 / 表格 / 模板)照旧可用 */
		const [src, setSrc] = useState(false);
		/* 富文本是非受控的(defaultValue), 「保存并继续」清空表单时靠它重新播种 */
		const [seed, setSeed] = useState(0);
		const md = useMd();
		const mdReady = md.status === 'ready' && !!md.Editor;
		const mdLoading = !src && !mdReady && md.status === 'loading';
		const richMode = !src && mdReady;
		const patch = (next) => {
			setProblem('');
			setForm((prev) => ({ ...prev, ...next }));
		};
		/* markdown 输入助手: 记住最后聚焦的字段, 工具栏与快捷键都往那儿插 */
		const areaRef = useRef(null);
		const [activeField, setActiveField] = useState('stem');
		const field = (key) => ({
			value: form[key] ?? '',
			onChange: (event) => patch({ [key]: event.target.value }),
			onFocus: (event) => {
				areaRef.current = event.target;
				if (activeField !== key) setActiveField(key);
			},
			onKeyDown: (event) => {
				if (snippetKeyDown && snippetKeyDown({ value: form[key] ?? '', onChange: (next) => patch({ [key]: next }), ref: { current: event.target } }, event)) return;
			},
		});
		const tools = () => (richMode || mdLoading ? null : MarkdownToolbar ? h(MarkdownToolbar, { t, value: form[activeField] ?? '', onChange: (next) => patch({ [activeField]: next }), areaRef, onEditTemplates }) : null);
		/* 一个 markdown 字段: 富文本框走 Milkdown, 源码框是原来的 textarea(工具栏 + 快捷键挂在它上面) */
		const mdField = (key, extra) =>
			mdLoading
				? h('div', { className: 'rk-mdedit rk-mdfield rk-md-wait' }, t('mdLoading'))
				: h(
						'div',
						{ className: 'rk-mdedit rk-mdfield' },
						h(md.Editor, {
							key: 'qmd-' + key + '-' + seed,
							defaultValue: form[key] ?? '',
							onChange: (next) => patch({ [key]: squeeze(next) }),
							theme: theme === 'light' ? 'light' : 'dark',
							locale: mdLocaleOf(),
							className: 'rk-md-zt',
							placeholder: extra && extra.placeholder ? extra.placeholder : undefined,
						}),
					);
		const textField = (key, extra) => h('textarea', Object.assign({ className: 'rk-textarea' }, extra || {}, field(key)));
		const setOption = (index, text) => {
			setProblem('');
			setForm((prev) => ({ ...prev, options: prev.options.map((row, at) => (at === index ? { text } : row)) }));
		};
		const addOption = () => {
			setProblem('');
			setForm((prev) => (prev.options.length >= OPTION_LETTERS.length ? prev : { ...prev, options: prev.options.concat([{ text: '' }]) }));
		};
		const dropOption = (index) => {
			setProblem('');
			setForm((prev) => {
				if (prev.options.length <= 2) return prev;
				return { ...prev, options: prev.options.filter((row, at) => at !== index) };
			});
		};
		const send = async (keepOpen) => {
			const bad = questionProblem(form, t);
			if (bad !== '') {
				setProblem(bad);
				return;
			}
			setBusy(true);
			setProblem('');
			const result = await onSubmit(questionFields(form), keepOpen);
			setBusy(false);
			if (result && result.error) {
				setProblem(result.error);
				return;
			}
			if (keepOpen) {
				setForm((prev) => ({ ...questionFormFrom({ kind: prev.kind }), kind: prev.kind }));
				setSeed((v) => v + 1);
			}
		};
		const modeSwitch = () =>
			h('div', { className: 'rk-seg', style: { marginLeft: 'auto' } },
				h('button', { className: 'rk-seg-item' + (src ? '' : ' rk-on'), type: 'button', onClick: () => setSrc(false) }, t('modeMd')),
				h('button', { className: 'rk-seg-item' + (src ? ' rk-on' : ''), type: 'button', onClick: () => setSrc(true) }, t('modeSrc')),
			);
		const optionRow = (row, index) => {
			const letter = OPTION_LETTERS[index] || '';
			return h(
				'div',
				{ className: 'rk-qopt', key: 'opt' + index },
				form.kind === 'choice'
					? h('input', {
							type: 'radio',
							name: 'rk-answer',
							checked: form.answerKey === letter,
							onChange: () => patch({ answerKey: letter }),
						})
					: null,
				h('span', { className: 'rk-qopt-key' }, letter),
				h('input', {
					className: 'rk-input',
					value: row.text,
					placeholder: letter + ' 选项内容',
					onChange: (event) => setOption(index, event.target.value),
				}),
				form.options.length > 2 ? h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => dropOption(index) }, t('dropOption')) : null,
			);
		};
		return h(
			'div',
			{ className: 'rk-modal' },
			h(
				'div',
				{ className: 'rk-modal-card rk-qcard', onKeyDown: (event) => { if (event.key === 'Escape') onCancel(); } },
				h(
					'div',
					{ className: 'rk-modal-title' },
					mode === 'new' ? t('qNew') : t('qEdit'),
					from ? h('span', { className: 'rk-qfrom' }, from) : null,
					modeSwitch(),
				),
				/* 左栏: 表单字段 */
				h(
					'div',
					{ className: 'rk-edit-split' },
					h(
						'div',
						{ className: 'rk-edit-col' },
				h(
					'div',
					{ className: 'rk-seg' },
					h(
						'button',
						{ className: 'rk-seg-item' + (form.kind === 'choice' ? ' rk-on' : ''), type: 'button', onClick: () => patch({ kind: 'choice' }) },
						t('kindChoice'),
					),
					h(
						'button',
						{ className: 'rk-seg-item' + (form.kind === 'case' ? ' rk-on' : ''), type: 'button', onClick: () => patch({ kind: 'case' }) },
						t('kindCase'),
					),
				),
				tools(),
				h(
					'div',
					{ className: 'rk-field' },
					h('label', null, t('stemLabel')),
					richMode
						? mdField('stem', { placeholder: '题干……' })
						: textField('stem', { style: { minHeight: 74, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }, placeholder: '题干……' }),
				),
				form.kind === 'choice'
					? h(
							'div',
							{ className: 'rk-field' },
							h('label', null, t('optionsLabel')),
							h('div', { className: 'rk-qhint' }, t('optionHint')),
							form.options.map(optionRow),
							form.options.length < OPTION_LETTERS.length
								? h('div', { className: 'rk-row' }, h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: addOption }, t('addOption')))
								: null,
						)
					: h(
							'div',
							{ className: 'rk-field' },
							h('label', null, t('answerTextLabel')),
							h('div', { className: 'rk-qhint' }, t('answerTextHint')),
							richMode
								? mdField('answerText', { placeholder: '属于**权衡点**。理由：…' })
								: textField('answerText', { style: { minHeight: 200, resize: 'vertical' }, placeholder: '属于**权衡点**。理由：…' }),
						),
				form.kind === 'choice'
					? h(
							'div',
							{ className: 'rk-field' },
							h('label', null, t('explanationLabel')),
							richMode
								? mdField('explanation', { placeholder: '解析……' })
								: textField('explanation', { style: { minHeight: 62, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }, placeholder: '解析……' }),
						)
					: null,
					),
					h(LivePreview, { t, value: questionPreviewMarkdown(form), className: 'rk-preview' }),
				),
				problem !== '' ? h('div', { className: 'rk-qerr' }, problem) : null,
				h(
					'div',
					{ className: 'rk-qfoot' },
					h('span', { className: 'rk-spacer' }),
					h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: onCancel }, t('cancel')),
					mode === 'new' ? h('button', { className: 'rk-btn', type: 'button', disabled: busy, onClick: () => send(true) }, t('saveAndNext')) : null,
					h('button', { className: 'rk-btn rk-primary', type: 'button', disabled: busy, onClick: () => send(false) }, busy ? t('saving') : t('save')),
				),
			),
		);
	}

	/* 编辑知识点: 弹窗里改 标题 / 标签 / 内容(markdown), 需要时再跳到原始 markdown */
	function pointProblem(form, t) {
		if (String(form.title || '').trim() === '') return t('errPointTitle');
		return '';
	}

	function pointError(message, t) {
		const text = String(message || '');
		if (text.includes('empty-title')) return t('errPointTitle');
		if (text.includes('point-not-found') || text.includes('point-key-required')) return t('pointChanged');
		if (text.includes('note-not-found')) return t('pointMissing');
		return text;
	}

	function PointDialog({ t, form: initial, onCancel, onSubmit, onRaw, onEditTemplates, theme }) {
		const [form, setForm] = useState(() => ({
			path: initial.path || '',
			mode: initial.mode || 'file',
			key: initial.key || '',
			title: initial.title || '',
			tags: initial.tags || '',
			body: initial.body || '',
		}));
		const [busy, setBusy] = useState(false);
		const [problem, setProblem] = useState('');
		const patch = (next) => {
			setProblem('');
			setForm((prev) => ({ ...prev, ...next }));
		};
		/* 富文本框(默认) / 源码框: 源码框里 markdown 输入助手照旧可用 */
		const [src, setSrc] = useState(false);
		const [seed, setSeed] = useState(0);
		const md = useMd();
		const mdReady = md.status === 'ready' && !!md.Editor;
		const mdLoading = !src && !mdReady && md.status === 'loading';
		const richMode = !src && mdReady;
		/* markdown 输入助手: 正文这一个字段接工具栏 + 快捷键 */
		const areaRef = useRef(null);
		const field = () => ({
			value: form.body ?? '',
			ref: areaRef,
			onChange: (event) => patch({ body: event.target.value }),
			onFocus: (event) => {
				areaRef.current = event.target;
			},
			onKeyDown: (event) => {
				if (snippetKeyDown && snippetKeyDown({ value: form.body ?? '', onChange: (next) => patch({ body: next }), ref: { current: event.target } }, event)) return;
			},
		});
		const tools = () => (richMode || mdLoading ? null : MarkdownToolbar ? h(MarkdownToolbar, { t, value: form.body ?? '', onChange: (next) => patch({ body: next }), areaRef, onEditTemplates }) : null);
		/* 正文: 富文本框走 Milkdown, 源码框是原来的 textarea */
		const mdField = () =>
			mdLoading
				? h('div', { className: 'rk-mdedit rk-mdfield rk-md-wait' }, t('mdLoading'))
				: h(
						'div',
						{ className: 'rk-mdedit rk-mdfield' },
						h(md.Editor, {
							key: 'pmd-body-' + seed,
							defaultValue: form.body ?? '',
							onChange: (next) => patch({ body: squeeze(next) }),
							theme: theme === 'light' ? 'light' : 'dark',
							locale: mdLocaleOf(),
							className: 'rk-md-zt',
							placeholder: t('pointBodyPlaceholder'),
						}),
					);
		const send = async () => {
			const bad = pointProblem(form, t);
			if (bad !== '') {
				setProblem(bad);
				return;
			}
			setBusy(true);
			setProblem('');
			const result = await onSubmit(form);
			setBusy(false);
			if (result && result.error) setProblem(result.error);
		};
		const modeSwitch = () =>
			h('div', { className: 'rk-seg', style: { marginLeft: 'auto' } },
				h('button', { className: 'rk-seg-item' + (src ? '' : ' rk-on'), type: 'button', onClick: () => setSrc(false) }, t('modeMd')),
				h('button', { className: 'rk-seg-item' + (src ? ' rk-on' : ''), type: 'button', onClick: () => setSrc(true) }, t('modeSrc')),
			);
		return h(
			'div',
			{ className: 'rk-modal' },
			h(
				'div',
				{
					className: 'rk-modal-card rk-pcard',
					onKeyDown: (event) => {
						if (event.key === 'Escape') onCancel();
						if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
							event.preventDefault();
							send();
						}
					},
				},
				h('div', { className: 'rk-modal-title' }, t('pointEdit'), h('span', { className: 'rk-qfrom' }, form.path), modeSwitch()),
				/* 左栏: 表单字段 */
				h(
					'div',
					{ className: 'rk-edit-split' },
					h(
						'div',
						{ className: 'rk-edit-col' },
				h(
					'div',
					{ className: 'rk-field' },
					h('label', null, t('pointTitleLabel')),
					h('input', {
						className: 'rk-input',
						value: form.title,
						autoFocus: true,
						onChange: (event) => patch({ title: event.target.value }),
					}),
				),
				form.mode === 'file'
					? h(
							'div',
							{ className: 'rk-field' },
							h('label', null, t('pointTagsLabel')),
							h('input', {
								className: 'rk-input',
								value: form.tags,
								placeholder: t('pointTagsHint'),
								onChange: (event) => patch({ tags: event.target.value }),
							}),
						)
					: null,
				tools(),
				h(
					'div',
					{ className: 'rk-field rk-grow' },
					h('label', null, t('pointBodyLabel')),
					richMode
						? mdField()
						: h('textarea', {
								className: 'rk-textarea',
								style: { minHeight: 150, resize: 'none', fontFamily: 'var(--rk-mono)', fontSize: 12.5, lineHeight: 1.75 },
								...field(),
								placeholder: t('pointBodyPlaceholder'),
							}),
					h('div', { className: 'rk-qhint' }, t('pointBodyHint')),
				),
					),
					src ? h(LivePreview, { t, value: form.body, className: 'rk-preview' }) : null,
				),
				problem !== '' ? h('div', { className: 'rk-qerr' }, problem) : null,
				h(
					'div',
					{ className: 'rk-qfoot' },
					h('span', { className: 'rk-spacer' }),
					h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: onCancel }, t('cancel')),
					h('button', { className: 'rk-btn rk-primary', type: 'button', disabled: busy, onClick: send }, busy ? t('saving') : t('save')),
				),
			),
		);
	}

	/* Git 提交弹窗: 工作区状态由入口轮询后传进来, 这里只负责展示,
	 * 再把 (提交范围, 提交信息, 是否顺带推送) 抛回给入口去执行。 */
	function GitDialog(props) {
		const { t, scope, status, statusError, busy, result, message, pending, outside, aiBusy, aiCandidates, aiError, onGenerate, onPick, onMessage, onRefresh, onCommit, onPushOnly, onPull, onCancel } = props;
		const files = (status && status.files) || [];
		const counts = (status && status.counts) || { plugin: 0, notes: 0, other: 0, total: 0 };
		const groups = [
			{ key: 'plugin', label: t('gitGroupPlugin') },
			{ key: 'notes', label: t('gitGroupNotes') },
			{ key: 'other', label: t('gitGroupOther') },
		]
			.map((group) => Object.assign({}, group, { items: files.filter((file) => file.group === group.key) }))
			.filter((group) => group.items.length > 0);
		/* git 的 porcelain 双字符码对使用者不友好(?? = 未跟踪的新文件), 这里翻成人话, 原始码留作 title */
		const stateOf = (code) => {
			const pair = String(code || '').padEnd(2, ' ');
			if (pair === '??') return { cls: 'is-new', label: t('gitStateNew') };
			if (/U/.test(pair) || pair === 'AA' || pair === 'DD') return { cls: 'is-del', label: t('gitStateConflict') };
			if (/D/.test(pair)) return { cls: 'is-del', label: t('gitStateDel') };
			if (/R/.test(pair)) return { cls: 'is-mod', label: t('gitStateRen') };
			if (/A/.test(pair)) return { cls: 'is-new', label: t('gitStateNew') };
			return { cls: 'is-mod', label: t('gitStateMod') };
		};
		const sync =
			status && status.upstream
				? status.ahead === 0 && status.behind === 0
					? t('gitSynced')
					: [status.ahead > 0 ? t('gitAhead') + ' ' + status.ahead : '', status.behind > 0 ? t('gitBehind') + ' ' + status.behind : ''].filter(Boolean).join(' · ')
				: '';
		const ready = !!status && status.ok !== false;
		const ahead = (status && status.ahead) || 0;
		/* 面板只提交笔记内容: 能不能提交由 host 给的 pending(笔记范围内的改动数)决定 */
		const canCommit = ready && pending > 0 && message.trim() !== '';
		const canPush = ready && (canCommit || ahead > 0);
		/* 仅推送: 只要本地有「已提交、还没推上去」的东西就可用 */
		const canPushOnly = ready && ahead > 0;
		const canCommitOnly = ready && pending > 0;
		/* 冲突(未解决)的文件: 一个都不许提交, 先让用户在编辑器里解决 */
		const conflictedFiles = files.filter((file) => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(file.code)).map((file) => file.path);
		const conflicted = conflictedFiles.length > 0;
		const canPull = ready && !!status.upstream;
		const info = result && result.data ? result.data : null;
		const bad = !!(result && (result.error || (info && info.ok === false && info.error !== 'nothing-to-commit')));
		let resultText = t('gitHint');
		if (result) {
			if (result.error) resultText = t('gitFailed') + '：' + result.error;
			else if (info && info.ok === false) resultText = info.message || info.error;
			else if (info && info.committed === undefined && info.pushed === undefined && info.action === 'pull')
				resultText = info.upToDate === true ? t('gitUpToDate') : t('gitPulled');
			else if (info && info.committed === undefined && info.pushed === undefined)
				resultText = t('gitPushed'); /* 原始 git 输出由下面的 result 块单独显示, 不再重复 */
			else if (info)
				resultText =
					info.committed === 0 && info.pushed
						? t('gitPushed') + (info.message ? ' · ' + info.message : '')
						: t('gitCommitted') +
							' · ' +
							String(info.committed || 0) +
							(info.hash ? ' · ' + info.hash : '') +
							(info.pushed ? ' · ' + t('gitPushed') : '') +
							(info.subject ? ' · ' + info.subject : '');
		}
		/* 这次提交前/后合并过远程更新, 在结果行里说一声 */
		if (info && info.pull && info.pull.ok === true && info.pull.skipped !== true && info.pull.upToDate !== true) resultText += '（' + t('gitMergedFirst') + '）';
		/* 有冲突没解决: 把文件和提示顶到最前面(提交按钮此时是禁用的) */
		if (conflicted) resultText = t('gitConflictFiles').split('{n}').join(String(conflictedFiles.length)) + ': ' + conflictedFiles.join(', ') + ' —— ' + resultText;
		const send = (push) => {
			if (conflicted) return;
			if (!push && !canCommit) return;
			if (push && !canPush) return;
			onCommit(push);
		};
		return h(
			'div',
			{ className: 'rk-modal' },
			h(
				'div',
				{
					className: 'rk-modal-card rk-gcard',
					onKeyDown: (event) => {
						if (event.key === 'Escape') onCancel();
						if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
							event.preventDefault();
							send(event.shiftKey);
						}
					},
				},
				h('div', { className: 'rk-modal-title' }, t('gitTitle'), ready ? h('span', { className: 'rk-git-sub' }, status.branch + (sync ? ' · ' + sync : '')) : null),
				h(
					'div',
					{ className: 'rk-git' },
					h(
						'div',
						{ className: 'rk-git-meta' },
						ready ? h('span', { className: 'rk-mono' }, status.upstream || 'origin') : null,
						ready && status.lastCommit ? h('span', { className: 'rk-mono' }, t('gitLastCommit') + ' ' + status.lastCommit.hash + ' ' + status.lastCommit.subject) : null,
						ready ? null : h('span', null, statusError || (status && status.message) || t('gitLoadFailed')),
					),
					h(
						'div',
						{ className: 'rk-git-files' },
						groups.length === 0
							? h('div', { className: 'rk-git-empty' }, !ready ? t('gitNoRepo') : t('gitClean'))
							: groups.map((group) =>
									h(
										'div',
										{ key: group.key },
										h('div', { className: 'rk-git-group' }, group.label, h('b', null, group.items.length)),
										group.items.map((file) => {
											const state = stateOf(file.code);
											return h(
												'div',
												{ className: 'rk-git-file', key: file.path },
												h('span', { className: 'rk-git-code ' + state.cls, title: file.code }, state.label),
												h('span', { className: 'rk-git-path' }, file.path),
											);
										}),
									),
								),
						status && status.truncated ? h('div', { className: 'rk-git-empty' }, t('gitTruncated')) : null,
					),
					h(
						'div',
						{ className: 'rk-git-scope' },
						h('span', null, scope === 'all' ? t('gitScopeLibHint') : t('gitScopeNotesHint')),
						outside > 0 ? h('span', { className: 'rk-git-hint' }, t('gitScopeOtherHint') + ' · ' + outside) : null,
					),
					h(
						'div',
						{ className: 'rk-field' },
						h(
							'div',
							{ className: 'rk-git-row' },
							h('label', null, t('gitMessage')),
							h(
								'button',
								{ className: 'rk-btn rk-ghost rk-git-ai', type: 'button', disabled: !!busy || !!aiBusy || !ready || pending === 0, onClick: onGenerate },
								aiBusy ? t('gitAiBusy') : t('gitAiGenerate'),
							),
						),
						h('textarea', {
							className: 'rk-textarea rk-git-msg',
							value: message,
							placeholder: t('gitMessagePlaceholder'),
							disabled: !!busy,
							autoFocus: true,
							onChange: (event) => onMessage(event.target.value),
						}),
						aiCandidates.length > 0 || aiError
							? h(
									'div',
									{ className: 'rk-git-cands' },
									h('div', { className: 'rk-git-label' }, aiError ? t('gitAiFailed') : t('gitAiCandidates')),
									aiError ? h('div', { className: 'rk-git-hint' }, aiError) : null,
									aiCandidates.map((text) =>
										h('button', { key: text, className: 'rk-git-cand' + (message === text ? ' is-on' : ''), type: 'button', onClick: () => onPick(text) }, text),
									),
								)
							: null,
					),
					h('div', { className: 'rk-git-result' + (result ? (bad ? ' is-bad' : ' is-ok') : '') }, resultText, info && info.output ? h('div', { className: 'rk-git-out' }, info.output) : null),
				),
				h(
					'div',
					{ className: 'rk-qfoot' },
					h('button', { className: 'rk-btn rk-ghost', type: 'button', disabled: !!busy, onClick: onRefresh }, t('gitRefresh')),
					h('span', { className: 'rk-spacer' }),
					h('button', { className: 'rk-btn rk-ghost', type: 'button', disabled: !!busy, onClick: onCancel }, t('cancel')),
					h('button', { className: 'rk-btn', type: 'button', disabled: !!busy || !canPull, title: canPull ? t('gitPullHint') : t('gitNoRemote'), onClick: onPull }, busy === 'pull' ? t('gitPulling') : t('gitPull')),
					h('button', { className: 'rk-btn', type: 'button', disabled: !!busy || conflicted || !canPushOnly, title: conflicted ? t('gitPullConflictHint') : canPushOnly ? t('gitPushOnlyHint') : t('gitNoPush'), onClick: onPushOnly }, busy === 'pushonly' ? t('gitPushing') : t('gitPushOnly')),
					h('button', { className: 'rk-btn', type: 'button', disabled: !!busy || conflicted || !canCommit, title: conflicted ? t('gitPullConflictHint') : canCommitOnly ? t('gitCommitOnly') : t('gitNothingToCommitYet'), onClick: () => send(false) }, busy === 'commit' ? t('gitCommitting') : t('gitCommitOnly')),
					h('button', { className: 'rk-btn rk-primary', type: 'button', disabled: !!busy || conflicted || !canPush, title: conflicted ? t('gitPullConflictHint') : undefined, onClick: () => send(true) }, busy === 'push' ? t('gitPushing') : t('gitCommitPush')),
				),
			),
		);
	}

		return { GitDialog, NameDialog, OPTION_LETTERS, questionFormFrom, questionFields, questionPreviewMarkdown, questionProblem, questionError, QuestionDialog, pointProblem, pointError, PointDialog };
}

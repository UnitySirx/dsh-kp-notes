/* rk-study · client/cards.js —— 卡片
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createCards({ React, renderInline, renderMarkdown, formatCount, pathLabel, countExamples, SKINS, sizes }) {
	const h = React.createElement;
	const { useState } = React;
	const S = sizes; /* client/sizes.js 注入: 章节卡片默认宽度与画布卡片保持一致 */
	function AnswerBlock({ markdown, index, t, revealAll }) {
		const [choice, setChoice] = useState(null);
		const open = choice === null ? Boolean(revealAll) : choice;
		return h(
			'div',
			{ className: 'rk-answer' + (open ? ' rk-open' : '') },
			h(
				'button',
				{ className: 'rk-answer-bar', type: 'button', onClick: () => setChoice(!open) },
				h('span', null, open ? '▾' : '▸'),
				h('span', null, open ? t('collapse') : t('reveal')),
				h('span', { className: 'rk-score' }, '#' + (index + 1)),
			),
			open
				? h(
						'div',
						{ className: 'rk-answer-body' },
						renderMarkdown(markdown, 'ans-' + index) || h('p', { className: 'rk-md-p' }, t('emptyBody')),
					)
				: null,
		);
	}

	/**
	 * 删除按钮: 第一次点击进入确认态, 再点「删除」才真正执行.
	 * 用于章节/小节/知识点/题目/文件五处, 由父组件决定调哪个 action.
	 */
	function DeleteButton({ t, label, onConfirm, onError, stop }) {
		const [armed, setArmed] = useState(false);
		const stopIt = (event) => {
			if (stop && event) {
				event.stopPropagation();
				event.preventDefault();
			}
		};
		const fire = async (event) => {
			stopIt(event);
			setArmed(false);
			try {
				await onConfirm();
			} catch (problem) {
				if (onError) onError(problem);
			}
		};
		return h(
			'span',
			{ className: 'rk-del', onClick: stopIt },
			armed
				? h(
						'span',
						{ className: 'rk-del-pop' },
						h('span', { className: 'rk-sec-sub' }, t('delConfirm')),
						h(
							'button',
							{ className: 'rk-btn rk-ghost', type: 'button', onClick: (event) => { stopIt(event); setArmed(false); } },
							t('cancel'),
						),
						h('button', { className: 'rk-btn rk-danger', type: 'button', onClick: fire }, label || t('del')),
					)
				: h(
						'button',
						{
							className: 'rk-btn rk-ghost rk-danger',
							type: 'button',
							title: label || t('del'),
							onClick: (event) => {
								stopIt(event);
								setArmed(true);
							},
						},
						label || t('del'),
					),
		);
	}

	function ExampleBlock({ example, index, t, revealAll, onDelete, onEdit, onError }) {
		return h(
			'div',
			{ className: 'rk-example' },
			h(
				'div',
				{ className: 'rk-example-title' },
				h('span', { className: 'rk-chip rk-brand' }, example.title || t('questions') + ' ' + (index + 1)),
				example.options && example.options.length > 0 ? h('span', { className: 'rk-chip' }, example.options.length + ' 选项') : null,
				example.path ? h('span', { className: 'rk-chip' }, pathLabel(example.path)) : null,
				h(
					'span',
					{ style: { marginLeft: 'auto', display: 'inline-flex', gap: '6px' } },
					onEdit ? h('button', { className: 'rk-btn', type: 'button', onClick: onEdit }, t('editQuestion')) : null,
					onDelete ? h(DeleteButton, { t, label: t('delQuestion'), onConfirm: onDelete, onError }) : null,
				),
			),
			example.stem ? renderMarkdown(example.stem, 'stem-' + index) : null,
			example.options && example.options.length > 0
				? h(
						'div',
						{ className: 'rk-options' },
						example.options.map((option, optionIndex) =>
							h(
								'div',
								{ className: 'rk-option', key: 'opt' + index + '-' + optionIndex },
								h('b', null, option.key),
								h('span', null, renderInline(option.text, 'opt' + index + '-' + optionIndex)),
							),
						),
					)
				: null,
			example.answer ? h(AnswerBlock, { markdown: example.answer, index, t, revealAll }) : null,
		);
	}

	/* 侧栏图标由宿主以 { size, active } 注入(见 ui-sidebar 的 SidebarPanelIconOwnerProps), 跟着走 */
	function PanelIcon({ size = 18 } = {}) {
		return h(
			'svg',
			{
				width: size,
				height: size,
				viewBox: '0 0 24 24',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.6,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
			},
			h('circle', { cx: 5, cy: 6, r: 2 }),
			h('circle', { cx: 5, cy: 18, r: 2 }),
			h('circle', { cx: 19, cy: 12, r: 2 }),
			h('path', { d: 'M7 6h6a3 3 0 0 1 3 3a3 3 0 0 0 3 3' }),
			h('path', { d: 'M7 18h6a3 3 0 0 0 3-3' }),
		);
	}

	/* 逐项配色：从整套皮肤里取色(跳过默认科技蓝), 按序号轮流分配, 相邻的卡片颜色就不同。
	 * 颜色写成元素自己的 CSS 变量, 只有这个元素(和它的子元素)看得见。 */
	/* 逐项配色用的调色板: 跳过 tech(默认那套)与 blueGrey(灰调不够醒目) */
	const CARD_PALETTE = (SKINS || []).filter((item) => item.light && item.id !== 'tech' && item.id !== 'blueGrey');
	function rgbTriple(hex) {
		const n = parseInt(String(hex).replace('#', ''), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
	}
	function toneProps(index, on) {
		if (!on || CARD_PALETTE.length === 0) return null;
		const item = CARD_PALETTE[((index % CARD_PALETTE.length) + CARD_PALETTE.length) % CARD_PALETTE.length];
		return {
			cls: ' rk-tinted',
			vars: {
				'--rk-a1': rgbTriple(item.light),
				'--rk-a2': rgbTriple(item.hex),
				'--rk-a3': rgbTriple(item.light),
				'--rk-accent': item.hex,
				'--rk-accent-2': item.light,
			},
		};
	}

	function ChapterCard({ chapter, t, onOpenSection, onNewSection, onDelete, onDeleteSection, onRename, onError, onContextMenu, x, y, width, tint }) {
		const tone = toneProps(chapter.index, tint);
		return h(
			'div',
			{
				className: 'rk-chapter' + (tone ? tone.cls : ''),
				'data-chapter': chapter.id,
				onContextMenu: (event) => onContextMenu && onContextMenu(event, chapter, null),
				style: Object.assign({ left: x || 0, top: y || 0, width: width || S.canvas.cardWidth }, tone ? tone.vars : null),
			},
			h(
				'div',
				{ className: 'rk-chapter-head' },
				h('div', { className: 'rk-chapter-no' }, String(chapter.index).padStart(2, '0')),
				h(
					'div',
					{ style: { minWidth: 0, flex: '1 1 auto' } },
					h('div', { className: 'rk-chapter-title' }, chapter.title),
					h('div', { className: 'rk-chapter-path' }, chapter.dir === '' ? '/' : chapter.rel),
				),
				chapter.number !== null && chapter.number !== undefined ? h('span', { className: 'rk-chip' }, '#' + chapter.number) : null,
				onRename && chapter.dir !== ''
					? h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => onRename(chapter) }, t('rename'))
					: null,
				onDelete && chapter.dir !== ''
					? h(DeleteButton, { t, label: t('delChapter'), stop: true, onError, onConfirm: () => onDelete(chapter) })
					: null,
			),
			h(
				'div',
				{ className: 'rk-chapter-meta' },
				h('span', null, h('b', null, chapter.stats.sections), ' ' + t('sections')),
				h('span', null, h('b', null, chapter.stats.points), ' ' + t('points')),
				h('span', null, h('b', null, chapter.stats.examples), ' ' + t('examples')),
				h('span', null, h('b', null, formatCount(chapter.stats.words)), ' ' + t('words')),
				chapter.tags && chapter.tags.length > 0 ? h('span', { className: 'rk-chip' }, chapter.tags[0]) : null,
			),
			h(
				'div',
				{ className: 'rk-sections' },
				chapter.sections.length === 0
					? h('div', { className: 'rk-sec', style: { cursor: 'default' } }, h('span', { className: 'rk-sec-sub' }, t('emptyChapter')))
					: chapter.sections.map((section, index) =>
							h(
								'div',
								Object.assign(
									{},
									{
									className: 'rk-sec',
									key: section.path,
									role: 'button',
									onClick: () => onOpenSection(section.path),
									onContextMenu: (event) => onContextMenu && onContextMenu(event, chapter, section),
									},
									(() => {
										const sub = toneProps(chapter.index + index + 1, tint);
										return sub ? Object.assign({ className: 'rk-sec' + sub.cls }, sub.vars) : null;
									})(),
								),
								h('span', { className: 'rk-sec-idx' }, String(index + 1).padStart(2, '0')),
								h(
									'span',
									{ className: 'rk-sec-main' },
									h(
										'span',
										{ className: 'rk-sec-title' },
										section.title,
										section.kind === 'question' ? h('span', { className: 'rk-chip rk-q', style: { marginLeft: 6 } }, t('question')) : null,
									),
									h('span', { className: 'rk-sec-sub' }, section.summary || pathLabel(section.path)),
								),
								h('span', { className: 'rk-chip' }, section.pointsCount + ' ' + t('points')),
								section.examplesCount > 0 ? h('span', { className: 'rk-chip' }, section.examplesCount + ' ' + t('examples')) : null,
								onDeleteSection ? h(DeleteButton, { t, label: t('delSection'), stop: true, onError, onConfirm: () => onDeleteSection(section) }) : null,
								h('span', { className: 'rk-sec-idx' }, '›'),
							),
						),
				h(
					'button',
					{ className: 'rk-sec', type: 'button', onClick: () => onNewSection(chapter.dir) },
					h('span', { className: 'rk-sec-idx' }, '＋'),
					h('span', { className: 'rk-sec-main' }, h('span', { className: 'rk-sec-sub' }, t('newSection'))),
				),
			),
		);
	}

	function PointCard({ point, index, t, onOpen, onDelete, onError, tint }) {
		const tone = toneProps(index + 1, tint);
		const childCount = (point.children || []).length;
		const exampleCount = (point.examples || []).length + countExamples(point.children);
		return h(
			'div',
			{ className: 'rk-point' + (tone ? tone.cls : ''), style: tone ? tone.vars : null, onClick: () => onOpen(point.id) },
			h(
				'div',
				{ className: 'rk-point-head' },
				h('span', { className: 'rk-point-no' }, 'K' + String(index + 1).padStart(2, '0')),
				h('div', { className: 'rk-point-title' }, point.title),
			),
			h('div', { className: 'rk-point-body' }, point.summary || t('emptyBody')),
			h(
				'div',
				{ className: 'rk-point-foot' },
				exampleCount > 0 ? h('span', { className: 'rk-chip rk-brand' }, exampleCount + ' ' + t('questions')) : null,
				childCount > 0 ? h('span', { className: 'rk-chip' }, childCount + ' ' + t('subPoints')) : null,
				point.path ? h('span', { className: 'rk-chip' }, pathLabel(point.path)) : null,
				onDelete && point.path ? h(DeleteButton, { t, label: t('delPoint'), stop: true, onError, onConfirm: () => onDelete(point) }) : null,
				h('span', { className: 'rk-chip' }, 'L' + point.level),
			),
		);
	}

	/* 把知识点正文按「最浅的那一级小标题」切成小知识点(用户口径: 小标题各自成一个小知识点,
	 * 1./2. 这类编号行留在它所属的小知识点里)。代码块里的 # 不算标题。 */
	/* 标题级别 → 2..6, 给「小知识点」的标题定大小与颜色(越浅越醒目) */
	function subLevel(level) {
		const value = Number(level);
		return Math.min(6, Math.max(2, Number.isFinite(value) ? value : 3));
	}

	function splitSubPoints(body) {
		const text = String(body || '');
		const lines = text.split('\n');
		let fence = null;
		let minLevel = 0;
		const marks = [];
		lines.forEach((line, index) => {
			const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
			if (fenceMatch) {
				const token = fenceMatch[1];
				if (fence === null) fence = { char: token[0], len: token.length };
				else if (token[0] === fence.char && token.length >= fence.len) fence = null;
				return;
			}
			if (fence !== null) return;
			const heading = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
			if (!heading) return;
			const level = heading[1].length;
			marks.push({ index, level, title: heading[2].trim() });
			if (minLevel === 0 || level < minLevel) minLevel = level;
		});
		const heads = marks.filter((mark) => mark.level === minLevel);
		if (heads.length === 0) return { intro: text.trim(), items: [] };
		const intro = lines.slice(0, heads[0].index).join('\n').trim();
		const items = heads.map((mark, order) => {
			const end = order + 1 < heads.length ? heads[order + 1].index : lines.length;
			return { title: mark.title, level: mark.level, body: lines.slice(mark.index + 1, end).join('\n').trim() };
		});
		return { intro, items };
	}

	function renderPointBody(point, t, prefix) {
		const sub = splitSubPoints(point.body);
		const nodes = [
			renderMarkdown(sub.intro, prefix) ||
				(sub.items.length > 0 ? null : h('p', { className: 'rk-md-p' }, t('emptyBody'))),
		];
		if (sub.items.length > 0) {
			nodes.push(
				h(
					'div',
					{ key: prefix + '-title', className: 'rk-panel-title', style: { marginTop: 18 } },
					h('b', null, t('subTopics')),
					h('span', { className: 'rk-chip' }, sub.items.length),
				),
			);
			sub.items.forEach((item, index) => {
				nodes.push(
					h(
						'div',
						{ key: prefix + '-st' + index, className: 'rk-subpoint rk-lv' + subLevel(item.level) },
						h(
							'div',
							{ className: 'rk-subpoint-head' },
							h('span', { className: 'rk-chip rk-subpoint-no' }, String(index + 1)),
							h('b', { className: 'rk-subpoint-lv' + subLevel(item.level) }, item.title),
							h('span', { className: 'rk-sec-sub', style: { marginLeft: 'auto' } }, 'H' + item.level),
						),
						renderMarkdown(item.body, prefix + '-s' + index) || h('p', { className: 'rk-md-p' }, t('emptyBody')),
					),
				);
			});
		}
		if (point.truncated) nodes.push(h('div', { key: prefix + '-more', className: 'rk-sec-sub' }, '…'));
		return nodes;
	}

	function PointDetail({ point, t, depth, onDeleteQuestion, onAddQuestion, onEditQuestion, onError }) {
		const [revealAll, setRevealAll] = useState(false);
		const examples = point.examples || [];
		const canAdd = depth === 0 && typeof onAddQuestion === 'function' && !!point.path;
		const cards = (list, prefix) =>
			list.map((example, index) =>
				h(ExampleBlock, {
					key: example.id || prefix + index,
					example,
					index,
					t,
					revealAll,
					onDelete: onDeleteQuestion && example.order ? () => onDeleteQuestion(example, point) : null,
					onEdit: onEditQuestion && example.path ? () => onEditQuestion(example, point) : null,
					onError,
				}),
			);
		const group = (kind, title, list, prefix) => {
			if (list.length === 0 && !canAdd) return null;
			return h(
				'div',
				{ style: { marginTop: 14 } },
				h(
					'div',
					{ className: 'rk-panel-title' },
					h('b', null, title),
					h('span', { className: 'rk-chip' }, list.length),
					list.length > 0 || canAdd
						? h(
								'span',
								{ className: 'rk-row', style: { marginLeft: 'auto' } },
								list.length > 0
									? h(
											'button',
											{ className: 'rk-btn rk-ghost', type: 'button', onClick: () => setRevealAll(!revealAll) },
											revealAll ? t('hideAll') : t('revealAll'),
										)
									: null,
								canAdd
									? h(
											'button',
											{
												className: 'rk-btn',
												type: 'button',
												onClick: () => onAddQuestion(point),
											},
											t('addQuestion'),
										)
									: null,
							)
						: null,
				),
				list.length > 0 ? cards(list, prefix) : h('div', { className: 'rk-sec-sub' }, t('noQuestionYet')),
			);
		};
		return h(
			'div',
			{ className: depth > 0 ? 'rk-panel' : 'rk-doc' },
			depth > 0
				? h(
						'div',
						{ className: 'rk-panel' },
						h('div', { className: 'rk-panel-title' }, h('b', null, point.title), h('span', { className: 'rk-chip' }, 'L' + point.level)),
						renderPointBody(point, t, 'pt-' + point.id)
					)
				: h(
						'div',
						{ className: 'rk-panel' },
						h(
							'div',
							{ className: 'rk-panel-title' },
							h('span', { className: 'rk-chip rk-brand' }, 'K'),
							h('b', null, point.title),
							h('span', { className: 'rk-chip' }, 'L' + point.level),
						),
						renderPointBody(point, t, 'pt-' + point.id)
					),
			examples.length > 0 || canAdd ? group('question', t('questions'), examples, 'pq') : null,
			(point.children || []).length > 0
				? h(
						'div',
						{ className: 'rk-panel-title', style: { marginTop: 18 } },
						h('b', null, t('subPoints')),
						h('span', { className: 'rk-chip' }, (point.children || []).length),
					)
				: null,
			(point.children || []).map((child, index) =>
				h(
					'div',
					{ key: child.id || 'ch' + index, style: { marginTop: 14 } },
					h(PointDetail, { point: child, t, depth: depth + 1, onDeleteQuestion, onError }),
				),
			),
		);
	}

		return { AnswerBlock, DeleteButton, ExampleBlock, PanelIcon, ChapterCard, PointCard, PointDetail, renderPointBody };
}

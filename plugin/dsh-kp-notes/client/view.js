/* 渲染层 —— 从 client.js 的 RkStudyPanel 里搬出来: 右键菜单、一级画布卡片、导图、小节、知识点、正文。
 *
 * 这些函数都是纯读的: 读面板的状态/派生值(视野、导图几何、目录、命中)与各域的动作用来生成 vdom,
 * 自身只有几个 map 里的临时量。所以整块搬走, 依赖由入口按名字注入(与 client/*.js 其余模块同一套范式)。
 * 面板本体那块 JSX(panelRoot)与 currentRootName / headStats / headActions 留在 client.js。
 */
export function createView({ React }) {
	const h = React.createElement;

	function useView({ t, menu, setMenu, closeMenu, menuRef, view, setView, extent, rootCards, rootStats, cardWidth, ROOT_CARD_H, rootCols, cardGap, level1, catalog, needle, hits, mind, mmSizes, positions, onMindMeasure, route, error, loading, current, currentPoint, enterRoot, openRenameRoot, forgetRoot, openNewRoot, openPoint, removeEntry, openSection, startNewSection, removeChapter, startRenameChapter, openEditorForSection, startNewUnit, removeQuestion, editQuestion, setRoute, editPoint, addQuestion, onMindToggle, onCardContextMenu, formatCount, PointCard, flashError, cardColors, MindMap, ChapterCard, DeleteButton, pathLabel, renderMarkdown, ExampleBlock, PointDetail }) {
			const renderMenu = () => {
				if (!menu) return null;
				const confirming = menu.confirming;
				const bodyNodes = confirming
					? [
							h('div', { className: 'rk-menu-confirm', key: 'ask' }, confirming.confirm),
							h(
								'div',
								{ className: 'rk-menu-row', key: 'row' },
								h(
									'button',
									{
										className: 'rk-btn rk-ghost',
										type: 'button',
										key: 'cancel',
										onClick: () => setMenu((value) => (value ? { ...value, confirming: null } : value)),
									},
									t('cancel'),
								),
								h(
									'button',
									{
										className: 'rk-btn rk-danger',
										type: 'button',
										key: 'go',
										onClick: () => {
											closeMenu();
											confirming.run();
										},
									},
									confirming.label,
								),
							),
						]
					: menu.items.map((item, index) =>
							item.sep
								? h('div', { className: 'rk-menu-sep', key: 'sep' + index })
								: h(
										'div',
										{
											className: 'rk-menu-item' + (item.danger ? ' rk-danger' : ''),
											key: item.id,
											role: 'menuitem',
											onClick: () => {
												if (item.confirm) {
													setMenu((value) => (value ? { ...value, confirming: item } : value));
													return;
												}
												closeMenu();
												item.run();
											},
										},
										item.label,
									),
						);
				return h(
					'div',
					{
						className: 'rk-menu',
						ref: menuRef,
						style: { left: menu.x + 'px', top: menu.y + 'px' },
						onContextMenu: (event) => event.preventDefault(),
						onPointerDown: (event) => event.stopPropagation(),
						onClick: (event) => event.stopPropagation(),
					},
					bodyNodes,
				);
			};

			/* 一级画布: 每个学习画布(根目录)一张卡片, 最后一张是「新建」 */
			const renderRootCards = () => {
				const planeStyle = {
					zoom: view.scale > 1.001 ? view.scale : 1,
					transform:
						view.scale > 1.001
							? 'translate(' + Math.round((view.x / view.scale) * 100) / 100 + 'px, ' + Math.round((view.y / view.scale) * 100) / 100 + 'px)'
							: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')',
					width: Math.max(extent.w, 1),
					height: Math.max(extent.h, 1),
				};
				const cards = rootCards.map((card) => {
					const stats = rootStats[card.entry.path];
					const rows = stats
						? [
								[t('chapters'), stats.chapters],
								[t('sections'), stats.sections],
								[t('points'), stats.points],
								[t('examples'), stats.examples],
								[t('words'), formatCount(stats.words)],
							]
						: [];
					return h(
						'div',
						{
							key: card.entry.path,
							className: 'rk-rootcard',
							style: { left: card.x, top: card.y, width: cardWidth, height: ROOT_CARD_H },
							title: card.entry.path,
							onClick: () => enterRoot(card.entry),
						},
						h(
							'div',
							{ className: 'rk-rootcard-head' },
							h('span', { className: 'rk-rootcard-icon' }, '📚'),
							h('b', { className: 'rk-rootcard-name' }, card.entry.name),
						),
						h('div', { className: 'rk-rootcard-path' }, card.entry.path),
						h(
							'div',
							{ className: 'rk-rootcard-stats' },
							rows.length > 0
								? rows.map((row) => h('span', { className: 'rk-rootcard-stat', key: row[0] }, h('b', null, row[1]), row[0]))
								: h('span', { className: 'rk-rootcard-stat' }, t('rootScanning')),
						),
						h(
							'div',
							{ className: 'rk-rootcard-foot' },
							h('span', { className: 'rk-rootcard-enter' }, t('rootEnter') + ' ›'),
							h(
								'button',
								{
									className: 'rk-btn rk-ghost',
									type: 'button',
									onClick: (event) => {
										event.stopPropagation();
										openRenameRoot(card.entry);
									},
								},
								t('rename'),
							),
							h(
								'button',
								{
									className: 'rk-btn rk-danger',
									type: 'button',
									title: t('rootForgetHint'),
									onClick: (event) => {
										event.stopPropagation();
										forgetRoot(card.entry);
									},
								},
								t('rootForget'),
							),
						),
					);
				});
				cards.push(
					h(
						'div',
						{
							key: '__new__',
							className: 'rk-rootcard rk-rootcard-new',
							style: {
								left: (rootCards.length % rootCols) * (cardWidth + cardGap),
								top: Math.floor(rootCards.length / rootCols) * (ROOT_CARD_H + cardGap),
								width: cardWidth,
								height: ROOT_CARD_H,
							},
							onClick: openNewRoot,
						},
						h('div', { className: 'rk-rootcard-plus' }, '＋'),
						h('div', { className: 'rk-rootcard-newlabel' }, t('rootNew')),
						h('div', { className: 'rk-rootcard-hint' }, t('rootNewHint')),
					),
				);
				return h('div', { className: 'rk-plane', style: planeStyle }, cards);
			};

			const renderMap = () => {
				if (level1) return renderRootCards();
				if (!catalog || catalog.chapters.length === 0) {
					return h('div', { className: 'rk-plain' }, h('div', { className: 'rk-empty' }, h('span', null, t('empty')), h('span', { className: 'rk-sec-sub' }, (catalog && catalog.root) || '')));
				}
				if (needle !== '') {
					if (hits.length === 0) return h('div', { className: 'rk-plain' }, h('div', { className: 'rk-empty' }, t('noMatch')));
					return h(
						'div',
						{ className: 'rk-plain' },
						h('div', { className: 'rk-panel-title' }, h('b', null, t('searchHits')), h('span', { className: 'rk-chip' }, hits.length)),
						h(
							'div',
							{ className: 'rk-cardwall' },
							hits.map((hit, index) =>
								h(PointCard, {
									key: hit.point.id + index,
									point: hit.point,
									index,
									t,
									onOpen: () => openPoint(hit.section.path, hit.point.id),
									onDelete: (point) => removeEntry(point.path),
									onError: flashError,
									tint: cardColors,
								}),
							),
						),
					);
				}
				if (mind) {
					return h(
						'div',
						{
							className: 'rk-plane',
							style: {
								/* 100% 及以下用 transform: scale —— 纯视觉缩放, 排版完全不动(字号 / 换行 / 盒子高度都不随缩放变化);
								   放大到 1 倍以上改用 CSS zoom —— 非整数设备像素比(系统显示缩放 1.5 倍之类)下 transform 的位图重采样
								   会让文字发虚(实测 dpr 1.5 / 放大 2 倍时 zoom 的笔画明显更实), 而放大时一屏只有一片正文, 重排可以接受 */
								zoom: view.scale > 1.001 ? view.scale : 1,
								transform: view.scale > 1.001
									? 'translate(' + Math.round((view.x / view.scale) * 100) / 100 + 'px, ' + Math.round((view.y / view.scale) * 100) / 100 + 'px)'
									: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')',
								width: Math.max(mind.width, 1),
								height: Math.max(mind.height, 1),
							},
						},
						h(MindMap, { data: mind, t, heights: mmSizes || {}, scale: view.scale, onMeasure: onMindMeasure, onFold: onMindToggle }),
					);
				}
				const chapters = catalog.chapters;
				return h(
					'div',
					{
						className: 'rk-plane',
						style: {
							/* 和导图同一套: 100% 及以下用 transform: scale(纯视觉缩放, 排版完全不动);
							   放大到 1 倍以上改用 CSS zoom —— 小数设备像素比(系统显示缩放)下 transform 的位图重采样会让文字发虚 */
							zoom: view.scale > 1.001 ? view.scale : 1,
							transform: view.scale > 1.001
								? 'translate(' + Math.round((view.x / view.scale) * 100) / 100 + 'px, ' + Math.round((view.y / view.scale) * 100) / 100 + 'px)'
								: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')',
							width: Math.max(extent.w, 1),
							height: Math.max(extent.h, 1),
						},
					},
					chapters.map((chapter) => {
						const spot = positions[chapter.id] || { x: 0, y: 0 };
						return h(ChapterCard, {
							key: chapter.id,
							chapter,
							t,
							onOpenSection: openSection,
							onNewSection: startNewSection,
							onDelete: removeChapter,
							onDeleteSection: (section) => removeEntry(section.path),
							onRename: startRenameChapter,
							onContextMenu: onCardContextMenu,
							onError: flashError,
							tint: cardColors,
							x: spot.x,
							y: spot.y,
							width: cardWidth,
						});
					}),
				);
			};

			const renderSection = () => {
				if (!current) return h('div', { className: 'rk-empty' }, t('noMatch'));
				const { chapter, section } = current;
				return h(
					'div',
					{ className: 'rk-doc' },
					h(
						'div',
						{ className: 'rk-panel' },
						h(
							'div',
							{ className: 'rk-panel-title' },
							h('span', { className: 'rk-chip' }, chapter.title),
							h('span', { className: 'rk-sec-idx' }, '›'),
							h('b', null, section.title),
							section.kind === 'question' ? h('span', { className: 'rk-chip rk-q' }, t('question')) : null,
							h(
								'span',
								{ className: 'rk-row', style: { marginLeft: 'auto' } },
								h('span', { className: 'rk-chip' }, section.pointsCount + ' ' + t('points')),
								section.examplesCount > 0 ? h('span', { className: 'rk-chip' }, section.examplesCount + ' ' + t('examples')) : null,
								h('span', { className: 'rk-chip' }, formatCount(section.words) + ' ' + t('words')),
								h('button', { className: 'rk-btn', type: 'button', onClick: () => openEditorForSection(section.path) }, t('edit')),
								h('button', { className: 'rk-btn', type: 'button', onClick: () => startNewUnit('newPoint', chapter, section) }, t('newPoint')),
								h(DeleteButton, { t, label: t('delFile'), onError: flashError, onConfirm: () => removeEntry(section.path) }),
							),
						),
						h('div', { className: 'rk-chapter-path' }, pathLabel(section.path) + '.md'),
						section.intro && section.kind !== 'meta' ? h('div', { style: { marginTop: 10 } }, renderMarkdown(section.intro, 'intro')) : null,
					),
					section.points.length === 0
							? h('div', { className: 'rk-empty' }, t('emptyPoints'))
							: h(
									'div',
									{ className: 'rk-cardwall' },
									section.points.map((point, index) =>
										h(PointCard, {
											key: point.id,
											point,
											index,
											t,
											onOpen: (id) => openPoint(section.path, id),
											onDelete: (item) => removeEntry(item.path || section.path),
											onError: flashError,
											tint: cardColors,
										}),
									),
								),
					section.questions && section.questions.length > 0
						? h(
								'div',
								{ style: { marginTop: 18 } },
								h('div', { className: 'rk-panel-title' }, h('b', null, t('questions')), h('span', { className: 'rk-chip' }, section.questions.length)),
								section.questions.map((question, index) =>
									h(ExampleBlock, {
										key: question.id || 'q' + index,
										example: question,
										index,
										t,
										revealAll: false,
										onDelete: question.path && question.order ? () => removeQuestion(question) : null,
										onEdit: question.path ? () => editQuestion(question) : null,
										onError: flashError,
									}),
								),
							)
						: null,
				);
			};

			const renderPoint = () => {
				if (!current || !currentPoint) return h('div', { className: 'rk-empty' }, t('noMatch'));
				const { chapter, section } = current;
				const pointPath = currentPoint.path || section.path;
				/* 头部与「小节详情」同一套(.rk-panel + .rk-panel-title): 位置是 chip › b, 动作在右边那一组,
				 * 挤不下时整组换行(panel-title 自带 flex-wrap) —— 老版用 .rk-crumbs, 它不换行,
				 * 于是窄面板下「返回」被拆成两行、章节名与小节名各折一行、按钮叠在一起 */
				return h(
					'div',
					{ className: 'rk-doc' },
					h(
						'div',
						{ className: 'rk-panel' },
						h(
							'div',
							{ className: 'rk-panel-title' },
							h('span', { className: 'rk-chip' }, chapter.title),
							h('span', { className: 'rk-sec-idx' }, '›'),
							h('b', null, section.title),
							h(
								'span',
								{ className: 'rk-row', style: { marginLeft: 'auto' } },
								h(
									'button',
									{ className: 'rk-btn', type: 'button', onClick: () => setRoute({ view: 'section', path: section.path }) },
									'‹ ' + t('back'),
								),
								h(
									'button',
									{
										className: 'rk-btn',
										type: 'button',
										onClick: () => (currentPoint.path ? editPoint(currentPoint) : openEditorForSection(section.path)),
									},
									t('edit'),
								),
								h(DeleteButton, {
									t,
									label: t('delFile'),
									onError: flashError,
									onConfirm: () => removeEntry(pointPath),
								}),
							),
						),
						h('div', { className: 'rk-chapter-path' }, pathLabel(pointPath) + '.md'),
					),
					h(PointDetail, {
						point: currentPoint,
						t,
						depth: 0,
						onDeleteQuestion: removeQuestion,
						onAddQuestion: addQuestion,
						onEditQuestion: editQuestion,
						onError: flashError,
					}),
				);
			};

			const body = () => {
				if (loading && !catalog) return h('div', { className: 'rk-empty' }, t('loading'));
				if (!catalog) return h('div', { className: 'rk-empty rk-err' }, String(error || 'no data'));
				return renderMap();
			};
			const detailBody = () => (route.view === 'point' ? renderPoint() : renderSection());
		return { renderMenu, renderRootCards, renderMap, renderSection, renderPoint, body, detailBody };
	}

	return { useView };
}

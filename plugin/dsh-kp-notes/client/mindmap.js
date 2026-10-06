/*
 * 思维导图模式: 从左往右的层级树(学习画布 → 章节 → 小节 → 知识点)
 *
 * 布局在这里算完交给入口(入口拿 width/height 当画布内容尺寸, 于是平移/缩放/复位与画布模式共用一套);
 * 这个模块只负责把数据画出来, 不碰视图状态。
 */
function createMindmap(deps) {
	const React = deps.React;
	const renderMarkdown = deps.renderMarkdown;
	const renderPointBody = deps.renderPointBody; /* 引子 + 小知识点分组(与详情面板同一套) */
	const h = React.createElement;

	/* 尺寸来自 client/sizes.js 的 mindmap 段(入口注入): 每层的列位置 / 节点宽高 / 行距
	 * 数组下标 = 层深(根 → 章 → 小节 → 知识点 → 知识点内容), 想调宽度去那里改 */
	const M = deps.sizes.mindmap;
	const COL_X = M.colX;
	const COL_W = M.colW;
	const ROW_H = M.rowH;  /* 内容那层放整篇 markdown, 默认高度只是量出来之前的估值 */
	const ROW_GAP = M.rowGap;
	const GROUP_GAP = M.groupGap; /* 不同父节点的子树之间多留一点, 层次更清楚 */

	const tier = (depth) => Math.min(COL_X.length - 1, Math.max(0, depth));

	/* 目录 + 折叠状态 → 导图数据树(折叠掉的节点仍然保留子节点数量, 以便继续展开)
	 * 知识点分两个节点: 知识点节点只放标题, 它的子节点放这个知识点的整篇正文(默认收起) */
	function buildMindmapTree(catalog, folded, opened, t) {
		const closed = folded || [];
		const open = opened || [];
		const stats = (catalog && catalog.stats) || {};
		const root = {
			id: 'root',
			kind: 'root',
			title: t('mindRoot'),
			chip: (stats.chapters || 0) + ' ' + t('chapters'),
			childCount: ((catalog && catalog.chapters) || []).length,
			section: '',
			children: [],
		};
		((catalog && catalog.chapters) || []).forEach((chapter) => {
			const chapterId = 'c:' + chapter.id;
			const firstSection = (chapter.sections || [])[0];
			const sections = [];
			(chapter.sections || []).forEach((section) => {
				const sectionId = 's:' + section.path;
				const points = [];
				(section.points || []).forEach((point) => {
					const count = (point.examples || []).length;
					const pointId = 'p:' + section.path + '#' + point.id;
					const contentId = 'd:' + section.path + '#' + point.id;
					/* 展开状态记的是知识点节点的 id(折叠按钮长在它身上) */
					const contentOpen = open.indexOf(pointId) >= 0;
					points.push({
						id: pointId,
						kind: 'point',
						title: point.title,
						chip: count > 0 ? count + ' ' + t('questions') : '',
						childCount: 1,
						closed: !contentOpen,
						section: section.path,
						point: point.id,
						children: contentOpen
							? [
									{
										id: contentId,
										kind: 'content',
										title: point.title,
										body: point.body || '',
										truncated: !!point.truncated,
										chip: '',
										childCount: 0,
										closed: false,
										section: section.path,
										point: point.id,
										children: [],
									},
								]
							: [],
					});
				});
				const sectionClosed = closed.indexOf(sectionId) >= 0;
				sections.push({
					id: sectionId,
					kind: 'section',
					title: section.title,
					chip: points.length + ' ' + t('points'),
					childCount: points.length,
					closed: sectionClosed,
					section: section.path,
					children: sectionClosed ? [] : points,
				});
			});
			const chapterClosed = closed.indexOf(chapterId) >= 0;
			root.children.push({
				id: chapterId,
				kind: 'chapter',
				title: chapter.title,
				chip: sections.length + ' ' + t('sections'),
				childCount: sections.length,
				closed: chapterClosed,
				section: firstSection ? firstSection.path : '',
				children: chapterClosed ? [] : sections,
			});
		});
		return root;
	}

	/* 中序遍历排 y: 叶子按行往下走, 父节点居中于首尾子节点之间
	 * heights 是节点被真实渲染后量到的高度(知识点那层要按内容高度排, 不然会互相压住) */
	function layoutMindmap(root, heights) {
		const sizes = heights || {};
		const nodes = [];
		const links = [];
		let cursor = 0;
		const walk = (node, depth) => {
			const level = tier(depth);
			node.depth = depth;
			node.x = COL_X[level];
			node.w = COL_W[level];
			const fixed = sizes[node.id];
			node.measured = Number.isFinite(fixed) && fixed > 0;
			node.h = node.measured ? Math.round(fixed) : ROW_H[level];
			const kids = node.children || [];
			if (kids.length === 0) {
				node.y = cursor;
				cursor += node.h + ROW_GAP[level];
			} else {
				kids.forEach((kid, index) => {
					walk(kid, depth + 1);
					if (index < kids.length - 1) cursor += GROUP_GAP;
				});
				node.y = (kids[0].y + kids[kids.length - 1].y) / 2;
			}
			node.y = Math.round(node.y);
			nodes.push(node);
			kids.forEach((kid) => {
				links.push({
					id: node.id + '>' + kid.id,
					level: tier(kid.depth),
					x1: node.x + node.w,
					y1: node.y + node.h / 2,
					x2: kid.x,
					y2: kid.y + kid.h / 2,
				});
			});
		};
		walk(root, 0);
		let width = 0;
		let height = 0;
		nodes.forEach((node) => {
			width = Math.max(width, node.x + node.w);
			height = Math.max(height, node.y + node.h);
		});
		return { nodes, links, width: width + M.canvasPadX, height: height + M.canvasPadY };
	}

	/* 左→右的三次贝塞尔: 从父节点右边缘拉到子节点左边缘 */
	const linkPath = (link) => {
		const dx = Math.max(16, (link.x2 - link.x1) * 0.46);
		return (
			'M' + link.x1 + ' ' + link.y1 +
			' C' + Math.round(link.x1 + dx) + ' ' + link.y1 +
			', ' + Math.round(link.x2 - dx) + ' ' + link.y2 +
			', ' + link.x2 + ' ' + link.y2
		);
	};

	function MindMap(props) {
		const data = props.data;
		const t = props.t;
		const closed = props.folded || [];
		const heights = props.heights || {};
		const refs = React.useRef({});
		const passes = React.useRef(0);
		const scaleRef = React.useRef(props.scale || 1);
		/* 量每个知识点节点的真实高度, 交给入口重新排版(量到一样高就不再 setState, 避免来回抖) */
		const measure = () => {
			/* 缩放比变了(1 倍以上会换成 CSS zoom ⇒ 正文自然高度会变)就重量一轮 */
			const scale = props.scale || 1;
			if (scaleRef.current !== scale) {
				scaleRef.current = scale;
				passes.current = 0;
			}
			if (passes.current > 8) return;
			const map = {};
			let changed = false;
			Object.keys(refs.current).forEach((id) => {
				const el = refs.current[id];
				if (!el) return;
				const height = el.offsetHeight;
				if (height > 0) map[id] = height;
				if (Math.abs((heights[id] || 0) - height) > 0.5) changed = true;
			});
			if (changed) {
				passes.current += 1;
				props.onMeasure(map);
			}
		};
		React.useLayoutEffect(measure);
		/* 公式与流程图是异步画出来的, 等它们画完再量一次 */
		React.useEffect(() => {
			const timer = setTimeout(measure, 420);
			return () => clearTimeout(timer);
		});
		return h(
			'div',
			{ className: 'rk-mm', style: { width: data.width + 'px', height: data.height + 'px' } },
			h(
				'svg',
				{ className: 'rk-mm-links', width: data.width, height: data.height },
				data.links.map((link) => h('path', { key: link.id, className: 'rk-mm-link rk-mm-lk-t' + link.level, d: linkPath(link) })),
			),
			data.nodes.map((node) => {
				const folded = !!node.closed;
				const canFold = (node.childCount || 0) > 0;
				const rich = node.kind === 'content' && !!node.body && typeof renderMarkdown === 'function';
				return h(
					'div',
					{
						key: node.id,
						ref: rich
							? (el) => {
									if (el) refs.current[node.id] = el;
									else delete refs.current[node.id];
								}
							: null,
						className:
							'rk-mm-node rk-mm-t' + tier(node.depth) +
							(node.kind === 'root' ? ' rk-mm-root' : '') +
							(rich ? ' rk-mm-rich' + (node.measured ? '' : ' rk-mm-auto') : ''),
						/* 富节点(知识点的内容子节点)高度交给内容: zoom 改变时浏览器会按缩放后的字号重新排版, 固定高度会让正文溢出节点 */
						style: { left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: rich ? 'auto' : node.h + 'px' },
						title: node.title,
					},
					canFold
						? h(
								'button',
								{
									className: 'rk-mm-fold',
									type: 'button',
									title: folded ? t('mmUnfold') : t('mmFold'),
									onClick: (event) => {
										event.stopPropagation();
										props.onFold(node);
									},
								},
								folded ? '+' : '−',
							)
						: null,
					rich ? null : h('span', { className: 'rk-mm-text' }, node.title),
					node.chip ? h('span', { className: 'rk-chip' }, node.chip) : null,
					rich
						? h(
								'div',
								{ className: 'rk-mm-body' },
								typeof renderPointBody === 'function'
									? renderPointBody({ body: node.body, truncated: node.truncated }, props.t, 'mm-' + node.id.replace(/[^0-9a-zA-Z]/g, '-'))
									: renderMarkdown(node.body, 'mm-' + node.id.replace(/[^0-9a-zA-Z]/g, '-')),
							)
						: null,
				);
			}),
		);
	}

	return { buildMindmapTree, layoutMindmap, MindMap };
}

export { createMindmap };

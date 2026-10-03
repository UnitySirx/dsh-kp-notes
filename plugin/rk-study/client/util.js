/* rk-study · client/util.js —— 工具
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createUtil(deps) {
	/* ------------------------------------------------------------ pieces */

	/* 让缩放值和平移量落在整数设备像素上: 否则整个画布被重采样, 放大后文字发虚 */
	function snapToDevice(value) {
		const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
		return Math.round(value * dpr) / dpr;
	}

	function roundScale(value) {
		return Math.round(value * 1000) / 1000;
	}

	function formatCount(value) {
		if (value === undefined || value === null) return '0';
		if (value >= 10000) return (value / 10000).toFixed(1) + 'w';
		return String(value);
	}

	function pathLabel(path) {
		return String(path || '').replace(/\.(md|markdown)$/i, '');
	}

	function flattenPoints(points, depth, out) {
		const list = out || [];
		(points || []).forEach((point) => {
			list.push(point);
			flattenPoints(point.children, (depth || 0) + 1, list);
		});
		return list;
	}

	function findSection(catalog, path) {
		if (!catalog || !catalog.chapters) return null;
		for (const chapter of catalog.chapters) {
			for (const section of chapter.sections) {
				if (section.path === path) return { chapter, section };
			}
		}
		return null;
	}

	function findPoint(points, id) {
		for (const point of points || []) {
			if (point.id === id) return point;
			const found = findPoint(point.children, id);
			if (found) return found;
		}
		return null;
	}

	/* 编辑器要知道自己在编辑什么: 章节说明 / 小节 / 知识点 / 题目 */
	function kindOfPath(catalog, relPath) {
		const path = String(relPath || '');
		if (path === '') return '';
		if (/(^|\/)questions\//.test(path)) return 'question';
		let found = '';
		((catalog && catalog.chapters) || []).forEach((chapter) => {
			(chapter.sections || []).forEach((section) => {
				if (section.path === path) found = 'section';
				flattenPoints(section.points, 0, []).forEach((point) => {
					if (point.path === path) found = 'point';
				});
			});
		});
		return found;
	}

	/* 给编辑器状态补上 kind: 新建文件按模式判断, 已存在文件按路径查目录 */
	function editorState(state, catalog) {
		if (!state) return state;
		const kind =
			state.mode === 'newPoint'
				? 'point'
				: state.mode === 'newSection'
					? 'section'
					: kindOfPath(catalog, state.path);
		return Object.assign({}, state, { kind });
	}

	function countExamples(points) {
		return (points || []).reduce(
			(total, point) => total + (point.examples ? point.examples.length : 0) + countExamples(point.children),
			0,
		);
	}

		return { snapToDevice, roundScale, formatCount, pathLabel, flattenPoints, findSection, findPoint, kindOfPath, editorState, countExamples };
}

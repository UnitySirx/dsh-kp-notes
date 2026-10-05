/*
 * dsh-kp-notes — 客户端「本机 localStorage + 学习库配置文件」的持久化。
 *
 * 这里收着三类东西:
 *   1. 画布列表与每张画布的统计(roots / rootStats);
 *   2. 「移出列表」的墓碑(removed): 磁盘一个文件都不动, 只是本机与库配置里记一笔 —— 本机那份在
 *      localStorage, 库那份走 api 的 readRemoved/writeRemoved;
 *   3. 配置: 学习库那一份 <库>/.config/rk-study.json(配色 / 画布列表 / 移出列表 / 一级画布的视野),
 *      画布自己那一份 <画布>/.config/rk-study.json(它自己的视野 + 字号 —— 跟着画布走)。
 *      localStorage 也照写一份(打开就能立刻看到), 这两个文件负责「换浏览器 / 换机器 / 换人接手时还在」;
 *      写是 500ms 合并一次的补丁, 一次操作只落一次盘。
 *
 * 依赖一律从外面传进来(deps 里是 React 与 api 模块的成员), 模块之间不互相 import。
 */
export function createStore({ React, api, FONT_STEPS, KEYS }) {
	const { useState, useEffect, useRef, useCallback } = React;
	const { readRoots, writeRoots, readRemoved, writeRemoved, readDefaultRoot, postLibConfig, fetchCatalogOf } = api;
	const { FONT_KEY, SKIN_KEY, ITEM_KEY, THEME_KEY } = KEYS;

	function useStore() {
		/* 一级画布: 画布列表 + 每张画布的统计 */
		const [roots, setRoots] = useState(() => readRoots());
		const [rootStats, setRootStats] = useState({});
		const [rootTick, setRootTick] = useState(0);

		/* 浏览器 localStorage 是本机即时状态(打开就能立刻看到): 画布列表 / 上次停在哪张画布 /
		 * 移出列表的墓碑 / 字号 / 配色 / 画布还是导图 / 逐项配色 / 导图折叠。
		 * 其中视野与字号同时写进 .config 的配置文件(见下面的 saveLib), 其余只在本机。
		 * 弹窗位置属于临时状态, 不落盘。 */

		/* 「移出列表」的画布 = 墓碑: 扫盘 / 重新扫描 / 导入都不会再加回来; 磁盘一个文件都不动。
		 * 在同一个路径重新建画布、或重新导入这个库时解除。 */
		const removedRef = useRef(null);
		if (removedRef.current === null) removedRef.current = readRemoved();
		const isRemoved = (path) => removedRef.current.indexOf(path) >= 0;
		const markRemoved = (path) => {
			if (isRemoved(path)) return;
			removedRef.current = removedRef.current.concat([path]);
			writeRemoved(removedRef.current);
			saveLib({ removed: removedRef.current });
		};
		const unmarkRemoved = (path) => {
			if (!isRemoved(path)) return;
			removedRef.current = removedRef.current.filter((item) => item !== path);
			writeRemoved(removedRef.current);
			saveLib({ removed: removedRef.current });
		};
		/* 配置(<库>/.config/rk-study.json 与 <画布>/.config/rk-study.json): 存视野缩放 / 字号 / 配色 /
		 * 画布列表 / 移出列表。localStorage 照写一份(打开就能立刻看到), 这两个文件负责「换浏览器 / 换机器 /
		 * 换人接手时还在」。写是 500ms 合并一次的补丁(一次操作只落一次盘); 还没读到文件时先不写, 免得用默认值把它盖掉。 */
		const [libRev, setLibRev] = useState(0);
		const [libTick, setLibTick] = useState(0);
		const libZoomRef = useRef(null);
		const libReadyRef = useRef(false);
		const libPatchesRef = useRef({});
		const libTimerRef = useRef(0);
		const toastTimerRef = useRef(0);
		const libLoadRef = useRef(null);
		/* 现在停在哪张画布: 视野 / 字号按画布各存一份, 落点由它决定(null = 一级画布 ⇒ 记进学习库那份配置) */
		const workRootRef = useRef(null);
		const setWorkRoot = useCallback((root) => {
			workRootRef.current = typeof root === 'string' && root !== '' ? root : null;
		}, []);
		/* 本机已经存过哪些外观设置: 存过就以本机为准(同一个人的即时状态), 没存过(换台机器)才用文件里的 */
		const hadLocalUiRef = useRef(null);
		if (hadLocalUiRef.current === null) {
			let font = null;
			let look = null;
			let item = null;
			let mode = null;
			try {
				font = window.localStorage.getItem(FONT_KEY);
				look = window.localStorage.getItem(SKIN_KEY);
				item = window.localStorage.getItem(ITEM_KEY);
				mode = window.localStorage.getItem(THEME_KEY);
			} catch (problem) {
				/* 存储不可用 ⇒ 当成本地没有 */
			}
			hadLocalUiRef.current = { fontScale: font !== null, skin: look !== null, cardColors: item !== null, theme: mode !== null };
		}
		const flushLib = useCallback(() => {
			libTimerRef.current = 0;
			const lib = readDefaultRoot();
			const patch = libPatchesRef.current;
			libPatchesRef.current = {};
			if (!libReadyRef.current || Object.keys(patch).length === 0) return;
			/* 视野(zoom)与字号(ui.fontScale)按画布各存一份: 停在哪张画布就写进那张画布自己的
			 * .config/rk-study.json(跟着画布走); 其余键(canvases / removed / 配色 …)与停在一级画布时的
			 * 东西一律写学习库那份。zoom 的键是「哪个工作区的视野」: 与本张画布同路径的才归它自己。 */
			const work = workRootRef.current;
			const own = {};
			const rest = {};
			for (const key of Object.keys(patch)) {
				if (key !== 'zoom' && key !== 'ui') {
					rest[key] = patch[key];
					continue;
				}
				if (key === 'zoom') {
					const zoom = patch.zoom && typeof patch.zoom === 'object' ? patch.zoom : {};
					for (const name of Object.keys(zoom)) {
						if (work && name === work) own.zoom = { [name]: zoom[name] };
						else (rest.zoom = rest.zoom || {})[name] = zoom[name];
					}
					continue;
				}
				const ui = patch.ui && typeof patch.ui === 'object' ? patch.ui : {};
				for (const name of Object.keys(ui)) {
					if (work && name === 'fontScale') (own.ui = own.ui || {})[name] = ui[name];
					else (rest.ui = rest.ui || {})[name] = ui[name];
				}
			}
			if (work && Object.keys(own).length > 0) {
				postLibConfig(work, own).catch(() => {
					/* 画布那份写不动就算了, 本机 localStorage 照样能用 */
				});
			}
			if (!lib || Object.keys(rest).length === 0) return;
			postLibConfig(lib, rest).catch(() => {
				/* 写不动就算了, 本机 localStorage 照样能用 */
			});
		}, []);
		/* 卸载时把还没发的库配置写入取消掉, 免得插件停用后还发一个 POST /rk-study/config */
		useEffect(
			() => () => {
				if (libTimerRef.current) {
					window.clearTimeout(libTimerRef.current);
					libTimerRef.current = 0;
				}
			},
			[],
		);
		const saveLib = useCallback((patch) => {
			if (!libReadyRef.current) return; /* 还没读到库配置: 先别用默认值把它盖掉 */
			const acc = libPatchesRef.current;
			const incoming = patch || {};
			for (const key of Object.keys(incoming)) {
				const value = incoming[key];
				const plain = value && typeof value === 'object' && !Array.isArray(value);
				const base = plain && acc[key] && typeof acc[key] === 'object' && !Array.isArray(acc[key]);
				acc[key] = base ? { ...acc[key], ...value } : value;
			}
			if (Object.keys(acc).length === 0) return;
			if (libTimerRef.current) return;
			libTimerRef.current = window.setTimeout(flushLib, 500);
		}, [flushLib]);
		/* 画布列表变了: localStorage 与学习库的配置一起写(canvases) */
		const saveRoots = useCallback((list) => {
			writeRoots(list);
			saveLib({ canvases: list });
		}, [saveLib]);

		const [toast, setToast] = useState(null);
		/* 字号: 根节点用 zoom 等比放大/缩小, 布局与画布一起变, 不需要改上百条 px 样式 */
		const [fontScale, setFontScale] = useState(() => {
			try {
				const saved = Number(window.localStorage.getItem(FONT_KEY));
				return FONT_STEPS.indexOf(saved) >= 0 ? saved : 100;
			} catch (problem) {
				return 100;
			}
		});
		const zoomRef = useRef(1);
		zoomRef.current = fontScale / 100;
		useEffect(() => {
			try {
				window.localStorage.setItem(FONT_KEY, String(fontScale));
			} catch (problem) {
				/* 存不上就算了, 不影响使用 */
			}
			saveLib({ ui: { fontScale } });
		}, [fontScale, libTick, saveLib]);
		const stepFont = useCallback((direction) => {
			setFontScale((value) => {
				const at = FONT_STEPS.indexOf(value);
				if (at < 0) return 100;
				return FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, at + direction))];
			});
		}, []);

		const flash = useCallback((message) => {
			setToast(message);
			if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
			toastTimerRef.current = window.setTimeout(() => {
				toastTimerRef.current = 0;
				setToast(null);
			}, 2400);
		}, []);
		useEffect(
			() => () => {
				if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
				toastTimerRef.current = 0;
			},
			[],
		);

		const loadRootStats = useCallback((list) => {
			Promise.all(
				list.map(async (entry) => {
					try {
						const data = await fetchCatalogOf(entry.path);
						return { path: entry.path, stats: (data && data.stats) || null };
					} catch {
						return { path: entry.path, stats: null };
					}
				}),
			).then((rows) => {
				const next = {};
				rows.forEach((row) => {
					if (row) next[row.path] = row.stats;
				});
				setRootStats(next);
			});
		}, []);

		return {
			roots,
			setRoots,
			rootStats,
			setRootStats,
			rootTick,
			setRootTick,
			isRemoved,
			markRemoved,
			unmarkRemoved,
			libRev,
			setLibRev,
			libTick,
			setLibTick,
			libZoomRef,
			libReadyRef,
			libPatchesRef,
			libLoadRef,
			hadLocalUiRef,
			flushLib,
			saveLib,
			setWorkRoot,
			saveRoots,
			fontScale,
			setFontScale,
			zoomRef,
			stepFont,
			toast,
			setToast,
			flash,
			loadRootStats,
		};
	}

	return { useStore };
}

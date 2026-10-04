/*
 * rk-study — Client half.
 *
 * 画布：大章节卡片（一个目录 = 一章）→ 小节 → 知识点卡片（正文抽出来渲染，不显示 markdown 源码）
 * 题目答案默认遮挡，点一下才展开；并且可以直接在插件里新建 / 编辑 markdown。
 */
window.__ModuleLoader__.load({
	id: 'dsh-kp-notes',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React;
		/* 客户端模块表(seed)里还有这几个: zt-react-milkdown 编辑器要跟插件共用同一个 react 实例,
		 * 所以从这里 require 出来交给 client/milkdown.js(那个 chunk 自己拿不到 require) */
		const ReactDOM = require('react-dom');
		const ReactDOMClient = require('react-dom/client');
		const JsxRuntime = require('react/jsx-runtime');

		const NS = 'rkStudy';
		const PANEL_ID = 'rk-study';
		const ROUTE = '/rk-study/notes';
		const POLL_MS = 10000;
		const GIT_ROUTE = '/rk-study/git';
		const GIT_POLL_MS = 20000;
		/* 字号档位(百分比): 面板根节点整体 zoom 缩放, 所以这个值也要参与画布的坐标换算 */
		const FONT_STEPS = [85, 100, 115, 130, 145, 160];
		const FONT_KEY = 'rk-study:font-scale';
		/* 配色皮肤: 只换 .rk-root 上的一组 CSS 变量(见 client/css.js 的 SKINS), 记在本地 */
		const SKIN_KEY = 'rk-study:skin';
		/* 主题: dark / light / auto(跟随系统 prefers-color-scheme), 也记在本地 */
		const THEME_KEY = 'rk-study:theme';
	const ITEM_KEY = 'rk-study:card-colors';
		/* 模式: 画布 / 思维导图(章节 → 小节 → 知识点, 左→右); 导图里折叠了哪些节点也记在本地 */
		const MODE_KEY = 'rk-study:mode';
		const FOLD_KEY = 'rk-study:map-fold';
		const OPEN_KEY = 'rk-study:map-open';
		/* 全屏专注: 把宿主(DSH)的左右侧栏藏起来, 画布占满整个窗口; 开关记在本地, 刷新后回到原样 */
		const FOCUS_KEY = 'rk-study:focus';
		/* 只读不写: 老版本把「弹出成独立窗体」的状态存在这里, 升级时读一次折成专注模式 */
		const LEGACY_WIN_KEY = 'rk-study:window';
		function readFocus() {
			try {
				const raw = window.localStorage.getItem(FOCUS_KEY);
				if (raw === '1') return true;
				if (raw === '0') return false;
				/* 老版本「弹出成独立窗体」开着的话, 顺势升级成专注模式 */
				const legacy = JSON.parse(window.localStorage.getItem(LEGACY_WIN_KEY) || 'null');
				return !!(legacy && legacy.floating === true);
			} catch (problem) {
				return false;
			}
		}

		/* 宿主的原生目录选择窗体(uiWorkspace.pickDirectory); apply() 里填, 没装就是 null */
		const dirPicker = { pick: null };

		/* 注入本插件自己的样式表:
		 * 这里用不了动态 runner 环境里的 styles.insert —— 静态 __ModuleLoader__ factory 只拿到 require。
		 * 所以自己插 <style>, 但把它的生命周期交给 ctx.effect: 插件停用/热重载时随 fiber 一起摘掉,
		 * 而不是依赖 loader 对 data-plugin-css 约定的回收(那份清册是在 apply() 之前记账的, 收不到这个标签)。 */
		function ensureStyles(ctx, CSS) {
			return ctx.effect(() => {
				if (typeof document === 'undefined') return () => {};
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-kp-notes';
				tag.dataset.pluginCss = 'dsh-kp-notes/rk-study.css';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					if (tag.parentNode) tag.parentNode.removeChild(tag);
				};
			}, 'rk-study: styles');
		}

		/* --------------------------------------------------------------- net */

		/* 多学习画布(多根目录): 每个请求都带上当前画布的根目录; 一级画布(rootPath 为空)时不带, 走插件默认根目录。
		 * activeRoot 只活在这一个页面会话里: 以前它同时写进 localStorage('rk-study:root'), 于是每次刷新 /
		 * 重开页面都会被送回上次那张画布; 现在一律从「全部画布」这一级打开, 想进哪张自己点进去。 */
		const ROOTS_KEY = 'rk-study:roots';
		const DEFAULT_ROOT_KEY = 'rk-study:default-root';
		const ROOTS_ROUTE = '/rk-study/roots';
		const CONFIG_ROUTE = '/rk-study/config';
		const STATE_ROUTE = '/rk-study/state'; /* 插件级状态: 落盘那份由 host 存在 DSH 数据目录里 */ /* 学习库那一级的配置: <库>/.config/rk-study.json */
		let activeRoot = null;

		function baseNameOf(path) {
			const parts = String(path || '').split('/').filter(Boolean);
			return parts.length > 0 ? parts[parts.length - 1] : String(path || '');
		}

		/* 列表里只有「路径 + 显示名」, 都在浏览器本地; 磁盘上的笔记目录是另一回事(移出列表不删文件) */
		function readRoots() {
			try {
				const raw = JSON.parse(window.localStorage.getItem(ROOTS_KEY) || '[]');
				if (!Array.isArray(raw)) return [];
				return raw
					.filter((entry) => entry && typeof entry.path === 'string' && entry.path.charAt(0) === '/')
					.map((entry) => ({ path: entry.path, name: String(entry.name || '').trim() || baseNameOf(entry.path) }));
			} catch {
				return [];
			}
		}

		function writeRoots(list) {
			try {
				window.localStorage.setItem(ROOTS_KEY, JSON.stringify(list));
			} catch {
				/* 存不下也无所谓: 本次会话里仍然可用 */
			}
		}

		/* 「移出列表」的墓碑(黑名单): 只记在浏览器里, 扫盘 / 重新扫描 / 导入都跳过这些路径 */
		const REMOVED_KEY = 'rk-study:removed-roots';

		function readRemoved() {
			try {
				const raw = JSON.parse(window.localStorage.getItem(REMOVED_KEY) || '[]');
				if (!Array.isArray(raw)) return [];
				return raw.filter((path) => typeof path === 'string' && path.charAt(0) === '/');
			} catch (problem) {
				return [];
			}
		}

		function writeRemoved(list) {
			try {
				window.localStorage.setItem(REMOVED_KEY, JSON.stringify(list));
			} catch (problem) {
				/* 存不下也无所谓: 本次会话里仍然有效 */
			}
		}

		/* 默认学习画布根目录: 只记在浏览器本地; 一级画布列表为空时用它, 「＋ 新建学习画布」也默认建议在它的上一级建 */
		function readDefaultRoot() {
			try {
				const path = String(window.localStorage.getItem(DEFAULT_ROOT_KEY) || '').trim();
				return path.charAt(0) === '/' ? path.replace(/\/+$/, '') || '/' : '';
			} catch {
				return '';
			}
		}

		function writeDefaultRoot(path) {
			try {
				if (path) window.localStorage.setItem(DEFAULT_ROOT_KEY, path);
				else window.localStorage.removeItem(DEFAULT_ROOT_KEY);
			} catch {
				/* 存不下也无所谓 */
			}
		}

		function withRootFor(url, root) {
			if (!root) return url;
			return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'root=' + encodeURIComponent(root);
		}

		function withRootQuery(url) {
			return withRootFor(url, activeRoot);
		}

		function routeUrl(params, root) {
			const url = new URL(ROUTE, window.location.origin);
			const use = root === undefined ? activeRoot : root;
			if (use) url.searchParams.set('root', use);
			if (params) {
				Object.keys(params).forEach((key) => {
					if (params[key] !== undefined && params[key] !== null) url.searchParams.set(key, String(params[key]));
				});
			}
			return url.toString();
		}

		async function fetchCatalog(force) {
			const response = await fetch(routeUrl(force ? { force: 1 } : null), { headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error('HTTP ' + response.status);
			return response.json();
		}

		/* 一级画布: 每个画布卡片要看的统计(带 root 参数再读一次目录) */
		async function fetchCatalogOf(root) {
			const response = await fetch(routeUrl(null, root), { headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error('HTTP ' + response.status);
			return response.json();
		}

		async function fetchRoots() {
			const response = await fetch(ROOTS_ROUTE, { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		/* 一级画布的新建 / 导入 / 改名(改名 = host 直接把磁盘目录改名) */
		async function postRoot(payload) {
			const response = await fetch(ROOTS_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) {
				const problem = new Error(data.message || data.error || 'HTTP ' + response.status);
				problem.code = data.error || '';
				throw problem;
			}
			return data;
		}

		/* 学习库的配置(<库>/.config/rk-study.json): 视野缩放 / 字号 / 配色 / 画布列表 / 移出列表。
		 * 单张画布自己一个字节都不写盘; 库那一级「有哪些画布、看多大」跟着这个文件走。 */
		async function fetchLibConfig(lib) {
			const url = new URL(CONFIG_ROUTE, window.location.origin);
			url.searchParams.set('root', lib);
			const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) return {}; /* 没有 / 读不动就当空的, 不影响使用 */
			return (data && data.config) || {};
		}

		async function postLibConfig(lib, patch) {
			const url = new URL(CONFIG_ROUTE, window.location.origin);
			url.searchParams.set('root', lib);
			const response = await fetch(url.toString(), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		/* 插件级状态(落盘那份在 <DSH_HOME>/rk-study/state.json):
		 * 只镜像这四项 —— 画布列表 / 学习库 / 上次停在哪张 / 移出列表。外观那些跟着学习库的 .config 走,
		 * 不用在这里再存一遍。localStorage 一被清掉(换浏览器 / 清缓存 / 宿主换端口), 这一份就把目录找回来。 */
		const STATE_KEYS = [
			['roots', ROOTS_KEY],
			['defaultRoot', DEFAULT_ROOT_KEY],
			['removed', REMOVED_KEY],
		];

		function readLocalState() {
			const out = {};
			for (const [name, key] of STATE_KEYS) {
				let value = null;
				try {
					value = window.localStorage.getItem(key);
				} catch (problem) {
					value = null;
				}
				if (value === null) continue;
				if (name === 'roots' || name === 'removed') {
					try {
						out[name] = JSON.parse(value);
					} catch (problem) {
						/* 坏了就不带这一项, 免得把好状态覆盖成空 */
					}
					continue;
				}
				out[name] = value;
			}
			return out;
		}

		async function fetchState() {
			const response = await fetch(STATE_ROUTE, { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) return {};
			return (data && typeof data.state === 'object' && data.state !== null ? data.state : {}) || {};
		}

		async function postState(state) {
			const response = await fetch(STATE_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ state }),
			});
			if (!response.ok) throw new Error('HTTP ' + response.status);
			return response.json().catch(() => ({}));
		}
		/* 扫一个目录下的一级画布(带 notes/ 或 questions/ 的子目录) —— 导入 / 重新扫描都用它 */
		async function fetchLibrary(path) {
			const url = new URL(ROOTS_ROUTE, window.location.origin);
			url.searchParams.set('path', path);
			const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		async function fetchFile(path) {
			const response = await fetch(routeUrl({ file: path }), { headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error('HTTP ' + response.status);
			return response.json();
		}

		async function fetchPoint(path, key) {
			const response = await fetch(routeUrl({ point: path, key }), { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok || data.ok === false) throw new Error(data.error || data.message || 'HTTP ' + response.status);
			return data;
		}

		async function postAction(payload) {
			const response = await fetch(routeUrl(null), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		async function fetchGit(root, scope) {
			const response = await fetch(withRootFor(GIT_ROUTE + '?scope=' + (scope === 'all' ? 'all' : 'notes'), root), { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		async function postGit(payload, root) {
			const response = await fetch(withRootFor(GIT_ROUTE, root), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.message || data.error || 'HTTP ' + response.status);
			return data;
		}

		/* git 状态很轻, 但没必要跟笔记扫描的高频轮询绑在一起: 20s 一轮 + 窗口重新聚焦时补一次 */
		function useGit(enabled, root, scope) {
			const [state, setState] = useState({ data: null, error: null, loading: true });
			const load = useCallback(async () => {
				try {
					const data = await fetchGit(root, scope);
					setState({ data, error: null, loading: false });
				} catch (error) {
					setState((prev) => ({ data: prev.data, error: (error && error.message) || String(error), loading: false }));
				}
			}, [root, scope]);
			/* 一级画布(还没选学习库)时没有根目录, 拉了也没意义 —— 不轮询, 也跟笔记轮询一样只在窗口可见时拉 */
			useEffect(() => {
				if (!enabled) return undefined;
				load();
				const timer = setInterval(() => {
					if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
				}, GIT_POLL_MS);
				const onFocus = () => {
					if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
				};
				window.addEventListener('focus', onFocus);
				return () => {
					clearInterval(timer);
					window.removeEventListener('focus', onFocus);
				};
			}, [load, enabled]);
			return { data: state.data, error: state.error, loading: state.loading, reload: load };
		}

		/* 一级画布提交整个库, 画布上只提交笔记; 想要更好的措辞点「✦ AI 生成」 */
		function defaultGitMessage(t, status, scope) {
			const counts = (status && status.counts) || { plugin: 0, notes: 0, other: 0, total: 0 };
			if (scope === 'all') return t('gitMsgLibrary');
			return counts.notes > 0 ? t('gitMsgNotes') : t('gitMsgOther');
		}

		function useCatalog() {
			const [state, setState] = useState({ data: null, error: null, loading: true });
			const load = useCallback(async (force) => {
				try {
					const data = await fetchCatalog(force === true);
					setState({ data, error: null, loading: false });
				} catch (error) {
					setState((prev) => ({ data: prev.data, error: (error && error.message) || String(error), loading: false }));
				}
			}, []);
			useEffect(() => {
				load(false);
				const timer = setInterval(() => {
					if (typeof document === 'undefined' || document.visibilityState === 'visible') load(false);
				}, POLL_MS);
				const onFocus = () => load(false);
				window.addEventListener('focus', onFocus);
				return () => {
					clearInterval(timer);
					window.removeEventListener('focus', onFocus);
				};
			}, [load]);
			return { data: state.data, error: state.error, loading: state.loading, reload: load };
		}

		function RkStudyPanel(props) {
			const t = props.t;
			/* 组件与工具函数都在 chunk 里(见 client.*.js), 由 apply() 注入; */
			/* 这里一次性解出来, 面板里原来的引用一行都不用改。 */
			const {
				ChapterCard,
				DeleteButton,
				Editor,
				ExampleBlock,
				GitDialog,
				NameDialog,
				PointCard,
				PointDetail,
				PointDialog,
				QuestionDialog,
				editorState,
				findPoint,
				findSection,
				flattenPoints,
				formatCount,
				pathLabel,
				pointError,
				questionError,
				renderMarkdown,
				roundScale,
				snapToDevice,
				SKINS,
				MindMap,
				buildMindmapTree,
				layoutMindmap,
			} = props.mods;
			const { data, error, loading, reload } = useCatalog();
			/* 一级画布: 多个「学习画布」(各自一个根目录); rootPath 为空 = 停在全部画布 */
			const [roots, setRoots] = useState(() => readRoots());
			const [rootPath, setRootPath] = useState(() => activeRoot);
			/* 一级画布上 git 查的是整个学习库(库目录 + scope=all), 画布上查的是这张画布自己的 notes/ */
			const libPath = readDefaultRoot();
			const level1 = rootPath === null;
			/* Git 提交统一挂在根节点画布(一级画布)上: 目标根 = 学习库目录, 范围 = 全部 ⇒ 一次提交整个库 */
			const gitRoot = level1 ? libPath : rootPath;
			const gitScope = level1 ? 'all' : 'notes';
			const { data: gitData, error: gitError, reload: gitReload } = useGit(gitRoot !== '', gitRoot, gitScope);
			const [rootInfo, setRootInfo] = useState(null);
			const [rootStats, setRootStats] = useState({});
			const [rootTick, setRootTick] = useState(0);
			const [rootDialog, setRootDialog] = useState(null);
			const [libraryDialog, setLibraryDialog] = useState(null);

			/* 设置一律只留在浏览器 localStorage 里(画布目录里不写配置文件):
			 * 画布列表 / 上次停在哪张画布 / 移出列表的墓碑 / 字号 / 配色 / 画布还是导图 / 逐项配色 / 导图折叠。
			 * 视野位置与弹窗位置属于临时状态, 不落盘。 */

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
			/* 学习库的配置(<库>/.config/rk-study.json): 存视野缩放 / 字号 / 配色 / 画布列表 / 移出列表。
			 * localStorage 照写一份(打开就能立刻看到), 这个文件负责「换浏览器 / 换机器 / 换人接手时还在」。
			 * 写是 500ms 合并一次的补丁(一次操作只落一次盘); 还没读到这个文件时先不写, 免得用默认值把它盖掉。 */
			const [libRev, setLibRev] = useState(0);
			const [libTick, setLibTick] = useState(0);
			const libZoomRef = useRef(null);
			const libReadyRef = useRef(false);
			const libPatchesRef = useRef({});
			const libTimerRef = useRef(0);
			const toastTimerRef = useRef(0);
			const libLoadRef = useRef(null);
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
				if (!lib || !libReadyRef.current || Object.keys(patch).length === 0) return;
				postLibConfig(lib, patch).catch(() => {
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

			const [gitOpen, setGitOpen] = useState(false);
			const [gitBusy, setGitBusy] = useState(null);
			const [gitResult, setGitResult] = useState(null);
			const [gitForm, setGitForm] = useState({ scope: 'notes', message: '' });
			const [gitAi, setGitAi] = useState({ busy: false, candidates: [], error: null });
			const [route, setRoute] = useState({ view: 'map' });
			const [query, setQuery] = useState('');
			const [view, setView] = useState({ x: 26, y: 22, scale: 1 });
			const [panning, setPanning] = useState(false);
			const [measureTick, setMeasureTick] = useState(0);
			const stageRef = useRef(null);
			const ringRef = useRef(null);
			const hoverRef = useRef(null);
			const panRef = useRef(null);
			const measured = useRef({});
			const didFit = useRef(false);
			const mapFits = useRef(0); /* 导图: 进入后自动 fit 的次数(最多两次: 先按当前高度、量稳后再来一次) */
			const userMoved = useRef(false); /* 用户自己缩放过/拖过视野 ⇒ 之后不再自动 fit(展开知识点也绝不能把视野复位) */
			const [editor, setEditor] = useState(null);
			const [nameDialog, setNameDialog] = useState(null);
			const [pointDialog, setPointDialog] = useState(null);
			const [questionDialog, setQuestionDialog] = useState(null);
			const [saving, setSaving] = useState(false);
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
			/* 配色: 参考 Material Design 色板, 点色块即换(整套变量换掉, 布局不动) */
			const [skin, setSkin] = useState(() => {
				try {
					return window.localStorage.getItem(SKIN_KEY) || 'tech';
				} catch (problem) {
					return 'tech';
				}
			});
			const [skinOpen, setSkinOpen] = useState(false);
			/* 宿主(DeepSeek Harness)现在是深色还是浅色: body[data-ds-dark-theme] 是权威标记,
			 * 其次是 html[data-ds-theme-source], 都没有就退到 color-scheme / 系统偏好。 */
			function readHostDark() {
				try {
					if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true;
					const source = document.documentElement ? document.documentElement.getAttribute('data-ds-theme-source') : null;
					if (source === 'dark') return true;
					if (source === 'light') return false;
					const scheme = (window.getComputedStyle(document.documentElement).colorScheme || '').trim();
					const first = scheme.split(/\s+/)[0];
					if (first === 'dark') return true;
					if (first === 'light') return false;
					return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
				} catch (problem) {
					return true;
				}
			}
			/* 把宿主的 brand 主色拆成 "r g b" 三元组: 插件里到处是 rgba(var(--rk-a1), x) 这种淡色,
			 * 这样它们也跟着平台的强调色走, 而不是插件自己的色相。 */
			function hostBrandTriplet() {
				try {
					const brand = (window.getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary') || '').trim();
					if (brand === '') return null;
					const probe = document.createElement('span');
					probe.style.color = brand;
					probe.style.display = 'none';
					document.body.appendChild(probe);
					const rgb = window.getComputedStyle(probe).color;
					document.body.removeChild(probe);
					const found = /rgba?\(([^)]+)\)/.exec(rgb);
					if (!found) return null;
					const nums = found[1].split(',').slice(0, 3).map((n) => Math.round(parseFloat(n)));
					if (nums.length !== 3 || nums.some((n) => !isFinite(n))) return null;
					return nums.join(' ');
				} catch (problem) {
					return null;
				}
			}
			/* 主题: 插件配色(默认, 就是原来那套深色) / 跟随主题。跟随主题 = 底色 / 文字 / 线条全部用
			 * 当前 DeepSeek Harness 的主题 token, 强调色取宿主的 brand 色, 插件不再自己上色;
			 * 宿主切明暗(或系统外观变化)时立刻跟着换, 不用刷新页面。 */
			const [theme, setTheme] = useState(() => {
				try {
					const saved = window.localStorage.getItem(THEME_KEY);
					return saved === 'follow' || saved === 'light' || saved === 'auto' ? 'follow' : 'plugin';
				} catch (problem) {
					return 'plugin';
				}
			});
			const [hostDark, setHostDark] = useState(() => readHostDark());
			useEffect(() => {
				const sync = () => setHostDark(readHostDark());
				sync();
				let watcher = null;
				if (window.MutationObserver) {
					watcher = new window.MutationObserver(sync);
					watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source', 'class', 'style'] });
					if (document.body) watcher.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] });
				}
				let media = null;
				const onMedia = () => sync();
				if (window.matchMedia) {
					media = window.matchMedia('(prefers-color-scheme: dark)');
					if (media.addEventListener) media.addEventListener('change', onMedia);
					else if (media.addListener) media.addListener(onMedia);
				}
				return () => {
					if (watcher) watcher.disconnect();
					if (media) {
						if (media.removeEventListener) media.removeEventListener('change', onMedia);
						else if (media.removeListener) media.removeListener(onMedia);
					}
				};
			}, []);
			const follow = theme === 'follow';
			const mdTheme = follow ? (hostDark ? 'dark' : 'light') : 'dark';
			/* 卡片各用一色: 章节卡 / 小节行 / 知识点卡各自带一个强调色, 免得一屏全是一个颜色 */
			const [cardColors, setCardColors] = useState(() => {
				try {
					return window.localStorage.getItem(ITEM_KEY) !== '0';
				} catch (problem) {
					return true;
				}
			});
			/* 画布 / 思维导图: 模式与导图里折叠的节点都记在本地 */
			const [mode, setMode] = useState(() => {
				try {
					return window.localStorage.getItem(MODE_KEY) === 'map' ? 'map' : 'canvas';
				} catch (problem) {
					return 'canvas';
				}
			});
			const [folded, setFolded] = useState(() => {
				try {
					const saved = JSON.parse(window.localStorage.getItem(FOLD_KEY) || '[]');
					return Array.isArray(saved) ? saved : [];
				} catch (problem) {
					return [];
				}
			});
			/* 知识点内容节点默认收起, 所以这里记的是「被展开」的那些 id */
			const [opened, setOpened] = useState(() => {
				try {
					const saved = JSON.parse(window.localStorage.getItem(OPEN_KEY) || '[]');
					/* 同一时刻只允许展开一个知识点的正文: 旧数据里有多个也只留最后一个 */
					return Array.isArray(saved) ? saved.slice(-1) : [];
				} catch (problem) {
					return [];
				}
			});
			useEffect(() => {
				try {
					window.localStorage.setItem(MODE_KEY, mode);
				} catch (problem) {
					/* 存储不可用就算了 */
				}
			}, [mode]);
			useEffect(() => {
				try {
					window.localStorage.setItem(FOLD_KEY, JSON.stringify(folded));
				} catch (problem) {
					/* 存储不可用就算了 */
				}
			}, [folded]);
			useEffect(() => {
				try {
					window.localStorage.setItem(OPEN_KEY, JSON.stringify(opened));
				} catch (problem) {
					/* 存储不可用就算了 */
				}
			}, [opened]);
			const skinBoxRef = useRef(null);
			const skinList = SKINS || [];
			const skinHex = (skinList.find((item) => item.id === skin) || skinList[0] || { hex: '#3fb6ff' }).hex;
			useEffect(() => {
				try {
					window.localStorage.setItem(SKIN_KEY, skin);
				} catch (problem) {
					/* 存不上就算了, 不影响使用 */
				}
				saveLib({ ui: { skin } });
			}, [skin, libTick, saveLib]);
			useEffect(() => {
				try {
					window.localStorage.setItem(THEME_KEY, theme);
				} catch (problem) {
					/* 存不上就算了, 不影响使用 */
				}
				saveLib({ ui: { theme } });
			}, [theme, libTick, saveLib]);
			/* 图表(mermaid)配色也跟主题走: 设置一次, 已经画出来的图会自己重画 */
			useEffect(() => {
				const mods = props.mods;
				if (mods && typeof mods.setMermaidTheme === 'function') mods.setMermaidTheme(mdTheme);
			}, [mdTheme, props.mods]);
			/* 跟随主题时, 把宿主 brand 色填进插件的 --rk-a1..a3; 切回插件配色就把这几个变量撤掉 */
			useEffect(() => {
				const root = document.documentElement;
				if (!root || !root.style) return;
				const keys = ['--rk-a1', '--rk-a2', '--rk-a3'];
				if (!follow) {
					keys.forEach((key) => root.style.removeProperty(key));
					return;
				}
				const triplet = hostBrandTriplet();
				if (triplet === null) return;
				keys.forEach((key) => root.style.setProperty(key, triplet));
			}, [follow, hostDark]);
			useEffect(() => {
				try {
					window.localStorage.setItem(ITEM_KEY, cardColors ? '1' : '0');
				} catch (problem) {
					/* 存不上就算了, 不影响使用 */
				}
				saveLib({ ui: { cardColors } });
			}, [cardColors, libTick, saveLib]);
			/* 读一次学习库的配置: 视野缩放 / 字号 / 配色 / 画布列表 / 移出列表。
			 * 一级画布列表会 await 这个 promise(libLoadRef); 视野恢复会用到 libZoomRef。 */
			useEffect(() => {
				const lib = readDefaultRoot();
				libReadyRef.current = false;
				if (!lib) {
					libReadyRef.current = true;
					libLoadRef.current = Promise.resolve({});
					/* 也要踢一次, 否则一级画布那个「首次铺满」effect 等不到信号 */
					setLibTick((value) => value + 1);
					return undefined;
				}
				let alive = true;
				libLoadRef.current = fetchLibConfig(lib)
					.then((saved) => {
						const file = saved && typeof saved === 'object' ? saved : {};
						if (!alive) return file;
						libZoomRef.current = file.zoom && typeof file.zoom === 'object' ? file.zoom : {};
						/* 移出列表取并集: 墓碑宁多勿少 */
						let changed = false;
						for (const path of Array.isArray(file.removed) ? file.removed : []) {
							if (typeof path !== 'string' || path.charAt(0) !== '/' || removedRef.current.indexOf(path) >= 0) continue;
							removedRef.current = removedRef.current.concat([path]);
							changed = true;
						}
						if (changed) writeRemoved(removedRef.current);
						/* 字号 / 配色: 本机存过就以本机为准, 没存过(换台机器)才用文件里的 */
						const ui = file.ui && typeof file.ui === 'object' ? file.ui : {};
						const had = hadLocalUiRef.current || {};
						if (!had.fontScale && FONT_STEPS.indexOf(Number(ui.fontScale)) >= 0) setFontScale(Number(ui.fontScale));
						if (!had.skin && typeof ui.skin === 'string' && ui.skin !== '') setSkin(ui.skin);
						if (!had.theme && typeof ui.theme === 'string') setTheme(ui.theme === 'follow' || ui.theme === 'light' || ui.theme === 'auto' ? 'follow' : 'plugin');
						if (!had.cardColors && typeof ui.cardColors === 'boolean') setCardColors(ui.cardColors);
						libReadyRef.current = true;
						setLibTick((value) => value + 1);
						/* 顺手把这个库当前的画布列表写回去(文件不存在就建出来) */
						postLibConfig(lib, { canvases: readRoots() }).catch(() => {});
						return file;
					})
					.catch(() => {
						libReadyRef.current = true;
						return {};
					});
				return () => {
					alive = false;
				};
			}, [libRev]);
			/* 启动时把落盘那份状态补进 localStorage: 只补「本机没有」的键(本机存过的以本机为准),
			 * 画布列表与墓碑取并集。补完踢一次 libRev / rootTick, 让「读库配置」与扫盘按新状态重跑。 */
			const stateReadyRef = useRef(false);
			useEffect(() => {
				let alive = true;
				/* 老版本把「上次停在哪张画布」存进 localStorage('rk-study:root'), 现在不读了 —— 顺手清掉,
				 * 免得以后有人 grep 到这个键以为它还有用。 */
				try {
					window.localStorage.removeItem('rk-study:root');
				} catch {
					/* 清不掉也无所谓: 反正没人再读它 */
				}
				fetchState()
					.then((saved) => {
						if (!alive) return;
						stateReadyRef.current = true;
						if (!saved || typeof saved !== 'object') return;
						let touched = false;
						const local = readRoots();
						const merged = local.slice();
						for (const item of Array.isArray(saved.roots) ? saved.roots : []) {
							const path = typeof item === 'string' ? item : item && item.path;
							if (typeof path !== 'string' || path.charAt(0) !== '/') continue;
							if (merged.some((entry) => entry.path === path)) continue;
							merged.push({ path, name: String((item && item.name) || '').trim() || baseNameOf(path) });
						}
						if (merged.length !== local.length) {
							writeRoots(merged);
							setRoots(merged);
							touched = true;
						}
						const tomb = readRemoved();
						let grew = false;
						for (const path of Array.isArray(saved.removed) ? saved.removed : []) {
							if (typeof path !== 'string' || path.charAt(0) !== '/' || tomb.indexOf(path) >= 0) continue;
							tomb.push(path);
							grew = true;
						}
						if (grew) {
							removedRef.current = tomb;
							writeRemoved(tomb);
							touched = true;
						}
						if (!readDefaultRoot() && typeof saved.defaultRoot === 'string' && saved.defaultRoot.charAt(0) === '/') {
							writeDefaultRoot(saved.defaultRoot);
							setLibRev((value) => value + 1);
							touched = true;
						}
						/* activeRoot 不再补齐: 打开面板就停在「全部画布」这一级 */
						if (touched) setRootTick((value) => value + 1);
					})
					.catch(() => {
						stateReadyRef.current = true;
						/* 读不到就当没有: 与以前一样, 只是这次没有兜底状态 */
					});
				return () => {
					alive = false;
				};
			}, []);
			/* 落盘镜像: 这四项变了就推一次(host 那边是合并写, 只覆盖这几项, 不会把库配置那份盖掉)。
			 * 等首次补齐读完再开, 免得拿空值把好状态覆盖掉。 */
			const statePushedRef = useRef('');
			useEffect(() => {
				const timer = window.setInterval(() => {
					if (!stateReadyRef.current) return;
					const snapshot = readLocalState();
					const text = JSON.stringify(snapshot);
					if (text === statePushedRef.current) return;
					statePushedRef.current = text;
					postState(snapshot).catch(() => {
						/* 推不上去就算了: 本机 localStorage 照样能用 */
					});
				}, 900);
				return () => window.clearInterval(timer);
			}, []);			useEffect(() => {
				if (!skinOpen) return undefined;
				const onDown = (event) => {
					if (skinBoxRef.current && !skinBoxRef.current.contains(event.target)) setSkinOpen(false);
				};
				const onKey = (event) => {
					if (event.key === 'Escape') setSkinOpen(false);
				};
				window.addEventListener('pointerdown', onDown, true);
				window.addEventListener('keydown', onKey, true);
				return () => {
					window.removeEventListener('pointerdown', onDown, true);
					window.removeEventListener('keydown', onKey, true);
				};
			}, [skinOpen]);

			/* ---- 全屏专注: 藏掉宿主的左右侧栏, 画布占满整个窗口 ---- */
			const [focused, setFocused] = useState(() => readFocus());
			const toggleFocus = useCallback(() => setFocused((value) => !value), []);
			useEffect(() => {
				try {
					window.localStorage.setItem(FOCUS_KEY, focused ? '1' : '0');
				} catch (problem) {
					/* 存不上就算了, 不影响使用 */
				}
			}, [focused]);
			/* 宿主的壳是一个网格(侧栏 | 中列 | 右栏), 网格列由它的 React 内联样式决定 ——
			 * 所以真正的隐藏规则写在 client/css.js 里(用 !important 压过内联样式), 这里只负责
			 * 在 <html> 上挂开关、并在外框上做个记号, 免得选择器去猜那个 CSS-module 的哈希类名。 */
			useEffect(() => {
				const html = document.documentElement;
				const marked = [];
				if (focused) {
					html.classList.add('rk-focus');
					try {
						const self = document.querySelector('.rk-root');
						const center = self && self.closest ? self.closest('[class*="centerCol"]') : null;
						const frame = center ? center.parentElement : null;
						if (frame) {
							frame.setAttribute('data-rk-focus', '');
							marked.push(frame);
						}
					} catch (problem) {
						/* 宿主换结构了也不至于崩: 顶多全屏没生效 */
					}
				} else {
					html.classList.remove('rk-focus');
				}
				return () => {
					html.classList.remove('rk-focus');
					marked.forEach((node) => node.removeAttribute('data-rk-focus'));
				};
			}, [focused]);
			/* Esc 也能退出全屏 —— 弹窗开着时先让弹窗自己关, 正在输入框里打字也不抢 */
			useEffect(() => {
				if (!focused) return undefined;
				const onKey = (event) => {
					if (event.key !== 'Escape') return;
					const node = event.target;
					if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable === true)) return;
					if (document.querySelector('.rk-modal') !== null) return;
					setFocused(false);
				};
				window.addEventListener('keydown', onKey, true);
				return () => window.removeEventListener('keydown', onKey, true);
			}, [focused]);

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
			/* ---- 一级画布(多学习画布) ---- */

			/* 换画布: 记住当前根目录(只给本次会话的请求用), 回到画布视图, 并让目录立刻重拉一次。
			 * 不再写 localStorage / 状态文件 —— 下次打开一律从「全部画布」开始。 */
			useEffect(() => {
				activeRoot = rootPath;
				setRoute({ view: 'map' });
				setQuery('');
				/* 换画布 / 回一级画布: 视图复位一次, 让新的一屏重新铺满(否则会沿用上一张画布的平移缩放) */
				didFit.current = false;
				mapFits.current = 0;
				userMoved.current = false;
				setView({ x: 26, y: 22, scale: 1 });
				reload(true);
			}, [rootPath, reload]);

			/* 每个画布卡片的统计: 各带自己的 root 读一次目录(host 的缓存是按 root 分桶的) */
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

			/* 停在全部画布时: 问 host 要默认根目录 / 建议父目录, 把默认画布并进列表, 再逐个读统计 */
			useEffect(() => {
				if (!level1) return undefined;
				let alive = true;
				(async () => {
					try {
						const info = await fetchRoots();
						if (!alive) return;
						setRootInfo(info);
						/* 列表 = localStorage 记着的 + 学习库目录扫出来的(跳过被手动移出的墓碑), 合并去重。
						 * 先到先得: 本地记着的名字(用户改过名)优先于扫盘得到的目录名。 */
						const list = readRoots().filter((entry) => !isRemoved(entry.path));
						const library = readDefaultRoot();
						/* 学习库的配置里也记着画布列表(换台机器时照它恢复) */
						const file = (await libLoadRef.current) || {};
						const fromFile = [];
						for (const item of Array.isArray(file.canvases) ? file.canvases : []) {
							const itemPath = typeof item === 'string' ? item : item && item.path;
							if (typeof itemPath !== 'string' || itemPath.charAt(0) !== '/') continue;
							if (list.some((entry) => entry.path === itemPath)) continue;
							if (fromFile.some((entry) => entry.path === itemPath)) continue;
							fromFile.push({ path: itemPath, name: String((item && item.name) || '').trim() || baseNameOf(itemPath) });
						}
						let base = list.concat(fromFile);
						if (library) {
							try {
								const scan = await fetchLibrary(library);
								const found = (scan && Array.isArray(scan.canvases) ? scan.canvases : []).map((item) => ({ path: item.path, name: item.name }));
								const merged = [];
								for (const item of [...list, ...found]) {
									if (!item || typeof item.path !== 'string' || item.path.charAt(0) !== '/') continue;
									if (isRemoved(item.path)) continue;
									if (merged.some((entry) => entry.path === item.path)) continue;
									merged.push({ path: item.path, name: String(item.name || '').trim() || baseNameOf(item.path) });
								}
								base = merged;
							} catch (problem) {
								base = list;
							}
						}
						if (!alive) return;
						/* 重新扫描: 磁盘上已经不在的画布直接从列表里拿掉(只改列表, 一个文件都不动) */
						const probes = await Promise.all(base.map((entry) => probeRoot(entry.path)));
						if (!alive) return;
						const gone = base.filter((entry, index) => probes[index] === false);
						const kept = base.filter((entry, index) => probes[index] !== false);
						saveRoots(kept); /* 扫盘结果同步到 localStorage 与学习库配置 */
						setRoots(kept);
						loadRootStats(kept);
						if (gone.length > 0) {
							flash(t('rootGone').split('{n}').join(String(gone.length)));
						} else if (rootTick > 0) {
							flash(t('rootRescanned'));
						}
					} catch (error) {
						if (alive) flash(String((error && error.message) || error));
					}
				})();
				return () => {
					alive = false;
				};
			}, [level1, rootTick, loadRootStats, flash]);

			const enterRoot = (entry) => setRootPath(entry.path);
			const leaveRoot = () => setRootPath(null);
			const openNewRoot = () => setRootDialog({ mode: 'new', name: '', path: '', busy: false, error: null });
			const openRenameRoot = (entry) => setRootDialog({ mode: 'rename', name: entry.name, path: entry.path, busy: false, error: null });
			/* 新学习画布的默认落点: 导入学习库时记下的那个目录(新画布都建在它下面); 没导入过就用 host 建议的父目录 */
			const canvasParent = () => readDefaultRoot() || (rootInfo && rootInfo.suggestParent) || '/';

			/* 磁盘上这张画布还在不在 —— host 的 ?path= 浏览接口会带回 exists */
			const probeRoot = async (path) => {
				try {
					const data = await fetchLibrary(path);
					return !data || data.exists !== false;
				} catch (error) {
					return true;
				}
			};

			/* 「移出列表」= 把画布目录移到同一层的 .remove/ 里(内容原样保留, 想恢复手工移回上一层),
			 * 再记成墓碑从列表里拿掉。移动失败(比如没权限)也只是记墓碑, 不挡用户。 */
			const forgetRoot = async (entry) => {
				try {
					await postRoot({ action: 'remove', path: entry.path });
				} catch (error) {
					/* 移动不成功也照样移出列表 */
				}
				markRemoved(entry.path);
				const list = roots.filter((item) => item.path !== entry.path);
				setRoots(list);
				saveRoots(list);
				loadRootStats(list);
				/* 这个画布没了, 它的视野记录顺手删掉 */
				saveLib({ zoom: { [entry.path]: null } });
				flash(t('rootRemoved'));
			};

			const submitRootDialog = async () => {
				const dialog = rootDialog;
				if (!dialog || dialog.busy) return;
				const name = String(dialog.name || '').trim();
				if (dialog.mode === 'rename') {
					if (name === '') {
						setRootDialog({ ...dialog, error: t('rootNeedName') });
						return;
					}
					setRootDialog({ ...dialog, busy: true, error: null });
					try {
						/* 改名 = 直接重命名磁盘目录(目录名就是画布名), 列表里的路径跟着换 */
						const result = await postRoot({ action: 'rename', path: dialog.path, name });
						const list = roots.map((item) => (item.path === dialog.path ? { ...item, path: result.root, name } : item));
						setRoots(list);
						saveRoots(list);
						/* 换路径了: 旧路径的视野记在库配置里, 顺手删掉那份 */
						saveLib({ zoom: { [dialog.path]: null } });
						if (rootPath === dialog.path) setRootPath(result.root);
						setRootDialog(null);
						loadRootStats(list);
						flash(t('rootRenamed'));
					} catch (error) {
						const code = (error && error.code) || '';
						const fallback = String((error && error.message) || error);
						setRootDialog({ ...dialog, busy: false, error: code === 'name-taken' ? t('rootNameTaken') : fallback });
					}
					return;
				}
				const path = String(dialog.path || '').trim() || (name ? canvasParent() + '/' + name : '');
				if (path === '') {
					setRootDialog({ ...dialog, error: t('rootNeedPath') });
					return;
				}
				setRootDialog({ ...dialog, busy: true, error: null });
				try {
					/* 画布建在学习库里时, 模板写进那个库的 .templates, 画布自己不再存一份 */
					const library = readDefaultRoot();
					const payload = { path, name };
					if (library && (path === library || path.indexOf(library + '/') === 0)) payload.library = library;
					const result = await postRoot(payload);
					const created = { path: result.root, name: name || result.name || baseNameOf(result.root) };
					/* 在同一个路径重新建画布 ⇒ 解除墓碑 */
					unmarkRemoved(created.path);
					const list = roots.some((item) => item.path === created.path) ? roots : roots.concat([created]);
					setRoots(list);
					saveRoots(list);
					setRootDialog(null);
					loadRootStats(list);
					flash(t('rootCreated'));
				} catch (error) {
					const code = (error && error.code) || '';
					const fallback = String((error && error.message) || error);
					setRootDialog({ ...dialog, busy: false, error: code === 'name-taken' ? t('rootNameTaken') : fallback });
				}
			};

			/* ---- 导入目录: 一个输入框 + 一个「选择…」按钮(弹宿主的原生目录选择窗体) ---- */
			const openImportLib = () => {
				setLibraryDialog({ path: readDefaultRoot() || '', busy: false, picking: false, error: null });
			};

			/* 弹宿主的目录选择窗体(uiWorkspace.pickDirectory), 选中后把绝对路径填进输入框 */
			const chooseLibraryDir = async () => {
				const dialog = libraryDialog;
				if (!dialog || dialog.busy || dialog.picking) return;
				if (typeof dirPicker.pick !== 'function') {
					setLibraryDialog({ ...dialog, error: t('libNoPicker') });
					return;
				}
				setLibraryDialog({ ...dialog, picking: true, error: null });
				try {
					const picked = await dirPicker.pick();
					setLibraryDialog((current) => {
						if (!current) return current;
						const path = String(picked || '').trim().replace(/\/+$/, '');
						return { ...current, picking: false, error: null, path: path === '' ? current.path : path };
					});
				} catch (error) {
					setLibraryDialog((current) =>
						current ? { ...current, picking: false, error: String((error && error.message) || error) } : current,
					);
				}
			};

			const runImportLib = async () => {
				const dialog = libraryDialog;
				if (!dialog || dialog.busy) return;
				const path = String(dialog.path || '').trim().replace(/\/+$/, '') || '/';
				if (path.charAt(0) !== '/') {
					setLibraryDialog({ ...dialog, error: t('libNeedAbs') });
					return;
				}
				setLibraryDialog({ ...dialog, busy: true, error: null });
				try {
					const result = await postRoot({ path, action: 'import' });
					if (!result || result.ok === false) throw new Error((result && result.message) || 'import failed');
					/* 导入 = 用户明确要这个库 ⇒ 清掉这些画布的墓碑, 再和这次扫盘的结果合并 */
					unmarkRemoved(path);
					const list = readRoots().slice();
					let added = 0;
					for (const item of result.canvases || []) {
						if (!item || typeof item.path !== 'string' || item.path.charAt(0) !== '/') continue;
						unmarkRemoved(item.path);
						if (list.some((entry) => entry.path === item.path)) continue;
						list.push({ path: item.path, name: String(item.name || '').trim() || baseNameOf(item.path) });
						added += 1;
					}
					saveRoots(list);
					setRoots(list.slice());
					loadRootStats(list);
					setLibraryDialog(null);
					/* 这个目录本身就是一张画布 ⇒ 只登记进列表, 不写盘、也不拿它当库(host 那半边判断的) */
					if (result.canvas) {
						flash(t('libImportedCanvas').split('{n}').join(baseNameOf(path) || path));
						return;
					}
					/* 导入的这个目录从此就是这个库: 以后新建的画布默认建在它下面, 模板也共用它的 .templates */
					writeDefaultRoot(path);
					setLibRev((value) => value + 1); /* 换库了: 重新读一次这个库的 .config */
					flash(added > 0 ? t('libImported').split('{n}').join(String(added)) : t('libImportedNone'));
				} catch (error) {
					setLibraryDialog({ ...dialog, busy: false, error: String((error && error.message) || error) });
				}
			};

			const renderLibraryDialog = () => {
				return h(
					'div',
					{ className: 'rk-modal', onClick: () => setLibraryDialog(null) },
					h(
						'div',
						{ className: 'rk-modal-card rk-settings', onClick: (event) => event.stopPropagation() },
						h('div', { className: 'rk-modal-title' }, '⇪ ' + t('libTitle')),
						h('div', { className: 'rk-settings-label' }, t('libLabel')),
						h(
							'div',
							{ className: 'rk-librow' },
							h('input', {
								className: 'rk-input',
								autoFocus: true,
								spellCheck: false,
								value: libraryDialog.path,
								placeholder: '/绝对路径',
								onChange: (event) => {
									const value = event.target.value;
									setLibraryDialog((dialog) => (dialog ? { ...dialog, path: value, error: null } : dialog));
								},
								onKeyDown: (event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										runImportLib();
									}
									if (event.key === 'Escape') setLibraryDialog(null);
								},
							}),
							h(
								'button',
								{
									className: 'rk-btn rk-ghost',
									type: 'button',
									disabled: libraryDialog.busy || libraryDialog.picking || typeof dirPicker.pick !== 'function',
									title: typeof dirPicker.pick === 'function' ? '' : t('libNoPicker'),
									onClick: chooseLibraryDir,
								},
								libraryDialog.picking ? t('libPicking') : t('libChoose'),
							),
						),
						h('div', { className: 'rk-settings-hint' }, t('libPickHint')),
						h('div', { className: 'rk-settings-hint' }, t('libHint')),
						libraryDialog.error ? h('div', { className: 'rk-rootdialog-error' }, libraryDialog.error) : null,
						h(
							'div',
							{ className: 'rk-row', style: { justifyContent: 'flex-end', marginTop: 12, gap: 8 } },
							h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => setLibraryDialog(null) }, t('cancel')),
							h(
								'button',
								{ className: 'rk-btn rk-primary', type: 'button', disabled: libraryDialog.busy, onClick: runImportLib },
								libraryDialog.busy ? t('saving') : t('libImportGo'),
							),
						),
					),
				);
			};

			const catalog = data;
			const stats = (catalog && catalog.stats) || { chapters: 0, sections: 0, points: 0, examples: 0, words: 0 };
			const gitCounts = (gitData && gitData.counts) || { plugin: 0, notes: 0, other: 0, total: 0 };
			/* 角标: 一级画布 = 整个学习库的未提交改动; 画布 = 这张画布 notes/ 范围内的改动 */
			const gitPending = (gitData && (typeof gitData.scopeTotal === 'number' ? gitData.scopeTotal : (level1 ? gitCounts.total : gitCounts.notes))) || 0;
			const gitOutside = Math.max(0, gitCounts.total - gitPending);
			/* 画布挂在本学习库下时, Git 提交只出现在一级画布(一次提交整个库); 自带根目录的画布保留自己的入口 */
			const gitInLibrary = !!(libPath && rootPath && (rootPath === libPath || rootPath.indexOf(libPath + '/') === 0));
			const showGit = !!gitData && (level1 || !gitInLibrary);
			const openGit = useCallback(() => {
				setGitResult(null);
				setGitAi({ busy: false, candidates: [], error: null });
				setGitForm({ scope: gitScope, message: defaultGitMessage(t, gitData, gitScope) });
				setGitOpen(true);
				gitReload(true);
			}, [gitData, gitReload, t, gitScope]);
			/* 让模型读一遍改动清单, 给几条候选 commit message(第 1 条自动填进去) */
			const generateGitMessage = useCallback(async () => {
				setGitAi({ busy: true, candidates: [], error: null });
				try {
					const data = await postGit({ action: 'message', scope: gitScope }, gitRoot);
					const candidates = (data && data.candidates) || [];
					setGitAi({ busy: false, candidates, error: data && data.ok === false ? data.message || data.error || 'ai-failed' : null });
					if (candidates.length > 0) setGitForm((form) => Object.assign({}, form, { message: candidates[0] }));
				} catch (error) {
					setGitAi({ busy: false, candidates: [], error: (error && error.message) || String(error) });
				}
			}, [gitScope]);
			const submitGit = useCallback(
				async (push) => {
					setGitBusy(push === true ? 'push' : 'commit');
					setGitResult(null);
					try {
						const data = await postGit({ action: 'commit', message: gitForm.message.trim(), scope: gitScope, push: push === true }, gitRoot);
						setGitResult({ ok: data.ok === true, data });
						if (data.ok === true) flash(data.committed === 0 && data.pushed ? t('gitPushed') : t('gitCommitted') + (data.hash ? ' · ' + data.hash : '') + (data.pushed ? ' · ' + t('gitPushed') : ''));
						/* 提交时顺手合并过远程更新: 磁盘上的笔记变了, 让列表重扫一遍 */
						if (data.ok === true && data.pull && data.pull.skipped !== true && data.pull.upToDate !== true) {
							setRootTick((value) => value + 1);
							if (!level1) reload(true);
						}
					} catch (error) {
						setGitResult({ ok: false, error: (error && error.message) || String(error) });
					} finally {
						setGitBusy(null);
						gitReload(true);
					}
				},
				[flash, gitForm.message, gitReload, level1, reload, t, gitScope],
			);
			/* 拉取: 不提交, 只把远程更新 fetch+merge 下来(冲突保留给用户解决), 拉完重扫画布 */
			const pullGit = useCallback(async () => {
				setGitBusy('pull');
				setGitResult(null);
				try {
					const data = await postGit({ action: 'pull' }, gitRoot);
					setGitResult({ ok: data.ok === true, data });
					if (data.ok === true) {
						flash(data.upToDate === true ? t('gitUpToDate') : t('gitPulled'));
						setRootTick((value) => value + 1);
						if (!level1) await reload(true);
					}
				} catch (error) {
					setGitResult({ ok: false, error: (error && error.message) || String(error) });
				} finally {
					setGitBusy(null);
					gitReload(true);
				}
			}, [flash, gitReload, level1, reload, t]);
			/* 仅推送: 不提交, 直接把本地已有的提交推到远程 */
			const pushOnlyGit = useCallback(async () => {
				setGitBusy('pushonly');
				setGitResult(null);
				try {
					const data = await postGit({ action: 'push' }, gitRoot);
					setGitResult({ ok: data.ok === true, data });
					if (data.ok === true) flash(t('gitPushed'));
				} catch (error) {
					setGitResult({ ok: false, error: (error && error.message) || String(error) });
				} finally {
					setGitBusy(null);
					gitReload(true);
				}
			}, [flash, gitReload, t]);
			const current = route.view === 'section' || route.view === 'point' ? findSection(catalog, route.path) : null;
			const currentPoint = current && route.pointId ? findPoint(current.section.points, route.pointId) : null;
			const detailOpen = route.view === 'section' || route.view === 'point';
			/* 章节图画布常驻: 右侧面板打开时也照样能平移/缩放 */
			const mapReady = level1 ? true : query.trim() === '' && !!catalog && (catalog.chapters || []).length > 0;
			const mapRef = useRef(mapReady);
			mapRef.current = mapReady;
			const layoutKey = 'rk-canvas:' + (level1 ? 'roots' : (catalog && catalog.root) || 'default');
			/* 学习库配置里视野的键: 一级画布是 'roots', 每张画布用它自己的根目录路径 */
			const zoomKey = level1 ? 'roots' : (catalog && catalog.root) || 'default';
			const VIEW_VERSION = 2;
			const cardWidth = 372;
			const cardGap = 18;
			const ROOT_CARD_H = 188;
			const MIN_SCALE = 0.2; /* 一行卡片可能很长, 复位时允许缩得更小才能全铺满 */
			const MAX_SCALE = 2.4;
			/* 插件区域的实际宽度: 宿主侧栏展开/收起、拉窗口都由它驱动自适应 */
			const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
			/* 一级画布的列数跟着可用宽度走(窄了就 1-2 列), 别硬撑 3 列 */
			const rootCols = stageBox.w > 0 ? Math.max(1, Math.min(3, Math.floor((stageBox.w - 44 + cardGap) / (cardWidth + cardGap)))) : 3;
			/* 上次自动铺满时的尺寸, 用来区分「尺寸变了」和「内容变了」 */
			const lastFit = useRef({ w: 0, h: 0 });
			const interacting = panning;

			/* 画布视野: 按工作区存进 localStorage, 刷新后保持 */
			useEffect(() => {
				const applyView = (saved) => setView({
					x: Number(saved.x) || 0,
					y: Number(saved.y) || 0,
					scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(saved.scale) || 1)),
				});
				try {
					const raw = window.localStorage.getItem(layoutKey);
					if (raw) {
						const saved = JSON.parse(raw);
						if (saved && saved.view && saved.v === VIEW_VERSION) { applyView(saved.view); userMoved.current = true; }
						didFit.current = true;
						return;
					}
				} catch (problem) {
					/* 存储不可用就算了 */
				}
				/* 本机没存过(换浏览器 / 换机器) ⇒ 用学习库配置里的那一份 */
				const fromFile = (libZoomRef.current || {})[zoomKey];
				if (fromFile && typeof fromFile === 'object') {
					applyView(fromFile);
					userMoved.current = true;
					didFit.current = true;
				}
			}, [layoutKey, zoomKey, libTick]);

			useEffect(() => {
				if (!catalog && !level1) return;
				/* 视野还没定下来之前(等学习库配置 / 首次铺满)一个字节都别记: 先记下来就会把文件里存的那份顶掉 */
				if (!didFit.current) return;
				try {
					window.localStorage.setItem(layoutKey, JSON.stringify({ v: VIEW_VERSION, view }));
				} catch (problem) {
					/* 存储不可用就算了 */
				}
				/* 视野也记进学习库的配置(换浏览器 / 换机器时照着恢复) */
				saveLib({ zoom: { [zoomKey]: { x: view.x, y: view.y, scale: view.scale } } });
			}, [layoutKey, zoomKey, view, catalog, level1, saveLib]);

			/* hover 高亮: 用一个屏幕空间的框跟随鼠标下的卡片/小节行 */
			const updateRing = useCallback(() => {
				const ring = ringRef.current;
				const stage = stageRef.current;
				const el = hoverRef.current;
				if (!ring || !stage) return;
				if (!el || !el.isConnected) {
					hoverRef.current = null;
					ring.classList.remove('rk-on');
					return;
				}
				const sr = stage.getBoundingClientRect();
				const r = el.getBoundingClientRect();
				let left = r.left;
				let top = r.top;
				let right = r.right;
				let bottom = r.bottom;
				if (!el.classList.contains('rk-chapter')) {
					/* 小节行等元素可能比卡片宽(靠卡片 overflow:hidden 裁掉), 高亮要跟着裁 */
					const cardEl = el.closest && el.closest('.rk-chapter');
					if (cardEl) {
						const cr = cardEl.getBoundingClientRect();
						left = Math.max(left, cr.left);
						top = Math.max(top, cr.top);
						right = Math.min(right, cr.right);
						bottom = Math.min(bottom, cr.bottom);
					}
				}
				const zoom = zoomRef.current || 1; /* 指针量到的是缩放后的屏幕像素, 要换回 stage 本地坐标 */
				ring.style.width = Math.max(0, Math.round((right - left) / zoom)) + 'px';
				ring.style.height = Math.max(0, Math.round((bottom - top) / zoom)) + 'px';
				ring.style.transform =
					'translate(' + Math.round((left - sr.left) / zoom) + 'px, ' + Math.round((top - sr.top) / zoom) + 'px)';
				ring.classList.add('rk-on');
			}, []);

			const clearRing = useCallback(() => {
				hoverRef.current = null;
				if (ringRef.current) ringRef.current.classList.remove('rk-on');
			}, []);

			const onStagePointerOver = useCallback(
				(event) => {
					const ring = ringRef.current;
					if (!mapRef.current || !ring) return;
					const target = event.target;
					if (!target || !target.closest) return;
					if (target.closest('.rk-btn')) {
						clearRing();
						return;
					}
					const sec = target.closest('.rk-sec');
					const card = sec ? null : target.closest('.rk-chapter');
					const node = sec || card ? null : target.closest('.rk-mm-node');
					const el = sec || card || node;
					if (!el) {
						clearRing();
						return;
					}
					if (hoverRef.current !== el) {
						hoverRef.current = el;
						ring.classList.toggle('rk-sec', !!sec);
						ring.classList.toggle('rk-card', !!card);
						ring.classList.toggle('rk-mm', !!node);
					}
					updateRing();
				},
				[clearRing, updateRing],
			);

			/* 视野(滚轮缩放/平移)一变, 高亮框按提交后的新布局重新量一次 */
			useLayoutEffect(() => {
				if (hoverRef.current) updateRing();
			}, [view, updateRing]);

			useEffect(() => {
				let frame = 0;
				const onResize = () => {
					if (frame) window.cancelAnimationFrame(frame);
					frame = window.requestAnimationFrame(updateRing);
				};
				window.addEventListener('resize', onResize);
				return () => {
					if (frame) window.cancelAnimationFrame(frame);
					window.removeEventListener('resize', onResize);
				};
			}, [updateRing]);

			/* 滚轮缩放: 以指针位置为锚点(必须非 passive 才能 preventDefault) */
			useEffect(() => {
				const stage = stageRef.current;
				if (!stage) return undefined;
				const onWheel = (event) => {
					closeMenu();
					if (!mapRef.current) return;
					event.preventDefault();
					userMoved.current = true;
					const rect = stage.getBoundingClientRect();
					const zoom = zoomRef.current || 1;
					const px = (event.clientX - rect.left) / zoom;
					const py = (event.clientY - rect.top) / zoom;
					setView((value) => {
						const factor = Math.exp(-event.deltaY * 0.0016);
						const scale = roundScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value.scale * factor)));
						const k = scale / value.scale;
						return { scale, x: snapToDevice(px - (px - value.x) * k), y: snapToDevice(py - (py - value.y) * k) };
					});
				};
				stage.addEventListener('wheel', onWheel, { passive: false });
				return () => stage.removeEventListener('wheel', onWheel);
			}, [mapReady, updateRing]);

			/* 量一次真实卡片高度, 自动布局才不会互相压住 */
			useLayoutEffect(() => {
				const stage = stageRef.current;
				if (!stage || !mapRef.current || !catalog) return;
				let changed = false;
				catalog.chapters.forEach((chapter) => {
					const element = stage.querySelector('[data-chapter="' + chapter.id + '"]');
					if (!element) return;
					const height = element.offsetHeight;
					if (height > 0 && measured.current[chapter.id] !== height) {
						measured.current[chapter.id] = height;
						changed = true;
					}
				});
				if (changed) setMeasureTick((value) => value + 1);
			});

			/* 所有章节卡排成一行, 不换行 */
			const positions = useMemo(() => {
				const out = {};
				((catalog && catalog.chapters) || []).forEach((chapter, index) => {
					out[chapter.id] = { x: index * (cardWidth + cardGap), y: 0 };
				});
				return out;
			}, [catalog]);

			/* 思维导图: 目录 + 折叠状态 → 节点 / 连线 / 内容尺寸(画布模式下是 null) */
			/* 知识点节点要按「真实渲染后的高度」排布, 所以先渲染一遍量高, 再拿量到的高度重排 */
			const [mmSizes, setMmSizes] = useState(null);
			const onMindMeasure = useCallback((map) => {
				setMmSizes((prev) => {
					const before = prev || {};
					const keys = Object.keys(map);
					if (keys.length === Object.keys(before).length && keys.every((key) => Math.abs((before[key] || 0) - map[key]) < 0.5)) return prev;
					return map;
				});
			}, []);
			/* 一级画布上永远是卡片, 不做导图: catalog 这时可能还是上一张画布留下的旧数据,
			 * 不挡掉的话导图的 extent / 按钮 / 右键都会被它影响 */
			const mind = useMemo(
				() => (mode === 'map' && !level1 && catalog ? layoutMindmap(buildMindmapTree(catalog, folded, opened, t), mmSizes) : null),
				[mode, level1, catalog, folded, opened, t, mmSizes],
			);

			/* 一级画布: 画布卡片按 3 列排, 尺寸统一, 不用量高 */
			const rootCards = useMemo(
				() => roots.map((entry, index) => ({ entry, x: (index % rootCols) * (cardWidth + cardGap), y: Math.floor(index / rootCols) * (ROOT_CARD_H + cardGap) })),
				[roots, rootCols],
			);

			const extent = useMemo(() => {
				if (mind) return { w: mind.width, h: mind.height };
				if (level1) {
					const count = Math.max(1, rootCards.length + 1);
					const cols = Math.min(rootCols, count);
					const rows = Math.ceil(count / rootCols);
					return { w: cols * cardWidth + (cols - 1) * cardGap, h: rows * ROOT_CARD_H + (rows - 1) * cardGap };
				}
				let w = 0;
				let hgt = 0;
				((catalog && catalog.chapters) || []).forEach((chapter) => {
					const spot = positions[chapter.id];
					if (!spot) return;
					const height = measured.current[chapter.id] || 300;
					w = Math.max(w, spot.x + cardWidth);
					hgt = Math.max(hgt, spot.y + height);
				});
				return { w, h: hgt };
			}, [mind, level1, rootCards, positions, catalog, measureTick, rootCols]);

			/* 复位: 把所有卡片缩放到刚好铺满可视区 */
			const fitView = useCallback(() => {
				if (mind || level1) {
					/* 导图 / 一级画布: 缩放并居中, 让整棵树(或整排卡片)刚好落在可视区里 */
					const box = mind ? { width: mind.width, height: mind.height } : { width: extent.w, height: extent.h };
					const area = stageRef.current;
					if (!area || box.width <= 0 || box.height <= 0) {
						setView({ x: 26, y: 22, scale: 1 });
						return;
					}
					const roomW = area.clientWidth - 40;
					const roomH = area.clientHeight - 40;
					if (roomW <= 0 || roomH <= 0) {
						setView({ x: 26, y: 22, scale: 1 });
						return;
					}
					const zoom = roundScale(Math.min(1, Math.max(MIN_SCALE, Math.min(roomW / box.width, roomH / box.height))));
					setView({
						scale: zoom,
						x: snapToDevice(Math.max(20, Math.round((area.clientWidth - box.width * zoom) / 2))),
						y: snapToDevice(Math.max(16, Math.round((area.clientHeight - box.height * zoom) / 2))),
					});
					return;
				}
				const stage = stageRef.current;
				if (!stage) return;
				const availW = stage.clientWidth - 48;
				const availH = stage.clientHeight - 48;
				if (extent.w <= 0 || extent.h <= 0 || availW <= 0 || availH <= 0) {
					setView({ x: 26, y: 22, scale: 1 });
					return;
				}
				const scale = roundScale(Math.min(1, Math.max(MIN_SCALE, Math.min(availW / extent.w, availH / extent.h))));
				setView({
					scale,
					x: snapToDevice(Math.max(24, Math.round((stage.clientWidth - extent.w * scale) / 2))),
					y: snapToDevice(Math.max(20, Math.round((stage.clientHeight - extent.h * scale) / 2))),
				});
			}, [extent, mind, level1]);

			/* 首次进入画布(没有存过视图)自动铺满一次 */
			useEffect(() => {
				if (!mapReady || didFit.current || measureTick === 0 || extent.w <= 0 || mind || level1) return;
				didFit.current = true;
				fitView();
			}, [mapReady, measureTick, extent, fitView, mind, level1]);

			/* 一级画布: 卡片是定高的, 没有「量高」这一步, 所以列表一变(0 → N)就重新铺满一次
			 * 但要等学习库配置读完: 文件里存过视野就照它恢复(见上面的读 effect), 没存过才铺满;
			 * 铺过一次就收手(didFit), 之后不再跟着列表变化乱跳 */
			useEffect(() => {
				if (!level1 || !mapReady || extent.w <= 0 || roots.length === 0) return;
				if (!libReadyRef.current) return;
				if (didFit.current) return;
				didFit.current = true;
				fitView();
			}, [level1, mapReady, extent, fitView, roots.length, libTick]);

			/* 容器尺寸一变(拉窗口 / 宿主侧栏开合 / 全屏)就重新量一次 */
			useEffect(() => {
				const stage = stageRef.current;
				if (!stage || !mapReady) return undefined;
				const sync = () => setStageBox({ w: stage.clientWidth, h: stage.clientHeight });
				sync();
				const ro = new ResizeObserver(sync);
				ro.observe(stage);
				return () => ro.disconnect();
			}, [mapReady]);

			/* 尺寸变了: 只在「这一屏已经装不下现在的画布」时重新铺满,
			 * 免得把用户自己调好的视野白白抖掉; 第一次观测只记下来, 交给上面 didFit 那两条 */
			useEffect(() => {
				if (!mapReady || stageBox.w <= 0 || stageBox.h <= 0) return;
				const last = lastFit.current;
				if (last.w === 0 && last.h === 0) {
					lastFit.current = { w: stageBox.w, h: stageBox.h };
					return;
				}
				if (last.w === stageBox.w && last.h === stageBox.h) return;
				lastFit.current = { w: stageBox.w, h: stageBox.h };
				const fits = view.scale * extent.w <= stageBox.w - 24 && view.scale * extent.h <= stageBox.h - 24;
				if (fits) return;
				fitView();
			}, [stageBox, mapReady, fitView, extent, view.scale]);

			/* 切模式时视图复位一次(导图与画布的布局不一样), 并让下次回画布时重新铺满 */
			useEffect(() => {
				didFit.current = false;
				mapFits.current = 0;
				userMoved.current = false;
				setView({ x: 26, y: 22, scale: 1 });
			}, [mode]);

			/* 导图: 进来先自动 fit 一次(整棵树可见), 等内容节点量完高再 fit 一次收工 */
			useEffect(() => {
				if (mode !== 'map' || !mind || userMoved.current || mapFits.current >= 2) return;
				const land = fitView;
				if (mapFits.current === 0) {
					mapFits.current = 1;
					const first = setTimeout(land, 60);
					return () => clearTimeout(first);
				}
				if (!mmSizes) return;
				mapFits.current = 2;
				const second = setTimeout(land, 80);
				return () => clearTimeout(second);
			}, [mode, mind, mmSizes, fitView]);

			/* 导图页的刷新: 重新扫描笔记 + 丢掉量到的高度, 重画一遍再 fit */
			const refreshMap = useCallback(() => {
				setMmSizes(null);
				mapFits.current = 0;
				userMoved.current = false;
				reload(true);
			}, [reload]);

			/* 右键菜单: 屏幕空间浮层(不参与画布缩放), 靠 stage 的 padding-box 定位 */
			const MENU_W = 196;
			const MENU_ITEM_H = 30;
			const MENU_SEP_H = 11;
			const MENU_PAD = 10;
			const [menu, setMenu] = useState(null);
			const menuRef = useRef(null);
			const closeMenu = useCallback(() => setMenu(null), []);
			const openMenu = useCallback((event, items) => {
				const stage = stageRef.current;
				if (!stage) return;
				const box = stage.getBoundingClientRect();
				const height = MENU_PAD + items.reduce((sum, item) => sum + (item.sep ? MENU_SEP_H : MENU_ITEM_H), 0);
				const maxX = Math.max(6, stage.clientWidth - MENU_W - 8);
				const maxY = Math.max(6, stage.clientHeight - height - 8);
				setMenu({
					x: Math.max(6, Math.min(Math.round((event.clientX - box.left) / zoomRef.current), maxX)),
					y: Math.max(6, Math.min(Math.round((event.clientY - box.top) / zoomRef.current), maxY)),
					items,
					confirming: null,
				});
			}, []);
			useEffect(() => {
				if (!menu) return undefined;
				const onDown = (event) => {
					const el = menuRef.current;
					if (el && el.contains(event.target)) return;
					closeMenu();
				};
				const onKey = (event) => {
					if (event.key === 'Escape') closeMenu();
				};
				window.addEventListener('pointerdown', onDown, true);
				window.addEventListener('keydown', onKey, true);
				window.addEventListener('blur', closeMenu);
				window.addEventListener('resize', closeMenu);
				return () => {
					window.removeEventListener('pointerdown', onDown, true);
					window.removeEventListener('keydown', onKey, true);
					window.removeEventListener('blur', closeMenu);
					window.removeEventListener('resize', closeMenu);
				};
			}, [menu, closeMenu]);

			/* 空白处按住拖动 = 平移画布 */
			const onStagePointerDown = (event) => {
				if (!mapReady || event.button !== 0) return;
				const target = event.target;
				if (target.closest('.rk-chapter') || target.closest('.rk-rootcard') || (target.closest && target.closest('a'))) return;
				/* 导图里的 `+ / −` 按钮不参与平移: 一旦 setPointerCapture, 指针的兼容鼠标事件会被改派到 stage, 按钮的 click 就没了 */
				if (target.closest && target.closest('.rk-mm-fold')) return; /* 导图节点可穿透(按住节点也能拖动画布), 但节点里的链接照旧可点 */
				/* 导图节点上不能 preventDefault: 那会连带吞掉这个指针的兼容鼠标事件, `+ / −` 的 click 就没了(文字选中已由 `.rk-mm` 的 user-select:none 关掉) */
				if (!(target.closest && target.closest('.rk-mm-node'))) event.preventDefault();
				panRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					originX: view.x,
					originY: view.y,
				};
				setPanning(true);
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch (problem) {
					/* 忽略 */
				}
			};
			const onStagePointerMove = (event) => {
				const pan = panRef.current;
				if (pan && pan.pointerId === event.pointerId) {
					const zoom = zoomRef.current || 1;
					const moved = { x: snapToDevice(pan.originX + (event.clientX - pan.startX) / zoom), y: snapToDevice(pan.originY + (event.clientY - pan.startY) / zoom) };
					userMoved.current = true;
					setView((value) => ({ ...value, x: moved.x, y: moved.y }));
				}
			};
			const onStagePointerUp = (event) => {
				const pan = panRef.current;
				if (pan && pan.pointerId === event.pointerId) {
					panRef.current = null;
					setPanning(false);
				}
			};
			const needle = query.trim().toLowerCase();
			const hits = useMemo(() => {
				if (needle === '' || !catalog) return [];
				const out = [];
				catalog.chapters.forEach((chapter) => {
					chapter.sections.forEach((section) => {
						flattenPoints(section.points, 0, []).forEach((point) => {
							const haystack = (point.title + ' ' + (point.summary || '') + ' ' + section.title + ' ' + chapter.title).toLowerCase();
							if (haystack.indexOf(needle) >= 0) out.push({ chapter, section, point });
						});
					});
				});
				return out.slice(0, 60);
			}, [catalog, needle]);

			const openSection = useCallback((path) => setRoute({ view: 'section', path }), []);
			const openPoint = useCallback((path, pointId) => setRoute({ view: 'point', path, pointId }), []);

			/* 导图节点点击: 知识点 → 详情; 小节 → 小节视图; 章节 → 它的第一个小节; 根 → 复位 */
			/* 折叠 / 展开一个导图节点 */
			const toggleFold = useCallback((id) => {
				setFolded((list) => (list.indexOf(id) >= 0 ? list.filter((item) => item !== id) : list.concat([id])));
			}, []);
			/* 手风琴: 同一时刻只展开一个知识点正文, 展开新的就把旧的收起来 */
			const toggleOpen = useCallback((id) => {
				setOpened((list) => (list.indexOf(id) >= 0 ? [] : [id]));
			}, []);
			/* 折叠按钮: 知识点节点开合它的「内容」子节点, 章节/小节还是普通折叠 */
			const onMindToggle = useCallback(
				(node) => {
					if (node.kind === 'content' || node.special === 'content') return;
					if (node.kind === 'point') {
						/* 展开/收起正文只改折叠状态, 不动当前视野: 缩放与平移保持原样(以前会复位到 100% 并跳到这块内容上) */
						toggleOpen(node.id);
					}
					else toggleFold(node.id);
				},
				[toggleFold, toggleOpen],
			);

			const openEditorForSection = useCallback(
				async (path) => {
					try {
						const file = await fetchFile(path);
						setEditor({ mode: 'edit', path, markdown: file.markdown, title: file.title });
					} catch (problem) {
						flash('读取失败：' + ((problem && problem.message) || problem));
					}
				},
				[flash],
			);

			/* 编辑某道题: 打开可视化表单(选择题 / 案例题), 需要时再跳到原始 markdown */
			const editQuestion = useCallback(
				(item, point) => {
					if (!item) return;
					const options = (item.options || []).map((option) => ({ text: option.text }));
					setQuestionDialog({
						mode: 'edit',
						pointPath: (point && point.path) || item.path || '',
						pointTitle: (point && point.title) || '',
						path: item.path || null,
						order: item.order || null,
						kind: options.length >= 2 ? 'choice' : 'case',
						stem: item.stem || '',
						options,
						answerKey: item.answerKey || '',
						answerText: item.answerText || '',
						explanation: item.explanation || '',
					});
				},
				[],
			);

			/* 编辑知识点: 先向宿主取这个知识点的准确标题/标签/正文, 再开弹窗 */
			const editPoint = useCallback(
				async (point) => {
					if (!point) return;
					const path = String(point.path || '').trim();
					if (path === '') {
						flash(t('loadFailed') + '：' + t('pointMissing'));
						return;
					}
					try {
						const data = await fetchPoint(path, point.title || '');
						setPointDialog({
							path: data.path || path,
							mode: data.mode || 'file',
							key: point.title || data.title || '',
							title: data.title || point.title || '',
							tags: (data.tags || []).join(', '),
							body: data.body || '',
						});
					} catch (problem) {
						flash(t('loadFailed') + '：' + pointError((problem && problem.message) || problem, t));
					}
				},
				[flash, t],
			);

			/* 弹窗 -> 宿主: savePoint 只换这一个知识点的标题/标签/正文 */
			const submitPoint = useCallback(
				async (form) => {
					try {
						const saved = await postAction({
							action: 'savePoint',
							path: form.path,
							key: form.key,
							title: form.title,
							body: form.body,
							tags: form.mode === 'file' ? form.tags : undefined,
						});
						flash(t('pointSaved') + ' · ' + pathLabel(saved.path));
						setPointDialog(null);
						await reload(true);
						return { ok: true, path: saved.path };
					} catch (problem) {
						return { error: pointError((problem && problem.message) || problem, t) };
					}
				},
				[flash, reload, t],
			);

			/* 逃生入口: 先存下弹窗里的改动, 再打开原始 markdown 抽屉, 不丢输入 */
			const rawPoint = useCallback(
				async (form) => {
					const target = (pointDialog && pointDialog.path) || form.path;
					const result = await submitPoint(form);
					if (result && result.error) return result;
					await openEditorForSection(target);
					return { ok: true };
				},
				[openEditorForSection, pointDialog, submitPoint],
			);

			const startNewSection = useCallback((dir) => setEditor({ mode: 'newSection', dir, title: '', markdown: '' }), []);
			/* 新建章节 = 只输入一个名称, 目录由宿主创建; 改名同理 */
			const startNewChapter = useCallback(() => setNameDialog({ mode: 'newChapter', dir: 'notes', value: '' }), []);
			const startRenameChapter = useCallback(
				(chapter) => setNameDialog({ mode: 'rename', dir: chapter.dir, value: chapter.name || chapter.title }),
				[],
			);

			const submitChapterName = useCallback(
				async (raw) => {
					const clean = String(raw || '').trim();
					if (clean === '') {
						flash('章节名不能为空');
						return;
					}
					const target = nameDialog;
					if (!target) return;
					try {
						if (target.mode === 'newChapter') {
							const created = await postAction({ action: 'newChapter', parent: target.dir, title: clean });
							flash('已新建章节 · ' + created.dir);
						} else {
							const renamed = await postAction({ action: 'renameChapter', dir: target.dir, title: clean });
							flash(
								renamed.unchanged
									? '章节名没有变化'
									: '已重命名 · ' + renamed.path + ((renamed.related || []).length > 0 ? '（题目目录同步改名）' : ''),
							);
						}
						setNameDialog(null);
						await reload(true);
					} catch (problem) {
						flash('操作失败：' + ((problem && problem.message) || problem));
					}
				},
				[flash, nameDialog, reload],
			);

			/* 在知识点下新增一道题: 打开可视化表单 */
			const addQuestion = useCallback((point) => {
				if (!point || !point.path) return;
				setQuestionDialog({
					mode: 'new',
					pointPath: point.path,
					pointTitle: point.title || '',
					path: null,
					order: null,
					kind: 'choice',
					stem: '',
					options: [],
					answerKey: 'A',
					answerText: '',
					explanation: '',
				});
			}, []);

			/* 表单 -> 宿主: saveQuestion 会重排整份文件的「## 题目 N」 */
			const submitQuestion = useCallback(
				async (fields, keepOpen) => {
					const target = questionDialog;
					if (!target) return { error: '' };
					try {
						const saved = await postAction({
							action: 'saveQuestion',
							path: target.path || target.pointPath,
							order: target.mode === 'edit' ? target.order : undefined,
							fields,
						});
						flash(
							(saved.created ? '已新建题目文件 · ' : '已保存题目 · ') +
								pathLabel(saved.path) +
								'（共 ' +
								saved.total +
								' 题）' +
								(keepOpen ? ' · ' + t('savedNext') : ''),
						);
						if (!keepOpen) setQuestionDialog(null);
						await reload(true);
						return { path: saved.path, ok: true };
					} catch (problem) {
						return { error: questionError((problem && problem.message) || problem, t) };
					}
				},
				[flash, questionDialog, reload, t],
			);

			/* 逃生入口: 直接编辑这道题所在的 markdown 文件(新题会先存一次再打开) */
			const rawQuestion = useCallback(
				async (fields) => {
					const target = questionDialog;
					if (!target) return {};
					if (target.mode === 'edit' && target.path) {
						setQuestionDialog(null);
						await openEditorForSection(target.path);
						return { ok: true };
					}
					const result = await submitQuestion(fields, false);
					if (result && result.error) return result;
					if (result && result.path) await openEditorForSection(result.path);
					return result || {};
				},
				[openEditorForSection, questionDialog, submitQuestion],
			);

			const flashError = useCallback(
				(problem) => flash('操作失败：' + ((problem && problem.message) || problem)),
				[flash],
			);

			/* 删除一个笔记文件(小节 / 知识点 / 题目 / 章节说明) */
			const removeEntry = useCallback(
				async (relPath) => {
					try {
						const removed = await postAction({ action: 'delete', path: relPath });
						const cascaded = (removed && removed.related) || [];
						flash(
							t('movedToBox') +
								(removed && removed.bucket ? removed.bucket + '/' : '') +
								' · ' +
								pathLabel(relPath) +
								(cascaded.length ? '（' + t('cascade') + ' ×' + cascaded.length + '）' : ''),
						);
						setEditor(null);
						setRoute((prev) => (prev.path === relPath ? { view: 'map' } : prev));
						await reload(true);
					} catch (problem) {
						flash('删除失败：' + ((problem && problem.message) || problem));
					}
				},
				[flash, reload, t],
			);

			/* 删除整章(目录及其下全部文件) */
			const removeChapter = useCallback(
				async (chapter) => {
					try {
						const removed = await postAction({ action: 'deleteDir', dir: chapter.dir });
						const cascaded = (removed && removed.related) || [];
						flash(
							t('movedToBox') +
								(removed && removed.bucket ? removed.bucket + '/' : '') +
								' · ' +
								chapter.rel +
								(cascaded.length ? '（' + t('cascade') + ' ×' + cascaded.length + '）' : ''),
						);
						setRoute({ view: 'map' });
						await reload(true);
					} catch (problem) {
						flash('删除失败：' + ((problem && problem.message) || problem));
					}
				},
				[flash, reload, t],
			);

			/* 从题目/知识点文件里删掉某一道题 */
			const removeQuestion = useCallback(
				async (item) => {
					try {
						const questionRemoved = await postAction({ action: 'deleteQuestion', path: item.path, order: item.order });
						flash(t('movedToBox') + (questionRemoved && questionRemoved.bucket ? questionRemoved.bucket + '/' : '') + ' · ' + (item.label || item.title));
						await reload(true);
					} catch (problem) {
						flash('删除失败：' + ((problem && problem.message) || problem));
					}
				},
				[flash, reload, t],
			);
			const startNewUnit = useCallback(
				(mode, chapter, section) =>
					setEditor({ mode, dir: (chapter && chapter.dir) || '', section: (section && section.order) || 1, title: '', markdown: '' }),
				[],
			);

			const submitEditor = useCallback(
				async ({ value, title }) => {
					if (!editor) return;
					const clean = String(title || '').trim();
					setSaving(true);
					try {
						if (editor.mode === 'edit') {
							await postAction({ action: 'save', path: editor.path, markdown: value });
							flash(t('saved') + ' · ' + pathLabel(editor.path));
							setEditor(null);
						} else if (clean === '') {
							flash('请先填写标题');
							setSaving(false);
							return;
						} else if (editor.mode === 'newSection') {
							const created = await postAction({ action: 'newSection', dir: editor.dir, title: clean });
							flash(t('saved') + ' · ' + created.path);
							setEditor(null);
						} else if (editor.mode === 'newPoint') {
							const created = await postAction({
								action: 'newPoint',
								dir: editor.dir,
								section: editor.section,
								title: clean,
							});
							flash(t('saved') + ' · ' + created.path);
							setEditor(null);
						}
						await reload(true);
					} catch (problem) {
						flash('保存失败：' + ((problem && problem.message) || problem));
					}
					setSaving(false);
				},
				[editor, flash, reload, t],
			);

			/* 右键菜单的条目: 空白 / 章节卡 / 小节行 三套 */
			const onBlankContextMenu = useCallback(
				(event) => {
					if (!mapReady) return;
					if (mind) {
						/* 导图是只读视图: 不给右键菜单(也不弹浏览器菜单) */
						event.preventDefault();
						return;
					}
					if (level1) {
						/* 一级画布: 右键只给「新建学习画布」 */
						event.preventDefault();
						openMenu(event, [{ id: 'newRoot', label: '＋ ' + t('rootNew'), run: () => openNewRoot() }]);
						return;
					}
					const target = event.target;
					if (target.closest && (target.closest('.rk-chapter') || target.closest('.rk-rootcard'))) return;
					if (target.closest && target.closest('.rk-btn, .rk-input, input, textarea')) return;
					event.preventDefault();
					openMenu(event, [
						{ id: 'newChapter', label: '＋ ' + t('newChapter'), run: () => startNewChapter() },
						{ id: 'refresh', label: t('refresh'), run: () => reload(true) },
						{ id: 'fit', label: t('fit'), run: () => fitView() },
					]);
				},
				[mapReady, openMenu, t, startNewChapter, reload, fitView],
			);
			const onCardContextMenu = useCallback(
				(event, chapter, section) => {
					if (!chapter) return;
					const target = event.target;
					if (target.closest && target.closest('.rk-btn, .rk-input, input, textarea')) return;
					event.preventDefault();
					event.stopPropagation();
					if (section) {
						openMenu(event, [
							{ id: 'openSection', label: t('openSection'), run: () => openSection(section.path) },
							{ id: 'editSection', label: t('editSection'), run: () => openEditorForSection(section.path) },
							{ sep: true },
							{
								id: 'delSection',
								label: t('delSection'),
								danger: true,
								confirm: t('delConfirm') + ' ' + section.title,
								run: () => removeEntry(section.path),
							},
						]);
						return;
					}
					const items = [{ id: 'newSection', label: '＋ ' + t('newSection'), run: () => startNewSection(chapter.dir) }];
					if (chapter.dir !== '') {
						items.push({ id: 'rename', label: t('rename'), run: () => startRenameChapter(chapter) });
						items.push({ sep: true });
						items.push({
							id: 'delChapter',
							label: t('delChapter'),
							danger: true,
							confirm: t('delConfirm') + ' ' + chapter.title,
							run: () => removeChapter(chapter),
						});
					}
					openMenu(event, items);
				},
				[openMenu, t, openSection, openEditorForSection, removeEntry, startNewSection, startRenameChapter, removeChapter],
			);
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
				return h(
					'div',
					{ className: 'rk-doc' },
					h(
						'div',
						{ className: 'rk-crumbs', style: { marginBottom: 12 } },
						h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => setRoute({ view: 'section', path: section.path }) }, '‹ ' + t('back')),
						h('span', null, chapter.title),
						h('span', null, '›'),
						h('span', null, section.title),
						h(
							'span',
							{ className: 'rk-row', style: { marginLeft: 'auto' } },
							currentPoint.path && currentPoint.path !== section.path
								? h('span', { className: 'rk-chip' }, pathLabel(currentPoint.path))
								: null,
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
								onConfirm: () => removeEntry(currentPoint.path || section.path),
							}),
						),
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

			/* 面板本体 —— 平常就是主列里那个面板; 弹出时整块搬进下面那个浮层窗体 */
			/* 当前画布(根目录)的显示名: 优先用列表里改过的名字, 否则用目录名 */
			const currentRootName = useMemo(() => {
				const hit = roots.find((entry) => entry.path === rootPath);
				return (hit && hit.name) || (rootPath ? baseNameOf(rootPath) : '');
			}, [roots, rootPath]);

			const headStats = level1
				? [h('span', { className: 'rk-stat' }, h('b', null, roots.length), t('rootCount'))]
				: [
						h('span', { className: 'rk-stat' }, h('b', null, stats.chapters), t('chapters')),
						h('span', { className: 'rk-stat' }, h('b', null, stats.sections), t('sections')),
						h('span', { className: 'rk-stat' }, h('b', null, stats.points), t('points')),
						h('span', { className: 'rk-stat' }, h('b', null, stats.examples), t('examples')),
						h('span', { className: 'rk-stat' }, h('b', null, formatCount(stats.words)), t('words')),
					];

			const headActions = [
				level1
					? h('button', { key: 'new', className: 'rk-btn rk-primary', type: 'button', onClick: openNewRoot }, '＋ ' + t('rootNew'))
					: h('button', { key: 'new', className: 'rk-btn', type: 'button', onClick: startNewChapter }, '＋ ' + t('newChapter')),
				level1
					? h('button', { key: 'import', className: 'rk-btn', type: 'button', title: t('libHint'), onClick: openImportLib }, '⇪ ' + t('libImport'))
					: null,
				h(
					'button',
					{ key: 'scan', className: 'rk-btn', type: 'button', onClick: () => (level1 ? setRootTick((value) => value + 1) : reload(true)) },
					t('refresh'),
				),
				showGit
					? h(
							'button',
							{ key: 'git', className: 'rk-btn', type: 'button', onClick: openGit, title: t('gitHint') },
							'⎇ ' + t('gitCommit') + (gitPending > 0 ? ' · ' + gitPending : ''),
						)
					: null,
				h(
					'button',
					{
						key: 'pop',
						className: 'rk-btn' + (focused ? '' : ' rk-ghost'),
						type: 'button',
						title: t('focusHint'),
						onClick: toggleFocus,
					},
					(focused ? '⤡ ' : '⤢ ') + (focused ? t('focusExit') : t('focus')),
				),
			];

			const panelRoot = h(
				'div',
				{ className: 'rk-root rk-skin-' + skin + (follow ? ' rk-follow' : ''), style: { zoom: String(fontScale / 100) } },
				h(
					'div',
					{ className: 'rk-head' },
					h('span', { className: 'rk-dot' }),
					h(
						'div',
						{ className: 'rk-headText' },
						h('div', { className: 'rk-h1' }, level1 ? t('rootTitle') : currentRootName || t('title')),
						h('div', { className: 'rk-h2' }, level1 ? t('rootSubtitle') : (catalog && catalog.root) || t('subtitle')),
					),
					h('div', { className: 'rk-stats' }, ...headStats, ...headActions),
				),
				h(
					'div',
					{ className: 'rk-toolbar' },
					level1
						? h('button', { className: 'rk-btn rk-primary', type: 'button', onClick: openNewRoot }, '＋ ' + t('rootNew'))
						: h('button', { className: 'rk-btn rk-ghost', type: 'button', title: t('rootAllHint'), onClick: leaveRoot }, '← ' + t('rootAll')),
					level1
						? null
						: h(
								'div',
								{ className: 'rk-modes' },
								h(
									'button',
									{ className: 'rk-mode' + (mode === 'canvas' ? ' is-on' : ''), type: 'button', onClick: () => setMode('canvas') },
									t('modeCanvas'),
								),
								h(
									'button',
									{ className: 'rk-mode' + (mode === 'map' ? ' is-on' : ''), type: 'button', onClick: () => setMode('map') },
									t('modeMap'),
								),
							),
					mind
						? h(
								'button',
								{ className: 'rk-btn rk-ghost', type: 'button', title: t('mapRefresh'), onClick: refreshMap },
								'↻ ' + t('mapRefresh'),
							)
						: null,
					level1
						? h('span', { className: 'rk-toolbar-hint' }, t('rootHint') + (readDefaultRoot() ? '　' + t('rootHintUnder') + ' ' + readDefaultRoot() : ''))
						: h('input', {
								className: 'rk-input',
								value: query,
								placeholder: t('search'),
								onChange: (event) => setQuery(event.target.value),
							}),
					h(
						'div',
						{ className: 'rk-row', style: { marginLeft: 'auto' } },
						h(
							'button',
							{
								className: 'rk-btn rk-ghost rk-zoomctl',
								type: 'button',
								title: t('zoomOut'),
								onClick: () => { userMoved.current = true; setView((value) => ({ ...value, scale: Math.max(MIN_SCALE, Math.round((value.scale - 0.1) * 100) / 100) })); },
							},
							'－',
						),
						h(
							'button',
							{
								className: 'rk-btn rk-ghost rk-ztag',
								type: 'button',
								style: { minWidth: 52 },
								title: t('fit'),
								onClick: () => { userMoved.current = true; setView((value) => ({ ...value, scale: 1 })); },
							},
							Math.round(view.scale * 100) + '%',
						),
						h(
							'button',
							{
								className: 'rk-btn rk-ghost rk-zoomctl',
								type: 'button',
								title: t('zoomIn'),
								onClick: () => { userMoved.current = true; setView((value) => ({ ...value, scale: Math.min(MAX_SCALE, Math.round((value.scale + 0.1) * 100) / 100) })); },
							},
							'＋',
						),
						h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: fitView }, t('fit')),
						h(
							'button',
							{ className: 'rk-btn rk-ghost', type: 'button', title: t('fontSmaller'), onClick: () => stepFont(-1) },
							'A－',
						),
						h(
							'button',
							{
								className: 'rk-btn rk-ghost rk-ztag',
								type: 'button',
								style: { minWidth: 66 },
								title: t('fontHint'),
								onClick: () => setFontScale(100),
							},
							t('fontLabel') + ' ' + fontScale + '%',
						),
						h(
							'button',
							{ className: 'rk-btn rk-ghost', type: 'button', title: t('fontLarger'), onClick: () => stepFont(1) },
							'A＋',
						),
						h(
							'div',
							{ className: 'rk-skin-wrap', ref: skinBoxRef },
							h(
								'button',
								{
									className: 'rk-btn rk-ghost',
									type: 'button',
									title: t('skinHint'),
									onClick: () => setSkinOpen((value) => !value),
								},
								h('span', { className: 'rk-swatch-dot', style: { background: skinHex } }),
								t('skinLabel'),
							),
							skinOpen
								? h(
										'div',
										{ className: 'rk-skin-pop' },
										h('div', { className: 'rk-skin-title' }, t('skinHint')),
										h(
											'div',
											{ className: 'rk-skin-row' },
											h('span', { title: t('themeHint') }, t('themeLabel')),
											h(
												'div',
												{ className: 'rk-theme-seg' },
												[
													{ id: 'plugin', name: 'themePlugin' },
													{ id: 'follow', name: 'themeFollow' },
												].map((item) =>
													h(
														'button',
														{
															key: item.id,
															type: 'button',
															className: 'rk-btn' + (theme === item.id ? ' rk-primary' : ' rk-ghost'),
															title: item.id === 'follow' ? t('themeHint') : t(item.name),
															onClick: () => setTheme(item.id),
														},
														t(item.name),
													),
												),
											),
										),
										h(
											'div',
											{ className: 'rk-skin-row' },
											h('span', { title: t('cardColorsHint') }, t('cardColors')),
											h(
												'button',
												{
													type: 'button',
													className: 'rk-btn' + (cardColors ? ' rk-primary' : ' rk-ghost'),
													onClick: () => setCardColors((value) => !value),
												},
												cardColors ? t('cardColorsOn') : t('cardColorsOff'),
											),
										),
										h(
											'div',
											{ className: 'rk-skin-grid' },
											skinList.map((item) =>
												h('button', {
													key: item.id,
													type: 'button',
													className: 'rk-swatch' + (item.id === skin ? ' is-on' : ''),
													title: t(item.name) + ' · ' + item.hex,
													style: { background: item.hex },
													onClick: () => setSkin(item.id),
												}),
											),
										),
									)
								: null,
						),
					),
				),
				h(
					'div',
					{ style: { position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex' } },
					h(
						'div',
						{
							className: 'rk-stage' + (mapReady ? ' rk-canvas' : '') + (panning ? ' rk-panning' : '') + (interacting ? ' rk-interacting' : ''),
							ref: stageRef,
							onPointerDown: onStagePointerDown,
							onPointerMove: onStagePointerMove,
							onPointerUp: onStagePointerUp,
							onPointerCancel: onStagePointerUp,
							onPointerOver: onStagePointerOver,
							onPointerLeave: clearRing,
							onContextMenu: onBlankContextMenu,
							onDoubleClick: () => {
								if (mapReady) fitView();
							},
						},
						body(),
						mapReady ? h('div', { className: 'rk-hover-ring', ref: ringRef }) : null,
						mapReady ? renderMenu() : null,
					),
					detailOpen
						? h(
								'div',
								{ className: 'rk-detail' },
								h(
									'div',
									{ className: 'rk-detail-bar' },
									h(
										'span',
										{ className: 'rk-detail-name' },
										(current && current.chapter.title + ' › ' + current.section.title) || '',
									),
									h(
										'button',
										{
											className: 'rk-btn rk-ghost',
											type: 'button',
											title: t('close'),
											onClick: () => setRoute({ view: 'map' }),
										},
										'✕ ' + t('close'),
									),
								),
								h('div', { className: 'rk-detail-body' }, detailBody()),
							)
						: null,
					editor
						? h(Editor, {
								/* key: 换文件(例如从笔记跳到模板库文件)时让编辑器重新挂载, 否则 textarea 还留着上一个文件的内容 */
								key: editor.path,
								theme: mdTheme,
								state: editorState(editor, catalog),
								t,
								saving,
								onClose: () => setEditor(null),
								onSave: submitEditor,
								onDelete: removeEntry,
								onError: flashError,
								onEditTemplates: openEditorForSection,
							})
						: null,
					nameDialog
						? h(NameDialog, {
								t,
								title: nameDialog.mode === 'newChapter' ? t('newChapter') : t('renameChapter'),
								value: nameDialog.value,
								placeholder: t('title2'),
								onCancel: () => setNameDialog(null),
								onSubmit: submitChapterName,
							})
						: null,
					questionDialog
						? h(QuestionDialog, {
								t,
								theme: mdTheme,
								mode: questionDialog.mode,
								from: questionDialog.pointTitle || '',
								form: questionDialog,
								onCancel: () => setQuestionDialog(null),
								onSubmit: submitQuestion,
								onRaw: rawQuestion,
								onEditTemplates: openEditorForSection,
							})
						: null,
					pointDialog
						? h(PointDialog, {
								t,
								theme: mdTheme,
								form: pointDialog,
								onCancel: () => setPointDialog(null),
								onSubmit: submitPoint,
								onRaw: rawPoint,
								onEditTemplates: openEditorForSection,
							})
						: null,
					gitOpen
						? h(GitDialog, {
								t,
								scope: gitScope,
								status: gitData,
								statusError: gitError,
								busy: gitBusy,
								result: gitResult,
								message: gitForm.message,
								pending: gitPending,
								outside: gitOutside,
								aiBusy: gitAi.busy,
								aiCandidates: gitAi.candidates,
								aiError: gitAi.error,
								onGenerate: generateGitMessage,
								onPick: (text) => setGitForm((form) => Object.assign({}, form, { message: text })),
								onMessage: (message) => setGitForm((form) => Object.assign({}, form, { message })),
								onRefresh: () => gitReload(true),
								onCommit: submitGit,
								onPushOnly: pushOnlyGit,
								onPull: pullGit,
								onCancel: () => setGitOpen(false),
							})
						: null,
					libraryDialog ? renderLibraryDialog() : null,
					rootDialog
						? h(
								'div',
								{ className: 'rk-modal', onClick: () => setRootDialog(null) },
								h(
									'div',
									{ className: 'rk-modal-card', onClick: (event) => event.stopPropagation() },
									h('div', { className: 'rk-modal-title' }, rootDialog.mode === 'rename' ? t('rootRename') : t('rootNew')),
									h('div', { className: 'rk-rootdialog-row' },
										h('span', { className: 'rk-rootdialog-label' }, t('rootName')),
										h('input', {
											className: 'rk-input',
											autoFocus: true,
											value: rootDialog.name,
											placeholder: t('rootName'),
											onChange: (event) => {
												const name = event.target.value;
												/* 新建时: 名字跟着默认路径走(用户自己改过路径就不再覆盖)
												 * 改名时: 绝不动路径 —— 路径就是这张画布本身 */
												const parent = canvasParent();
												const typed = String(rootDialog.path || '');
												const auto =
													rootDialog.mode !== 'rename' &&
													(typed === '' || typed === (rootDialog.name ? parent + '/' + rootDialog.name : ''));
												setRootDialog({
													...rootDialog,
													name,
													path:
														rootDialog.mode === 'rename'
															? rootDialog.path
															: auto
																? name
																	? parent + '/' + name
																	: ''
																: rootDialog.path,
													error: null,
												});
											},
											onKeyDown: (event) => {
												if (event.key === 'Enter') submitRootDialog();
												if (event.key === 'Escape') setRootDialog(null);
											},
										}),
									),
									rootDialog.mode === 'rename'
										? null
										: h(
												'div',
												{ className: 'rk-rootdialog-row' },
												h('span', { className: 'rk-rootdialog-label' }, t('rootPathLabel')),
												h('input', {
													className: 'rk-input',
													value: rootDialog.path,
													placeholder: (rootDialog.name ? canvasParent() + '/' + rootDialog.name : '/绝对路径'),
													onChange: (event) => setRootDialog({ ...rootDialog, path: event.target.value, error: null }),
													onKeyDown: (event) => {
														if (event.key === 'Enter') submitRootDialog();
														if (event.key === 'Escape') setRootDialog(null);
													},
												}),
											),
									rootDialog.mode === 'rename'
						? h('div', { className: 'rk-rootdialog-hint' }, t('rootRenameHint'))
						: h('div', { className: 'rk-rootdialog-hint' }, t('rootPathHint')),
									rootDialog.error ? h('div', { className: 'rk-rootdialog-error' }, rootDialog.error) : null,
									h(
										'div',
										{ className: 'rk-row', style: { justifyContent: 'flex-end', marginTop: 12, gap: 8 } },
										h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => setRootDialog(null) }, t('cancel')),
										h(
											'button',
											{ className: 'rk-btn rk-primary', type: 'button', disabled: !!rootDialog.busy, onClick: submitRootDialog },
											rootDialog.busy ? t('saving') : rootDialog.mode === 'rename' ? t('save') : t('rootCreate'),
										),
									),
								),
							)
						: null,
					toast ? h('div', { className: 'rk-toast' }, toast) : null,
				),
			);

			return panelRoot;
		}

		/* client/ 下的十一个模块用原生 import() 加载: loader 的 chunk 协议只认插件根目录的 client.<名>.js,
		 * 装不下子目录。所以改走插件自己的只读静态路由 /rk-study/client/<名>.js(见 host 半 lib/routes.js)。
		 * 模块之间不互相 import, 依赖统一由入口按拓扑顺序注入。
		 *
		 * 必须带 ?v= 加载: 入口 bundle 的 URL 每次刷新都带新的 &rev=<hash>, 所以入口一定会重新执行,
		 * 而下面这些 import() 的 URL 会留在文档的 ES module map 里 —— 不带版本号的话,
		 * 「把插件关一次开一次」会出现「新的 client.js 跑在旧的 client/*.js 上」的静默错配。
		 * 路由会先切掉 query 再解析文件(见 host 半 lib/routes.js), 所以带版本号是零成本的。
		 * 改 client/ 或 client.js 时, 与 host.js / cordis.patch.yml 的版本号一起 +1。 */
		const MODULE_VERSION = 133;
		const CLIENT_MODULES = ['dict', 'css', 'util', 'vendor', 'milkdown', 'md', 'cards', 'dialogs', 'editor', 'snippets', 'mindmap'];
		const loadClientModule = (name) => import('/rk-study/client/' + name + '.js?v=' + MODULE_VERSION);

		async function apply(ctx) {
			const [dict, css, util, vendor, milkdown, md, cards, dialogs, editor, snippets, mindmap] = await Promise.all(CLIENT_MODULES.map(loadClientModule));
			const dictMods = dict.createDict();
			const cssMods = css.createCss();
			const utilMods = util.createUtil();
			const vendorMods = vendor.createVendor({ React });
			/* milkdown: 把 vendor 里的 zt-react-milkdown 包跑起来(编辑界面用); 加载失败由调用方回退 textarea */
			const milkdownMods = milkdown.createMilkdown({
				React,
				ReactDOM,
				ReactDOMClient,
				JsxRuntime,
				doc: document,
				onError: (error) => ctx.logger?.warn?.('rk-study: zt-react-milkdown 加载失败, 已回退到源码编辑', error),
			});
			/* 依赖图无环: dict / css / util 是叶子, vendor 只要 React, milkdown 只要 react 家族, md 吃 vendor, cards 吃 md + util, editor 吃 md + cards, dialogs 吃 md */
			const mdMods = md.createMd({ React, MathNode: vendorMods.MathNode, MermaidBlock: vendorMods.MermaidBlock, looksLikeMath: vendorMods.looksLikeMath });
			const cardMods = cards.createCards({ React, renderInline: mdMods.renderInline, renderMarkdown: mdMods.renderMarkdown, formatCount: utilMods.formatCount, pathLabel: utilMods.pathLabel, countExamples: utilMods.countExamples, SKINS: cssMods.SKINS });
			/* snippets 只要 React: markdown 输入助手(小工具栏 + 公式/结构模板 + 快捷键) */
			const snippetsMods = snippets.createSnippets({ React, rootQuery: withRootQuery });
			const dialogMods = dialogs.createDialogs({ React, LivePreview: mdMods.LivePreview, MarkdownToolbar: snippetsMods.MarkdownToolbar, snippetKeyDown: snippetsMods.snippetKeyDown, milkdown: milkdownMods });
			const editorMods = editor.createEditor({ React, DeleteButton: cardMods.DeleteButton, LivePreview: mdMods.LivePreview, MarkdownToolbar: snippetsMods.MarkdownToolbar, snippetKeyDown: snippetsMods.snippetKeyDown, milkdown: milkdownMods });
			/* mindmap: 思维导图模式(左→右的章节 / 小节 / 知识点树), 知识点节点里渲染整篇 markdown 正文 */
			const mindmapMods = mindmap.createMindmap({ React, renderMarkdown: mdMods.renderMarkdown, renderPointBody: cardMods.renderPointBody });
			const mods = Object.assign({}, utilMods, vendorMods, mdMods, cardMods, dialogMods, editorMods, snippetsMods, mindmapMods, { SKINS: cssMods.SKINS });

			ensureStyles(ctx, cssMods.CSS);
			ctx.effect(() => ctx.locale.register(NS, { zh: dictMods.zh, en: dictMods.en }), 'rk-study: dictionaries');
			const t = ctx.locale.bind(NS);
			/* 目录选择窗体: 用宿主自带的那个(跟「打开文件夹」同一个); 没装就让「选择…」按钮置灰。
			 * uiWorkspace 必须在 inject 里声明: cordis 的 ctx.get(name) 默认 strict, provider 没就绪就返回
			 * undefined, 而 dirPicker.pick 是渲染时读的 —— 这里读空一次, 选择按钮就永久置灰了。 */
			try {
				const workspace = ctx.get('uiWorkspace');
				dirPicker.pick =
					workspace && typeof workspace.pickDirectory === 'function' ? () => workspace.pickDirectory() : null;
				if (dirPicker.pick === null) ctx.logger?.warn?.('rk-study: uiWorkspace.pickDirectory 不可用, 目录选择器已置灰');
			} catch (error) {
				dirPicker.pick = null;
				ctx.logger?.warn?.('rk-study: 读取 uiWorkspace 失败', error);
			}
			ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, mods }) }, RkStudyPanel));
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 15, label: () => t('panel'), locale: NS }, cardMods.PanelIcon),
			);
		}

		/* uiWorkspace 必须在 inject 里: dirPicker.pick 是渲染期读取的, 服务没就绪就读空, 选择按钮会永久置灰 */
		return { inject: ['slots', 'locale', 'uiWorkspace'], apply, NS, PANEL_ID };
	},
});

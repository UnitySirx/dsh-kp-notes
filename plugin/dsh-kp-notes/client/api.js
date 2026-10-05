/*
 * dsh-kp-notes — 客户端数据层。
 *
 * 原来长在 client.js 顶部那段标着 net 的数据层, 这里原样搬出来: 宿主那几个路由
 * (/rk-study/notes、/rk-study/roots、/rk-study/config、/rk-study/state、/rk-study/git) 的
 * fetch/post 包装, 外加 useCatalog / useGit 两个轮询 hook。
 *
 * 约定与 client/ 下其它模块一致: 依赖由入口(client.js 的 apply())按拓扑顺序注入,
 * 模块之间不互相 import —— 这里只要 React。
 *
 * 想加一个新请求, 加在这里并 return 出去, 面板从 props.mods 解出来用。
 */

export function createApi({ React }) {
	const { useState, useEffect, useCallback } = React;

	const ROUTE = '/rk-study/notes';
	const POLL_MS = 10000;
	const GIT_ROUTE = '/rk-study/git';
	const GIT_POLL_MS = 20000;
	/* 图片素材(见 README「图片素材」): 上传与显示都是这一条路由 */
	const MEDIA_ROUTE = '/rk-study/media';

	/* 多学习画布(多根目录): 每个请求都带上当前画布的根目录; 一级画布(rootPath 为空)时不带, 走插件默认根目录。
	 * activeRoot 只活在这一个页面会话里: 以前它同时写进 localStorage('rk-study:root'), 于是每次刷新 /
	 * 重开页面都会被送回上次那张画布; 现在一律从「全部画布」这一级打开, 想进哪张自己点进去。
	 * 面板里有自己的 rootPath state, 这个只是给 routeUrl / withRootQuery 用的会话值。 */
	const ROOTS_KEY = 'rk-study:roots';
	const DEFAULT_ROOT_KEY = 'rk-study:default-root';
	const ROOTS_ROUTE = '/rk-study/roots';
	const CONFIG_ROUTE = '/rk-study/config';
	const STATE_ROUTE = '/rk-study/state'; /* 插件级状态: 落盘那份由 host 存在 DSH 数据目录里 */ /* 学习库那一级的配置: <库>/.config/rk-study.json */
	let activeRoot = null;

	function getActiveRoot() {
		return activeRoot;
	}

	function setActiveRoot(value) {
		activeRoot = value === undefined || value === null || value === '' ? null : value;
	}

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

	/* 回收站: 这个根目录的 .remove 里收着什么 —— 删掉的章节/小节/知识点, 或者「移出列表」的画布。
	 * 宿主已经把「原位还在不在」「原来的号是多少」算好了, 前端只负责显示和点按钮。 */
	async function readBin(root, mode) {
		const response = await fetch(routeUrl({ bin: 1, mode: mode || 'chapters' }, root), { headers: { accept: 'application/json' } });
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'HTTP ' + response.status);
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

	/* 图片素材: 显示地址(带 ?root= 与 ?path=<markdown 里那段相对路径>)。
	 * 相对路径的换算全在 host 那边做(见 lib/routes.js 的 mediaFind), 客户端不需要知道笔记在哪、
	 * 素材目录叫什么 —— 卡片 / 导图 / 预览 / 编辑器都只拿 markdown 里那一段来问这一条 URL。 */
	function mediaUrl(rel) {
		const url = new URL(MEDIA_ROUTE, window.location.origin);
		if (activeRoot) url.searchParams.set('root', activeRoot);
		if (rel) {
			let text = String(rel).trim();
			try {
				text = decodeURIComponent(text);
			} catch {
				/* 不是合法的百分号编码就按原样用 */
			}
			url.searchParams.set('path', text);
		}
		return url.toString();
	}

	/* 上传: File → base64 → POST, 成功后 host 回 { ok, src, name, uid, path }。
	 * 失败返回 null(调用方显示「插入失败」, 不抛异常) */
	async function uploadMedia(payload) {
		const url = new URL(MEDIA_ROUTE, window.location.origin);
		if (activeRoot) url.searchParams.set('root', activeRoot);
		let response;
		try {
			response = await fetch(url.toString(), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
		} catch (error) {
			return null;
		}
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data.ok === false) return null;
		return data;
	}

	return {
		ROUTE,
		ROOTS_ROUTE,
		CONFIG_ROUTE,
		STATE_ROUTE,
		GIT_ROUTE,
		MEDIA_ROUTE,
		getActiveRoot,
		setActiveRoot,
		baseNameOf,
		readRoots,
		writeRoots,
		readRemoved,
		writeRemoved,
		readDefaultRoot,
		writeDefaultRoot,
		withRootFor,
		withRootQuery,
		routeUrl,
		fetchCatalog,
		fetchCatalogOf,
		fetchRoots,
		postRoot,
		fetchLibConfig,
		postLibConfig,
		readLocalState,
		fetchState,
		postState,
		fetchLibrary,
		fetchFile,
		fetchPoint,
		postAction,
		readBin,
		fetchGit,
		postGit,
		useGit,
		defaultGitMessage,
		useCatalog,
		mediaUrl,
		uploadMedia,
	};
}

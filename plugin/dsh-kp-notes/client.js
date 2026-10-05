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
				/* 图片素材(client/media.js): 面板里 <img> 的相对路径按它换成可显示地址 */
				media,
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
				useStore,
				useTheme,
				useGitPanel,
				useRoots,
				useEditing,
				useCanvas,
				useView,
				setMermaidTheme,
				/* 数据层(client/api.js): 宿主路由的 fetch/post 包装 + 目录 / git 两个轮询 hook */
				baseNameOf,
				defaultGitMessage,
				fetchCatalogOf,
				fetchFile,
				fetchLibConfig,
				fetchLibrary,
				fetchPoint,
				fetchRoots,
				fetchState,
				getActiveRoot,
				postAction,
				postGit,
				postLibConfig,
				postRoot,
				postState,
				readBin,
				readDefaultRoot,
				readLocalState,
				readRemoved,
				readRoots,
				setActiveRoot,
				useCatalog,
				useGit,
				writeDefaultRoot,
				writeRemoved,
				writeRoots,
			} = props.mods;
			const { data, error, loading, reload } = useCatalog();
			/* 本机 localStorage 与学习库配置的持久化都在 client/store.js 里 */
			const storeBag = useStore();
			const {
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
				saveLib,
				saveRoots,
				flushLib,
				setWorkRoot,
				fontScale,
				setFontScale,
				zoomRef,
				stepFont,
				toast,
				setToast,
				flash,
				loadRootStats,
			} = storeBag;
			/* 配色 / 主题 / 跟随宿主明暗 / 卡片各一色都在 client/theme.js 里 */
			const {
				skin, setSkin, skinOpen, setSkinOpen, skinBoxRef, skinList, skinHex,
				theme, setTheme, hostDark, follow, mdTheme, cardColors, setCardColors,
			} = useTheme({ libTick: storeBag.libTick, saveLib: storeBag.saveLib, setMermaidTheme });
			/* 一级画布: 多个「学习画布」(各自一个根目录); rootPath 为空 = 停在全部画布 */
			const [rootPath, setRootPath] = useState(() => getActiveRoot());
			/* 一级画布上 git 查的是整个学习库(库目录 + scope=all), 画布上查的是这张画布自己的 notes/ */
			const libPath = readDefaultRoot();
			const level1 = rootPath === null;
			/* Git 提交统一挂在根节点画布(一级画布)上: 目标根 = 学习库目录, 范围 = 全部 ⇒ 一次提交整个库 */
			const gitRoot = level1 ? libPath : rootPath;
			const gitScope = level1 ? 'all' : 'notes';
			/* Git 提交面板的状态与动作都在 client/git.js 里 */
			const {
				gitData, gitError, gitReload, gitCounts, gitPending, gitOutside,
				gitOpen, setGitOpen, gitBusy, gitResult, gitForm, setGitForm, gitAi, setGitAi,
				openGit, generateGitMessage, submitGit, pullGit, pushOnlyGit,
			} = useGitPanel({ t, gitRoot, gitScope, level1, reload, flash, setRootTick });
			/* 学习画布目录与新画布/导入学习库的弹窗状态都在 client/roots.js 里 */
			const {
				rootInfo, setRootInfo, rootDialog, setRootDialog, libraryDialog, setLibraryDialog,
				enterRoot, leaveRoot, openNewRoot, openRenameRoot, canvasParent, probeRoot, forgetRoot,
				submitRootDialog, openImportLib, chooseLibraryDir, runImportLib, renderLibraryDialog,
			} = useRoots({ t, storeBag, setRootPath, rootPath, dirPicker });
			/* 视野 / 字号按画布各存一份: 告诉 store 现在停在哪张画布(null = 一级画布 ⇒ 记进学习库那份配置)。
			 * 这条 effect 得排在下面「读配置」那条前面, 免得进画布后第一次写入还按上一张画布的落点算。 */
			useEffect(() => {
				setWorkRoot(rootPath);
			}, [rootPath, setWorkRoot]);
			const [binDialog, setBinDialog] = useState(null); /* 回收站面板: { busy, data, error } */

			/* 回收站只有两层看它:
			 *   · 根画布（还没进任何画布）—— 宿主去翻每张画布父目录的 .remove, 只列「被移出列表的整只画布」;
			 *   · 一级画布（进了某张画布）—— 只看这张画布自己的 .remove, 记录按章聚合成「整章」。 */
			const binMode = () => (level1 ? 'roots' : 'chapters');
			const binRoot = () => (level1 ? libPath : rootPath || libPath);
			const binRows = (data) => (data && data.mode === 'chapters' ? data.chapters || [] : (data && data.buckets) || []);

			async function openBin() {
				setBinDialog({ busy: true, data: null, error: '' });
				try {
					setBinDialog({ busy: false, data: await readBin(binRoot(), binMode()), error: '' });
				} catch (problem) {
					setBinDialog({ busy: false, data: null, error: String((problem && problem.message) || problem) });
				}
			}

			async function reloadBin() {
				try {
					const data = await readBin(binRoot(), binMode());
					setBinDialog((current) => (current ? { busy: false, data, error: '' } : current));
				} catch (problem) {
					setBinDialog((current) => (current ? { busy: false, data: current.data, error: String((problem && problem.message) || problem) } : current));
				}
			}

			/* 一级画布那层恢复的可能是「被移出列表」的画布: 除了放开墓碑, 还要把它重新登记进画布列表,
			 * 否则放过墓碑了、列表里也看不见它。 */
			const noteRestoredCanvas = (target) => {
				const item = String(target || '');
				if (!level1 || item === '' || item.charAt(0) !== '/') return;
				const list = readRoots().slice();
				if (!list.some((entry) => entry.path === item)) {
					list.push({ path: item, name: baseNameOf(item) || item });
					saveRoots(list);
				}
				unmarkRemoved(item);
				setRoots(list);
				loadRootStats(list);
				setRootTick((value) => value + 1);
			};

			/* 恢复一条: 搬回原位, 号跟着回去; 被移出列表的画布顺手放开墓碑。
			 * 原位已经有同名的东西时宿主会拒绝（绝不覆盖）, 这里把原话提示给用户。 */
			async function restoreBinItem(bucket, item) {
				setBinDialog((current) => (current ? { ...current, busy: true, error: '' } : current));
				try {
					await postAction({ action: 'restore', bucket: bucket.name, item: item.item, box: bucket.box || '' });
					if (level1) noteRestoredCanvas(item.target);
					else {
						unmarkRemoved(String(item.target || ''));
						reload(true);
					}
					flash(t('binRestored') + ' · ' + item.item);
					await reloadBin();
				} catch (problem) {
					const message = String((problem && problem.message) || problem);
					setBinDialog((current) => (current ? { ...current, busy: false, error: message } : current));
				}
			}

			/* 老格式的 .remove 里没有「桶」: 直接躺在 .remove 下的每条记录都是一整份,
			 * 一条一条搬回去, 汇总成跟宿主同一个形状。 */
			async function restoreLegacyRows(bucket) {
				const restored = [];
				const skipped = [];
				for (const item of bucket.items || []) {
					try {
						const one = await postAction({ action: 'restore', bucket: '', item: item.item, box: bucket.box || '' });
						restored.push({ target: (one && one.target) || item.target });
					} catch (problem) {
						skipped.push({ item: item.item, error: String((problem && problem.message) || problem) });
					}
				}
				return { restored, skipped };
			}

			async function restoreWholeBin(bucket) {
				setBinDialog((current) => (current ? { ...current, busy: true, error: '' } : current));
				try {
					const result = bucket.legacy
						? await restoreLegacyRows(bucket)
						: await postAction({ action: 'restoreBucket', bucket: bucket.name, box: bucket.box || '' });
					const done = (result.restored || []).length;
					const skipped = (result.skipped || []).length;
					(result.restored || []).forEach((row) => {
						if (level1) noteRestoredCanvas(row.target);
						else unmarkRemoved(String(row.target || ''));
					});
					if (!level1) reload(true);
					flash(t('binRestored') + ' · ' + done + (skipped > 0 ? ' · ' + skipped + ' ' + t('binSkipped') : ''));
					await reloadBin();
				} catch (problem) {
					const message = String((problem && problem.message) || problem);
					setBinDialog((current) => (current ? { ...current, busy: false, error: message } : current));
				}
			}

			/* 一级画布那层只有这一个动作: 把这一章在所有桶里的东西整段合并回去。 */
			async function restoreBinChapter(chapter) {
				setBinDialog((current) => (current ? { ...current, busy: true, error: '' } : current));
				try {
					const result = await postAction({ action: 'restoreChapter', chapter: chapter.chapter, box: chapter.box || '' });
					const done = (result.restored || []).length;
					const skipped = (result.skipped || []).length;
					(result.restored || []).forEach((row) => unmarkRemoved(String(row.target || '')));
					reload(true);
					flash(t('binRestored') + ' · ' + (chapter.name || chapter.chapter) + ' · ' + done + (skipped > 0 ? ' · ' + skipped + ' ' + t('binSkipped') : ''));
					await reloadBin();
				} catch (problem) {
					const message = String((problem && problem.message) || problem);
					setBinDialog((current) => (current ? { ...current, busy: false, error: message } : current));
				}
			}


			const [route, setRoute] = useState({ view: 'map' });
			const [query, setQuery] = useState('');
			const [editor, setEditor] = useState(null);
			const [nameDialog, setNameDialog] = useState(null);
			const [pointDialog, setPointDialog] = useState(null);
			const [questionDialog, setQuestionDialog] = useState(null);
			const [saving, setSaving] = useState(false);
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
			/* 读一次配置: 学习库那份 + 当前画布自己那份(视野缩放 / 字号 / 配色 / 画布列表 / 移出列表)。
			 * 视野与字号「按画布各存一份」, 所以进 / 出一张画布要重读一次; 画布那份盖在库那份上面。
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
				const readConfig = (root) => fetchLibConfig(root).then((saved) => (saved && typeof saved === 'object' ? saved : {})).catch(() => ({}));
				libLoadRef.current = (async () => {
					const file = await readConfig(lib);
					if (!alive) return file;
					/* 画布自己那份: 它自己的视野(键就是这张画布的路径) + 字号 */
					const own = rootPath && rootPath !== lib ? await readConfig(rootPath) : {};
					if (!alive) return file;
					const zoom = Object.assign({}, file.zoom && typeof file.zoom === 'object' ? file.zoom : {});
					const ownZoom = own.zoom && typeof own.zoom === 'object' ? own.zoom : null;
					if (rootPath && ownZoom) {
						if (ownZoom[rootPath] && typeof ownZoom[rootPath] === 'object') zoom[rootPath] = ownZoom[rootPath];
						else {
							const views = Object.keys(ownZoom).filter((key) => ownZoom[key] && typeof ownZoom[key] === 'object');
							/* 画布被整个拷到别的路径: 那份配置里只有一条视野就认它, 否则退回按路径合并 */
							if (views.length === 1) zoom[rootPath] = ownZoom[views[0]];
							else Object.assign(zoom, ownZoom);
						}
					}
					libZoomRef.current = zoom;
					/* 移出列表取并集: 墓碑宁多勿少 */
					let changed = false;
					for (const path of Array.isArray(file.removed) ? file.removed : []) {
						if (typeof path !== 'string' || path.charAt(0) !== '/' || removedRef.current.indexOf(path) >= 0) continue;
						removedRef.current = removedRef.current.concat([path]);
						changed = true;
					}
					if (changed) writeRemoved(removedRef.current);
					/* 字号 / 配色: 本机存过就以本机为准, 没存过(换台机器)才用文件里的; 画布那份盖在库那份上 */
					const ui = Object.assign({}, file.ui && typeof file.ui === 'object' ? file.ui : {}, own.ui && typeof own.ui === 'object' ? own.ui : {});
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
				})();
				return () => {
					alive = false;
				};
			}, [libRev, rootPath]);
			/* 启动时把落盘那份状态补进 localStorage: 只补「本机没有」的键(本机存过的以本机为准),
			 * 画布列表与墓碑取并集。补完踢一次 libRev / rootTick, 让「读库配置」与扫盘按新状态重跑。 */
			const stateReadyRef = useRef(false);
			/* 面板根节点: 图片素材的相对路径 → 可显示地址的改写挂在这上面(见 client/media.js)。
			 * 挂一次管整块面板(卡片 / 导图 / 预览 / 编辑器都在里面), 新插入的 <img> 由 MutationObserver 兜住。 */
			const panelRootRef = useRef(null);
			useEffect(() => {
				const node = panelRootRef.current;
				if (!media || typeof media.watchImages !== 'function' || !node) return undefined;
				return media.watchImages(node);
			}, []);
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
			}, []);

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

			/* ---- 一级画布(多学习画布) ---- */

			/* 换画布: 记住当前根目录(只给本次会话的请求用), 回到画布视图, 并让目录立刻重拉一次。
			 * 不再写 localStorage / 状态文件 —— 下次打开一律从「全部画布」开始。 */
			useEffect(() => {
				setActiveRoot(rootPath);
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

			const catalog = data;
			const stats = (catalog && catalog.stats) || { chapters: 0, sections: 0, points: 0, examples: 0, words: 0 };
			/* 画布挂在本学习库下时, Git 提交只出现在一级画布(一次提交整个库); 自带根目录的画布保留自己的入口 */
			const gitInLibrary = !!(libPath && rootPath && (rootPath === libPath || rootPath.indexOf(libPath + '/') === 0));
			const showGit = !!gitData && (level1 || !gitInLibrary);
			const current = route.view === 'section' || route.view === 'point' ? findSection(catalog, route.path) : null;
			const currentPoint = current && route.pointId ? findPoint(current.section.points, route.pointId) : null;
			const detailOpen = route.view === 'section' || route.view === 'point';
			/* 章节图画布常驻: 右侧面板打开时也照样能平移/缩放 */
			const mapReady = level1 ? true : query.trim() === '' && !!catalog && (catalog.chapters || []).length > 0;
			/* 画布视口 / 导图几何 / 舞台指针这一层搬到了 client/canvas.js */
			const { view, setView, panning, setPanning, measureTick, setMeasureTick, stageRef, ringRef, hoverRef, panRef, measured, didFit, mapFits, userMoved, mapRef, layoutKey, zoomKey, VIEW_VERSION, cardWidth, cardGap, ROOT_CARD_H, MIN_SCALE, MAX_SCALE, stageBox, setStageBox, rootCols, lastFit, interacting, mmSizes, setMmSizes, updateRing, clearRing, onStagePointerOver, positions, onMindMeasure, mind, rootCards, extent, fitView, refreshMap, menu, setMenu, menuRef, closeMenu, openMenu, onStagePointerDown, onStagePointerMove, onStagePointerUp, needle, hits } = useCanvas({
				t, mode, mapReady, level1, catalog, query, reload, setRoute,
				folded, opened, roots, libTick, saveLib, zoomRef, libZoomRef, libReadyRef,
				roundScale, snapToDevice, layoutMindmap, buildMindmapTree, flattenPoints,
			});
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

			/* 打开 / 编辑 / 新建 / 删除 那一层都在 client/editing.js 里 */
			const {
				openEditorForSection, editQuestion, editPoint, submitPoint, rawPoint,
				startNewSection, startNewChapter, startRenameChapter, submitChapterName,
				addQuestion, submitQuestion, rawQuestion, flashError,
				removeEntry, removeChapter, removeQuestion, startNewUnit, submitEditor,
				onBlankContextMenu, onCardContextMenu,
			} = useEditing({
				t, flash, reload, pathLabel, pointError, questionError,
				openMenu, openNewRoot, fitView, openSection, mapReady, mind, level1,
				setRoute, setSaving, editor, setEditor,
				nameDialog, setNameDialog, pointDialog, setPointDialog, questionDialog, setQuestionDialog,
			});
			/* 渲染层(菜单 / 一级画布卡片 / 导图 / 小节 / 知识点 / 正文)搬到了 client/view.js */
			const { renderMenu, renderRootCards, renderMap, renderSection, renderPoint, body, detailBody } = useView({
				t, menu, setMenu, closeMenu, menuRef, view, setView, extent, rootCards, rootStats,
				cardWidth, ROOT_CARD_H, rootCols, cardGap, level1, catalog, needle, hits, mind, mmSizes,
				positions, onMindMeasure, route, error, loading, current, currentPoint,
				enterRoot, openRenameRoot, forgetRoot, openNewRoot, openPoint, removeEntry, openSection,
				startNewSection, removeChapter, startRenameChapter, openEditorForSection, startNewUnit, removeQuestion, editQuestion,
				setRoute, editPoint, addQuestion, onMindToggle, onCardContextMenu,
				formatCount, PointCard, flashError, cardColors, MindMap, ChapterCard, DeleteButton,
				pathLabel, renderMarkdown, ExampleBlock, PointDetail,
			});

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
				h('button', { key: 'bin', className: 'rk-btn', type: 'button', title: t('binHint'), onClick: openBin }, '♻ ' + t('binTrash')),
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
				{ className: 'rk-root rk-skin-' + skin + (follow ? ' rk-follow' : ''), ref: panelRootRef, style: { zoom: String(fontScale / 100) } },
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
					binDialog
						? h(
								'div',
								{ className: 'rk-modal', onClick: () => setBinDialog(null) },
								h(
									'div',
									{ className: 'rk-modal-card rk-bin', onClick: (event) => event.stopPropagation() },
									h('div', { className: 'rk-modal-title' }, '♻ ' + t('binTrash')),
									h(
										'div',
										{ className: 'rk-bin-hint' },
										(binDialog.data && binDialog.data.root ? t('binAt') + ' ' + binDialog.data.root + '　' : '') +
											t(binDialog.data && binDialog.data.mode === 'chapters' ? 'binChapterHint' : 'binHint'),
									),
									binDialog.error ? h('div', { className: 'rk-bin-error' }, binDialog.error) : null,
									binDialog.busy && !binDialog.data
										? h('div', { className: 'rk-bin-empty' }, t('loading'))
										: !binDialog.data || binRows(binDialog.data).length === 0
											? h('div', { className: 'rk-bin-empty' }, t('binEmpty'))
											: binDialog.data.mode === 'chapters'
												? (binDialog.data.chapters || []).map((chapter) =>
														h(
															'div',
															{ key: chapter.chapter, className: 'rk-bin-bucket' },
															h(
																'div',
																{ className: 'rk-bin-head' },
																h('span', { className: 'rk-bin-when' }, chapter.name || chapter.chapter),
																h('span', { className: 'rk-bin-count' }, String(chapter.count || 0) + ' ' + t('binItems')),
																chapter.uid ? h('span', { className: 'rk-bin-uid' }, chapter.uid) : null,
																h(
																	'button',
																	{
																		className: 'rk-btn rk-bin-btn',
																		type: 'button',
																		title: (chapter.items || []).map((one) => one.item).join('\n') || chapter.chapter,
																		disabled: binDialog.busy,
																		onClick: () => restoreBinChapter(chapter),
																	},
																	'↩ ' + t('binRestoreChapter'),
																),
															),
														),
													)
												: (binDialog.data.buckets || []).map((bucket) =>
														h(
															'div',
															{ key: (bucket.box || '') + '|' + bucket.name, className: 'rk-bin-bucket' },
															h(
																'div',
																{ className: 'rk-bin-head' },
																h('span', { className: 'rk-bin-when', title: bucket.legacy ? t('binLegacyHint') : '' }, bucket.at || bucket.name),
																h('span', { className: 'rk-bin-count' }, String(bucket.count || 0) + ' ' + t('binItems')),
																(binDialog.data.boxes || []).length > 1 && bucket.root
																	? h('span', { className: 'rk-bin-src', title: bucket.root }, t('binFrom') + ' ' + bucket.root)
																	: null,
																h(
																	'button',
																	{
																		className: 'rk-btn rk-bin-btn',
																		type: 'button',
																		title: bucket.legacy ? t('binLegacyHint') : '',
																		disabled: binDialog.busy,
																		onClick: () => restoreWholeBin(bucket),
																	},
																	'↩ ' + t('binRestoreAll'),
																),
															),
															h(
																'ul',
																{ className: 'rk-bin-list' },
																(bucket.items || []).map((item) =>
																	h(
																		'li',
																		{ key: item.item, className: 'rk-bin-item' },
																		h('span', { className: 'rk-bin-path', title: item.target || item.item }, (item.kind === 'dir' ? '▸ ' : '· ') + item.item),
																		item.uid ? h('span', { className: 'rk-bin-uid' }, item.uid) : null,
																		h(
																			'button',
																			{
																				className: 'rk-btn rk-bin-btn',
																				type: 'button',
																				disabled: binDialog.busy,
																				onClick: () => restoreBinItem(bucket, item),
																			},
																			'↩ ' + t('binRestore'),
																		),
																	),
																),
															),
														),
													),
									h('div', { className: 'rk-bin-foot' }, h('button', { className: 'rk-btn', type: 'button', onClick: () => setBinDialog(null) }, t('cancel'))),
								),
							)
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

		/* client/ 下的这些模块用原生 import() 加载: loader 的 chunk 协议只认插件根目录的 client.<名>.js,
		 * 装不下子目录。所以改走插件自己的只读静态路由 /rk-study/client/<名>.js(见 host 半 lib/routes.js)。
		 * 模块之间不互相 import, 依赖统一由入口按拓扑顺序注入。
		 *
		 * 必须带 ?v= 加载: 入口 bundle 的 URL 每次刷新都带新的 &rev=<hash>, 所以入口一定会重新执行,
		 * 而下面这些 import() 的 URL 会留在文档的 ES module map 里 —— 不带版本号的话,
		 * 「把插件关一次开一次」会出现「新的 client.js 跑在旧的 client/*.js 上」的静默错配。
		 * 路由会先切掉 query 再解析文件(见 host 半 lib/routes.js), 所以带版本号是零成本的。
		 * 改 client/ 或 client.js 时, 与 host.js / cordis.patch.yml 的版本号一起 +1。 */
		const MODULE_VERSION = 165;
		const CLIENT_MODULES = ['api', 'store', 'theme', 'git', 'roots', 'editing', 'canvas', 'view', 'dict', 'css', 'util', 'vendor', 'milkdown', 'md', 'media', 'cards', 'dialogs', 'editor', 'snippets', 'mindmap'];
		const loadClientModule = (name) => import('/rk-study/client/' + name + '.js?v=' + MODULE_VERSION);

		async function apply(ctx) {
			const [api, store, theme, gitPanel, rootsMod, editingMod, canvasMod, viewMod, dict, css, util, vendor, milkdown, md, media, cards, dialogs, editor, snippets, mindmap] = await Promise.all(CLIENT_MODULES.map(loadClientModule));
			/* api: 宿主路由的 fetch/post 包装 + 目录 / git 两个轮询 hook(见 client/api.js) */
			const apiMods = api.createApi({ React });
			/* store: 本机 localStorage + 学习库配置文件(<库>/.config/rk-study.json)的读写(见 client/store.js) */
			const storeMods = store.createStore({
				React,
				api: apiMods,
				FONT_STEPS,
				KEYS: { FONT_KEY, SKIN_KEY, ITEM_KEY, THEME_KEY },
			});
			const dictMods = dict.createDict();
			const cssMods = css.createCss();
			/* theme: 配色 / 主题 / 跟随宿主明暗 / 卡片各一色(见 client/theme.js) */
			const themeMods = theme.createTheme({ React, KEYS: { FONT_KEY, SKIN_KEY, ITEM_KEY, THEME_KEY }, SKINS: cssMods.SKINS });
			/* git: 提交 / 仅推送 / 拉取 / 模型写 commit message(见 client/git.js) */
			const gitPanelMods = gitPanel.createGitPanel({ React, api: apiMods });
			/* roots: 学习画布目录(新建/改名/移出列表)与导入学习库(见 client/roots.js) */
			const rootsMods = rootsMod.createRoots({ React, api: apiMods });
			/* editing: 打开/编辑/新建/删除(见 client/editing.js) */
			const editingMods = editingMod.createEditing({ React, api: apiMods });
			/* canvas: 画布视口 / 导图几何 / 舞台指针(见 client/canvas.js) */
			const canvasMods = canvasMod.createCanvas({ React });
			/* view: 渲染层 —— 右键菜单 / 一级画布卡片 / 导图 / 小节 / 知识点 / 正文(见 client/view.js) */
			const viewMods = viewMod.createView({ React });
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
			/* media: 图片素材 —— 插图落盘到 media/<小节uid>.assestfiles/ + 面板里相对 src 的显示换算(见 client/media.js) */
			const mediaMods = media.createMedia({ api: apiMods });
			/* 依赖图无环: dict / css / util 是叶子, vendor 只要 React, milkdown 只要 react 家族, md 吃 vendor, cards 吃 md + util, editor 吃 md + cards, dialogs 吃 md */
			const mdMods = md.createMd({ React, MathNode: vendorMods.MathNode, MermaidBlock: vendorMods.MermaidBlock, looksLikeMath: vendorMods.looksLikeMath });
			const cardMods = cards.createCards({ React, renderInline: mdMods.renderInline, renderMarkdown: mdMods.renderMarkdown, formatCount: utilMods.formatCount, pathLabel: utilMods.pathLabel, countExamples: utilMods.countExamples, SKINS: cssMods.SKINS });
			/* snippets 只要 React: markdown 输入助手(小工具栏 + 公式/结构模板 + 快捷键) */
			const snippetsMods = snippets.createSnippets({ React, rootQuery: apiMods.withRootQuery });
			const dialogMods = dialogs.createDialogs({ React, LivePreview: mdMods.LivePreview, MarkdownToolbar: snippetsMods.MarkdownToolbar, snippetKeyDown: snippetsMods.snippetKeyDown, unescapeRedundant: mdMods.unescapeRedundant, media: mediaMods, milkdown: milkdownMods });
			const editorMods = editor.createEditor({ React, DeleteButton: cardMods.DeleteButton, LivePreview: mdMods.LivePreview, MarkdownToolbar: snippetsMods.MarkdownToolbar, snippetKeyDown: snippetsMods.snippetKeyDown, milkdown: milkdownMods, unescapeRedundant: mdMods.unescapeRedundant, media: mediaMods });
			/* mindmap: 思维导图模式(左→右的章节 / 小节 / 知识点树), 知识点节点里渲染整篇 markdown 正文 */
			const mindmapMods = mindmap.createMindmap({ React, renderMarkdown: mdMods.renderMarkdown, renderPointBody: cardMods.renderPointBody });
			/* 注意: Object.assign 是把每个模块工厂的返回**摊平**进 mods 的(面板直接解构 ChapterCard / useStore …),
			 * 所以 media 这种「要整体拿走」的得写成字面量属性 { media: mediaMods } —— 直接把 mediaMods 当参数传进去
			 * 只会把它的成员(isRelativeSrc / upload / watchImages …)摊到顶层, 面板里的 media 就是 undefined。 */
			const mods = Object.assign({}, apiMods, storeMods, themeMods, gitPanelMods, rootsMods, editingMods, canvasMods, viewMods, utilMods, vendorMods, mdMods, cardMods, dialogMods, editorMods, snippetsMods, mindmapMods, { SKINS: cssMods.SKINS, media: mediaMods });

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

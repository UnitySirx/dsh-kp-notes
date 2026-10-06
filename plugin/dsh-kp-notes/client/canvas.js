/* 画布视口 / 导图几何 / 舞台指针这一层 —— 从 client.js 的 RkStudyPanel 里搬出来。
 *
 * 这些状态与 ref 是绑在一起的一组: 视野(view/panning)、舞台尺寸与测量(stageBox/measureTick/measured/
 * mmSizes)、导图几何(mind/positions/rootCards/extent)、自动铺满的几次机会(mapFits/didFit/userMoved)、
 * 右键菜单(menu)与检索命中(hits)。它们互相读对方的当前值, 所以整块一起搬。
 *
 * 面板侧仍然保留: 路由(route/query)、两个派生值(catalog/mapReady)、写面板 own 的 folded/opened 的
 * toggleFold/toggleOpen、以及路由跳转 openSection/openPoint —— 它们要么是别的域的, 要么只碰路由。
 *
 * 依赖全部由入口按名字注入, 子模块之间不互相 import(与 client/*.js 其余模块同一套范式)。
 */
export function createCanvas({ React, sizes }) {
	const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;
	const S = sizes; /* client/sizes.js 注入: 卡片宽高 / 间距 / 缩放上下限 / 舞台留白 / 菜单尺寸 */

	/* t / mode / mapReady / level1 / catalog / query / reload / setRoute          —— 面板
	 * folded / opened / roots / libTick / saveLib / zoomRef / libZoomRef / libReadyRef —— store
	 * roundScale / snapToDevice / layoutMindmap / buildMindmapTree / flattenPoints —— 几何助手
	 */
	function useCanvas({ t, mode, mapReady, level1, catalog, query, reload, setRoute,
		folded, opened, roots, libTick, saveLib, zoomRef, libZoomRef, libReadyRef,
		roundScale, snapToDevice, layoutMindmap, buildMindmapTree, flattenPoints }) {
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
		const mapRef = useRef(mapReady);
		mapRef.current = mapReady;
		const layoutKey = 'rk-canvas:' + (level1 ? 'roots' : (catalog && catalog.root) || 'default');
		/* 学习库配置里视野的键: 一级画布是 'roots', 每张画布用它自己的根目录路径 */
		const zoomKey = level1 ? 'roots' : (catalog && catalog.root) || 'default';
		const VIEW_VERSION = 2;
		/* 尺寸来自 client/sizes.js(入口注入): 根画布(rootCanvas)与画布内(canvas)两套卡片尺寸互不影响,
		 * 缩放范围是共用的 stage —— 想调卡片大小去那个文件改对应的那一级 */
		const G = level1 ? S.rootCanvas : S.canvas;
		const cardWidth = G.cardWidth;
		const cardGap = G.cardGap;
		const ROOT_CARD_H = S.rootCanvas.cardHeight; /* 只有一级画布(根画布)的卡片是固定卡高 */
		const MIN_SCALE = S.stage.minScale; /* 一行卡片可能很长, 复位时允许缩得更小才能全铺满 */
		const MAX_SCALE = S.stage.maxScale;
		/* 插件区域的实际宽度: 宿主侧栏展开/收起、拉窗口都由它驱动自适应 */
		const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
		/* 一级画布的列数跟着可用宽度走(窄了就 1-2 列), 别硬撑 rootColsMax 列;
		 * 减掉的是根画布舞台的左右内边距(sizes.rootCanvas.stagePadX, 与 css.js 的 .rk-stage 同源) */
		const rootCols = stageBox.w > 0 ? Math.max(1, Math.min(S.rootCanvas.rootColsMax, Math.floor((stageBox.w - S.rootCanvas.stagePadX * 2 + cardGap) / (cardWidth + cardGap)))) : S.rootCanvas.rootColsMax;
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
					/* 本机那条得真的能用才算数: 老版本(v 对不上) / 坏掉的条目不能当成「本机有」,
					 * 否则下面直接 return 会让视野停在一个默认值上, 再被 saveLib 写回文件 —— 用户看到的
					 * 就是「离开插件再进来, 画布缩放被重置」。 */
					if (saved && saved.view && saved.v === VIEW_VERSION) {
						applyView(saved.view);
						userMoved.current = true;
						didFit.current = true;
						return;
					}
				}
			} catch (problem) {
				/* 存储不可用就算了 */
			}
			/* 本机没存过(换浏览器 / 换机器 / 本机那条用不了) ⇒ 用学习库配置里的那一份 */
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

		/* 首次进入画布(没有存过视图)自动铺满一次 —— 但要等学习库 / 画布那份配置读完:
		 * 配置还没读回来时铺满, 会把铺满结果当成「本机存过的视野」写进本机与文件, 文件里那份真值就没了 */
		useEffect(() => {
			if (!mapReady || !libReadyRef.current || didFit.current || measureTick === 0 || extent.w <= 0 || mind || level1) return;
			didFit.current = true;
			fitView();
		}, [mapReady, measureTick, extent, fitView, mind, level1, libTick]);

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
			/* 视野是「本机存过的 / 学习库配置里的 / 用户自己调过的」(userMoved) 就绝不再自动铺满:
			 * 面板刚挂上来的头几次尺寸测量还是布局噪声, 拿它重新铺满, 会把刚从学习库恢复的那份视野
			 * 直接盖掉 —— 表现就是「离开插件再进来, 画布缩放被重置」。内容真被挤出去时, 用户按一下
			 * 铺满/复位就行。 */
			if (userMoved.current) return;
			const fits = view.scale * extent.w <= stageBox.w - 24 && view.scale * extent.h <= stageBox.h - 24;
			if (fits) return;
			fitView();
		}, [stageBox, mapReady, fitView, extent, view.scale]);

		/* 切模式时视图复位一次(导图与画布的布局不一样), 并让下次回画布时重新铺满。
		 * 首次挂载不算「切模式」: 那一下复位会把刚从本机 / 学习库配置里恢复回来的视野清掉。 */
		const modeRef = useRef(mode);
		useEffect(() => {
			if (modeRef.current === mode) return;
			modeRef.current = mode;
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

		/* 右键菜单: 屏幕空间浮层(不参与画布缩放), 靠 stage 的 padding-box 定位;
		 * 四个尺寸与 css.js 的 .rk-menu / .rk-menu-item 同源(sizes.menu), 改一处两边一起变 */
		const MENU_W = S.menu.width;
		const MENU_ITEM_H = S.menu.itemH;
		const MENU_SEP_H = S.menu.sepH;
		const MENU_PAD = S.menu.pad;
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

		return { view, setView, panning, setPanning, measureTick, setMeasureTick, stageRef, ringRef, hoverRef, panRef, measured, didFit, mapFits, userMoved, mapRef, layoutKey, zoomKey, VIEW_VERSION, cardWidth, cardGap, ROOT_CARD_H, MIN_SCALE, MAX_SCALE, stageBox, setStageBox, rootCols, lastFit, interacting, mmSizes, setMmSizes, updateRing, clearRing, onStagePointerOver, positions, onMindMeasure, mind, rootCards, extent, fitView, refreshMap, menu, setMenu, menuRef, closeMenu, openMenu, onStagePointerDown, onStagePointerMove, onStagePointerUp, needle, hits };
	}

	return { useCanvas };
}

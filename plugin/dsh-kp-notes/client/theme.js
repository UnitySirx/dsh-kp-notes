/*
 * dsh-kp-notes — 客户端的配色与主题。
 *
 * 三件事:
 *   1. 配色皮肤(skin): 只换 .rk-root 上的一组 CSS 变量(见 client/css.js 的 SKINS), 记在本地与库配置;
 *   2. 主题(theme): 插件配色(默认) / 跟随主题(follow) —— 跟随主题 = 底色 / 文字 / 线条全用宿主
 *      DeepSeek Harness 的主题 token, 强调色取宿主的 brand 色; 宿主切明暗时立刻跟着换, 不用刷新;
 *   3. 卡片各用一色(cardColors): 章节卡 / 小节行 / 知识点卡各自带一个强调色。
 *
 * 依赖一律从外面传进来(deps 里是 React 与持久化那一层的东西), 模块之间不互相 import。
 */
export function createTheme({ React, KEYS, SKINS }) {
	const { useState, useEffect, useRef } = React;

	function useTheme({ libTick, saveLib, setMermaidTheme }) {
		/* 配色: 参考 Material Design 色板, 点色块即换(整套变量换掉, 布局不动) */
		const [skin, setSkin] = useState(() => {
			try {
				return window.localStorage.getItem(KEYS.SKIN_KEY) || 'tech';
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
				const saved = window.localStorage.getItem(KEYS.THEME_KEY);
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
				return window.localStorage.getItem(KEYS.ITEM_KEY) !== '0';
			} catch (problem) {
				return true;
			}
		});
		const skinBoxRef = useRef(null);
		const skinList = SKINS || [];
		const skinHex = (skinList.find((item) => item.id === skin) || skinList[0] || { hex: '#3fb6ff' }).hex;
		useEffect(() => {
			try {
				window.localStorage.setItem(KEYS.SKIN_KEY, skin);
			} catch (problem) {
				/* 存不上就算了, 不影响使用 */
			}
			saveLib({ ui: { skin } });
		}, [skin, libTick, saveLib]);
		useEffect(() => {
			try {
				window.localStorage.setItem(KEYS.THEME_KEY, theme);
			} catch (problem) {
				/* 存不上就算了, 不影响使用 */
			}
			saveLib({ ui: { theme } });
		}, [theme, libTick, saveLib]);
		/* 图表(mermaid)配色也跟主题走: 设置一次, 已经画出来的图会自己重画 */
		useEffect(() => {
			if (typeof setMermaidTheme === 'function') setMermaidTheme(mdTheme);
		}, [mdTheme, setMermaidTheme]);
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
				window.localStorage.setItem(KEYS.ITEM_KEY, cardColors ? '1' : '0');
			} catch (problem) {
				/* 存不上就算了, 不影响使用 */
			}
			saveLib({ ui: { cardColors } });
		}, [cardColors, libTick, saveLib]);
		useEffect(() => {
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
		return {
			skin, setSkin, skinOpen, setSkinOpen, skinBoxRef, skinList, skinHex,
			theme, setTheme, hostDark, readHostDark, hostBrandTriplet, follow, mdTheme,
			cardColors, setCardColors,
		};
	}

	return { useTheme };
}

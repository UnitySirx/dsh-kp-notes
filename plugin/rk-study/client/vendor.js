/* rk-study · client/vendor.js —— 公式与流程图
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createVendor(deps) {
	const React = deps.React;
	const h = React.createElement;
	const { useState, useEffect, useRef } = React;
	/* --------------------------- 数学公式 / 流程图: 按需拉取随插件分发的渲染引擎 */

	const VENDOR = '/rk-study/vendor';
	const katexLoader = { promise: null };
	const mermaidLoader = { promise: null };

	function loadVendorScript(src) {
		return new Promise((resolve, reject) => {
			const found = document.querySelector('script[data-rk-vendor="' + src + '"]');
			if (found) {
				if (found.dataset.rkLoaded === '1') resolve();
				else {
					found.addEventListener('load', () => resolve());
					found.addEventListener('error', () => reject(new Error('vendor-load-failed: ' + src)));
				}
				return;
			}
			const el = document.createElement('script');
			el.src = src;
			el.async = true;
			el.dataset.rkVendor = src;
			el.addEventListener('load', () => {
				el.dataset.rkLoaded = '1';
				resolve();
			});
			el.addEventListener('error', () => reject(new Error('vendor-load-failed: ' + src)));
			document.head.appendChild(el);
		});
	}

	function loadVendorStyle(href) {
		if (document.querySelector('link[data-rk-vendor="' + href + '"]')) return;
		const el = document.createElement('link');
		el.rel = 'stylesheet';
		el.href = href;
		el.dataset.rkVendor = href;
		document.head.appendChild(el);
	}

	function ensureKatex() {
		if (!katexLoader.promise) {
			katexLoader.promise = (async () => {
				loadVendorStyle(VENDOR + '/katex.min.css');
				await loadVendorScript(VENDOR + '/katex.min.js');
				if (!window.katex) throw new Error('katex-missing');
				return window.katex;
			})().catch((error) => {
				katexLoader.promise = null;
				throw error;
			});
		}
		return katexLoader.promise;
	}

	function ensureMermaid() {
		if (!mermaidLoader.promise) {
			mermaidLoader.promise = (async () => {
				await loadVendorScript(VENDOR + '/mermaid.min.js');
				const mermaid = window.mermaid;
				if (!mermaid) throw new Error('mermaid-missing');
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					/*
					 * 语法错时不画 mermaid 自带的「Syntax error in text / mermaid version …」红框:
					 * 那个框是 mermaid 直接挂到 body 上的, React 管不到, 会一直挡在页面上关不掉。
					 * 打开这个开关后它先自己清理临时节点再抛错, 由我们渲染下面那块可读的失败卡片。
					 */
					suppressErrorRendering: true,
					theme: 'dark',
					fontFamily: 'inherit',
					themeVariables: {
						darkMode: true,
						background: 'transparent',
						primaryColor: '#0f1e38',
						mainBkg: '#0f1e38',
						primaryTextColor: '#e8f2ff',
						primaryBorderColor: '#3fb6ff',
						nodeBorder: '#3fb6ff',
						nodeTextColor: '#e8f2ff',
						textColor: '#e8f2ff',
						lineColor: '#5be0ff',
						secondaryColor: '#101c33',
						tertiaryColor: '#0a1426',
						edgeLabelBackground: '#0a1426',
						labelBackground: '#0a1426',
						clusterBkg: '#0a1426',
						clusterBorder: '#3fb6ff',
						fontSize: '14px',
					},
					flowchart: { useMaxWidth: true, htmlLabels: true },
				});
				return mermaid;
			})().catch((error) => {
				mermaidLoader.promise = null;
				throw error;
			});
		}
		return mermaidLoader.promise;
	}

	const MATH_SIGNAL = /[\\^_{}=+\-*/<>|()\[\]]/;

	/* $...$ 与真实货币写法(价格 $100, 折扣 $20)的区分: 有空格又没有数学符号、以运算符收尾的, 一律当正文 */
	function looksLikeMath(tex) {
		if (tex === '' || tex.length > 300) return false;
		if (/^[\d\s.,%]+$/.test(tex)) return false;
		if (/\s/.test(tex) && !MATH_SIGNAL.test(tex)) return false;
		if (/[-+*/=<>|]\s*$/.test(tex)) return false;
		return true;
	}

	function MathNode({ tex, display }) {
		const ref = useRef(null);
		const [failed, setFailed] = useState(false);
		useEffect(() => {
			let alive = true;
			ensureKatex()
				.then((katex) => {
					if (!alive || !ref.current) return;
					try {
						katex.render(tex, ref.current, {
							displayMode: Boolean(display),
							throwOnError: false,
							errorColor: '#ff6b81',
							strict: 'ignore',
							trust: false,
						});
					} catch (error) {
						setFailed(true);
					}
				})
				.catch(() => {
					if (alive) setFailed(true);
				});
			return () => {
				alive = false;
			};
		}, [tex, display]);
		if (failed) {
			if (display) return h('pre', { className: 'rk-md-pre rk-math-raw' }, h('code', null, '$$ ' + tex + ' $$'));
			return h('code', { className: 'rk-code-inline rk-math-raw' }, '$' + tex + '$');
		}
		return h(display ? 'div' : 'span', { ref, className: display ? 'rk-math-block' : 'rk-math-inline' });
	}

	/*
	 * mermaid 渲染时会往 body 挂一个临时容器, 正常/异常路径都应该自己收走;
	 * 万一某个版本漏收(或历史遗留), 这里按 id 兜底清掉, 免得错误框永久挡在页面上。
	 */
	function dropStrayMermaid(id) {
		const drop = (node) => {
			if (node && node.parentNode) node.parentNode.removeChild(node);
		};
		drop(document.getElementById(id));
		drop(document.getElementById('d' + id));
		Array.prototype.slice.call(document.body.children).forEach((el) => {
			if (el.tagName !== 'DIV' || !el.id || el.id.charAt(0) !== 'd') return;
			if (id && el.id.indexOf(id) === -1) return;
			if (/Syntax error|mermaid version/i.test(el.textContent || '')) drop(el);
		});
	}

	function MermaidBlock({ code }) {
		const ref = useRef(null);
		const [state, setState] = useState({ status: 'loading', message: '' });
		useEffect(() => {
			let alive = true;
			const id = 'rk-mmd-' + Math.random().toString(36).slice(2);
			setState({ status: 'loading', message: '' });
			dropStrayMermaid(id);
			ensureMermaid()
				.then((mermaid) => mermaid.render(id, code))
				.then((result) => {
					if (!alive) return;
					const svg = (result && result.svg) || '';
					if (svg === '') {
						setState({ status: 'failed', message: 'empty-svg' });
						return;
					}
					if (ref.current) ref.current.innerHTML = svg;
					setState({ status: 'done', message: '' });
				})
				.catch((error) => {
					dropStrayMermaid(id);
					if (!alive) return;
					const raw = String((error && error.message) || error);
					/* mermaid 的语法错消息很长(带行列号与期望符号), 只留第一行 */
					const line = raw.split('\n')[0].slice(0, 200);
					setState({ status: 'failed', message: line });
				});
			return () => {
				alive = false;
				dropStrayMermaid(id);
			};
		}, [code]);
		if (state.status === 'failed') {
			return h(
				'div',
				{ className: 'rk-mermaid rk-mermaid-fail' },
				h('div', { className: 'rk-mermaid-note' }, '流程图渲染失败：' + state.message),
				h('pre', { className: 'rk-md-pre' }, h('code', null, code)),
			);
		}
		return h(
			'div',
			{ className: 'rk-mermaid' },
			h('div', { ref, className: 'rk-mermaid-svg' }),
			state.status === 'loading' ? h('div', { className: 'rk-mermaid-note' }, '正在渲染流程图…') : null,
		);
	}

		return { VENDOR, katexLoader, mermaidLoader, loadVendorScript, loadVendorStyle, ensureKatex, ensureMermaid, MATH_SIGNAL, looksLikeMath, MathNode, dropStrayMermaid, MermaidBlock };
}

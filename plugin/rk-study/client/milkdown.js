/* rk-study · client/milkdown.js —— zt-react-milkdown 编辑器接入口
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块。依赖(react 家族)由入口注入, 本文件不碰
 * window.__ModuleLoader__。
 *
 * 为什么是自己跑 CJS 包而不是 npm 装依赖:
 *   zt-react-milkdown 只把 react 家族当 peerDependency, 其余依赖(refractor / katex / i18next /
 *   @milkdown/* / radix-ui / lucide-react …)都已经打进 dist/index.cjs; 而且整包只 require 五个模块:
 *     react / react-dom / react-dom/client / react/jsx-runtime / react-dom/server
 *   前四个正好都在 DSH 客户端的模块表(seed)里, 由入口 require 出来交给这里; 只有 react-dom/server
 *   不在 —— 它只用于「复制为 HTML」这类边角功能, 用一个空实现顶上即可。
 *   这样做的好处是编辑器跟我们共用同一个 react 实例, 不会出现两份 react 的经典问题。
 *
 * 体积: js 1.6 MB + css 1.6 MB, 所以只在真正要打开编辑界面时才拉取; 拉取或执行失败就返回
 * status: 'failed', 调用方原样回退到 textarea, 不影响编辑流程。
 */

const VENDOR_BASE = '/rk-study/vendor/zt-milkdown';
const STYLE_FLAG = 'data-rk-milkdown';

/* react-dom/server 的替身: 该包只在少数「导出 HTML」的路径上用到, 返回空串足够, 不影响编辑 */
const SERVER_STUB = {
	renderToStaticMarkup: () => '',
	renderToString: () => '',
};

export function createMilkdown({ React, ReactDOM, ReactDOMClient, JsxRuntime, doc, onError }) {
	let bundlePromise = null;
	let styleInjected = false;

	function ensureStyle() {
		if (styleInjected || !doc || !doc.head) return;
		styleInjected = true;
		if (doc.querySelector('link[' + STYLE_FLAG + ']')) return;
		const link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = VENDOR_BASE + '/zt-milkdown.css';
		link.setAttribute(STYLE_FLAG, '1');
		doc.head.appendChild(link);
	}

	function loadBundle() {
		if (bundlePromise) return bundlePromise;
		bundlePromise = (async () => {
			ensureStyle();
			const response = await fetch(VENDOR_BASE + '/zt-milkdown.js');
			if (!response.ok) throw new Error('milkdown-bundle-http-' + response.status);
			const code = await response.text();
			const module = { exports: {} };
			const requireShim = (id) => {
				if (id === 'react') return React;
				if (id === 'react-dom') return ReactDOM;
				if (id === 'react-dom/client') return ReactDOMClient;
				if (id === 'react/jsx-runtime') return JsxRuntime;
				if (id === 'react-dom/server') return SERVER_STUB;
				throw new Error('milkdown-unexpected-require:' + id);
			};
			/* 包是 rollup 的 CJS 产物(首行 Object.defineProperty(exports, Symbol.toStringTag, …),
			 * 末行 exports.MilkdownEditor = …), 直接给它 require / module / exports 三个名字就能跑 */
			const factory = new Function('require', 'module', 'exports', code);
			factory(requireShim, module, module.exports);
			const component = module.exports && module.exports.MilkdownEditor;
			if (typeof component !== 'function') throw new Error('milkdown-export-missing');
			return component;
		})();
		/* 让失败也有「人接」: 组件里 catch 掉, 避免 unhandled rejection 噪音 */
		bundlePromise.catch(() => {});
		return bundlePromise;
	}

	const FAILED = { status: 'failed', Editor: null };

	function useMilkdown() {
		const [state, setState] = React.useState(() => ({ status: 'loading', Editor: null }));
		React.useEffect(() => {
			let alive = true;
			loadBundle().then(
				(Editor) => {
					if (alive) setState({ status: 'ready', Editor });
				},
				(error) => {
					if (!alive) return;
					setState(FAILED);
					if (onError) onError(error);
				},
			);
			return () => {
				alive = false;
			};
		}, []);
		return state;
	}

	return { useMilkdown, loadBundle };
}

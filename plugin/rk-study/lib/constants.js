/* rk-study · host/constants —— 从 host.js 第 23-64 行原样切出 */
import { fileURLToPath } from 'node:url';
import os from 'node:os';

/* @deepseek-ai/schemastery 由 DSH 运行时的模块解析提供(插件目录自身不放 node_modules)。但插件是按
 * **真实路径** file:///Users/…/rk-study/plugin/rk-study/host.js 加载的, 宿主那份 node_modules 不在它的
 * 上层目录里 —— 静态 import 会 ERR_MODULE_NOT_FOUND, 把整个 host 半拖挂(实测: "rk-study-v2 … failed
 * to import", 插件的所有路由全部 404)。所以改成动态 import + 兜底: 解析得到就用真 schema(配置文件能
 * 拿到字段提示), 解析不到就 export undefined —— cordis 的 Config 本来就是可选的, 插件照常工作。 */
let z = null;
try {
	const schemastery = await import('@deepseek-ai/schemastery');
	z = (schemastery && (schemastery.default || schemastery)) || null;
} catch {
	z = null;
}

export const name = 'rk-study';

/* fs / webServer 是核心功能必需; subprocess 只给「Git 提交」用, 但它是 DSH 自带服务所以照实依赖。
 * llm 故意不在这里: 只有「✦ AI 生成 commit message」用得上, 而 lib/git.js 已经自守
 * (ctx.llm 取不到就返回 llm-unavailable) —— 没有 llm 的 profile 也该能正常用笔记面板。 */
export const inject = ['fs', 'webServer', 'subprocess'];

/* cordis.patch.yml 里那一行 config 的 schema。DSH 的配置检查器(mode/字段提示)只认
 * @deepseek-ai/schemastery 的原生 schema, 所以这里必须用它, 不能手写 Standard Schema。
 * 默认值故意留空/与 lib/util.js 的 normalizeConfig 兜底一致: schema 会保留未知键,
 * 所以老 config 里的自定义键不会被这里清掉。 */
export const Config = z
	? z.object({
			root: z.string().default('').description('学习画布(笔记)根目录的绝对路径; 留空 = 用 DSH 当前工作目录'),
			exclude: z.array(z.string()).default(['plugin', 'node_modules', '.git', '.dsh', 'dist', 'build', '.obsidian']).description('扫描时跳过的目录/文件名'),
			maxDepth: z.natural().default(8).description('扫描递归深度上限'),
			noteDir: z.string().default('notes').description('笔记(知识点说明)相对目录'),
			questionDir: z.string().default('questions').description('题目相对目录'),
			gitProvider: z.string().default('').description('AI 写 commit message 用的 provider; 留空 = 自动挑第一个'),
			gitModel: z.string().default('').description('AI 写 commit message 用的 model; 留空 = 自动挑第一个'),
			templateDir: z.string().default('').description('编辑器模板库目录; 留空 = 画布根目录下的 .templates'),
		})
	: undefined;

export const ROUTE = '/rk-study/notes';
/* 一级画布: 学习笔记根目录的查询 / 创建 */
export const ROOTS_ROUTE = '/rk-study/roots';
/* 学习库(画布存放目录)自己的配置: <库>/.config/rk-study.json —— 只有这一级写盘 */
export const CONFIG_ROUTE = '/rk-study/config';
export const CONFIG_DIR = '.config';
export const CONFIG_FILE = 'rk-study.json';
/* 号池单独一个文件: <库>/.config/rk-study-uids.json —— 只放 uids(绝对路径 -> uid), 与界面配置分家 */
export const UIDS_FILE = 'rk-study-uids.json';
/* 插件自己的状态(画布列表 / 学习库 / 上次停在哪张 / 移出列表)。与「学习库那一级的 .config」不同, 这份不
 * 属于任何画布目录, 而是插件自己的持久化 —— 落在 DSH 自己的数据目录里(与 .plugin-backups / cache 同级)。
 * 存在的理由: 浏览器 localStorage 一换浏览器、清了缓存、或者宿主换了访问端口就整份读不到, 表现就是
 * 「每次重启系统都得手动导入一遍目录」; 客户端启动时拿这份补齐 localStorage 里缺的键。 */
export const STATE_ROUTE = '/rk-study/state';
export const STATE_DIR = `${(String(process.env.DSH_HOME || '').trim() || `${os.homedir()}/.dsh`).replace(/\/+$/, '')}/rk-study`;
export const STATE_FILE = `${STATE_DIR}/state.json`;

/* 渲染引擎(katex / mermaid)以静态资源形式随插件分发, 由 host 直接吐文件 —— 客户端按需 <script> 拉取, 离线可用 */
export const ASSET_ROUTE = '/rk-study/vendor';

export const DEFAULT_EXCLUDE = ['plugin', 'node_modules', '.git', '.dsh', 'dist', 'build', '.obsidian'];
/* 笔记(知识点说明)放在 noteDir 下, 知识点的题目按镜像路径放在 questionDir 下 */
export const DEFAULT_NOTE_DIR = 'notes';
export const DEFAULT_QUESTION_DIR = 'questions';
export const VENDOR_DIR = fileURLToPath(new URL('../vendor/', import.meta.url)).replace(/\/$/, '');
/* 客户端模块(client.js 之外的 chunk)同样由插件直接吐文件 —— loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录, 所以改用原生 import() + 这条只读静态路由, 只放行 .js 且不允许越级路径 */
export const CLIENT_ROUTE = '/rk-study/client';
export const CLIENT_DIR = fileURLToPath(new URL('../client/', import.meta.url)).replace(/\/$/, '');
export const CLIENT_TYPES = {
	'.js': 'text/javascript; charset=utf-8',
};
/* 编辑器工具栏的模板库(藏在**画布根目录**的 .templates/ 里, 扫描器不会把它画到画布上;
 * 学习库里如果有一份 <库>/.templates/, 库里的画布共用那一份) */
export const TEMPLATE_ROUTE = '/rk-study/templates';
/* 面板里的「Git 提交」: 读工作区改动 / 暂存提交 / 推送 */
export const GIT_ROUTE = '/rk-study/git';
export const ASSET_TYPES = {
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.woff2': 'font/woff2',
	'.svg': 'image/svg+xml',
};
export const MAX_FILES = 1500;
export const MAX_DEPTH = 8;
export const MAX_BYTES_PER_FILE = 1024 * 1024;
export const MAX_POINT_CHARS = 8000;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const CACHE_TTL_MS = 1000;

export const MARKDOWN_RE = /\.(?:md|markdown)$/i;
export const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
export const FENCE_RE = /^\s*(?:```|~~~)/;
export const ANSWER_TITLE_RE = /^(?:参考|正确)?\s*(?:答案|解析|正确答案|答案解析|参考答案|answer|analysis|solution)\s*[:：]?\s*$/i;
export const ANSWER_LINE_RE = /^\s{0,3}(?:>\s*)?(?:[-*+]\s*)?(?:\*\*|__)?\s*(?:参考|正确)?\s*(?:答案|解析|正确答案|答案解析|参考答案|answer|analysis|solution)\s*(?:\*\*|__)?\s*[:：]/i;
export const EXAMPLE_TITLE_RE = /^(?:例题|案例|案例分析|练习|真题|试题|习题|题目|问答题|简答题|选择题|论文题|错题|刷题|已做|做过)/;
export const OPTION_RE = /^\s*(?:[-*+]\s*)?(?:\*\*|__)?\s*([A-Ha-h])\s*(?:\*\*|__)?\s*[.、)）:：]\s*(\S.*)$/;
export const QUESTION_PATH_RE = /(题目|真题|试题|习题|考题|历年|刷题|错题|exam|quiz|question|q&a)/i;
export const NUMERIC_PREFIX_RE = /^(\d+)\s*[-_.、)]?\s*(.*)$/;
/* 文件名里表示「这是题目」的段落: 01-例题-xxx / 01-真题-xxx / 01-案例分析-xxx */
export const QUESTION_SEGMENT_RE = /^(?:例题|题目|试题|习题|练习|真题|案例|案例分析|案例题|选择题|问答题|简答题|分析题|论文题|错题|刷题|已做|做过|quiz|exam|question)$/i;
export const TYPE_QUESTION_RE = /^(?:question|题目|题|quiz|exam)/i;
export const TYPE_POINT_RE = /^(?:point|knowledge|kp|知识点|考点)/i;
export const TYPE_SECTION_RE = /^(?:section|小节|导读|章节导读)/i;

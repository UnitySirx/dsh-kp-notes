/* rk-study · host/templates —— 从 host.js 第 1368-1537 行原样切出 */
import { insideRoot } from './fsguard.js?v=92';
import { questionBlockNodes } from './questions.js?v=92';
import { numericPrefix, stripNumericPrefix } from './util.js?v=92';

export function noteTemplate(title, order) {
	return [
		'---',
		`title: ${title}`,
		'type: section',
		'tags: []',
		`order: ${order}`,
		'---',
		'',
		`# ${title}`,
		'',
		'这一节要解决的问题、考点位置、复习顺序。',
		'',
	].join('\n');
}

export function pointTemplate(title, order) {
	return [
		'---',
		`title: ${title}`,
		'type: point',
		'tags: []',
		`order: ${order}`,
		'---',
		'',
		`# ${title}`,
		'',
		'一句话结论 + 关键要点（原理、公式、易错点、对比表）。',
		'',
		'> 这个知识点的题目放在题目目录（questions/）的同名文件里，在插件里点「添加题目」即可。',
		'',
	].join('\n');
}

/** 一道题的标准骨架, 追加到题目文件末尾 */
export function questionBlock(order) {
	return [
		`## 题目 ${order}`,
		'',
		'题干……',
		'',
		'A. 选项一',
		'B. 选项二',
		'C. 选项三',
		'D. 选项四',
		'',
		'**答案**：A',
		'**解析**：说明为什么选 A，以及其余选项错在哪里。',
		'',
	].join('\n');
}

/** 表单字段 -> 一个题目块的 markdown(格式约定只在这里生成, 前端不拼 markdown) */
export function questionBlockFromFields(fields, order) {
	const source = fields || {};
	const kind = source.kind === 'case' ? 'case' : 'choice';
	const stem = String(source.stem ?? '').trim();
	const out = [`## 题目 ${order}`, '', stem === '' ? '题干……' : stem, ''];
	if (kind === 'choice') {
		const options = Array.isArray(source.options) ? source.options : [];
		let count = 0;
		for (const option of options) {
			const key = String((option && option.key) || '').trim().toUpperCase();
			const text = String((option && option.text) || '').trim();
			if (key === '' || text === '') continue;
			out.push(`${key}. ${text}`);
			count += 1;
		}
		if (count > 0) out.push('');
		out.push(`**答案**：${String(source.answerKey ?? '').trim().toUpperCase() || 'A'}`);
		out.push('');
		const explanation = String(source.explanation ?? '').trim();
		out.push(`**解析**：${explanation === '' ? '……' : explanation}`);
	} else {
		const answer = String(source.answerText ?? '').trim();
		out.push('**答案**：');
		out.push('');
		if (answer !== '') out.push(answer);
	}
	out.push('');
	return out.join('\n');
}

/** 知识点题目文件的骨架: questions/<章>/<知识点文件名>.md */
export function questionFileTemplate(pointTitle, order, pointPath) {
	return [
		'---',
		`title: ${pointTitle} · 题目`,
		'type: question',
		'tags: []',
		`order: ${order ?? 1}`,
		`point: ${pointPath}`,
		'---',
		'',
		`# ${pointTitle} · 题目`,
		'',
		'本文件是该知识点的题目：每道题一个 `## 题目 N` 标题。答案写在 `**答案**：` 一行里，插件会自动遮挡。',
		'',
	].join('\n');
}

export function questionTemplate(title, order) {
	return [
		'---',
		`title: ${title}`,
		'type: question',
		'tags: []',
		`order: ${order}`,
		'---',
		'',
		`# ${title}`,
		'',
		questionBlock(1),
	].join('\n');
}

/** 数出题目文件里已有的题目数 —— 与 questionBlockNodes 同口径 */
export function countQuestionItems(markdown) {
	return { total: questionBlockNodes(markdown).blocks.length };
}

export function filePad(value) {
	return String(Number(value) || 0).padStart(2, '0');
}

/** 同目录内避免重名: `01-例题-真题.md` → `01-例题-真题-2.md` */
export function uniqueFileName(entries, file) {
	const taken = new Set(entries.map((entry) => String(entry.name ?? '')));
	if (!taken.has(file)) return file;
	const dot = file.lastIndexOf('.');
	const stem = dot > 0 ? file.slice(0, dot) : file;
	const ext = dot > 0 ? file.slice(dot) : '';
	for (let n = 2; n < 100; n += 1) {
		const candidate = `${stem}-${n}${ext}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${stem}-${Date.now()}${ext}`;
}

/** 第 SS 个小节下的下一个知识点序号 (01-SS-知识点) */
export function pointNumberFor(entries, sectionOrder) {
	const prefix = `${filePad(sectionOrder)}-`;
	let next = 1;
	for (const entry of entries) {
		const name = String(entry.name ?? '');
		if (!name.startsWith(prefix)) continue;
		const second = numericPrefix(stripNumericPrefix(name));
		if (second !== null && second >= next) next = second + 1;
	}
	return next;
}

export function sanitizeName(value, fallback) {
	const text = String(value ?? '')
		.replace(/[/\\:*?"<>|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text === '' ? fallback : text.slice(0, 60);
}

export async function listDirSafe(ctx, config, relDir, signal) {
	const abs = relDir === '' ? config.root : `${config.root}/${relDir}`;
	try {
		const target = await ctx.fs.resolve(abs, { signal });
		/* relDir 来自请求参数, 可能带 `..`: 规范化后不在 root 内就不给列 */
		if (!(await insideRoot(ctx, config, abs, signal))) return [];
		const entries = await ctx.fs.listDir(target, signal);
		return entries;
	} catch {
		return [];
	}
}

/* rk-study · 编辑器模板库的默认内容 —— 两个文件各管一个菜单, 首次读取时用它。
 * 用数组 join 而不是模板字符串: 内容里全是反引号和 $ , 免得转义到看不清。 */
export const FORMULA_LIBRARY = [
	'# 公式模板',
	'',
	'> 这份文件是「学习画布」编辑器工具栏「公式 ▾」菜单的数据源。',
	'> `##` 是分组，`###` 是模板名；模板名下面**紧跟的第一个代码块**里的内容，就是点一下要插进正文的文本。',
	'> 一条只放一个公式或一个符号 —— 点哪条就只插哪条，不会一次插一串。',
	'> 代码块用三个反引号就行；如果模板内容本身要带代码块，外面用四个反引号包起来。',
	'> 照着下面的样子加一条、保存，回到编辑器点「重新读取」就能看到。',
	'',
	'## 公式',
	'',
	'### 行内公式 \\frac',
	'```text',
	'$A = \\frac{MTBF}{MTBF + MTTR}$',
	'```',
	'',
	'### 块级公式 $$',
	'```text',
	'$$',
	'A = \\frac{MTBF}{MTBF + MTTR} = \\frac{9000}{9000 + 10} \\approx 99.89\\%',
	'$$',
	'```',
	'',
	'### 分式 \\frac',
	'```text',
	'$\\frac{a}{b}$',
	'```',
	'',
	'### 求和 \\sum',
	'```text',
	'$\\sum_{i=1}^{n} a_i$',
	'```',
	'',
	'### 积分 \\int',
	'```text',
	'$\\int_{0}^{T} \\lambda(t)\\,\\mathrm{d}t$',
	'```',
	'',
	'### 极限 \\lim',
	'```text',
	'$\\lim_{n \\to \\infty} \\frac{1}{n}$',
	'```',
	'',
	'### 根号 \\sqrt',
	'```text',
	'$\\sqrt{x}$',
	'```',
	'',
	'### 上标 b^2',
	'```text',
	'$b^{2}$',
	'```',
	'',
	'### 下标 a_1',
	'```text',
	'$a_{1}$',
	'```',
	'',
	'### 方程组 cases',
	'```text',
	'$$',
	'\\begin{cases}',
	'x + y = 1 \\\\',
	'x - y = 3',
	'\\end{cases}',
	'$$',
	'```',
	'',
	'### 矩阵 bmatrix',
	'```text',
	'$$',
	'A = \\begin{bmatrix}',
	'a_{11} & a_{12} \\\\',
	'a_{21} & a_{22}',
	'\\end{bmatrix}',
	'$$',
	'```',
	'',
	"",
	'## 希腊字母',
	'',
	'### α \\alpha',
	'```text',
	'$\\alpha$',
	'```',
	'',
	'### β \\beta',
	'```text',
	'$\\beta$',
	'```',
	'',
	'### γ \\gamma',
	'```text',
	'$\\gamma$',
	'```',
	'',
	'### δ \\delta',
	'```text',
	'$\\delta$',
	'```',
	'',
	'### ε \\epsilon',
	'```text',
	'$\\epsilon$',
	'```',
	'',
	'### θ \\theta',
	'```text',
	'$\\theta$',
	'```',
	'',
	'### λ \\lambda',
	'```text',
	'$\\lambda$',
	'```',
	'',
	'### μ \\mu',
	'```text',
	'$\\mu$',
	'```',
	'',
	'### π \\pi',
	'```text',
	'$\\pi$',
	'```',
	'',
	'### ρ \\rho',
	'```text',
	'$\\rho$',
	'```',
	'',
	'### σ \\sigma',
	'```text',
	'$\\sigma$',
	'```',
	'',
	'### τ \\tau',
	'```text',
	'$\\tau$',
	'```',
	'',
	'### φ \\phi',
	'```text',
	'$\\phi$',
	'```',
	'',
	'### ω \\omega',
	'```text',
	'$\\omega$',
	'```',
	'',
	'### Δ \\Delta',
	'```text',
	'$\\Delta$',
	'```',
	'',
	'### Σ \\Sigma',
	'```text',
	'$\\Sigma$',
	'```',
	'',
	'### Ω \\Omega',
	'```text',
	'$\\Omega$',
	'```',
	'',
	'## 关系与运算符',
	'',
	'### ≤ \\le',
	'```text',
	'$\\le$',
	'```',
	'',
	'### ≥ \\ge',
	'```text',
	'$\\ge$',
	'```',
	'',
	'### ≠ \\ne',
	'```text',
	'$\\ne$',
	'```',
	'',
	'### ≈ \\approx',
	'```text',
	'$\\approx$',
	'```',
	'',
	'### ≡ \\equiv',
	'```text',
	'$\\equiv$',
	'```',
	'',
	'### ± \\pm',
	'```text',
	'$\\pm$',
	'```',
	'',
	'### × \\times',
	'```text',
	'$\\times$',
	'```',
	'',
	'### ÷ \\div',
	'```text',
	'$\\div$',
	'```',
	'',
	'## 箭头与集合',
	'',
	'### → \\to',
	'```text',
	'$\\to$',
	'```',
	'',
	'### ⇒ \\Rightarrow',
	'```text',
	'$\\Rightarrow$',
	'```',
	'',
	'### ⇔ \\Leftrightarrow',
	'```text',
	'$\\Leftrightarrow$',
	'```',
	'',
	'### ∈ \\in',
	'```text',
	'$\\in$',
	'```',
	'',
	'### ⊂ \\subset',
	'```text',
	'$\\subset$',
	'```',
	'',
	'### ∪ \\cup',
	'```text',
	'$\\cup$',
	'```',
	'',
	'### ∩ \\cap',
	'```text',
	'$\\cap$',
	'```',
	'',
	'### ∅ \\varnothing',
	'```text',
	'$\\varnothing$',
	'```',
].join('\n');

/* 「Markdown模板」菜单(结构 / 笔记 / 题目)的默认内容 —— 与公式库分开一个文件, 各改各的。 */
export const MARKDOWN_LIBRARY = [
	'# Markdown模板',
	'',
	'> 这份文件是「学习画布」编辑器工具栏「模板 ▾」菜单的数据源。',
	'> `##` 是分组，`###` 是模板名；模板名下面**紧跟的第一个代码块**里的内容，就是点一下要插进正文的文本。',
	'> 代码块用三个反引号就行；如果模板内容本身要带代码块（比如流程图），外面用四个反引号包起来。',
	'> 照着下面的样子加一条、保存，回到编辑器点「重新读取」就能看到。',
	'',
	'## 结构',
	'',
	'### 表格',
	'```text',
	'| 列一 | 列二 | 列三 |',
	'| --- | --- | --- |',
	'| 内容 | 内容 | 内容 |',
	'```',
	'',
	'### 流程图',
	'````text',
	'```mermaid',
	'flowchart TD',
	'  A[需求] --> B[架构评估]',
	'  B --> C[详细设计]',
	'  C --> D[实现与测试]',
	'```',
	'````',
	'',
	'### 无序清单',
	'```text',
	'- 要点一',
	'- 要点二',
	'```',
	'',
	'### 引用块',
	'```text',
	'> 一句话结论',
	'>',
	'> 展开说明。',
	'```',
	'',
	'## 笔记',
	'',
	'### 知识点骨架',
	'```text',
	'## 知识点 1：标题',
	'',
	'一句话定义。',
	'',
	'**要点**',
	'',
	'- 要点一',
	'- 要点二',
	'',
	'### 例题 1',
	'',
	'题干……',
	'',
	'**答案**：……',
	'**解析**：……',
	'```',
	'',
	'### 小节骨架',
	'```text',
	'---',
	'title: 小节标题',
	'type: section',
	'tags: []',
	'order: 1',
	'---',
	'',
	'# 小节标题',
	'',
	'这一节要解决的问题。',
	'```',
	'',
	'## 题目',
	'',
	'### 选择题骨架',
	'```text',
	'## 题目 1',
	'',
	'题干……',
	'',
	'A. 选项一',
	'B. 选项二',
	'C. 选项三',
	'D. 选项四',
	'',
	'**答案**：A',
	'**解析**：……',
	'```',
	'',
	'### 案例题骨架',
	'```text',
	'## 题目 1',
	'',
	'案例背景……',
	'',
	'**答案**：',
	'……',
	'',
	'**解析**：',
	'……',
	'```',
	'',
].join('\n');

/* 模板库文件表: 一个文件对应工具栏上的一个下拉菜单, key 决定它进哪个菜单。
 * 放在笔记目录下的隐藏文件夹: 扫描器跳过 "." 开头的目录, 所以它不会变成画布上的一张卡,
 * 但它跟着 notes/ 一起被提交, 用户也能在编辑器里直接改。 */
export const TEMPLATE_FILES = [
	{ key: 'formula', label: '公式模板', file: '公式模板.md', markdown: FORMULA_LIBRARY },
	{ key: 'markdown', label: 'Markdown模板', file: 'Markdown模板.md', markdown: MARKDOWN_LIBRARY },
];


# dsh-kp-notes · 知识点笔记（学习画布）

> 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发的知识点(Knowledge Point)笔记插件 —— 把一整个目录的 Markdown 笔记变成一张可平移、缩放的卡片画布：**一个目录 = 一章，一章 = 一张卡**，知识点是卡片，题目自带答案遮挡，随手自测。

左侧边栏「全局面板」里叫 **知识点笔记**（英文界面 `Architect Notes`）。完整文档、开发说明与全部截图见仓库：<https://github.com/UnitySirx/dsh-kp-notes>

![多画布](https://raw.githubusercontent.com/UnitySirx/dsh-kp-notes/main/plugin/dsh-kp-notes/screenshots/01-canvases.jpg)
![知识点详情：表格 + KaTeX 公式](https://raw.githubusercontent.com/UnitySirx/dsh-kp-notes/main/plugin/dsh-kp-notes/screenshots/03-point-detail.jpg)
![题目答案遮挡](https://raw.githubusercontent.com/UnitySirx/dsh-kp-notes/main/plugin/dsh-kp-notes/screenshots/04-questions.jpg)
![思维导图](https://raw.githubusercontent.com/UnitySirx/dsh-kp-notes/main/plugin/dsh-kp-notes/screenshots/06-mindmap.jpg)

## 安装

```bash
# 从 npm 装
dsh plugin --profile <profile 名> add dsh-kp-notes

# 或者直接装本仓库（源码即成品，没有构建步骤）
dsh plugin --profile <profile 名> add link:/绝对路径/rk-study/plugin/dsh-kp-notes
```

装完刷新页面，在左侧「全局面板 → 知识点笔记」打开；第一次用点「⇪ 导入目录」把已有笔记库加进来，或者「＋ 新建学习画布」。

## 它能做什么

- **目录即章节**：`notes/<章>/<小节>.md` 是小节，文件里的知识点变成卡片，点卡片开右侧详情。
- **正文全量渲染**：Markdown 表格、`$$KaTeX$$` 公式、```` ```mermaid ```` 流程图、代码块，不用装任何东西。
- **题目与自测**：`questions/<章>/<同名>.md` 里写题目，选择题自动排 4 个选项，答案默认遮挡，点开才看解析（也可以「显示全部答案」）。
- **画布内编辑**：新建/编辑/删除知识点与题目，所见即所得，落盘还是普通 Markdown（带 frontmatter），随时能被其它工具接手。
- **思维导图**：一键把「画布 → 章 → 小节 → 知识点」画成可折叠的导图。
- **多画布 + Git 提交**：一个插件面板管多个笔记库；「⎇ Git 提交」让宿主模型读改动清单生成 commit 信息。
- **深色 / 浅色 / 跟随系统**三档配色，中英双语界面。

## 笔记目录约定

```
<学习库>/
├── notes/<章>/<小节>.md          # 小节：type: section
├── notes/<章>/<小节>/<知识点>.md  # 知识点：type: point
└── questions/<章>/<同名>.md       # 题目：type: question（用 point: 指回知识点）
```

不按这个结构也能用：只要是 Markdown，插件会按目录/标题自己整理出一张画布。

## 许可

MIT © UnitySir · 有问题开 [Issue](https://github.com/UnitySirx/dsh-kp-notes/issues) 或 QQ `451991189`

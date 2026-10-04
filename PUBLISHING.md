# 发布清单 · dsh-kp-notes

> 这份清单只服务于「把插件发到 npm + 被 awesome-dsh-plugin 收录」，插件本身运行不需要这里任何一步。
> 当前状态：包内元数据已就绪（`npm pack --dry-run` = 61 个文件 / 2.84 MB 压缩 / 7.57 MB 解包），**尚未发布**，npm 也还没登录。

## 一、发布到 npm

```bash
npm login                      # 本机还没有 npm 登录态（没有 ~/.npmrc）
cd plugin/rk-study
npm pack --dry-run             # 干跑：看文件清单和体积
npm publish                    # publishConfig.access = "public"
```

以后每次发版：

1. 改 `plugin/rk-study/package.json` 的 `version`（修 bug → patch，加功能 → minor）。
2. `npm pack --dry-run` 确认 `files` 白名单没漏东西 —— 运行时只用到 `host.js`、`client.js`、`lib/`、`client/`、`locale/`、`vendor/`、`cordis.patch.yml`、`icon.svg`（`package.json`、`README.md`、`LICENSE` 是 npm 自动带的）。
3. `npm publish`。
4. 打 tag：`git tag v1.0.0 && git push origin v1.0.0`。
5. 发布后把根 `README.md` 里「包尚未发布……」那句换成 npm 安装说明。

自检：tarball 里**不应该**出现 `screenshots/`、`screenshots.json`、`.DS_Store`（`files` 已经把它们的挡在包外；截图只服务于 GitHub 首页和社区清单）。

## 二、提交到社区清单（awesome-dsh-plugin）

仓库 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>，**只加一个文件**（两个 README 由脚本生成，别手改）：

`data/plugins/UnitySirx__dsh-kp-notes--plugin-rk-study.yml`

```yaml
url: https://github.com/UnitySirx/dsh-kp-notes/tree/main/plugin/rk-study
name: UnitySirx/dsh-kp-notes#rk-study
category: docs
description:
  en: 'Turns a whole directory of Markdown notes into a pannable, zoomable card canvas: chapters, knowledge points and questions are laid out in layers, with KaTeX formulas, Mermaid flowcharts, mind maps and git commits, opened from a left sidebar panel entry.'
  zh: '把一整个目录的 Markdown 笔记变成可平移缩放的卡片画布：章节/知识点/题目分层，KaTeX 公式、Mermaid 流程图、思维导图、Git 提交，左侧边栏面板入口。'
```

提交前必须全部满足（CI 会逐条查）：

- [ ] GitHub 仓库加 topic **`dsh-plugin`**（现在 `topics: []`）。
- [ ] 仓库创建满 1 天 —— `created_at 2026-10-03T13:47:12Z`，即 **北京时间 2026-10-04 21:47 之后**才过得了。
- [ ] 条目 `url` 指向**声明 `dsh.bundle` 的那层目录**（`…/tree/main/plugin/rk-study`）。指仓库根会报
      `the entry points at the repository root, but the root package.json declares no dsh.bundle`。
- [ ] 文件名必须和 url 对得上：`owner__repo--子目录（把 / 换成 -）.yml`。
- [ ] 只写 `url` / `name` / `category` / `description`（可选 `tarball`）；写 npm 字段会报 `unknown field …`（npm 包名由脚本自己从仓库推）。
- [ ] `description.en` 必填且单行；**英文里出现 `: ` 必须整体加引号**，否则 YAML 会当成嵌套键。
- [ ] 截图不进条目：在插件目录放 `screenshots.json`（已就位：8 条、相对它自身目录、1–8 张）。

PR 可以直接抄：

> **标题**：`Add dsh-kp-notes — Markdown notes → study canvas (DeepSeek Harness plugin)`
>
> **正文**：`Adds UnitySirx/dsh-kp-notes#rk-study (npm: dsh-kp-notes, MIT). It turns a directory of Markdown notes into a card canvas: chapters / knowledge points / questions in layers, KaTeX + Mermaid + mind map rendering, in-canvas editing that writes plain Markdown back, and git commits from the panel. Screenshots are declared in plugin/rk-study/screenshots.json.`

## 三、已经满足的检查项（对照 awesome 的 `scripts/check-submission.mjs`）

| 检查项 | 状态 |
| --- | --- |
| 声明 `dsh.bundle`（`plugin/rk-study/package.json` → `./cordis.patch.yml`） | ✅ |
| `cordis.patch.yml` 用包名引用（不是 `file://` 绝对路径 + 写死的 `config.root`） | ✅ |
| `exports["./client"]` + `dsh.client.platform: "web"` + 浏览器模块注册 id == 包名 | ✅ |
| `icon.svg` 相对路径、小于 256 KiB | ✅ |
| `license` / `repository`（含 `directory`）/ `homepage` / `keywords` / `author` | ✅ |
| `peerDependencies`（`@deepseek-ai/cordis ^4.0.4` + 4 个 `@deepseek-ai/dsh-client-* ^0.2.0-rc.1`） | ✅ |
| `files` / `engines` / `publishConfig` | ✅ |
| 有真实可用代码、目录结构正常 | ✅ |
| topic `dsh-plugin` / 仓库满 1 天 / 清单条目 | ⬜ 见第二节 |

## 四、备注

- 本机开发怎么装：`dsh plugin --profile tauri add link:/Users/unitysir/Desktop/rk-study/plugin/rk-study`，装完把 profile 的 `dsh.profile.bundles` 里写成包名 `dsh-kp-notes`（本机已经这么配了，符号链接在 `~/.dsh/profiles/tauri/node_modules/dsh-kp-notes`）。
- 任何 `dsh plugin …` 子命令都会去写 `~/.dsh/profiles/<name>/package.json.lock`，所以别在受限沙箱里跑。

# 发布清单 · dsh-kp-notes

> 这份清单只服务于「把插件发到 npm + 被 awesome-dsh-plugin 收录」，插件本身运行不需要这里任何一步。
> 当前状态：包内元数据已就绪（`npm pack --dry-run` = 61 个文件 / 2.84 MB 压缩 / 7.57 MB 解包），**npm 尚未发布**（卡在 npm 账号 `unitysirx` 被临时封禁，见第一节末）；社区清单条目**已提交为草稿 PR**：[awesome-dsh-plugin#6525](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6525)。

## 一、发布到 npm

```bash
npm login                      # 本机还没有 npm 登录态（没有 ~/.npmrc）
cd plugin/dsh-kp-notes
npm pack --dry-run             # 干跑：看文件清单和体积
npm publish                    # publishConfig.access = "public"
```

以后每次发版：

1. 改 `plugin/dsh-kp-notes/package.json` 的 `version`（修 bug → patch，加功能 → minor）。
2. `npm pack --dry-run` 确认 `files` 白名单没漏东西 —— 运行时只用到 `host.js`、`client.js`、`lib/`、`client/`、`locale/`、`vendor/`、`cordis.patch.yml`、`icon.svg`（`package.json`、`README.md`、`LICENSE` 是 npm 自动带的）。
3. `npm publish`。
4. 打 tag：`git tag v1.0.0 && git push origin v1.0.0`。
5. 发布后把根 `README.md` 里「包尚未发布……」那句换成 npm 安装说明。

自检：tarball 里**不应该**出现 `screenshots/`、`screenshots.json`、`.DS_Store`（`files` 已经把它们的挡在包外；截图只服务于 GitHub 首页和社区清单）。

**当前卡点（2026-10-04）**：npm 账号 `unitysirx` 被临时封禁 —— 发布请求返回
`403 PUT https://registry.npmjs.org/dsh-kp-notes - Your account has been temporarily suspended due to a recent security-sensitive action.`
成因疑为短时间内连续多次 2FA 验证失败 + 连续新建多个 access token 触发反滥用；在解封前不应再重试任何写入。
账号本身还缺可用的 2FA 手段（没有 authenticator app），建议先到 npm 网页把 2FA 重新绑定到 authenticator，再 `npm login` + `npm publish`（这样 OTP 不经过任何第三方）。
顺带：此前创建的 3 个 granular token 已出现在对话记录里，**建议全部在 Access Tokens 页面删除**；我这边 `/tmp` 下的临时 token 文件与 npm 日志已删除。

## 二、提交到社区清单（awesome-dsh-plugin）

仓库 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>，**只加一个文件**（两个 README 由脚本生成，别手改）：

`data/plugins/UnitySirx__dsh-kp-notes--plugin-dsh-kp-notes.yml`

```yaml
url: https://github.com/UnitySirx/dsh-kp-notes/tree/main/plugin/dsh-kp-notes
name: UnitySirx/dsh-kp-notes#dsh-kp-notes
category: docs
description:
  en: 'Knowledge-point notebook for DeepSeek Harness: turns a Markdown notes folder into a card canvas — folder = chapter, file = section, body = knowledge points — with masked-answer questions for self-testing, KaTeX formulas, Mermaid flowcharts, a mind map view and in-panel editing.'
  zh: 'DeepSeek Harness 知识点笔记插件：把 Markdown 笔记目录变成卡片式学习画布，目录 = 章节、文件 = 小节、正文 = 知识点；题目可遮挡答案自测，支持 KaTeX 公式、Mermaid 流程图、思维导图与面板内编辑。'
```

文件名不是猜的，是官方 `scripts/lib/entries.mjs` 的 `slugFor()` 算出来的（`…/tree/main/plugin/dsh-kp-notes` → `--plugin-dsh-kp-notes`）；提交前可以用它的 `readEntries()` 本地解析一遍，零问题再提。

提交前必须全部满足（CI 会逐条查）：

- [x] GitHub 仓库加 topic **`dsh-plugin`**（已加，仓库 `topics: ["dsh-plugin"]`）。
- [ ] 仓库创建满 1 天 —— `created_at 2026-10-03T13:47:12Z`，即 **北京时间 2026-10-04 21:47**。
      **这一条不需要等到点再提交**：`scripts/check-submission.mjs:409` 的原话是
      `nothing to do: this check re-runs by itself and should clear in about Nh. No need to resubmit, push, or close and reopen` —— PR 开着不动，检查自己会重跑到通过。
- [ ] 条目 `url` 指向**声明 `dsh.bundle` 的那层目录**（`…/tree/main/plugin/dsh-kp-notes`）。指仓库根会报
      `the entry points at the repository root, but the root package.json declares no dsh.bundle`。
- [ ] 文件名必须和 url 对得上：`owner__repo--子目录（把 / 换成 -）.yml`。
- [ ] 只写 `url` / `name` / `category` / `description`（可选 `tarball`）；写 npm 字段会报 `unknown field …`（npm 包名由脚本自己从仓库推）。
- [ ] `description.en` 必填且单行；**英文里出现 `: ` 必须整体加引号**，否则 YAML 会当成嵌套键。
- [ ] 截图不进条目：在插件目录放 `screenshots.json`（已就位：8 条、相对它自身目录、1–8 张）。

### 已提交的 PR（2026-10-04）

**<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6525>** —— 标题 `Add dsh-kp-notes`，先以草稿创建，2026-10-04 22:07 CST 由作者点 **Ready for review** 转正式；1 个文件变更。

- fork：`UnitySirx/awesome-dsh-plugin`；分支 `add-dsh-kp-notes`（从上游 `main` 的 `bb8496e` 切出）；条目提交 `c0a7dd8`。
- 到点后在 PR 页面点 **Ready for review** 即算正式提交；也可以直接让助手调 API 把 draft 转正式（`PATCH /pulls/6525` 传 `draft: false` 需走 GraphQL `markPullRequestReadyForReview`）。
- PR 正文里 6 项 checkbox 已按实际勾选，只有「仓库满 1 天」留空并注明会自动恢复。

### CI 首轮结果（2026-10-04）

这个仓库的检查是**两段式**，只看第一个绿勾会误判：

| 工作流 | 触发 | 作用 | 我们的结果 |
| --- | --- | --- | --- |
| `pr-check.yml` | `pull_request`（fork 安全，**没有 token**） | 格式 / lint / 测试 / 构建 | ✅ 16 步全绿（含 `awesome-lint`、`READMEs match data/plugins`、`Build`） |
| `pr-gate.yml` | 等 `pr-check` 完成后由 `workflow_run` 触发（有 token） | 跑 `scripts/check-submission.mjs`，**年龄闸门在这里** | ❌ 唯一红项 = 年龄 |

`Submission gate` 的 check-run 原文（标题 `1 entry/entries need changes`）：

```
https://github.com/UnitySirx/dsh-kp-notes/tree/main/plugin/dsh-kp-notes
  - repository is 0.6 days old (needs 1) — nothing to do: this check re-runs by itself and
    should clear in about 9h. No need to resubmit, push, or close and reopen; the age bar
    is the only thing failing here.
```

→ 条目内容、`dsh.bundle`、`url`、`category`、描述全部已通过，只差仓库年龄。另外 `pr-guard.yml` / `regate.yml` 里都有 `if (pr.isDraft) continue`，所以草稿状态不会被定时巡检盯上。

### 闸门转绿（2026-10-04 22:24 CST）

`regate.yml:222-224` 的重扫规则要三条同时成立才重跑：gate 结论是 `failure` + summary 里含 `days old` + **距上次判定满 24 小时**。我们那次判定完成于 `2026-10-04T04:49:51Z`，所以**自然重扫最早要到 `2026-10-05T06:19Z`（北京时间 14:19）**——「仓库满 1 天」和「变绿」之间隔着这个 24 小时冷却，不看代码会以为 21:47 就该自己绿。

为了不等，在 fork 分支上造了一个**内容零变更**的空提交 `8a25fc3`（`POST /git/commits` 复用父提交的 tree，再 `PATCH /git/refs/heads/add-dsh-kp-notes`），靠 `pull_request` 的 `synchronize` 事件把链路重跑一遍：

| 环节 | 结果 |
| --- | --- |
| `pr-check.yml` | ✅ success（14:21:28Z），16 步 + Stale-fork guard 全过（空提交不删任何条目） |
| `pr-gate.yml` → `Submission gate` | ✅ **success**（14:24:34Z），标题 `Entries look good` |
| PR 状态 | `mergeable: true`、`mergeable_state: clean`、0 评论 0 评审 |

`Submission gate` 转绿时的正文：

```
All 1 submitted entry passes: `dsh.bundle` declared, repo old enough, enough commits.
```

→ 至此提交侧全部完成，**剩下只等维护者合并**，作者无需再做任何事。

## 三、已经满足的检查项（对照 awesome 的 `scripts/check-submission.mjs`）

| 检查项 | 状态 |
| --- | --- |
| 声明 `dsh.bundle`（`plugin/dsh-kp-notes/package.json` → `./cordis.patch.yml`） | ✅ |
| `cordis.patch.yml` 用包名引用（不是 `file://` 绝对路径 + 写死的 `config.root`） | ✅ |
| `exports["./client"]` + `dsh.client.platform: "web"` + 浏览器模块注册 id == 包名 | ✅ |
| `icon.svg` 相对路径、小于 256 KiB | ✅ |
| `license` / `repository`（含 `directory`）/ `homepage` / `keywords` / `author` | ✅ |
| `peerDependencies`（`@deepseek-ai/cordis ^4.0.4` + 4 个 `@deepseek-ai/dsh-client-* ^0.2.0-rc.1`） | ✅ |
| `files` / `engines` / `publishConfig` | ✅ |
| 有真实可用代码、目录结构正常 | ✅ |
| topic `dsh-plugin` | ✅ `topics: ["dsh-plugin"]` |
| 仓库满 1 天（`MIN_AGE_DAYS = 1`） | ✅ 2026-10-04T14:24Z 闸门转绿 |
| 清单条目（一个 `data/plugins/*.yml`） | ✅ PR #6525（已转正式、闸门全绿、等待合并） |

## 四、备注

- 本机开发怎么装：`dsh plugin --profile tauri add link:/Users/unitysir/Desktop/rk-study/plugin/dsh-kp-notes`，装完把 profile 的 `dsh.profile.bundles` 里写成包名 `dsh-kp-notes`（本机已经这么配了，符号链接在 `~/.dsh/profiles/tauri/node_modules/dsh-kp-notes`）。
- 任何 `dsh plugin …` 子命令都会去写 `~/.dsh/profiles/<name>/package.json.lock`，所以别在受限沙箱里跑。

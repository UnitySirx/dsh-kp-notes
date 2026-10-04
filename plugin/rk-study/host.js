/*
 * rk-study — Host half.
 *
 * Scans the markdown study workspace and turns it into a structured catalog:
 *   目录 (= 大章节)  →  .md 文件 (= 小节)  →  知识点 / 知识点说明 / 题目 · 答案
 *
 * Also serves the read + write endpoints the client half uses to browse and edit
 * those markdown files in place.
 */
/* 拆分后的模块: 改 lib/ 下任何文件后, 把下面所有 `?v=N` 一起 +1(含 lib/ 内部互相 import 的那些
 * 与 client.js 的 MODULE_VERSION / cordis.patch.yml 的 ?entry=) 再重载插件即可生效。
 *
 * Config 也要从这里转出去: cordis 是从插件模块本身取 `plugin.Config` / `plugin.inject` 的
 * (cordis/lib/index.js Context.plugin), 不转出去的话 schemastery schema 不会生效。 */
export { name, inject, Config, ROUTE, ASSET_ROUTE } from './lib/constants.js?v=55';
export { apply } from './lib/routes.js?v=55';

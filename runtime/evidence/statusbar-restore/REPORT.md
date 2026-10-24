# 恢复 Typora 原生底部状态栏 — 根因与验收证据

- 时间：2026-10-24 21:05 – 21:35（本机时间，UTC+8）
- 环境：Windows 10 19041 / Typora 1.6.7（`D:\Typora`）/ 社区框架 core 2.9.13 / 墨章 `ranzhi.inkchapter` 0.1.0-alpha.1
- 结论：**问题由 Typora 原生设置 `showStatusBar=false` 造成，与社区框架、墨章均无关。只恢复了原生配置，未改动任何源码。**

---

## 1. 症状与根因链

| 观察到的症状 | 直接原因 |
| --- | --- |
| 右下角原生字数统计、状态栏不可见 | `footer.ty-footer` 整体 `display:none`（body 只有 `hide-footer`） |
| 底部左侧“侧边栏切换”等入口不可见 | `#outline-btn`、`#toggle-sourceview-btn` 都住在 `footer.ty-footer` 里，随状态栏一起消失 |
| 原生“源代码模式”快捷入口缺失 | 同上；1.6.7 的源码模式按钮是 footer 内的 `#toggle-sourceview-btn`（`fa-code` 图标，内联 `display:inline-block`） |
| 左侧文件树底部只看到 `+` | 这是 Typora **原生 hover-only 设计**：`.use-file-tree-style .sidebar-footer-item{opacity:0}`，仅 `#sidebar-new-file-btn` 恒显；鼠标移入侧栏后“打开文件夹/⋮/固定大纲”才显现（见 `06-C-sidebar-footer-hover.png`）。不是缺陷。 |

根因链（全部有源码/实机证据）：

1. `%APPDATA%\Typora\profile.data`（十六进制编码的 JSON）中 `"showStatusBar":false`。
2. `D:\Typora\resources\appsrc\window\frame.js` 启动时：
   `!1!==_options.showStatusBar ? document.body.classList.add("show-footer") : document.body.classList.add("hide-footer")`
   → 本机加了 `hide-footer`。
3. `D:\Typora\resources\style\window.css`：`footer.ty-footer{display:none;…}`，只有 `.show-footer footer.ty-footer{display:block;z-index:4}` 才显示；
   `.hide-footer content{bottom:0!important}` 同时把正文下边距归零 —— 即“看起来根本没有状态栏”。
4. 结论：纯原生配置问题，插件/框架均未参与。

## 2. 恢复方式（只动原生配置）

- 路径：**偏好设置 → 外观 → 状态栏 → 显示状态栏**（截图 `03-preferences-appearance.png` 未勾选 → `04-preferences-statusbar-checked.png` 勾选）。
- 该控件在 Typora 的 Preferences 包里 `keyName:"showStatusBar"`，onChange 直接执行
  `document.body.classList.add("show-footer")` + `putSetting("showStatusBar", true)`，因此**即时生效且持久化**。
- 复验：`profile.data` 解码后为 `"showStatusBar":true`；关闭 Typora 后再次解码仍为 `true`。
- 视图菜单亦可见勾选态：`24-view-menu-items.png`（视图 → 显示状态栏 ✓；同菜单含 源代码模式 Ctrl+/、显示/隐藏侧边栏 Ctrl+Shift+L）。
- 未做任何 DOM 重建、未重写字数统计、未新增 CSS/JS。

## 3. 三环境对照（安全配置切换，未删除插件、未覆盖 WIP）

| 环境 | 配置 | 状态栏结果 | 证据 |
| --- | --- | --- | --- |
| A：原生 | `%APPDATA%\Typora\plugins\loader.js` 临时改名（框架不加载），墨章在 vault 内禁用 | 状态栏可见：`<`、`</>`、`314 字符` | `21-A-native-only-footer.png` |
| B：仅框架 | `test/vault/.typora/plugins.json` → `{"ranzhi.inkchapter": false}`，框架启用 | 状态栏可见：`<`、`</>`、`314 字符`；墨章 UI 全部消失（标题无编号） | `20-B-framework-on-inkchapter-off.png` |
| C：框架+墨章 | 原状（两者启用） | 状态栏可见 + 墨章右栏/导航正常 | `05-C-footer-restored.png`、`22-C-restored-after-matrix.png`、`30/41` |

- A 完成后 `loader.js` 已还原，SHA256 与备份一致（`9D6206F0…EF380`）。
- B 完成后 `plugins.json` 已按备份原样还原（`git status` 该文件为 clean）。
- 每个环境都以同一原生 `profile.data`（`showStatusBar:true`）运行，变量仅为插件加载状态 → 三者都显示状态栏，证明隐藏与插件无关。

## 4. 源码 / 样式全量审计（footer、statusbar、status-bar、word-count、sidebar、ribbon、source-mode）

| 产物 | 检索结果 |
| --- | --- |
| 部署中的墨章 CSS（`test\vault\.typora\plugins\dist\style.css`） | `footer` / `#footer` / `word-count` / `outline-btn` / `toggle-sourceview` 命中 **0**；仅 1 条 `body.inkchapter-ribbon-hidden.typ-ribbon--enable .info-panel-tab-wrapper{display:flex!important}`（恢复原生侧栏标签） |
| `src/style.scss` | 仅 ribbon 恢复块（第 4460–4490 行）涉及 `.info-panel-tab-wrapper`；无任何 footer/字数/源码模式规则 |
| 框架实际加载的 `%APPDATA%\Typora\plugins\2.9.13\core.css` | `.typ-ribbon--enable .info-panel-tab-wrapper{display:none}`（仅 ribbon 模式）；`footer.ty-footer{left:…}`（仅定位）；`#footer-word-count-info{max-height:90vh}`（仅下拉）；无 `show-footer/hide-footer` 操作、无 `#footer-word-count{display:none}` |
| 框架 `core.js` | 仅 `typ-ribbon--enable` 类切换；无 footer 隐藏 |
| 墨章 TS | `outline-numbering-adapter.ts` 仅把 `#ty-sidebar-footer`/`.sidebar-footer` 等列入“非大纲容器”排除表，不写样式、不删节点 |

即：没有任何 `display:none` / `visibility:hidden` / `opacity:0` / DOM 删除 / 容器裁切 / 布局覆盖来自墨章或框架指向原生状态栏。

## 5. 兼容性验证（墨章右上下按钮不得遮挡原生控件）

- 墨章导航的 `bottom` 由 `navBottom = bottomGap + NAV_BOTTOM_PX` 计算，`bottomGap = innerHeight - editorShell.bottom`（`document-utility-overlay-host.ts`），状态栏出现后 `editorShell.bottom` 自动上移，因此导航天然避让。
- 实机：1920×1030（`30/41`）、1200×780（`40`）下，导航 rect 约 `right=1122, bottom=687` / `right=698, bottom=650`，状态栏在 `y≈800+`，**不重叠**。
- 侧栏折叠/展开：`09`（折叠后 footer 横跨全宽）、`10`（再次展开）正常。
- 文档滚动：`39`（滚到文末）状态栏与导航均正常。
- 窗口缩放往返：`15`（1200×780）→ `16`（还原最大化）→ `40`（新构建 1200×780）→ `41`（新构建还原）布局一致。
- 源代码模式：`07/33` 开启（原生 markdown 视图 + “退出源代码模式”）、`08/34` 关闭，字数统计按原生规则在源码模式下隐藏。
- **PENDING**：侧栏宽度拖拽（`#typora-sidebar-resizer`）。三次像素拖拽（y=430/700，x=330/331/333）均未改变侧栏宽度；其中一次误触把文件树条目拖入正文，已用 Ctrl+Z 撤销并核对字数回到 314。该功能为纯原生实现，本次未触及侧栏 DOM/CSS，故标为未通过真机拖拽验收。
- **N/A**：侧栏列表内部滚动 —— 该 vault 根目录仅 6 个条目，不产生侧栏滚动条，无法构造真机滚动场景；文档区滚动已验证（`39`）。

## 6. 质量门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 定向测试 | `npx vitest run`（ribbon-visibility、overlay-host、navigator 几何、响应式、min-width、drawer safe-area、region-divider、toolbar 可见性） | 8 文件 / **194 测试通过** |
| 类型检查 | `pnpm run typecheck` | 退出码 **0** |
| 全量测试 | `pnpm run test` | **245 文件 / 4599 测试通过**，退出码 0 |
| 构建 | `pnpm run build:dev`（含 verify:archive PASS、typecheck、esbuild、installDevPlugin） | 退出码 **0** |
| 测试 vault 部署 | `scripts/deploy-test-vault.ps1`（PowerShell 5.1 需 `$PSDefaultParameterValues['Get-Content:Encoding']='UTF8'`，否则脚本读源码 manifest 中文会 GBK 乱码） | `DEPLOY_HASH_MAIN_MATCH=True`、`DEPLOY_HASH_CSS_MATCH=True` |
| 运行时加载 | `test/vault/.typora/inkchapter-runtime-load.json` | `mainJsSha256` 与构建/部署一致 |

哈希：

- 构建 `dist/main.js`：`8A2C6786185618CA9FA832CB53CEA95420AF74EADCB659A21ABB55C4FFC74B08`（4,421,617 B，dev）
- 部署 `test\vault\.typora\plugins\dist\main.js`：同上（一致）
- 构建/部署 `style.css`：`75D7EE4E92953C04B4A6F753B04331F473E88A101A020871EECF7EB60C6B0355`
- 运行时实际加载：`8A2C6786…C74B08`（`loadSource: vault`，`pluginRoot: …\test\vault\.typora\plugins\dist`）
- 用户级（全局）安装 `%APPDATA%\Typora\plugins\plugins\ranzhi.inkchapter`：`DE62CB1A…39A339E`，**未改动、未部署**（本次只部署测试 vault）

## 7. 过程事故与恢复（未提交 Git）

1. 从 Agent shell 启动 Typora 会立即 `exit code 0` 且不写日志：因环境变量 `ELECTRON_RUN_AS_NODE=1` 让 Electron 以 Node 模式运行。解决办法是在启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（`pnpm run build:dev` 内部的 `exec('Typora …')` 同样受影响）。
2. 像素拖拽侧栏时分隔条未命中，误将一个 `README.md` 链接拖入正文；立即 Ctrl+Z 撤销，字数回到 314、标题无 `*`、`git diff` 为空。
3. `pnpm run build:dev` 的 `installDevPlugin` 会把 `test/vault/.typora/plugins.json` 重写成单行；已 `git checkout --` 还原为 HEAD 内容（该文件此前为 clean，无用户改动被丢弃）。
4. 全程未执行 `git add/commit`；除新增 `runtime/evidence/statusbar-restore/` 证据目录外，工作区 WIP 与初始状态一致。

## 8. 截图索引

`00` 症状基线（状态栏缺失）· `03/04` 偏好设置外观状态栏勾选前后 · `05` 恢复后 · `06` 侧栏 hover 原生入口 · `07/08` 源码模式开/关 · `09/10` 侧栏折叠/展开 · `12/13` 字数 314→320→314 · `14` 第二窗口（DevTools）· `15/16` 窗口缩放往返 · `20/21/22` B/A/C 对照 · `24` 视图菜单（显示状态栏 ✓）· `30–41` 最终构建验收 · `42` 两个窗口复原。

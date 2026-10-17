# P0-CARET-EOF-RUNTIME-IDENTITY

> 轮次：`sess-p0-caret-eof-full-closure`（2026-10-12T11:49Z 记录）

## 1. 运行实例（Typora）

- **Typora 进程：未运行**（`Get-Process Typora` 返回空）。本轮**未启动/未重启/未关闭** Typora（项目硬约束：禁止自行启停宿主）。
- 因此 `PID / 主窗口句柄 / 窗口标题 / 当前打开的 vault` 均 **NOT_RUN**（无实例）。
- 最近一次加载记录（磁盘 `test/vault/.typora/inkchapter-runtime-load.json`，`loadedAt=2026-10-12T11:04:43.641Z`）：
  - `pluginId = ranzhi.inkchapter`
  - `buildMarker = inkchapter-heading-reason-chip-stable-anchor-v2`
  - `loadSource = vault`；`initializationCount = 1`
  - `ribbonInjected = false`；`ribbonEnableClass = false`
  - `pluginRoot = D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist`
  - `mainJsSha256 = 430FC94709D506DEF66E57E82E1C349516AF26C2C6BF7A07DB3393E103CC8A4E`

## 2. 三方 SHA 核对

| 层 | 路径 | SHA256 |
|---|---|---|
| BUILD | `dist/main.js` | `3A165610E9C56F78EE7FA2CEBCF9FEEDAAB69D37A6FA27B0D59CBFB039ADDE10` |
| DEPLOY | `test/vault/.typora/plugins/dist/main.js` | `3A165610…` ✅ MATCH |
| LOADED | `inkchapter-runtime-load.json.mainJsSha256` | `430FC947…` ❌ STALE |
| GLOBAL（生产，未覆盖） | `%APPDATA%\Typora\plugins\plugins\ranzhi.inkchapter\main.js` | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E` |

**判定：`RUNTIME_IDENTITY = FAIL`**（`ACTUAL_LOADED_SHA256 != DEPLOY_SHA256`）。
按提示词 §1.5：三方不一致 → **停止运行时"验收"**，但继续修复部署链（本轮已完成构建与部署链）。

## 3. 实际插件加载路径（已部署）

- `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js`（本轮已更新为 `3A165610…`）
- `...\dist\style.css` = `2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414`
- `...\dist\manifest.json`（由 `src/manifest.json` 复制）
- 全局生产根**未被本轮覆盖**（`GLOBAL_DEPLOY: skipped`，未传 `-Global -ApproveGlobal`）。

## 4. 环境事实

- 运行环境：Windows / PowerShell 5.1；Node `v24.19.0`；pnpm `11.15.0`（`E:\NodeJS`）。
- 自动化盲区（既有结论）：Typora 编辑区为 web DOM，不暴露给 Windows UI Automation；合成键盘/滚轮不可靠；行激活需 trusted `pointerdown` → 视觉/交互只能人工。
- 本轮构建为 **dev/test**（`dist/main.js.map` 存在），仅部署 test vault；未提升到全局生产。

## 5. 必需人工动作（唯一）

1. 重启 Typora（载入 test vault）→ 使 `mainJsSha256 = 3A165610…`、`initializationCount` 重新计数。
2. 在 `Document-Diagnostics-Trailing-Blank-3.md` 上执行 **C0/C4 配对 Enter** 与 A/B/C 真实操作。
3. 保存后导出 Markdown，交由 `scanPluginTextInSerializedMarkdown` 判定 `PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN_COUNT`。

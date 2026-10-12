# ENTER-EOF-IDENTITY-MATRIX

> 阶段 2 交付物。目标：在任何修改/实验前封锁「运行环境—版本—测试对象」身份。
> 采集时间：2026-10-12（本地 GMT+8）。证据等级：**OBSERVED**（命令实测输出）。

## 1. 仓库与 WIP 封锁

| 项 | 值 |
|---|---|
| branch | `archive/document-diagnostics-copy-sort-ui-v1` |
| HEAD | `9fa6a8024fcd5dac0e629eb3cbaf042ba46b446d` |
| 未提交文件 | 27 项（含 `M` 修改 18 + `??` 新增 9）——**本轮全部保留，未 reset / 未 clean / 未覆盖** |

`git status --short` 中的关键 WIP（本轮继续沿用，未回滚）：
- `src/document-utilities/enter-echo-write-trace.ts`（new）
- `src/document-utilities/document-diagnostic-eof-blank-row-band-v1.ts`（new）
- `src/document-utilities/document-diagnostic-blank-region-unified-v1.test.ts`（new）
- `src/document-utilities/document-utility-overlay-host.ts`、`heading-numbering-service.ts`、`main.ts`、`style.scss`（M）
- 既有证据 `runtime/evidence/ENTER-DUPLICATE-{ROOT-CAUSE,FIX-REPORT,RUNTIME-MATRIX}.md`（未删除）

## 2. 三份 main.js/style.css 与「实际加载」SHA（P0）

| 根 | 路径 | main.js SHA256 | style.css SHA256 |
|---|---|---|---|
| 编译产物 | `dist/main.js` | `E854ABB8919B9AE509DC8BEFF292F23D7BDC531B3F78FC69E90240415D6C0317` | `506B3E639B4BC33827FD914B53CAA8E57F0957460D0927B2A495F9B4D9319EE8` |
| 部署副本(测试 vault) | `test/vault/.typora/plugins/dist/main.js` | `E854ABB8919B9AE509DC8BEFF292F23D7BDC531B3F78FC69E90240415D6C0317` | `506B3E63…` |
| 全局社区插件 | `C:\Users\MSIPC\.typora\community-plugins\plugins\ranzhi.inkchapter\main.js` | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E`（**未改**） | `506B3E63…` |
| **当前运行实例实际加载** | `runtime-load.json#mainJsSha256` | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E` | — |

关键区分（防止用历史 runtime-load 冒充当前实例）：
- 本任务**开始前**：编译 = 部署(vault) = 全局 = **实际加载** = `DE62CB1A…`（`loadedAt 2026-10-12T07:54:00.153Z`、`loadSource=vault`、`initializationCount=1`）。→ 身份自洽。
- 本任务**本轮 build+deploy 后**：编译 = 部署(vault) = `E854ABB8…`；但 Typora 进程仍在运行旧实例 → `runtime-load.json` 仍为 `DE62CB1A…`。**新构建要在运行实例生效必须重启 Typora**（本轮因目标文档有未保存内容，未重启，见 RUNTIME-ACCEPTANCE）。

- pluginId / manifest：`ranzhi.inkchapter`，`name=墨章 InkChapter`，`version=0.1.0-alpha.1`，`loadSource=vault`（vault 优先于 global）。
- 加载优先级实测：`loadSource=vault` ⇒ 即使全局与 vault 同 id，本窗口加载的是 **vault 副本**。

## 3. Typora 进程与目标文档身份

| 项 | 值 |
|---|---|
| Typora 进程 | PID 2360 / 29168 / 33508 / **34412** / 47328（5 个，`D:\Typora\Typora.exe`） |
| 带窗口的实例 | **PID 34412** |
| 窗口标题 | `Document-Diagnostics-Code-Integrity-Test.md•  - Typora`（`•` = 有未保存修改） |
| 活动文档绝对路径 | `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\Document-Diagnostics-Code-Integrity-Test.md` |
| vault 根 | `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault` |
| documentKey（运行实例） | `Document-Diagnostics-Code-Integrity-Test.md`（审计 `documentKey` 字段） |
| buildId（运行实例） | `inkchapter-heading-reason-chip-stable-anchor-v2` |
| sessionId（本证据用到的会话） | `sess-1791791639996` |
| enterTxnId（被归因的 Enter） | `NENTER-3-1791792211233` |

**NOT_Untitled 校验**：活动文档为已持久化 vault 文件（`documentMode=PERSISTED`），非 `Untitled`；实验样本满足身份门禁。

## 4. IDENTITY_GATE 结论

| 子项 | 结果 |
|---|---|
| 当前编译/部署/加载三重 SHA 一致性（修改前） | **PASS**（`DE62CB1A…` 三处相同且 `loadSource=vault`） |
| 目标文档为受控测试文件（非 Untitled） | **PASS** |
| 运行实例加载 = 被测 ARTIFACT | **PASS（修改前）**；修改后 **PENDING_USER_RUNTIME**（需重启 Typora 加载 `E854ABB8…`） |
| 未自动覆盖生产全局插件 | **PASS**（全局保持 `DE62CB1A…`，未 `-Global`） |

> 结论：**修改前身份门禁 PASS**，允许进入对照与归因阶段；部署后新构建的「实际加载」身份需一次受控重启人工确认。

## 5. R2 — 受控重载后的实际加载身份（已确认）

上一版遗留缺陷：报告称新构建已部署，但运行实例仍加载旧构建 `DE62CB1A…`，**新代码从未真实运行**。本轮已修正：

| 项 | 值 |
|---|---|
| 重载前实际加载 | `DE62CB1A…`（旧） |
| 重载方式 | `Ctrl+S` 保存 WIP → `scripts/restart-typora-test-vault.ps1`（安全，无未保存数据） |
| **重载后实际加载** | **`A337D6DF91E7B4171A9C214FF109DD8A5EA6E5F98140310F7579DDD529A549FF`**（`loadSource=vault`，`initializationCount=1`，`pluginRoot=test\vault\.typora\plugins\dist`） |
| 编译 / 部署 / 实际加载 | **三处全部 `A337D6DF…`（一致）** |
| 全局生产插件 | `DE62CB1A…`（未覆盖） |
| 目标文档 | `test\vault\Document-Diagnostics-Code-Integrity-Test.md`（持久化，非 Untitled） |

新构建在运行实例中自证：`DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-DISABLED` 审计在真实提交中发出（旧构建无此事件）。

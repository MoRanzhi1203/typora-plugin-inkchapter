# 文档诊断修复能力矩阵（V2 — 真实修复引擎）

> 分支：`feature/diagnostics-trae-ui-quick-fix`（未合并 main、未推送）
> 权威实现：`src/document-utilities/document-diagnostic-fix-v2.ts`
> 只读能力表：`describeFixCapability()` / `listFixCapabilities()`（UI 与测试共用同一张表）

## 1. 编辑器事务取证（F0）

| 事实 | 证据 |
|---|---|
| Typora 没有公开 range-replace API | `@types/typora` 仅公开 `File.reloadContent` / `Editor.reset` / `Editor.selection` |
| `File.reloadContent(markdown, options)` 的真实实现 | `D:\Typora\resources\appsrc\window\frame.js`：解构 `{skipUndo, delayRefresh, fromDiskChange, skipChangeCount, onInit, skipStore}` |
| 未传 `skipUndo` ⇒ 撤销可用 | 同一函数内 `C.editor.undo.register(t, l)`；`t.tag='reload'`、`t.undo.push(buildAllDoc(...))` |
| 生产路径 | `main.ts` → `diagnosticFix.applyMarkdown` → `File.reloadContent(next, {})` → 立即 `editor.getMarkdown()` 回读比对 |
| 禁止路径 | 无 `fs.writeFile`、无 `#write.innerHTML`、无 DOM 删除、无手改撤销栈 |

**撤销粒度（真实承诺）**：一次修复/一批修复 = 一次 `reload` 命令，`Ctrl+Z` 一次恢复整批；
标题/代码/表格名称写入题注服务时不改 Markdown，因此不产生 Markdown 撤销项（UI 已明确说明）。

## 2. 修复支持矩阵

| 诊断代码 | 能力 | 修复方式 | 真实应用 | 证据测试 |
|---|---|---|---|---|
| `EXCESSIVE_INTERNAL_BLANK_LINES` | `AUTO_SAFE` | 源补丁：`first+pass .. last` 整行删除 | ✅ `File.reloadContent` + 回读 | fix-v2 / fix-controller |
| `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` | `AUTO_SAFE` | 源补丁：正文行 EOL 之后的多余换行 | ✅ 同上 | fix-v2 / fix-controller |
| `CODE_MISSING_LANGUAGE` | `USER_INPUT_REQUIRED` | 源补丁：仅起始围栏 info | ✅ 同上 | fix-v2 / fix-controller |
| `FIGURE_MISSING_NAME` | `USER_INPUT_REQUIRED` | 源补丁：仅 `![alt]` | ✅ 同上 | fix-v2 |
| `CODE_MISSING_NAME` | `USER_INPUT_REQUIRED` | `CaptionService.setCaption('code', …)` | ✅ 题注服务（不改 Markdown） | fix-v2 / fix-controller |
| `TABLE_MISSING_NAME` | `USER_INPUT_REQUIRED` | `CaptionService.setCaption('table', …)` | ✅ 题注服务（不改 Markdown） | fix-v2 / fix-controller |
| 其余全部规则 | `UNAVAILABLE` | 仅「定位 / 说明」 | — | 能力表默认值 |

`CODE_MISSING_NAME` / `TABLE_MISSING_NAME` 在题注服务不可用时会降级为 `UNAVAILABLE`
（不渲染空按钮）。

## 3. 安全闸门（全部在真实写入前执行）

`planDiagnosticFixV2()` 与 `DiagnosticFixController`：

- `DOCUMENT_LOCKED`：editGuard 锁定时不出现任何可确认计划；写入前再校验一次；
- `STALE_DOCUMENT`：快照 / 诊断 / 实时文档键不一致；
- `STALE_DIAGNOSTIC`：诊断已不在最新快照；
- `STALE_SOURCE`：补丁 `before` 与实时 Markdown 不一致；
- `PATCH_OUT_OF_BOUNDS` / `INVALID_FACT`：区间越界、空行区间含非空行、围栏/图名 token 不合法；
- `PATCH_CONFLICT`：同类/一键批量中范围重叠者被跳过并计数；
- `REQUIRES_INPUT`：语言/名称未提供或非法；
- `NO_FIXER` / `NOT_APPLICABLE`：无修复器、或当前已无需修改。

写入时 `createEditorFixTransactionAdapter` 再执行：文档键校验 → 基准文本严格相等 →
一次写入 → 回读严格相等；任一失败返回 `STALE_* / WRITE_REJECTED / READBACK_MISMATCH`。

## 4. 修复结果验证

`classifyFixOutcome()` 只接受**修复后的权威快照**：

- `VERIFIED_FIXED`：请求的诊断 ID 全部消失；
- `CHANGED_BUT_PERSISTS`：补丁已写入但诊断仍在（UI 明确报告“已修改，但仍有 N 项”）；
- `STALE` / `FAILED`：文档切换 / 无快照；
- 新出现的诊断 ID 单独列出（`introducedIds`），不隐藏副作用。

## 5. 测试证据

- `document-diagnostic-fix-v1.test.ts`（17）：纯规划、CRLF、受保护块、冲突、过期。
- `document-diagnostic-fix-v2.test.ts`（17）：能力矩阵、caption 路由、同类/一键计划、事务适配器、结果分类。
- `document-diagnostic-fix-panel.test.ts`（6）：输入校验、真实 diff、取消零写入、忙碌禁用。
- `document-diagnostic-fix-controller.test.ts`（9）：确认前零写入、写入后验证、持久诊断如实报告、锁定/切换拒绝、重复提交幂等。
- `document-hub-model-order-v1.test.ts`（6）：默认文档顺序、稳定次级排序、过滤不改计数。

# 文档诊断修复能力矩阵（V1）

> 分支：`feature/diagnostics-fix-planner`
> 基线：`main = 26714a3`
> 本轮只实现**纯补丁规划/预检/差异预览**；真实编辑事务适配器未验证，因此所有 `apply`
> 一律 `BLOCKED`，不会写磁盘、不会改 `#write.innerHTML`、不会删 DOM、不会整篇 reload。

## 1. 修复支持矩阵

| 诊断代码 | 支持级别 | 计划器 | 真实应用 | 说明 |
|---|---|---|---|---|
| `EXCESSIVE_INTERNAL_BLANK_LINES` | `AUTO` | ✅ 源补丁 | `BLOCKED` | 压缩到策略允许的 1 个空行；保留一个空行 |
| `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` | `AUTO` | ✅ 源补丁 | `BLOCKED` | 删除多余文末空行，保留正文行自身的 1 个 EOL |
| `CODE_MISSING_LANGUAGE` | `REQUIRES_INPUT` | ✅ 源补丁 | `BLOCKED` | 必须显式输入合法语言；只改起始围栏 |
| `FIGURE_MISSING_NAME` | `REQUIRES_INPUT` | ✅ 源补丁 | `BLOCKED` | 只把用户输入写入图片 alt；拒绝 `]`/换行 |
| `CODE_MISSING_NAME` | `MANUAL` | ❌ 无源补丁 | `BLOCKED` | 属于题注服务，必须走现有命名事务，不能伪造 |
| `TABLE_MISSING_NAME` | `MANUAL` | ❌ 无源补丁 | `BLOCKED` | 同上 |
| 其余诊断 | `UNSUPPORTED` | — | — | 没有验证过的修复语义 |

## 2. 已实现的预检/安全闸门

`src/document-utilities/document-diagnostic-fix-v1.ts`：

- `DiagnosticFixRegistry`：按 code 注册，`AUTO/REQUIRES_INPUT/MANUAL/UNSUPPORTED`。
- `FixPlanner`（`planDiagnosticFix` / `planManyFixes` / `planAllAutoFixes`）：
  - `DOCUMENT_LOCKED`：editGuard 锁定时拒绝；
  - `STALE_DOCUMENT`：诊断/快照 documentKey 不一致；
  - `STALE_DIAGNOSTIC`：诊断已不在最新快照；
  - `STALE_SOURCE`：编辑器 Markdown hash 与快照源不一致，或 revision 过期；
  - `PATCH_OUT_OF_BOUNDS` / `STALE_SOURCE`：补丁越界或 `before` 与当前源不一致；
  - `PATCH_CONFLICT`：批量计划范围重叠；
  - `REQUIRES_INPUT`：名称/语言未提供；
  - `CAPTION_NAME_SERVICE_REQUIRED`：代码/表名不允许源补丁；
  - `TRANSACTION_AUTHORITY_UNVERIFIED`：`applySupported=false` 的固定原因。
- 差异预览：只输出补丁附近的 line hunk，不生成整篇新 Markdown 作为执行路径。
- `applyPatchesToMarkdown`：仅测试/预览用的纯函数，不是运行时入口。

## 3. 边界处理

空行修复器：

- 复用 `EXCESSIVE_INTERNAL_BLANK_LINES` 的权威 gap 元数据（`firstBlankLine` / `lastBlankLine` / `actualBlankLines` / `passMaxBlankLines`）；
- 只删除 `first+pass .. last` 的整行；保留 1 个空行；
- 拒绝首部 gap、非空行、越界、以及被 `parseDocumentSourceSyntax` 判为代码/公式/受保护范围的行；
- 文末修复只删除正文行 EOL 之后的额外换行，保留恰好 1 个 EOL；拒绝未闭合代码块内的尾部空行；
- CRLF/LF 均保留原换行风格；不使用整篇正则替换。

代码语言/图名：

- 代码语言按 `block:code:<ordinal>` 映射到 `parseFencedCodeBlocks` 的起始围栏，只插入 info；
- 图名只改 `![alt](...)` 的 alt，不碰路径/标题；
- 语言/名称必须由用户显式提供，非法输入拒绝。

## 4. 测试证据

`src/document-utilities/document-diagnostic-fix-v1.test.ts`（15 tests）：

- 4 空行→1 空行；CRLF；fenced code 拒绝；首部 gap 拒绝；
- 文末 3 换行→1；CRLF；正常单换行拒绝；
- 代码块序号、已有语言、非法语言、显式输入；
- 图名 alt 插入、缺输入、非法字符；
- 代码/表名 `CAPTION_NAME_SERVICE_REQUIRED`；
- locked、stale source/document/revision、diagnostic 消失、批量重叠、`applySupported=false`。

## 5. 为什么真实应用被 BLOCKED

审计结论：

- `@types/typora` 只公开 `File.reloadContent(markdown)` / `Editor.reset(markdown)`（整篇）与
  `Editor.selection`；没有公开的 range replace API。
- `File.reloadContent` 是整篇 Markdown 重建，任务明确禁止；现有题注/图片改写也使用它，
  不能作为本功能的“安全事务”先例。
- `editor.selection` 是 DOM 文本范围；空行在渲染 DOM 中没有稳定的文本节点对应，
  无法把 Markdown 行偏移安全映射为选区，强行用 `execCommand` 可能跨块/破坏结构。
- 因此没有可验证的 range transaction、Undo/Redo 证据；启用 apply 会违反
  “只能通过经过验证的 Typora 编辑事务修改”的要求。

## 6. 尚需外部输入

1. Typora 官方/可验证的 range edit transaction（含 Undo/Redo、异步文档切换隔离）。
2. 题注名称服务的事务入口（代码块/表名）。
3. 真实 GUI 中展开面板的 fix 入口验收（当前未新增 UI，避免无事务按钮误导用户）。

## 7. 状态

- 计划器/预检/冲突/差异：**MODULE_PASS + INTEGRATION_READY**（纯函数，无运行时写）。
- 空行/代码语言/图名补丁：**MODULE_PASS**（计划级）。
- 真实应用：**BLOCKED**（无验证事务）。
- UI：**BLOCKED**（不在无 apply 事务时新增“修复”按钮，避免伪能力）。

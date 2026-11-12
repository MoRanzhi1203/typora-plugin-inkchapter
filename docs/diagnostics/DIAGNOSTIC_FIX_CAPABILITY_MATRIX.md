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
| `LIST_EMPTY_ITEM` | `AUTO_SAFE` | 源补丁：删除无内容的列表标记行 | ✅ 同上 | format-integrity-v1 / fix-v2 |
| `FORMULA_SINGLE_LINE_BLOCK` | `AUTO_SAFE` | 源补丁：`$$x$$` → `$$` / 公式 / `$$` 三行 | ✅ 同上 | format-integrity-v1 / fix-v2 |
| `FIGURE_IN_HEADING` | `AUTO_SAFE` | 源补丁：保留标题层级与文字，图片（含空路径 token）按原顺序移出为独立段落；标题内残留的图片语法片段一并移出（仅图片标题移除标题结构） | ✅ 同上 | heading-v1 / classification-v1 |
| `FIGURE_SYNTAX_IN_HEADING` | `AUTO_SAFE` | 源补丁：把标题中未完成的 `![...](` 语法整体移出标题（标题文字保留；仅语法标题移除标题结构） | ✅ 同上 | heading-v1 |
| `FIGURE_UNCLOSED_DESTINATION` | `AUTO_SAFE` | 源补丁：仅在**段落结尾且无其他未闭合结构**时插入 `)`；URL 字节不变 | ✅ 同上 | syntax-integrity-v1 |
| `FIGURE_UNCLOSED_ALT` | `AUTO_SAFE` | 源补丁：仅在描述与路径边界无歧义时插入 `]`；歧义时降级为手动 | ✅ 同上 | syntax-integrity-v1 |
| `FIGURE_MALFORMED_SYNTAX` | `UNAVAILABLE` | 仅「定位 / 说明」；不渲染修复按钮 | — | syntax-integrity-v1 |
| `FIGURE_INVALID_DESTINATION` | `UNAVAILABLE` | 仅「定位 / 说明」；不渲染修复按钮 | — | syntax-integrity-v1 |
| `FIGURE_EMPTY_SOURCE` | `EXPLICIT_ONLY` | 源补丁：**仅在用户点击该行「处理」时**删除空图片占位符；**不进入一键修复**，也不伪造路径 | ✅ 同上 | heading-v1 / fix-v2 |
| `FIGURE_BLOCK_STRUCTURE_INVALID` | `AUTO_SAFE` | 源补丁：把通用非法 owning block 拆成「文字块 / 每图一块」 | ✅ 同上 | v515 §11 / fix-v2 |
| `FIGURE_MULTIPLE_SAME_BLOCK` | `AUTO_SAFE` | 源补丁：按原顺序拆成「每图一块」 | ✅ 同上 | v515 §8.2 / classification-v1 |
| `FIGURE_TEXT_MIXED` | `AUTO_SAFE` | 源补丁：文字 / 图片 / 文字 三段 | ✅ 同上 | v515 §8.2 / classification-v1 |
| `FIGURE_IN_LIST` | `AUTO_SAFE` | 源补丁：**原位**移除目标顶层列表项标记（无序 / 有序 / 任务列表），图片留在原位置，前后兄弟项保持原顺序 | ✅ 同上 | classification-v1 |
| `FIGURE_IN_QUOTE` | `AUTO_SAFE` | 源补丁：**原位**移除图片行的全部引用层级；前后引用文字保留引用属性 | ✅ 同上 | classification-v1 |
| `FIGURE_INLINE_FORMAT` | `AUTO_SAFE` | 源补丁：移除直接包裹图片的强调标记后独立成块 | ✅ 同上 | classification-v1 |
| `FIGURE_IN_TABLE` | `UNAVAILABLE` | 仅「定位 / 说明」；不渲染修复按钮 | — | classification-v1 |
| `CODE_MISSING_NAME` | `USER_INPUT_REQUIRED` | `CaptionService.setCaption('code', …)` | ✅ 题注服务（不改 Markdown） | fix-v2 / fix-controller |
| `TABLE_MISSING_NAME` | `USER_INPUT_REQUIRED` | `CaptionService.setCaption('table', …)` | ✅ 题注服务（不改 Markdown） | fix-v2 / fix-controller |
| 其余全部规则 | `UNAVAILABLE` | 仅「定位 / 说明」 | — | 能力表默认值 |

`CODE_MISSING_NAME` / `TABLE_MISSING_NAME` 在题注服务不可用时会降级为 `UNAVAILABLE`
（不渲染空按钮）。

图片结构规则按真实问题分类（`FIGURE_IN_HEADING` / `FIGURE_SYNTAX_IN_HEADING` /
`FIGURE_IN_LIST` / `FIGURE_IN_QUOTE` / `FIGURE_IN_TABLE` / `FIGURE_MULTIPLE_SAME_BLOCK` /
`FIGURE_TEXT_MIXED` / `FIGURE_INLINE_FORMAT` / `FIGURE_BLOCK_STRUCTURE_INVALID`），每个
owning block **只发布一条**诊断（优先级：标题 > 非法容器 > 多图同行 > 图文混排 > 行内格式 >
通用结构）。`FIGURE_IN_HEADING` 与 `FIGURE_SYNTAX_IN_HEADING` 以「是否存在完整图片 token」
为唯一边界：有完整 token 的标题只报前者，后者只覆盖语法残留，同一图片节点绝不重复报错。

> 规则 ID 映射：V2 规格表中的 `FIGURE_BLOCK_STRUCTURE` 在本工程继续使用既有稳定 ID
> `FIGURE_BLOCK_STRUCTURE_INVALID`（兜底规则），未新增同义 ID。

可自动修复范围：
- 段落 / 独立图片块：文字与每张图片各自成块；
- 标题（H1–H6）：图片与图片语法片段移出标题，标题层级 / 文字 / 图片字节不变；
- **顶层**列表项：原位移除列表标记，图片成为独立段落，前后兄弟项顺序不变（嵌套项或带缩进子内容时拒绝并说明原因）；
- 引用块：原位移除图片行的全部 `>` 层级，前后引用文字保持引用属性；
- 行内格式：仅移除直接包裹图片的 `**` / `*` / `__` / `_` / `~~`。

**一键修复（§13.2）**：只收集 `AUTO_SAFE` 计划，并按依赖优先级排序（容器结构 → 多图同行 →
图文混排 → 通用兜底；同优先级按文档位置），冲突计划由第一个占用字节的计划获胜，其余标记
`PATCH_CONFLICT`。所有补丁合并为**一次** `File.reloadContent` 写回，写回后重新检测并以新快照
判定修复结果（`VERIFIED_FIXED` / `CHANGED_BUT_PERSISTS`），不按列表顺序逐条字符串替换。
`FIGURE_EMPTY_SOURCE` 为 `EXPLICIT_ONLY`，永远不进入一键修复。

表格单元格 `FIGURE_IN_TABLE` 的生产者把 `metadata.autoFixable` 记为 `false`，列表行
**不渲染修复按钮**，修复器本身也以 `STRUCTURE_NOT_AUTO_FIXABLE` 明确拒绝并说明原因
（Markdown 逐字节不变）。同一 owning block 只发布一条诊断，因此「多图同行 + 图文同行」
是一次写回。

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

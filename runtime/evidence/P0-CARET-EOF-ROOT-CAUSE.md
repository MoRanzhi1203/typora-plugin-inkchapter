# P0-CARET-EOF-ROOT-CAUSE

> 轮次：`sess-p0-caret-eof-full-closure`（2026-10-12）
> 构建：`dist/main.js = 3A165610E9C56F78EE7FA2CEBCF9FEEDAAB69D37A6FA27B0D59CBFB039ADDE10`
> 证据分级：**PROVEN**（有本机真实证据/源码事实）｜**HYPOTHESIS**（尚未闭环）｜**NOT_RUN**（需真实 Typora）

## 1. 光标隔离（诊断备注侵入正文）

### 1.1 已证实的结构性缺陷（PROVEN，修复前）
- 插件 document-space 展示层 `inkchapter-locate-document-layer` 被 append 进 `#write`（contenteditable 书写区），层内承载**可见文字**（原因 chip、`N 空行` 标签、EOF 标签、CODE 标签），**修复前只有 `pointer-events:none`**，缺 `contenteditable="false"` / `tabindex="-1"` / `user-select:none` → 非 Markdown 文字位于可编辑树内，方向键可将插入点移入插件备注。
- 首分叉：`src/document-utilities/document-diagnostic-caret-isolation-v1.ts` 的 `stampCaretInertPresentation()` 是否在 `appendChild(layer)` **之前**执行。

### 1.2 本轮修复（PROVEN，可判错）
- 生产层在挂载前完成标记：`document-utility-overlay-host.ts` 的 `ensureLocateDocumentLayer`（`stampCaretInertPresentation(layer,false)` 先于 `host.appendChild(layer)`）与 `ensureHeadingMarkerLayer`；题注（`caption-dom-adapter.ts`、`caption-service.ts`）以 `interactive=true` 保留交互，不设 `pointer-events:none`。
- 由源码契约测试 `CONTRACT: 生产层在 appendChild 之前完成标记` 判错守护。

### 1.3 审计器可靠性缺陷（PROVEN → 本轮修复）
- **静默覆盖（结构缺陷）**：旧 `scheduleNavigationPostDefaultAudit` 队列满时 `pendingAudits.shift()` 直接丢弃最旧样本、**不计数** → 覆盖缺口永不可见（提示词 §2.3/§7.2 明令禁止）。
- 缺少 `eventSeq/queuedAt/flushedAt` 与 `enqueued/flushed/dropped/staleDocumentDiscard` 对账字段。
- 切文档/编辑器根重绑时**未注销待处理事件** → 跨文档污染风险。
- **本轮修复**：
  - `MAX_PENDING_AUDITS: 16 → 64`，溢出**显式计入 `AUDITS_DROPPED`** 并使覆盖门禁 `FAIL_AUDIT_COVERAGE`（不再静默）。
  - 新增 `NavigationAuditCounters`（`KEY_EVENTS_ELIGIBLE / AUDITS_ENQUEUED / AUDITS_FLUSHED / AUDITS_DROPPED / AUDITS_CANCELLED_WITH_REASON / AUDITS_REJECTED_WITH_REASON / STALE_DOCUMENT_DISCARD / UNSUPPORTED_KEY`）与 `evaluateAuditCoverageGate()`。
  - 每次入队分配 `eventSeq`/`queuedAt`，出队记录 `flushedAt`，审计 payload 增列。
  - 新增 `invalidateNavigationAudits(reason)`，在 `bindEditorRoot` 编辑器根重绑时调用（`EDITOR_ROOT_REBIND`）。

### 1.4 序列化泄漏判据（PROVEN，设计修正）
- 旧 `NON_MARKDOWN_TEXT_SERIALIZED_COUNT` **仅由 DOM 标记/编辑隔离扫描推得**，不等于检查了 Typora 实际导出的 Markdown。
- 本轮新增真实判据 `scanPluginTextInSerializedMarkdown(markdown, presentationTexts)`（纯文本比对）+ `evaluateSerializedMarkdownGate()`；**未取得真实导出文本时返回 `NOT_RUN`**，不得以静态 0 冒充 PASS。

## 2. 文末一次 Enter 重复拆分（EOF）

- **本轮状态：ROOT_CAUSE = UNKNOWN（未闭环）**。已验证排除「插件结构性 DOM 写入」路径（`pluginStructuralWriteCount=0`，见 `ENTER-EOF-FIX-REPORT.md` / `PROGRESS-ARCHIVE` ENTRY 8）。
- **本轮新增证据（PROVEN，静态）**：对 `heading-numbering-service.ts` 普通 Enter 路径（无缩进 token）逐行核查——插件**不调用** `preventDefault()` / `stopPropagation()`，也**不派发**合成 Enter；`preventDefault/stopPropagation` 仅出现在**特殊命令/缩进事务**与 **Backspace 消费**路径。故普通文末 Enter 的二次 `pressReturn` **不能**归因于插件的事件链拦截。新增有界只读取证 `ENTER-PLUGIN-INTERVENTION-AUDIT`（记录 `createdTransaction` / `defaultPreventedAtHandlerEnd` / `cancelBubbleAtHandlerEnd` / `pluginDispatchSyntheticEnter=false`）。
- **HYPOTHESIS（待真实运行时）**：余下嫌疑为「诊断提交路径在原生 `pressReturn` 期间产生的**非结构**副作用（属性写入/布局读触发）间接改变了 Typora 的 pressReturn 分支」。需真实 Typora 的 C0/C4 配对 + 首个内容分叉时刻插桩确认。
- **C0/C4 同条件真实对照 = NOT_RUN**（Typora 未运行，且项目硬约束禁止自行启动 Typora）。

## 3. EOF / 正文空行检测

- 四计数轴分离（`sourceTerminalLFCount` / `sourceBlankLineCount` / `renderedVisibleBlankCount` / `excessVisibleRows`）**已在此前轮次实现**（`PROGRESS-ARCHIVE` ENTRY 4/5/7），本轮**复核存在**、未回退；规则矩阵 N=0/1/2/5/10 的单测由 `document-diagnostic-blank-region-unified-v1.test.ts` 覆盖（本轮复核 25/25 通过）。
- **真实 Typora 视觉判定 = PENDING_USER_MANUAL**（需真实编辑逐行增删）。

## 4. 结论

| 缺陷 | 首次分叉 | 证据等级 | 本轮处置 |
|---|---|---|---|
| 诊断备注可被光标进入 | 展示层缺 `contenteditable=false` | PROVEN | 已修（挂载前标记） |
| 导航审计静默丢弃样本 | `pendingAudits.shift()` 无计数 | PROVEN | 已修（计数 + FAIL_AUDIT_COVERAGE） |
| 切文档审计跨文档污染 | 未注销待处理项 | PROVEN | 已修（`invalidateNavigationAudits`） |
| 序列化泄漏判据不真实 | 仅 DOM 推断 | PROVEN | 已修（真实导出文本比对，未采样 NOT_RUN） |
| 文末 Enter 重复拆分 | 未定（事件链嫌疑，结构性写入已排除） | HYPOTHESIS | 未修；C0/C4=NOT_RUN |

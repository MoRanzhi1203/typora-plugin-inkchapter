# EN11-R3-PATCH-AND-TESTS

> 轮次：`sess-p0-en11-causal-closure-r3`（2026-10-12）｜新构建 `741663E9…`

## 1. 本轮改动（Phase C）

### 1.1 新增：单一 `PresentationPaintCoordinator`
文件：`src/document-utilities/presentation-paint-coordinator.ts`（新增）

替换旧候选的 **7 处各自独立的 `setTimeout(remainingMs+1)`**。语义：

- **每 `(documentKey, 展示域)` 仅一个 pending dirty intent**，`latest-wins` 合并（旧闭包被新闭包取代，绝不重放旧 DOM）。
- intent 含 `documentKey / editorRootId / sourceRevision / layoutEpoch / intentEpoch`。
- **无 hold → 同步绘制**（`request()` 直接 `commit`）→ 所有非 Enter 路径行为与改动前完全一致。
- **有 hold → 停放在 `Map`，帧驱动有界重检**：`heldPredicate()` 是唯一权威（arm 的真实 Enter 回声窗口），**不把固定 250ms 当作唯一安全判断**；`MAX_HELD_FRAMES=120` 耗尽即 `HOLD_RETRY_BUDGET_EXHAUSTED` + fail-open 绘制（**标记不会永久消失**）。
- 绘制时**重新读取实时 `currentIdentity()`**：文档变化 → `DROP_STALE(DOC_CHANGED_BEFORE_PAINT)`；根变化 → `DROP_STALE(ROOT_CHANGED_BEFORE_PAINT)`；请求时文档已不匹配 → `DROP_STALE(DOC_MISMATCH_ON_REQUEST)`。
- 绘制闭包抛错 → 吞掉（`PAINT_ERRORS++`），不抛出（fail-open）。
- 禁：轮询、作为安全机制的递归 `setTimeout`、任何 DOM MutationObserver、写-观察反馈环。

计数器：`REQUESTS / MERGED / PAINTED / DROPPED_STALE / DEFERRED_BY_ECHO_WINDOW / HOLD_RETRY_BUDGET_EXHAUSTED / PAINT_ERRORS`。

### 1.2 接线：`document-utility-overlay-host.ts`

- 新增 `paintCoordinator` 字段 + `getPaintCoordinator()`（注入 `isContentDocumentWriteHoldActive` 作为 held 权威；注入 `{ documentKey: authority.getDocumentKey(), editorRootId: resolveBusinessContentRoot()? }` 作为实时 identity；注入审计 `DOCUMENT-DIAGNOSTIC-ECHO-WINDOW-PAINT-HELD`）。
- `runContentDocumentPaint(reason, paint)` 改为 `coordinator.request(reason, intent, paint)`（**7 处调用点不变**）。
- `bindDocument()` → `coordinator.cancelAll('DOCUMENT_SWITCH')`；`dispose()` → `coordinator.dispose()`。
- 新增测试/验收 seam：`getPresentationPaintCounters()` / `getPresentationPaintPendingCount()` / `flushPresentationPaintNow()`；`getEchoWindowHeldPaintCount()` 改读 coordinator 的 `DEFERRED_BY_ECHO_WINDOW`。
- 未改动：`。。+Enter` 缩进模块（`tryStartEnterIndentTransaction` / `commitEnterIndentTransactionSync` / caret 恢复 / rehydrate 链路）、原生 Enter/Backspace、Undo/Redo、原生侧栏、公式/编号/题注功能。

### 1.3 受保护的 7 处 `#write` 展示绘制（均经 coordinator）

`HEADING_MARKERS`、`ACTIVE_HEADING_EMPHASIS`（`commitAdmittedSnapshot`）、`REFLOOR_MARKERS`、`REFLOOR_ACTIVE_EMPHASIS`（rAF reflow）、`PASSIVE_ACTIVE_EMPHASIS`、`HEADING_TEXT_CHANGED_MARKERS`、`HEADING_TEXT_CHANGED_ACTIVE_EMPHASIS`、`ACTIVE_BLOCK_GAP_RECOMMIT`。

## 2. 测试

### 2.1 新增状态机行为测试（替代脆弱 source-slice）
文件：`src/document-utilities/presentation-paint-coordinator.test.ts`（新增，11 例）

- T1 无 hold 同步绘制；T2 hold 期间不绘制、释放后绘制；T3 同域合并 latest-wins；T4 不同域各自 pending；
- T5 文档切换 → DROP_STALE；T6 根替换 → DROP_STALE；T7 请求时文档不匹配 → 立即丢弃；
- T8 绘制抛错 fail-open；T9 cancelAll/dispose；T10 预算耗尽 fail-open 绘制；T11 计数器接口稳定。

### 2.2 保留并更新既有 hold 测试
文件：`src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts`

- HOLD-4 保留（`getEnterEchoWriteHoldRemainingMs`）。
- HOLD-5 更新：断言 7 处绘制**全部**经 `this.runContentDocumentPaint(...)`，并断言新增 `new PresentationPaintCoordinator(` / `this.getPaintCoordinator().request(`，且**不存在**旧的 `setTimeout(() => { try { paint() }`（可判错：实现回退即 FAIL）。
- 计数对账（`countOf(裸调用) === countOf(包裹行)`）保留，防止任一包裹被移除。
- 修正冲突：`ACTIVE_BLOCK_GAP_RECOMMIT` 采用**单行**包裹，避免改变 `document-diagnostic-layout-invalidation.test.ts` 依赖的源码锚点（未放宽任何断言窗口）。

## 3. 门禁（真实输出）

| 门禁 | 结果 |
|---|---|
| TYPECHECK (`tsc --noEmit`) | **PASS** |
| TARGETED_TESTS（coordinator + hold） | **PASS**（16/16） |
| FULL_TESTS | **PASS**（238 files / 4507 tests） |
| BUILD (`build:dev`，含前置 tsc fail-fast) | **PASS** |
| ARCHIVE_VERIFY | **PASS**（ENTRY_COUNT=10，append-only） |
| DEPLOY_SHA | **PASS**（project==vault==`741663E9…`；`DEPLOY_HASH_MAIN_MATCH=True`） |
| RUNTIME_IDENTITY | **PASS**（loaded `741663E9…`，source=vault，init=1，PID 44588） |
| 全局生产插件 | **未覆盖**（仍 `DE62CB1A…`） |

## 4. 未做（遵守约束）

- 未 `preventDefault(Enter)`、未削减 LF、未删除末端空行、未过滤第二个 Mutation、未硬编码 split 次数、未事后移动光标。
- 未盲目扩大延时窗口（改为事件驱动 + 有界 + fail-open，且无 hold 时同步）。
- 未以 jsdom 事件冒充 Typora runtime；单元测试与真实运行分列。
- 未 commit。

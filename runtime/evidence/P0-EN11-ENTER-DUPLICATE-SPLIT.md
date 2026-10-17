# P0-EN11 — 文末 Enter 重复拆分：缩进快捷输入核查 + 定点修复

> 轮次：`sess-p0-en11-indent-shortcut`（2026-10-12）
> 构建：修复前 `3A165610…`（真实运行未含本次改动）→ 修复后 **`9146A7B07386448BA0E88CBC19624C31DD56E58B8D72D4B099A39AA367D3E9F1`**（已部署 test vault 并由真实 Typora 加载）
> 证据分级：PROVEN（真实日志/源码事实）｜HYPOTHESIS｜NOT_RUN｜PENDING_USER_MANUAL

---

## 1. 结论（优先回答本轮的核查目标）

**「首行缩进快捷输入（`。。+Enter`）」不是 EN-11 文末重复拆分的触发源 —— 该假设被真实证据否证。**

三条独立证据：

1. **代码路径（PROVEN，源码）**：`tryStartEnterIndentTransaction` 进入缩进事务需**同时**满足：
   - `settings.indentShortcutEnabled === true`；且
   - `readParagraphIndentCommand(paragraph)` 返回 token —— 该函数**仅当段落可见文本恰好等于 `..` 或 `。。`**（`paragraph-indent-manager.ts:1352-1357`）才返回，普通句子句末的 `。。`（如「正文结束。」）或空段落一律 `null`；且
   - `isCaretAtTokenEnd(paragraph, 2)` 要求整段文本长度等于 token 长度、且插入点在段末。
   → 因此**普通 Enter（C 组）在正常/文末空段落中不可能进入缩进事务**。
2. **真实运行日志（PROVEN）**：全部审计会话中 `ALLOW_SPECIAL_COMMAND = 0`、`CANONICAL-RECORD-COMMIT = 0`、`POST-TOKEN-SELECTION = 0` —— 缩进事务**从未被执行过**。
3. **真实 Enter 归因（PROVEN，新构建会话 `runtime-sess-1791806776811` 等）**：每次真实 Enter 的 `ENTER-PLUGIN-INTERVENTION-AUDIT` 均为
   `admissionDecision=ALLOW_NORMAL_ENTER`、**`createdTransaction=false`**、`defaultPreventedAtHandlerEnd=false`、`cancelBubbleAtHandlerEnd=false`、`pluginDispatchSyntheticEnter=false`
   → 插件**既未进入缩进事务，也未拦截/二次派发 Enter 事件**。

**同时否证另一个假设**：「一次物理 Enter 同时执行了插件结构编辑 + Typora 原生插入」——provenance 审计显示插件只新增**展示节点**（`pluginOwnedAddedCount` 3→4，无内容结构写入），`userContentMutationCount` 归因 Typora。

## 2. 四组对照：代码路径静态判定 + 运行状态

| 组 | 定义 | 代码路径判定（PROVEN） | 真实运行状态 |
|---|---|---|---|
| **A** | 墨章禁用 | 无插件代码运行 | **NOT_RUN**（需用户在 vault 禁用插件后实测） |
| **B** | 启用但关闭缩进快捷 | `tryStartEnterIndentTransaction` 在 `!indentShortcutEnabled` 处**立即 return false** → 普通 Enter 纯原生 | **NOT_RUN**（需用户关闭开关后实测） |
| **C** | 启用缩进快捷、只按普通 Enter | 无 token → `return false` → `handled=false` → **不 preventDefault**；`onBeforeInputInsertParagraph` 因 `activeEnterTransaction` 为 null 而 `return`（不抑制）→ 纯原生 | **部分证据**：真实日志 `createdTransaction=false`、`ALLOW_NORMAL_ENTER`；但**重复拆分仍出现**（见 §3） |
| **D** | 输入 `。。` 后按 Enter | 进入事务：`commitEnterIndentTransactionSync` 调 **`event.preventDefault()` + `stopPropagation()`**，并置 `suppressNativeInsertParagraph=true`；断言 `paragraphCountAfter === paragraphCountBefore`（**设计上不产生新段落**）→ 与 EN-11 的「+4 LF / 2 次 split」症状方向相反 | **NOT_RUN**（日志中 `ALLOW_SPECIAL_COMMAND=0`，从未执行） |

> 说明：A/B/D 均**未执行**，故不得判 PASS；C 的「插件不干预事件链」已被真实日志证明，但 C 的**重复拆分**本身仍未消除。

## 3. EN-11 的真实证据（新构建、未含本次修复）

会话 `runtime-sess-1791806776811`（构建 `3A165610…`，探针已硬关闭）：

- 真实 Enter（`isTrusted=true, code=Enter`）各一次 → 每次均产生**两条** `SPLIT_1_TO_2`：
  - 批次1 `emp-…854831`：`childListCount=2, mutationShape=SPLIT_1_TO_2, provenance=USER_CONTENT, pluginOwnedAddedCount=3`
  - 批次2 `emp-…854924`：`childListCount=4, mutationShape=SPLIT_1_TO_2, pluginOwnedAddedCount=4, pluginOwnedRemovedCount=1, sameStateKeyAsPrevious=true`
- `ENTER-DUPLICATE-SPLIT-AFTER-FINAL`：`duplicateSplitIndex=2, windowMs≈91, endBlockRenormalization=true, decision=NATIVE_END_BLOCK_RENORMALIZATION`
- 插件事件链：`createdTransaction=false / defaultPrevented=false`（见 §1）。

→ 归因收敛为：**在真实 Enter 的有界回声窗口内，插件的展示层（heading markers / active emphasis / block-gap band）仍向 `#write` 写入节点**；Typora 的块模型对 `#write` 子树内的外来 childList 写入执行**尾块再归一化**，产生第二次 split（+2 LF）。这与 `isContentDocumentWriteHoldActive()` 已存在的「回声窗口内禁止内容文档写入」机制同源，但此前该 hold **只覆盖了 dry-run 探针**，未覆盖其余展示载体。

## 4. 定点修复（同轮实施）

**入口：写入侧（非 Mutation 过滤、非吞事件、非改计数、非删空行）**

- 新增 `enter-echo-write-trace.getEnterEchoWriteHoldRemainingMs()`（暴露回显窗口剩余毫秒）。
- `document-utility-overlay-host.ts` 新增 `runContentDocumentPaint(reason, paint)`：
  - 若 `isContentDocumentWriteHoldActive()` 为假 → 立即绘制（**零改动**的正常路径）；
  - 若为真 → **推迟**（`setTimeout(remaining+1)`）到窗口结束后再绘制，并发出有界审计 `DOCUMENT-DIAGNOSTIC-ECHO-WINDOW-PAINT-HELD`；计数 `echoWindowHeldPaintCount`（测试/验收 seam: `getEchoWindowHeldPaintCount()`）。
- 将 **5 处** reconcile 驱动的 `#write` 展示绘制全部改经该入口：
  `HEADING_MARKERS`、`ACTIVE_HEADING_EMPHASIS`（`commitAdmittedSnapshot`）、
  `REFLOOR_MARKERS`、`REFLOOR_ACTIVE_EMPHASIS`（rAF reflow）、
  `PASSIVE_ACTIVE_EMPHASIS`（passive/active reconcile）、
  `HEADING_TEXT_CHANGED_MARKERS`、`HEADING_TEXT_CHANGED_ACTIVE_EMPHASIS`（标题文本变更重建）、
  `ACTIVE_BLOCK_GAP_RECOMMIT`（active 带重提交）。
- **保留全部正常功能**：`。。+Enter` 缩进模块**未改动**（`tryStartEnterIndentTransaction` / `commitEnterIndentTransactionSync` / caret 恢复 / rehydrate 链路零修改）；普通 Enter 行为零改动（仍不 preventDefault）。
- **未使用**被禁止的手段：未丢弃 MutationObserver、未将 LF 除二、未固定等待以吞事件、未删除空行、未事后瞬移光标。

**可判错测试**（`document-diagnostic-blank-row-acceptance-hold-v1.test.ts`）：
- `HOLD-4`：剩余毫秒访问器与窗口一致（0 表示未武装）。
- `HOLD-5`：断言 5 处 `#write` 展示绘制**全部**经 `runContentDocumentPaint(...)` 路由，且**每个**裸调用（`this.renderHeadingDiagnosticMarkers()` / `this.renderActiveHeadingEmphasisForCommittedVisual()` / `this.recommitActiveBlockGapVisual()`）都被包裹（计数对账 `countOf(裸调用) === countOf(包裹行)`）—— 移除任一包裹即 FAIL。

## 5. 门禁结果（真实输出）

| 门禁 | 结果 |
|---|---|
| TYPECHECK (`tsc --noEmit`) | **PASS** |
| TARGETED_TESTS | **PASS**（60/60，含 HOLD-4/5） |
| FULL_TESTS | **PASS**（237 files / 4496 tests） |
| BUILD (`build:dev`，含前置 tsc) | **PASS** |
| ARCHIVE_VERIFY | **PASS**（ENTRY_COUNT=10） |
| DEPLOY_SHA | **PASS**（project == vault == `9146A7B0…`；global 未覆盖 `DE62CB1A…`） |
| RUNTIME_IDENTITY | **PASS**（真实加载 `9146A7B0…`，`loadSource=vault`，`init=1`，PID 48576） |
| EN11_ECHO_WINDOW_GATE | **PENDING_USER_MANUAL**（需用户真实按键复测） |

## 6. 未运行项（不得判 PASS）

- **A 组**（墨章禁用 C0 基线）：NOT_RUN。
- **B 组**（关闭缩进快捷）：NOT_RUN。
- **D 组**（`。。+Enter`）：NOT_RUN（日志中从未执行；需人工复测其「不产生新段落」设计行为是否保持）。
- **C 组复测**（新构建 `9146A7B0…` 下普通 Enter 是否仍出现 `duplicateSplitIndex=2`）：**NOT_RUN** —— 本次加载后尚未有真实 Enter 事件。
- 真实净变化 / 可见空行数量逐组记录：NOT_RUN。

**唯一必需人工动作**：在已加载 `9146A7B0…` 的 Typora 中，对同一文档副本（建议 `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md`，SHA `E0817FC7…`）依次执行 A/B/C/D 四组，每组按一次受信任 Enter；随后运行
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-p0-caret-eof-postrestart.ps1`
即可自动读出 `EN11_GROUP`、`ENTER_DUPLICATE_SPLIT_OBSERVED`、`ECHO_WINDOW_PAINT_HELD` 与 `EN11_ECHO_WINDOW_GATE`。

## 7. 诚实的残余风险

- 本次修复针对**已被真实证据指向**的「回声窗口内插件展示写入」入口；因无法执行 A/B/C/D 真实对照，**因果闭环仍为 HYPOTHESIS + 写入入口 PROVEN**，未经真实 A/B 差分确认。
- 推迟绘制使诊断标记在 Enter 后最多延迟 ~250ms 出现（展示层，不影响计数/Drawer/几何/保存内容）。
- 若复测后 `ENTER_DUPLICATE_SPLIT` 仍 > 0，则残余写入源在本次未覆盖的载体（如 `commitBlankSpaceWarningBand` / `buildBlankRowFragmentEls` 的非 reconcile 调用路径），需按同一模式继续收口。

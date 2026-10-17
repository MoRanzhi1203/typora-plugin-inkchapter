# EOF-R5-ROOT-CAUSE

> 轮次：`sess-p0-eof-visual-sync-r5`（2026-10-12/18）
> 现场构建 `2BAC40036D3676193884FA6A96D0C2C95D012FC5DD85CA8D75F14702B3BB5758`（实际加载，`loadSource=vault`，init=1）
> 证据分级：**OBSERVED**（真实日志/源码）｜**HYPOTHESIS**｜**NOT_RUN**

## 1. 真实链路（源码函数 → 文件）

1. **测量 / 诊断事实**
   - `measureTrailingBlankGeometry()` → `tail.trailingBlankRects`（真实可见空段落）。
   - `reconcileDocumentEndBlankLineDiagnostics()`（`document-utility-overlay-host.ts:15502`）
     - 计算 `renderedVisibleBlankCount` / `excessVisibleRows = max(0, N-1)`
     - 规则：0→缺换行；1→PASS；≥2→多余（`publish=true`）
     - 生成 `eofPublishedDetail`，写 `renderedBlankRowAuthority`
     - **返回可能被改写的 snapshot（detail）**
   - `commitAdmittedSnapshot()`（`:3448`）→ 调用上面的 reconcile，**赋值 `this.snapshot = admitted`**。
2. **诊断发布**
   - `document-diagnostics-authority.ts:366`：内容指纹 = `documentKey|mode|severity:code:targetIdentity#facts`
   - 指纹不变 → `NOOP` 早退（不 `notify()`）。
3. **Drawer**
   - `DRAWER_CONTENT_PATCHED_WITHOUT_RERENDER`（`:21905`）→ 文本可局部更新。
4. **EOF 视觉（关键）**
   - `commitSyntheticEofVisual()`（`:24764`）→ `paintDocEndExcessRows()`（`:24605`）
   - `paintDocEndExcessRows` 内含完整原子替换：signature 变化或 `existingFragments !== excess` → 清理旧 fragment + chip → 重建 + `多余 N 空行`。
   - **但它只被定位/点击事务调用**（`:23529`、`:24454`、`:24507`）。
   - 另一条重绘 `rederiveSyntheticEofVisualOnLayoutChange()`（`:25443`）只在布局失效/几何恢复时调用，且 **要求 carrier 已存在**。

## 2. 首次不一致点（OBSERVED）

`16:49:45.617`（日志）：`sourceRevision=3`、`renderedVisibleBlankCount=2`、`excessVisibleRows=1`，但 `visualFragmentCount=2`。

→ 诊断事实/决策已经变成 excess=1，**DOM 里仍是 2 个片段与「多余 2 空行」**。
→ 随后 `16:49:48.801` 片段变成 `0`（旧集合被清、新的未落地），`16:49:51.600` 点击后才 `eofFragmentSetMatch=true / visualFragmentRebuilt=true`。

**首个失效点**：`commitAdmittedSnapshot` 在被动提交后**没有投递任何 EOF 视觉同步**；视觉更新只存在于定位/点击事务。规范化表述：

- 诊断事实：**已更新**（OBSERVED）
- 视觉任务是否投递：**未投递**（OBSERVED，`dispatchDocumentEndExcessVisualSync` 修复前不存在）
- 旧视觉是否撤销：部分（几何不可得分支会清空）
- 新视觉是否落地：**未落地**（OBSERVED）

## 3. 次生失效点（OBSERVED）

`recomputeSyntheticEofPresentation()`（`:25414`）在 `geo.rect == null` 时**无条件**移除旧 fragment + chip。编辑瞬间几何暂不可得 → “先清空、后不补”，正是 `2 → 0` 的成因。

## 4. 审计字段失真（OBSERVED）

`DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT.diagnosticDiff` 原为 `publish ? 'NONE' : 'REMOVE'` 的**硬编码**，不能据此判断内容是否变化。

## 5. 三条独立问题（结论）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 诊断事实变更 | 正常（reconcile 已算出 visible/excess） |
| 2 | 视觉任务是否投递 | **缺陷**：被动路径未投递 → 已修（`dispatchDocumentEndExcessVisualSync`） |
| 3 | 旧视觉撤销 / 新视觉落地 | **缺陷**：几何暂不可得时清空不补 → 已修（保留集合，等待 settled 重绘） |

## 6. 修复（本轮，源码）

- 新增 `lastEofReconcileFacts`（content/geometry 指纹 + visible/excess/detail/layoutEpoch）。
- `reconcileDocumentEndBlankLineDiagnostics` 计算 **contentFingerprint**（`documentKey|rule|mode|visible|excess|detail`）与 **geometryFingerprint**（`rootIdentity|sourceRevision|layoutEpoch|trailingRowCount`）。
- `commitAdmittedSnapshot` 在 `this.snapshot = admitted` 后调用 `dispatchDocumentEndExcessVisualSync()`：
  - `publish=false` → `EOF_TAIL_RETRACT` 原子清理 label/fill；
  - `excess==null`（不可测）→ **不清空**；
  - `update = UPDATE_CONTENT / UPDATE_GEOMETRY / NOOP`（**不再看 diagnosticDiff**）；
  - 经 `runContentDocumentPaint('EOF_TAIL_VISUAL')` → 单一 `rederiveSyntheticEofVisualOnLayoutChange(excess)` 重绘。
- `rederiveSyntheticEofVisualOnLayoutChange(extraOverride?)` 使用**实时** excess，不再用缓存值。
- `geo.rect == null` 分支：仅当 `liveExcessRows === 0` 才清理；否则保留集合。
- 审计 `diagnosticDiff` 恢复身份/集合语义；新增 `visualUpdate` + 两个 fingerprint 字段。

## 7. 未闭环（NOT_RUN）

- 真实 Typora 下 0/1/2/3 空行的像素与按键验收（需重启载入新构建；当前实例含未保存 WIP，未强制重启）。
- `EOF-16` 原生 Enter 对照禁用墨章。

## 8. 用户真实反馈复核（2026-10-18）

用户报告：「还有多余行时增减行数，**数值会变但作色块不变**；删除到只剩一行时色块消失；文末回车出现两个空行。」

- **数值变 / 色块不变**：与修复前证据完全一致——旧会话 `runtime-sess-1792255754176` 中 `EOF-BLANK-COUNT-AUDIT`（`paintDocEndExcessRows` 内）在决定审计已经 3→2→3 变化时**只触发 3 次且全为 excess=2**，即被动期间**没有任何重绘**。该会话运行的是修复前构建 `2BAC4003…`。
  - 本轮新增 `EOF-04b` 断言：色块 `style.height` 必须随 3→2→4 缩小/增大 → **PASS**（证明修复后的重绘路径同时更新标签与几何）。
  - 真实新构建（`B0A98E09…`）下的该场景仍 **PENDING_USER_MANUAL**（自动化无法产生受信任键入）。
- **只剩一行时色块消失**：这是 `publish=false → EOF_TAIL_RETRACT` 的预期行为（本轮保留并补了零残留断言）。
- **文末回车变两个空行**：属 EN-11（历史问题，非 R5 范围）。已证实的结论：不是插件写入触发（`pluginStructuralWriteCount=0`），而是 Typora 尾块再归一化；本轮**未改动 Enter 逻辑**，状态仍为 `PENDING_USER_MANUAL`。

## 9. 真实验收尝试：审计字段缺失的前置原因（OBSERVED，2026-10-18）

尝试读取 `DOCUMENT-DIAGNOSTIC-EOF-VISUAL-SYNC` / `EOF-BLANK-COUNT-AUDIT` / `EOF-BLANK-DECISION-AUDIT` 时全部为 **0 条**。会话 `runtime-sess-1792258568994`（构建 `B0A98E09…`）：

- 文件停在 110 行 / 73458 B，`MTIME=01:38:55`；末条为 `FORENSIC-SINK-FLUSH queuedCount=109 writtenCount=109 droppedCount=0`。
- 之后 Typora 标题出现 `EOF-R5-Verify-3blanks.md•`（**确有编辑**），但审计**再无任何事件**（无 `@edit`、无 recompute、无 EOF）。
- 同会话 `17:38:54` 的 `DOCUMENT-UTILITY-ACTIVE-DOCUMENT-RECONCILE` 明确报告：
  `presenceState=EMPTY`、`activeLeafPath=""`、`documentEpoch=0`、`canonicalFrameDocumentKey=null`、`readinessState=INACTIVE`。

**结论**：插件在「空标签关闭（`DOCUMENT-UTILITY-EMPTY-TAB-CLOSE-INVARIANT`）+ 通过第二次 CLI 调用打开文件」这一序列后**丢失了活动文档绑定**，对当前文档处于 INACTIVE；因此 R5 的 EOF 链路根本没有运行。

**判定：EOF 视觉同步 = NOT_RUN（不是 PASS，也不是 FAIL）**——缺少可判定的真实字段。

**新增待修缺陷（非 R5 引入）**：`EMPTY_TAB_CLOSE` 后未重新绑定真实文档（`presenceState` 永为 `EMPTY`）。

**恢复验收的最小步骤**：完全退出 Typora → 重新打开 `test/vault` → **在 Typora 内**打开 `runtime/EOF-R5-Verify-3blanks.md`（不要用第二个 `Typora.exe <file>` 进程）→ 确认审计出现新的 `ACTIVE-DOCUMENT-RECONCILE`（`presenceState=PRESENT`）后再编辑。

## 10. 恢复后的真实字段（OBSERVED，2026-10-18 01:48，构建 `B0A98E09…`）

恢复方式：vault 启动 + 第二进程转发文件（无空标签竞争）→ 绑定成功：
`presenceState=ACTIVE`、`activeLeafPath=…/runtime/EOF-R5-Verify-3blanks.md`、`documentEpoch=2`、`canonicalFrameState=READY`。

真实按键（`Ctrl+End` → `Enter`，OS 级）：

- `ENTER-ADMISSION-AUDIT`：`key="Enter", code="", isTrusted=true, decision=REJECT_NON_ENTER`（SendKeys 产生的 Enter 无 `code`，插件按非标准 Enter 拒绝，**未进入 EN-11 路径**）。
- 文档仍变化（标题 `•`），`DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT`：

```json
{"renderedVisibleBlankCount":4,"excessVisibleRows":3,
 "publishedDetail":"文末有 4 个可见空行，建议保留 1 个。",
 "diagnosticDiff":"NONE","visualUpdate":"UPDATE_CONTENT",
 "contentFingerprint":"runtime/EOF-R5-Verify-3blanks.md|DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE|wysiwyg|4|3|文末有 4 个可见空行，建议保留 1 个。",
 "geometryFingerprint":"editorRoot#1|2|6|4",
 "visualFragmentCount":0,"publish":true}
```

结论：
- **诊断链路正确**：`visualUpdate=UPDATE_CONTENT` 已按内容指纹触发；`diagnosticDiff=NONE` 不再阻断。
- **视觉仍无法判定**：`visualFragmentCount=0` —— 该文档从未点击过 EOF 诊断，`locateDocEndCarrier` 不存在，被动同步按设计不新建第二套几何权威，因此没有 label/fill 可更新。**EOF 视觉同步 = NOT_RUN（缺 carrier）**。
- **EN-11 旁证**：本次 Enter 被插件明确 `REJECT_NON_ENTER`（事件链未介入），但可见空行仍 `2 → 4`，源码 LF `3 → 7`（+4）。即该次 +2 段落完全由 Typora 产生，**不是插件干预所致**；仍需真实鼠标+键盘的 C0/C4 才能定论。

## 11. 闭环证据（OBSERVED，2026-10-18 01:51，构建 `B0A98E09…`，真实点击 + 真实回车/退格）

用户先点击 Drawer「文档末尾空行过多」建立 carrier，随后真实 `Enter` / `Backspace`。同一会话 `runtime-sess-1792259260353`：

### 11.1 `DOCUMENT-DIAGNOSTIC-EOF-VISUAL-SYNC`（被动投递，5 条）

| 时间 | update | visible | excess | contentFingerprint 尾段 | geometryFingerprint |
|---|---|---|---|---|---|
| 17:50:44.713 | `UPDATE_CONTENT` | 3 | 2 | `…\|wysiwyg\|3\|2\|文末有 3 个…` | `editorRoot#1\|3\|9\|3` |
| 17:50:45.217 | `UPDATE_CONTENT` | 2 | 1 | `…\|wysiwyg\|2\|1\|文末有 2 个…` | `editorRoot#1\|4\|10\|2` |
| 17:50:45.619 | `RETRACT` | 1 | 0 | `…\|wysiwyg\|1\|0\|文末有 1 个…` | `editorRoot#1\|5\|11\|1` |
| 17:50:58.998 | `UPDATE_CONTENT` | 2 | 1 | `…\|wysiwyg\|2\|1\|文末有 2 个…` | `editorRoot#1\|12\|19\|2` |
| 17:51:00.961 | `NOOP` | 2 | 1 | 同上（幂等） | 同上 |

→ **无一次 `NOOP` 漏掉真实变化**；最后一次 `NOOP` 是同指纹的幂等去重。

### 11.2 `DOCUMENT-DIAGNOSTIC-EOF-BLANK-COUNT-AUDIT`（真实重绘，5 条）

| 时间 | excess | expected | actual | match | rebuilt | 旧片段清理 |
|---|---|---|---|---|---|---|
| 17:50:42.961 | 3 | 3 | 3 | true | true | 0 |
| 17:50:44.715 | 2 | 2 | 2 | true | true | **4** |
| 17:50:45.218 | 1 | 1 | 1 | true | true | **3** |
| 17:50:54.701 | 2 | 2 | 2 | true | true | 0 |
| 17:50:58.999 | 1 | 1 | 1 | true | true | **3** |

标签文本与片段集合同处一个重建块（`chip.textContent = formatDocumentEndTrailingBlankChipText(excess)`，紧邻 fragment 重建），`visualFragmentRebuilt=true` 证明该块确实执行；`eofExpectedExcessFragmentCount === eofActualExcessFragmentCount` 证明覆盖集合与数值一致。

### 11.3 硬门禁（真实 Runtime）

```
EOF_DIAGNOSTIC_CONTENT_STALE_COUNT            = 0   [5/5 变化均有 UPDATE_CONTENT/RETRACT]
EOF_LABEL_EXCESS_COUNT_MISMATCH               = 0   [3/2/1/2/1 每次重建，chip 与 excess 同源]
EOF_EXCESS_ROW_TARGET_SET_MISMATCH            = 0   [expected==actual 5/5]
EOF_STALE_VISUAL_OWNER_COUNT                  = 0   [cleanup 4/3/3，重建后无残留]
EOF_UPDATED_WITHOUT_VISUAL_INVALIDATION_COUNT = 0   [每次内容变化均有 VISUAL-SYNC]
EOF_REQUIRED_BLANK_ROW_PAINTED_COUNT          = 0   [requiredRows=1，只涂 excess 行]
EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT          = NOT_RUN（单文档会话，未切文档）
EOF_WRITE_EDITOR_CONTENT_MUTATION_COUNT       = 0   [仅 presentation 子节点；未改正文]
```

**结论：用户报告的「数值变、色块不变」在 `B0A98E09…` 上已闭环（audit 级 PASS）。**

## 12. 仍开放

- EN-11（一次 Enter 产生两个空行）：需真实鼠标 + 标准 `code=Enter` 的 C0/C4 配对；本次 OS 按键 `code=""` 被拒，不能作为 EN-11 判定。
- `EOF_CROSS_DOCUMENT` 与像素目检：NOT_RUN / 建议目视一眼标签与色块。

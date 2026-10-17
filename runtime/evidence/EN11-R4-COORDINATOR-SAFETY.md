# EN11-R4-COORDINATOR-SAFETY

> 轮次：`sess-p0-en11-r4`（2026-10-12）｜**先读源码后判定**（提示词 §0.5）。

## 1. B1 — 等待预算耗尽不得越过内容安全门（**证实的真实缺陷，已修**）

**修复前（R3 实际源码）**：`schedule()` 在 `heldFrames >= MAX_HELD_FRAMES` 时执行
`if (held) { HOLD_RETRY_BUDGET_EXHAUSTED++ } ... this.flushNow()` → **hold 仍 active 时强制写入 `#write`**。

**修复（R4）**：预算耗尽且 `heldPredicate()` 仍为 true → **BLOCK**：
- `counters.PAINT_BLOCKED_UNSTABLE++`、`state='BLOCKED'`、`blocked=true`，**保留全部 dirty intent**，停止主动循环（不再调度 rAF/timer）；
- 恢复只能来自**事件驱动的稳定信号**：`resumeOnStable(reason)`（已在 `invalidateDiagnosticVisualGeometry` 中接线，scroll/wheel/pointermove/mousemove 不触发）或一次新的 `request()`；
- fail-open 仅限**抛错的谓词/绘制闭包**，**不**适用于内容写入安全规则。

**红→绿**：`T10` 断言预算耗尽后 `painted===0`、`PAINT_BLOCKED_UNSTABLE>0`、`isBlocked()===true`、`getPendingCount()===1`（R3 版本此断言会 FAIL，因为 R3 会绘制）；`T12` 断言 `resumeOnStable` 后绘制一次。

## 2. B2 — 真实身份与 revision 门禁（**证实的真实缺陷，已修**）

**修复前**：`overlay-host` 的 `runContentDocumentPaint` 传 `editorRootId: null`；`sourceRevision/layoutEpoch` 仅记录不校验。

**修复（R4）**：
- 新增 `editorRootIdentity = new WeakMap<Element, number>()` + 单调序号 → `editorRootIdOf(el)` 返回 `editorRoot#<n>`；**同一 `DIV#write` 字符串但不同对象必然得到不同 id** → 跨根替换必然失效（`ROOT_CHANGED_BEFORE_PAINT` / `ROOT_MISMATCH_ON_REQUEST` → `DROP_STALE`）。
- `runContentDocumentPaint` / 协调器 identity 读取器均传入真实 root id（不再 `null`）。
- 新增第 4 构造参数 `currentRevision()`：commit 前校验 live `sourceRevision/layoutEpoch`；
  - 可用且前进 → `REVISION_ADVANCED_BEFORE_PAINT` + 审计 `REDERIVED_FROM_LIVE`，**按 live 绘制**（闭包自身重求导，绝不重放旧 DOM）；
  - 不可得 → `REVISION_UNKNOWN_AT_PAINT`，**禁止硬编码匹配**。
- 生命周期：`request/rebind/cancelAll/dispose/bindDocument(DOCUMENT_SWITCH)` 均取消待处理 intent 与已安排的 rAF/timer。

**红→绿**：`T13`（root 对象替换 → `DROPPED_STALE=1`）、`T14`（rev 前进 → 仍绘制 + `REVISION_ADVANCED_BEFORE_PAINT=1`；rev 缺失 → `REVISION_UNKNOWN_AT_PAINT=1`）。

## 3. B3 — 调度正确性与不可见状态（**已完善**）

- 显式状态流 `IDLE → REQUESTED → (PARKED | BLOCKED) → COMMITTED | DROP_STALE`（`getState()` 可读）。
- 文档不可见（`document.visibilityState==='hidden'`）→ **`PARKED_INACTIVE`**，**不烧帧、不绘制**（`DEFERRED_BY_ECHO_WINDOW` 保持 0），待 `resumeOnStable` 后重试。
- 同 `(documentKey, 域)` 仅一个最新 intent（latest-wins 合并）；rAF 有界（`MAX_HELD_FRAMES`），无无界递归、无写-观察反馈环、无常驻 observer。
- **红→绿**：`T15`（hidden → `PARKED_INACTIVE>0` 且 `DEFERRED_BY_ECHO_WINDOW===0`，painted=0）。

## 4. B4 — `#write` 写入入口全量枚举（实际源码，非“仅 7 处”）

`host = resolveBusinessContentRoot()`（`#write`）；`this.root`/`toolbar`/`drawer`/`problemsControl` 位于 `document.body`（**在 `#write` 之外**）。

| # | 入口（行） | 根 | 可被 Enter 窗口触达 | 协调器托管 | 备注 |
|---|---|---|---|---|---|
| 1 | `ensureLocateDocumentLayer` → `host.appendChild(layer)` (4998/4999) | `#write` | 是（经 `ensureHeadingMarkerLayer` 于绘制内延迟创建） | **是**（其调用者均在协调器托管闭包内） | 已 `stampCaretInertPresentation` |
| 2 | `ensureHeadingMarkerLayer` → `docLayer.appendChild(layer)` (10538) | `#write` | 是 | **是**（由 #4/#5/#6 闭包内调用） | |
| 3 | `renderHeadingDiagnosticMarkers` 系列 (7830/8046/8047/8178/11282/11287/11465/11477/11557) | `#write` | 是 | **是**（`HEADING_MARKERS`/`REFLOOR_MARKERS`/`HEADING_TEXT_CHANGED_MARKERS`） | |
| 4 | `renderActiveHeadingEmphasisForCommittedVisual` 系列 | `#write` | 是 | **是**（`ACTIVE_HEADING_EMPHASIS`/`REFLOOR_ACTIVE_EMPHASIS`/`PASSIVE_ACTIVE_EMPHASIS`/`HEADING_TEXT_CHANGED_ACTIVE_EMPHASIS`） | |
| 5 | `commitBlockGapVisual` → `container.appendChild(chip)`+`layer.appendChild(container)` (14121/14123) | `#write` | 是（`recommitActiveBlockGapVisual`，仅 ACTIVE 态） | **是**（`ACTIVE_BLOCK_GAP_RECOMMIT`） | 另有点击路径调用（非 Enter） |
| 6 | `buildBlankRowFragmentEls` 的宿主 append (13608) | `#write` | 是（经 #5） | 间接（随 #5） | 工厂本身不写 |
| 7 | `commitDocumentSpaceCarrier` → `layer.appendChild(clone)` (5278/5279) | `#write` | **否**（主动定位/点击） | 否 | 点击驱动 |
| 8 | inline 片段 (5327) | `#write` | **否**（主动定位） | 否 | 点击驱动 |
| 9 | `carrier.appendChild(cue)` (12650) | `#write` | **否**（定位/题注提交） | 否 | 点击驱动 |
| 10 | `runBlankRowPaintLayerAcceptanceDryRun` (15848/15856) | `#write` | 是 | **是**（但生产 **hard-off**：`blankRowAcceptanceDryRunEnabled=false` + hold 门） | 验收探针 |
| 11 | 插件 chrome：`toolbar/problemsControl/lock/drawer/navigator` (18598/20017/20027/20029/20074…) | `document.body` | 不适用 | 不适用 | **在 `#write` 之外，不参与序列化** |

**诚实结论**：Enter 窗口内**可触达**的 `#write` 写入入口 = 1–6、10，且**全部已由协调器/硬关闭覆盖**；7–9 为**点击/定位驱动**（Enter 不触发）。但这**不等于**“零写入”：受限 tracer 的 `structuralRecordCount=0` 不足以证明全路径无写入（提示词 §B4 明示）。

## 5. 未托管入口的风险处置

- 7–9 不在 Enter 路径内，因此**不在本轮扩围**（提示词禁止“盲目扩增全域延时保护”）。
- 若真实复现证明其可被 Enter 触达，应按同一模式（`runContentDocumentPaint`）收口，或按 §B5.4 **优先迁出 `#write`**。

## 6. 门禁

`COORDINATOR_HOLD_BUDGET_GATE=PASS`（T10/T12 红→绿）
`COORDINATOR_STALE_INTENT_GATE=PASS`（T5/T6/T7/T13 + `cancelAll`/`dispose`）

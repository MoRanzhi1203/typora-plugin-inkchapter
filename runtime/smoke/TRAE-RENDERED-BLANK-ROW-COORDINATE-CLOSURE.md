# TRAE：EXCESSIVE_INTERNAL_BLANK_LINES 坐标空间统一与 Rendered Blank Row 激活闭环

> 项目：`typora-plugin-inkchapter`
>
> 执行模式：**一次性完整执行**
>
> 当前 Fixture：`test/vault/Document-Diagnostics-Code-Integrity-Test.md`
>
> 本轮目标：修复 `EXCESSIVE_INTERNAL_BLANK_LINES` 已正确识别 3 个真实可见空白行，但点击后仍因 `GEOMETRY_INVALID → ZERO_PAINTED_RECT → rollback → IDLE` 无法保持激活的问题。

## 1. 已确认事实，不得回退

当前点击本身成功：

```text
ACTIVATE
IDLE → ACTIVE
PUBLISH_FIRST_OWNER
secondUserClickRequired=false
```

因此本轮禁止继续排查 click handler / sameTarget / state classifier。

当前计数已经正确：

```text
sourceBlankLineCount=7
renderedBlankRowCount=3
renderedBlankRowRectCount=3
displayedBlankRowCount=3
warningDecision=WARNING
authority=RENDERED_DOM_BLANK_ROWS_V1
```

Typora 真实 DOM 已证明存在三个独立空白编辑行，均为：

```text
p.md-end-block.md-p
contentEditable=true
textLength=0
candidateBlankRow=true
```

三个 Viewport Rect：

```text
row1: top=378.3125   bottom=403.9125
row2: top=416.71249  bottom=442.31249
row3: top=455.11252  bottom=480.71252
```

Previous / Next physical binding 也已正确：

```text
previous = block:code:2 → PRE.md-fences
identity=RESOLVED
physical=VERIFIED
binding=BOUND

next = P.md-end-block.md-p
identity=RESOLVED
physical=VERIFIED
binding=BOUND
```

本轮禁止重新修改 source/rendered count 语义、warning threshold 或 canonical boundary binding。

---

## 2. 当前 P0 根因：Coordinate Space 混用

真实 DOM sourceRect 属于 Viewport Space：

```text
previous top=324.675 bottom=363.313
next top=493.513 bottom=519.113
blank rows top=378.313 ... 480.713
```

但 legacy PresentationExtent / synthetic gap 已经是另一套 Document / Document-local 坐标：

```text
previous extent bottom=967.313
next extent top=1097.513
```

纵向差：

```text
967.312519 - 363.312519 = 604
1097.512512 - 493.512512 = 604
```

说明旧 extent 发生了约 `+604px` 的 document-space 转换，而 RenderedBlankRow Rect 仍保留 Viewport 坐标。

最硬证据：

```text
row union center ≈ (378.3125 + 480.7125) / 2
                 ≈ 429.5125

当前 scrollTargetCenterY=-174.48749

429.5125 - 604 ≈ -174.4875
```

这说明 blank-row rect 已经是 Viewport Rect，却又被当成 document rect 再减了一次 offset，发生 double conversion。

最终：

```text
renderedBlankRowCount=3
markerFragmentCount=0
fillCarrierRegistered=false
reason=GEOMETRY_INVALID
```

---

## 3. 本轮总架构

当：

```text
renderedBlankRowDecision=VERIFIED
renderedBlankRowCount>0
```

时必须走唯一主路径：

```text
Rendered Blank Row DOM
→ fresh getBoundingClientRect()
→ VIEWPORT rects
→ ONE canonical coordinate conversion
→ DOCUMENT_LOCAL fragment rects
→ fragment[0..N-1]
→ fragment union
   ├─ scroll target
   └─ visual target
→ generic document-space carrier
→ generic active lease
→ ACTIVE
```

Legacy：

```text
Previous PresentationExtent
Next PresentationExtent
caption union
previous.bottom → next.top synthetic gap
```

只允许在：

```text
RenderedBlankRowResolver 无法得到真实 row DOM
```

时作为 fallback。

当前 Fixture 已 VERIFIED，禁止进入 fallback。

---

## 4. 建立显式 Coordinate Space 类型

建议：

```ts
type CoordinateSpace =
  | 'VIEWPORT'
  | 'DOCUMENT'
  | 'DOCUMENT_LOCAL'

interface SpatialRect {
  rect: RectLike
  coordinateSpace: CoordinateSpace
  layoutEpoch: number
  source:
    | 'DOM_CLIENT_RECT'
    | 'RENDERED_BLANK_ROW'
    | 'PRESENTATION_EXTENT'
    | 'DOCUMENT_SPACE_CARRIER'
}
```

所有跨模块 Rect 必须携带：

```text
coordinateSpace
layoutEpoch
```

禁止靠调用位置猜坐标系。

---

## 5. 只能存在一个 canonical conversion point

统一实现/复用：

```ts
viewportRectToDocumentLocal(...)
```

只负责：

```text
VIEWPORT → DOCUMENT_LOCAL
```

每个 fragment 转换次数必须恰好为 1。

如果输入已经是 `DOCUMENT_LOCAL` 又再次进入 converter：

```text
development hard fail
runtime audit FAIL
```

禁止 BlankGap 业务层散落：

```text
+scrollTop
-scrollTop
+604
-604
```

---

## 6. RenderedBlankRows 直接成为 PRIMARY Geometry Authority

明确分流：

```ts
if (
  renderedRows.decision === 'VERIFIED' &&
  renderedRows.rows.length > 0
) {
  return buildFromRenderedBlankRows(renderedRows)
}

return buildSyntheticGapFallback(...)
```

PRIMARY path 禁止通过：

```text
resolvePresentationExtent(previous)
resolvePresentationExtent(next)
caption owner union
synthetic block-gap rect
```

二次证明 blank-row geometry。

Previous / Next 只负责：

```text
identity guard
order guard
boundary containment guard
```

---

## 7. 三个真实 blank rows → 三个 fragments

当前 Fixture：

```text
renderedBlankRowCount=3
```

必须：

```text
markerFragmentCount=3
```

每个真实 row：

```text
HTMLElement
→ getBoundingClientRect()
→ VIEWPORT SpatialRect
→ viewportRectToDocumentLocal()
→ DOCUMENT_LOCAL SpatialRect
→ one FILL_ONLY fragment
```

禁止：

```text
renderedBlankRowCount=3
markerFragmentCount=0
```

---

## 8. 不再把整个 previous.bottom → next.top 涂色

三个 fragment 分别覆盖三个真实空 paragraph。

要求：

```text
fragmentCoverageRatio >= 0.98
fragmentIntersectsPreviousBoundary=false
fragmentIntersectsNextBoundary=false
fragmentIntersectsCaption=false
```

继续使用：

```text
FILL_ONLY
border=0
outline=0
shadow=0
rail=0
```

---

## 9. Scroll Authority 也必须切换

当前日志虽然记录：

```text
scrollTargetKind=rendered-blank-gap
```

但 Generic Locator 仍然：

```text
primaryAnchor=source-line
resolvedNodeKind=p
scrollAnchorKind=p
```

最终必须区分：

```text
transportAnchorKind
semanticScrollTargetKind
```

允许 paragraph 只作为粗定位 transport，但最终：

```text
semanticTargetKind=rendered-blank-gap
visualTargetKind=rendered-blank-gap
scrollTargetKind=rendered-blank-gap
```

Scroll Center 必须来自：

```text
converted fragment union center
```

---

## 10. 当前已可见时也必须完整构建 geometry

即使：

```text
targetInitiallyVisible=true
automaticScrollRequired=false
PLACEMENT_FAST_PATH_NO_SCROLL_WRITE
```

仍必须：

```text
fresh rows
→ fresh DOMRects
→ canonical conversion
→ fragments
→ carrier
```

不得因为“不滚动”而跳过 visual geometry build。

---

## 11. Post-scroll 必须重新 resolve / remeasure

目标不在 viewport 时：

```text
provisional rows
→ provisional union
→ scroll
→ settle
→ re-resolve previous
→ re-resolve next
→ re-resolve blank rows
→ fresh getBoundingClientRect()
→ one coordinate conversion
→ rebuild final fragments
→ commit
```

滚动前 Rect 不得直接用于最终 Paint。

---

## 12. `presentationBuiltAfterScroll` 统一语义

当前存在：

```text
TARGET-AUDIT: presentationBuiltAfterScroll=true
markerFragmentCount=0
decision=MISSING
```

但 One-Click 又：

```text
presentationBuiltAfterScroll=false
```

必须统一。

只有以下全部满足：

```text
fresh physical boundaries
fresh rendered row rects
converted fragmentCount>0
carrierRegistered=true
layoutEpoch current
```

才允许：

```text
presentationBuiltAfterScroll=true
```

---

## 13. `visualClosureScoped` 必须使用唯一事实对象

当前存在：

```text
BLOCK-GAP-TARGET-AUDIT visualClosureScoped=true
```

但真正 Closure：

```text
visualClosureScoped=false
blockGapVisualClosureScoped=false
```

必须建立一个唯一：

```text
VisualClosureScopeResult
```

所有 audit 都从同一对象读取。

成功时：

```text
visualClosureScoped=true
blockGapVisualClosureScoped=true
currentDiagnosticActiveVisualCount=1
markerFragmentCount=3
```

3 fragments 仍只属于 1 个 semantic active visual owner。

---

## 14. 修复 mixed-coordinate Gate 漏检

当前明明发生坐标空间混用，但：

```text
mixedCoordinateSpace=0
```

说明现有 Gate 未覆盖 RenderedBlankRow path。

新增：

```text
INTERNAL_BLANK_LINE_DOUBLE_COORDINATE_CONVERSION_COUNT=0
INTERNAL_BLANK_LINE_UNKNOWN_COORDINATE_SPACE_COUNT=0
INTERNAL_BLANK_LINE_MIXED_COORDINATE_SPACE_COMPARE_COUNT=0
```

任何：

```text
VIEWPORT Rect
直接与
DOCUMENT_LOCAL Rect
```

比较，必须计数并 FAIL。

---

## 15. 新增 Coordinate Audit

新增：

```text
DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-GEOMETRY-AUDIT
```

至少输出：

```text
diagnosticId
targetKey
layoutEpoch

renderedBlankRowCount

rows=[
  {
    index,
    inputRect,
    inputCoordinateSpace,
    outputRect,
    outputCoordinateSpace,
    conversionCount
  }
]

fragmentCount
fragmentUnionRect
fragmentUnionCoordinateSpace

scrollTargetKind
scrollTargetRect
scrollTargetCoordinateSpace
scrollTargetCenterY

legacySyntheticGapConsulted
legacySyntheticGapUsed

mixedCoordinateComparisonDetected
doubleConversionDetected

decision
reason
```

---

## 16. 数学 Regression 必须加入

真实 Runtime：

```text
viewport row union:
top=378.3125
bottom=480.7125
center≈429.5125
```

当前错误：

```text
scrollTargetCenterY≈-174.4875
```

新增 test：

```text
VIEWPORT_CENTER_429_DOUBLE_SUBTRACT_604_MUST_FAIL
```

禁止通过特殊判断修：

```ts
if (centerY < 0) centerY += 604
```

必须从 coordinate model 修正。

---

## 17. Round-trip Coordinate Test

测试：

```text
VIEWPORT
→ DOCUMENT_LOCAL
→ VIEWPORT
```

误差：

```text
<=1px
```

每个 Blank Row：

```text
conversionCount=1
```

---

## 18. Panel / Navigator Gate 改成 current transaction scoped

当前 Closure 还出现：

```text
FINAL_COMMIT_WITH_PANEL_INTERSECTION_COUNT
FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT
```

但本次：

```text
visualFragmentCount=0
```

需要区分：

```text
historical coverage counters
current transaction fatal counters
```

历史 counter 不得污染当前 transaction。

Fragment 成功生成后，使用同一 `DOCUMENT_LOCAL` space 做：

```text
drawer safe clip
toolbar safe clip
navigator safe clip
```

Clip 只能裁剪，不得再次改变 Coordinate Space。

---

## 19. 本轮 P0 / P1 顺序

严格按：

```text
P0-1 CoordinateSpace type
P0-2 one canonical converter
P0-3 RenderedBlankRow primary fragment path
P0-4 VERIFIED path 移除 legacy extent/synthetic gap dependency
P0-5 fragment union 成为真实 scroll target
P0-6 first-click active + ZERO_PAINTED_RECT=0

P1-1 presentationBuiltAfterScroll truth
P1-2 visualClosureScoped single authority
P1-3 mixed-coordinate Gate coverage
P1-4 current-transaction panel/nav gate scoping
P1-5 dynamic 3→2 / 2→3
```

---

## 20. 禁止的修法

禁止：

```text
重新修改 source/rendered count
修改 warning threshold
重新重构 canonical boundary binding
继续调 previousExtent/gapTop 迁就 row rect
增加 visual retry 次数
硬编码 +604 / -604
负数 center 补偿
针对当前 Fixture 特判
新增 BlankRow 专属 lifecycle
```

禁止新增：

```text
BlankRowPersistentCarrier
BlankRowAtomicHandoff
BlankRowSurfaceAuthorityV2
BlankRowCompositingAuthority
```

继续复用 existing generic carrier / active lease。

---

## 21. Targeted Tests

至少加入：

```text
rendered rows VERIFIED → synthetic gap not called
3 VIEWPORT rows → 3 DOCUMENT_LOCAL fragments
each fragment conversionCount=1
double conversion → FAIL
mixed-space compare → FAIL
viewport center≈429.5125 不得变成 -174.4875
markerFragmentCount=renderedBlankRowCount
fragment union center used as scroll target
presentationBuiltAfterScroll requires fragments/carrier
visualClosureScoped audits share same fact
historical navigator counter does not poison clean transaction
```

---

## 22. Real Runtime Gates

当前 Fixture 必须：

```text
SOURCE_BLANK_LINE_COUNT=7
RENDERED_BLANK_ROW_COUNT=3
DISPLAYED_BLANK_ROW_COUNT=3

PREVIOUS_PHYSICAL_VERIFIED=true
NEXT_PHYSICAL_VERIFIED=true
PREVIOUS_RESOLVED_TAG=pre
NEXT_RESOLVED_TAG=p

RENDERED_BLANK_ROW_RECT_COUNT=3

RENDERED_BLANK_ROW_PRIMARY_GEOMETRY_USED_COUNT>=1
SYNTHETIC_GAP_USED_WHILE_RENDERED_ROWS_VERIFIED_COUNT=0

ROW_FRAGMENT_COORDINATE_CONVERSION_COUNT=3
DOUBLE_COORDINATE_CONVERSION_COUNT=0
MIXED_COORDINATE_SPACE_COMPARE_COUNT=0

MARKER_FRAGMENT_COUNT=3
CURRENT_DIAGNOSTIC_ACTIVE_VISUAL_COUNT=1

SCROLL_TARGET_KIND=rendered-blank-gap
NEGATIVE_RENDERED_GAP_CENTER_COUNT=0

FIRST_CLICK_ACTIVE_COUNT>=1
SECOND_CLICK_REQUIRED_COUNT=0
ZERO_PAINTED_RECT_COUNT=0

PRESENTATION_BUILT_WITH_ZERO_FRAGMENT_COUNT=0

VISUAL_CLOSURE_SCOPED=true
BLOCK_GAP_VISUAL_CLOSURE_SCOPED=true

STALE_VISUAL_COUNT=0
```

---

## 23. Runtime Matrix

### R1 第一次点击

```text
IDLE
→ ACTIVE
→ 3 fragments
→ carrier
→ lease
→ remains ACTIVE
```

禁止：

```text
ACTIVE
→ GEOMETRY_INVALID
→ ZERO_PAINTED_RECT
→ rollback
→ IDLE
```

### R2 视觉位置

3 fragments 分别对齐三个真实空 paragraph。

不得覆盖：

```text
previous code
code caption
next paragraph
```

### R3 再次点击

```text
ACTIVE → IDLE
fragment count=0
lease removed
```

### R4 再点

```text
FIRST CLICK → ACTIVE
```

### R5 3→2

```text
warning removed
fragments removed
lease removed
no stale visual
```

### R6 2→3

```text
warning returns
display=3
first click active
fragment count=3
```

### R7 不在 viewport 的长文档

必须：

```text
scrollTargetKind=rendered-blank-gap
scroll center=fragment union
post-scroll re-resolve
post-scroll remeasure
post-scroll reconvert
post-scroll repaint
```

---

## 24. 全量 Gate 顺序

```text
1. targeted coordinate tests
2. rendered blank-row tests
3. block-gap visual tests
4. one-click closure tests
5. typecheck
6. full tests
7. build
8. production-path audit
9. deploy
10. deploy SHA / identity
11. real Runtime R1-R7
```

Runtime 未真实通过时禁止：

```text
FINAL_DECISION=PASS
```

只能：

```text
FINAL_DECISION=PENDING_USER_MANUAL_RUNTIME
```

或：

```text
FINAL_DECISION=FAIL
```

---

## 25. Production Path Audit

确认 VERIFIED RenderedBlankRow path 不再依赖：

```text
PresentationExtent(previous)
PresentationExtent(next)
caption union
synthetic block gap
```

来决定 marker geometry。

确认不存在散落：

```text
+scrollTop
-scrollTop
+604
-604
```

确认所有跨空间比较都先统一 coordinate space。

---

## 26. 最终报告模板

```text
=== RENDERED BLANK ROW COORDINATE CLOSURE ===

ROOT_CAUSE =
  ...

SOURCE_BLANK_LINE_COUNT =
  ...

RENDERED_BLANK_ROW_COUNT =
  ...

DISPLAYED_BLANK_ROW_COUNT =
  ...

PREVIOUS_PHYSICAL_BINDING =
  ...

NEXT_PHYSICAL_BINDING =
  ...

PRIMARY_GEOMETRY_AUTHORITY =
  ...

LEGACY_SYNTHETIC_GAP_USED_WHILE_VERIFIED =
  true / false

INPUT_COORDINATE_SPACE =
  ...

OUTPUT_COORDINATE_SPACE =
  ...

DOUBLE_COORDINATE_CONVERSION_COUNT =
  ...

MIXED_COORDINATE_COMPARE_COUNT =
  ...

MARKER_FRAGMENT_COUNT =
  ...

SCROLL_TARGET_KIND =
  ...

SCROLL_TARGET_CENTER_Y =
  ...

PRESENTATION_BUILT_AFTER_SCROLL =
  ...

VISUAL_CLOSURE_SCOPED =
  ...

FIRST_CLICK_ACTIVE =
  PASS / FAIL / PENDING_RUNTIME

ZERO_PAINTED_RECT_COUNT =
  ...

DYNAMIC_3_TO_2 =
  PASS / FAIL / PENDING_RUNTIME

DYNAMIC_2_TO_3 =
  PASS / FAIL / PENDING_RUNTIME

TARGETED_TESTS =
  PASS / FAIL

TYPECHECK =
  PASS / FAIL

FULL_TESTS =
  PASS / FAIL

BUILD =
  PASS / FAIL

PRODUCTION_PATH_AUDIT =
  PASS / FAIL

DEPLOY_SHA_GATE =
  PASS / FAIL

RUNTIME_IDENTITY =
  PASS / FAIL

REAL_RUNTIME_MATRIX =
  PASS / FAIL / PENDING_USER_MANUAL_RUNTIME

FINAL_DECISION =
  PASS / FAIL / PENDING_USER_MANUAL_RUNTIME
```

---

## 27. 最终 PASS 条件

全部满足：

1. `source=7 / rendered=3 / displayed=3` 保持；
2. previous/next physical VERIFIED；
3. VERIFIED rows 成为唯一主 Geometry Authority；
4. 当前 Fixture 不使用 synthetic gap；
5. 所有 Rect 显式标注 space；
6. 每个 fragment 只 conversion 一次；
7. double conversion=0；
8. mixed-space compare=0；
9. 不再出现 `scrollTargetCenterY=-174.487...`；
10. markerFragmentCount=3；
11. 三个 fragment 与三个真实空 paragraph 对齐；
12. previous/next/caption 不误染；
13. scrollTargetKind=rendered-blank-gap；
14. first click 保持 ACTIVE；
15. second click required=0；
16. ZERO_PAINTED_RECT=0；
17. presentationBuiltAfterScroll 只在真实 build 成功时为 true；
18. visualClosureScoped 单一事实一致；
19. 3→2 实时消失；
20. 2→3 实时恢复；
21. current transaction panel/nav gate 不受历史 counter 污染；
22. targeted/typecheck/full/build PASS；
23. deploy SHA / runtime identity PASS；
24. 真实 Runtime R1-R7 PASS。

## 28. 核心原则

不要继续修：

```text
怎样让 synthetic gap 更像三行空白
```

而是：

```text
Typora 已经给出了三个真实 Blank Row DOM。

三个真实 Viewport Rect
→ 统一转换一次
→ 三个 Document-local fragments
→ fragment union 作为 scroll target
→ generic carrier
→ ACTIVE
```

必须移除这条错误依赖：

```text
VERIFIED RenderedBlankRows
仍需要 legacy PresentationExtent / synthetic BlockGap
二次证明之后才能 Paint
```

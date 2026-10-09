# TRAE：连续空行过多（EXCESSIVE_INTERNAL_BLANK_LINES）定位闭环修复

> 项目：`typora-plugin-inkchapter`
>
> 本轮模式：**一次性完整执行**
>
> 核心目标：修复“连续空行过多”诊断虽然能够正确检测，但点击后无法在真实空白区域生成定位标记、最终 `ZERO_PAINTED_RECT` 的问题。
>
> 本轮只解决 **Internal Blank Gap 的 canonical boundary → geometry → scroll → visual → closure** 闭环；不得扩散为 Heading、Document-End、Drawer 样式或其它无关诊断重构。

---

## 0. 执行模式与硬约束

本轮禁止只做审计后结束。

如果审计过程中发现问题，必须在同一轮立即修改，并继续完成：

1. targeted tests；
2. TypeScript typecheck；
3. full tests；
4. build；
5. production-path audit；
6. deploy identity / SHA；
7. 能执行的真实 Runtime matrix；
8. 最终 Gate 汇总。

只有真实 Runtime 证据完成时才允许输出：

```text
FINAL_DECISION=PASS
```

如果真实 Typora Runtime 必须由用户手动完成，则在全部静态 Gate、测试、构建、部署、身份校验完成后，只允许结束为：

```text
FINAL_DECISION=PENDING_USER_MANUAL_RUNTIME
```

禁止把：

```text
STATIC_PASS
BUILD_PASS
UNIT_TEST_PASS
```

误写成完整 Runtime PASS。

---

# 1. 当前问题不是“检测错误”，而是“Block Gap Locator 失败”

当前 Fixture：

```text
test/vault/Document-Diagnostics-Code-Integrity-Test.md
```

已经能够正确产生：

```text
EXCESSIVE_INTERNAL_BLANK_LINES
```

Runtime 证据表明当前源级检测结果为：

```text
previousBlockIdentity=code:```#2
previousBlockKind=code

firstBlankLine=30
lastBlankLine=32
actualBlankLines=3

warningThreshold=3

nextBlockIdentity=paragraph:代码 3 Manual prefix code caption#0
nextBlockKind=paragraph
nextBlockStartLine=33

locationKind=source-range
```

因此：

```text
DETECTION = CORRECT
```

本轮不得修改“3 个连续空行触发 warning”的规则语义。

当前真正失败的是：

```text
source blank gap
→ previous boundary resolve
→ next boundary resolve
→ block-gap geometry
→ paint
```

---

# 2. 当前真实根因

## 2.1 previous code boundary 使用 Markdown fence 文本重新猜 DOM

当前 Runtime：

```text
previousBlockIdentity=code:```#2
previousBlockAnchorText=```

previousBindingDecision=MISSING
previousBindingStrategy=ANCHOR_TEXT_NOT_FOUND
previousResolvedTag=null
previousResolvedClass=null
```

与此同时 next paragraph：

```text
nextBindingDecision=BOUND
nextBindingStrategy=CANONICAL_LOCATE_ELEMENT
nextResolvedTag=p
```

说明当前实际结构是：

```text
previous code block         = MISSING
next paragraph              = BOUND
```

因此后续：

```text
previousRect=null
nextRect=<valid paragraph rect>

gapTop=null
gapBottom=null
gapHeight=null
gapWidth=null

painted=false
fillCount=0
```

最终：

```text
BLOCK_GAP_VISUAL_NOT_PAINTED
ONE_CLICK_VISUAL_FAILED
ZERO_PAINTED_RECT
```

---

# 3. 为什么 `previousBlockAnchorText=``` ` 必须退出生产定位路径

Markdown fenced code block 的结束 fence 不是稳定身份。

多个代码块都可以包含：

```text
```
```

因此：

```text
```
→ text search
→ resolve previous block
```

不是合法的 canonical binding。

当前项目已经存在成熟的 canonical code target 链：

```text
block:code:N
→ canonical code target collection
→ pre.md-fences
```

所以 Internal Blank Gap 不允许再通过：

```text
ANCHOR_TEXT
SOURCE TEXT GUESS
querySelector + "```"
```

重建代码块身份。

必须直接复用 canonical code authority。

---

# 4. 本轮目标架构

本轮最终必须收敛成：

```text
Source Blank-Line Detection
        │
        ▼
BlankGapSemanticTarget
        │
        ├── previousBoundaryRef
        └── nextBoundaryRef
        │
        ▼
Canonical Boundary Resolver
        │
        ├── code      → canonical code target authority
        ├── heading   → canonical heading authority
        ├── paragraph → canonical content block authority
        ├── table     → canonical table authority
        ├── figure    → canonical figure authority
        ├── formula   → canonical formula authority
        └── ...
        │
        ▼
Presentation Extent Resolver
        │
        ├── previousPresentationExtent
        └── nextPresentationExtent
        │
        ▼
BlockGapGeometryPolicy
        │
        ▼
physical gap rect
        │
        ▼
generic document-space FILL_ONLY carrier
        │
        ▼
generic active lease
        │
        ▼
ACTIVE
```

业务语义允许是 `block-gap`。

**禁止**建立新的：

```text
BlankGapPersistentCarrier
BlankGapAtomicHandoff
BlankGapPresentationAuthorityV2/V3
BlankGapCompositingAuthority
```

视觉生命周期继续使用现有 generic carrier / lease。

---

# 5. Detection Authority：继续坚持 Source Derived

连续空行数量必须继续由 Markdown Source 判断。

必须保持：

```text
sourceDerived=true
domGeometryUsed=false
```

DOM 只负责：

```text
Presentation Geometry
```

不得把 DOM 视觉高度、margin 或空白像素反向作为：

```text
actualBlankLines
```

的检测权威。

也就是说：

```text
SOURCE
→ 决定有没有 3 个连续空行

DOM
→ 决定这 3 个空行在屏幕上应该标在哪里
```

二者必须分离。

---

# 6. Diagnostic Target：将“source line”升级为 Block-Gap Semantic Target

目前 generic `source-range` 定位把 `nextBlockStartLine=33` 当成主要 Locator Anchor，导致点击后最终 resolved node 是 next paragraph。

本轮需要给 `EXCESSIVE_INTERNAL_BLANK_LINES` 建立明确的 Block Gap Presentation Contract。

推荐数据结构：

```ts
interface BlankGapBoundaryRef {
  kind:
    | 'heading'
    | 'paragraph'
    | 'code'
    | 'table'
    | 'figure'
    | 'formula'
    | 'list'
    | 'blockquote'
    | 'other'

  canonicalIdentity: string

  ordinal: number | null

  sourceStart: number | null
  sourceEnd: number | null

  startLine: number | null
  endLine: number | null

  sourceFingerprint: string | null
}

interface BlankGapPresentationTarget {
  kind: 'block-gap'

  previous: BlankGapBoundaryRef
  next: BlankGapBoundaryRef

  firstBlankLine: number
  lastBlankLine: number
  actualBlankLines: number
}
```

如果现有 `DiagnosticLocation` 的 `locationKind` 是全局稳定协议，不适合本轮大规模扩 union，可保持：

```text
locationKind=source-range
```

作为 source truth，

但必须新增：

```text
presentationKind=block-gap
```

使 Locator 明确分流到 `BlockGapGeometryPolicy`。

不得继续让 `EXCESSIVE_INTERNAL_BLANK_LINES` 落入普通 source-range highlight。

---

# 7. Stable Identity 规则

本轮必须消除：

```text
code:```#2
```

作为代码块 DOM binding authority。

推荐最终 identity：

```text
previous:
  kind=code
  canonicalIdentity=block:code:2
  ordinal=2

next:
  kind=paragraph
  canonicalIdentity=<stable paragraph identity>
```

Diagnostic ID 可以继续保留 human-readable 信息，但实际定位不得依赖：

```text
```
```

此类非唯一 anchor。

推荐：

```text
document:
EXCESSIVE_INTERNAL_BLANK_LINES:
blank-gap:
block:code:2>>
paragraph:<stable-id>
```

如果为了兼容旧 diagnostic ID 不立即迁移，也必须保证内部 Locator metadata 已经完全脱离 fence-text binding。

---

# 8. Canonical Boundary Resolver

实现/抽取：

```ts
resolveBlankGapBoundary(
  ref: BlankGapBoundaryRef
): BoundaryResolution
```

返回至少：

```ts
interface BoundaryResolution {
  decision: 'BOUND' | 'MISSING'
  strategy: string
  element: HTMLElement | null
  canonicalIdentity: string
  semanticIdentityMatch: boolean
}
```

## 8.1 Code Boundary

`kind=code` 必须：

```text
canonicalIdentity / ordinal
→ existing canonical code target collection
→ canonical pre.md-fences
```

优先：

```text
CANONICAL_CODE_TARGET
```

禁止：

```text
ANCHOR_TEXT_NOT_FOUND
SOURCE_FENCE_TEXT_SEARCH
QUERY_BY_BACKTICKS
```

成为正常路径。

## 8.2 Heading Boundary

复用 canonical heading identity / stable identity。

## 8.3 Paragraph / List / Blockquote

复用当前已有 canonical locate element / source-to-content-block mapping。

## 8.4 Table / Figure / Formula

复用项目已有 canonical business target authority。

禁止复制另一套元素选择逻辑。

---

# 9. Boundary Fail-Closed

Block Gap 是“双边界几何”。

所以必须：

```text
previous=BOUND
AND
next=BOUND
```

才能生成 gap。

任意一侧：

```text
MISSING
```

则：

```text
gapRect=null
decision=FAIL_CLOSED
```

但必须输出准确原因：

```text
PREVIOUS_BOUNDARY_MISSING
NEXT_BOUNDARY_MISSING
BOTH_BOUNDARIES_MISSING
```

禁止退化为：

```text
previous missing
→ highlight next block

next missing
→ highlight previous block
```

否则用户会误认为相邻内容块本身有问题。

---

# 10. Presentation Extent：不能只拿原始 DOM block rect

当前已经存在类似：

```text
DOCUMENT-DIAGNOSTIC-PRESENTATION-EXTENT-AUDIT
```

本轮应继续复用这个方向。

每个 Boundary 要解析成：

```text
PresentationExtent
```

而不仅仅：

```text
element.getBoundingClientRect()
```

原因：

- code caption 可能位于代码块上方；
- figure/table caption 可能位于对象上方或下方；
- 插件 owned presentation 可能扩展对象视觉范围。

最终：

```text
previousGapBoundaryY = previousPresentationExtent.bottom
nextGapBoundaryY     = nextPresentationExtent.top
```

这样不会把空行 fill 覆盖到 caption 上。

要求：

```text
previousPresentationExtent.ownerIdentity
  == previous canonical identity

nextPresentationExtent.ownerIdentity
  == next canonical identity
```

插件 caption 必须通过 owner relation 纳入对应对象，而不是作为独立内容块参与 Blank Gap Detection。

---

# 11. BlockGapGeometryPolicy

完成两个 Boundary + PresentationExtent 后：

```ts
gapTop = previousExtent.bottom
gapBottom = nextExtent.top
gapHeight = gapBottom - gapTop
```

必须满足：

```text
gapTop < gapBottom
gapHeight > 0
```

水平范围：

```text
left/right
```

使用当前 document text/content column authority。

禁止直接使用：

```text
window width
drawer width
full editor shell width
```

推荐：

```text
gapRect.left  = content/text column left
gapRect.right = content/text column right
```

使视觉范围与正文列一致。

---

# 12. 第一阶段直接标记整个 Physical Gap

本轮第一目标是：

```text
位置正确
第一次点击立即显示
visual closure 真实 PASS
```

因此不要在这一轮为了“只覆盖多出来的第 2、3 个空行”继续引入新的复杂 geometry。

Phase 1：

```text
previousExtent.bottom
        ↓
[ entire real physical gap ]
        ↓
nextExtent.top
```

整个真实 gap 使用轻量 warning fill。

后续如果需要，再单独把：

```text
allowed gap
excess gap
```

拆开。

本轮不得因为追求 pixel-perfect excess-only region 再制造新的特殊生命周期。

---

# 13. Visual Style：继续 FILL_ONLY

当前 Blank Gap 警告不需要边框。

必须：

```text
border=0
outline=0
shadow=0
verticalRail=0
horizontalRail=0
cornerArm=0
```

只使用：

```text
warning active fill
```

不要把：

```text
previous code block
next paragraph
```

本身染色。

视觉语义必须明确：

```text
“这段空白太多”
```

而不是：

```text
“这个代码块有问题”
“这个 paragraph 有问题”
```

---

# 14. Scroll Authority：目标应该是 Gap，不是 next paragraph

当前 Runtime：

```text
resolvedNodeKind=p
scrollAnchorKind=p
```

说明滚动的其实是 next paragraph。

本轮必须改为：

```text
scrollTargetKind=block-gap
```

Compound geometry：

```ts
gapCenterY = (gapTop + gapBottom) / 2
```

定位流程：

```text
resolve previous
resolve next
build provisional gap
        ↓
scroll gap center into visible editor
        ↓
wait layout settle
        ↓
RE-RESOLVE previous
RE-RESOLVE next
        ↓
RE-MEASURE presentation extents
        ↓
REBUILD gap rect
        ↓
paint
```

滚动前计算的 rect：

```text
不得直接用于最终 paint
```

必须保证：

```text
freshTargetMeasurement=true
presentationBuiltAfterScroll=true
```

---

# 15. 一个重要异常：当前日志中的 placementMode 仍出现 CLAMPED_DOCUMENT_END

当前 Internal Blank Gap 的 One-Click Audit 中出现：

```text
placementMode=CLAMPED_DOCUMENT_END
```

这是高度可疑的。

`EXCESSIVE_INTERNAL_BLANK_LINES` 是：

```text
internal block gap
```

不是：

```text
document end
```

本轮必须审计为什么内部 Blank Gap 落到了 Document-End Placement Mode。

最终必须保证：

```text
INTERNAL_BLANK_LINE_DOCUMENT_END_PLACEMENT_COUNT=0
```

内部空行定位不得复用：

```text
CLAMPED_DOCUMENT_END
GO_BOTTOM
EOF geometry
```

除非这个 gap 本身真的属于 EOF；而 Detection 当前已经明确：

```text
EOF_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT=0
```

所以本 Fixture 绝不能走 Document-End placement。

---

# 16. Generic Highlight Bypass 应该继续，但 Block-Gap Visual 必须成功

当前：

```text
genericBlockHighlightAttempted=false
genericInlineHighlightAttempted=false
genericHeadingHighlightAttempted=false
```

这部分原则正确。

Block Gap 不应该偷偷 fallback 到 generic block/inline highlight。

最终必须：

```text
genericBlockHighlightAttempted=false
genericInlineHighlightAttempted=false
genericHeadingHighlightAttempted=false

blockGapVisualUsed=true
decision=PASS
```

---

# 17. Visual Closure 必须按当前 Diagnostic Scoped

当前还有一个独立的严重问题：

```text
visualFragmentCount=0
activeMarkerPresent=false
terminalState=FAILED
```

但：

```text
visualDecision=PASS
commitDecision=COMMIT
decision=PASS
```

说明 Visual Closure 仍然存在“页面上有其它 passive marker 就可能 PASS”的风险。

本轮必须把 Block Gap Closure 纳入 scoped contract：

```text
documentKey
+
diagnosticId
+
targetKey
+
targetIndex
```

当前点击的 Blank Gap 必须满足：

```text
currentDiagnosticActiveVisualCount=1
```

否则：

```text
visualClosure=FAIL
```

不得因为：

```text
passiveMarkerPresent=true
```

而让当前 diagnostic PASS。

---

# 18. Active Owner / Lease

成功 paint 后：

```text
active owner
active targetKey
active fill carrier
active lease
```

必须指向同一 Blank Gap Target。

要求：

```text
activeStateDiagnosticId
  == fillDiagnosticId

activeStateTargetKey
  == fillTargetKey

leaseTargetKey
  == activeStateTargetKey
```

禁止成功画出后马上被 generic cleanup 回收。

重复点击同一诊断时：

```text
ACTIVE → DEACTIVATE
```

必须清理当前 gap fill。

切换到其它诊断时：

```text
old gap fill count = 0
new diagnostic visual = 1
```

---

# 19. Dynamic Refresh

必须真实测试：

初始：

```text
3 blank lines
→ warning count +1
→ gap visual available
```

用户删除 1 个空行：

```text
3 → 2
```

应立即：

```text
EXCESSIVE_INTERNAL_BLANK_LINES removed
active gap fill removed
passive projection removed
lease released
no stale carrier
```

再次增加为空行：

```text
2 → 3
```

必须重新：

```text
diagnostic published
same semantic gap identity rebuilt
click works on first attempt
```

禁止依赖 polling / interval 扫描。

继续使用现有内容 mutation / document diagnostics refresh 主链。

---

# 20. Source Range 只作为来源，不作为最终视觉对象

当前 source range：

```text
firstBlankLine=30
lastBlankLine=32
nextBlockStartLine=33
```

应该保留用于：

- diagnostic identity；
- source truth；
- edit refresh；
- source audit；
- fallback forensic。

但最终 presentation 不再：

```text
source line 33
→ p
→ highlight p
```

而应：

```text
source gap
→ canonical previous boundary
→ canonical next boundary
→ real DOM gap
```

---

# 21. Runtime Audit 增补

增加：

```text
DOCUMENT-DIAGNOSTIC-BLOCK-GAP-TARGET-AUDIT
```

至少记录：

```text
diagnosticId
targetKey

firstBlankLine
lastBlankLine
actualBlankLines

previousBoundaryKind
previousBoundaryCanonicalIdentity
previousBoundaryOrdinal
previousBindingDecision
previousBindingStrategy
previousResolvedTag
previousResolvedClass

nextBoundaryKind
nextBoundaryCanonicalIdentity
nextBoundaryOrdinal
nextBindingDecision
nextBindingStrategy
nextResolvedTag
nextResolvedClass

previousExtentTop
previousExtentBottom
previousExtentAuthority

nextExtentTop
nextExtentBottom
nextExtentAuthority

gapTop
gapBottom
gapHeight
gapWidth

scrollTargetKind
scrollTargetCenterY

presentationBuiltAfterScroll
fillCarrierRegistered
activeFillCount

visualClosureScoped
currentDiagnosticActiveVisualCount

decision
reason
```

---

# 22. 强制 Runtime Gate

至少加入：

```text
INTERNAL_BLANK_LINE_WARNING_RUNTIME_COUNT >= 1

INTERNAL_BLANK_LINE_PREVIOUS_BOUNDARY_RESOLVED_COUNT >= 1
INTERNAL_BLANK_LINE_NEXT_BOUNDARY_RESOLVED_COUNT >= 1

INTERNAL_BLANK_LINE_PREVIOUS_CODE_CANONICAL_BIND_COUNT >= 1

INTERNAL_BLANK_LINE_ANCHOR_TEXT_CODE_FENCE_BIND_COUNT = 0

INTERNAL_BLANK_LINE_PREVIOUS_BOUNDARY_MISSING_COUNT = 0
INTERNAL_BLANK_LINE_NEXT_BOUNDARY_MISSING_COUNT = 0

INTERNAL_BLANK_LINE_GAP_RECT_COUNT >= 1
INTERNAL_BLANK_LINE_GAP_RECT_WIDTH_ZERO_COUNT = 0
INTERNAL_BLANK_LINE_GAP_RECT_HEIGHT_ZERO_COUNT = 0

INTERNAL_BLANK_LINE_ACTIVE_FILL_COUNT = 1
INTERNAL_BLANK_LINE_ZERO_PAINTED_RECT_COUNT = 0

INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_RUNTIME_COUNT >= 1
INTERNAL_BLANK_LINE_SECOND_CLICK_REQUIRED_COUNT = 0

INTERNAL_BLANK_LINE_SCROLL_TARGET_IS_GAP_COUNT >= 1
INTERNAL_BLANK_LINE_DOCUMENT_END_PLACEMENT_COUNT = 0

INTERNAL_BLANK_LINE_WRONG_NEXT_BLOCK_HIGHLIGHT_COUNT = 0
INTERNAL_BLANK_LINE_WRONG_PREVIOUS_BLOCK_HIGHLIGHT_COUNT = 0

INTERNAL_BLANK_LINE_SCOPED_VISUAL_CLOSURE_PASS_COUNT >= 1
INTERNAL_BLANK_LINE_UNSCOPED_VISUAL_FALSE_PASS_COUNT = 0

INTERNAL_BLANK_LINE_DYNAMIC_DISAPPEAR_RUNTIME_COUNT >= 1
INTERNAL_BLANK_LINE_DYNAMIC_REAPPEAR_RUNTIME_COUNT >= 1

INTERNAL_BLANK_LINE_STALE_VISUAL_COUNT = 0

INTERNAL_BLANK_LINE_CLICK_DRAWER_SCROLL_DRIFT_GT_1PX_COUNT = 0
INTERNAL_BLANK_LINE_CLICK_DRAWER_VIEWPORT_ANCHOR_CHANGED_COUNT = 0
```

---

# 23. Targeted Test Matrix

## A. 当前真实回归 Fixture

必须优先验证：

```text
code block
+
3 blank lines
+
paragraph "代码 3 Manual prefix code caption"
```

预期：

```text
warning=1
previous code canonical bound
next paragraph bound
gapRect>0
first click visual=1
ZERO_PAINTED_RECT=0
```

---

## B. Boundary 组合

至少增加：

```text
paragraph → paragraph
heading → paragraph
paragraph → heading
heading → heading

code → paragraph
paragraph → code
code → code

table → paragraph
paragraph → table

formula → paragraph
paragraph → formula
```

如果 figure/table/formula 的 canonical target test infrastructure 已有，纳入；如果对应 fixture 过重，至少写 pure resolver/geometry tests。

---

## C. Code Fence Identity

必须专门测试：

```text
code #0
code #1
code #2
```

全部 source fence 都是：

```text
```
```

但 Blank Gap previous 应稳定绑定：

```text
block:code:2
```

不能误绑：

```text
block:code:0
block:code:1
```

---

## D. Threshold

```text
0 blank lines → no diagnostic
1 blank line  → no diagnostic
2 blank lines → no diagnostic
3 blank lines → warning
4 blank lines → warning
```

必须保持当前：

```text
warningThreshold=3
passMaxBlankLines=2
```

---

## E. Exclusion

确保仍然不会把以下内部空行误报：

```text
fenced code internal blank line
formula internal blank line
front matter internal blank line
HTML block internal blank line
```

现有 Gate 必须继续保持 0：

```text
CODE_FENCE_INTERNAL_BLANK_LINE_FALSE_POSITIVE_COUNT=0
FORMULA_INTERNAL_BLANK_LINE_FALSE_POSITIVE_COUNT=0
FRONT_MATTER_BLANK_LINE_FALSE_POSITIVE_COUNT=0
HTML_BLOCK_BLANK_LINE_FALSE_POSITIVE_COUNT=0
```

---

## F. EOF Separation

Internal Blank Gap 与 EOF rules 必须继续分离。

要求：

```text
EOF_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT=0
INTERNAL_BLANK_LINE_REPORTED_AS_EOF_COUNT=0
LEADING_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT=0
```

本轮禁止破坏前面已经修复的：

```text
DOCUMENT_TERMINAL_NEWLINE_MISSING
document:end geometry
```

---

# 24. 不允许的修法

禁止：

### 24.1 固定找 next paragraph

```text
source line
→ next p
→ highlight p
```

---

### 24.2 用 `"```"` 找代码块

```text
previousBlockAnchorText=```
→ search DOM
```

---

### 24.3 按文字模糊匹配代码内容

空代码块没有正文文本，普通代码内容也可能重复。

---

### 24.4 只增加 retry 次数

当前已经：

```text
visualPaintAttemptCount=3
visualRetryCount=2
```

仍然：

```text
ZERO_PAINTED_RECT
```

说明不是“重试不够”，是 Authority 错误。

---

### 24.5 高亮相邻块作为 fallback

禁止：

```text
previous missing → highlight next
next missing → highlight previous
```

---

### 24.6 修改 warningThreshold

本轮不是 Detection 规则错误。

---

### 24.7 用 DOM 几何检测连续空行数量

检测必须继续 source-derived。

---

### 24.8 新增特殊生命周期

禁止：

```text
BlankGapPersistentCarrier
BlankGapSurfaceAuthorityV2
BlankGapAtomicHandoff
```

只允许增加：

```text
semantic resolver / geometry policy
```

视觉提交仍走 generic visual system。

---

# 25. Production Path Audit

修改完成后全文搜索并确认：

```text
EXCESSIVE_INTERNAL_BLANK_LINES
```

生产定位路径中不再依赖：

```text
previousBlockAnchorText=```
ANCHOR_TEXT_NOT_FOUND
```

作为正常代码块定位方式。

如果 Anchor Text 还需要保留：

只能作为：

```text
forensic metadata / last-resort diagnostic log
```

不能成为 canonical resolver authority。

同时审计：

```text
CLAMPED_DOCUMENT_END
```

不得出现在正常 Internal Blank Gap 最终 placement。

---

# 26. 测试与构建顺序

按以下顺序一次完成：

```text
1. targeted resolver tests
2. targeted block-gap geometry tests
3. targeted blank-line diagnostic tests
4. targeted visual closure tests
5. pnpm typecheck / tsc
6. full test suite
7. pnpm run build:dev
8. production-path grep/audit
9. deploy
10. SHA / Runtime identity
11. real Runtime matrix
```

项目既有命令如与上述名称不同，以 `package.json` 当前真实 scripts 为准，不允许猜命令。

---

# 27. Runtime 手动操作矩阵

真实 Typora 中至少执行：

## R1：点击“连续空行过多”

预期：

```text
previousBoundary=BOUND
nextBoundary=BOUND
gapRect.height>0
activeFillCount=1
terminalState=ACTIVE
```

视觉必须在：

```text
代码 3
与
代码 3 Manual prefix code caption
```

之间。

---

## R2：再次点击同一条

预期：

```text
ACTIVE → IDLE
activeFillCount=0
```

---

## R3：再次点击

预期：

```text
FIRST CLICK → ACTIVE
```

不得需要第二次。

---

## R4：删除一个空行

从：

```text
3 → 2
```

预期：

```text
diagnostic removed
fill removed
lease removed
staleVisual=0
```

---

## R5：重新增加一个空行

从：

```text
2 → 3
```

预期：

```text
diagnostic returns
first click works
gap identity correct
```

---

## R6：切换到其它诊断后再返回

预期：

```text
old visual cleared
new visual unique
blank gap restored correctly
```

---

## R7：Drawer 已滚动状态点击

预期：

```text
DRAWER_SCROLL_TOP_CHANGED_ON_ACTIVE_CLICK_COUNT=0
DRAWER_VIEWPORT_ANCHOR_CHANGED_ON_ACTIVE_CLICK_COUNT=0
```

---

# 28. 最终成功日志应接近

```text
DOCUMENT-DIAGNOSTIC-BLOCK-GAP-TARGET-AUDIT:

ruleId=EXCESSIVE_INTERNAL_BLANK_LINES
presentationKind=block-gap

previousBoundaryKind=code
previousBoundaryCanonicalIdentity=block:code:2
previousBindingDecision=BOUND
previousBindingStrategy=CANONICAL_CODE_TARGET
previousResolvedTag=pre

nextBoundaryKind=paragraph
nextBindingDecision=BOUND
nextBindingStrategy=CANONICAL_LOCATE_ELEMENT
nextResolvedTag=p

gapHeight>0
gapWidth>0

scrollTargetKind=block-gap

presentationBuiltAfterScroll=true

fillCarrierRegistered=true
activeFillCount=1

visualClosureScoped=true
currentDiagnosticActiveVisualCount=1

decision=PASS
```

`ONE-CLICK` 应接近：

```text
actualPaintedPrimaryRect=<non-null>
primaryMarkerVisible=true
visualCarrierPresent=true
secondUserClickRequired=false
terminalState=ACTIVE
decision=PASS
```

不得再出现：

```text
previousBindingDecision=MISSING
previousBindingStrategy=ANCHOR_TEXT_NOT_FOUND

BLOCK_GAP_VISUAL_NOT_PAINTED
ZERO_PAINTED_RECT

visualFragmentCount=0
activeMarkerPresent=false
visualDecision=PASS

placementMode=CLAMPED_DOCUMENT_END
```

---

# 29. 本轮范围边界

本轮可以修改：

```text
Internal Blank Line diagnostic target metadata
Blank Gap canonical boundary resolver
Blank Gap presentation extent
Blank Gap geometry policy
Blank Gap scroll policy
Blank Gap visual closure scoping
Blank Gap tests/audits/gates
```

除非共享基础设施确实需要，否则禁止顺手改：

```text
Heading diagnostics
Heading reason chip
Document-End marker geometry
Toolbar style
Drawer style
Navigator style
Figure locator
Code Empty Block visual policy
Caption numbering policy
```

如发现这些模块存在其它问题，只记录为：

```text
OUT_OF_SCOPE_FINDING
```

不得在本轮扩散修改。

---

# 30. 最终报告模板

最终必须输出：

```text
=== INTERNAL BLANK GAP CANONICAL LOCATOR CLOSURE ===

ROOT_CAUSE =
  ...

PRODUCTION_FILES_CHANGED =
  ...

SOURCE_DETECTION =
  PASS / FAIL

PREVIOUS_BOUNDARY_AUTHORITY =
  ...

NEXT_BOUNDARY_AUTHORITY =
  ...

CODE_FENCE_TEXT_BINDING_REMOVED =
  true / false

BLOCK_GAP_GEOMETRY =
  PASS / FAIL

SCROLL_TARGET =
  block-gap / ...

FIRST_CLICK_ACTIVE =
  PASS / FAIL / PENDING_RUNTIME

ZERO_PAINTED_RECT_COUNT =
  ...

SCOPED_VISUAL_CLOSURE =
  PASS / FAIL

DYNAMIC_DISAPPEAR =
  PASS / FAIL / PENDING_RUNTIME

DYNAMIC_REAPPEAR =
  PASS / FAIL / PENDING_RUNTIME

TYPECHECK =
  PASS / FAIL

TARGETED_TESTS =
  PASS / FAIL

FULL_TESTS =
  PASS / FAIL

BUILD =
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

# 31. 最终判定原则

满足以下全部条件才能：

```text
FINAL_DECISION=PASS
```

1. Source detection 仍正确；
2. previous code boundary 不再使用 `"```"` Anchor Text；
3. previous / next canonical boundary 都能真实绑定；
4. gapRect 非空；
5. 点击一次后 gap 区域真实出现 warning fill；
6. 不误染 previous/next block；
7. 不走 `CLAMPED_DOCUMENT_END`；
8. `ZERO_PAINTED_RECT_COUNT=0`；
9. Visual Closure 按当前 diagnostic scoped；
10. Active visual count 恰好为 1；
11. 删除空行后视觉与诊断实时消失；
12. 恢复第 3 个空行后实时重新出现；
13. Drawer viewport 不漂移；
14. targeted/typecheck/full/build 全 PASS；
15. deploy SHA 和 Runtime identity PASS；
16. 真实 Runtime 已验证。

本轮的核心不是：

```text
“让警告点击后滚到附近”
```

而是：

```text
“把连续空行本身作为一个真实的 Block-Gap Semantic Target，
用两个 canonical boundary 构造真实 gap geometry，
并通过 generic visual system 完成 first-click active closure。”
```

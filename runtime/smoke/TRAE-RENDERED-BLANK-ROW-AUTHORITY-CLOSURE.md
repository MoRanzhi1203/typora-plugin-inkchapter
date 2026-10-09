# TRAE：EXCESSIVE_INTERNAL_BLANK_LINES 可见空白行权威 + 真实 DOM 定位闭环修复

> 项目：`typora-plugin-inkchapter`
>
> 本轮执行模式：**一次性完整执行**
>
> 本轮目标：彻底修复 `EXCESSIVE_INTERNAL_BLANK_LINES` 当前同时存在的三类错误：
>
> 1. Typora 渲染界面实际只有 3 个空白行，但 Drawer 报告 7 行；
> 2. Binding 日志出现 `decision=BOUND`，但 `resolvedTag=null / physicalVerified=false` 的假绑定；
> 3. 点击诊断后仍以 paragraph 为滚动锚点，无法生成真实 blank-row marker，最终 `ZERO_PAINTED_RECT`。
>
> 本轮不得继续在“raw source blank lines + previous.bottom/next.top”方案上打补丁。必须重新建立：
>
> ```text
> Source Candidate Authority
> +
> Rendered Blank Row Authority
> +
> Fresh Physical Boundary Authority
> +
> Rendered Blank Row Geometry
> +
> Scoped Visual Closure
> ```
>
> 这是一次**规则语义纠正 + Runtime 定位闭环修复**，不是单纯 CSS 调色或 retry 修复。

---

# 0. 执行纪律

默认采用“一次性完整执行”。

禁止以下结束方式：

```text
只审计
只列问题
只写建议
修改一点后等待用户确认
STATIC_PASS 后宣布完成
UNIT_TEST_PASS 后宣布完成
BUILD_PASS 后宣布完成
```

本轮必须在同一轮尽可能完成：

```text
真实证据审计
→ DOM probe
→ 根因确认
→ production 修改
→ targeted tests
→ typecheck
→ full tests
→ build
→ production-path audit
→ deploy
→ SHA / Runtime identity
→ 真实 Runtime matrix
→ 最终 Gate 汇总
```

只有真实 Runtime 证据满足全部核心 Gate 时允许：

```text
FINAL_DECISION=PASS
```

若当前环境无法操作真实 Typora UI，只允许：

```text
FINAL_DECISION=PENDING_USER_MANUAL_RUNTIME
```

不得把静态测试冒充 Runtime PASS。

---

# 1. 当前真实错误证据

## 1.1 用户可见 3 行，但 Runtime 报告 7 行

当前 Typora WYSIWYG 界面中，代码块与：

```text
代码 3 Manual prefix code caption
```

之间实际可见的是约 3 个空白编辑行。

但是当前 Runtime：

```text
firstBlankLine=32
lastBlankLine=38
actualBlankLines=7
```

因此当前 `actualBlankLines` 实际含义是：

```text
RAW MARKDOWN SOURCE BLANK LINE COUNT
```

而不是：

```text
TYPORA RENDERED / EDITABLE BLANK ROW COUNT
```

这是当前第一根因。

---

# 2. 上一轮的错误前提必须废弃

上一轮把规则固定为：

```text
sourceDerived=true
domGeometryUsed=false
```

并认为：

```text
Markdown Source
→ 决定空行数量
DOM
→ 只负责 presentation
```

这个定义对 `EXCESSIVE_INTERNAL_BLANK_LINES` 不成立。

对用户而言，“连续空行过多”的语义是：

```text
Typora 编辑界面中实际存在多少个连续空白编辑行
```

而不是：

```text
Markdown 序列化中存在多少个 raw empty source line
```

本轮必须明确区分：

```ts
sourceBlankLineCount
renderedBlankRowCount
```

两者允许不同。

当前真实回归案例应允许：

```text
sourceBlankLineCount = 7
renderedBlankRowCount = 3
```

用户可见诊断必须使用：

```text
renderedBlankRowCount = 3
```

---

# 3. 新规则语义

最终规则定义为：

```text
Source
→ 只负责发现 Blank Gap Candidate
→ 给出 source range + previous/next semantic boundary

Runtime Rendered DOM
→ 负责确认当前用户实际看到多少个 blank rows
→ 负责最终 warning 决策
→ 负责最终 marker geometry
```

即：

```text
SOURCE CANDIDATE AUTHORITY
+
RENDERED BLANK ROW AUTHORITY
```

而不是：

```text
SOURCE COUNT AUTHORITY
```

---

# 4. 计数模型必须重构

## 4.1 保留 sourceBlankLineCount

Source scanner 可以继续输出：

```text
firstSourceBlankLine
lastSourceBlankLine
sourceBlankLineCount
```

这些字段用于：

- forensic；
- source identity；
- mutation invalidation；
- Markdown 范围审计；
- source ↔ rendered mapping。

但不得直接用于用户提示：

```text
当前两个内容块之间存在 X 个连续空行
```

## 4.2 新增 renderedBlankRowCount

新增：

```ts
interface RenderedBlankRowResult {
  sourceBlankLineCount: number
  renderedBlankRowCount: number
  rows: RenderedBlankRow[]
  decision:
    | 'VERIFIED'
    | 'NO_RENDERED_ROWS'
    | 'RUNTIME_UNAVAILABLE'
    | 'STALE_LAYOUT'
    | 'AMBIGUOUS'
  authority: string
}

interface RenderedBlankRow {
  index: number
  element: HTMLElement | null
  rect: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  } | null
  physicalVerified: boolean
  editableVerified: boolean
  pluginOwned: boolean
  layoutEpoch: number
}
```

最终用户可见数量：

```text
displayedBlankRowCount = renderedBlankRowCount
```

---

# 5. 禁止通过数学公式把 7 换算成 3

禁止：

```ts
Math.floor(sourceBlankLineCount / 2)
(sourceBlankLineCount - 1) / 2
sourceBlankLineCount - 4
```

禁止针对当前 Fixture：

```ts
if (sourceBlankLineCount === 7) return 3
```

Markdown 序列化与 Typora rendered rows 不是固定比例。

必须从真实 Runtime DOM 得到 rendered row count。

---

# 6. 第一阶段：先做真实 DOM Probe，但不得只审计后结束

在修改最终逻辑之前，必须在当前真实 Fixture：

```text
test/vault/Document-Diagnostics-Code-Integrity-Test.md
```

中探测：

```text
previous canonical code block
→ blank region
→ next paragraph
```

对应的真实 DOM。

至少输出：

```text
DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-DOM-PROBE
```

内容：

```text
documentKey
sourceRevision
layoutEpoch
previousCanonicalIdentity
previousElementTag
previousElementClass
previousElementDataLine
previousConnected
previousInBusinessRoot
nextIdentity
nextElementTag
nextElementClass
nextElementDataLine
nextConnected
nextInBusinessRoot
businessRootTag
businessRootClass
betweenSiblingCount
betweenSibling[i].tag
betweenSibling[i].class
betweenSibling[i].dataLine
betweenSibling[i].textLength
betweenSibling[i].normalizedText
betweenSibling[i].contentEditable
betweenSibling[i].rect
betweenSibling[i].pluginOwned
betweenSibling[i].codeMirrorInternal
betweenSibling[i].candidateBlankRow
```

必须确认：

> Typora 是否为这 3 个 WYSIWYG 空白行创建独立可编辑 DOM block。

---

# 7. DOM Probe 分支策略

## A. 若存在真实空白 DOM 行

例如：

```html
<pre class="md-fences">...</pre>
<p class="md-p md-end-block"></p>
<p class="md-p md-end-block"></p>
<p class="md-p md-end-block"></p>
<p class="md-p md-end-block">代码 3 Manual prefix code caption</p>
```

则：

```text
RenderedBlankRowResolver
= 直接数这 3 个真实 empty editable block
```

这是首选方案。

## B. 若 Typora 没有独立 blank row DOM

只有真实 probe 证明不存在独立 blank-row 元素时，才允许使用 Geometry Fallback：

```text
previous physical extent bottom
→
next physical extent top
```

再扣除：

```text
正常 object margin
正常 paragraph margin
正常 inter-block spacing
```

结合当前主题真实测量的：

```text
blank editable line box height
```

计算 `renderedBlankRowCount`。

但必须满足：

```text
禁止固定 24px
禁止固定 margin
禁止 sourceCount/2
禁止固定主题参数
```

所有数据来自实时 DOM / computed style。

---

# 8. RenderedBlankRowResolver

建议增加一个纯职责 Resolver：

```ts
resolveRenderedBlankRows({
  businessRoot,
  previousBoundary,
  nextBoundary,
  sourceCandidate,
  layoutEpoch
})
```

职责只允许：

1. 验证 previous/next physical boundary；
2. 取得两者之间真实 DOM sibling / rendered row；
3. 排除非业务节点；
4. 判断 blank row；
5. 返回 row rect；
6. 返回 renderedBlankRowCount。

不得负责 Drawer、Active State、Carrier lifecycle、Lease、Scroll transaction。

---

# 9. Blank Row DOM 过滤规则

候选 blank row 必须全部满足：

```text
在 business content root 内
connected
位于 previous 和 next 之间
不是 previous
不是 next
不是 plugin-owned caption
不是 diagnostic overlay
不是 toolbar/drawer/navigator
不是 CodeMirror internal
不是 syntax helper
不是 hidden node
不是 zero-size invisible node
不是 formula internal
不是 table internal
```

Blank 判定建议：

```text
normalized user-visible text == ''
```

并结合：

```text
editable paragraph / Typora business row semantics
```

禁止仅通过：

```text
textContent.trim() === ''
```

就承认任意空 DIV 为 blank row。

---

# 10. 必须复用 Business Root 与现有 internal exclusion

当前项目已经能够识别：

```text
rawPreCount=10
canonicalCodeTargetCount=4
rejectedCodeMirrorInternalCount=6
```

因此 BlankRowResolver 必须复用现有：

```text
business content root
canonical code target filtering
plugin-owned exclusion
CodeMirror internal exclusion
```

禁止自行使用宽泛 `document.querySelectorAll('p,div,pre')` 猜测。

---

# 11. 第二根因：当前存在假 BOUND

当前 Runtime 出现：

```text
previousBindingDecision=BOUND
previousBindingStrategy=CANONICAL_CODE_TARGET
nextBindingDecision=BOUND
nextBindingStrategy=CANONICAL_LOCATE_ELEMENT
```

但同时：

```text
previousResolvedTag=null
previousResolvedClass=null
nextResolvedTag=null
nextResolvedClass=null
```

next 还出现：

```text
canonicalLocateElementProvided=true
physicalVerified=false
decision=PARTIAL
```

因此当前 Binding Contract 有语义错误：

```text
“逻辑身份已解析”
被错误写成
“物理 DOM 已 BOUND”
```

---

# 12. Binding Contract 必须拆成两层

```ts
interface BoundaryResolution {
  identityDecision:
    | 'RESOLVED'
    | 'MISSING'
    | 'AMBIGUOUS'
  physicalDecision:
    | 'VERIFIED'
    | 'MISSING'
    | 'DISCONNECTED'
    | 'WRONG_KIND'
    | 'ZERO_RECT'
    | 'STALE_LAYOUT'
  decision:
    | 'BOUND'
    | 'UNVERIFIED'
    | 'MISSING'
    | 'AMBIGUOUS'
  canonicalIdentity: string | null
  element: HTMLElement | null
  connected: boolean
  insideBusinessRoot: boolean
  kindVerified: boolean
  rect: DOMRect | null
  layoutEpoch: number
  strategy: string
}
```

---

# 13. BOUND 的硬条件

只有全部满足：

```text
identityDecision=RESOLVED
element != null
element.isConnected=true
businessRoot.contains(element)=true
expected kind matches
physical rect exists
rect.width > 0
rect.height > 0
measurement layoutEpoch == current layoutEpoch
```

才允许：

```text
decision=BOUND
physicalDecision=VERIFIED
```

否则：

```text
decision=UNVERIFIED / MISSING
```

严禁：

```text
BOUND + element=null
BOUND + resolvedTag=null
BOUND + physicalVerified=false
BOUND + rect=null
```

---

# 14. 新增致命 Runtime Gate

```text
INTERNAL_BLANK_LINE_BOUND_WITH_NULL_ELEMENT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITHOUT_PHYSICAL_VERIFICATION_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_DISCONNECTED_ELEMENT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_STALE_LAYOUT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_ZERO_RECT_COUNT = 0
```

任一非零：

```text
FINAL_DECISION=FAIL
```

---

# 15. Previous code boundary

继续允许 canonical identity：

```text
block:code:2
```

但必须重新 resolve 成当前 live DOM：

```text
block:code:2
→ canonical code target collection
→ current live pre.md-fences
```

不能复用旧 transaction element、旧 snapshot element、旧 preferred element。

如果 Layout Epoch 改变，必须重新 resolve。

---

# 16. Next paragraph boundary

当前：

```text
CANONICAL_LOCATE_ELEMENT
canonicalLocateElementProvided=true
physicalVerified=false
```

说明 preferredNextElement 可能是 stale / unverified element。

本轮修改：`preferredNextElement` 只能作为 identity hint，不能直接当 physical authority。

必须：

```text
stable paragraph/source identity
→ current business root
→ re-resolve current live element
→ physical verify
```

如果无法重新找到：

```text
decision=UNVERIFIED
```

不得 `BOUND`。

---

# 17. Post-scroll 必须再次物理绑定

流程必须：

```text
SOURCE CANDIDATE
        ↓
initial previous identity resolution
initial next identity resolution
        ↓
initial physical verify
        ↓
rendered blank rows provisional measurement
        ↓
scroll
        ↓
layout settle
        ↓
RE-RESOLVE previous LIVE element
RE-RESOLVE next LIVE element
        ↓
recollect rendered blank rows
        ↓
remeasure row rects
        ↓
paint
```

滚动前 Element / Rect 不允许直接用于最终 paint。

---

# 18. presentationBuiltAfterScroll 字段修正

当前出现：

```text
presentationBuiltAfterScroll=true
```

但：

```text
previousExtent=null
nextExtent=null
gapRect=null
```

这是错误状态。

以后只有满足：

```text
postScrollPreviousPhysicalVerified=true
postScrollNextPhysicalVerified=true
renderedBlankRowCount > 0
renderedBlankRowRectCount > 0
measuredLayoutEpoch == currentLayoutEpoch
```

才能：

```text
presentationBuiltAfterScroll=true
```

否则必须为 `false`。

---

# 19. 第三根因：Scroll Target 仍然是 paragraph

当前真实 Runtime：

```text
scrollAnchorKind=p
scrollTargetKind=null
scrollTargetCenterY=null
```

说明上一轮所谓：

```text
SCROLL_TARGET=block-gap
```

并未在真实 Runtime 成立。

本轮最终必须：

```text
scrollTargetKind=rendered-blank-gap
```

---

# 20. Scroll Target 应直接来自 rendered row geometry

如果有 3 个 blank-row rect：

```ts
rowRects = [r1, r2, r3]
```

构造：

```ts
unionTop = min(row.top)
unionBottom = max(row.bottom)
unionCenterY = (unionTop + unionBottom) / 2
```

滚动目标必须是 `rendered-blank-gap center`，而不是 next paragraph center。

---

# 21. 关于 CLAMPED_DOCUMENT_END

`CLAMPED_DOCUMENT_END` 可能只是 generic placement 在文档无法继续滚动时的结果，并不等于使用了 EOF geometry。

因此本轮不要再错误设置：

```text
CLAMPED_DOCUMENT_END_COUNT 必须永远=0
```

正确 Gate：

```text
INTERNAL_BLANK_LINE_EOF_AUTHORITY_USED_COUNT = 0
INTERNAL_BLANK_LINE_GO_BOTTOM_ACTION_USED_COUNT = 0
INTERNAL_BLANK_LINE_SCROLL_TARGET_KIND_RENDERED_GAP_COUNT >= 1
```

如果 viewport 本身无法继续滚动，`placementMode=CLAMPED_DOCUMENT_END` 可以存在，但 `scrollTargetKind` 仍必须是 `rendered-blank-gap`。

---

# 22. Marker 几何必须重做

禁止继续简单：

```text
gapTop = previousExtent.bottom
gapBottom = nextExtent.top
```

并把整个物理空间全部染色。

这个区域还包含：

```text
previous normal margin
next normal margin
normal inter-block spacing
```

会导致标记比真实空白行更大、更偏。

---

# 23. 优先使用 Blank Row Fragments

如果实际有 3 个 blank rows：

```text
rowRect[0]
rowRect[1]
rowRect[2]
```

建议使用 3 个 fragment fill，而不是整个 `previous.bottom → next.top` 的大矩形。

语义：

```text
markerFragmentCount = renderedBlankRowCount
```

当前 Fixture：

```text
renderedBlankRowCount = 3
markerFragmentCount = 3
```

---

# 24. Fragment Visual Style

继续 `FILL_ONLY`。

禁止 border、outline、box-shadow、rail、corner。

每个 row fill：

```text
width = document text column / actual editable row width
height = actual blank row rect height
```

不得覆盖 previous code block、next paragraph、caption、normal object margin。

---

# 25. Active Visual 语义

即使 marker 有 3 个 fragment，当前 Diagnostic 仍然是一个 Semantic Active Visual：

```text
currentDiagnosticActiveVisualCount = 1
renderedFragmentCount = 3
```

不能把 3 个 fragment 误认为 3 个 diagnostic visual owner。

---

# 26. Drawer 文案必须使用 renderedBlankRowCount

当前：

```text
当前两个内容块之间存在 7 个连续空行
```

应变成：

```text
当前两个内容块之间存在 3 个连续空行，建议压缩为 1 个空行。
```

字段：

```text
sourceBlankLineCount=7
renderedBlankRowCount=3
displayedBlankRowCount=3
```

Drawer 禁止直接读取 `sourceBlankLineCount`。

---

# 27. Warning Threshold

保持当前语义：

```text
renderedBlankRowCount <= 2 → PASS
renderedBlankRowCount >= 3 → WARNING
```

建议目标仍为“压缩为 1 个空行”。

---

# 28. Source Candidate 与 Visible Diagnostic 分离

推荐：

```text
Phase A:
Source scanner
→ BlankGapCandidate
```

Candidate 不是用户可见 Diagnostic。

只有：

```text
Phase B:
RenderedBlankRowResolver
→ VERIFIED
→ renderedBlankRowCount >= 3
```

才发布 `EXCESSIVE_INTERNAL_BLANK_LINES`。

这样不会先在 Drawer 显示 7，再异步改成 3。

---

# 29. 若 Runtime 暂时不可用

如果：

```text
business root not ready
layout epoch unstable
source mode active
DOM not settled
```

不要 fallback：

```text
displayedBlankRowCount=sourceBlankLineCount
```

应该进入：

```text
candidate=PENDING_RENDERED_VERIFICATION
```

等待现有 document reconcile / layout ready 事件。

禁止新增 `setInterval` 全文轮询。

---

# 30. 源代码模式处理

Source Code Mode 只用于 forensic source authority。

不得：

```text
source mode 显示 7 行
→ Drawer 就改成 7
```

如果 source mode 下 rendered DOM unavailable：

```text
保留最近一次同 sourceRevision 的 VERIFIED rendered count
```

或者暂停 rendered visual 定位，但不得把 source count 冒充 rendered count。

---

# 31. Dynamic Refresh

## Case 1：3 → 2 可见空白行

```text
renderedBlankRowCount: 3 → 2
```

要求：

```text
warning removed
active marker removed
fragment carriers removed
lease released
no stale diagnostic
```

## Case 2：2 → 3

```text
2 → 3
```

要求：

```text
warning appears
display=3
first click works
3 blank row fragments rendered
```

## Case 3：source count 改变但 rendered count 不变

Drawer 仍使用 rendered count。

---

# 32. 不允许为了测试改当前真实问题语义

上一轮曾为了 Runtime Matrix 主动修改：

```text
test/vault/Document-Diagnostics-Code-Integrity-Test.md
```

本轮禁止继续通过修改 Fixture 内容去“配合算法”。

建议：

1. 保留用户当前真实 Fixture；
2. 新增独立回归 Fixture：

```text
test/vault/runtime/Document-Diagnostics-Rendered-Blank-Rows-Test.md
```

明确构造：

```text
sourceBlankLineCount != renderedBlankRowCount
```

避免测试只覆盖 `source=3 / rendered=3` 的理想场景。

---

# 33. 核心 Regression Fixture

必须包含当前问题：

```text
SOURCE MODE:
sourceBlankLineCount = 7

WYSIWYG:
renderedBlankRowCount = 3
```

预期：

```text
visible diagnostic count = 3
warning = true
marker fragment count = 3
first click active = true
```

---

# 34. Test Matrix

至少：

## A. source 与 rendered 相同

```text
source=3
rendered=3
expected warning=1
display=3
```

## B. source 多于 rendered

```text
source=7
rendered=3
expected warning=1
display=3
```

## C. rendered pass

```text
rendered=2
expected warning=0
```

## D. 0 / 1 / 2 / 3 / 4 rendered rows

```text
0 → PASS
1 → PASS
2 → PASS
3 → WARNING
4 → WARNING
```

## E. Boundary 类型

```text
paragraph → paragraph
code → paragraph
paragraph → code
code → code
heading → paragraph
paragraph → heading
table → paragraph
paragraph → table
formula → paragraph
paragraph → formula
```

## F. CodeMirror internal exclusion

CodeMirror internal rows 不得被算作 blank row。

## G. Plugin caption exclusion

figure/table/code/formula caption 不得成为 blank row。

---

# 35. Runtime Audit 新增

新增：

```text
DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-AUDIT
```

至少记录：

```text
documentKey
diagnosticId
sourceRevision
layoutEpoch
sourceCandidateId
sourceFirstBlankLine
sourceLastBlankLine
sourceBlankLineCount
previousIdentityDecision
previousPhysicalDecision
previousBindingDecision
previousCanonicalIdentity
previousResolvedTag
previousResolvedClass
previousConnected
previousInsideBusinessRoot
previousKindVerified
previousRect
nextIdentityDecision
nextPhysicalDecision
nextBindingDecision
nextCanonicalIdentity
nextResolvedTag
nextResolvedClass
nextConnected
nextInsideBusinessRoot
nextKindVerified
nextRect
betweenSiblingCount
renderedBlankRowCount
renderedBlankRowRectCount
renderedBlankRows=[...]
displayedBlankRowCount
threshold
warningDecision
scrollTargetKind
scrollTargetCenterY
presentationBuiltAfterScroll
markerFragmentCount
activeVisualCount
decision
reason
```

---

# 36. 真实成功日志目标

```text
DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-AUDIT:

sourceBlankLineCount=7

previousIdentityDecision=RESOLVED
previousPhysicalDecision=VERIFIED
previousBindingDecision=BOUND
previousCanonicalIdentity=block:code:2
previousResolvedTag=PRE

nextIdentityDecision=RESOLVED
nextPhysicalDecision=VERIFIED
nextBindingDecision=BOUND
nextResolvedTag=P

renderedBlankRowCount=3
renderedBlankRowRectCount=3

displayedBlankRowCount=3
warningDecision=WARNING

scrollTargetKind=rendered-blank-gap
scrollTargetCenterY=<non-null>

presentationBuiltAfterScroll=true

markerFragmentCount=3
currentDiagnosticActiveVisualCount=1

decision=PASS
```

---

# 37. 当前错误状态必须消失

允许：

```text
sourceBlankLineCount=7
```

但当 rendered=3 时不允许：

```text
displayedBlankRowCount=7
```

不得再出现：

```text
previousBindingDecision=BOUND
previousResolvedTag=null
```

不得再出现：

```text
nextBindingDecision=BOUND
physicalVerified=false
```

不得再出现：

```text
previousRect=null
nextRect=null
decision=BLOCK_GAP_BOTH_SIDES_BOUND
```

不得再出现：

```text
scrollTargetKind=null
```

不得再出现：

```text
presentationBuiltAfterScroll=true
+
renderedBlankRowRectCount=0
```

不得再出现 `ZERO_PAINTED_RECT`。

---

# 38. Visual Closure 保持当前 fail-closed 改进

最新 Runtime 已经能够：

```text
visualDecision=FAIL
commitDecision=NO_COMMIT
terminalState=FAILED
OWNER-RETIRE
reason=ZERO_PAINTED_RECT
```

这部分原则正确。

本轮禁止把它改回：

```text
passiveMarkerPresent=true
→ PASS
```

继续要求当前 diagnostic + 当前 targetKey + 当前 active owner + 当前 blank-row carriers 严格 scoped。

---

# 39. 新 Gate：计数权威

```text
INTERNAL_BLANK_LINE_SOURCE_CANDIDATE_RUNTIME_COUNT >= 1
INTERNAL_BLANK_LINE_RENDERED_COUNT_VERIFIED_COUNT >= 1
INTERNAL_BLANK_LINE_SOURCE_COUNT_USED_AS_DISPLAY_COUNT_COUNT = 0
INTERNAL_BLANK_LINE_SOURCE_RENDERED_COUNT_CONFLATION_COUNT = 0
INTERNAL_BLANK_LINE_DISPLAYED_COUNT_MATCH_RENDERED_COUNT_COUNT >= 1
```

核心 Fixture 断言：

```text
SOURCE_BLANK_COUNT = 7
RENDERED_BLANK_ROW_COUNT = 3
DISPLAYED_BLANK_ROW_COUNT = 3
```

---

# 40. 新 Gate：Physical Binding

```text
INTERNAL_BLANK_LINE_PREVIOUS_PHYSICAL_VERIFIED_COUNT >= 1
INTERNAL_BLANK_LINE_NEXT_PHYSICAL_VERIFIED_COUNT >= 1
INTERNAL_BLANK_LINE_BOUND_WITH_NULL_ELEMENT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITHOUT_PHYSICAL_VERIFICATION_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_DISCONNECTED_ELEMENT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_ZERO_RECT_COUNT = 0
INTERNAL_BLANK_LINE_BOUND_WITH_STALE_LAYOUT_COUNT = 0
```

---

# 41. 新 Gate：Rendered Row Geometry

```text
INTERNAL_BLANK_LINE_RENDERED_ROW_RECT_COUNT >= 1
INTERNAL_BLANK_LINE_RENDERED_ROW_RECT_MISSING_COUNT = 0
INTERNAL_BLANK_LINE_RENDERED_ROW_ZERO_HEIGHT_COUNT = 0
INTERNAL_BLANK_LINE_RENDERED_ROW_OUTSIDE_BOUNDARIES_COUNT = 0
INTERNAL_BLANK_LINE_RENDERED_ROW_PLUGIN_OWNED_COUNT = 0
INTERNAL_BLANK_LINE_RENDERED_ROW_CODEMIRROR_INTERNAL_COUNT = 0
```

当前核心 Fixture：

```text
RENDERED_ROW_RECT_COUNT = 3
```

---

# 42. 新 Gate：Scroll / Visual

```text
INTERNAL_BLANK_LINE_SCROLL_TARGET_RENDERED_GAP_COUNT >= 1
INTERNAL_BLANK_LINE_EOF_AUTHORITY_USED_COUNT = 0
INTERNAL_BLANK_LINE_GO_BOTTOM_ACTION_USED_COUNT = 0
INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_COUNT >= 1
INTERNAL_BLANK_LINE_SECOND_CLICK_REQUIRED_COUNT = 0
INTERNAL_BLANK_LINE_ZERO_PAINTED_RECT_COUNT = 0
INTERNAL_BLANK_LINE_CURRENT_DIAGNOSTIC_ACTIVE_VISUAL_COUNT = 1
INTERNAL_BLANK_LINE_MARKER_FRAGMENT_COUNT_MATCH_RENDERED_ROWS_COUNT >= 1
INTERNAL_BLANK_LINE_WRONG_PREVIOUS_BLOCK_HIGHLIGHT_COUNT = 0
INTERNAL_BLANK_LINE_WRONG_NEXT_BLOCK_HIGHLIGHT_COUNT = 0
```

---

# 43. 新 Gate：Post-scroll Truthfulness

```text
INTERNAL_BLANK_LINE_PRESENTATION_BUILT_WITH_NULL_BOUNDARY_COUNT = 0
INTERNAL_BLANK_LINE_PRESENTATION_BUILT_WITHOUT_ROW_RECT_COUNT = 0
INTERNAL_BLANK_LINE_PRESENTATION_BUILT_ON_STALE_LAYOUT_COUNT = 0
```

只有 fresh physical boundaries + fresh rendered rows + current layout epoch 才能：

```text
presentationBuiltAfterScroll=true
```

---

# 44. Dynamic Runtime Gate

```text
INTERNAL_BLANK_LINE_3_TO_2_DIAGNOSTIC_REMOVED_COUNT >= 1
INTERNAL_BLANK_LINE_3_TO_2_VISUAL_REMOVED_COUNT >= 1
INTERNAL_BLANK_LINE_2_TO_3_DIAGNOSTIC_ADDED_COUNT >= 1
INTERNAL_BLANK_LINE_2_TO_3_FIRST_CLICK_ACTIVE_COUNT >= 1
INTERNAL_BLANK_LINE_STALE_VISUAL_COUNT = 0
```

---

# 45. Drawer 稳定性

继续：

```text
DRAWER_SCROLL_DRIFT_GT_1PX_COUNT = 0
DRAWER_VIEWPORT_ANCHOR_CHANGED_COUNT = 0
```

点击 Blank Gap 不允许 Drawer 自己跳动。

---

# 46. 不允许的修复

禁止：

1. `sourceBlankLineCount → message`；
2. `7 → 3` 固定换算；
3. identity exists 就 `BOUND`；
4. preferred element 未验证直接 `BOUND`；
5. 无条件高亮 `previous.bottom → next.top`；
6. 用 next paragraph 作为 Blank Gap 最终 scroll target；
7. 修改 warning threshold 掩盖计数错误；
8. 修改 Fixture 让 source count 回到 3；
9. 新增 timer polling；
10. 新增 BlankGap 专属 PersistentCarrier / AtomicHandoff / SurfaceAuthority V2/V3。

---

# 47. 建议修改文件范围

预计：

```text
src/document-utilities/document-diagnostic-internal-blank-lines-v1.ts
```

调整为 source candidate authority，不再直接决定 visible count。

```text
src/document-utilities/document-diagnostics.ts
```

调整 Candidate → runtime rendered verification → visible diagnostic publish。

```text
src/document-utilities/document-diagnostic-block-gap-visual-v1.ts
```

承载 RenderedBlankRow geometry、fragment geometry、gate/audit。

```text
src/document-utilities/document-utility-overlay-host.ts
```

承载 fresh physical boundary、RenderedBlankRowResolver integration、rendered-gap scroll、fragment carrier commit、scoped closure。

如现有模块无法合理承载，可新增：

```text
src/document-utilities/document-diagnostic-rendered-blank-row.ts
```

职责仅限 DOM blank-row resolution，不得变成新 visual lifecycle authority。

---

# 48. Targeted Tests

至少执行：

```text
document-diagnostic-internal-blank-lines-v1
document-diagnostic-block-gap-visual-v1
rendered-blank-row resolver
document-diagnostics
document-utility-overlay-host block-gap
one-click visual closure
dynamic refresh
```

---

# 49. 静态测试不能替代真实 Runtime

上一轮即使：

```text
22 new tests PASS
FULL TESTS PASS
BUILD PASS
```

真实 Runtime 仍然：

```text
rendered=3
display=7
BOUND + null element
ZERO_PAINTED_RECT
```

因此 pure/unit test 只能属于 `STATIC_GATE`。

---

# 50. Runtime Matrix

## R1：初始状态

WYSIWYG 实际看到 3 个连续 blank rows。

Drawer 必须：

```text
当前两个内容块之间存在 3 个连续空行
```

禁止显示 7。

## R2：点击诊断

必须：

```text
previous physical VERIFIED
next physical VERIFIED
renderedBlankRowCount=3
markerFragmentCount=3
scrollTargetKind=rendered-blank-gap
FIRST CLICK → ACTIVE
```

## R3：视觉位置

3 个 marker 与真实 blank rows 对齐。

禁止 marker 在 blank rows 上方、code block 内、覆盖 next paragraph 或形成粗略大矩形。

## R4：再次点击

```text
ACTIVE → IDLE
fragment count=0
```

## R5：再点击

```text
FIRST CLICK → ACTIVE
```

## R6：删除 1 个 blank row

```text
3 → 2
```

要求 warning/marker/lease 全部实时消失。

## R7：添加 1 个 blank row

```text
2 → 3
```

要求 warning 返回、display=3、first click works。

## R8：打开 Source Code Mode

允许看到 7 raw source blank lines，但不得把 Drawer 文案改成 7。

---

# 51. 全量 Gate

按顺序：

```text
TARGETED_TESTS
TYPECHECK
FULL_TESTS
BUILD
RUNTIME_STRUCTURE
PRODUCTION_PATH_AUDIT
DEPLOY_SHA_GATE
RUNTIME_IDENTITY
REAL_RUNTIME_MATRIX
```

任何一个 FAIL：

```text
FINAL_DECISION=FAIL
```

Runtime 未执行：

```text
FINAL_DECISION=PENDING_USER_MANUAL_RUNTIME
```

---

# 52. Production Path Audit

全文搜索确保不存在：

```text
displayedBlankRowCount = sourceBlankLineCount
```

确保 canonical/physical binding 不允许：

```text
decision=BOUND
element=null
```

确保 `preferredNextElement` 不是未验证 physical authority。

确保 Internal Blank Gap 不走 document-end carrier / GO_BOTTOM / EOF geometry。

确保没有新增 BlankGap 特殊生命周期。

---

# 53. 最终报告模板

```text
=== RENDERED BLANK ROW AUTHORITY CLOSURE ===

ROOT_CAUSE_SOURCE_COUNT =
  ...

ROOT_CAUSE_FAKE_BOUND =
  ...

ROOT_CAUSE_SCROLL_TARGET =
  ...

DOM_PROBE_RESULT =
  ...

SOURCE_BLANK_LINE_COUNT =
  ...

RENDERED_BLANK_ROW_COUNT =
  ...

DISPLAYED_BLANK_ROW_COUNT =
  ...

PREVIOUS_IDENTITY_DECISION =
  ...

PREVIOUS_PHYSICAL_DECISION =
  ...

PREVIOUS_BINDING_DECISION =
  ...

PREVIOUS_RESOLVED_TAG =
  ...

NEXT_IDENTITY_DECISION =
  ...

NEXT_PHYSICAL_DECISION =
  ...

NEXT_BINDING_DECISION =
  ...

NEXT_RESOLVED_TAG =
  ...

BOUND_WITH_NULL_ELEMENT_COUNT =
  ...

BOUND_WITHOUT_PHYSICAL_VERIFICATION_COUNT =
  ...

RENDERED_ROW_RECT_COUNT =
  ...

MARKER_FRAGMENT_COUNT =
  ...

SCROLL_TARGET_KIND =
  ...

PRESENTATION_BUILT_AFTER_SCROLL =
  ...

FIRST_CLICK_ACTIVE =
  PASS / FAIL / PENDING_RUNTIME

ZERO_PAINTED_RECT_COUNT =
  ...

DYNAMIC_3_TO_2 =
  PASS / FAIL / PENDING_RUNTIME

DYNAMIC_2_TO_3 =
  PASS / FAIL / PENDING_RUNTIME

SCOPED_VISUAL_CLOSURE =
  PASS / FAIL

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

# 54. 最终 PASS 条件

必须全部满足：

1. `sourceBlankLineCount=7` 可以存在；
2. 当前核心 Fixture `renderedBlankRowCount=3`；
3. Drawer 显示 3，不显示 7；
4. source count 与 rendered count 明确分离；
5. previous physical boundary 真实 VERIFIED；
6. next physical boundary 真实 VERIFIED；
7. `BOUND + null element` 永远为 0；
8. `BOUND + physicalVerified=false` 永远为 0；
9. blank-row rect count=3；
10. marker fragment count=3；
11. marker 与真实 3 行对齐；
12. 不染 previous code；
13. 不染 next paragraph；
14. scroll target 是 rendered blank gap；
15. 不使用 EOF authority；
16. post-scroll 重新 resolve / remeasure；
17. `presentationBuiltAfterScroll=true` 时 physical/rect truth 均真实存在；
18. first click ACTIVE；
19. `ZERO_PAINTED_RECT_COUNT=0`；
20. 3→2 实时消失；
21. 2→3 实时恢复；
22. Drawer viewport 不漂移；
23. scoped visual closure PASS；
24. targeted/typecheck/full/build PASS；
25. deploy SHA + runtime identity PASS；
26. 真实 Runtime Matrix PASS。

---

# 55. 本轮核心结论

本轮不是：

```text
“修一下 7 的显示数字”
```

也不是：

```text
“继续修 previous.bottom → next.top”
```

真正需要完成的是：

```text
Raw Markdown Source
    ↓
只发现 Candidate / Source Identity
    ↓
Fresh Previous Physical Boundary
Fresh Next Physical Boundary
    ↓
Rendered Blank Row Resolver
    ↓
用户真正看到的 3 个 blank rows
    ↓
count=3
rowRects=3
    ↓
warning message=3
scroll target=blank-row union
marker fragments=3
    ↓
FIRST CLICK ACTIVE
```

只有完成这条链，才算真正修复：

```text
3 行被报成 7 行
+
定位错误
+
无法选中标记
```

三个问题。

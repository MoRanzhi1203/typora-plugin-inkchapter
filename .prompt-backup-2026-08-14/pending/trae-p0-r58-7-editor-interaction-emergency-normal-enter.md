# TRAE P0 — R58.7 Editor Interaction Emergency Repair
## Normal Enter Continuity + First-Line Caret + Indent Preservation + Caret Ownership Handover

> Project:
>
> `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1.3.1a NOT FIXED
> R60 BLOCKED
> ```
>
> Latest runtime build observed:
>
> ```text
> inkchapter-r58-7-phA1-3-1a-scope-authority-k9m4v
> ```
>
> 本轮是一个独立的 **Editor Interaction Emergency Repair**。
>
> 暂停继续扩大：
>
> ```text
> Save-As classifier
> Operation Provenance
> Cross-document persistence lifecycle
> ContinuityEngine
> Session Overlay
> ```
>
> 当前真实用户故障已经升级为 P0：
>
> ```text
> 1. `。。+Enter` 后继续普通 Enter，
>    光标经常跳到上一行。
>
> 2. 已缩进段落执行普通 Enter 后，
>    新行视觉缩进消失/顶格。
>
> 3. 文档第一行场景下执行 Enter，
>    selection / caret 可能完全消失。
> ```
>
> 最新 runtime 已证明：
>
> ```text
> Special Command 同步 commit 成功
> ≠
> Normal Enter 连续性成功
> ```
>
> 因此本轮必须重新打开：
>
> ```text
> Normal Enter orchestration
> Caret ownership handover
> First interaction editor readiness
> Raw MutationRecord capture
> Enter pre/post structural reconciliation
> Visual indent continuity
> ```
>
> 但继续 HARD FREEZE：
>
> ```text
> token recognition
> Special Command semantic commit
> SelectionTruth resolver 本体
> persisted sidecar backend
> Single-Dot CURRENT_LIVE de-noise
> Save-As classifier
> ```
>
> 禁止把当前问题重新解释为纯 Scope bug。
>
> 最新日志已经证明这些故障发生在：
>
> ```text
> same editor
> same EPHEMERAL scope
> same Untitled document
> ```
>
> 内部。

---

# 0. 本轮唯一目标

建立真正的：

```text
NormalEnterContinuityTransaction
```

让普通 Enter 不再只是：

```text
UserIntentEpoch++
```

而是：

```text
NORMAL_ENTER
↓
capture pre-state
↓
new caret owner becomes active
↓
Typora native DOM mutation
↓
capture raw mutation
↓
capture post-state
↓
resolve completed paragraph
↓
resolve caret destination
↓
preserve semantic / visual indent
↓
verify final selection
↓
close transaction
```

---

# 1. 最新 runtime Ground Truth

当前 Special Command 同步阶段真实成功：

```text
USER-INTENT-EPOCH:
source=SPECIAL_COMMAND

POST-TOKEN-SELECTION:
sameAsCommand=true

ENTER-COMMIT-ATOMIC:
overallSuccess=true

CARET-EXPECTATION-CREATE:
expectedRuntimeId=P-RUNTIME-1

HANDOFF-CREATE:
preRuntimeId=P-RUNTIME-1
```

Microtask / RAF / OBS 初期：

```text
actualRuntimeId=P-RUNTIME-1
verified=true
```

这说明：

```text
Special Command commit
本身不是当前主故障。
```

---

# 2. 真正断点发生在下一次 NORMAL_ENTER

最新日志真实重复出现：

```text
USER-INTENT-EPOCH:
source=NORMAL_ENTER

HANDOFF-CLOSE:
reason=SUPERSEDED_BY_USER_INTENT

CARET-EXPECTATION-CLOSE:
reason=SUPERSEDED_BY_USER_INTENT
restoreAttempted=false
```

紧接：

```text
SELECTION-TRUTH:
runtimeId=null
ordinal=null
logicalOffset=null
insideEditor=false
```

Mutation：

```text
removedParagraphCount=0
addedParagraphCount=0
selectionRuntimeId=none
mutationShape=NONE
```

这个序列至少重复出现两轮。

---

# 3. 核心 P0-A — Caret Ownership Gap

当前逻辑：

```text
SpecialCommand CaretExpectation
↓
NORMAL_ENTER
↓
关闭旧 CaretExpectation
关闭旧 Handoff
↓
Typora native Enter
↓
没有新的 NormalEnter caret owner
↓
selection lost
```

这是当前最重要的根因。

---

# 4. 正确模型必须是 Ownership Handover

必须改成：

```text
old SpecialCommand caret owner
↓
NORMAL_ENTER begins
↓
create NormalEnterContinuityTransaction
↓
new transaction TAKES OWNERSHIP
↓
then close old Special expectation/handoff
↓
native Enter mutation
↓
new transaction owns caret until final verify
```

原则：

```text
OLD OWNER CLOSE
只能发生在
NEW OWNER ACTIVE
之后
```

禁止：

```text
close old owner
↓
no new owner
```

---

# 5. 新增 NormalEnterContinuityTransaction

建议：

```ts
interface NormalEnterContinuityTransaction {
  id: string;

  intentId: string;
  intentEpoch: number;

  scopeId: string;
  persistenceKey: string | null;

  sourceElement: HTMLElement;
  sourceRuntimeId: string;
  sourceOrdinal: number;

  sourceCanonicalRecordId: string | null;
  sourceCanonicalGeneration: number | null;

  sourceSemantic:
    | "auto"
    | "force-indent"
    | "force-flush";

  sourceComputedIndent: string;

  preSelectionLogicalOffset: number | null;

  preSiblingRuntimeIds: string[];
  preParagraphCount: number;

  rawMutationRecords: MutationRecord[];

  completedOriginalElement: HTMLElement | null;
  completedOriginalRuntimeId: string | null;

  caretDestinationElement: HTMLElement | null;
  caretDestinationRuntimeId: string | null;

  postSelectionRuntimeId: string | null;
  postSelectionLogicalOffset: number | null;

  structuralDecision:
    | "PENDING"
    | "SPLIT_1_TO_2"
    | "SAME_P_BR"
    | "REPLACED_1_TO_1"
    | "UNKNOWN";

  semanticContinuityVerified: boolean;
  visualContinuityVerified: boolean;
  caretContinuityVerified: boolean;

  active: boolean;
  createdAt: number;
}
```

---

# 6. Normal Enter 必须独立于 Special Command transaction

禁止把：

```text
EnterIndentTransaction
```

继续扩展成一个万能事务。

应单独：

```text
SpecialCommandTransaction
```

和：

```text
NormalEnterContinuityTransaction
```

职责必须分开。

---

# 7. NORMAL_ENTER Pre-State Capture

在 Typora native Enter mutation 前必须捕获：

```text
NORMAL-ENTER-PRE:
txnId=...
scopeId=...
sourceRuntimeId=...
sourceOrdinal=...
sourceRecordId=...
sourceGeneration=...
sourceSemantic=...
sourceComputedIndent=...
logicalOffset=...
paragraphCount=...
siblingRuntimeIds=[...]
selectionInsideEditor=true
```

---

# 8. First-Line 必须显式记录

新增：

```text
isFirstParagraph=true|false
previousParagraphRuntimeId=none|...
```

第一行：

```text
ordinal=0
previousParagraphRuntimeId=none
```

必须进入 acceptance。

---

# 9. 第一行不能依赖“上一段 fallback”

任何 caret fallback：

```text
previous sibling
previous paragraph
nearest previous connected P
```

在：

```text
ordinal=0
```

必须禁止。

第一行无法 resolve 时：

```text
BLOCK / DEFER / explicit restore to known new destination
```

禁止把 selection collapse 到 editor 外。

---

# 10. P0-C — First Interaction Context Race

最新 runtime 已证明：

真实 editor 中已经存在：

```text
P-RUNTIME-1
insideEditor=true
```

但前几次：

```text
POINTER
NORMAL_ENTER
```

仍然：

```text
scopeId=unknown
documentMode=NO_EDITOR
```

随后 MutationObserver 才：

```text
STALE_CONTEXT_CORRECTION
NO_EDITOR → EPHEMERAL
```

这必须修。

---

# 11. Editor Ready 必须先于 Trusted User Input

正确 invariant：

```text
if editorRoot exists
AND user event target is inside editor
THEN
DocumentRuntimeContext must not remain NO_EDITOR
```

---

# 12. First Interaction Gate

所有：

```text
POINTER
NORMAL_ENTER
TEXT_INPUT
SPECIAL_COMMAND
BACKSPACE
```

在 trusted event capture 时：

如果：

```text
event target inside actual editor
AND context.mode=NO_EDITOR
```

必须先：

```text
bind/sync editor runtime
refresh context
```

然后才：

```text
beginTrustedUserIntent
```

---

# 13. 禁止 mutation observer 才修 context

当前：

```text
first Enter
↓
mutation
↓
STALE_CONTEXT_CORRECTION
```

太晚。

目标：

```text
first Enter keydown
↓
context already EPHEMERAL
↓
transaction starts
```

---

# 14. First-Interaction Trace

新增：

```text
FIRST-INTERACTION-CONTEXT-CHECK:
eventType=keydown
key=Enter
editorRootExists=true
eventInsideEditor=true
modeBefore=NO_EDITOR
decision=REFRESH_BEFORE_INTENT
modeAfter=EPHEMERAL
scopeId=...
```

正常稳定后：

```text
decision=ALREADY_READY
```

---

# 15. First Interaction Hard Stop

如果：

```text
eventInsideEditor=true
AND modeAfter=NO_EDITOR
```

必须：

```text
NORMAL_ENTER transaction = BLOCK
```

并输出：

```text
FIRST-INTERACTION-CONTEXT-VIOLATION
```

禁止继续无 scope Enter orchestration。

---

# 16. P0-B — MutationObserver Blind Spot

当前真实 NORMAL_ENTER 多次出现：

```text
removedParagraphCount=0
addedParagraphCount=0
mutationShape=NONE
```

不能再解释成：

```text
没有结构变化
```

只说明：

```text
paragraph-level classifier 没看懂变化
```

---

# 17. 必须捕获 Raw MutationRecord

对 active NormalEnter transaction：

记录所有原始 MutationRecord：

```text
type
target tag
target runtimeId
addedNodes
removedNodes
added nodeName
removed nodeName
parent
previousSibling
nextSibling
textContent change summary
```

---

# 18. 新增 NORMAL-ENTER-RAW-MUTATION

示例：

```text
NORMAL-ENTER-RAW-MUTATION:
txnId=...
index=1
type=childList
targetTag=P
targetRuntimeId=P-RUNTIME-1
added=[BR]
removed=[]
previousSibling=...
nextSibling=...
```

或者：

```text
added=[P,P]
removed=[P]
```

必须真实记录 Typora 当前版本究竟怎么改 DOM。

---

# 19. 禁止只依赖 top-level P add/remove

当前 classifier：

```text
SPLIT_1_TO_2
```

只能覆盖：

```text
1 removed P
2 added P
```

现在必须支持至少识别：

```text
A. top-level split
B. same-P BR insertion
C. nested inline split
D. replace 1→1 + later insert
E. unknown multi-step mutation
```

---

# 20. Pre/Post Structural Diff Authority

除了 raw MutationRecord，
必须比较 transaction 前后：

```text
top-level paragraph list
runtimeIds
text snapshots
connected state
sibling order
selection target
```

不能只看单个 observer batch。

---

# 21. Transaction-local mutation window

Normal Enter transaction 应在：

```text
keydown/beforeinput
```

开始，

收集：

```text
same synchronous turn
microtask
RAF
必要时 next microtask
```

里的 mutation。

禁止把任意未来 MutationObserver 全部归入该 Enter。

---

# 22. Mutation Window 必须由 intentId/txnId 关联

每条：

```text
NORMAL-ENTER-RAW-MUTATION
NORMAL-ENTER-POST
```

必须携带：

```text
txnId
intentEpoch
```

避免与后续用户输入混淆。

---

# 23. Structural Resolution 不能再等同于 Mutation Shape

建立：

```text
NormalEnterStructuralDecision
```

至少：

```text
TOP_LEVEL_SPLIT
SAME_PARAGRAPH_LINE_BREAK
REPLACED_PARAGRAPH
NO_STRUCTURAL_CHANGE
UNKNOWN
```

---

# 24. P0-D — Visual Indent Continuity

当前日志证明：

普通 Enter 后：

```text
originalSemantic=force-indent
```

仍保持。

因此“缩进取消”不能先假设为 semantic reset。

必须记录：

```text
old semantic
old computed indent
completed paragraph semantic
completed paragraph computed indent
caret destination semantic
caret destination computed indent
```

---

# 25. NORMAL-ENTER-POST Trace

必须：

```text
NORMAL-ENTER-POST:
txnId=...
decision=...
sourceRuntimeId=...
completedRuntimeId=...
caretDestinationRuntimeId=...
sourceSemantic=force-indent
completedSemantic=...
caretDestinationSemantic=...
sourceComputedIndent=32px
completedComputedIndent=...
caretDestinationComputedIndent=...
selectionRuntimeId=...
selectionLogicalOffset=...
selectionInsideEditor=...
```

---

# 26. 需要明确产品语义

Normal Enter 从：

```text
force-indent paragraph
```

执行后：

```text
completed original paragraph
```

必须继续：

```text
force-indent
```

新 caret destination：

默认应根据产品规则确定。

如果当前设计是：

```text
new paragraph inherits document default
```

则记录：

```text
caretDestinationSemantic=auto
```

如果设计是：

```text
new paragraph inherits force-indent
```

则明确测试。

禁止当前 runtime“偶然顶格”而没有语义决定。

---

# 27. 当前推荐语义

基于现有 canonicalOwner / caretDestination 设计：

```text
completed original
保留原 CanonicalRecordId / force-indent

new paragraph
作为 caret destination
默认 auto
```

但它必须是：

```text
明确 semantic auto + 正确 visual projection
```

而不是因为 resolver 漏掉导致无样式。

---

# 28. SAME_P_BR 视觉问题

如果 Typora native Enter 结果实际是：

```text
same <p>
+ <br>
```

那么 CSS `text-indent` 只会影响第一视觉行。

这会自然出现：

```text
第二视觉行顶格
```

此时不能误以为 semantic reset。

必须明确判断：

```text
same paragraph logical line break
```

是否符合插件产品模型。

---

# 29. 如果 SAME_P_BR 不符合产品模型

如果插件业务语义要求：

```text
每个 Enter 都形成独立 paragraph layout unit
```

则不能依赖 Typora 保持 same `<p><br>`。

需要在确认真实 DOM 后：

```text
等待 Typora 完成自身 normalization
```

再处理。

禁止插件强行同步重写 DOM，
除非已经证明 Typora 不会 normalize。

---

# 30. 禁止立即 DOM surgery

本轮第一阶段只：

```text
observe
classify
preserve selection
preserve semantic
```

不要先：

```text
split DOM manually
replace P manually
insert P manually
```

否则会和 Typora native editor 冲突。

---

# 31. P0-A 新 Caret Ownership

Normal Enter transaction 必须有：

```text
caretOwnershipState:
CAPTURED_PRE
NATIVE_MUTATION_PENDING
DESTINATION_RESOLVED
VERIFIED
FAILED
```

---

# 32. NORMAL_ENTER 接管旧 expectation

在 begin NormalEnter transaction 后：

```text
NORMAL-ENTER-CARET-HANDOVER:
fromExpectationId=...
fromHandoffId=...
toTxnId=...
decision=TAKE_OWNERSHIP
```

然后才：

```text
old expectation close
old handoff close
```

---

# 33. 旧 expectation close reason

不要继续全部：

```text
SUPERSEDED_BY_USER_INTENT
```

对于 Normal Enter ownership handover：

```text
reason=OWNERSHIP_TRANSFERRED_TO_NORMAL_ENTER
```

更准确。

---

# 34. Caret Destination Resolution

优先使用 transaction-local post state：

```text
post native selection
```

如果 selection 仍有效且 inside editor：

```text
adopt current selection target
```

不要无条件 restore。

---

# 35. Selection still valid = no caret write

如果：

```text
selectionInsideEditor=true
caret destination plausible
```

必须：

```text
caretWriteAttempted=false
```

---

# 36. Selection lost = guarded restore

只有：

```text
selectionExists=false
OR
insideEditor=false
```

才允许 restore。

restore target 必须是：

```text
transaction-resolved caretDestination
```

禁止：

```text
source paragraph
previous paragraph
nearest paragraph
```

作为 silent fallback。

---

# 37. First-Line Restore

第一行：

```text
previousParagraphRuntimeId=none
```

selection lost 时：

只能：

```text
resolved new caretDestination
```

否则：

```text
NORMAL-ENTER-CARET-FAIL
decision=BLOCK
```

不能把 focus 弄到 editor 外。

---

# 38. Caret Restore Trace

```text
NORMAL-ENTER-CARET-RESTORE:
txnId=...
reason=SELECTION_LOST
targetRuntimeId=...
targetOrdinal=...
isFirstParagraph=true|false
previousParagraphRuntimeId=...
restoreAttempted=true
restoreSuccess=true|false
```

---

# 39. End-to-End Success Gate 重定义

当前：

```text
ENTER-COMMIT-ATOMIC overallSuccess=true
```

只能叫：

```text
SPECIAL-COMMAND-COMMIT-SUCCESS
```

不能代表 editor continuity。

---

# 40. 新 Success Gate

必须新增：

```text
EDITOR-CONTINUITY-FINAL:
txnId=...
commandCommitSuccess=true
normalEnterObserved=true
structuralDecision=...
semanticContinuity=true
visualContinuity=true
caretContinuity=true
selectionInsideEditor=true
overall=true
```

---

# 41. Special Command End-to-End Acceptance

真正的完整 case：

```text
type text
↓
`。。+Enter`
↓
continue typing
↓
Normal Enter
↓
type next line
```

最终：

```text
selection inside editor
no jump to previous paragraph
completed paragraph retains indent semantic
caret destination matches native/new line
```

---

# 42. 禁止再用 150ms command close 作为最终 PASS

Special transaction 可以 150ms close。

但：

```text
user-visible continuity
```

必须单独由：

```text
NormalEnterContinuityTransaction
```

验收。

---

# 43. First-Line Case 必须单独验收

Case F1：

```text
空 Untitled
第一段第一行
输入 abc
执行 `。。+Enter`
继续输入 def
Normal Enter
继续输入 ghi
```

必须：

```text
caret never disappears
selectionInsideEditor=true
previousParagraphRuntimeId=none
```

---

# 44. First-Line Direct Enter

Case F2：

```text
新建空 Untitled
第一行直接输入文本
普通 Enter
```

必须：

```text
NO_EDITOR user intent = 0
selection lost = 0
```

---

# 45. Indented Paragraph Case

Case I1：

```text
paragraph force-indent
↓
ordinary Enter
```

必须记录：

```text
pre semantic=force-indent
pre computed=32px
```

post：

```text
completed original semantic=force-indent
completed computed=32px
```

---

# 46. New Destination Semantic 必须明确

post：

```text
caret destination semantic=<explicit>
caret destination computed=<expected>
```

不能：

```text
unknown
null
not observed
```

---

# 47. Jump-to-Previous-Line Case

Case J1：

```text
P1 normal
P2 force-indent
caret at P2
Normal Enter
```

必须：

```text
post selection
!= P1
```

---

# 48. Explicit Previous-Line Guard

如果：

```text
postSelectionRuntimeId == previousParagraphRuntimeId
```

且 transaction pre-caret 不在 previous paragraph：

输出：

```text
NORMAL-ENTER-PREVIOUS-PARAGRAPH-JUMP:
decision=FAIL
```

---

# 49. Caret Lost Guard

如果：

```text
selectionExists=false
OR
insideEditor=false
```

输出：

```text
NORMAL-ENTER-SELECTION-LOSS:
txnId=...
sourceRuntimeId=...
sourceOrdinal=...
isFirstParagraph=...
structuralDecision=...
decision=FAIL
```

---

# 50. Scope 在本轮怎么处理

Scope Authority 不是本轮主线，
但 NormalEnter transaction 必须 snapshot：

```text
scopeId
persistenceKey
```

只用于：

```text
same transaction guard
```

不要本轮继续扩大 Registry scope architecture。

---

# 51. Same-Scope Proof

当前三个 bug 都必须在：

```text
same scope
```

下复现和修复。

如果 transaction scope 变化：

```text
close transaction
reason=SCOPE_CHANGED
```

即可。

---

# 52. Save-As / Document Switch HARD FREEZE

本轮禁止修改：

```text
file:will-save
PendingPersistencePromotion
SAVE_AS_PROMOTION
DOCUMENT_SWITCH classifier
```

---

# 53. Registry Scope Authority 暂时冻结

当前 build 已新增：

```text
RECORD-LIFECYCLE scopeId
RUNTIME-SCOPE-SNAPSHOT
CARET-EXPECTATION scopeId
HANDOFF scopeId
```

本轮只做必要编译兼容。

不要继续扩展：

```text
assertCanonicalScope
full Registry firewall
```

直到 Normal Enter 用户故障先闭环。

---

# 54. SelectionTruth HARD FREEZE

不要重写：

```text
resolveSelectionTruth
logical offset normalization
runtimeId resolver
```

当前 selection 存在时 resolver 工作正常。

问题是：

```text
selection 被丢失
```

不是 resolver 不认识 selection。

---

# 55. Mutation Shape Authority 部分解冻

不要删除已有：

```text
SPLIT_1_TO_2
MERGE_2_TO_1
REPLACE_1_TO_1
```

但不能再把它们当作 Normal Enter 唯一结构 authority。

---

# 56. 新 Normal Enter Resolver 不替代 Merge

只处理：

```text
source=NORMAL_ENTER
```

Backspace / Merge 不进入本轮。

---

# 57. Raw Mutation Test NT-1

模拟：

```text
1 removed P
2 added P
```

必须：

```text
TOP_LEVEL_SPLIT
```

---

# 58. Raw Mutation Test NT-2

模拟：

```text
same P
childList added BR
```

必须：

```text
SAME_PARAGRAPH_LINE_BREAK
```

---

# 59. Raw Mutation Test NT-3

模拟：

```text
0 removed top-level P
0 added top-level P
but nested inline/text mutation exists
```

必须：

```text
NOT classify as NO_CHANGE blindly
```

而：

```text
UNKNOWN or SAME_PARAGRAPH_LINE_BREAK
```

根据 raw evidence。

---

# 60. First Interaction Test FI-1

输入：

```text
context=NO_EDITOR
editorRoot exists
event target inside editor
```

必须：

```text
refresh before intent
modeAfter=EPHEMERAL
```

---

# 61. First Interaction Test FI-2

如果 refresh 失败：

```text
Normal Enter BLOCK
```

不能：

```text
USER-INTENT-EPOCH scopeId=unknown
```

继续执行。

---

# 62. Caret Handover Test CH-1

Active Special expectation：

```text
E1
```

Normal Enter arrives：

必须：

```text
Normal transaction N1 active
BEFORE
E1 closes
```

---

# 63. Caret Handover Test CH-2

禁止出现：

```text
active owner count = 0
```

在 ownership handover 的同步路径中。

---

# 64. First-Line Test FL-1

```text
ordinal=0
selection lost
```

不得 fallback previous paragraph。

---

# 65. Indent Continuity Test IC-1

```text
sourceSemantic=force-indent
```

普通 Enter 后：

```text
completed original
force-indent retained
```

---

# 66. Indent Continuity Test IC-2

如果 native DOM 为 same-P BR：

必须明确输出：

```text
SAME_PARAGRAPH_LINE_BREAK
```

并验证用户视觉规则。

---

# 67. Runtime Acceptance RA1 — First Interaction

新建 Untitled 后：

```text
第一次 pointer
第一次 Normal Enter
第一次 text input
```

所有 inside-editor intent：

```text
scopeId=unknown
documentMode=NO_EDITOR
= 0
```

---

# 68. Runtime Acceptance RA2 — `。。+Enter` → Normal Enter

至少 10/10：

```text
text
↓
。。+Enter
↓
continue typing
↓
Normal Enter
↓
continue typing
```

必须：

```text
previous paragraph jump = 0
selection loss = 0
```

---

# 69. Runtime Acceptance RA3 — First Line

至少 10/10：

```text
first paragraph
ordinary Enter
```

必须：

```text
selectionExists=true
insideEditor=true
```

---

# 70. Runtime Acceptance RA4 — Indent Continuity

至少 10/10：

```text
force-indent paragraph
↓
ordinary Enter
```

必须：

```text
completed original semantic preserved
completed original computed indent preserved
```

---

# 71. Runtime Acceptance RA5 — New Paragraph Semantics

每次 Normal Enter：

必须明确记录：

```text
caret destination semantic
caret destination computed indent
```

禁止 missing。

---

# 72. Runtime Acceptance RA6 — Raw Mutation Coverage

至少收集：

```text
10 个 Normal Enter
```

输出真实 mutation shape 分布：

```text
TOP_LEVEL_SPLIT count
SAME_PARAGRAPH_LINE_BREAK count
REPLACED_PARAGRAPH count
UNKNOWN count
```

---

# 73. UNKNOWN 不得 silently PASS

任何：

```text
UNKNOWN
```

如果伴随：

```text
selection lost
visual mismatch
```

必须 FAIL。

---

# 74. Runtime Acceptance RA7 — Selection owner

Normal Enter 整条 transaction：

```text
caret ownership gap count = 0
```

---

# 75. Runtime Acceptance RA8 — Regression

继续：

```text
Special Command synchronous commit
10/10

SelectionTruth while selection exists
PASS

Split existing cases
PASS

Sidecar EPHEMERAL suppression
PASS

Single-Dot CURRENT_LIVE
INFO only
```

---

# 76. Hard Stop List

任一：

```text
NORMAL_ENTER 后立刻无 new caret owner

旧 CaretExpectation 先 close，
NormalEnter transaction 尚未 active

selectionExists=false

insideEditor=false

postSelectionRuntimeId == previousParagraphRuntimeId
且 pre-caret 不在 previous paragraph

first-line 使用 previous paragraph fallback

force-indent completed paragraph visual indent 丢失

Normal Enter 仍只有 mutationShape=NONE
但没有 raw mutation evidence

SAME_P_BR 被当成 no mutation

NO_EDITOR inside-editor user input 仍发生

RUNTIME-SCOPE-SNAPSHOT 创建后未绑定 NormalEnter transaction

ENTER-COMMIT-ATOMIC 被直接当 end-to-end PASS

通过手写 DOM surgery 掩盖 unknown native shape

修改 Save-As classifier

修改 persisted historical resolver

修改 Merge algorithm
```

立即：

```text
R58.7 EDITOR INTERACTION EMERGENCY REPAIR NOT FIXED — R60 BLOCKED
```

---

# 77. 禁止假修复

禁止：

```text
给 selection lost 加 setTimeout restore 到上一段

Normal Enter 后总是 restore 到 source paragraph

first-line 时 focus editor body 代替 caret target

强制 caret.setPosition(previousParagraph)

只把 mutationShape=NONE 改名

只新增日志，不建立 transaction

用 150ms timer 猜 Typora DOM 完成

每次 Enter 手动拆 P

为了视觉 indent 给所有新行直接加 32px

修改 defaultIndent 来掩盖问题

把 new paragraph 永久 force-indent
除非产品规则明确如此

再次修改 token recognition

再次修改 Single-Dot
```

---

# 78. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-indent-manager.ts
```

可能新增：

```text
src/heading-numbering/normal-enter-continuity.ts
```

建议把：

```text
NormalEnterContinuityTransaction
raw mutation aggregation
pre/post structural resolver
```

独立到新文件，避免继续让 service 膨胀。

---

# 79. 不推荐修改

本轮避免：

```text
paragraph-canonical-registry.ts
paragraph-layout-store.ts
document-runtime-context.ts
Save-As provenance code
Merge resolver
```

除非是最小类型适配。

---

# 80. Source Map — Normal Enter

修改前必须输出：

```text
keydown Enter capture

beforeinput insertParagraph / insertLineBreak

beginTrustedUserIntent NORMAL_ENTER

old handoff close

old caret expectation close

MutationObserver callback

paragraph add/remove aggregation

mutation shape classification

selection resolver call

post-Enter refresh

caret restore path
```

---

# 81. Source Map — First Interaction

必须输出：

```text
editorRoot bind

editor load

document context refresh

pointer capture

keydown capture

beforeinput capture

mutation observer self-heal
```

确认：

```text
为什么 user intent 会先于 context ready
```

---

# 82. Source Map — Visual Indent

必须输出：

```text
semantic writer

effective CSS writer

text-indent calculation

force-indent class

new paragraph creation

refresh projection

post-Enter style application
```

---

# 83. 修改前必须回答 6 个 Root Causes

1.

```text
为什么 NORMAL_ENTER 到来时，
旧 CaretExpectation/Handoff 会立即关闭，
但没有新的 caret owner？
```

2.

```text
为什么真实 Enter 后 MutationObserver 多次得到
removed=0 / added=0 / mutationShape=NONE？
Typora 实际 DOM 到底发生了什么？
```

3.

```text
为什么 selection 会在 Normal Enter 后变成：
runtimeId=null
insideEditor=false？
```

4.

```text
为什么 editor 已经存在 P-RUNTIME-1，
前几次 user intent 仍然是 NO_EDITOR / scopeId=unknown？
```

5.

```text
用户看到“缩进取消”时，
canonical semantic 是否真的从 force-indent 变 auto，
还是 visual line / paragraph structure 变化导致？
```

6.

```text
为什么第一行比中间段落更容易出现 caret disappear？
当前是否存在 previous-paragraph fallback？
```

---

# 84. Build ID

必须唯一：

```text
inkchapter-r58-7-editor-continuity-normal-enter-<unique>
```

---

# 85. Typecheck / Tests / Build

执行：

```powershell
pnpm exec tsc --noEmit

pnpm test

pnpm run build:dev

powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

必须记录：

```text
typecheck exit

tests count

new tests count

build exit

project SHA

deployed SHA

shaMatch

style SHA

Build ID
```

---

# 86. Restart / Strict Startup

启动或重启必须验证：

```text
old Typora process exited

new PID

new StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

target document / Untitled

plugin main path

plugin SHA

project SHA

shaMatch=true

style SHA

Build ID

initializationCount=1
```

---

# 87. Startup Evidence Rule

任何 mandatory 缺失：

必须原样：

```text
启动命令已发出，但尚未确认成功
```

---

# 88. Runtime Test 顺序

必须严格：

```text
restart
↓
strict startup
↓
new Untitled
↓
First Interaction Case
↓
First-Line Direct Enter
↓
Special + Normal Enter chain
↓
Indented Paragraph Enter
↓
Previous-Line Jump Case
↓
10x repeated acceptance
↓
raw mutation distribution
↓
final continuity audit
```

---

# 89. Final Runtime Audit

必须输出：

```text
NORMAL-ENTER-CONTINUITY-AUDIT:

normalEnterCount=...

contextUnknownCount=0

caretOwnershipGapCount=0

selectionLossCount=0

previousParagraphJumpCount=0

firstLineFailureCount=0

completedIndentSemanticLossCount=0

completedIndentVisualLossCount=0

topLevelSplitCount=...

sameParagraphBrCount=...

replacedParagraphCount=...

unknownStructuralCount=...

overall=PASS|FAIL
```

---

# 90. Acceptance 分层

以后必须分别报告：

```text
SOURCE COMPLETE

UNIT TEST COMPLETE

BUILD COMPLETE

DEPLOY COMPLETE

STARTUP VERIFIED

RUNTIME ACCEPTANCE COMPLETE
```

只有：

```text
RUNTIME ACCEPTANCE COMPLETE
```

才允许最终 PASS。

---

# 91. Final PASS

只有全部 mandatory runtime gate 真实通过：

```text
R58.7 EDITOR INTERACTION EMERGENCY REPAIR PASS
— NORMAL ENTER / FIRST-LINE / CARET / INDENT CONTINUITY CLOSED
```

---

# 92. Final FAIL

任何：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 EDITOR INTERACTION EMERGENCY REPAIR NOT FIXED — R60 BLOCKED
```

---

# 93. Execution Rules

直接操作：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

禁止：

```text
git add
git commit
git push
```

允许：

```text
git status
git diff
```

禁止编造：

```text
raw MutationRecord
DOM shape
selection state
caret destination
semantic continuity
visual indent
first-line behavior
PID
StartTime
MainWindowHandle
MainWindowTitle
SHA
Build ID
runtime acceptance count
```

---

# 94. 第一执行动作

不要先改代码。

先输出：

```text
Normal Enter Source Map

First Interaction Source Map

Caret Ownership Source Map

Mutation Capture Source Map

Visual Indent Projection Source Map
```

然后回答 Section 83 的 6 个 root-cause 问题。

接下来先加：

```text
diagnostics + transaction skeleton
```

用真实 runtime 捕获 Typora Normal Enter 的原始 DOM 行为。

在没有得到 raw MutationRecords 前：

```text
禁止手写 DOM 修复算法
```

确认真实 DOM shape 后，
再实施最小修复。

---

# 95. 本轮最核心原则

```text
NORMAL_ENTER
不是一个简单的 UserIntent。

NORMAL_ENTER
是一个 Editor Continuity Transaction。
```

以及：

```text
Caret ownership
必须 hand over，
不能被 destroy 后等待浏览器自行决定。
```

最终用户级 invariant：

```text
`。。+Enter`
↓
继续输入
↓
普通 Enter
↓
继续输入

光标永不跳到上一段
光标永不离开 editor
第一行不消失
已完成缩进段落的 semantic/visual indent 不丢失
```

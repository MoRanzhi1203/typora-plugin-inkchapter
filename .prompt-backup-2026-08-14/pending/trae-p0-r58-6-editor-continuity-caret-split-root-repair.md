# TRAE P0 — R58.6 Editor Continuity Transaction + Caret Continuity + DOM Mutation Classification

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Editor Continuity Root Repair**
>
> Current authoritative status:
>
> ```text
> R58.5 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮目标：
>
> 1. 修复 `。。+Enter` 后首行缩进成功但光标跳到上一行；
> 2. 修复此后 ↓ 无法正常回到目标缩进行；
> 3. 修复缩进行输入正文后再次 Enter，原段落回到顶格；
> 4. 让 canonical identity continuity、semantic/visual continuity、caret/selection continuity 统一进入一次 `EditorContinuityTransaction`；
> 5. 区分 Typora DOM mutation 的 `REPLACE_1_TO_1`、`SPLIT_1_TO_2`、必要时 `MERGE_2_TO_1`；
> 6. 对 Enter split 明确区分：
>    - canonical owner replacement
>    - caret destination
> 7. 强制 `LiveOwnershipProof` 真正成为 Promotion / Backspace / UI mutation 的 hard authorization；
> 8. 保持 R58.2–R58.5 已验证有效架构不回退；
> 9. 保持 physical sidecar / persisted historical 现有成果，并禁止 historical records 干扰 current-session continuity；
> 10. 修正 startup plugin artifact path。

---

# 0. 最新真实 Runtime Ground Truth

最新 runtime Build：

```text
inkchapter-r58-5-live-ownership-lease-dom-continuity-n7r2x
```

已真实确认：

```text
vaultRoot =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

SIDECAR-ACTUAL-LOAD:
exists=true
recordCount=6
source=physical
backend=filesystem

PERSISTED_HISTORICAL registration:
已实际发生

CURRENT_LIVE:
MATCH-LIVE-BINDING only

CURRENT_LIVE rehydrate:
dirty=false
reason=live-projection-only
writeScheduled=false

current-session historical heuristic isolation:
仍保持

Enter One-Shot Handoff:
P-RUNTIME-1 → P-RUNTIME-2
same canonicalRecordId
generation 1→2
recordCount unchanged
```

但同时真实失败：

```text
POST-TOKEN-SELECTION:
caretSuccess=true

随后：
selParagraph=undefined

1500ms/2000ms:
sameAsCommand=false
```

说明：

```text
pre-replacement caret 成功
≠
post-replacement caret continuity 成功
```

---

# 1. 当前三个用户可见 Bug

## Bug A

```text
输入 “。。”
→ Enter
→ 当前行出现首行缩进
→ 光标却移动到上一行
```

## Bug B

```text
光标跳到上一行后
→ 直接按 ↓
→ 无法回到刚刚首行缩进的当前行

必须：
Enter
→ 到下一行
→ ↑
→ 才能回到该行
```

## Bug C

```text
首行缩进的当前行
→ 输入正文
→ 再按 Enter
→ 原段落首行缩进消失
→ 回到顶格
```

这三个现象必须作为同一 Editor Continuity 问题处理，
不能拆成三个局部补丁。

---

# 2. 最新 Runtime 对应关系

## 2.1 命令即时 caret 成功

```text
POST-TOKEN-SELECTION:
commandRuntimeId=P-RUNTIME-1
resolvedRuntimeId=P-RUNTIME-1
anchorOffset=0
sameAsCommand=true
caretSuccess=true

ENTER-COMMIT-ATOMIC:
caretSuccess=true
overallSuccess=true
```

说明：

```text
在 P-RUNTIME-1 尚未被 Typora 替换的瞬间，
caret 写入成功。
```

但这不是最终成功。

---

# 3. 第一次 DOM replacement 后 caret 丢失

随后：

```text
HANDOFF-RESOLVE:
replacementRuntimeId=P-RUNTIME-2

CANONICAL-BINDING-TRANSFER:
P-RUNTIME-1 → P-RUNTIME-2
reason=HANDOFF_REPLACE
```

canonical identity 与 force-indent 成功转移。

但是 observation：

```text
T4_150ms:
selParagraph=undefined

T5_300ms:
selParagraph=undefined

T6_500ms:
selParagraph=undefined

T7_1000ms:
selParagraph=undefined

T8_1500ms:
sameAsCommand=false

T9_2000ms:
sameAsCommand=false
```

因此当前 handoff 实际只完成：

```text
canonical identity continuity
semantic continuity
visual continuity
```

没有完成：

```text
caret / selection continuity
```

---

# 4. 第二次 DOM replacement 后 canonical owner 丢失

在新 current record：

```text
indent-1786438470103-6
```

中：

```text
P-RUNTIME-1
→ HANDOFF_REPLACE
→ P-RUNTIME-2

CURRENT_LIVE
generation=2
```

用户输入正文：

```text
打
这是
这是一个
这是一个段落
```

期间一直：

```text
MATCH-LIVE-BINDING
targetRuntimeId=P-RUNTIME-2

semanticBefore=force-indent
semanticAfter=force-indent
```

之后按 Enter：

```text
CURRENT-LIVE-DISCONNECTED
previousRuntimeId=P-RUNTIME-2

CURRENT_AWAITING_TRANSFER

CANONICAL-TRANSFER-PENDING:
candidateCount=0
handoffId=none

awaitingForMs:
0
78
411
5745
5795
```

说明：

```text
normal editing / Enter split
发生了新的 DOM replacement，
但没有 generic live continuity 接管。
```

---

# 5. R58.5 核心 Generic Replacement 实际没有进入 Runtime

最新 runtime 中：

```text
LIVE-REPLACEMENT-TICKET = 0

LIVE-REPLACEMENT-DETECTED = 0

LIVE-REPLACEMENT-RESOLVE = 0

LIVE-REPLACEMENT-BLOCK = 0

LIVE-REPLACEMENT-MISSED = 0

reason=LIVE_DOM_REPLACEMENT = 0
```

因此：

```text
R58.5 generic DOM replacement architecture
没有真正落到 production runtime path。
```

本轮必须以 runtime trace 为准，
不能因为源码里“已经写了类/函数”就判完成。

---

# 6. LiveOwnershipProof 也没有真正成为 Hard Authorization

最新 runtime 仍出现：

```text
CANONICAL-RECORD-PROMOTION:

stateBefore=CURRENT_LIVE
stateAfter=CURRENT_LIVE

bindingVerified=false
elementConnected=false

decision=PROMOTE
```

这直接违反 R58.5 contract。

并且 physical historical load 后还出现：

```text
PROMOTION-LIFECYCLE-VIOLATION:
state=PERSISTED_HISTORICAL
decision=BLOCK
```

但 service 紧接着又打印：

```text
CANONICAL-RECORD-PROMOTION:
temporary=true→false
state=CURRENT_LIVE
```

说明：

```text
Registry BLOCK result
没有真正成为 service control-flow STOP
```

或 success trace 为无条件假日志。

两者都必须修。

---

# 7. 本轮核心抽象 — EditorContinuityTransaction

新增：

```ts
interface EditorContinuityTransaction {
  continuityId: string;

  recordId: string;
  documentKey: string;

  mutationKind:
    | "REPLACE_1_TO_1"
    | "SPLIT_1_TO_2"
    | "MERGE_2_TO_1";

  oldRuntimeId: string;
  oldGeneration: number;

  canonicalOwnerReplacement?: HTMLElement;
  canonicalOwnerRuntimeId?: string;

  caretDestination?: HTMLElement;
  caretDestinationRuntimeId?: string;

  semanticSnapshot: ParagraphSemanticSnapshot;

  caretSnapshot: LogicalCaretSnapshot;

  evidence: ContinuityEvidence[];

  state:
    | "CREATED"
    | "RESOLVED"
    | "APPLIED"
    | "VERIFIED"
    | "BLOCKED";
}
```

---

# 8. 关键原则：Canonical Owner 和 Caret Destination 不是同一个概念

这是本轮最重要的架构修正。

对于：

```text
REPLACE_1_TO_1
```

通常：

```text
canonicalOwnerReplacement
=
caretDestination
```

例如：

```text
P1 → P2
```

但对于正常 Enter：

```text
SPLIT_1_TO_2
```

可能：

```text
old P2

→ completed paragraph P3
+ new empty paragraph P4
```

此时：

```text
canonicalOwnerReplacement = P3

caretDestination = P4
```

不能把 P4 当成 R1 的 canonical owner。

---

# 9. “。。+Enter” 是一个特殊 Command Continuity Contract

业务语义：

```text
输入 “。。”
→ Enter
```

不是普通 paragraph split。

它代表：

```text
删除 token
→ 将当前 paragraph 设为 force-indent
→ caret 留在当前 paragraph 逻辑开头
```

因此该 command 的 continuity contract：

```text
canonicalOwnerReplacement = replacement current paragraph

caretDestination = replacement current paragraph

logicalCaretOffset = 0
```

即：

```text
owner 与 caret destination 相同
```

---

# 10. 正常正文 Enter 是 Split Contract

例如：

```text
    这是一个段落|
```

用户正常按 Enter：

```text
old paragraph P2
→ completed replacement P3
+ new paragraph P4
```

此时必须：

```text
R1 canonical identity
→ P3

force-indent
→ P3

caret
→ P4
```

禁止：

```text
R1 → P4
```

否则会错误把首行缩进语义绑定到新空段。

---

# 11. Phase A — Source Map

修改前必须定位真实 production paths：

```text
Enter key handler

“。。” command detection

token deletion

POST-TOKEN-SELECTION

ENTER-COMMIT-ATOMIC

activeOneShotHandoff

HANDOFF-RESOLVE

HANDOFF-TRANSFER

Selection / Range writes

resolveCurrentBodyParagraph

resolve selection paragraph

MutationObserver

connectObserver

observer callback

MutationRecord[]

removedNodes

addedNodes

paragraph split behavior

keydown Enter path

composition events

paragraph runtimeId assignment

ParagraphCanonicalRegistry

LiveOwnershipProof implementation

Promotion API

Backspace API

UI update API

historical rehydrate promotion path

service call sites ignoring registry result
```

必须输出：

```text
behavior
→ file
→ function
→ ownership inputs
→ selection inputs
→ current result handling
→ bypass risk
```

先 Source Map，后修改。

---

# 12. Phase B — LogicalCaretSnapshot

新增：

```ts
interface LogicalCaretSnapshot {
  recordId?: string;

  sourceRuntimeId: string;

  logicalOffset: number;

  collapsed: boolean;

  affinity:
    | "forward"
    | "backward";

  capturedGeneration?: number;

  commandKind:
    | "SPECIAL_INDENT_ENTER"
    | "NORMAL_ENTER"
    | "OTHER";
}
```

对于：

```text
。。+Enter
```

必须：

```text
logicalOffset=0
commandKind=SPECIAL_INDENT_ENTER
```

---

# 13. Caret Snapshot 必须是 Logical，不是旧 DOM Node Pointer

禁止长期保存：

```text
Range
TextNode
Node offset
```

作为 replacement 后最终 caret source。

因为旧 node 会被 Typora 删除。

应该保存：

```text
logical paragraph-local offset
```

并在新 replacement 上重新 resolve TextNode / Range。

---

# 14. Pre-Handoff Caret 和 Post-Handoff Caret 分离

当前：

```text
POST-TOKEN-SELECTION
```

只能表示：

```text
pre-handoff immediate selection result
```

建议改名/新增：

```text
PRE-HANDOFF-CARET-SNAPSHOT
```

字段：

```text
continuityId
recordId
runtimeId
logicalOffset
selectionInsideSource
captured=true
```

---

# 15. Post-Handoff Caret 必须重新验证

新增：

```text
POST-HANDOFF-CARET-RESTORE
```

字段：

```text
continuityId
recordId

fromRuntimeId
toRuntimeId

expectedLogicalOffset

caretDestinationRuntimeId

selectionRuntimeId

selectionInsideDestination

actualLogicalOffset

restoreAttempted

verified
```

只有：

```text
verified=true
```

才能计入最终 command success。

---

# 16. Editor Continuity Commit

新增：

```text
EDITOR-CONTINUITY-COMMIT
```

成功必须同时：

```text
identityTransferred=true

semanticTransferred=true

visualVerified=true

generationAdvanced=true

caretResolved=true

caretRestored=true

caretVerified=true

selectionInsideExpectedDestination=true
```

才：

```text
overallSuccess=true
```

---

# 17. 当前 ENTER-COMMIT-ATOMIC 不能继续作为最终成功 Gate

当前：

```text
ENTER-COMMIT-ATOMIC
overallSuccess=true
```

发生在 DOM replacement 之前。

本轮必须调整语义：

```text
ENTER-COMMIT-ATOMIC
=
command-local commit
```

不是 editor continuity 最终 commit。

最终 gate：

```text
EDITOR-CONTINUITY-COMMIT
```

---

# 18. Phase C — DOM Mutation Classification

MutationObserver 必须从真实 `MutationRecord[]` 分类：

```text
REPLACE_1_TO_1

SPLIT_1_TO_2

MERGE_2_TO_1

AMBIGUOUS
```

---

# 19. REPLACE_1_TO_1

定义：

```text
1 old bound paragraph removed

1 compatible paragraph added

same document

same parent / equivalent DOM slot

continuity evidence unique
```

结果通常：

```text
canonicalOwnerReplacement = new paragraph

caretDestination =
根据 command/caret snapshot 决定
```

对于特殊 indent command：

```text
caretDestination = same new paragraph
```

---

# 20. SPLIT_1_TO_2

定义：

```text
1 old bound paragraph removed / structurally replaced

2 logical paragraphs emerge

one represents completed old paragraph

one represents newly-created paragraph after Enter
```

必须解析：

```text
canonicalOwnerReplacement

caretDestination
```

分别是谁。

---

# 21. SPLIT_1_TO_2 Canonical Owner Evidence

允许用于判断 completed old paragraph：

```text
same mutation batch

same parent

structural position relative to old paragraph

old paragraph content prefix/body continuity

new empty paragraph position

editor selection after Enter

MutationRecord ordering

stable sibling boundaries
```

注意：

```text
content continuity
```

这里只作为：

```text
same-mutation local split evidence
```

不能升级成 generic whole-document historical heuristic。

---

# 22. SPLIT_1_TO_2 Caret Destination Evidence

正常 Enter 后：

```text
selection
```

通常应该落在新 paragraph。

允许结合：

```text
browser current Selection

newly-added paragraph

empty/near-empty new paragraph

DOM position

same mutation batch
```

确定：

```text
caretDestination=P4
```

---

# 23. 不允许的 Split Guessing

禁止：

```text
whole-document ordinal-only

whole-document text similarity

first paragraph after old ordinal

first candidate wins

anchor heuristic

proximity resolver
```

所有 split resolution 必须限制在：

```text
same editor mutation continuity scope
```

---

# 24. MERGE_2_TO_1

本轮至少定义并 instrument。

如果 Backspace / Delete 造成：

```text
2 paragraphs
→ 1 paragraph
```

暂时不能可靠 resolve 时：

```text
decision=BLOCK
```

但必须输出：

```text
EDITOR-MUTATION-CLASSIFICATION
kind=MERGE_2_TO_1
```

禁止静默当 1→1。

---

# 25. Phase D — MutationObserver 必须真正进入 Runtime

新增：

```text
EDITOR-MUTATION-BATCH
```

字段：

```text
batchId

removedParagraphCount

addedParagraphCount

removedRuntimeIds

addedRuntimeIds

activeCanonicalOwners

selectionRuntimeId

documentKey
```

然后：

```text
EDITOR-MUTATION-CLASSIFICATION
```

字段：

```text
batchId
kind
candidateCount
reason
```

---

# 26. Generic Continuity Runtime Hard Gate

本轮 runtime 必须出现：

```text
EDITOR-MUTATION-BATCH

EDITOR-MUTATION-CLASSIFICATION

EDITOR-CONTINUITY-RESOLVE
```

如果一次真实 normal Enter/re-render 后：

```text
以上 trace 全部为 0
```

则：

```text
R58.6 FAIL
```

禁止“源码已实现但 runtime 没进路径”继续算完成。

---

# 27. Phase E — Canonical Transfer 与 Caret Transfer 分开 Apply

`EditorContinuityTransaction` apply 顺序建议：

```text
1. classify mutation

2. resolve canonicalOwnerReplacement

3. resolve caretDestination

4. validate current generation

5. transfer canonical binding

6. project semantic / visual state

7. restore caret

8. verify caret

9. final commit
```

---

# 28. Canonical Binding Transfer

继续复用已验证：

```text
CANONICAL-BINDING-TRANSFER
```

不得重写 identity core。

对于：

```text
REPLACE_1_TO_1
```

reason：

```text
LIVE_DOM_REPLACEMENT
```

对于：

```text
SPLIT_1_TO_2
```

reason：

```text
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 29. Caret Transfer 不能绑死在 Canonical Owner 上

新增：

```text
CARET-CONTINUITY-TRANSFER
```

字段：

```text
continuityId

mutationKind

fromRuntimeId

canonicalOwnerRuntimeId

caretDestinationRuntimeId

expectedLogicalOffset

actualLogicalOffset

selectionInsideDestination

verified
```

---

# 30. 特殊 Indent Command Caret Gate

对于：

```text
SPECIAL_INDENT_ENTER
```

必须：

```text
canonicalOwnerRuntimeId
==
caretDestinationRuntimeId
```

并：

```text
logicalOffset=0
```

最终 selection 必须在该 paragraph 内。

---

# 31. Normal Enter Caret Gate

对于：

```text
NORMAL_ENTER
```

在 `SPLIT_1_TO_2`：

```text
canonicalOwnerRuntimeId
!=
caretDestinationRuntimeId
```

通常应成立。

如果代码仍默认：

```text
caretDestination = canonicalOwner
```

则：

```text
HARD STOP
```

---

# 32. Phase F — Selection Restore

需要新增等价：

```ts
restoreLogicalCaret(
  destination: HTMLElement,
  logicalOffset: number
): CaretRestoreResult
```

必须：

```text
resolve current text node

clamp logicalOffset

create fresh Range

Selection.removeAllRanges()

Selection.addRange()
```

不能使用旧 detached Range。

---

# 33. Caret Restore 时机

建议：

```text
transfer semantic
↓
microtask
↓
restore caret
↓
requestAnimationFrame
↓
verify
```

如果 Typora 在同一 tick 内再次重写 DOM，
允许最多一次 generation-aware retry。

禁止：

```text
无限 setTimeout 抢焦点

每次 refresh 强写 selection
```

---

# 34. Caret Retry 必须 Generation-Aware

如果 restore 后 owner 再次 replacement：

```text
old generation proof
```

必须失效。

retry 必须基于：

```text
new continuity transaction
```

或当前 valid generation。

禁止旧 callback 把 caret 写回 stale element。

---

# 35. Selection Verification

新增：

```ts
verifyCaretDestination(...)
```

必须检查：

```text
Selection.rangeCount > 0

selection anchor node connected

destination.contains(anchorNode)

resolved paragraph === expected destination

logical offset correct
```

对于 collapsed caret：

```text
focusNode
```

也应位于同一 destination。

---

# 36. 方向键 Bug 的验收

`。。+Enter` 完成后：

```text
selectionInsideExpectedDestination=true
```

然后真实测试：

```text
↑
↓
```

不得进入：

```text
selParagraph=undefined
```

稳定状态。

至少记录：

```text
CARET-NAVIGATION-AUDIT
```

字段：

```text
beforeRuntimeId
key
afterRuntimeId
selectionParagraphResolved
```

---

# 37. 不要拦截 Arrow Keys 修假象

禁止：

```text
keydown ArrowDown
→ 手工跳到目标 paragraph
```

作为本轮主修复。

方向键异常是 selection graph 错误的结果。

必须先保证：

```text
post-handoff Selection
```

真实位于正确 editable paragraph。

---

# 38. Phase G — LiveOwnershipProof 真正落地

保留：

```ts
interface LiveOwnershipProof {
  recordId: string;
  documentKey: string;
  runtimeId: string;
  element: HTMLElement;
  generation: number;
}
```

Registry 必须真正提供：

```text
resolveLiveOwnershipProof()
```

---

# 39. Proof 必须 Hard Authorize

以下 API 只能接：

```text
LiveOwnershipProof
```

- Promotion
- Backspace
- UI existing update

不能继续只传：

```text
recordId
```

---

# 40. Promotion 必须 STOP on Registry BLOCK

Service 必须：

```text
const result = registry.promoteExisting(...)

if (!result.ok) {
    return
}
```

之后才允许：

```text
success trace
sidecar dirty
write scheduling
```

---

# 41. Promotion Success Trace Contract

只有：

```text
bindingVerified=true

elementConnected=true

generationMatches=true

runtimeIdMatches=true

decision=PROMOTE
```

才允许打印：

```text
CANONICAL-RECORD-PROMOTION
```

否则只能：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

---

# 42. Historical Promotion Block

`PERSISTED_HISTORICAL`：

禁止：

```text
Promotion
```

如果 Registry：

```text
decision=BLOCK
```

service 不能再打印：

```text
state=CURRENT_LIVE
promotion success
```

新增 hard diagnostic：

```text
REGISTRY-BLOCK-IGNORED
```

出现一次：

```text
HARD STOP
```

---

# 43. Backspace / UI 同样检查 Block Result

统一：

```text
result.ok=false
→ STOP
```

禁止：

```text
继续修改 record
继续写 sidecar
继续打印成功 trace
```

---

# 44. Phase H — Historical Records 与 Current Session 完全隔离

最新 physical sidecar：

```text
recordCount=6
```

加载后出现多个 historical candidate：

```text
candidateCount=3
decision=BLOCK
reason=multi-owner
```

本轮暂不做 sidecar compaction 主重构。

但必须保证：

```text
PERSISTED_HISTORICAL
```

不能参加：

```text
EditorContinuityTransaction
LiveOwnershipProof
current-session DOM replacement
caret continuity
```

---

# 45. Historical Multi-Owner 继续 BLOCK

现有：

```text
multi-owner
decision=BLOCK
```

保持。

禁止为了让测试“看起来恢复”而：

```text
first candidate wins
```

Historical compaction 另立后续任务。

---

# 46. Phase I — Plugin Runtime Artifact Path

当前 banner：

```text
Plugin Artifact Path:
D:\Typora\resources\electron.asar\renderer\main.js
```

仍错误。

必须改为真实 deployed InkChapter plugin bundle，例如：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

以实际 authoritative deploy path 为准。

---

# 47. Runtime Artifact Trace

新增：

```text
PLUGIN-RUNTIME-ARTIFACT
```

字段：

```text
pluginMainPath

pluginMainSha256

projectMainSha256

shaMatch

buildId
```

禁止再报告 electron renderer main.js。

---

# 48. Build ID

本轮使用唯一：

```text
inkchapter-r58-6-editor-continuity-caret-split-<unique>
```

source / dist / deployed / runtime / verification 全一致。

---

# 49. Unit Tests — Special Indent Enter

## CE-1

```text
“。。”
→ Enter
→ replacement
```

必须：

```text
canonical owner = replacement
caret destination = replacement
logical offset=0
```

---

# 50. Unit Tests — Selection Lost After Old Node Removal

旧 node：

```text
isConnected=false
```

旧 Range 不得继续使用。

必须：

```text
restore on replacement
```

---

# 51. Unit Tests — Normal Enter Split

## CE-2

```text
old P2 with force-indent
→ Enter
→ completed P3 + new P4
```

必须：

```text
canonical owner P3

force-indent P3

caret P4

P4 semantic default/auto
```

---

# 52. Unit Tests — No Canonical Leak to New Paragraph

新 paragraph P4：

不能继承：

```text
R1 canonicalRecordId
```

除非业务明确创建新的 canonical record。

---

# 53. Unit Tests — Promotion Block Propagation

Registry：

```text
ok=false
```

Service 必须：

```text
return
```

禁止：

```text
success trace
record mutation
sidecar write
```

---

# 54. Unit Tests — Historical Block Propagation

PERSISTED_HISTORICAL promotion：

```text
Registry BLOCK
```

Service：

```text
STOP
```

必须 0：

```text
REGISTRY-BLOCK-IGNORED
```

---

# 55. Unit Tests — Mutation Classification

至少：

```text
1→1

1→2

ambiguous

2→1
```

均有明确 classification。

---

# 56. Runtime Acceptance R1 — Special Indent Enter Caret 10/10

每轮：

```text
输入 “。。”
→ Enter
```

必须：

```text
force-indent applied

canonical record created exactly once

replacement resolved

EDITOR-CONTINUITY-COMMIT
overallSuccess=true

selectionInsideExpectedDestination=true

actualLogicalOffset=0
```

10/10。

---

# 57. Runtime Acceptance R2 — No Jump to Previous Paragraph

每个 R1 case：

命令完成后立即读取 Selection。

必须：

```text
selection paragraph
=
canonical owner paragraph
```

禁止：

```text
selParagraph=undefined
```

稳定超过一个 RAF。

禁止：

```text
selection resolves to previous paragraph
```

---

# 58. Runtime Acceptance R3 — Arrow Navigation

命令完成后：

```text
↑
↓
```

真实操作。

必须正常导航。

不得要求：

```text
先 Enter
再 ↑
```

才能回到目标段。

---

# 59. Runtime Acceptance R4 — Normal Enter Split 10/10

每轮：

```text
SPECIAL_INDENT_ENTER
→ 输入正文
→ NORMAL_ENTER
```

必须：

```text
old logical paragraph remains force-indent

old canonical record remains on completed paragraph

new paragraph is separate

caret moves to new paragraph

recordCount does not duplicate old record
```

10/10。

---

# 60. Runtime Acceptance R5 — Original Paragraph Never Flushes

在 R4：

按 Enter 后原段落：

```text
semantic=force-indent

computed text-indent=expected indent

canonical binding valid
```

不得：

```text
semantic=auto
computed=0px
```

---

# 61. Runtime Acceptance R6 — Generic 1→1 Replacement 10/10

普通 typing/re-render：

```text
REPLACE_1_TO_1
```

必须：

```text
EDITOR-MUTATION-CLASSIFICATION
kind=REPLACE_1_TO_1

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT

generation+1

same recordId
```

---

# 62. Runtime Acceptance R7 — 1→2 Split Classification 10/10

正常 Enter：

```text
EDITOR-MUTATION-CLASSIFICATION
kind=SPLIT_1_TO_2
```

必须：

```text
canonicalOwnerRuntimeId != caretDestinationRuntimeId
```

10/10。

---

# 63. Runtime Acceptance R8 — LiveOwnershipProof

所有 Promotion：

```text
bindingVerified=true
elementConnected=true
generationMatches=true
runtimeIdMatches=true
```

才成功。

必须 0：

```text
bindingVerified=false decision=PROMOTE

elementConnected=false decision=PROMOTE
```

---

# 64. Runtime Acceptance R9 — Registry Block Propagation

构造 historical / stale proof case。

必须：

```text
Registry BLOCK
→ service STOP
```

`REGISTRY-BLOCK-IGNORED=0`

---

# 65. Runtime Acceptance R10 — Replacement → Backspace 10/10

覆盖：

```text
special command replacement
normal 1→1 replacement
normal split completed paragraph
```

目标有 valid proof 时：

```text
UPDATE_EXISTING

sameRecord=true

appendOccurred=false

recordCount unchanged
```

---

# 66. Runtime Acceptance R11 — Current Session Heuristic Isolation

必须继续：

```text
CURRENT_AWAITING_TRANSFER
→ MATCH-EXACT-ANCHOR = 0

MATCH-PROXIMITY = 0

MATCH-LEGACY = 0
```

Editor continuity 只能使用：

```text
same-mutation local evidence
```

---

# 67. Runtime Acceptance R12 — Physical Persistence Regression

继续：

```text
SIDECAR-ACTUAL-WRITE
source=physical
backend=filesystem

restart

SIDECAR-ACTUAL-LOAD
exists=true
source=physical
backend=filesystem
```

---

# 68. Runtime Acceptance R13 — Persisted Historical Isolation

启动后 historical records：

```text
PERSISTED_HISTORICAL
```

不能：

```text
进入 LiveOwnershipProof

参加 EditorContinuityTransaction

参与 current-session owner transfer
```

---

# 69. Runtime Acceptance R14 — Document Switch 3 Cycles

```text
doc A → doc B → doc A
```

3 cycles。

必须：

```text
continuity transaction cleared

caret snapshots cleared

live proofs invalidated

no cross-doc transfer

no cross-doc caret restore
```

---

# 70. Runtime Acceptance R15 — Strict Startup

必须验证：

```text
old process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

target document

InkChapter plugin runtime path

plugin main.js SHA256

style.css SHA256

Build ID

initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 71. Hard Stop List

任一出现：

```text
POST-TOKEN-SELECTION success
但 post-handoff selection 丢失

selParagraph=undefined
在 continuity commit 后仍持续

special indent command
caret 跳 previous paragraph

normal Enter 后
old force-indent paragraph becomes auto/0px

SPLIT_1_TO_2
canonical owner == caret destination
且无明确特殊业务理由

normal split 新 paragraph
继承旧 canonical record

LIVE-REPLACEMENT runtime trace = 0
在真实 replacement case

EDITOR-MUTATION-CLASSIFICATION trace = 0
在真实 Enter/re-render case

bindingVerified=false decision=PROMOTE

elementConnected=false decision=PROMOTE

REGISTRY-BLOCK-IGNORED

CURRENT_AWAITING_TRANSFER
进入 historical heuristic

BACKSPACE_UPDATE decision=CREATE_NEW

current-session multi-owner unexpected

plugin runtime path points to electron.asar renderer main.js

runtime Build ID mismatch

deployed SHA mismatch
```

立即：

```text
R58.6 NOT FIXED — R60 BLOCKED
```

---

# 72. 禁止的假修复

禁止：

```text
拦截 ArrowDown 手工跳 paragraph

每次 refresh 强行 setSelection

用 setTimeout 无限抢 caret

只延长 handoff observation 时间

只把 selParagraph undefined 改日志

只给 P2 再 apply 一次 CSS

normal Enter 后把 force-indent 复制给新 P4
而旧 P3 丢 canonical owner

用 ordinal-only 判 split owner

用 whole-document text matching 判 split

historical heuristic 恢复 current-session split

Registry BLOCK 后 service 继续走 success

只创建 EditorContinuityTransaction 类型但 runtime 不触发
```

---

# 73. 推荐模块

```text
paragraph-canonical-registry.ts
├─ canonical identity
├─ generation
├─ LiveOwnershipProof
└─ mutation authorization

editor-continuity.ts
├─ EditorContinuityTransaction
├─ LogicalCaretSnapshot
├─ mutation classification
├─ canonical owner resolution
├─ caret destination resolution
├─ caret restore
└─ final verification

heading-numbering-service.ts
├─ command orchestration
├─ observer integration
├─ Enter contracts
├─ Promotion
├─ Backspace
└─ rehydrate projection

paragraph-layout-store.ts
└─ physical persistence
```

不强制拆文件，
但职责必须分离。

---

# 74. Clean Trace — Special Indent Enter

理想：

```text
SPECIAL_INDENT_ENTER
continuityId=C1

PRE-HANDOFF-CARET-SNAPSHOT
runtime=P1
offset=0

EDITOR-MUTATION-BATCH
remove=P1
add=P2

EDITOR-MUTATION-CLASSIFICATION
kind=REPLACE_1_TO_1

EDITOR-CONTINUITY-RESOLVE
canonicalOwner=P2
caretDestination=P2

CANONICAL-BINDING-TRANSFER
P1 → P2

CARET-CONTINUITY-TRANSFER
destination=P2
offset=0
verified=true

EDITOR-CONTINUITY-COMMIT
overallSuccess=true
```

---

# 75. Clean Trace — Normal Enter Split

```text
P2
text="这是一个段落"
force-indent
caret=end

NORMAL_ENTER

EDITOR-MUTATION-BATCH
remove=P2
add=P3,P4

EDITOR-MUTATION-CLASSIFICATION
kind=SPLIT_1_TO_2

EDITOR-CONTINUITY-RESOLVE
canonicalOwner=P3
caretDestination=P4

CANONICAL-BINDING-TRANSFER
P2 → P3
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

P3:
force-indent

P4:
auto

CARET-CONTINUITY-TRANSFER
destination=P4
offset=0
verified=true

EDITOR-CONTINUITY-COMMIT
overallSuccess=true
```

---

# 76. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Root Cause — Caret Continuity Missing
## 4. Root Cause — Generic Runtime Replacement Missing
## 5. Root Cause — Split Owner/Destination Conflation
## 6. Files Changed
## 7. EditorContinuityTransaction
## 8. LogicalCaretSnapshot
## 9. Pre/Post Handoff Caret
## 10. MutationObserver Runtime Path
## 11. Mutation Classification
## 12. REPLACE_1_TO_1
## 13. SPLIT_1_TO_2
## 14. MERGE_2_TO_1
## 15. Canonical Owner Resolution
## 16. Caret Destination Resolution
## 17. Caret Restore
## 18. Caret Verification
## 19. LiveOwnershipProof Enforcement
## 20. Registry Block Propagation
## 21. Historical Isolation
## 22. Plugin Artifact Path
## 23. Build ID
## 24. Typecheck
## 25. Tests
## 26. Build
## 27. Deploy SHA256
## 28. Strict Startup Verification
## 29. R1 Special Indent Enter 10/10
## 30. R2 No Previous-Line Jump
## 31. R3 Arrow Navigation
## 32. R4 Normal Enter Split 10/10
## 33. R5 Original Paragraph Indent Retained
## 34. R6 Generic 1→1 Replacement 10/10
## 35. R7 Split Classification 10/10
## 36. R8 LiveOwnershipProof
## 37. R9 Registry Block Propagation
## 38. R10 Replacement→Backspace 10/10
## 39. R11 Current Session Heuristic Isolation
## 40. R12 Physical Persistence
## 41. R13 Historical Isolation
## 42. R14 Document Switch
## 43. R15 Strict Startup
## 44. Hard Stop Counts
## 45. Remaining Known Issues
## 46. Final Verdict
```

---

# 77. Final Verdict

最终只能：

```text
R58.6 FIXED — R60 UNLOCKED
```

或者：

```text
R58.6 NOT FIXED — R60 BLOCKED
```

任何 mandatory runtime：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6 NOT FIXED — R60 BLOCKED
```

---

# 78. Execution Rules

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

用于审计。

禁止编造：

```text
Selection state

caret offset

MutationRecord

DOM replacement

split classification

canonical owner

caret destination

runtimeId

generation

proof validation

PID

window handle

vault

active doc

plugin artifact path

SHA256

Build ID

runtime acceptance
```

启动或重启 Typora 后，如果没有完整验证：

```text
old process
new process
main window
target vault
target document
InkChapter runtime bundle
SHA256
Build ID
initializationCount
```

必须明确：

```text
启动命令已发出，但尚未确认成功
```

只有所有 R58.6 editor continuity runtime gates 全部真实通过后，
才允许：

```text
R58.6 FIXED — R60 UNLOCKED
```

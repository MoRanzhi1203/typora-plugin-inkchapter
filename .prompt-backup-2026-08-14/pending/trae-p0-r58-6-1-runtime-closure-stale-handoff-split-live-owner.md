# TRAE P0 — R58.6.1 Runtime Closure Repair

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Closure**
>
> Current authoritative status:
>
> ```text
> R58.6 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不是新架构重构。
>
> 只关闭 4 个已经被真实 runtime 明确证明的断点：
>
> 1. One-Shot Handoff 生命周期泄漏，旧 handoff 会劫持后续无关 DOM mutation；
> 2. Editor Mutation 路径目前只有 logging/classification，resolver 没有真正完成 1→1 / 1→2 / 2→1 continuity；
> 3. Promotion 仍可在 `bindingVerified=false / elementConnected=false` 时成功；
> 4. exact `CURRENT_LIVE` owner 已存在时，historical candidates 仍被放入同一竞争 group，造成 current-session multi-owner HARD STOP。
>
> 只有以上四项 runtime 真正闭环后，才继续 R58.6 原 R1-R15 验收。

---

# 0. 最新 Runtime Ground Truth

最新 runtime Build：

```text
inkchapter-r58-6-editor-continuity-caret-split-p1q8r
```

已经真实确认以下能力工作，必须 HARD FREEZE：

```text
vaultRoot authority = PASS
physical sidecar load/write = PASS
PERSISTED_HISTORICAL physical registration = PASS
CURRENT_LIVE → MATCH-LIVE-BINDING = PASS
CURRENT_LIVE projection-only = PASS
current-session historical heuristic isolation = PASS
single-dot wrong apply = 0

Backspace with valid LiveOwnershipProof:
decision=UPDATE_EXISTING
recordCount unchanged

MutationObserver runtime logging 已进入 production：
EDITOR-MUTATION-BATCH
LIVE-REPLACEMENT-TICKET
EDITOR-MUTATION-CLASSIFICATION
LIVE-REPLACEMENT-MISSED
```

禁止重新推翻这些链路。

---

# 1. Runtime Failure A — Stale One-Shot Handoff

真实链路：

```text
SPECIAL_INDENT_ENTER
txn-1

~156ms:
TRANSACTION CLOSED

T4~T9:
originalConnected=true

直到 T9_2000ms：
原 paragraph 仍 connected
```

这表示本次 command continuity window 内：

```text
没有真正 DOM replacement
```

但 runtime：

```text
activeHandoffCount=1
```

仍然长期存在。

约十秒后出现新的无关 DOM mutation：

```text
removed=[P-RUNTIME-1]

added=[
 P-RUNTIME-6,
 P-RUNTIME-5
]

selectionRuntimeId=P-RUNTIME-5
```

旧：

```text
handoff-txn-1-...
```

被再次消费：

```text
HANDOFF-RESOLVE
replacementRuntimeId=P-RUNTIME-6

CANONICAL-BINDING-TRANSFER
P1 → P6
reason=HANDOFF_REPLACE
```

这说明：

```text
旧 command handoff
跨越 command window
劫持后续正常编辑 mutation
```

---

# 2. One-Shot Handoff 正确语义

One-Shot Handoff 必须只属于：

```text
当前 command continuity window
```

不能成为长期 live replacement watcher。

建议 lifecycle：

```ts
type CommandHandoffState =
  | "OPEN"
  | "CONSUMED"
  | "CLOSED_NO_REPLACEMENT"
  | "EXPIRED";
```

---

# 3. Command Handoff Close Rule

如果：

```text
transaction 已结束
originalElement.isConnected === true
没有发生 command-owned replacement
没有 active editor continuity transaction waiting to resolve
```

必须：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

并：

```text
remove active handoff
activeHandoffCount--
```

不能继续存活。

---

# 4. Handoff Expiration Gate

新增：

```text
STALE-COMMAND-HANDOFF
```

字段：

```text
handoffId
txnId
createdAt
now
ageMs
transactionClosed
originalConnected
decision
```

如果 handoff 超过允许 command window 仍尝试参与 mutation resolution：

```text
decision=BLOCK
```

出现 stale handoff 实际完成 transfer：

```text
HARD STOP
```

---

# 5. Handoff 只能消费一次

成功：

```text
HANDOFF-TRANSFER
```

后立即：

```text
state=CONSUMED
remove handoff
```

不允许同一个 handoffId 参与第二次 DOM mutation。

---

# 6. 不要用任意大 TTL 掩盖问题

禁止：

```text
handoff lifetime = 10s / 30s
```

只是为了“有机会等 replacement”。

Command handoff 生命周期必须和 command transaction + Typora immediate mutation window 绑定。

如果 command 结束后 original 仍 connected：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

---

# 7. Runtime Failure B — Mutation Classification 已进入 Runtime，但 Resolver 没落地

当前已观察真实：

```text
EDITOR-MUTATION-BATCH
```

进入 runtime。

但很多 case：

```text
LIVE-REPLACEMENT-TICKET
→ EDITOR-MUTATION-CLASSIFICATION
→ LIVE-REPLACEMENT-MISSED
```

停在这里。

没有：

```text
EDITOR-CONTINUITY-RESOLVE

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT
```

因此：

```text
classification != continuity resolution
```

---

# 8. 当前 Classification 还有形态错误

真实 case：

```text
removed=[P5,P6]
added=[P7]
```

当前却输出：

```text
kind=REPLACE_1_TO_1
```

这是错误的 editor mutation shape。

DOM 层真实是：

```text
2 → 1
```

至少应：

```text
kind=MERGE_2_TO_1
```

或：

```text
kind=COMPLEX_2_TO_1
```

---

# 9. 必须区分两个计数

不要把 editor mutation shape 和 canonical-participating node count 混为一谈。

新增：

```ts
interface EditorMutationClassification {
  removedParagraphCount: number;
  addedParagraphCount: number;

  canonicalRemovedCount: number;
  canonicalAddedCandidateCount: number;

  mutationKind:
    | "REPLACE_1_TO_1"
    | "SPLIT_1_TO_2"
    | "MERGE_2_TO_1"
    | "COMPLEX"
    | "NONE";
}
```

---

# 10. Classification Gate

规则至少：

```text
removed=1 added=1
→ REPLACE_1_TO_1

removed=1 added=2
→ SPLIT_1_TO_2

removed=2 added=1
→ MERGE_2_TO_1

其它
→ COMPLEX
```

然后再做 canonical participant resolution。

---

# 11. Runtime Failure C — SPLIT_1_TO_2 已被识别，但直接判 ambiguous

真实：

```text
removed=[P13]

added=[
 P15,
 P14
]

selectionRuntimeId=P14
```

当前：

```text
kind=SPLIT_1_TO_2
candidateCount=2
reason=ambiguous
```

SPLIT resolver 的职责就是区分：

```text
canonicalOwnerReplacement
caretDestination
```

---

# 12. SPLIT_1_TO_2 Resolver

输入：

```text
old canonical owner
same mutation batch
two added paragraphs
current Selection
DOM order
local content continuity
sibling boundaries
```

输出：

```ts
interface SplitResolution {
  canonicalOwner: HTMLElement | null;
  caretDestination: HTMLElement | null;

  decision:
    | "RESOLVED"
    | "BLOCKED";

  evidence: string[];
}
```

---

# 13. Caret Destination 优先 Evidence

如果：

```text
selectionRuntimeId
```

正好属于两个新增 paragraphs 之一：

```text
caretDestination = selection paragraph
```

这是强证据。

必须 trace：

```text
SPLIT-CARET-DESTINATION
```

---

# 14. Canonical Owner Resolution

在 normal Enter：

```text
canonicalOwner
```

通常是：

```text
不是 caretDestination 的另一个 completed paragraph
```

但仍需局部证据验证。

允许：

```text
same mutation batch
DOM order relative to old paragraph
local text continuity
same parent
stable siblings
caretDestination identity
```

禁止：

```text
whole-document anchor search
whole-document ordinal-only
proximity resolver
legacy historical resolver
```

---

# 15. Normal Enter Split Contract

如果：

```text
old P13
→ P15 + P14

selection=P14
```

且 evidence 证明 P15 是 completed old paragraph：

必须：

```text
canonicalOwner=P15
caretDestination=P14
```

然后：

```text
CANONICAL-BINDING-TRANSFER
P13 → P15
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

并：

```text
P15 保持原 semantic
P14 不继承旧 canonicalRecordId
```

---

# 16. REPLACE_1_TO_1 Resolver

对于真实：

```text
removed=1
added=1
```

如果：

```text
same mutation batch
same document
same parent/equivalent slot
old canonical owner in removed
unique added paragraph
```

必须：

```text
EDITOR-CONTINUITY-RESOLVE
decision=TRANSFER
```

不能仅因为没有 historical anchor 证据就 `LIVE-REPLACEMENT-MISSED`。

---

# 17. MERGE_2_TO_1

本轮至少正确分类。

如果不能可靠确定 merge 后 canonical owner：

```text
decision=BLOCK
```

但必须：

```text
kind=MERGE_2_TO_1
```

不能误报 1→1。

---

# 18. Generic Transfer 成功 Gate

只有：

```text
current record state=CURRENT_AWAITING_TRANSFER
same document
ticket generation=current generation
resolver decision=RESOLVED
canonical owner exactly one
replacement connected
```

才：

```text
CANONICAL-BINDING-TRANSFER
```

---

# 19. Pending 不能永久积累正常可解 case

当前已观察：

```text
awaitingCount=3
oldestAwaitingMs > 14000
```

新增：

```text
CONTINUITY-RESOLUTION-LEAK
```

如果存在明确 same-batch replacement/split evidence，
但 record 超过连续数个 editor cycles 仍 CURRENT_AWAITING_TRANSFER：

```text
HARD STOP
```

---

# 20. 保持 Pending Safety

如果真的 candidateCount=0 或证据冲突：

```text
CURRENT_AWAITING_TRANSFER
```

继续保持。

禁止：

```text
historical heuristic fallback
timeout-only retire
first candidate wins
```

---

# 21. Runtime Failure D — Promotion 仍未 Hard Authorize

最新真实 trace 仍出现：

```text
CANONICAL-RECORD-PROMOTION

bindingVerified=false
elementConnected=false

decision=PROMOTE
```

因此：

```text
R58.6 Promotion authorization = FAIL
```

---

# 22. 废弃业务入口 promoteExistingByRecordId(recordId)

业务层禁止：

```ts
promoteExistingByRecordId(recordId)
```

作为 live mutation API。

只允许：

```ts
promoteExisting(
  proof: LiveOwnershipProof,
  patch
)
```

---

# 23. LiveOwnershipProof 强制验证

必须：

```text
state=CURRENT_LIVE
proof.recordId == record.id
proof.runtimeId == meta.currentRuntimeId
proof.element == meta.currentElement
proof.generation == meta.generation
proof.documentKey == meta.documentKey
proof.element.isConnected == true
recordIdByElement(proof.element) == recordId
recordIdByRuntimeId(proof.runtimeId) == recordId
```

全部 true 才 PROMOTE。

---

# 24. Promotion Trace Contract

成功：

```text
CANONICAL-RECORD-PROMOTION

bindingVerified=true
elementConnected=true
generationMatches=true
runtimeIdMatches=true
decision=PROMOTE
```

失败：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

禁止：

```text
bindingVerified=false
decision=PROMOTE
```

---

# 25. Registry Block 必须传播到 Service

统一：

```ts
const result = registry.promoteExisting(...);

if (!result.ok) {
  return;
}
```

`return` 前禁止：

```text
record mutation
dirty=true
sidecar write scheduling
success trace
```

---

# 26. REGISTRY-BLOCK-IGNORED

新增 hard diagnostic：

```text
REGISTRY-BLOCK-IGNORED
```

任何 registry `ok=false` 之后仍发生 canonical mutation / dirty / write / success trace：

```text
HARD STOP
```

---

# 27. Runtime Failure E — Historical Candidate 反向阻塞 Exact CURRENT_LIVE Owner

最新 runtime 大量出现：

```text
candidateLifecycleStates=[
 PERSISTED_HISTORICAL,
 CURRENT_LIVE
]

currentSessionCandidateCount=1

REHYDRATE-BLOCK-CURRENT-SESSION-MULTI-OWNER
ACTION=HARD_STOP
```

这说明 historical candidate 被允许和 exact live owner 竞争同一个 target。

这是错误的。

---

# 28. Live Owner Dominance

如果 target 已经：

```text
MATCH-LIVE-BINDING
```

并且有：

```text
CURRENT_LIVE exact owner
```

则 target ownership 已确定。

此 target 的 historical candidates 必须：

```text
不进入 competitive rehydrate group
```

---

# 29. Historical Suppression Trace

新增：

```text
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

字段：

```text
targetRuntimeId
liveRecordId
historicalCandidateRecordIds
suppressedCount
reason=exact-live-owner
```

---

# 30. Live Owner Dominance Rule

顺序必须：

```text
1. exact CURRENT_LIVE binding

2. if exact live owner exists:
      live projection
      suppress historical resolver for this target

3. only if no live owner:
      PERSISTED_HISTORICAL resolver may run
```

禁止：

```text
live owner + historical candidates
→ multi-owner HARD STOP
```

---

# 31. Historical Multi-Owner 仍保留

如果没有 live owner，且 historical candidateCount > 1：

```text
BLOCK
reason=multi-owner
```

不要 first candidate wins。

---

# 32. 不要在本轮做 Sidecar Compaction

historical recordCount 增大是独立 P1。

本轮只做：

```text
live owner dominance
```

不要同时做 historical GC / sidecar compaction / record migration。

---

# 33. Selection Resolver 统一

当前 runtime 曾同时出现：

```text
EDITOR-MUTATION-BATCH:
selectionRuntimeId=P1
```

但：

```text
OBS-SELECTION:
selParagraph=undefined
sameAsCommand=true
```

说明 selection diagnostics 不统一。

新增唯一 resolver：

```ts
resolveSelectionParagraph(): {
  paragraph: HTMLElement | null;
  runtimeId: string | null;
  localOffset: number | null;
}
```

以下全部必须共用：

```text
EDITOR-MUTATION-BATCH
OBS-SELECTION
POST-HANDOFF verification
SPLIT resolver
CARET-NAVIGATION-AUDIT
```

---

# 34. sameAsCommand 一致性

`sameAsCommand=true` 只能在：

```text
selection paragraph runtimeId == expected runtimeId
```

时成立。

如果：

```text
selParagraph=null
```

则：

```text
sameAsCommand=false
```

禁止矛盾 trace。

---

# 35. Plugin Runtime Artifact Path 仍需修

当前仍错误：

```text
Plugin Artifact Path:
D:\Typoraesources\electron.asarenderer\main.js

Plugin SHA256:
unknown
```

必须改为真实 deployed InkChapter bundle。

目标例如：

```text
D:\TyporaPluginProjects	ypora-plugin-inkchaptertestault\.typora\plugins\dist\main.js
```

以实际 authoritative deploy path 为准。

---

# 36. PLUGIN-RUNTIME-ARTIFACT Gate

必须：

```text
pluginMainPath=<actual InkChapter deployed bundle>
exists=true
pluginMainSha256=<real SHA256>
projectMainSha256=<build output SHA256>
shaMatch=true
buildId=<current unique build>
```

禁止继续使用 electron renderer main.js。

---

# 37. Build ID

本轮使用：

```text
inkchapter-r58-6-1-runtime-closure-<unique>
```

source / dist / deployed / runtime / verification 一致。

---

# 38. Unit Tests — Handoff Lifetime

## HC-1

transaction closes + original still connected + no replacement：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

## HC-2

closed handoff 后发生无关 mutation：

```text
old handoff cannot participate
```

## HC-3

handoff successfully transferred：

```text
immediately CONSUMED
```

## HC-4

consumed handoff second mutation：

```text
BLOCK
```

---

# 39. Unit Tests — Mutation Shape

```text
1 removed / 1 added → REPLACE_1_TO_1
1 removed / 2 added → SPLIT_1_TO_2
2 removed / 1 added → MERGE_2_TO_1
其它 → COMPLEX
```

---

# 40. Unit Tests — Split Resolver

```text
removed=P13
added=P15,P14
selection=P14
```

必须：

```text
caretDestination=P14
```

若 local continuity 证明 P15 是 completed old paragraph：

```text
canonicalOwner=P15
decision=RESOLVED
```

---

# 41. Unit Tests — 1→1 Resolver

唯一 same-batch replacement：

```text
old canonical removed
1 new paragraph added
same parent/slot
→ RESOLVED
→ transfer
```

不需要 historical anchor。

---

# 42. Unit Tests — Promotion Proof

```text
valid proof → PROMOTE
binding mismatch → BLOCK
element disconnected → BLOCK
generation stale → BLOCK
recordId-only live promotion → unavailable / BLOCK
```

---

# 43. Unit Tests — Live Owner Dominance

target 已存在 exact CURRENT_LIVE owner R1，
另有 historical H1/H2。

必须：

```text
R1 wins directly
H1/H2 suppressed
no multi-owner hard stop
```

---

# 44. Runtime Acceptance A1 — No Stale Handoff

执行：

```text
。。+Enter
```

如果 2s 内 original 没 replacement：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
activeHandoffCount=0
```

之后正常编辑：

```text
旧 handoff 不得再次 HANDOFF-RESOLVE
```

---

# 45. Runtime Acceptance A2 — 1→1 Generic Replacement 10/10

每轮：

```text
normal typing/re-render
1 removed
1 added
```

必须：

```text
kind=REPLACE_1_TO_1
EDITOR-CONTINUITY-RESOLVE decision=RESOLVED
CANONICAL-BINDING-TRANSFER reason=LIVE_DOM_REPLACEMENT
same recordId
generation+1
```

10/10。

---

# 46. Runtime Acceptance A3 — Split 10/10

正常正文 Enter：

```text
1 removed
2 added
```

必须：

```text
kind=SPLIT_1_TO_2
caretDestination=selection runtime paragraph
canonicalOwner=completed old paragraph
canonicalOwner != caretDestination
```

10/10。

---

# 47. Runtime Acceptance A4 — Merge Classification

构造 Backspace/Delete merge：

```text
2 removed
1 added
kind=MERGE_2_TO_1
```

禁止误报 REPLACE_1_TO_1。

---

# 48. Runtime Acceptance A5 — No Permanent Awaiting

对于 evidence 已明确的 normal replacement/split：

```text
CURRENT_AWAITING_TRANSFER
→ CURRENT_LIVE
```

不得：

```text
awaitingForMs > 2000
```

真 ambiguity 可 pending，但必须有真实 reason。

---

# 49. Runtime Acceptance A6 — Promotion Hard Authorization

至少 5 次合法 promotion。

全部：

```text
bindingVerified=true
elementConnected=true
generationMatches=true
runtimeIdMatches=true
decision=PROMOTE
```

同时必须：

```text
bindingVerified=false decision=PROMOTE = 0
elementConnected=false decision=PROMOTE = 0
REGISTRY-BLOCK-IGNORED = 0
```

---

# 50. Runtime Acceptance A7 — Live Owner Dominance

至少 10 次 refresh。

当 target 存在：

```text
CURRENT_LIVE exact owner
+
historical candidates
```

必须：

```text
MATCH-LIVE-BINDING
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
no current-session multi-owner HARD STOP
```

---

# 51. Runtime Acceptance A8 — Selection Resolver Consistency

同一 observation：

如果：

```text
selectionRuntimeId=P1
```

则：

```text
selParagraph runtimeId=P1
```

如果 selParagraph=null：

```text
sameAsCommand=false
```

禁止矛盾 trace。

---

# 52. Runtime Acceptance A9 — Regression

必须继续保持：

```text
Single Dot wrong apply = 0
current-session historical heuristic = 0
Backspace CREATE_NEW = 0
physical sidecar load/write PASS
PERSISTED_HISTORICAL only physical birth
```

---

# 53. Runtime Acceptance A10 — Strict Startup

必须验证：

```text
old process exited
new PID
StartTime
MainWindowHandle
MainWindowTitle
target vault
target document
real InkChapter plugin main.js path
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

# 54. Hard Stop List

任一出现：

```text
closed command handoff later resolves unrelated mutation

STALE-COMMAND-HANDOFF decision=TRANSFER

1 removed 2 added but kind != SPLIT_1_TO_2

2 removed 1 added but kind=REPLACE_1_TO_1

split selection points to added paragraph but caretDestination unresolved

evidence-resolvable 1→1 but LIVE-REPLACEMENT-MISSED

bindingVerified=false decision=PROMOTE

elementConnected=false decision=PROMOTE

generation mismatch decision=PROMOTE

REGISTRY-BLOCK-IGNORED

exact CURRENT_LIVE owner exists but historical candidate joins same competition group

REHYDRATE-BLOCK-CURRENT-SESSION-MULTI-OWNER caused only by historical + one exact live owner

awaitingCount continuously grows in normal edit

plugin runtime path points to electron.asar renderer main.js

plugin SHA unknown

runtime Build ID mismatch

deployed SHA mismatch
```

立即：

```text
R58.6.1 NOT FIXED — R60 BLOCKED
```

---

# 55. 不允许的假修复

禁止：

```text
把 handoff TTL 改大

只减少 stale log

mutation kind 按 canonical participant 数量命名

SPLIT 看到 2 added 就直接 ambiguous

1→1 继续要求 historical anchor

给 Promotion success log 强制打印 bindingVerified=true

Registry BLOCK 后 service 继续 mutation

看到 live + historical multi-owner 就删除 historical record

本轮直接做 sidecar compaction

用 ArrowDown interception 掩盖 selection

把 renderer main.js SHA 当 plugin SHA
```

---

# 56. 推荐修改范围

优先限制在：

```text
heading-numbering-service.ts
paragraph-canonical-registry.ts
main.ts
paragraph-indent-forensic.ts
```

如果已有独立 continuity module，允许修改。

不要扩大到：

```text
single-dot algorithm
Two-Pass historical matching
heading numbering engine
outline numbering
template system
```

---

# 57. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

记录：

```text
exit code
test count
project main SHA256
deployed plugin main SHA256
style SHA256
Build ID
```

---

# 58. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Stale Handoff Root Cause
## 4. Handoff Lifecycle Fix
## 5. Mutation Shape Classification Fix
## 6. 1→1 Resolver
## 7. 1→2 Split Resolver
## 8. 2→1 Merge Classification
## 9. Canonical Owner Resolution
## 10. Caret Destination Resolution
## 11. Promotion Hard Authorization
## 12. Registry Block Propagation
## 13. Live Owner Dominance
## 14. Selection Resolver Unification
## 15. Files Changed
## 16. Build ID
## 17. Typecheck
## 18. Tests
## 19. Build
## 20. Deploy SHA256
## 21. Strict Startup Verification
## 22. A1 No Stale Handoff
## 23. A2 1→1 Replacement 10/10
## 24. A3 Split 10/10
## 25. A4 Merge Classification
## 26. A5 No Permanent Awaiting
## 27. A6 Promotion Proof
## 28. A7 Live Owner Dominance
## 29. A8 Selection Consistency
## 30. A9 Regression
## 31. A10 Strict Startup
## 32. Hard Stop Counts
## 33. Remaining Known Issues
## 34. Final Verdict
```

---

# 59. Final Verdict

最终只能：

```text
R58.6.1 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.1 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.1 FIXED
```

不等于：

```text
R60 UNLOCKED
```

R58.6 原 R1-R15 GUI/runtime acceptance 仍必须继续完成。

任何 mandatory A1-A10：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.1 NOT FIXED — R60 BLOCKED
```

---

# 60. Execution Rules

直接操作：

```text
D:\TyporaPluginProjects	ypora-plugin-inkchapter
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
handoff age
MutationRecord shape
selection runtimeId
canonical owner
caret destination
LiveOwnershipProof
promotion authorization
historical suppression
PID
StartTime
HWND
window title
vault
active document
plugin artifact path
SHA256
Build ID
runtime acceptance count
```

启动或重启 Typora 后，如果没有完整验证：

```text
process
window
target vault
target document
plugin artifact path
plugin SHA256
Build ID
initializationCount
```

必须明确：

```text
启动命令已发出，但尚未确认成功
```

本轮只允许完成 runtime closure，
不要用新的大范围重构掩盖现有四个明确断点。

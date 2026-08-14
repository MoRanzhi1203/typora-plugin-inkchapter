# TRAE P0 — R58.6.2 Mutation Shape Authority + Split Continuity + Proof-Before-Mutation + Unified Selection Identity

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Closure**
>
> Current authoritative status:
>
> ```text
> R58.6.1 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不要扩大架构。
>
> 只修 4 个已经被最新 runtime 直接证明的 P0：
>
> 1. Mutation Shape Authority：必须先按整个 MutationObserver batch 的 removed/added 总数判定 1→1 / 1→2 / 2→1，禁止按 canonical participant 数量降格；
> 2. SPLIT_1_TO_2 Continuity Resolver：必须分离并解析 `canonicalOwner` 与 `caretDestination`；
> 3. Promotion Proof-Before-Mutation：`LiveOwnershipProof` 必须在 canonical mutation 之前完成，禁止 recordId-only live promotion；
> 4. Unified Selection Identity：OBS-SELECTION / MutationObserver / Split Resolver / Caret Verification 必须共用唯一 selection resolver。
>
> 只有这四项真实通过后，才允许继续 R58.6 GUI acceptance。

---

# 0. 最新 Runtime Ground Truth

最新 runtime Build：

```text
inkchapter-r58-6-1-runtime-closure-s3t6v
```

已经真实通过，必须 HARD FREEZE：

```text
HANDOFF-CLOSE:
reason=NO_REPLACEMENT_REQUIRED
activeHandoffCount→0

HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER:
reason=exact-live-owner

CURRENT_LIVE:
MATCH-LIVE-BINDING

CURRENT_LIVE projection-only:
dirty=false
writeScheduled=false

physical sidecar load/write:
PASS

PERSISTED_HISTORICAL physical registration:
PASS

Backspace with valid LiveOwnershipProof:
decision=UPDATE_EXISTING

single-dot safeguards:
no wrong apply observed
```

禁止重新推翻这些链路。

---

# 1. 当前 Runtime Failure A — Mutation Shape 被错误降格

真实 DOM batch：

```text
removedParagraphCount=2
addedParagraphCount=1

removed=[
 P-RUNTIME-10,
 P-RUNTIME-13
]

added=[
 P-RUNTIME-20
]
```

当前却输出：

```text
EDITOR-MUTATION-CLASSIFICATION
kind=REPLACE_1_TO_1
candidateCount=1
reason=resolved
```

并继续：

```text
LIVE-REPLACEMENT-RESOLVE
decision=TRANSFER

CANONICAL-BINDING-TRANSFER
P-RUNTIME-13 → P-RUNTIME-20
reason=LIVE_DOM_REPLACEMENT
```

这是错误的。

整个 DOM batch 是：

```text
2 → 1
```

必须首先分类为：

```text
MERGE_2_TO_1
```

不能因为其中只有一个 removed paragraph 参与 canonical ownership，就把整个 mutation shape 降格成 1→1。

---

# 2. Mutation Shape Authority

新增/统一：

```ts
type EditorMutationShape =
  | "REPLACE_1_TO_1"
  | "SPLIT_1_TO_2"
  | "MERGE_2_TO_1"
  | "COMPLEX"
  | "NONE";
```

唯一 authoritative classification：

```ts
function classifyEditorMutationShape(
  removedParagraphs: HTMLElement[],
  addedParagraphs: HTMLElement[],
): EditorMutationShape {
  const removed = removedParagraphs.length;
  const added = addedParagraphs.length;

  if (removed === 0 && added === 0) return "NONE";
  if (removed === 1 && added === 1) return "REPLACE_1_TO_1";
  if (removed === 1 && added === 2) return "SPLIT_1_TO_2";
  if (removed === 2 && added === 1) return "MERGE_2_TO_1";
  return "COMPLEX";
}
```

---

# 3. Shape 和 Canonical Participation 必须分离

禁止：

```text
canonicalRemovedCount=1
canonicalCandidateCount=1
→ REPLACE_1_TO_1
```

新增：

```ts
interface EditorMutationClassification {
  mutationShape: EditorMutationShape;
  removedParagraphCount: number;
  addedParagraphCount: number;
  canonicalRemovedCount: number;
  canonicalAddedCandidateCount: number;
  removedRuntimeIds: string[];
  addedRuntimeIds: string[];
}
```

原则：

```text
mutationShape
由整个 DOM batch 决定

canonical participant count
只是 resolver 的第二维信息
```

---

# 4. Registry 禁止重新猜 Shape

Service 必须把 authoritative `mutationShape` 显式传入 resolver。

Registry 只能：

```text
validate / resolve within given mutationShape
```

不能通过：

```text
old canonical record + unique added paragraph
```

自行把 MERGE_2_TO_1 降格成 REPLACE_1_TO_1。

---

# 5. REPLACE_1_TO_1 Resolver Gate

只有：

```text
removedParagraphCount=1
addedParagraphCount=1
mutationShape=REPLACE_1_TO_1
```

才允许进入 1→1 resolver。

允许 current-session same-batch evidence：

```text
old canonical owner in removedNodes
new candidate in addedNodes
same document
same editor root
same parent or equivalent DOM slot
generation current
candidate exactly one
new candidate not already owned
```

成功：

```text
EDITOR-CONTINUITY-RESOLVE
kind=REPLACE_1_TO_1
decision=TRANSFER

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT
```

---

# 6. 禁止过度放宽 1→1 Evidence

当前真实 runtime 曾出现：

```text
evidence=[old-element-in-removed-list]
decision=TRANSFER
```

这过于危险。

禁止仅凭：

```text
old-element-in-removed-list
```

完成 transfer。

至少必须同时有：

```text
authoritative shape=REPLACE_1_TO_1
same mutation batch
unique added candidate
```

再叠加 parent/slot 等 local evidence。

---

# 7. MERGE_2_TO_1

如果：

```text
removed=2
added=1
```

必须：

```text
kind=MERGE_2_TO_1
```

如果本轮暂时不能可靠决定 merge 后 canonical ownership：

```text
decision=BLOCK
```

可以接受。

禁止：

```text
kind=REPLACE_1_TO_1
decision=TRANSFER
```

本轮优先保证“不误转移”。

---

# 8. Runtime Failure B — SPLIT_1_TO_2 只分类，不解析

真实：

```text
removed=P-RUNTIME-20

added=[
 P-RUNTIME-22,
 P-RUNTIME-21
]

selectionRuntimeId=P-RUNTIME-21
```

当前：

```text
kind=SPLIT_1_TO_2
candidateCount=2
reason=ambiguous
```

然后 record：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

持续超过 5s。

没有：

```text
SPLIT-CARET-DESTINATION
EDITOR-CONTINUITY-RESOLVE
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

因此：

```text
classification 已有
split continuity resolver 未实现
```

---

# 9. SPLIT_1_TO_2 的两个输出必须分离

新增：

```ts
interface SplitContinuityResolution {
  canonicalOwner: HTMLElement | null;
  caretDestination: HTMLElement | null;
  canonicalOwnerRuntimeId: string | null;
  caretDestinationRuntimeId: string | null;
  evidence: string[];
  decision: "RESOLVED" | "BLOCKED";
}
```

关键原则：

```text
canonicalOwner
!=
caretDestination
```

对 normal Enter 通常应成立。

---

# 10. Caret Destination 优先从 Selection 解析

对于：

```text
added=[P22,P21]
selectionRuntimeId=P21
```

如果 selection paragraph：

```text
isConnected=true
属于 addedParagraphs
documentKey exact
```

则：

```text
caretDestination=P21
```

必须输出：

```text
SPLIT-CARET-DESTINATION
decision=RESOLVED
```

---

# 11. Canonical Owner Resolver

在 normal Enter split：

```text
old P20
→ P22 + P21

caretDestination=P21
```

则 canonical owner 优先在：

```text
addedParagraphs - caretDestination
```

中解析。

如果只剩 P22，还必须用 local continuity evidence 验证。

允许：

```text
same mutation batch
same editor root
same parent
old paragraph DOM slot
added sibling order
local text continuity
stable previous/next sibling
caretDestination already resolved
```

禁止：

```text
whole-document anchor search
whole-document ordinal-only
proximity resolver
legacy historical resolver
first candidate wins
```

---

# 12. Normal Enter Split Contract

成功 case：

```text
old P20
semantic=force-indent

Enter

P22 = completed old paragraph
P21 = new paragraph with caret
```

必须：

```text
canonicalOwner=P22
caretDestination=P21

CANONICAL-BINDING-TRANSFER
P20 → P22
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

P22 semantic=force-indent
P21 semantic=auto

P21 does NOT inherit old canonicalRecordId
```

---

# 13. Split Resolver 成功 Trace

必须新增：

```text
EDITOR-CONTINUITY-RESOLVE:
mutationShape=SPLIT_1_TO_2
recordId=...
fromRuntimeId=P20
canonicalOwnerRuntimeId=P22
caretDestinationRuntimeId=P21
decision=RESOLVED
```

然后：

```text
CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 14. Split Resolver Block

如果 local evidence 真不足：

```text
decision=BLOCK
```

必须明确缺失的 evidence。

禁止只写：

```text
ambiguous: 2 added paragraphs
```

因为 1→2 本身天然有 2 added，resolver 的职责就是区分它们。

---

# 15. Permanent Awaiting 必须关闭可解析 case

如果：

```text
SPLIT_1_TO_2
+
selectionRuntimeId among added paragraphs
+
canonical owner local evidence unique
```

仍然超过：

```text
2000ms
```

必须：

```text
CONTINUITY-RESOLUTION-LEAK
ACTION=HARD_STOP
```

---

# 16. Pending Safety 继续保持

如果真的 unresolved：

```text
CURRENT_AWAITING_TRANSFER
```

仍可保持。

但禁止：

```text
historical heuristic fallback
timeout-only retirement
ordinal-only fallback
text-only global recovery
```

---

# 17. Runtime Failure C — Promotion 仍然 Mutation Before Proof

最新真实 trace：

```text
RECORD-LIFECYCLE:
event=PROMOTE
state=CURRENT_LIVE

CANONICAL-RECORD-PROMOTION:
bindingVerified=false
elementConnected=false
temporaryBefore=true
temporaryAfter=false
decision=PROMOTE
```

之后 service 又打印：

```text
CANONICAL-RECORD-PROMOTION:
bindingVerified=true
elementConnected=true
generationMatches=true
decision=PROMOTE
```

说明当前仍是：

```text
Registry mutation first
→ Service proof second
```

---

# 18. Proof-Before-Mutation

正确顺序：

```text
paragraph
↓
resolveLiveOwnershipProof
↓
proof VALID
↓
registry.promoteExisting(proof)
↓
Registry internally revalidates proof
↓
canonical mutation
```

禁止：

```text
recordId
↓
Registry mutate
↓
Service later check proof
```

---

# 19. 废弃 RecordId-Only Live Promotion

业务层不得再使用：

```ts
promoteExistingByRecordId(recordId)
```

作为 current-session live Promotion 入口。

唯一 live API：

```ts
promoteExisting(
  proof: LiveOwnershipProof,
  patch
)
```

---

# 20. LiveOwnershipProof Contract

```ts
interface LiveOwnershipProof {
  recordId: string;
  documentKey: string;
  runtimeId: string;
  element: HTMLElement;
  generation: number;
}
```

Registry 内必须验证：

```text
meta.state === CURRENT_LIVE
proof.recordId === record.id
proof.documentKey === meta.documentKey
proof.runtimeId === meta.currentRuntimeId
proof.element === meta.currentElement
proof.generation === meta.generation
proof.element.isConnected === true
recordIdByElement(proof.element) === recordId
recordIdByRuntimeId(proof.runtimeId) === recordId
```

全部 true 才能 mutation。

---

# 21. Promotion Success Trace

只有 mutation 完成后才允许：

```text
CANONICAL-RECORD-PROMOTION:
bindingVerified=true
elementConnected=true
generationMatches=true
runtimeIdMatches=true
decision=PROMOTE
```

禁止：

```text
bindingVerified=false
decision=PROMOTE
```

---

# 22. Promotion Block Trace

任何 proof 无效：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

record 必须：

```text
temporary unchanged
recordCount unchanged
dirty unchanged
```

---

# 23. Registry Block Propagation

Service：

```ts
const proof = registry.resolveLiveOwnershipProof(paragraph);

if (!proof) {
  return;
}

const result = registry.promoteExisting(proof, patch);

if (!result.ok) {
  return;
}
```

之后才允许 dirty / sidecar write / success trace。

---

# 24. REGISTRY-BLOCK-IGNORED

任何 registry：

```text
ok=false
```

之后仍发生 canonical mutation / dirty / write / success trace：

```text
REGISTRY-BLOCK-IGNORED
ACTION=HARD_STOP
```

---

# 25. Runtime Failure D — Selection Identity 不统一

当前同一时段可出现：

```text
EDITOR-MUTATION-BATCH:
selectionRuntimeId=P4
```

同时：

```text
OBS-SELECTION:
selParagraph=undefined
sameAsCommand=true
```

说明至少有两套 selection resolver。

---

# 26. 唯一 Selection Resolver

新增或统一：

```ts
interface SelectionParagraphState {
  paragraph: HTMLElement | null;
  runtimeId: string | null;
  localOffset: number | null;
  collapsed: boolean;
  anchorNodeConnected: boolean;
  focusNodeConnected: boolean;
}

function resolveSelectionParagraph(
  editorRoot: HTMLElement
): SelectionParagraphState;
```

---

# 27. 所有 Selection Diagnostic 必须共用

以下全部调用同一个 resolver：

```text
EDITOR-MUTATION-BATCH
OBS-SELECTION
POST-TOKEN-SELECTION
SPLIT-CARET-DESTINATION
POST-HANDOFF verification
CARET-CONTINUITY verification
CARET-NAVIGATION-AUDIT
```

禁止各自单独用：

```text
cursorOffset
closest()
selection anchor
runtimeId cache
```

推断 paragraph identity。

---

# 28. sameAsCommand Gate

只有：

```text
selectionState.runtimeId === commandRuntimeId
```

才：

```text
sameAsCommand=true
```

如果：

```text
selectionState.runtimeId=null
```

则必须：

```text
sameAsCommand=false
```

禁止：

```text
selParagraph=undefined
sameAsCommand=true
```

---

# 29. POST-TOKEN-SELECTION 也必须使用统一 Resolver

必须确认：

```text
resolvedRuntimeId
```

来自唯一：

```text
resolveSelectionParagraph()
```

而不是旧 helper / stale cached identity。

---

# 30. SPLIT Resolver 必须直接使用统一 Selection

SPLIT 的：

```text
selectionRuntimeId
```

只能来自：

```text
resolveSelectionParagraph()
```

禁止 MutationObserver 和 OBS-SELECTION 得到不同 selection identity。

---

# 31. Caret Restore 本轮不做大重构

本轮目标首先是：

```text
selection identity authoritative
+
split destination authoritative
```

如果已有 caret restore helper，可以使用。

禁止：

```text
ArrowDown interception
infinite setTimeout
periodic forced selection
```

掩盖问题。

---

# 32. 已通过部分 HARD FREEZE

禁止修改：

```text
HANDOFF-CLOSE at T9
NO_REPLACEMENT_REQUIRED logic
Live Owner Dominance
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
CURRENT_LIVE projection-only
current-session historical heuristic isolation
physical sidecar load/write
PERSISTED_HISTORICAL physical birth
Backspace no-CREATE_NEW
single-dot protection
```

---

# 33. Historical Multi-Owner 继续 BLOCK

如果：

```text
no exact CURRENT_LIVE owner
```

且：

```text
historical candidateCount > 1
```

继续：

```text
BLOCK
reason=multi-owner
```

本轮不要做 sidecar compaction。

---

# 34. Plugin Runtime Artifact Path 仍未修复

当前仍：

```text
Plugin Artifact Path:
D:\Typoraesources\electron.asarenderer\main.js

Plugin SHA256:
unknown
```

本轮继续要求修正。

---

# 35. Plugin Path Strategy

禁止主要依赖：

```text
__dirname
document.currentScript
renderer process main
```

优先从：

```text
vaultRoot
plugin manifest location
plugin id=ranzhi.inkchapter
known deployed plugin directory
```

构造真实 deployed bundle。

必须：

```text
fs.existsSync(pluginMainPath) === true
```

---

# 36. PLUGIN-RUNTIME-ARTIFACT

必须：

```text
pluginMainPath=<actual deployed InkChapter main.js>
exists=true
pluginMainSha256=<real>
projectMainSha256=<real>
shaMatch=true
buildId=<current build>
```

---

# 37. Build ID

本轮：

```text
inkchapter-r58-6-2-shape-split-proof-selection-<unique>
```

source / build / deploy / runtime / verification 一致。

---

# 38. Unit Tests — Shape Authority

```text
1 removed / 1 added → REPLACE_1_TO_1
1 removed / 2 added → SPLIT_1_TO_2
2 removed / 1 added → MERGE_2_TO_1
其它 → COMPLEX
```

---

# 39. Unit Test — No Shape Downgrade

输入：

```text
removed=2
added=1
canonicalRemovedCount=1
canonicalAddedCandidateCount=1
```

必须：

```text
mutationShape=MERGE_2_TO_1
```

禁止：

```text
REPLACE_1_TO_1
```

---

# 40. Unit Test — Split Caret Destination

```text
removed=P20
added=P22,P21
selection=P21
```

必须：

```text
caretDestination=P21
```

---

# 41. Unit Test — Split Canonical Owner

若 local continuity 唯一证明：

```text
P22 completed old paragraph
```

必须：

```text
canonicalOwner=P22
canonicalOwner != caretDestination
```

---

# 42. Unit Test — Promotion Proof

```text
valid proof → PROMOTE
binding mismatch → BLOCK
runtime mismatch → BLOCK
element disconnected → BLOCK
generation stale → BLOCK
recordId-only live promotion → unavailable/BLOCK
```

---

# 43. Unit Test — Selection Consistency

如果：

```text
resolveSelectionParagraph().runtimeId=P4
```

则同一 observation 下：

```text
EDITOR-MUTATION-BATCH
OBS-SELECTION
POST-TOKEN-SELECTION
```

都必须报告 P4。

---

# 44. Runtime Acceptance G1 — Merge Shape

构造：

```text
2 removed
1 added
```

必须：

```text
EDITOR-MUTATION-CLASSIFICATION
kind=MERGE_2_TO_1
```

必须 0：

```text
2→1 batch
kind=REPLACE_1_TO_1
```

---

# 45. Runtime Acceptance G2 — 1→1 Transfer 10/10

只有真实：

```text
1 removed
1 added
```

才允许 REPLACE_1_TO_1。

成功 10/10：

```text
EDITOR-CONTINUITY-RESOLVE
decision=RESOLVED

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT
```

---

# 46. Runtime Acceptance G3 — Split 10/10

正常 Enter：

```text
1 removed
2 added
```

每次必须：

```text
kind=SPLIT_1_TO_2

SPLIT-CARET-DESTINATION
decision=RESOLVED

EDITOR-CONTINUITY-RESOLVE
canonicalOwnerRuntimeId=<completed paragraph>
caretDestinationRuntimeId=<selection paragraph>

canonicalOwner != caretDestination
```

10/10。

---

# 47. Runtime Acceptance G4 — Original Paragraph Retains Indent

操作：

```text
。。+Enter
→ 输入正文
→ normal Enter
```

必须：

```text
completed original paragraph:
same canonicalRecordId
semantic=force-indent
computed indent=expected

new paragraph:
no old canonicalRecordId
semantic=auto
caret inside
```

---

# 48. Runtime Acceptance G5 — No Permanent Awaiting

对 evidence-resolvable 1→1 / 1→2：

```text
CURRENT_AWAITING_TRANSFER
```

不得超过：

```text
2000ms
```

必须回：

```text
CURRENT_LIVE
```

---

# 49. Runtime Acceptance G6 — Promotion Proof 5/5

合法 promotion：

```text
bindingVerified=true
elementConnected=true
generationMatches=true
runtimeIdMatches=true
decision=PROMOTE
```

至少 5/5。

必须：

```text
bindingVerified=false decision=PROMOTE = 0
elementConnected=false decision=PROMOTE = 0
generationMatches=false decision=PROMOTE = 0
REGISTRY-BLOCK-IGNORED = 0
```

---

# 50. Runtime Acceptance G7 — Selection Consistency

必须 0：

```text
selParagraph=undefined
sameAsCommand=true
```

如果：

```text
EDITOR-MUTATION-BATCH selectionRuntimeId=P4
```

同一 selection observation 必须：

```text
OBS-SELECTION selParagraph=P4
```

---

# 51. Runtime Acceptance G8 — Real User Flow

至少 10 次：

```text
输入 “。。”
→ Enter
→ 当前行首行缩进
→ 光标仍位于正确 current paragraph
→ 输入正文
→ normal Enter
→ 原段保持首行缩进
→ 新段保持 auto
→ caret 在新段
→ ↑↓ 正常
```

10/10。

---

# 52. Runtime Acceptance G9 — Regression

继续必须：

```text
HANDOFF-CLOSE works
stale handoff transfer = 0
live owner dominance works
historical/live false multi-owner = 0
single-dot wrong apply = 0
Backspace CREATE_NEW = 0
current-session historical heuristic = 0
physical sidecar PASS
```

---

# 53. Runtime Acceptance G10 — Strict Startup

必须验证：

```text
old process exited
new PID
StartTime
MainWindowHandle != 0
MainWindowTitle nonempty
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
2 removed / 1 added → REPLACE_1_TO_1

1 removed / 2 added → not SPLIT_1_TO_2

SPLIT selectionRuntimeId among added but caretDestination unresolved

SPLIT canonicalOwner == caretDestination without special-command contract

normal Enter new paragraph inherits old canonicalRecordId

normal Enter completed old paragraph loses force-indent

evidence-resolvable split awaitingForMs > 2000

bindingVerified=false decision=PROMOTE

elementConnected=false decision=PROMOTE

generationMatches=false decision=PROMOTE

Registry mutates before proof validation

recordId-only live promotion still reachable

selParagraph=undefined sameAsCommand=true

MutationObserver selectionRuntimeId != OBS-SELECTION runtimeId at same observation

stale handoff transfer

historical candidate blocks exact CURRENT_LIVE owner

plugin runtime path still electron.asar renderer main.js

plugin SHA unknown

runtime Build ID mismatch

deployed SHA mismatch
```

立即：

```text
R58.6.2 NOT FIXED — R60 BLOCKED
```

---

# 55. 禁止的假修复

禁止：

```text
根据 canonical participant count 改写 mutation shape

2→1 当 1→1 transfer

SPLIT 看到两个 added 就直接 ambiguous

用 historical anchor 解决 current-session split

用 ordinal-only / text-only global search 解决 split

仅修改日志为 MERGE/SPLIT 但 resolver 仍旧逻辑

在 Service 后补 proof 日志掩盖 Registry 已先 mutation

强制打印 bindingVerified=true

保留 recordId-only live promotion bypass

OBS-SELECTION 单独继续使用 cursorOffset 推断 paragraph

拦截 ArrowDown 手工修导航

无限 setSelection / setTimeout 抢 caret

重新修改 stale handoff close

重新修改 live owner dominance

本轮做 sidecar compaction
```

---

# 56. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-canonical-registry.ts
src/main.ts
src/heading-numbering/paragraph-indent-forensic.ts
```

如果已有：

```text
editor-continuity.ts
selection helper
```

允许集中修改。

禁止扩大到：

```text
single-dot core
Two-Pass historical algorithm
heading numbering engine
outline numbering
template system
```

---

# 57. Source Map 必须先做

修改前必须输出：

```text
MutationObserver callback
→ file/function

mutation classification
→ file/function

resolveLiveReplacement
→ file/function

split detection
→ file/function

Promotion call sites
→ file/function

recordId-only promotion APIs
→ file/function

resolveLiveOwnershipProof
→ file/function

OBS-SELECTION
→ file/function

EDITOR-MUTATION-BATCH selection resolver
→ file/function

POST-TOKEN-SELECTION resolver
→ file/function

plugin artifact path resolution
→ file/function
```

先确认 production bypass，再改代码。

---

# 58. Build / Deploy

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
project dist main.js SHA256
deployed plugin main.js SHA256
style.css SHA256
Build ID
```

---

# 59. Strict Restart Rule

启动/重启 Typora 后，不允许只因为 restart script exit 0 就宣称成功。

必须验证：

```text
process
main window
title
target vault
target document
real plugin runtime bundle
SHA256
Build ID
initializationCount
```

未完整验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 60. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Mutation Shape Root Cause
## 4. Mutation Shape Authority
## 5. Shape vs Canonical Participation
## 6. 1→1 Resolver
## 7. 2→1 Merge Classification
## 8. Split Root Cause
## 9. Split Caret Destination
## 10. Split Canonical Owner
## 11. Split Transfer
## 12. No Permanent Awaiting
## 13. Promotion Root Cause
## 14. Proof-Before-Mutation
## 15. Removed RecordId-Only Promotion Paths
## 16. Registry Block Propagation
## 17. Selection Root Cause
## 18. Unified Selection Resolver
## 19. Selection Diagnostic Consistency
## 20. Plugin Artifact Path
## 21. Files Changed
## 22. Build ID
## 23. Typecheck
## 24. Tests
## 25. Build
## 26. Deploy SHA256
## 27. Strict Startup
## 28. G1 Merge Shape
## 29. G2 1→1 10/10
## 30. G3 Split 10/10
## 31. G4 Original Indent Retained
## 32. G5 No Permanent Awaiting
## 33. G6 Promotion Proof
## 34. G7 Selection Consistency
## 35. G8 Real User Flow 10/10
## 36. G9 Regression
## 37. G10 Strict Startup
## 38. Hard Stop Counts
## 39. Remaining Known Issues
## 40. Final Verdict
```

---

# 61. Final Verdict

最终只能：

```text
R58.6.2 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.2 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.2 FIXED
```

不等于：

```text
R60 UNLOCKED
```

仍需完成 R58.6 原始 GUI/runtime acceptance。

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.2 NOT FIXED — R60 BLOCKED
```

---

# 62. Execution Rules

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
MutationRecord shape
removed/added counts
canonical participant count
split owner
caret destination
selection runtimeId
LiveOwnershipProof
promotion authorization
PID
StartTime
HWND
window title
vault
active document
plugin artifact path
SHA256
Build ID
runtime pass count
```

本轮严格按：

```text
Shape Authority
→ Split Resolver
→ Proof-Before-Mutation
→ Unified Selection Identity
```

顺序执行。

不要重新扩大问题范围。

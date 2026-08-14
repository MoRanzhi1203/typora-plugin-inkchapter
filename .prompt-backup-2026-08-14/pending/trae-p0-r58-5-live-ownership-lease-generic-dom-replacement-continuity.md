# TRAE P0 — R58.5 Live Ownership Lease + Generic DOM Replacement Continuity

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Canonical Ownership Continuity**
>
> Purpose:
>
> 1. 补齐 Typora 普通编辑 / re-render 过程中发生的 **非 Enter One-Shot Handoff DOM replacement**；
> 2. 建立 `LiveOwnershipProof + generation lease`，让 Promotion / Backspace / UI Update 不能在 stale runtime ownership 上修改 canonical record；
> 3. 引入 `LiveReplacementTicket`，用 current-session DOM continuity evidence 恢复 canonical binding；
> 4. 保留已经验证有效的 R58.2–R58.4 成果，不重新开放 current-session historical heuristic；
> 5. 完成 physical sidecar reopen/restart + `PERSISTED_HISTORICAL` 验证；
> 6. 修正 strict startup runtime plugin artifact path。
>
> Current authoritative status:
>
> ```text
> R58.4 NOT FIXED
> R60 BLOCKED
> ```

---

# 0. 当前真实 Runtime Ground Truth

最新 runtime 已经证明以下能力真实工作，必须 HARD FREEZE：

```text
vaultRoot =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

vaultRoot source =
vault-service

physical sidecar write =
filesystem-backed real file write

CURRENT_LIVE
→ MATCH-LIVE-BINDING only

CURRENT_LIVE rehydrate
→ dirty=false
→ reason=live-projection-only
→ writeScheduled=false

CURRENT_AWAITING_TRANSFER
→ persistent heuristic candidateCount=0

current-session record:
MATCH-EXACT-ANCHOR = 0
MATCH-NORMALIZED-ANCHOR = 0
MATCH-PROXIMITY = 0
MATCH-LEGACY = 0

SINGLE-DOT-WRONG-APPLY = 0

SINGLE-DOT-CURRENT-SESSION-CANDIDATE = 0

unexpected current-session multi-owner = 0

Enter One-Shot Handoff:
P-RUNTIME-1
→ P-RUNTIME-3
same canonicalRecordId
generation 1→2
recordCount unchanged

CANONICAL-BINDING-TRANSFER:
fromRuntimeId known
toRuntimeId known

premature immediate RETIRE:
已不再发生
```

这些全部冻结。

---

# 1. 当前真正未解决的根因

最新 runtime 已出现以下真实链路：

```text
Enter
→ canonical record R1
→ runtime P1

Typora replacement
→ One-Shot Handoff exists
→ R1 P1 → P3
→ transfer success

用户继续输入正文
→ Typora 再次 replacement P3

此时：
active One-Shot Handoff = none

CURRENT_LIVE-DISCONNECTED
→ CURRENT_AWAITING_TRANSFER

CANONICAL-TRANSFER-PENDING
awaitingForMs:
0
91
411
7313
7363

candidateCount=0
```

说明：

```text
当前 canonical transfer 只覆盖 command-level handoff
```

但 Typora 实际上会在一次 paragraph lifecycle 中发生多次 DOM replacement。

因此：

```text
One-Shot Handoff
不能是唯一 canonical replacement continuity channel
```

---

# 2. 第二个真实失败：Promotion Firewall 仍未真正授权

最新 trace 已出现：

```text
CANONICAL-RECORD-PROMOTION

stateBefore=CURRENT_LIVE
stateAfter=CURRENT_LIVE

bindingVerified=false
elementConnected=false

decision=PROMOTE
```

这说明：

```text
Promotion API 虽然打印 proof fields
但没有把 proof validation 变成 hard authorization
```

当前 Registry 仍允许：

```text
state=CURRENT_LIVE
```

作为单独依据完成 promotion。

这是错误的。

必须升级为：

```text
CURRENT_LIVE
+
valid LiveOwnershipProof
```

才允许 live mutation。

---

# 3. 本轮核心设计

本轮只新增两个核心抽象：

```text
1. LiveOwnershipProof

2. LiveReplacementTicket
```

整体架构：

```text
CanonicalRecordId
        │
        ▼
Live Ownership Lease
(recordId/runtimeId/element/document/generation)
        │
        ├── Promotion
        ├── Backspace
        └── UI Update
        │
DOM replacement
        │
        ▼
LiveReplacementTicket
        │
        ├── command handoff evidence
        └── MutationObserver continuity evidence
        │
        ▼
CANONICAL-BINDING-TRANSFER
generation++
        │
        ▼
new LiveOwnershipProof
```

---

# 4. HARD FREEZE

本轮禁止重新修改以下已通过主链：

```text
CURRENT_LIVE projection-only

persistent resolver lifecycle gate

current-session historical heuristic isolation

single-dot protections

Two-Pass rehydrate

multi-owner BLOCK policy

canonical transfer lineage

Enter atomic commit

POST-TOKEN-SELECTION

Verify-First Caret

Backspace CREATE_NEW prohibition

vault.path authoritative source

physical sidecar write path
```

禁止：

```text
重新开放 MATCH-EXACT-ANCHOR 给 current-session record

为了恢复 owner 使用 generic anchor search

因为 pending 时间长就 retire

用 text similarity / proximity / ordinal-only
作为 generic live transfer final proof

只加更多 guard 而不建立 ownership lease
```

---

# 5. Phase A — Source Map

修改前必须定位：

```text
ParagraphCanonicalRegistry

runtime meta

recordIdByElement

recordIdByRuntimeId

generation update

markAwaitingTransfer

transferCanonicalBinding

promotion path

backspace path

UI paragraph-indent update path

MutationObserver setup

connectObserver

observer callback

MutationRecord handling

removedNodes

addedNodes

paragraph detection

runtimeId assignment / paragraph runtime identity

activeOneShotHandoff

HANDOFF-RESOLVE

physical sidecar load

register persisted records

startup runtime artifact path
```

输出：

```text
behavior
→ source file
→ function
→ current inputs
→ identity source
→ mutation owner
→ bypass risk
```

先 Source Map，再修改。

---

# 6. Phase B — LiveOwnershipProof

新增：

```ts
export interface LiveOwnershipProof {
  recordId: string;
  documentKey: string;
  runtimeId: string;
  element: HTMLElement;
  generation: number;
}
```

含义：

```text
CanonicalRecordId
的当前 live owner lease
```

它不是持久身份。

它只代表：

```text
在某一 generation，
某一个 HTMLElement / runtimeId
被 Registry 确认为该 canonical record 的当前 live owner。
```

---

# 7. Registry 必须提供唯一 Proof Resolver

新增：

```ts
resolveLiveOwnershipProof(
  element: HTMLElement,
  documentKey: string
): LiveOwnershipProof | null
```

必须同时验证：

```text
record exists

runtime meta exists

state === CURRENT_LIVE

element.isConnected === true

meta.currentElement === element

runtimeId exists

meta.currentRuntimeId === runtimeId

recordIdByElement(element) === recordId

recordIdByRuntimeId(runtimeId) === recordId

meta.documentKey === documentKey

generation matches current meta
```

缺任何一项：

```text
return null
```

---

# 8. LiveOwnershipProof Hard Rule

以下 live mutation API 必须强制要求：

```text
LiveOwnershipProof
```

而不是 optional：

```text
Promotion

Backspace

UI existing-record update
```

禁止 API：

```ts
promoteExisting(recordId)
updateBackspace(recordId)
updateFromUI(recordId)
```

改为：

```ts
promoteExisting(proof, patch)

updateBackspace(proof, patch)

updateFromUI(proof, patch)
```

没有 proof：

```text
不能执行 canonical mutation
```

---

# 9. Generation Lease

Registry 每次 canonical binding transfer：

```text
generation++
```

旧 proof：

```text
generation=N
```

在 transfer 后自动失效。

Mutation API 必须：

```text
proof.generation === meta.generation
```

否则：

```text
STALE-LIVE-OWNERSHIP-PROOF
decision=BLOCK
```

这条用于防止：

```text
stale callback
old HTMLElement
delayed promotion
delayed Backspace
```

在 DOM replacement 后继续修改新 owner 的 canonical record。

---

# 10. Proof Audit Trace

新增：

```text
LIVE-OWNERSHIP-PROOF
```

成功字段：

```text
recordId
documentKey
runtimeId
generation
elementConnected=true
state=CURRENT_LIVE
bindingByElement=true
bindingByRuntime=true
decision=VALID
```

失败统一：

```text
LIVE-OWNERSHIP-PROOF-REJECT
```

字段：

```text
recordId?
documentKey
runtimeId?
generation?
reason
```

---

# 11. Phase C — Promotion 必须 Hard Authorize

Promotion 流：

```text
paragraph
↓
resolveLiveOwnershipProof()
↓
proof
↓
registry.promoteExisting(proof)
```

如果 proof=null：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

禁止继续修改：

```text
temporary
anchor
mode
```

---

# 12. Promotion Success Gate

合法 promotion：

```text
proof valid

stateBefore=CURRENT_LIVE

bindingVerified=true

elementConnected=true

runtimeIdMatches=true

generationMatches=true

temporaryBefore=true

temporaryAfter=false

stateAfter=CURRENT_LIVE

recordCount unchanged
```

只有这种：

```text
decision=PROMOTE
```

才可计入 R58.5 Promotion acceptance。

---

# 13. Promotion Illegal State

如果出现：

```text
bindingVerified=false
```

或：

```text
elementConnected=false
```

或：

```text
generationMatches=false
```

则必须：

```text
decision=BLOCK
```

如果日志仍出现：

```text
bindingVerified=false
decision=PROMOTE
```

直接：

```text
HARD STOP
```

---

# 14. Phase D — Backspace 使用同一 Proof

Backspace：

```text
current paragraph
↓
resolveLiveOwnershipProof()
↓
proof
↓
registry.updateBackspace(proof)
```

Proof 不存在：

```text
BACKSPACE-CANONICAL-BLOCK
```

禁止：

```text
anchor search
generic upsert
ordinal fallback
CREATE_NEW
```

---

# 15. Backspace Success Invariant

成功：

```text
same recordId

proof valid

state=CURRENT_LIVE

generation current

UPDATE_EXISTING

sameRecord=true

appendOccurred=false

recordCount unchanged
```

---

# 16. Phase E — UI Existing Update 使用 Proof

如果 UI 操作目标已有 canonical record：

```text
paragraph
↓
resolveLiveOwnershipProof()
↓
registry.updateFromUI(proof)
```

没有 valid proof：

```text
BLOCK
```

禁止 UI 直接改：

```text
record.mode
record.anchor
record.temporary
```

显式创建新 override 是另一独立 intent，
不能复用 existing-update path。

---

# 17. Phase F — LiveReplacementTicket

新增：

```ts
export interface LiveReplacementTicket {
  ticketId: string;

  recordId: string;
  documentKey: string;

  previousElement: HTMLElement;
  previousRuntimeId: string;

  previousGeneration: number;

  parentElement?: HTMLElement;

  previousOrdinal?: number;

  previousSibling?: Node | null;
  nextSibling?: Node | null;

  semanticMode: string;

  createdAt: number;

  source:
    | "COMMAND_HANDOFF"
    | "MUTATION_OBSERVER";
}
```

它只服务 current-session live continuity。

禁止持久化。

---

# 18. Ticket 创建时机

### A. Command Handoff

保留当前 One-Shot Handoff，
但内部可映射为：

```text
LiveReplacementTicket
source=COMMAND_HANDOFF
```

不要求强行重构现有 handoff，只需统一 transfer downstream。

### B. Generic DOM Replacement

MutationObserver 发现：

```text
CURRENT_LIVE bound element
被 removed
```

必须立刻捕获：

```text
recordId
runtimeId
generation
parent
slot/sibling evidence
```

建立：

```text
LiveReplacementTicket
source=MUTATION_OBSERVER
```

随后：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

---

# 19. MutationObserver 是 Generic Replacement 的权威 Continuity Source

不要等 rehydrate 才猜。

必须读取同一批：

```text
MutationRecord[]
```

中的：

```text
removedNodes

addedNodes
```

记录：

```text
old bound paragraph removed

new compatible paragraph added
```

如果在同一 mutation batch / parent / DOM slot 中出现强 continuity：

```text
LIVE-REPLACEMENT-DETECTED
```

---

# 20. Live Replacement Evidence

允许作为 current-session generic replacement proof 的强证据：

```text
same MutationObserver batch

same parent container

old element removed

new paragraph added

same child slot / equivalent insertion position

stable previous sibling boundary

stable next sibling boundary

candidate count exactly 1

same documentKey
```

这些是：

```text
DOM continuity evidence
```

不是 historical heuristic。

---

# 21. 禁止 Generic Live Replacement 使用的证据

禁止作为最终 transfer proof：

```text
anchor similarity

text hash similarity alone

paragraph text equality alone

normalized anchor

proximity search across whole document

ordinal-only match

first candidate wins

legacy resolver
```

这些只能属于：

```text
PERSISTED_HISTORICAL resolver
```

不能用于 current-session generic live transfer。

---

# 22. Generic Live Replacement Resolver

新增等价逻辑：

```ts
resolveLiveReplacement(
  ticket,
  mutationBatch
): ReplacementResolution
```

输出：

```ts
type ReplacementResolution =
  | {
      decision: "TRANSFER";
      replacement: HTMLElement;
      replacementRuntimeId: string;
      evidence: string[];
    }
  | {
      decision: "PENDING";
      reason: string;
      candidateCount: number;
    }
  | {
      decision: "BLOCK";
      reason: string;
      candidateCount: number;
    };
```

---

# 23. Transfer Gate

只有：

```text
candidateCount === 1
+
strong DOM continuity proof
+
record state=CURRENT_AWAITING_TRANSFER
+
ticket generation === meta.generation
+
document match
```

才允许：

```text
CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT
```

---

# 24. Transfer Result

成功：

```text
same canonicalRecordId

fromRuntimeId=ticket.previousRuntimeId

toRuntimeId=new runtimeId

generation:
N → N+1

state:
CURRENT_AWAITING_TRANSFER
→ CURRENT_LIVE

recordCount unchanged

old owner invalidated

new owner established
```

---

# 25. Transfer Reasons

保留区分：

```text
HANDOFF_REPLACE

LIVE_DOM_REPLACEMENT
```

禁止都写成 HANDOFF_REPLACE。

这样验收可以知道：

```text
command replacement
```

和：

```text
ordinary editor DOM replacement
```

是否都被支持。

---

# 26. New Generic Replacement Traces

新增：

```text
LIVE-REPLACEMENT-TICKET

LIVE-REPLACEMENT-DETECTED

LIVE-REPLACEMENT-RESOLVE

LIVE-REPLACEMENT-BLOCK
```

`LIVE-REPLACEMENT-TICKET`：

```text
ticketId
recordId
fromRuntimeId
generation
documentKey
source
```

`LIVE-REPLACEMENT-RESOLVE`：

```text
ticketId
recordId
candidateCount
replacementRuntimeId
evidence
decision
```

---

# 27. Pending Rule

如果：

```text
candidateCount=0
```

或：

```text
candidateCount>1
```

不能猜。

继续：

```text
CURRENT_AWAITING_TRANSFER
```

输出：

```text
CANONICAL-TRANSFER-PENDING
```

但普通 Typora re-render 的正常 replacement 应通过 MutationObserver continuity 被恢复。

---

# 28. Pending Leak Interpretation

注意：

```text
awaitingCount > 0
```

本身不是立刻 FAIL。

但如果：

```text
一次正常 DOM replacement
明显存在唯一 replacement node
```

却长期：

```text
CURRENT_AWAITING_TRANSFER
```

说明 Generic Live Replacement Continuity 失败。

新增：

```text
LIVE-REPLACEMENT-MISSED
```

用于：

```text
removed bound node
+
added unique paragraph in matching slot
+
系统仍未 transfer
```

---

# 29. 禁止通过 Historical Resolver 恢复 Pending Current Record

任何：

```text
CURRENT_AWAITING_TRANSFER
```

仍然：

```text
candidateCount=0
```

persistent resolver 禁止。

即使 generic live replacement resolver失败，
也不能 fallback：

```text
MATCH-EXACT-ANCHOR
MATCH-PROXIMITY
MATCH-LEGACY
```

这是 HARD FREEZE。

---

# 30. Phase G — Physical Sidecar Naming Contract

当前实际使用：

```text
source=filesystem
```

建议统一语义：

```text
source=physical
backend=filesystem
```

修改：

```text
SIDECAR-ACTUAL-WRITE

SIDECAR-ACTUAL-LOAD
```

字段至少：

```text
source=physical
backend=filesystem
```

避免 automated gate：

```text
filesystem != physical
```

产生歧义。

---

# 31. Physical Write Gate

必须保持：

```text
vaultRoot=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

absolutePath=
...\test\vault\.typora\inkchapter\paragraph-layout\doc.md.json

source=physical
backend=filesystem

recordCountAfter=N
```

并检查：

```text
file exists=true
```

---

# 32. Phase H — Physical Reopen / Restart

本轮必须真正执行：

```text
write sidecar
↓
close doc
↓
reopen
```

必须：

```text
SIDECAR-ACTUAL-LOAD
exists=true
recordCount>0
source=physical
```

然后：

```text
REGISTER_PERSISTED
```

---

# 33. Persisted Historical Registration

physical load 后：

```text
state=PERSISTED_HISTORICAL

origin=physical-sidecar
```

禁止保留：

```text
HTMLElement
runtimeId
generation lease
```

这些属于旧 session。

---

# 34. Historical Rehydrate

仅：

```text
PERSISTED_HISTORICAL
```

允许进入 historical resolver：

```text
anchor
textHash
structure
ordinal
legacy compatibility
```

恢复成功后可以：

```text
project semantics
```

但不能把旧 session runtimeId 恢复回来。

---

# 35. Phase I — Strict Startup Runtime Artifact Path

当前错误 banner：

```text
Runtime Main Path:
D:\Typora\resources\electron.asar\renderer\main.js
```

这个是 Typora renderer main.js。

必须改为 InkChapter deployed plugin artifact：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

或实际 authoritative deployed bundle path。

---

# 36. Startup Plugin Artifact Verification

必须输出：

```text
PLUGIN-RUNTIME-ARTIFACT
```

字段：

```text
pluginMainPath

pluginMainSha256

expectedProjectSha256

shaMatch

buildId
```

禁止再把 Electron renderer main.js 当插件 runtime path。

---

# 37. Strict Startup Gate

必须验证：

```text
old process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

target document

InkChapter deployed plugin main.js path

InkChapter plugin main.js SHA256

style.css SHA256

runtime Build ID

initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 38. Build ID

本轮修改完成后换唯一 ID：

```text
inkchapter-r58-5-live-ownership-lease-dom-continuity-<unique>
```

确保：

```text
source
dist
deployed
runtime banner
runtime-load.json
verification expected ID
```

全部一致。

---

# 39. Unit Tests — Proof Resolver

## LP-1

valid CURRENT_LIVE exact owner：

```text
proof VALID
```

## LP-2

element disconnected：

```text
proof REJECT
```

## LP-3

runtime mismatch：

```text
proof REJECT
```

## LP-4

generation stale：

```text
proof REJECT
```

## LP-5

document mismatch：

```text
proof REJECT
```

---

# 40. Unit Tests — Promotion Authorization

## PA-1

valid proof：

```text
PROMOTE
```

## PA-2

bindingVerified=false：

```text
BLOCK
```

## PA-3

elementConnected=false：

```text
BLOCK
```

## PA-4

generation stale：

```text
BLOCK
```

## PA-5

proof missing：

```text
BLOCK
```

---

# 41. Unit Tests — Backspace Authorization

## BA-1

valid proof：

```text
UPDATE_EXISTING
```

## BA-2

stale proof：

```text
BLOCK
```

## BA-3

disconnected element：

```text
BLOCK
```

## BA-4

CREATE_NEW：

```text
impossible
```

---

# 42. Unit Tests — Generic DOM Replacement

## GR-1

same mutation batch：

```text
remove old bound P1
add exactly one replacement P2
same parent/slot

→ LIVE_DOM_REPLACEMENT transfer
```

## GR-2

candidateCount=0：

```text
PENDING
```

## GR-3

candidateCount=2：

```text
BLOCK / PENDING
no transfer
```

## GR-4

different document：

```text
BLOCK
```

## GR-5

ordinal-only similarity：

```text
not enough
```

---

# 43. Unit Tests — Generation Invalidation

```text
proof generation=1

transfer
meta generation=2

old proof mutation
→ STALE-LIVE-OWNERSHIP-PROOF
→ BLOCK
```

---

# 44. Unit Tests — Historical Isolation

```text
CURRENT_AWAITING_TRANSFER
→ historical resolver forbidden
```

即使 generic replacement unresolved：

```text
MATCH-EXACT-ANCHOR = 0
```

---

# 45. Typecheck / Test / Build

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

记录：

```text
exit code
test files
test count
failures
```

---

# 46. Deploy

仅使用 authoritative：

```text
scripts/deploy-test-vault.ps1
```

记录：

```text
project main.js SHA256

deployed plugin main.js SHA256

style.css SHA256

Build ID

match=true
```

---

# 47. Runtime Acceptance R1 — Enter Handoff Regression 5/5

继续验证：

```text
Enter
→ actual replacement
→ HANDOFF_REPLACE
```

5/5。

必须：

```text
same recordId
generation+1
recordCount unchanged
```

---

# 48. Runtime Acceptance R2 — Generic Live DOM Replacement 10/10

这是本轮主验收。

每轮：

```text
canonical paragraph CURRENT_LIVE
↓
normal typing / edit
↓
Typora DOM replacement
↓
no active One-Shot Handoff
```

必须：

```text
LIVE-REPLACEMENT-TICKET

LIVE-REPLACEMENT-RESOLVE
candidateCount=1

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_REPLACEMENT

same recordId

fromRuntimeId known

toRuntimeId known

generation+1

recordCount unchanged

state=CURRENT_LIVE
```

10/10。

禁止：

```text
永久 CURRENT_AWAITING_TRANSFER
```

对于明显有唯一 same-batch replacement 的 case。

---

# 49. Runtime Acceptance R3 — Ownership Lease Mutation

对经历过至少一次 generic transfer 的 record：

```text
resolve new LiveOwnershipProof
```

必须：

```text
new runtimeId

new element

new generation
```

旧 proof：

```text
must be rejected
```

---

# 50. Runtime Acceptance R4 — Promotion 5/5

每轮：

```text
valid LiveOwnershipProof
```

才允许：

```text
PROMOTE
```

必须：

```text
bindingVerified=true

elementConnected=true

runtimeIdMatches=true

generationMatches=true

stateBefore=CURRENT_LIVE

stateAfter=CURRENT_LIVE

recordCount unchanged
```

5/5。

任何：

```text
bindingVerified=false
decision=PROMOTE
```

立即 FAIL。

---

# 51. Runtime Acceptance R5 — Replacement → Backspace 10/10

至少覆盖：

```text
Enter handoff replacement

Generic live DOM replacement
```

之后 Backspace：

```text
valid current proof

UPDATE_EXISTING

same recordId

appendOccurred=false

recordCount unchanged
```

10/10。

---

# 52. Runtime Acceptance R6 — Pending Safety

故意构造 ambiguous / no replacement case。

必须：

```text
CURRENT_AWAITING_TRANSFER

candidateCount=0 or >1

no historical heuristic

no wrong transfer

no retire from timing alone
```

---

# 53. Runtime Acceptance R7 — Single Dot Regression 10/10

继续：

```text
。
```

10 logical cases。

必须：

```text
semantic=auto

SINGLE-DOT-WRONG-APPLY=0

SINGLE-DOT-CURRENT-SESSION-CANDIDATE=0
```

---

# 54. Runtime Acceptance R8 — Live Projection Regression

连续至少 10 refresh：

```text
CURRENT_LIVE
MATCH-LIVE-BINDING

dirty=false
reason=live-projection-only
writeScheduled=false
```

---

# 55. Runtime Acceptance R9 — Physical Save/Reopen

必须：

```text
SIDECAR-ACTUAL-WRITE
source=physical
backend=filesystem
file exists=true
```

然后：

```text
close/reopen
SIDECAR-ACTUAL-LOAD
exists=true
source=physical
recordCount>0
```

---

# 56. Runtime Acceptance R10 — Restart Historical Load

重启 Typora 后：

```text
SIDECAR-ACTUAL-LOAD
exists=true

REGISTER_PERSISTED

state=PERSISTED_HISTORICAL

origin=physical-sidecar
```

---

# 57. Runtime Acceptance R11 — Historical Rehydrate

验证：

```text
PERSISTED_HISTORICAL
→ historical resolver allowed
→ correct logical paragraph restored
```

同时：

```text
current-session resolver isolation
```

仍然 0 回退。

---

# 58. Runtime Acceptance R12 — Document Switch 3 Cycles

```text
doc A
→ doc B
→ doc A
```

3 cycles。

必须：

```text
no cross-document live proof

no cross-document replacement ticket

old proofs invalidated

no current-session historical fallback

physical sidecar document identity correct
```

---

# 59. Hard Stop List

任一出现：

```text
bindingVerified=false decision=PROMOTE

elementConnected=false decision=PROMOTE

generationMatches=false decision=PROMOTE

STALE-LIVE-OWNERSHIP-PROOF mutation succeeds

generic DOM replacement exists
but no LIVE_DOM_REPLACEMENT transfer

CURRENT_AWAITING_TRANSFER
→ MATCH-EXACT-ANCHOR

CURRENT_AWAITING_TRANSFER
→ MATCH-PROXIMITY

LIVE_DOM_REPLACEMENT
candidateCount>1
but transfer occurs

LIVE_DOM_REPLACEMENT
ordinal-only evidence
but transfer occurs

BACKSPACE_UPDATE decision=CREATE_NEW

SINGLE-DOT-WRONG-APPLY

SINGLE-DOT-CURRENT-SESSION-CANDIDATE

current-session multi-owner

physical sidecar reopen exists=false after successful write

PERSISTED_HISTORICAL created without physical load

plugin runtime path points to electron.asar renderer main.js

runtime Build ID mismatch

deployed SHA mismatch
```

立即：

```text
R58.5 NOT FIXED — R60 BLOCKED
```

---

# 60. 不允许的假修复

禁止：

```text
给 CURRENT_AWAITING_TRANSFER 新增 anchor fallback

给 paragraph 文本做 equality guessing

用 ordinal-only 恢复 generic replacement

将 CANONICAL-TRANSFER-PENDING 直接改日志为 TRANSFER

Promotion proof fields 继续 optional

只打印 bindingVerified=true 而不真正检查 maps/meta

Backspace 独立再写一套 proof logic

UI 独立再写一套 proof logic

不更新 generation

generic transfer 后旧 proof 仍可 mutation

只验证 physical write 不验证 reopen/load

只验证 load 不验证 PERSISTED_HISTORICAL

把 electron renderer main.js 当 plugin artifact
```

---

# 61. 推荐模块划分

```text
paragraph-canonical-registry.ts
├─ LiveOwnershipProof
├─ proof resolver
├─ generation lease
├─ mutation authorization
├─ transfer
└─ lifecycle

paragraph-live-replacement.ts
├─ LiveReplacementTicket
├─ MutationObserver batch capture
├─ continuity evidence
└─ generic replacement resolution

heading-numbering-service.ts
├─ Enter orchestration
├─ observer integration
├─ Promotion request
├─ Backspace request
├─ UI request
└─ rehydrate projection

paragraph-layout-store.ts
├─ physical load
├─ physical write
└─ sidecar identity
```

如果不拆新文件也可以，
但职责必须保持清晰。

---

# 62. Final Clean Trace — Generic Replacement

成功例：

```text
R1 CURRENT_LIVE
runtime=P3
generation=2

LIVE-REPLACEMENT-TICKET
recordId=R1
fromRuntimeId=P3
generation=2
source=MUTATION_OBSERVER

CURRENT_AWAITING_TRANSFER

LIVE-REPLACEMENT-DETECTED
same batch
same parent
same slot
candidateCount=1

LIVE-REPLACEMENT-RESOLVE
replacementRuntimeId=P4
decision=TRANSFER

CANONICAL-BINDING-TRANSFER
recordId=R1
fromRuntimeId=P3
toRuntimeId=P4
reason=LIVE_DOM_REPLACEMENT
generation 2→3
recordCount unchanged

CURRENT_LIVE

LIVE-OWNERSHIP-PROOF
runtimeId=P4
generation=3
decision=VALID
```

---

# 63. Final Clean Trace — Promotion

```text
LIVE-OWNERSHIP-PROOF
recordId=R1
runtimeId=P4
generation=3
elementConnected=true
bindingByElement=true
bindingByRuntime=true
decision=VALID

CANONICAL-RECORD-PROMOTION
stateBefore=CURRENT_LIVE
stateAfter=CURRENT_LIVE
bindingVerified=true
elementConnected=true
generationMatches=true
temporary true→false
recordCount unchanged
decision=PROMOTE
```

---

# 64. Final Clean Trace — Persistence

```text
SIDECAR-ACTUAL-WRITE
source=physical
backend=filesystem
exists=true

restart

SIDECAR-ACTUAL-LOAD
source=physical
backend=filesystem
exists=true
recordCount=N

REGISTER_PERSISTED
state=PERSISTED_HISTORICAL
origin=physical-sidecar
```

---

# 65. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Root Cause — One-Shot Handoff Coverage Gap
## 4. Root Cause — Promotion Proof Not Enforced
## 5. Files Changed
## 6. LiveOwnershipProof Design
## 7. Generation Lease
## 8. Promotion Authorization
## 9. Backspace Authorization
## 10. UI Authorization
## 11. LiveReplacementTicket
## 12. MutationObserver Continuity Capture
## 13. Generic Live Replacement Resolver
## 14. Transfer Reasons
## 15. Historical Isolation
## 16. Physical Sidecar Naming Contract
## 17. Physical Reopen
## 18. Historical Registration
## 19. Startup Plugin Artifact Path
## 20. Build ID
## 21. Typecheck
## 22. Tests
## 23. Build
## 24. Deploy SHA256
## 25. Strict Startup Verification
## 26. R1 Enter Handoff 5/5
## 27. R2 Generic DOM Replacement 10/10
## 28. R3 Ownership Lease
## 29. R4 Promotion 5/5
## 30. R5 Replacement→Backspace 10/10
## 31. R6 Pending Safety
## 32. R7 Single Dot 10/10
## 33. R8 Live Projection 10/10
## 34. R9 Physical Save/Reopen
## 35. R10 Restart Historical Load
## 36. R11 Historical Rehydrate
## 37. R12 Document Switch 3 Cycles
## 38. Hard Stop Counts
## 39. Remaining Known Issues
## 40. Final Verdict
```

---

# 66. Final Verdict Vocabulary

最终只能：

```text
R58.5 FIXED — R60 UNLOCKED
```

或者：

```text
R58.5 NOT FIXED — R60 BLOCKED
```

任一 mandatory runtime：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.5 NOT FIXED — R60 BLOCKED
```

---

# 67. Execution Rules

直接操作真实 repository：

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
MutationObserver evidence

replacement runtimeId

proof validation

generation

GUI result

PID

StartTime

MainWindowHandle

MainWindowTitle

vaultRoot

active document

plugin runtime artifact path

SHA256

Build ID

physical sidecar path

physical file existence

historical load

runtime acceptance count
```

启动或重启 Typora 后，如果以下没有全部真实确认：

```text
old process
new process
main window
target vault
target document
InkChapter plugin artifact path
plugin SHA256
Build ID
initializationCount
```

必须明确输出：

```text
启动命令已发出，但尚未确认成功
```

只有所有 R58.5 runtime gates 全部真实通过后，
才允许：

```text
R58.5 FIXED — R60 UNLOCKED
```

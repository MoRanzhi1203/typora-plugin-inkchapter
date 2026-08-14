# TRAE P0 — R58.3 Closure Repair: Transfer Lineage, Awaiting-Transfer Terminal Policy, Live Projection-Only, and Physical Sidecar

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Closure Repair**
>
> Purpose: **在保留已验证有效的 R58.2 Canonical Registry + Lifecycle State Machine 基础上，集中修复最后四个阻塞项，并完成真实 Runtime Acceptance。**
>
> Current authoritative status:
>
> ```text
> R58.2 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮禁止再次大规模重构 Registry / lifecycle eligibility。
> 已经验证有效的部分优先保持冻结，只针对剩余未闭环点做最小、可审计、可回归的修复。

---

# 0. 当前真实基线

最新 runtime 已经证明以下 R58.2 设计真实生效：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
→ TRANSFER
→ CURRENT_LIVE
```

并且：

```text
CURRENT_AWAITING_TRANSFER
→ candidateCount=0
→ no persistent heuristic fallback
```

当前日志中未观察到：

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROXIMITY
MATCH-LEGACY

BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER

current-session multi-owner

SINGLE-DOT-WRONG-APPLY
SINGLE-DOT-CURRENT-SESSION-CANDIDATE
```

说明：

```text
current-session record 不再因为 live binding 暂时消失而自动进入 historical heuristic
```

这一架构方向已经生效，禁止本轮回退。

---

# 1. 本轮四个唯一 P0 根问题

## P0-1 — Transfer lineage 不完整

当前真实 trace 出现：

```text
AWAIT_TRANSFER
previousRuntimeId=P-RUNTIME-4
```

随后：

```text
TRANSFER
runtimeId=P-RUNTIME-5
```

但：

```text
CANONICAL-BINDING-TRANSFER
fromRuntimeId=unknown
toRuntimeId=P-RUNTIME-5
```

这说明 canonical record identity 连续性虽然存在，
但 transfer provenance 没有完整保留。

必须修成：

```text
fromRuntimeId=P-RUNTIME-4
toRuntimeId=P-RUNTIME-5
```

不得 unknown。

---

## P0-2 — CURRENT_AWAITING_TRANSFER 缺少 terminal policy

已观察到至少一个 record：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

之后长期：

```text
candidateCount=0
```

但没有：

```text
TRANSFER
```

也没有：

```text
CURRENT_RETIRED
```

这虽然是安全隔离，
但会形成永久 orphan pending record。

必须补完整终态策略：

```text
CURRENT_AWAITING_TRANSFER
→ TRANSFER
或
→ CURRENT_RETIRED
```

不能无限 pending。

---

## P0-3 — CURRENT_LIVE rehydrate 仍在 anchor-repair

当前实际日志存在：

```text
MATCH-LIVE-BINDING
candidateSource=LIVE
```

随后：

```text
REHYDRATE-WRITE-AUDIT
dirty=true
reason=anchor-repair
writeScheduled=true
```

这违反 R58.2 architecture：

```text
CURRENT_LIVE rehydrate
= projection only
```

Live rehydrate 不得修改 canonical anchor，
不得因此标 dirty，
不得 schedule sidecar write。

---

## P0-4 — Physical sidecar 仍 disabled

当前 runtime 仍显示：

```text
SIDECAR-DISABLED
vaultRoot unknown

SIDECAR-ACTUAL-LOAD
source=disabled

SIDECAR-ACTUAL-WRITE
source=disabled
```

必须解析 authoritative vaultRoot 并真正启用：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

禁止恢复 TEMP fallback。

---

# 2. HARD FREEZE — 本轮禁止回退的已修复能力

以下已验证有效行为必须保持：

```text
CanonicalRecordId = 唯一业务身份

Canonical Registry

CanonicalRuntimeState

CURRENT_LIVE

CURRENT_AWAITING_TRANSFER

CURRENT_RETIRED

PERSISTED_HISTORICAL

CURRENT_AWAITING_TRANSFER → zero heuristic candidates

CURRENT_LIVE → MATCH-LIVE-BINDING only

current-session record 禁止 persistent resolver

BACKSPACE_UPDATE 不得 CREATE_NEW

Two-Pass Rehydrate

multi-owner = BLOCK

single-dot semantic default remains auto

One-Shot Handoff

Verify-First Caret

POST-TOKEN-SELECTION

Phase 1 writer = 0
```

禁止为了修 vaultRoot / transfer 而重新引入：

```text
binding missing → MATCH-EXACT-ANCHOR

current-session → persistent heuristic

generic Backspace upsert

first-candidate incremental apply

same-mode ambiguity amnesty
```

---

# 3. Phase A — Source Map

修改前必须先定位真实生产代码：

```text
ParagraphCanonicalRegistry

markAwaitingTransfer
transferBinding
retire / cleanup APIs

activeOneShotHandoff
HANDOFF-RESOLVE
HANDOFF-TRANSFER
CANONICAL-BINDING-TRANSFER emitter

resolveParagraphOverrideRehydratePlan
applyParagraphRehydratePlan
anchor repair branch
scheduleSidecarWrite

paragraph-layout-store.ts
getSidecarDir
getSidecarPath
loadParagraphLayout
saveParagraphLayout

vaultRoot source / app.vault / workspace / current file path service

document switch cleanup
```

输出：

```text
behavior
→ source file
→ function
→ current input
→ current state mutation
→ current failure mode
```

然后再修改。

---

# 4. Phase B — 修复 Transfer Lineage

目标：

```text
AWAIT_TRANSFER 时保存 previousRuntimeId
TRANSFER 时继续携带并输出 previousRuntimeId
```

禁止：

```text
markAwaitingTransfer()
清空 currentRuntimeId
↓
transfer 时再去读 currentRuntimeId
↓
fromRuntimeId=unknown
```

推荐实现：

```ts
interface CanonicalRuntimeMeta {
  currentRuntimeId?: string;
  previousRuntimeId?: string;
  ...
}
```

进入 awaiting：

```ts
previousRuntimeId = currentRuntimeId;
currentRuntimeId = undefined;
state = "CURRENT_AWAITING_TRANSFER";
```

transfer：

```ts
const fromRuntimeId = meta.previousRuntimeId;
const toRuntimeId = replacementRuntimeId;
```

成功后：

```text
currentRuntimeId = toRuntimeId
previousRuntimeId = fromRuntimeId 或按设计保留 audit snapshot
generation + 1
state=CURRENT_LIVE
```

---

# 5. Transfer Hard Invariant

`CANONICAL-BINDING-TRANSFER` 必须包含：

```text
canonicalRecordId
fromRuntimeId
toRuntimeId

stateBefore=CURRENT_AWAITING_TRANSFER
stateAfter=CURRENT_LIVE

generationBefore
generationAfter

oldOwnerInvalidated=true
newOwnerEstablished=true

recordCountBefore
recordCountAfter
```

硬要求：

```text
fromRuntimeId != unknown
toRuntimeId != unknown

fromRuntimeId != toRuntimeId

recordCountBefore === recordCountAfter
generationAfter === generationBefore + 1
```

任一失败：

```text
TRANSFER-LINEAGE-INVARIANT-VIOLATION
```

立即 HARD STOP。

---

# 6. Phase C — AWAITING_TRANSFER Terminal Policy

必须定义：

```text
CURRENT_AWAITING_TRANSFER
```

何时：

```text
继续等待
TRANSFER
RETIRED
```

禁止永久 pending。

推荐增加 runtime metadata：

```ts
awaitingSince?: number;
handoffId?: string;
handoffGeneration?: number;
awaitingReason?: string;
```

---

# 7. Allowed AWAITING_TRANSFER Outcomes

## Outcome A — replacement 唯一确定

```text
CURRENT_AWAITING_TRANSFER
→ TRANSFER
→ CURRENT_LIVE
```

## Outcome B — replacement 在 handoff TTL 内未确定

继续：

```text
CURRENT_AWAITING_TRANSFER
```

但必须输出：

```text
CANONICAL-TRANSFER-PENDING
```

至少字段：

```text
recordId
previousRuntimeId
handoffId
awaitingForMs
candidateCount
reason
```

## Outcome C — handoff definitively expired / original logical paragraph gone

```text
CURRENT_AWAITING_TRANSFER
→ CURRENT_RETIRED
```

输出：

```text
RECORD-LIFECYCLE
event=RETIRE
```

---

# 8. Retirement 规则

Retire 必须是：

```text
runtime ownership retirement
```

不是：

```text
delete canonical record
```

除非业务本身明确删除 override。

`CURRENT_RETIRED`：

```text
candidateCount=0
persistent heuristic=forbidden
live binding=none
runtimeId binding=none
```

禁止：

```text
CURRENT_RETIRED
→ PERSISTED_HISTORICAL
```

在同一 runtime session 中静默发生。

只有真实 sidecar reload 才能注册为：

```text
PERSISTED_HISTORICAL
```

---

# 9. Awaiting Transfer Leak Gate

增加检查：

```text
AWAITING-TRANSFER-LEAK-AUDIT
```

每次稳定 refresh / handoff cleanup 时报告：

```text
awaitingCount
oldestAwaitingMs
recordIds
```

在无 active handoff 的稳定状态下：

```text
awaitingCount must become 0
```

若 handoff 已结束但 record 仍永久 awaiting：

```text
AWAITING-TRANSFER-LEAK
```

HARD STOP。

---

# 10. Phase D — CURRENT_LIVE Rehydrate = Projection Only

这是本轮最重要的源码修复之一。

对于：

```text
runtimeState=CURRENT_LIVE
candidateSource=LIVE
matchStrategy=MATCH-LIVE-BINDING
```

`applyParagraphRehydratePlan()` 只能：

```text
apply semantic projection
apply visual projection
```

绝对禁止：

```text
repair anchor
mutate canonical record metadata
mark dirty
scheduleSidecarWrite
```

---

# 11. Live Projection Branch Must Return Before Anchor Repair

建议形成显式结构：

```ts
if (runtimeState === "CURRENT_LIVE") {
  applyLiveProjection(...);

  emit REHYDRATE-WRITE-AUDIT:
    dirty=false
    reason=live-projection-only
    writeScheduled=false

  continue;
}
```

之后 historical repair branch 只处理：

```text
PERSISTED_HISTORICAL
```

不能让 LIVE 分支 fallthrough 到 anchor repair。

---

# 12. Canonical Mutation Instrumentation

任何 rehydrate 引发 canonical record mutation 必须输出：

```text
REHYDRATE-CANONICAL-MUTATION
```

字段：

```text
planId
recordId
runtimeState
candidateSource
matchStrategy
mutationType
before
after
```

规则：

```text
CURRENT_LIVE
→ REHYDRATE-CANONICAL-MUTATION count must be 0
```

如果：

```text
dirty=true
```

但：

```text
REHYDRATE-CANONICAL-MUTATION absent
```

说明 dirty classification 错误。

如果 mutation 真发生但日志没打：

```text
instrumentation FAIL
```

---

# 13. Historical Anchor Repair Only

只有：

```text
runtimeState=PERSISTED_HISTORICAL
```

才允许考虑：

```text
anchor repair
```

且必须：

```text
trusted historical target
+
normalize(oldAnchor) != normalize(newAnchor)
```

才：

```text
dirty=true
writeScheduled=true
```

相同 anchor：

```text
dirty=false
writeScheduled=false
```

---

# 14. Settled Refresh Gate

无用户编辑情况下连续 10 次 refresh：

```text
CURRENT_LIVE records
```

必须全部：

```text
REHYDRATE-CANONICAL-MUTATION=0

REHYDRATE-WRITE-AUDIT
dirty=false
writeScheduled=false
reason=live-projection-only
或
reason=no-anchor-repair-needed
```

任何一次 live anchor repair：

```text
HARD STOP
```

---

# 15. Phase E — Authoritative Vault Root Resolution

禁止：

```text
TEMP fallback
guess random parent
hardcode production user path
```

必须优先读取实际 Typora community plugin runtime 中的 authoritative vault service。

从当前运行环境真实 source map / API 中确认可用来源，例如：

```text
app.vault
vault.path
workspace active file
plugin core service
```

不要凭记忆猜 API。

---

# 16. Vault Root Resolution Contract

必须实现：

```text
resolveVaultRoot()
```

返回：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

测试环境下。

要求：

```text
vaultRoot exists
target document lies under vaultRoot
sidecar path lies under vaultRoot-controlled .typora directory
```

禁止：

```text
vaultRoot=unknown
```

进入 physical persistence acceptance。

---

# 17. Sidecar Storage Identity

明确统一 storage root：

```text
vaultRoot
+
documentKey
+
InkChapter sidecar namespace
```

同一 document：

```text
save
load
restart
```

必须解析成相同 physical path。

输出：

```text
SIDECAR-STORAGE-IDENTITY
```

字段：

```text
vaultRoot
documentKey
storageRoot
sidecarPath
source=physical
```

---

# 18. Physical Write Contract

`saveParagraphLayout()` 必须真实输出：

```text
SIDECAR-ACTUAL-WRITE

documentKey=doc.md
vaultRoot=<real path>
source=physical
sidecarPath=<real path>
recordCount=N
success=true
```

必须实际文件存在。

禁止仅打印 log 但没有 physical file。

---

# 19. Physical Load Contract

重新打开 / 重启后：

```text
SIDECAR-ACTUAL-LOAD

documentKey=doc.md
vaultRoot=<real path>
source=physical
sidecarPath=<same path>
recordCount=N
success=true
```

并且 loaded records：

```text
REGISTER_PERSISTED
state=PERSISTED_HISTORICAL
origin=physical-sidecar
```

禁止：

```text
in-memory current-session records
伪装 PERSISTED_HISTORICAL
```

---

# 20. Phase F — Build ID 修正

当前 runtime banner 仍可能显示旧：

```text
inkchapter-canonical-lifecycle-repair-r58-final-m3n7p
```

本轮 source 修改完成后必须换新唯一 Build ID。

建议：

```text
inkchapter-r58-3-closure-transfer-live-projection-sidecar-<unique>
```

并保证：

```text
source Build ID
dist/main.js Build ID
deployed main.js Build ID
runtime banner
runtime-load.json
verification script expected Build ID
```

全部一致。

---

# 21. Build ID Hard Stop

如果：

```text
runtime Build ID != source expected Build ID
```

则：

```text
HARD STOP — RUNTIME_BUILD_ID_MISMATCH
```

不得继续 GUI acceptance。

---

# 22. Source-Level Tests — Transfer

至少：

## TR-1

```text
P1 CURRENT_LIVE
→ markAwaiting
→ previousRuntimeId=P1
```

## TR-2

```text
P1 awaiting
→ transfer P2
→ fromRuntimeId=P1
→ toRuntimeId=P2
→ same recordId
→ generation +1
```

## TR-3

transfer 不改变 record count。

## TR-4

transfer 无 previousRuntimeId：

```text
BLOCK / invariant violation
```

不能输出 unknown 然后继续算成功。

---

# 23. Source-Level Tests — Await Terminal

## AT-1

unique replacement：

```text
AWAITING → LIVE
```

## AT-2

temporary pending：

```text
still AWAITING
CANONICAL-TRANSFER-PENDING
```

## AT-3

handoff expired / logical paragraph gone：

```text
AWAITING → RETIRED
```

## AT-4

RETIRED：

```text
candidateCount=0
```

## AT-5

RETIRED cannot enter persistent resolver in same session。

---

# 24. Source-Level Tests — Live Projection

## LP-1

CURRENT_LIVE + MATCH-LIVE-BINDING：

```text
semantic projection applied
dirty=false
writeScheduled=false
canonical mutation=0
```

## LP-2

CURRENT_LIVE anchor changed in DOM：

```text
rehydrate must not repair anchor
```

## LP-3

PERSISTED_HISTORICAL materially stale anchor：

```text
one controlled repair allowed
```

## LP-4

same normalized historical anchor：

```text
no dirty
no write
```

---

# 25. Source-Level Tests — Vault Root

## VR-1

test vault runtime service returns exact:

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

## VR-2

document key resolves under vault.

## VR-3

sidecar path stable across save/load.

## VR-4

TEMP fallback remains blocked.

## VR-5

unknown vaultRoot causes explicit BLOCK,
但在正常 test runtime 不应再出现。

---

# 26. Typecheck / Tests / Build

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

# 27. Deploy

只使用 authoritative：

```text
scripts/deploy-test-vault.ps1
```

核对：

```text
project dist/main.js SHA256
runtime dist/main.js SHA256
match=true

project dist/style.css SHA256
runtime dist/style.css SHA256
match=true

Build ID
```

任何 mismatch：

```text
HARD STOP — DEPLOY_ARTIFACT_MISMATCH
```

---

# 28. Strict Typora Restart Verification

重启前：

```text
record old PID
stop old process
verify old process exited
```

启动后必须验证：

```text
new PID
new StartTime
MainWindowHandle != 0
MainWindowTitle nonempty

target vault
target test document

runtime main.js path
runtime main.js SHA256
runtime style.css SHA256

runtime Build ID
initializationCount=1
```

如果启动命令已发出，但任一项未确认：

```text
启动命令已发出，但尚未确认成功
```

禁止仅输出：

```text
Typora 已重新启动
```

---

# 29. Runtime Acceptance R1 — Baseline Enter 3/3

保留回归：

```text
fresh paragraph
→ exact token
→ Enter
```

必须：

```text
CURRENT_LIVE
CANONICAL-RECORD-COMMIT
duplicateAppendDetected=false
recordCount exactly +1
```

3/3。

---

# 30. Runtime Acceptance R2 — Replacement 5/5

每轮：

```text
Enter
→ actual originalConnected=false
→ CURRENT_AWAITING_TRANSFER
→ CANONICAL-BINDING-TRANSFER
→ CURRENT_LIVE replacement
```

必须：

```text
same canonicalRecordId
fromRuntimeId known
toRuntimeId known
generation +1
recordCount unchanged
old owner invalidated
new owner active
```

5/5。

---

# 31. Runtime Acceptance R3 — Replacement → Backspace 10/10

这是本轮主回归。

每轮：

```text
Enter
→ actual replacement
→ verify transfer
→ place caret at logical start of replacement paragraph
→ Backspace
```

必须：

```text
same canonicalRecordId

BACKSPACE_UPDATE
decision=UPDATE_EXISTING

recordCountBefore === recordCountAfter

CANONICAL-RECORD-BACKSPACE
sameRecord=true
appendOccurred=false
```

禁止：

```text
CREATE_NEW
BACKSPACE-DUPLICATE-RECORD-BUG
BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION
```

10/10。

---

# 32. Runtime Acceptance R4 — Awaiting Terminal

构造/观察至少 3 次 replacement continuity。

必须证明：

```text
每个 CURRENT_AWAITING_TRANSFER
最终：
→ TRANSFER
或
→ RETIRED
```

稳定状态下：

```text
AWAITING-TRANSFER-LEAK-AUDIT
awaitingCount=0
```

如果还有无 active handoff 的长期 awaiting：

```text
FAIL
```

---

# 33. Runtime Acceptance R5 — Single Dot 补足 10/10

执行 10 个独立 logical case：

```text
new unbound paragraph
→ type only `。`
→ refresh / composition / DOM churn
```

必须：

```text
semantic=auto
computed=0px or current resolved auto style

SINGLE-DOT-WRONG-APPLY=0
SINGLE-DOT-CURRENT-SESSION-CANDIDATE=0
```

10/10。

---

# 34. Runtime Acceptance R6 — Multi-owner

整场：

```text
unexpected current-session multi-owner=0
LIVE-BINDING-COLLISION=0
```

若 historical sidecar records 产生 ambiguity：

```text
允许 Two-Pass BLOCK
但 lifecycleState 必须全部 PERSISTED_HISTORICAL
```

---

# 35. Runtime Acceptance R7 — Promotion 5/5

每轮：

```text
temporary CURRENT_LIVE record
→ 输入稳定正文内容
→ promotion
```

必须：

```text
CANONICAL-RECORD-PROMOTION

same recordId
temporary true→false
state CURRENT_LIVE
binding retained
recordCount unchanged
```

5/5。

---

# 36. Runtime Acceptance R8 — Live Projection Idempotence 10/10

停止编辑后触发/观察连续 10 次 refresh。

所有 CURRENT_LIVE records 必须：

```text
MATCH-LIVE-BINDING
```

且：

```text
REHYDRATE-CANONICAL-MUTATION=0

dirty=false
writeScheduled=false
```

禁止：

```text
reason=anchor-repair
```

出现在 CURRENT_LIVE projection。

10/10。

---

# 37. Runtime Acceptance R9 — Document Switch 3 Cycles

执行：

```text
doc A → doc B → doc A
```

共 3 cycles。

必须：

```text
A runtime binding 不在 B resolve
B runtime binding 不在 A resolve

document switch 后
current-session record 不进入 historical heuristic

AWAITING_TRANSFER 不泄漏跨文档

record count 不异常增长
```

---

# 38. Runtime Acceptance R10 — Physical Sidecar Save / Reopen / Restart

前提：

```text
vaultRoot resolved
```

然后：

```text
create stable records
save
confirm physical sidecar write

close document
reopen
confirm physical sidecar load

restart Typora
reopen doc
confirm same physical sidecar load
```

必须：

```text
source=physical

loaded record state=PERSISTED_HISTORICAL

same logical semantics restored

no stale current-session binding reused

no duplicate canonical record
```

---

# 39. Runtime Acceptance R11 — Historical Rehydrate

使用 R10 真正物理载入的 record。

必须证明：

```text
PERSISTED_HISTORICAL
→ persistent resolver allowed
```

并：

```text
current-session resolver isolation 仍然成立
```

不能因为本轮隔离过严导致 reopen 永远无法 restore。

---

# 40. Hard Stop List

任一出现：

```text
TRANSFER-LINEAGE-INVARIANT-VIOLATION

CANONICAL-BINDING-TRANSFER fromRuntimeId=unknown

AWAITING-TRANSFER-LEAK

CURRENT_LIVE reason=anchor-repair

CURRENT_LIVE REHYDRATE-CANONICAL-MUTATION

BACKSPACE_UPDATE decision=CREATE_NEW

BACKSPACE-DUPLICATE-RECORD-BUG

BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION

LIVE-BINDING-COLLISION

BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER

SINGLE-DOT-CURRENT-SESSION-CANDIDATE

SINGLE-DOT-WRONG-APPLY

current-session multi-owner

cross-document binding

SIDECAR-ACTUAL-WRITE source=disabled during R10

SIDECAR-ACTUAL-LOAD source=disabled during R10

runtime Build ID mismatch

deploy SHA mismatch
```

立即：

```text
R58.3 NOT FIXED — R60 BLOCKED
```

---

# 41. 本轮禁止的假修复

禁止：

```text
重新推倒 Canonical Registry

重新开放 current-session anchor heuristic

只把 fromRuntimeId log 写成 guessed value

给 AWAITING_TRANSFER 设置任意超时直接删除 canonical record

CURRENT_LIVE anchor-repair 继续发生但改日志 reason

仅让 sidecar log source=physical 但不真正写文件

通过 hardcode test path 假装 authoritative vaultRoot

只跑 unit tests 不跑 GUI runtime

只跑一个 replacement / Backspace 就宣布通过

把 10 条重复 trace 当成 10 个 logical single-dot case
```

---

# 42. Final Clean Trace 目标

成功的一轮应该类似：

```text
ENTER
recordId=R1
state=CURRENT_LIVE
runtimeId=P1

DOM REPLACEMENT
state=CURRENT_AWAITING_TRANSFER
previousRuntimeId=P1

CANONICAL-BINDING-TRANSFER
recordId=R1
fromRuntimeId=P1
toRuntimeId=P2
state=CURRENT_LIVE
generation 1→2
recordCount unchanged

REHYDRATE
recordId=R1
candidateSource=LIVE
MATCH-LIVE-BINDING
dirty=false
writeScheduled=false

BACKSPACE
recordId=R1
UPDATE_EXISTING
sameRecord=true
appendOccurred=false
recordCount unchanged

PROMOTION
recordId=R1
temporary true→false
recordCount unchanged

SIDECAR-ACTUAL-WRITE
source=physical

restart

SIDECAR-ACTUAL-LOAD
source=physical
state=PERSISTED_HISTORICAL
```

---

# 43. Final Report

最终必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Files Changed
## 4. Transfer Lineage Fix
## 5. Awaiting-Transfer Terminal Policy
## 6. Live Projection-Only Fix
## 7. Vault Root Authoritative Resolution
## 8. Physical Sidecar Storage Identity
## 9. Build ID
## 10. Typecheck
## 11. Unit Tests
## 12. Build
## 13. Deploy SHA256
## 14. Strict Typora Startup Verification
## 15. R1 Enter 3/3
## 16. R2 Replacement 5/5
## 17. R3 Replacement→Backspace 10/10
## 18. R4 Awaiting Terminal Results
## 19. R5 Single Dot 10/10
## 20. R6 Multi-owner Result
## 21. R7 Promotion 5/5
## 22. R8 Live Projection Idempotence 10/10
## 23. R9 Document Switch 3 Cycles
## 24. R10 Physical Save/Reopen/Restart
## 25. R11 Historical Rehydrate
## 26. Hard Stop Trace Counts
## 27. Remaining Known Issues
## 28. Final Verdict
```

---

# 44. Final Verdict Vocabulary

最终只能二选一：

```text
R58.3 FIXED — R60 UNLOCKED
```

或：

```text
R58.3 NOT FIXED — R60 BLOCKED
```

任一 mandatory runtime：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

都必须：

```text
R58.3 NOT FIXED — R60 BLOCKED
```

---

# 45. Execution Rules

直接操作真实 repository。

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

不要编造：

```text
GUI interaction
PID
StartTime
window handle
window title
vault path
active document
SHA256
Build ID
runtime trace
sidecar physical path
sidecar physical read/write
```

任何启动命令已发出但严格启动验证不完整时，必须明确输出：

```text
启动命令已发出，但尚未确认成功
```

不要把：

```text
restart script exit=0
```

当作：

```text
Typora 已确认成功启动
```

只有真实 Runtime Acceptance 全部完成后，才允许解锁 R60。

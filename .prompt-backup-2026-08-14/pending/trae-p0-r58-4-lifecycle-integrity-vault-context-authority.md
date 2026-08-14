# TRAE P0 — R58.4 Lifecycle Integrity + Vault Context Authority

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Lifecycle Integrity Repair**
>
> Purpose:
>
> 1. 把 `ParagraphCanonicalRegistry` 从“rehydrate 状态参考”升级为整个 canonical mutation 系统的唯一状态与写权限裁判；
> 2. 彻底修复 premature retirement / retired-record mutation leak；
> 3. 使用 Typora Community Core 的 authoritative vault service (`app → vault → vault.path`) 建立真实 physical sidecar context；
> 4. 保留已经验证有效的 R58.2 / R58.3 成果，不重新大规模重构 rehydrate / handoff / single-dot / transfer 主链。
>
> Current authoritative status:
>
> ```text
> R58.3 NOT FIXED
> R60 BLOCKED
> ```

---

# 0. 当前真实 Runtime Ground Truth

最新真实日志已经证明以下能力有效，必须冻结：

```text
CanonicalRecordId = 唯一业务身份

CURRENT_LIVE
→ MATCH-LIVE-BINDING only

CURRENT_AWAITING_TRANSFER
→ zero persistent heuristic candidates

current-session record
→ MATCH-EXACT-ANCHOR = 0
→ MATCH-NORMALIZED-ANCHOR = 0
→ MATCH-PROXIMITY = 0
→ MATCH-LEGACY = 0

SINGLE-DOT-WRONG-APPLY = 0
SINGLE-DOT-CURRENT-SESSION-CANDIDATE = 0

unexpected current-session multi-owner = 0

CURRENT_LIVE rehydrate
→ dirty=false
→ reason=live-projection-only
→ writeScheduled=false

CANONICAL-BINDING-TRANSFER
→ fromRuntimeId known
→ toRuntimeId known
→ SAME recordId
→ generation +1
→ recordCount unchanged

BACKSPACE_UPDATE
→ no CREATE_NEW
```

这些是本轮的 **HARD FREEZE**。

---

# 1. 当前两个真正的系统性根因

## 根因 A — Registry 不是 Mutation Authority

当前已经出现：

```text
RECORD-LIFECYCLE:
state=CURRENT_RETIRED
```

但后续：

```text
CANONICAL-RECORD-PROMOTION
temporary=true→false
state=CURRENT_LIVE
```

说明：

```text
CURRENT_RETIRED
不是实际终态
```

业务 mutation path 仍可以绕过 registry lifecycle，
直接修改：

```text
record.mode
record.temporary
record.anchor
```

因此：

```text
Registry 目前只是状态记录器
不是 mutation firewall
```

---

## 根因 B — Vault Root 仍来自错误时机 / 错误来源

当前 runtime 明确存在：

```text
[Service] Loading "app → vault"...
```

而 Typora Community Core 内部使用：

```text
this.vault.path
```

但 InkChapter 仍然：

```text
SIDECAR-CONTEXT:
vaultRoot unknown

SIDECAR-ACTUAL-LOAD:
source=disabled

SIDECAR-ACTUAL-WRITE:
source=disabled
```

说明当前：

```text
main.ts
→ startup active file inference
```

不是 authoritative storage context。

本轮必须改成：

```text
app → vault → vault.path
```

作为唯一 vault root source of truth。

---

# 2. HARD FREEZE

本轮禁止重新修改以下已工作主链，除非为了接入 mutation authority 做最小适配：

```text
rehydrate candidate lifecycle isolation

CURRENT_LIVE projection-only

MATCH-LIVE-BINDING resolver

persistent resolver gating

single-dot guards

Two-Pass grouping

multi-owner BLOCK policy

canonical transfer lineage algorithm

fromRuntimeId / toRuntimeId transfer identity

Enter atomic commit

POST-TOKEN-SELECTION

Verify-First Caret

Backspace no-CREATE_NEW invariant
```

禁止：

```text
恢复 current-session anchor heuristic

恢复 generic upsert

为了让 awaitingCount=0 而自动 retire

给 single-dot 新增业务特判代替 lifecycle 修复

重新大规模重写 transferCanonicalBinding
```

---

# 3. Phase A — Source Map

修改前必须定位真实 production implementation：

```text
ParagraphCanonicalRegistry

CanonicalRuntimeState

registerCurrent*
markAwaitingTransfer
transferCanonicalBinding
retireRecord
sweepStaleAwaitingRecords

promotion path
temporary→stable mutation path

Backspace canonical update path

UI canonical update path

generic sidecar mutation path

record.mode direct assignments
record.temporary direct assignments
record.anchor direct assignments

paragraph-layout-store.ts
loadParagraphLayout
saveParagraphLayout
getSidecarDir
getSidecarPath

main.ts
ServiceContext creation

Typora Community Core app/vault service access
vault.path

file-open
editor-load
document-switch
vault-change
```

输出：

```text
behavior
→ file
→ function
→ current lifecycle checks
→ direct mutation
→ bypass possibility
```

先 Source Map，后修改。

---

# 4. Phase B — Registry 升级为唯一 Mutation Authority

新增统一 mutation intent：

```ts
export type CanonicalMutationIntent =
  | "ENTER_CREATE"
  | "BACKSPACE_UPDATE"
  | "PROMOTE"
  | "UI_UPDATE"
  | "TRANSFER_BINDING"
  | "EXPLICIT_RETIRE"
  | "HISTORICAL_REPAIR";
```

建议统一 API：

```ts
mutateCanonicalRecord(input): CanonicalMutationResult
```

或等价明确 APIs：

```ts
createForEnter(...)
updateBackspace(...)
promoteExisting(...)
updateFromUI(...)
transferBinding(...)
retire(...)
repairHistorical(...)
```

但所有 API 必须共享同一个 lifecycle validation core。

---

# 5. 统一 Mutation Result

建议：

```ts
export type CanonicalMutationResult =
  | {
      ok: true;
      recordId: string;
      intent: CanonicalMutationIntent;
      stateBefore: CanonicalRuntimeState;
      stateAfter: CanonicalRuntimeState;
      recordCountBefore: number;
      recordCountAfter: number;
    }
  | {
      ok: false;
      recordId?: string;
      intent: CanonicalMutationIntent;
      reason:
        | "INVALID_LIFECYCLE_STATE"
        | "DOCUMENT_MISMATCH"
        | "RUNTIME_MISMATCH"
        | "ELEMENT_MISMATCH"
        | "ELEMENT_DISCONNECTED"
        | "RECORD_MISSING"
        | "BINDING_COLLISION"
        | "INVALID_TRANSITION";
    };
```

业务层：

```text
result.ok=false
→ 必须 STOP
```

禁止：

```text
mutation API 返回失败
→ 业务代码继续直接改 record
```

---

# 6. Phase C — 建立显式 Lifecycle Transition Matrix

Registry 内统一允许：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
→ CURRENT_LIVE
→ CURRENT_RETIRED

CURRENT_LIVE
→ CURRENT_RETIRED

PERSISTED_HISTORICAL
保持 historical runtime identity
```

禁止：

```text
CURRENT_RETIRED → CURRENT_LIVE
CURRENT_RETIRED → CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED → PERSISTED_HISTORICAL

PERSISTED_HISTORICAL → CURRENT_LIVE
```

除非未来有明确独立 rebind architecture，
本轮一律禁止。

---

# 7. State Transition 必须统一调用

禁止源码散落：

```ts
meta.state = "CURRENT_RETIRED";
meta.state = "CURRENT_LIVE";
```

新增：

```ts
transitionState({
  recordId,
  expectedFrom,
  to,
  reason
})
```

或等价实现。

必须验证：

```text
expectedFrom == actual
transition allowed
document matches
```

失败输出：

```text
LIFECYCLE-TRANSITION-VIOLATION
```

字段：

```text
recordId
expectedFrom
actualFrom
requestedTo
reason
documentKey
runtimeId
```

出现一次：

```text
HARD STOP
```

---

# 8. CURRENT_RETIRED 必须是真终态

定义：

```text
CURRENT_RETIRED
=
within current runtime session,
this canonical record can never become CURRENT_LIVE again.
```

允许：

```text
inspect
persist
cleanup
audit
```

禁止：

```text
PROMOTE
BACKSPACE
TRANSFER
UI_UPDATE
rehydrate apply
live bind
```

任何 mutation：

```text
CURRENT_RETIRED
→ CANONICAL-MUTATION-BLOCK
reason=INVALID_LIFECYCLE_STATE
```

---

# 9. Mutation Matrix

必须建立等价规则：

```text
State                    ENTER   BACKSPACE   PROMOTE   TRANSFER   UI_UPDATE   REHYDRATE
------------------------------------------------------------------------------------------------
CURRENT_LIVE               —        YES        YES        —          YES       LIVE_PROJECT_ONLY

CURRENT_AWAITING_TRANSFER   —        NO         NO         YES        NO        ZERO_CANDIDATE

CURRENT_RETIRED             —        NO         NO         NO         NO        ZERO_CANDIDATE

PERSISTED_HISTORICAL        —        NO         NO         NO         NO        HISTORICAL_ONLY
```

任何绕过：

```text
HARD STOP
```

---

# 10. Phase D — Promotion 改为 Registry-Owned Operation

当前 Promotion 必须彻底停止直接修改 record。

新路径：

```text
paragraph
↓
resolve exact registry owner
↓
recordId
↓
registry.promoteExisting(...)
```

Promotion 必须验证：

```text
state == CURRENT_LIVE

documentKey matches

runtimeId ==
registry.currentRuntimeId

element ==
registry.currentElement

element.isConnected == true

record.temporary == true
```

否则：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

---

# 11. Promotion Success Invariants

只有合法 promotion：

```text
same recordId

temporary:
true → false

state:
CURRENT_LIVE → CURRENT_LIVE

binding retained

runtimeId unchanged

element unchanged

recordCount unchanged
```

新增 trace：

```text
CANONICAL-RECORD-PROMOTION
```

必须字段：

```text
recordId
stateBefore
stateAfter
runtimeId
bindingVerified
elementConnected
temporaryBefore
temporaryAfter
recordCountBefore
recordCountAfter
decision
```

---

# 12. Retired Promotion Hard Stop

如果：

```text
state=CURRENT_RETIRED
```

任何 promotion attempt：

```text
PROMOTION-LIFECYCLE-VIOLATION
reason=INVALID_LIFECYCLE_STATE
decision=BLOCK
```

同时：

```text
record unchanged
recordCount unchanged
```

这条必须有 unit test 和 runtime forensic assertion。

---

# 13. Phase E — Backspace 接入同一 Mutation Firewall

Backspace 继续：

```text
paragraph
→ resolveExactLiveRecord()
→ canonicalRecordId
```

之后：

```text
registry.updateBackspace(...)
```

必须验证：

```text
state=CURRENT_LIVE

runtimeId exact

element exact

document exact
```

失败：

```text
BACKSPACE-CANONICAL-BLOCK
```

禁止：

```text
generic upsert
anchor fallback
ordinal fallback
CREATE_NEW
```

---

# 14. Phase F — UI Update 接入同一 Mutation Firewall

所有 Paragraph Indent UI / context menu / dialog update：

如果目标已经有 canonical record：

```text
registry.updateFromUI(...)
```

也必须：

```text
CURRENT_LIVE
或明确的 supported state
```

本轮不允许 UI 绕过 registry 直接改 record。

如果 UI 是 explicit create 场景，
必须用单独 intent，
不能复用 Backspace / Promotion path。

---

# 15. Phase G — 删除 Premature Retirement

当前禁止：

```text
sweepStaleAwaitingRecords()
→ timeout
→ CURRENT_RETIRED
```

仅因为：

```text
element disconnected
no replacement this refresh
handoff not immediately resolved
```

而 retire。

时间本身不能证明 logical paragraph 已死亡。

---

# 16. Awaiting Transfer 正确语义

```text
CURRENT_AWAITING_TRANSFER
```

表示：

```text
canonical owner 暂时失去 connected live element，
但 logical ownership 仍然存在，
等待受控 replacement continuity。
```

因此：

```text
candidateCount=0
persistent heuristic=forbidden
Backspace=BLOCK
Promotion=BLOCK
UI update=BLOCK
```

但：

```text
TRANSFER
allowed
```

---

# 17. Sweep 只允许 Audit，不允许 Retirement Mutation

将：

```text
sweepStaleAwaitingRecords
```

改成：

```text
auditAwaitingTransferRecords
```

或等价。

职责：

```text
统计 awaiting records
输出 pending diagnostic
检测 invalid orphan state
```

禁止它直接：

```text
transition → CURRENT_RETIRED
```

---

# 18. CANONICAL-TRANSFER-PENDING

对于长期 awaiting：

```text
CANONICAL-TRANSFER-PENDING
```

字段：

```text
recordId
previousRuntimeId
documentKey
handoffId
awaitingSince
awaitingForMs
activeHandoff
candidateCount
reason
```

它只是：

```text
diagnostic
```

不是：

```text
retire trigger
```

---

# 19. Phase H — Retire 必须由确定性 Evidence 触发

允许 retire reason：

```ts
export type CanonicalRetireReason =
  | "EXPLICIT_PARAGRAPH_DELETE"
  | "DOCUMENT_SWITCH"
  | "DOCUMENT_CLOSE"
  | "EDITOR_DISPOSE"
  | "COMMAND_CANCEL_CONFIRMED";
```

若当前代码不能可靠证明 explicit paragraph delete，
不要实现猜测式 paragraph deletion retirement。

宁可保持：

```text
CURRENT_AWAITING_TRANSFER
```

也不能误 retire。

---

# 20. 禁止的 Retire Reason

以下绝不能直接 retire：

```text
ELEMENT_DISCONNECTED

NO_REPLACEMENT_THIS_TICK

NO_REPLACEMENT_THIS_REFRESH

HANDOFF_NOT_FOUND_IMMEDIATELY

TIMEOUT_ONLY

NO_SELECTION

NO_FOCUS
```

如果源码仍出现这些 reason：

```text
Source Gate FAIL
```

---

# 21. Premature Retirement Diagnostic

增加：

```text
PREMATURE-RETIREMENT-VIOLATION
```

触发条件：

```text
retire request
+
没有确定性 retire reason
```

或：

```text
AWAIT_TRANSFER
→ RETIRE
仅由 timing / disconnected / no immediate replacement 驱动
```

出现一次：

```text
HARD STOP
```

---

# 22. Phase I — Document Switch 才是明确 Retire Boundary

doc A → doc B 时：

对 A 当前 runtime records：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
```

可以显式：

```text
→ CURRENT_RETIRED
reason=DOCUMENT_SWITCH
```

并：

```text
clear element bindings
clear runtime bindings
clear active transactions
clear active handoffs
```

禁止 A record 在 B resolve。

---

# 23. 同 Session 不允许 Retired → Historical

`CURRENT_RETIRED`：

不能因为：

```text
时间过去
binding missing
document reopened
```

在同一个 runtime registry 中直接改：

```text
PERSISTED_HISTORICAL
```

只有：

```text
physical sidecar load
```

可以创建 / 注册：

```text
PERSISTED_HISTORICAL
```

---

# 24. Phase J — Authoritative Vault Context

必须停止：

```text
startup active-file inference
```

作为 vaultRoot source。

真实 authoritative source：

```text
Typora Community Core
→ app
→ vault
→ vault.path
```

必须阅读当前依赖源码确认实际 API。

不要凭记忆猜调用名。

---

# 25. Source Gate — Vault Service

必须定位：

```text
app → vault
vault.path
```

真实生产 API。

输出：

```text
source file
service name
property
actual runtime path
```

test vault 必须是：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

---

# 26. VaultStorageContext

新增：

```ts
interface VaultStorageContext {
  vaultRoot: string;
  source: "vault-service";
  generation: number;
}
```

推荐不要复制 stale 字符串。

可选择：

```ts
getVaultRoot(): string | null
```

或：

```text
dynamic context update
```

但最终 load/save 必须读当前 authoritative context。

---

# 27. ParagraphLayoutStore Context 必须可更新

新增：

```ts
updateStorageContext({
  vaultRoot,
  documentKey
})
```

或等价。

调用时机至少：

```text
plugin load

editor load

file open

document switch

vault change
```

不要只在 constructor 运行一次。

---

# 28. SIDECAR-CONTEXT-UPDATE

新增 trace：

```text
SIDECAR-CONTEXT-UPDATE
```

字段：

```text
previousVaultRoot
nextVaultRoot
vaultRootSource
documentPath
documentKey
storageRoot
sidecarPath
generation
changed
```

正常 test runtime 必须：

```text
vaultRootSource=vault-service
```

---

# 29. Physical Sidecar Storage Identity

统一：

```text
vaultRoot
+
documentKey
+
InkChapter sidecar namespace
```

必须输出：

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

# 30. Physical Write Contract

真实写：

```text
SIDECAR-ACTUAL-WRITE
```

必须：

```text
vaultRoot=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

source=physical

sidecarPath=<real path>

success=true

recordCount=N
```

然后必须检查：

```text
file exists=true
```

不能只改 log。

---

# 31. Physical Load Contract

重新打开：

```text
SIDECAR-ACTUAL-LOAD
```

必须：

```text
source=physical
same sidecarPath
success=true
recordCount=N
```

然后 loaded records：

```text
REGISTER_PERSISTED
state=PERSISTED_HISTORICAL
origin=physical-sidecar
```

---

# 32. Historical Birth Rule

只有：

```text
source=physical-sidecar
```

可以：

```text
PERSISTED_HISTORICAL
```

禁止：

```text
CURRENT_RETIRED
→ PERSISTED_HISTORICAL
```

同 session 内转换。

禁止：

```text
metadata missing
→ assume historical
```

---

# 33. Phase K — Generic Mutation Inventory

搜索所有直接写：

```text
.mode =
.temporary =
.anchor =
```

以及：

```text
overrides.push(
splice(
```

针对 ParagraphIndentOverrideRecord。

逐个分类：

```text
Enter
Backspace
Promotion
UI
Transfer
Historical Repair
```

除 `ENTER_CREATE` /明确 store load 之外，
必须全部经过 registry mutation authority。

---

# 34. Legacy Generic Upsert Gate

如果仍保留：

```text
applyParagraphIndentOverrideToSidecar*
```

它不能被：

```text
Backspace
Promotion
Transfer
UI existing update
```

调用。

Source Gate 搜索调用点。

发现 live mutation path 仍通过 generic upsert：

```text
HARD STOP — GENERIC_MUTATION_BYPASS
```

---

# 35. Unit Tests — State Transitions

## ST-1

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
PASS
```

## ST-2

```text
CURRENT_AWAITING_TRANSFER
→ CURRENT_LIVE
TRANSFER only
PASS
```

## ST-3

```text
CURRENT_AWAITING_TRANSFER
→ CURRENT_RETIRED
DOCUMENT_SWITCH
PASS
```

## ST-4

```text
CURRENT_RETIRED
→ CURRENT_LIVE
BLOCK
LIFECYCLE-TRANSITION-VIOLATION
```

## ST-5

```text
CURRENT_RETIRED
→ PERSISTED_HISTORICAL
BLOCK
```

---

# 36. Unit Tests — Promotion Firewall

## PF-1

CURRENT_LIVE exact owner：

```text
PROMOTE PASS
```

## PF-2

CURRENT_RETIRED：

```text
PROMOTION-LIFECYCLE-VIOLATION
BLOCK
```

## PF-3

CURRENT_AWAITING_TRANSFER：

```text
BLOCK
```

## PF-4

runtime mismatch：

```text
BLOCK
```

## PF-5

element mismatch / disconnected：

```text
BLOCK
```

---

# 37. Unit Tests — Retirement

## RT-1

disconnect alone：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
NOT RETIRED
```

## RT-2

several refresh cycles no replacement：

```text
still CURRENT_AWAITING_TRANSFER
CANONICAL-TRANSFER-PENDING
```

## RT-3

DOCUMENT_SWITCH：

```text
→ CURRENT_RETIRED
```

## RT-4

timer-only retirement：

```text
PREMATURE-RETIREMENT-VIOLATION
BLOCK
```

---

# 38. Unit Tests — Backspace Firewall

## BF-1

CURRENT_LIVE exact owner：

```text
UPDATE_EXISTING
```

## BF-2

CURRENT_RETIRED：

```text
BLOCK
```

## BF-3

CURRENT_AWAITING_TRANSFER：

```text
BLOCK
```

## BF-4

CREATE_NEW：

```text
impossible
```

---

# 39. Unit Tests — Vault Context

## VC-1

authoritative vault service：

```text
vault.path
=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

## VC-2

plugin loads before active document：

```text
vaultRoot still known from vault service
```

## VC-3

file open：

```text
documentKey updates
vaultRoot unchanged
```

## VC-4

sidecar load/save use current context。

---

# 40. Unit Tests — Historical Birth

## HB-1

physical sidecar load：

```text
REGISTER_PERSISTED
PERSISTED_HISTORICAL
```

## HB-2

current retired in-memory record：

```text
cannot register historical
```

---

# 41. Instrumentation

保留：

```text
RECORD-LIFECYCLE
CANONICAL-BINDING-TRANSFER
MATCH-LIVE-BINDING
REHYDRATE-WRITE-AUDIT
CANONICAL-RECORD-BACKSPACE
CANONICAL-RECORD-PROMOTION
```

新增：

```text
CANONICAL-MUTATION-BLOCK

LIFECYCLE-TRANSITION-VIOLATION

PREMATURE-RETIREMENT-VIOLATION

PROMOTION-LIFECYCLE-VIOLATION

CANONICAL-TRANSFER-PENDING

SIDECAR-CONTEXT-UPDATE

SIDECAR-STORAGE-IDENTITY
```

---

# 42. Build ID

本轮实际 production migration 完成后换唯一 Build ID。

建议：

```text
inkchapter-r58-4-lifecycle-integrity-vault-authority-<unique>
```

source / dist / deployed / runtime banner / runtime-load.json / verify script 必须一致。

---

# 43. Typecheck / Tests / Build

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

记录：

```text
exit code
test file count
test count
failures
```

---

# 44. Deploy Gate

仅使用：

```text
scripts/deploy-test-vault.ps1
```

核对：

```text
project main.js SHA256
runtime main.js SHA256

project style.css SHA256
runtime style.css SHA256

Build ID
```

全部 match。

---

# 45. Strict Typora Startup Verification

重启时必须真实验证：

```text
old process exited

new PID
new StartTime

MainWindowHandle != 0
MainWindowTitle nonempty

target vault

target test document

runtime plugin main.js path

runtime plugin main.js SHA256

runtime style.css SHA256

runtime Build ID

initializationCount=1
```

不要把：

```text
D:\Typora\resources\electron.asar\renderer\main.js
```

当成 InkChapter plugin runtime artifact path。

InkChapter runtime artifact 必须指向 test vault plugin bundle。

如果任一项未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 46. Runtime Acceptance R1 — Registry Mutation Authority

执行真实 Enter / Promotion / Backspace。

必须证明：

```text
所有 canonical mutations
均经过 Registry mutation authority
```

不得出现：

```text
GENERIC_MUTATION_BYPASS
```

---

# 47. Runtime Acceptance R2 — No Premature Retirement

至少构造/观察 5 次真实 DOM disconnect/replacement。

每次：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

如果 replacement 暂时未出现：

```text
CANONICAL-TRANSFER-PENDING
```

禁止：

```text
0~1ms
→ CURRENT_RETIRED
```

除非 reason 是：

```text
DOCUMENT_SWITCH
DOCUMENT_CLOSE
EDITOR_DISPOSE
EXPLICIT_PARAGRAPH_DELETE
COMMAND_CANCEL_CONFIRMED
```

必须：

```text
PREMATURE-RETIREMENT-VIOLATION=0
```

---

# 48. Runtime Acceptance R3 — Transfer 5/5

实际 replacement：

```text
CURRENT_AWAITING_TRANSFER
→ CANONICAL-BINDING-TRANSFER
→ CURRENT_LIVE
```

必须：

```text
same recordId

fromRuntimeId known
toRuntimeId known

generation +1

recordCount unchanged
```

5/5。

---

# 49. Runtime Acceptance R4 — Retired Mutation Firewall

创建一个明确：

```text
CURRENT_RETIRED
```

record。

尝试/观察：

```text
Promotion
Backspace
UI update
Transfer
```

必须全部：

```text
CANONICAL-MUTATION-BLOCK
reason=INVALID_LIFECYCLE_STATE
```

且：

```text
record unchanged
recordCount unchanged
```

---

# 50. Runtime Acceptance R5 — Promotion 5/5

只有：

```text
CURRENT_LIVE
exact owner
```

才计数。

每个：

```text
stateBefore=CURRENT_LIVE
bindingVerified=true
elementConnected=true
runtimeIdMatches=true
temporary true→false
stateAfter=CURRENT_LIVE
recordCount unchanged
```

5/5。

任何 retired promotion：

```text
FAIL
```

---

# 51. Runtime Acceptance R6 — Replacement → Backspace 10/10

每轮：

```text
Enter
→ actual replacement
→ transfer
→ Backspace
```

必须：

```text
same recordId

BACKSPACE_UPDATE
decision=UPDATE_EXISTING

sameRecord=true
appendOccurred=false

recordCount unchanged
```

10/10。

---

# 52. Runtime Acceptance R7 — Live Projection Regression

连续至少 10 refresh：

```text
CURRENT_LIVE
MATCH-LIVE-BINDING
dirty=false
reason=live-projection-only
writeScheduled=false
```

必须继续 PASS。

---

# 53. Runtime Acceptance R8 — Single Dot Regression 10/10

执行 10 个独立 logical case：

```text
。
```

必须：

```text
semantic=auto

SINGLE-DOT-WRONG-APPLY=0

SINGLE-DOT-CURRENT-SESSION-CANDIDATE=0
```

---

# 54. Runtime Acceptance R9 — Vault Root Authority

启动时即使：

```text
Active Doc=unknown
```

也必须：

```text
vaultRoot known
source=vault-service
```

test runtime：

```text
vaultRoot=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

不得再依赖 active file 才知道 vaultRoot。

---

# 55. Runtime Acceptance R10 — Physical Sidecar

必须真实：

```text
SIDECAR-ACTUAL-WRITE
source=physical
success=true

file exists=true
```

然后：

```text
close/reopen
```

必须：

```text
SIDECAR-ACTUAL-LOAD
source=physical
success=true
same path
```

---

# 56. Runtime Acceptance R11 — Historical Rehydrate

由 R10 physical load 得到：

```text
PERSISTED_HISTORICAL
```

然后：

```text
persistent resolver
```

恢复目标。

同时：

```text
current-session isolation
```

不能退化。

---

# 57. Runtime Acceptance R12 — Document Switch 3 Cycles

执行：

```text
doc A → doc B → doc A
```

3 cycles。

必须：

```text
old document CURRENT_LIVE/AWAITING
→ explicit CURRENT_RETIRED
reason=DOCUMENT_SWITCH

no cross-document binding

no current-session historical fallback

no retired mutation
```

---

# 58. Hard Stop List

任一出现：

```text
CURRENT_RETIRED → CURRENT_LIVE

CURRENT_RETIRED → PERSISTED_HISTORICAL

PROMOTION on CURRENT_RETIRED succeeds

BACKSPACE on CURRENT_RETIRED succeeds

TRANSFER on CURRENT_RETIRED succeeds

PREMATURE-RETIREMENT-VIOLATION

LIFECYCLE-TRANSITION-VIOLATION

GENERIC_MUTATION_BYPASS

BACKSPACE_UPDATE decision=CREATE_NEW

BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER

SINGLE-DOT-WRONG-APPLY

SINGLE-DOT-CURRENT-SESSION-CANDIDATE

unexpected current-session multi-owner

vaultRoot unknown in normal test runtime

SIDECAR-ACTUAL-WRITE source=disabled during R10

SIDECAR-ACTUAL-LOAD source=disabled during R10

runtime Build ID mismatch

plugin runtime SHA mismatch
```

立即：

```text
R58.4 NOT FIXED — R60 BLOCKED
```

---

# 59. 不允许的假修复

禁止：

```text
给 promotion 再加一个局部 if
但其它 mutation 仍可绕过 registry

用 90s/30s/1s TTL 直接 retire

为了 awaitingCount=0 强制 retire

只修改 RETIRE 日志，不改 transition authority

把 source=disabled 字符串改成 source=physical
但不真实写文件

硬编码 test vault path 进 production runtime

继续从 startup active file 猜 vaultRoot

CURRENT_RETIRED 再绑定 replacement

current-session retired record 原地变 historical

只跑 unit test 不做 runtime acceptance
```

---

# 60. 推荐最终架构

```text
                  ParagraphCanonicalRegistry
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      Lifecycle        Live Binding      Mutation
      Authority         Authority         Firewall
          │                │                │
          └────────────────┴────────────────┘
                           │
                   Canonical Record
```

业务层：

```text
Enter
Backspace
Promotion
Handoff
UI
```

只能：

```text
request mutation
```

不能自己：

```text
modify canonical record
```

---

# 61. Storage Architecture

```text
Typora Community Core
        │
        ▼
     app.vault
        │
        ▼
     vault.path
        │
        ▼
VaultStorageContext
        │
        ▼
ParagraphLayoutStore
        │
        ▼
physical sidecar
```

禁止：

```text
startup active-file inference
```

作为 authoritative root。

---

# 62. Final Clean Lifecycle Example

```text
ENTER
R1
CURRENT_LIVE
runtime=P1

DOM DISCONNECT
CURRENT_AWAITING_TRANSFER
previousRuntime=P1

no replacement yet
CANONICAL-TRANSFER-PENDING
state remains AWAITING

replacement appears
CANONICAL-BINDING-TRANSFER
P1 → P2
same R1
CURRENT_LIVE

PROMOTION
registry validates CURRENT_LIVE
same R1
temporary true→false

DOCUMENT SWITCH
R1
CURRENT_LIVE → CURRENT_RETIRED
reason=DOCUMENT_SWITCH

later mutation attempt
CANONICAL-MUTATION-BLOCK
state=CURRENT_RETIRED
```

---

# 63. Final Clean Persistence Example

```text
plugin onload
Active Doc=unknown

SIDECAR-CONTEXT-UPDATE
vaultRoot=D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
source=vault-service

doc.md opens
documentKey=doc.md

save
SIDECAR-ACTUAL-WRITE
source=physical

restart

SIDECAR-ACTUAL-LOAD
source=physical

REGISTER_PERSISTED
state=PERSISTED_HISTORICAL
origin=physical-sidecar
```

---

# 64. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Root Cause A — Mutation Authority
## 4. Root Cause B — Vault Authority
## 5. Files Changed
## 6. Registry Mutation Firewall
## 7. Lifecycle Transition Matrix
## 8. CURRENT_RETIRED Terminal Enforcement
## 9. Promotion Migration
## 10. Backspace Migration
## 11. UI Mutation Migration
## 12. Premature Retirement Removal
## 13. Awaiting Transfer Pending Policy
## 14. Retire Evidence Model
## 15. Vault Service Source
## 16. VaultStorageContext
## 17. ParagraphLayoutStore Context Refresh
## 18. Physical Sidecar Identity
## 19. Historical Birth Rule
## 20. Build ID
## 21. Typecheck
## 22. Tests
## 23. Build
## 24. Deploy SHA256
## 25. Strict Startup Verification
## 26. R1 Mutation Authority
## 27. R2 No Premature Retirement
## 28. R3 Transfer 5/5
## 29. R4 Retired Mutation Firewall
## 30. R5 Promotion 5/5
## 31. R6 Replacement→Backspace 10/10
## 32. R7 Live Projection 10/10
## 33. R8 Single Dot 10/10
## 34. R9 Vault Root Authority
## 35. R10 Physical Sidecar
## 36. R11 Historical Rehydrate
## 37. R12 Document Switch 3 Cycles
## 38. Hard Stop Counts
## 39. Remaining Known Issues
## 40. Final Verdict
```

---

# 65. Final Verdict Vocabulary

最终只能：

```text
R58.4 FIXED — R60 UNLOCKED
```

或者：

```text
R58.4 NOT FIXED — R60 BLOCKED
```

任何 mandatory runtime：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.4 NOT FIXED — R60 BLOCKED
```

---

# 66. Execution Rules

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

作为审计。

不要编造：

```text
source behavior
GUI result
PID
StartTime
window handle
window title
vault path
active document
plugin runtime path
SHA256
Build ID
sidecar physical path
physical read/write
runtime traces
```

启动或重启 Typora 后，如果没有完整验证：

```text
old process
main window
target vault
target document
plugin runtime SHA256
Build ID
initializationCount
```

必须明确：

```text
启动命令已发出，但尚未确认成功
```

只有所有 R58.4 lifecycle + physical persistence runtime gates 全部真实通过后，才允许解锁 R60。

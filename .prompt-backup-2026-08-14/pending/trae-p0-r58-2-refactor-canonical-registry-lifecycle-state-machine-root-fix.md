# TRAE P0 — R58.2 Canonical Registry + Lifecycle State Machine 根治重构

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Architectural Refactor**
>
> Purpose: **从身份模型源头修复 canonical record 生命周期，彻底切断 current-session record 被释放进 persistent heuristic resolver 的结构性路径。**
>
> Current authoritative status:
>
> ```text
> R58 NOT FIXED
> R60 BLOCKED
> ```
>
> 本任务不是继续给现有 R58 打补丁，而是对 canonical identity / runtime ownership / rehydrate eligibility 进行受控重构。
>
> 只有本文件规定的 Source / Unit / Build / Deploy / Runtime Acceptance 全部通过后，才允许：
>
> ```text
> R58.2 FIXED — R60 UNLOCKED
> ```

---

# 0. 当前真实故障结论

最新真实 Typora runtime 已经证明：

```text
1. BACKSPACE_UPDATE → CREATE_NEW 的危险 fallback 已增加 BLOCK 保险，
   但没有证明 replacement 后 canonical ownership 连续性已经修复。

2. 实际存在 Typora DOM replacement / handoff：
   old runtime → replacement runtime

3. 日志中没有稳定证明：
   old runtime → SAME canonicalRecordId → replacement runtime

4. current-session record 在失去 live owner 后，
   仍然能够进入 MATCH-EXACT-ANCHOR / persistent candidate pipeline。

5. 单 `。` paragraph 仍然会收到旧 force-indent canonical record 的错误 candidate，
   只是最终被 SINGLE-DOT-WRONG-APPLY guard 阻断。

6. repeated multi-owner 说明 candidate eligibility upstream 仍然错误。

7. rehydrate 的 anchor-repair 虽已部分幂等，
   但仍存在 dirty=true / writeScheduled=true 的重复写入。

8. physical sidecar runtime 仍显示：
   vaultRoot=unknown
   SIDECAR-DISABLED
```

因此：

```text
现有 guard = 有效安全网
但根因 = 未消除
```

本轮禁止把“错误被 BLOCK”当成“错误不再发生”。

---

# 1. 本轮根修目标

必须把 paragraph canonical identity 分成两个完全不同的世界：

```text
A. CURRENT SESSION RUNTIME IDENTITY
B. PERSISTED HISTORICAL REHYDRATE IDENTITY
```

并建立硬边界：

```text
CURRENT SESSION record
绝对不能因为暂时没有 connected live binding
就自动退回 persistent heuristic resolver。
```

唯一允许 generic anchor / text / ordinal / proximity matching 的 record：

```text
PERSISTED_HISTORICAL
```

---

# 2. 核心不变量

以后整个 paragraph indent canonical 系统必须服从：

```text
CanonicalRecordId
=
唯一业务身份
```

以下全部只是定位手段，不得充当 canonical ownership identity：

```text
HTMLElement
runtimeId
paragraph ordinal
anchor
normalized anchor
textHash
visible text
DOM path
DOM position
Selection
nearest paragraph
```

禁止：

```text
“找不到 binding，所以再猜一次 record”
```

---

# 3. HARD FREEZE

以下行为原则继续冻结，除非为接入新 registry 做最小适配：

```text
exact `。。` / `..` recognizer

single `。` / `.`
绝不触发 Enter business command

keydown Enter
= business owner

beforeinput(insertParagraph)
= suppress-only when transaction already owned

Verify-First Caret

POST-TOKEN-SELECTION

Runtime Paragraph ID

One-Shot handoff concept

Backspace:
FORCE_INDENT → FORCE_FLUSH

semantic / visual separation

Two-Pass Rehydrate:
RESOLVE ALL
→ GROUP
→ DECIDE
→ APPLY

multi-owner = BLOCK ALL

Phase 1 writer = 0
```

禁止重新：

```text
恢复 first-candidate incremental apply
恢复 same-mode ambiguity amnesty
让 rehydrate/global refresh 写 caret
用 Selection 作为 command ownership source
用 single-dot 特判替代 identity 修复
```

---

# 4. Phase A — 先建立真实 Source Map

修改前必须定位当前实际 production implementation：

```text
ParagraphIndentOverrideRecord
inMemoryOverrides
applyParagraphIndentOverrideToSidecar*
Enter transaction type
commitEnterIndentTransactionSync
tryStartEnterIndentTransaction
Backspace reverse handler
activeOneShotHandoff
tryExecuteOneShotHandoff / HANDOFF-RESOLVE
runtime paragraph ID generator
element→record binding
runtimeId→record binding
resolveParagraphAnchor*
rehydrate candidate generator
resolveParagraphOverrideRehydratePlan
applyParagraphRehydratePlan
anchor repair
scheduleSidecarWrite
loadParagraphLayout
saveParagraphLayout
document switch events
```

输出：

```text
behavior
→ source file
→ function
→ current identity input
→ current mutation target
→ current fallback
```

只有 Source Map 完成后才开始改。

---

# 5. Phase B — 新建 Canonical Registry

优先创建独立模块：

```text
src/heading-numbering/paragraph-canonical-registry.ts
```

若实际项目目录结构不同，可放入最合适位置，但必须独立职责。

建议核心类型：

```ts
export type CanonicalRuntimeState =
  | "CURRENT_LIVE"
  | "CURRENT_AWAITING_TRANSFER"
  | "CURRENT_RETIRED"
  | "PERSISTED_HISTORICAL";

export interface CanonicalRuntimeMeta {
  recordId: string;
  documentKey: string;

  state: CanonicalRuntimeState;

  sessionId: string;
  generation: number;

  currentRuntimeId?: string;
  currentElement?: HTMLElement;

  previousRuntimeId?: string;

  createdAt: number;
  updatedAt: number;
}
```

Registry 概念职责：

```ts
class ParagraphCanonicalRegistry {
  recordsById: Map<string, ParagraphIndentOverrideRecord>;

  runtimeMetaByRecordId: Map<string, CanonicalRuntimeMeta>;

  recordIdByElement: WeakMap<HTMLElement, string>;

  recordIdByRuntimeId: Map<string, string>;
}
```

如果现有 architecture 不适合直接存 recordsById，
可以让 persistent record storage 仍由原 store 持有，
但 canonical identity lookup / lifecycle / binding 必须集中在 Registry。

---

# 6. Phase C — Persistent Record 与 Runtime Metadata 解耦

禁止再用：

```text
temporary
```

同时表达：

```text
“内容临时”
和
“属于当前 live session”
```

这是两个不同维度。

Persistent sidecar record 继续保留：

```text
id
mode
anchor
temporary
...
```

Runtime-only metadata 负责：

```text
sessionId
runtimeState
currentElement
currentRuntimeId
generation
documentKey
```

因此必须支持：

```text
temporary=false + CURRENT_LIVE
temporary=true  + PERSISTED_HISTORICAL
```

不要把 `temporary` 当成 session ownership truth。

---

# 7. Phase D — Registry API 必须显式分离 mutation intent

删除/停止业务路径继续依赖一个模糊 generic：

```text
applyParagraphIndentOverrideToSidecar(paragraph, mode)
```

让它既可能 update 又可能 create。

必须拆分成语义明确 API。

至少需要等价于：

```ts
createOrReuseForEnter(...)
updateExistingByRecordId(...)
promoteExistingByRecordId(...)
transferBinding(...)
retireRecordRuntime(...)
resolveExactLiveRecord(...)
```

推荐 mutation intent：

```ts
type CanonicalMutationIntent =
  | "ENTER_CREATE_OR_REUSE"
  | "BACKSPACE_UPDATE_EXISTING"
  | "PROMOTE_EXISTING"
  | "UI_UPDATE_EXISTING"
  | "PERSISTED_REHYDRATE_REPAIR";
```

只有：

```text
ENTER_CREATE_OR_REUSE
```

允许 CREATE_NEW。

其余全部：

```text
UPDATE_EXISTING
或
BLOCK
```

---

# 8. Phase E — BACKSPACE_UPDATE API 中彻底不存在 CREATE_NEW

必须从 API 结构上保证：

```text
BACKSPACE_UPDATE
→ UPDATE_EXISTING
或
→ BLOCK
```

绝不允许：

```text
BACKSPACE_UPDATE
→ CREATE_NEW
```

不是增加一个末尾 `if`，
而是让 Backspace 调用的 mutation function 根本没有 append 能力。

推荐：

```ts
updateBackspaceRecord(
  canonicalRecordId: string,
  nextMode: ParagraphIndentMode
)
```

如果没有 canonicalRecordId：

```text
不调用 mutation
直接 BLOCK
```

---

# 9. Phase F — Enter Transaction 成为 Canonical Identity 出生点

扩展真实 Enter transaction：

```ts
interface EnterIndentTransaction {
  txnId: string;

  documentKey: string;

  commandElement: HTMLElement;
  commandRuntimeId: string;

  canonicalRecordId?: string;

  ...
}
```

Enter canonical commit：

```text
1. 解析 command paragraph
2. 检查 command element/runtime 是否已经 exact bound
3. 若已 bound：
      reuse same canonicalRecordId
4. 若未 bound：
      create canonical record exactly once
5. txn.canonicalRecordId = R
6. registry.bind R ↔ element ↔ runtimeId
7. emit CANONICAL-RECORD-COMMIT
```

Transaction canonical success 必须满足：

```text
txn.canonicalRecordId != null
```

从此 txn 生命周期中禁止再通过 anchor / ordinal / text 重新查 canonical identity。

---

# 10. Phase G — 统一 Live Binding

Registry 必须提供：

```ts
bindLiveOwner(...)
resolveExactLiveRecord(...)
invalidateOldOwner(...)
```

必须保证双向一对一不变量：

```text
one live element/runtime
→ max one canonicalRecordId

one canonicalRecordId in CURRENT_LIVE
→ max one active live owner
```

任何冲突：

```text
LIVE-BINDING-COLLISION
```

并 BLOCK。

禁止自动挑第一个 winner。

---

# 11. Phase H — DOM Replacement 进入显式 Lifecycle

当 current live element 被 Typora 替换/断开：

不要立刻把 record 当 historical。

执行：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

并保留：

```text
canonicalRecordId
previousRuntimeId
previousElement
documentKey
generation
```

在：

```text
CURRENT_AWAITING_TRANSFER
```

状态下：

```text
ZERO generic heuristic candidate
ZERO MATCH-EXACT-ANCHOR
ZERO MATCH-NORMALIZED-ANCHOR
ZERO ordinal
ZERO proximity
ZERO legacy
ZERO textHash
```

只允许：

```text
one-shot / handoff continuity resolver
```

寻找 replacement。

---

# 12. Phase I — Handoff 必须 Transfer Canonical Ownership

当前 semantic handoff 不够。

`activeOneShotHandoff` 必须携带：

```text
handoffId
documentKey
canonicalRecordId
previousRuntimeId
previousElement
semantic
generation
```

replacement 唯一确定后调用：

```ts
transferCanonicalBinding({
  documentKey,
  canonicalRecordId,
  fromElement,
  fromRuntimeId,
  toElement,
  toRuntimeId,
  reason
})
```

必须：

```text
1. validate document
2. validate record exists
3. validate source lifecycle
4. invalidate old element binding
5. invalidate old runtimeId binding
6. bind replacement element
7. bind replacement runtimeId
8. generation + 1
9. state → CURRENT_LIVE
10. record count unchanged
```

新增/保留 trace：

```text
CANONICAL-BINDING-TRANSFER
```

字段：

```text
handoffId
documentKey
canonicalRecordId
fromRuntimeId
toRuntimeId
stateBefore
stateAfter
generationBefore
generationAfter
oldOwnerInvalidated
newOwnerEstablished
recordCountBefore
recordCountAfter
```

硬不变量：

```text
recordCountBefore === recordCountAfter
```

---

# 13. Phase J — Transfer 失败时不能进入 Persistent Heuristic

replacement 没有唯一解析成功：

```text
CURRENT_AWAITING_TRANSFER
```

继续保持隔离。

禁止：

```text
binding missing
→ MATCH-EXACT-ANCHOR
```

必须输出：

```text
CANONICAL-TRANSFER-PENDING
```

只有明确满足 retirement 条件时，才进入：

```text
CURRENT_RETIRED
```

但：

```text
CURRENT_RETIRED
```

同样不得 generic heuristic。

---

# 14. Phase K — Rehydrate Candidate Eligibility 先按 Lifecycle 分流

这是本轮最核心重构点。

candidate generation 必须改成：

```ts
for (const record of records) {
  const meta = registry.getRuntimeMeta(record.id);

  if (meta) {
    switch (meta.state) {
      case "CURRENT_LIVE":
        resolveExactLiveBindingOnly(record, meta);
        break;

      case "CURRENT_AWAITING_TRANSFER":
        emitZeroCandidateReason(...);
        break;

      case "CURRENT_RETIRED":
        emitZeroCandidateReason(...);
        break;

      case "PERSISTED_HISTORICAL":
        resolvePersistentCandidates(record);
        break;
    }
  } else {
    // 只有明确来源于当前 loadDocumentContext / sidecar load 的记录
    // 才能被登记成 PERSISTED_HISTORICAL
  }
}
```

禁止：

```text
if live binding exists:
    MATCH-LIVE-BINDING
else:
    persistent heuristic
```

因为：

```text
no binding
≠
historical record
```

---

# 15. Phase L — 谁可以进入 Persistent Resolver

只有明确：

```text
runtimeState=PERSISTED_HISTORICAL
```

的 record 可以进入：

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROMOTED-ANCHOR
MATCH-INDEX-FALLBACK
MATCH-PROXIMITY
MATCH-LEGACY
textHash
ordinal
```

Persistent resolver 入口增加 hard assertion：

```text
if state !== PERSISTED_HISTORICAL:
    BLOCK
```

新增 hard diagnostic：

```text
BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER
```

字段：

```text
recordId
state
sessionId
documentKey
boundRuntimeId
targetRuntimeId
matchStrategy
resolverStage
```

出现一次：

```text
HARD STOP
```

---

# 16. Phase M — 明确 Session Origin

每次插件 runtime 启动生成：

```text
sessionId
```

Current-session 创建的 canonical record 在整个当前进程生命周期中必须能够判断：

```text
createdInCurrentSession=true
```

即使：

```text
element disconnected
runtime binding temporarily unavailable
```

也不能突然变成 historical。

只有：

```text
真正通过 sidecar load 进入当前 runtime
```

的 record 才登记：

```text
PERSISTED_HISTORICAL
```

禁止通过“缺少 metadata”推断 historical。

---

# 17. Phase N — Persistent Load 必须显式登记 Historical State

在：

```text
loadParagraphLayout
reconstructParagraphOverridesFromSidecar
```

真正从 physical sidecar 载入 records 后：

```ts
registry.registerPersistedHistorical(record)
```

状态：

```text
PERSISTED_HISTORICAL
```

必须能证明：

```text
source=physical-sidecar
```

而不是当前 session in-memory array。

如果 sidecar 当前 disabled：

```text
不要伪造 PERSISTED_HISTORICAL
```

---

# 18. Phase O — Rehydrate 对 CURRENT_LIVE 只允许 Exact Live Projection

对于：

```text
CURRENT_LIVE
```

唯一目标：

```text
meta.currentElement
```

唯一策略：

```text
MATCH-LIVE-BINDING
```

不扫描其它 paragraph。

不跑 persistent resolver。

不做 multi-owner guess。

如果 currentElement disconnected：

```text
状态本身应已转 CURRENT_AWAITING_TRANSFER
```

不能继续 CURRENT_LIVE。

---

# 19. Phase P — Candidate Source 必须与 Lifecycle 一致

统一 candidate provenance：

```text
candidateSource:
LIVE
PERSISTENT
LEGACY
```

映射：

```text
CURRENT_LIVE
→ LIVE only

CURRENT_AWAITING_TRANSFER
→ NONE

CURRENT_RETIRED
→ NONE

PERSISTED_HISTORICAL
→ PERSISTENT / LEGACY
```

不允许：

```text
CURRENT_* record
→ PERSISTENT candidate
```

---

# 20. Phase Q — Candidate Dedupe

对于同一个：

```text
recordId + targetRuntimeId
```

最多保留一个 candidate。

策略优先级：

```text
MATCH-LIVE-BINDING
>
MATCH-RECORD-ID
>
MATCH-EXACT-ANCHOR
>
MATCH-NORMALIZED-ANCHOR
>
MATCH-PROMOTED-ANCHOR
>
MATCH-INDEX-FALLBACK
>
MATCH-PROXIMITY
>
MATCH-LEGACY
```

新增：

```text
REHYDRATE-CANDIDATE-DEDUPE
```

字段：

```text
recordId
targetRuntimeId
strategiesBefore
strategyKept
duplicatesRemoved
```

---

# 21. Phase R — Two-Pass 继续只负责真正 ambiguity

不要重写 grouping 规则。

目标是 upstream candidate 变干净。

对于 current-session live records：

```text
unexpected multi-owner groups = 0
```

Two-Pass BLOCK 只留下给：

```text
PERSISTED_HISTORICAL ambiguity
```

输出 multi-owner 时必须增加：

```text
candidateLifecycleStates
candidateSources
```

如果 multi-owner 中含：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
```

即：

```text
HARD STOP
```

---

# 22. Phase S — Single Dot 从根源没有错误 Candidate

保留现有：

```text
SINGLE-DOT-WRONG-APPLY
```

作为 temporary safety trap。

但最终成功标准不是：

```text
错误 candidate 被 guard block
```

而是：

```text
新 unbound `。`
收到 current-session historical-style candidate = 0
```

新增 candidate-level assertion：

```text
SINGLE-DOT-CURRENT-SESSION-CANDIDATE
```

如果：

```text
targetTextVisible == "。"
candidate record lifecycle != PERSISTED_HISTORICAL
candidate target != exact live owner
```

立即 HARD STOP。

最终 clean run：

```text
SINGLE-DOT-WRONG-APPLY = 0
SINGLE-DOT-CURRENT-SESSION-CANDIDATE = 0
```

---

# 23. Phase T — Backspace 只依赖 Exact Canonical Ownership

Backspace sequence：

```text
paragraph
↓
registry.resolveExactLiveRecord
↓
recordId
↓
updateExistingByRecordId
```

禁止 Backspace 调用：

```text
anchor resolver
ordinal resolver
proximity resolver
textHash resolver
generic upsert
```

找不到 exact owner：

```text
BACKSPACE-CANONICAL-BLOCK
```

必须：

```text
recordCount unchanged
semantic business mutation 不提交 canonical corruption
```

---

# 24. Phase U — Temporary → Stable Promotion by RecordId

当：

```text
CURRENT_LIVE
+
record.temporary=true
+
当前 bound paragraph 得到真实稳定内容
```

执行：

```ts
promoteExistingByRecordId(recordId, ...)
```

只允许：

```text
same recordId
temporary true → false
recordCount unchanged
binding retained
state remains CURRENT_LIVE
```

新增：

```text
CANONICAL-RECORD-PROMOTION
```

禁止 promotion 重新通过 anchor 找 record。

---

# 25. Phase V — Anchor 职责降级

Anchor 只允许承担：

```text
1. persistent snapshot metadata
2. PERSISTED_HISTORICAL reopen resolver
```

Anchor 不再承担：

```text
Enter live identity
Backspace live identity
promotion live identity
handoff identity
current-session ownership
```

如果发现这些业务路径仍调用：

```text
resolveParagraphAnchor*
```

作为 canonical identity source：

```text
Source Gate FAIL
```

---

# 26. Phase W — Rehydrate Projection 与 Canonical Mutation 分离

Rehydrate 默认职责：

```text
canonical state
→ runtime semantic / visual projection
```

不是：

```text
runtime DOM
→ canonical identity rewrite
```

CURRENT_LIVE rehydrate：

```text
禁止 anchor-repair mutation
```

因为 anchor 更新应该来自 trusted live mutation event。

PERSISTED_HISTORICAL：

首次 exact/high-confidence restore 后
允许一次受控 metadata repair。

所有 rehydrate canonical mutation 输出：

```text
REHYDRATE-CANONICAL-MUTATION
```

settled refresh 必须：

```text
count=0
```

---

# 27. Phase X — Anchor Repair Idempotence

对允许的 historical metadata repair：

```text
normalize(oldAnchor)
==
normalize(newAnchor)
```

则：

```text
dirty=false
writeScheduled=false
```

只有：

```text
materially different
+
trusted historical owner
```

才允许 write。

连续无编辑 refresh 不得反复写。

---

# 28. Phase Y — Document Switch Lifecycle

切换 doc A → doc B：

不能只：

```text
clearLiveBindings()
```

然后让 old records 无 metadata。

必须：

```text
1. 清理 A 的 element/runtime lookup
2. 清理 active transaction/handoff
3. 对 current-session A records 做显式 lifecycle transition
4. 禁止它们在 B 中 resolve
5. 禁止它们因为 no binding 进入 historical heuristic
```

若 A records 已成功 physical save 且下一次重新 load：

```text
从 sidecar load
→ 新 runtime 中登记 PERSISTED_HISTORICAL
```

当前 process 内不要静默把 current-session records 转 historical。

---

# 29. Phase Z — Physical Sidecar / Vault Root 最终闭环

完成 in-memory identity 修复后，
必须继续解决：

```text
vaultRoot=unknown
SIDECAR-DISABLED
```

读取真实 application/vault API。

test vault 必须解析到：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

禁止恢复生产 TEMP fallback。

必须证明：

```text
SIDECAR-ACTUAL-WRITE
source=physical
```

以及：

```text
SIDECAR-ACTUAL-LOAD
source=physical
```

使用同一 storage identity。

---

# 30. 推荐最终模块边界

目标 architecture：

```text
paragraph-layout-store.ts
│
├─ persistent schema
├─ load
└─ save


paragraph-canonical-registry.ts
│
├─ canonical record ID ownership
├─ runtime lifecycle
├─ element binding
├─ runtimeId binding
├─ session origin
├─ transfer
├─ promotion
└─ mutation invariants


paragraph-rehydrate-resolver.ts
│
├─ lifecycle eligibility gate
├─ CURRENT_LIVE exact resolution
├─ CURRENT_AWAITING_TRANSFER zero candidate
├─ CURRENT_RETIRED zero candidate
└─ PERSISTED_HISTORICAL persistent resolver


heading-numbering-service.ts
│
├─ event orchestration
├─ Enter
├─ Backspace
├─ handoff
├─ refresh
└─ UI integration
```

如果为了控制 diff 暂时不能一次完全拆文件，
至少要形成等价职责边界，
并在 final report 说明 remaining extraction。

---

# 31. 迁移策略：禁止 Big-Bang 无保护重写

按顺序迁移：

```text
MIG-1
建立 registry + lifecycle types

MIG-2
接入 Enter canonical creation

MIG-3
接入 Backspace exact-update

MIG-4
接入 handoff lifecycle + transfer

MIG-5
接入 rehydrate lifecycle eligibility

MIG-6
current-session persistent resolver hard block

MIG-7
接入 promotion

MIG-8
projection / canonical mutation separation

MIG-9
document switch isolation

MIG-10
physical sidecar historical registration
```

每一步 typecheck + focused tests。

不得先删除所有旧路径再一起调。

---

# 32. Legacy Generic Upsert 淘汰 Gate

必须 inventory 所有：

```text
applyParagraphIndentOverrideToSidecar*
```

调用点。

最终业务规则：

```text
Enter
→ explicit create/reuse

Backspace
→ explicit updateExisting

Promotion
→ explicit promoteExisting

UI existing override mutation
→ explicit updateExisting

Handoff
→ binding transfer only
```

Legacy generic upsert 如果保留：

```text
只能作为内部 compatibility wrapper
且不得被 live command path 调用
```

---

# 33. Source Gate — Lifecycle

必须找到真实 executable production implementation：

```text
CanonicalRuntimeState
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
PERSISTED_HISTORICAL

ParagraphCanonicalRegistry
```

不是 docs/tests/comment。

---

# 34. Source Gate — Mutation Intent

必须证明：

```text
BACKSPACE_UPDATE
没有 CREATE_NEW branch

PROMOTION
没有 CREATE_NEW branch

TRANSFER
没有 CREATE_NEW branch
```

最好通过 API/type structure 证明，而不只是 runtime `if`。

---

# 35. Source Gate — Persistent Resolver Isolation

搜索所有调用：

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROMOTED-ANCHOR
MATCH-INDEX-FALLBACK
MATCH-PROXIMITY
MATCH-LEGACY
resolveParagraphAnchor*
```

必须证明：

```text
只有 PERSISTED_HISTORICAL
能够进入 persistent resolver
```

出现 current-session path：

```text
HARD STOP — CURRENT_SESSION_PERSISTENT_RESOLVER_SOURCE_LEAK
```

---

# 36. Source Gate — Handoff

必须证明：

```text
activeOneShotHandoff
携带 canonicalRecordId

replacement resolve
→ transferCanonicalBinding
```

不能只：

```text
semantic transfer
```

---

# 37. Unit Tests — Registry

至少：

## REG-1
Create Enter record:

```text
state=CURRENT_LIVE
recordId unique
element/runtime bound
```

## REG-2
one runtime → two records:

```text
BLOCK collision
```

## REG-3
one record → two live owners:

```text
BLOCK collision
```

## REG-4
mark awaiting transfer:

```text
CURRENT_LIVE → CURRENT_AWAITING_TRANSFER
```

## REG-5
transfer:

```text
same recordId
old owner invalid
new owner active
generation +1
recordCount unchanged
```

---

# 38. Unit Tests — Rehydrate Eligibility

## REH-1 CURRENT_LIVE

```text
only MATCH-LIVE-BINDING
```

## REH-2 CURRENT_AWAITING_TRANSFER

```text
candidateCount=0
```

## REH-3 CURRENT_RETIRED

```text
candidateCount=0
```

## REH-4 PERSISTED_HISTORICAL

```text
persistent matcher allowed
```

## REH-5

current-session no binding：

```text
must NOT be inferred historical
```

## REH-6

current-session record cannot emit:

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROXIMITY
```

---

# 39. Unit Tests — Commands

## CMD-1 Enter

```text
create exactly once
txn.canonicalRecordId set
```

## CMD-2 repeated Enter-owned processing

```text
same txn cannot append second record
```

## CMD-3 Backspace

```text
same record update
```

## CMD-4 Backspace missing identity

```text
BLOCK
record count unchanged
```

## CMD-5 Promotion

```text
same recordId
temporary true→false
```

---

# 40. Unit Tests — Replacement Regression

必须复现之前 `P-RUNTIME-*` replacement failure class：

```text
Enter
→ bind R to P1
→ P1 disconnected
→ state AWAITING_TRANSFER
→ replacement P2
→ transfer R P1→P2
→ Backspace P2
→ SAME R
```

要求：

```text
record count unchanged after transfer
record count unchanged after Backspace
```

---

# 41. Unit Tests — Single Dot Regression

存在 current-session old records：

```text
R1 CURRENT_LIVE
R2 CURRENT_AWAITING_TRANSFER
R3 CURRENT_RETIRED
```

创建 unbound：

```text
。
```

必须：

```text
R1 candidate to `。` = 0
R2 candidate to `。` = 0
R3 candidate to `。` = 0
semantic=AUTO
```

---

# 42. Unit Tests — Historical Reopen

构造：

```text
record loaded from sidecar
state=PERSISTED_HISTORICAL
```

确保 persistent anchor resolver 仍可用。

本轮不能因为隔离 current session
把真实 reopen persistence 全部禁掉。

---

# 43. Instrumentation

保留/完善：

```text
CANONICAL-RECORD-COMMIT
LIVE-BINDING-RESOLUTION
CANONICAL-BINDING-TRANSFER
CANONICAL-TRANSFER-PENDING
CANONICAL-RECORD-BACKSPACE
CANONICAL-RECORD-PROMOTION

REHYDRATE-CANDIDATE
REHYDRATE-CANDIDATE-DEDUPE
REHYDRATE-APPLY
REHYDRATE-WRITE-AUDIT
REHYDRATE-CANONICAL-MUTATION

LIVE-BINDING-COLLISION
BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER
SINGLE-DOT-WRONG-APPLY
SINGLE-DOT-CURRENT-SESSION-CANDIDATE
```

---

# 44. Unified RECORD-LIFECYCLE Trace

每个 record 必须能够按 recordId 回放：

```text
CREATE
REGISTER_CURRENT
BIND
AWAIT_TRANSFER
TRANSFER
BACKSPACE_UPDATE
PROMOTE
REHYDRATE_CANDIDATE
REHYDRATE_APPLY
REHYDRATE_BLOCK
RETIRE
PERSISTED_LOAD
```

统一：

```text
RECORD-LIFECYCLE
```

字段至少：

```text
recordId
event
documentKey
sessionId
runtimeState
runtimeId
previousRuntimeId
generation
mode
temporary
recordCount
targetRuntimeId
matchStrategy
candidateSource
timestamp
```

---

# 45. Build ID

只有完成实际 architecture migration 后才修改 build ID。

建议风格：

```text
inkchapter-canonical-registry-lifecycle-r58-2-<unique>
```

不要仅修改 Build ID 来表示重构完成。

---

# 46. Typecheck / Test / Build

执行项目原生：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

必须记录：

```text
exit code
test files
test count
failures
```

---

# 47. Deploy Gate

使用 authoritative：

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
```

不允许错误部署目录。

---

# 48. Strict Typora Startup Gate

重启后必须验证：

```text
old process exited
new PID
new StartTime
MainWindowHandle != 0
MainWindowTitle
target vault
target test document
runtime main.js path
main.js SHA256
style.css SHA256
runtime build ID
initializationCount=1
```

如果启动命令执行了，但任一项未确认：

```text
启动命令已发出，但尚未确认成功
```

不得写：

```text
Typora 已成功启动
```

---

# 49. Runtime Acceptance R1 — Enter 3/3

每轮：

```text
fresh paragraph
→ exact trigger
→ Enter
```

必须：

```text
CANONICAL-RECORD-COMMIT
state=CURRENT_LIVE
txn canonicalRecordId set
recordCount exactly +1
duplicate append=0
```

3/3。

---

# 50. Runtime Acceptance R2 — Replacement 5/5

必须真实观察 DOM replacement。

每轮：

```text
CURRENT_LIVE P1
→ originalConnected=false
→ CURRENT_AWAITING_TRANSFER
→ replacement P2
→ CANONICAL-BINDING-TRANSFER
→ CURRENT_LIVE P2
```

必须：

```text
same canonicalRecordId
generation +1
old owner invalid
new owner active
recordCount unchanged
```

5/5。

如果没有实际 replacement：

```text
NOT EXECUTED
```

不得 PASS。

---

# 51. Runtime Acceptance R3 — Backspace After Replacement 10/10

每轮：

```text
Enter
→ wait actual replacement
→ verify transfer
→ Backspace at logical start
```

必须：

```text
same canonicalRecordId
UPDATE_EXISTING
recordCount unchanged
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

# 52. Runtime Acceptance R4 — No Current-Session Persistent Candidate

全 session 搜索：

```text
BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER
```

必须：

```text
count=0
```

并人工抽查至少 5 个：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
```

record lifecycle。

必须没有：

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROXIMITY
MATCH-LEGACY
```

---

# 53. Runtime Acceptance R5 — Single Dot 10/10

每轮：

```text
存在多个 current-session canonical records
→ 新 unbound paragraph
→ 输入单 `。`
→ refresh / rebuild
```

必须：

```text
semantic=AUTO
computed=0px or resolved auto style

SINGLE-DOT-CURRENT-SESSION-CANDIDATE=0
SINGLE-DOT-WRONG-APPLY=0
```

10/10。

注意：

```text
“wrong apply 被 block”
不算 PASS。
```

要求错误 candidate 根本不产生。

---

# 54. Runtime Acceptance R6 — Multi-owner

对 current-session candidate：

```text
unexpected current-session multi-owner=0
```

若 historical records 发生 multi-owner：

```text
允许 Two-Pass BLOCK
但必须 candidateLifecycleStates 全部是 PERSISTED_HISTORICAL
```

---

# 55. Runtime Acceptance R7 — Promotion 5/5

每轮：

```text
temporary CURRENT_LIVE R
→ 输入稳定内容
→ promotion
```

必须：

```text
same R
temporary true→false
state CURRENT_LIVE
recordCount unchanged
binding retained
```

5/5。

---

# 56. Runtime Acceptance R8 — Settled Refresh Idempotence

停止编辑后观察至少 10 个 refresh。

必须全部：

```text
REHYDRATE-CANONICAL-MUTATION=0
dirty=false
writeScheduled=false
```

若存在实际 justified historical one-time repair，
必须独立标出，并在下一轮稳定。

---

# 57. Runtime Acceptance R9 — Document Switch

执行：

```text
doc A → doc B → doc A
```

至少 3 cycles。

必须：

```text
A bindings never resolve in B
B bindings never resolve in A
current-session records 不因 clear binding 进入 historical heuristic
record count 不异常增长
```

---

# 58. Runtime Acceptance R10 — Physical Persistence

先修正 vaultRoot。

证明：

```text
SIDECAR-ACTUAL-WRITE source=physical
SIDECAR-ACTUAL-LOAD source=physical
```

然后：

```text
create stable records
save
close document
reopen
restart Typora
reopen
```

必须：

```text
loaded records register PERSISTED_HISTORICAL
persistent resolver 恢复正确 target
没有 stale current-session binding
没有 duplicate canonical record
```

---

# 59. Hard Stop List

任一出现：

```text
BACKSPACE_UPDATE decision=CREATE_NEW

BACKSPACE-DUPLICATE-RECORD-BUG

BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION

LIVE-BINDING-COLLISION

BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER

SINGLE-DOT-CURRENT-SESSION-CANDIDATE

SINGLE-DOT-WRONG-APPLY

current-session multi-owner

transfer record count changed

promotion record count changed

cross-document binding

current-session record silently converted historical

persistent resolver entered without PERSISTED_HISTORICAL state
```

立即：

```text
R58.2 NOT FIXED — R60 BLOCKED
```

不要继续用后续成功覆盖失败。

---

# 60. 不允许的假修复

禁止以下方式作为完成：

```text
只加 single-dot 特判

只加 BACKSPACE BLOCK

只加更多 logging

只把 multi-owner BLOCK 得更严

只改 build ID

只增加 tests 但不迁移 production path

只在 active binding 存在时 skip heuristic

binding 丢失后仍 fallback persistent resolver

document switch 直接 clear maps 后不管理 lifecycle

把 current-session records 删除 metadata 后当 historical
```

---

# 61. Source Acceptance

必须给出 production call graph：

```text
Enter
→ registry
→ recordId

Handoff
→ lifecycle AWAITING_TRANSFER
→ transfer
→ same recordId

Backspace
→ registry exact owner
→ updateExisting

Promotion
→ registry recordId
→ promoteExisting

Rehydrate
→ lifecycle gate
→ exact live OR persistent historical
```

不能只列函数名。

---

# 62. Runtime Success Shape

最终 clean trace 应类似：

```text
ENTER
RECORD-LIFECYCLE CREATE
recordId=R1
state=CURRENT_LIVE
runtimeId=P1

DOM REPLACEMENT
RECORD-LIFECYCLE AWAIT_TRANSFER
recordId=R1

CANONICAL-BINDING-TRANSFER
recordId=R1
from=P1
to=P2
state=CURRENT_LIVE
recordCount unchanged

REHYDRATE
recordId=R1
candidateSource=LIVE
strategy=MATCH-LIVE-BINDING
target=P2

BACKSPACE
recordId=R1
UPDATE_EXISTING
recordCount unchanged

PROMOTION
recordId=R1
temporary=true→false
recordCount unchanged
```

整个 current session：

```text
current-session MATCH-EXACT-ANCHOR = 0
current-session MATCH-NORMALIZED-ANCHOR = 0
current-session MATCH-PROXIMITY = 0
current-session MATCH-LEGACY = 0

SINGLE-DOT-WRONG-APPLY = 0
SINGLE-DOT-CURRENT-SESSION-CANDIDATE = 0

unexpected current-session multi-owner = 0

BACKSPACE CREATE_NEW = 0
```

---

# 63. Final Report

最终必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Root Cause
## 4. Old Identity Architecture
## 5. New Canonical Registry Architecture
## 6. Runtime Lifecycle State Machine
## 7. Session Origin Model
## 8. Persistent Record vs Runtime Metadata Separation
## 9. Enter Migration
## 10. Handoff Await/Transfer Migration
## 11. Backspace Explicit Update Migration
## 12. Promotion Migration
## 13. Rehydrate Lifecycle Eligibility
## 14. Persistent Resolver Isolation
## 15. Candidate Deduplication
## 16. Single-Dot Root Fix
## 17. Multi-owner Root Fix
## 18. Projection vs Canonical Mutation Separation
## 19. Anchor Repair Idempotence
## 20. Document Switch Lifecycle
## 21. Physical Sidecar / Vault Root
## 22. Files Changed
## 23. Source Gates
## 24. Typecheck
## 25. Unit Tests
## 26. Build
## 27. Deploy SHA256
## 28. Strict Startup Verification
## 29. R1 Enter 3/3
## 30. R2 Replacement 5/5
## 31. R3 Backspace-after-Replacement 10/10
## 32. R4 Current-Session Persistent Resolver Leak Count
## 33. R5 Single-Dot 10/10
## 34. R6 Multi-owner Results
## 35. R7 Promotion 5/5
## 36. R8 Settled Refresh 10/10
## 37. R9 Document Switch 3 cycles
## 38. R10 Save/Reopen/Restart Persistence
## 39. Hard Stop Trace Counts
## 40. Remaining Known Issues
## 41. Final Verdict
```

---

# 64. Final Verdict Vocabulary

只能二选一：

```text
R58.2 FIXED — R60 UNLOCKED
```

或：

```text
R58.2 NOT FIXED — R60 BLOCKED
```

没有：

```text
source fixed
mostly fixed
guard fixed
runtime likely fixed
ready for R60
```

这种中间措辞。

任一 mandatory runtime scenario：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终都必须：

```text
R58.2 NOT FIXED — R60 BLOCKED
```

---

# 65. Execution Rules

直接对真实 repository 执行。

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

用于报告。

不要编造：

```text
GUI result
SHA256
PID
window handle
active vault
runtime build
runtime traces
sidecar path
```

如果当前环境不能完成真实 GUI acceptance：

```text
不得标 PASS
```

最终：

```text
R58.2 NOT FIXED — R60 BLOCKED
```

直到真实 Typora runtime 证明完整 lifecycle。

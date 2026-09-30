# Trae 完整修复任务：Heading Diagnostic Active Persistence V1
## 标题诊断 Active 持续投影 + 多目标 TargetKey 权威 + Post-Layout Closure

> 项目：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> 本轮按“一次性完整执行模式”执行。
>
> **不是只读审计，不允许只列问题后停止；发现问题后必须在同一轮完成生产修改、测试、构建、部署、Runtime 验收和最终证据报告。**
>
> 本轮主问题已经从“点击分类失败”进一步收敛为：
>
> **标题诊断点击时能够进入 ACTIVE，初始定位和 Active Fill 也能成功，但后续 heading geometry/layout reconcile 会把 Active 视觉重建掉，造成 Drawer/状态仍认为 ACTIVE，而正文实际 Active Fragment / Fill 已消失；同时 multi-target heading 还存在 canonical diagnostic target index 与 transaction-local index 混用风险。**

---

# 0. 本轮不要再修什么

除非新 Runtime 证据证明存在回归，否则本轮禁止重新大改：

```text
Active State Machine V2 click classification
DEACTIVATE every-click versioning
V2.1 atomic teardown
Figure Diagnostic Locator
Figure Fixture Resource Closure
Figure Literal Exclusion
图片结构规则
severity Error/Warning 分支
```

当前最新 Runtime 已证明：

```text
Click
→ ACTIVATE / SWITCH
→ Locate
→ Highlight
→ Active Fill
```

初始链路可以成功。

真正需要修复的是：

```text
Heading Active Visual Persistence
+
Heading Visual Projection Authority
+
Multi-target canonical row/target identity
+
Post-layout Runtime closure
```

---

# 1. 最新 Runtime 已确认的事实

## 1.1 点击本身成功

最新日志中：

```text
clickSequence=20

clickedDiagnosticId=
document:STRICT_SINGLE_H1_MULTIPLE_H1:...

clickedTargetIndex=1

phaseBefore=IDLE
action=ACTIVATE
phaseAfter=ACTIVE

versionBefore=19
versionAfter=20

transactionIdAfter=15
```

所以：

```text
标题诊断点击没有被 dispatch 丢失
```

---

## 1.2 初始 Locate 成功

同一次点击：

```text
targetVisible=true

highlightClassApplied=true
highlightRectsCount=1

activeMarkerPresent=true
activeFragmentRects=[...]

fillCount=1
fillGateSatisfied=true
```

因此：

```text
Locate Resolver
Heading Target Resolution
初始 Active Fill 建立
```

都曾经成功。

---

## 1.3 Post-Settle 一度闭环

同一次点击的 post-settle：

```text
phaseAfter=ACTIVE
activeStatePresent=true
selectedActiveRowCount=1

activeTargetCount=1
activeFillCount=1
activeHeadingFragmentCount=1

activeLeasePresent=true
```

说明点击完成瞬间：

```text
State
Drawer
Target
Fill
Lease
```

是一致的。

---

## 1.4 后续 geometry/layout reconcile 把 Active Fill 丢掉

随后 layout epoch 更新：

```text
layoutEpochBefore=37
layoutEpochAfter=38
```

同一个 active heading 出现：

```text
activeFragmentRects=[]
activeRebuilt=false

activeMarkerPresent=true
fillFragmentRects=[]
fillFragmentCount=0

passiveFillSuppressed=true

decision=PASS
```

这是本轮核心错误。

非法状态是：

```text
phase = ACTIVE
activeMarkerPresent = true

但：

activeFragmentCount = 0
activeFillCount = 0
```

并且：

```text
passiveFillSuppressed = true
```

最终形成视觉真空：

```text
Passive 不画
Active 也没画
```

---

# 2. 额外发现：multi-target targetIndex namespace 混用风险

本轮必须一起修复。

点击日志：

```text
clickedTargetIndex=1
```

说明用户点击的是：

```text
多余 H1 的第 2 个 target
```

但进入 narrowed locate transaction 后：

```text
targetCount=1
targetIndex=0
```

这本身可以是合理的：

```text
transaction 内只有一个局部 target
所以 local index = 0
```

问题是后续 audit 又出现：

```text
activeTargetIdentity=id:H1:idx:8
activeTargetIndex=0
```

也就是说：

```text
canonical diagnostic target index = 1

transaction local target index = 0
```

两套 index 已同时存在。

如果 Drawer row active、Heading visual projection、reason chip、reconcile 中任何一处把：

```text
transactionLocalIndex
```

误当：

```text
diagnosticTargetIndex
```

就会造成：

```text
点 2/2
状态却映射到 1/2

或者：

正文 target 是 H1:idx:8
Drawer active row 却映射错
```

因此本轮必须正式拆分两个 namespace。

---

# 3. 额外发现：跨 diagnostic 的 Active Target 泄漏

切换到：

```text
HEADING_LEVEL_GAP
H3:idx:9
```

后，`STRICT_SINGLE_H1_MULTIPLE_H1` 自己的 Visual Audit 仍观察到：

```text
activeTargetIdentity=id:H3:idx:9
```

而 H3 显然不属于：

```text
STRICT_SINGLE_H1_MULTIPLE_H1
```

的 excess H1 target set。

同时：

```text
activeTargetNotInExcessSet
```

计数增加，但 audit 仍：

```text
decision=PASS
```

这说明：

```text
某些 Heading audit / visual reconcile
直接读取了全局 active target
而没有先判断 activeDiagnosticId 是否等于当前正在投影的 diagnosticId。
```

这也必须修。

---

# 4. 本轮根因正式定义

```text
ROOT_H1
Active heading fill 仍是 click-time side effect，
不是 activeDiagnosticState 的持续派生投影。

ROOT_H2
layoutEpoch / geometryGeneration 更新时，
passive heading visual 会 rebuild，
active visual 没有同步 rebuild。

ROOT_H3
passiveFillSuppressed 可以在 activeFillCount=0 时成立，
造成 Passive=0 + Active=0。

ROOT_H4
Heading Marker Audit 把 activeMarkerPresent 布尔值当成功条件，
即使 activeFragmentRects=[] / fillFragmentCount=0 仍然 PASS。

ROOT_H5
Post-Settle Closure 只验证 click settle 瞬间，
没有验证之后的 heading visual reconcile。

ROOT_H6
diagnosticTargetIndex 和 transactionLocalIndex 混用，
multi-target row/target 可能发生 identity/index 漂移。

ROOT_H7
Heading visual audit/reconcile 对 active target 的读取没有按 diagnostic scope，
导致其它 diagnostic 的 active heading 泄漏进当前 diagnostic audit。

ROOT_H8
Drawer row active projection 与 body heading active projection
没有共享同一个 canonical target key / owner snapshot。
```

---

# 5. 本轮目标架构

最终应统一成：

```text
DiagnosticInteractionState
        │
        │ canonical authority
        ▼
HeadingDiagnosticProjection
        │
        ├─ Drawer Active Row
        ├─ Passive Heading Marker
        ├─ Active Heading Fill
        ├─ Reason Chip
        └─ Runtime Audit
```

禁止继续形成：

```text
Drawer 自己保存 selected
Heading passive 自己 rebuild
Active locate 自己 paint
Reason chip 自己读 lastLocated
```

的多源投影。

---

# 6. Active State 仍然是唯一交互权威

保持：

```ts
DiagnosticInteractionState {
  version,
  phase,
  diagnosticId,
  targetKey,
  diagnosticTargetIndex,
  transactionId,
  leaseToken
}
```

其中：

```text
diagnosticTargetIndex
```

必须是：

```text
诊断原始 multi-target 下标
```

不得被 transaction-local index 覆盖。

---

# 7. 正式拆分两个 Target Index Namespace

建议显式命名：

```ts
diagnosticTargetIndex
transactionLocalTargetIndex
```

例如：

```text
STRICT_SINGLE_H1_MULTIPLE_H1
targets = [H1:idx:4, H1:idx:8]

用户点击 H1:idx:8
diagnosticTargetIndex = 1

transaction targets = [H1:idx:8]
transactionLocalTargetIndex = 0
```

二者合法但含义不同。

---

# 8. Canonical TargetKey 必须使用 diagnostic namespace

Canonical target key：

```text
documentKey
+
diagnosticId
+
diagnosticTargetIndex
+
stableHeadingIdentity
```

例如：

```text
...::STRICT_SINGLE_H1_MULTIPLE_H1::1::id:H1:idx:8
```

禁止构造：

```text
...::STRICT_SINGLE_H1_MULTIPLE_H1::0::id:H1:idx:8
```

如果 0 是 transaction-local index。

---

# 9. Drawer RowKey 必须和 TargetKey 一致

multi-target 诊断的每一行：

```text
1/2
2/2
```

都必须有唯一：

```text
drawerRowKey
```

建议：

```text
drawerRowKey =
diagnosticId
+
diagnosticTargetIndex
+
stableHeadingIdentity
```

不得仅使用：

```text
diagnosticId
```

因为：

```text
1/2 和 2/2 diagnosticId 相同
```

---

# 10. Drawer Active 判定必须由 Active State 派生

不要保存独立：

```text
row.active = true/false
```

而是每次 render：

```ts
isActive =
  activeState.phase === 'ACTIVE'
  && activeState.diagnosticId === row.diagnosticId
  && activeState.diagnosticTargetIndex === row.diagnosticTargetIndex
  && activeState.targetKey === row.targetKey;
```

这样：

```text
Drawer re-render
filter re-render
layout change
geometry change
```

都不会丢 Active row。

---

# 11. Heading Active Visual 也必须由同一个 TargetKey 派生

不能只比较：

```text
diagnosticId
```

必须比较：

```text
activeState.targetKey
```

或者：

```text
diagnosticId
+
diagnosticTargetIndex
+
stableHeadingIdentity
```

---

# 12. 建立统一 Heading Visual Snapshot

建议建立：

```ts
interface HeadingDiagnosticVisualSnapshot {
  headingIdentity: string;
  layoutEpoch: number;
  geometryGeneration: number;

  passiveFragments: Rect[];
  activeFragments: Rect[];

  reasonChip: ReasonChipProjection | null;

  diagnosticId: string | null;
  diagnosticTargetIndex: number | null;
  activeTargetKey: string | null;

  activeOwnerVersion: number | null;
  activeLeaseToken: string | null;
}
```

实际类型命名按项目代码组织调整。

---

# 13. Heading Projection 必须同时读取三个 Authority

```text
A. current diagnostic snapshot
B. current DiagnosticInteractionState
C. current settled heading geometry
```

建议统一入口：

```ts
buildHeadingDiagnosticVisualSnapshot(
  diagnosticSnapshot,
  interactionState,
  headingGeometrySnapshot,
)
```

---

# 14. Passive + Active 必须一次性计算

当前不要再：

```text
先 build passive
后面单独 append active
```

应该：

```text
同一 snapshot 内同时得到：

passiveFragments
activeFragments
reasonChip
activeOwner
```

这样 active 不再是 click-time 临时 DOM。

---

# 15. Atomic Publish

正确顺序：

```text
measure new geometry
        ↓
build full passive + active snapshot
        ↓
validate snapshot closure
        ↓
atomic publish
        ↓
retire previous visual snapshot
```

禁止：

```text
clear old active
→ suppress passive
→ 再尝试 build active
```

---

# 16. 旧视觉不能先清除

如果新 snapshot 尚未满足：

```text
activeFragments >= 1
```

则：

```text
不要先销毁旧的 committed visual snapshot
```

应：

```text
保留旧完整 snapshot
→ 等新的 settled geometry 一次性替换
```

如果必须等待一帧：

```text
允许 bounded one-shot rAF / layout settle
```

禁止：

```text
interval polling
无限 retry
timer loop
```

---

# 17. Layout Epoch 不是 Interaction Version

必须明确：

```text
layoutEpoch change
!= user interaction
```

所以：

```text
layoutEpoch 37 → 38
```

不得：

```text
DEACTIVATE
retire active owner
clear active target
```

只能：

```text
remeasure
reproject
republish
```

---

# 18. 增加 Visual Projection Generation

建议把：

```text
interactionVersion
```

和：

```text
headingVisualGeneration
```

分开。

例如：

```ts
interactionVersion = 20
headingVisualGeneration = 58 → 59 → 60
```

layout 变化只增长：

```text
headingVisualGeneration
```

不改变：

```text
interactionVersion
active targetKey
lease owner
```

---

# 19. Visual callback 必须双重验证

任何异步 visual callback commit 前检查：

```text
interactionVersion still matches

AND

headingVisualGeneration still current
```

其中：

```text
interaction version
```

防旧用户交互覆盖新交互。

```text
visual generation
```

防旧 geometry 覆盖新 geometry。

---

# 20. Active Owner 在 layout change 后必须仍然存在

如果：

```text
interaction state = ACTIVE
```

且：

```text
diagnostic still exists
target still exists
```

则 layout change 后：

```text
active owner
```

必须不变：

```text
same diagnosticId
same diagnosticTargetIndex
same targetKey
same interactionVersion
same lease token
```

只允许：

```text
geometry generation
fragment rect
```

变化。

---

# 21. Passive Suppression 必须改成“Active Ready 后才能生效”

当前非法：

```text
passiveFillSuppressed=true
activeFillCount=0
```

必须永久禁止。

建议：

```ts
const canSuppressPassive =
  activeState.phase === 'ACTIVE'
  && activeOwnerMatches
  && activeFragments.length > 0
  && activeFragmentsMeasurable
  && activeFragmentsVisible;
```

只有：

```text
canSuppressPassive=true
```

才允许：

```text
passiveFillSuppressed=true
```

---

# 22. 如果 Active 重建失败，不能进入视觉真空

若当前 active heading 新一轮 geometry 测量暂时失败：

```text
优先保留上一 committed active visual
```

如果旧 geometry 已不可用：

```text
至少恢复 passive visual
```

禁止：

```text
Passive=0
Active=0
```

---

# 23. Active Fragment 必须成为 State-Derived Projection

最终关系必须是：

```text
Active State
+
Current Heading Geometry
=
Active Heading Fragment
```

而不是：

```text
User Click
→ append Active Fragment once
```

---

# 24. Cross-Diagnostic Scope 必须收敛

每个 diagnostic 的 visual audit/reconcile 必须先判断：

```ts
const activeBelongsToDiagnostic =
  activeState.phase === 'ACTIVE'
  && activeState.diagnosticId === diagnostic.id;
```

如果不是：

```text
activeTargetForThisDiagnostic = null
activeMarkerCountForThisDiagnostic = 0
```

---

# 25. Strict Multi-H1 Audit 不得看到 H3 Active

当当前 active 是：

```text
HEADING_LEVEL_GAP / H3:idx:9
```

则：

```text
STRICT_SINGLE_H1_MULTIPLE_H1 audit
```

中必须：

```text
activeTargetIdentity=null
```

或者：

```text
activeTargetBelongsToAudit=false
```

不能再：

```text
activeTargetIdentity=id:H3:idx:9
```

然后继续 PASS。

---

# 26. activeTargetNotInExcessSet 不能继续被忽略

对 Strict Multi-H1 audit：

如果：

```text
activeDiagnosticId === STRICT_SINGLE_H1_MULTIPLE_H1
```

并且：

```text
active target 不属于 excess H1 set
```

必须：

```text
decision=FAIL
```

不能只 increment counter 以后仍：

```text
PASS
```

如果 active 属于其它 diagnostic：

```text
不应计入 activeTargetNotInExcessSet
```

因为不属于这个 audit scope。

---

# 27. Heading Marker Audit 成功条件必须重写

当前：

```text
activeMarkerPresent=true
fillFragmentCount=0
decision=PASS
```

必须禁止。

对于 current active heading：

```text
ACTIVE heading
```

必须同时满足：

```ini
activeMarkerPresent=true
activeFragmentCount>=1
activeFillCount>=1
activeFragmentMeasurable=true
activeFragmentVisible=true
activeFragmentHeadingIdentity=currentActiveHeading
activeFragmentLayoutEpoch=currentLayoutEpoch
activeFragmentGeometryGeneration=currentGeometryGeneration
```

否则：

```ini
decision=FAIL
```

---

# 28. 布尔 activeMarkerPresent 必须从真实 DOM/Projection 派生

禁止：

```text
activeMarkerPresent
```

只是某个 logical flag。

应该表示：

```text
当前 projection 中确实存在可见 active marker/fill
```

如果：

```text
activeFragmentRects=[]
```

则：

```text
activeMarkerPresent=false
```

---

# 29. Heading Coverage Audit 也必须核对 Active Fragment

当：

```text
bodyActivePolicy=FULL_VISIBLE_HEADING
```

时：

```text
bodyActiveCoverageMask
```

不能仅根据期望 policy 写 TITLE。

必须核对：

```text
真实 active fragment rect
```

如果：

```text
active rect = []
```

则：

```text
bodyActiveCoverageMask=NONE
decision=FAIL
```

---

# 30. Post-Settle Closure 需要升级

当前：

```text
POST-SETTLE-CLOSURE-V2
```

只证明：

```text
click settle 时 activeFillCount=1
```

但后面 geometry reconcile 又能破坏它。

因此新增：

```text
DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE
```

---

# 31. Post-Reconcile Closure 触发条件

事件驱动触发：

```text
layoutEpoch changed
heading visual projection committed
drawer rerender completed
caption reconcile changed layout
numbering changed heading geometry
```

禁止纯时间轮询。

---

# 32. Post-Reconcile Closure 的状态要求

如果：

```text
activeState.phase=ACTIVE
active target is heading
```

则每次 heading projection commit 后都必须：

```ini
selectedActiveRowCount=1

activeTargetCount=1

activeHeadingFragmentCount>=1
activeFillCount>=1

activeLeasePresent=true

activeTargetKey == activeState.targetKey

activeHeadingIdentity == targetKey.headingIdentity

activeFragmentLayoutEpoch == currentLayoutEpoch
```

---

# 33. Drawer Active Row 也必须纳入 Post-Reconcile Closure

必须验证：

```text
正文 Active
+
Drawer row Active
```

同时存在。

不能：

```text
正文 Active
Drawer row passive
```

也不能：

```text
Drawer row Active
正文 Fill=0
```

---

# 34. 新增 Heading Active Persistence Audit

新增：

```text
DOCUMENT-DIAGNOSTIC-HEADING-ACTIVE-PERSISTENCE-AUDIT
```

字段至少：

```yaml
documentKey:

interactionVersion:
diagnosticId:
diagnosticTargetIndex:
targetKey:
headingIdentity:

phase:

layoutEpochBefore:
layoutEpochAfter:

geometryGenerationBefore:
geometryGenerationAfter:

activeOwnerBefore:
activeOwnerAfter:

activeLeaseTokenBefore:
activeLeaseTokenAfter:

drawerActiveRowCountBefore:
drawerActiveRowCountAfter:

activeFragmentCountBefore:
activeFragmentCountAfter:

activeFillCountBefore:
activeFillCountAfter:

passiveFillSuppressedBefore:
passiveFillSuppressedAfter:

activeRebuildRequired:
activeRebuildPerformed:

targetIndexNamespace:
transactionLocalTargetIndex:

decision:
reason:
```

---

# 35. 新增 Target Index Authority Audit

新增：

```text
DOCUMENT-DIAGNOSTIC-TARGET-INDEX-AUTHORITY-AUDIT
```

至少：

```yaml
diagnosticId:
stableHeadingIdentity:

diagnosticTargetIndex:
transactionLocalTargetIndex:

targetKeyEncodedIndex:
drawerRowEncodedIndex:
activeStateEncodedIndex:

decision:
reason:
```

---

# 36. Target Index Gate

必须：

```ini
DIAGNOSTIC_TARGET_INDEX_TRANSACTION_LOCAL_INDEX_ALIAS_COUNT=0

MULTI_TARGET_HEADING_ACTIVE_TARGETKEY_MISMATCH_COUNT=0

MULTI_TARGET_HEADING_WRONG_SUBTARGET_ACTIVE_COUNT=0

DRAWER_ROW_CANONICAL_TARGET_INDEX_MISMATCH_COUNT=0

HEADING_VISUAL_CANONICAL_TARGET_INDEX_MISMATCH_COUNT=0
```

---

# 37. Cross-Diagnostic Gate

必须：

```ini
CROSS_DIAGNOSTIC_ACTIVE_TARGET_LEAK_COUNT=0

STRICT_MULTI_H1_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT=0

HEADING_LEVEL_GAP_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT=0
```

---

# 38. Active Persistence 硬 Gate

必须新增：

```ini
ACTIVE_HEADING_WITH_ZERO_FRAGMENT_COUNT=0

ACTIVE_HEADING_WITH_ZERO_FILL_COUNT=0

ACTIVE_HEADING_MARKER_BOOLEAN_WITHOUT_FRAGMENT_COUNT=0

ACTIVE_HEADING_VISUAL_LOST_AFTER_LAYOUT_EPOCH_COUNT=0

ACTIVE_HEADING_VISUAL_LOST_AFTER_GEOMETRY_GENERATION_COUNT=0

ACTIVE_HEADING_PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_FILL_COUNT=0

ACTIVE_HEADING_RECONCILE_SKIPPED_COUNT=0

HEADING_ACTIVE_VISUAL_FALSE_PASS_COUNT=0

DRAWER_ACTIVE_ROW_WITHOUT_HEADING_ACTIVE_VISUAL_COUNT=0

HEADING_ACTIVE_VISUAL_WITHOUT_DRAWER_ACTIVE_ROW_COUNT=0
```

---

# 39. 正向 Coverage Gate

必须有真实正向覆盖，不接受全部 0 的“假通过”。

至少：

```ini
ACTIVE_HEADING_INITIAL_ACTIVATE_RUNTIME_COUNT>=1

ACTIVE_HEADING_SWITCH_RUNTIME_COUNT>=1

ACTIVE_HEADING_REBUILT_AFTER_LAYOUT_EPOCH_COUNT>=1

ACTIVE_HEADING_REBUILT_AFTER_GEOMETRY_GENERATION_COUNT>=1

MULTI_TARGET_HEADING_DISTINCT_SUBTARGET_ACTIVATION_COUNT>=2

HEADING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT>=1
```

---

# 40. 新增 Runtime Fixture 或扩展现有 Fixture

优先扩展：

```text
test/vault/runtime/smoke/Phase7-Strict-H1-Boundary-Runtime-Test.md
```

如果现有内容足够，不要重复造 fixture。

但必须确保可稳定覆盖：

```text
STRICT_SINGLE_H1_MULTIPLE_H1
HEADING_LEVEL_GAP
multi-target H1
layout reconcile
```

---

# 41. Runtime Matrix A：多余 H1 1/2

执行：

```text
点击 STRICT_SINGLE_H1_MULTIPLE_H1 target 1/2
```

必须：

```ini
action=ACTIVATE

diagnosticTargetIndex=0

drawerActiveRowCount=1

activeHeadingIdentity=id:H1:idx:4

activeFragmentCount>=1
activeFillCount>=1
```

---

# 42. Runtime Matrix B：多余 H1 2/2

从 #1 Active：

```text
点击同 diagnostic 的 target 2/2
```

应该是：

```text
SWITCH TARGET
```

或者项目当前定义的等价 atomic target switch。

必须：

```ini
diagnosticId unchanged
diagnosticTargetIndex 0 -> 1

activeHeadingIdentity=id:H1:idx:8

drawerActiveRow=2/2

1/2 不再 Active
2/2 唯一 Active
```

---

# 43. Matrix B 必须检查 transaction-local index

允许：

```text
transactionLocalTargetIndex=0
```

但必须证明：

```text
diagnosticTargetIndex=1
```

没有被改成 0。

---

# 44. Runtime Matrix C：Multi-H1 → Level Gap

从：

```text
H1 target 2/2 Active
```

点击：

```text
HEADING_LEVEL_GAP / H3
```

必须：

```ini
action=SWITCH

old active H1 cleared
new active H3 created

drawerActiveRowCount=1

activeHeadingIdentity=id:H3:idx:9

activeFillCount>=1
```

---

# 45. Matrix C 要验证 Cross-Diagnostic Scope

切换后：

```text
STRICT_SINGLE_H1_MULTIPLE_H1 audit
```

必须：

```text
foreign active target ignored
```

不能再把：

```text
H3:idx:9
```

当成它自己的 active target。

---

# 46. Runtime Matrix D：Active H3 后触发 Layout Reconcile

保持：

```text
H3 Active
```

然后触发至少一种真实 layout/geometry 更新：

```text
drawer rerender
caption reconcile
numbering projection
document utility layout
heading geometry generation
```

要求：

```text
layoutEpoch N -> N+1
```

并最终：

```ini
phase=ACTIVE

same diagnosticId
same diagnosticTargetIndex
same targetKey
same interactionVersion

activeFragmentCount>=1
activeFillCount>=1

drawerActiveRowCount=1
```

---

# 47. Matrix D 是本轮最关键验收

必须出现：

```ini
ACTIVE_HEADING_REBUILT_AFTER_LAYOUT_EPOCH_COUNT>=1
```

不能通过“本次没有 layout change”规避。

---

# 48. Runtime Matrix E：Active H1 后触发 Geometry Generation

同样验证：

```text
geometryGeneration M -> M+1
```

Active 必须持续。

---

# 49. Runtime Matrix F：Same Target Deactivate

点击当前 active heading 的同一 row：

```text
ACTIVE(A)
+
click A
→ IDLE
```

要求：

```ini
phase=IDLE

activeFragmentCount=0
activeFillCount=0
activeLeasePresent=false
drawerActiveRowCount=0

passive marker 恢复
```

---

# 50. Deactivate 后不得留下 active suppression

必须：

```ini
IDLE_WITH_PASSIVE_FILL_SUPPRESSED_COUNT=0
```

---

# 51. Runtime Matrix G：快速跨标题切换

至少：

```text
H1 target 1
→ H1 target 2
→ H3 gap
→ H1 target 1
```

每一次只允许：

```text
1 个 Active owner
1 个 Drawer active row
1 个 Active heading target
```

---

# 52. Stale Geometry Callback

快速 switch 后：

```text
旧 heading geometry callback
```

如果版本或 visual generation 过期：

```text
STALE -> DROP
```

不得：

```text
清除当前新 Active
```

---

# 53. 新增 Stale Projection Gate

```ini
STALE_HEADING_VISUAL_CALLBACK_APPLIED_COUNT=0

STALE_HEADING_VISUAL_CALLBACK_CLEARED_NEW_ACTIVE_COUNT=0

STALE_HEADING_GEOMETRY_COMMITTED_COUNT=0
```

---

# 54. Drawer CSS / Visual Active

如果 state 已正确但用户肉眼仍不明显，检查 active row CSS：

```text
active row background
left indicator
severity active token
```

但 CSS 只能在 state authority 修正后处理。

禁止用加深颜色掩盖 state/projection bug。

---

# 55. Drawer Active Row 必须有 Runtime DOM 证据

Audit 至少记录：

```yaml
selectedActiveRowCount:
activeRowKey:
activeRowDiagnosticId:
activeRowDiagnosticTargetIndex:
activeRowComputedClass:
activeRowVisible:
```

---

# 56. Body Active Fill 必须有真实 DOM 证据

记录：

```yaml
activeHeadingFragmentCount:
activeFillCount:

activeFragmentRects:
activeFillVisible:

activeFillHeadingIdentity:
activeFillLayoutEpoch:
```

不能只记录 logical bool。

---

# 57. Reason Chip 不得作为 Active 代理

当前 reason chip 是 passive/semantic decoration。

禁止：

```text
reason chip 存在
=
Active 存在
```

Active 必须由：

```text
active fill/fragments
```

证明。

---

# 58. Passive Semantic Set 保持不变

保持现有正确设计：

```text
active click 不改变 passive semantic target set
```

也就是：

```text
passiveSemanticSetHashBefore
==
passiveSemanticSetHashAfter
```

但 visual projection 可以：

```text
active target passive fill suppressed
```

前提是 active fill 已真实存在。

---

# 59. 不要删除 Passive Marker

Active target：

```text
semantic passive membership
```

仍然存在。

只是 presentation 可：

```text
Active fill 覆盖 passive fill
```

不能把 diagnostic 从 passive authority 中移除。

---

# 60. Heading Active Persistence Feature Gate

新增：

```text
FEATURE_HEADING_DIAGNOSTIC_ACTIVE_PERSISTENCE_V1
```

PASS 条件至少：

```ini
ACTIVE_HEADING_WITH_ZERO_FRAGMENT_COUNT=0
ACTIVE_HEADING_WITH_ZERO_FILL_COUNT=0
ACTIVE_HEADING_MARKER_BOOLEAN_WITHOUT_FRAGMENT_COUNT=0
ACTIVE_HEADING_VISUAL_LOST_AFTER_LAYOUT_EPOCH_COUNT=0
ACTIVE_HEADING_VISUAL_LOST_AFTER_GEOMETRY_GENERATION_COUNT=0
ACTIVE_HEADING_PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_FILL_COUNT=0
ACTIVE_HEADING_RECONCILE_SKIPPED_COUNT=0
HEADING_ACTIVE_VISUAL_FALSE_PASS_COUNT=0

DRAWER_ACTIVE_ROW_WITHOUT_HEADING_ACTIVE_VISUAL_COUNT=0
HEADING_ACTIVE_VISUAL_WITHOUT_DRAWER_ACTIVE_ROW_COUNT=0

DIAGNOSTIC_TARGET_INDEX_TRANSACTION_LOCAL_INDEX_ALIAS_COUNT=0
MULTI_TARGET_HEADING_ACTIVE_TARGETKEY_MISMATCH_COUNT=0
MULTI_TARGET_HEADING_WRONG_SUBTARGET_ACTIVE_COUNT=0
DRAWER_ROW_CANONICAL_TARGET_INDEX_MISMATCH_COUNT=0
HEADING_VISUAL_CANONICAL_TARGET_INDEX_MISMATCH_COUNT=0

CROSS_DIAGNOSTIC_ACTIVE_TARGET_LEAK_COUNT=0
STRICT_MULTI_H1_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT=0
HEADING_LEVEL_GAP_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT=0

STALE_HEADING_VISUAL_CALLBACK_APPLIED_COUNT=0
STALE_HEADING_VISUAL_CALLBACK_CLEARED_NEW_ACTIVE_COUNT=0
STALE_HEADING_GEOMETRY_COMMITTED_COUNT=0

IDLE_WITH_PASSIVE_FILL_SUPPRESSED_COUNT=0
```

---

# 61. Feature Coverage

必须：

```ini
ACTIVE_HEADING_INITIAL_ACTIVATE_RUNTIME_COUNT>=1
ACTIVE_HEADING_SWITCH_RUNTIME_COUNT>=1
ACTIVE_HEADING_REBUILT_AFTER_LAYOUT_EPOCH_COUNT>=1
ACTIVE_HEADING_REBUILT_AFTER_GEOMETRY_GENERATION_COUNT>=1
MULTI_TARGET_HEADING_DISTINCT_SUBTARGET_ACTIVATION_COUNT>=2
HEADING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT>=1
```

---

# 62. 必须修复 Audit False PASS

当前类似：

```text
activeMarkerPresent=true
fillFragmentCount=0
decision=PASS
```

必须彻底消失。

建议增加：

```ini
HEADING_AUDIT_PASS_WITH_ZERO_ACTIVE_FILL_COUNT=0
```

---

# 63. Post-Settle + Post-Reconcile 双门禁

以后不能只：

```text
POST_SETTLE=PASS
```

还必须：

```text
POST_RECONCILE=PASS
```

Feature 最终：

```text
PASS
```

需要同时满足。

---

# 64. Targeted Tests

至少覆盖：

```text
Diagnostic interaction V2 regression
Heading passive/active projection
Heading coverage
Heading marker
Heading visual snapshot
Heading label geometry
Strict multi-H1 multi-target
Heading level gap
Drawer row projection
TargetKey identity
Target index namespace
Visual lease
Atomic switch
Post-layout reconcile
Post-geometry reconcile
Same-target deactivate
Stale visual callback
```

---

# 65. 单元测试必须覆盖 target index namespace

至少：

```text
clicked diagnosticTargetIndex=1

narrowed transactionLocalTargetIndex=0

active state diagnosticTargetIndex remains 1

drawer row remains 2/2

targetKey encoded index remains 1
```

---

# 66. 单元测试必须覆盖跨 diagnostic scope

例如：

```text
active H3 gap
```

时：

```text
strict multi-H1 projection
```

不得读取 H3 为自己的 active target。

---

# 67. 单元测试必须覆盖 geometry rebuild

```text
ACTIVE heading
→ layoutEpoch++
→ rebuild
→ active fragment still exists
```

---

# 68. 静态 Gate

按项目真实脚本执行：

```ini
TARGETED_TESTS=PASS
TYPECHECK=PASS
FULL_TESTS=PASS
BUILD=PASS
```

如果项目有：

```text
lint
contract
runtime structure
identity
```

一并执行。

---

# 69. 部署 Gate

继续遵守：

```text
dist\plugins\fanzhi.inkchapter
→
test\vault\.typora\plugins
```

必须：

```ini
DEPLOY_SHA_GATE=PASS
```

---

# 70. Runtime Identity

如果重启 Typora，必须验证：

```text
Typora process
main window handle
window title
target vault
active fixture
plugin build identity
deployed SHA256
```

禁止：

```text
启动命令成功
=
RUNTIME_IDENTITY PASS
```

---

# 71. Runtime 验收不要只读预期序列

必须严格重建：

```text
actual user click
→ actual dispatch
→ actual reducer transition
→ actual canonical target key
→ actual drawer active row
→ actual heading DOM fragment
→ actual fill
→ actual lease
→ actual post-layout result
```

---

# 72. 每次点击至少输出这些字段

```yaml
clickSequence:

clickedDiagnosticId:
clickedDiagnosticTargetIndex:
clickedStableHeadingIdentity:

canonicalTargetKey:

transactionLocalTargetIndex:

action:
versionBefore:
versionAfter:

phaseAfter:

drawerActiveRowCount:
drawerActiveRowKey:

activeHeadingIdentity:
activeHeadingFragmentCount:
activeFillCount:

activeLeasePresent:
activeLeaseOwnerVersion:
activeLeaseToken:

layoutEpoch:
geometryGeneration:

postSettleDecision:
postReconcileDecision:
```

---

# 73. Multi-H1 1/2 与 2/2 必须并排展示证据

最终报告必须明确列：

```text
1/2:
diagnosticTargetIndex=0
headingIdentity=H1:idx:4
rowKey=...
targetKey=...

2/2:
diagnosticTargetIndex=1
headingIdentity=H1:idx:8
rowKey=...
targetKey=...
```

并证明：

```ini
sameDiagnosticId=true

sameTargetKey=false
sameRowKey=false
sameStableHeadingIdentity=false
```

---

# 74. Global Runtime Scan

最终扫描：

```text
decision=FAIL
FAIL_
UNRESOLVED
MISMATCH
DIVERGENCE
STALE
activeFillCount=0
activeFragmentRects=[]
passiveFillSuppressed=true
```

注意：

```text
只有当前 active heading 的 zero-fill 才是致命
```

不要把合法 passive heading 的：

```text
activeFragmentRects=[]
```

误判成 failure。

---

# 75. Final Decision 规则

只要出现任一：

```ini
ACTIVE_HEADING_WITH_ZERO_FILL_COUNT>0

ACTIVE_HEADING_VISUAL_LOST_AFTER_LAYOUT_EPOCH_COUNT>0

MULTI_TARGET_HEADING_ACTIVE_TARGETKEY_MISMATCH_COUNT>0

CROSS_DIAGNOSTIC_ACTIVE_TARGET_LEAK_COUNT>0

DRAWER_ACTIVE_ROW_WITHOUT_HEADING_ACTIVE_VISUAL_COUNT>0
```

则：

```ini
FINAL_DECISION=FAIL
```

即使：

```ini
TYPECHECK=PASS
BUILD=PASS
```

也不能 FINAL PASS。

---

# 76. 最终报告固定格式

必须：

```ini
TARGETED_TESTS=
TYPECHECK=
FULL_TESTS=
BUILD=

DEPLOY_SHA_GATE=
RUNTIME_IDENTITY=

HEADING_INITIAL_ACTIVATE_MATRIX=
HEADING_MULTI_TARGET_SWITCH_MATRIX=
HEADING_CROSS_DIAGNOSTIC_SWITCH_MATRIX=
HEADING_POST_LAYOUT_RECONCILE_MATRIX=
HEADING_POST_GEOMETRY_RECONCILE_MATRIX=
HEADING_SAME_TARGET_DEACTIVATE_MATRIX=

TARGET_INDEX_AUTHORITY_GATE=
CROSS_DIAGNOSTIC_SCOPE_GATE=
POST_RECONCILE_CLOSURE_GATE=

FEATURE_HEADING_DIAGNOSTIC_ACTIVE_PERSISTENCE_V1=
GLOBAL_RUNTIME_DECISION=

FINAL_DECISION=
```

---

# 77. 最终报告必须给 5 组真实证据

## A. Initial Activate

证明：

```text
点击
→ ACTIVE
→ row active
→ heading fill active
```

## B. Multi-target

证明：

```text
1/2 与 2/2 使用不同 canonical rowKey / targetKey
```

## C. Post-layout persistence

证明：

```text
layoutEpoch 改变后
Active 仍存在
```

## D. Cross-diagnostic switch

证明：

```text
H1 → H3
旧 Active 退出
新 Active 唯一存在
其它 diagnostic audit 不读取 foreign active target
```

## E. Same-target deactivate

证明：

```text
第二次点击
→ IDLE
→ Active visual/lease/row 全清除
→ Passive visual 恢复
```

---

# 78. 本轮禁止项

禁止：

```text
1. 再在 click classifier 上补 severity if。
2. 再修改 Error/Warning 对称性作为主方案。
3. 用 CSS 强制 :active / :focus 假装 row Active。
4. 只加深颜色掩盖 fill 丢失。
5. 用 lastLocatedDiagnosticId 恢复 Active。
6. 用 selectedDiagnosticId 作为 heading Active authority。
7. 用 transactionLocalTargetIndex 覆盖 diagnosticTargetIndex。
8. 在 layoutEpoch 变化时清 Active owner。
9. passive fill 先 suppress，再尝试 active rebuild。
10. activeFill=0 时仍让 audit PASS。
11. 只验证 click settle，不验证 post-reconcile。
12. 用 setInterval / 定时轮询持续修复 visual。
13. 为让 Gate PASS 删除 multi-target Runtime Case。
14. 把 H3 foreign active target 继续送进 strict multi-H1 audit。
15. 发现 Runtime failure 后只给分析，不修改。
```

---

# 79. 一次性完整执行流程

现在直接执行：

```text
读取最新 Runtime log
→ 定位 heading passive/active projection 入口
→ 定位 Drawer row active projection 入口
→ 审计 targetIndex namespace
→ 审计 cross-diagnostic active scope
→ 建立 canonical diagnosticTargetIndex
→ 建立 canonical drawerRowKey / targetKey
→ 建立统一 HeadingVisualSnapshot
→ active state-derived projection
→ passive + active atomic build
→ atomic publish
→ active-ready-before-passive-suppress
→ layout/geometry reproject
→ stale visual generation guard
→ Heading Marker Audit 修正
→ Post-Reconcile Closure
→ Target Index Authority Audit
→ Cross-Diagnostic Scope Audit
→ targeted tests
→ typecheck
→ full tests
→ build
→ deploy
→ SHA gate
→ Runtime identity
→ 完整 Runtime Matrix A-G
→ global runtime scan
→ final evidence report
```

---

# 80. 最终不变量

最终必须稳定成立：

```text
只要：

DiagnosticInteractionState.phase = ACTIVE
AND target is heading
AND diagnostic/target 仍存在

那么：

Drawer 中恰好 1 个 canonical row Active

AND

正文中恰好 1 个对应 heading Active Fill

AND

layoutEpoch / geometryGeneration 的变化
只能重投影，不能让 Active 消失
```

multi-target 还必须满足：

```text
diagnosticTargetIndex
永远是 diagnostic 原始 target index

transactionLocalTargetIndex
永远只在 transaction 内部使用

两者不得混用。
```

跨 diagnostic 还必须满足：

```text
一个 diagnostic 的 visual audit
不得读取另一个 diagnostic 的 active target
作为自己的 active target。
```

只有以上全部闭环后，才允许：

```ini
FEATURE_HEADING_DIAGNOSTIC_ACTIVE_PERSISTENCE_V1=PASS
FINAL_DECISION=PASS
```

**本轮不是只读审计。发现问题后直接完成生产修改和全部可执行 Gate，不要中途停止等待下一轮确认。**

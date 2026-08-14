# TRAE Forensic-Only R60：追查 Canonical Record 重复 Append 与 Single-Dot 错误 Rehydrate 的具体函数/分支

## 0. 项目路径

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

---

# 1. 本轮性质

本轮是：

```text
FORENSIC-ONLY
```

目标不是继续修业务，而是把当前 P0 精确定位到：

```text
具体 recordId
具体创建函数
具体 upsert 决策
具体 append 分支
具体 candidate resolver
具体 matchStrategy
具体 rehydrate APPLY 来源
```

本轮禁止在没有证据前：

```text
重构 business logic
修改 recognizer
修改 caret
修改 Two-Pass
修改 Backspace semantic
修改 One-Shot semantic freshness
修改 persistent schema
```

---

# 2. 当前已知真实故障链

当前真实日志已经证明：

```text
POST-TOKEN-SELECTION
PASS

Verify-First Caret
PASS

Enter:
tokenSuccess=true
paragraphCountSuccess=true
semanticSuccess=true
visualSuccess=true
caretSuccess=true
overallSuccess=true
```

但同时存在：

```text
Backspace 后 recordCount 增加

旧 force-indent record
被 generic rehydrate
错误 APPLY 到新的单 `。` paragraph
```

一个特别值得追踪的旧 record：

```text
indent-1786381670391-1
```

它和：

```text
txn-2-1786381670390
```

时间高度接近。

当前不要直接假定二者一定同源。

本轮必须通过 provenance trace 证明：

```text
谁创建了它
为什么它没被 Backspace update
为什么它后来匹配了 single-dot paragraph
```

---

# 3. PRECONDITION：先确认不是旧 R56 Runtime

在任何 forensic 操作前：

必须执行 R59 runtime gate。

正确 runtime 根路径：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist
```

禁止：

```text
test\vault.typora
```

---

# 4. Source Gate：必须先确认 R58 源码是否真的存在

先搜索当前源码是否已经包含 R58 核心设计/trace：

```text
CANONICAL-RECORD-COMMIT

CANONICAL-RECORD-BACKSPACE

LIVE-BINDING-RESOLUTION

MATCH-LIVE-BINDING

LiveParagraphRecordBinding
```

如果这些 R58 核心代码在源码中不存在：

```text
HARD STOP
```

报告：

```text
R58_SOURCE_NOT_PRESENT
```

不得：

```text
直接在 R56 上做 R60 forensic
```

因为那样只能再次分析旧实现。

---

# 5. Runtime Gate：必须确认刚构建代码真实加载

如果启动/重启 Typora：

严格验证：

```text
1. old Typora process fully exited
2. new PID
3. new StartTime
4. MainWindowHandle != 0
5. MainWindowTitle nonempty
6. target vault REALLY open
7. project dist/main.js SHA256
8. actual runtime main.js SHA256
9. main.js hash match
10. project dist/style.css SHA256
11. actual runtime style.css SHA256
12. style.css hash match
13. current build/forensic marker
14. actual loaded script absolute path
15. initializationCount = 1
```

第 6 项必须由真实 active document/runtime context 证明，例如：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\doc.md
```

第 8 / 11：

```text
必须对真实 `.typora\plugins\dist`
执行 Get-FileHash
```

任一项缺失：

```text
启动命令已发出，但尚未确认成功。
```

并：

```text
HARD STOP
```

不得开始 forensic GUI sequence。

---

# 6. Build / Forensic Identity

业务语义仍属于：

```text
R58 Live Canonical Record Binding
```

本轮 forensic revision：

```text
R60
```

推荐：

```ts
BUSINESS_BUILD_ID =
"inkchapter-live-canonical-record-binding-r58-<id>"

FORENSIC_REVISION =
"canonical-record-provenance-r60-<id>"
```

如果项目只能暴露单一 marker：

```text
inkchapter-r58-canonical-record-forensic-r60-<id>
```

但报告必须明确：

```text
R60 只增加 forensic instrumentation，
不修改 R58 business semantics。
```

---

# 7. HARD FREEZE

以下全部冻结：

```text
exact `。。/..` recognizer

single `。/.`
无 business command

keydown Enter
sole business owner

beforeinput(insertParagraph)
suppress-only

150ms transaction close

Verify-First Caret

POST-TOKEN-SELECTION

Selection Resolver

P-RUNTIME WeakMap identity

paragraph count invariant

FORCE_INDENT immediate semantic

32px immediate visual

Backspace:
FORCE_INDENT → FORCE_FLUSH

One-Shot semantic freshness

Two-Pass:
RESOLVE ALL
→ GROUP
→ DECIDE
→ APPLY

multi-owner BLOCK ALL
```

禁止改变上述逻辑以“让测试通过”。

---

# 8. 本轮只允许新增 forensic instrumentation

允许修改：

```text
logger / forensic helper

record creation/upsert provenance logs

live binding provenance logs

candidate resolution provenance logs

invariant guards

runtime counters
```

禁止：

```text
改变 matcher 返回值

改变 record selection

改变 semantic

改变 DOM projection

改变 caret

改变 sidecar schema
```

---

# 9. 第一追查点：找到 Record 真正的创建/Append 总入口

全项目搜索：

```text
records.push
overrides.push
layout.records.push
paragraphOverrides.push
recordId =
"indent-"
Date.now()
crypto.randomUUID
applyParagraphIndentOverrideToSidecar
```

必须列出：

```text
所有可能创建新 paragraph-layout record 的函数
```

最终建立一个统一 forensic hook：

```text
traceRecordMutation(...)
```

---

# 10. RECORD-CREATE Trace

任何真正的新 record 创建：

必须打印：

```text
RECORD-CREATE
```

字段至少：

```text
recordId

operationReason

callerFunction

txnId

documentKey

runtimeId

paragraphOrdinal

paragraphConnected

paragraphTextRaw

paragraphTextVisible

mode

temporary

anchor

normalizedAnchor

textHash

recordCountBefore

recordCountAfter

timestamp
```

---

# 11. operationReason 必须显式枚举

禁止：

```text
reason=unknown
```

建议至少：

```text
ENTER_COMMIT_CREATE

ENTER_COMMIT_UPSERT

BACKSPACE_UPDATE

BODY_PROMOTION

HANDOFF_BINDING_UPDATE

REHYDRATE_REPAIR

LEGACY_MIGRATION

UI_EXPLICIT_CHANGE

UNKNOWN_BUG
```

如果代码无法判断：

```text
UNKNOWN_BUG
```

并附：

```text
caller stack summary
```

---

# 12. Record Create 不允许只打印 recordId

必须能回答：

```text
这个 record 为什么被创建？
```

以及：

```text
当时系统是否已经有一个应该被 update 的 record？
```

---

# 13. 第二追查点：SIDECAR-UPSERT-DECISION

重点函数：

```text
applyParagraphIndentOverrideToSidecar()
```

或当前真实负责：

```text
find existing record
vs
append new record
```

的函数。

每次调用必须先打印：

```text
SIDECAR-UPSERT-DECISION
```

---

# 14. SIDECAR-UPSERT-DECISION 字段

至少：

```text
operationReason

txnId

incomingRuntimeId

incomingParagraphOrdinal

incomingMode

incomingTemporary

explicitRecordId

recordIdFromElementBinding

recordIdFromLiveBinding

recordIdFromTxn

recordIdFromAnchor

recordIdFromOrdinal

recordIdFromTextHash

allMatchedRecordIds

selectedRecordId

decision:
UPDATE_EXISTING
CREATE_NEW
BLOCK

decisionReason

recordCountBefore
```

---

# 15. CREATE_NEW 必须解释为什么没有更新旧 record

如果：

```text
decision=CREATE_NEW
```

必须输出：

```text
whyExplicitRecordMissing

whyElementBindingMissing

whyLiveBindingMissing

whyTxnBindingMissing

whyAnchorLookupRejected
```

不要只写：

```text
no match
```

---

# 16. Backspace 特别要求

当：

```text
operationReason=BACKSPACE_UPDATE
```

正常预期：

```text
selectedRecordId != null

decision=UPDATE_EXISTING
```

若：

```text
decision=CREATE_NEW
```

立即输出：

```text
BACKSPACE-DUPLICATE-RECORD-BUG
```

---

# 17. BACKSPACE-RECORD-COUNT-INVARIANT

在第一次 Backspace semantic mutation 前：

```text
recordCountBefore
```

完成后：

```text
recordCountAfter
```

必须：

```text
recordCountAfter === recordCountBefore
```

否则：

```text
BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION
```

字段：

```text
runtimeId

recordIdBefore

recordIdAfter

recordCountBefore

recordCountAfter

newRecordIds

allRecordIdsBefore

allRecordIdsAfter
```

然后：

```text
HARD STOP
```

本轮不继续 single-dot 阶段，

因为第一处根因已经抓到。

---

# 18. 第三追查点：RECORD-LIFECYCLE

每个 record 必须能按 recordId 搜到完整生命周期。

新增统一：

```text
RECORD-LIFECYCLE
```

---

# 19. RECORD-LIFECYCLE event

至少：

```text
CREATE

UPSERT

BIND_ELEMENT

HANDOFF_REPLACE

BACKSPACE_UPDATE

BODY_PROMOTION

REHYDRATE_CANDIDATE

REHYDRATE_APPLY

REHYDRATE_BLOCK

UNBIND

REMOVE
```

---

# 20. RECORD-LIFECYCLE 字段

```text
recordId

event

txnId

runtimeId

previousRuntimeId

generation

mode

temporary

recordCount

candidateTargetRuntimeId

candidateTargetOrdinal

candidateTargetText

matchStrategy

candidateSource

timestamp
```

---

# 21. 特别追踪目标 record

如果运行中再次出现：

```text
indent-1786381670391-1
```

或者新的等价旧 record：

必须能通过：

```text
RECORD-LIFECYCLE recordId=<id>
```

完整回放：

```text
CREATE
→ BIND
→ HANDOFF
→ BACKSPACE?
→ REHYDRATE_CANDIDATE
→ APPLY to `。`
```

---

# 22. 第四追查点：REHYDRATE-CANDIDATE Provenance

当前日志只有：

```text
candidateCount=1
decision=APPLY
```

不够。

必须在 candidate 生成时逐条打印：

```text
REHYDRATE-CANDIDATE
```

---

# 23. REHYDRATE-CANDIDATE 字段

```text
recordId

recordMode

recordTemporary

recordHasLiveBinding

recordBoundRuntimeId

recordBoundConnected

candidateSource:
LIVE
PERSISTENT
LEGACY

targetRuntimeId

targetOrdinal

targetTextRaw

targetTextVisible

matchStrategy

confidence

exactAnchorEqual

normalizedAnchorEqual

promotedAnchorEqual

textHashEqual

ordinalEqual

proximityDistance

legacyMatch

candidateAccepted
candidateRejected

acceptRejectReason
```

---

# 24. matchStrategy 必须是明确枚举

至少：

```text
MATCH-LIVE-BINDING

MATCH-RECORD-ID

MATCH-EXACT-ANCHOR

MATCH-NORMALIZED-ANCHOR

MATCH-PROMOTED-ANCHOR

MATCH-INDEX-FALLBACK

MATCH-PROXIMITY

MATCH-LEGACY

MATCH-NONE
```

禁止：

```text
matchStrategy=unknown
```

---

# 25. Single Dot 错误 APPLY 的 Hard Forensic Trap

如果 candidate target：

```text
targetTextVisible == "。"
```

且 record：

```text
recordMode == force-indent
```

必须立刻输出：

```text
SINGLE-DOT-REHYDRATE-CANDIDATE-TRAP
```

字段完整包含：

```text
recordId
recordTemporary
recordHasLiveBinding
boundRuntimeId
targetRuntimeId
matchStrategy
candidateSource
all anchor/hash/ordinal/proximity evidence
```

---

# 26. 如果 Single Dot 最终被 APPLY

立即输出：

```text
SINGLE-DOT-WRONG-APPLY
```

字段：

```text
recordId
winnerRecordId

targetRuntimeId
targetText="。"

matchStrategy

candidateSource

semanticBefore
indentBefore

semanticAfter
indentAfter
```

然后：

```text
HARD STOP
```

禁止继续 GUI。

---

# 27. 第五追查点：Live Record 是否非法进入 Heuristic

如果 R58 已实现 live binding：

任何：

```text
temporary=true
AND
active live binding exists
```

的 record，

理论上不能再进入 generic heuristic。

---

# 28. BUG-LIVE-RECORD-ENTERED-HEURISTIC

只要出现：

```text
recordHasLiveBinding=true
```

同时：

```text
matchStrategy != MATCH-LIVE-BINDING
```

并且它正在扫描其它 paragraph，

打印：

```text
BUG-LIVE-RECORD-ENTERED-HEURISTIC
```

字段：

```text
recordId

boundRuntimeId

boundConnected

targetRuntimeId

targetText

matchStrategy

resolverFunction

resolverStage
```

然后：

```text
HARD STOP
```

---

# 29. Live Binding Collision

如果两个 record：

```text
R1
R2
```

同时绑定同一个 HTMLElement/runtimeId：

打印：

```text
LIVE-BINDING-COLLISION
```

不要自动修。

只记录并：

```text
HARD STOP
```

---

# 30. 第六追查点：Rehydrate 是否修改 Canonical State

当前真实调用栈已经显示：

```text
applyParagraphRehydratePlan
→ scheduleSidecarWrite
```

本轮必须精确查清：

```text
normal rehydrate 为什么触发 write
```

---

# 31. REHYDRATE-WRITE-AUDIT

每次：

```text
applyParagraphRehydratePlan
```

前后记录：

```text
recordCountBefore

recordCountAfter

recordSnapshotHashBefore

recordSnapshotHashAfter

scheduleSidecarWriteCalled

writeReason

migrationReason
```

---

# 32. REHYDRATE-CANONICAL-MUTATION-INVARIANT

Normal rehydrate：

```text
source=rehydrate
```

且不是：

```text
legacy migration
anchor repair
dedupe
schema migration
```

必须：

```text
recordCountAfter == recordCountBefore

recordSnapshotHashAfter == recordSnapshotHashBefore
```

否则：

```text
REHYDRATE-CANONICAL-MUTATION-VIOLATION
```

---

# 33. scheduleSidecarWrite 也必须带 reason

不要：

```text
scheduleSidecarWrite()
```

无来源。

改 forensic signature：

```text
scheduleSidecarWrite(reason)
```

至少记录：

```text
ENTER_CANONICAL_COMMIT

BACKSPACE_CANONICAL_UPDATE

BODY_PROMOTION

LEGACY_MIGRATION

ANCHOR_REPAIR

REHYDRATE_NORMAL_UNEXPECTED

UNKNOWN
```

注意：

```text
本轮仅用于追踪 provenance
```

不要因此改变业务行为。

---

# 34. 如果 Normal Rehydrate 调 write

打印：

```text
NORMAL-REHYDRATE-WRITE-SIDE-EFFECT
```

字段：

```text
planId

winnerRecordIds

writeReason

recordCountBefore
recordCountAfter

snapshotChanged
```

---

# 35. 第七追查点：OBS-SELECTION 只做确认，不修

当前：

```text
POST-TOKEN-SELECTION
```

已经可靠。

但：

```text
OBS-SELECTION
selParagraph=undefined
```

仍旧存在。

本轮不要再修。

只新增：

```text
OBS-SELECTION-CROSSCHECK
```

同时调用：

```text
shared resolveSelectionParagraph()
```

和旧 observation path。

---

# 36. OBS-SELECTION-CROSSCHECK

字段：

```text
time

sharedResolverRuntimeId

sharedResolverOrdinal

sharedResolverLocalOffset

legacySelParagraph

legacySameAsCommand

continuityCurrentRuntimeId

objectEqualityResult
```

如果：

```text
shared resolver 有 runtimeId
legacy undefined
```

输出：

```text
OBS-SELECTION-LEGACY-PATH-CONFIRMED-BROKEN
```

仅确认，

本轮不修改。

---

# 37. Clean Baseline 必须是真的 Clean

开始 GUI forensic 前：

```text
restart Typora
open target doc
```

必须记录：

```text
CANONICAL-BASELINE
```

字段：

```text
documentKey

physicalSidecarEnabled

physicalRecordCount

memoryRecordCount

recordIds
```

---

# 38. Clean Baseline 目标

理想：

```text
memoryRecordCount=0
```

如果不是：

不要直接测试。

先报告：

```text
BASELINE_NOT_CLEAN
```

列出所有：

```text
recordId
mode
temporary
anchor
```

然后：

```text
HARD STOP
```

禁止自动删除用户数据。

---

# 39. Physical Sidecar Context

当前可能仍：

```text
vaultRoot=unknown
physical write blocked
```

本轮允许：

```text
physicalSidecarEnabled=false
```

但必须清晰区分：

```text
physicalRecordCount
memoryRecordCount
```

不要再把：

```text
disk disabled
```

误称：

```text
canonical record count=0
```

---

# 40. 最小 Forensic GUI Sequence

只允许：

```text
F1
一次 `。。+Enter`

F2
同一 paragraph logical start
一次 Backspace

F3
新 paragraph
只输入单 `。`
```

禁止任何额外：

```text
重复 Enter
重复 Backspace
3/3
5/5
30/30
```

---

# 41. F1：一次 Enter

前：

```text
memoryRecordCount=N
```

执行：

```text
。。
Enter
```

立即停止输入。

必须收集：

```text
RECORD-CREATE

SIDECAR-UPSERT-DECISION

RECORD-LIFECYCLE CREATE

CANONICAL-RECORD-COMMIT

LIVE-BINDING-RESOLUTION

POST-TOKEN-SELECTION
```

---

# 42. F1 预期

正常：

```text
recordCount
N → N+1

exactly one new record R

operationReason=ENTER_COMMIT_CREATE

R bound to current runtime paragraph
```

如果：

```text
+0
+2
```

立即：

```text
HARD STOP
```

---

# 43. F2：一次 Backspace

只有 F1 完整通过后：

当前同一 paragraph logical start：

```text
Backspace
```

立即停止输入。

收集：

```text
SIDECAR-UPSERT-DECISION

BACKSPACE-RECORD-COUNT-INVARIANT

CANONICAL-RECORD-BACKSPACE

RECORD-LIFECYCLE BACKSPACE_UPDATE
```

---

# 44. F2 关键问题

只回答：

```text
Backspace 为什么没有更新 F1 的 R？
```

正常必须：

```text
selectedRecordId=R

decision=UPDATE_EXISTING

recordCount unchanged
```

如果：

```text
CREATE_NEW
```

必须打印具体：

```text
哪个 lookup 丢失
```

并立即停止。

---

# 45. F3：单 `。`

只有 F2：

```text
same record update
recordCount unchanged
```

通过，

才进入 F3。

创建新的普通空 paragraph。

只输入：

```text
。
```

不按 Enter。

---

# 46. F3 收集

只看：

```text
SINGLE-DOT-TRACE

REHYDRATE-CANDIDATE

SINGLE-DOT-REHYDRATE-CANDIDATE-TRAP

BUG-LIVE-RECORD-ENTERED-HEURISTIC

SINGLE-DOT-WRONG-APPLY

RECORD-LIFECYCLE REHYDRATE_CANDIDATE/APPLY
```

---

# 47. F3 最终要回答的问题

不是：

```text
single dot 为什么触发 recognizer？
```

因为 recognizer 已冻结且当前证据显示它没有触发业务命令。

真正要回答：

```text
哪个 recordId
通过哪个 matchStrategy
在哪个 candidate resolver
用什么证据
把新的 `。` paragraph
认成旧 force-indent record 的 owner？
```

---

# 48. Hard Stop 优先级

以下任一出现：

```text
R58_SOURCE_NOT_PRESENT

BUILD_ID_MISMATCH

BASELINE_NOT_CLEAN

BACKSPACE-DUPLICATE-RECORD-BUG

BACKSPACE-RECORD-COUNT-INVARIANT-VIOLATION

BUG-LIVE-RECORD-ENTERED-HEURISTIC

LIVE-BINDING-COLLISION

REHYDRATE-CANONICAL-MUTATION-VIOLATION

SINGLE-DOT-WRONG-APPLY
```

立即：

```text
STOP
```

不要继续后续步骤。

---

# 49. 禁止“看到问题顺手修”

这是 forensic-only。

如果找到：

```text
具体 if/else
具体 lookup
具体 matcher
具体 append
```

本轮：

```text
只报告
```

不要马上修。

因为需要保留：

```text
第一现场
```

下一轮再根据证据生成最小修复。

---

# 50. Source-Level Attribution

最终报告必须给出：

```text
file path

function name

decision branch

approximately line / symbol

input state

decision

wrong output
```

例如：

```text
heading-numbering-service.ts

applyParagraphIndentOverrideToSidecar()

BACKSPACE_UPDATE

liveBinding lookup returned null

falls through to CREATE_NEW

recordCount 1 → 2
```

或者：

```text
resolveParagraphAnchorCandidates()

record R

target text="。"

matchStrategy=MATCH-INDEX-FALLBACK

candidateAccepted=true

→ Two-Pass sees unique candidate
→ APPLY
```

---

# 51. 禁止停留在“可能是”

最终必须尽可能分类：

```text
ROOT-1
record binding lost after replacement

ROOT-2
Backspace lookup ignores stable recordId

ROOT-3
temporary live record incorrectly enters persistent heuristic

ROOT-4
ordinal fallback accepts single-dot

ROOT-5
normalized anchor incorrectly accepts single-dot

ROOT-6
rehydrate write side effect mutates canonical state

ROOT-7
other exact branch
```

如果仍无法证明：

```text
UNRESOLVED
```

并指出：

```text
还缺哪个字段
```

---

# 52. Typecheck / Unit / Build

因为本轮会加 instrumentation：

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

但：

```text
unit tests PASS
不能替代 runtime forensic
```

---

# 53. Deployment

只允许：

```text
scripts\deploy-test-vault.ps1
```

如果该脚本还没落地：

先按 R59 要求建立。

禁止任何手写：

```text
Copy-Item ...\test\vault.typora...
```

---

# 54. Correct Paths

```text
PROJECT MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

PROJECT CSS:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\style.css

RUNTIME MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

RUNTIME CSS:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\style.css

RUNTIME LOAD:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter-runtime-load.json

TARGET VAULT:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

---

# 55. SyntaxError

继续记录：

```text
SyntaxError: Unexpected token ')'
```

若仍无 source attribution：

```text
UNRESOLVED
```

不得在本轮修改 paragraph logic。

---

# 56. Git

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

---

# 57. 本轮成功标准

本轮不是“功能修好”。

成功标准是：

```text
R58 source confirmed

correct runtime loaded

baseline clean

F1 exactly one record provenance captured

F2 Backspace upsert decision captured

F2 duplicate append exact branch identified
或证明 same-record update 正常

F3 single-dot candidate provenance captured

具体 recordId 已知

具体 matchStrategy 已知

具体 resolverFunction 已知

具体 accept reason 已知

Rehydrate canonical mutation side effect
已证明/排除

OBS legacy path
已证明/排除

最终 root cause
可以定位到具体函数与 branch
```

---

# 58. 最终报告格式

```text
# 1. Git Baseline

# 2. R58 Source Gate

# 3. Business Build ID

# 4. Forensic Revision

# 5. Correct Deployment Proof

# 6. Strict 15-item Runtime Verification

# 7. Actual Active Document

# 8. CANONICAL-BASELINE

# 9. Record Creation Entry Points Inventory

# 10. F1 Enter

# 11. RECORD-CREATE

# 12. SIDECAR-UPSERT-DECISION Enter

# 13. F1 RecordId

# 14. F1 Runtime Binding

# 15. F1 Record Count Invariant

# 16. F2 Backspace

# 17. SIDECAR-UPSERT-DECISION Backspace

# 18. BACKSPACE-RECORD-COUNT-INVARIANT

# 19. Was Backspace UPDATE or CREATE_NEW?

# 20. Exact Branch Causing Duplicate Append

# 21. RECORD-LIFECYCLE Timeline

# 22. F3 Single Dot

# 23. SINGLE-DOT-TRACE

# 24. REHYDRATE-CANDIDATE Provenance

# 25. Winning RecordId

# 26. Winning matchStrategy

# 27. Winning candidateSource

# 28. Resolver Function

# 29. Exact Evidence That Accepted Single Dot

# 30. BUG-LIVE-RECORD-ENTERED-HEURISTIC

# 31. LIVE-BINDING-COLLISION

# 32. REHYDRATE-WRITE-AUDIT

# 33. REHYDRATE-CANONICAL-MUTATION-INVARIANT

# 34. OBS-SELECTION-CROSSCHECK

# 35. Source File + Function + Branch Attribution

# 36. Root Cause Classification
ROOT-1 / ROOT-2 / ROOT-3 / ROOT-4 / ROOT-5 / ROOT-6 / ROOT-7 / UNRESOLVED

# 37. Exact Minimal Fix Recommended
REPORT ONLY — DO NOT IMPLEMENT

# 38. Typecheck

# 39. Unit Tests

# 40. Build

# 41. Startup Final Verdict

# 42. Git Final Status
```

---

# 59. 最终原则

```text
第一：
不要再从 GUI 最终现象猜根因。

第二：
追一个 recordId 的完整生命周期。

第三：
Backspace 必须解释：
为什么 UPDATE 变成 CREATE。

第四：
Single dot 必须解释：
哪个 matcher 把它接受成 candidate。

第五：
Live record 若进入 generic heuristic，
必须在进入点就抓住。

第六：
Normal rehydrate 若修改 canonical，
必须直接抓住副作用。

第七：
本轮只定位，不修复。
拿到具体 file/function/branch 后，
下一轮再做最小修复。
```

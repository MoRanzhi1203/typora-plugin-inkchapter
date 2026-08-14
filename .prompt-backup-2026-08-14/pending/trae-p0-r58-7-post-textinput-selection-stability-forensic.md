# Trae P0 — R58.7 Post-TEXT_INPUT Selection Stability Forensic Gate

## 0. 任务定位

本轮**不是继续修改 caret 业务逻辑**，而是为 `R58.7 CARET OWNERSHIP FULL CLOSURE` 补齐 runtime 证据。

最新 runtime 已证明以下子问题已经通过：

- `TEXT_INPUT` trusted intent coverage：PASS
- `insertCompositionText` coverage：PASS
- composition dedupe：PASS
- `SPLIT_NEW_PARAGRAPH` expectation 被新 `TEXT_INPUT` supersede：PASS
- `CARET-CONTINUITY-RESTORE`：0
- 旧的 `actualOffset=1 → restore offset=0` stale CaretExpectation 路径：已消失
- Canonical Transfer visual / semantic / identity / awaiting cleanup：PASS，继续冻结

但当前不能把整个 `R58.7 CARET OWNERSHIP` 判 PASS，因为 runtime 仍出现：

```text
TEXT_INPUT
→ SELECTION-TRUTH logicalOffset=1
→ 后续 mutation / rehydrate 附近
→ same runtimeId logicalOffset=0
```

且中间没有：

```text
CARET-CONTINUITY-RESTORE
CARET-REPAIR
```

因此当前只允许追查：

```text
Post-TEXT_INPUT Selection Stability
+
IME/composition transient
+
Rehydrate/DOM projection correlation
```

必须先区分：

```text
A. 用户可见的持久 caret reset
B. IME/Typora composition 的瞬时 selection checkpoint
C. rehydrate / projection 引发的 selection reset
```

在没有 runtime 因果证据前，禁止再次修改 caret writer、restore timing、timeout 或 canonical transfer。

---

# 1. 冻结范围

以下模块/行为全部冻结，除非新的 runtime 明确证明其自身错误：

```text
Canonical Transfer
Canonical source snapshot
Canonical visual verifier
Canonical semantic projection
Canonical identity transfer
Awaiting cleanup

Enter Admission
Process/Period → REJECT_NON_ENTER
NormalEnter transaction admission
NormalEnter structural resolver
canonicalOwner / caretDestination split
SelectionTruth parser
Caret Handover
CaretExpectation supersession
TEXT_INPUT UserIntentEpoch
Composition dedupe
Historical resolver
Save-As
Merge
```

严禁：

```text
修改 restoreLogicalCaret / CARET-REPAIR 实现
删除 delayed verification
缩短/延长 timeout 掩盖问题
增加 setSelection/setTimeout 猜测式补丁
previous-paragraph fallback
generic historical/ordinal/text heuristic
手动 DOM split
强行写 offset=1
在没有因果证据前禁用 rehydrate
```

---

# 2. 当前正式判断

当前状态必须保持：

```text
R58.7 Canonical Atomic Projection
= PASS in current runtime / FREEZE

Trusted TEXT_INPUT coverage
= PASS

Composition dedupe
= PASS

CaretExpectation supersession
= PASS

Old delayed CARET-REPAIR path
= FIXED

Post-TEXT_INPUT Selection Stability
= NOT PROVEN

Rehydrate correlation
= PRESENT
but causality = NOT PROVEN

R58.7 CARET OWNERSHIP FULL CLOSURE
= NOT ACCEPTED

R60 BLOCKED
```

禁止因为：

```text
CARET-CONTINUITY-RESTORE=0
NORMAL-ENTER-FINAL overall=false=0
SELECTION-CONTINUITY-VERIFY offsetMatches=false=0
```

就直接宣布 full caret PASS。

这些指标只证明旧 stale expectation restore 路径消失，不能证明输入字符后的最终 caret 长期稳定。

---

# 3. 新增纯诊断：POST-TEXT-INPUT-STABILITY

对每一个**非 deduplicated、trusted 的 TEXT_INPUT intent**创建只读 observation。

只允许读 Selection / DOM / runtime state。

**禁止在 observation 中写 Selection、写 DOM、修复 caret。**

建议结构：

```ts
interface PostTextInputStabilityObservation {
  observationId: string
  inputIntentId: string
  intentEpoch: number
  inputType: string
  scopeId: string

  initialRuntimeId: string | null
  initialVisibleText: string
  initialLogicalOffset: number | null

  createdAt: number
}
```

必须采样：

```text
T0_SYNC
T_MICROTASK
T_RAF
T_16MS
T_50MS
T_150MS
T_300MS
T_500MS
T_1000MS
T_2200MS
```

每个采样点输出：

```text
POST-TEXT-INPUT-STABILITY:
observationId=
inputIntentId=
intentEpoch=
source=
sample=

runtimeId=
visibleText=
logicalOffset=
insideEditor=
collapsed=
anchorConnected=
focusConnected=

isCompositionActive=
activeCaretExpectationId=
activeCaretExpectationEpoch=

pluginSelectionWriteCountSinceInput=
caretContinuityRestoreCountSinceInput=
caretRepairCountSinceInput=

rehydratePlanCountSinceInput=
rehydrateApplyCountSinceInput=
rehydrateDomWriteCountSinceInput=

overallReadSuccess=
```

重要：

```text
POST-TEXT-INPUT-STABILITY
只能观察，不得修复。
```

---

# 4. 增加 Selection Write Authority Counter

当前必须能证明：

```text
offset 1 → 0
```

是否发生了插件 selection write。

新增统一计数器，所有插件主动 Selection 写入必须经过同一个 audit：

```text
PLUGIN-SELECTION-WRITE-AUDIT:
writeId=
caller=
reason=
runtimeId=
logicalOffsetBefore=
logicalOffsetRequested=
logicalOffsetAfter=
intentEpoch=
success=
```

所有可能写 caret 的路径必须进入此 audit。

至少覆盖：

```text
POST-TOKEN-SELECTION
CARET-REPAIR
CARET-CONTINUITY-RESTORE
任何 Selection/Range setStart/setEnd/collapse/addRange 路径
```

在 `TEXT_INPUT` observation 创建时保存：

```text
selectionWriteCounterAtInput
```

后续每个稳定性采样输出：

```text
pluginSelectionWriteCountSinceInput
```

若 offset 1→0 且：

```text
pluginSelectionWriteCountSinceInput=0
```

则不能再归因于现有 CaretExpectation writer。

---

# 5. 增加 REHYDRATE-SELECTION-AUDIT

当前 runtime 中 `offset 1 → 0` 与 rehydrate 高度相关，但禁止直接把相关性当因果。

对每次 rehydrate plan 执行增加只读前后采样：

```text
REHYDRATE-SELECTION-AUDIT:
planId=
source=
scopeId=

selectionBeforeRuntimeId=
selectionBeforeOffset=
selectionBeforeVisibleText=

winnerCount=
blockedCount=

rehydrateApplyCount=
actualDomWriteCount=
semanticChangedCount=
classChangedCount=
inlineStyleChangedCount=
decorationWriteCount=

selectionAfterSyncRuntimeId=
selectionAfterSyncOffset=

selectionAfterMicrotaskRuntimeId=
selectionAfterMicrotaskOffset=

selectionAfterRAFRuntimeId=
selectionAfterRAFOffset=

selectionWriteAttemptedByRehydrate=
```

重点区分：

```text
REHYDRATE-APPLY log emitted
≠
actual DOM mutation happened
```

必须实际统计：

```text
actualDomWriteCount
```

若：

```text
semanticBefore === semanticAfter
class already correct
style already correct
```

则应允许：

```text
actualDomWriteCount=0
```

本轮不要为了得到这个结果而修改业务逻辑；先真实审计。

---

# 6. IME / Composition 时序审计

对中文输入必须补齐：

```text
compositionstart
beforeinput insertCompositionText
input
compositionupdate
compositionend
```

至少输出：

```text
IME-SELECTION-AUDIT:
compositionSessionId=
eventType=
inputType=
isComposing=
runtimeId=
visibleText=
logicalOffset=
intentEpoch=
timestamp=
```

目标是判断：

```text
offset 1 → 0 → 1
```

是否只是 composition 中间态。

不要把每一个 `insertCompositionText` 当成全新 ownership transaction。

当前已有 dedupe 继续冻结。

---

# 7. 真正的 A/B Fixture

当前：

```text
r58-canonical-transfer-acceptance.md
```

已存在 historical sidecar，不能再称 clean fixture。

必须创建新的唯一文件，例如：

```text
r58-caret-textinput-clean-<timestamp>.md
```

测试开始前必须证明：

```text
activeFilePath=<new file>
sidecar absolutePath=<new sidecar path>
exists=false
recordCount=0
registryRecordCount=0
```

不能只“新建 md”但复用旧 sidecar。

A/B：

## A — Clean

```text
新 md
sidecar 不存在
recordCount=0
```

## B — Historical noise

```text
当前 r58-canonical-transfer-acceptance.md
已有 historical sidecar
```

两边使用相同操作。

---

# 8. Runtime 操作矩阵

每组至少 10 次。

## Case A1 — Clean / Special + Split + Immediate Text

```text
。。
Enter
Enter
立即输入 。
等待 >2.2s
```

每轮人工目标：

```text
最终 text="。"
最终 caret=。|
```

必须覆盖所有 stability sample。

## Case A2 — Clean / Normal Enter + Immediate Text

无 canonical record：

```text
普通正文
Enter
立即输入 。
等待 >2.2s
```

用于判断是否与 canonical/rehydrate 无关。

## Case A3 — Clean / Special + Split / No Text

```text
。。
Enter
Enter
不输入
等待 >2.2s
```

确认真实 delayed drift repair 能力没有被误伤。

## Case B1 — Historical sidecar

在旧 fixture 重复 A1 至少 10 次。

---

# 9. 判定矩阵

## 情况 1：IME 瞬态

若：

```text
T0=1
T16=0
T50=1
T150=1
...
T2200=1

pluginSelectionWriteCountSinceInput=0
```

且 0 出现在 composition 中间阶段：

```text
结论：
IME / Typora transient selection checkpoint
不是用户可见持久 caret reset
```

不要修。

## 情况 2：真实持久 caret reset

若：

```text
T0=1
T50=0
T150=0
T300=0
...
```

则：

```text
Post-TEXT_INPUT Selection Stability = FAIL
```

继续追因。

## 情况 3：Rehydrate 强因果

若每次：

```text
before rehydrate offset=1
actualDomWriteCount>0
after sync/microtask/RAF offset=0
pluginSelectionWriteCountSinceInput=0
```

且 clean/non-rehydrate 对照不出现，则：

```text
rehydrate projection = strong causal candidate
```

之后再开独立修复轮。

## 情况 4：Rehydrate 只是相关

若：

```text
actualDomWriteCount=0
selection 仍 1→0→1
```

则不能归因于 rehydrate。

优先归入 IME / browser / Typora lifecycle。

---

# 10. 关键 acceptance

只有满足下列条件才能宣布：

```text
R58.7 CARET OWNERSHIP FULL CLOSURE = PASS
```

至少要求：

```text
Clean Case A1 >=10/10：

TEXT_INPUT captured=true
expectationSuperseded=true

CARET-CONTINUITY-RESTORE after typing=0
CARET-REPAIR after typing=0
pluginSelectionWriteCountSinceInput=0

T50 logicalOffset=1
T150 logicalOffset=1
T300 logicalOffset=1
T500 logicalOffset=1
T1000 logicalOffset=1
T2200 logicalOffset=1

visibleText="。"
insideEditor=true
selectionLoss=0
```

T16/MICROTASK/RAF 允许记录 transient，但若 transient 存在必须被明确归因并证明 T50 后恢复稳定。

若任何一次：

```text
T50 或更晚持续 logicalOffset=0
```

则：

```text
R58.7 CARET OWNERSHIP NOT FIXED — R60 BLOCKED
```

---

# 11. Canonical Transfer Regression Gate

本轮虽然不修改 canonical，但必须确认没有退化：

```text
CANONICAL-TRANSFER-PROJECTION-FAIL=0
CANONICAL-TRANSFER-FINAL-AUDIT overall=false=0
AWAITING_TRANSFER stable nonzero=0
```

Case A1 中 canonical split 必须保持：

```text
SOURCE-SNAPSHOT state=CURRENT_LIVE
CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
TRANSFER
FINAL-AUDIT overall=true
```

---

# 12. Enter Admission Regression Gate

必须：

```text
Process / Period
→ ENTER-ADMISSION-AUDIT decision=REJECT_NON_ENTER
```

且：

```text
normalEnterTxnCreatedFromNonEnterCount=0
```

注意：

```text
nonEnterRejectedCount 可以 >0
```

不要再混淆两个计数器。

---

# 13. Build / Artifact / Startup Gate

如果只增加 diagnostics/tests，也必须新 Build ID。

建议：

```text
inkchapter-r58-7-post-textinput-stability-forensic-<unique>
```

顺序必须：

```text
完成全部 source 修改
→ 写最终 Build ID
→ tsc --noEmit
→ 专项 tests
→ full tests
→ build
→ deploy
→ SHA parity
→ restart
→ strict startup verification
→ runtime
```

禁止测试后再修改任何 TS 文件却沿用旧测试结果。

唯一 runtime plugin 路径：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js
```

禁止使用：

```text
test\vault.typora
```

必须实际输出：

```text
old Typora process exited
new PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

target vault
target test document

runtime plugin main path
project main SHA256
deployed main SHA256
shaMatch=true

style.css SHA256

Build ID
runtime Build ID
initializationCount=1
```

缺任一项必须原样写：

**启动命令已发出，但尚未确认成功**

---

# 14. 已知独立噪声

启动前仍可能存在：

```text
SyntaxError: Unexpected token ')'
```

当前没有证据证明它与 post-TEXT_INPUT caret stability 有因果关系。

本轮只记录，不顺手修。

---

# 15. 最终报告模板

必须按以下格式，不得仅给总结性 PASS：

```text
Build ID:
Project SHA:
Runtime SHA:
shaMatch:
style SHA:

Strict startup:
oldProcessExited:
PID:
StartTime:
MainWindowHandle:
MainWindowTitle:
targetVault:
targetDocument:
runtimeBuildId:
initializationCount:

Fixture A:
sidecarExistsBefore:
recordCountBefore:

Case A1 count:
Case A1 T50 offset=1:
Case A1 T150 offset=1:
Case A1 T300 offset=1:
Case A1 T500 offset=1:
Case A1 T1000 offset=1:
Case A1 T2200 offset=1:

Transient 1→0→1 count:
Persistent 1→0 count:

pluginSelectionWriteAfterInput:
CARET-CONTINUITY-RESTORE after input:
CARET-REPAIR after input:

REHYDRATE correlation count:
REHYDRATE actualDomWriteCount:
Selection reset immediately after actual DOM write:

IME composition transient correlation:

Case B1 result:

Canonical projection fail:
Canonical final audit fail:
Awaiting leak:
Selection loss:
NonEnter-created NENTER:

Verdict:
```

最终仅允许二选一：

```text
R58.7 CARET OWNERSHIP FULL CLOSURE PASS — R60 may proceed
```

或：

```text
R58.7 CARET OWNERSHIP NOT FIXED — R60 BLOCKED
```

如果只证明旧 stale restore 已修，但 post-TEXT_INPUT stability 尚未覆盖：

```text
R58.7 STALE CARET EXPECTATION FIXED;
POST-TEXT_INPUT STABILITY NOT PROVEN;
R60 BLOCKED
```

---

# 16. 禁止 Git 写操作

本轮禁止：

```text
git add
git commit
git push
```

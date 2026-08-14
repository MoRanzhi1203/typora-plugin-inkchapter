# Trae P0 — R58.7 Forensic Hardening Final Self-Check + Runtime R0 Gate

## 0. 本轮任务定位

本轮不继续修改 caret / canonical 业务逻辑。

当前目标：

```text
Forensic Hardening Final Self-Check
→ Final Artifact Provenance
→ Strict Startup
→ Runtime R0 Smoke
```

只有 R0 smoke 通过后，才允许继续 A1/A2/A3/B1 正式 runtime matrix。

当前正式状态：

```text
R58.7 STALE CARET EXPECTATION FIXED
TEXT_INPUT UserIntent = PASS
Composition dedupe = PASS
CaretExpectation supersession = PASS
Canonical Transfer = PASS / FREEZE

POST-TEXT_INPUT STABILITY = NOT PROVEN
R58.7 CARET OWNERSHIP FULL CLOSURE = NOT ACCEPTED
R60 BLOCKED
```

严禁因为：

```text
CARET-CONTINUITY-RESTORE=0
NORMAL-ENTER-FINAL overall=true
SELECTION-CONTINUITY-VERIFY offsetMatches=false=0
```

就宣布 full caret PASS。

---

# 1. 冻结范围

以下全部冻结：

```text
CaretExpectation supersession
TEXT_INPUT UserIntentEpoch
Composition dedupe
Caret writer
CARET-REPAIR
restoreLogicalCaret

Enter Admission
Process/Period → REJECT_NON_ENTER
NormalEnter transaction admission
Caret Handover
SelectionTruth
StructuralResolution

Canonical Transfer
Canonical visual verifier
Canonical semantic projection
Canonical identity transfer
Awaiting cleanup

Historical resolver
Save-As
Merge
```

禁止：

```text
继续加新的业务修复
增加 setSelection/setTimeout 猜测补丁
缩短/延长 timeout 掩盖问题
删除 delayed observation
previous-paragraph fallback
generic historical heuristic
禁用 rehydrate 作为猜测性修复
```

本轮只允许：

```text
forensic self-check
diagnostic coverage hardening
artifact provenance
startup verification
runtime R0
```

---

# 2. Final Self-Check A — Same Composition Session 不得误取消 Probe

当前 targeted probe 设计：

```text
SPLIT_NEW_PARAGRAPH expectation
→ first non-dedup trusted TEXT_INPUT
→ arm exactly one PostTextInputObservation
```

必须验证：

```text
same compositionSessionId
```

内后续的 `insertCompositionText`，即使由于时间窗口成为：

```text
deduplicated=false
```

也不得被当成新的 ownership intent 而取消当前 observation。

硬 invariant：

```text
sameCompositionSessionNonDedupInputCancels=false
```

正确语义：

```text
compositionstart session=C1

beforeinput insertCompositionText A
→ ARM observation O1

beforeinput insertCompositionText B
same compositionSessionId=C1
even if deduplicated=false
→ KEEP O1
→ do NOT cancel
→ may update latestInputIntentId

compositionend C1
→ O1 reaches TEXT_COMMIT
```

只有以下真正新 intent 才允许取消：

```text
different compositionSessionId
pointer
keyboard navigation
new Enter
new Special Command
document switch
scope change
editor unbind
plugin unload
```

新增或确认：

```text
POST-TEXT-INPUT-PROBE-INVARIANT:
sameCompositionSessionNonDedupInputCancels=false
maxActiveObservation=1
overall=true
```

如果当前源码不满足，只允许修 forensic ownership 判定，不得改 editor caret 业务逻辑。

---

# 3. Final Self-Check B — TEXT_COMMIT 必须以真实事件顺序为准

当前必须保留：

```text
T0_SYNC
T_MICROTASK
T_RAF
T_16MS
...
```

但这些是 event lifecycle forensic，不作为最终 post-commit stability 结论。

必须有：

```text
T_INPUT_EVENT
TEXT_COMMIT
```

对于 IME，禁止硬假设：

```text
compositionend 永远发生在 final input 之后
```

R0 必须实际输出事件顺序：

```text
IME-EVENT-ORDER:
compositionSessionId=
compositionstartTs=
lastBeforeInputTs=
lastInputTs=
compositionEndTs=
```

并输出：

```text
TEXT-COMMIT-AUDIT:
observationId=
compositionSessionId=
commitSource=
compositionEndTimestamp=
lastInputTimestamp=
lastBeforeInputTimestamp=
runtimeId=
visibleText=
logicalOffset=
```

判定规则：

若真实 runtime 是：

```text
input
→ compositionend
```

允许：

```text
TEXT_COMMIT = compositionend
```

若真实 runtime 是：

```text
compositionend
→ final input
```

则必须：

```text
TEXT_COMMIT = final input
```

或：

```text
compositionend 后等待 final input / microtask settle
```

禁止在 runtime 证据出现前猜测事件顺序。

---

# 4. Final Self-Check C — Selection Writer Inventory 100% Coverage

重新静态 inventory 所有可能显式修改 Selection/Range 的 API：

```text
setStart
setEnd
collapse
removeAllRanges
addRange
setBaseAndExtent
setPosition
extend
selectAllChildren
Selection.modify
document.execCommand
createRange
```

同时检查项目 helper：

```text
restoreLogicalCaret
repairCaretAtParagraphLogicalStart
writeCaretAtTextLeaf
focusParagraphAfterMarkerIndex
focusLastIndentMarker
POST-TOKEN-SELECTION
BACKSPACE-CARET-REPAIR
CARET-CONTINUITY-RESTORE
```

另检查：

```text
.focus()
```

`.focus()` 不一定属于 explicit logical Selection writer，但必须进入 inventory：

```text
reviewed=true
classifiedAs=
  EXPLICIT_SELECTION_WRITE
  FOCUS_SIDE_EFFECT_ONLY
  NON_EDITOR
```

最终输出：

```text
PLUGIN-SELECTION-WRITE-INVENTORY:
explicitSelectionWriteSiteCount=
auditedExplicitSelectionWriteSiteCount=
focusSideEffectSiteCount=
uncoveredPluginSelectionWriteSite=
overall=
```

硬条件：

```text
uncoveredPluginSelectionWriteSite=0
```

所有显式 Selection writer 都必须经过：

```text
PLUGIN-SELECTION-WRITE-AUDIT
```

禁止为了 audit 统一而改写 writer 的业务行为。

---

# 5. Final Self-Check D — Probe 不得自我扰动

必须保持：

```text
maxActiveObservation=1
```

Observation 每个 callback 执行时验证：

```text
observationId
generation
scopeId
editorInstanceId
```

任何不匹配：

```text
return without reading/writing editor
```

新增/确认：

```text
POST-TEXT-INPUT-CALLBACK-GATE:
observationId=
expectedGeneration=
currentGeneration=
scopeMatches=
editorMatches=
decision=ALLOW|DROP_STALE
```

document switch / editor unbind / unload：

```text
cancel all pending observation callbacks
```

旧 observation 的 2200ms callback 不得跨入下一轮 test。

R0 中：

```text
staleCallbackExecutedCount=0
staleCallbackDroppedCount 可以 >=0
activeObservationPeak=1
```

---

# 6. Final Self-Check E — Rehydrate 只统计真实 DOM Change

必须保持：

```text
REHYDRATE-APPLY emitted
≠
actual DOM write
```

输出：

```text
REHYDRATE-SELECTION-AUDIT:
planId=
selectionBeforeRuntimeId=
selectionBeforeOffset=

applyAttemptedCount=

semanticApplyAttempted=
semanticActuallyChanged=

classApplyAttempted=
classActuallyChanged=

inlineStyleApplyAttempted=
inlineStyleActuallyChanged=

decorationApplyAttempted=
decorationActuallyChanged=

actualDomWriteCount=

selectionAfterSyncRuntimeId=
selectionAfterSyncOffset=

selectionAfterMicrotaskRuntimeId=
selectionAfterMicrotaskOffset=

selectionAfterRAFRuntimeId=
selectionAfterRAFOffset=

selectionWriteAttemptedByRehydrate=
```

`actualDomWriteCount` 只统计真实变更。

如果：

```text
semanticBefore=force-indent
semanticAfter=force-indent
class already correct
style already correct
```

必须允许：

```text
actualDomWriteCount=0
```

---

# 7. Final Pipeline Provenance

如果上述 self-check 修改任何 source：

必须换新 Build ID。

禁止复用：

```text
k9t4w
j7d3q
```

建议：

```text
inkchapter-r58-7-post-textinput-r0-gate-<unique>
```

最终顺序：

```text
完成全部 source 修改
↓
写最终唯一 Build ID
↓
pnpm exec tsc --noEmit
↓
专项 tests
↓
pnpm exec vitest run
↓
pnpm run build:dev
↓
deploy
↓
four-path direct SHA
```

上一轮最终 source 在一次后续 edit 后只重跑了：

```text
tsc
full tests
build:dev
```

如果报告要写：

```text
专项 tests = 385 passed
```

则必须在最终 source 上重新实际执行专项 tests。

否则只能准确写：

```text
专项385 = pre-final instrumentation pass
final full suite = 676 pass
```

建议直接补跑最终专项 tests。

---

# 8. style.css Provenance

当前已知：

```text
build
→ rollup
→ processor 去换行/空白
→ style SHA C5A...

build:dev
→ esbuild/sass 输出
→ style SHA F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

本轮统一：

```text
pnpm run build:dev
```

并确认：

```text
src/style.scss git diff = empty
```

最终四路径 SHA 必须直接输出：

```text
PROJECT:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

RUNTIME:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

PROJECT STYLE:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\style.css

RUNTIME STYLE:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\style.css
```

必须：

```text
mainMatch=true
cssMatch=true
```

禁止使用：

```text
test\vault.typora
```

---

# 9. Fresh Fixture Gate

A1 必须使用一次一文件：

```text
r58-caret-a1-fresh-01.md
...
r58-caret-a1-fresh-10.md
```

每个文件测试前必须证明：

```text
sidecarExists=false
recordCount=0
```

进入 runtime 打开后还必须证明：

```text
activeFilePath=<exact fixture>
persistenceKey=<exact fixture>
registryRecordCount=0
```

如果任一 fresh fixture 在测试前：

```text
sidecarExists=true
recordCount>0
registryRecordCount>0
```

STOP，不得把它作为 clean trial。

---

# 10. Strict Startup Gate

当前 sandbox 内 restart 已失败过。

优先方案：

```text
1. Trae 完成 final artifact
2. 用户在 sandbox 外手动启动 Typora
3. 打开 fresh-01
4. Trae只读检查 startup/runtime
```

不要反复调用 `Start-Process`。

不要为了启动直接扩大整个 AppData 权限。

针对这一次新的真实启动必须重新取得：

```text
old Typora process exited
new PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

target vault
target document

runtime plugin main path

project main SHA
runtime main SHA
shaMatch=true

style SHA

Build ID
runtime Build ID
initializationCount=1
```

以前失败的 PID / StartTime / `Title=Error`：

```text
不得复用
```

缺任一项必须原样输出：

**启动命令已发出，但尚未确认成功**

---

# 11. Runtime R0 — 只做 1 次

严格启动 PASS 后，不要立即做 10 次。

只打开：

```text
r58-caret-a1-fresh-01.md
```

执行一次：

```text
。。
Enter
Enter
立即输入 。
等待至少 2.5 秒
```

然后 STOP。

先分析 R0 instrumentation 是否可信。

---

# 12. R0 Mandatory Evidence

必须存在且只属于同一个 observation：

```text
POST-TEXT-INPUT-ARM count=1
maxActiveObservation=1

TEXT_INPUT supersede=true

T_INPUT_EVENT exists

IME event order complete

TEXT_COMMIT-AUDIT exists

COMMIT+0 exists
COMMIT+16 exists
COMMIT+50 exists
COMMIT+150 exists
COMMIT+300 exists
COMMIT+500 exists
COMMIT+1000 exists
COMMIT+2200 exists
```

必须：

```text
staleCallbackExecutedCount=0
uncoveredPluginSelectionWriteSite=0
```

并记录：

```text
CARET-CONTINUITY-RESTORE after input count
CARET-REPAIR after input count
PLUGIN-SELECTION-WRITE-AUDIT after input count
REHYDRATE actualDomWriteCount
```

---

# 13. R0 Raw Timeline

先按 raw timeline 排列：

```text
compositionstart
beforeinput
TEXT_INPUT intent
expectation supersede
T_INPUT_EVENT
compositionupdate
compositionend
TEXT_COMMIT
COMMIT+0
COMMIT+16
COMMIT+50
COMMIT+150
COMMIT+300
COMMIT+500
COMMIT+1000
COMMIT+2200
```

每个点输出：

```text
runtimeId
visibleText
logicalOffset
insideEditor
isComposing
pluginSelectionWriteCountSinceInput
rehydrateDomWriteCountSinceInput
```

禁止先下结论：

```text
offset 1→0 = rehydrate
offset 1→0 = IME
```

必须先展示 timeline。

---

# 14. R0 判定

## R0-A — IME transient

若：

```text
composition active:
1 → 0 → 1

但 TEXT_COMMIT 后：

COMMIT+50=1
COMMIT+150=1
COMMIT+300=1
COMMIT+500=1
COMMIT+1000=1
COMMIT+2200=1

pluginSelectionWriteCountSinceInput=0
```

判：

```text
R0 = PASS
pre-commit selection change = IME/Typora transient candidate
```

允许进入 A1×10。

## R0-B — Persistent failure

若：

```text
COMMIT+50=0
并且后续持续 0
```

判：

```text
R0 = FAIL
POST-TEXT_INPUT STABILITY NOT FIXED
```

STOP。

不要让用户继续 A1×10。

## R0-C — Plugin writer

若：

```text
offset 1
→ PLUGIN-SELECTION-WRITE-AUDIT
→ offset 0
```

按 caller 定位。

STOP。

## R0-D — Rehydrate strong causal candidate

只有：

```text
selectionBefore=1
actualDomWriteCount>0
selectionAfter=0
pluginSelectionWriteCount=0
且 COMMIT 后错误持续
```

才允许：

```text
rehydrate = strong causal candidate
```

仅仅：

```text
REHYDRATE-APPLY 与 offset 0 时间相邻
```

不得判因果。

---

# 15. R0 PASS 后才进入正式 Matrix

只有 R0 instrumentation 完整且稳定性 PASS，才继续：

```text
A1 fresh canonical ×10
A2 fresh noncanonical ×3
A3 split no text ×3
B1 historical fixture ×5
```

本轮 prompt 默认终点：

```text
R0 分析完成
```

除非用户明确要求继续，否则不要自动进入全部人工 matrix。

---

# 16. Canonical Regression Gate

R0 中必须继续保持：

```text
SOURCE-SNAPSHOT state=CURRENT_LIVE
CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
RECORD-LIFECYCLE TRANSFER
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING_TRANSFER stable leak=0
```

禁止修改 canonical 业务代码。

---

# 17. Enter Admission Regression Gate

必须：

```text
Process / Period
→ REJECT_NON_ENTER
```

且：

```text
normalEnterTxnCreatedFromNonEnterCount=0
```

`nonEnterRejectedCount > 0` 正常。

不要混淆两个计数器。

---

# 18. 最终报告格式

R0 前：

```text
Build ID:
Final source modified after Build ID?:
Final tsc:
Final targeted tests:
Final full tests:
Build command:
Project main SHA:
Runtime main SHA:
mainMatch:
Project style SHA:
Runtime style SHA:
cssMatch:

Selection write inventory:
explicitSelectionWriteSiteCount:
auditedExplicitSelectionWriteSiteCount:
focusSideEffectSiteCount:
uncoveredPluginSelectionWriteSite:

sameCompositionSessionNonDedupInputCancels:
maxActiveObservation:

Fresh fixture:
sidecarExists:
recordCount:

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
```

R0 后：

```text
R0 observationId:

IME event order:

TEXT_INPUT superseded:
T_INPUT_EVENT:

TEXT_COMMIT:
commitSource:

COMMIT+0:
COMMIT+16:
COMMIT+50:
COMMIT+150:
COMMIT+300:
COMMIT+500:
COMMIT+1000:
COMMIT+2200:

caretRestoreAfterInput:
caretRepairAfterInput:
pluginSelectionWriteAfterInput:

rehydratePlanCount:
rehydrateApplyCount:
rehydrateActualDomWriteCount:

staleCallbackExecutedCount:
activeObservationPeak:

Canonical projection fail:
Canonical final audit fail:
Awaiting leak:
Selection loss:
NonEnter-created NENTER:

R0 Verdict:
```

R0 Verdict 只允许：

```text
R0 PASS — proceed to A1 matrix
```

或：

```text
R0 FAIL — POST-TEXT_INPUT STABILITY NOT FIXED; R60 BLOCKED
```

如果 runtime 未启动：

```text
启动命令已发出，但尚未确认成功
R0 NOT EXECUTED
R60 BLOCKED
```

---

# 19. Git

禁止：

```text
git add
git commit
git push
```

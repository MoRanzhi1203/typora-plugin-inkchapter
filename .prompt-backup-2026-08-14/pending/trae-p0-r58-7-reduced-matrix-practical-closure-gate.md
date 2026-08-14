# Trae P0 — R58.7 Reduced Matrix Practical Closure Gate

## 0. 目标

当前不再执行原计划：

```text
A1 fresh canonical ×10
A2 fresh noncanonical ×3
A3 split-no-text ×3
B1 historical/noise ×5
```

改为 **Reduced Matrix**：

```text
A1 fresh canonical ×3
A2 fresh noncanonical ×1
A3 split-no-text ×1
B1 historical/noise ×2
```

当前已知：

```text
Build:
inkchapter-r58-7-clean-r0-closure-p4v9n

Fresh-05 Clean Baseline = PASS / runtime
Formal Clean R0 = PASS / runtime
Post-TEXT_INPUT stability = PASS
Probe lifecycle COMPLETE = PASS
Canonical Transfer = PASS
AWAITING-TRANSFER-LEAK awaitingCount=0
Enter Admission = PASS
```

本轮目标：

```text
用最小但仍有代表性的重复矩阵完成 R58.7 Practical Closure
```

注意：

```text
不得把 Reduced Matrix 写成 Full Exhaustive Closure。
```

---

# 1. 冻结当前业务实现

当前禁止修改：

```text
src/heading-numbering/**
CaretExpectation
Caret repair
SelectionTruth
NormalEnter
Canonical Transfer
Canonical Registry
Rehydrate
Historical resolver
Save-As
Merge
```

当前 Build 固定：

```text
inkchapter-r58-7-clean-r0-closure-p4v9n
```

禁止：

```text
build
build:dev
deploy
修改 Build ID
git add
git commit
git push
```

除非 Reduced Matrix 暴露真实业务失败，否则本轮只做验证。

---

# 2. Reduced Matrix 定义

本轮只执行：

```text
A1 fresh canonical ×3
A2 fresh noncanonical ×1
A3 split-no-text ×1
B1 historical/noise ×2
```

总计：

```text
7 trials
```

Formal Clean R0（fresh-05）已经完成，不重复计入 A1。

---

# 3. A1 ×3 — Fresh Canonical Repeatability

建议使用三个全新 fixture：

```text
r58-caret-a1-fresh-06.md
r58-caret-a1-fresh-07.md
r58-caret-a1-fresh-08.md
```

如果其中某个 fixture 已被使用或 sidecar 已存在，则：

```text
不要删除 sidecar
不要清空历史
改用下一个从未使用的 fresh fixture
```

每个 A1 trial 前必须证明：

```text
fixtureExists=true
sidecarExists=false
recordCount=0
```

runtime 打开后必须证明：

```text
SIDECAR-ACTUAL-LOAD exists=false recordCount=0 source=physical
PERSISTED_LOAD count=0
PERSISTED_HISTORICAL count=0
```

固定操作：

```text
。。
Enter
Enter
立即输入 。
等待 >= 2.5s
```

必须满足：

```text
Process/Period → REJECT_NON_ENTER
isTrusted=true

POST-TEXT-INPUT-ARM count=1
CARET-EXPECTATION-SUPERSESSION-AUDIT superseded=true

COMMIT+50    logicalOffset=1
COMMIT+150   logicalOffset=1
COMMIT+300   logicalOffset=1
COMMIT+500   logicalOffset=1
COMMIT+1000  logicalOffset=1
COMMIT+2200  logicalOffset=1

visibleText="。"
insideEditor=true

CARET-CONTINUITY-RESTORE=0
CARET-REPAIR=0
unexpected PLUGIN-SELECTION-WRITE=0

POST-TEXT-INPUT-COMPLETE exactly once
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

A1 必须：

```text
3/3 PASS
```

否则 Reduced Matrix 立即 FAIL。

---

# 4. A2 ×1 — Fresh Noncanonical

使用一个新的 fresh fixture。

目标：

```text
验证没有 canonical override 的普通段落路径
```

要求：

```text
fixture clean
runtime clean
无 historical record
```

操作应覆盖：

```text
普通段落
普通 Enter
随后输入文本
```

不得通过 special command 创建 canonical record。

必须验证：

```text
sourceCanonicalRecordId=none
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true
caret destination 正常
无 CARET-REPAIR
无 CARET-CONTINUITY-RESTORE
无 unexpected selection write
```

并确认：

```text
canonicalOutcomeOverall=n/a
```

或等价非 canonical 正常结果。

A2 只执行一次。

---

# 5. A3 ×1 — Split No Text

使用一个新的 fresh fixture。

目标：

```text
只执行 split，不立即输入新的 。
```

重点验证：

```text
SPLIT_NEW_PARAGRAPH expectation 正常建立
caretDestinationRuntimeId 正确
completedOriginalRuntimeId 正确
selectionInsideEditor=true
```

等待至少：

```text
2.5s
```

期间不得主动输入 TEXT_INPUT。

必须：

```text
无异常 CARET-RESTORE
无 CARET-REPAIR
Canonical transfer overall=true
AWAITING-TRANSFER-LEAK awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

如果 expectation 自然保持或被合法关闭，均需记录真实原因，不得伪造 supersession。

---

# 6. B1 ×2 — Historical / Noise

使用两个独立 historical/noise fixture。

目标：

```text
验证 PERSISTED_HISTORICAL 与 current-session live identity 隔离
```

必须明确：

```text
只有 PERSISTED_HISTORICAL 才允许 historical resolver
CURRENT_LIVE 不得走 historical heuristic
CURRENT_AWAITING_TRANSFER 不得走 historical heuristic
CURRENT_RETIRED 不得走 historical heuristic
```

每个 B1 trial 需要证明：

```text
historical source 是 physical sidecar load
record lifecycle = PERSISTED_HISTORICAL
historical resolver 使用范围正确
无 current-session record 被 historical heuristic 抢占
无 duplicate canonical append
无 stale awaiting leak
```

B1 必须：

```text
2/2 PASS
```

---

# 7. 每个 trial 的最低启动验证

每轮都至少验证：

```text
PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

target vault
target document

runtime plugin main path

Build ID =
inkchapter-r58-7-clean-r0-closure-p4v9n

runtime Build ID =
inkchapter-r58-7-clean-r0-closure-p4v9n

project/runtime main SHA match=true
style SHA match=true
initializationCount=1
```

如果本轮执行了真实关闭/重启，则必须同时直接验证：

```text
oldProcessExited=true
```

不能从新 sessionId 推断。

---

# 8. 正确路径

唯一合法 runtime 根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora
```

禁止：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora
```

所有：

```text
runtime-load
runtime main.js
runtime style.css
sidecar
```

必须从：

```text
test\vault\.typora
```

派生。

---

# 9. Fail-Fast

Reduced Matrix 必须 fail-fast。

例如：

```text
A1-01 PASS
A1-02 FAIL
```

立即：

```text
STOP
```

保留：

```text
当前 fixture
sidecar
runtime log
process metadata
runtime-load
相关 audit
```

禁止：

```text
删除 sidecar
重置 fixture
重复测试直到 PASS
继续后续 trial
```

---

# 10. Matrix Verdict

必须生成：

```text
A1-01:
A1-02:
A1-03:

A2-01:

A3-01:

B1-01:
B1-02:
```

最终统计：

```text
A1 = 3/3
A2 = 1/1
A3 = 1/1
B1 = 2/2
TOTAL = 7/7
```

只有：

```text
7/7 PASS
```

才允许：

```text
R58.7 PRACTICAL CLOSURE = PASS
```

---

# 11. 禁止错误命名

即使 7/7 PASS，也禁止写：

```text
R58.7 FULL EXHAUSTIVE CLOSURE PASS
A1×10 PASS
FULL MATRIX PASS
```

因为原始：

```text
A1×10
A2×3
A3×3
B1×5
```

没有执行。

必须明确：

```text
Extended Stress Matrix = WAIVED / NOT EXECUTED
Reduced Matrix = 7/7 PASS
```

---

# 12. R60 状态

如果 Reduced Matrix 7/7 PASS，并且用户接受 Reduced Matrix waiver，可以报告：

```text
R58.7 PRACTICAL CLOSURE = PASS
EXTENDED STRESS MATRIX = WAIVED
R60 MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

不得报告：

```text
R58.7 FULL EXHAUSTIVE CLOSURE PASS
```

如果任何 trial FAIL：

```text
R58.7 PRACTICAL CLOSURE = FAIL
R60 BLOCKED
```

---

# 13. SyntaxError 独立债务

继续记录：

```text
SyntaxError: Unexpected token ')'
```

如果存在：

```text
startupSyntaxErrorObserved=true
```

但除非证明与 InkChapter 业务逻辑有因果关系，否则：

```text
不要修改 Caret / Canonical / paragraph 业务代码
```

单独作为 runtime debt 记录。

---

# 14. 最终报告格式

```text
=== BUILD ===
buildId:
mainSHA:
styleSHA:

=== FORMAL CLEAN R0 ===
fresh05:
verdict:

=== A1 REDUCED ===
A1-01:
A1-02:
A1-03:
A1Result:

=== A2 ===
A2-01:
A2Result:

=== A3 ===
A3-01:
A3Result:

=== B1 ===
B1-01:
B1-02:
B1Result:

=== COUNTERS ===
totalPass:
totalFail:
totalInvalid:

=== DEBT ===
startupSyntaxErrorObserved:
extendedStressMatrixExecuted:false

=== FINAL ===
reducedMatrix:
practicalClosure:
extendedMatrix:
R60:
```

---

# 15. 最终允许输出

若 7/7 PASS：

```text
FORMAL CLEAN R0 = PASS

A1 REDUCED REPEATABILITY = 3/3 PASS
A2 = 1/1 PASS
A3 = 1/1 PASS
B1 = 2/2 PASS

REDUCED MATRIX = 7/7 PASS

R58.7 PRACTICAL CLOSURE = PASS
EXTENDED STRESS MATRIX = WAIVED / NOT EXECUTED

R60 MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

若失败：

```text
REDUCED MATRIX FAIL — <具体 trial>
R58.7 PRACTICAL CLOSURE = FAIL
R60 BLOCKED
```

---

# 16. Git

禁止：

```text
git add
git commit
git push
```

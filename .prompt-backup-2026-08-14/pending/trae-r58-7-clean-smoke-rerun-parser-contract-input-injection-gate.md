# Trae — R58.7 Clean Smoke Re-run Gate：Parser Contract 已修复 → 新 Smoke Session → InputSmoke → Full

## 0. 当前冻结基线

当前 Build：

```text
inkchapter-r58-7-file-audit-ime-provenance-imep4k7
```

当前 Main SHA：

```text
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前已经成立：

```text
Strict Startup #1 = PASS / RUNTIME
File-backed Audit Sink = PASS / RUNTIME
Audit Session Authority = PASS / RUNTIME
JSONL UTF-8 Offset Smoke = PASS
IME JSONL Observability = PASS / source + unit
Runner JSONL Integration = PASS / source
RUNNER-PARSER-CONTRACT = 6/6 PASS
```

当前未成立：

```text
Trusted Input Automation = NOT YET VERIFIED
InputSmoke = INVALID / previous runner reporting error
Full Reduced Matrix = NOT YET
R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

---

# 1. 上一次 InputSmoke 的正式解释

失败 session：

```text
sess-1786593474840
```

上一次 InputSmoke：

```text
InputSmoke = INVALID
reason = RUNNER_REPORTING_ERROR
```

根因：

```text
Invoke-JsonlTrial
↓
Write-Step 使用 Write-Output
↓
日志字符串进入 PowerShell pipeline
↓
$verdict 实际变成 System.Object[]
↓
$verdict.verdict
↓
PropertyNotFoundStrict
```

不是 InkChapter / IME / Caret / Canonical 业务 FAIL。

Runner parser contract 已修复：

```text
RUNNER-PARSER-CONTRACT-1 = PASS
RUNNER-PARSER-CONTRACT-2 = PASS
RUNNER-PARSER-CONTRACT-3 = PASS
RUNNER-PARSER-CONTRACT-4 = PASS
RUNNER-PARSER-CONTRACT-5 = PASS
RUNNER-PARSER-CONTRACT-6 = PASS
```

---

# 2. 旧 Smoke Session 必须保留，不得重用

旧 session：

```text
sess-1786593474840
```

保留：

```text
runtime audit JSONL
input-smoke.delta.jsonl
input-smoke.json
strict-startup.json
sink-runtime-smoke.json
process metadata
```

禁止删除、truncate、覆盖，禁止把旧 InputSmoke 改写成 PASS。

因为旧 Runner 已执行 SendInput 调用但：

```text
auditEvidenceOfInput=false
deltaBytes=0
```

更准确状态：

```text
inputInjectionAttempted=true
inputObservedByInkChapter=false
inputOutcome=UNKNOWN
```

当前 session 视为：

```text
CONTAMINATED
```

禁止原 session 直接重跑 InputSmoke。

---

# 3. 本轮继续冻结 imep4k7

禁止修改：

```text
src/**
forensic-log-sink.ts
heading-numbering-service.ts
paragraph-indent-forensic.ts
CaretExpectation
SelectionTruth
NormalEnter
Canonical Transfer
Canonical Registry
DocumentRuntimeContext
Historical resolver
Rehydrate
Merge
IME 状态机
```

禁止 build / build:dev / deploy / 修改 Build ID。

本轮只允许修改：

```text
scripts/r58-matrix/**
```

并且只用于 Runner 基础设施修复。

---

# 4. 补充 SendInput 返回值审计

在新一轮 InputSmoke 前，允许增加 Runner-only：

```text
INPUT-INJECTION-AUDIT
```

记录：

```text
targetPid=
targetHwnd=
foregroundHwndBefore=
foregroundMatchBefore=
requestedInputCount=
sendInputReturnCount=
foregroundHwndAfter=
injectionAttempted=
injectionSucceeded=
```

Win32 SendInput 返回的成功插入事件数量必须被记录。

判定：

```text
sendInputReturnCount == requestedInputCount
```

否则：

```text
InputSmoke = INVALID
reason=SENDINPUT_PARTIAL_OR_FAILED
```

禁止仅因为 SendInput 未抛异常就声称输入成功。

---

# 5. SendInput Audit 回归测试

新增 Runner-only regression tests：

```text
INPUT-INJECT-1 requested=5 returned=5
→ PASS

INPUT-INJECT-2 requested=5 returned=0
→ INVALID / SENDINPUT_PARTIAL_OR_FAILED

INPUT-INJECT-3 requested=5 returned=3
→ INVALID / SENDINPUT_PARTIAL_OR_FAILED

INPUT-INJECT-4 foreground mismatch
→ INVALID / FOREGROUND_WINDOW_MISMATCH
```

要求全部 PASS。

不要 build/deploy。

---

# 6. 建立全新的 Clean Smoke Session

修复 Runner 后：

```text
关闭当前 Typora
↓
确认 Typora processCount=0
```

只重置 disposable smoke fixture：

```text
r58-automation-input-smoke.md
```

以及它自己的 sidecar。

禁止重置：

```text
fresh-01~10
historical fixtures
旧 audit logs
app-*.log
runtime-load historical evidence
```

Smoke fixture 必须恢复 clean baseline。

---

# 7. Strict Startup #1B

目标：

```text
r58-automation-input-smoke.md
```

运行：

```powershell
cd D:\TyporaPluginProjects\typora-plugin-inkchapter

.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode StrictStartup `
  -OutputDir "artifacts\r58-final"
```

必须产生：

```text
new PID
new StartTime
new MainWindowHandle
new MainWindowTitle
new auditSessionId
new runtime-*.log
```

且：

```text
new auditSessionId != sess-1786593474840
```

---

# 8. Strict Startup #1B Mandatory Evidence

必须：

```text
oldProcessExited=true
processCountAfterClose=0

newPid != empty
StartTime != empty
MainWindowHandle != 0
MainWindowTitle != ""

targetDocument=r58-automation-input-smoke.md

runtimeBuildId=inkchapter-r58-7-file-audit-ime-provenance-imep4k7

projectMainSHA
=
runtimeMainSHA
=
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C

mainMatch=true
cssMatch=true
initializationCount=1
auditDecision=ACCEPT
```

只有全部满足：

```text
Strict Startup #1B = PASS / RUNTIME
```

---

# 9. SinkSmoke #1B

Strict Startup #1B PASS 后：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode SinkSmoke `
  -OutputDir "artifacts\r58-final"
```

必须：

```text
auditDirectoryExists=true
auditFileExists=true
fileSize>0
FORENSIC-SINK-READY=true
buildIdCorrect=true
jsonlParseFailureCount=0
jsonlValid=true
baselineEventsPresent=true
sinkErrorCount=0
droppedCount=0
fileBackedAuditSink=PASS
```

并确认当前 audit session 是新的 #1B session。

---

# 10. InputSmoke #1B

SinkSmoke PASS 后：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode InputSmoke `
  -OutputDir "artifacts\r58-final"
```

Runner 必须自动：

```text
record byteOffsetBefore
↓
SetForegroundWindow
↓
verify foreground HWND
↓
SendInput:
Period
Period
Enter
Enter
Period
↓
capture sendInputReturnCount
↓
wait >=2.5s
↓
record byteOffsetAfter
↓
read delta JSONL
↓
trial-parser
```

---

# 11. Input Injection Gate

必须：

```text
foregroundMatchBefore=true
requestedInputCount > 0
sendInputReturnCount == requestedInputCount
injectionAttempted=true
injectionSucceeded=true
```

否则：

```text
InputSmoke = INVALID
```

并给具体：

```text
FOREGROUND_WINDOW_MISMATCH
或
SENDINPUT_PARTIAL_OR_FAILED
```

---

# 12. JSONL Delta Gate

新的 InputSmoke 必须首先证明：

```text
byteOffsetAfter > byteOffsetBefore
deltaBytes > 0
deltaLineCount > 0
JSON parse failure count = 0
```

如果：

```text
SendInputReturnCount == requestedInputCount
```

但：

```text
deltaBytes=0
```

则：

```text
InputSmoke = INVALID
reason=INPUT_NOT_OBSERVED_BY_RUNTIME
```

不要判 InkChapter business FAIL。

下一步只调查：

```text
editor focus
Typora contenteditable focus
IME context
foreground window
SendInput target
```

---

# 13. Trusted Keyboard Gate

delta JSONL 必须：

```text
KEYBOARD-EVENT-PROVENANCE
key=Process
code=Period
isTrusted=true
```

否则：

```text
INVALID
reason=INPUT_PROVENANCE_MISMATCH
```

---

# 14. IME Runtime Gate

必须证明：

```text
IME-SELECTION-AUDIT / IME-EVENT-ORDER

compositionstart
↓
beforeinput
inputType=insertCompositionText
↓
input
↓
compositionend
```

compositionupdate 若真实环境产生则记录，但不强制每次必有。

同时：

```text
TEXT-COMMIT-AUDIT
visibleText="。"
logicalOffset=1
```

trusted Period 成立但没有真实 IME chain：

```text
InputSmoke = INVALID
reason=IME_NOT_ACTIVE
```

---

# 15. InputSmoke Business Gate

必须：

```text
POST-TEXT-INPUT-ARM exactly 1

CARET-EXPECTATION-SUPERSESSION-AUDIT
superseded=true
restoreAttempted=false

POST-TEXT-INPUT-STABILITY:
COMMIT+50    logicalOffset=1
COMMIT+150   logicalOffset=1
COMMIT+300   logicalOffset=1
COMMIT+500   logicalOffset=1
COMMIT+1000  logicalOffset=1
COMMIT+2200  logicalOffset=1

visibleText="。"
insideEditor=true

POST-TEXT-INPUT-COMPLETE exactly once

activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
NORMAL-ENTER-FINAL overall=true

AWAITING-TRANSFER-LEAK-AUDIT awaitingCount=0
CANONICAL-SCOPE-MISMATCH count=0

CARET-CONTINUITY-RESTORE after input=0
CARET-REPAIR after input=0
unexpected PLUGIN-SELECTION-WRITE=0

FORENSIC-SINK-ERROR count=0
droppedCount=0
```

只有全部成立：

```text
InputSmoke #1B = PASS / RUNTIME
```

---

# 16. Parser Contract 必须继续保持稳定

trial-parser.js 输出 envelope：

```json
{
  "type": "InputSmoke",
  "trial": "InputSmoke",
  "verdict": "PASS|FAIL|INVALID",
  "failedChecks": [],
  "invalidReason": null
}
```

如果：

```text
node missing
exitCode != 0
output missing
output empty
invalid JSON
missing verdict
```

统一：

```text
verdict=INVALID
invalidReason=PARSER_CONTRACT_ERROR
```

禁止 PowerShell fatal。

---

# 17. InputSmoke PASS 后的正式状态

只有新 clean session InputSmoke PASS：

```text
Trusted Input Automation = PASS / RUNTIME
IME JSONL Observability = PASS / RUNTIME
File-backed Audit Sink = PASS / RUNTIME
```

此时才允许进入 Formal Matrix。

---

# 18. Formal Matrix 前必须重新建立 Matrix Session

InputSmoke PASS 后：

```text
reset fresh-01~10
↓
关闭 smoke Typora
↓
processCount=0
↓
Strict Startup #2
↓
target fresh-01
```

禁止沿用 smoke session。

---

# 19. Formal Reduced Matrix

分配：

```text
A1-01 → fresh-01
A1-02 → fresh-02
A1-03 → fresh-03
A2-01 → fresh-04
A3-01 → fresh-05
B1-01 → r58-b1-historical-01.md
B1-02 → r58-b1-historical-02.md
```

要求：

```text
A1=3/3 PASS
A2=1/1 PASS
A3=1/1 PASS
B1=2/2 PASS
TOTAL=7/7 PASS
```

A1/A2/A3 必须在同一 Formal Matrix Session 中通过真实 document switch：

```text
fresh-01
→ fresh-02
→ fresh-03
→ fresh-04
→ fresh-05
```

---

# 20. Full Matrix Gate

只有：

```text
Strict Startup #1B PASS
SinkSmoke #1B PASS
InputSmoke #1B PASS
Strict Startup #2 PASS
A1 3/3
A2 1/1
A3 1/1
B1 2/2
TOTAL 7/7
```

才允许：

```text
File-backed Audit Sink = PASS / RUNTIME
IME JSONL Observability = PASS / RUNTIME
Trusted Input Automation = PASS / RUNTIME
Reduced Matrix = 7/7 PASS
R58.7 PRACTICAL CLOSURE = PASS
Extended Stress Matrix = WAIVED / NOT EXECUTED
R60 = MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

禁止：

```text
A1×10 PASS
FULL EXHAUSTIVE MATRIX PASS
R58.7 FULL EXHAUSTIVE CLOSURE PASS
```

---

# 21. Fail-Fast

任何真实 FAIL：

```text
STOP
```

保存：

```text
current runtime audit
trial delta
parser output
strict startup
sink smoke
input injection audit
process metadata
fixture
sidecar
summary-so-far
```

生成：

```text
artifacts/r58-final/FAILURE-SNAPSHOT/
```

禁止：

```text
retry-until-pass
自动换 fixture 隐藏 FAIL
truncate audit
删除旧 session 证据
```

---

# 22. 本轮立即执行顺序

严格：

```text
1. 可选补 INPUT-INJECTION-AUDIT + 4 个 Runner-only regression tests
2. 关闭旧 contaminated smoke session
3. processCount=0
4. reset disposable smoke fixture only
5. Strict Startup #1B
6. SinkSmoke #1B
7. InputSmoke #1B
8. PASS 后 reset fresh-01~10
9. Strict Startup #2
10. Full Reduced Matrix
11. final-summary
12. STOP
```

---

# 23. Git

禁止：

```text
git add
git commit
git push
```

不要自动进入 R60。

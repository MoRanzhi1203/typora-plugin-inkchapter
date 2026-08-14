# Trae — E2 Input Foreground Safety + Trial Artifact Authority 修复门禁

## 0. 任务目标

本轮只修 **E2 Formal Input Gate 的 Harness 问题**，不得修改 EmptySpecial 业务源码。

当前已确认：

```text
Build:
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

Main SHA:
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

Style SHA:
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前 Runtime：

```text
Strict Startup = PASS / RUNTIME
E2 Runtime Precondition = PASS / RUNTIME
E2 Precondition False-INVALID = CLOSED / RUNTIME
P0-A/B/C = RUNTIME PENDING
Caret = RUNTIME PENDING
```

当前新 blocker：

```text
Foreground match = false
但 Runner 仍执行 SendInput
```

最新 `input-injection-audit.json`：

```text
targetHwnd=1576830
foregroundHwndBefore=1904888
foregroundMatchBefore=false
requestedInputCount=2
sendInputReturnCount=2
foregroundHwndAfter=1904888
injectionAttempted=true
injectionSucceeded=true
```

因此：

```text
E2 Foreground Input Safety
= BUG CONFIRMED / HARNESS / RUNTIME
```

同时当前 `trial.delta.jsonl` 属于旧 Build/旧 session：

```text
buildId=inkchapter-r58-7-p0-empty-special-arm-obs-es2b7q
sessionId=sess-1786634957368
```

而当前 Build：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

因此：

```text
E2 Trial Delta Artifact Authority
= BUG CONFIRMED / HARNESS
```

本轮目标：

```text
1. foreground mismatch 时绝对禁止 SendInput
2. acquire foreground 后必须重新验证 HWND
3. 输入期间丢失 foreground 必须立即 INVALID
4. trial artifact 必须绑定 current Build/current session
5. stale delta / stale token artifact 必须 DROP
6. token provenance 只允许从 current accepted session evidence 生成
7. 修复后只做 Harness contract + preflight
8. Runtime reproof 只执行 Strict Startup + exactly one E2-01
```

---

# 1. HARD FREEZE

禁止修改：

```text
src/**
dist/**
Build ID
Main SHA
style.css
EmptySpecial
NormalEnter
CanonicalRecordId architecture
DocumentRuntimeContext
historical resolver
caret geometry
CSS
selection restore / repair
fixture
```

不得生成新业务 Build。

---

# 2. 本轮允许修改范围

优先：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

必要时可新增/修改：

```text
scripts/r58-matrix/*input*.mjs
scripts/r58-matrix/*foreground*.mjs
scripts/r58-matrix/*artifact*.mjs
scripts/r58-matrix/*contract*.mjs
```

除非直接必要，不修改：

```text
R58Win32Helper.cs
ensureHelperBuilt()
Roslyn compile path
e2-precondition.mjs
```

---

# 3. 禁止项

```text
PowerShell
pwsh
*.ps1
Node child_process 调用 PowerShell
git add/commit/push
retry-until-pass
```

---

# 4. 先只读定位 Input Gate

检查：

```text
foreground acquire
foreground verify
SendInput 调用
input audit writer
special-token-provenance writer
trial.delta writer
trial-summary writer
early INVALID return path
```

必须回答：

```text
foregroundMatchBefore=false 时为什么仍 injectionAttempted=true？
Acquire 后是否重新读取 actual foreground HWND？
SendInput 前是否有最后一道 foreground gate？
SendInput 后是否验证 foreground 仍属于 target Typora？
early INVALID 时是否清理/隔离旧 trial artifacts？
trial.delta.jsonl 是否可能复用历史文件？
token parser 是否校验 current Build/session？
```

---

# 5. Foreground Safety Invariant

正式冻结：

```text
Acquire target foreground
↓
read actual foreground hwnd
↓
IF actual != targetHwnd:
    INVALID / FOREGROUND_WINDOW_MISMATCH
    injectionAttempted=false
    requestedInputCount=0
    sendInputReturnCount=0
    STOP
```

绝不允许：

```text
foreground mismatch
→ still SendInput
```

---

# 6. Acquire + Verify

记录：

```text
foregroundHwndBeforeAcquire
acquireAttempted
acquireSucceeded
foregroundHwndAfterAcquire
foregroundMatchAfterAcquire
```

只有：

```text
acquireSucceeded=true
foregroundMatchAfterAcquire=true
```

才允许输入。

否则精确判：

```text
FOREGROUND_ACQUIRE_FAILED
或
FOREGROUND_WINDOW_MISMATCH
```

---

# 7. SendInput 前 CAS Gate

每个 `SendInput` 前重新读取：

```text
GetForegroundWindow()
```

若：

```text
actualForegroundHwnd != targetHwnd
```

则：

```text
FOREGROUND_LOST_BEFORE_INPUT
SendInputCallCount=0
STOP
```

---

# 8. SendInput 精确返回

要求：

```text
sendInputReturnCount === requestedInputCount
```

否则：

```text
SENDINPUT_PARTIAL_OR_FAILED
```

不得把 `returned > 0` 当成功。

---

# 9. Input 后重新验证 Foreground

记录：

```text
foregroundHwndAfterInput
foregroundMatchAfterInput
```

若 false：

```text
FOREGROUND_LOST_DURING_INPUT
```

不得继续 token provenance。

---

# 10. 精确 invalidReason

禁止继续把所有问题归为：

```text
SPECIAL_TOKEN_PROVENANCE_MISMATCH
```

至少拆分：

```text
FOREGROUND_ACQUIRE_FAILED
FOREGROUND_WINDOW_MISMATCH
FOREGROUND_LOST_BEFORE_INPUT
FOREGROUND_LOST_DURING_INPUT
SENDINPUT_PARTIAL_OR_FAILED
EDITOR_INPUT_NOT_FOCUSED
RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED
RUNTIME_BEFOREINPUT_NOT_OBSERVED
RUNTIME_INPUT_NOT_OBSERVED
IME_SEQUENCE_INCOMPLETE
SPECIAL_TOKEN_TEXT_MISMATCH
SPECIAL_TOKEN_OFFSET_MISMATCH
TOKEN_PROOF_TIMEOUT
```

---

# 11. input-injection-audit.json 升级

至少保存：

```text
targetPid
targetHwnd
foregroundHwndBeforeAcquire
acquireAttempted
acquireSucceeded
foregroundHwndAfterAcquire
foregroundMatchAfterAcquire
foregroundHwndBeforeInput
foregroundMatchBeforeInput
requestedInputCount
sendInputReturnCount
foregroundHwndAfterInput
foregroundMatchAfterInput
auditPath
runtimeSessionId
buildId
auditOffsetBeforeInput
auditOffsetAfterInput
keyboardEventObserved
beforeInputObserved
inputObserved
injectionAttempted
injectionSucceeded
overall
invalidReason
```

核心 invariant：

```text
foregroundMatchAfterAcquire=false
→ injectionAttempted=false
```

---

# 12. Trial Artifact Authority

以下当前 trial artifact 必须绑定：

```text
buildId
runtimeSessionId
auditPath
trialId
trialStartedAt
```

至少：

```text
trial.delta.jsonl
special-token-provenance.json
input-injection-audit.json
trial-summary.json
runtime-identity.json
```

---

# 13. Stale Artifact 规则

```text
artifact.buildId != expectedBuildId
→ DROP_STALE

artifact.runtimeSessionId != acceptedRuntimeSessionId
→ DROP_STALE
```

current trial 缺 delta：

```text
CURRENT_TRIAL_DELTA_NOT_AVAILABLE
```

禁止 fallback 到旧文件。

---

# 14. 每次 Trial 独立 artifact generation

推荐：

```text
artifacts/empty-special-runtime/e2-01/
  attempt-<runtimeSessionId>-<timestamp>/
```

若暂不改目录结构，trial 开始前必须：

```text
archive / rotate old files
```

不得 silent reuse，也不得无备份删除历史 evidence。

---

# 15. Freshness 校验

artifact 增加：

```text
generatedAt
trialStartedAt
trialEndedAt
runtimeSessionId
buildId
```

要求：

```text
generatedAt >= trialStartedAt
runtimeSessionId == accepted runtime session
buildId == current Build
```

---

# 16. trial.delta.jsonl 生成规则

必须从：

```text
current accepted auditPath
+
current trial byteOffsetStart
→ trial end byte offset
```

生成。

生成后验证：

```text
current Build/session only
```

若混入 stale：

```text
TRIAL_DELTA_SESSION_CONTAMINATION
→ INVALID
```

---

# 17. special-token-provenance Authority

只从 current trial delta 计算：

```text
KEYBOARD-EVENT-PROVENANCE
beforeinput
input
compositionstart
compositionend
IME-SELECTION-AUDIT
```

保存：

```text
buildId
runtimeSessionId
auditPath
tokenText
logicalOffset
imeProvenance
keyboardEventCount
beforeInputCount
inputCount
compositionStartCount
compositionEndCount
overall
invalidReason
```

---

# 18. 历史 Period 证据只能标 Historical

旧 `es2b7q` 已观察：

```text
Period ×2 → ".."
```

只能写：

```text
Physical Period → ASCII ".."
= HISTORICALLY CONFIRMED
```

当前 1jdevq：

```text
IME/token behavior = NOT YET PROVEN
```

本轮不得据此直接修改输入策略。

---

# 19. Contract Tests

至少：

```text
INPUT-1 foreground mismatch → SendInput never called
INPUT-2 acquire succeeds + target foreground → injection allowed
INPUT-3 foreground lost before input → block
INPUT-4 requested=2 returned<2 → SENDINPUT_PARTIAL_OR_FAILED
INPUT-5 foreground lost after input → invalid
INPUT-6 old Build delta ignored/archived
INPUT-7 wrong-session artifact DROP_STALE
INPUT-8 current session delta accepted
INPUT-9 current trial no delta → CURRENT_TRIAL_DELTA_NOT_AVAILABLE
INPUT-10 summary/input-audit/token-proof Build+session authority一致
```

---

# 20. 禁止重试式前台激活

允许：

```text
单次明确 AcquireForeground
+
bounded wait
+
verify
```

禁止：

```text
无限 SetForegroundWindow
循环 SendInput
retry-until-pass
```

无法稳定拿前台：

```text
INVALID → STOP
```

---

# 21. 静态验证

执行：

```text
node --check scripts/r58-matrix/run-empty-special-gate.mjs
```

以及所有新增 contract。

然后：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

必须 PASS。

不得生成业务 Build。

---

# 22. Runtime Reproof

静态全部 PASS 后，在正常 Windows Runtime：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup
```

必须 PASS。

然后只执行一次：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

然后 STOP。

禁止重复 E2-01，也禁止 E2-02/E2-03/E1/E3。

---

# 23. Formal Token Gate

只有：

```text
foreground safe
SendInput exact success
current trial artifact authority valid
```

后才判断：

```text
visibleText=="。。"
logicalOffset=2
```

以及：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

否则精确 INVALID。

---

# 24. 如果 current 1jdevq 正式证明 Period → ".."

只有 current Build/current session/current delta 证明：

```text
KEYBOARD-EVENT-PROVENANCE key="." code="Period"
visibleText=".."
logicalOffset=2
compositionSessionId=none
```

才判：

```text
PHYSICAL_PERIOD_DOES_NOT_PRODUCE_CHINESE_FULL_STOP
= CONFIRMED / CURRENT RUNTIME
```

STOP。

下一轮再设计 trusted 输入方式。

本轮禁止 clipboard/paste/不可控文本注入绕过正式输入门。

---

# 25. 如果 Token Gate PASS

只有：

```text
tokenText="。。"
logicalOffset=2
imeProvenance=true
```

才发送 Enter，并进入原 Formal EmptySpecial Gate：

```text
ALLOW_SPECIAL_COMMAND
→ EMPTY_SPECIAL
→ SAFE_EMPTY
→ NORMALIZED_TO_NATIVE_EMPTY
→ SETTLED_BY_MUTATION_QUIET
→ TRANSACTION-CLOSE
→ post-close mutation=0
→ caret geometry
```

---

# 26. Out of Scope

本轮不处理：

```text
EmptySpecial business fixes
Caret/CSS
Duplicate Lifecycle
dispose cleanup
canonical invariant
parser global cleanup
startup SyntaxError
Reduced Matrix
R60
```

Duplicate Lifecycle 保持：

```text
CONFIRMED / RUNTIME
DEFERRED
```

---

# 27. 报告

生成：

```text
docs/audits/inkchapter-e2-input-foreground-artifact-authority-fix-2026-08-13.md
artifacts/project-audit/inkchapter-e2-input-foreground-artifact-authority-fix-2026-08-13.json
```

报告至少包含：

```text
A. Frozen Build
B. Foreground Safety Root Cause
C. Input Gate Changes
D. SendInput Exactness
E. Trial Artifact Authority
F. Stale Artifact Handling
G. Contract Tests
H. Preflight
I. Strict Startup Reproof
J. E2-01 Result
K. Token Provenance
L. P0-A/B/C Status
M. Caret Status
N. Remaining Issues
O. R58.7 / R60 Verdict
```

---

# 28. 最终状态措辞

如果仅 Harness patch/tests：

```text
E2 Foreground Input Safety
= SOURCE/HARNESS FIXED
= RUNTIME PENDING

E2 Trial Artifact Authority
= SOURCE/HARNESS FIXED
= RUNTIME PENDING
```

不得写 E2/P0 已修复。

只有 Runtime reproof 后才能关闭。

---

# 29. STOP 纪律

执行：

```text
只读定位
→ 只修 Input Safety + Artifact Authority
→ Node syntax
→ Contracts
→ Preflight
→ 正常 Windows Strict Startup
→ exactly one E2-01
→ STOP
```

任何：

```text
FAIL
INVALID
ENVIRONMENT-BLOCKED
```

都：

```text
保存 evidence → STOP
```

绝不 retry-until-pass。

核心原则：

```text
foreground mismatch 时绝不 SendInput。

current trial 只能使用 current Build/current session/current byte-window evidence。

旧 es2b7q artifact 不得污染 1jdevq verdict。
```

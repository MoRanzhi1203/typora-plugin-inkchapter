# Trae — E2 Input Failure-Path Artifact Durability + Precise Verdict 修复

## 0. 任务目标

本轮只修 **Harness 的失败路径证据落盘与最终 verdict 精确分类**。

当前冻结业务 Build：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

Main SHA：

```text
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B
```

Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前 Runtime 已确认：

```text
Strict Startup = PASS / RUNTIME
E2 Runtime Precondition = PASS / RUNTIME
旧 trial artifacts = 已成功 archive

Current Build/session authority：
buildId=inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
runtimeSessionId=sess-1786672539069

Current E2-01：
INVALID / TOKEN_PROOF_TIMEOUT
sendEnterCallCount=0
```

当前 token evidence：

```text
keyboardEventCount=0
beforeInputCount=0
inputCount=0
compositionStartCount=0
compositionEndCount=0
tokenText=null
logicalOffset=null
imeProvenance=false
```

但失败路径缺失：

```text
input-injection-audit.json = MISSING
trial-delta-meta.json = MISSING
trial.delta.jsonl = MISSING
```

正式定性：

```text
E2 Input Failure-Path Artifact Durability
= BUG CONFIRMED / HARNESS

E2 Token Verdict Specificity
= BUG CONFIRMED / HARNESS
```

## 1. HARD FREEZE

禁止修改：

```text
src/**
dist/**
Build ID
Main SHA
style.css
fixture
EmptySpecial
NormalEnter
Canonical
DocumentRuntimeContext
historical resolver
caret/CSS
selection restore/repair
```

不得生成新业务 Build。

## 2. 本轮允许修改范围

只允许优先修改：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
scripts/r58-matrix/e2-input.mjs
```

以及必要的 Harness contract 模块。

## 3. 禁止项

```text
PowerShell / pwsh / *.ps1
git add / commit / push
retry-until-pass
本轮运行 E2-01
本轮运行 strict-startup
```

本轮只做 Harness patch + contracts + preflight。

## 4. INPUT FAILURE-PATH ARTIFACT DURABILITY

`injectKeys()` 完成后，不论 PASS / FOREGROUND_* INVALID / SENDINPUT_* INVALID / 后续 TOKEN gate FAIL，都必须先生成：

```text
input-injection-audit.json
```

然后才允许进入 token proof 或 return。

至少保存：

```text
buildId
runtimeSessionId
auditPath
trialId
trialStartedAt
generatedAt
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
injectionAttempted
injectionSucceeded
overall
invalidReason
```

核心 invariant：

```text
foregroundMatchAfterAcquire=false
→ injectionAttempted=false
→ requestedInputCount=0
→ sendInputReturnCount=0
```

禁止 token gate early-return 导致 input audit 丢失。

## 5. CURRENT TRIAL DELTA MUST ALWAYS EXIST

Token observation 结束时，无论 PASS / INVALID / timeout / 0 events，都必须生成：

```text
trial.delta.jsonl
trial-delta-meta.json
```

即使 current trial 完全没有 Runtime event，`trial.delta.jsonl` 也必须作为当前 trial 的合法空文件存在。

`trial-delta-meta.json` 至少保存：

```text
buildId
runtimeSessionId
auditPath
trialId
trialStartedAt
generatedAt
byteOffsetStart
byteOffsetEnd
deltaBytes
deltaLineCount
eventCount
keyboardEventCount
beforeInputCount
inputCount
compositionStartCount
compositionEndCount
staleEventDropCount
parseFailureCount
authorityValid
overall
invalidReason
```

若 0 events：

```text
deltaExists=true
eventCount=0
```

禁止省略文件、fallback old artifact、读取 `previous-*` 历史 trial。

## 6. FINAL VERDICT SPECIFICITY

`TOKEN_PROOF_TIMEOUT` 不能继续作为最终宽泛 verdict。bounded wait 到 deadline 后，根据 current-trial evidence 输出最早、最具体的失败层：

```text
input-injection-audit 不存在
→ INPUT_INJECTION_AUDIT_NOT_AVAILABLE

current trial delta 无法生成
→ CURRENT_TRIAL_DELTA_NOT_AVAILABLE

delta 存在，但 keyboardEventCount=0
→ RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED

keyboardEventCount>0 且 beforeInputCount=0
→ RUNTIME_BEFOREINPUT_NOT_OBSERVED

beforeInputCount>0 且 inputCount=0
→ RUNTIME_INPUT_NOT_OBSERVED

keyboard/beforeinput/input 已有但 composition provenance 不完整
→ IME_SEQUENCE_INCOMPLETE

IME provenance 完整但 tokenText != "。。"
→ SPECIAL_TOKEN_TEXT_MISMATCH

tokenText=="。。" 但 logicalOffset != 2
→ SPECIAL_TOKEN_OFFSET_MISMATCH
```

`TOKEN_PROOF_TIMEOUT` 只允许作为 observation loop 尚未结束时的内部状态。

## 7. SINGLE VERDICT AUTHORITY

建立单一最终判定，例如：

```text
evaluateTokenProofFinal(observation, inputAudit, deltaMeta)
```

返回：

```text
overall
invalidReason
tokenText
logicalOffset
imeProvenance
keyboardEventCount
beforeInputCount
inputCount
compositionStartCount
compositionEndCount
```

以下 artifact 必须共享同一最终 verdict：

```text
trial-summary.json
special-token-provenance.json
trial-delta-meta.json
```

禁止出现互相矛盾的 `invalidReason`。

## 8. CURRENT BUILD / SESSION AUTHORITY

所有 evidence 继续绑定：

```text
buildId
runtimeSessionId
auditPath
trialId
trialStartedAt
```

wrong Build / wrong session / wrong auditPath 必须 `DROP_STALE`，不能参与 current verdict。

## 9. Contract Tests

至少新增：

```text
ARTIFACT-1 Token timeout 时 input-injection-audit 仍存在
ARTIFACT-2 0 Runtime events 时 trial.delta.jsonl 仍生成
ARTIFACT-3 0 Runtime events 时 trial-delta-meta eventCount=0
ARTIFACT-4 keyboardEventCount=0 → RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED
ARTIFACT-5 keyboard>0 / beforeinput=0 → RUNTIME_BEFOREINPUT_NOT_OBSERVED
ARTIFACT-6 beforeinput>0 / input=0 → RUNTIME_INPUT_NOT_OBSERVED
ARTIFACT-7 input 存在但 composition 不完整 → IME_SEQUENCE_INCOMPLETE
ARTIFACT-8 wrong Build/session evidence → DROP_STALE
ARTIFACT-9 special-token-provenance / trial-delta-meta / trial-summary invalidReason 一致
ARTIFACT-10 任何 early INVALID → 先完成 artifact write/flush → 再 return
```

## 10. 静态验证

修改完成后只执行：

```text
node --check scripts/r58-matrix/run-empty-special-gate.mjs
node --check scripts/r58-matrix/e2-input.mjs
```

运行新增 Harness contracts。

然后：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

必须 PASS。

## 11. 本轮 STOP

到 Harness patch + contracts PASS + preflight PASS 即 STOP。

禁止本轮执行：

```text
--mode strict-startup
--scenario E2 --trial 01
```

Runtime reproof 下一轮再做。

## 12. 审计报告

生成：

```text
docs/audits/inkchapter-e2-input-failure-artifact-verdict-fix-2026-08-13.md
artifacts/project-audit/inkchapter-e2-input-failure-artifact-verdict-fix-2026-08-13.json
```

报告至少包含：

```text
A. Frozen Build
B. Current Runtime Evidence
C. Failure-Path Artifact Bug
D. Delta Always-Write Design
E. Final Verdict Resolution
F. Single Verdict Authority
G. Build/Session Authority
H. Contract Tests
I. Preflight
J. Runtime Reproof Status
K. P0-A/B/C Status
L. Caret Status
M. R58.7 / R60 Verdict
```

## 13. 最终状态措辞

如果 Harness patch/tests/preflight 完成：

```text
E2 Input Failure-Path Artifact Durability
= SOURCE/HARNESS FIXED / RUNTIME PENDING

E2 Token Verdict Specificity
= SOURCE/HARNESS FIXED / RUNTIME PENDING
```

不得写：

```text
Foreground Input Safety = RUNTIME PASS
E2-01 = FIXED
P0 = FIXED
```

## 14. 本轮核心原则

```text
下一次 Runtime trial 无论在哪里失败，
都必须留下完整、
current Build、
current session、
current byte-window、
可判定的 evidence。
```

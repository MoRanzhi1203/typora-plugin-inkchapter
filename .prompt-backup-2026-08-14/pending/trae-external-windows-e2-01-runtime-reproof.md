# Trae / External Windows Runtime — E2-01 单次复证交接门禁

## 0. 任务性质

本轮**不再修改代码**。当前 Harness 修复已经完成并通过静态验证：

```text
E2 Foreground Input Safety = SOURCE/HARNESS FIXED / RUNTIME PENDING
E2 Trial Artifact Authority = SOURCE/HARNESS FIXED / RUNTIME PENDING
```

本轮唯一目标：

```text
1. 在正常 Windows Runtime 中复证 Strict Startup
2. 仅执行一次 E2-01
3. 保存当前 trial artifacts
4. STOP
```

禁止在 Trae 沙箱中替代执行 Runtime gate。

---

# 1. 当前冻结业务 Build

```text
Build ID:
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

Main SHA:
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

Style SHA:
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

项目：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

目标 fixture：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\r58-empty-special-e2-01.md
```

---

# 2. 当前状态

```text
Strict Startup
= PREVIOUSLY PASS / RUNTIME
= MUST REPROVE AFTER LATEST HARNESS PATCH

E2 Runtime Precondition
= PREVIOUSLY PASS / RUNTIME

E2 Precondition False-INVALID
= CLOSED / RUNTIME

Foreground Input Safety
= SOURCE/HARNESS FIXED / RUNTIME PENDING

Trial Artifact Authority
= SOURCE/HARNESS FIXED / RUNTIME PENDING

P0-A/B/C
= SOURCE FIXED / RUNTIME PENDING

Caret Geometry
= UNKNOWN ON CURRENT BUILD

R58.7 = NOT CLOSED
R60 = NO-GO
```

---

# 3. HARD FREEZE

本轮禁止修改：

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

run-empty-special-gate.mjs
e2-input.mjs
e2-precondition.mjs
Harness contracts
```

本轮不是修复轮，而是 Runtime 复证轮。

---

# 4. 禁止项

禁止：

```text
PowerShell / pwsh / *.ps1
git add / commit / push
retry-until-pass
手工修改 fixture
手工输入“。。”
手工移动 caret
手工切换输入法来掩盖 Harness 失败
重复执行 E2-01
执行 E2-02 / E2-03 / E1 / E3
```

任何 `FAIL / INVALID / ENVIRONMENT-BLOCKED`：保存 evidence → STOP。

---

# 5. 外部 Windows CMD — 第一步

用户本人在普通 Windows CMD 中执行：

```bat
cd /d D:\TyporaPluginProjects\typora-plugin-inkchapter
node scripts\r58-matrix\run-empty-special-gate.mjs --mode strict-startup
```

---

# 6. Strict Startup 必须明确 PASS

只有出现：

```text
strict startup verdict=PASS failedChecks=
```

才允许继续。

`strict-startup.json` 必须满足：

```text
oldProcessExited=true
processCountAfterClose=0
newPid=<current>
newStartTime=<current launch>
mainWindowHandle != 0
mainWindowTitle != ""

targetVault=D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
targetDocument=r58-empty-special-e2-01.md

projectMainSHA=238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B
runtimeMainSHA=238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B
shaMatch=true
styleSHA=F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
runtimeBuildId=inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
initializationCount=1
runtimeLoadFresh=true
readinessReady=true
auditDecision=ACCEPT
strictStartup=true
verdict=PASS
failedChecks=[]
```

任一失败：STOP，不执行 E2-01。

---

# 7. 外部 Windows CMD — 第二步

仅当 Strict Startup PASS 后，执行唯一一次：

```bat
node scripts\r58-matrix\run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

执行完立即 STOP，禁止重跑。

---

# 8. E2 Runtime Precondition

期望：

```text
E2-RUNTIME-PRECONDITION
overall=true
invalidReason=null
```

且：

```text
documentContextReadyObserved=true
sidecarLoadObserved=true
sidecarExists=false
sidecarRecordCount=0
auditAuthorityAccepted=true
```

若出现 `DOCUMENT_CONTEXT_* / SIDECAR_* / AUDIT_* / TRIAL_DELTA_* / CURRENT_TRIAL_DELTA_NOT_AVAILABLE`：保存 artifact → STOP。

---

# 9. Foreground Input Safety 复证

Harness 必须证明：

```text
AcquireForeground
→ actual foreground == targetHwnd
→ SendInput 前 CAS 仍一致
→ exact SendInput
→ 输入后 foreground 仍一致
```

核心 invariant：

```text
foreground != targetHwnd
→ SendInputCallCount=0
→ injectionAttempted=false
→ INVALID / STOP
```

若再次出现：

```text
foregroundMatch=false
但 injectionAttempted=true
```

正式判：

```text
E2 Foreground Input Safety = FAIL / CURRENT RUNTIME
```

STOP。

---

# 10. Trial Artifact Authority 复证

当前 trial artifact 必须属于：

```text
Build=inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
Current accepted runtime session
Current auditPath
Current E2-01 attempt
```

旧 Build `inkchapter-r58-7-p0-empty-special-arm-obs-es2b7q` 禁止参与 current verdict。

若 delta/meta 出现 old Build 或 old session：

```text
TRIAL_DELTA_SESSION_CONTAMINATION
或等价 stale reason
→ INVALID → STOP
```

---

# 11. Token Gate

只有 foreground safety + artifact authority PASS 后才判断 token。

Formal token 必须：

```text
tokenText="。。"
logicalOffset=2
imeProvenance=true
```

IME provenance 必须包含：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

若出现：

```text
RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED
RUNTIME_BEFOREINPUT_NOT_OBSERVED
RUNTIME_INPUT_NOT_OBSERVED
IME_SEQUENCE_INCOMPLETE
SPECIAL_TOKEN_TEXT_MISMATCH
SPECIAL_TOKEN_OFFSET_MISMATCH
TOKEN_PROOF_TIMEOUT
```

则：

```text
E2-01 = INVALID / INPUT GATE
→ STOP
```

不得重试。

---

# 12. Current 1jdevq 若正式证明 Period → ".."

只有 current Build/current session/current delta 明确出现：

```text
KEYBOARD-EVENT-PROVENANCE key="." code="Period"
visibleText=".."
logicalOffset=2
compositionSessionId=none
```

才正式判：

```text
PHYSICAL_PERIOD_DOES_NOT_PRODUCE_CHINESE_FULL_STOP
= CONFIRMED / CURRENT RUNTIME
```

然后 STOP。本轮禁止用 clipboard/paste/脚本写文本绕过 trusted input gate。

---

# 13. 只有 Token Gate PASS 才允许 Enter

只有：

```text
tokenText="。。"
logicalOffset=2
imeProvenance=true
```

才允许 Harness 发送 Enter，进入 EmptySpecial Runtime gate。

---

# 14. P0-C Routing

必须：

```text
ENTER-ADMISSION-AUDIT decision=ALLOW_SPECIAL_COMMAND
SPECIAL-COMMAND-ROUTING-AUDIT selectedPath=EMPTY_SPECIAL
```

否则：

```text
P0-C = FAIL / RUNTIME
→ STOP
```

---

# 15. P0-A Empty DOM Predicate / Normalization

必须：

```text
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE
safeEmptyTextShape=true
decision=SAFE_EMPTY
```

以及：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION
decision=NORMALIZED_TO_NATIVE_EMPTY
nativeEmptyEquivalentAfter=true
markdownContentChanged=false
overall=true
```

否则：

```text
P0-A = FAIL / RUNTIME
→ STOP
```

---

# 16. P0 Settle Gate

必须：

```text
EMPTY-SPECIAL-MUTATION-WINDOW-ARM
observer arm preconditions=true
observerArmedAt < tokenConsumedAt
```

随后：

```text
EMPTY-SPECIAL-SETTLE-AUDIT
relevantMutationCount>=1
quietBoundaryReached=true
decision=SETTLED_BY_MUTATION_QUIET
```

`TIMEOUT_BLOCK` = 真实业务 FAIL。

`relevantMutationCount=0` = INVALID / observability failure，STOP。

---

# 17. P0-B Terminal Cleanup

必须：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE
observerDisconnected=true
timeoutCleared=true
activeTxnCleared=true
terminal=true
```

并且：

```text
post-close same txn EMPTY-SPECIAL-MUTATION count=0
```

否则：

```text
P0-B = FAIL / RUNTIME
→ STOP
```

---

# 18. Caret Geometry

目标：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
expectedIndentPx≈32
actualCaretIndentPx≈32
caretVisualCorrect=true
```

如果：

```text
nativeEmptyEquivalentAfter=true
semantic/logical gates=true
expected≈32
actual≈0
caretVisualCorrect=false
```

正式判：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / CURRENT BUILD RUNTIME
```

STOP，本轮禁止立即追加 CSS workaround。

---

# 19. EmptySpecial Final

唯一 Runtime PASS：

```text
EMPTY-SPECIAL-FINAL
logicalOwnerCorrect=true
structurePreserved=true
semanticCorrect=true
visualIndentCorrect=true
caretLogicalCorrect=true
caretVisualCorrect=true
overall=true
```

成立则：

```text
E2-01 = PASS / RUNTIME
```

然后 STOP，仍禁止 E2-02/E1/E3。

---

# 20. 必须保存的 artifacts

收集当前 E2-01 attempt 的：

```text
strict-startup.json
trial-precondition.json
input-injection-audit.json
special-token-provenance.json
trial-delta-meta.json
trial.delta.jsonl
runtime-identity.json
trial-summary.json
parser-out.json
```

若 Harness 使用 `attempt-<runtimeSessionId>-<timestamp>`，必须选择本次最新 attempt。

不要用 `previous-*` 历史目录作为 current verdict evidence。

---

# 21. 外部执行后只读分析

用户完成 CMD 后，把：

```text
CMD 完整输出
+
当前 attempt artifacts
```

交回分析。

此时只允许：

```text
读取 evidence
→ 判定当前最早失败 gate
```

不要在同一轮自动修改代码。

---

# 22. 结果分类

只允许：

```text
Strict Startup = FAIL / INVALID
E2 Runtime Precondition = FAIL / INVALID
Foreground Input Safety = FAIL / RUNTIME
Trial Artifact Authority = FAIL / RUNTIME
Token Gate = INVALID / CURRENT RUNTIME
P0-C = FAIL / RUNTIME
P0-A = FAIL / RUNTIME
P0-B = FAIL / RUNTIME
Caret = FAIL / RUNTIME
E2-01 = PASS / RUNTIME
```

不要把上游 INVALID 写成 EmptySpecial FAIL。

---

# 23. R58.7 / R60

除非 E2-01 真正 `PASS / RUNTIME`，否则保持：

```text
R58.7 = NOT CLOSED
R60 = NO-GO
```

即使 E2-01 PASS，也先 STOP，reduced matrix 另开一轮。

---

# 24. STOP 纪律

执行顺序：

```text
Normal Windows CMD
↓
Strict Startup
↓
IF PASS
↓
exactly one E2-01
↓
保存 artifacts
↓
STOP
```

任何 `FAIL / INVALID / ENVIRONMENT-BLOCKED`：保存 evidence → STOP。

禁止 retry-until-pass。

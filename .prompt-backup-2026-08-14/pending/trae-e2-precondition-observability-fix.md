# Trae — 修复 E2 Precondition False-INVALID / Audit Observability / Artifact Authority

## 0. 任务目标

本轮只修 **E2-01 Runtime Gate 的 Harness Precondition 误判问题**。

当前真实 Windows Runtime 已经证明：

```text
Strict Startup
= PASS / RUNTIME

Build
= inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

Main SHA
= 238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

Style SHA
= F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

Runtime Build
= ACTIVE / VERIFIED

Initialization Count
= 1

shaMatch
= true

runtimeLoadFresh
= true

readinessReady
= true

auditDecision
= ACCEPT
```

Formal Strict Startup artifact 已证明：

```text
newPid=708
newStartTime=2026-08-13T19:04:11.9431645+00:00
MainWindowHandle=1772720
MainWindowTitle=r58-empty-special-e2-01.md - Typora

targetDocument=r58-empty-special-e2-01.md
runtimeBuildId=inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
initializationCount=1
strictStartup=true
verdict=PASS
failedChecks=[]
```

但是 E2-01 当前结果：

```text
verdict=INVALID
invalidReason=FIXTURE_TOPOLOGY_MISMATCH
sendEnterCallCount=0
```

这不是 EmptySpecial 业务 FAIL。

当前源码已经证明所谓 `FIXTURE_TOPOLOGY_MISMATCH` 实际判断：

```js
const topologyOk =
  !!ctxReady &&
  !!sidecarLoad &&
  getField(sidecarLoad, 'exists') === false &&
  getField(sidecarLoad, 'recordCount') === 0;
```

即它检查的实际语义是：

```text
DOCUMENT-CONTEXT-READY 是否被 Runner 观察到
+
SIDECAR-ACTUAL-LOAD 是否被 Runner 观察到
+
sidecar exists=false
+
sidecar recordCount=0
```

而不是：

```text
paragraph topology
target paragraph empty
target trailing
previous/next paragraph
```

因此本轮目标是：

```text
修正 E2 precondition 的真实语义
+
消除 audit JSONL availability / polling race
+
让 trial-precondition.json 成为最终 INVALID/PASS 的权威证据
+
去除 JSON artifact BOM
+
重新执行唯一一次 clean E2-01
```

---

# 1. 当前关键证据

## 1.1 E2-01 当前 summary

```json
{
  "mode": "run",
  "scenario": "E2",
  "trialId": "e2-01",
  "verdict": "INVALID",
  "invalidReason": "FIXTURE_TOPOLOGY_MISMATCH",
  "sendEnterCallCount": 0,
  "failedChecks": [
    "FIXTURE_TOPOLOGY_MISMATCH"
  ]
}
```

这证明：

```text
business input NOT SENT
Enter NOT SENT
EmptySpecial transaction NOT STARTED
```

因此：

```text
P0-A = RUNTIME PENDING
P0-B = RUNTIME PENDING
P0-C = RUNTIME PENDING
Caret Geometry = RUNTIME PENDING
```

不得把本次 INVALID 当作业务失败。

---

## 1.2 当前 trial-precondition.json

当前文件实际内容：

```json
{
  "scenario": "E2",
  "trialId": "e2-01",
  "fixture": "r58-empty-special-e2-01.md",
  "processCountAfterClose": 0,
  "sidecarExists": false,
  "sidecarRecordCount": -1,
  "fixtureExists": true,
  "clean": true,
  "invalidReason": null
}
```

但最终 summary 却：

```text
invalidReason=FIXTURE_TOPOLOGY_MISMATCH
```

说明：

```text
trial-precondition artifact
!=
final precondition verdict authority
```

这是本轮必须修的 Harness 缺陷。

---

## 1.3 BOM 已确认

当前 `trial-precondition.json` 文件头：

```text
efbbbf
```

即：

```text
UTF-8 BOM = CONFIRMED
```

CMD `type` 因此显示：

```text
锘縶
```

本轮顺手修正 JSON writer：

```text
UTF-8 without BOM
```

但 BOM 只是输出问题，不是 Runtime gate 根因。

---

## 1.4 Runtime 已经观察到真实 READY / clean sidecar

真实 renderer runtime 已出现：

```text
DOCUMENT-CONTEXT-READY
mode=PERSISTED
scopeId=r58-empty-special-e2-01.md
businessReady=true
persistenceReady=true
decision=READY
```

同时出现：

```text
SIDECAR-ACTUAL-LOAD
documentKey=r58-empty-special-e2-01.md
exists=false
recordCount=0
source=physical
backend=filesystem
```

而且 `SIDECAR-ACTUAL-LOAD` 在真实 Runtime 中出现两次。

因此：

```text
fixture disk baseline = CLEAN
runtime context READY = OBSERVED
runtime sidecar exists=false recordCount=0 = OBSERVED
```

Runner 却仍判：

```text
topologyOk=false
```

当前强结论：

```text
E2 PRECONDITION OBSERVABILITY / ARTIFACT AUTHORITY
= BUG CONFIRMED / HARNESS
```

高概率根因：

```text
JSONL audit availability / polling / session-window race
```

但不要在未读源码前把具体 race 机制写成“已证明”。

---

# 2. HARD FREEZE

本轮严禁修改：

```text
src/**
dist/**
Build ID
Main SHA
style.css

EmptySpecial business logic
NormalEnter
CanonicalRecordId architecture
DocumentRuntimeContext
historical resolver
caret geometry
CSS
selection/caret restore logic
```

当前业务 Build 必须继续保持：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

不得生成新业务 Build。

---

# 3. 本轮唯一允许修改范围

优先只允许：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

必要时允许新增/修改：

```text
scripts/r58-matrix/*precondition*.mjs
scripts/r58-matrix/*harness*contract*.mjs
scripts/r58-matrix/*parser*contract*.mjs
```

不要修改：

```text
R58Win32Helper.cs
Roslyn direct compile path
ensureHelperBuilt()
multi-cwd root resolution
```

除非本轮调查发现与该 bug 直接相关的新独立证据。

---

# 4. 禁止 PowerShell

全程禁止：

```text
powershell.exe
pwsh
*.ps1
Node child_process 调用 PowerShell
```

只使用：

```text
node
dotnet
现有 Win32 helper
```

---

# 5. 第一阶段：只读定位当前 false INVALID

先读取：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

重点检查：

```text
strict startup 返回的 accepted auditPath/session authority
run mode 重新 strict-startup 后使用哪个 auditPath
audit file 选择逻辑
byte-offset 起点
JSONL delta read
wait/poll helper
FORENSIC-SINK-FLUSH 的处理
DOCUMENT-CONTEXT-READY 查找
SIDECAR-ACTUAL-LOAD 查找
topologyOk 计算
trial-precondition artifact 写入
trial-summary artifact 写入
```

必须明确回答：

```text
ctxReady 从哪里读取？
sidecarLoad 从哪里读取？
读的是 strict-startup 的 accepted audit file 吗？
是否可能读到 stale audit？
是否在事件落盘前只读一次？
是否有等待 current-session evidence？
是否用 LastWriteTime 重新选择 audit file？
是否可能 strict-startup 已 ACCEPT A，但 run precondition 又读 B？
```

---

# 6. 修正术语：废弃 FIXTURE_TOPOLOGY_MISMATCH

当前错误名误导。

禁止继续用一个：

```text
FIXTURE_TOPOLOGY_MISMATCH
```

覆盖所有 context/sidecar precondition 失败。

至少拆成：

```text
DOCUMENT_CONTEXT_READY_NOT_OBSERVED

DOCUMENT_CONTEXT_SCOPE_MISMATCH

SIDECAR_ACTUAL_LOAD_NOT_OBSERVED

SIDECAR_DOCUMENT_KEY_MISMATCH

SIDECAR_EXISTS_UNEXPECTEDLY

SIDECAR_RECORD_COUNT_NONZERO

SIDECAR_SOURCE_NOT_PHYSICAL

AUDIT_SESSION_AUTHORITY_MISMATCH

AUDIT_PRECONDITION_TIMEOUT

AUDIT_JSONL_PARSE_FAILURE
```

如果真正检查 paragraph topology，另用：

```text
PARAGRAPH_TOPOLOGY_MISMATCH
```

不要混用。

---

# 7. Strict Startup audit authority 必须传递到 run precondition

Formal rule：

```text
Strict Startup PASS
↓
得到 accepted:
  auditPath
  audit session identity
  runtime Build identity
  runtime-load identity
↓
run mode precondition
必须继续使用同一个 accepted audit authority
```

禁止：

```text
Strict Startup ACCEPT audit=A
↓
run precondition
重新按 LastWriteTime 猜 audit=B
```

建议引入显式对象：

```js
RuntimeAuditAuthority {
  auditPath
  runtimeSessionId
  buildId
  targetDocument
  acceptedAt
  byteOffsetAtAccept
}
```

`strictStartup()` 返回这个 authority。

`runScenario()` 必须显式消费它。

---

# 8. Precondition 不能立即单次读取

当前 forensic sink：

```text
memory queue
→ async batch flush
→ JSONL
```

因此：

```text
console event 已发生
!=
JSONL 当前毫秒已经可读
```

Precondition 必须使用 bounded wait/poll。

建议：

```text
waitForRuntimePreconditions({
  auditAuthority,
  expectedDocumentKey,
  expectedScopeId,
  timeoutMs,
  pollIntervalMs
})
```

示意：

```text
startOffset = accepted authority byte offset

loop until deadline:
  read JSONL delta from current offset
  validate UTF-8 / JSONL
  accumulate only current accepted session
  detect DOCUMENT-CONTEXT-READY
  detect SIDECAR-ACTUAL-LOAD

  if both authoritative conditions satisfied:
      PASS

  wait pollInterval
```

推荐：

```text
timeoutMs ≈ 3000–5000
pollIntervalMs ≈ 50–100
```

不要无限等待。

不要 retry-until-pass。

这是同一个 trial 内的 bounded observation wait，不是重新执行 trial。

---

# 9. 必须以 current accepted session 为作用域

只接受：

```text
buildId ==
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

并且：

```text
document/scope ==
r58-empty-special-e2-01.md
```

以及 accepted session identity。

旧 session、旧 Build、旧 es2b7q 事件必须：

```text
DROP_STALE
```

不能参与 precondition。

如果 event schema 中没有每条都带 sessionId：

必须使用当前 audit file authority + byte window + runtime identity 三重约束。

禁止仅凭：

```text
event name
+
LastWriteTime
```

匹配。

---

# 10. DOCUMENT-CONTEXT-READY 判定

正式要求：

```text
event=DOCUMENT-CONTEXT-READY

mode=PERSISTED
scopeId=r58-empty-special-e2-01.md
businessReady=true
persistenceReady=true
decision=READY
```

如果 event 存在但 scope 错：

```text
DOCUMENT_CONTEXT_SCOPE_MISMATCH
```

如果 deadline 内完全没看到：

```text
DOCUMENT_CONTEXT_READY_NOT_OBSERVED
```

不要归类为 fixture topology。

---

# 11. SIDECAR-ACTUAL-LOAD 判定

正式要求：

```text
event=SIDECAR-ACTUAL-LOAD

documentKey=r58-empty-special-e2-01.md
exists=false
recordCount=0
source=physical
backend=filesystem
```

如果没观察到：

```text
SIDECAR_ACTUAL_LOAD_NOT_OBSERVED
```

如果：

```text
exists=true
```

则：

```text
SIDECAR_EXISTS_UNEXPECTEDLY
```

如果：

```text
recordCount != 0
```

则：

```text
SIDECAR_RECORD_COUNT_NONZERO
```

如果：

```text
source != physical
```

则：

```text
SIDECAR_SOURCE_NOT_PHYSICAL
```

---

# 12. Duplicate lifecycle 不要在本轮修

真实 Runtime 已观察到：

```text
EDITOR-RUNTIME-BOUND ×2
DOCUMENT-CONTEXT-READY ×2
SIDECAR-ACTUAL-LOAD ×2
```

这已经是：

```text
P2 Duplicate Lifecycle
= CONFIRMED / RUNTIME
```

但是本轮不要修它。

Precondition parser 必须能够：

```text
接受同一 authoritative session 中重复但语义一致的 READY/load
```

例如：

```text
2 个 SIDECAR-ACTUAL-LOAD
都为：
exists=false
recordCount=0
source=physical
```

则：

```text
precondition = PASS
duplicateCount = 2
```

同时把 duplicateCount 写 artifact，留给 Phase 2。

不要因为 exactly-one 要求把当前 E2 判 INVALID。

---

# 13. Precondition artifact 必须变成权威证据

重做：

```text
artifacts/empty-special-runtime/e2-01/trial-precondition.json
```

至少保存：

```json
{
  "scenario": "E2",
  "trialId": "e2-01",

  "expectedBuildId": "...",
  "expectedDocumentKey": "r58-empty-special-e2-01.md",
  "expectedScopeId": "r58-empty-special-e2-01.md",

  "auditPath": "...",
  "auditAuthorityAccepted": true,

  "fixtureExists": true,
  "fixtureClean": true,

  "documentContextReadyObserved": true,
  "documentContextReadyCount": 2,
  "documentContextMode": "PERSISTED",
  "documentContextScopeId": "r58-empty-special-e2-01.md",
  "documentContextDecision": "READY",

  "sidecarLoadObserved": true,
  "sidecarLoadCount": 2,
  "sidecarDocumentKey": "r58-empty-special-e2-01.md",
  "sidecarExists": false,
  "sidecarRecordCount": 0,
  "sidecarSource": "physical",

  "waitStartedAt": "...",
  "waitEndedAt": "...",
  "waitDurationMs": 0,
  "pollCount": 0,

  "jsonlParseFailureCount": 0,
  "staleEventDropCount": 0,

  "overall": true,
  "invalidReason": null
}
```

如果失败：

```text
overall=false
invalidReason=<exact enum>
```

`trial-summary.json.invalidReason` 必须直接来自该 artifact 的最终判定。

禁止：

```text
trial-precondition.invalidReason=null
trial-summary.invalidReason=某个别的值
```

---

# 14. Single verdict authority

建立单一函数：

```js
evaluateE2Precondition(...)
```

返回：

```js
{
  overall,
  invalidReason,
  checks,
  observations,
  authority
}
```

然后：

```text
trial-precondition.json
trial-summary.json
console log
```

全部引用同一个结果。

禁止三个地方各自重新判断。

---

# 15. JSON artifact 统一 UTF-8 无 BOM

所有新写 JSON：

```js
fs.writeFileSync(
  filePath,
  JSON.stringify(data, null, 2) + '\n',
  'utf8'
)
```

要求：

```text
head bytes != efbbbf
```

增加 contract：

```text
JSON-UTF8-NO-BOM = PASS
```

已有旧 BOM artifact 不需要迁移。

---

# 16. JSONL 增量读取必须保持 UTF-8 byte correctness

不得破坏已经通过的：

```text
JSONL-OFFSET-UTF8-SMOKE = PASS
unicodeIntact=true
parseFailureCount=0
```

读取仍必须：

```text
byte offsets
TextDecoder("utf-8", { fatal: true })
```

禁止按 JS string length 当 byte offset。

---

# 17. Harness Contract Tests

本轮至少新增以下 contract。

## PRECOND-1 — delayed context event

模拟：

```text
第一次 poll:
no DOCUMENT-CONTEXT-READY

第二次 poll:
READY arrives
```

期望：

```text
PASS
not INVALID
```

## PRECOND-2 — delayed sidecar event

模拟：

```text
READY 已存在
sidecar 在后续 poll 才出现
```

期望 PASS。

## PRECOND-3 — timeout missing context

期望：

```text
INVALID
DOCUMENT_CONTEXT_READY_NOT_OBSERVED
```

## PRECOND-4 — timeout missing sidecar

期望：

```text
INVALID
SIDECAR_ACTUAL_LOAD_NOT_OBSERVED
```

## PRECOND-5 — dirty sidecar

```text
exists=true
```

期望：

```text
SIDECAR_EXISTS_UNEXPECTEDLY
```

## PRECOND-6 — nonzero records

```text
recordCount=1
```

期望：

```text
SIDECAR_RECORD_COUNT_NONZERO
```

## PRECOND-7 — stale previous session ignored

旧 session 有 READY/load，新 accepted session 没有。

期望：

```text
INVALID
不得误 PASS
```

## PRECOND-8 — duplicate consistent lifecycle

同 accepted session：

```text
READY ×2
SIDECAR-ACTUAL-LOAD ×2
```

且语义一致。

期望：

```text
PASS
readyCount=2
sidecarLoadCount=2
```

## PRECOND-9 — summary/artifact authority

断言：

```text
trialSummary.invalidReason
===
trialPrecondition.invalidReason
```

## PRECOND-10 — UTF-8 no BOM

新 JSON artifact：

```text
first3Bytes != EF BB BF
```

---

# 18. 不要伪造 paragraph topology

本轮不得为了让 E2 通过而：

```text
手工插入空段落
改 fixture 为更多空行
发送额外 Enter
移动 caret
修改 Runtime DOM
```

原因：

当前 FALSE INVALID 并未证明 paragraph topology 有问题。

只有 future artifact 真正加入 paragraph topology probe 并证明失败，才允许另开一轮处理。

---

# 19. Precondition 命名建议

当前源码注释：

```text
Runtime topology precondition
```

应改成更准确的：

```text
Runtime context / sidecar authority precondition
```

变量：

```text
topologyOk
```

建议改：

```text
runtimePreconditionOk
```

或：

```text
contextSidecarPreconditionOk
```

避免以后误判。

---

# 20. 本轮静态验证

修改 harness 后执行：

```text
node --check scripts/r58-matrix/run-empty-special-gate.mjs
```

以及所有新 contract tests。

再执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

必须：

```text
PASS
shaMatch=true
styleMatch=true
fixtureClean=true
```

不得生成新业务 Build。

---

# 21. Runtime Reproof

静态/harness contract 全 PASS 后，才在正常 Windows Runtime 执行。

## 21.1 Strict Startup

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup
```

必须再次：

```text
PASS
```

## 21.2 唯一一次 E2-01

Strict Startup PASS 后：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

只执行一次。

然后 STOP。

禁止：

```text
E2-02
E2-03
E1
E3
retry-until-pass
```

---

# 22. E2-01 Run 的新 precondition PASS 要求

正式业务输入前必须输出类似：

```text
E2-RUNTIME-PRECONDITION

auditAuthorityAccepted=true

documentContextReadyObserved=true
documentContextReadyCount>=1
scopeId=r58-empty-special-e2-01.md
decision=READY

sidecarLoadObserved=true
sidecarLoadCount>=1
documentKey=r58-empty-special-e2-01.md
exists=false
recordCount=0
source=physical

jsonlParseFailureCount=0
overall=true
invalidReason=null
```

只有：

```text
overall=true
```

才允许进入 token provenance / SendInput。

---

# 23. Formal E2 业务 Gate 保持不变

Harness precondition PASS 后，原业务门禁不变。

必须：

```text
visibleText=="。。"
logicalOffset=2

compositionstart
beforeinput insertCompositionText
input
compositionend
```

随后：

```text
ALLOW_SPECIAL_COMMAND
→ selectedPath=EMPTY_SPECIAL
```

以及：

```text
SAFE_EMPTY
NORMALIZED_TO_NATIVE_EMPTY
SETTLED_BY_MUTATION_QUIET
TRANSACTION-CLOSE cleanup correct
post-close same txn mutation=0
```

最后才判断：

```text
expectedIndentPx≈32
actualCaretIndentPx≈32 or ≈0
```

---

# 24. E2-01 分支纪律

## 如果 precondition 仍 INVALID

保存：

```text
trial-precondition.json
trial-summary.json
relevant delta JSONL
```

STOP。

不得自动重跑。

## 如果 precondition PASS，但 P0-A/B/C FAIL

保存 runtime evidence，STOP。

下一轮只修实际失败层。

## 如果 P0-A/B/C PASS，但 caret≈0

正式判：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / CURRENT BUILD RUNTIME
```

STOP。

下一轮才做 empty-only visual projection。

## 如果 E2-01 全 PASS

正式：

```text
E2-01 = PASS / RUNTIME
```

STOP。

下一轮才进入 P2/P3。

---

# 25. 当前明确 Out of Scope

本轮不处理：

```text
P2 Duplicate Lifecycle
dispose() lifecycle cleanup
canonical existingId missing -> BLOCK
parser single authority（除 precondition verdict authority 的必要局部收敛）
TRANSACTION-CLOSE naming
startup SyntaxError attribution
process.cwd fallback
R60
Reduced Matrix
```

其中：

```text
P2 Duplicate Lifecycle
= CONFIRMED / RUNTIME
```

但必须等 E2-01 关闭后处理。

Startup：

```text
SyntaxError: Unexpected token ')'
```

仍保持：

```text
EXISTS
InkChapter causality NOT PROVEN
OUT OF CURRENT P0 SCOPE
```

---

# 26. 产出报告

生成：

```text
docs/audits/inkchapter-e2-precondition-observability-fix-2026-08-13.md
```

以及：

```text
artifacts/project-audit/inkchapter-e2-precondition-observability-fix-2026-08-13.json
```

报告必须包含：

```text
A. Frozen Build
B. Root Cause / Source Finding
C. Old False-INVALID Semantics
D. Audit Authority Design
E. Wait/Poll Design
F. Invalid Reason Taxonomy
G. Artifact Authority
H. UTF-8 BOM Fix
I. Contract Tests
J. Preflight
K. Strict Startup Reproof
L. E2-01 Result
M. P0-A/B/C Runtime Status
N. Caret Runtime Status
O. Remaining Issues
P. R58.7 / R60 Verdict
```

---

# 27. 最终状态措辞

如果本轮只完成 harness patch 和 tests，但尚未 Runtime：

```text
E2 Precondition Observability
= SOURCE/HARNESS FIXED
= RUNTIME PENDING
```

不得写：

```text
E2-01 fixed
P0 fixed
```

如果 Runtime E2-01 precondition PASS：

```text
E2 Precondition False-INVALID
= CLOSED / RUNTIME
```

然后根据业务 transaction 实际结果单独判断 P0。

---

# 28. STOP 纪律

本轮执行顺序：

```text
只读定位
↓
只修 Harness precondition
↓
Node syntax
↓
Harness contracts
↓
Preflight
↓
正常 Windows Strict Startup
↓
唯一一次 E2-01
↓
STOP
```

任何：

```text
FAIL
INVALID
ENVIRONMENT-BLOCKED
```

都：

```text
保存 evidence
→ STOP
```

绝不 retry-until-pass。

---

# 29. 本轮核心原则

```text
当前问题不是 EmptySpecial 业务逻辑被证明失败。

当前问题是：

Runner 已经得到 INVALID，
但 artifact 无法说明为何 INVALID，
且真实 Runtime 已出现 READY + clean sidecar。

因此先修：
Audit authority
+
bounded wait/poll
+
precondition verdict authority
+
precise invalid reasons

不要动业务源码。

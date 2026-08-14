# Trae — R58.7 Final Automation Hardening：IME Audit Mirror + UTF-8 Offset Smoke + Runtime Gate

## 0. 当前状态

当前候选 Build：

```text
inkchapter-r58-7-file-backed-audit-sink-fbas8k3q
```

当前已确认：

```text
File-backed Audit Sink — source/unit = PASS
AUD-1~AUD-10 = 10/10 PASS
Full Tests = 700/700 PASS
tsc = PASS
build:dev = PASS
deploy = PASS

project/runtime main SHA
=
C5A34D07CF4D1EA0E7E12FCC1F93D962D87390A0146F38939B133619A737E413

mainMatch=true

project/runtime style SHA
=
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

cssMatch=true

Runner JSONL Integration = IMPLEMENTED / SOURCE PASS
PowerShell syntax = PASS
trial-parser syntax = PASS
Schema synthetic smoke = PASS
DryRun = PASS
```

当前未完成：

```text
Sink Runtime = NOT YET
Trusted InputSmoke = NOT YET
Full Reduced Matrix = NOT YET
R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

当前 DryRun 中：

```text
runtimeBuildId =
inkchapter-r58-7-persisted-docswitch-scope-authority-dsw2q7
```

这是旧 runtime evidence，不代表新 Build 回归。

当前正式解释：

```text
fbas8k3q Deploy = PASS
fbas8k3q Runtime Activation = NOT YET
```

---

# 1. 本轮只处理两个自动化基础设施缺口

仅处理：

```text
A. JSONL collector 的 UTF-8 byte-offset 完整性

B. IME runtime audit JSONL 镜像完整性
```

完成后：

```text
New Build
↓
Strict Startup #1
↓
Sink Runtime Smoke
↓
InputSmoke
↓
PASS
↓
Fixture Reset
↓
Strict Startup #2
↓
Full Reduced Matrix
```

---

# 2. 继续冻结业务算法

禁止修改：

```text
CaretExpectation
SelectionTruth
NormalEnter
Canonical Transfer
Canonical visual verifier
Canonical Registry lifecycle
DocumentRuntimeContext
Save-As classifier
Historical resolver
Rehydrate
Merge
Paragraph semantic / visual logic
```

本轮允许修改：

```text
scripts/r58-matrix/**
```

以及仅用于 observability 的：

```text
IME-SELECTION-AUDIT
IME-EVENT-ORDER
→ emitRuntimeAudit(...)
```

禁止：

```text
改变 IME 状态机
改变 composition 行为
改变 user intent
改变 selection
改变 caret
改变 canonical
改变 transaction
改变 DOM
新增 testMode
synthetic DOM event
CDP
--remote-debugging-port
Runtime.evaluate
git add
git commit
git push
```

---

# 3. 第一任务：UTF-8 Byte Offset Smoke

当前 Runner 使用：

```text
byteOffsetBefore
byteOffsetAfter
```

因此必须证明：

```text
offset = 真正 byte offset
```

而不是：

```text
string character index
```

新增一个不依赖 Typora 的自动测试：

```text
JSONL-OFFSET-UTF8-SMOKE
```

测试文件至少：

```json
{"event":"ASCII","payload":{"text":"abc"}}
{"event":"UNICODE","payload":{"text":"。"}}
{"event":"UNICODE_PATH","payload":{"text":"测试文档.md"}}
```

步骤：

```text
写 line1
记录 line1 结束后的 byte offset
追加 line2 + line3
从 byte offset 读取 delta
UTF-8 decode
逐行 JSON.parse
```

必须：

```text
deltaLineCount=2
parseFailureCount=0
line2.payload.text="。"
line3.payload.text="测试文档.md"
overall=true
```

输出：

```text
JSONL-OFFSET-UTF8-SMOKE = PASS
```

如果 FAIL：

```text
STOP
```

只修：

```text
forensic-file-collector
```

禁止进入 runtime。

---

# 4. 第二任务：补齐 IME Audit JSONL 镜像

当前 JSONL 已能证明：

```text
KEYBOARD-EVENT-PROVENANCE
key=Process
code=Period
isTrusted=true

USER-INTENT-EPOCH
eventType=beforeinput
inputType=insertCompositionText

TEXT-COMMIT-AUDIT
visibleText=。
logicalOffset=1
```

但完整 composition provenance 当前仍只在 console：

```text
IME-SELECTION-AUDIT
IME-EVENT-ORDER
```

因此允许进行一次纯 observability 接线。

目标：

```text
现有 console audit
↓
emitRuntimeAudit(...)
↓
console + JSONL
```

必须镜像：

```text
IME-SELECTION-AUDIT
IME-EVENT-ORDER
```

至少覆盖：

```text
compositionstart
compositionupdate
beforeinput
input
compositionend
```

以及已有：

```text
compositionSessionId
inputType
isComposing
eventType
selection snapshot
```

如果当前 console audit 已携带上述字段，只镜像同一 payload。

禁止重新计算或重构 IME 业务状态。

---

# 5. 不允许散落 file append

禁止：

```text
console.info(...)
appendFile(...)
```

直接散落在 IME 逻辑中。

必须继续通过统一：

```text
emitRuntimeAudit(event, payload)
```

实现。

---

# 6. IME Audit 单元测试

新增/补充 tests。

至少：

```text
IME-AUD-1 compositionstart mirror
IME-AUD-2 compositionupdate mirror
IME-AUD-3 beforeinput insertCompositionText mirror
IME-AUD-4 input mirror
IME-AUD-5 compositionend mirror
IME-AUD-6 payload 不改变
IME-AUD-7 event 顺序保持
IME-AUD-8 sink failure 不影响业务路径
```

要求：

```text
8/8 PASS
```

或并入现有 audit suite，但必须逐项可见。

---

# 7. 生成新 Build

因为 src 再次发生 observability 修改：

禁止继续把：

```text
inkchapter-r58-7-file-backed-audit-sink-fbas8k3q
```

作为最终 runtime Build。

生成新唯一 Build ID，例如：

```text
inkchapter-r58-7-file-audit-ime-provenance-<unique>
```

记录：

```text
newBuildId=
```

然后执行：

```text
pnpm exec tsc --noEmit
targeted audit tests
full tests
pnpm run build:dev
deploy
```

重新计算：

```text
project main SHA
runtime main SHA
mainMatch=true

project style SHA
runtime style SHA
cssMatch=true
```

任何失败：

```text
STOP
```

---

# 8. 新 Build 后冻结 src

新 Build 完成后：

```text
src/**
= FREEZE
```

后续只允许改：

```text
scripts/r58-matrix/**
```

除非 Runtime Smoke 明确证明 sink/IME audit 自身存在缺陷。

---

# 9. Strict Startup #1 — Smoke Session

目标：

```text
r58-automation-input-smoke.md
```

必须真实执行：

```text
old PID
old process exit
processCountAfterClose=0

new PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

target vault
target document

runtime main path
project/runtime main SHA match
style SHA match

Build ID
runtime Build ID
initializationCount=1
```

如果启动命令实际未执行：

```text
Strict Startup = NOT EXECUTED
```

不得写：

```text
启动命令已发出，但尚未确认成功
```

只有启动命令确实发出、但 mandatory evidence 缺失时，才必须原样写：

**启动命令已发出，但尚未确认成功**

---

# 10. Sink Runtime Smoke

Strict Startup #1 PASS 后，不输入。

验证：

```text
audit directory exists=true
current session audit file exists=true
fileSize>0

FORENSIC-SINK-READY=true
RUNTIME-IDENTITY-FINAL=true
DOCUMENT-CONTEXT-STATE=true
DOCUMENT-CONTEXT-READY=true
SIDECAR-ACTUAL-LOAD=true

buildId=newBuildId

JSONL parseFailureCount=0
sinkErrorCount=0
droppedCount=0
```

smoke fixture clean baseline：

```text
SIDECAR-ACTUAL-LOAD
exists=false
recordCount=0
source=physical

scopeId
==
persistenceKey
==
documentKey
==
r58-automation-input-smoke.md
```

只有全部满足：

```text
FILE-BACKED AUDIT SINK
= PASS / RUNTIME
```

---

# 11. InputSmoke

Sink Runtime Smoke PASS 后：

```text
record audit byte offset
↓
SetForegroundWindow
↓
GetForegroundWindow()==Typora HWND
↓
SendInput Period
SendInput Period
SendInput Enter
SendInput Enter
SendInput Period
↓
wait >=2.5s
↓
read JSONL delta
```

禁止：

```text
Unicode direct injection
clipboard paste
DOM insertion
synthetic event
```

---

# 12. Trusted Input / IME Gate

必须从 JSONL delta 自动证明：

```text
KEYBOARD-EVENT-PROVENANCE
key=Process
code=Period
isTrusted=true
```

并自动证明完整 IME sequence：

```text
IME-SELECTION-AUDIT / IME-EVENT-ORDER

compositionstart
↓
compositionupdate（如真实环境产生）
↓
beforeinput inputType=insertCompositionText
↓
input
↓
compositionend
```

允许真实 IME 在某些输入中省略 compositionupdate，但：

```text
compositionstart
beforeinput
input
compositionend
```

必须可证明。

还必须：

```text
TEXT-COMMIT-AUDIT
visibleText="。"
logicalOffset=1
```

如果：

```text
trusted Period=true
但无 IME composition chain
```

判：

```text
INPUTSMOKE = INVALID
reason=IME_NOT_ACTIVE
```

如果：

```text
isTrusted != true
```

判：

```text
INPUTSMOKE = INVALID
reason=INPUT_PROVENANCE_MISMATCH
```

---

# 13. InputSmoke Business Gate

必须：

```text
POST-TEXT-INPUT-ARM exactly 1

CARET-EXPECTATION-SUPERSESSION-AUDIT
superseded=true
restoreAttempted=false

POST-TEXT-INPUT-STABILITY:
COMMIT+50=1
COMMIT+150=1
COMMIT+300=1
COMMIT+500=1
COMMIT+1000=1
COMMIT+2200=1

visibleText="。"
insideEditor=true

POST-TEXT-INPUT-COMPLETE

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

只有：

```text
INPUTSMOKE = PASS
```

才允许进入 Full Matrix。

---

# 14. InputSmoke PASS 后 Reset

只有 PASS 后：

```text
TEST FIXTURE RESET
```

重置：

```text
r58-caret-a1-fresh-01.md
...
r58-caret-a1-fresh-10.md
```

以及对应 sidecar。

要求：

```text
fixtureExists=true
sidecarExists=false
```

旧 app-*.log 不删除。

---

# 15. Strict Startup #2 — Formal Matrix Session

不要继续沿用 InputSmoke session。

InputSmoke PASS + reset 后：

```text
彻底关闭 Typora
↓
验证 processCount=0
↓
正式启动 fresh-01
```

目标：

```text
r58-caret-a1-fresh-01.md
```

再次执行完整 Strict Startup。

原因：

```text
Smoke Session
= 自动化基础设施验收

Matrix Session
= 正式 R58.7 验收
```

避免把 InputSmoke 的：

```text
canonical
intent
probe
selection
runtime state
```

带进正式 Matrix。

---

# 16. Full Reduced Matrix

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

fresh-06~10 只用于：

```text
TRIAL INVALID
```

替补，不得用于隐藏真实 FAIL。

---

# 17. A1 ×3

每轮：

```text
。。
Enter
Enter
立即输入 。
wait >=2.5s
```

要求：

```text
clean physical sidecar
scope authority correct
trusted input=true
IME provenance=true

POST-TEXT-INPUT-COMPLETE

COMMIT+50~2200 logicalOffset=1

canonical final=true
normalEnter final=true

awaitingCount=0
scopeMismatchCount=0

caretRestore=0
caretRepair=0
unexpectedSelectionWrite=0

sinkErrorCount=0
droppedCount=0
```

A1：

```text
3/3 PASS
```

---

# 18. A1/A2/A3 同 Session Document Switch

Formal Matrix Session 内：

```text
fresh-01
→ fresh-02
→ fresh-03
→ fresh-04
→ fresh-05
```

禁止 restart 规避 document switch。

每次必须：

```text
DOCUMENT-CONTEXT-TRANSITION

scopeIdBefore=old
scopeIdAfter=new
scopeIdSame=false

persistenceKeyBefore=old
persistenceKeyAfter=new

preserveScope=false
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

稳定后：

```text
scopeId == persistenceKey == documentKey == current fixture
old scope current owners=0
awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

---

# 19. A2 ×1

fresh-04：

```text
普通段落输入
Enter
立即输入 。
wait >=2.5s
```

要求：

```text
sourceCanonicalRecordId=none
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true

caretRestore=0
caretRepair=0
unexpectedSelectionWrite=0

awaitingCount=0
scopeMismatchCount=0

sinkErrorCount=0
droppedCount=0
```

---

# 20. A3 ×1

fresh-05：

```text
。。
Enter
Enter
不再输入
wait >=2.5s
```

要求：

```text
completedOriginalRuntimeId correct
caretDestinationRuntimeId correct

canonicalOwner != caretDestination

canonical transfer overall=true
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true

awaitingCount=0
scopeMismatchCount=0

无异常 caretRestore
无异常 caretRepair

sinkErrorCount=0
droppedCount=0
```

A3 不要求：

```text
POST-TEXT-INPUT-COMPLETE
```

---

# 21. B1 ×2

使用独立 historical fixtures。

Seed：

```text
r58-b1-historical-01.md
r58-b1-historical-02.md
```

必须先生成合法 sidecar：

```text
sidecar exists=true
recordCount>=1
stable persistence boundary reached
```

Seed 不算 PASS。

B1 正式 physical load：

```text
SIDECAR-ACTUAL-LOAD
exists=true
recordCount>=1
source=physical

RECORD-LIFECYCLE
event=PERSISTED_LOAD
state=PERSISTED_HISTORICAL
```

仅：

```text
PERSISTED_HISTORICAL
```

可使用 generic historical resolver。

每轮：

```text
historicalResolverLeakage=0
duplicateAppend=0
awaitingCount=0
scopeMismatchCount=0
sinkErrorCount=0
droppedCount=0
```

B1：

```text
2/2 PASS
```

---

# 22. FAIL / INVALID

真实业务断言失败：

```text
TRIAL FAIL
```

基础设施问题：

```text
TRIAL INVALID
```

INVALID 包括：

```text
foreground HWND mismatch
IME_NOT_ACTIVE
input provenance mismatch
audit session ambiguous
JSONL collector failure
JSONL UTF-8 offset failure
sink observability failure
script duplicate input
```

真实 FAIL 不允许自动换 fixture 重跑。

---

# 23. Fail-Fast

任何 FAIL：

```text
STOP MATRIX
```

保存：

```text
current audit JSONL
trial delta JSONL
trial verdict JSON
runtime-load
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
删现场
truncate audit
重置 sidecar
自动继续
retry-until-pass
```

---

# 24. 最终判定

必须全部：

```text
JSONL-OFFSET-UTF8-SMOKE = PASS

Strict Startup #1 = PASS
Sink Runtime Smoke = PASS
InputSmoke = PASS

Strict Startup #2 = PASS

A1 = 3/3 PASS
A2 = 1/1 PASS
A3 = 1/1 PASS
B1 = 2/2 PASS

TOTAL = 7/7 PASS
```

才允许：

```text
File-backed Audit Sink
= PASS / RUNTIME

Trusted Input Automation
= PASS / RUNTIME

IME JSONL Observability
= PASS / RUNTIME

Document-Switch Scope Authority
= PASS

Reduced Matrix
= 7/7 PASS

R58.7 PRACTICAL CLOSURE
= PASS

Extended Stress Matrix
= WAIVED / NOT EXECUTED

R60
= MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

禁止写：

```text
A1×10 PASS
FULL EXHAUSTIVE MATRIX PASS
R58.7 FULL EXHAUSTIVE CLOSURE PASS
```

---

# 25. 如果只完成 InputSmoke

若：

```text
UTF8 Offset Smoke PASS
Strict Startup #1 PASS
Sink Runtime Smoke PASS
InputSmoke PASS
```

但 Full 未执行：

```text
File-backed Audit Sink = PASS / RUNTIME
Trusted Input Automation = PASS / RUNTIME
IME JSONL Observability = PASS / RUNTIME
Full Reduced Matrix = MAY START

R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

---

# 26. 立即执行顺序

严格：

```text
1. UTF-8 byte-offset smoke
2. IME audit mirror
3. IME audit targeted tests
4. tsc
5. full tests
6. build:dev
7. deploy
8. SHA parity
9. freeze new Build
10. Strict Startup #1
11. Sink Runtime Smoke
12. InputSmoke
13. PASS 后 reset fixtures
14. Strict Startup #2
15. Full Reduced Matrix
16. final-summary
17. STOP
```

不要自动进入 R60。

---

# 27. Git

禁止：

```text
git add
git commit
git push
```

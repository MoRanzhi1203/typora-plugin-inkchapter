# Trae — EmptySpecial E2-01 Runtime Gate（Node/Win32 版，禁止 PowerShell）

## 0. 当前冻结基线

当前候选 Build：

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
Build loaded = true
project/runtime main SHA parity = true
Initialization Count = 1
Active Doc = r58-empty-special-e2-01.md
sidecarExists = false
sidecarRecordCount = 0
```

但当前仍缺：

```text
Formal Strict Startup process/window proof
Formal E2-01 runtime transaction
```

本轮目标：

```text
FREEZE current business source
→ 建立非 PowerShell Runtime Gate
→ Strict Startup
→ only one clean E2-01
→ STOP
```

---

# 1. HARD RULE：禁止 PowerShell

本轮不得执行：

```text
powershell.exe
pwsh
*.ps1
Invoke-*
Get-Process
Get-Content
Start-Process
Stop-Process
Get-FileHash
```

现有 `.ps1` 文件可以只读参考逻辑，但不得执行。

不得为了方便偷偷从 Node `child_process` 调用 PowerShell。

若某个 Windows Runtime 能力在非 PowerShell 路径下无法获得，必须：

```text
NON_POWERSHELL_RUNTIME_CAPABILITY_GAP
→ STOP
```

不得降低 Strict Startup 门槛。

---

# 2. 业务源码冻结

当前 Build `terminal-normalize-1jdevq` 先冻结。

禁止修改：

```text
src/heading-numbering/empty-special-command.ts
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-canonical-registry.ts

CanonicalRecordId architecture
NormalEnter SPLIT_1_TO_2
historical resolver
DocumentRuntimeContext
scope authority
Live Owner Dominance
caret geometry algorithm
CSS visual workaround
generic caret repair/restore
```

本轮优先只允许修改：

```text
scripts/r58-matrix/**
artifacts/**
必要的 non-PowerShell helper
```

如果没有修改 `src/**`：

```text
不要生成新 Build
不要重新改 Build ID
```

---

# 3. 将 Runtime Harness 切换为 Node authority

新增/收敛一个 Node 入口：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

支持：

```text
--mode preflight
--mode strict-startup
--mode run --scenario E2 --trial 01
```

正式 runtime authority 以后使用：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight

node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup

node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

禁止再要求用户执行 `.ps1`。

---

# 4. Node Preflight

Preflight 至少验证：

```text
expectedBuildId
expectedMainSHA
expectedStyleSHA

project dist/main.js exists
runtime plugin main exists
project/runtime SHA match

style.css SHA match

r58-empty-special-e2-01.md exists
sidecarExists=false
sidecarRecordCount=0

fixture bytes match expected UTF-8 no-BOM baseline

parser exists
audit directory accessible
```

SHA 必须使用 Node `crypto`：

```js
crypto.createHash('sha256')
```

禁止外部 PowerShell hash。

输出：

```text
artifacts/empty-special-runtime/preflight.json
```

---

# 5. Strict Startup 必须是非 PowerShell 真验证

Strict Startup 仍必须验证全部：

```text
old Typora process exited
processCountAfterClose=0

newPid
newStartTime

MainWindowHandle != 0
MainWindowTitle != ""

targetVault
targetDocument

runtimeMainPath
runtimeMainSHA
projectMainSHA
shaMatch=true

styleSHA

runtimeBuildId=
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

initializationCount=1

readinessReady=true
auditDecision=ACCEPT

runtime-load freshness >= new process start
RUNTIME-IDENTITY-FINAL belongs to current launch/session
```

不能只靠 renderer log 宣布 Strict Startup PASS。

---

# 6. Windows process/window 能力：Node + Win32 helper

优先检查仓库/已安装依赖中是否已有可直接复用的非 PowerShell Win32 helper。

如果没有：

```text
允许新增一个最小本地 Win32 helper
```

推荐结构：

```text
scripts/r58-matrix/win32-helper/
  R58Win32Helper.cs
  R58Win32Helper.csproj
```

通过：

```text
dotnet build
```

生成本地 helper。

禁止联网安装第三方包。

helper 只负责：

```text
Enumerate Typora processes
PID
process start time
terminate/close old Typora
MainWindowHandle
MainWindowTitle
foreground window
SetForegroundWindow
SendInput
```

Node 通过：

```js
child_process.spawn / execFile
```

读取 helper 的 JSON stdout。

如果当前环境没有可用 `dotnet` / 本地非 PowerShell Win32 能力：

```text
NON_POWERSHELL_RUNTIME_CAPABILITY_GAP
```

STOP。

不要回退 PowerShell。

---

# 7. Strict Startup readiness polling

不能：

```text
看到 HWND
→ 立即读取 runtime-load
→ 判 startup
```

必须 polling：

```text
new process exists
↓
HWND != 0
↓
MainWindowTitle != ""
↓
runtime-load file mtime >= process StartTime
↓
runtime Build ID == expected
↓
runtime Main SHA == expected
↓
initializationCount == 1
↓
current audit session contains RUNTIME-IDENTITY-FINAL
↓
ACCEPT
```

避免之前 stale runtime-load race。

输出：

```text
artifacts/empty-special-runtime/strict-startup.json
```

---

# 8. JSONL 读取完全使用 Node

禁止 `Get-Content`。

使用：

```text
fs.stat
fs.open
fs.read
TextDecoder("utf-8", { fatal: true })
JSON.parse
```

Formal trial 必须 byte-window：

```text
byteOffsetStart
→ input
→ wait final
→ flush/stable
→ byteOffsetEnd
→ decode exact delta
→ parse current trial only
```

任何 malformed UTF-8：

```text
INVALID / JSONL_UTF8_PARSE_FAILURE
```

---

# 9. E2-01 fixture 必须保持 clean

正式执行前再次证明：

```text
fixture=r58-empty-special-e2-01.md

sidecarExists=false
sidecarRecordCount=0

fixture bytes=
E6 96 87 E6 9C AC 0A 0A

no BOM
```

不要无意义重写该 `.md`。

不要删除历史 audit。

---

# 10. E2-01 Runtime Topology Precondition

正式输入前必须证明当前 Typora DOM 中：

```text
target paragraph empty=true
target is trailing empty paragraph
nextRuntimeId=null
previous paragraph exists
document scope correct
target connected=true
```

如果静态 Markdown 没恢复为目标 runtime topology：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
```

SendInputCallCount=0。

---

# 11. Token 输入必须先证明“。。”，再允许 Enter

使用当前 Windows 中文 IME + trusted key input。

输入：

```text
。
。
```

要求 audit 中存在对应 IME provenance：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

并在发送 Enter 前证明：

```text
visibleText=="。。"
logicalOffset=2
```

如果实际是：

```text
..
```

或其他文本：

```text
INVALID / SPECIAL_TOKEN_PROVENANCE_MISMATCH
SendEnterCallCount=0
```

禁止错误 token 进入业务 transaction。

---

# 12. Formal E2-01 事件链

只允许一个 EmptySpecial txn：

```text
SPECIAL-COMMAND-ROUTING-AUDIT
↓
EMPTY-SPECIAL-PRE
↓
EMPTY-SPECIAL-MUTATION-WINDOW-ARM
↓
EMPTY-SPECIAL-TOKEN-CONSUMED
↓
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE
↓
EMPTY-SPECIAL-DOM-NORMALIZATION
↓
EMPTY-SPECIAL-SETTLE-AUDIT
↓
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
↓
EMPTY-SPECIAL-CANONICAL-COMMIT
↓
EMPTY-SPECIAL-CARET-VERIFY
↓
EMPTY-SPECIAL-CARET-GEOMETRY
↓
EMPTY-SPECIAL-VISUAL-VERIFY
↓
EMPTY-SPECIAL-FINAL
↓
EMPTY-SPECIAL-TRANSACTION-CLOSE
```

全部：

```text
same txnId
```

byte-window 内要求：

```text
PRE exactly 1
ARM exactly 1
TOKEN-CONSUMED exactly 1
DOM-NORMALIZATION exactly 1
SETTLE exactly 1
FINAL exactly 1
TRANSACTION-CLOSE exactly 1
```

---

# 13. Routing Gate

必须：

```text
ENTER-ADMISSION-AUDIT
decision=ALLOW_SPECIAL_COMMAND

SPECIAL-COMMAND-ROUTING-AUDIT
selectedPath=EMPTY_SPECIAL
```

禁止：

```text
ALLOW_SPECIAL_COMMAND
→ NORMAL_ENTER
```

如果发生：

```text
REAL BUSINESS FAIL / SPECIAL_ROUTE_DIVERGENCE
```

立即 STOP。

不要修改 NormalEnter resolver。

---

# 14. Exact Empty Span Gate

必须出现：

```text
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE
```

要求：

```text
matchesExpectedMdPlainShape=true
hasNonEmptyTextNode=false
safeEmptyTextShape=true
decision=SAFE_EMPTY
```

随后：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION

decision=NORMALIZED_TO_NATIVE_EMPTY
nativeEmptyEquivalentAfter=true
markdownContentChanged=false
overall=true
```

如果 safe exact shape 仍：

```text
BLOCK_UNSAFE_STRUCTURE
```

判：

```text
REAL BUSINESS FAIL / EMPTY_SPAN_PREDICATE_RUNTIME_FAIL
```

STOP。

---

# 15. Mutation-authoritative Settle Gate

必须：

```text
observerRootConnectedAtArm=true
observerRootContainsSourceAtArm=true
sourceConnectedAtArm=true
observerRootIsCurrentEditorRoot=true

observerArmedAt < tokenConsumedAt

relevantMutationCount>=1
quietBoundaryReached=true

decision=SETTLED_BY_MUTATION_QUIET
```

如果：

```text
relevantMutationCount=0
```

判：

```text
INVALID / EMPTY_SPECIAL_MUTATION_NOT_OBSERVED
```

如果：

```text
TIMEOUT_BLOCK
```

判真实 BLOCK，STOP。

---

# 16. Terminal Cleanup Gate

必须：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE

observerDisconnected=true
timeoutCleared=true
activeTxnCleared=true
terminal=true
overall=true
```

并严格验证：

```text
TRANSACTION-CLOSE 之后
same txnId
EMPTY-SPECIAL-MUTATION count = 0
```

如果 terminal 后仍有 same txn mutation：

```text
REAL BUSINESS FAIL / STALE_EMPTY_SPECIAL_OBSERVER
```

STOP。

---

# 17. Caret Geometry Gate

前面全部 PASS 后才检查：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

目标：

```text
fontSizePx≈16
expectedIndentPx≈32
actualCaretIndentPx≈32
caretVisualCorrect=true
overall=true
```

如果：

```text
nativeEmptyEquivalentAfter=true
semanticCorrect=true
computedTextIndent≈32px
caretLogicalCorrect=true
actualCaretIndentPx≈0
caretVisualCorrect=false
```

则正式确认：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / RUNTIME
```

然后 STOP。

不要在本轮自动加入 CSS workaround。

---

# 18. Final PASS Gate

只有全部满足：

```text
routingCorrect=true
safeEmptyPredicate=true
nativeEmptyEquivalentAfter=true
mutationAuthoritative=true

logicalSlotPreserved=true
paragraphCountPreserved=true
canonicalOwnerCorrect=true

semanticCorrect=true
visualIndentCorrect=true

caretLogicalCorrect=true
caretVisualCorrect=true

unexpectedMerge=false
unexpectedDelete=false

transactionCloseOverall=true
postCloseSameTxnMutationCount=0

EMPTY-SPECIAL-FINAL overall=true
```

才允许：

```text
E2-01 = PASS / RUNTIME
```

然后立即 STOP。

不要自动继续 E2-02。

---

# 19. Verdict

只允许：

```text
PASS
FAIL
INVALID
```

FAIL：

```text
safe span runtime fail
SPECIAL route divergence
TIMEOUT_BLOCK
stale observer after close
caretVisualCorrect=false after native normalization
unexpected merge/delete
canonical owner wrong
FINAL overall=false
```

INVALID：

```text
wrong token
IME provenance missing
foreground mismatch
topology mismatch
UTF-8 parse failure
mutation not observed
audit ambiguity
non-PowerShell capability gap
```

INVALID 不计入 E2 PASS/FAIL。

---

# 20. Artifacts

保存：

```text
artifacts/empty-special-runtime/e2-01/
  strict-startup.json
  trial-precondition.json
  input-injection-audit.json
  trial.delta.jsonl
  trial-summary.json
  fixture-before.bin
  fixture-after.bin
  sidecar-before.json
  sidecar-after.json
  runtime-identity.json
```

不得删除历史证据。

---

# 21. STOP 条件

本轮执行顺序严格：

```text
Node Preflight
→ Node Strict Startup
→ only clean E2-01
→ STOP
```

任何 FAIL / INVALID：

```text
保存 artifacts
→ STOP
```

禁止 retry-until-pass。

禁止运行 E2-02/E1/E3。

禁止 git add / commit / push。

不要进入 R60。

Startup `SyntaxError: Unexpected token ')'` 继续独立延期，不纳入 EmptySpecial P0。

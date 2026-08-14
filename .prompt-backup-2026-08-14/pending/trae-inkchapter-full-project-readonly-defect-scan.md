# Trae — Typora InkChapter 全项目只读缺陷扫描与证据审计

## 0. 任务目标

对当前项目进行一次**全仓、系统性、只读优先**扫描，目标不是立即修复，而是回答：

```text
当前项目到底还存在哪些问题？
哪些问题是真实 Runtime Bug？
哪些只是 Source/Test Gap？
哪些是 Harness/Observability 问题？
哪些属于历史噪声或已修复问题？
哪些问题会阻塞 R58.7 / EmptySpecial / R60？
```

项目根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

当前冻结候选 Build：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

当前 Main SHA：

```text
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

---

# 1. HARD RULE：本轮以扫描和证据审计为主

本轮默认：

```text
READ-ONLY SOURCE AUDIT
```

禁止直接修改：

```text
src/**
dist/**
test/vault/.typora/plugins/**
package.json
build.js
业务配置
Build ID
```

允许：

```text
view/search files
运行现有测试
运行 TypeScript 检查
运行现有 Node scripts
读取 logs / artifacts / audit JSONL
生成新的审计报告
```

如果为了扫描确实需要新增临时分析脚本，只允许放在：

```text
scripts/audit/**
```

并且必须：

```text
不修改业务状态
不启动自动修复
不修改 fixture
不删除历史 evidence
```

不得进入自动 fix。

---

# 2. 禁止 PowerShell

本轮禁止：

```text
powershell.exe
pwsh
*.ps1
Node child_process 调用 PowerShell
```

现有 `.ps1` 可以只读查看逻辑，但不得执行。

优先使用：

```text
Trae 自带 view_files/search_by_regex
node
npx
pnpm
npm
git
dotnet（仅当只读验证确有必要）
```

如某项扫描只有 PowerShell 才能完成：

```text
SCAN_CAPABILITY_GAP
```

记录后继续其他项目，不得偷偷回退 PowerShell。

---

# 3. 证据优先级

所有结论必须按以下证据等级排序：

```text
1. Runtime evidence
2. Actual executed command result
3. Source implementation
4. Unit / integration tests
5. Trae summary
6. Architectural inference
```

禁止：

```text
source 看起来修了
→ 宣布 Runtime FIXED

test PASS
→ 宣布用户可见问题 FIXED

build 成功
→ 宣布 Typora 启动成功
```

每个 issue 都必须标记 Evidence Level。

---

# 4. Issue 分类

每个发现只能归入以下类别之一：

```text
RUNTIME_CONFIRMED_BUG
SOURCE_CONFIRMED_BUG
TEST_COVERAGE_GAP
RUNTIME_OBSERVABILITY_GAP
HARNESS_BUG
LIFECYCLE_LEAK
RACE_CONDITION
STATE_AUTHORITY_BUG
PERSISTENCE_BUG
SCOPE_BUG
CARET_BUG
DOM_NORMALIZATION_BUG
ROUTING_BUG
DUPLICATE_LIFECYCLE
PERFORMANCE_RISK
DEAD_CODE_OR_DUPLICATE_LOGIC
STALE_HISTORICAL_NOISE
UNKNOWN / NEEDS_RUNTIME_PROOF
ALREADY_FIXED / EVIDENCE_CONFIRMED
```

不要把不同类别混为一个 issue。

---

# 5. Severity

每个问题标记：

```text
P0 = 数据/结构/identity/caret/transaction 直接错误，阻塞当前主线
P1 = 高概率影响编辑稳定性或产生误判
P2 = 可维护性、性能、重复 lifecycle、观测噪声
P3 = 低风险清理项
```

---

# 6. 扫描范围 A — Startup / Plugin Runtime Identity

检查：

```text
src/main.ts
runtime-load.json 写入逻辑
Build ID 来源
project/runtime SHA 计算
initializationCount
RUNTIME-IDENTITY-FINAL
FORENSIC-SINK-READY
plugin loader lifecycle
plugin enable/load ordering
```

重点检查：

```text
runtime-load readiness race
stale runtime-load
旧 audit file 被误选
Build ID / SHA provenance 漂移
重复初始化
重复 editor bind
重复 document context ready
```

历史已知：

```text
EDITOR-RUNTIME-BOUND 曾重复
DOCUMENT-CONTEXT-READY 曾重复
SIDECAR-ACTUAL-LOAD 曾重复
```

必须确认当前源码是否仍允许同 editor/doc 重复 lifecycle。

注意：

```text
SyntaxError: Unexpected token ')'
```

历史上发生在 InkChapter onload 前。

本轮只做 attribution scan：

```text
InkChapter causality proven?
yes / no / unknown
```

不得无证据归因。

---

# 7. 扫描范围 B — DocumentRuntimeContext / Scope Authority

检查：

```text
NO_EDITOR
EPHEMERAL
PERSISTED

scopeId
persistenceKey
activeFilePath
businessReady
persistenceReady
sessionId
```

验证：

```text
EPHEMERAL → PERSISTED Save As
PERSISTED A → PERSISTED B
PERSISTED B → A
document switch
file open
save
close
unload
```

重点搜索：

```text
stale scope
stale persistenceKey
same scope reused incorrectly
old document state leaking into new document
sidecar write to wrong document
```

如果当前 source 已符合已验证架构，标：

```text
ALREADY_FIXED / SOURCE CONSISTENT
```

不要重复制造问题。

---

# 8. 扫描范围 C — CanonicalRecordId / Registry Lifecycle

冻结业务模型：

```text
CanonicalRecordId = business identity

CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
PERSISTED_HISTORICAL
```

检查：

```text
register
bind
rebind
transfer
retire
rehydrate
document switch
promotion
Backspace
Enter replacement
```

重点查找：

```text
append duplicate canonical record
CURRENT_AWAITING_TRANSFER 落入 historical resolver
CURRENT_RETIRED 被重新激活
多个 runtime owner 指向同一 canonical
同 runtime 指向多个 canonical
controlled replacement candidateCount != 1 仍 commit
```

输出所有可能破坏：

```text
ONE CANONICAL BUSINESS IDENTITY
```

的不变量路径。

---

# 9. 扫描范围 D — NormalEnter Transaction

检查完整链：

```text
Trusted Enter
→ EditorTransactionCoordinator
→ pre state
→ DOM mutation
→ StructuralResolution
→ canonical transfer
→ caret plan
→ final
```

重点确认：

```text
isRealEnterKey
intentEpoch
normalEnterTxnId
SPLIT_1_TO_2
completedOriginalRuntimeId
caretDestinationRuntimeId
canonical owner handoff
```

查找：

```text
NormalEnter source/caret owner混淆
first-line fallback
previous/next heuristic
跨 txn stale callback
selection write
restore after newer trusted input
```

不得为了 EmptySpecial 问题误改 NormalEnter。

---

# 10. 扫描范围 E — Empty Paragraph Special Command

这是当前最高优先级扫描区。

检查：

```text
EmptySpecialCommandTransaction
EMPTY-SPECIAL-PRE
MUTATION-WINDOW-ARM
TOKEN-CONSUMED
EMPTY-SPAN-PREDICATE
DOM-NORMALIZATION
SETTLE
STRUCTURAL-RESOLUTION
CANONICAL-COMMIT
CARET-VERIFY
CARET-GEOMETRY
VISUAL-VERIFY
FINAL
TRANSACTION-CLOSE
```

重点验证：

### E-1 Exact empty span

```text
Text("")
允许
Text(" ")
Text("\n")
Text("\t")
必须拒绝
```

确认实现没有：

```text
trim() 过宽
全局 DOM cleanup
invisible char workaround
```

### E-2 Terminal lifecycle

所有：

```text
COMMITTED
BLOCKED
SUPERSEDED
TIMEOUT_BLOCK
FAILED
```

必须：

```text
observer.disconnect
timer clear
RAF ownership clear
active txn clear
terminal
```

查：

```text
terminal 后 same txn mutation
stale callback
old txn 清掉 newer txn
activeEnterTransaction 泄漏
```

### E-3 Routing

验证：

```text
ALLOW_SPECIAL_COMMAND
→ EMPTY_SPECIAL
```

查：

```text
ALLOW_SPECIAL_COMMAND
→ NORMAL_ENTER
```

以及：

```text
activeEnterTransaction
activeEmptySpecialTransaction
one-at-a-time guards
```

### E-4 Caret

只扫描，不主动修：

```text
native empty
computed text-indent
expectedIndentPx
actualCaretIndentPx
logical offset
visual caret
```

如果没有最新 Runtime：

```text
UNKNOWN / NEEDS_RUNTIME_PROOF
```

不得直接进入 CSS workaround。

---

# 11. 扫描范围 F — Caret / Selection Authority

检查：

```text
CaretExpectation
intentEpoch
SUPERSEDED
restore gate
selection writes
focus side effects
```

冻结 invariant：

```text
newer trusted user input
→ old caret expectation superseded
→ old restore forbidden
```

扫描：

```text
setSelection
Range
Selection.addRange
focus()
caret restore
repair
rehydrate selection mutation
```

列出：

```text
所有写 selection 的位置
是否 audit
是否可能 stale
```

---

# 12. 扫描范围 G — POST-TEXT Observation

历史已确认：

```text
POST-TEXT Observation Lifecycle = BUG CONFIRMED
```

重点检查当前 source 是否已经真正修复：

```text
Observation(epoch=N)
newer trusted non-dedup intent
→ SUPERSEDE
→ cancel pending callbacks
→ stale callback DROP_STALE
```

查：

```text
old observation 跨 runtime
old observation 跨 logicalOffset
过期 callback 仍 COMPLETE
```

如果尚未修：

```text
P1 / RUNTIME_CONFIRMED_BUG
```

若只是 source patched 无 Runtime：

```text
SOURCE_FIXED / RUNTIME_PENDING
```

---

# 13. 扫描范围 H — Promotion Lifecycle

历史存在：

```text
promotion lifecycle violations
```

扫描：

```text
PromotionRequest
provenance
consume once
duplicate consume
append record
no-op
```

目标模型：

```text
one-shot
provenance-rich
consume/no-op
same CanonicalRecordId
```

列出所有违反 one-shot 的路径。

---

# 14. 扫描范围 I — Rehydrate

扫描：

```text
rehydrate scheduling
rehydrate DOM writes
selection writes
no-op schedule
historical resolver
live owner dominance
multi-owner block
```

重点检查：

```text
CURRENT_LIVE
→ exact live projection only

CURRENT_AWAITING_TRANSFER
→ zero historical candidates

CURRENT_RETIRED
→ zero candidates

PERSISTED_HISTORICAL
→ historical resolver only
```

统计：

```text
重复 schedule
无效 rehydrate
可能性能噪声
```

---

# 15. 扫描范围 J — Persistence / Sidecar

检查：

```text
load
save
flush
close
switch
unload
physical load
```

重点：

```text
session overlay
stable snapshot
write boundary
duplicate SIDECAR-ACTUAL-LOAD
record duplication
wrong document write
stale file
historical pollution
```

不得把历史被污染的 `doc.md` 当当前 clean fixture。

---

# 16. 扫描范围 K — Forensic Sink

检查：

```text
queue
batch flush
UTF-8
session file
flushForensicSink
shutdownForensicSink
failure isolation
```

确认：

```text
sink failure cannot block business
no truncate
strict UTF-8
byte-offset safe
current session identification
```

搜索：

```text
encoding bug
flush race
unload lost logs
cross-session log mix
```

---

# 17. 扫描范围 L — Runner / Harness

检查：

```text
scripts/r58-matrix/**
run-empty-special-gate.mjs
Win32 helper
trial parser
byte window
fixture manager
input provenance
strict startup readiness
```

特别区分：

```text
业务 bug
vs
Harness bug
```

检查：

```text
cwd-dependent path bug
重复 scripts/r58-matrix/scripts/r58-matrix
absolute/relative path混用
stale artifact selection
whole-session Last 1
wrong token ".."
SendEnter before token proof
foreground mismatch
retry-until-pass
formal fixture被污染
```

要求所有路径基于：

```text
import.meta.url / repo root resolution
```

不得依赖调用者 cwd。

---

# 18. 扫描范围 M — Tests

执行现有：

```text
npx tsc --noEmit
vitest full regression
现有 Node test/harness contract
```

不要执行 `.ps1`。

统计：

```text
总测试数
失败数
skip
todo
flaky patterns
```

扫描 tests 是否存在：

```text
jsdom 与真实 Chromium DOM 不一致
只构造理想 DOM
未覆盖 empty Text("")
未覆盖 lifecycle terminal
未覆盖 stale callback
未覆盖 route divergence
未覆盖 same-session pollution
```

输出：

```text
Test Coverage Gap Matrix
```

---

# 19. 扫描范围 N — Dead Code / Duplicate Authority

搜索：

```text
重复 parser
重复 startup verifier
重复 build ID constants
重复 SHA constants
旧 R58 scripts
旧 runtime gates
废弃 CDP path
旧 heuristic resolver
未使用 helper
```

特别寻找：

```text
两个 authority 同时维护
```

例如：

```text
两个 StrictStartup implementation
两个 EmptySpecial parser
两个 runtime-load source
```

标记：

```text
DEAD_CODE_OR_DUPLICATE_LOGIC
```

但本轮不要删。

---

# 20. 扫描范围 O — Race / Async / Event Listener Leak

系统搜索：

```text
setTimeout
setInterval
queueMicrotask
requestAnimationFrame
MutationObserver
addEventListener
on()
once()
register()
```

检查每个：

```text
owner
lifecycle
cancel/disconnect path
terminal path
document switch path
unload path
```

重点输出：

```text
可能跨 document
可能跨 txn
可能跨 intentEpoch
可能跨 editor instance
```

的 async callback。

---

# 21. 扫描范围 P — User-visible numbering / outline / sidebar

对：

```text
heading numbering
paragraph indent
outline toolbar
sidebar numbering
scope selection
start/cancel numbering
```

做结构扫描。

重点：

```text
source of truth 是否唯一
DOM 编号 vs sidebar 编号是否可能漂移
document switch 后是否复用旧 cache
toolbar controller 生命周期
设置更新触发重复 render
```

本轮只列问题，不做 UI 重构。

---

# 22. 当前已知历史问题必须逐项复核

以下问题不能直接假定仍存在，也不能直接假定已修：

```text
1. Strict Startup readiness race
2. duplicate EDITOR-RUNTIME-BOUND
3. duplicate DOCUMENT-CONTEXT-READY
4. duplicate SIDECAR-ACTUAL-LOAD
5. POST-TEXT observation supersession
6. Promotion one-shot lifecycle
7. excessive rehydrate no-op scheduling
8. startup SyntaxError attribution
9. EmptySpecial exact empty span
10. EmptySpecial terminal observer cleanup
11. Special admission → execution route divergence
12. empty paragraph visual caret geometry
13. JSONL UTF-8 reader correctness
14. formal fixture topology validity
15. cwd-dependent Node harness path
```

逐项给：

```text
CURRENT STATUS
EVIDENCE
SOURCE LOCATION
RUNTIME STATUS
NEXT PROOF NEEDED
```

---

# 23. 禁止“扫描顺便修”

发现问题后：

```text
记录
分类
定位
给修复建议
```

但不要直接 edit source。

只有发现：

```text
明显扫描脚本自身错误
```

可修 `scripts/audit/**`。

业务代码保持只读。

---

# 24. 输出文件

最终必须生成：

```text
docs/audits/inkchapter-full-project-defect-scan-2026-08-13.md
```

以及：

```text
artifacts/project-audit/inkchapter-full-project-defect-scan-2026-08-13.json
```

JSON 每项：

```json
{
  "id": "ISSUE-001",
  "severity": "P0",
  "category": "LIFECYCLE_LEAK",
  "title": "...",
  "status": "CONFIRMED|SUSPECTED|FIXED_SOURCE_ONLY|CLOSED",
  "evidenceLevel": "RUNTIME|COMMAND|SOURCE|TEST|INFERENCE",
  "files": [],
  "symbols": [],
  "runtimeEvidence": [],
  "rootCauseConfidence": "HIGH|MEDIUM|LOW",
  "impact": "...",
  "recommendedFix": "...",
  "regressionRisk": "...",
  "verificationPlan": "..."
}
```

---

# 25. 最终报告结构

报告必须按：

```text
A. Executive Summary
B. Current Build / SHA / Runtime Baseline
C. P0 Issues
D. P1 Issues
E. P2/P3 Issues
F. Already Fixed / Closed
G. Runtime Observability Gaps
H. Harness / Test Problems
I. Async/Lifecycle Leak Map
J. Duplicate Authority / Dead Code Map
K. Test Coverage Gap Matrix
L. Recommended Fix Order
M. Runtime Verification Order
N. Frozen Areas / Do Not Touch
O. Final Go / No-Go for R60
```

---

# 26. 每个 Issue 必须包含

```text
Issue ID
Severity
Category
Status
Evidence Level

User-visible symptom
Exact source location
Exact runtime/log evidence
Root-cause analysis
Confidence

Why it matters

Minimal safe fix
Do-not-fix-with
Regression risk

Required unit test
Required integration test
Required runtime proof

Blocker for:
R58.7 / EmptySpecial / R60 / none
```

---

# 27. 修复顺序建议必须基于依赖关系

不要只按文件排序。

示例：

```text
transaction terminal authority
→ routing
→ DOM normalization
→ mutation settle
→ canonical
→ caret geometry
→ persistence
```

若 issue 是 observability gap：

```text
先补 proof
再修 business
```

---

# 28. R60 Go / No-Go

只有当扫描结束后才能给：

```text
R60 GO
R60 CONDITIONAL GO
R60 NO-GO
```

必须列出阻塞项。

禁止因为：

```text
tsc PASS
tests PASS
build PASS
```

就直接给 GO。

---

# 29. Runtime 状态措辞

如果本轮没有真正启动 Typora：

```text
Strict Startup = NOT EXECUTED
Runtime verification = NOT EXECUTED
```

不得声称 Runtime PASS。

如果只是启动命令发出但没有完整验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 30. 本轮 STOP 条件

扫描结束后：

```text
输出报告
输出 JSON
STOP
```

不得：

```text
自动修复
生成新业务 Build
重跑直到 PASS
git add
git commit
git push
进入 R60
```

本轮任务是：

```text
找全问题
分清证据
确定优先级
确定后续修复路线
```

不是把问题“扫掉”。

# TRAE P0 工程修复：固化 Build→Deploy→Runtime Verification 门禁，并完成 R58 第一次真实有效 Smoke 验证

## 0. 项目路径

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

---

# 1. 本轮目标

当前不要继续新增 paragraph business logic。

本轮目标不是：

```text
R59 继续改 caret
R59 继续改 recognizer
R59 继续改 Two-Pass
R59 继续改 Live Canonical Record Binding
```

而是先修复整个工程的：

```text
BUILD
→ DEPLOY
→ START
→ RUNTIME IDENTITY VERIFY
→ GUI SMOKE
```

闭环。

当前真实问题是：

```text
源码/构建可能已经进入 R58
但部署仍写入错误目录：

test\vault.typora\...

真实 Typora 实际加载目录却是：

test\vault\.typora\...
```

结果：

```text
新代码可能已构建
但真实 runtime 仍加载旧 bundle
```

所以本轮必须先建立：

```text
不可绕过的部署和运行身份门禁
```

只有：

```text
EXPECTED BUILD
==
ACTUAL RUNTIME BUILD
```

后，

才允许第一次真实验证 R58。

---

# 2. HARD FREEZE：禁止继续修改业务逻辑

以下全部冻结：

```text
exact `。。/..` recognizer

single `。/.`
无 business command

keydown Enter sole owner

beforeinput(insertParagraph) suppress-only

150ms transaction close

Verify-First Caret

POST-TOKEN-SELECTION

TextNode → parentElement → body P Selection Resolver

P-RUNTIME WeakMap object identity

Backspace shared caret pipeline

FORCE_INDENT → FORCE_FLUSH

semantic / visual separation

One-Shot semantic freshness

Two-Pass Rehydrate

multi-owner BLOCK ALL

R58 Live Canonical Record Binding 设计

MATCH-LIVE-BINDING 设计

temporary/live record heuristic rehydrate gate
```

本轮禁止：

```text
重新修改上述 business logic
```

除非：

```text
R58 真实加载成功后
最小 smoke 明确证明源码逻辑本身失败
```

---

# 3. 当前最优先硬错误：错误部署路径

禁止再使用：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault.typora\plugins\dist
```

这是错误路径。

唯一正确 test-vault runtime 路径：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist
```

main.js：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

style.css：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\style.css
```

runtime-load：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\inkchapter-runtime-load.json
```

---

# 4. 删除“人工临时拼部署命令”的工作流

以后禁止：

```text
Copy-Item ... test\vault.typora ...
```

禁止每轮临时手写部署路径。

新增固定脚本：

```text
scripts\deploy-test-vault.ps1
```

所有 test-vault 部署只允许通过该脚本。

---

# 5. deploy-test-vault.ps1 必须使用单一常量

脚本内部明确：

```powershell
$ProjectRoot = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$RuntimeRoot = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist"
```

目标：

```text
$RuntimeRoot\main.js
$RuntimeRoot\style.css
```

禁止：

```text
动态向上猜
字符串拼接 vault.typora
```

---

# 6. 部署脚本增加 Hard Path Assertion

在任何 Copy-Item 前必须验证：

```text
RuntimeRoot absolute path
```

必须精确等于：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist
```

若不是：

```text
throw INVALID_RUNTIME_DEPLOY_PATH
```

例如：

```powershell
$ExpectedRuntimeRoot =
  "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist"

if (
  [System.IO.Path]::GetFullPath($RuntimeRoot) -ne
  [System.IO.Path]::GetFullPath($ExpectedRuntimeRoot)
) {
  throw "INVALID_RUNTIME_DEPLOY_PATH: $RuntimeRoot"
}
```

---

# 7. 错误目录必须检测

检测：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault.typora
```

如果存在：

不要自动删除重要内容。

先输出：

```text
LEGACY_WRONG_DEPLOY_PATH_DETECTED
```

列出：

```text
path
main.js exists?
style.css exists?
last write time
```

然后：

```text
停止向该目录部署
```

如目录只含误部署产物，可在报告中建议人工清理。

本轮不得因为该目录存在就继续误判为 runtime。

---

# 8. Build ID 必须只有一个真相源

项目内只允许：

```ts
INKCHAPTER_BUILD_ID
```

唯一来源。

禁止：

```text
main.ts 一份
forensic 一份
runtime-load 一份
手写字符串多份
```

---

# 9. 本轮 Build ID

本轮工程门禁版本：

```text
inkchapter-runtime-gate-r59-<id>
```

但必须注意：

如果 R58 business code 已经完成并准备真实验证，

推荐：

```text
业务 feature 标识：
inkchapter-live-canonical-record-binding-r58-<id>

运行门禁 revision：
runtime gate revision 单独记在 diagnostic
```

不要为了本轮工程门禁把 R58 business identity 混乱。

最终至少必须能同时知道：

```text
Business Build ID
Runtime Gate Revision
```

如果当前项目只能保留一个 build marker：

则统一使用：

```text
inkchapter-live-canonical-record-binding-r58-<fresh-id>
```

并在报告注明：

```text
R59 只改部署/验证基础设施，
未修改 R58 business semantics。
```

---

# 10. Build ID 必须同步到所有 Runtime Evidence

以下必须完全一致：

```text
console:
[InkChapter] onload START build=...

runtime-load.json:
buildMarker

forensic:
INKCHAPTER_BUILD_ID

外部 verify script:
expectedBuildId
```

任一不一致：

```text
BUILD_ID_MISMATCH
HARD STOP
```

---

# 11. 新建 Runtime Verification 脚本

新增：

```text
scripts\verify-typora-runtime.ps1
```

该脚本只做：

```text
真实运行状态验证
```

不做：

```text
启动
部署
修改源码
```

---

# 12. Runtime Verification 输出结构化 JSON

至少输出：

```json
{
  "oldProcessExited": true,
  "pid": 0,
  "startTime": "",
  "mainWindowHandle": 0,
  "mainWindowTitle": "",
  "activeDocumentPath": "",
  "targetVaultPath": "",
  "targetVaultVerified": false,
  "projectMainSha256": "",
  "runtimeMainSha256": "",
  "mainHashMatch": false,
  "projectCssSha256": "",
  "runtimeCssSha256": "",
  "cssHashMatch": false,
  "expectedBuildId": "",
  "runtimeBuildId": "",
  "buildIdMatch": false,
  "actualMainJsPath": "",
  "actualStyleCssPath": "",
  "runtimeLoadPath": "",
  "initializationCount": 0,
  "all15Passed": false
}
```

---

# 13. 第 6 项 Target Vault 禁止硬编码

禁止：

```text
"6. vault: test/vault"
```

这种输出。

必须由真实证据证明。

允许证据来源：

```text
当前 active document path

ServiceDocSwitch runtime context

readContentFrom current file

runtime-load current document context

workspace active file
```

最终：

```text
activeDocumentPath
startsWith
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\
```

才：

```text
targetVaultVerified=true
```

---

# 14. Runtime 当前文档必须单独输出

必须输出例如：

```text
activeDocumentPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\doc.md
```

不能只输出：

```text
MainWindowTitle=Typora
```

---

# 15. Hash 验证必须针对真实 Runtime Path

Project main：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
dist\main.js
```

Actual runtime main：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

Project css：

```text
...\dist\style.css
```

Actual runtime css：

```text
...\test\vault\.typora\plugins\dist\style.css
```

---

# 16. #8 / #11 必须真实 Get-FileHash

必须实际执行：

```powershell
Get-FileHash <actual-runtime-main> -Algorithm SHA256
Get-FileHash <actual-runtime-style> -Algorithm SHA256
```

禁止：

```text
读取错误目录 hash
重复 project hash
仅相信 runtime-load.json 自报 hash
```

---

# 17. Runtime-load 只能辅助，不可代替文件 hash

runtime-load.json 可以提供：

```text
actualMainJsPath
actualStyleCssPath
buildMarker
initializationCount
loadedAt
```

但：

```text
实际 SHA256
```

仍必须由外部验证脚本对该 path 重新计算。

---

# 18. 启动脚本独立

新增：

```text
scripts\restart-typora-test-vault.ps1
```

职责只有：

```text
1. terminate old Typora
2. confirm old PID exited
3. launch target vault
4. wait for new process/window
```

不得：

```text
顺便猜 runtime hash
顺便部署
顺便硬编码 PASS
```

---

# 19. Restart 脚本的启动语句

启动：

```text
D:\Typora\Typora.exe
```

参数：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

---

# 20. “命令执行成功”不能代表启动成功

即使：

```text
Start-Process
```

返回正常，

也只能先写：

```text
Launch sent.
```

随后必须执行 runtime verification。

---

# 21. 严格 15 项验证

完整：

```text
1. old Typora process fully exited

2. new PID

3. new StartTime

4. MainWindowHandle != 0

5. MainWindowTitle nonempty

6. target vault REALLY open

7. project dist/main.js SHA256

8. actual runtime main.js SHA256

9. main.js hash match

10. project dist/style.css SHA256

11. actual runtime style.css SHA256

12. style.css hash match

13. expected/current build marker match

14. actual loaded script absolute path

15. initializationCount = 1
```

---

# 22. 任一项失败的唯一措辞

只要一项：

```text
FAIL
UNKNOWN
PARTIAL
```

最终必须：

```text
启动命令已发出，但尚未确认成功。
```

禁止：

```text
13/15 PASS 所以运行正常
14/15 PASS 所以运行正常
plugin root 对所以算 pass
```

---

# 23. 新 Gate 流程

以后固定：

```text
GATE 0
Typecheck / Unit / Build

GATE 1
Deploy target path

GATE 2
Project vs Actual Runtime Hash

GATE 3
Expected Build vs Runtime Build

GATE 4
Strict 15-item Runtime Verification

GATE 5
Minimal GUI Smoke
```

---

# 24. Gate 必须短路

任一 Gate FAIL：

```text
HARD STOP
```

后续 Gate：

```text
SKIPPED
```

不能：

```text
部署错了
但继续 GUI

build mismatch
但继续分析业务
```

---

# 25. GATE 0

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

输出：

```text
TYPECHECK
UNIT
BUILD
```

如果 fail：

```text
STOP
```

---

# 26. GATE 1

调用：

```text
scripts\deploy-test-vault.ps1
```

必须输出：

```text
PROJECT_MAIN
PROJECT_STYLE

RUNTIME_MAIN
RUNTIME_STYLE

DEPLOY_ROOT

DEPLOY_PATH_VALID=true
```

---

# 27. GATE 2

部署后，Typora 启动前就比较：

```text
project main hash
runtime main hash

project css hash
runtime css hash
```

必须：

```text
both match
```

否则：

```text
DEPLOY_HASH_MISMATCH
STOP
```

---

# 28. GATE 3：Runtime Build Identity

启动后第一业务门禁：

```text
expectedBuildId
==
runtime-load buildMarker
==
console onload build
```

必须三者一致。

如果：

```text
expected R58
actual R56
```

立即：

```text
BUILD_ID_MISMATCH
STOP
```

禁止 GUI business test。

---

# 29. GATE 4：Strict Runtime Verification

调用：

```text
scripts\verify-typora-runtime.ps1
```

必须：

```text
all15Passed=true
```

否则：

```text
STOP
```

---

# 30. GATE 5：第一次真实 R58 Smoke

只有 Gate 0~4 全部 PASS，

才允许执行 R58 最小 smoke。

---

# 31. R58 Smoke 只做三项，各 1 次

禁止先跑 3/3、5/5、30/30。

只做：

```text
S1
single `。`

S2
`。。+Enter`

S3
`。。+Enter`
→ first Backspace
```

---

# 32. S1：Single Dot

输入：

```text
。
```

必须：

```text
business command count=0

semantic=AUTO

computed indent=0px

recordCount unchanged
```

并且绝对不能：

```text
REHYDRATE decision=APPLY
mode=force-indent
```

来自 old live record。

---

# 33. S2：Exact Enter

before：

```text
recordCount=N
```

执行：

```text
。。
Enter
```

必须看到 R58 新 trace：

```text
CANONICAL-RECORD-COMMIT
```

要求：

```text
recordCountBefore=N

recordCountAfter=N+1

recordId=R

duplicateAppendDetected=false

boundRuntimeId=P-RUNTIME-X

temporary=true
```

---

# 34. S2 必须看到 Live Binding

必须出现：

```text
LIVE-BINDING-RESOLUTION
```

要求：

```text
recordId=R

bindingExists=true

boundRuntimeId=P-RUNTIME-X

strategy=MATCH-LIVE-BINDING

heuristicSkipped=true

resolvedRuntimeId=P-RUNTIME-X
```

---

# 35. S2 Caret 继续验证但不允许改

继续要求：

```text
POST-TOKEN-SELECTION

sameAsCommand=true

localOffset=0

alreadyCorrect=true

caretWriteAttempted=false
```

这部分若继续 PASS：

```text
冻结
```

---

# 36. S3：Backspace Same Record

执行：

```text
。。
Enter
```

得到：

```text
recordId=R
```

然后当前段 logical start：

```text
Backspace
```

必须出现：

```text
CANONICAL-RECORD-BACKSPACE
```

要求：

```text
recordId=R

sameRecord=true

recordCountBefore=N+1

recordCountAfter=N+1

modeBefore=FORCE_INDENT

modeAfter=FORCE_FLUSH

appendOccurred=false
```

---

# 37. S3 Rehydrate 不得 Append

Backspace 后：

```text
refresh
rehydrate
```

必须：

```text
recordCount unchanged
```

---

# 38. S3 Handoff Semantic Freshness 继续冻结

如果随后发生 replacement：

必须仍保持：

```text
semanticAtReplacementTime=force-flush

semanticAfter=force-flush

indentAfter=0px
```

本轮不改这部分。

---

# 39. R58 新日志缺失则立即 STOP

如果 build marker 声称：

```text
R58
```

但没有出现：

```text
CANONICAL-RECORD-COMMIT
LIVE-BINDING-RESOLUTION
CANONICAL-RECORD-BACKSPACE
SIDECAR-MEMORY-COUNT
```

应判：

```text
R58 instrumentation/runtime mismatch
```

立即停止。

---

# 40. 不得用旧 R56 日志评价 R58

如果 runtime：

```text
build=R56
```

则结论只能：

```text
R58 NOT TESTED
```

不能：

```text
R58 failed
```

---

# 41. Rehydrate 职责审计

本轮不要大改 Two-Pass，

但必须审计：

```text
applyParagraphRehydratePlan
→ scheduleSidecarWrite
```

是否在 normal rehydrate 中发生。

输出：

```text
REHYDRATE-WRITE-AUDIT
```

---

# 42. Normal Rehydrate 原则

正常：

```text
rehydrate
=
read canonical state
→ project semantic/visual to DOM
```

默认不应该：

```text
创建 record
append record
重写 canonical state
```

---

# 43. 允许 Rehydrate 写 canonical 的例外

仅允许明确：

```text
legacy migration
anchor repair
dedupe repair
schema migration
```

并必须：

```text
单独标记 reason
```

---

# 44. 本轮只审计 Rehydrate Side Effect

不要在没有证据前：

```text
重写整个 rehydrate pipeline
```

先报告：

```text
哪些 normal rehydrate path 会 scheduleSidecarWrite
为什么
是否导致 record count mutation
```

---

# 45. Runtime Banner

新增启动后一次性 banner：

```text
================================================
InkChapter Runtime
Business Build: <id>
Runtime Gate Revision: R59
Project Main SHA: <hash>
Runtime Main SHA: <hash>
Runtime Main Path: <path>
Active Doc: <path>
Target Vault Verified: true/false
Initialization Count: 1
================================================
```

---

# 46. 日志分类

推荐：

```text
[BOOT]
[DEPLOY]
[RUNTIME]
[COMMAND]
[CARET]
[RECORD]
[LIVE-BINDING]
[REHYDRATE]
[HANDOFF]
```

不要求大规模重构 logger，

但关键 R58 新日志必须易筛选。

---

# 47. Build ID 与 Runtime Gate Revision 分开

如果实现方便：

```text
BUSINESS_BUILD_ID
=
inkchapter-live-canonical-record-binding-r58-<id>

RUNTIME_GATE_REVISION
=
r59
```

不要因为纯部署脚本变化：

```text
把 business feature 版本误认成 R59
```

---

# 48. 测试脚本

新增：

```text
scripts\run-r58-first-valid-smoke.ps1
```

它只能在：

```text
verify-typora-runtime.ps1
返回 all15Passed=true
```

后运行。

如果没有 GUI automation 能力：

脚本至少：

```text
输出 manual smoke checklist
并记录当前 expected build/runtime identity
```

不能假装 GUI 已自动通过。

---

# 49. GUI 未真实验证时的措辞

只能写：

```text
Runtime identity verified.
GUI smoke not yet verified.
```

不能：

```text
R58 PASS
```

---

# 50. 错误路径自动保护测试

新增：

```text
DEPLOY-1
runtime root exact correct

DEPLOY-2
`test\vault.typora` rejected

DEPLOY-3
wrong root throws INVALID_RUNTIME_DEPLOY_PATH

DEPLOY-4
deploy writes actual `.typora` runtime

DEPLOY-5
project/runtime main hash match

DEPLOY-6
project/runtime css hash match
```

---

# 51. Build Identity Tests

新增：

```text
BUILD-1
one build source

BUILD-2
console marker == source

BUILD-3
runtime-load marker == source

BUILD-4
expected == actual

BUILD-5
R56 actual with R58 expected → HARD STOP

BUILD-6
new R58 traces absent → mismatch warning
```

---

# 52. Runtime Verification Tests

新增：

```text
RT-1 PID new

RT-2 StartTime new

RT-3 HWND nonzero

RT-4 title nonempty

RT-5 active doc in target vault

RT-6 actual runtime path exact `.typora`

RT-7 runtime hash external recompute

RT-8 build match

RT-9 initializationCount=1

RT-10 any missing field → all15Passed=false
```

---

# 53. 运行步骤固定化

以后完整流程：

```text
pnpm exec tsc --noEmit
↓
pnpm test
↓
pnpm run build:dev
↓
scripts\deploy-test-vault.ps1
↓
deploy hash verification
↓
scripts\restart-typora-test-vault.ps1
↓
scripts\verify-typora-runtime.ps1
↓
expected build == actual build ?
↓
15/15 ?
↓
YES
↓
R58 S1/S2/S3
```

---

# 54. 当前错误目录不得作为任何验证来源

禁止任何：

```text
Get-FileHash
Get-Content runtime-load
Copy-Item
```

指向：

```text
test\vault.typora
```

来证明 runtime。

---

# 55. Source of Truth 路径表

唯一：

```text
PROJECT MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

PROJECT CSS:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\style.css

RUNTIME MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

RUNTIME CSS:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\style.css

RUNTIME LOAD:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter-runtime-load.json

TARGET VAULT:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

---

# 56. SyntaxError

继续记录：

```text
SyntaxError: Unexpected token ')'
```

如果没有 source attribution：

```text
UNRESOLVED
```

不得因为它修改 paragraph business logic。

---

# 57. Git

禁止：

```text
git add
git commit
git push
```

只允许：

```text
git status
git diff
```

用于报告。

---

# 58. 成功标准

本轮 PASS 必须满足：

```text
错误部署目录
不再写入

deploy-test-vault.ps1
只部署 `.typora`

project/runtime main hash
真实匹配

project/runtime css hash
真实匹配

expected build
==
actual runtime build

runtime marker
不是旧 R56

runtime-load path
正确 `.typora`

target vault
由真实 active document 证明

initializationCount=1

strict 15/15
全部真实通过

然后：
R58 S1
single dot PASS

R58 S2
canonical record exactly +1
live binding PASS

R58 S3
Backspace same record
recordCount unchanged
```

---

# 59. 任一门禁失败的正确处理

```text
STOP
```

不要：

```text
继续业务测试
继续修改 business logic
继续 3/3
继续 30/30
```

报告：

```text
FAILED GATE:
exact gate

EXPECTED:
...

ACTUAL:
...

NEXT ACTION:
...
```

---

# 60. 最终报告格式

```text
# 1. Git Baseline

# 2. Current Wrong Deploy Path Root Cause

# 3. Correct Runtime Source-of-Truth Paths

# 4. deploy-test-vault.ps1

# 5. Wrong Path Hard Guard

# 6. restart-typora-test-vault.ps1

# 7. verify-typora-runtime.ps1

# 8. Runtime Verification JSON

# 9. Build ID Single Source

# 10. Business Build ID

# 11. Runtime Gate Revision

# 12. GATE 0
Typecheck / Unit / Build

# 13. GATE 1
Deploy Path

# 14. GATE 2
Hashes

# 15. GATE 3
Expected vs Actual Build

# 16. GATE 4
Strict 15 Items

# 17. Actual Active Document

# 18. Target Vault Proof

# 19. Actual Runtime Main Path

# 20. Actual Runtime CSS Path

# 21. initializationCount

# 22. Runtime Banner

# 23. REHYDRATE-WRITE-AUDIT

# 24. DEPLOY-1~DEPLOY-6

# 25. BUILD-1~BUILD-6

# 26. RT-1~RT-10

# 27. Is R58 Really Loaded?
TRUE/FALSE

# 28. S1 Single Dot
PASS/FAIL/SKIPPED

# 29. S2 Enter Canonical Record
PASS/FAIL/SKIPPED

# 30. S2 Live Binding
PASS/FAIL/SKIPPED

# 31. S3 Backspace Same Record
PASS/FAIL/SKIPPED

# 32. Duplicate Record Count

# 33. Single Dot Wrong APPLY Count

# 34. Remaining Failure

# 35. Is 3/3 Smoke Ready?
TRUE/FALSE

# 36. Is 30/30 Ready?
FALSE

# 37. Startup Final Verdict

# 38. Git Final Status
```

---

# 61. 本轮最终原则

```text
第一：
先证明“运行的就是刚构建的代码”，
再分析业务。

第二：
部署路径必须只有一个真相源：
test\vault\.typora\plugins\dist。

第三：
Build ID mismatch
就是 HARD STOP。

第四：
错误目录 hash match
没有任何 runtime 证明价值。

第五：
15 项启动验证
必须全部真实成立，
不能硬编码、不能部分通过冒充成功。

第六：
R58 没有真实加载，
就只能写：
R58 NOT TESTED。

第七：
只有第一次真实 R58 runtime identity 通过后，
才允许评价 Live Canonical Record Binding 是否修复成功。
```

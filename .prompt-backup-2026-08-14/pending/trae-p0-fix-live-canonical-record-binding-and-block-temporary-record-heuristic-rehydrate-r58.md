# TRAE P0 修复工程：建立 Live Canonical Record Binding，禁止 Temporary Record 参与 Heuristic Rehydrate，并统一 OBS Selection Truth

## 0. 项目路径

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

---

# 1. 当前真实状态

最新 runtime 已经证明以下部分应继续冻结：

```text
Verify-First Caret
PASS

POST-TOKEN-SELECTION:
resolvedRuntimeId == commandRuntimeId
localOffset = 0
alreadyCorrect = true
caretWriteAttempted = false
caretSuccess = true

Enter immediate transaction:
tokenSuccess = true
paragraphCountSuccess = true
semanticSuccess = true
visualSuccess = true
caretSuccess = true
overallSuccess = true

Runtime Paragraph ID:
P-RUNTIME-N
已进入 runtime

Backspace shared caret verification:
alreadyCorrect = true
caretWriteAttempted = false

One-Shot semantic freshness:
Enter FORCE_INDENT
→ Backspace FORCE_FLUSH
→ replacement
最终 replacement 仍 FORCE_FLUSH / 0px
```

当前真正的新 P0 已经收敛为：

```text
P0-A
Canonical record 仍然没有做到
Enter create exactly once
Backspace update SAME recordId

当前日志中：
recordCount
1 → 2 → 3 → 4 → 5

其中 Backspace 后也增加，
说明仍在 append duplicate record。


P0-B
刚创建的 temporary/live record
仍参与 generic heuristic rehydrate。

导致旧 record 能错误匹配新的单 `。` paragraph：

single dot 本身仍 AUTO，
但 REHYDRATE-GROUP 却：
decision=APPLY
winner=<old record>
mode=force-indent


P0-C
Two-Pass 只能挡 multi-owner，
挡不住“唯一但身份错误”的 candidate。


P0-D
OBS-SELECTION 仍未完全使用新的 Selection Resolver。

当前仍出现：
selParagraph=undefined
sameAsCommand=true/false

说明 observation truth 仍不完整。


P0-E
Build marker 仍显示 R56，
与实际已进入 runtime 的 R57 代码不一致。

严格 build/startup identity 仍未证明。
```

---

# 2. HARD FREEZE：本轮禁止修改

以下继续冻结：

```text
exact `。。/..` recognizer

single `。` / `.`
绝不触发 business command

keydown Enter capture
= sole business owner

beforeinput(insertParagraph)
= suppress-only

150ms transaction close

token consume current same paragraph

paragraph count unchanged

Verify-First Caret

POST-TOKEN-SELECTION

Selection TextNode → parentElement → P resolver

Runtime Paragraph ID via object identity / WeakMap

Backspace shared caret pipeline

FORCE_INDENT → FORCE_FLUSH

semantic / visual separation

One-Shot semantic freshness

Two-Pass Rehydrate:
RESOLVE ALL
→ GROUP
→ DECIDE
→ APPLY

multi-owner BLOCK ALL
```

禁止：

```text
重新改 recognizer
重新改 caret 主模型
重新改 Two-Pass grouping
恢复 long-lived Pending
让 handoff 写 caret
让 global refresh 写 caret
让 rehydrate 写 caret
```

---

# 3. 本轮核心原则

本轮必须建立：

```text
Canonical Record Identity
=
stable recordId
+
live runtime binding
```

不能继续：

```text
刚创建的 record
立即退化成：
anchor / ordinal / textHash / weak match
去重新猜 paragraph 身份
```

---

# 4. 最终产品合同：Enter 必须立即创建 / Upsert Exactly Once

这一条不可更改。

Exact：

```text
。。
Enter
```

或：

```text
..
Enter
```

必须在同一个 Enter business command 中：

```text
create / upsert canonical sidecar record
EXACTLY ONCE
```

记录至少：

```text
recordId
mode = FORCE_INDENT
temporary = true
current anchor snapshot
```

必须：

```text
stable recordId
```

---

# 5. 禁止再次延迟持久化到正文输入

不得：

```text
Enter 后先不创建 record
等用户输入正文再创建
```

正确：

```text
Enter
→ canonical record R 立即存在
```

后续正文输入：

```text
更新 SAME R
temporary=false
anchor updated
recordCount unchanged
```

---

# 6. Live Canonical Record Binding

新增明确 runtime binding，例如：

```ts
interface LiveParagraphRecordBinding {
  recordId: string

  txnId: string

  currentElement: HTMLElement

  currentRuntimeId: string

  generation: number

  temporary: boolean

  createdAt: number
}
```

维护：

```ts
Map<string, LiveParagraphRecordBinding>
```

key：

```text
recordId
```

另可维护：

```ts
WeakMap<HTMLElement, string>
```

用于：

```text
currentElement → recordId
```

---

# 7. Enter Transaction 必须绑定 Record

正确序列：

```text
keydown Enter recognize exact token
↓
prevent native split
↓
begin txn
↓
generate/bind stable recordId R
↓
create/upsert canonical record R exactly once
mode=FORCE_INDENT
temporary=true
↓
bind:
R ↔ current command paragraph P-RUNTIME-X
↓
consume token
↓
Verify-First caret
↓
semantic FORCE_INDENT
↓
visual 32px
↓
close txn ~150ms
```

---

# 8. Exactly-Once 的定义

一次 Enter command：

```text
record count before = N
```

如果是新 command paragraph：

```text
record count after = N+1
```

只允许：

```text
+1 exactly
```

禁止：

```text
+0
+2
+3
```

---

# 9. Record ID 必须进入 Transaction Trace

新增：

```text
CANONICAL-RECORD-COMMIT
```

字段：

```text
txnId

recordId

operation:
CREATE
UPSERT_EXISTING

recordCountBefore
recordCountAfter

modeBefore
modeAfter

temporaryBefore
temporaryAfter

boundRuntimeId

duplicateAppendDetected
```

---

# 10. Backspace 必须通过 Live Binding 找到 SAME Record

第一次 Backspace：

```text
selection current paragraph
→ resolve runtime element
→ lookup element → recordId
```

必须得到：

```text
same R
```

然后：

```text
R.mode:
FORCE_INDENT → FORCE_FLUSH
```

record count：

```text
unchanged
```

禁止：

```text
新建 record
append new record
基于 anchor 再猜一次 record
```

---

# 11. Backspace Trace

新增：

```text
CANONICAL-RECORD-BACKSPACE
```

字段：

```text
runtimeId

recordId

recordCountBefore
recordCountAfter

modeBefore=FORCE_INDENT
modeAfter=FORCE_FLUSH

sameRecord=true

appendOccurred=false
```

---

# 12. Body Promotion 必须更新 SAME Record

当 temporary empty paragraph 开始输入正文：

```text
recordId R
temporary=true
```

输入正文后：

```text
update R
temporary=false
anchor updated
```

必须：

```text
recordCount unchanged
```

禁止：

```text
append new promoted record
```

---

# 13. One-Shot Replacement 必须同步更新 Live Binding

当前：

```text
P-RUNTIME-5
→ replacement
P-RUNTIME-8
```

One-Shot transfer成功后：

```text
binding.currentElement = replacement
binding.currentRuntimeId = P-RUNTIME-8
binding.generation++
```

recordId：

```text
保持 SAME R
```

绝不能：

```text
replacement 时创建新 record
```

---

# 14. Handoff 允许携带 recordId，但不得成为 semantic source

One-Shot 可以保存：

```text
recordId
txnId
currentElement
currentRuntimeId
```

但：

```text
semantic source
```

仍然必须来自 canonical record / explicit semantic model。

Handoff 自己不能成为第二份长期 semantic source。

---

# 15. P0-B：Live Temporary Record 不得进入 Generic Heuristic Rehydrate

这是当前最重要的新隔离规则。

如果 record：

```text
temporary=true
```

且：

```text
存在 active live binding
```

则 generic rehydrate：

```text
不得对它执行：
textHash match
ordinal match
proximity
weak anchor
normalized anchor
legacy
```

---

# 16. Live-Bound Record 的唯一合法目标

对于：

```text
record R
```

若：

```text
live binding currentElement connected
```

则 R 的唯一 target：

```text
binding.currentElement
```

不得扫描其它 paragraph。

---

# 17. Known Replacement 的唯一合法目标

若：

```text
binding.currentElement disconnected
```

但 One-Shot 已经唯一解析 replacement：

```text
binding.currentElement = replacement
```

则：

```text
R 只属于 replacement
```

不得：

```text
同时再跑 heuristic candidate resolver
```

---

# 18. 只有没有 Live Binding 时才允许 Persistent Rehydrate Matching

例如：

```text
save/reopen
plugin restart
document reopen
```

此时 runtime binding 已不存在，

才允许：

```text
persistent anchor resolver
```

进入：

```text
Two-Pass Rehydrate
```

---

# 19. Rehydrate Pipeline 增加 Live-Binding Gate

在 candidate resolution 之前：

```text
if record has active live binding:
    resolve only bound element
    strategy = MATCH-LIVE-BINDING
else:
    use existing persistent matching pipeline
```

新增 strategy：

```text
MATCH-LIVE-BINDING
```

它优先级必须高于所有：

```text
MATCH-EXACT-ANCHOR
MATCH-NORMALIZED-ANCHOR
MATCH-PROMOTED-ANCHOR
MATCH-INDEX-FALLBACK
MATCH-PROXIMITY
MATCH-LEGACY
```

---

# 20. Live Binding 不应该触发 Multi-Owner 猜测

如果两个不同 live record：

```text
R1
R2
```

被绑定到同一个 currentElement：

这是：

```text
LIVE_BINDING_COLLISION
```

必须 HARD BLOCK。

不能：

```text
选择其中一个
```

新增：

```text
LIVE-BINDING-COLLISION
```

---

# 21. 单 `。` 必须增加 Hard Protection

单：

```text
。
```

仍然：

```text
semantic=AUTO
```

但保护不能只在 recognizer。

Rehydrate 还必须满足：

```text
任何 active live temporary record
不得 heuristic APPLY 到这个新 paragraph
```

---

# 22. 当前真实错误必须专门回归

当前日志已经出现：

```text
SINGLE-DOT-TRACE:
text="。"
semantic=auto
```

随后：

```text
REHYDRATE-GROUP:
decision=APPLY
winner=<old record>
mode=force-indent
```

本轮必须新增 regression：

```text
SDR-1
旧 temporary live record 存在
新 paragraph 输入单 `。`
→ candidateCount from that live record = 0

SDR-2
single `。`
不得被 MATCH-LIVE-BINDING 指向
除非它本身就是绑定的 currentElement

SDR-3
single `。`
最终 semantic=AUTO

SDR-4
single `。`
最终 computed indent=0px
```

---

# 23. Two-Pass 继续冻结

不要因为：

```text
unique wrong candidate
```

而修改：

```text
grouping
ambiguity
winner selection
```

本轮修的是：

```text
candidate eligibility / identity source
```

不是：

```text
Two-Pass planner
```

---

# 24. Live Binding Candidate Trace

新增：

```text
LIVE-BINDING-RESOLUTION
```

字段：

```text
recordId

temporary

bindingExists

boundRuntimeId

boundConnected

strategy

heuristicSkipped

resolvedRuntimeId

collision
```

---

# 25. Generic Rehydrate Trace 必须标记来源

每条 candidate 必须能区分：

```text
LIVE
PERSISTENT
LEGACY
```

新增：

```text
candidateSource
```

禁止把：

```text
live-bound temporary record
```

伪装成：

```text
weak persistent candidate
```

---

# 26. P0-C：OBS-SELECTION 必须完全迁移到公共 Selection Resolver

当前：

```text
POST-TOKEN-SELECTION
```

已经正确：

```text
resolvedRuntimeId=P-RUNTIME-X
```

但：

```text
OBS-SELECTION
selParagraph=undefined
```

仍然存在。

这说明 Observation 还没统一。

---

# 27. OBS-SELECTION 只允许调用公共 Resolver

禁止 Observation 自己：

```text
closest
cursor offset
old helper
fingerprint
```

必须：

```text
resolveSelectionParagraph()
```

与 Enter / Backspace 完全同源。

---

# 28. OBS-SELECTION 新格式

必须输出：

```text
OBS-SELECTION

time

selectionExists

selectionRuntimeId

selectionOrdinal

localLogicalOffset

commandCurrentRuntimeId

sameAsCommandCurrentElement

continuityGeneration
```

禁止：

```text
selParagraph=undefined
```

但同时又给：

```text
sameAsCommand=true
```

这种矛盾日志。

---

# 29. sameAsCommand 的唯一算法

必须：

```ts
resolution.paragraph === continuity.currentElement
```

不是：

```text
ordinal equal
runtime string equal
global offset equal
```

---

# 30. Observation 必须跟随 Replacement 后的 currentElement

One-Shot 后：

```text
continuity.currentElement = replacement
```

Observation 后续必须比较：

```text
selection paragraph
===
replacement
```

不能继续只对：

```text
originalElement
```

判断。

---

# 31. Memory Sidecar Record Count 必须稳定

当前测试中：

```text
1 → 2 → 3 → 4 → 5
```

必须逐操作解释。

新增：

```text
SIDECAR-MEMORY-COUNT
```

每次：

```text
Enter
Backspace
promotion
replacement
rehydrate
```

记录：

```text
before
after
operation
recordId
```

---

# 32. 允许的 Count 变化

```text
New Enter:
N → N+1

Backspace:
N → N

Body promotion:
N → N

One-Shot replacement:
N → N

Rehydrate:
N → N

Refresh:
N → N

Single dot:
N → N
```

---

# 33. 禁止 Rehydrate 修改 Canonical Record Count

Rehydrate 是：

```text
projection / restoration
```

不是：

```text
record creation
```

除非是明确：

```text
legacy migration
```

且必须单独标记。

本轮 normal rehydrate：

```text
record count mutation = 0
```

---

# 34. 禁止 Backspace 通过 applyParagraphIndentOverrideToSidecar Append

必须审计：

```text
applyParagraphIndentOverride()
applyParagraphIndentOverrideToSidecar()
onBackspaceCommand()
```

找出为什么：

```text
Backspace
→ recordCount +1
```

改为：

```text
lookup same recordId
→ update
```

---

# 35. 禁止 Enter 重复 Append 同一 Paragraph

如果：

```text
同一个 live-bound command paragraph
```

因为重复 event / refresh 再次调用 sidecar mutation，

必须：

```text
UPSERT SAME RECORD
```

不能：

```text
append duplicate
```

---

# 36. Canonical Record Registry

推荐明确维护：

```ts
recordById: Map<string, ParagraphRecord>

liveBindingByRecordId: Map<string, LiveParagraphRecordBinding>

recordIdByElement: WeakMap<HTMLElement, string>
```

不要依靠数组：

```text
find by anchor
```

来处理 live session identity。

---

# 37. Stable recordId 生成规则

recordId 生成：

```text
只在首次 exact Enter command
```

一次。

禁止：

```text
Backspace 再生成
promotion 再生成
replacement 再生成
rehydrate 再生成
```

---

# 38. Test：Canonical Record

至少：

```text
LR-1
First Enter:
N → N+1 exactly

LR-2
Enter binds stable recordId R

LR-3
Backspace updates R
N unchanged

LR-4
Body promotion updates R
N unchanged

LR-5
One-Shot replacement updates binding only
N unchanged

LR-6
Refresh does not append

LR-7
Rehydrate does not append

LR-8
Single dot does not append

LR-9
Repeated apply on same live paragraph remains same R

LR-10
Two different Enter commands create two different recordIds
```

---

# 39. Test：Live Binding Rehydrate Gate

至少：

```text
LB-1
temporary live record skips heuristic resolver

LB-2
connected bound element is sole target

LB-3
replacement updated binding becomes sole target

LB-4
live record cannot target neighbor paragraph

LB-5
live record cannot target new single-dot paragraph

LB-6
no live binding → persistent resolver allowed

LB-7
two live records bound same element → HARD BLOCK

LB-8
MATCH-LIVE-BINDING has highest priority
```

---

# 40. Test：Single Dot Regression

至少：

```text
SDR-1
single `。`
no business command

SDR-2
single `。`
no new canonical record

SDR-3
single `。`
no live-record heuristic candidate

SDR-4
single `。`
semantic=AUTO

SDR-5
single `。`
indent=0px

SDR-6
old live force-indent record
cannot APPLY to single dot
```

---

# 41. Test：Observation Resolver

至少：

```text
OR-1
OBS uses shared Selection Resolver

OR-2
TextNode anchor resolves runtimeId

OR-3
OBS selectionRuntimeId never undefined for valid body P

OR-4
sameAsCommand uses object equality

OR-5
after replacement compares against continuity.currentElement

OR-6
global cursor offset does not define sameAsCommand
```

---

# 42. GUI 验证顺序

只做：

```text
G1
Single `。`

G2
`。。+Enter`

G3
`。。+Enter`
→ first Backspace

G4
`。。+Enter`
→ wait replacement
→ first Backspace

G5
两个不同空 paragraph
分别 `。。+Enter`
```

每组：

```text
3 次
```

---

# 43. G1 成功标准

```text
single `。`

business command count=0

recordCount unchanged

semantic=AUTO

indent=0px

任何 old live record：
不得 decision=APPLY 到该 paragraph
```

---

# 44. G2 成功标准

before：

```text
recordCount=N
```

after Enter：

```text
recordCount=N+1 exactly

recordId=R

boundRuntimeId=P-RUNTIME-X

temporary=true

POST-TOKEN-SELECTION:
alreadyCorrect=true

caretWriteAttempted=false
```

---

# 45. G3 成功标准

Enter 后：

```text
recordId=R
recordCount=N+1
```

第一次 Backspace：

```text
same recordId=R

mode:
FORCE_INDENT → FORCE_FLUSH

recordCount still N+1

appendOccurred=false

caret remains same paragraph offset0
```

---

# 46. G4 成功标准

Enter：

```text
R ↔ P-RUNTIME-A
```

replacement：

```text
R ↔ P-RUNTIME-B
generation=1
```

Backspace：

```text
update R
FORCE_FLUSH
```

如果再 replacement：

```text
仍然 SAME R
```

本轮 One-Shot only one replacement；若真实出现第二 replacement：

```text
只记录
不要恢复 Pending
```

---

# 47. G5 成功标准

两个不同 command：

```text
Enter 1
→ R1

Enter 2
→ R2
```

必须：

```text
R1 != R2

recordCount exactly +2

各自 live binding 独立
```

不能：

```text
共享同一 record
```

---

# 48. GUI 任一 Duplicate Record 立即 HARD STOP

只要：

```text
Backspace:
recordCount +1
```

或：

```text
replacement:
recordCount +1
```

或：

```text
refresh:
recordCount +1
```

立即：

```text
STOP
```

输出：

```text
CANONICAL-RECORD-COMMIT
CANONICAL-RECORD-BACKSPACE
SIDECAR-MEMORY-COUNT
LIVE-BINDING-RESOLUTION
HANDOFF-CURRENT-SEMANTIC
REHYDRATE candidate provenance
```

不得继续批量测试。

---

# 49. GUI 任一 Single Dot 被 Rehydrate APPLY 立即 HARD STOP

只要：

```text
text="。"
```

出现：

```text
REHYDRATE-GROUP
decision=APPLY
mode=force-indent
```

立即：

```text
STOP
```

输出该 winner record 的：

```text
recordId
temporary
liveBindingExists
boundRuntimeId
candidateSource
matchStrategy
anchor
ordinal
```

---

# 50. Physical Sidecar I/O 仍可被 Vault Gate 阻止

当前：

```text
vaultRoot=unknown
```

物理 write 可以继续：

```text
blocked
```

但这不允许 canonical model 失真。

也就是：

```text
disk write blocked
!=
memory record identity broken
```

---

# 51. Vault Root 本轮不展开修复

本轮只保证：

```text
canonical record model 正确
```

真正 production：

```text
vault.path
```

注入 sidecar store 的修复留后续单独阶段。

---

# 52. Build Marker 必须更新

当前真实日志仍：

```text
inkchapter-paragraph-local-caret-empty-block-r56-e5f2i
```

本轮必须更新为唯一：

```text
inkchapter-live-canonical-record-binding-r58-<id>
```

所有：

```text
onload marker
runtime-load.json
forensic marker
```

必须一致。

---

# 53. 禁止 Build ID 与代码版本不一致

如果 runtime 出现新：

```text
LIVE-BINDING-RESOLUTION
```

但 build marker 仍是 R56/R57：

```text
FAIL
```

---

# 54. Strict Startup Verification

每次启动/重启 Typora 必须真实验证 15 项：

```text
1. old Typora process fully exited

2. new PID

3. new StartTime

4. MainWindowHandle != 0

5. MainWindowTitle nonempty

6. target vault REALLY open
   必须从真实窗口/当前文档/runtime context 证明
   不能硬编码字符串

7. project dist/main.js SHA256

8. actual runtime main.js SHA256

9. main.js hash match

10. project dist/style.css SHA256

11. actual runtime style.css SHA256

12. style.css hash match

13. current R58 build marker

14. actual loaded script absolute path

15. initializationCount = 1
```

---

# 55. 正确 Runtime 路径

必须：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\style.css
```

runtime-load：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\inkchapter-runtime-load.json
```

禁止：

```text
test\vault.typora
```

---

# 56. Hash 必须真实计算

#8 / #11：

```powershell
Get-FileHash
```

必须对：

```text
真实 runtime path
```

执行。

不得：

```text
重复 project hash
假装 runtime hash
```

---

# 57. 任一启动项缺失

必须写：

```text
启动命令已发出，但尚未确认成功。
```

不得声称：

```text
15/15 PASS
```

---

# 58. SyntaxError

继续记录：

```text
SyntaxError: Unexpected token ')'
```

若无 source 证据：

```text
UNRESOLVED
```

不得因此修改 paragraph business logic。

---

# 59. Typecheck / Unit / Build

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

测试通过：

```text
不能代替真实 GUI
```

---

# 60. 最终成功标准

全部成立才 PASS：

```text
Verify-First Caret
保持 PASS

Selection Resolver
保持 PASS

Backspace shared caret
保持 PASS

One-Shot semantic freshness
保持 PASS

Enter:
canonical record exactly +1

Backspace:
same recordId
recordCount unchanged

Body promotion:
same recordId
recordCount unchanged

Replacement:
same recordId
recordCount unchanged

Live temporary record:
不参与 generic heuristic matching

Live record:
只允许 target bound currentElement

Single `。`:
AUTO / 0px

Single `。`:
无 old record APPLY

Two-Pass:
保持不变

OBS-SELECTION:
使用公共 resolver
selectionRuntimeId 可用

Build ID:
R58 一致

Strict startup:
15/15 真实验证
```

---

# 61. 本轮禁止事项

不得：

```text
git add
git commit
git push
```

不得：

```text
重新改 recognizer
```

不得：

```text
重新改 Verify-First Caret
```

不得：

```text
重新改 Two-Pass grouping
```

不得：

```text
恢复 long-lived Pending
```

不得：

```text
Backspace append record
```

不得：

```text
replacement append record
```

不得：

```text
live temporary record
参与 weak/ordinal/proximity heuristic
```

不得：

```text
把 Single Dot 再次归咎于 recognizer
```

不得：

```text
进入 30/30 stress
```

---

# 62. 最终报告格式

```text
# 1. Git Baseline

# 2. R57 Runtime Evidence Summary

# 3. Frozen Components Proof

# 4. Duplicate Record Root Cause

# 5. Live Canonical Record Binding Design

# 6. Enter Exactly-Once Record Commit

# 7. Stable RecordId

# 8. Backspace Same-Record Update

# 9. Body Promotion Same-Record Update

# 10. One-Shot Binding Update

# 11. Live Temporary Rehydrate Gate

# 12. MATCH-LIVE-BINDING

# 13. LIVE-BINDING-COLLISION Guard

# 14. Single Dot Rehydrate Regression Root Cause

# 15. Single Dot Hard Protection

# 16. OBS-SELECTION Shared Resolver Migration

# 17. LR-1~LR-10

# 18. LB-1~LB-8

# 19. SDR-1~SDR-6

# 20. OR-1~OR-6

# 21. Typecheck

# 22. Unit Tests

# 23. Build

# 24. R58 Build ID

# 25. Deployment Paths

# 26. Strict 15-item Startup Verification

# 27. G1 3/3

# 28. G2 3/3

# 29. G3 3/3

# 30. G4 3/3

# 31. G5 3/3

# 32. Duplicate Record Count

# 33. Single Dot Wrong APPLY Count

# 34. Backspace Append Count

# 35. Replacement Append Count

# 36. Live Record Heuristic Candidate Count

# 37. Remaining Failure
NONE / exact failure

# 38. Is Vault-Root Sidecar I/O Ready?
FALSE unless separately fixed

# 39. Is 30/30 Ready?
FALSE

# 40. Git Final Status
```

---

# 63. 本轮最终原则

```text
第一：
Enter 创建 canonical record exactly once immediately。

第二：
Backspace / promotion / replacement
永远更新 SAME recordId，
绝不 append。

第三：
刚创建且 live-bound 的 temporary record
不能再退化成 heuristic anchor matching。

第四：
Live identity 用 recordId + currentElement/runtimeId，
不是 text/ordinal 猜测。

第五：
Two-Pass 继续作为 persistent ambiguity safety，
但 live session identity 必须在进入 Two-Pass 前就确定。

第六：
Single `。` recognizer 本身已经正确，
当前必须阻止的是旧 live record 错误 APPLY 到它。

第七：
Observation 必须和 Enter/Backspace 共用同一个 Selection Resolver。
```

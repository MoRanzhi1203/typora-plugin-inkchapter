# Trae P0 — R58.7 A1×10 自动化 Runner + Trusted IME Smoke Gate

## 0. 当前状态

当前插件 Build 固定：

```text
inkchapter-r58-7-clean-r0-closure-p4v9n
```

已经通过：

```text
Fresh-05 Clean Baseline = PASS / runtime
Formal Clean R0 = PASS / runtime
Post-TEXT_INPUT stability = PASS
Probe lifecycle COMPLETE = PASS
Canonical Transfer = PASS
AWAITING-TRANSFER-LEAK awaitingCount=0
Enter Admission = PASS
```

当前仍未完成：

```text
A1 fresh canonical ×10
A2 fresh noncanonical ×3
A3 split-no-text ×3
B1 historical/noise ×5
```

因此：

```text
R58.7 FULL CLOSURE = NOT YET
R60 = BLOCKED
```

本轮只实现并验证：

```text
A1 Automation Runner
→ Automation Smoke
→ Trusted IME Provenance Gate
→ A1 fresh canonical ×10
→ 自动生成验收报告
```

---

# 1. 总原则

## 1.1 不修改插件业务源码

本轮禁止修改：

```text
src/heading-numbering/**
Canonical Registry
CaretExpectation
Caret repair
SelectionTruth
NormalEnter
Canonical Transfer
Rehydrate
Historical resolver
Save-As
Merge
```

除非自动化实现本身发现当前 artifact 无法运行，否则：

```text
p4v9n = FREEZE
```

禁止为了让自动化更容易而改变业务逻辑。

---

# 2. 自动化必须是“外部黑盒测试”

推荐实现：

```text
scripts/r58-matrix/
  run-r58-a1-matrix.ps1
  r58-input-injector.ps1
  r58-console-collector.ps1
  r58-trial-evaluator.ps1
  r58-process-verifier.ps1
  README.md
```

允许使用：

```text
PowerShell
Windows API SendInput
AutoHotkey（如果机器已安装且可稳定使用）
Chrome DevTools Protocol / remote debugging
Node.js 仅用于日志收集/解析
```

禁止：

```text
直接调用插件内部函数
直接改 DOM
dispatchEvent(new KeyboardEvent(...))
element.textContent=...
document.execCommand(...)
人工伪造 beforeinput/input/compositionend
```

A1 必须保持真实用户输入链。

---

# 3. Trusted Input 强制要求

A1 自动化输入必须最终在 runtime 中产生真实：

```text
KEYBOARD-EVENT-PROVENANCE:
key=Process
code=Period
isTrusted=true
```

以及：

```text
IME-compositionstart
beforeinput inputType=insertCompositionText
input
compositionend
IME-EVENT-ORDER
```

如果自动输入只产生：

```text
isTrusted=false
```

或者没有 IME composition 链：

```text
TRIAL INVALID — INPUT PROVENANCE MISMATCH
```

不得计为 PASS。

---

# 4. 自动化方案选择顺序

Trae 必须先检查本机能力，不要凭空假定。

优先级：

```text
A. AutoHotkey 已安装且可稳定触发当前中文 IME
B. PowerShell + user32!SendInput
C. 其他真实 OS input 方法
```

禁止选择：

```text
DOM synthetic event
DevTools Runtime.evaluate 注入 KeyboardEvent
直接设置编辑器文本
```

---

# 5. 输入层实现要求

如果采用 PowerShell + SendInput：

必须：

```text
真实聚焦 Typora 主窗口
确认 HWND 与目标 PID 匹配
SetForegroundWindow
等待窗口前台稳定
再发送按键
```

输入序列必须对应用户真实操作：

```text
。。
Enter
Enter
立即输入 。
```

注意：

```text
中文句号必须通过当前用户正在使用的中文 IME 路径产生
```

禁止直接插入 Unicode 字符绕过 IME。

如果使用键盘按键：

```text
需要实际触发 Period / Process 链
```

Smoke 阶段必须证明这一点。

---

# 6. A1 Automation Smoke — 不计入 A1×10

必须先创建一个独立 smoke fixture：

```text
r58-caret-a1-auto-smoke-01.md
```

要求：

```text
fixtureExists=true
sidecarExists=false
recordCount=0
```

Smoke 只运行一次。

操作：

```text
关闭 Typora
→ 验证 count=0
→ 启动 smoke fixture
→ 验证启动
→ 捕获 console
→ 自动输入 。。 + Enter + Enter + 。
→ 等待 >=2.5s
→ 解析日志
```

Smoke 必须证明：

```text
Process/Period
isTrusted=true

beforeinput insertCompositionText
IME-EVENT-ORDER exists

POST-TEXT-INPUT-ARM count=1
TEXT-COMMIT-AUDIT exists

COMMIT+50/+150/+300/+500/+1000/+2200
logicalOffset=1
visibleText="。"
insideEditor=true

POST-TEXT-INPUT-COMPLETE
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CARET-CONTINUITY-RESTORE=0
CARET-REPAIR=0
unexpected PLUGIN-SELECTION-WRITE=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

只有 Smoke PASS 后才允许进入 A1×10。

---

# 7. 正确 runtime 路径

唯一合法：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora
```

禁止：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora
```

所有路径必须通过：

```powershell
$root = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$vault = Join-Path $root "test\vault"
$dotTypora = Join-Path $vault ".typora"
```

派生。

---

# 8. A1 Fixture 范围

正式 A1 使用 10 个独立 fresh fixtures：

```text
r58-caret-a1-fresh-06.md
r58-caret-a1-fresh-07.md
r58-caret-a1-fresh-08.md
r58-caret-a1-fresh-09.md
r58-caret-a1-fresh-10.md
r58-caret-a1-fresh-11.md
r58-caret-a1-fresh-12.md
r58-caret-a1-fresh-13.md
r58-caret-a1-fresh-14.md
r58-caret-a1-fresh-15.md
```

如果文件不存在，允许自动创建最小空 fixture。

但禁止：

```text
删除已有 sidecar
清空已使用文件后伪装 fresh
```

每轮开始前必须：

```text
fixtureExists=true
sidecarExists=false
recordCount=0
```

如果某个 fixture sidecar 已存在：

```text
TRIAL INVALID — FIXTURE NOT FRESH
```

STOP，不得自动清理。

---

# 9. 每轮 Strict Startup 自动验证

每个 trial 必须独立执行：

```text
记录 old PID
→ 关闭 Typora
→ 验证 old PID 不存在
→ 验证 Typora process count=0
→ 启动目标 fixture
→ 获取 new PID
→ StartTime
→ MainWindowHandle
→ MainWindowTitle
```

必须：

```text
oldProcessExited=true
new PID != old PID
MainWindowHandle != 0
MainWindowTitle=<fixture name> - Typora
```

然后验证：

```text
runtime main path =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

Build ID =
inkchapter-r58-7-clean-r0-closure-p4v9n

initializationCount=1

project/runtime SHA match=true
cssMatch=true
```

当前预期 main SHA：

```text
A4AA5689C724E427A5108895E329070406AA7CA47EBDE74559D785B1B9C77CA3
```

当前预期 style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

任何 startup 字段失败：

```text
TRIAL FAIL — STRICT STARTUP
STOP MATRIX
```

---

# 10. Console 自动捕获

优先方案：

```text
Typora 启动时启用 Chromium remote debugging
→ CDP attach
→ Runtime.consoleAPICalled
→ Runtime.exceptionThrown
→ 保存 trial console
```

输出目录：

```text
artifacts/r58-a1/
```

每轮至少保存：

```text
trial-01-console.log
trial-01-runtime.json
trial-01-verdict.json
```

到：

```text
trial-10-console.log
trial-10-runtime.json
trial-10-verdict.json
```

同时生成：

```text
a1-summary.json
a1-summary.md
```

如果 CDP 无法稳定捕获 Typora renderer console：

必须先研究当前 Typora 可用的 remote debugging 启动参数。

禁止因此修改插件业务源码。

---

# 11. Runtime Clean Baseline 自动门禁

每轮在输入前必须在本轮 console 中看到：

```text
SIDECAR-ACTUAL-LOAD:
documentKey=<fixture>
exists=false
recordCount=0
source=physical
```

并确认：

```text
PERSISTED_LOAD count=0
PERSISTED_HISTORICAL count=0
```

如果 baseline 不干净：

```text
TRIAL FAIL — RUNTIME BASELINE NOT CLEAN
STOP MATRIX
```

---

# 12. A1 每轮固定动作

每轮只执行一次：

```text
。。
Enter
Enter
立即输入 。
等待 >= 2.5s
```

然后停止输入。

不要在同一 fixture 重跑。

不要在失败后 reset 文档重试。

---

# 13. 每轮 A1 PASS 条件

## 13.1 Input Provenance

必须：

```text
Process/Period → REJECT_NON_ENTER
isTrusted=true

IME composition chain exists
```

并且：

```text
normalEnterTxnCreatedFromNonEnterCount=0
```

## 13.2 TEXT_INPUT takeover

必须：

```text
POST-TEXT-INPUT-ARM count=1
CARET-EXPECTATION-SUPERSESSION-AUDIT superseded=true
restoreAttempted=false
```

## 13.3 Stability

必须：

```text
COMMIT+50    logicalOffset=1
COMMIT+150   logicalOffset=1
COMMIT+300   logicalOffset=1
COMMIT+500   logicalOffset=1
COMMIT+1000  logicalOffset=1
COMMIT+2200  logicalOffset=1
```

且：

```text
visibleText="。"
insideEditor=true
```

## 13.4 No plugin caret writes

必须：

```text
CARET-CONTINUITY-RESTORE after input=0
CARET-REPAIR after input=0
unexpected PLUGIN-SELECTION-WRITE=0
```

## 13.5 Probe lifecycle

必须：

```text
POST-TEXT-INPUT-COMPLETE exactly once
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0
```

## 13.6 Canonical

必须：

```text
CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

任何一项失败：

```text
TRIAL FAIL
STOP MATRIX
```

---

# 14. Fail-Fast

A1 必须 fail-fast。

例如：

```text
A1-01 PASS
A1-02 PASS
A1-03 FAIL
```

则立即：

```text
STOP
```

保留：

```text
当前 Typora
当前 fixture
当前 sidecar
当前 console
当前 runtime-load
当前 process metadata
```

禁止：

```text
自动删除失败 sidecar
自动重新创建 fixture
自动清空文档
自动重跑直到 PASS
继续 A1-04
```

失败现场必须完整保存。

---

# 15. Trial Verdict JSON

每轮生成类似：

```json
{
  "trial": "A1-01",
  "fixture": "r58-caret-a1-fresh-06.md",
  "strictStartup": true,
  "cleanBaseline": true,
  "trustedInput": true,
  "imeProvenance": true,
  "textInputSupersession": true,
  "commit50": 1,
  "commit150": 1,
  "commit300": 1,
  "commit500": 1,
  "commit1000": 1,
  "commit2200": 1,
  "caretRestore": 0,
  "caretRepair": 0,
  "pluginSelectionWrite": 0,
  "probeComplete": true,
  "canonicalVisualVerify": true,
  "projectionVerify": true,
  "canonicalFinalAudit": true,
  "awaitingCount": 0,
  "normalEnterFinal": true,
  "verdict": "PASS"
}
```

---

# 16. A1 汇总

最终 `a1-summary.md` 必须包含：

```text
Build ID
main SHA
style SHA

Automation Smoke:
PASS / FAIL

A1-01 ...
A1-10 ...

PASS count
FAIL count
INVALID count

A1 RESULT
```

仅当：

```text
Smoke PASS
A1 PASS count=10
FAIL=0
INVALID=0
```

才允许：

```text
A1 FRESH CANONICAL MATRIX = 10/10 PASS
```

否则：

```text
A1 MATRIX NOT PASSED
R60 BLOCKED
```

---

# 17. 不得提前推进 R60

即使：

```text
A1 = 10/10 PASS
```

也只能：

```text
A1 PASS
```

下一步仍需：

```text
A2 fresh noncanonical ×3
A3 split-no-text ×3
B1 historical/noise ×5
```

全部通过后才允许：

```text
R58.7 CARET OWNERSHIP FULL CLOSURE PASS
R60 MAY PROCEED
```

---

# 18. SyntaxError 独立记录

当前启动阶段曾观察：

```text
SyntaxError: Unexpected token ')'
```

本轮自动化 runner 必须：

```text
记录 Runtime.exceptionThrown
```

但不得因为此错误自动修改 paragraph/caret/canonical 业务源码。

报告：

```text
startupSyntaxErrorObserved=true/false
```

如果 InkChapter 后续正常加载和完成 A1，则先作为独立债务记录。

---

# 19. 实现阶段必须先做 DryRun

在真正 Smoke 前，先运行：

```text
runner DryRun
```

只验证：

```text
fixture detection
sidecar detection
Typora process discovery
correct .typora path
runtime-load reading
SHA reading
console collector startup
window focus
```

DryRun 禁止输入任何按键。

DryRun PASS 后再运行 Automation Smoke。

---

# 20. 建议 CLI

目标入口：

```powershell
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode DryRun
```

```powershell
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode Smoke
```

```powershell
.\scripts\r58-matrix\run-r58-a1-matrix.ps1 -Mode A1
```

可选参数：

```text
-StartFreshNumber 6
-TrialCount 10
-OutputDir artifacts\r58-a1
-FailFast true
```

---

# 21. 开发完成后的执行顺序

严格：

```text
实现 runner
↓
脚本级静态/语法检查
↓
DryRun
↓
Smoke
↓
Smoke runtime provenance PASS
↓
A1×10
↓
生成 summary
↓
STOP
```

不要在同一任务自动继续 A2/A3/B1。

---

# 22. 禁止 Git 写操作

禁止：

```text
git add
git commit
git push
```

---

# 23. 最终交付

必须返回：

```text
1. 新增脚本清单
2. runner 架构说明
3. 输入注入方式
4. 为什么该输入可产生 isTrusted=true
5. console 捕获方式
6. DryRun 结果
7. Smoke 结果
8. A1 10 次逐轮结果
9. a1-summary.md 路径
10. 是否允许进入 A2
```

如果 Smoke 尚未 PASS，则禁止运行 A1×10。

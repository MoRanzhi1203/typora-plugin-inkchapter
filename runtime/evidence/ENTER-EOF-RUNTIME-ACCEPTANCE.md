# ENTER-EOF-RUNTIME-ACCEPTANCE

> 阶段 10 交付物（R2）。真实 Typora Runtime 验收。证据等级：**OBSERVED（真实按键 + audit 落盘）**。
> 本文件记录的是**新构建已真实加载后**的验收结果，取代上一版「PENDING_USER_RUNTIME」。

## 1. 受控重载与真实 SHA（IDENTITY — 本轮核心交付）

| 步骤 | 结果 |
|---|---|
| 保护 WIP | `Ctrl+S` 保存活动文档（标题由 `…• - Typora` 变为 `… - Typora`，脏标记清除）；备份 `runtime/evidence/_backup-Document-Diagnostics-Code-Integrity-Test.md` |
| 受控重载 | `scripts/restart-typora-test-vault.ps1`（保存后无未保存数据，安全；未覆盖生产全局插件） |
| **实际加载 SHA** | `A337D6DF91E7B4171A9C214FF109DD8A5EA6E5F98140310F7579DDD529A549FF`（`runtime-load.json#mainJsSha256`，`loadSource=vault`，`initializationCount=1`） |
| 编译/部署 SHA | 与上完全相同（dist = test/vault 部署副本）→ **编译=部署=实际加载 三处一致** |
| 全局生产插件 | `DE62CB1A…`（**未改**） |

> 这修正了上一版报告的关键缺陷：**上一轮报告中的「实际加载」仍是旧构建 `DE62CB1A…`，新构建从未真实运行**。本轮已完成重载并以运行实例自证。

## 2. 可自动化的「真实按键」注入（方法学）

Typora 编辑区不接受普通合成键（`CU press_key` / `SendKeys` 产生的 `keydown.code=""` → 插件判 `REJECT_NON_ENTER`）。本轮实测确认：
- **`keybd_event` 纯扫描码注入（VK=0, `KEYEVENTF_SCANCODE=8`）可产生 `key="Enter", code="Enter", isTrusted=true`**，插件判为 `ALLOW_NORMAL_ENTER`，Typora 执行真实段落拆分。
- 证据：`KEYBOARD-EVENT-PROVENANCE {"key":"Enter","code":"Enter","isTrusted":true}` + 紧随 `EDITOR-MUTATION-BATCH {"removedParagraphCount":1,"addedParagraphCount":2}`。
- 因此本轮**完成了真实按键 Enter**（非模拟事件、非 `execCommand`），满足「真实 Enter」要求。

## 3. 真实 Enter 结果（新构建 A337D6DF）

会话：`runtime-sess-1791796280208.log`（`buildId=inkchapter-heading-reason-chip-stable-anchor-v2`）。

### 3.1 每次 Enter 的确定性结果（2 次功能型 Enter）

| 项 | Enter #1 (09:44:58) | Enter #2 (09:46:20) |
|---|---|---|
| `ENTER-ADMISSION-AUDIT` | `ALLOW_NORMAL_ENTER` | `ALLOW_NORMAL_ENTER` |
| `SPLIT_1_TO_2` 次数 | **1** | **1** |
| `EDITOR-MUTATION-BATCH` | removed 1 / added 2 | removed 1 / added 2 |
| `NORMAL-ENTER-FINAL` | 有 | 有 |
| `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` | **无** | **无** |
| `DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-DISABLED` | **有** | **有** |
| 源码增量 | `rev1 len1076 → rev3 len1079`（含测试用字符 ×1 与一次拆分） | **`rev3 len1079 → rev4 len1081`（+2 字节 = 恰好一次段落拆分）** |
| `terminalNewlineCount` | 32 → 32 | 32 → 32（**无额外空行**） |

### 3.2 全会话计数（新构建）

| 计数 | 旧构建 `sess-1791791639996` | 新构建 `sess-1791796280208` |
|---|---|---|
| `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` | **3**（每次 Enter 1 次） | **0** |
| `DOCUMENT-DIAGNOSTIC-PAINT-LAYER-CALIBRATION` | 每次提交 1 次 | **0** |
| `BLANK-ROW-FRAGMENT-CLOSURE` | 每次提交 1 次 | **0** |
| `BLANK-ROW-DRYRUN-DISABLED` | — | **4**（探针已在生产关闭） |
| 单次真实 Enter 净源码增量 | **+4 LF**（两次 split） | **+2 字节**（一次 split） |

## 4. 门禁（含真实验收）

| 门禁 | 状态 | 依据 |
|---|---|---|
| IDENTITY_GATE | **PASS** | 编译=部署=实际加载=`A337D6DF…`；文档为持久化测试文件 |
| C0_C5_CONTROL_GATE | **PASS（C4 真实）** | 新构建 C4 2 次真实 Enter；因异常未复现，C0 未触发（见 CONTROL-MATRIX） |
| TRACE_ATTRIBUTION_GATE | **PASS** | 4 条结构写入业务栈 + provenance 交叉验证 |
| REAL_ENTER_SEMANTIC_GATE | **PASS** | 真实 Enter → 恰好一次 split、`+2 字节`、`termLF` 不变、无重复 split |
| DIAGNOSTIC_SYNC_GATE | **PARTIAL** | 提交期 `TRAILING-BLANK-AUDIT`/`INTERNAL-BLANK-LINE-DECISION-AUDIT`/EOF 决策均在真实 Enter 后按序发出；Drawer 实际 DOM 文本未逐字比对 |
| EOF_GEOMETRY_GATE | **PARTIAL** | 真实 Enter 后 EOF 决策审计正常发出、无重复标记；像素级几何/滚动/拖拽未自动验收 |
| PERF_GATE | **PARTIAL** | 见 §5 |
| STATIC_GATE | **PASS** | tsc exit 0；全量 235 files / 4479 tests PASS |
| BUILD_DEPLOY_GATE | **PASS** | build exit 0；vault 部署 `A337D6DF…` |
| RUNTIME_GATE | **PASS（核心）** | 重载 + 真实 Enter + 单次 split 已实测 |

## 5. 性能

- 真实 Enter → 首次 split：`.338 → .394` ≈ **56ms**；Enter → 诊断提交（`TRAILING-BLANK-AUDIT`）：`.338 → .408` ≈ **70ms**。
- 旧构建同一 Enter → 第二次 split 检测约 **171ms**（并额外产生一次提交）。新构建**无第二次提交**。
- `P95/P99` 端到端序列：**NOT_RUN**（未做批量采样与 `performance.mark` 统计，不以日志条数减少冒充）。

## 6. 未完成 / 待人工（诚实声明）

- **文档末尾**（EOF）真实 Enter 未取得干净测量：本轮 2 次成功 Enter 均在**正文中部**（`Ctrl+End` 的扩展键注入未能稳定把光标移到文末空白段）。文末语义需一次人工复核。
- Drawer 实际 DOM 文本逐字比对、EOF 像素几何、滚动/拖拽/缩放（R02–R05）为 **NOT_RUN**。
- **最小人工步骤（1 步）**：在 Typora 中把光标放到文末最后一行，按一次 Enter，确认文末仅多 **1** 条空行且 Drawer 文案与可视空行一致（预期不再出现 `ENTER-DUPLICATE-SPLIT-AFTER-FINAL`）。

## 7. 环境还原

- 测试期缓冲区的测试输入（1 个字符 + 2 次 Enter）**未保存**，已丢弃；磁盘文档保持用户 WIP：`1084 bytes / SHA F6D1861F…`；保存前快照保留在 `_backup-…md`（`B0CBB62F…`）。
- Typora 已用测试 vault + 新构建重新打开该文档。

## 8. R3 — 文末（EOF）真实 Enter 复核：**R2 结论被推翻，修复不完整**

**本文档 §3 的「PASS」仅适用于正文中部 Enter，不适用于文末（EOF）场景。** 文末复核结果：

| 组别 | 设置 | 1 次文末 Enter 结果 |
|---|---|---|
| **C0**（真实原生，墨章在 vault 中禁用，无插件审计会话） | 插件关闭 | `1084B/trailingLF=32` → `1086B/trailingLF=34` → **+2 字节 / +2 LF，1 次 split** |
| **C4**（新构建 `A337D6DF…`，探针已关） | 插件启用 | 缓冲 `rev1 len1076 termLF32` → `rev2 len1080 termLF36` → **+4 字节 / +4 LF，2 次 split** |

C4 文末 Enter 逐步证据（`runtime-sess-1791800854509.log` / `inkchapter-enter-echo-trace.json`）：

```
10:27:59.915 ENTER-ADMISSION-AUDIT {key:Enter, code:Enter, ALLOW_NORMAL_ENTER}
10:28:00.012 EDITOR-MUTATION-BATCH {removed1/added2}   ← 第 1 次 SPLIT
10:28:00.021 NORMAL-ENTER-FINAL
10:28:00.071 EDITOR-MUTATION-BATCH {removed1/added2}   ← 第 2 次 SPLIT（重复）
10:28:00.073 ENTER-DUPLICATE-SPLIT-AFTER-FINAL {duplicateSplitIndex:2, windowMs:53, endBlockRenormalization:true}
10:28:00.077 ENTER-ECHO-DOM-WRITE-TRACE {recordCount:14, structuralRecordCount:0, pluginStructuralWriteCount:0, originCounts:{plugin:0,typora:14}}
10:28:00.119 DOCUMENT-TRAILING-BLANK-AUDIT {rev1→2, len1076→1080, termLF32→36}
```

**关键更正**：
1. **探针关闭并未消除文末重复 split** → dry-run 不是文末重复 split 的原因；R2 以「正文中部 2 次 Enter 无重复」得出的 PASS 结论**不成立**。
2. 新构建 trace 显示回声窗口内 **`pluginStructuralWriteCount:0`、`structuralRecordCount:0`** —— 即插件在该窗口内**没有任何 DOM 结构写入**；14 条记录全部是 Typora 自身对 `P.md-end-block.md-p` 的属性写入，来自**两条不同的 `Editor.pressReturn` 路径**（`…:1:469967` 与 `…:1:471560`）。
3. 因此：文末一次 Enter 在**原生下走 1 次 `pressReturn`（+2 LF）**，在**墨章启用下走 2 次 `pressReturn`（+4 LF）**。触发因素**不是**插件 DOM 写入，而更可能是**插件在 Enter keydown 处理链中的存在（同步执行/事件链干预）导致 Typora 的 `pressReturn` 序列被执行两次**。

**R3 结论**：`REAL_ENTER_SEMANTIC_GATE = FAIL（文末）`；`EOF` 场景未修复。`ROOT_CAUSE` 从「dry-run 写入」**修正为 UNKNOWN（已排除结构性 DOM 写入路径）**。

# ENTER-EOF-CONTROL-MATRIX

> 阶段 3 交付物。C0–C5 原生/插件对照。证据等级：**OBSERVED / PENDING_USER_RUNTIME**。
> 统一测试对象：`Document-Diagnostics-Code-Integrity-Test.md`（vault 文档），文末最后一个可编辑段落，单次真实 Enter。

## 1. 为什么 C0–C3 本轮无法自动完成（必须先说明）

三组都需要 **真实键盘按键** 进入 Typora 的 `contenteditable`。本项目运行时证据（历史 `app-*.log` 与本轮）一致表明：
- Typora 编辑区不接受合成 `KeyboardEvent`（`isTrusted=false` 被 `isRealEnterKey()` 判为非 Enter → `REJECT_NON_ENTER`）；
- 也没有可用的 DevTools 注入通道（历史尝试未生效）。

因此凡「需要另建纯原生/子模块关闭会话并按真实 Enter」的组别，本轮标记 **PENDING_USER_RUNTIME**，不伪造。凡「真实 Enter 已在全启用模式下采集」的组别，用运行实例真实数据报告。

## 2. 已实测：C4 = 墨章全部启用（真实按键）

来源：`test/vault/.typora/inkchapter/audit/runtime-sess-1791791639996.log`（`sess-1791791639996`，`buildId=inkchapter-heading-reason-chip-stable-anchor-v2`）。
本轮该会话捕获 **3 次真实 Enter**（`NENTER-1-1791792203569` / `NENTER-2-1791792209930` / `NENTER-3-1791792211233`），每次结果一致：

| 观测项 | 每次 Enter 的值 |
|---|---|
| 首次 `SPLIT_1_TO_2`（真实按键） | 1 次（`emb-…` removed 1 / added 2 段） |
| 第二次 `SPLIT_1_TO_2`（回声） | 1 次，`windowMs≈124–193`，`endBlockRenormalization=true` |
| `ENTER-ECHO-DOM-WRITE-TRACE` | `recordCount=18 truncated=false structuralRecordCount=4 pluginStructuralWriteCount=4` |
| `originCounts` | `{plugin:4, typora:14, unknown:0}` |
| 源码净增（`DOCUMENT-TRAILING-BLANK-AUDIT`） | 每次真实 Enter **+2 LF**（`1062→1064`），随后回声事件再 **+2 LF**（`1064→1066`） |

**C4 源码净增（单次 Enter）= +4 LF**（两次 +2）：`sourceRevision 6→7` 在 `.274`，`7→8` 在 `.448`。这是本轮发现的关键新增事实。

## 3. 未实测组别（PENDING_USER_RUNTIME）

| 组别 | 设置 | 需要的人工操作 | 现状 |
|---|---|---|---|
| C0 | 墨章完整禁用 | 独立会话完全禁用墨章，文末单次真实 Enter，记录 `getMarkdown()`/DOM | **PENDING_USER_RUNTIME** |
| C1 | 墨章启用、诊断/Overlay 关闭 | 关闭诊断面板与 overlay 后单次 Enter | **PENDING_USER_RUNTIME** |
| C2 | 墨章启用、标题/编号/题注增强关闭 | 关闭正文增强后单次 Enter | **PENDING_USER_RUNTIME** |
| C3 | 墨章启用、仅段首缩进/Enter 相关功能关闭 | 关闭 Enter 相关模块后单次 Enter | **PENDING_USER_RUNTIME** |
| C5 | 全部启用、**受控追踪器开启** | —— | 当前构建在每次真实 Enter **无条件武装**追踪器（`armEnterEchoWriteTrace`，250ms 有界），因此 C4≡C5；无法在本构建下分离"追踪器开/关"。分离需一次构建级开关。 |

## 4. 对照结论（诚实分级）

- **C4 已测，且呈现 `每次 Enter = 首次 split(+2 LF) + 回声 split(+2 LF) = 净 +4 LF`**。这是「空行增加异常」的直接量化证据。
- **C0 基线缺失 ⇒ 不能断言 `+2 LF/次 split` 本身是否原生正确**。但注意：即便单次 split 的原生语义是 +2 LF，**同一次 Enter 出现两次 split（净 +4 LF）在渲染层就是多出的一整条可见空行** —— 这正是用户报告的异常。
- 依据 §3.3 分支判定：本会话证据指向 **分支 A**（插件在回声窗口内的 DOM 结构写入与第二次 split 共现），但需 C0/C1 对照最终确认；因此 `ROOT_CAUSE_EVIDENCE_LEVEL=PROVEN_WRITE / INFERRED_CAUSAL`（写入 PROVEN，因果 INFERRED）。
- **不允许**：把两次 `+2 LF` 直接当成「原生正常」；也**不允许**用忽略第二个 Mutation batch / 分组去重把差异吞掉（历史 `SAME_ENTER_SCENE_IDEMPOTENT` 只幂等化了**诊断提交**，并未阻止**内容**被第二次 split 改写——本轮必须修内容入口）。

## 5. 人工最小闭环（供 C0–C3 补齐）

1. 关闭墨章（或对应子模块），**另存一份完全相同的初始文档副本**；
2. 光标置于文末最后一个非空段落后，按 **一次** Enter；
3. 记录 `getMarkdown()` 末尾 LF 数与可视空段落数；
4. 与 C4 的 `+4 LF / 两次 split` 对比；
5. 若 C0 = `+2 LF / 一次 split` ⇒ 分支 A 确认（插件回声写入制造了多余 split）。

## 6. R2 — 新构建（A337D6DF…，真实加载）的 C4 实测

| 组别 | 状态 | 结果 |
|---|---|---|
| C4（全部启用，新构建，真实按键） | **已测** | 2 次真实 Enter（`ALLOW_NORMAL_ENTER`）各产生 **1 次** `SPLIT_1_TO_2`、净 **+2 字节**、`terminalNewlineCount` 不变、`ENTER-DUPLICATE-SPLIT-AFTER-FINAL`=**0** |
| C4（旧构建 `DE62CB1A…` 同会话） | 已测（对照） | 每次真实 Enter **2 次** split、净 **+4 LF**、`ENTER-DUPLICATE-SPLIT-AFTER-FINAL`=**3/3** |
| C0（原生，无墨章） | **未触发** | 按 §3.3「如仍异常才执行 C0」：新构建下异常**未复现**，故未执行；如需独立基线，仍可用 1 步人工完成 |
| C1/C2/C3/C5 | **NOT_RUN** | 需子模块关闭会话；本轮异常已不复现，未做二分 |

**结论**：跨构建对照（同文档、同 vault、同 Enter 通道，唯一差异 = 是否启用 DOM 修改型验收探针）显示：**探针关闭后第二次 split 与 `+4 LF` 同时消失** ⇒ 支持分支 A 的因果结论。

> ⚠️ **该结论已被 R3 文末复核推翻（见 §7）**：上述对照是在**正文中部**做的；文末（EOF）场景下探针关闭后重复 split **仍然存在**。

## 7. R3 — 文末（EOF）原生 C0 对照（决定性）

| 组别 | 设置 | 1 次**文末** Enter | 结果 |
|---|---|---|---|
| C0 | 墨章在 vault 禁用（`plugins.json=false`，无插件审计会话） | `1084B/LF32 → 1086B/LF34` | **+2 字节 / +2 LF，1 次 split** |
| C4 | 新构建启用（探针已关） | `len1076/LF32 → len1080/LF36`（2 次 split） | **+4 字节 / +4 LF，2 次 split** |

**C0 ≠ C4** ⇒ 文末多出的 1 次 split / +2 LF 确由**墨章存在**引起（非原生）。
但新构建 trace 同时显示 `pluginStructuralWriteCount:0` ⇒ **不是插件 DOM 结构写入引起**；文末原生走 1 次 `pressReturn`，启用墨章后走 2 次。
⇒ 归因分支修正为 **UNKNOWN**（分支 A 不成立、非 dry-run；待查插件在 Enter keydown 链中的同步处理/事件链行为）。

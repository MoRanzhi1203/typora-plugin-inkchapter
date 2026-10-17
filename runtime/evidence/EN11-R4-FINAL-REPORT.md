# EN11-R4-FINAL-REPORT

> 轮次：`sess-p0-en11-r4`（2026-10-12）｜新构建 `2BAC40036D3676193884FA6A96D0C2C95D012FC5DD85CA8D75F14702B3BB5758`（已部署并由真实 Typora 加载，PID 17680，source=vault，init=1）

## 1. 本轮实际完成

1. **WIP/身份门禁**：`git` 只读登记，未 commit/reset/clean；BUILD==DEPLOY==LOADED==`2BAC4003…`（独立取值）。
2. **来源审计（先读源码）** 确认并修复了 3 个**真实**协调器缺陷：
   - **B1**：R3 在 hold 预算耗尽时**强制写入 `#write`** → 改为 **BLOCK**（`PAINT_BLOCKED_UNSTABLE`），保留 dirty intent，事件驱动 `resumeOnStable` 恢复（红→绿 T10/T12）；
   - **B2**：`editorRootId` 恒为 `null` + `sourceRevision/layoutEpoch` 只记录不校验 → 改为 **WeakMap 单调 root 身份** + 提交前 live revision 校验（前进记 `REDERIVED_FROM_LIVE`，缺失记 `REVISION_UNKNOWN_AT_PAINT`，禁硬编码匹配）（红→绿 T13/T14）；
   - **B3**：无显式状态流/无不可见处置 → 新增 `IDLE→PARKED/BLOCKED→COMMITTED/DROP_STALE` 与 `PARKED_INACTIVE`（不可见不烧帧）（红→绿 T15）。
3. **B4 全量枚举**：列出 11 类 `#write`/chrome 写入入口，标注根、Enter 窗口可触达性、是否协调器托管（见 `EN11-R4-COORDINATOR-SAFETY.md` §4）；**未**声称“零写入”。
4. **验收脚本加固（§4）**：新增 ADMISSION 门（非当前有效身份 → 全部当前 Runtime 子门禁 `NOT_ADMITTED`）；`EN11_ECHO_WINDOW_GATE` 在**本次运行无真实 Enter** 时恒 `NOT_RUN`；`AUDIT_COVERAGE` 要求 `eligible>0` 且 `dropped=0`；新增 `OVERALL_DECISION=` 与退出码对齐（FAIL→exit 2）。UTF-8 BOM 已确认。
5. **因果证据（新）**：用 R3 构建的一次**真实 Enter** 证明，在协调器**明确 PARKED** 的同时，窗口内 `pluginStructuralWriteCount=0`、`originCounts={plugin:0,typora:14}`，而第二次 split **仍然发生** → `PRESENTATION_WRITE_CAUSALITY=REFUTED`（结构性写入机制被否证；`pluginOwnedAddedCount` 是**节点归属**而非写入者）。

## 2. 未完成（不得判 PASS）

- **C0 / C4 / B / D 四组同条件真实对照**：C0 需禁用插件并重启 Typora（当前实例含 WIP，探索约束禁止），B/D 需受信任按键 → **NOT_RUN**。
- **E / K / V 真实回归**：需真实键鼠与像素目检 → **NOT_RUN / PENDING**。
- **新的领先假设未证实**：`#write` 内**长期存在的 overlay 节点**是否改变 Typora 尾块再归一化（见 §3 唯一实验）。

## 3. 唯一必需人工动作（最少）

1. 在**已加载 `2BAC4003…`** 的 Typora（PID 17680）中，复制 `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md` 为独立副本，光标置于文末最后一个可见空段落末尾，按**一次 Enter**；记录 Enter 前后 SHA/bytes/LF。
2. 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-p0-caret-eof-postrestart.ps1`，读 `ADMISSION / EN11_ECHO_WINDOW_GATE / ENTER_DUPLICATE_SPLIT_OBSERVED / ECHO_WINDOW_PAINT_HELD / OVERALL_DECISION`。
3. **若仍复现第二次 split**：执行 §4 的**单因子**实验（把诊断 overlay 容器临时挂到 `#write` 外层），复测一次 Enter —— 这是判定「overlay 存在性」假设的唯一必要动作。

## 4. 风险与反伪声明

- 未使用任何被禁手段：未 `preventDefault(Enter)`、未缩减 LF、未删除空行、未忽略 Mutation、未无界定时器、未强拉光标、未跳过 tsc、未部署旧版本。
- 未把 `pluginOwnedAddedCount>0` 当作“插件导致原生二次拆分”；未把 `HYPOTHESIS` 写成 `PROVEN`。
- 未盲目扩增全域延时保护（仅修 B1 安全门；未对 §B4 表中点击驱动入口扩围）。
- 未 `git commit`；未覆盖全局生产插件（仍 `DE62CB1A…`）；原生侧栏未替换（`ribbonInjected=false`）。

## 5. 严格结论

```text
PROMPT_VERSION=EN11-R4
WIP_GATE=PASS
TYPECHECK=PASS
TARGETED_TESTS=PASS (tested=20)
FULL_TESTS=PASS (files=238 tests=4511)
BUILD=PASS
DEPLOY_SHA=PASS
RUNTIME_IDENTITY=PASS
C0_C4_COMPARISON=NOT_RUN
INDENT_B_D_COMPARISON=NOT_RUN
COORDINATOR_HOLD_BUDGET_GATE=PASS
COORDINATOR_STALE_INTENT_GATE=PASS
ENTER_EOF_SEMANTIC=PENDING_USER_MANUAL
CARET_ISOLATION_RUNTIME=PENDING_USER_MANUAL
DIAGNOSTIC_EOF_VISUAL=PENDING_USER_MANUAL
PRESENTATION_WRITE_CAUSALITY=REFUTED
FINAL_DECISION=PENDING_USER_MANUAL
NOT_RUN=[C0,C4,B,D,E01-E10,K01-K09,V01-V12,T15-T18,P12,真实导出Markdown比对]
MODIFIED_FILES=[src/document-utilities/presentation-paint-coordinator.ts, src/document-utilities/presentation-paint-coordinator.test.ts, src/document-utilities/document-utility-overlay-host.ts, src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts, scripts/verify-p0-caret-eof-postrestart.ps1]
EVIDENCE_FILES=[runtime/evidence/EN11-R4-WIP-IDENTITY.md, runtime/evidence/EN11-R4-COORDINATOR-SAFETY.md, runtime/evidence/EN11-R4-CAUSAL-EXPERIMENTS.md, runtime/evidence/EN11-R4-REGRESSION-MATRIX.md, runtime/evidence/EN11-R4-FINAL-REPORT.md]
```

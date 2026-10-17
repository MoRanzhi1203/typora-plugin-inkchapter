# EN11-R3-FINAL-ACCEPTANCE

> 轮次：`sess-p0-en11-causal-closure-r3`（2026-10-12）
> 新构建：`741663E93C20E992422CAF28B911976DD25DF203890CDE184DF2CF35644CEB56`（已部署并由真实 Typora 加载）
> 旧候选：`9146A7B0…`（七处独立延迟回调）→ 本轮改为单一 `PresentationPaintCoordinator`

## 1. Phase A 结论：当前候选的真实效果

- `RUNTIME_IDENTITY=PASS`，`LOADED_MARKERS=True`（新门禁符号在运行产物中）。
- 本轮加载后**尚无真实 Enter 事件**（`EN11_GROUP=UNKNOWN_NO_ENTER`、`ENTER_DUPLICATE_SPLIT_OBSERVED=0`、`ECHO_WINDOW_PAINT_HELD=0`）。
- 因此 **`9146A7B0…` 的修复效果本身未被真实验收**；本轮据此**不能**宣布 EN-11 已修复。
- 因存在用户 WIP 且提示词 §1.4 禁止重启/关闭运行中的 Typora，**C0（禁用墨章）无法在本轮自动取得**。

## 2. 回归矩阵（E / K / V / P）

### E — 原生编辑
| case | 状态 | 说明 |
|---|---|---|
| E01 文末 0/1/2/5/10 空行 × 1 Enter | NOT_RUN | 需受信任按键 |
| E02 连续 Enter 3/10 次 | NOT_RUN | 同上 |
| E03 Backspace | NOT_RUN | 同上 |
| E04 Undo/Redo | NOT_RUN | 同上 |
| E05 保存重开 / CRLF·LF | NOT_RUN | 同上 |
| E06 C0/C4 对照 | NOT_RUN | C0 需重启切插件 |
| E07 缩进开关 B/C 对照 | NOT_RUN | 同上 |
| E08 `。。+Enter` / `..+Enter` | NOT_RUN | 需受信任按键；代码路径未改动 |
| E09 IME 组合输入 | NOT_RUN | 同上 |
| E10 H1 后 / 代码块后 / 公式后 / EOF Enter | NOT_RUN | 同上 |

### K — 光标与编辑隔离
| case | 状态 | 说明 |
|---|---|---|
| K01–K08（方向键/Home/End/Ctrl+A/拖选/chip/EOF/CODE/题注） | NOT_RUN / PENDING_USER_MANUAL | 需真实键鼠；历史对照见 `P0-CARET-EOF-REGRESSION-MATRIX.md`（不得当本轮 PASS） |

### V — 诊断、绘制与布局
| case | 状态 | 说明 |
|---|---|---|
| V01–V12 | NOT_RUN / PENDING_USER_VISUAL | 需真实交互与像素目检；本轮未宣称通过 |

### P — 工程与证据
| case | 状态 | 证据 |
|---|---|---|
| P01 审计计数守恒（eligible=enqueued+rejected；enqueued=flushed+dropped+cancelled；dropped=0） | **PASS（静态/单元）** | coordinator 计数 + caret 审计覆盖门禁单测；真实运行采样 NOT_RUN |
| P02 TypeScript 失败阻断测试与构建 | **PASS** | `package.json` build:dev/build 前置 `typecheck`；`build-pipeline-fail-fast.test.ts` 守卫 |
| P03 全量测试 | **PASS** | 238 files / 4507 tests |
| P04 `pnpm run build:dev` | **PASS** | 含 `ARCHIVE VERIFY=PASS` |
| P05 构建/部署/加载独立 SHA | **PASS** | `741663E9…` 三方一致（独立取值） |
| P06 PID/HWND/title/vault/initCount | **PASS** | PID 44588 / HWND 13703080 / vault / init=1 |
| P07 当前会话日志 | **PASS** | 新 session 已创建；本轮无 Enter 样本 |
| P08 全局生产插件不被覆盖 | **PASS** | 仍 `DE62CB1A…` |
| P09 文档 SHA/bytes/换行 | **PASS** | 见 `EN11-R3-IDENTITY-AND-WIP.md` §3 |
| P10 `PROGRESS-ARCHIVE` append-only verify | **PASS** | verify 通过，新增 ENTRY 11 |

## 3. 严格结论

```
TYPECHECK=PASS
TARGETED_TESTS=PASS (16/16)
FULL_TESTS=PASS (238 files / 4507 tests)
BUILD=PASS
DEPLOY_SHA=PASS (project==vault==741663E9…)
RUNTIME_IDENTITY=PASS (loaded 741663E9…, source=vault, init=1, PID 44588)
C0_C4_BASELINE=NOT_RUN
EN11_REAL_ENTER_SEMANTIC=PENDING
CARET_REAL_RUNTIME=PENDING
DIAGNOSTIC_EOF_REAL_RUNTIME=PENDING
PRESENTATION_WRITE_CAUSALITY=UNKNOWN
FINAL_DECISION=PENDING_USER_MANUAL
```

> 按提示词 §7：「只有新构建真实加载、同条件 C0/C4 差分无额外编辑、回归没有严重退化时，EN11 才能判 PASS」——当前 C0/C4 与真实 Enter 均未执行，故 `EN11`**不判 PASS**。

## 4. 唯一必需人工动作（最少、具体）

在**已加载 `741663E9…`** 的 Typora 中（当前实例 PID 44588；若已关闭请重新打开 `test/vault`）：

1. 复制一份字节副本：`test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md` → 独立副本。
2. **C4**：将光标置于文末最后一个可见空段落末尾，按**一次 Enter**；记录 Enter 前后文件 SHA/bytes/LF。
3. **B**：在设置中**关闭「首行缩进快捷输入」**，重复步骤 2。
4. **D**：在仅含 `。。` 的段落末尾按一次 Enter（另用副本），确认 token 被消费且**段落数不变**。
5. **C0**：在 vault 设置中**禁用墨章**并重启 Typora 一次，重复步骤 2（此步必须由你操作重启）。
6. 运行：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-p0-caret-eof-postrestart.ps1`
   读 `EN11_GROUP / ENTER_DUPLICATE_SPLIT_OBSERVED / ECHO_WINDOW_PAINT_HELD / EN11_ECHO_WINDOW_GATE`。

**因果隔离最小 A/B（升级 `PRESENTATION_WRITE_CAUSALITY` 为 PROVEN 所需）**：对同一次 Enter，仅令 `runContentDocumentPaint` 在窗口内永不绘制（临时开关），复测一次；必须**同时**出现「窗口内插件写入消失」与「额外 split 消失」。

## 5. 诚实声明

- 本轮完成了：真实身份核验、四组代码路径判定、缩进快捷键否证、七处独立延迟回调→单一 `PresentationPaintCoordinator` 的收敛、状态机行为测试、全部门禁（tsc/定向/全量/构建/部署/加载）。
- 本轮**未完成**：真实 C0/C4/B/D Enter 语义差分、E/K/V 真实回归、`PRESENTATION_WRITE_CAUSALITY` 因果闭环。以上不得判 PASS。
- 未执行 `git commit`；全部 WIP 与用户文档保持原样。

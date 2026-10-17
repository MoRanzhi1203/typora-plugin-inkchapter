# EN11-R4-CAUSAL-EXPERIMENTS

> 轮次：`sess-p0-en11-r4`（2026-10-12）｜分级：PROVEN / REFUTED / HYPOTHESIS / NOT_RUN

## 1. 决定性新证据（PROVEN，来自 R3 构建 `741663E9…` 的一次**真实 Enter**）

会话 `runtime-sess-1791808827067`，事件时间线（真实时钟）：

| 时刻 | 事件 | 关键事实 |
|---|---|---|
| 12:46:56.750 | `ENTER-ADMISSION-AUDIT` | `key=Enter, isTrusted=true, ALLOW_NORMAL_ENTER` |
| 12:46:56.751 | `ENTER-PLUGIN-INTERVENTION-AUDIT` | **`createdTransaction=false`、`defaultPrevented=false`、`cancelBubble=false`、`dispatchSyntheticEnter=false`** |
| 12:46:56.798 | 结构批次1 | `mutationShape=SPLIT_1_TO_2`、`childListCount=2`、`pluginOwnedAddedCount=3` |
| 12:46:56.845 | **`ECHO-WINDOW-PAINT-HELD {event:PARKED, domain:HEADING_MARKERS, reason:WRITE_HOLD_ACTIVE}`** | 协调器**已停放**该绘制 → 窗口内**未写 `#write`** |
| 12:46:56.846 | **`{event:PARKED, domain:ACTIVE_HEADING_EMPHASIS}`** | 同上 |
| 12:46:56.923 | 结构批次2 | `mutationShape=SPLIT_1_TO_2`、`childListCount=4`、`pluginOwnedAddedCount=4`、`pluginOwnedRemovedCount=1` |
| 12:46:56.929 | `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` | `duplicateSplitIndex=2, windowMs=127, endBlockRenormalization=true` |

**回声窗口 trace（同一 Enter，`test/vault/.typora/inkchapter-enter-echo-trace.json`）**：
`windowMs=127`、`recordCount=14`、**`structuralRecordCount=0`**、**`pluginStructuralWriteCount=0`**、
`originCounts={"plugin":0,"typora":14,"unknown":0}`；14 条全部为 **`attr:setAttribute`/`attr:removeAttribute`，目标 `P.md-end-block`（父 `DIV#write`）** —— 即 **Typora 自身**的属性写入。

## 1b. 在其内确认（PROVEN，**本轮 R4 构建 `2BAC4003…`，两次真实 Enter**）

会话 `runtime-sess-1791810143998`（`ADMISSION=CURRENT_RUNTIME_ADMITTED`，doc `Document-Diagnostics-Trailing-Blank-3.md`）：

| Enter | 时刻 | 协调器停放 | 第二次 split |
|---|---|---|---|
| #1 | 13:02:39.695 | 13:02:39.776 `PARKED HEADING_MARKERS` + `PARKED ACTIVE_HEADING_EMPHASIS`（`WRITE_HOLD_ACTIVE`） | 13:02:39.855 `duplicateSplitIndex=2, windowMs=102` |
| #2 | 13:04:59.941 | 13:04:59.993 `PARKED` ×2（`WRITE_HOLD_ACTIVE`） | 13:05:00.060 `duplicateSplitIndex=2, windowMs=83` |

两次均：`createdTransaction=false / defaultPrevented=false`（插件未干预事件链）→ 协调器**把全部受管绘制停放在窗口内（未写 `#write`）** → **第二次 `SPLIT_1_TO_2` 仍然发生**。

结合 §1 的 trace（`pluginStructuralWriteCount=0`、`originCounts={plugin:0,typora:14}`），
**在两个不同构建上独立确认**：受管的展示绘制写入**不是**第二次拆分的原因。

## 1c. 本轮脚本判定（真实输出）

`OVERALL_DECISION=FAIL`（退出码 2，符合 R4 §4「返回码与判定对齐」）：
`EN11_ECHO_WINDOW_GATE=FAIL`、`ENTER_DUPLICATE_SPLIT_OBSERVED=2`、`ECHO_WINDOW_PAINT_HELD=8`、`EN11_GROUP=C_PLAIN_ENTER`、
`AUDIT_COVERAGE=NOT_RUN`、`CARET_ISOLATION_RUNTIME=NOT_RUN`（本会话无导航样本）、`RUNTIME_IDENTITY=PASS`。

> 注：目标文档标题为 `Document-Diagnostics-Trailing-Blank-3.md•`（**含未保存更改**）。本轮**未修改**该文档。

## 2. 结论一：展示写入（结构性）机制 **REFUTED**

- 窗口内**插件结构性写入 = 0**（`pluginStructuralWriteCount=0`，`originCounts.plugin=0`），且两个协调域**明确 PARKED**（未写 `#write`）；
- 然而**第二次 `SPLIT_1_TO_2` 仍然发生**。
- 因此批次2 的 `pluginOwnedAddedCount=4` **不能**归因为“插件写入诱发第二次拆分”——它统计的是**节点归属**（插件拥有的 overlay 节点被 Typora 自身的重归一化重新加入），与提示词 §0.3 的警告完全一致。

```
PRESENTATION_WRITE_CAUSALITY=REFUTED（针对“窗口内插件结构性写入”这一机制）
```

## 3. 结论二：新的领先假设（HYPOTHESIS，未证实）

既然窗口内插件**不写入**，而历史 C0（+2 LF/1 split）与 C4（+4 LF/2 split）仍有差异，则最可能的差异源是
**`#write` 子树内长期存在的插件 overlay 节点（*存在*而非*写入*）改变了 Typora 的尾块再归一化行为**。

- 支持：批次2 的 `pluginOwnedAddedCount=4` 说明 Typora 重归一化时**重新加入了插件拥有的节点**；`endBlockRenormalization=true`。
- 未证实：**没有新构建下的 C0/C4 同条件差分**（C0 需禁用插件并重启，本轮受 WIP 保护约束未执行）。

## 4. 最小可逆实验（下一步，唯一可变因子）

按提议优先级（提示词 §B5.3/§B5.4）：

1. **首选（迁出编辑 DOM）**：临时把诊断 overlay 容器挂到 `#write` 之外的独立覆盖层（沿用既有 document-local 坐标权威，不新建第二套映射），复测**一次真实 Enter**；
2. 判定：若「第二次 split 消失」→ 升级为 `PROVEN`（“overlay 存在于 `#write` 内”是诱因），并据此正式迁出；
3. 若未消失 → 恢复，再依序对 §B4 表中其它入口做**单因子**抑制实验（每次只动一个）。

## 5. C0 / C4 / B / D 组状态

| 组 | 状态 | 原因 |
|---|---|---|
| C0（禁用墨章） | **NOT_RUN** | 需禁用插件并**重启 Typora**；当前实例含用户 WIP，提示词 §1.5 禁止重启/关闭 |
| C4（启用，普通 Enter） | **PENDING_USER_MANUAL** | 需受信任按键；R3 构建已取得 1 次真实 Enter（§1），★但那是 R3 构建，非本轮 `2BAC4003…` |
| B（关闭缩进快捷） | **NOT_RUN** | 需人工切换设置 + 受信任按键 |
| D（`。。+Enter`） | **NOT_RUN** | 全历史 `ALLOW_SPECIAL_COMMAND=0`，从未执行；不得声称缩进功能无风险 |

## 6. 结论

```
C0_C4_COMPARISON=NOT_RUN
INDENT_B_D_COMPARISON=NOT_RUN
ENTER_EOF_SEMANTIC=PENDING_USER_MANUAL
PRESENTATION_WRITE_CAUSALITY=REFUTED
```

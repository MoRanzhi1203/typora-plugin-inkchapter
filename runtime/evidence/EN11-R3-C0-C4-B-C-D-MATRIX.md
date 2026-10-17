# EN11-R3-C0-C4-B-C-D-MATRIX

> 轮次：`sess-p0-en11-causal-closure-r3`（2026-10-12）
> 判定：`PASS`=本轮有可判错证据；`FAIL`；`NOT_RUN`=未执行；`PENDING_USER_MANUAL`=需人工受信任操作。
> **未执行项一律不得判 PASS。**

## 1. 实验前置条件（锁定不变）

| 项 | 值 |
|---|---|
| 同 Typora 版本 | 是（同一安装 `D:\Typora\Typora.exe`） |
| loaded build SHA | `741663E93C20E992422CAF28B911976DD25DF203890CDE184DF2CF35644CEB56` |
| fixture | `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md`（39B / 6 LF / `E0817FC7…`），每组用**按字节复制**的独立副本 |
| 初始光标 | 文末最后一个可见空段落末尾（逻辑 offset=0 于该空段落） |
| 配置 | 缩进快捷输入=默认开启；仅 B 组关闭 |

## 2. 组别定义与运行状态

| 组 | 定义 | 状态 | 说明 |
|---|---|---|---|
| **C0** | 禁用墨章，文末普通 Enter ×1 | **NOT_RUN** | 禁用插件需重启 Typora（插件在启动时加载）；当前实例含用户 WIP，提示词 §1.4 禁止重启/关闭 → 无法在在本轮自动完成 |
| **C4** | 启用墨章，缩进快捷保持当前设置，文末普通 Enter ×1 | **NOT_RUN** | 需受信任按键 |
| **B** | 启用墨章，**关闭**缩进快捷，文末普通 Enter ×1 | **NOT_RUN** | 代码路径已判定（`!indentShortcutEnabled` → `return false`，纯原生） |
| **D** | 启用墨章，在**仅含 `。。`** 的段落末尾 Enter ×1（另用副本） | **NOT_RUN** | 代码路径已判定（进入事务：`preventDefault`+`stopPropagation`，`suppressNativeInsertParagraph=true`，断言 `paragraphCountAfter===paragraphCountBefore` → 设计上不产生新段落）；无真实执行记录（`ALLOW_SPECIAL_COMMAND=0`） |

## 3. 代码路径判定（PROVEN，源码）

| 组 | 是否会进入缩进事务 | 是否 preventDefault | 预期段落数 |
|---|---|---|---|
| C0 | 否（无插件） | 否 | +1（原生 split） |
| C4 | 否（无 token） | 否 | +1（原生 split） |
| B | 否（`indentShortcutEnabled=false` 早退） | 否 | +1（原生 split） |
| D | **是**（token + caret 在段末） | **是** | **不变**（消费 token，缩进当前段落） |

→ 因此 **C4 与 D 的语义不同**：C4 是原生新段落；D 是「不产生新段落」的缩进命令。**C4 的重复拆分不可能来自 D 的路径**（历史日志 `ALLOW_SPECIAL_COMMAND=0` 证实 D 从未执行）。

## 4. 历史对照（HISTORICAL，非本轮）

| 场景 | 构建 | Enter 次数 | split 次数 | Markdown 净变化 | 结论 |
|---|---|---|---|---|---|
| C0（原生） | 旧构建（禁用墨章） | 1 | 1 | +2 LF | 历史基线 |
| C4（墨章） | `DE62CB1A…`（旧） | 1 | 2 | +4 LF | 历史缺陷 |
| C4（墨章，探针关） | `A337D6DF…` | 1 | 2 | +4 LF | 缺陷仍在（文末） |
| C4（墨章） | `3A165610…` | 1 | 2 | +4 LF（推断） | 缺陷仍在 |

以上为**历史**记录，按提示词要求**不得当作当前版本 PASS**。

## 5. 每 Enter 需记录的字段（供人工执行）

```
caseId | buildSha | docSha(before) | docSha(after) | bytesDelta | LFDelta
       | caretBefore/After | DOM blank N | Drawer | overlay
       | ENTER-ADMISSION-AUDIT.decision | ENTER-PLUGIN-INTERVENTION-AUDIT.createdTransaction
       | SPLIT_1_TO_2 count | duplicateSplitIndex | pluginOwnedAddedCount(批次)
       | ECHO_WINDOW_PAINT_HELD | ENTER-DUPLICATE-SPLIT-AFTER-FINAL count
       | decision(PASS/FAIL/NOT_RUN) | evidencePath
```

## 6. 结论

```
C0_C4_BASELINE=NOT_RUN
EN11_REAL_ENTER_SEMANTIC=PENDING
D_GROUP=NOT_RUN（不得声称 。。+Enter 全功能通过）
B_GROUP=NOT_RUN
```

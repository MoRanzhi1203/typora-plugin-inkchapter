# ENTER-DUPLICATE-RUNTIME-MATRIX

对照试验与人工场景矩阵。**未执行**项明确标 `NOT_RUN`，不得视为通过。

## 1. 实验前提

- 同一测试副本：`test/vault/Document-Diagnostics-Empty-Block-Presentation-Test.md`（每次测试前 `git status` 该文件必须为空）。
- 相同窗口尺寸 / 渲染模式 / 光标语义位置（文末）。
- 输入必须 **isTrusted**；自动化事件若不能稳定聚焦编辑器则终止该组并转人工。

## 2. C0–C5 矩阵

| 场景 | 配置 | nativePressReturnCount | structuralMutationCount | markdownNewlineDelta | visibleBlankDelta | diagnosticCountDelta | editorLatencyMs | pluginWriteFrames | traceCoverage | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|
| C0 | 完全禁用墨章 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | **NOT_RUN** |
| C1 | 墨章启用、关诊断显示 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | **NOT_RUN** |
| C2 | 关正文增强 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | **NOT_RUN** |
| C3 | 关段首缩进 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | **NOT_RUN** |
| C4 | 全功能 + tracer 关 | 1（观测到 `Editor.pressReturn` 双路径） | 2（两次 `SPLIT_1_TO_2`） | 未测（需 B3 三层快照） | 未测 | 未测 | 未测 | 0（结构）/ 14（属性，origin=typora） | 部分 | **FAIL（重复拆分存在）** |
| C5 | 全功能 + tracer 开 | 同上 | 同上 | 未测 | 未测 | 未测 | 未测 | 同上 | 部分 | 与 C4 行为一致（未见 tracer 制造额外行为） |

> C0–C3 需要逐项禁用插件功能并在真实 GUI 中按键，本轮**未执行**（自动化按键无法稳定聚焦编辑器）。
> C4/C5 的 `structuralMutationCount=2` 来自 `duplicateSplitIndex=2`；`pluginWriteFrames=0` 指**结构**写入，14 条为**属性**写入且 `origin=typora`。

## 3. 人工场景矩阵

| # | 场景 | 结果 |
|---|---|---|
| R01 | 文末单次 Enter | **FAIL**（出现两次 `SPLIT_1_TO_2`） |
| R02 | 连续 2 次 Enter | NOT_RUN |
| R03 | Backspace | NOT_RUN |
| R04 | Ctrl+Z / Ctrl+Y | NOT_RUN（本轮仅用于撤销注入换行，未作为验收） |
| R05 | 保存 → 关闭 → 重开 | NOT_RUN |
| R06 | 滚动（激活/非激活标记不漂移） | 既有 V511 回归覆盖（单元级），真实 GUI **NOT_RUN** |
| R07 | 侧栏窄→宽、宽→窄 | 既有 V511 回归覆盖（单元级），真实 GUI **NOT_RUN** |
| R08 | 代码块 caption+内容包围范围 | 上轮单测覆盖（`CODE_BODY_UNEXPECTED_FILL_COUNT=0`），真实 GUI **PENDING_USER_MANUAL** |
| R09 | EOF overlay 不覆写正文 | 上轮单测覆盖，真实 GUI **PENDING_USER_MANUAL** |

## 4. 三层对照快照（§B3）状态

`BEFORE / FIRST_SPLIT / FINAL / SECOND_SPLIT / SETTLED / AFTER_SAVE_REOPEN` 六态快照 **NOT_RUN**：
需要 `getMarkdown()` 尾字节、DOM 尾段（`P.md-end-block`）、诊断 snapshot 三源同步采样；本轮未取得可信 GUI 输入，未伪造数值。

### 4.1 一次被撤回的测量（诚实记录）
本轮曾试图用「注入 1 次 Enter → Ctrl+S → 比对磁盘字节/换行数」直接测 `markdownNewlineDelta`，得到 `delta_bytes=0 / delta_nl=0`。
**该测量无效并已撤回**：随即发现 Typora 活动窗口标题为 **`Untitled•`** —— Enter 落在 **Untitled 窗口**而非 fixture，fixture 磁盘未变**不能**证明「源码净增 0」。
→ 结论：`markdownNewlineDelta` 仍为 **NOT_RUN**；且暴露一个仪器缺口：**trace payload 未记录 `documentKey`**，无法自证轨迹归属哪个文档（后续应补充）。

**因此 `markdownNewlineDelta` / `visibleBlankDelta` 仍为未测**，无法判定「源码净增是否异常」，故 §C 判定分支中的关键前提缺失 → 只能标 `PENDING_USER_MANUAL`。

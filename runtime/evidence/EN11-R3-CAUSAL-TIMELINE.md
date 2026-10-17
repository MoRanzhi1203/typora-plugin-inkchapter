# EN11-R3-CAUSAL-TIMELINE

> 轮次：`sess-p0-en11-causal-closure-r3`（2026-10-12）｜证据分级：PROVEN / HYPOTHESIS / NOT_RUN

## 1. 已证实的第一次分叉（PROVEN，来自真实审计日志）

对**上一次真实运行**（构建 `3A165610…`，探针已硬关闭）中的一次受信任 Enter，稳定关联：

| 相对时刻 | 事件 | 证据 |
|---|---|---|
| t0 | `ENTER-ADMISSION-AUDIT`：`key=Enter, code=Enter, isTrusted=true, isComposing=false, decision=ALLOW_NORMAL_ENTER` | audit |
| t0 | `ENTER-PLUGIN-INTERVENTION-AUDIT`：**`createdTransaction=false`、`defaultPreventedAtHandlerEnd=false`、`cancelBubbleAtHandlerEnd=false`、`pluginDispatchSyntheticEnter=false`** | audit |
| t0+~37ms | 结构批次1 `mutationShape=SPLIT_1_TO_2`，`childListCount=2`，`provenance=USER_CONTENT`，`pluginOwnedAddedCount=3` | `EDITOR-MUTATION-PROVENANCE-AUDIT` |
| t0+~130ms | 结构批次2 `mutationShape=SPLIT_1_TO_2`，`childListCount=4`，`pluginOwnedAddedCount=4`、`pluginOwnedRemovedCount=1`，`sameStateKeyAsPrevious=true` | 同上 |
| t0+~132ms | `ENTER-DUPLICATE-SPLIT-AFTER-FINAL`：`duplicateSplitIndex=2, windowMs≈91, endBlockRenormalization=true, decision=NATIVE_END_BLOCK_RENORMALIZATION` | audit |
| t0+~154ms | 源码 `+2 LF`（相对原生多出一次 split） | `DOCUMENT-TRAILING-BLANK-AUDIT` |

**第一次因果分叉**：`#write` 子树在回声窗口内出现**插件所有的 added 节点**（批次2 的 `pluginOwnedAddedCount=4`），紧随其后 Typora 执行尾块再归一化（批次2 的 `SPLIT_1_TO_2`）。

## 2. 被否证的假设（PROVEN 否证）

- **`。。+Enter` 缩进快捷输入是触发源**：否证。`ALLOW_SPECIAL_COMMAND=0`、`CANONICAL-RECORD-COMMIT=0`、`POST-TOKEN-SELECTION=0`（全历史会话）；且源码 `readParagraphIndentCommand` 仅当段落可见文本**恰为** `..`/`。。` 才返回 token。
- **插件拦截/二次派发 Enter**：否证（`preventDefault=false` / `dispatchSyntheticEnter=false`）。
- **「一次 Enter 同时执行插件结构编辑 + 原生插入」**：否证（插件只新增展示节点，`userContentMutationCount` 归因 Typora）。

## 3. 仍为 HYPOTHESIS 的部分

「插件展示写入 → 触发 Typora 再归一化 → 第二次 split」的**因果**尚未以最小可逆 A/B 差分闭环（见 §4）。因此
`PRESENTATION_WRITE_CAUSALITY = UNKNOWN`（写入入口在窗口内 PROVEN，因果未 PROVEN）。

## 4. 因果隔离所需的最小 A/B（本轮未执行 → NOT_RUN）

唯一可变因子：**单一已确认写入入口**（当前实现为 `runContentDocumentPaint` → `PresentationPaintCoordinator`）。

- A：保持现状（启用窗口内展示写入）→ 复测 Enter；
- B：仅令该入口在窗口内**永不绘制**（其余配置不变）→ 复测 Enter。

升级为 PROVEN 的条件（提示词 §3.4）：必须**同时**观察到「该写入消失」**且**「额外拆分消失」。本轮无法执行（需受信任按键 + 需在同一运行实例内切换该开关），故记 NOT_RUN，不以静态推断冒充实证。

## 5. 本轮对「七处独立延迟回调」的处理（Phase C）

旧候选 `9146A7B0…` 用 **7 处各自独立的 `setTimeout(remainingMs+1)`**（含跨文档/根替换不可取消、可能重放旧快照）。本轮改为**单一 `PresentationPaintCoordinator`**：

- 每 `(documentKey, 展示域)` 仅一个 pending dirty intent（latest-wins 合并）；
- intent 携带 `documentKey / editorRootId / sourceRevision / layoutEpoch / intentEpoch`；
- **无 hold → 同步绘制**（非 Enter 路径行为零变化）；
- **有 hold → 帧驱动有界重检**（非固定 250ms 作为唯一安全判断；预算 `MAX_HELD_FRAMES` 耗尽即 fail-open 绘制，标记不会永久消失）；
- 绘制时**重新读取实时 identity/geometry**（绝不重放捕获的旧 DOM）；
- 文档切换 / 根替换 / dispose → `cancelAll` 全部丢弃并记 `DROP_STALE`；
- 无轮询、无常驻 body MutationObserver、无写-观察反馈环。

详见 `EN11-R3-PATCH-AND-TESTS.md`。

## 6. 结论

```
FIRST_PROVEN_DIVERGENCE=回声窗口内 #write 子树出现插件展示 added 节点（批次2 pluginOwnedAddedCount=4），紧随 Typora 尾块再归一化
PRESENTATION_WRITE_CAUSALITY=UNKNOWN
MINIMAL_AB_DIFFERENTIAL=NOT_RUN
```

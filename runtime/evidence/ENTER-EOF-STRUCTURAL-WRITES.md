# ENTER-EOF-STRUCTURAL-WRITES

> 阶段 4 交付物。对 `recordCount=18` 中的 **4 条结构写入**逐条归因。证据等级：**OBSERVED（原始 trace + 代码）**。
> 原始数据：`test/vault/.typora/inkchapter-enter-echo-trace.json`（`capturedAt=2026-10-12T08:03:31.403Z`，`normalEnterTxnId=NENTER-3-1791792211233`）。

## 1. 汇总

```
recordCount=18   truncated=false
structuralRecordCount=4        ← appendChild/insertBefore/removeChild/replaceChild/remove/insertAdjacentElement
pluginStructuralWriteCount=4
originCounts={plugin:4, typora:14, unknown:0}
```

14 条 `typora` 记录全部是对尾块 `P.md-end-block.md-p` 的 `attr:setAttribute/removeAttribute`（属性写入，**不能**作为结构证据）。
4 条 `plugin` 记录全部是 **`struct:remove`，目标 `DIV`**。

## 2. 四条逐条明细

| # | kind | 目标 | sinceEnterMs | origin | 首个有效业务帧（跳过 tracer 自身帧后） |
|---|---|---|---|---|---|
| 1 | `struct:remove` | `DIV` | 50 | plugin | `n.runBlankRowPaintLayerAcceptanceDryRun` |
| 2 | `struct:remove` | `DIV` | 50 | plugin | 同上 |
| 3 | `struct:remove` | `DIV` | 50 | plugin | 同上 |
| 4 | `struct:remove` | `DIV` | 61 | plugin | `n.reconcileInternalBlankLineDiagnostics`（同一调用链上一层） |

统一调用链（`stack` 原文，截断 120 字符/帧）：

```
at n.runBlankRowPaintLayerAcceptanceDryRun (…/test/vault/.typora/plugins/dist/main.js)
at n.reconcileInternalBlankLineDiagnostics (…/test/vault/.typora/plugins/dist/main.js)
at n.commitAdmittedSnapshot                (…/test/vault/.typora/plugins/dist/main.js)
at …/plugins/dist/main.js?v=0.1.0-alpha.1:96:2
at KC.notify (…/main.js)   ← 框架订阅分发（非业务写入者）
at KC.recompute (…/main.js)
at …/main.js:96:2
at t (typora://app/typemark/appsrc/window/frame.js:1:598476)   ← 最底层触发者：框架/原生
```

- **wrapped method**：`Element.prototype.remove`（`WRITE_METHODS` 中的 `['remove','element']`）。
- **真实调用帧**：`runBlankRowPaintLayerAcceptanceDryRun`（本仓库 `document-utility-overlay-host.ts` 的提交期「验收 dry-run」）。
- **目标是否属于内容文档**：是。`nodeTouchesWriteRoot()` 仅在 `#write`（或其子树）时记录；被移除的 DIV 位于 `ensureLocateDocumentLayer()` 创建的 paint layer 内，而该 layer 由 `host.appendChild(layer)` 挂在 `resolveBusinessContentRoot()`（内容文档根 `#write`）下。
- **前后拓扑指纹**：见 §4（本轮 tracer 已新增 `targetFingerprint`/`affectedFingerprint`，下一条真实 Enter 可给出 `tag/childCount/parent/attrs`，用于确认这些 DIV 的 `data-inkchapter-acceptance-dryrun` 身份）。
- **时间**：`sinceEnterMs=50/50/50/61`（Enter 在 `08:03:31.233`，即 `.283–.294`）。
- **enterTxnId**：`NENTER-3-1791792211233`；**documentKey**：`Document-Diagnostics-Code-Integrity-Test.md`。
- **是否早于第二次 SPLIT**：**是**。第二次 split 的批次 `emb-1791792211402-k9` 在 `.402`，4 条写入在 `.283–.294` → **插件结构写入早于第二次 SPLIT ≈ 108–119ms**。

## 3. 与插件自身「变更来源审计」的交叉验证（独立证据源）

`EDITOR-MUTATION-PROVENANCE-AUDIT`（插件自带 observer 的独立统计）：

| 批次 | 时间 | pluginOwnedAddedCount | pluginOwnedRemovedCount | userContentMutationCount | mutationShape |
|---|---|---|---|---|---|
| `emp-1791792211259` | .259 | **4** | 0 | 1 | **SPLIT_1_TO_2** |
| `emp-1791792211335` | .335 | 0 | 0 | 22 | NONE |
| `emp-1791792211401` | .401 | **4** | **1** | 1 | **SPLIT_1_TO_2** |
| `emp-1791792211433` | .433 | 3 | 0 | 0 | NONE（`PLUGIN_PRESENTATION`） |

- 两个 `SPLIT_1_TO_2` 批次都携带 **`pluginOwnedAddedCount=4`**。
- `4 = 1 个 dry-run 容器 + 3 个 fragment DIV`，正是 `runBlankRowPaintLayerAcceptanceDryRun` 每次提交插入的节点数（`container` + 每条源空行一个 `fragment`）。
- 纯展示批次（.433，标题标记/载体）是 `pluginOwnedAddedCount=3`，与 split 批次的 4 不同 → 说明 split 批次的 4 个插件新增节点**特指 dry-run 探针**，而非普通 overlay 载体。

## 4. 反证与覆盖边界（不得夸大）

- **反证（旧结论被推翻）**：上一轮 `ENTER-DUPLICATE-ROOT-CAUSE.md` 依据 `structuralRecordCount=0 / plugin=0 / typora=14` 判定「插件未做结构写入，第二次 split 是原生尾块重建」。该结论 **REFUTED**：宽域追踪器本轮记录到 `pluginStructuralWriteCount=4`，且插件自带 provenance 审计独立显示 split 批次携带 4 个插件新增节点。
- **覆盖边界**：tracer 仅覆盖 `Node`/`Element` 的 mutation 方法；**未覆盖** `innerHTML/outerHTML`、`Range`、Typora 内部模型直改。因此「4 条 = 全部」不能外推为「插件只写这 4 次」。但本轮 4 条已足以命名**一个具体的、可复核的插件内容文档写入入口**。
- **未覆盖的观测缺口**：本轮 trace 只记录到 `struct:remove`，未记录到对应的 `struct:appendChild`（同一 dry-run 的插入）。插入与移除发生在同一提交内、时间相近；插入未落库的原因**未定案（UNKNOWN）**，已通过新增 `targetFingerprint/affectedFingerprint` 与 provenance 交叉验证补强，下一条真实 Enter 可直接确认节点身份。

## 5. 逐条归因结论

| 记录 | 操作 | 真实业务帧 | 目标 | 是否内容文档 | 时序 | 结论 |
|---|---|---|---|---|---|---|
| ×3 | `Element.remove` | `runBlankRowPaintLayerAcceptanceDryRun` | dry-run DIV | 是（`#write` 子树） | 早于 2nd split | **插件写入 PROVEN** |
| ×1 | `Element.remove` | 同上（链上层 `reconcileInternalBlankLineDiagnostics`） | dry-run DIV | 是 | 早于 2nd split | **插件写入 PROVEN** |

**FOUR_STRUCTURAL_WRITE_ORIGINS = plugin×4（全部来自提交期 paint-layer 验收 dry-run），非 Typora、非 unknown。**

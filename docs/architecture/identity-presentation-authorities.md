# 身份与呈现权威（Identity & Presentation Authorities）

> 本文件是若干轮修复中长期稳定下来的**架构原则**的单一 canonical 说明。
> 每条都标注当前真实状态：`CURRENT`（已在生产代码中落地）/ `PARTIAL`（部分落地）/ `DEFERRED`（仅为历史设计目标）。
> 模块文档（[../modules/](../modules/)）引用本文件，不再各自复述。

## 0. 为什么需要"权威"分层

墨章同时存在三类容易混淆的"身份"与"几何"：

- **源身份**（Markdown 文本中的事实）
- **规范对象身份**（插件解析出的稳定目标）
- **呈现身份/几何**（某个 document 版本下的屏幕坐标与视觉）

历史缺陷（重复 occurrence 高亮错处、诊断在编辑后高亮旧坐标、Drawer 定位被覆盖）根因都是把其中一层当成另一层的权威。以下分层为现行规则。

## 1. Source Identity — `CURRENT`

- 用户文档事实只来自 Markdown 源（canonical source），不读渲染后的 `textContent` / 可见编号 span。
- 生产文件：`src/heading-numbering/canonical-heading-frame.ts`（`CanonicalHeadingFrame` / `getCanonicalHeadingFrame`，经 `main.ts` 注入 `DocumentUtilities` 与 `CaptionService`）。
- 标题级诊断的 `sourceAuthority` = canonical 源标题文本（见 `docs/diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md` §6）。

## 2. Canonical Object Identity（图/表/代码/公式对象身份）— `CURRENT`

- 图片名称权威 = Markdown alt（`src/heading-numbering/figure-alt-binding.ts`）。
- 表/代码名称存于插件 sidecar（`src/heading-numbering/caption-store.ts`，路径 `<vault>/.typora/inkchapter/captions/<doc>.json`），并以 `targetAnchor` 与目标一对一绑定（`src/heading-numbering/caption-dom-adapter.ts`）。
- 题注"存在性"与"命名"由 `CaptionService` 统一发布（`src/heading-numbering/caption-service.ts` / `caption-semantic-bridge.ts`）。
- 约束：`1 business object = 1 standalone owning block = 1 canonical target`（Standalone Object Block Invariant），生产文件 `src/document-utilities/document-standalone-object-block-invariant-v515.ts`。

## 3. Presentation Owner / Presentation Extent — `CURRENT`

- 诊断"呈现归属"与"呈现范围"由文档工具层持有，不进入编号/题注语义管线。
- 空白警告呈现：`src/document-utilities/blank-space-warning-presentation.ts`。
- 呈现 extent 语义与几何分离，禁止把 overlay 遮挡误判为几何截断。

## 4. Stable Diagnostic Identity — `CURRENT`

- 诊断 id 去重键 = `category + code + targetIdentity`（`deduplicateDiagnostics`，`src/document-utilities/document-diagnostics.ts`）。
- 重复 source occurrence 的稳定身份：`SourceOccurrenceIdentity`（`documentKey + sourceRevision + resourceKind + canonicalDestination + sourceStart + sourceEnd + occurrenceIndex`），生产文件 `src/document-utilities/document-diagnostic-source-occurrence-v512-r5.ts`。
- 多 target 唯一键 = `${docKey}::${diagnosticId}::${targetIndex}::${stableIdentity}`。

## 5. Location Authority（定位权威）— `CURRENT`

- 三态定位策略（canonical-node / source-range / figure-occurrence）由注册表决定。
- 生产文件：`src/document-utilities/document-diagnostic-location.ts`、`document-diagnostic-locator.ts`、`document-diagnostic-locator-authority-v1.ts`。
- 定位视觉与定位事务解耦，`canCommitLocateVisual()` 是唯一提交门（见 §7）。

## 6. Presentation Authority（呈现权威）— `CURRENT`

- 诊断视觉闭合：`src/document-utilities/document-diagnostic-visual-closure-v512-r2.ts`、`document-diagnostic-visual-closure-target-v514-r2.ts`、`document-diagnostic-visual-reflow-v514-r4.ts`。
- passive 视觉集与 active 强调双权威解耦：`document-diagnostic-passive-active-v514-r3.ts`（passive 永不等于 selection；active 只能增/移/删自身）。

## 7. Active Transaction / Active Lease — `CURRENT`

- 视觉事务：`src/document-utilities/document-diagnostic-visual-transaction-v2-1.ts`（locate 与 visual 解耦、原子 teardown、Fill/Marker/Lease 同事务）。
- 两类 lease 拆分：`DrawerLocateRecoveryLease`（终态前必须释放）与 `ActiveLocateVisualLease`（可跨 COMMIT）；生产文件 `src/document-utilities/document-diagnostic-drawer-persistence-v512-r3.ts`。
- 交互状态机：`src/document-utilities/document-diagnostic-active-state-machine-v2.ts`（统一 ACTIVATE/DEACTIVATE/SWITCH，severity-blind）。
- canonical active target 解析 fail-closed，不回落 `targets[0]`：`src/document-utilities/document-diagnostic-canonical-active-target-v2.ts`。

## 8. Layout Epoch — `CURRENT`

- 唯一 `DocumentLayoutEpoch`：仅 caption/numbering/formula projection、window settle、document switch/load bump；scroll/pointer/selection/focus 禁止 bump。
- 生产文件：`src/document-utilities/document-layout-epoch-v512-r2.ts`。

## 9. Document Isolation — `CURRENT`

- 所有跨文档状态以 `documentKey` 归属（`generateDocumentKey()`，`src/heading-numbering/heading-numbering-scope-store.ts`）。
- Active document presence 最高权威 = `activeLeaf.state.path`（`main.ts` 的 `readWorkspaceActiveLeafState`）；EXPLICIT EMPTY 硬否决 stale `activeFile`。
- Problems 控制唯一投影链：`src/document-utilities/document-problems-projection.ts`。

## 10. Deferred 原则（只为历史设计目标，当前未实现）

| 原则 | 状态 | 说明 |
|---|---|---|
| 跨文件 Anchor 检测 | `DEFERRED` | 全仓无 heading slug/anchor 生成器；正文 `#anchor` 在 `document-resource-scanner.ts` 归入 `other` 跳过。 |
| 结构化 Figure/Table/Formula 正文引用解析 | `DEFERRED` | 无 structured reference catalog / parser；见 gap ledger §3.3。 |
| 用户源侧 caption 格式契约 | `DEFERRED` | 未定义 caption 语法；插件状态不得报为文档错误。 |
| 用户源侧编号冲突检测 | `DEFERRED` | 编号为渲染时计算、不持久化；根因属 runtime 域。 |

详见 [../roadmap/known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md)。

## 11. 相关文档

- [plugin-architecture.md](plugin-architecture.md)
- [../modules/document-utilities.md](../modules/document-utilities.md)
- [../modules/document-diagnostics.md](../modules/document-diagnostics.md)
- [../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md](../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md)

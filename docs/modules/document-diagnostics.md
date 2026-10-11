# 模块：Document Diagnostics（文档诊断）

> 本文件是"文档诊断"模块的 canonical 说明。规则清单**不在本文件复制**，以
> [../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md](../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md)
> 为唯一矩阵（由脚本生成），本文件只描述权威、机制与契约。

## 1. 作用与用户可见能力

在 Typora 编辑器中实时检测当前 Markdown 文档的结构/完整性/一致性，把结果呈现为：

- 右上角工具栏的错误/警告/提示计数；
- 可用鼠标点击定位的文档内标记（passive）与当前选中强调（active）；
- 右侧 Drawer 的问题列表与筛选；
- 左侧大纲上的诊断投影（仅已提交映射时）。

runtime 域（插件自身部署完整性）**不会**进入用户 Drawer（见 §5）。

## 2. 当前实现状态

- 真实计数以自动生成的 [../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md](../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md) 为准（由 `scripts/document-diagnostics/generate-capability-matrix.mjs` 从注册表 + Runtime Code Resolver + Static Test Manifest + Runtime Evidence Manifest 推导）。本文件不复制规则清单，避免漂移。
- 单一 producer `computeDocumentDiagnostics`，单一注册表 `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`。
- 事件驱动重算，无 `setInterval` 全文轮询。
- Source Syntax / Footnote / Reference-style Link / Front Matter / Table Header / Empty Link 完整性（TRAE V3）由 **三套共享 source authority** 单一解析供给：
  - `DocumentSourceSyntaxAuthority`（`src/document-utilities/document-source-syntax-authority.ts`）—— Front Matter / Code Fence / Formula Block / Protected Ranges + Source Table Structure，一次 source revision 解析 ≤ 1 次。
  - `DocumentDefinitionReferenceIndex`（`src/document-utilities/document-definition-reference-index.ts`）—— footnote 引用/定义 + reference-style link 引用/定义，一次 source revision 构建 ≤ 1 次；footnote 与 reference-link 不再各写一套全文 scanner。
  - `DocumentInlineLinkAuthority`（`src/document-utilities/document-inline-link-authority.ts`）—— `[text](target)` / `![alt](target)` 结构，一次 source revision 解析 ≤ 1 次。
- `FRONTMATTER_MALFORMED` 因项目无 canonical YAML parser，按规格登记为 `DEFERRED_BY_SPEC`（reason = `CANONICAL_FRONTMATTER_PARSER_REQUIRED`），绝不用自制 regex 冒充 YAML 校验。
- 内部空行过多 `EXCESSIVE_INTERNAL_BLANK_LINES` 的**发布判决以可视空行数为依据**（见 §4）。

## 3. Production Entry Points

| 关注点 | 生产文件 |
|---|---|
| 诊断计算（单一 producer） | `src/document-utilities/document-diagnostics.ts` |
| 诊断 authority / 装配 | `src/document-utilities/document-diagnostics-authority.ts`、`src/document-utilities/document-diagnostics-vnext-authority.ts` |
| Source Syntax / Definition-Reference / Inline-Link authority | `src/document-utilities/document-source-syntax-authority.ts`、`document-definition-reference-index.ts`、`document-inline-link-authority.ts` |
| 域分离（document vs runtime） | `src/document-utilities/diagnostic-domain-v1.ts` |
| 定位 | `src/document-utilities/document-diagnostic-location.ts`、`document-diagnostic-locator.ts`、`document-diagnostic-locator-authority-v1.ts` |
| 呈现 / 视觉闭合 | `src/document-utilities/document-diagnostic-visual-closure-v512-r2.ts`、`document-diagnostic-visual-closure-target-v514-r2.ts`、`document-diagnostic-visual-reflow-v514-r4.ts`、`document-diagnostic-passive-active-v514-r3.ts` |
| 交互 / 事务 / 状态机 | `src/document-utilities/document-diagnostic-active-state-machine-v2.ts`、`document-diagnostic-canonical-active-target-v2.ts`、`document-diagnostic-visual-transaction-v2-1.ts` |
| 能力矩阵生成 | `scripts/document-diagnostics/generate-capability-matrix.mjs` |
| main wiring | `src/main.ts` → `createDocumentUtilities(...)`（注入 `getDiagnosticSnapshot`、`getCaptionIntegrityDiagnostics`、`getObjectEffectiveNumberElementFacts` 等） |

## 4. Authority / Source of Truth

- **Content Diagnostic vs State Guard**：`diagnostic-domain-v1.ts` 定义 `DiagnosticDomain`；`document-diagnostics-authority.ts` 只发布 `document` 域。
- **Severity**：error / warning / hint 三档；severity palette 冻结（`src/style.scss`）。
- **Stable Identity**：去重键 `category + code + targetIdentity`（`deduplicateDiagnostics`）；occurrence 级身份见 `document-diagnostic-source-occurrence-v512-r5.ts`。
- **Location Authority / Presentation Authority / Active Transaction**：见 [../architecture/identity-presentation-authorities.md](../architecture/identity-presentation-authorities.md)。
- **内部空行发布判决（`src/document-utilities/document-diagnostic-internal-blank-decision-v1.ts`）**：正常编辑（WYSIWYG）下**以可视空行数 `visibleBlankLineCount` 为发布依据**——`<=1` 不发布、`>=2` 发布且数量=可视数；`sourceBlankLineCount` 仅保留用于源码解析 / 位置映射 / 调试，**不直接决定告警**。数据来源按编辑模式区分：`wysiwyg` 取渲染行带、`source`（`.typora-sourceview-on`）取源码行数、`unknown` 或不可测量时**不猜测**（不发布）。模式切换由 `body` 的**只读** class 观察器触发重评估，禁止复用另一模式的遗留结果；不符合条件的诊断从**快照 / 计数 / 排序 / Active** 同步移除（非仅在 Drawer 隐藏）。
- **Drawer 更新三态（`src/document-utilities/document-diagnostic-drawer-viewport-v1.ts`）**：`STRUCTURAL_UPDATE`（行集合 / 顺序 / 严重级别 / 筛选 / 文档变化 → 重建并捕获恢复视口）、`CONTENT_UPDATE`（行集合不变但**显示内容**变化 → 就地刷新既有行文字，不重建、不动滚动 / 选中 / Active）、`ACTIVE_PATCH`（结构与内容均不变）。判定由**结构签名**与**内容签名**（含真实显示文字）分离决定，纯内容变化绝不折叠为 `ACTIVE_PATCH`。
- **真实 DOM 内容一致性门禁**：`DOCUMENT-DIAGNOSTIC-DRAWER-CONTENT-CONSISTENCY` 读回 Drawer 行的**真实 DOM 文字**并校验显示数 == 当前诊断的可视空行数（`checkedRowCount` / `mismatchCount`），禁止只比较内部对象即宣布 PASS。

## 5. 核心数据结构

- `Diagnostic`（含 `code` / `severity` / `domain` / `scope` / `presentation` / 目标身份与 location）。
- `DiagnosticDomain = 'document' | 'runtime'`。
- `DiagnosticTargetProjection`（Drawer 的 occurrence 级条目，按文档位置排序）。
- `RuntimeIntegrityReport`（runtime 域，`refreshRuntimeIntegrity`）。

## 6. 主流程

```text
源变更 / 文档切换 / 设置变更（事件驱动）
  → computeDocumentDiagnostics（单一 producer）
  → deduplicateDiagnostics（稳定 id）
  → document-diagnostics-authority 发布 document 域快照
  → 工具栏计数 / Drawer / passive marker /（COMMITTED 时）大纲投影
  → 用户点击 → 定位事务（canCommitLocateVisual 门）→ active 强调
```

## 7. 用户交互与 UI Contract

- Drawer 顶部筛选固定为 全部 / 错误 / 警告 / 提示；内部 area 只作 metadata，不生成 Tab。
- reason chip 由注册表 `scope` 决定（`shouldRenderReasonChip({code})`），无 `code === 'DOCUMENT_*'` 特判。
- passive 与 active 视觉解耦（passive 永不等于 selection）。
- Drawer 行**内容**变更走 `CONTENT_UPDATE` 就地刷新：保留滚动位置、选中状态与 Active 标记，不无差别重建面板。

## 8. Settings / Persistence

- 诊断本身无独立持久化设置；行为受标题编号有效设置、strict/loose 有效模式、caption 设置影响。
- 有效模式必须取 `numberingService.getEffectiveHeadingMode()`（文档覆盖 ?? 全局），不得只读全局。

## 9. Dynamic Refresh / Event Model

- 触发：`onSourceEdit`（editor `edit`）、`onDocumentSwitch`（`file:open`）、`onCanonicalFrameCommit`、`onSettingsChanged`、`onActiveLeafChanged`。
- 无轮询；几何按 `DocumentLayoutEpoch` 失效/重建。

## 10. Runtime Audit / Debug Evidence

- 审计前缀：`DOCUMENT-DIAGNOSTIC-*`、`DIAGNOSTIC-DOMAIN-RUNTIME-REPORT`、`RUNTIME-IDENTITY-FINAL`（runtime 域）。
- 证据落盘：`<vault>/.typora/inkchapter/audit/runtime-<sessionId>.log`（`src/runtime/forensic-log-sink.ts`）。

## 11. Tests / Fixtures

- 单测：`src/document-utilities/document-diagnostics.test.ts`、`document-diagnostics-vnext-gap-closure-v1.test.ts`、`document-diagnostic-heading-auto-number-conflict-v1.test.ts`、`document-diagnostic-static-test-manifest.ts` 等。
- 静态/运行期闭合：`document-diagnostic-runtime-closure-authority.ts`、`document-diagnostic-runtime-closure-evidence-mapping.test.ts`。
- Runtime smoke fixtures：`test/vault/runtime/smoke/Document-Diagnostics-*.md`、`runtime/smoke/Document-Diagnostics-*.md`。
- 能力矩阵：`docs/diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md`（生成脚本 `scripts/document-diagnostics/generate-capability-matrix.mjs`）。

## 12. Build / Deployment 相关约束

- 规则清单改动后应重跑 `scripts/document-diagnostics/generate-capability-matrix.mjs` 保持矩阵与注册表一致。

## 13. 已知限制与 Deferred Work

- 25 条 VNext 规则 `DEFERRED_BY_SPEC`（caption 家族 / 编号完整性家族 / anchor 家族 / cross-reference 家族）。
- 见 [../roadmap/known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md)。

## 14. 历史设计决策

- Earlier DOM-adjacency approach was replaced by canonical owner resolution（题注归属不再靠 DOM 邻接猜测）。
- 视觉方案经 `raw DOM → semantic occupancy → presentation extent` 演进，失败方向不进入当前规范。

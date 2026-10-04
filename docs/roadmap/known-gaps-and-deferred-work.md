# Known Gaps & Deferred Work

> 本文件收录"**当前代码/测试/Runtime 尚无证据支持**"的能力与残差。
> 规则：未实现的能力**不得**写进模块的"当前实现"说明，也**不得**写进 CHANGELOG 的 `Added`；只能出现在这里。
> 每项均标注真实证据与原始提示词出处（Provenance 仅用于追溯，不代表已实现）。

## A. 设计层面确认延后（DEFERRED_BY_SPEC）

| Feature | Module | Current Status | Why Deferred | Required Authority | Evidence | Original Prompt Provenance | Priority |
|---|---|---|---|---|---|---|---|
| 跨文件 / 本地 Anchor 检测（`LINK_LOCAL_TARGET_MISSING` 之外的 anchor 家族） | document-diagnostics | DEFERRED | 全仓无 heading slug / anchor 生成器，禁止自造第二套 slug | Typora 实际锚点行为的 canonical anchor authority | [docs/diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md](../diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md) §3.2；`src/infrastructure/heading-dom-adapter.ts`、`src/document-utilities/document-resource-scanner.ts` | TRAE-DOCUMENT-DIAGNOSTICS-VNEXT-REQUIREMENTS-GAP-CLOSURE-V1 | P2 |
| 结构化 Figure/Table/Formula 正文引用解析（`*_REFERENCE_TARGET_MISSING`） | document-diagnostics | DEFERRED | 无 structured reference catalog / parser；禁止对中文 prose 用全局 regex | structured reference parser | 同上 §3.3 | TRAE-DOCUMENT-DIAGNOSTICS-VNEXT-REQUIREMENTS-GAP-CLOSURE-V1 | P2 |
| 用户源侧 caption 格式 / orphan / multiple / 编号冲突规则族（9 + 8 条） | document-diagnostics | DEFERRED | 用户源里不存在独立 caption 实体；编号不持久化，根因属 runtime 域 | 用户源侧 caption 语法 + 编号权威 | 同上 §3.1/§3.2/§5 | TRAE-DOCUMENT-DIAGNOSTICS-VNEXT-REQUIREMENTS-GAP-CLOSURE-V1 | P3 |
| 分段式公式自动编号 / 公式可见 tag 编号（section-based formula numbering） | object-caption-numbering | REDEVELOPMENT_REQUIRED | 旧 R5→R60 公式编号架构已废弃，需按当前 canonical 语义权威重做 | 公式语义权威（`src/heading-numbering/formula-semantic-planner.ts`）+ 单投影仲裁 | `README.md` 当前公式模块状态；[modules/formula-numbering.md](../modules/formula-numbering.md) | 公式编号历史链（见 [maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)） | P1 |

## B. 已实现主体、但存在未闭环残差（PARTIAL）

| Feature | Module | Current Status | Why Deferred | Required Authority | Evidence | Original Prompt Provenance | Priority |
|---|---|---|---|---|---|---|---|
| Figure Diagnostic Locator V1 残差 | document-utilities | PARTIAL | blockquote 结构块 `DOM_BLOCK_IDENTITY_UNRESOLVABLE → FAIL`；fixture decode FAIL → occurrence coverage=0 | Source↔DOM binding | `src/document-utilities/document-diagnostic-locator*.ts`；`test/vault/runtime/smoke/Figure-Diagnostic-Locator-V1-Test.md` | TRAE-FIGURE-DIAGNOSTIC-LOCATOR-V1 / -SEMANTIC-CLOSURE-V2 | P2 |
| Figure Diagnostic Fixture Resource V1 残差 | document-utilities | PARTIAL | Runtime Acceptance A–H 未执行；`PIXEL_GATE` 未确认 | 真实资产目录 + `EXPECTED_MISSING` allowlist | `src/document-utilities/document-diagnostic-fixture-resource-preflight-v1.ts` | TRAE-FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-CLOSURE-V1 / -FIXTURE-RESOURCE-LOCATOR-VISUAL-CLOSURE-V2.1 | P2 |
| Document Utility Performance Closure V1 残差 | document-utilities | PARTIAL | 无专属单测；stress Matrix A–H 未运行 | Mutation Provenance 分流（`PLUGIN_PRESENTATION` 不进 semantic pipeline） | `src/heading-numbering/document-utility-mutation-provenance-v1.ts` | TRAE-DOCUMENT-UTILITY-PERFORMANCE-CLOSURE-V1 | P2 |
| 启动首开诊断准入（Startup Snapshot Admission V5）残差 | document-utilities | PARTIAL | 两条 invariant 名 + `STARTUP_ACTIVE_BARRIER` 未落地；首开准入无真机验收 | Consumer admission（`admitDiagnosticsSnapshot`） | `src/document-utilities/document-startup-snapshot-admission-v5.test.ts` | Trae-DeepSeekV4-Startup-Snapshot-Admission-V5-OneShot | P2 |
| 空工作区 / 空 surface / 真实双击创建残差 | document-utilities | PARTIAL | 真实 OS 双击创建未闭环（`BLOCKED_BY_GUI_TOOLING`） | capture-phase 双击 + Readiness Barrier | `src/document-utilities/document-empty-workspace.ts`、`document-empty-workspace-controller.ts`、`document-active-document-readiness.ts` | Trae-DeepSeekV4-Empty-Workspace-UX-V1 / -Empty-Surface-Initial-Diagnostics-V2 / -Real-DblClick-Readiness-Barrier-V3 | P2 |
| Problems 投影 / Presentation 恢复 V4 残差 | document-utilities | PARTIAL | 提交后最终 DOM 计数采样未取得 | 唯一投影链 + suppressed→full replay | `src/document-utilities/document-problems-projection.ts` | Trae-DeepSeekV4-Problems-Projection-Presentation-Restore-V4-OneShot | P3 |
| Close-Last-Tab / Active Leaf Presence V3 残差 | document-utilities | PARTIAL | 真实"关闭最后标签→应用内空 leaf"受环境阻塞 | `activeLeaf.state.path` 最高 authority + EXPLICIT EMPTY 硬否决 | `main.ts`（`readWorkspaceActiveLeafState`） | Trae-DeepSeekV4-Close-Last-Tab-Active-Leaf-Closure-V3-OneShot | P2 |
| Code Caption / Figure Diagnostics V5.12-R8 残差 | object-caption-numbering · document-utilities | PARTIAL | `dup.png` occ1 单击 `ONE_CLICK_VISUAL_FAILED:ZERO_PAINTED_RECT`；`same.png` 未复验 | 单 scanner 双 range + occurrence-aware Range | `src/document-utilities/document-caption-code-spacing-v512-r8.ts`、`src/document-utilities/document-diagnostic-figure-target-v512-r8.ts` | Trae-DeepSeekV4-Code-Caption-Figure-Diagnostics-V5.12-R8-OneShot | P2 |
| 像素级目检门禁（`PIXEL_GATE`） | 全部 UI 模块 | PARTIAL | `PIXEL_GATE=PENDING_USER_VISUAL_ACCEPTANCE`（部分会话为 `BLOCKED_BY_ENVIRONMENT`） | 真实 Typora 截图目检 | 各轮 audit 记录 | 多轮 UI/定位提示词 | P3 |

## C. 内容审计发现、未删除的边界文件（OPEN）

- `test/vault/regression/r58/trae-p0-r58-7-strict-startup-fresh03-formal-clean-r0-gate.md`：内容是一次性 P0 执行提示词，但位于受保护的 git 跟踪回归目录。本轮遵守"不修改 test/fixtures"约束，**未删除**。若后续允许清理 fixtures，应按 Prompt 处理并登记到 [maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)。
- `src/document-utilities/document-hint-visual-semantics-chip-policy-v1.test.ts` 顶部注释引用了历史提示词名 `TRAE-DOCUMENT-HINT-VISUAL-SEMANTICS-CHIP-POLICY-V1`（纯溯源注释，非文档链接）。本轮不修改生产测试，保留。

## D. 已确认**不存在**的能力（避免误称"当前支持"）

- 插件不存在独立的 caption 实体解析（图名=alt；表/代码名=插件 sidecar）。
- 插件不存在实时持久化的对象编号（编号为渲染时计算）。
- 插件不存在跨文件引用解析与 anchor 目录。

> 以上均以当前 `src/**` 与测试为据；与任何历史提示词的描述冲突时，以代码为准。

## E. TRAE V3 登记、但本轮**未进入** Production Registry 的 P2 候选

> 来源：`TRAE-DOCUMENT-DIAGNOSTICS-SYNTAX-FOOTNOTE-REFERENCE-FRONTMATTER-EXPANSION-V3` §15。
> 这些能力本轮**只登记、不实现**，不进入 `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`（避免为凑数而注册）。

| 组 | Runtime Code（候选） | 现状 | 依赖 |
|---|---|---|---|
| List | `LIST_ITEM_EMPTY` / `LIST_NESTING_LEVEL_JUMP` / `TASK_LIST_ITEM_EMPTY` / `ORDERED_LIST_NUMBER_SEQUENCE_INVALID` | P2 / 未实现 | 列表结构 source authority |
| Accessibility | `IMAGE_ALT_TEXT_EMPTY` | P2 / 未实现 | 复用 `DocumentInlineLinkAuthority` 的 image alt |
| Leading Blank | `DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE` | P2 / 未实现 | 现有 EOF / 空白策略扩展 |
| Code | `CODE_LANGUAGE_UNKNOWN` | P2 / 未实现 | 代码块 info string authority |
| Source Hygiene | `TRAILING_WHITESPACE` / `MIXED_LINE_ENDINGS` / `TAB_INDENTATION` / `BOM_PRESENT` | P2 / 未实现 | 源码级 hygiene 通道（不走诊断 DOM） |
| Front Matter Later | `FRONTMATTER_DUPLICATE_KEY` / `FRONTMATTER_EMPTY` / `FRONTMATTER_NOT_AT_DOCUMENT_START` | P2 / 未实现 | canonical YAML parser（与 `FRONTMATTER_MALFORMED` 同源阻塞） |
| Link Definition Later | `LINK_REFERENCE_DEFINITION_UNUSED` | P2 / 未实现 | 复用 `DocumentDefinitionReferenceIndex`（索引已具备引用/定义两侧） |
| Table Later | `TABLE_ROW_COLUMN_COUNT_INCONSISTENT` / `TABLE_DATA_ROW_EMPTY` | P2 / 未实现 | 现有 Source Table Structure authority 扩展 |
| Formula Label | `FORMULA_LABEL_DUPLICATE` / `FORMULA_LABEL_EMPTY` / `FORMULA_REFERENCE_LABEL_MISSING` | P2 / 未实现（无 canonical parser 时继续 `DEFERRED_BY_SPEC`） | 公式 label/ref canonical parser |

## F. TRAE V3 明确保持冻结（不得误实现）

- `LINK_LOCAL_FILE_ANCHOR_MISSING`、`FIGURE_REFERENCE_TARGET_MISSING`、`TABLE_REFERENCE_TARGET_MISSING`、`FORMULA_REFERENCE_TARGET_MISSING` 继续 `DEFERRED_BY_SPEC`。
- 结构化 Figure/Table/Formula 正文交叉引用仍需 **Canonical Structured Reference Parser**；**禁止**使用宽泛中文 prose regex（图 3-2 / 表 4-1 / 式（5.3））。
- `FRONTMATTER_MALFORMED` 已登记为 `DEFERRED_BY_SPEC`（reason = `CANONICAL_FRONTMATTER_PARSER_REQUIRED`）；项目当前**不含** canonical YAML parser 依赖。

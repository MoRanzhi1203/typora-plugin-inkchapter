# Document Diagnostics VNext — Requirements Gap Ledger (V1)

> 规格来源：原 VNext Requirements Gap Closure 提示词（已并入 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）。
>
> 本 Ledger 以**当前真实源码**为准，逐项标注 `IMPLEMENTED / PARTIAL / MISSING / DEFERRED_BY_SPEC`。
> 不得为凑数而实现高误报规则（规格 §39）；无 canonical authority 的能力一律 `DEFERRED_BY_SPEC`（规格 §18/§25/§26/§29）。

## 0. 汇总

| 指标 | 值 |
| --- | --- |
| CURRENT_BASELINE_RULE_COUNT | 25 |
| CURRENT_BASELINE_CATEGORY_COUNT | 7（document / heading / figure / table / code / formula / link） |
| VNEXT_PLANNED_NEW_RULE_COUNT | 36 |
| IMPLEMENTED_BEFORE_THIS_ROUND | 0 / 36 |
| PARTIAL_BEFORE_THIS_ROUND | 0 / 36 |
| MISSING_BEFORE_THIS_ROUND | 36 / 36 |
| IMPLEMENTED_THIS_ROUND | 11 |
| COMPLETED_PARTIAL_THIS_ROUND | 0 |
| DEFERRED_BY_SPEC_THIS_ROUND | 25 |
| FINAL_ENABLED_VNEXT_RULE_COUNT | 11 |
| FINAL_TOTAL_DOCUMENT_RULE_COUNT | 36（25 baseline + 11 enabled） |

审计结论：源码事实与规格 §1 的 25 条 / 7 类清单**一致**，36 条 VNext 规则在本轮之前**确实一条都未实现**（`grep` 全部 code 均无生产命中）。

---

## 1. 基础设施项（必须冻结，不得无理由重写）

```text
Requirement=统一 Diagnostics 基础设施（domain=document / runtime）
Status=IMPLEMENTED
Evidence=diagnostic-domain-v1.ts 定义 DiagnosticDomain；document-diagnostics-authority.ts 只发布 document；DIAGNOSTIC-DOMAIN-RUNTIME-REPORT 只写 runtime
ProductionFiles=src/document-utilities/diagnostic-domain-v1.ts, src/document-utilities/document-diagnostics-authority.ts
Tests=diagnostic-domain-separation-v1.test.ts (18)
RuntimeEvidence=runtime-sess-*.log DIAGNOSTIC-DOMAIN-RUNTIME-REPORT（Drawer 不含 runtime）
PlannedAction=冻结

Requirement=Document Drawer 只消费 document，顶部只有 全部/错误/警告/提示
Status=IMPLEMENTED
Evidence=Drawer filter = severity；10 个内部 area 只作为 metadata（本轮新增 DocumentDiagnosticArea），未生成 Tab
ProductionFiles=src/document-utilities/document-utility-overlay-host.ts, src/document-utilities/document-diagnostic-location.ts
Tests=document-diagnostics-vnext-gap-closure-v1.test.ts §9/§10/§11（area 完整性）
RuntimeEvidence=Drawer tab 数 = 3（全部/错误/警告）+ severity 内 hint 归入「提示」
PlannedAction=冻结；本轮禁止新增 category tab

Requirement=Error 红 / Warning 暖黄 / Hint 冷灰蓝 三档视觉分离
Status=IMPLEMENTED
Evidence=style.scss severity palette 未改动（本轮 style.css SHA 变化 = 无）
ProductionFiles=src/style.scss
Tests=document-hint-visual-semantics-chip-policy-v1.test.ts
RuntimeEvidence=captionCuePresent=false / severity palette 审计 PASS
PlannedAction=冻结（UNREQUESTED_SEVERITY_COLOR_CHANGE_COUNT=0）

Requirement=document-level reason-chip suppression（scope 驱动，非 severity 驱动、非单 code 特判）
Status=PARTIAL → 本轮补齐
Evidence=shouldRenderReasonChip 原本只读 metadata.scope / metadata.reasonChip；注册表尚未成为权威，且没有 code→scope 通道
ProductionFiles=src/document-utilities/document-heading-diagnostic-marker-v5-12.ts
Tests=document-diagnostics-vnext-gap-closure-v1.test.ts（registry scope 驱动 chip）
RuntimeEvidence=DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT reasonChip=false（document 规则）
PlannedAction=已补齐：shouldRenderReasonChip({code}) 读取注册表 scope（§11）

Requirement=first-click activation / stable identity 主链 / event-driven recompute
Status=IMPLEMENTED
Evidence=Active State Machine V2 + Universal Location；host 在文档变更事件上重算，无 setInterval 全文轮询
ProductionFiles=src/document-utilities/document-diagnostic-active-state-machine-v2.ts, document-diagnostic-location.ts
Tests=document-diagnostic-active-interaction-v514-r7.test.ts 等
RuntimeEvidence=DOCUMENT-DIAGNOSTIC-POST-SETTLE-CLOSURE-V2 clickSequence=1 phase IDLE→ACTIVE
PlannedAction=新规则复用同一条主链（本轮未新增定位器）
```

---

## 2. 现有 25 条业务规则

全部 `Status=IMPLEMENTED`，证据同源：`computeDocumentDiagnostics`（单一 producer）+ `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`（单一定位策略）+ Drawer。

```text
Requirement=DOCUMENT_INACTIVE / DOCUMENT_EMPTY / DOCUMENT_SOURCE_UNAVAILABLE
Status=IMPLEMENTED   ProductionFiles=document-diagnostics.ts L943-L1224
Tests=document-diagnostics.test.ts, document-diagnostic-empty-short-circuit-v512-r6.test.ts
RuntimeEvidence=空文档短路只发布 DOCUMENT_EMPTY   PlannedAction=无

Requirement=DOCUMENT_HEADING_ONLY_NO_BODY
Status=IMPLEMENTED   ProductionFiles=document-diagnostics.ts (headingCount===1 分支)
Tests=document-diagnostic-heading-only-hint-v1.test.ts (55)
RuntimeEvidence=Hint 冷灰蓝 + 无 reason chip   PlannedAction=重构为 单/多 互斥分支（本轮，§12）

Requirement=DOCUMENT_TERMINAL_NEWLINE_MISSING / DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE
Status=IMPLEMENTED   Tests=document-diagnostics-standard-eof-newline-7r3-11-8b8.test.ts   PlannedAction=无

Requirement=STRICT_SINGLE_H1_NO_H1 / STRICT_SINGLE_H1_MULTIPLE_H1 / STRICT_FIRST_H1_*
Status=IMPLEMENTED   Tests=document-diagnostics-conditional-strict-h1-7r3-11-8b9.test.ts
RuntimeEvidence=H2-only fixture: STRICT_SINGLE_H1_NO_H1=error   PlannedAction=无（scope=heading 已显式登记以保留既有 chip 契约）

Requirement=HEADING_LEVEL_GAP / HEADING_EMPTY_TEXT / HEADING_DUPLICATE_TEXT / HEADING_DUPLICATE_IDENTITY
Status=IMPLEMENTED   PlannedAction=无

Requirement=LATENT_ATX_HEADING_MARKER_LEVEL_n / LINK_LOCAL_TARGET_MISSING
Status=IMPLEMENTED   PlannedAction=无
```

---

## 3. VNext 新增 36 条

### 3.1 P0（15）

```text
Requirement=DOCUMENT_HEADINGS_ONLY_NO_BODY   (§12/§13)
Status=IMPLEMENTED_THIS_ROUND
Evidence=headingCount>=2 && 无实质正文 → hint；与单标题规则同用一个 bodyless 判定，if/else 结构性互斥
ProductionFiles=src/document-utilities/document-diagnostics.ts, src/document-utilities/document-diagnostic-location.ts
Tests=document-diagnostics-vnext-gap-closure-v1.test.ts（H1+H2 / H1+H2+H3 / +正文 / 单标题 / 0标题+H2-only 共存 / dedup）
RuntimeEvidence=Conditional-Strict-H2Only-Runtime-Test.md → 全部1 错误0 警告0 提示1
PlannedAction=已完成

Requirement=SECTION_EMPTY   (§16)
Status=IMPLEMENTED_THIS_ROUND
Evidence=heading→下一个同级/更高级 heading 之间无正文且无子标题 → hint（scope=heading, reasonChip=true）
ProductionFiles=src/document-utilities/document-diagnostics-vnext-authority.ts, document-diagnostics.ts
Tests=同上（SECTION_EMPTY 正/负/边界/无正文时不与文档级 hint 重复）
RuntimeEvidence=章节 fixture（详见 §5 Runtime Matrix）
PlannedAction=已完成

Requirement=SECTION_ONLY_SUBHEADINGS   (§17)
Status=IMPLEMENTED_THIS_ROUND
Evidence=存在 descendant headings 但整个 subtree 无正文；与 SECTION_EMPTY 按 heading 互斥
ProductionFiles=同上   Tests=同上（互斥门禁断言）   PlannedAction=已完成

Requirement=TABLE_BLOCK_STRUCTURE_INVALID   (§18)
Status=IMPLEMENTED_THIS_ROUND
Evidence=canonical source parser 证明表格 header/delimiter 行携带 list/blockquote 标记 → 非独立块；禁止 DOM 位置/正则猜测
ProductionFiles=document-diagnostics-vnext-authority.ts (analyzeTableBlocks)
Tests=同上（blockquote 内表格 error / 独立表格 0）
PlannedAction=已完成

Requirement=FORMULA_BLOCK_STRUCTURE_INVALID   (§19)
Status=IMPLEMENTED_THIS_ROUND
Evidence=只处理 `$$` display formula；行内 `$…$` 永不参与；携带容器标记 → 非独立块
ProductionFiles=同上 (analyzeDisplayFormulaBlocks)
Tests=同上（list-item 内 $$ error / 独立 $$ 0 / 行内 $…$ 0）
PlannedAction=已完成

Requirement=HEADING_MANUAL_NUMBER_PREFIX   (§24)
Status=IMPLEMENTED_THIS_ROUND
Evidence=严格前缀识别（`1.` / `1.1` / `1.1.2` / `一、` / `（一）`），仅在标题自动编号开启时运行；§24 负例全部不命中
ProductionFiles=同上 (detectManualNumberPrefix) + document-diagnostics.ts
Tests=同上（正例族 / 负例清单 / 未开启编号时 0）
PlannedAction=已完成（十进小数 `1.5` 的固有歧义已在源码注释与测试中显式记录）

Requirement=FIGURE_ORPHAN_CAPTION / TABLE_ORPHAN_CAPTION / CODE_ORPHAN_CAPTION   (§21)
Status=DEFERRED_BY_SPEC
Evidence=用户源文档中不存在「独立 caption 实体」：图名 = 图片 token 自身的 alt（`figure-alt-binding.ts` 明示 Markdown alt 是唯一权威），因此"有 caption 无 target"在源模型中不可表达；表/代码的 name 存于插件 sidecar（`caption-store.ts`，路径 `<vault>/.typora/inkchapter/captions/<doc>.json`），属 PLUGIN STATE，不是用户文档；运行时孤儿由 `CaptionService.orphanIds` 记录，属 runtime 域（§21 明确要求不得作为 document error）
ProductionFiles=(现状) src/heading-numbering/caption-service.ts, caption-store.ts, figure-alt-binding.ts
Tests=—   RuntimeEvidence=CAPTION-* 审计（runtime 域）
PlannedAction=DEFERRED：需先定义可在用户 Markdown 中表达的 caption 语法；在此之前任何实现都只能暴露插件状态（PLUGIN_CAPTION_RENDER_FAILURE_EXPOSED_AS_DOCUMENT_ERROR_COUNT 会被违反）

Requirement=FIGURE_MULTIPLE_CAPTIONS / TABLE_MULTIPLE_CAPTIONS / CODE_MULTIPLE_CAPTIONS   (§22)
Status=DEFERRED_BY_SPEC
Evidence=同 §21：一个 image token 只有一个 alt；表/代码 caption 由 `CaptionRegistry` 以 targetAnchor 一对一绑定（`caption-dom-adapter.ts` 的 captionOwnerRoots 隐含 1:1）。既有的重复检测是"重名"（FIGURE/TABLE/CODE_DUPLICATE_NAME），不是"多 caption 指向同一对象"
PlannedAction=DEFERRED：无用户源侧多 caption 权威

Requirement=FIGURE_CAPTION_FORMAT_INVALID / TABLE_CAPTION_FORMAT_INVALID / CODE_CAPTION_FORMAT_INVALID   (§23)
Status=DEFERRED_BY_SPEC
Evidence=项目未定义任何 caption 格式契约（无 HTML 注释 / YAML / 专有属性承载 caption）；图的"名称结构"= alt，已由 FIGURE_MISSING_NAME 覆盖；表/代码名称在插件 sidecar。§23 要求严格区分 document（用户源结构错误）与 runtime（插件生成呈现错误）
PlannedAction=DEFERRED：缺少"用户源 caption 格式"定义；不得把插件呈现失败误报为 document error

Requirement=LINK_LOCAL_ANCHOR_MISSING   (§25)
Status=DEFERRED_BY_SPEC
Evidence=全仓无 heading slug / anchor 生成器（`heading-dom-adapter.ts` 只读 Typora `id`）；正文 `#anchor` 在 `document-resource-scanner.ts` L129/L137 被直接归入 'other' 跳过。§25 明确禁止自行重复实现第二套 slug 算法
ProductionFiles=(现状) src/infrastructure/heading-dom-adapter.ts, src/document-utilities/document-resource-scanner.ts
PlannedAction=DEFERRED：需先建立 canonical heading-anchor authority（复用 Typora 实际锚点行为）
```

### 3.2 P1（14）

```text
Requirement=FIGURE_MANUAL_NUMBER_PREFIX   (§24)
Status=IMPLEMENTED_THIS_ROUND
Evidence=图名（Markdown alt，用户源）携带手工编号且图片自动编号开启 → warning；定位复用既有 figure-occurrence 定位器
ProductionFiles=src/document-utilities/document-diagnostics.ts
Tests=document-diagnostics-vnext-gap-closure-v1.test.ts（§24 族 + §24 负例）
PlannedAction=已完成

Requirement=TABLE_MANUAL_NUMBER_PREFIX / CODE_MANUAL_NUMBER_PREFIX   (§24)
Status=DEFERRED_BY_SPEC
Evidence=表/代码名称来自插件 sidecar（CAPTION_REGISTRY），不是用户文档内容（`document-diagnostics-authority.ts` nameSource=CAPTION_REGISTRY）；对其做"手工编号"检测等于检查插件状态，会误导用户
PlannedAction=DEFERRED：需先有用户源侧的表/代码名称权威

Requirement=FIGURE_NUMBER_DUPLICATE / TABLE_NUMBER_DUPLICATE / CODE_NUMBER_DUPLICATE   (§27)
Status=DEFERRED_BY_SPEC
Evidence=编号是"渲染时计算、从不持久化"（`caption-system.ts` L9；`CaptionNumberEntry.number` 为纯函数产物；sidecar 只存 title）。任何 number 冲突的根因都在插件计算 → runtime 域
ProductionFiles=(现状) src/heading-numbering/caption-semantic-bridge.ts, caption-service.ts
PlannedAction=DEFERRED：无用户源侧编号权威；如需，应在 runtime 域实现（§27 根因分域要求）

Requirement=FIGURE_NUMBER_ORDER_INVALID / TABLE_NUMBER_ORDER_INVALID / CODE_NUMBER_ORDER_INVALID   (§27)
Status=DEFERRED_BY_SPEC
Evidence=同上（无持久化 number，用户手工序号无结构化权威）
PlannedAction=DEFERRED

Requirement=FORMULA_NUMBER_ORDER_INVALID / FORMULA_NUMBER_SECTION_MISMATCH   (§27)
Status=DEFERRED_BY_SPEC
Evidence=`formula-semantic-planner.ts` 计算 ordinal/rawNumber/renderedNumber，不落盘；用户侧公式编号只在 Markdown 文本里（可由 §24 手工编号族覆盖），无法与插件分段权威比对
PlannedAction=DEFERRED

Requirement=LINK_LOCAL_FILE_ANCHOR_MISSING / HEADING_ANCHOR_COLLISION   (§25/§26)
Status=DEFERRED_BY_SPEC
Evidence=同 LINK_LOCAL_ANCHOR_MISSING：无 canonical anchor 权威。§26 明确要求基于 Typora 实际锚点行为，不能仅凭标题文字相同判冲突
PlannedAction=DEFERRED：待 anchor authority 建立后同轮启用
```

### 3.3 P2（7）

```text
Requirement=CODE_EMPTY_BLOCK   (§28)
Status=IMPLEMENTED_THIS_ROUND
Evidence=围栏块内无任何非空行 → hint（source-range 定位）  Tests=同上（空围栏 1 / 有内容 0）
PlannedAction=已完成

Requirement=TABLE_EMPTY_CONTENT   (§28)
Status=IMPLEMENTED_THIS_ROUND
Evidence=表头 + 分隔行、0 数据行 → hint   Tests=同上（仅表头 1 / 有数据行 0）   PlannedAction=已完成

Requirement=FORMULA_EMPTY_CONTENT   (§28)
Status=IMPLEMENTED_THIS_ROUND
Evidence=`$$` 显示公式体为空 → hint；不参与、不阻断 KNOWN_EMPTY 编号（EMPTY_FORMULA_NUMBERING_BLOCKED_COUNT=0 由构造保证）
Tests=同上（空 $$ 1 / 有内容 0 / 行内 $…$ 0）   PlannedAction=已完成

Requirement=BLOCKQUOTE_EMPTY   (§28)
Status=IMPLEMENTED_THIS_ROUND
Evidence=`>` 后无内容 → hint   Tests=同上（`>` 1 / `> 有内容` 0）   PlannedAction=已完成

Requirement=FIGURE_REFERENCE_TARGET_MISSING / TABLE_REFERENCE_TARGET_MISSING / FORMULA_REFERENCE_TARGET_MISSING   (§29)
Status=DEFERRED_BY_SPEC
Evidence=全仓无正文交叉引用解析器（无 `crossRef` / `parseReference` / 结构化引用目录；命中的 "reference" 全部是标题编号模板概念）。§29 明确：无稳定 canonical structured reference parser 时必须 DEFERRED_BY_SPEC，禁止对普通中文 prose 用全局 regex
ProductionFiles=(现状 无)   PlannedAction=DEFERRED：需先建立 structured reference catalog（对象清单已存在，引用解析器不存在）
```

---

## 4. Hard Gates 覆盖

| Gate | 值 | 依据 |
| --- | --- | --- |
| DOCUMENT_HEADINGS_ONLY_NO_BODY_MISSING_COUNT | 0 | 规则已启用并有正/负/边界/动态测试 |
| SINGLE_AND_MULTI_HEADING_ONLY_COEXIST_COUNT | 0 | 同一 bodyless 判定上的 if/else（结构性互斥）+ 测试遍历 1/2/3/6 标题 |
| DUPLICATE_SUBSTANTIVE_BODY_AUTHORITY_COUNT | 0 | 唯一 authority：`hasSubstantiveNonHeadingContent` + `analyzeDocumentCompleteness`（后者复用前者语义，无第二实现） |
| SECTION_EMPTY_AND_ONLY_SUBHEADINGS_DUPLICATE_COUNT | 0 | `hasDescendant ? ONLY_SUBHEADINGS : EMPTY` 三目 + 测试按 identity 计数 |
| DOCUMENT_SCOPE_REASON_CHIP_SPECIAL_CASE_COUNT | 0 | 生产路径无 `code === 'DOCUMENT_*'` 特判；chip 由 `shouldRenderReasonChip({code})` → 注册表 scope 决定 |
| PLUGIN_CAPTION_RENDER_FAILURE_EXPOSED_AS_DOCUMENT_ERROR_COUNT | 0 | 9 条 caption 规则全部 DEFERRED，未启用任何会把插件状态报为 document error 的规则 |
| PLUGIN_NUMBERING_FAILURE_EXPOSED_AS_DOCUMENT_ERROR_COUNT | 0 | 8 条编号完整性规则全部 DEFERRED |
| MANUAL_NUMBER_PREFIX_FALSE_POSITIVE_COUNT | 0 | §24 负例清单（2026 年计划 / 5G / 3D / R2 / ISO 9001 / 2026.10 发布 / 一对一 / 三分之一 / 第一章）全部不命中 |
| EMPTY_FORMULA_NUMBERING_BLOCKED_COUNT | 0 | FORMULA_EMPTY_CONTENT 只发布 hint，不进入 caption/formula 编号链路 |
| DOCUMENT_RULE_WITHOUT_DOMAIN_COUNT | 0 | `rule()` 构造器强制 domain='document'；测试遍历注册表 |
| DOCUMENT_RULE_WITHOUT_SCOPE_COUNT | 0 | `rule()` 强制 scope（area 默认 + 显式覆盖）；测试遍历注册表 |
| DOCUMENT_RULE_WITHOUT_PRESENTATION_METADATA_COUNT | 0 | `rule()` 强制 presentation{reasonChip,passiveVisual,activeVisual}；测试遍历注册表 |
| DOCUMENT_DIAGNOSTIC_DUPLICATE_ID_COUNT | 0 | `deduplicateDiagnostics(category+code+targetIdentity)` + 测试断言 id 唯一 |
| DOCUMENT_DIAGNOSTIC_CROSS_DOCUMENT_LEAK_COUNT | 0 | 诊断按 documentKey 归属（既有架构）；本轮规则全部 source-only |
| DOCUMENT_DIAGNOSTIC_STALE_AFTER_EDIT_COUNT | 0 | 事件驱动重算（既有主链）；本轮无定时器 |
| DOCUMENT_DIAGNOSTIC_FIRST_CLICK_NOT_ACTIVATED_COUNT | 0 | 复用既有 first-click 主链（§35 Runtime Matrix） |
| DOCUMENT_DIAGNOSTIC_LOCATOR_WRONG_TARGET_COUNT | 0 | 新规则沿用既有定位器（canonical-node / source-range / figure-occurrence） |
| UNREQUESTED_SEVERITY_COLOR_CHANGE_COUNT | 0 | style.scss 未改动 |
| UNREQUESTED_DRAWER_UI_CHANGE_COUNT | 0 | Drawer 结构/标签未改动 |
| UNRELATED_PRODUCTION_CHANGE_COUNT | 0 | 改动文件：document-diagnostics.ts / document-diagnostic-location.ts / document-diagnostics-vnext-authority.ts / document-heading-diagnostic-marker-v5-12.ts / latent-atx-heading-marker.ts（+1 纯导出）/ overlay-host.ts（2 处传参） |

---

## 5. DEFERRED 家族原因（汇总）

1. **Caption 家族（9 条）**：用户源文档里不存在独立的 caption 实体（图名=图片 alt；表/代码名=插件 sidecar）。实现它们只能读取插件状态，会直接违反 §23 的 `PLUGIN_CAPTION_RENDER_FAILURE_EXPOSED_AS_DOCUMENT_ERROR_COUNT=0`。
2. **编号完整性家族（8 条）**：编号是渲染时计算、不持久化；无用户源侧编号权威。§27 要求按根因分域——这类问题的根因在插件，应属 runtime 域。
3. **Anchor 家族（3 条）**：无 canonical heading-anchor authority；§25 禁止再造一套 slug；§26 要求基于 Typora 实际锚点行为。
4. **Cross-reference 家族（3 条）**：无 structured reference parser；§29 明确要求 DEFERRED_BY_SPEC，禁止对中文 prose 用全局 regex。

以上四类共 25 条；**未启用即无 emit**，因此不会产生误报，也不会把插件状态误报为文档错误。

## 6. Heading Auto-Number Conflict V1（本轮新增，priority=P0）

```text
code=HEADING_AUTO_NUMBER_CONFLICT
domain=document
category=heading-numbering（record category=heading / area=caption-numbering）
severity=error（两种模式下恒定，绝不下调）
scope=heading
status=IMPLEMENTED_THIS_ROUND
priority=P0
```

| Registry 字段 | 值 |
| --- | --- |
| sourceAuthority | canonical Markdown source heading text（`DiagnosticHeadingFact.text`，来自 CanonicalHeadingFrame；**永不**读 rendered textContent / visible label / generated numbering span） |
| numberingEffectiveAuthority | `isAutoNumberingEffectiveForHeading`（`src/heading-numbering/heading-auto-number-effective.ts`）——复用 `computeHeadingNumbering`（既有编号引擎）判定该 heading 是否会真的画出自动编号；覆盖全局开关 / strict-loose H1 / 每级 enabled / maxDepth / 零填充抑制 / 单标题 override |
| manualPrefixAuthority | `resolveHeadingManualNumberPrefix`（`src/document-utilities/document-diagnostics-heading-manual-number-prefix-v1.ts`）→ confirmed / ambiguous / none；**唯一**解析器，legacy `HEADING_MANUAL_NUMBER_PREFIX` 只是它的窄视图 |
| locationStrategy | canonical-node（scroll anchor = canonical heading block，绝不定位到手工编号子串 / 自动编号 span） |
| visualMode | VISIBLE_HEADING_LABEL（复用 Heading Visible Label Coverage authority：`一、1.1 小节` 整体 text-tight，reason chip 排除） |
| suppression | 同一 heading 已有 conflict 时抑制 generic `HEADING_MANUAL_NUMBER_PREFIX` warning |
| fixture | test/vault/runtime/smoke/Heading-Auto-Number-Conflict-Test.md |
| tests | src/document-utilities/document-diagnostics-heading-auto-number-conflict-v1.test.ts（33 条） |
| runtimeVerified | R1–R20 Runtime Matrix（见本轮 Final Report） |

关键 hard gates（§46）与正向覆盖（§47）由
`src/document-utilities/document-diagnostics-heading-auto-number-conflict-v1.ts`
统一持有：26 条 gate + 10 条 coverage，运行时经
`HEADING-AUTO-NUMBER-CONFLICT-AUDIT` / `HEADING-AUTO-NUMBER-CONFLICT-DYNAMIC-AUDIT`
证据驱动，无轮询。


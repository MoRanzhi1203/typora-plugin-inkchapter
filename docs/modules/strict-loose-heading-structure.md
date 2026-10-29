# Strict/Loose 标题结构模式

## 用户可见功能

插件支持两种标题结构模式：**严格模式（strict）** 和 **宽松模式（loose）**，用户在设置页或大纲工具栏切换。两种模式改变标题层级与编号样式的绑定关系。

## 模式定义

### 严格模式

- H1 = 文档题目，不参与编号
- H2 → S1, H3 → S2, H4 → S3, H5 → S4, H6 → S5
- H1 数量校验：要求恰好 1 个 H1

### 宽松模式

- H1 → S1, H2 → S2, H3 → S3, H4 → S4, H5 → S5
- H6 → S6（可选扩展样式槽）
- H1 正常参与编号

## Shared Style Slots（共享样式槽）

定义 5 个核心共享样式槽 S1-S5，strict 和 loose 共用同一套数据：

| Slot | Strict 绑定 | Loose 绑定 |
|------|------------|-----------|
| S1   | H2         | H1        |
| S2   | H3         | H2        |
| S3   | H4         | H3        |
| S4   | H5         | H4        |
| S5   | H6         | H5        |

每个样式槽包含完整标题级样式：编号格式、编号组合、前缀、后缀、起始值、上下级引用、number-title gap、标题对齐、首行缩进。

**关键原则**：模式切换只改变"物理标题层级 → 样式槽"的绑定关系，不复制数据。

## S6 扩展样式槽（仅宽松模式）

Loose H6 默认不生成墨章编号，保持 Typora/主题原始 H6 样式。

### S6 三状态

| 状态 | configured | enabled | 行为 |
|------|-----------|---------|------|
| 未配置 | false | — | H6 保持原始样式，不进入墨章体系 |
| 已配置 · 编号开启 | true | true | 使用 S6 编号 |
| 已配置 · 编号关闭 | true | false | 仅排版（对齐/缩进），不编号 |

### S6 UI 控制

- 未配置时：显示「启用 H6 自定义」按钮
- 已配置时：显示「恢复原始 H6」按钮
- 启用自定义后 H6 预览显示 S6 格式；未配置时显示"未自定义"

## P/S/R 三坐标系

命名系统区分三个坐标空间：

- **P (Physical)**: 物理标题层级 H1-H6
- **S (Style Slot)**: 共享样式槽 S1-S6
- **R (Reference)**: 格式引用中的参考层级编号

两个核心映射函数：

- `resolveStyleSlot(mode, physicalLevel)` — 正向：物理层级 → 样式槽
- `resolvePhysicalHeadingForStyleSlot(mode, slot)` — 反向：样式槽 → 物理层级

## Canonical Variant

统一使用 `withLevelOne` 作为唯一 canonical variant。`withoutLevelOne` 保留为 legacy 兼容，不再主动使用。所有引擎函数（`computeHeadingNumbering`、`getActiveFormatVariant` 等）统一以 `withLevelOne` 为主路径。

## 格式应用与结构模式解耦

- 格式应用（apply preset/format）不得改变当前 `headingStructureMode`
- `headingStructureMode` 独立于 `preset`/`customDefinition`
- Mode 存储于 `HeadingNumberingSettings.headingStructureMode`，随 scope（global/document）持久化

## Reference Slot 显示映射

格式编辑器中 reference（上级引用）的内部存储与 UI 显示遵循 P/S/R 模型：
- **存储**：`segment.level` 和 `ReferenceOption.value` 使用 Style Slot 索引
- **显示**：UI 通过 `resolvePhysicalHeadingForStyleSlot(mode, slot)` 将 S→P 转换为物理层级标签

### 各模式的 Reference 显示

**Strict**:
- S1→H2, S2→H3, S3→H4, S4→H5, S5→H6

**Loose**:
- S1→H1, S2→H2, S3→H3, S4→H4, S5→H5, S6→H6

### 禁止行为
- 不得为 UI 显示而修改存储的 slot 值
- 不得在 reference selector 选项生成时对存储值做 +1/-1 offset

## Legacy Canonical Migration（旧数据迁移规则）

### 旧 strict（已废弃 showLevelOneNumber=false）
迁移路径：
- old H2→S1, old H3→S2, old H4→S3, old H5→S4, old H6→S5
- S6.configured=false

### 旧 loose
迁移路径：
- old H1→S1, old H2→S2, ..., old H5→S5, old H6→S6
- 仅在能确认是用户真实配置时 `configured=true`

### 迁移约束
- 幂等：不因重复 render 或打开设置而反复迁移
- 不破坏：打开设置页不执行 destructive save
- `showLevelOneNumber` 仅作为 legacy 输入，不再作为运行时判断依据

## 设计约束

- strict H1 = 文档题目；不编号、不分配 slot
- 格式编辑器按物理层级显示标签：strict 下 H1 显示"文档题目"，H2-H6 正常显示
- Markdown 原文不写入专有结构标记
- `showLevelOneNumber` 仅作为 legacy compatibility 输入

## Effective Heading Settings / 渲染 authority（7R.3.11.8B.4.2，strict 渲染单一权威）

> 2026-09-07 吸收自历史提示词（8B.4.2，见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）；代码已提交（git `194b3fe`，覆盖 8B.4.2 + 8B.4.3 + 8B.4.3.1）；**真实 Typora Runtime 视觉/手动验收待执行**（含 8B.4.2 §46–57 的 Runtime matrix）。

- **单一 authority 链**：`SAVED_GLOBAL + SAVED_DOCUMENT_OVERRIDE → Heading Scope Store → resolveEffectiveSettings(documentKey) → Heading Structure Effective Authority → Control Surface Snapshot`；所有 Runtime 消费者（正文 renderer、Outline、Diagnostics、Caption/Formula semantic scope）必须围绕同一个 effective authority，禁止各模块自行推导一套 mapping。
- `resolveHeadingStructure()` 硬契约：STRICT → mode=strict / showLevelOneNumber=false / numberingRootPhysicalLevel=2 / requiresSingleH1=true；LOOSE → mode=loose / showLevelOneNumber=true / numberingRootPhysicalLevel=1 / requiresSingleH1=false。MODE-3 legacy fallback 仅在 `headingStructureMode` 缺失时按 `showLevelOneNumber` 反向派生一次（false→strict、true→loose）。
- **Shared Style Slot 映射硬契约**：
  - strict：H1→null、H2→S1、H3→S2、H4→S3、H5→S4、H6→S5（root physical = H2，第一层正文编号由 physical H2 产生）。
  - loose：H1→S1、H2→S2、H3→S3、H4→S4、H5→S5、H6→S6/native。
- **H1 不是「隐藏 S1」**：strict H1 应为 styleSlot=null / numberLabel=null；禁止用 CSS（如 `.strict h1::before{display:none}`）单独隐藏编号当作根修复（否则 H2 仍可能错误绑定 S2）。
- **strict 文档非法也不降级**：0 H1 / 2+ H1 / heading gap 时 Diagnostics 可以 ERROR，但 structure mode 仍为 strict；strict 下多 H1 全部不编号（正文所有 H1 墨章编号 = NONE）、禁止自动 fallback loose（`STRICT_INVALID_FALLBACK_LOOSE_COUNT=0`），也不能「第二个 H1 开始编号」。
- **legacy showLevelOneNumber 只是镜像**：strict → 派生 false、loose → 派生 true；显式 mode 一旦存在 legacy 不得覆盖；合法运行时禁止 strict+true / loose+false；preset/custom format（含携带 legacy showLevelOneNumber=true 的 custom）不得改变 mode。
- **模式切换 = 完整 numbering invalidation**：loose↔strict 一次 transition 必须同时失效 computed labels、counter snapshot、style-slot binding、DOM number projection、outline labels（loose→strict 不能只删 H1 attribute；strict→loose 不能保留 strict H2 label/cache）；document switch A(strict)→B(loose override)→A(strict) 不得 carry over label（`DOCUMENT_MODE_CARRYOVER_COUNT=0`）。
- 设置页作用域语义：当前文档页显示「当前文档 effective mode + source（globalDefault / documentOverride）」，全局默认页只显示 globalDefault mode；UI 不得在正文实际使用 document override 时只显示 global strict。
- 审计（state-transition / 低频）：`HEADING-STRUCTURE-EFFECTIVE-AUTHORITY`（decision=COHERENT / PERSISTED_RUNTIME_DIVERGED / EFFECTIVE_RESOLVER_DIVERGED）、`HEADING-NUMBERING-MAPPING-INVARIANT`（decision=PASS / STRICT_H1_NUMBER_VISIBLE / STRICT_SLOT_SHIFT_WRONG / LOOSE_SLOT_SHIFT_WRONG，strict PASS = H1 null 且 visibleH1NumberCount=0）、`HEADING-MODE-TRANSITION-CLEANUP`（from/toMode、removedStaleNumberCount、recomputedLabelCount、visibleH1NumberCountAfter）、`SETTINGS-RUNTIME-PERSISTENCE-PARITY`（decision=MATCH / PERSISTED_RUNTIME_DIVERGED）。
- **先决纪律（8B.4.2 Branch A）**：此前 Runtime 曾「直接改 persisted JSON 切 strict→loose、测完把文件改回 strict 但运行中的 Typora 仍保留 loose in-memory state」，制造出「设置页 strict、正文 loose」的假象。因此任何严格态验证前必须先做**干净重启**（或走正式 settings API apply），确认 `persisted == live scope store == effective == resolved` 之后再下结论；禁止在 live 状态下直接改回 settings 文件后结束测试。
- 相关源码（以真实代码为准）：`heading-structure.ts`（`resolveHeadingStructure` / `resolveHeadingStructureMode`，strict numberingRootPhysicalLevel=2）、`heading-structure-audit.ts`（`emitHeadingStructureEffectiveAuthority` 等审计发射）、`heading-numbering-service.ts`（`effectiveModeRevision`、`HEADING-STRUCTURE-MODE-WRITE` 等）、`heading-numbering-setting-tab.ts`（设置页作用域）。聚焦测试：`src/heading-numbering/heading-structure-7r3-11-8b42.test.ts`（MODE-1/2/3、MAP-STRICT/LOOSE、LABEL-S1/S2/S3、TRANS-MODE-1/2/3、SCOPE-1~4 等）。

## 结构模式控制面同步（7R.3.11.8B.7）

> 2026-09-07 吸收自历史提示词（8B.7，见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）；代码已提交（git `1f556f5`，8B.7 + 8B.7.1）；**真实 Runtime 视觉/手动验收待执行**。

- **问题**：大纲右上角 `...` 菜单、设置→标题编号→当前文档、设置→全局默认、document override、effective/resolved、headingDraft、legacy showLevelOneNumber 多入口此前可状态分裂（曾出现大纲菜单显示「切换为严格模式」而设置页「当前文档」仍高亮 strict → `CONTROL_SURFACE_STATE_SPLIT=true`）。8B.7 收口目标：ONE SAVED SCOPE MODEL + ONE EFFECTIVE RESOLVER + ONE WRITE AUTHORITY + MULTIPLE READ-ONLY CONTROL SURFACES + ONE EXPLICIT DRAFT LIFECYCLE。
- **四层状态必须区分**：`SAVED_GLOBAL` / `SAVED_DOCUMENT_OVERRIDE` / `EFFECTIVE·RESOLVED` / `SETTINGS_DRAFT`；禁止用一个模糊的 `mode` 同时表达四种状态。
- **Global scope**：`globalDefault.headingStructureMode` 合法值 strict / loose（global 本身无 inherit）；历史 persisted 缺字段 → migration/default=strict（日志标注 `source=DEFAULT_FALLBACK`）。
- **Current Document scope 三态**：INHERIT / STRICT / LOOSE（UI：`[继承全局默认] [严格模式] [宽松模式]`）；documentOverride absent → INHERIT。**禁止**把「继承全局 strict」和「文档 override strict」显示成无法区分的同一状态；设置页须展示「来源：继承全局默认 / 当前文档覆盖 + 当前有效：…」。
- **Outline Menu**：只按 `effectiveMode` 读取（strict→「切换为宽松模式」、loose→「切换为严格模式」），禁止按 global/draft/legacy/last-click cache 决定文案；写**当前文档 document scope**（例：global=strict、doc=inherit、effective=strict，点「切换为宽松」→ global 仍 strict、doc override=loose、effective=loose），**禁止写 global**。
- **Single Write Authority**：`setHeadingStructureMode({ scope, documentKey, mode, source })`（scope=global|document；document mode=inherit|strict|loose；source=OUTLINE_MENU / SETTINGS_CURRENT_DOCUMENT / SETTINGS_GLOBAL_DEFAULT / COMMAND / MIGRATION / RUNTIME_TEST）；UI 禁止直接 mutate store internals。一次 mode write = 一次完整业务 transaction：write saved scope → persist → 更新 legacy mirror → invalidate effective cache → recompute effective → **发布一次** effective transition → heading refresh → outline refresh → diagnostics refresh → caption reconcile → formula reconcile（如依赖）→ settings surface notification；idempotent（loose→set loose=NO_OP）；**一次用户操作 = 一次 business transaction**（禁止一次点击触发两次 mode transition / 两次 heading snapshot）。
- 恢复继承：设置页 Current Document 必须能清除 document override（→inherit global）；Current Document「取消更改」恢复 saved document scope（不能直接恢复 effective 而丢失 inherit/override 区别）。
- Global 变更只影响继承文档，**不得覆盖 document override**（`GLOBAL_CHANGE_DOES_NOT_OVERWRITE_DOCUMENT_OVERRIDE`；例：A=inherit/B=override strict/C=override loose，global strict→loose → A effective loose、B effective strict、C effective loose）。
- **preset / custom /「在文档中显示标题编号」开关均不得改变 structure mode**（hide numbering 时 strict 仍 strict、loose 仍 loose）。
- 审计：`HEADING-STRUCTURE-CONTROL-SNAPSHOT`（savedGlobal / documentOverridePresent / savedDocument / documentScopeState / effective / resolved / legacy / outlineMenuObservedMode / settings 各字段）、`HEADING-STRUCTURE-CONTROL-SURFACE-INVARIANT`（CLEAN：outlineMenu == settingsEffective == effective == resolved == headingRenderer == outlineRenderer == diagnosticsMode；DIRTY 仅允许 settingsDraftMode≠effective 且 UI 明示未保存 → decision=PASS_DRAFT_DIRTY）、`HEADING-STRUCTURE-MODE-WRITE`（before/afterGlobal、before/afterOverride、before/afterEffective、legacyBefore/After、persist/publish decision）。
- 相关源码：`heading-structure-control-sync.ts`（`resolveEffectiveHeadingMode` / `resolveDocumentScopeState` / `deriveLegacyShowLevelOneNumber` / `planHeadingStructureModeWrite` / draft model）、`heading-numbering-service.ts`、`outline-numbering-controller.ts`、`heading-numbering-setting-tab.ts`。聚焦测试：`src/heading-numbering/heading-structure-control-synchronization-7r3-11-8b7.test.ts`（S1–S27；CASE A–D 作用域矩阵）。

## Draft 生命周期（7R.3.11.8B.7）

> 与上节同属 8B.7 收口；设置草稿与 saved state 可分叉（控制台 `[InkChapter DirtyBreakdown] hasAnyDirty=true sources:['headingDraft=draft differs from saved']`）在用户未保存时是正常状态；8B.7 补齐的是**外部模式变化 → Draft 的 rebase / conflict 规则**。

- headingDraft 绑定 `scopeView + documentKey + baseSavedFingerprint + draftFingerprint`；状态机 **CLEAN / DIRTY / CONFLICTED**。
- **CLEAN**：draft == 当前 saved scope；外部 authority 改变 → 自动 rebase 到新的 saved state 并 rerender Settings（无需关闭/重开设置页）。
- **DIRTY**：用户改设置未保存（draft≠saved）；`headingDraft=draft differs from saved` 属合理状态；禁止为清 dirty 而自动保存 / 静默覆盖 draft。
- **外部变化 + CLEAN** → auto-rebase（saved=loose、draft=loose、draftState=CLEAN、Settings UI 立即显示 loose）。
- **外部变化 + DIRTY 但结果相同**（saved 被外部写成与 draft 相同的值）→ draftState=CLEAN。
- **外部变化 + 真冲突**（draft 含未保存设置、base saved 已改变、draft≠new saved）→ draftState=CONFLICTED；禁止 silent overwrite / silent stale；设置页至少明示「当前标题设置已被其它入口更新；你的未保存修改仍保留」。
- Conflict 操作语义：**取消更改** = 放弃旧 draft、rebase 到最新 saved；**保存并应用** = 用户明确让 draft 覆盖当前 saved；结束后 CLEAN。
- Settings 订阅 authority：打开 subscribe（收到变化按 CLEAN→REBASE / DIRTY+same→CLEAN / DIRTY+conflict→CONFLICTED 处理），关闭 unsubscribe；**`LISTENER_LEAK_COUNT=0`**。
- Settings reopen 必须重读 active document / saved global / document override / effective / resolved，禁止把上次窗口残留 headingDraft 当新文档初始化。
- **Document switch**：A 的 draft 不得应用到 B（`DRAFT_CROSS_DOCUMENT_CARRYOVER=0`）；A 若 DIRTY 需明确 scope boundary，不能静默复用同一 draft 对象。
- **Current Document ↔ Global Default draft 隔离**：切换页签不得把 Current loose draft 显示到 Global（`CURRENT_DRAFT_GLOBAL_DRAFT_CROSSOVER=0`）。
- 保存并应用：Current：inherit→clear override、strict→override strict、loose→override loose；Global：strict/loose→write global；成功后 draftState=CLEAN。
- 审计：`HEADING-STRUCTURE-DRAFT-LIFECYCLE`（只记录 CLEAN→DIRTY→CLEAN、DIRTY→CONFLICTED→CLEAN 转移）。
- 聚焦测试：`heading-structure-control-synchronization-7r3-11-8b7.test.ts`（S8–S16：DIRTY+external same / conflict / cancel / save / cross-document / cross-scope 等）。

## Diagnostics 快照模式依赖（7R.3.11.8B.7.1）

> 2026-09-07 吸收自历史提示词（8B.7.1，见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）；代码已提交（git `1f556f5`）；**真实 Runtime 视觉/手动验收待执行**。Diagnostics 规则集/severity policy 等后果性细节见 `modules/document-utilities.md` §3，本文件只记模式依赖契约，不重复展开。

- **Runtime 新失败**：8B.7 已证明 strict→loose 后 mode write / heading renderer / outline renderer / strict validator 输入全部同步（effective=loose、resolved=loose、outlineMenuObservedMode=loose、headingRendererMode=loose、outlineRendererMode=loose、diagnosticsMode=loose），但 Document Diagnostics UI 仍保留切换前的旧快照（revision=11、error=4、warning=9、hint=0）→ Toolbar/Drawer stale；根因族 `DIAGNOSTIC_SNAPSHOT_NOT_REPUBLISHED_ON_EFFECTIVE_MODE_CHANGE`。旧的 `diagnosticsMode` 只能证明「diagnostics 应该用什么 mode」，不能证明「已发布 snapshot 实际由什么 mode 生成」→ 旧 CONTROL-SURFACE-INVARIANT 属 false PASS。
- **契约**：`effectiveMode` + `effectiveModeRevision` 正式纳入 Diagnostic Snapshot 的 dependency / revision / fingerprint / publish authority / Toolbar & Drawer subscription；快照携带 mode provenance（documentKey、diagnosticRevision、sourceDocumentRevision、effectiveMode、effectiveModeRevision、severity policy revision/指纹、errorCount/warningCount/hintCount、records）。
- **硬性等式**：`LATEST_EFFECTIVE_MODE == PUBLISHED_DIAGNOSTIC_SNAPSHOT_MODE` 且 `diagnosticSnapshotEffectiveModeRevision == latest effectiveModeRevision`；否则 `decision=FAIL_STALE_DIAGNOSTIC_SNAPSHOT`（不得再 PASS）。
- 核心语义：**CONTENT UNCHANGED + MODE CHANGED = 语义变化 = 需重建发布**。Dedup 仍需保留但必须包含 mode 维度：同文档同内容同 mode 同 policy 同结果 → suppress；同文档同内容不同 effective mode → MUST recompute/publish。idempotent mode write（loose→loose）不 rebuild（`IDEMPOTENT_MODE_DIAGNOSTIC_REBUILD_COUNT=0`）；dirty draft 未保存不 rebuild（`DIRTY_DRAFT_DIAGNOSTIC_REBUILD_COUNT=0`）；override shield 时 global 变更不 rebuild（`GLOBAL_CHANGE_WITH_SHIELDED_OVERRIDE_DIAGNOSTIC_REBUILD=0`）。
- 事件驱动单一链：`HEADING_STRUCTURE_EFFECTIVE_CHANGED`（带 documentKey/before/after/effectiveModeRevision/source）→ mark semantic input dirty → schedule 一次 bounded recompute → capture authority（documentKey/documentRevision/canonicalRevision/effectiveMode/effectiveModeRevision）→ 用新 mode 计算 → 复查 authority → publish immutable snapshot → Toolbar+Drawer 更新。禁止 polling / setInterval / 固定 delay refresh；一次 mode transaction 合并为一次最终 publish（`ONE_MODE_TRANSACTION_MAX_DIAGNOSTIC_PUBLISH_COUNT=1`）；stale 结果丢弃（`STALE_DOCUMENT_DIAGNOSTIC_PUBLISH_COUNT=0`）；rapid strict/loose toggle latest wins；不得过早发布「new mode + old canonical」假快照。
- **Toolbar / Drawer 只订阅 published snapshot**：Toolbar 不得自己跑 validator；Drawer 打开后不得持有 open-time 副本，新快照原位替换列表；Drawer 打开时切 mode 应自动 4/9/0→0/6/6→4/9/0，禁止依赖「重新检查 / 关闭再打开 / 切换文档 / 重启」。
- mode republish 后每条记录保留 location（`LOCATABLE_DIAGNOSTIC_COUNT == DIAGNOSTIC_COUNT` 在 strict/loose 快照中都成立）；消失的 strict-only 记录其 Locate item 同步消失。Manual「重新检查」保留但语义只是 force recompute（reason=MANUAL_RECHECK），不是 mode sync 必要步骤（`MANUAL_RECHECK_REQUIRED_FOR_MODE_SYNC=false`）。
- 计数预期（fixture：`test/vault/runtime/smoke/Document-Diagnostics-ATX-Marker-Test.md`；以真实 rule snapshot 为准）：strict 4/9/0 ↔ loose 0/6/6 ↔ strict 4/9/0（STRICT_SINGLE_H1 类 strict-only ERROR→absent；HEADING_LEVEL_GAP strict ERROR→loose WARNING；LATENT_ATX_HEADING_MARKER strict WARNING→loose HINT）。
- 相关源码：`heading-numbering-service.ts`（`effectiveModeRevision`、Control-Surface-Invariant 中 diagnosticSnapshotMode / diagnosticSnapshotEffectiveModeRevision / fingerprint 字段、snapshot provenance）、`src/document-utilities/diagnostics-types.ts`（snapshot 含 effectiveMode/effectiveModeRevision）、`document-diagnostics-authority.ts` / `document-diagnostics.ts`（recompute/publish）。聚焦测试：`src/document-utilities/document-diagnostic-mode-sync-7r3-11-8b7-1.test.ts`（M1–M20）。

## Strict 政策激活权威模型（policy activation，7R.3.11.8B.8~8B.11 主题之一）

> 2026-09-07 吸收自 `ZCODE-DEEPSEEKV4-CONDITIONAL-STRICT-H1-POLICY-CLOSURE.md`、`ZCODE-DEEPSEEKV4-HEADING-POLICY-ACTIVATION-AUTHORITY-CLOSURE.md`、`ZCODE-DEEPSEEKV4-PLAIN-BODY-ONLY-STRICT-HEADING-EXCEPTION-CLOSURE.md`。
> 阶段映射（以 git log 为准）：8B.9 = 条件式 Strict H1 政策、8B.10 = Heading Policy Activation Authority、8B.11 = 纯正文唯一豁免（同批 8B.8 = 标准 EOF 新行策略，EOF 提示词收口、不在本文件展开）；代码已提交 git `4729e0f`（8B.8+8B.9+8B.10）、`212481d`（8B.11）。策略语义放本文件，诊断后果见 `modules/document-utilities.md` §3 与对应 focused test；**真实 Runtime 视觉/手动验收待执行**。

- **核心原则：`storedMode = strict` ≠ `strictPolicyActive = true`**。用户没有显式启用/配置全局标题策略时，普通 Markdown（README、临时笔记、纯正文）不得被当作 strict 强制约束——曾真实产生「文档必须以一级标题开始，H1 前存在正文内容」「严格模式要求全文必须且只能包含一个一级标题（H1），当前未检测到 H1」两条错误诊断。
- **EffectiveHeadingPolicy 分层**：`stored → global config → feature activation → scope activation → effective（for current document）`；activationSource = none | global-explicit | document-explicit | inherited。禁止把「settings 对象存在 / mode!==undefined / mode!==null / typeof settings.heading==='object'」当作已配置（默认设置初始化后这些恒真）；configured/active 必须来自真实 feature toggle、scope activation、explicit setting、document override、enabled flag。
- **三段门**：strict-only 规则进入条件 ≈ `headingFeatureEnabled && headingPolicyConfigured && mode==='strict'`（shouldEnforceStrictHeadingPolicy）；未启用/未配置 → `STRICT_SINGLE_H1 / STRICT_FIRST_H1 / PRE_H1_BODY / STRICT_ZERO_H1` 全部 SKIP（reason=STRICT_POLICY_INACTIVE）。诊断规则必须统一走同一 authority gate，禁止各 rule 自己从 settings 重读 mode。
- 激活后 strict-only 规则（STRICT_H1_MISSING / STRICT_SINGLE_H1 / STRICT_MULTIPLE_H1 / STRICT_FIRST_H1 / PRE_H1_BODY）进入；loose / custom 隔离（custom 按自身 contract，禁止 custom/unconfigured → fallback strict）。
- **内容级唯一豁免 plainBodyOnly（8B.11 最终语义）**：`plainBodyOnly = headingCount === 0 && hasMeaningfulBodyContent === true`（全文只有实质正文、完全不存在 H1–H6 任意一级）。只有 plainBodyOnly 才允许跳过「必须存在 H1 / 必须由 H1 起始」这组 strict 标题结构要求。
- **出现任何 heading 立即恢复 strict 契约**：判断依据是 `headingCount > 0`（H1~H6 任一级都算，不能只看 h1Count）；一旦有标题 → plainBodyOnly=false → 恢复既有 strict 规范（正文后出现单个 H1 → 报 H1 前正文/首位置结构；两个 H1 → 报 MULTIPLE_H1/SINGLE_H1；首个标题是 H2/H3 → 报缺 H1/首级错误；删除全部标题回到纯正文 → 错误自动全部消失）。
- 上一轮「effectivePolicyActive=false → strictDiagnosticsActive=false → 全部 SKIP」的过度豁免 gate 已撤销/收缩（8B.11）：**「全文只有正文且 0 headings」是唯一无 H1 豁免；「出现任何 heading」== 恢复既有 strict 标题规范**。hasMeaningfulBodyContent 须用真实文档内容语义（普通段落算 meaningful；HTML 注释/纯空白/plugin metadata/hidden marker/caption decoration 不算）；空文档（headingCount=0 且无实质正文）不属于 plainBodyOnly 豁免，保持既有行为。
- **Generic heading structural diagnostics 独立于 strict policy**：即使未启用全局策略，只要文档实际存在标题，仍可检查 H1→H3 跳级等纯结构问题；禁止 `if (!policyActive) return []` / `if (headingCount===0) return` 之类把全部 heading diagnostics 一并关掉。
- 审计（document-utilities 侧）：`HEADING-POLICY-DIAGNOSTIC-AUDIT`（8B.9：headingFeatureEnabled / headingPolicyConfigured / headingMode / strictPolicyActive / h1Count / diagnosticCode / decision=EMIT|SKIP / reason）、`HEADING-POLICY-AUTHORITY-AUDIT`（8B.10：storedMode → featureEnabled / globalScopeEnabled / documentScopeEnabled / activationSource → effectivePolicyActive / effectiveMode / effectiveStrictRequire → strictDiagnosticsActive 链）、STRICT-HEADING-SHAPE-AUDIT / strictRuleSetDecision（8B.11：headingCount / h1Count~h6Count / hasMeaningfulBodyContent / plainBodyOnly / firstHeadingLevel / hasBodyBeforeFirstH1，decision=PLAIN_BODY_EXCEPTION | ENFORCE）。
- 相关源码（以真实代码为准）：`src/document-utilities/document-diagnostics-authority.ts`（`plainBodyOnly = headingCount === 0 && hasMeaningfulBodyContent`、HEADING-POLICY-AUTHORITY-AUDIT）、`src/document-utilities/document-diagnostics.ts`（strictHeadingRulesActive = strictMode && !plainBodyOnly）、`document-utilities-context.ts`。聚焦测试（以实际为准）：`src/document-utilities/document-diagnostics-conditional-strict-h1-7r3-11-8b9.test.ts`、`src/heading-numbering/heading-policy-activation-7r3-11-8b10.test.ts`、`src/document-utilities/document-h1-authority-bridge.test.ts`（含 B11 plain-body-only 断言）；`src/document-utilities/document-diagnostics-standard-eof-newline-7r3-11-8b8.test.ts` 属 8B.8 EOF 收口。

## 相关代码

- `src/heading-numbering/heading-structure.ts` — 结构解析 (`resolveHeadingStructure`)、槽位映射 (`resolveStyleSlot`/`resolvePhysicalHeadingForStyleSlot`)
- `src/heading-numbering/numbering-engine.ts` — 编号引擎（canonical variant、S6 check、buildStrictEffectiveLevels）
- `src/heading-numbering/heading-types.ts` — `HeadingStructureMode`、`s6Configured`
- `src/heading-numbering/heading-numbering-scope-store.ts` — deepMergeSettings 含 `s6Configured` 传播
- `src/settings/heading-numbering-setting-tab.ts` — UI 渲染（S6 控制按钮、物理层级标签、当前文档/全局默认作用域）
- `src/heading-numbering/outline-toolbar-controller.ts` — 工具栏模式切换
- `src/heading-numbering/heading-structure-control-sync.ts` — 控制面同步（`resolveEffectiveHeadingMode` / `resolveDocumentScopeState` / `deriveLegacyShowLevelOneNumber` / `planHeadingStructureModeWrite`、draft 模型与 CLEAN/DIRTY/CONFLICTED 判定）
- `src/heading-numbering/heading-structure-audit.ts` — `HEADING-STRUCTURE-EFFECTIVE-AUTHORITY` / `HEADING-NUMBERING-MAPPING-INVARIANT` / `HEADING-MODE-TRANSITION-CLEANUP` 审计发射、persisted mode 读取
- `src/heading-numbering/heading-numbering-service.ts` — `effectiveModeRevision`、`HEADING-STRUCTURE-MODE-WRITE`、`HEADING-STRUCTURE-CONTROL-SNAPSHOT` / `-CONTROL-SURFACE-INVARIANT`（含 diagnosticSnapshot mode provenance，8B.7.1）
- `src/heading-numbering/document-numbering-coordinator.ts` — `DocumentNumberingCoordinator`（文档级编号协调入口）
- `src/heading-numbering/outline-numbering-controller.ts` — 大纲同步（消费正文 computed labels；8B.4.3 OUTLINE-* 审计 / OUTLINE-STRICT-VERIFY，详见 `outline-numbering.md`）

## 当前状态

已实现但未验收

（2026-09-07 更新：7R.3.11.8B.4.2 / 8B.4.3 / 8B.7 / 8B.7.1 / 8B.8~8B.11 相关代码已提交——git `0fd5de4`（8B.4+8B.4.1）、`194b3fe`（8B.4.2+8B.4.3+8B.4.3.1）、`1f556f5`（8B.7+8B.7.1）、`4729e0f`（8B.8+8B.9+8B.10）、`212481d`（8B.11）；对应 focused 测试已入库；真实 Typora GUI Runtime 视觉/手动验收仍在收尾，见上方各阶段小节。）

## 已知问题

- GUI Runtime 验证证据不足（严格/宽松切换后编号保持性、往返不漂移）
- 真实 Typora GUI Runtime 视觉/手动验收仍在收尾：8B.4.2 strict 渲染单一权威、8B.7 控制面同步与 Draft 生命周期、8B.7.1 诊断快照模式同步、8B.8~8B.11 policy 激活与纯正文豁免的 Runtime 验收均待执行
## 2026-08-19 Cleanup 吸收

- `trae-strict-first-h1-runtime-wiring-v2.md`
- `trae-strict-first-h1-topline-v3.md`
- `trae-strict-first-h1-validation.md`

这组 prompt 的结论已收束为 strict H1 题目语义、shared slots、S6 三状态与模式切换约束。

## 2026-09-07 Cleanup 吸收

- 8B.4.2 strict effective heading numbering authority（git `194b3fe`）
- 8B.4.3 / 8B.4.3.1 outline duplicate identity mapping closure（git `194b3fe`，大纲侧收口详见 `outline-numbering.md`）
- 8B.7 heading structure control surface sync（git `1f556f5`）
- 8B.7.1 diagnostic snapshot mode sync closure（git `1f556f5`）
- 上述提示词文件均已删除，逐条明细见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)
- `ZCODE-DEEPSEEKV4-CONDITIONAL-STRICT-H1-POLICY-CLOSURE.md`（8B.9）、`ZCODE-DEEPSEEKV4-HEADING-POLICY-ACTIVATION-AUTHORITY-CLOSURE.md`（8B.10）、`ZCODE-DEEPSEEKV4-PLAIN-BODY-ONLY-STRICT-HEADING-EXCEPTION-CLOSURE.md`（8B.11；同批 8B.8 = 标准 EOF 新行策略），git `4729e0f` / `212481d`

这组 prompt 的结论已收束为：strict/loose 单一 effective 渲染 authority 与 slot 映射硬契约；控制面多入口同步 + Single Write Authority + 一次用户操作一次业务 transaction；headingDraft CLEAN/DIRTY/CONFLICTED 生命周期与跨文档/跨作用域隔离；Diagnostic Snapshot 纳入 effectiveMode/effectiveModeRevision 模式依赖与 stale 契约；`storedMode≠strictPolicyActive` 的分层激活模型与「纯正文无标题（plainBodyOnly）唯一豁免、出现任何 heading 立即恢复 strict 契约」的内容级判定。真实 Typora Runtime 视觉/手动验收待执行。

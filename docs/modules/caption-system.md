# Caption System / 图表题注

> 本页整合 Phase 1–6（提示词 01–12）与 Phase 7R.3.10 对象标题排版（提示词 35）的耐久结论。对象编号（Figure/Table/Code/Formula）的权威来源是 **Heading 语义快照**，而非渲染 DOM 编号。

## 用户可见功能

用户可为 table、figure、code 三类对象设置题注。题注支持设置、编辑、删除，且每一类对象拥有独立编号序列和独立位置规则。

默认表现：
- table 题注在对象上方
- figure 题注在对象下方
- code 题注在对象上方

## 状态模型

题注核心由纯数据层承载：

- `CaptionRegistry` 负责增删改查、重绑定、rehydrate、清理
- `CaptionRecord` 保存文档级题注记录
- `CaptionTargetAnchor` 保存目标对象的稳定锚点

题注记录只保存用户输入的标题与稳定锚点，不把显示编号写死进 record。

## 编号语义规则

- 主链固定：**标题语义 → 编号作用域 → 对象独立序号 → 格式化**。
- 严格模式语义：H1=DocumentTitle、H2=Chapter、H3=Section、H4=Subsection、H5/H6=Item；**STRICT: H1 ≠ Chapter**。
- 宽松模式：标准结构 H1=Chapter/H2=Section/H3=Subsection，强调相对有效层级，允许缺级压缩（H1→H3 可解释为 Chapter→Section）；strict 绝不压缩、不把 H4 冒充 H3。
- `{chapter}`/`{section}` 是语义变量；`{n}` 是 effective scope 内对象顺序序号；禁止以物理 H 层级或已渲染标题文本（"一、"、"1.1"）反解析。
- strict/loose **都允许 scope 降级**（SECTION→CHAPTER→GLOBAL、CHAPTER→GLOBAL）；两者真正区别是"如何解释标题结构"，不是"是否降级"。
- 四类对象（figure/table/formula/code）独立计数；scope key 包含 objectKind。
- 对象名称绑定 stableIdentity，编号是动态投影（currentCalculatedNumber）。

## 语义权威模型

- 双权威划分：**物理标题编号权威**（H1Counter…，服务标题显示）与**规范语义标题权威**（DocumentTitle/Chapter/Section/Subsection/Item，对象编号唯一来源）；Caption 不得自造语义 ordinal。
- 语义序号按 **semantic effective depth**（非物理 H 层级）；loose 异质根/同章异质 Section 层级可确定编号。
- 规范状态结构：`SemanticHeadingNumberState`（stableIdentity/physicalLevel/effectiveDepth/semanticRole/ordinalByDepth/logicalOrdinal/chapterOrdinal/sectionOrdinal/sourceRevision）。
- **ordinalByDepth 规范表示**：`readonly (number|null)[]`（index 0=Chapter、1=Section…），禁止移除 null 槽位（`[null,1] != [1]`）；chapterOrdinal/sectionOrdinal 是便捷投影不是第二权威。
- 结构身份独立于计数：Skipped Chapter 下 Section 的 structuralChapterIdentity 仍指向该 skipped chapter，但 chapterOrdinal=null。
- loose 有效深度算法（路径局部压缩）：扫描文档顺序，弹出物理级别 ≥ L 的栈顶，`effectiveDepth = 父级 effectiveDepth + 1`；混合结构分支局部解析。

## 实时刷新与 Reconcile

- 编号永远是当前文档结构的动态投影（`Number = Projection(CurrentDocumentState)`）；ordinal = 1 + 当前对象之前同 objectKind 同 effectiveScopeKey 的对象数量（非 lastNumber+1）。
- 统一 `DocumentNumberingRevision`：同一轮文档状态四类对象必须基于同一 revision；统一协调器链，禁止四类 service 各自解析标题。
- 刷新策略：事件驱动 + **全量逻辑重算 + desired-state diff + 差量 DOM/MathJax 投影**；局部优化必须与 full recompute oracle 一致。
- 禁周期轮询；允许 microtask/rAF 合并连续 mutation 为一次 reconcile。
- Mutation Guard：projectionMutationGuard/selfMutationToken 识别插件自身投影防循环，但不能粗暴忽略用户真实编辑。

## 快照与计数策略

- 一个 heading revision 产出两个规范状态（physical + semantic），合并为 `HeadingNumberingSnapshot{revision, headings, physical, semantic}`；快照不可变，revision 由权威内部分配并原子发布。
- 策略分类（SHARED_WITH_PHYSICAL / SEMANTIC_ONLY / PHYSICAL_ONLY / UNDEFINED）：
  - `startAt`：strict 语义 depth n ← 物理 H(n+1) 的 startAt。
  - `restartAfterLevel = PHYSICAL_ONLY`：语义层级恒分层重置，不改变对象语义归属。
  - `maxDepth = PHYSICAL_DISPLAY_ONLY`：关闭深层可见编号不得把对象移入其他语义 Chapter/Section。
- 结构路径与计数路径分离：unnumbered+skip 保留语义结构角色但不消耗 ordinal，后代仍结构归属；unnumbered+consume 消耗 ordinal 且后代继承；skip 下 SECTION 请求 → 确定性降级到 CHAPTER。
- strict H1 = document-title、semanticPath=[]、counted=false，永不消耗 Chapter ordinal。

## 快照生命周期与文档隔离

- 语义标题快照 ≠ 物理标题 DOM 投影：用户可关闭可见标题编号而对象编号仍工作（语义 commit 必须先于任何"仅跳过物理渲染"的 early return）。
- 文档切换防陈旧屏障：active document=B 时 getter 绝不返回 A 快照；proactive invalidation + 防御性 getter 的 documentKey 比对；快照内嵌 documentKey，(documentKey, revision) 唯一标识已发布状态。
- 订阅事件：`subscribeHeadingNumberingSnapshot(listener(snapshot|null, reason))`，reason ∈ COMMITTED / INVALIDATED_DOCUMENT_SWITCH / INVALIDATED_DOCUMENT_CLOSED。
- 语义专用设置变化（strict↔loose、startAt、unnumbered override、skip↔consume）即使 DOM 未变也必须产出新语义 revision；物理专用策略不改变语义 Chapter/Section。
- numbering disabled 契约：物理编号禁用 ≠ 语义快照不可用/不更新。

## 编号预设与配置

- 五公共预设锁定：`global {n}`、`chapter-dot {chapter}.{n}`、`section-dot {chapter}.{section}.{n}`、`chapter-dash {chapter}-{n}`、`section-dash {chapter}.{section}-{n}`；**第五预设绝不渲染 2-1-3（必须 2.1-3）**。
- 标准可见深度上限 = Chapter+Section+ObjectOrdinal；raw 与 wrapper 分离（raw=2.1-3，渲染=图/表/代码/() 前缀）。
- `startNumber` 只作用于对象 ordinal {n}（每个 effective scope 内）；`minDigits` 只补 {n}（禁止 02.01-01）；本阶段仅阿拉伯数字。
- 公共 UI 不得暴露物理 H 级重置选项（按 H1/按 H2/按 H3）；普通用户只见语义选择（全文连续/按章/按节）。
- 预设权威单一化：`numbering-preset-formatter.ts` 为规范（原始格式化）；`object-numbering-presets.ts` 仅承载 UI 描述/中文标签/预览/迁移并**调用**规范 formatter；禁止两套独立 switch/case 格式化。

## 配置持久化与迁移

- 持久化配置附加语义字段 `preset`（6 值），不删除旧字段；additive migration 直到 Phase 6。
- 规范化配置形状：enabled/preset/startNumber/minDigits/legacyCustomTemplate/legacyPayload。
- `legacy-custom` 是兼容状态而非公共标准预设；行为必须无损（{chapter}/{section}/{n} 不得回退为 {n}）。
- 旧配置迁移：只按精确简单模板映射五预设；含额外语法/未知 NumberingMode/特殊 reset → Advanced/Legacy Custom；迁移必须幂等。
- 未知字段策略：typed 持久化 schema 只保留已知兼容字段；任意未知字段仅在纯 normalizer 的 legacyPayload 保留。
- 公式 legacy 包装规范化：**仅公式**的精确包装模板可迁移到标准预设（`({n})`→global、`({chapter}.{n})`→chapter-dot…）；不是通用括号剥离规则。

## 生产协调器与投影（Phase 6）

- 生产收敛架构：HeadingNumberingService → HeadingNumberingSnapshot → **DocumentNumberingCoordinator**（完整 heading 快照 + 完整对象快照 + 当前语义 preset）→ 全量 desired-state 重算 → 与上次 diff → 只投影变化对象。
- `DesiredCaptionNumberState`：documentKey/revision/stableIdentity/objectKind/requestedScope/effectiveScope/chapterOrdinal/sectionOrdinal/scopeKey/ordinal/rawNumber/renderedLabel/resolutionStatus(EXACT/DEGRADED)。
- 稳定身份绑定元数据（name/元数据/settings/交叉引用），**绝不绑定编号**；禁止以旧编号/DOM 顺序缓存号作为下一 ordinal 权威。
- 6A 硬目标：`PRODUCTION_CAPTION_NO_DOM_NUMBER_PARSE = PASS`（移除 data-inkchapter-heading-number/heading innerText 等 DOM 解析）。
- 标准预设运行时以 preset 为权威；legacy 字段不再成为标准运行时权威。
- 6B：协调器真实生产接线；只做编排，**不得成为第二语义标题权威**。
- diff 比较键：stableIdentity/objectKind/effectiveScope/chapterOrdinal/sectionOrdinal/ordinal/rawNumber/renderedLabel/resolutionStatus；desired 未变 → 0 次 DOM 写（no-op 0 写，防事件风暴）。

## 对象-标题绑定（Phase 6.1）

- 旧机制为位置耦合（raw DOM H1..H6 → precedingHeadingCount → 假设 DOM index==snapshot index）；**禁止 index±1 补丁**。
- 最终架构：Heading Authority → canonical heading DOM binding → 最近前置 canonical heading 身份 → 按 `stableIdentity` 查 semantic state → scope resolver。
- 绑定与快照**原子发布**（同一 documentKey + 同一 revision）；对象条目契约用 `precedingHeadingStableIdentity` 取代 `precedingHeadingCount`。
- `compareDocumentPosition` 集中为单一 helper（显式处理 DISCONNECTED/CONTAINS/CONTAINED_BY）；scope 降级仍在 scope resolver，Caption 不得按物理 H 级别分支。
- resolver NULL 退出路径全分类（NO_ACTIVE_DOCUMENT / NO_CURRENT_SNAPSHOT / DOCUMENT_KEY_MISMATCH / NO_EDITOR_ROOT / NO_BINDINGS / TARGET_DISCONNECTED / HEADING_DISCONNECTED / ROOT_MISMATCH / COMPARE_DISCONNECTED / TARGET_BEFORE_FIRST_HEADING / NO_PRECEDING_CANDIDATE / CANDIDATE_IDENTITY_NOT_IN_SNAPSHOT / REVISION_MISMATCH）。
- editor-root 身份硬门禁：heading adapter root、caption root、target root、binding elements 必须同 ownerDocument、同 editor root、connected。
- 文档上下文守卫：语义投影前要求 active==caption==snapshot==binding==coordinator 的 documentKey 一致；任何 mismatch → DEFER、projectionWrites=0。

## 对象标题排版（Phase 7R.3.10，纯表现层）

- **TYPOGRAPHY = SHARED，LAYOUT = OBJECT-SPECIFIC**；单一 token 权威 `--inkchapter-object-caption-*`（0.95em、400、1.5、inline-gap 0.35em）；子节点 kind/number/name 必须 `font/color/letter-spacing: inherit`。
- Formula 例外：保持 MathJax 字体族，仅视觉对齐；CSS 选择器窄范围到 InkChapter 自有宿主，禁全局 `mjx-tag`/`mjx-container *` 重排。
- 强制 `TYPOGRAPHY_CHANGE_NUMBERING_DIFF_COUNT=0`（排版改动不得影响编号）。

## 相关代码

- `src/heading-numbering/caption-system.ts`
- `src/heading-numbering/caption-service.ts`
- `src/heading-numbering/caption-store.ts`
- `src/heading-numbering/caption-dom-adapter.ts`
- `src/heading-numbering/caption-dialog.ts`
- `src/heading-numbering/caption-context-menu.ts`
- `src/heading-numbering/document-numbering-coordinator.ts`
- `src/heading-numbering/canonical-heading-frame.ts`
- `src/heading-numbering/semantic-heading-numbering.ts`

## 历史吸收

- 2026-08-19 cleanup absorbed the caption/object-caption series and object-numbering legacy batches into this system doc.
- 2026-08-24 cleanup absorbed Phase 1–6（语义权威/快照/预设/协调器）与 Phase 7R.3.10（对象标题排版）。

## 当前状态

已实现；Phase 6 起生产 Caption 权威迁移至语义快照（`PRODUCTION_CAPTION_NO_DOM_NUMBER_PARSE=PASS`）；后续 7R 系列已在真实 Runtime 验证（见 [document-utilities.md](document-utilities.md) 与 [formula-numbering.md](formula-numbering.md)）。

## 已知约束

- 不得用图像 URL、alt、表格文本、代码文本本身直接充当唯一 identity
- 不得把重复内容对象错误合并成同一题注
- 不得把显示编号回写成 Markdown 源码中的业务身份
- 不得用渲染 DOM 编号作为生产权威；不得按物理 H 级别推断语义角色；不得自建第二 strict/loose 开关

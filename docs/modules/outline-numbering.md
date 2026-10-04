# 目录编号

## 用户可见功能

用户在 Typora 左侧侧栏的「目录（大纲）」面板中可以看到标题编号。编号与正文中的标题编号保持一致，实时同步更新。用户无需任何额外操作——只需打开目录面板即可看到带编号的标题。

## 预期表现

- 打开 Typora 侧栏目录面板，标题自动显示编号
- 编辑标题文本时，目录中的编号实时更新
- 切换文档时，目录编号自动适配新文档
- 面板隐藏后重新打开时，编号仍然正确显示
- 编号样式与正文一致（预设或 Custom）

## 当前真实表现

基于代码分析（未 Runtime 验证）：

**目录适配器 v5**（`outline-numbering-adapter.ts`）:
- `findOutlineRootRelaxed()`: 跳过 `offsetParent` 检查，支持隐藏面板的 root 检测
- `findOutlineTextElementsRelaxed()`: 在面板隐藏时也能找到目录项
- 多个 root 候选选择器（`ROOT_CANDIDATES`）
- 非目录面板排除（文件树、搜索、工具栏等）
- `data-inkchapter-number` 属性标记已注入编号的目录项
- `SyncResult` 返回详细同步结果（匹配数、属性应用数、未匹配数）

**控制器**（`outline-numbering-controller.ts`）:
- 管理同步生命周期
- 处理事件触发（文档切换、标题变更）

**已知问题**:
- outline root 检测在面板隐藏时可能失败（v5 的 `findOutlineRootRelaxed` 已实现但未经验证）
- `#outline-content` 候选选择器优先，如果 Typora 版本变化可能失效
- 目录项匹配采用文本匹配 + 数据行号双重策略

## 当前状态

已实现但未验收

（2026-09-07 更新：8B.4.2 / 8B.4.3 / 8B.4.3.1「重复标题身份映射 + collector 首层失败收口」代码已提交，git `194b3fe`；聚焦测试已建立；真实 Typora Runtime 视觉/手动验收待执行，见下方「Outline 身份映射」小节。）

## 已实现内容

- 目录编号注入到侧栏 DOM
- 多 root 选择器候选策略
- 隐藏面板的 relaxed 检测
- 非目录面板排除
- `data-inkchapter-number` 属性标记
- 实时同步（标题变更事件驱动）
- SyncResult 详细诊断
- Runtime 取证工具（`runtime-audit.ts`）

## 未完成内容

- Runtime 验证（目录面板实际显示编号截图）
- 面板隐藏/显示切换时的编号保持
- outline root 检测的兼容性测试

## 用户操作方式

1. 确保标题编号开关已开启
2. 点击 Typora 左侧「目录」图标打开大纲面板
3. 目录中的标题自动显示编号
4. 编辑文档时目录编号实时更新

## 相关代码

- `src/heading-numbering/outline-numbering-adapter.ts` — 目录 DOM 适配器 v5
- `src/heading-numbering/outline-numbering-controller.ts` — 目录编号控制器
- `src/heading-numbering/heading-numbering-service.ts` — 集成目录同步
- `src/heading-numbering/runtime-audit.ts` — 取证/诊断工具
- `docs/analysis/runtime-evidence/runtime-evidence-summary.md` — 取证汇总
- `docs/analysis/heading-numbering-outline-root-cause-audit.md` — 根因审计

## 验证证据

- v5 适配器代码审查已完成
- Runtime 取证数据存在（4 个场景 JSON 文件）
- `trae-runtime-forensics-h2-h3-outline-delay` 取证已完成
- 8B.4.3 focused test（`outline-duplicate-identity-7r3-11-8b43.test.ts`，F1–F10：collector 16/16、duplicateCollapsedCount=0 等）文件已入库（git `194b3fe`）
- 真实 Typora Runtime 视觉/手动验收（ATX fixture 16/16、11/11、无点击刷新、native rebuild、document switch）：待执行
- 无截图证据

## 已知问题

- 隐藏面板的 root 检测未经验证
- 目录项文本匹配在特殊字符场景可能失败
- 面板初始加载时编号可能延迟一帧（首次不显示需点击问题）

## Outline 身份映射（7R.3.11.8B.4.3，重复标题身份收口）

> 阶段：7R.3.11.8B.4.2（strict effective authority，同批收口）/ 8B.4.3（duplicate identity mapping closure）/ 8B.4.3.1（collector first-failure closure）。
>
> 2026-09-07 吸收自两份历史提示词（见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）；代码已提交（git `194b3fe`），见本小节末尾「阶段归属与验收状态」。**真实 Typora Runtime 视觉/手动验收待执行。**

### 问题签名

用户直接视觉证据：

```text
正文：
H1  text
H2  一、 text

Outline：
H1  text
H2      text        ← H2 "text" 的墨章编号 decoration 没有加载
```

- 两个**相邻、同名、不同级**（H1/H2 "text"）的真实标题节点在 Typora 侧栏目录中都存在；只有第二个 H2 "text" 的编号 decoration 缺失。
- 原失败 signature（此前 Runtime 稳定出现）：

```text
canonicalHeadingCount=16
headingLabelCount=16
business/native inventory count=15
matchedCount=15
unmatchedHeadingCount=1
expected=11 / actual=10

OUTLINE-STRICT-VERIFY
decision=FAIL
reason=DECORATION_COUNT_MISMATCH
```

- 根因族：`OUTLINE_DUPLICATE_IDENTITY_COLLISION`（TRIGGER=`ADJACENT_SAME_TEXT_DIFFERENT_LEVEL_HEADINGS`，CASE=H1 "text" + H2 "text"）。
- 8B.4.3.1 focused test 固化 pre-fix 证据：`rawNativeDomItemCount=16` → `collectorNativeItemCount=15`（collectorTrace.strategy=2、leafDedupSkippedCount=1）→ `FIRST_FAILING_LAYER=C（COLLECTOR_TEXT_DEDUP_COLLAPSES_NODE）`。
- 禁止再把这个 signature 解释成「Typora 没生成第二个 native outline item」；须把旧计数拆成 rawNativeDomItemCount / eligibleNativeItemCount / collectorNativeItemCount / uniqueNormalizedTextCount / matchedNativeItemCount 等独立口径。

### 修复合约：身份模型

- **禁止 text-only 唯一身份**：`Map<string, NativeOutlineItem>`（key 仅 normalizedText）与 `Set<normalizedText>` 均不得作为 Outline item 的唯一业务身份或 dedup 依据（`# text` 与 `## text` 是两个独立结构节点）。
- native identity 至少包含：`rawDomOrdinal + outlineDepth/level + normalizedText + sameTextOccurrenceOrdinal`；示例 `L1|text|occ1|dom9`、`L2|text|occ1|dom10`；同层重复（H2 方法 ×2）仍须区分 occ1/occ2。
- canonical 侧必须保留 `stableIdentity`（含 physicalLevel、document order、normalizedText），禁止退化成 normalizedText only。
- **bodyTexts membership 与 native identity dedup 是两件事**：`getBodyHeadingTexts()`（该 DOM leaf 文本是否属于任一 canonical heading text）作为 membership 继续允许 `Set<string>`；但不得用 normalizedText 去重真实 Native Outline Item。即：membership by text = OK；identity by text = NOT OK。
- 8B.4.3.1 的实际修复点：collector（`findOutlineTextElementsCore` Strategy 2）删除 `seenTexts: Set<string>` 加 `if (seenTexts.has(text)) continue` 的 text-only 去重；保留 leaf-most `hasMatchingChild`（wrapper → anchor → outline-label span 只收最内层真实文本 target）；两个独立 wrapper（H1/H2 各一）下的两个 span 都必须收集。
- 禁止：特判标题文本、为 unmatched heading 随机找 outline node、只修 expectedNumberedCount / actualDecorationCount。

### Matching 与 Projection 分离

- 顺序为 **MATCH ALL HEADINGS → 再决定 decoration**：所有 canonical headings（**包括 strict H1**）都必须参与 Heading ↔ Native Outline matching；strict H1（label=null、numberDecoration=null）也要求 matched=true 且 nativeTarget exists。禁止「only match numbered headings」、禁止把 projection 当作 collection/matching 的过滤条件（collection 前的 `if (!computedNumber) continue` 属错误层次）。
- 匹配策略：canonical heading（document order）↔ native outline（DOM order）一对一；候选条件至少 = normalizedText 兼容 + physicalLevel/outlineDepth 兼容 + 未消费 + 相对顺序单调；occurrence ordinal 用于消歧；candidate consumption 状态 **per reconcile transaction**（禁止跨文档 / 跨 native generation 持久化）。
- 匹配完成后才做 label projection：label==null → remove/skip InkChapter number span；label!=null → 恰好一个 number span。
- decoration 必须绑定 canonical stableIdentity（或 match transaction identity），不能只绑定 text；同一 native item 至多一个 decoration，不同 native item 即使同名允许各有独立 decoration；Outline rebuild / document switch / mode switch 后 `staleDecorationCount=0`，不得出现旧节点 + 新节点 decoration 双重残留。
- initial scan 与 Native MutationObserver rebuild 必须共用唯一 collect/match authority（`collectNativeOutlineItems()` / `matchCanonicalHeadingsToNativeItems()` 或当前等价入口），禁止两套映射规则导致重复 collapse。
- native generation / canonical revision 变化时必须 recollect raw nodes → rebuild native identities → rematch 全部 canonical headings，不得复用旧 DOM node identity。
- 重复标题文本不是结构错误（即使未来 Diagnostics 给 `DUPLICATE_HEADING_TEXT` 类 warning 也不影响 matching）。

### 层级 authority

native item level/depth 真实来源优先级：`closest('.outline-item-wrapper')` 的 class（outline-h1..outline-h6）→ aria-level → data-level → DOM nesting；**禁止以视觉 padding-left 作为唯一 level authority**；层级未知时记录 `levelConfidence`，禁止静默猜测；known native level 与 physicalLevel 不一致时不得为凑 cardinality 强行 match（decision=LEVEL_MISMATCH）。

### Cardinality 硬不变量与取证审计

每层计数均可审计：**raw → eligible → collector → matcher → projection**；在哪一层第一次变少就只修哪一层，禁止跨层补丁、禁止预防性重写下一层。

- `OUTLINE-MAPPING-CARDINALITY-INVARIANT`：documentKey / canonicalHeadingCount / rawNativeDomItemCount / eligibleNativeItemCount / collectorNativeItemCount / matchedHeadingCount / matchedNativeCount / unmatchedHeadingCount / unmatchedNativeCount / duplicateCollapsedCount / decision。
- `OUTLINE-RAW-NATIVE-INVENTORY`：在 collector 去重、filter、mapping **之前**记录 raw DOM（rawIndex、nodeIdentity、nodeConnected/Visible、tagName/className、ariaLevel、dataLevel、inferredDepth、rawText/normalizedText 等），直接证明 H1/H2 两个相邻同名节点真实存在。
- `OUTLINE-COLLECTOR-INVENTORY`：strategy、rawAnchorCount、anchorEligibleCount、leafCandidateCount、leafEligibleCount、duplicateCollapsedCount、collectedCount 及 duplicateGroups（normalizedText/rawIndexes/levels/collectorIndexes）。
- `OUTLINE-HEADING-MATCH-DETAIL`：每个 heading 的 candidateNativeIndexes / candidateLevels / candidateConsumedStates、selectedNative（index/level/nodeIdentity）、matchReason；decision=MATCH / NO_NATIVE_CANDIDATE / DUPLICATE_OCCURRENCE_EXHAUSTED / LEVEL_MISMATCH / ORDER_MISMATCH / ALREADY_CONSUMED / SELECTOR_EXCLUDED。
- `OUTLINE-NUMBER-DECORATION-INVARIANT`：expectedNumberedCount / actualNumberDecorationCount / duplicateDecorationCount / staleDecorationCount（mapping PASS 后才计算）。
- `OUTLINE-STRICT-H1-NUMBER-INVARIANT`：matchedH1Count == canonicalH1Count 且 visibleH1NumberDecorationCount=0（H1 参与 matching、不参与 number projection）。
- 旧 `nativeItemCount` 口径拆分为 rawNativeDomItemCount / collectorNativeItemCount，避免把 collector loss 误判成 Typora DOM loss。
- 日志降噪：detail 只在 documentKey change / native generation change / canonical revision change / cardinality FAIL / duplicate group fingerprint change 时输出；稳定 PASS 只输出 summary。

### 重复场景矩阵（focused test）

`src/heading-numbering/outline-duplicate-identity-7r3-11-8b43.test.ts`，覆盖 F1–F10：

- F1 当前 ATX duplicate trigger（`.outline-h1/.outline-h2` 同名；raw=2/collector=2/matched=2；strict：H1 label=""、H2 label="一、"）。
- F2 Strategy 2 duplicate（无 `a[href]`；strategy=2、collector=2、duplicateCollapsed=0）。
- F3 Strategy 1 baseline（有 `a[href]`；collector=3，无 regression）。
- F4 同层重复 H2 方法 ×2（occ1→occ1、occ2→occ2，禁止覆盖前一个）。
- F5 混合层级重复 H2 A / H3 A / H2 A（matched=3，无 collapse）。
- F6 非相邻重复 H2 方法 / H3 结果 / H2 方法（matched=3）。
- F7 strict H1 participates（H1 matched=true 且无 decoration；H2 matched=true 且有 decoration）。
- F8 loose duplicate（H1/H2 同名都 matched、都有 label，仍是两个独立 target）。
- F9 reconcile 同一 DOM 10 次：collector/match 计数稳定、duplicateDecorationCount=0。
- F10 native rebuild（old DOM disconnect → new DOM 同文序列）：old mapping discarded、new mapping 100% rebuilt。

### Runtime 目标（真实验收待执行）

打开 `test/vault/runtime/smoke/Document-Diagnostics-ATX-Marker-Test.md`（打开后正常 settle，**不得**点击大纲 / 切换侧栏 / 开关大纲作为前置刷新），要求：

- 16/16/16/16：canonicalHeadingCount = rawNativeDomItemCount = eligibleNativeItemCount = collectorNativeItemCount = matchedHeadingCount = 16；unmatchedHeadingCount=0、unmatchedNativeCount=0、duplicateCollapsedCount=0。
- 11/11：expectedNumberedCount=11、actualNumberDecorationCount=11；visibleH1NumberDecorationCount=0、duplicateDecorationCount=0、staleDecorationCount=0。
- `MANUAL_OUTLINE_REFRESH_REQUIRED=false`。
- 真实 Typora Runtime 截图/手动验收（含一次真实 native rebuild 后仍 16/16 与 11/11、document switch ATX→01-中文学术论文模板→ATX 无 carryover、H2 text→text2→text 恢复后 duplicate collision 不再出现、strict/loose 下 mapping cardinality 均 16/16）：**待执行**。
- 回归冻结：BODY_HEADING_NUMBERING / STRICT_EFFECTIVE_AUTHORITY / ATX_DIAGNOSTICS / CAPTION / FORMULA / SCROLL / DRAWER 均不得 regression；修复禁止触碰正文 Heading Numbering 主 counter 与 strict H1 语义。

### 阶段归属与验收状态（2026-09-07 吸收）

- 吸收来源：两份历史提示词（8B.4.3 duplicate identity mapping closure 与 8B.4.3.1 collector first-failure closure，与 8B.4.2 strict effective authority 同批收口，strict 映射语义见 `strict-loose-heading-structure.md`）；迁移明细见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)。
- 代码状态：已提交（git `194b3fe`，覆盖 7R.3.11.8B.4.2 + 8B.4.3 + 8B.4.3.1）；focused test 已入库。真实 Runtime 视觉/手动验收待执行。
- 主要涉及源码（以真实代码为准）：`src/heading-numbering/outline-numbering-adapter.ts`（`findOutlineTextElementsCore`、`OutlineCollectorTrace`、`collectRawNativeOutlineInventory`、`computeDuplicateGroups`、`matchHeadingsToOutline`、`applyNumberingAttributes`）、`outline-numbering-controller.ts`（OUTLINE-* 审计发射与 OUTLINE-STRICT-VERIFY）、`heading-numbering-service.ts`、`src/runtime/forensic-log-sink.ts`（runtime audit 输出）。

## 历史修复记录

- 目录同步编号实现（`trae-sync-heading-numbering-to-outline-sidebar`，部分完成）
- 标题级别偏移与自动刷新（`trae-fix-heading-level-offset-and-outline-auto-refresh`，部分完成）
- 标题 key 碰撞与 root 缓存（`trae-fix-heading-key-collision-and-outline-root-cache`，部分完成）
- H2 样式索引与首帧（`trae-correct-h2-style-index-and-outline-first-frame`，部分完成）
- Runtime 取证（`trae-runtime-forensics-h2-h3-outline-delay`）
- 目录首次不显示修复（`trae-fix-outline-numbering-auto-display-without-click`）
- 中文原版修复提示（`Typora标题编号与目录同步修复提示词`，已废弃）
- Runtime 探针修复（`trae-outline-numbering-runtime-probe-data-attribute-fix`，已废弃）
- 根因审计报告（`heading-numbering-outline-root-cause-audit.md`）
- 重复标题身份映射 + collector 首层失败收口（8B.4.2 / 8B.4.3 / 8B.4.3.1，代码已提交 git `194b3fe`；逐条明细见 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)）

## 当前唯一下一步

在 Typora 中打开目录面板，使用测试文档验证目录编号显示，特别关注面板隐藏/显示切换后的编号保持情况。
## 2026-08-19 Cleanup 吸收

- `trae-outline-document-identity-root-generation-verify-p0-fix.md`
- `trae-outline-document-context-binding-recovery-v19-p0.md`
- `trae-outline-current-document-full-resync-v29.md`
- `trae-outline-click-forensic-native-refresh-attribution-v21.md`
- `trae-outline-live-heading-mutation-reapply-p0-fix.md`
- `trae-outline-native-refresh-heading-trigger-v22.md`
- `trae-outline-native-subtree-rebuild-barrier-v23.md`
- `trae-outline-observer-coverage-gap-v24.md`
- `trae-outline-observer-late-bind-root-availability-v26.md`
- `trae-outline-post-native-stability-closure-v27.md`
- `trae-outline-runtime-codepath-authority-v25.md`
- `trae-outline-visible-root-availability-wakeup-v20-p0.md`
- `trae-outline-document-switch-semantic-convergence-v28.md`

本页的权威点是 `authoritativeDocumentKey`、snapshot / controller / toolbar 同步，以及 root generation 与 verify 顺序。

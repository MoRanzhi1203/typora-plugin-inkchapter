# 诊断三批次 — B1 可靠性修复验收报告

> 分支：`feature/diagnostics-b1-reliability`
> 基线：`main` @ `4017d598134720396fe28ccae53488e9f95886ac`（GIT-0 文档提交后）
> 时间：2026-11-10（Etc/GMT-8）
> 范围：只修改受控源码、测试和诊断文档；未修改 Typora、社区框架、用户 Markdown 或真实用户配置。

## 1. 批次状态

| 门禁项 | 状态 | 证据 |
|---|---|---|
| B1-01 统计集合 / 差集 / 守恒 | PASS | `document-diagnostic-code-sets.ts` + 7 个测试；差集见 §2 |
| B1-02 状态色块 / stale fence | PASS（自动）；GUI NEEDS_MANUAL | 状态矩阵 + `getComputedStyle` + stale revision 测试；真实 Typora 截图待人工 |
| B1-03 事件数 vs 投影行数；4 条定位契约 | PASS | multi-target 1 event / 2 rows 测试；4 条 registry location 对齐 |
| B1-04 不可达规则 / 门控 / 兼容残留 | PASS | CB007 接入；CB008/CB010 默认关闭；strictPolicyActive 接入；旧 code 名清理 |
| B1-05 去重 / 抑制 / 文案 | PASS | source-unavailable 抑制；CB009 与 CODE_EMPTY_BLOCK 抑制；空行注释修正 |
| B1-06 行为测试 | PASS | 图/表/代码重名、CB007/008/010、CB009、strict 门控、stale fence、multi-target |
| B1-07 当前构建真实 GUI 运行时闭包 | NEEDS_MANUAL | 自动化无 Typora 控件级点击能力；未伪造截图/闭包 |
| 全量测试 / 类型 / 构建 / 隐私 | SEE §5 | 最新结果见 §5 |

**结论：代码与测试门禁 PASS；P0 GUI 视觉/交互项标记 NEEDS_MANUAL，不冒充 PASS。**

## 2. 代码集合权威（B1-01）

新增 `src/document-utilities/document-diagnostic-code-sets.ts`，程序化给出五个集合与差集：

| 集合 | 数量 | 说明 |
|---|---:|---|
| registeredFamilyIds | 92 | 注册表 familyId |
| registryResolvedKeys | 98 | LATENT 只保留 1 个 `*` sentinel |
| expandedRuntimeCodes | 103 | LATENT 展开 6 个 LEVEL 代码 |
| producerSupportedCodes | 98 | `PRODUCED_DIAGNOSTIC_CODES` |
| runtimeReachableCodes | 95 | 98 − CB008 − CB010 − STRICT_FIRST_H1_DOCUMENT_EMPTY |

差集：

- producerNotExpanded = 0；
- expandedNotProducer = 5 个 DEFERRED code；
- producerNotRegistryResolved = 6 个 LATENT LEVEL；
- registryResolvedNotProducer = 1 个 LATENT sentinel + 5 个 DEFERRED；
- expandedNotRegistryResolved = 6 个 LATENT LEVEL；
- registryResolvedNotExpanded = 1 个 LATENT sentinel。

严重程度（103 代码注册表基准）：错误 12 / 警告 62 / 提示 29。
真正可达（95 代码）：错误 12 / 警告 56 / 提示 27。
strict 可达（95 代码）：错误 14 / 警告 60 / 提示 21。

这修正了旧报告“95 = 98 − CB007/8/10”的错误构成：旧集合把不可达的 STRICT_FIRST_H1_DOCUMENT_EMPTY 算进可达、又把实际接入的 CB007 排除。B1 后 95 的构成是：CB007 可达；CB008、CB010、STRICT_FIRST_H1_DOCUMENT_EMPTY 不可达。

## 3. B1 代码变更

### 3.1 状态色块与计数

- `document-status-indicator.ts` 的优先级保持 `error → red / warning → amber / hint → blue-gray / clean → green / unknown → gray`；警告优先于“结构未验证”的灰色分支。
- `document-utility-overlay-host.ts` 的 hub facts 改为使用 `deriveDocumentProblemsProjection` 的 **事件计数**，并在 `noDoc` 时归零；多目标行的计数不再抬高严重程度数。
- `document-hub-controller.ts` 的 overview / filter 使用 status 事件计数；新增 `rowCount`，当行数与事件总数不同时显示“N 行”。
- `document-hub-model.ts` 新增 `rowCount` 字段（视图行数，不等于事件数）。
- stale fence：`admitDiagnosticsSnapshot` 已对 `STALE_REVISION` 拒绝旧 revision；B1 新增直接测试。

关于“1 警告却灰色”：在 GIT-0 基线（V5.2 commit 23e58c0）中，`resolveDocumentStatusCode` 已把 warning 放在 structuralVerified 之前，自动测试矩阵无法复现灰色。B1 没有伪造“修复了一个当前不存在的 bug”，而是：
- 锁定 `unverified snapshot + 1 warning = YELLOW` 的回归测试；
- 新增 `getComputedStyle(backgroundColor)` 断言；
- 新增 stale revision 拒绝测试；
- 新增 multi-target 1 event / 2 rows 测试。
真实 Typora 的像素级确认仍为 NEEDS_MANUAL。

### 3.2 定位契约（B1-03）

注册表改为与生产器实际一致：

| 规则 | 旧声明 | 新声明 |
|---|---|---|
| FIGURE_NUMBER_DUPLICATE | figure-occurrence | target-group |
| FIGURE_NUMBER_ORDER_INVALID | figure-occurrence | block-node |
| TABLE_NUMBER_DUPLICATE | block-node | target-group |
| CODE_NUMBER_DUPLICATE | block-node | target-group |

对应测试在 `document-diagnostics-numbering-integrity-v2.test.ts` 断言 `location.kind` 与目标成员数。

### 3.3 不可达规则 / 门控 / 残留（B1-04）

- **CB007**：`parseFencedCodeBlocks` 新增 `rawText`（保留原始 `\r`，text 仍是 LF 归一）；生产器把 `fence.rawText` 传给 analyzer。CB007 从不可达变为可达，且只对真正混用 CRLF/LF 的块触发。
- **CB008**：注册表 `defaultEnabled=false`，原因 `OPT_IN_LONG_LINE_THRESHOLD`；阈值仍由 `maxLineLength` 配置，生产器不默认启用。
- **CB010**：注册表 `defaultEnabled=false`，原因 `DUPLICATE_OF_CODE_MISSING_LANGUAGE`；生产器不启用，避免与 CODE_MISSING_LANGUAGE 重复提示。
- **STRICT_FIRST_H1_DOCUMENT_EMPTY**：注册表 `knownUnreachableRuntimeCodes`，原因 `EMPTY_DOCUMENT_TERMINAL_SHORT_CIRCUIT`；代码保留，不删除。
- **strictPolicyActive**：生产器使用 `input.strictPolicyActive ?? input.strictMode` 门控 strict-only 规则；`strictMode` 仍只决定 severity。authority 审计同步。
- **captionDuplicateNames**：标记 `@deprecated`，说明生产器不读取；保留输入形状兼容性。
- **PROJECT_TERMINAL_NEWLINE_MISSING**：从优先级表删除。
- **旧 STRICT-FIRST-H1**：`validateStrictFirstH1` 标记 `@deprecated`，生产只使用 `validateStrictFirstH1Topline`；旧 code 名 `LINK_LOCAL_TARGET_NOT_FOUND` / `STRICT_H1_MISSING` 已从测试与 authority 审计中清理。

### 3.4 去重 / 抑制 / 文案（B1-05）

- strict first-H1 已报告 `SOURCE_UNAVAILABLE` 时，抑制通用 `DOCUMENT_SOURCE_UNAVAILABLE`；未激活 strict policy 时通用提示保留。
- 完全空且有题注的代码块由 CB009 拥有，通用 `CODE_EMPTY_BLOCK` 被抑制；无题注或仅有空白行的空块仍由通用规则报告。
- 空行阈值注释由“3+”改为“2+”，实现、文案、注释一致。
- `TABLE_EMPTY_CONTENT` 与 `TABLE_HEADER_EMPTY` 保留为两个可独立修复的事实（无数据行 vs 空表头），未强行合并。

### 3.5 行为测试（B1-06）

新增/更新：

- `document-diagnostic-code-sets.test.ts`（7 tests）：集合、差集、守恒、95 构成、severity。
- `document-diagnostics-b1-reliability.test.ts`（12 tests）：strict 门控、source-unavailable 抑制、CB007 混合/全 CRLF、CB008/CB010 不产生、CB009 抑制、图/表/代码重名行为。
- `document-hub-status-authority-v1.test.ts`：YELLOW/getComputedStyle、stale revision 拒绝、multi-target 1 event / 2 rows。
- `content-block-toolbar-code-source.test.ts`：rawText 保留 CRLF 与混合换行。
- `document-diagnostics-numbering-integrity-v2.test.ts`：4 条定位 kind。
- `document-diagnostic-code-empty-block-generic-pipeline.test.ts`：命名空块由 CB009 拥有。
- 旧 code 名 fixture 清理。

## 4. 关键文件

- `src/document-utilities/document-diagnostic-code-sets.ts`（新增）
- `src/document-utilities/document-diagnostic-location.ts`（defaultEnabled / knownUnreachable / 4 条定位）
- `src/document-utilities/document-diagnostics.ts`（strictPolicyActive、CB007 rawText、source-unavailable 抑制、CB009 抑制、空行注释）
- `src/document-utilities/content-block-toolbar-code-source.ts`（rawText）
- `src/document-utilities/document-utility-overlay-host.ts`（事件计数、noDoc 归零）
- `src/document-utilities/document-hub-controller.ts` / `document-hub-model.ts`（rowCount / 事件计数）
- `src/document-utilities/document-diagnostics-authority.ts`（strict 审计对齐）
- `src/document-utilities/document-diagnostic-copy-v1.ts`（兼容映射清理）
- `src/heading-numbering/strict-document-validator.ts`（legacy @deprecated）

## 5. 验证

| 命令 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | PASS，exit 0 |
| 定向测试（B1 相关 16 文件） | PASS，328 tests |
| 全量 `node node_modules/vitest/vitest.mjs run` | 结果见执行日志最新记录 |
| 生产构建 `node build.js --prod` | PASS，`dist/main.js` SHA256 `FD45A411B5B514161CAD673D975FE7EF7E6B728178381C9B64CCD493AFE1C4B4` |
| 隐私检查 `node scripts/verify-image-privacy.mjs` | 待批次门禁重跑 |
| 文档检查 `node scripts/docs/verify-docs.mjs` | 待批次门禁重跑 |

## 6. GUI 验收（NEEDS_MANUAL）

自动测试无法代替真实 Typora 的像素/点击验收；B1 标记以下项 NEEDS_MANUAL，不伪报 PASS：

1. 打开 `test/vault`（真实 Typora，加载墨章插件），确认右上角方块尺寸 15×15、热区约 32×32、无白色包装/阴影。
2. 构造 1 项警告（如缺表名）且快照 `structuralVerified=false`：方块应为 amber，不应为 gray；记录 `getComputedStyle(square).backgroundColor` 与 `dataset.status`。
3. 构造一个 multi-target 警告（重复标题）：面板显示“1 项警告 · 2 行”，方块计数为 1；两行均可点击并定位到各自标题。
4. 快速切换 3–5 个文档：旧文档的警告不得回写到新文档；方块/列表/计数同源。
5. 双击方块锁定：只出现独立中性色细框，不覆盖 severity 颜色；再次双击解锁。

解除条件：在上述真实 Typora 环境中逐项记录截图、DOMRect、dataset 与计算结果；无法提供时保持 NEEDS_MANUAL，不能以自动测试替代。

# 墨章文档诊断全量盘点与分类统计（现行源码审计）

> B2+B2b+B2c+B2d 更新（2026-11-10）：新增 FRONTMATTER_MALFORMED、TABLE_COLUMN_COUNT_MISMATCH、TABLE_ALIGNMENT_INVALID、LIST_INDENTATION_INVALID、HEADING_NUMBER_SEQUENCE_INVALID、FIGURE_IMAGE_FORMAT_UNSUPPORTED、FORMULA_SOURCE_LENGTH_EXCEEDING、FORMULA_SOURCE_LINE_TOO_LONG、FORMULA_RENDER_WIDTH_OVERFLOW、FORMULA_LATEX_RENDER_FAILED 的生产器；当前 101 家族 / 107 注册解析代码 / 112 展开代码 / 108 生产器代码 / 103 可达代码。4 条跨文件/交叉引用 DEFERRED 仍为 BLOCKED（无 canonical 语法/文件锚点权威），见 `DIAGNOSTICS-BATCH-2-REPORT.md` 与 `DIAGNOSTICS-B2B3-UNBLOCK-AUDIT.md`。

> 审计对象：typora-plugin-inkchapter 当前工作树（未修改规则注册表、未修改任何诊断业务逻辑）。
> 审计方式：读取真实源码 + 只读枚举脚本 + 定向测试 + 类型检查。
> 生成时间：2026-11-10（Etc/GMT-8）。
> 本文所有结论都给出源码文件与行号；所有统计都可由附录 C 的一次性只读脚本复算。

## 0. 结论摘要

**当前墨章文档诊断总计 101 个规则家族、112 个具体诊断代码，其中错误 13 个、警告 70 个、提示 29 个，另有其他类别 0 个。**

把动态代码按运行时真实展开后，112 是“规则全集”口径；其中：

- 有生产器路径的具体代码 108 个（对应 97 个 IMPLEMENTED 家族）；
- 在当前固定选项下真正可达的具体代码 103 个（CB008、CB010、两条默认关闭的公式源码规则、不可达动态代码 STRICT_FIRST_H1_DOCUMENT_EMPTY 除外）；
- 4 个 DEFERRED_BY_SPEC 家族没有任何生产器（LINK_LOCAL_FILE_ANCHOR_MISSING、3 条交叉引用），B2 已记录为 BLOCKED。

| 关键指标 | 数值 | 口径 |
| --- | ---: | --- |
| 规则家族 | 101 | 注册表 familyId 去重 |
| 注册表解析代码（官方） | 107 | LATENT 前缀只计 1 个 sentinel，含 4 个 DEFERRED |
| 具体诊断代码（展开动态代码） | 112 | LATENT 展开 6 级、STRICT_FIRST 展开 7 码 |
| 有生产器的具体代码 | 108 | 90 个 EXACT + 7 个 STRICT 码 + 6 个 LATENT 级别 + 新增 |
| 真正可达的具体代码 | 103 | 108 减去 4 个默认关闭 + 1 个不可达动态代码 |
| 错误 / 警告 / 提示（家族） | 13 / 64 / 24 | 注册表基准级别 |
| 错误 / 警告 / 提示（具体代码） | 13 / 70 / 29 | 注册表基准级别，展开后 |
| 接入生产器的家族 | 97 | 无条件 77 + 条件启用 16 + 默认关闭 4 |
| 未接入（DEFERRED） | 4 | 无生产器（BLOCKED） |
| 运行时闭包已证实 | 0 | 97 个 IMPLEMENTED 家族全部 UNVERIFIED |
| 静态可定位家族 | 100 / 101 | 仅 DOCUMENT_EMPTY 声明不可定位 |

## 1. 统计口径（必须先读）

### 1.1 规则家族与具体代码分开计数

“规则家族”指注册表 DOCUMENT_DIAGNOSTIC_RULE_REGISTRY 的一个 familyId（document-diagnostic-location.ts:542-954）。92 个家族中：

- 90 个家族是 EXACT 策略（一个家族一个 code）；
- STRICT_FIRST_H1 是 PATTERN 策略，对应 7 个具体代码（registry:595-612）；
- LATENT_ATX_HEADING_MARKER 是 PREFIX 策略，运行时实际发射 6 个 LEVEL_n 代码（registry:583-589；生产器 document-diagnostics.ts:2445）。

因此：家族 92；把 PATTERN 与 PREFIX 展开后的具体代码 = 90 + 7 + 6 = **103**。

> B2 追加：新增 6 个家族后当前为 98 家族 / 109 展开代码 / 105 生产器代码 / 100 可达；第 2–6 节的 92/103 表是 B1 基线，B2 最新完整统计、新增规则与 BLOCKED 项见 `DIAGNOSTICS-BATCH-2-REPORT.md`。

### 1.2 官方 98 与“有生产器 98”不是同一个集合

能力矩阵与 Runtime Closure Authority 的 RESOLVED_DIAGNOSTIC_CODE_COUNT = 98（document-diagnostic-runtime-closure-authority.ts:200-210），它的构成是：

- 90 个 EXACT（其中含 5 个 DEFERRED）；
- 7 个 STRICT_FIRST 代码；
- 1 个 LATENT 前缀 sentinel（LATENT_ATX_HEADING_MARKER_*）。

而 PRODUCED_DIAGNOSTIC_CODES 的 98 个是：

- 85 个 IMPLEMENTED EXACT；
- 7 个 STRICT_FIRST 代码；
- 6 个 LATENT LEVEL 代码。

两者数值相同但集合不同：官方 98 多了 5 个 DEFERRED 与 1 个 sentinel，生产器 98 多了 6 个 LATENT LEVEL 代码。这是一个真实存在的计数口径陷阱（见异常 D01）。

### 1.3 严重程度

内部严重程度只有 error / warning / info 三档（diagnostics-types.ts:12）。展示层把 info 映射为 hint（document-diagnostic-location.ts:153-159；overlay 的 presentationSeverityLabel 见 document-utility-overlay-host.ts:2671-2674），用户可见标签只有“错误 / 警告 / 提示”。因此：

- Info 不是第四个用户可见级别，本文不把 Info 与 Hint 重复计数；
- 本文“提示”= 内部 info = 展示 hint；
- runtime domain 的 FAIL / DEGRADED / PENDING 是另一条轴（diagnostic-domain-v1.ts:21-28），不属于文档诊断级别，也不进入文档计数。

### 1.4 模式与配置

注册表的 internalSeverity 是“基准级别”。三条规则会随严格/宽松模式改变运行级别（modeDependent=true，registry:381-385）：

- HEADING_LEVEL_GAP：strict = error，loose = warning（document-diagnostics.ts:296-297）；
- HEADING_EMPTY_TEXT：strict = error，loose = warning（同处）；
- LATENT_ATX_HEADING_MARKER：strict = warning，loose = info（document-diagnostics.ts:416）。

因此本文同时给出“注册表基准”和“strict 运行”两套分布，避免把基准数当成任何模式下的实际数。

### 1.5 实例不计数

同一规则在文档中触发 N 次只算 1 条规则、1 个代码；N 个实例只影响诊断条数，不影响本报告的规则统计。

### 1.6 UNVERIFIED 的含义

本报告把两件事分开：

- 静态可达：源码里是否存在真实生产路径；本报告对 95 个代码给出“可达”结论，对 8 个代码给出“不可达 / 无生产器”结论（2 个默认关闭 + 1 个空文档短路 + 5 个 DEFERRED）；
- 运行时证据：是否有可验证的 Fresh-Runtime-Identity 会话证明它在真实 Typora 中执行过。当前 87 个 IMPLEMENTED 家族的 runtimeClosureStatus 全部是 UNVERIFIED（能力矩阵 CLOSED_FAMILY_COUNT=0），唯一一条 runtime evidence 的 mainSha256 与当前 dist/main.js 不一致（见 D15）。

### 1.7 生产器核对范围

本报告核对到的诊断构造入口：computeDocumentDiagnostics（含 emitObjectNumberIntegrity / emitSourceSyntaxIntegrity / buildInternalBlankLineDiagnostics）、computeCaptionIntegrityDiagnostics、analyzeCodeBlockV4、analyzeDocumentCompleteness / analyzeTableBlocks / analyzeDisplayFormulaBlocks / analyzeEmptySourceObjects、document-source-syntax-authority 的三类状态机、document-definition-reference-index、document-inline-link-authority。

未发现第二个向 DocumentDiagnosticsSnapshot 注入 diagnostic 的生产器：computeDocumentDiagnostics 负责源侧，computeCaptionIntegrityDiagnostics 负责 DOM 侧，二者在 DocumentDiagnosticsAuthority.recompute 中合并（document-diagnostics-authority.ts:340-345）。

## 2. 总体统计

### 2.1 家族级

| 项目 | 数量 |
| --- | ---: |
| 注册规则家族 | 92 |
| 错误家族 | 12 |
| 警告家族 | 56 |
| 提示家族（内部 info / 展示 hint） | 24 |
| 其他严重程度家族 | 0 |
| IMPLEMENTED | 87 |
| DEFERRED_BY_SPEC | 5 |
| PLANNED | 0 |

### 2.2 具体代码级（注册表基准，103）

| 项目 | 数量 |
| --- | ---: |
| 具体诊断代码总数 | 103 |
| 错误代码 | 12 |
| 警告代码 | 62 |
| 提示代码 | 29 |
| 其他严重程度代码 | 0 |
| 有生产器路径的代码 | 98 |
| 真正可达的代码 | 95 |
| 无生产器（DEFERRED）的代码 | 5 |
| 有生产器但默认关闭的代码 | 2 |
| 已注册但已知不可达的动态代码 | 1 |

### 2.3 执行状态

| 状态 | 家族数 | 说明 |
| --- | ---: | --- |
| A 已注册并执行 | 69 | 接入生产器；由文档内容 / 文档状态决定是否触发 |
| B 已注册但条件启用 | 16 | 严格模式 3 + 编号配置 13 |
| C 已注册但不可达 | 2 | CB008 / CB010，生产器从不启用其选项（CB007 已在 B1 接入原始换行数据） |
| D 未接入（DEFERRED） | 5 | 无生产器 |
| 已废弃但保留源码 / 映射 | 0（注册家族） | 另有 1 条未注册的兼容映射残留，见 D10 |
| 仅测试代码中出现 | 0（注册家族） | 另有 1 个旧规则实现和 2 个旧 code 名残留在测试，见 D13 |
| 无法确认（运行时证据） | 87 | 全部 IMPLEMENTED 家族 UNVERIFIED |

说明：A 的 69 不等于“每次都会报 69 条”，它表示这 69 个家族已接入生产器且没有全局配置开关；任何一条都仍需要对应文档事实才会触发。B 的 16 在开关关闭时完全不执行。

## 3. 按严重程度统计

### 3.1 家族级分布（注册表基准）

| 严重程度 | 家族数 | 占比 |
| --- | ---: | ---: |
| 错误（Error） | 12 | 13.0% |
| 警告（Warning） | 56 | 60.9% |
| 提示（Hint / 内部 Info） | 24 | 26.1% |
| 其他 | 0 | 0.0% |
| 合计 | 92 | 100.0% |

### 3.2 具体代码级分布

| 口径 | 错误 | 警告 | 提示 | 其他 | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 注册表基准（103 代码） | 12 | 62 | 29 | 0 | 103 |
| strict 运行（103 代码） | 14 | 66 | 23 | 0 | 103 |
| 有生产器（98 代码） | 12 | 57 | 29 | 0 | 98 |
| 真正可达（95 代码） | 12 | 56 | 27 | 0 | 95 |
| strict 且有生产器（98 代码） | 14 | 61 | 23 | 0 | 98 |
| strict 且可达（95 代码） | 14 | 60 | 21 | 0 | 95 |

### 3.3 模式差异

| 规则 | loose | strict | 依据 |
| --- | --- | --- | --- |
| HEADING_LEVEL_GAP | 警告 | 错误 | document-diagnostics.ts:296-297 |
| HEADING_EMPTY_TEXT | 警告 | 错误 | document-diagnostics.ts:298-299 |
| LATENT_ATX_HEADING_MARKER | 提示 | 警告 | document-diagnostics.ts:412-416 |
| STRICT_FIRST_H1（7 码） | 不运行 | 警告 | document-diagnostics.ts:1996-2019 |
| STRICT_SINGLE_H1_NO_H1 / MULTIPLE_H1 | 不运行 | 错误 | document-diagnostics.ts:2025-2069 |

注意：strict 下 STRICT_FIRST_H1 的 7 个代码全部按 warning 运行（resolveDocumentDiagnosticSeverity 的 default 分支返回 warning，document-diagnostics.ts:411-419），而不是旧实现 StrictFirstH1ValidationResult 里写的 error（strict-document-validator.ts:125-136）。这是一个“旧实现 / 新实现”级别冲突，见 D13。

### 3.4 Info 与 Hint

24 个家族 / 29 个代码的内部级别是 info。展示层统一映射为 hint：

- resolveDocumentDiagnosticPresentationSeverity 把 info 映射为 hint（document-diagnostic-location.ts:153-159）；
- UI 标签函数把 info 映射为“提示”（document-utility-overlay-host.ts:2671-2674）；
- 顶部状态方块有独立的 HINT 颜色（document-status-indicator.ts:42-68）。

因此 Info 与 Hint 是同一件事的两种表示，本文只计一次“提示”。

### 3.5 其他严重程度

文档诊断没有第四种严重程度。项目里确实还存在另一套 runtime 诊断状态 FAIL / DEGRADED / PENDING（diagnostic-domain-v1.ts:21-28），但它被 domain 选择器隔离，不进入文档 Drawer、不进入文档计数（document-problems-projection.ts:37-50）。

### 3.6 动态代码文案映射核查

103 个代码中有 13 个动态代码：STRICT_FIRST_H1 的 7 个 + LATENT 的 6 个。逐条核对 copy 解析：

- STRICT 7 个在 copy 表都有静态 title / description / suggestion（document-diagnostic-copy-v1.ts:251-260）；
- LATENT 6 个没有静态 title，按设计回退到规范化后的生产者 message；description / suggestion 来自家族文案（document-diagnostic-copy-v1.ts:275, 379-389）；
- 未发现“有 code、无任何文案”的动态代码；LATENT 的 title 是动态的，不是缺失。

## 4. 按检测对象分类统计

### 4.1 主表：按检测对象（每条规则只归一个主类别）

| 检测对象 | 家族 | 错误 | 警告 | 提示 | 具体代码 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 文档整体结构 | 15 | 3 | 4 | 8 | 21 |
| 标题层级及编号 | 7 | 2 | 4 | 1 | 12 |
| 段落、空行与换行 | 1 | 0 | 1 | 0 | 1 |
| 图片及图片资源 | 10 | 1 | 9 | 0 | 10 |
| 表格及表名 | 12 | 1 | 9 | 2 | 12 |
| 公式及公式编号 | 6 | 3 | 2 | 1 | 6 |
| 代码块及语言声明 | 26 | 1 | 16 | 9 | 26 |
| 链接与锚点 | 6 | 0 | 5 | 1 | 6 |
| 引用与脚注 | 9 | 1 | 6 | 2 | 9 |
| 合计 | 92 | 12 | 56 | 24 | 103 |

分类依据：

- 文档整体结构：文档状态、空文档、EOF、首 H1 / 唯一 H1、标题/章节完整性、Front Matter、空引用块；
- 标题层级及编号：标题跳级、空标题、重复文字/身份、潜在 ATX、手工编号、自动编号冲突；
- 段落、空行与换行：仅内部连续空行规则（EOF 空行归文档整体结构，因为它是文件级边界问题）；
- 图片 / 表格 / 公式 / 代码：对象自身的命名、结构、资源、空对象、编号、手工编号、题注；
- 链接与锚点：本地链接目标、空文本/目标、文档内锚点、标题锚点冲突；
- 引用与脚注：脚注 4 条、引用式链接 2 条、3 条 DEFERRED 交叉引用；Front Matter 未闭合与 MALFORMED 都归文档整体结构，不在此类。

跨类别说明：题注（caption）类 9 条和编号（number）类 13 条在注册表里共享 area = caption-numbering；本主表按“检测对象”把它们分别拆到图片 / 表格 / 代码 / 公式 / 标题，因此不会重复计数。按 area 的第二张表见 4.2。

### 4.2 附表：按注册表 area（11 个内部领域）

| area | 中文领域 | 家族 | 错误 | 警告 | 提示 | 具体代码 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| document-state | 文档状态 / 边界 | 10 | 3 | 4 | 3 | 16 |
| document-format | 文档格式 / 空行 | 1 | 0 | 1 | 0 | 1 |
| document-completeness | 文档与章节完整性 | 8 | 0 | 0 | 8 | 8 |
| heading | 标题 | 5 | 1 | 3 | 1 | 10 |
| figure | 图片 | 4 | 1 | 3 | 0 | 4 |
| table | 表格 | 5 | 1 | 3 | 1 | 5 |
| code | 代码块 | 19 | 1 | 10 | 8 | 19 |
| formula | 公式 | 3 | 3 | 0 | 0 | 3 |
| caption-numbering | 编号与题注 | 22 | 1 | 21 | 0 | 22 |
| link-anchor | 链接与锚点 | 6 | 0 | 5 | 1 | 6 |
| cross-reference | 引用、脚注与交叉引用 | 9 | 1 | 6 | 2 | 9 |
| 合计 | — | 92 | 12 | 56 | 24 | 103 |

两张表各自守恒：主表按对象，附表按注册表领域；差异只来自 caption-numbering 的跨对象拆解，不是规则重复。

## 5. 实际运行状态核查

### 5.1 状态定义与计数

| 代码 | 定义 | 家族数 |
| --- | --- | ---: |
| A | 注册、接入生产器、无全局配置开关 | 69 |
| B | 注册、接入生产器、但被严格模式或编号配置门控 | 16 |
| C | 注册、有生产器代码，但生产器永不启用其触发选项 | 2 |
| D | 注册但无生产器（DEFERRED_BY_SPEC） | 5 |

### 5.2 B 类：16 个条件启用家族

严格模式门控（3）：

| 家族 | 生效条件 | 证据 |
| --- | --- | --- |
| STRICT_SINGLE_H1_NO_H1 | strictMode = true 且 h1Facts 已就绪 | document-diagnostics.ts:2025-2037 |
| STRICT_SINGLE_H1_MULTIPLE_H1 | strictMode = true 且 h1Facts 已就绪 | document-diagnostics.ts:2038-2069 |
| STRICT_FIRST_H1 | strictMode = true | document-diagnostics.ts:1996-2019 |

编号配置门控（13）：

| 家族 | 生效条件 | 证据 |
| --- | --- | --- |
| HEADING_MANUAL_NUMBER_PREFIX | numberingEnabled.heading = true | document-diagnostics.ts:2317 |
| HEADING_AUTO_NUMBER_CONFLICT | headingAutoNumbering.enabled = true 且该标题生效 | document-diagnostics.ts:2266 |
| FIGURE_MANUAL_NUMBER_PREFIX | numberingEnabled.figure = true | document-diagnostics.ts:3103 |
| TABLE_MANUAL_NUMBER_PREFIX | numberingEnabled.table = true | document-diagnostics.ts:3394 |
| CODE_MANUAL_NUMBER_PREFIX | numberingEnabled.code = true | document-diagnostics.ts:3418 |
| FIGURE / TABLE / CODE_NUMBER_DUPLICATE | objectEffectiveNumbers 快照非空且编号开启 | document-diagnostics.ts:1234-1237, 1260-1293 |
| FIGURE / TABLE / CODE / FORMULA_NUMBER_ORDER_INVALID | 快照非空、全部对象有事实、编号开启 | document-diagnostics.ts:1234-1237, 1302-1304 |
| FORMULA_NUMBER_SECTION_MISMATCH | 章节作用域编号事实存在 | document-diagnostics.ts:1348-1350 |

这些开关来自 main.ts 的实际 provider 接线：numberingEnabled.heading 来自 getHeadingPolicyState（document-utilities-context.ts:294-299），对象编号来自 captionService.getObjectNumberingEnabledState（main.ts:1520-1523），编号事实来自 captionService.getObjectEffectiveNumberElementFacts（main.ts:1579-1583）。

### 5.3 C 类：2 个默认关闭家族 + 1 个不可达动态代码

| 家族 | 不可达原因 | 证据 |
| --- | --- | --- |
| CB008 | 只在 options.enableLongLine === true 时运行；生产器从不传，默认关闭且阈值可配置 | document-diagnostic-code-block-v4.ts:295-315；options 定义 31-33 |
| CB010 | 只在 options.enableMissingLanguage === true 时运行；生产器从不传，且与 CODE_MISSING_LANGUAGE 重复 | document-diagnostic-code-block-v4.ts:772-784；options 定义 35-36 |

CB007 已在 B1 接入真实的原始换行数据（parseFencedCodeBlocks 的 rawText），因此从不可达集合移出；只对真正混用 CRLF/LF 的代码块触发。

另外，STRICT_FIRST_H1 家族内的动态代码 STRICT_FIRST_H1_DOCUMENT_EMPTY 也不可达：空文档会在 computeDocumentDiagnostics 顶部短路成 DOCUMENT_EMPTY（document-diagnostics.ts:1950-1956），不会走到首 H1 检查；无 documentKey 时又先走 DOCUMENT_INACTIVE（1985-1991）。

### 5.4 D 类：5 个未接入家族

| 家族 | 状态 | 证据 |
| --- | --- | --- |
| FRONTMATTER_MALFORMED | DEFERRED_BY_SPEC，producerAuthority = NONE | document-diagnostic-location.ts:796-800 |
| LINK_LOCAL_FILE_ANCHOR_MISSING | DEFERRED_BY_SPEC，producerAuthority = NONE | document-diagnostic-location.ts:928-932 |
| FIGURE_REFERENCE_TARGET_MISSING | DEFERRED_BY_SPEC，producerAuthority = NONE | document-diagnostic-location.ts:939-943 |
| TABLE_REFERENCE_TARGET_MISSING | DEFERRED_BY_SPEC，producerAuthority = NONE | document-diagnostic-location.ts:944-948 |
| FORMULA_REFERENCE_TARGET_MISSING | DEFERRED_BY_SPEC，producerAuthority = NONE | document-diagnostic-location.ts:949-953 |

### 5.5 运行时证据

能力矩阵显示 92 家族、87 IMPLEMENTED、5 DEFERRED、0 CLOSED、87 UNVERIFIED（docs/diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md 的机器可读摘要；也可由 document-diagnostic-capability-summary.test.ts 复算）。

唯一的 runtime evidence 记录（docs/diagnostics/runtime-evidence/document-diagnostics-runtime-evidence.json）对应 EXCESSIVE_INTERNAL_BLANK_LINES，但它的 mainSha256 = 817B7327...，当前 dist/main.js 的 SHA256 = 7BB0DF41...，两者不一致，因此该证据不能被当作当前构建的运行时证明。缺的证据是：与当前 dist/main.js 同 SHA 的 Fresh-Runtime-Identity 会话、第一次点击 / ACTIVE 视觉 / 取消激活 / 动态刷新 / 跨文档清理的逐项通过记录。

因此：所有 87 个 IMPLEMENTED 家族的“实际执行过”均为 UNVERIFIED；这是证据缺口，不是“规则未启用”。

## 6. 诊断定位能力统计

### 6.1 按注册表 locationStrategy

| 定位方式 | 家族 | 具体代码 |
| --- | ---: | ---: |
| 单目标·规范节点（canonical-node） | 9 | 15 |
| 单目标·源码范围（source-range） | 17 | 22 |
| 单目标·文档开头（document-start） | 4 | 4 |
| 单目标·文档末尾（document-end） | 2 | 2 |
| 单目标·规范块节点（block-node） | 28 | 28 |
| 单目标·整个违规块（source-block） | 1 | 1 |
| 单目标·图片出现位置（figure-occurrence） | 3 | 3 |
| 单目标·题注投影（caption-projection） | 6 | 6 |
| 单目标·源码语法起始符（source-syntax-opener） | 3 | 3 |
| 多目标（1…N）（multi-target） | 5 | 5 |
| 目标组（1 行 / N 成员）（target-group） | 14 | 14 |
| 合计 | 92 | 103 |

### 6.2 汇总

- 有定位策略声明的家族：92 / 92；
- 可定位家族（静态）：91 / 92；唯一例外是 DOCUMENT_EMPTY，它带 nonLocatableNotice = true 且没有 location（document-diagnostics.ts:1119-1125；契约见 document-diagnostic-location.ts:1167-1173）。
- 不可定位家族：1（DOCUMENT_EMPTY）。
- 单目标定位：73（canonical-node 9 + source-range 17 + document-start 4 + document-end 2 + block-node 28 + source-block 1 + figure-occurrence 3 + caption-projection 6 + source-syntax-opener 3）。
- 多目标定位：5（HEADING_DUPLICATE_TEXT、FIGURE_DUPLICATE_NAME、TABLE_DUPLICATE_NAME、CODE_DUPLICATE_NAME、STRICT_SINGLE_H1_MULTIPLE_H1）。
- 目标组定位：14。
- 文档末尾定位：2（DOCUMENT_TERMINAL_NEWLINE_MISSING、DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE）。
- 无生产器、因此运行期没有实例的定位策略：5 个 DEFERRED 家族。
- 有生产器且实际能产生非空 location 的家族：86（87 个 IMPLEMENTED 减去 DOCUMENT_EMPTY）。

校验：73 + 5 + 14 = 92；73 中已包含文档末尾 2 与文档开头 4，不再重复加总。

### 6.3 声明策略与实际 location kind（B1 已修复）

B1 把 4 条编号完整性规则的注册表声明改为与生产器实际 location 一致：

| 规则 | B1 前声明 | B1 后声明 = 生产器实际 | 证据 |
| --- | --- | --- | --- |
| FIGURE_NUMBER_DUPLICATE | figure-occurrence | target-group | registry:879-882；document-diagnostics.ts:1274-1291 |
| FIGURE_NUMBER_ORDER_INVALID | figure-occurrence | block-node（blockKind = figure） | registry:891-894；document-diagnostics.ts:1320 |
| TABLE_NUMBER_DUPLICATE | block-node | target-group | registry:883-886；document-diagnostics.ts:1274-1291 |
| CODE_NUMBER_DUPLICATE | block-node | target-group | registry:887-890；document-diagnostics.ts:1274-1291 |

B1 后注册表与生产器一致；对应的 target-group / block-node 行为测试在 document-diagnostics-numbering-integrity-v2.test.ts 中断言。

### 6.4 点击可靠性

- 所有有 location 的条目都必须通过 resolveDiagnosticLocation 解析（document-utility-overlay-host.ts:26426），解析失败会给出 TARGET_CHANGED / UNRESOLVED 的诚实结果，而不是假装定位成功（26434-26493）。
- 仅 DOCUMENT_EMPTY 没有 location，点击会返回 UNSUPPORTED / NO_LOCATION（document-diagnostic-location.ts:1757-1759）；它是声明的非定位通知，不属于“有行号却无法定位”的缺陷。
- 不能因为 UI 显示了行号就认定定位可靠：行号来自投影的 sourceLine（document-diagnostic-drawer-order-v514-r1.ts:29-45），真正的定位仍走 location 契约；本报告以 location 契约为准。

## 7. 完整规则明细

字段说明：级别为注册表基准级别；执行状态 A/B/C/D 见第 5 节；源码位置为文件:行号；测试为该家族首个非元测试文件（无引用则 NONE）。

### 7.1 文档整体结构（15 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOCUMENT_INACTIVE | 没有活动文档 | 提示 | documentKey 为空，或 markdown 与 headings 同时为空（无活动文档） | 单目标·文档开头 | 已注册·执行 | document-diagnostics.ts:1985-1991 | document-utility-toolbar-rendered-visibility.test.ts:128 |
| DOCUMENT_EMPTY | 文档为空 | 提示 | 有 documentKey 且 Markdown 去空白后为空（终端短路，不运行任何内容规则） | 不可定位（声明 notice） | 已注册·执行 | document-diagnostics.ts:1950-1956, 1119-1125 | document-diagnostic-empty-short-circuit-v512-r6-7r3-11-8b99.test.ts:12 |
| DOCUMENT_SOURCE_UNAVAILABLE | 无法读取文档源码 | 提示 | 有文档标识但 markdown 读取为 null | 单目标·文档开头 | 已注册·执行 | document-diagnostics.ts:2484-2491 | document-diagnostic-capability-summary.test.ts:113 |
| DOCUMENT_TERMINAL_NEWLINE_MISSING | 文档末尾缺少换行符 | 警告 | 源码最后一个字符不是换行符（EOF policy = MISSING_TERMINAL_NEWLINE） | 单目标·文档末尾 | 已注册·执行 | document-diagnostics.ts:2362-2385 | document-diagnostic-document-end-newline-marker-v1.test.ts:3 |
| DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE | 文档末尾空行过多 | 警告 | 末尾终止换行后仍有 2 个及以上额外空行（与上一条互斥） | 单目标·文档末尾 | 已注册·执行 | document-diagnostics.ts:2386-2405 | document-diagnostic-blank-region-unified-v1.test.ts:81 |
| DOCUMENT_HEADING_ONLY_NO_BODY | 文档仅包含标题 | 提示 | 恰有 1 个规范标题、标题源码行可定位、且无任何实质非标题内容 | 单目标·规范节点 | 已注册·执行 | document-diagnostics.ts:2093-2148 | document-diagnostic-heading-coverage-v514-r6.test.ts:76 |
| DOCUMENT_HEADINGS_ONLY_NO_BODY | 文档仅包含标题结构 | 提示 | 有 2 个及以上规范标题且无任何实质非标题内容（与上一条互斥） | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:2149-2198 | document-diagnostic-heading-coverage-v514-r6.test.ts:77 |
| STRICT_SINGLE_H1_NO_H1 | 缺少一级标题 | 错误 | 严格模式 + canonical H1 帧已就绪 + H1 数量为 0 | 单目标·文档开头 | 已注册·条件启用 | document-diagnostics.ts:2025-2037 | document-diagnostic-empty-short-circuit-v512-r6-7r3-11-8b99.test.ts:91 |
| STRICT_SINGLE_H1_MULTIPLE_H1 | 存在多余的一级标题 | 错误 | 严格模式 + canonical H1 帧已就绪 + H1 数量大于 1（定位第 2..N 个 H1） | 多目标（1…N） | 已注册·条件启用 | document-diagnostics.ts:2038-2069 | document-diagnostic-active-interaction-v514-r7.test.ts:404 |
| STRICT_FIRST_H1 | 首个内容块必须是一级标题 | 警告 | 严格模式 + 源码首内容块不是 H1；按 reason 生成 7 个具体代码 | 单目标·规范节点 | 已注册·条件启用 | document-diagnostics.ts:1996-2019 | heading-numbering/strict-first-h1-topline.test.ts |
| SECTION_EMPTY | 章节没有正文 | 提示 | 某标题到下一个同级或更高级标题之间既无正文也无子标题；文档整体非 bodyless 且标题行可解析 | 单目标·规范节点 | 已注册·执行 | document-diagnostics-vnext-authority.ts:211-234 | document-diagnostic-section-completeness-v1.test.ts |
| SECTION_ONLY_SUBHEADINGS | 章节仅包含子标题 | 提示 | 某标题的章节窗口内只有子标题、没有正文；文档整体非 bodyless 且标题行可解析 | 单目标·规范节点 | 已注册·执行 | document-diagnostics-vnext-authority.ts:211-234 | document-diagnostic-section-completeness-v1.test.ts |
| FRONTMATTER_UNCLOSED | Front Matter 未闭合 | 错误 | 文档首行是 --- 但缺少结束分隔符（frontMatter.closed = false） | 单目标·源码语法起始符 | 已注册·执行 | document-diagnostics.ts:1786-1804 | document-diagnostic-source-syntax-location-authority.test.ts:96 |
| FRONTMATTER_MALFORMED | Front Matter 格式不规范 | 警告 | 闭合 Front Matter 的保守 YAML 子集校验：Tab 缩进、顶层重复键、顶层缺冒号 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2006-2035；document-diagnostics-b2-authority.ts:44-100 | document-diagnostics-b2-rules.test.ts |
| BLOCKQUOTE_EMPTY | 引用块为空 | 提示 | 引用块只有 > 标记、没有任何非空内容行 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2832 | document-diagnostics-vnext-gap-closure-v1.test.ts:15 |

### 7.2 标题层级及编号（7 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LATENT_ATX_HEADING_MARKER | 检测到未转义的潜在标题标记「#…」 | 提示（strict 下为警告） | 源码行首存在未转义的 # 标记，但 Typora 未把它识别为标题；实际发射按级别拆成 6 个代码 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| HEADING_LEVEL_GAP | 标题层级存在跳级（H2 → H4） | 警告（strict 下为错误） | 下一标题物理层级大于上一标题层级 + 1（回退到更高级不算跳级） | 单目标·规范节点 | 已注册·执行 | document-diagnostics.ts:2563-2587 | document-diagnostics.test.ts |
| HEADING_EMPTY_TEXT | 标题为空 | 警告（strict 下为错误） | 标题文字 trim 后为空 | 单目标·规范节点 | 已注册·执行 | document-diagnostics.ts:2545-2557 | document-diagnostics.test.ts |
| HEADING_DUPLICATE_TEXT | 重复的标题文字「…」 | 警告 | 两个及以上标题的 trim 文字相同（大小写不敏感去重后） | 多目标（1…N） | 已注册·执行 | document-diagnostics.ts:2519-2543 | document-diagnostic-active-interaction-v514-r7.test.ts:267 |
| HEADING_DUPLICATE_IDENTITY | 标题规范身份重复 | 错误 | canonical heading frame 中同一 stableIdentity 出现两次及以上 | 单目标·规范节点 | 已注册·执行 | document-diagnostics.ts:2496-2505 | document-diagnostic-heading-coverage-v514-r6.test.ts:68 |
| HEADING_MANUAL_NUMBER_PREFIX | 标题包含手工编号 | 警告 | 标题自动编号功能开启（policy.enabled）且标题文字带手工编号；已被 AUTO_NUMBER_CONFLICT 的标题跳过 | 单目标·规范节点 | 已注册·条件启用 | document-diagnostics.ts:2317-2352 | document-diagnostics-heading-auto-number-conflict-v1.test.ts:21 |
| HEADING_AUTO_NUMBER_CONFLICT | 标题编号冲突 | 错误 | 标题自动编号全局开启 + 该标题的编号实际生效 + 源码标题带已确认的手工编号 | 单目标·规范节点 | 已注册·条件启用 | document-diagnostics.ts:2266-2308 | document-diagnostics-heading-auto-number-conflict-v1.test.ts:9 |

### 7.3 段落、空行与换行（1 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXCESSIVE_INTERNAL_BLANK_LINES | 连续空行过多 | 警告 | 两个兄弟内容块之间连续空行数 ≥ 2（阈值 2，不是 3；代码块/公式/Front Matter/HTML 内部空行不计） | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2421-2430; document-diagnostic-internal-blank-lines-v1.ts:54-57, 771 | document-diagnostic-active-gap-inheritance-r2.test.ts:22 |

### 7.4 图片及图片资源（10 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FIGURE_MISSING_NAME | 图片缺少图名 | 警告 | 统一图片源码 occurrence 的 alt 文本 trim 后为空（source-first；坏图也可命中） | 单目标·图片出现位置 | 已注册·执行 | document-diagnostics.ts:3004-3097 | document-diagnostics-v4-missing-image-source-first-7r3-11-8b80.test.ts |
| FIGURE_DUPLICATE_NAME | 重复的图名「…」 | 警告 | 两个及以上图片的图名（alt）相同（空名不参与） | 多目标（1…N） | 已注册·执行 | document-diagnostics.ts:2837-2850 | NONE（仅文案 / 排序测试） |
| FIGURE_LOCAL_IMAGE_MISSING | 本地图片不存在：<路径> | 警告 | 图片目标是本地相对路径且文件不存在（远程 / data URL 不参与；source-first + DOM fallback 去重） | 单目标·图片出现位置 | 已注册·执行 | document-diagnostics.ts:2860-2994, 3213-3257 | document-diagnostics-v4-missing-image-source-first-7r3-11-8b80.test.ts |
| FIGURE_IN_HEADING | 图片被插入标题 | 错误 | H1–H6 标题源码中存在真实图片 token（文字前/中/后、多图、仅图片、空路径）；优先级高于图文/多图混排 | 单目标·整个标题行 | 已注册·执行 | document-diagnostics.ts:3056-3123 | document-figure-heading-invariant-v1.test.ts |
| FIGURE_EMPTY_SOURCE | 图片路径为空 | 错误 | 图片 token 的目标为空 / 纯空白（`![]()` / `![alt]()` / `![alt](   )`），独立于结构修复 | 单目标·图片 token | 已注册·执行 | document-diagnostics.ts:3125-3158 | document-figure-heading-invariant-v1.test.ts |
| FIGURE_BLOCK_STRUCTURE_INVALID | 图片独立块结构异常 | 错误 | 图片 owning block 不满足独立块不变量，且未命中更具体的分类（通用兜底）；命中后抑制该块的普通图片规则 | 单目标·整个违规块 | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-standalone-object-block-invariant-v515.test.ts |
| FIGURE_IN_LIST | 图片被设置为列表项 | 错误 | 图片位于（无序 / 有序 / 任务）列表项中 | 单目标·整个列表 owning block | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_IN_QUOTE | 图片被设置为引用块 | 错误 | 图片位于（多层）引用块中 | 单目标·整个引用 owning block | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_IN_TABLE | 图片嵌入表格单元格 | 错误 | 图片 token 位于 GFM 表格行内（无法无损拆分） | 单目标·整个表格 owning block | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_MULTIPLE_SAME_BLOCK | 多张图片位于同一段落 | 错误 | 同一段落 owning block 内 ≥2 张图片 | 单目标·整个违规块 | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_TEXT_MIXED | 图片与正文位于同一段落 | 警告 | 同一段落 owning block 内图片与真实正文共存 | 单目标·整个违规块 | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_INLINE_FORMAT | 图片包含不允许的行内格式 | 警告 | 图片被 `**` / `*` / `__` / `_` / `~~` 直接包裹 | 单目标·整个违规块 | 已注册·执行 | document-diagnostics.ts:3017-3105 | document-figure-issue-classification-v1.test.ts |
| FIGURE_MANUAL_NUMBER_PREFIX | 图名包含手工编号 | 警告 | 图片自动编号开启 + 图片 alt 带手工编号 | 单目标·图片出现位置 | 已注册·条件启用 | document-diagnostics.ts:3103-3195 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:8 |
| FIGURE_ORPHAN_CAPTION | 图片题注没有对应对象 | 警告 | 图片题注投影存在，但无法通过 canonical owner map 绑定到图片对象 | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:152-166 | document-diagnostics-caption-integrity-v1.test.ts:22 |
| FIGURE_MULTIPLE_CAPTIONS | 图片存在多个题注 | 警告 | 同一图片 owner 绑定了多于 1 个题注（1 条诊断 / N 个成员） | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:198-223 | document-diagnostics-caption-integrity-v1.test.ts:21 |
| FIGURE_CAPTION_FORMAT_INVALID | 图片题注格式不规范 | 警告 | 图片题注标签无法由 buildObjectNumberingLabel 按规范格式精确复现 | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:174-192 | document-diagnostics-caption-integrity-v1.test.ts:20 |
| FIGURE_NUMBER_DUPLICATE | 图片编号重复 | 警告 | 编号服务开启 + 多个图片的 canonical 有效编号相同 | 目标组（1 行 / N 成员） | 已注册·条件启用 | document-diagnostics.ts:1260-1293 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:191 |
| FIGURE_NUMBER_ORDER_INVALID | 图片编号顺序异常 | 警告 | 编号服务开启 + 该类型全部对象都有编号事实 + 图片有效编号非严格递增 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:1295-1325 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:192 |

### 7.5 表格及表名（12 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TABLE_MISSING_NAME | 表格缺少表名 | 警告 | 表格语义名为空 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:3276-3287 | document-diagnostics.test.ts |
| TABLE_DUPLICATE_NAME | 重复的表名「…」 | 警告 | 两个及以上表格的语义名相同（空名不参与） | 多目标（1…N） | 已注册·执行 | document-diagnostics.ts:3262-3275 | NONE |
| TABLE_BLOCK_STRUCTURE_INVALID | 表格必须作为独立块插入 | 错误 | 表格 header/delimiter 行带列表项或引用块标记（源码解析证明非独立块） | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2682-2711 | document-diagnostics-vnext-gap-closure-v1.test.ts:10 |
| TABLE_EMPTY_CONTENT | 表格没有数据行 | 提示 | 表格只有表头行与分隔行，零数据行 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2803-2830 | document-diagnostics-vnext-gap-closure-v1.test.ts:14 |
| TABLE_HEADER_EMPTY | 表头单元格为空 | 提示 | 表头存在空白单元格 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1880-1892 | document-source-syntax-integrity-v3.test.ts:21 |
| TABLE_HEADER_DUPLICATE | 表头重复 | 警告 | 同一表头文字在同一表格中出现两次及以上 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1893-1909 | document-source-syntax-integrity-v3.test.ts:22 |
| TABLE_MANUAL_NUMBER_PREFIX | 表名包含手工编号 | 警告 | 表格自动编号开启 + 表名带手工编号 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:3394-3417 | document-diagnostics-locate-activation-v1.test.ts:300 |
| TABLE_NUMBER_DUPLICATE | 表格编号重复 | 警告 | 编号服务开启 + 多个表格 canonical 有效编号相同 | 目标组（1 行 / N 成员） | 已注册·条件启用 | document-diagnostics.ts:1260-1293 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:191 |
| TABLE_NUMBER_ORDER_INVALID | 表格编号顺序异常 | 警告 | 编号服务开启 + 编号事实完整 + 表格有效编号非严格递增 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:1295-1325 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:192 |
| TABLE_ORPHAN_CAPTION | 表格题注没有对应对象 | 警告 | 表格题注投影无法绑定到 canonical 表格 owner | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:152-166 | document-diagnostics-caption-integrity-v1.test.ts:25 |
| TABLE_MULTIPLE_CAPTIONS | 表格存在多个题注 | 警告 | 同一表格 owner 绑定多于 1 个题注 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:198-223 | document-diagnostics-caption-integrity-v1.test.ts:24 |
| TABLE_CAPTION_FORMAT_INVALID | 表格题注格式不规范 | 警告 | 表格题注标签不符合 canonical formatter 输出 | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:174-192 | document-diagnostics-caption-integrity-v1.test.ts:23 |

### 7.6 公式及公式编号（6 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FORMULA_DUPLICATE_VISIBLE_TAG | 公式编号重复 | 错误 | 同一公式宿主内可见编号标签去重后数量小于标签总数 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:3444-3456 | document-diagnostic-empty-short-circuit-v512-r6-7r3-11-8b99.test.ts:98 |
| FORMULA_BLOCK_STRUCTURE_INVALID | 公式必须作为独立块插入 | 错误 | 独立 $$ 公式块带列表项或引用块标记（空公式除外，归 FORMULA_EMPTY_CONTENT） | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2712-2743 | document-diagnostics-vnext-gap-closure-v1.test.ts:11 |
| FORMULA_EMPTY_CONTENT | 公式为空 | 提示 | $$ display formula 的内容（含跨行）trim 后为空 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2831 | document-diagnostics-vnext-gap-closure-v1.test.ts:14 |
| FORMULA_BLOCK_UNCLOSED | 公式块未闭合 | 错误 | $$ 公式块缺少结束分隔符 | 单目标·源码语法起始符 | 已注册·执行 | document-diagnostics.ts:1763-1782 | document-diagnostic-source-syntax-location-authority.test.ts:88 |
| FORMULA_NUMBER_ORDER_INVALID | 公式编号顺序异常 | 警告 | 编号服务开启 + 编号事实完整 + 公式有效编号非严格递增 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:1295-1325 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:17 |
| FORMULA_NUMBER_SECTION_MISMATCH | 公式编号章节不一致 | 警告 | 公式编号为章节作用域且编码章节号与该公式实际所在章节不同 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:1346-1366 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:17 |

### 7.7 代码块及语言声明（26 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CODE_MISSING_NAME | 代码块缺少名称 | 警告 | 代码块语义名为空 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:3305-3315 | document-diagnostics.test.ts |
| CODE_MISSING_LANGUAGE | 代码块缺少语言标识 | 警告 | 代码块语言标识 trim 后为空 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:3316-3330 | document-diagnostics.test.ts |
| CODE_DUPLICATE_NAME | 重复的代码名称「…」 | 警告 | 两个及以上代码块语义名相同（空名不参与） | 多目标（1…N） | 已注册·执行 | document-diagnostics.ts:3291-3304 | NONE |
| CODE_EMPTY_BLOCK | 代码块为空 | 提示 | fenced code block 内没有任何非空行 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:2802 | document-diagnostic-code-empty-block-generic-pipeline.test.ts:3 |
| CB001 | 代码开头空行过多 | 警告 | 代码开头连续空白逻辑行 ≥ 2 且整块并非全空 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:141-156 | content-block-toolbar-controller.test.ts:542 |
| CB002 | 代码末尾空行过多 | 警告 | 代码末尾连续空白逻辑行 ≥ 2 且整块并非全空 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:158-173 | content-block-toolbar-controller.test.ts:402 |
| CB003 | 代码正文空行过多 | 提示 | 代码正文（去掉首尾空白区）连续空行 ≥ 3 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:175-215 | document-diagnostic-code-block-v4.test.ts:39 |
| CB004 | 代码行尾有多余空格 | 提示 | 非空代码行末尾存在空格或 Tab | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:217-235 | document-diagnostic-code-block-v4.test.ts:44 |
| CB005 | 代码缩进混用 | 提示 | 同一行行首缩进同时包含空格与 Tab | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:236-249 | document-diagnostic-code-block-v4.test.ts:50 |
| CB006 | 代码含不可见字符 | 警告 | 代码行内含零宽 / 方向控制 / BOM / C0 控制字符 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:252-273 | document-diagnostic-code-block-v4.test.ts:56 |
| CB007 | 代码换行符混用 | 提示 | 同一代码块混用 CRLF 与 LF；B1 已接入 parseFencedCodeBlocks 的 rawText（原始换行） | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:275-293; document-diagnostics.ts:3352-3356 | document-diagnostic-code-block-v4.test.ts:62 |
| CB008 | 代码行过长 | 提示 | 代码行超过长度上限；需要 enableLongLine，生产器未传入，永不触发 | 单目标·规范块节点 | 已注册·不可达 | document-diagnostic-code-block-v4.ts:295-315, 33 | document-diagnostic-code-block-v4.test.ts:68 |
| CB009 | 空代码块带有题注 | 提示 | 代码文本恰为 1 个空行且该代码块存在题注（captionPresent） | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:317-328 | document-diagnostic-code-block-v4.test.ts:74 |
| CB010 | 代码块缺少语言标识 | 提示 | 缺少语言；需要 enableMissingLanguage，生产器未传入，永不触发（且与 CODE_MISSING_LANGUAGE 重复） | 单目标·规范块节点 | 已注册·不可达 | document-diagnostic-code-block-v4.ts:772-784; document-diagnostics.ts:3352-3356 | document-diagnostic-code-block-v4.test.ts:80 |
| CB101 | 代码使用全角括号 | 警告 | 非字符串 / 非注释代码区出现全角括号 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:686, 703-748 | content-block-toolbar-controller.test.ts:438 |
| CB102 | 代码使用全角逗号或分号 | 警告 | 非字符串 / 非注释代码区出现全角逗号或分号 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:689 | document-diagnostic-code-block-v4.test.ts:90 |
| CB103 | 代码使用全角冒号 | 警告 | 非字符串 / 非注释代码区出现全角冒号 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:692 | document-diagnostics.test.ts:420 |
| CB104 | 代码使用全角运算符 | 警告 | 非字符串 / 非注释代码区出现全角运算符或智能引号 | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:695 | document-diagnostic-code-block-v4.test.ts:120 |
| CB105 | 代码含全角标点 | 提示 | 非字符串 / 非注释代码区出现疑似输入法误输入的全角标点（low confidence） | 单目标·规范块节点 | 已注册·执行 | document-diagnostic-code-block-v4.ts:698 | document-diagnostic-code-block-v4.test.ts:125 |
| CODE_FENCE_UNCLOSED | 代码围栏未闭合 | 错误 | 代码围栏从开启行到 EOF 没有同字符、同长度的闭合围栏 | 单目标·源码语法起始符 | 已注册·执行 | document-diagnostics.ts:1740-1760 | document-diagnostic-source-syntax-location-authority.test.ts:74 |
| CODE_MANUAL_NUMBER_PREFIX | 代码块名称包含手工编号 | 警告 | 代码块自动编号开启 + 代码名称带手工编号 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:3418-3441 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:7 |
| CODE_NUMBER_DUPLICATE | 代码块编号重复 | 警告 | 编号服务开启 + 多个代码块 canonical 有效编号相同 | 目标组（1 行 / N 成员） | 已注册·条件启用 | document-diagnostics.ts:1260-1293 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:16 |
| CODE_NUMBER_ORDER_INVALID | 代码块编号顺序异常 | 警告 | 编号服务开启 + 编号事实完整 + 代码块有效编号非严格递增 | 单目标·规范块节点 | 已注册·条件启用 | document-diagnostics.ts:1295-1325 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:16 |
| CODE_ORPHAN_CAPTION | 代码块题注没有对应对象 | 警告 | 代码块题注投影无法绑定到 canonical 代码块 owner | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:152-166 | document-diagnostics-caption-integrity-v1.test.ts:19 |
| CODE_MULTIPLE_CAPTIONS | 代码块存在多个题注 | 警告 | 同一代码块 owner 绑定多于 1 个题注 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:198-223 | document-diagnostics-caption-integrity-v1.test.ts:18 |
| CODE_CAPTION_FORMAT_INVALID | 代码块题注格式不规范 | 警告 | 代码块题注标签不符合 canonical formatter 输出 | 单目标·题注投影 | 已注册·执行 | document-diagnostics-caption-integrity-v1.ts:174-192 | document-diagnostics-caption-integrity-v1.test.ts:17 |

### 7.8 链接与锚点（6 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LINK_LOCAL_TARGET_MISSING | 本地链接目标不存在：<路径> | 警告 | 非图片的本地相对链接目标文件不存在 | 单目标·规范块节点 | 已注册·执行 | document-diagnostics.ts:3468-3505 | document-diagnostic-locator-v2.test.ts |
| LINK_TEXT_EMPTY | 链接文字为空 | 提示 | 非图片 inline link 的可见文字 trim 后为空 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:1913-1924 | document-source-syntax-integrity-v3.test.ts:372 |
| LINK_TARGET_EMPTY | 链接目标为空 | 警告 | inline link 的目标地址 trim 后为空 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:1925-1933 | document-source-syntax-integrity-v3.test.ts:377 |
| LINK_LOCAL_ANCHOR_MISSING | 本地锚点不存在：#anchor | 警告 | 文档内 #anchor 无法匹配任何 canonical heading 的 DOM id；文档无 heading id 时整体静默 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:3559-3592 | document-diagnostics-numbering-anchor-integrity-v1.test.ts |
| LINK_LOCAL_FILE_ANCHOR_MISSING | 其他文件锚点无法校验（DEFERRED） | 警告 | 注册为 DEFERRED_BY_SPEC：跨文件锚点需要读取其他文件索引，生产器永不生成 | 单目标·源码范围 | 未接入（DEFERRED） | document-diagnostic-location.ts:928-932 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:22 |
| HEADING_ANCHOR_COLLISION | 标题锚点重复 | 警告 | 两个及以上 canonical heading 共享同一个渲染 id（1 条诊断 / 目标组） | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:3512-3554 | document-diagnostics-numbering-anchor-integrity-v1.test.ts |

### 7.9 引用与脚注（9 个家族）

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FOOTNOTE_REFERENCE_TARGET_MISSING | 脚注引用「label」缺少对应定义 | 警告 | 脚注引用标签存在，但同标签没有任何定义（有重复定义时不报） | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1823-1830 | document-source-syntax-integrity-v3.test.ts:14 |
| FOOTNOTE_DEFINITION_DUPLICATE | 脚注「label」存在 N 个重复定义 | 错误 | 同一脚注标签存在 2 个及以上定义 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1815-1822 | document-source-syntax-integrity-v3.test.ts:15 |
| FOOTNOTE_DEFINITION_UNUSED | 脚注定义「label」未被任何引用使用 | 提示 | 脚注定义存在，但正文没有任何引用 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:1831-1838 | document-source-syntax-integrity-v3.test.ts:16 |
| FOOTNOTE_DEFINITION_EMPTY | 脚注定义「label」内容为空 | 提示 | 唯一脚注定义的内容（含续行）为空 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:1840-1848 | document-source-syntax-integrity-v3.test.ts:17 |
| LINK_REFERENCE_DEFINITION_MISSING | 引用式链接「label」缺少对应定义 | 警告 | 引用式链接 [text][label] 存在，但 [label]: 定义不存在 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1868-1875 | document-source-syntax-integrity-v3.test.ts:18 |
| LINK_REFERENCE_DEFINITION_DUPLICATE | 引用式链接定义「label」存在 N 个重复定义 | 警告 | 同一引用标签存在 2 个及以上链接定义 | 目标组（1 行 / N 成员） | 已注册·执行 | document-diagnostics.ts:1860-1867 | document-source-syntax-integrity-v3.test.ts:19 |
| FIGURE_REFERENCE_TARGET_MISSING | 图片引用目标缺失 | 警告 | 注册为 DEFERRED_BY_SPEC：正文图片编号引用校验没有 canonical 引用解析器 | 单目标·源码范围 | 未接入（DEFERRED） | document-diagnostic-location.ts:939-943 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:304 |
| TABLE_REFERENCE_TARGET_MISSING | 表格引用目标缺失 | 警告 | 注册为 DEFERRED_BY_SPEC：正文表格编号引用校验没有 canonical 引用解析器 | 单目标·源码范围 | 未接入（DEFERRED） | document-diagnostic-location.ts:944-948 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:304 |
| FORMULA_REFERENCE_TARGET_MISSING | 公式引用目标缺失 | 警告 | 注册为 DEFERRED_BY_SPEC：正文公式编号引用校验没有 canonical 引用解析器 | 单目标·源码范围 | 未接入（DEFERRED） | document-diagnostic-location.ts:949-953 | document-diagnostics-numbering-anchor-integrity-v1.test.ts:304 |

### 7.10 STRICT_FIRST_H1 家族的 7 个具体代码

| 具体代码 | 中文标题 | 级别 | 触发条件（reason） | 定位 | 状态 | 源码 | 测试 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| STRICT_FIRST_H1_LEADING_PARAGRAPH | H1 前存在正文 | 警告（基准；strict 运行） | LEADING_PARAGRAPH：首个内容块是普通段落 | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_LEADING_EMPTY_LINE | H1 前存在空行 | 警告（基准；strict 运行） | LEADING_EMPTY_LINE：首行是空行 | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_LEADING_EMPTY_BLOCK | H1 前存在空段落 | 警告（基准；strict 运行） | LEADING_EMPTY_BLOCK：首行只有空白 | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_LEADING_OTHER_HEADING | H1 不是文档首项 | 警告（基准；strict 运行） | LEADING_OTHER_HEADING：首个内容是 H2–H6 | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_LEADING_OTHER_BLOCK | H1 前存在其他内容 | 警告（基准；strict 运行） | LEADING_OTHER_BLOCK：首个内容是引用 / 列表 / 围栏 / 表格 / 公式 / 图片 / 分隔线 / HTML | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_DOCUMENT_EMPTY | 文档缺少 H1 | 警告（基准；strict 运行） | DOCUMENT_EMPTY：空文档（生产器被空文档短路，不可达） | 单目标·规范节点 / 源码范围 | 不可达（见 5.3） | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |
| STRICT_FIRST_H1_SOURCE_UNAVAILABLE | 无法校验 H1 | 警告（基准；strict 运行） | SOURCE_UNAVAILABLE：markdown 为 null | 单目标·规范节点 / 源码范围 | 已注册·条件启用 | document-diagnostics.ts:1996-2019；strict-document-validator.ts:257-315 | strict-first-h1-topline.test.ts |

说明：7 个代码共用 familyId = STRICT_FIRST_H1，注册表 key 是 STRICT_FIRST_H1_POSITION（document-diagnostic-location.ts:595-612）。它们的 title 在 copy 表里逐码给出（document-diagnostic-copy-v1.ts:251-260）。

### 7.11 LATENT_ATX_HEADING_MARKER 家族的 6 个具体代码

| 具体代码 | 中文标题 | 级别 | 触发条件 | 定位 | 状态 | 源码 | 测试 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LATENT_ATX_HEADING_MARKER_LEVEL_1 | 检测到未转义的潜在标题标记「#」 | 提示（strict 下为警告） | 行首 # 未被 Typora 识别为 H1，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| LATENT_ATX_HEADING_MARKER_LEVEL_2 | 检测到未转义的潜在标题标记「##」 | 提示（strict 下为警告） | 行首 ## 未被 Typora 识别为 H2，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| LATENT_ATX_HEADING_MARKER_LEVEL_3 | 检测到未转义的潜在标题标记「###」 | 提示（strict 下为警告） | 行首 ### 未被 Typora 识别为 H3，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| LATENT_ATX_HEADING_MARKER_LEVEL_4 | 检测到未转义的潜在标题标记「####」 | 提示（strict 下为警告） | 行首 #### 未被 Typora 识别为 H4，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| LATENT_ATX_HEADING_MARKER_LEVEL_5 | 检测到未转义的潜在标题标记「#####」 | 提示（strict 下为警告） | 行首 ##### 未被 Typora 识别为 H5，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |
| LATENT_ATX_HEADING_MARKER_LEVEL_6 | 检测到未转义的潜在标题标记「######」 | 提示（strict 下为警告） | 行首 ###### 未被 Typora 识别为 H6，且该行不是规范标题 | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:2436-2479 | latent-atx-heading-marker.test.ts |

说明：PREFIX 策略在注册表里只保留一个 sentinel（document-diagnostic-location.ts:583-589, 1001-1006），运行期发射 LEVEL_1 … LEVEL_6。`LEVEL_n` 没有静态 copy title，UI 使用规范化后的动态 message 作为标题（document-diagnostic-copy-v1.ts:379-389），description / suggestion 仍来自 LATENT 家族文案。

### 7.12 B2 新增规则（6 个家族）

> 说明：7.1–7.11 是 B1 基线的 92 行明细；本表补齐 B2 新增的 6 个家族，合计 98。FRONTMATTER_MALFORMED 已在 7.1 更新为已执行。

| 规则 ID（家族） | 中文标题 | 级别 | 触发条件 | 定位方式 | 执行状态 | 源码位置 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TABLE_COLUMN_COUNT_MISMATCH | 表格列数不一致 | 警告 | 表头 / 分隔行 / 数据行的单元格数不一致（转义管道与代码跨度由唯一 tokenizer 处理） | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:3588-3622；document-diagnostics-b2-authority.ts:119-176 | document-diagnostics-b2-rules.test.ts |
| LIST_INDENTATION_INVALID | 列表缩进不一致 | 警告 | 列表项回退到从未出现过的缩进层级（父级 0、子级 2、下一项 1） | 单目标·源码范围 | 已注册·执行 | document-diagnostics.ts:3624-3654；document-diagnostics-b2-authority.ts:183-250 | document-diagnostics-b2-rules.test.ts |
| FORMULA_SOURCE_LENGTH_EXCEEDING | 公式源码过长 | 警告 | 显式配置 formulaSourceRules.lengthLimit 且公式源码（去空白/编号标记）超过上限 | 单目标·源码范围 | 已注册·默认关闭 | document-diagnostics.ts:3656-3685；document-diagnostics-b2-authority.ts:273-326 | document-diagnostics-b2-rules.test.ts |
| FORMULA_SOURCE_LINE_TOO_LONG | 公式单行过长 | 警告 | 显式配置 formulaSourceRules.lineLimit 且公式源码某行超过上限 | 单目标·源码范围 | 已注册·默认关闭 | document-diagnostics.ts:3686-3720；document-diagnostics-b2-authority.ts:273-326 | document-diagnostics-b2-rules.test.ts |
| FORMULA_RENDER_WIDTH_OVERFLOW | 公式渲染超宽 | 警告 | 运行时测量事实为 MEASURED 且 naturalWidth > availableWidth | 单目标·规范块节点 | 已注册·执行（无测量事实则 PENDING） | document-diagnostics.ts:3722-3762；document-diagnostics-b2-authority.ts:44-100 | document-diagnostics-b2-rules.test.ts |
| FORMULA_LATEX_RENDER_FAILED | 公式渲染失败 | 错误 | 运行时测量事实为 FAILED（数学渲染器明确失败） | 单目标·规范块节点 | 已注册·执行（无事实则 PENDING） | document-diagnostics.ts:3722-3762 | document-diagnostics-b2-rules.test.ts |

## 8. 重复与异常清单（B1 审计与修复记录）

本轮不删除、不合并、不降低任何规则；以下问题只记录。

### D01 两个“98”不是同一个集合（计数口径冲突）

- 现象：能力矩阵 RESOLVED_DIAGNOSTIC_CODE_COUNT=98；生产器 allow-list 也是 98；但两者集合不同。
- 证据：registry 98 = 90 EXACT（含 5 DEFERRED）+ 7 STRICT + 1 LATENT sentinel（document-diagnostic-runtime-closure-authority.ts:200-210）；生产器 98 = 85 IMPLEMENTED EXACT + 7 STRICT + 6 LATENT（document-diagnostics.ts:687-761）。实际差集：生产器多 6 个 LATENT LEVEL；官方多 5 个 DEFERRED + 1 个 LATENT sentinel。
- 影响：任何直接引用 98 的“覆盖率 / 规则数”结论都可能把 5 个未实现规则算进去，同时把 6 个真实 LATENT 代码折叠成 1 个 sentinel。

### D02 CB007 已接入真实原始换行（B1 修复）

- 修复：parseFencedCodeBlocks 现在同时返回 text（LF 归一，CodeMirror 语义）与 rawText（保留每行原始 \r），生产器把 rawText 传给 analyzeCodeBlockV4。
- 证据：content-block-toolbar-code-source.ts:14-31, 93-130；document-diagnostics.ts:3352-3356；行为测试 document-diagnostics-b1-reliability.test.ts CB007 两例。
- 结果：CB007 从“不可达”变为可达；全 CRLF 或全 LF 不误报，只有真正混用才触发。

### D03 CB008 注册为 IMPLEMENTED，但生产器永不触发

- 证据：CB008 只在 options.enableLongLine === true 时运行（document-diagnostic-code-block-v4.ts:295-315）；options 定义明确“默认关闭”（31-33）；生产器从不传该选项。
- 影响：同上。

### D04 CB010 注册为 IMPLEMENTED，但生产器永不触发，且与 CODE_MISSING_LANGUAGE 语义重复

- 证据：CB010 只在 options.enableMissingLanguage === true 时运行（document-diagnostic-code-block-v4.ts:772-784）；注释明确写“与既有 CODE_MISSING_LANGUAGE 重复，不默认启用”（772）；两者 copy title 都是“代码块缺少语言标识”（document-diagnostic-copy-v1.ts:304, 318）。
- 影响：规则家族数 +1，但运行期 0 触发；这是一条“设计上重复、注册上独立”的规则。

### D05 STRICT_FIRST_H1_DOCUMENT_EMPTY 不可达

- 证据：空文档在 computeDocumentDiagnostics 顶部直接返回 DOCUMENT_EMPTY（document-diagnostics.ts:1950-1956）；无 documentKey 时走 DOCUMENT_INACTIVE（1985-1991）；首 H1 检查只在有 documentKey 且非空文档的分支运行（1996-2019）。validateStrictFirstH1Topline 的 DOCUMENT_EMPTY reason 确实存在（strict-document-validator.ts:257-263），但诊断生产器到不了。
- 影响：7 个 STRICT 代码里 1 个是死代码。

### D06 编号完整性 4 条定位契约已对齐（B1 修复）

- 修复：注册表把 FIGURE_NUMBER_DUPLICATE / TABLE_NUMBER_DUPLICATE / CODE_NUMBER_DUPLICATE 声明为 target-group，把 FIGURE_NUMBER_ORDER_INVALID 声明为 block-node，与生产器实际 location 一致。
- 证据：document-diagnostic-location.ts:879-910；document-diagnostics.ts:1274-1291, 1320；document-diagnostics-numbering-integrity-v2.test.ts 断言 location.kind。
- 影响：注册表、能力矩阵和运行期定位类型不再互相矛盾。

### D07 顶部状态方块与 Toolbar 使用不同计数来源

- 现象：Toolbar 的 Error/Warning/Hint 数来自 deriveDocumentProblemsProjection，按“诊断条数”统计（document-problems-projection.ts:42-50）；顶部状态方块来自 flattenDiagnosticsToProjections 后的“投影行数”，multi-target 诊断会展开成 N 行（document-utility-overlay-host.ts:22931-22972；document-diagnostic-drawer-order-v514-r1.ts:232-264）。
- 影响：只有 multi-target 规则（HEADING_DUPLICATE_TEXT、STRICT_SINGLE_H1_MULTIPLE_H1、FIGURE/TABLE/CODE_DUPLICATE_NAME）触发且目标数 > 1 时，两处数字不同；颜色通常一致，但“警告 N”会不一致。
- 证据边界：两者都来自同一个已准入 snapshot，不是“不同 snapshot”；问题在“条数 vs 行数”的计数口径。

### D08 strictPolicyActive 已接入门控（B1 修复）

- 修复：computeDocumentDiagnostics 使用 `input.strictPolicyActive ?? input.strictMode` 作为 strict-only 规则门控；strictMode 仍只决定严重程度。
- 证据：document-diagnostics.ts:1982-1987；document-diagnostics-authority.ts:626-628；行为测试 document-diagnostics-b1-reliability.test.ts 两例。
- 影响：当严格策略未激活但 effective mode 仍是 strict 时，STRICT_FIRST_H1 / STRICT_SINGLE_H1 不再误运行。

### D09 captionDuplicateNames 是死输入字段

- 证据：DocumentDiagnosticsInput 声明 captionDuplicateNames（document-diagnostics.ts:492），但生产器从未读取；document-utilities.ts 的 provider 永远返回 []（document-utilities.ts:345-350）。
- 影响：题注重名检测实际由 FIGURE/TABLE/CODE_DUPLICATE_NAME 在对象命名层完成，这个字段没有贡献；它是一个未接入的残留接口。

### D10 PROJECT_TERMINAL_NEWLINE_MISSING 兼容映射已清理（B1）

- 修复：从 DOCUMENT_DIAGNOSTIC_RULE_PRIORITY 删除未注册、不生成的 PROJECT_TERMINAL_NEWLINE_MISSING。
- 证据：document-diagnostic-copy-v1.ts:99-102（删除后优先级表）；注册表从未包含该 key。
- 影响：优先级表的 code 集合不再比注册表多 1。

### D11 重复名称规则已补行为测试（B1 修复）

- 修复：新增 document-diagnostics-b1-reliability.test.ts，覆盖图/表/代码重复名称的真实诊断、warning 级别、multi-target 目标与 block identity。
- 证据：该测试文件三例；能力矩阵的 Static Test 从 NONE 变为 TARGETED（TABLE_DUPLICATE_NAME / CODE_DUPLICATE_NAME）。
- 结果：三条重名规则不再只有文案/排序测试。

### D12 空行阈值注释已对齐（B1）

- 修复：document-diagnostics.ts:353 注释从“3+”改为“2+”。
- 证据：INTERNAL_BLANK_LINE_POLICY.warningThreshold = 2（document-diagnostic-internal-blank-lines-v1.ts:54-57），判断 actualBlankLines >= 2（771）；copy 表也按 2 生成（document-diagnostic-copy-v1.ts:264）。
- 结果：实现、注释、文案三者一致。

### D13 旧第一 H1 实现与旧 code 名残留（B1 部分清理）

- 旧实现：validateStrictFirstH1 仍返回 ruleId = STRICT-FIRST-H1、severity = error，但已标记 @deprecated，且生产诊断只 import validateStrictFirstH1Topline（document-diagnostics.ts:9；heading-numbering-service.ts:94-100）。保留函数是为了不删除其历史测试。
- 旧 code 名：LINK_LOCAL_TARGET_NOT_FOUND 已从 locator fixture 改为现行 LINK_LOCAL_TARGET_MISSING；STRICT_H1_MISSING 已从两个测试判断和 authority 审计中删除（document-diagnostics-authority.ts:619-621）。
- 影响：grep 不再出现旧 code 名；旧实现仍明确标注为 legacy、无生产调用者。

### D14 有证据的同根因双报 / 重叠

- source unavailable（B1 修复）：strict first-H1 已经证明 SOURCE_UNAVAILABLE 时，通用 DOCUMENT_SOURCE_UNAVAILABLE 被抑制；未激活 strict policy 时通用提示仍保留（document-diagnostics.ts:1997-2029, 2497-2505；行为测试 document-diagnostics-b1-reliability.test.ts）。
- 空代码块：CODE_EMPTY_BLOCK（document-diagnostics.ts:2802）与 CB009（document-diagnostic-code-block-v4.ts:317-328）会在“完全空且有题注”的同一代码块上同时触发；dedup key 含 code，因此两条都会保留。
- 表格空内容与空表头：TABLE_EMPTY_CONTENT（2803-2830）与 TABLE_HEADER_EMPTY（1880-1892）可在同一张“只有表头且表头为空”的表上同时触发；它们描述不同事实，未做抑制。
- 已正确抑制的重叠（反例，证明不是所有相似规则都重复）：FIGURE_BLOCK_STRUCTURE_INVALID 命中后抑制 FIGURE_MISSING_NAME / FIGURE_LOCAL_IMAGE_MISSING（3007-3010, 2864-2865）；HEADING_AUTO_NUMBER_CONFLICT 命中后抑制同一标题的 HEADING_MANUAL_NUMBER_PREFIX（2317-2320）；脚注重复定义时不报同标签的引用缺失（1815-1830）。

### D15 运行时证据过期

- 证据：runtime evidence 的 mainSha256 = 817B7327EE102AA132EB0B3E91311274DC30EE9729DE002977D45E6DB3652BC1；当前 dist/main.js = 7BB0DF417B3C912CC66E84FA56260CF7A34A811417D1E8AA9549124987A53312。
- 影响：该证据不能证明当前构建；能力矩阵因此 0 CLOSED / 87 UNVERIFIED。

### D16 严重级别的“注册表基准”容易误导

- 证据：registry 固定 HEADING_LEVEL_GAP / HEADING_EMPTY_TEXT = warning、LATENT = info（document-diagnostic-location.ts:320-385），但运行期 strict 下分别是 error / error / warning（document-diagnostics.ts:296-299, 416）。
- 影响：能力矩阵的 ERROR_FAMILY_COUNT=12 / HINT_FAMILY_COUNT=24 只在 loose 基准下成立；strict 下是 14 / 23。这不是 bug，但任何“多少错误规则”的回答必须说明模式。

## 9. 检测覆盖评价

### 9.1 已经覆盖的 Markdown 内容

- 文档级：空文档、源码不可用、无活动文档、EOF 终止换行、EOF 多余空行、内部连续空行、首 H1 / 唯一 H1、标题结构完整性、Front Matter 未闭合、空引用块。
- 标题：跳级、空标题、重复文字、重复规范身份、潜在 ATX、手工编号、自动编号冲突、章节无正文 / 仅子标题。
- 图片：图名缺失 / 重复、本地资源缺失、非独立块、手工编号、题注孤立 / 多题注 / 格式、编号重复 / 顺序。
- 表格：表名缺失 / 重复、非独立块、空表、空表头 / 重复表头、手工编号、编号重复 / 顺序、题注孤立 / 多题注 / 格式。
- 公式：重复可见编号、非独立块、空公式、未闭合、编号顺序、章节不一致。
- 代码：名称 / 语言缺失、重名、空块、未闭合围栏、15 条格式与全角标点 lint（实际可达 13 条：CB007 已接入，CB008/CB010 默认关闭）、手工编号、编号重复 / 顺序、题注孤立 / 多题注 / 格式。
- 链接 / 锚点：本地链接目标缺失、空链接文字 / 目标、文档内锚点缺失、标题锚点冲突。
- 脚注 / 引用：脚注引用缺定义、定义重复 / 未用 / 空、引用式链接定义缺失 / 重复。

### 9.2 明确缺口（尚未实现）

以下缺口是根据“现有注册表 + 生产器”反推的，不是凭空新增规则：

- YAML Front Matter 语法校验：FRONTMATTER_MALFORMED 仍是 DEFERRED_BY_SPEC，仓库没有 canonical YAML 解析器。
- 跨文件锚点校验：LINK_LOCAL_FILE_ANCHOR_MISSING 是 DEFERRED_BY_SPEC。
- 正文交叉引用（图片 / 表格 / 公式编号引用是否存在）：3 条 *_REFERENCE_TARGET_MISSING 全部 DEFERRED_BY_SPEC。
- 远程链接可达性 / HTTP 状态：代码明确禁止网络（LINK_LOCAL_TARGET_MISSING 只做本地相对路径）。
- 图片资源层面：图片尺寸、格式、重复图片（同图多处）、alt 语义质量、远程图片可达性均无规则。
- 表格结构层面：列数一致性、对齐方式、单元格跨行 / 跨列、表格宽度均无规则。
- 代码语义层面：语法错误、语言合法性、代码块语言与实际内容不匹配均无规则（现有 CB 只做格式 / 标点）。
- 公式语义层面：LaTeX 语法合法性、公式引用编号一致性（题注显示编号 vs 有效编号）无规则。
- 列表 / HTML：列表层级、列表缩进、HTML 块合法性无规则。
- 文档级换行风格：CRLF / LF 混用只在 CB007 中考虑（且不可达），没有文档级规则。
- 标题自动编号连续性：现有规则只查手工编号冲突 / 编号重复 / 顺序，未查自动编号是否连续、层级是否合法。
- 表格 / 公式题注缺失：TABLE_MISSING_NAME / CODE_MISSING_NAME 覆盖对象名称，FORMULA 没有对应的“公式缺少名称 / 题注”规则。

### 9.3 已有实现但尚未验证

- 87 个 IMPLEMENTED 家族的 runtime closure 全部 UNVERIFIED：缺少与当前构建 SHA 一致的真实运行时证据。
- CB008 / CB010：有实现代码，但默认关闭（CB010 与 CODE_MISSING_LANGUAGE 重复），属于“已实现但默认不启用”。
- 5 个 DEFERRED：有注册和文案，但没有生产器，属于“未实现”。

### 9.4 评价边界

本报告只评价“现有规则覆盖什么”。没有把“应该有什么规则”写成已实现规则，也没有把“当前文档没有触发”当成“规则未启用”。

## 10. 结论

**当前墨章文档诊断总计 92 个规则家族、103 个具体诊断代码，其中错误 12 个、警告 62 个、提示 29 个，另有其他类别 0 个。**

补充口径：

- 项目官方 resolved code 口径是 98（LATENT 前缀折叠为 1 个 sentinel，含 5 个 DEFERRED）；若按该口径，严重程度是错误 12 / 警告 57 / 提示 29。
- 有生产器路径的代码 98；当前固定选项下真正可达 95（错误 12 / 警告 56 / 提示 27）。
- 85 个家族已接入生产器且非默认关闭（69 个无条件 + 16 个条件启用）；2 个已注册但默认关闭；5 个未接入。
- 86 个家族在运行期能产生非空 location；1 个（DOCUMENT_EMPTY）声明不可定位；5 个无生产器。
- 87 个 IMPLEMENTED 家族的运行时执行证据均为 UNVERIFIED（0 CLOSED）；唯一一条运行时证据与当前构建 SHA 不一致。

有证据的主要异常与 B1 处置：两个“98”集合不同（D01，保留为口径差异并新增代码集合审计）、CB007 已接入（D02）、CB008/CB010 默认关闭（D03–D04）、STRICT_FIRST_H1_DOCUMENT_EMPTY 不可达（D05）、4 条编号定位契约已对齐（D06）、状态方块与 Toolbar 计数口径已统一为事件数（D07）、strictPolicyActive 已接入门控（D08）、captionDuplicateNames 标记 legacy（D09）、兼容映射已清理（D10）、重名规则已补行为测试（D11）、空行注释已对齐（D12）、旧实现/旧 code 名已清理或标记（D13）、同根因 source-unavailable 双报已抑制（D14）、运行时证据仍过期（D15）、基准级别与 strict 级别差异保留（D16）。

## 附录 A：验证命令与结果

| 命令 | 结果 |
| --- | --- |
| node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json | 通过，exit 0，无诊断 |
| node node_modules/vitest/vitest.mjs run <15 个诊断定向测试文件> | 15 个测试文件、405 个测试全部通过，13.06s |
| node node_modules/vitest/vitest.mjs run src/document-utilities src/heading-numbering | 266 个测试文件、5187 个测试全部通过，116.92s |

定向测试文件清单：document-diagnostics.test.ts、document-diagnostic-capability-summary.test.ts、document-diagnostic-runtime-closure-authority-v2.test.ts、document-diagnostics-vnext-gap-closure-v1.test.ts、document-diagnostics-caption-integrity-v1.test.ts、document-diagnostic-code-block-v4.test.ts、document-source-syntax-integrity-v3.test.ts、document-diagnostic-internal-blank-lines-v1.test.ts、document-diagnostic-heading-only-hint-v1.test.ts、document-diagnostics-numbering-integrity-v2.test.ts、document-diagnostic-copy-v1.test.ts、document-diagnostic-locator-v1.test.ts、document-diagnostic-locator-v2.test.ts、document-diagnostics-target-group-v1.test.ts、document-diagnostics-toolbar-severity-summary-v1.test.ts。

## 附录 B：检查过的主要源码文件

- src/document-utilities/document-diagnostics.ts — 纯生产器、severity 策略、去重、EOF、编号完整性、源语法完整性
- src/document-utilities/document-diagnostics-authority.ts — 运行时 authority、caption 合并、recompute
- src/document-utilities/document-diagnostic-location.ts — 规则注册表 92 项、定位策略、PUBLISHED=LOCATABLE 契约
- src/document-utilities/document-diagnostic-copy-v1.ts — 标题 / 描述 / 建议 / 优先级映射
- src/document-utilities/document-diagnostic-drawer-order-v514-r1.ts — 投影展开（multi-target / target-group）
- src/document-utilities/diagnostics-types.ts — 诊断模型、severity 类型、location 类型
- src/document-utilities/document-status-indicator.ts — 状态方块颜色与计数
- src/document-utilities/document-problems-projection.ts — Toolbar 计数投影
- src/document-utilities/diagnostic-domain-v1.ts — document / runtime 域分离与计数
- src/document-utilities/document-utility-overlay-host.ts — Drawer / 定位 / 状态方块 / Toolbar 消费
- src/document-utilities/document-diagnostics-caption-integrity-v1.ts — 9 条题注规则生产器
- src/document-utilities/document-diagnostics-vnext-authority.ts — 章节完整性、手工编号、表/公式结构、空对象
- src/document-utilities/document-diagnostic-internal-blank-lines-v1.ts — 内部空行阈值与 gap 分析
- src/document-utilities/document-diagnostic-code-block-v4.ts — CB001–CB105 规则与选项
- src/document-utilities/document-source-syntax-authority.ts — 围栏 / 公式 / Front Matter 状态机
- src/document-utilities/document-definition-reference-index.ts — 脚注 / 引用式链接索引
- src/document-utilities/document-inline-link-authority.ts — inline link 文字 / 目标
- src/document-utilities/document-utilities-context.ts — collectDiagnosticsInput 与编号 / 严格策略输入
- src/document-utilities/document-utilities.ts — provider 接线与 canonicalDuplicateIdentities
- src/document-utilities/document-diagnostic-capability-summary.ts — 能力矩阵派生
- src/document-utilities/document-diagnostic-runtime-closure-authority.ts — 冻结基线 92/98 与 UNVERIFIED
- src/document-utilities/document-diagnostic-static-test-manifest.ts — 静态测试清单
- src/heading-numbering/strict-document-validator.ts — 新旧两个第一 H1 实现
- src/heading-numbering/caption-service.ts — 题注完整性 / 编号事实 provider
- src/main.ts — provider 接线（caption / numbering / policy）

## 附录 C：统计可重复性与一次性只读脚本

本轮使用了四个一次性只读脚本（位于项目根目录，审计结束后全部删除，不进入版本库）：

- 规则枚举脚本：用 esbuild 打包 document-diagnostic-location.ts / document-diagnostics.ts / document-diagnostic-copy-v1.ts / caption-integrity / runtime-closure-authority，输出 92 个家族的 familyId、ruleId、category、area、scope、severity、locationStrategy、implementationStatus、runtimeCodes、copy；并输出 PRODUCED_DIAGNOSTIC_CODES 与 registry resolved codes 的差集。
- 测试覆盖脚本：扫描全部 *.test.ts，对每个家族匹配 familyId / ruleId / runtime code / *_CODE 常量，输出对应测试文件；再用偏好规则排除能力矩阵 / 闭包 / copy 等元测试，得到明细表中的“首个非元测试文件”。
- 未登记代码扫描脚本：从全部测试中提取 code: / code === 形式的大写代码，与 registry + 生产器 allow-list 比对，确认没有“仅测试存在”的注册规则；检出的旧 code 名见 D13。
- 报告生成脚本：把上述 JSON 与人工核对的触发条件 / 源码行号合并，生成这份 Markdown，并对 92 行明细做 familyId 集合校验。

复算校验：

- 92 个家族 familyId 无重复；
- 家族 severity 合计 12 + 56 + 24 = 92；
- 具体代码合计 103；主表 9 类家族 15+7+1+10+12+6+26+6+9 = 92；代码 21+12+1+10+12+6+26+6+9 = 103；
- area 表 11 类家族 10+1+8+5+4+5+19+3+22+6+9 = 92；代码 16+1+8+10+4+5+19+3+22+6+9 = 103；
- 定位表 73 + 5 + 14 = 92；
- 执行状态 69 + 16 + 2 + 5 = 92。

路径核对：报告引用的 79 个 .ts 文件路径全部实际存在（唯一匹配到的 test.ts 是“*.test.ts”通配描述，不是文件引用）。

## 附录 D：测试覆盖缺口

| 家族 | 问题 |
| --- | --- |
| TABLE_DUPLICATE_NAME | 全仓测试没有引用该 code 或常量；能力矩阵 Static Test = NONE |
| CODE_DUPLICATE_NAME | 同上 |
| FIGURE_DUPLICATE_NAME | 只有 copy 文案测试与排序测试，没有“产生诊断”的行为测试 |
| CB007 / CB008 / CB010 | 有测试，但生产器不可达；测试覆盖的是分析器 / 代码块工具，不是诊断生产路径 |
| 5 个 DEFERRED 家族 | 没有生产器；能力矩阵按 DEFERRED 处理，不需要 targeted test |

其余 85 个家族至少有一个测试文件引用其家族 / 代码（覆盖率 90 / 92，含 2 个零引用）。


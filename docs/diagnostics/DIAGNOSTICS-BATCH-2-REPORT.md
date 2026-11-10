# 诊断三批次 — B2 规则扩展验收报告

> 分支：`feature/diagnostics-b2-rule-expansion`
> 基线：`main` @ `f71d16b43aa9f0d94743e482d598541c5c365b5e`（B1 合并 + 日志提交后）
> 时间：2026-11-10（Etc/GMT-8）
> 范围：只改受控源码、测试和诊断文档；未修改 Typora、社区框架、用户 Markdown 或真实用户配置。

## 1. 批次状态

| 项 | 状态 | 说明 |
|---|---|---|
| B2-01 五条 DEFERRED | **PARTIAL / 1 PASS + 3 BLOCKED + 1 接口就绪** | FRONTMATTER_MALFORMED 已实现；跨文件 anchor 三态接口已实现并测试；文件锚点/3 条交叉引用仍缺 canonical authority |
| B2-02 表格结构 | PASS（列数 + 对齐） | TABLE_COLUMN_COUNT_MISMATCH 与 TABLE_ALIGNMENT_INVALID 均已实现；对齐规则针对松 delimiter 识别下的非法 cell |
| B2-03 列表结构 | PASS（缩进） / TODO（标记/序号） | LIST_INDENTATION_INVALID 已实现；混合标记、非 1 起始有序列表都是合法 Markdown，未误报 |
| B2-04 标题/编号 | PASS（序列） | 使用 canonical heading effective display path 的 HEADING_NUMBER_SEQUENCE_INVALID；未重推导编号 |
| B2-05 图片资源 | PARTIAL（扩展名） | FIGURE_IMAGE_FORMAT_UNSUPPORTED 只对显式非图片扩展名；格式/重复内容需 file-info provider |
| B2-06 公式 | PARTIAL | 源码长度、单行长度、渲染宽度、渲染失败已实现；高度可选规则未做（默认关闭） |
| B2-07 注册/测试/能力矩阵 | PASS（已实现项） | 10 条规则完成注册、文案、定位、测试；能力矩阵计数更新 |
| 全量测试 / 类型 / 构建 | SEE §5 | — |

**结论：B2 的实现范围（10 条规则）通过代码与测试门禁；4 条 DEFERRED（其中跨文件 anchor 接口已就绪）与若干可选规则保持 BLOCKED，不能宣称 B2 全合同 PASS。**

## 2. 规则总数（B2 后）

| 口径 | 数值 |
|---|---:|
| 规则家族 | 101 |
| 注册表解析代码 | 107 |
| 展开后的具体代码 | 112 |
| 有生产器路径的代码 | 108 |
| 真正可达的代码 | 103 |
| DEFERRED 家族 | 4（全部 BLOCKED） |
| 默认关闭家族 | 4（CB008、CB010、两条公式源码规则） |
| 错误 / 警告 / 提示（家族） | 13 / 64 / 24 |
| 错误 / 警告 / 提示（112 代码） | 13 / 70 / 29 |
| 可达 103 代码 | 13 / 63 / 27 |
| strict 可达 103 代码 | 15 / 67 / 21 |

集合守恒由 `document-diagnostic-code-sets.test.ts` 断言：108 个生产器代码 = 103 可达 + 4 默认关闭 + 1 已知不可达；112 展开代码 − 108 生产器代码 = 4 个 DEFERRED 代码。

## 3. 已实现规则

### 3.1 FRONTMATTER_MALFORMED（B2-01）

- 级别：警告；定位：source-range。
- 触发：CLOSED Front Matter 的保守 YAML 子集校验：Tab 缩进、顶层重复键、顶层缺冒号。
- 不触发：缩进映射/序列、块标量、注释、合法键值。
- 抑制：FRONTMATTER_UNCLOSED 时不产生 MALFORMED。
- 源码：`document-diagnostics-b2-authority.ts:44-100`；`document-diagnostics.ts:2006-2035`。
- 测试：`document-diagnostics-b2-rules.test.ts` 四例。

### 3.2 TABLE_COLUMN_COUNT_MISMATCH（B2-02）

- 级别：警告；定位：source-range。
- 触发：表头、分隔行或任一数据行的单元格数不一致；每张表只报第一处根因。
- 反误报：转义管道 `\|`、行内代码由唯一 table tokenizer 处理；围栏内的“表”不参与。
- 源码：`document-diagnostics-b2-authority.ts:119-176`；`document-diagnostics.ts:3588-3622`。
- 测试：三例（少列、转义管道、代码围栏）。

### 3.2b TABLE_ALIGNMENT_INVALID（B2d）

- 规则：TABLE_ALIGNMENT_INVALID；级别：警告；定位：source-range。
- 触发：表格识别器使用松 `[\s:|-]+` delimiter 语法，非法 cell（如 `::`）仍被识别为表格；该规则逐单元格校验 `^\s*:?-+:?\s*$`。
- 不触发：合法 `---` / `:---` / `---:` / `:---:`；fenced code 内伪表格由 `isRangeProtected` 排除。
- 每个表格只报第一个非法单元格（根因优先）。
- 测试：`document-diagnostics-b2-rules.test.ts` 三例。

### 3.3 LIST_INDENTATION_INVALID（B2-03）

- 级别：警告；定位：source-range。
- 触发：列表项回退到一个从未出现过的缩进层级（父 0、子 2、下一项 1）。
- 反误报：合法 1–3 空格子级、混合标记、非 1 起始的有序列表都不报。
- 源码：`document-diagnostics-b2-authority.ts:183-250`；`document-diagnostics.ts:3624-3654`。
- 测试：三例。

### 3.4 标题编号序列（B2b）

- 规则：HEADING_NUMBER_SEQUENCE_INVALID；级别：警告；定位：canonical-node。
- 触发：canonical heading 的 `counted=true` 且 `displayCountedPath` 在同层级跳号/重复（如 1.1 → 1.3）。
- 不触发：未 counted 的标题；层级跳级由 HEADING_LEVEL_GAP 拥有并重置序列基线，不双报。
- 源码：`document-h1-authority-bridge.ts:112-120`；`document-diagnostics.ts:2856-2899`。
- 测试：`document-diagnostics-b2-rules.test.ts` 四例（跳号、连续、未 counted、层级跳级）。

### 3.5 图片格式（B2c）

- 规则：FIGURE_IMAGE_FORMAT_UNSUPPORTED；级别：警告；定位：source-range。
- 触发：图片语法目标路径的扩展名明确属于非图片集合（pdf/docx/zip/md/txt/json/html/js/ts/css 等）。
- 不触发：无扩展名、未知/新图片扩展名、远程/data URL；不使用 allow-list 猜测。
- 源码：`document-diagnostics-b2-authority.ts`（NON_IMAGE_FILE_EXTENSIONS / detectNonImageDestination）；`document-diagnostics.ts` B2c 段。
- 测试：`document-diagnostics-b2-rules.test.ts` 两例（.pdf 触发；png/avif/remote/data/无扩展不触发）。

### 3.6 公式规则（B2-06）

| 规则 | 级别 | 默认 | 触发 |
|---|---|---|---|
| FORMULA_SOURCE_LENGTH_EXCEEDING | 警告 | 关闭 | 显式 lengthLimit，公式源码字符数超限 |
| FORMULA_SOURCE_LINE_TOO_LONG | 警告 | 关闭 | 显式 lineLimit，公式源码单行超限 |
| FORMULA_RENDER_WIDTH_OVERFLOW | 警告 | 开启（需测量事实） | naturalWidth > availableWidth |
| FORMULA_LATEX_RENDER_FAILED | 错误 | 开启（需失败事实） | 数学渲染器明确 FAILED |

- 源码长度排除 `\tag{...}` 与空白，按 Unicode code point 计数。
- 宽度/失败只消费 `FormulaRenderFact`：`MEASURED` 且两个宽度有限才判断；`PENDING` / 缺失不判断；`FAILED` 必须来自渲染器。
- 运行时：`DocumentDiagnosticsAuthority` 从公式 host 内部的 math 内容测量 naturalWidth / availableWidth；`clientWidth=0` 或 jsdom 无布局 → PENDING。
- 源码：`document-diagnostics-b2-authority.ts:273-326`；`document-diagnostics.ts:3656-3762`；`document-diagnostics-authority.ts:1440-1475`。
- 测试：五例（默认关闭、显式长度、单行、宽度、失败/PENDING）。

## 4. BLOCKED / 未实现（有证据）

### 4.1 LINK_LOCAL_FILE_ANCHOR_MISSING（BLOCKED）

- 需要：跨文件 heading id / slug 的 canonical authority，且必须与 Typora 渲染的 id 一致。
- 现状：仓库没有可复用的 Typora slugifier；`outline-numbering-adapter` 只匹配已渲染 DOM，不能对未打开文件生成 anchor。
- 不做：用文件名或正则猜 anchor（会造成跨文件误报）。
- 解除条件：提供 `resolveLocalFileAnchor(path, anchor): EXISTS | MISSING | UNKNOWN` 的 canonical provider，并在 UNKNOWN 时静默。

### 4.2 FIGURE / TABLE / FORMULA_REFERENCE_TARGET_MISSING（3 条，BLOCKED）

- 需要：Typora 当前支持且有明确定义的“正文对象引用”语法，以及规范对象标识（figure/table/formula 的有效编号）。
- 现状：Typora 的跨引用是 `[text](#heading-id)` 的 heading anchor；图表公式没有可引用的稳定 anchor，仓库也没有 cross-reference parser。
- 不做：把自然语言“图 1-1”当引用扫描（任务书明确禁止）。
- 解除条件：定义并实现规范的引用语法（例如显式对象引用链接），再由同一个 parser 解析 Markdown 源与有效编号。

### 4.3 TABLE_ALIGNMENT_INVALID（已解除，B2d）

- 已证明松 delimiter 识别下 `::` 是独立于列数/块结构的语法缺陷；已实现并测试。
- 不再 BLOCKED。

- 现状：GFM delimiter 必须满足 `:?-+:?` 才会被识别为表格；非法 alignment 已被 `parseDocumentSourceTables` 排除，不构成“表格内的列对齐错误”。
- 不做：对任意 `:` 位置做猜测。
- 解除条件：提供 canonical table parser 的 alignment 结果。

### 4.4 HEADING_NUMBER_SEQUENCE_INVALID（已由 B2b 实现）

- 已使用 canonical heading `counted` + `displayCountedPath`；不再 BLOCKED。
- 不按标题文本/序号字符串自行推导。

### 4.5 图片字节级格式 / 重复内容（BLOCKED）

- 已实现：显式非图片扩展名（FIGURE_IMAGE_FORMAT_UNSUPPORTED）。
- 字节级格式/重复内容需要异步 ImageEvidenceProvider；诊断同步 compute 不能 await `sha256File`/索引，见 `DIAGNOSTICS-B2B3-UNBLOCK-AUDIT.md` §4。

- 需要：可靠的文件/字节/尺寸信息（格式、重复内容）。
- 现状：没有 image file-info provider；按扩展名猜格式会误报（如 avif/webp/无扩展名）。
- 不做：修改图片、上传/下载、读私有路径。

### 4.6 FORMULA_RENDER_HEIGHT_EXCEEDING（未做）

- 任务书列为可选、默认关闭；当前没有高度配置/版心模型，B3 再评估。

## 5. 验证

| 命令 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | PASS，exit 0 |
| B2 规则定向测试 | 14 tests PASS |
| 计数/能力/闭包测试 | 84 tests PASS（6 文件） |
| 全量 Vitest | PASS，336 文件 / 5878 tests，189.21s |
| 生产构建 | PASS，`dist/main.js` SHA256 `17E64A21388DDE062A0F0E529AD508DB76BE759F6FD36610F27AC6238B9F5762` |
| 隐私 / 文档检查 | PASS（SCANNED_LINES=0；DOC_BROKEN_LINK_COUNT=0） |

## 6. 合并决策

B2 的实现范围已通过定向测试；4 条 DEFERRED 仍缺 canonical 跨文件/对象引用权威，图片字节级/重复内容需异步 provider，不能宣称 B2 全合同 PASS。按任务书要求，合并时记录 PARTIAL 状态，不写成“B2 全部完成”。

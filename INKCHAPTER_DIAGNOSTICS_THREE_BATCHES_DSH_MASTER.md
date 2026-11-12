# InkChapter / 墨章：文档诊断三批次开发、Git 主线整合与闭环验收（DSH 总任务书）

> 执行对象：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
> 执行方式：在 **DSH 当前会话中直接读取代码、执行 Git/测试/修改/记录**；不要仅返回方案。
> 优先依据：当前实际源码、Git 状态、测试结果与 `DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md`。本任务书是开发需求，不声称目前任何功能已实现或测试已通过。
> 完成目标：先将既有可合并的工作安全整合进 `main`，然后依次从最新 `main` 创建三个**独立的批次分支**，逐批修复、扩展、验收、合并主线；在单个 DSH 会话中维护任务状态并持续循环，直到所有可执行任务都经证据验证为完成，或遭遇无法安全解除的真实阻塞。

---

## 0. 全局强制约束

1. 禁止升级 Typora、修改其安装目录、修改社区框架或无关功能；只改墨章项目受控源码、测试和项目文档。
2. 禁止更改测试 Markdown 正文或真实用户 Markdown 作为“修复手段”；自动诊断只读，不能自动插入/删除标题、空行、图片、公式、引用、代码、题注。
3. 不得上传 PAT、SSH 私钥、用户绝对路径、诊断文档真实内容、图片私有路径到 GitHub、日志或测试夹具。敏感信息在报告中脱敏。
4. 禁止 `git reset --hard`、`git clean -fd`、`git push --force`、丢弃 stash、强行改写历史、覆盖其他人在工作树中的未提交更改。不得以自动化为名删除用户成果。
5. Git 状态必须先审计：`git status --porcelain=v1`、当前分支、上游、`git log --graph --decorate --oneline -n 20`、`git branch -avv`、`git remote -v`（输出需脱敏）、ahead/behind、是否在 rebase/merge 中、冲突文件、未跟踪文件、现有 worktree。
6. 在任何合并动作前检查 `main` / 目标分支血缘、提交签名/保护规则（若可访问）、远端差异和工作区是否干净。若工作区不干净，先**逐文件盘点并保全**：将用户更改保存在明确命名的保护分支/WIP 提交或经确认可恢复的 Git worktree；不得偷藏或覆盖。重要文件先做内容哈希清单。
7. 用户已授权按本任务书在项目中创建分支、提交与将当前成果合并入 `main`，但**不允许用不安全操作绕过合并冲突、分支保护或未解决的测试失败**；远端推送仅在凭据、远端配置和保护要求已确认时进行，失败则保留本地提交并记录。
8. 不修改 Git 全局用户配置，不新增远程地址，不自动删除已有分支/标签，不自动删除远程分支。
9. DSH 必须真实执行，不得虚构通过的测试、截图、构建散列、运行时闭包或用户界面结果。缺少真实 Typora GUI 控制能力时标记 `NEEDS_MANUAL`，提供精确人工操作/采证要求，不得伪报 PASS。
10. 已有业务必须维持：严格/宽松模式、H1–H6 自动编号、图表公式代码编号、题注、编辑锁定、精准诊断定位、局部导航器、原生图片操作与墨章图片双链去重、本地与 GitHub 索引、上传下载预检、单次传输结果如实记录、折叠代码块等。
11. 严重程度的 `info` 与 UI `hint` 是同一等级，不重复计数。`FAIL/DEGRADED/PENDING` 属于运行时域，不混入文档诊断统计。不要把规则家族、具体诊断代码、实际实例、投影行数互相混淆。
12. 严格尊重现有规则语义和历史设计，不得为快速达标而任意降低错误到警告、删除注册项、屏蔽扫描、减少测试断言或修改快照以掩盖问题。
13. 开发时尽量复用现有 `DocumentDiagnosticsAuthority`、注册表、文案、定位契约、图片管理与编号服务。禁止建立第二套诊断主状态、图床索引或图片去重服务。
14. 每批次的 Git 合并都必须基于该批次**完整可执行测试门禁**；GUI 不能自动测时，必须明确 `NEEDS_MANUAL` 并评估该项是否阻止合并。P0 真实 GUI 未验证不得标为完成；若该项属于发布阻塞，则保留分支，不强行合入 main。
15. 控制范围：不安装大型 React/Ant Design/Fluent UI 运行时框架；在现有 TypeScript/DOM/SCSS 上实现轻量 Fluent Compact 视觉风格。

## 1. 参考材料与基线审计

优先读取：
- 项目现行 `docs/diagnostics/DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md`，或用户放入项目根目录的同名文件；发现两个版本先比较差异，以现行源码重新核实，不直接盲信报告。
- 已有 V5.2 UI/图片管理/验收报告及项目日志；历史提示词若有矛盾，以**本总任务书**为本次最终需求，已有业务契约及实际源码优先于过时文档。
- `src/document-utilities/document-diagnostics.ts`, `document-diagnostics-authority.ts`, `document-diagnostic-location.ts`, `document-diagnostic-copy-v1.ts`, `document-problems-projection.ts`, `document-diagnostic-drawer-order-v514-r1.ts`, `document-status-indicator.ts`, `document-utility-overlay-host.ts`, `document-diagnostic-runtime-closure-authority.ts`, `document-diagnostic-code-block-v4.ts`, `document-diagnostics-caption-integrity-v1.ts`, `document-utilities-context.ts`, `src/style.scss`；路径先检查是否存在，再查找实际文件，不能因候选文件名不存在就停止整个工作。
- 相关 `main.ts`、图片管理服务、编号与题注服务、严格 H1、源码索引、测试工具和文档。

记录基线：当前分支、HEAD SHA、`main` SHA、远端跟踪 SHA、构建的 `dist/main.js` SHA256、测试统计、TS 类型检查、构建、隐私检查，以及现有 92 家族/103 展开代码/5 DEFERRED/3 CB 不可达/0 个当前 SHA 下已闭包的报告口径。**所有这些数字都要重算核对，不能当作新的实际结果。**

生成持续更新的执行文件：
- `docs/diagnostics/DIAGNOSTICS-THREE-BATCH-EXECUTION-LOG.md`：时间、批次、分支、HEAD、任务 ID、证据、测试、阻塞、决策。
- `docs/diagnostics/DIAGNOSTICS-THREE-BATCH-CHECKLIST.md`：每任务 `TODO/DOING/PASS/BLOCKED/NEEDS_MANUAL`；自动验证可复现。
- 每批次独立的验收报告 `DIAGNOSTICS-BATCH-1-REPORT.md`、`...-BATCH-2-REPORT.md`、`...-BATCH-3-REPORT.md`。
- 保留/更新原 `DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md`，每批次都按实际注册家族/代码重新生成，不手工虚增总数。

---

## 2. 在所有开发前执行 Git 主线整合（GIT-0，强制第一个阶段）

**目标：先把此前已经完成、且经过验证的当前功能分支整合到 `main`，再开始三批次开发。** 这是本轮用户明确指定的顺序。不要假定当前分支名称、历史 HEAD、远端同步状态与以前的会话一致。

### GIT-0.1 审计与保全

1. 运行 Git 检查，识别当前工作分支与 `main` 的提交图和是否需要合并的未合并提交；识别是否已有尚未提交的用户更改和未跟踪文件。
2. 如果没有 `main` 本地分支，判断远端主线的真实默认分支与追踪情况；不可擅自创建一个无关系的 `main` 代替历史主线。
3. `git fetch` 仅在网络/凭据可用且不会覆盖本地更改时执行；审计 `main` 与 `origin/main` 的差异。**不要盲目 `git pull`**。如果远端不可达，可继续可验证的本地工作，但记录“远端同步未验证”；若无法确认分支祖先关系则阻塞合并。
4. 对所有改动执行逐文件审计；合法的未提交工作必须先形成可恢复的保护提交/分支或安全 worktree。无法明确内容归属、检测到意外改动或正在未完成 rebase 时，暂停涉及 Git 历史的动作、先解决该阻塞。
5. 若当前所在的是功能分支，核实其内容是否全部应该并入 main。排除敏感文件、构建缓存、临时提示词、未验证的大范围重构；不得隐式删除或无审查地提交整个目录。

### GIT-0.2 基线回归与合并

1. 在待合并分支执行类型检查、诊断相关测试、全量现有测试、生产构建以及现有隐私/文档检查；任一失败先追根因并修复，再重新验证。
2. 安全切到 `main`（如有未提交改动则先保全）；核查其与远端跟踪分支关系；必要时以安全快进更新。
3. 将经过验证的既有功能分支合并至 `main`：优先采用能保留血缘且可追溯的非破坏性方式（有意义时使用 `--no-ff`）；冲突逐个理解并解决，保留两侧独立有效功能；不得简单选 `ours` / `theirs` 全盘覆盖。
4. 再次运行定向+全量测试、类型检查、构建、隐私审计，检查合并后 Git diff 和诊断基线。通过后才记录 `BASELINE_MAIN_SHA`。
5. 如远端允许且已审查，按既有团队工作流提交/推送 `main`；有分支保护、无法推送或需要 PR 时使用合规 PR 流程或保留本地合并与明确的远端待办，不绕过保护。
6. 若无需要合并的已有功能分支，直接在 main 完成基线门禁并记录“无额外待合并提交”，不得虚构合并记录。

### GIT-0.3 三批次分支策略

**按顺序创建，不要预先从旧 main 创建三个长期分支：**

- 批次一从 `BASELINE_MAIN_SHA` 创建：`feature/diagnostics-b1-reliability`。
- 批次一完成门禁、合入最新 `main` 后，从该 `main` 创建批次二：`feature/diagnostics-b2-rule-expansion`。
- 批次二完成门禁、合入最新 `main` 后，从该 `main` 创建批次三：`feature/diagnostics-b3-academic-ui`。

如分支名已存在，先检查其历史与工作树：属于本轮已完成工作则续做/合并；不相关则选安全的递增后缀并记入日志，不重置旧分支。

每批次：`main -> feature branch -> 逐项实现 -> 定向测试 -> 全量测试 -> GUI 证据 -> 完整交付报告 -> 合并 main -> 合并后回归 -> 下一分支`。未经门禁通过，禁止自动推进下一批次依赖功能；允许继续只读分析/文档准备，但不得伪称上一批次完成。

---

## 3. 批次一 B1：诊断可靠性修复（全部 P0 优先）

### B1-01 统计集合和审计报告纠错

从规则注册表、动态 code 展开策略、真实生产器、默认启用选项分别构造不可变集合并程序化求差：
- `registeredFamilyIds` / `registryResolvedKeys` / `expandedRuntimeCodes`；
- `producerSupportedCodes` / `runtimeReachableCodes`（注明 strict/loose、配置模式）；
- `deferredFamilies` / `producerUnreachableCodes` / `verifiedRuntimeFamilies`。

重点解决“官方 98 与生产器 98 集合不同”、103 动态展开口径、“95 可达”与 `STRICT_FIRST_H1_DOCUMENT_EMPTY` 被空文档短路的矛盾。**不能预设最终就是 94 或 95**；必须追踪当前分支实际短路路径，运行证明并列出差集 ID。多条件变体要明确配置组合和可能性。修正注册表、能力矩阵与报告的术语；所有数值可脚本复算，加入守恒断言。

### B1-02 状态色块灰色误报、显示状态权威

必须复现并修复“1 项警告而色块显示未知灰色”现象；首先核实截图对应的活动 Markdown、快照、颜色派生、`data-*` 状态和 `getComputedStyle(backgroundColor)`，区分状态竞态与 CSS 覆盖。

规定展示逻辑：`error -> red`, `warning -> amber`, `info/hint only -> distinct muted blue`, `checked clean -> green`, `not checked/unknown -> neutral gray`；颜色以主题变量映射，不得硬编码单文档实例。

同一活动文档快照派生诊断摘要、列表和状态方块；锁定只绘制独立中性框，不覆盖严重程度色。

严格的 stale-result fence：活动文档标识、诊断 generation/revision、异步任务 token 一致才可发布结果；旧文档、旧扫描结果不能回写最新状态。覆盖刷新失败、无活动文档、短文档、自动检测触发和快速切换多个文件。

### B1-03 数量统计、投影语义与精确定位

区分：家族数、诊断代码数、诊断实例数、投影行数、target-group 成员数。把 UI 展示的数字和含义统一：严重程度依据规范化诊断**事件**；多目标展开不重复提高严重程度计数；同时保留逐目标的可点击行与不同定位目标。必要时增加独立 `rowCount`，不随意改旧业务计数契约。

审计并修正 4 条定位契约差异：`FIGURE_NUMBER_DUPLICATE`, `FIGURE_NUMBER_ORDER_INVALID`, `TABLE_NUMBER_DUPLICATE`, `CODE_NUMBER_DUPLICATE`。确认预期定位类型，修正注册声明或生产器；单目标/multi-target/target-group/文末不可定位/无目标失败均测试。

### B1-04 不可达规则、条件门控与兼容残留

逐项处理 `CB007`、`CB008`、`CB010`、`STRICT_FIRST_H1_DOCUMENT_EMPTY`。对于每项明确采用：补接线并启用（仅在价值、兼容、性能可证实时）、保留但明确默认关闭、标记为 deferred/legacy、或经过兼容审查安全清理。**CB010 不得与 `CODE_MISSING_LANGUAGE` 重复产生提示**；CB008 若支持应默认关闭且阈值可配置；CB007 须有真实原始源码换行数据。

核实 `strictPolicyActive` / strictMode 实际门控，`captionDuplicateNames` 死字段，`PROJECT_TERMINAL_NEWLINE_MISSING` 兼容残留、旧 STRICT-FIRST-H1 实现和旧 code fixture；先做引用/兼容核查再清理，不能凭 grep 一键删除。

### B1-05 诊断去重、抑制与文案

检查 source unavailable 双报、空代码块与 CB009 重叠、空表与空表头重叠；保留不同可独立修复事实，抑制真正同根因冗余。复核空行阈值实际 `>=2` 与过时 `3+` 注释，修正文档/注释而不擅自更改已约定的阈值。保证所有动态诊断 code 具有可访问的规范文案与修复建议。

### B1-06 必需行为测试和当前构建运行时证据

为 `FIGURE_DUPLICATE_NAME`、`TABLE_DUPLICATE_NAME`、`CODE_DUPLICATE_NAME` 增加真实诊断产生和定位测试；增加正反例、动态 code、strict/loose、多个目标、target-group、文末和切文档竞态测试。

复查 87 IMPLEMENTED/0 CLOSED 的原始口径，针对当前 `dist/main.js` 哈希采集真实 Typora 下诊断触发、状态色块、首次点击定位、激活状态、取消激活、动态刷新、跨文档清理证据。若自动 GUI 不可用，标记逐项 `NEEDS_MANUAL`，不得假装 runtime closure 完成；按项目现有闭包契约更新证据，不人为编辑 SHA 到当前值。

### B1 门禁

- 当前注册/可达/默认启用集合的数值均有自动差集与守恒检查；所有发现的异常均有明确处置与测试。
- “警告但灰色”有真实复现和修复证据；P0 GUI 未验收时不能宣称完全通过。
- 图表代码重名规则行为测试；多目标数字、定位/失效、strict/loose 通过。
- TypeScript、诊断定向测试、相关全量测试、构建、隐私审计全部通过；不得用旧的“5187 tests passed”冒充新结果。
- 生成 B1 报告并合入 `main`；如果门禁阻塞保留 B1 分支与详细阻塞，不擅自开始依赖其成果的 B2 代码实现。

---

## 4. 批次二 B2：高价值规则扩展（复用现有权威）

**只从 B1 合并后的最新 `main` 创建分支。先完成 5 条 DEFERRED 的正式实现，再逐步增加结构及公式核心规则；增量提交、增量回归，不必一次堆满候选项。**

### B2-01 补齐五个已登记 DEFERRED 家族

不得再创建重复 ID：
1. `FRONTMATTER_MALFORMED`：可靠 YAML 解析/语法错误；与未闭合 Front Matter 明确互斥/抑制。复用项目已有可用解析能力；若新增依赖要先审查包大小与安全性，不能默认安装不必要依赖。
2. `LINK_LOCAL_FILE_ANCHOR_MISSING`：安全解析项目内可访问 Markdown 目标文件，复用规范 slug/heading id 策略；超出访问范围/不可用时返回明确 UNKNOWN/DEFERRED 而非不存在；缓存、增量失效、路径防越界。
3. `FIGURE_REFERENCE_TARGET_MISSING`：正式图编号引用是否能绑定 canonical 图对象。
4. `TABLE_REFERENCE_TARGET_MISSING`：正式表编号引用是否能绑定 canonical 表对象。
5. `FORMULA_REFERENCE_TARGET_MISSING`：正式公式编号引用是否能绑定 canonical 公式对象。

后三项先建立公共 `cross-reference index/authority`：解析 Typora 当前支持且有明确定义的引用语法，链接规范对象标识和当前有效编号；手工编号/自动编号及重编号后更新；**不得用正则扫到自然语言“图 2-3”就一律报错**。未知语法保持不检查而不是误报。每项有定位到引用出现位置的正反例。

### B2-02 表格结构

优先实现 `TABLE_COLUMN_COUNT_MISMATCH`（真实解析后表头、分隔、数据列数不一致）与 `TABLE_ALIGNMENT_INVALID`（对齐标记/列结构异常）；正确处理转义 `\|`、行内代码、Typora 实际语法，防止误报。仅在用户启用的文档规范中可选实现 `TABLE_EMPTY_BODY_CELL`、表格行列数量阈值、表格显示宽度。默认不把合法空单元格判成错误。

### B2-03 列表结构

优先实现 `LIST_INDENTATION_INVALID`，以 Typora 真实解析的树形结构为准。再实现可选 `LIST_MARKER_INCONSISTENT`、`LIST_ORDER_NUMBER_INVALID`，以及任务列表标记/嵌套块结构规则（实际需要才登记 ID）。Markdown 合法的混合 marker、有序列表从非 1 数字起始等不得误报为通用错误。样式偏好默认提示且可关闭。

### B2-04 标题与自动编号

增补 `HEADING_NUMBER_SEQUENCE_INVALID` 时必须复用当前自动编号、章节层级和有效编号权威；先证明未被已有 `HEADING_LEVEL_GAP`、编号冲突或重复编号规则覆盖。章节编号归属、引用歧义只在有稳定可判定目标时报警。不要把规范生成的编号误判为用户手工编号。

### B2-05 图片资源

优先 `FIGURE_IMAGE_FORMAT_UNSUPPORTED` 和实际解码失败（能可靠取得文件信息时）；可选 `FIGURE_IMAGE_CONTENT_DUPLICATE`（基于现有 SHA-256 索引）、格式与扩展名不一致、分辨率阈值、双链状态异常。读取现有图片管理预检结果，不重复网络上传/下载和本地 SHA 全量扫描；不可确认资源显示 UNKNOWN，不错误写成 MISSING。严禁检测器自动改文档正文/传输图片。

### B2-06 公式长度与渲染专项（本批次核心，不得遗漏）

必须交付：
- `FORMULA_RENDER_WIDTH_OVERFLOW`：渲染结果可靠时默认启用警告。`ratio = naturalMathContentWidth / effectiveAvailableWidth`，默认阈值 100%；可选 85% 接近边界提示默认关。测量公式**内部数学内容**实际自然宽度，而非被 CSS `max-width` / `overflow:hidden` 限制后的外框宽。考虑公式编号、边距、CSS zoom、滚动容器、字体加载；未渲染完/隐藏/渲染失败则 PENDING/UNKNOWN，不误报。
- `FORMULA_SOURCE_LENGTH_EXCESSIVE`：默认关闭、建议初始阈值 300 字符；明确 Unicode 计数口径、排除围栏/自动生成标记，可配置。
- `FORMULA_SOURCE_LINE_TOO_LONG`：默认关闭、建议初始阈值 120 字符；可配置、正反例完整。
- `FORMULA_LATEX_RENDER_FAILED`：仅在实际数学渲染器明确返回失败且能可靠归属公式块时产出错误；不得靠简单正则误报。
- `FORMULA_RENDER_HEIGHT_EXCESSIVE`：可选，默认关闭且有用户配置时才能执行。长公式换行建议作为超宽规则的 suggestion，不必另建重复 code。

运行性能：ResizeObserver/布局刷新等采用节流、缓存和文档 generation 保护；窗口变宽后超宽诊断可消失；侧栏拖拽、主题缩放、公式重新渲染可更新结果；切换文档清理旧测量。不得造成编辑卡死、无限 layout thrash、频繁 DOM 写入。编辑器宽度与导出纸张版心宽度是两套独立检测依据；本批次先做好编辑器，不假设 PDF/Word 版心。

### B2-07 规则注册与默认策略

所有新增规则必须有唯一 familyId、明确内部 `error/warning/info`、中文标题、description、suggestion、trigger/skip、定位契约、注册表 area、模式/档案开关、producer authority、测试清单、报告映射。高成本或高误报默认关闭；不可访问/未完成时明确 UNKNOWN 而非绿色健康或虚假警告。

每项新增检测至少包含正常样本、违规样本、边界样本、跨文档、与已有规则的相互抑制/去重、点击定位以及性能测试。避免生产器输出未登记 code。

### B2 门禁

- 5 条 DEFERRED 在技术前提满足情况下都有 producer、行为测试及能力矩阵更新；若需要改变先决设计且本会话无法安全实施，记录确切 BLOCKED 而不能虚假标记已实现。
- 表格/列表结构检查有基于真实 Markdown 解析的反误报测试。
- 公式宽度、源码总长度、单行长度、渲染失败至少完成准确实现与单元/集成测试；可选高度检测不应阻塞核心路径，但在任务清单中保留明确状态。
- 规则总数重新按真实 familyId 和展开 code 计算，严格/宽松显示级别核对；旧诊断行为与图片去重不退化。
- 全量门禁+运行时可行的真实 GUI 验证+报告；仅通过后合入 `main`，再从最新 main 建立 B3 分支。

---

## 5. 批次三 B3：学术/实验报告配置档案与 Compact Inspector UI 精修

### B3-01 检测 Profile 与严格/宽松模式正交

设计配置层：`general`（默认通用 Markdown）、`academic`（学术论文）、`lab-report`（实验报告）、`custom`（自定义）。Profile 管**启用集合、目标规范与阈值**；strict/loose 管已定义规则的严厉程度，两者正交，不强行覆盖已有严格模式。支持全局→文件夹→当前文档继承，实际以现有配置层级为准；旧配置向后兼容且默认行为尽量不变。

通用默认开启低误报的结构/资源检查；不默认要求三线表、固定字数、章节清单、第一行缩进、某一学校或期刊专属规范。

### B3-02 学术档案可选检测

在可靠解析/模板配置前提下扩展：引用文献不存在、重复参考文献、已定义未引用、必需章节缺失、章节正文过短、图片分辨率不足、表格/公式超出版心、图表公式正文引用一致性、必要元数据缺失。参考文献格式必须先定义明确的引用语法/管理方式；不以任意自然语言猜测“参考文献”。与 B2 已有交叉引用共享权威，禁止重复 code。

实验报告档案偏重代码块语言、图表题注、公式、结果资源与按模板配置的章节完整性；避免对实验结论做不可靠的“正确性”智能判断。未能可靠实现的项目清楚记录 TODO/BLOCKED，不将候选功能伪装为已完成。

### B3-03 公式与表格的论文版心规则

建立**可配置且来源明确**的目标纸张/版心模型（若无真实模板参数，不使用假定 A4 边距当唯一正确值），与编辑器实际宽度检查区分。版心不确定时不产生“导出必定超宽”警告；对公式/表格的目标宽度另行计算并有可靠测量依据。明确 PDF 与 Word 的排版环境可能不同，不作未经验证的跨格式精度承诺。

### B3-04 顶部状态方块与三标签 UI

沿用 InkChapter Fluent Compact：收起**只有 15x15 px 彩色方块**与约 32x32 px 透明热区，无可见白色包装、阴影或残留透明遮挡；单击展开/收起，双击使用真实 editGuard 锁定/解锁，处理点击仲裁、键盘可达、焦点和 reduced-motion；锁定只有独立中性色细框，不覆盖诊断状态色。

展开宽度初值 360 CSS px，响应式：顶部完整 header **包括状态方块**，下方唯一 content，两者必须**左边界、右边界和宽度全部相同，误差 <= 1 CSS px**；三标签平分色块之外剩余宽度，色块在 header 最右侧内有 10-12px 视觉留白。移动的是共享根容器锚点，不单独 offset 色块。header 约 36px，内容内边距 12px，间隔 4-6px，主圆角约 6px，动画 160-180ms。

浅色/深色通过 CSS tokens 实现主背景/次文字/弱边框/错误红/警告琥珀/提示蓝灰/正常绿/未知中性灰；不叠加新的 `!important` 修补布局；审查删除过时 V5.1/V5.2 选择器。实际颜色依据状态权威，CSS 不能掩盖业务竞态。

### B3-05 诊断列表 UI

展开直接展示**诊断列表**，不得恢复“摘要/详情/返回”多层 UI。顶部简洁错误/警告/提示统计 + 一个紧凑筛选入口及刷新；默认按文档源位置排序。每条行：6px 语义色点、13px 标题、固定约 40-48px 右对齐行号、必要时 12px 次级说明（最多通常两行），低饱和悬停/焦点/选中，细分隔线、无独立厚卡片和无满屏彩色底。长路径可显示截断但必须可获取完整文本。多目标/target-group 保留真实点击定位语义，只有视图分组可选而不折叠源诊断 ID。

面板动态最大高度跟随窗口，列表内部滚动；切换检测/图片/锁定时宽度不跳变；点击定位后关闭并执行正确定位；点击正文的关闭策略必须排除内部点击与意外编辑干扰；收起后不能留下透明命中层。当前批次不新增复杂自动停靠或智能避让。

### B3-06 图片、锁定标签与导航器

图片页显示有效继承来源、图片引用数、真实可上传/待核实/可复用资源状态和有限快捷按钮：上传全部、下载全部、检查补齐双链、设置。可用性必须通过图片预检决定；资源缺失不能误写成待上传成功；网络失败不能伪称对象不存在；实际复用报告 0 次上传/下载。

锁定标签**单行** `当前文档可编辑 [锁定]` / `当前文档已锁定 [解锁]`，真实 editGuard 回调成功才更新状态。保留原生插图与原生右键操作，保持双链去重索引、相对 `./assets` 与集中图库选择的既有约定。

导航器只在**当前文档真实可竖向滚动**时显示，短文档隐藏；切换文档、调整侧栏、缩放、展开面板、公式宽度变化后不漂移。不得对 `#write` 强插节点或修改正文结构。

### B3-07 GUI/主题/性能与文档

真实 Typora 验收：浅/深主题、100/125/150% DPI、短文档/长文档、7/11 项警告、1 项警告且方块 amber、混合错误/警告/提示且方块 red、图片资源缺失、锁定/解锁、快速切 3-5 个文件、窗口小→大→小、侧栏拖拽、滚动、代码块折叠、公式跨宽度阈值消失/触发、长路径/行号。对 header/content 的 DOMRect 记录 left/right/width CSS px 并分别断言 <=1；鼠标热区尺寸测量。

审核对比截图必须真实来自 Typora（不能用模拟图代替）。记录每项 PASS/FAIL/NEEDS_MANUAL、环境与构建 SHA；无法访问 GUI 也应完成所有可执行测试与精确人工验收清单。

### B3 门禁

Profile 默认兼容及覆盖测试、文档级配置继承测试、UI geometry 和交互测试、图床预检及锁定回归、Typora GUI 验收、全量 TypeScript/Vitest/build/privacy/docs 全部通过或诚实列出不可自动验证的阻塞。只有满足合并策略才能将 B3 合入 `main`。

---

## 6. 统一自动化验证与防回归门禁（所有批次共同执行）

每次有实质源码变更后执行**相关定向测试**；每个批次提交前执行全量：

1. 先读取 `package.json` 真实 scripts；优先仓库正式测试命令。若可用，用 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 和 `node node_modules/vitest/vitest.mjs run` 或分套件运行；严禁无根据地把例子命令当仓库唯一正确指令。
2. 本项目现有至少包含 document-utilities / heading-numbering / image-management、图片工具栏、诊断 UI 等测试，必须识别实际覆盖并做全量回归；如测试套件分组，统计全部 pass/fail/skip。
3. 生产构建应验证产物存在，并记录 `dist/main.js` 的真实 SHA256；不得通过编辑 runtime evidence JSON 让旧 SHA 看起来匹配。
4. 隐私/密钥检查：源码/构建/生成报告无 PAT、凭据、用户私人路径、真实文档隐私内容；检查临时脚本和未跟踪文件后才能 commit。
5. 性能：大 Markdown、长代码块、密集公式/图片、多目标诊断、快速编辑、窗口 resize、侧栏拖拽；检测耗时、DOM 测量次数、内存缓存、debounce/cancellation，不能引入无限重复刷新或主线程卡死。
6. 保存每个失败的完整可复现命令、测试输出、最小复现、根因、对应修复提交和复测证据；不人为减少统计样本，不跳过不稳定测试当 PASS。
7. 对新规则统一检查 registry、code、copy、severity、location、producer、runtime projection、behavior tests、strict/loose、Profile、性能及 UI，缺一项则保持 TODO/BLOCKED。

### BATCH_GATE 统一定义

`PASS` 必须同时满足：该批次约定必做范围真正完成、无未解释的生产/回归测试失败、无 P0/P1 功能倒退、无泄漏、无不安全 Git 状态、可执行的 GUI 检查真实完成。`NEEDS_MANUAL` 不能标记为 `PASS`；涉及用户要求的真实视觉/交互阻塞时不得自动合并或发布，先输出待手工验收报告。`BLOCKED` 不可反复空转。

---

## 7. DSH 持续循环执行控制器（核心执行要求）

建立一个**可持久化的任务账本**：每项任务有 ID、分支、优先级、依赖、状态、操作证据、验证命令、失败原因、下一动作。每次开始先重新从 Git+日志读取实际状态，不因会话文字“已完成”就跳过。

执行流程：

```text
START
  -> READ master prompt + source inventory + project status
  -> GIT-0 safety audit / preserve / baseline test / merge existing work to main
  -> for batch in [B1, B2, B3] IN ORDER:
       verify latest main is ready
       create or resume independent batch branch from latest main
       REPEAT:
          collect unfinished executable tasks
          pick highest-priority task whose dependencies are satisfied
          investigate source -> implement minimal correct change
          run focused tests -> analyze failures -> fix root cause
          update task ledger + commit coherent verified increment
          if a test fails: retry after NEW evidence or actual change
          if persistent blocked: mark BLOCKED with concrete evidence
       UNTIL no executable unfinished task remains
       run full test gate + document/report + GUI validation
       if BATCH_GATE=PASS:
          merge branch into main safely -> repeat full post-merge gate
          record merged main SHA and continue next batch
       else:
          preserve branch and state; STOP dependent merge/next batch
          finish independent read-only investigation and print blocker
  -> FINAL: compare all task IDs + source registry + Git log + tests + screenshots
  -> END only when all mandatory items PASS and main includes all three batches,
     or when a real unresolved blocker prevents safe continuation
```

**循环不是无限重跑失败命令：** 同一错误连续两次无代码/环境变化时，不允许第三次盲重试；必须转为新的取证、隔离测试、修复根因或给出 BLOCKED。严禁使用 `while true` 死循环、无上限递归、为刷通过而频繁删除缓存。优先剪枝重复步骤：同一阶段已用可重现结果覆盖的无关检查不要反复做，但批次合并后的完整门禁不可省略。

发现隐患时分级：P0 先处理并阻止后续合并，P1 按业务影响处理，P2 记录并在适合的批次解决；扩展建议与必做能力区分。若用户要求“全部执行”，在无技术阻塞的前提下继续推进已列出**明确交付的必做任务**，可选/需政策模板的规则不擅自强行默认开启，应在报告中说明实现、关闭或等待规范参数的状态。

保持会话输出精炼：每完成一个阶段输出实际更改、测试结果、提交 SHA、下一批次；不要生成大量重复方案或反复向用户索取已给过的信息。只有涉及不可恢复损失、外部密钥不可用、分支保护、无法安全合并等实质阻塞才停止并报告，不得声称后台会继续执行。

---

## 8. 最终交付格式

完成时在当前 DSH 会话返回：

1. **Git 总览**：开发前分支、保全方式、首次并 main 的 merge SHA、三个批次分支、每次合并主线的 SHA、最终 `main` HEAD、远端同步状态（已推/未推/受保护）。若某批次未合并，明示原因。
2. **规则总览**：最新规则家族、展开诊断代码、错误/警告/提示基准分布、strict/loose 运行分布、默认启用/条件启用/不可达/DEFERRED、当前构建闭包验证数；不要复制初始 92/103 当作最终结果。
3. **B1 修复明细**：灰色方块复现/根因/修复证据，计数差异、定位契约、CB007/8/10 与动态死代码处置、去重和现有规则行为测试。
4. **B2 新增明细**：五条 DEFERRED 的实际接线情况、表格/列表/标题/图片规则清单、公式宽度/源码长度/单行长度/渲染失败、每项 ID/默认状态/触发条件/定位/测试证据。
5. **B3 交付明细**：Profile 配置继承、学术/实验报告可选规则、版心配置、Fluent Compact 上下等宽、三标签、图片页、锁定及导航器行为。
6. **回归与 GUI**：测试命令及真实 pass/fail/skip、构建 SHA、隐私审计、性能基准、真实截图/DOMRect；无法验证明确 NEEDS_MANUAL，不虚构数据。
7. **异常与后续**：仅保留有证据的 BLOCKED/NEEDS_MANUAL，注明复现步骤和解除条件；没有未完成的必做任务才写 `ALL_MANDATORY_TASKS_PASS`。
8. **项目文档**：更新诊断清单、能力矩阵、规则新增说明、实施日志及三批次报告；此前临时提示词仅在关键内容已归档、无未完成引用且可恢复后再清理，不能删除用户未授权资料。

### 任务执行一句话规则

**先安全地合并现有成果到 `main`，再依次从最新 `main` 开三个批次独立分支；每个分支不断审计、修改、复测、修复到门禁满足，再合并主线。既不因困难提前停止，也不以假通过、无限重试或破坏 Git 历史换取“全部完成”。**

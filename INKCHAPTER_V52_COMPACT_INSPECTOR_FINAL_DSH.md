# InkChapter V5.2 Compact Inspector — Final Refinement / DSH Execution Task

> 文件名：`INKCHAPTER_V52_COMPACT_INSPECTOR_FINAL_DSH.md`  
> 项目：`D:\TyporaPluginProjects\typora-plugin-inkchapter`  
> 任务类型：在现有 V5.2 基础上修复 P0 诊断状态不一致，并完成文档工具栏 UI 精修与完整回归。  
> 执行方式：在当前 DSH 会话中连续执行“审计 → 复现 → 修改 → 测试 → 根因修复 → 复测 → 真实 GUI 验收 → 文档归档”；非必要不询问用户，不假称后台执行。

## 0. 任务总目标与验收边界

本轮不重新开发整套 UI，也不直接发布 V5.3。继续现有 V5.2 功能分支，先修复状态色块错误，再进行统一排版美化。最终界面必须做到：

1. 收起状态只有一个 **15px 左右、四角轻圆角的纯色状态方块**；透明点击热区约 32×32px；无白色按钮外壳、投影、背景或虚假描边。
2. 展开为单一文档工具栏：**检测｜图片｜锁定｜状态色块**。顶部总宽度（包含色块）与下方内容面板 **严格等宽**，左、右边缘分别重合，实测差值均 ≤ 1 CSS px。收起状态无残留的面板宽度和指针遮挡。
3. 默认检测标签**直接显示诊断问题清单**；不得恢复“摘要 → 详情 → 返回”的中间过程；诊断行点击调用现有真实精准定位事务。
4. 诊断数量、筛选、状态方块的语义状态由**同一当前有效文档诊断快照与同一计数权威**派生；消除“有 1 项警告但方块为未知灰色”的错误。
5. 图片页重点显示**真实资源状态、可执行操作和当前策略来源**；锁定页保持单行。原有业务能力全部保留。
6. 界面遵循自有 InkChapter Compact Inspector 视觉变量：主视觉参考 Fluent 2 的克制轻量工具条，三等分标签参考 Segmented，诊断清单借鉴 JetBrains Problems 的信息层次。**不安装 Fluent React / Ant Design / React 等大型框架**。
7. 不改变原生 Typora 编辑内容宽度、不污染 `#write`、不修改任何 Markdown 正文；无未经授权的新目录、网络传输或图片引用改写。
8. 真实 Typora GUI 验收不能用 jsdom 通过替代：每个实测项要有当次运行的证据；无法验证则标记 `NEEDS_MANUAL`，不能说 `PASS`。

### 本轮强制优先级

- **P0-A**：警告存在时状态方块错误显示灰色；诊断计数 / 映射 / CSS 的单一数据源。
- **P0-B**：切换 Markdown 后旧文档快照、颜色、图片摘要、锁定视觉或异步任务串用。
- **P0-C**：展开 / 定位 / 关闭时的悬浮 UI 与正文关系、点击事件与透明覆盖层。
- **P1-A**：顶部/底部等宽、字体对齐、信息层级、诊断列表、深浅主题与 DPI。
- **P1-B**：图片批量按钮可用性与统计口径真实、锁定页简洁与逻辑一致。
- **P2**：可选的筛选密度 / 按类型分组，只有在 P0/P1 全部稳定且不会引入新复杂状态时实现；默认按文档位置排序。

## G0. Git、部署与工作区基线

1. `cd D:\TyporaPluginProjects\typora-plugin-inkchapter`，运行 `git status --short --branch`、`git log -n 12 --oneline --decorate`、`git branch -vv`；核对当前实际分支和提交。**不要假设**当前 HEAD 一定是过去报告中的 `9b3f517`，也不要在不检查的情况下强行 checkout / reset / clean。
2. 优先继续 `feature/document-status-image-batch`，若本地当前已进入该分支的新提交，直接在最新提交上工作。不要自动合并 main，不强制推送，不覆盖无关未提交修改。遇到冲突时先保护并报告证据，再使用不丢失改动的解决方式。
3. 对本次相关的 DOM/CSS、源码服务、单测、主入口、历史模块文档建立影响清单。原始源码中重要文件可能很大，使用精准定位与小幅变更，不因“顺便清理”重排巨型文件。
4. 记录当前 `package.json` 的可用脚本、测试数量、build 产物和实际部署路径。仅当已有安全部署流程和目标环境可用时执行部署；不要覆盖未知的全局 Typora 配置。
5. 只在必要时查看历史提交以理解旧设计：`a64754f`（文案、排序、列表 UI）、`4b203ef`（移除诊断卡片详情）、`d3c0f14`（单行投影、严重级别）、`23677ea`（V5.2 工具栏）。**不是回滚任务**；按当前真实代码选择性借鉴。

**G0 产出**：HEAD / 分支 / 工作区、旧版截图症状、现有 DOM 和核心测试基线，记录于本轮最终报告。

## A1. P0 — 复现“有警告但状态方块灰色”

### 必要的真实场景

- `01-中文学术论文模板.md`：用户截图显示检测清单有 **1 项警告（表格缺少表名）**，同时顶部方块呈**灰色**。应先复现并记录，不能直接将灰色 CSS 设为黄色。
- `Generic-Locator-Runtime-Test.md`：截图出现 7 项警告；也有图片引用、缺失资源和锁定标签场景。
- `Document-Diagnostics-Code-Integrity...md`：截图出现 11 项警告。
- 复杂诊断测试文档：包含 1 错误、3 警告和 7 提示时，方块应由错误优先呈红色。
- 未检查的文档、完全正常的文档、仅提示文档分别验证。

### 全链路追踪

至少审计以下真实文件（若仓库改名，则定位真实等价文件）：

- `src/document-utilities/document-status-indicator.ts`
- `src/document-utilities/document-hub-model.ts`
- `src/document-utilities/document-hub-controller.ts`
- `src/document-utilities/document-utility-overlay-host.ts`
- 诊断快照与 severity 计数的现有唯一权威（例如 `document-problems-projection.ts` 和相关诊断领域服务）
- `src/style.scss`

追踪并在**调试日志（敏感数据脱敏）**中关联记录：当前活动文档 ID/epoch、诊断快照 ID/revision、计数 error/warning/hint、是否检查完成、派生 `status kind`、UI model、DOM `data-*`/class、最终 `getComputedStyle(square).backgroundColor`、更新事件的触发源。严格区分以下根因：

1. 列表和方块来自不同快照或不同统计权威。
2. 切换文档时灰色 placeholder 覆盖后未被有效诊断更新替换。
3. 异步任务迟到，旧文档或旧 epoch 覆盖新文档。
4. 检查成功与“未知/失败”的标记更新顺序错误。
5. UI `data-state` 正确但 CSS 选择器、继承或运行时 inline style 覆盖错误。
6. 仅提示的颜色与未知灰色在视觉上未区分。

必要时搭建可复现的 host + snapshot 集成用例；不以“在 CSS 把 gray 改为 amber”冒充修复。

## A2. P0 — 唯一诊断状态权威与颜色语义

建立或复用**一个**只读、可测试的纯派生函数：输入为当前有效文档、当前检查状态、当前诊断快照以及已有诊断领域权威计数；输出为 `{documentIdentity, revision, checkedState, errorCount, warningCount, hintCount, statusKind}`。不要复制现有计数逻辑，不按过滤后的列表重新计数，不将图片待上传项目误加到文档诊断 warning 中。

**颜色优先级与语义：**

| 条件 | statusKind | 方块视觉 |
| --- | --- | --- |
| 已检查，error > 0 | error | 红色 `#D24D57` 候选 |
| 已检查，error = 0，warning > 0 | warning | 琥珀色 `#D49A26` 候选 |
| 已检查，error = warning = 0，hint > 0 | hint | 蓝灰色 `#66869F` 候选 |
| 已检查，三类数量都为 0 | healthy | 绿色 `#2F986D` 候选 |
| 未检查/状态不确定/无有效文档 | unknown | 中性灰 `#929AA4` 候选 |

上述 hex 是**浅色主题候选设计 token**，须验证深色主题对比度；不得将多主题硬编码到同一条 CSS。失败/检查中的状态若已有独立语义，保留真实语义，但绝不能假装 healthy。提示与未知不可同色。锁定细框与状态色完全独立。

对 UI 更新采用当前文档身份 + epoch/revision 的**提交时校验**。仅接受当前活动文档的合法结果；所有取消或失败均给出可诊断的状态，不静默回退到旧文档。不要为状态恢复增加无界 timer/polling。

**必须测量的契约：** 在同一帧稳定快照中，`warningCount > 0 && errorCount === 0` 时方块状态必须是 `warning`，绝不能是 `unknown`；切换检测/图片/锁定标签时颜色不变；锁定时只增加锁框。

## A3. P0 — 多文档生命周期与状态隔离

1. 明确活动 tab/叶节点与路径优先级，不能以旧文档 `documentKey` 替代当前 active leaf 的权威。实际空工作区应为 unknown，不显示上一个文档的警告。
2. 在真正切换 Markdown 时折叠面板或按既有约定更新到新文档，但无论何种方式均不展示过期诊断清单、图片统计或锁定视觉。
3. 诊断刷新、图片预检和锁定回调各自校验当前文档身份；不同标签的 UI 仅共享同一有效文档模型。
4. 连续切换 A（7 警告）→ B（1 警告）→ C（1 错误）→ D（0 问题）→ 空工作区，再快速逆向切换 10 次，应无错色、错数、错定位、闪烁后永久灰色、旧列表残留。
5. 刷新失败时下一步允许重新检查，但不能留下永久错误颜色或以 unknown 掩盖已有有效状态；依据现有状态权威区分检查中、失败和已检查。

## U1. 固定外部几何：上下严格等宽（不能只右对齐）

以实际 V5.2 DOM 为基础，整理为一个布局根和单一可见内容容器：

```text
InspectorRoot (right-side anchor; no markdown insertion)
  ExpandedLayout (one shared width; only while open)
    Header (100% width; tabs + square hot area INSIDE this width)
      Tabs (3 equal columns: 检测 | 图片 | 锁定)
      StatusTrigger (32x32 transparent hit area; 15px square)
    Content (100% width; current tab only)
```

1. 展开宽度建议 `min(360px, availableViewportWidth - safeInsets)`；窗口有效宽度不足时上下同时缩小或采用合法紧凑变体，**不能只缩小内容面板**。统一 `box-sizing: border-box`，防止 padding/border 引起上宽下窄。
2. Header / Content 在 CSS 布局稳定后 `getBoundingClientRect()`：`abs(leftDifference) <= 1 CSS px`、`abs(rightDifference) <= 1 CSS px`、`abs(widthDifference) <= 1 CSS px`。标签页切换后、列表刷新后、窗口变化后均保持。
3. 方块 15px，轻圆角 2–3px；32px 透明热区位于顶部内部最右，右侧保留 8–12px 内部视觉空间；整体根距窗口安全边界初始 12–16px。不得单独 `translateX` 方块破坏等宽对齐。
4. 上下间距建议 4px，顶部高度 36px。三个标签严格等分剩余宽度；选中态用浅色/深色对应低饱和背景，未选中可辨，不套大圆角按钮。
5. 收起状态只显示色块与无装饰点击热区；`ExpandedLayout` 收起后不能在视口占据隐藏 360px 的 pointer hitbox。清理过期节点/重复监听，复用原控制器而非重建第二套。
6. 位置锚定要随窗口尺寸与 Typora 侧栏变化重新确认；不能挤占正文宽度或影响编辑布局。浮层不能插入 `#write`。
7. 不创建独立的第二个诊断抽屉；旧隐藏兼容节点须先审计依赖再安全退役，不允许为了通过测试而保留重复可交互浮层。

## U2. 统一 InkChapter Compact Inspector 视觉 token

主视觉参考 Fluent 2 的轻量工具条、低对比度控件；顶部借鉴 Ant Design Segmented；列表借鉴 JetBrains Problems。**只借鉴原则，不引入新框架、不抄袭第三方图标资产或直接复制大型 CSS。**

以现有 Typora 变量优先构造主题感知的局部 token，不破坏 Typora 自有样式：

| Token 用途 | 浅色候选 |
| --- | --- |
| 主面板背景 | `#FAFAFB` |
| hover 表面 | `#F1F3F6` |
| selected 表面 | `#E9EFF6` |
| 分隔线 | `#E2E5EA` |
| 主文字 | `#28313F` |
| 次文字 | `#677384` |
| 诊断 error | `#D24D57` |
| 诊断 warning | `#D49A26` |
| 诊断 hint | `#66869F` |
| healthy | `#2F986D` |
| unknown | `#929AA4` |
| focus | `#567FAF` |

深色主题必须独立映射并验证 WCAG 对比度；不以“更淡、更小的灰字”牺牲可读性。主标题建议 13px，说明 12px，行号 11px tabular numbers；面板圆角约 6px，内部 padding 12px，避免大量大面积灰底、重阴影。禁用态清楚区分但保留可读理由。

清理 V5.1/V5.2 过期、重复或相互覆盖的 `style.scss` 选择器；记录实际 cascade 与 computed-style 根因；不靠增加 `!important` 铺新覆盖层。不要改 Typora 全局主题。

## U3. 检测标签：直接问题浏览，强调信息清晰

1. 检测标签展开后默认直接渲染诊断列表，**不允许再出现摘要页/详情/返回三级结构**。
2. 顶部仅保留当前诊断计数（例如 `1 错误 · 3 警告 · 7 提示`）以及紧凑的筛选/刷新入口。不能因隐藏某类而让当前文档总数变少。过滤仅作用于展示。
3. 默认每行采用稳定栅格：左侧 6px 语义色点；中间标题；右侧固定宽度约 40–48px 的位置列；第二行有必要时显示说明。标题约 13px，说明约 12px；标准模式最多两行说明，长 URL/路径截断或安全断行，不得把位置挤掉或撑宽面板。完整路径可通过 tooltip 或复制访问，而非新建弹窗。
4. 无卡片嵌套、重复“警告”前缀、冗余大背景；hover 低饱和、focus 清楚，选中状态稳定且对暗色主题可读。
5. 诊断清单默认依文档位置排序，复用既有投影/单行目标组/多目标规则与现有排序权威。**不按标题字符串去重**，不合并实际诊断身份。
6. 可以在次级筛选菜单提供“全部/错误/警告/提示”与“标准/精简”密度，但不能把筛选堆满顶部。默认标准模式保留必要说明；精简模式可只显示标题和位置，但完整文本仍可访问，且点击继续真实定位。
7. 点击整条诊断须走现有 `locateDiagnostic` / active lease / exact target 路线，不能回退成仅 `scrollIntoView` 的近似实现。定位过程依照既有时序关闭浮窗，不让关闭动作抢夺焦点或清除 ACTIVE 标记。
8. 每个列表均使用内部滚动；最大高度受当前窗口空间约束，不能让面板无限向下增长。内容区域不能越过右侧边界或遮挡原生菜单、标签条等关键控件。
9. 数据没更新时清楚表示未检查/刷新中，不展示旧文档的已筛选列表。

## U4. 图片标签：资源事实与可执行资格一致

从截图可见某文档有 2 处图片引用，列表也展示 2 项待上传，但正文显示缺失资源；需要澄清 **引用数 ≠ 本地可读数 ≠ 待上传数**。

1. 图片页以少量紧凑信息展示：当前配置来源（全局/文件夹/本 MD）、引用统计、**实际可上传 / 可下载 / 需要核实**的资源状态、上传全部/下载全部、检查并补齐双链、当前文档设置。
2. 只显示预检结果真正支持的计数；不能假设“2 引用就可以上传 2 个”。资源缺失、网络未验证、可复用、待执行须区分。未知不等于失败，不等于可传。
3. 按钮是否可用来自现有只读预检及授权状态；原因清楚、精简显示。操作必须继续：预检 → 用户显式确认 → 既有服务执行 → 真实结果汇总。用户取消后零传输、零目录创建、零 Markdown 更改。
4. 保留 SHA-256 内容去重、REUSED_REMOTE/REUSED_LOCAL/COPIED_EXISTING_LOCAL/UPLOADED_NEW/DOWNLOADED_NEW/ALREADY_LINKED 等真实结果语义；不把 Git blob SHA 误当 SHA-256。不因 403/网络失败误认远端已存在。
5. 三级配置：全局默认 → 匹配文件夹 → 当前 MD；并保留 Typora 原生六种插图方式，不因窗口切换偷偷更改原生全局设置。
6. 图片高级配置、凭据、缓存、完整上传模式仍通过现有设置页面进入。敏感 GitHub PAT 不在日志、截图、报告或提交中出现。
7. 不允许打开/扫描/切换文档时自动创建 `./assets`、`${filename}.assets` 或全局图库目录，除非已有明确业务授权；不上传本机路径和凭据。
8. 真实缺失图片的 GUI 验收必须保留缺失状态，不为了截图好看改测试 Markdown 引用。

## U5. 锁定标签：单行、单一动作权威

1. 锁定页保持一行：`编辑中 / 已锁定` + `锁定 / 解锁` 操作。不要堆叠卡片和不必要的说明。
2. 点击锁定和双击状态方块调用同一个真实 editGuard 服务；成功才更新锁框与状态，失败必须反馈，不伪造成功。
3. 锁定外框是中性细线，独立于红/黄/蓝灰/绿状态方块颜色；锁定与解锁不能清空或重置诊断快照。
4. 验证 `beforeinput / keydown / paste / cut / drop` 等编辑保护与允许滚动、选择、复制行为。关闭 UI 不释放当前文档的真实锁定。
5. 单击展开和双击锁定需可靠仲裁；260ms 固定双击窗口仅可作为待验证实现，不应不经实测就假称适配 Windows 全部双击设置；按钮与键盘提供等效操作。

## U6. 悬浮面板、交互与生命周期

1. 维持单一悬浮模式，**本轮不新增自动智能避让、右侧停靠模式、第二诊断弹窗或大型动画框架**。
2. 单击色块展开/收起，Esc/外部有效点击收起；文档切换收起；点击诊断项先建立真实定位事务，再根据既有安全时序收起，不能因为 close 破坏 locate lease。
3. 点击正文/拖动侧栏/调整窗口，不能误触发内部重复点击或让浮层成为永久透明拦截层。外部监听器在 dispose 中清理，工具栏 DOM 存在唯一实例。
4. 动画建议 160–180ms，`prefers-reduced-motion` 禁用动画时仍正常布局。动画期间可以暂缓几何断言，但完成后必须稳定通过。
5. 保留滚动导航器规则：**仅在当前 MD 实际纵向可滚动时显示**；短文档隐藏、长文档显示；多文档切换不能带出旧高度；不能为看见箭头而移除 scrollable gate。
6. `#write` 永远不应包含插件可视节点或菜单文本；DOM 位置及文档源码快照必须不被 UI 操作污染。

## T1. 必须新增/修正的自动化测试

- **状态矩阵**：1 error; 1 warning; 7 hint; 0/0/0 checked; unknown; mixed 1/3/7; check failed; switching tabs and locking preserve diagnostic colour。
- **同源性**：列表每个严重级别的真实计数与方块派生状态来自同一快照、同一当前文档身份和一次更新代次；filter 不改变总数。
- **竞态**：A→B→C 快速切换、旧 async 返回、刷新失败后重试、空工作区、连续 10 次切换，无 stale overwrites。
- **几何**：header/content 两端与总宽度分别 ≤ 1 CSS px；三标签切换、resize、sidebar resize、不同长短诊断和图片/锁定内容；收起后隐藏区域 `pointer-events` 不拦截。
- **诊断**：直接列表，无摘要/详情/返回；真实投影顺序、目标组单行、多目标不被合并；点击正确 exact-target；定位事务可恢复。
- **图片**：缺失本地图片不是可上传；预检不落盘；上传/下载确认取消零副作用；远端未知不误报；结果数真实；零未经授权的资产目录。
- **锁定**：双击只锁定一次；单击不触发锁；真实编辑保护；错误不伪装成功；锁框不覆盖颜色。
- **导航器**：短文档隐藏，长文档出现，长→短→长切换正常；工具栏刷新异常不打断导航器布局。
- **完整性**：`#write` 不变；事件监听和单 DOM 实例；不恢复旧第二诊断浮窗；无新的外部依赖。

不要把 `jsdom` 的 CSS 源码断言、伪造 `getBoundingClientRect()` 或测试桩当成**真实像素布局验收**；必须区分自动化契约与实际 GUI。

## T2. 真正的 Typora GUI 视觉验收

使用用户真实测试场景，不要更改原始 fixture 内容：

| 文档/场景 | 需要证明 |
| --- | --- |
| `01-中文学术论文模板.md` | 1 warning 时方块为警告色，而非未知灰色；定位“表格缺少表名”正确，先核对是否与可见“表 1”同一对象 |
| `Generic-Locator-Runtime-Test.md` | 7 warnings 时方块色正确，缺失资源的图片统计不误导，可定位、可关闭 |
| `Document-Diagnostics-Code-Integrity...md` | 11 warnings 下列表可滚动、路径不撑宽、正文位置不漂移 |
| 混合诊断文档 | 1 error/3 warning/7 hint 时方块红色，过滤分类正确，提示与未知颜色有区别 |
| 完全正常与仅提示文档 | 绿色健康 / 专用提示色，二者不同于未知灰 |
| 图管理与锁定 | 同一宽度，按钮禁用原因真实，锁框仅在锁定时显示 |
| 多文档切换 | 5 文档切换并连续操作 10 次，不串颜色/数字/锁定/图片数据 |
| 窄宽与侧栏拖拽 | 拖拽侧栏、窗口小→大→小，无双边错位、无闪烁和导航器误显示 |
| 主题与 DPI | 浅色/深色；100%、125%、150% DPI；hover/focus/readability/geometry |

**证据要求**：收起态、三个标签展开态、1-warning 错色修复前后、混合诊断颜色、不同宽度、深浅主题以及定位前后的真实截图（保存到本地忽略目录，避免提交含本机隐私的截图）。如无法用 CDP 获取真实 DOM，不得把多次坐标点击失败当成成功；可以提供本地可执行的 GUI 测量脚本/人工步骤。`NEEDS_MANUAL` 不得转换为 `PASS`。

## R1. 完整验证、循环修复与退出条件

执行项目存在的真实命令（先读取 `package.json`，不要凭空假设所有脚本都存在）：

```powershell
pnpm run typecheck
pnpm run build
node scripts/verify-image-privacy.mjs --all
```

再执行定向 Vitest、全量 Vitest，以及存在时的 `pnpm run docs:verify`。核对 build 输出、实际部署产物 SHA256、运行时单插件实例、无错误/警告控制台回归。对于需要网络 GitHub 仓库和 PAT 的端到端上传/下载，未获用户新的执行授权时仅做到安全预检和模拟验证，标 `NEEDS_MANUAL` 或 `BLOCKED_CREDENTIALS`，不得偷偷发起传输。

**执行循环**：

```text
AUDIT
  -> REPRODUCE (capture before evidence)
  -> ROOT_CAUSE (prove which layer)
  -> MODIFY MINIMALLY
  -> TARGETED_TEST
  -> FULL_TEST / TYPECHECK / BUILD / PRIVACY / DOCS
  -> RUNTIME_GUI_VERIFICATION
  -> [FAIL?] -> ROOT_CAUSE -> MODIFY -> REPEAT
  -> [ALL AUTOMATABLE PASS + GUI outcome honest] -> FINAL_REPORT
```

当连续尝试没有增加新证据或没有任何实质进展时，停止重复盲试，输出阻塞原因和精确手动重现步骤；禁止无限重试、跳过失败或篡改基线、削弱断言、修改 fixture 以伪造成功。用户要求“一次性循环执行直到任务结束”意味着**在本会话内尽可能完成所有可完成项**，而不是承诺未来后台交付。

### 不可突破的边界

- 不升级 Typora，不修改 Typora 安装目录 / 社区框架，不自动合并 `main`，不强制 push。
- 不修改用户 Markdown 原文，不往 `#write` 注入插件 UI/警告文本，不破坏撤销重做。
- 不泄露 GitHub PAT、授权标识、本机用户目录或个人路径；截图/报告必须经过隐私检查；不把凭据、全局图库内容或 `.gitignore` 归档原件推到 GitHub。
- 不降低任何 P0 测试门槛；既有业务与定位算法原样保留，若行为必须改动，先证明原因并添加回归用例。
- 不新增自动停靠/智能避让/第二浮窗；先保证单浮层模式稳定。

## R2. 最终交付格式

最终报告须包含：

1. **Git**：分支、开始/结束 HEAD、是否提交与推送、工作区状态、未处理的用户修改（如果存在）。提交推送必须按现有仓库授权与流程，不能强推。
2. **P0 根因**：对“1 warning + gray square”提供证据链：哪个快照/状态/DOM/CSS 处错误，修复前后输出是什么，真实 GUI 是否验证。
3. **架构改动**：诊断状态单一权威、文档 epoch 隔离、实际修改文件、废弃 CSS/DOM 说明。
4. **视觉**：顶部/底部上下等宽测量数值，15px 色块、主题配色与诊断行栅格、图片页和锁定页新样式；真实截图所在的本地安全目录。
5. **测试**：定向及全量实际文件/用例数、typecheck、build、privacy、docs、部署 SHA 校验，失败及复测均要如实列出。
6. **真实 GUI**：每项 `PASS / FAIL / NEEDS_MANUAL / BLOCKED`，各自证据，不把测试桩结果当实际视觉证据。
7. **未解决项**：精准阻塞、可复现步骤、下一步最小行动；不掩盖已知失败。
8. **文档归档**：将本轮已完成的工程结论整合进现有 `docs/modules/`、`CHANGELOG.md` 和必要的运维说明；一次性提示词的归档方式服从项目既有本地忽略策略，不复制原件进 GitHub 若与现行策略冲突。

**立即开始 G0，不要只返回方案。请持续执行能在当前 DSH 会话内完成的工作，直至 P0 修复、UI 精修、自动化回归和可访问的真实 GUI 验收完成或留下诚实的明确阻塞。**

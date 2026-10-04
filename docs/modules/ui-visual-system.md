# 插件 UI 视觉体系（Typora Native+）

> 本文档是从历史 UI 系列任务模板中提取的**耐久视觉规范**（参见文末「来源」）。这些模板均为任务正文：正文自报的 STATE 块可采信，**未执行/未验收的 PASS 占位一律不得照抄**。凡需要真实 Typora 截图才能判定的人工视觉项，本文档统一标注为 `PENDING_USER_MANUAL_CHECK`，不写 PASS。
>
> 适用范围：墨章 InkChapter 的全部注入 UI（文档检测 Problems Control、编辑/锁定、回到顶部/底部 Navigator、Diagnostics Drawer/Sheet、Settings Workbench、Caption Dialog、Context Menu、Toast 等）。

## 1. 定位与目标

- 视觉语言一句话：**Typora Native+**——插件 UI 是 Typora 的增强层，不是独立 Web App；追求**轻、稳、密、静**（低对比边框与少阴影、控件尺寸与状态不跳动、高信息密度、动画克制不抢正文）。
- 视觉层级固定：正文（Level 0）永远是主角 → 辅助工具（Level 1：Problems Control、Navigator，低存在感）→ 任务面板（Level 2：Diagnostics Drawer/Sheet、Settings Workbench，扁平紧凑）→ 强交互（Level 3：Dialog/Confirm/危险操作才允许更高视觉重量）。
- 禁大型 UI 框架（React/Vue/Tailwind/AntD/Element Plus 后台风格），只为少数图标建极小 wrapper；**正式功能图标禁止 Emoji/Unicode 混搭**。
- 禁止：卡片墙、胶囊按钮墙、每个状态都做成实体按钮、过度圆角、大阴影、大面积高饱和色、渐变滥用、固定屏幕坐标 hack、极端 z-index 竞争。

## 2. 布局契约

- **文档检测（Diagnostics Problems Control）与 编辑/锁定切换 = 编辑器右上角同一工具组**（DocumentActionCluster），属于“当前文档状态工具”，不得移到设置页/底栏/右键菜单作为唯一入口；同一轻量外壳容器内放 Error Segment、Warning Segment、分隔线、Edit/Lock Icon Action，禁止三个区域各自加边框/圆角/shadow。
- **回到顶部/到底部 = 编辑器右侧下方纵向浮动组**：统一一个 vertical floating group（一个共享 rail shell + 两个按钮），不散落、不占正文排版宽度、不遮挡 Typora 滚动条与正文/表格/图/代码；位置由 editor/visible viewport 几何驱动，resize、sidebar 开合、文档切换后重新判定；接近顶部/底部时对应按钮进入 disabled/low-emphasis。
- **有“提交性质”的范围选择（全局默认 / 当前文档 等）必须显式确定/取消**：禁止关窗当取消、禁止选项点击后立即执行不可逆操作、无选择不可误提交；`Esc = 取消`，Enter/Escape 行为合理。保留原业务语义，只优化表达。
- **z-index 分层体系**：`toolbar → floating-controls → popover/dropdown → tooltip → modal-backdrop → modal` 明确分层；文档右上角工具不压 modal、tooltip 不被 toolbar 截断、floating 不盖 modal；不破坏 Typora 自带菜单/查找框等原生层级。**禁 999999 / 2147483647 级暴力竞争**，用最小充分值。
- **pointer-events 契约**：非交互容器 `pointer-events:none`，可交互子元素恢复 `auto`（避免透明容器吞事件或盖住编辑区；编辑锁定禁止用整区 pointer-events:none 作假修复）。
- **生命周期**：全部 UI 有 `mount / update / unmount` 与资源释放（listener、observer、debounce、Esc cleanup）；文档切换/主题切换/reload 不重复 mount、不重复注册 listener、不残留 floating/toolbar 副本。

## 3. Design Tokens

颜色/尺寸一律走插件 scoped token（`--ink-ui-*`），不再散落硬编码值。

### 3.1 颜色语义（低饱和、偏灰、克制）

| Token 语义 | 说明 | 参考基调（Light） |
|---|---|---|
| `--ink-ui-bg` | 面板/浮层底色 | `#ffffff` |
| `--ink-ui-bg-subtle / -hover / -selected` | 弱背景/悬停/选中背景 | `#f7f8fa / #f2f4f7 / #f3f6f9` 级 |
| `--ink-ui-text / -secondary / -muted` | 文本三级 | `#24272b / #5f6670 / #8a919b` 级 |
| `--ink-ui-border / -subtle` | 边框两级 | `#e2e5e9 / #eceef1` 级 |
| `--ink-ui-accent / -hover` | 选中/主 CTA 强调 | 低饱和蓝（约 `#4f7cac / #426d99`）|
| `--ink-ui-error / -warning / -info / -success` | 问题类型语义色（muted 使用） | 约 `#c85a5a / #b7832f / #587fa8 / #5f8b68` |

语义分离（重要）：**severity 颜色 = “这是哪一种问题”**（只用于 icon、必要的小数字、2px 指示线、极浅 tint）；**selected 背景 = “用户当前选中/正在查看哪一项”**（统一 neutral/accent selection `--ink-ui-bg-selected`）。选中错误、选中警告都不得使用红/黄 selected 背景；禁整块红/黄背景、大面积 severity border、红/黄实心按钮、大面积 badge 填色。

### 3.2 间距（4px Grid）

只允许主步进 **4 / 8 / 12 / 16 / 24**；避免 7 / 11 / 13 / 18 / 22 等偶然值。用法参考：icon gap 4；control gap 4/8；Issue row padding 8/12；section gap 16；major gap 24；panel padding 12/16。设置表单内控件默认高 30–32px、字号 13px。

### 3.3 圆角

| 组件 | radius |
|---|---|
| Input / Button / IconButton | 4px |
| Toolbar / Navigator / Popover / Context Menu | 6px |
| Drawer / Dialog | 8px |

禁止 12/14/16/20px 的大圆角 SaaS 风。

### 3.4 阴影（仅三档，浮层专属）

```css
--ink-ui-shadow-toolbar: 0 1px 4px  rgba(0, 0, 0, .05);
--ink-ui-shadow-popover: 0 4px 12px rgba(0, 0, 0, .08);
--ink-ui-shadow-dialog:  0 10px 30px rgba(0, 0, 0, .12);
```

Section、Issue row、Preset Card（选中可用 accent border 表达）无 shadow；Navigator 无/极弱 shadow。

### 3.5 字体层级（四层为主）

| 层级 | 规格 |
|---|---|
| 页面/面板大标题 | 18–20px / 600 |
| Section/面板标题 | 15–16px / 600 |
| 控件/Issue 主标题等 | 13–14px / 500 |
| 辅助说明/muted 文本 | 12px / muted（极限元数据可 11px） |

禁止插件 UI 字号与 Markdown H1/H2 争夺注意力；UI body 常用 13px/400、Issue detail 12px muted（行高 1.5–1.6）。

## 4. 组件规范

### 4.1 按钮：只有三类

- **Icon Button**：28×28px、border:none、background:transparent、radius:4px；用于 close/refresh/edit/lock/unlock/up/down/more。hover=`--ink-ui-bg-hover`。
- **Text Button**：取消/应用/保存/次级确认，紧凑、轻边框、小圆角。
- **Primary Button**：**仅真正的 CTA**（确认/保存设置/关键提交）。错误、警告、定位、重新检查、关闭、删除等一律禁止做成 Primary/实心红黄。
- 配套原则“**状态不是按钮**”：状态/数量/severity/metadata 默认不做实体按钮；关闭/刷新/编辑/展开/导航优先 Icon Action；保存/应用/确认/删除才考虑 Button。

### 4.2 图标

- 统一 SVG stroke icon 体系：**尺寸 14–16px、stroke-width 1.5–1.75**（错误 circle-x、警告 triangle-alert、信息 circle-info、成功 check、刷新 rotate-cw、关闭 x、编辑 pencil、锁/解锁 lock/unlock、上下 chevron、定位 chevron-right/arrow-right、更多 ellipsis）。
- 纯图标按钮必须 `tooltip + aria-label`（title 亦可）；同一状态同一图标，禁 Emoji 与 SVG 混搭、禁多种 stroke/尺寸混用。

### 4.3 Navigator（回到顶部/到底部，单实例常驻）

- 呈现三态（工程 authority 冻结）：**gutter → inset → hidden / NO_SAFE_PLACEMENT**；由可滚动性 + 右侧真实 gutter/安全 rail 几何判定，**禁止“小视口 = 隐藏”**、禁止以 `window.innerWidth` 当唯一判据。
- 视觉：gutter 模式整组宽约 **30px**、按钮高 **28px**、radius **6px**（V1 规范建议；具体以 `--ink-ui-radius-sm`/现有 token 落盘为准）；上下按钮共享一个 rail shell，仅按钮间一条 subtle divider，禁止每按钮独立 Card。
- 存在感：idle `opacity: .68–.76`，hover 恢复到 1，disabled 按钮 `opacity: .28–.32`；hover 才完全“亮起”，默认低存在感。
- **尺寸变化必须用真实 measured size**：任何视觉宽度改动（如 30px）后，rail/inset 判定必须读取真实 `offsetWidth/offsetRect` 而非旧常量；位置漂移设 1–3px 级容差 invariant，禁止高频自修复循环（drift 不通过轮询/自动回拉掩盖）。
- Drawer 只改变可用几何，不直接驱动 navigator hidden（Drawer 打开时按新 rail 重新计算 gutter/inset）。

### 4.4 Diagnostics Drawer / Sheet（单 drawer，非 Card Wall）

- Diagnostics 是**一个 drawer 容器 + 内部扁平 Problems List**（icon + 主标题 + muted 说明 + 行间 divider），禁每项独立 Card（禁 Card Wall）。
- 宽屏 drawer：clamp 型宽度（建议 360–380px，中屏 340–360px，最终受 visible editor viewport 约束）；radius 8px、轻 shadow、单层 border。
- Header 两层：Row1 = 标题 + refresh/close（均为 icon-only 28×28，tooltip=“重新检查文档/关闭文档检测”）；Row2 = `全部 N 错误 N 警告 N`（提示 N>0 才显示）计数文本。
- Severity Filter 用**文本 Tab**（全部/错误/警告/提示），禁 Pill、禁大按钮组；active = `font-weight:500` + 底部 2px 指示线（错误/警告 tab 可用 muted 语义色）。
- **Issue row**：`padding: 9px 12px`、`min-height: 44px`；title 13px/500、detail 12px muted；右侧行号类 metadata（如 `第 24 行` / `H3 · 第 24 行`，只显示真实存在的 metadata，禁止编造行号）。
- **行 = 定位入口**：禁独立 `[定位]` 按钮；click / Enter 定位（多目标行点击在目标间循环，如 `1/2 → 2/2`）。
- Selected：点击定位后 Issue 行获得轻量 selected（`--ink-ui-bg-selected`，可选左侧 2px accent），**不按 severity 变色**；正文定位高亮用 accent（浅 tint 背景 + 细 outline，约 1.2–1.8s 淡出），禁粗红框/亮黄/闪烁。
- 空状态：check icon + “未发现文档问题”，不显示 `错误0 警告0 提示0`。
- 窄屏：切 **editor-contained Sheet**（见 §5），不建立第二套数据/状态逻辑（复用同一份 DOM 内容，只改 presentation）。
- 单实例：`drawerCount<=1`（DUPLICATE_MOUNT_GATE）。

### 4.5 Toolbar / Problems Control（右上角）

- 外层唯一轻量容器；内部 Error/Warning Status Segment + divider + Edit/Lock，勿重复加边框。
- **Status Segment 视觉状态**：idle = 透明背景、severity icon 用 muted 色、数字用 normal text（不整块红/黄）；hover = `--ink-ui-bg-hover`（不红/黄底）；active = 极淡 neutral/tinted 背景 + 底部 2px severity 指示线；zero = 默认隐藏该段。
- 交互：点 Error/Warning 段 → 打开 Drawer 并切到对应过滤；Drawer 与 Toolbar 不得维护两套 filter state。
- **Smart Summary 动态隐藏零项**：有 error+warning 显示两段；只有其一显示一段；全 0 只显示 check/「文档正常」；**禁止输出 `错误 0 警告 0 提示 0`**。计数语法统一：Toolbar = icon+数字、Drawer = `错误 N`、Summary = `N 个错误 · N 个警告`。

### 4.6 Settings Workbench 的 Tab / Panel / Section

- Tab 用**类 Typora 原生文本 tab**（设置页 4 Tab 固定为 编号方案/标题格式/文档规则/图表对象，不加第五个；Diagnostics 的 severity filter 同为文本 tab）：active = `font-weight 略增/500` + **2px 底边线**；inactive muted；hover 轻微；禁蓝色大按钮、Pill、圆角 segmented、Card 化 tab。
- Panel/Section 扁平：Panel 不加 Card/shadow/大圆角；内部 Section 用 spacing/字号/subtle separator 分组（`Page → Section → Control`），禁 Card 套 Card。
- Form 控件统一：高 30–32px、13px、radius 4px、1px subtle border；focus = accent border + 2px 弱 ring（禁强蓝 halo）；禁每字段各自 inline width。
- 底部操作栏单实例、4 Tab 共享：只允许一个 Primary（`取消 = Text，保存/应用 = Primary`），禁多个同权重大按钮；保存样式/保存并应用/取消更改语义区分见 [settings-ui.md](settings-ui.md)（属 Phase 2-D 范围，仅记录未实现）。
- 状态区 = Compact Summary（字段 = 当前样式 · 来源：全局默认/当前文档 · 标题编号：已启用/关闭；示例形态 `论文.md · 样式1 · 来源：全局默认 · 已启用`），无大 Card/无大留白。

## 5. 响应式规则

- **一律基于真实容器宽度**：settings 用 settings 容器宽度、toolbar/navigator/diagnostics 用 editor visible viewport（`visibleWidth`，即 `#write` 内容与滚动视口相交），**禁以 `window.innerWidth` 作唯一判据**、禁 blanket hide、禁固定屏幕坐标。
- Toolbar 三档（full → compact → suppressed）按真实编辑器内容可见宽度渐进压缩（参考阈值 compact≈520px、suppressed≈280px 只是语义起点；**禁止机械调 280/520 掩盖几何错误**）。窄档 icon-only 必须有 tooltip/aria-label，edit/lock 切换宽度稳定不抖动。
- Diagnostics 响应式：宽屏 anchored drawer → 窄屏 **viewport-level sheet**（可读性优先），建议 sheet 尺寸 `left/right: 8px、max-height: 70vh` 级，**以可见 editor viewport 为界**：
  - 不覆盖 Sidebar/文件树、不横跨 sidebar、不遮 Typora 滚动条、不盖 Typora 顶部主菜单区域；
  - `Esc` 可关；关闭逻辑、focus、定位继续工作；
  - 宽/窄模式切换不重复 mount，resize 允许布局切换但不得重建数据层。
- Navigator 响应式：无足够 gutter → inset；gutter/inset 均无安全空间且已知几何 → hidden（禁因 DevTools/中等宽度“小视口=隐藏”误判）；仅保留最小 editor-contained 呈现，绝不强行铺满工作区。
- Settings Workbench：宽 = 4 Tab 单行、summary 单/双行；中 = 4 Tab 单行紧凑；窄 = tabs 单行紧凑，必要时 `overflow-x:auto`（禁 Tab 文字折行造成高度跳变）。

## 6. Dark / Light 主题跟随

- 判定优先级（固定）：
  1. Typora 原生 CSS variable；
  2. Typora theme class / body marker；
  3. 插件语义 token 映射（`--ink-ui-*`）；
  4. `prefers-color-scheme` **仅作 fallback**。
- 禁硬编码某个主题名；禁只支持默认主题；禁扫描主题文件/高频观察器；必须覆盖「OS Light + Typora Dark」与「OS Dark + Typora Light」组合。
- 暗色下不得出现：白底弹窗、黑底黑字、hover 文字消失、border 过亮。主题色禁止 `#fff/#000` 散落组件。
- 现状：token 就绪即可推进 Light V1，`DARK_THEME_VISUAL=PENDING_USER_MANUAL_CHECK`（不因此阻塞 Light）。

## 7. Motion

- 时长家族 **100–180ms**（hover 100–150ms、popover 120ms、drawer/sheet 150–180ms、tab underline 120ms 量级；V1 建议 120–160ms ease）。
- **只 transition：background / opacity / border-color / color**。
- 禁止：scale、bounce、spring、translateY 大幅 slide、闪烁/闪光动画；滚动动画短而自然。
- 禁永久 `requestAnimationFrame` 循环 / `setInterval` 轮询刷 UI（事件驱动 + rAF 合并；状态刷新复用文档事件/store 生命周期）。

## 8. CSS 纪律

- 样式限定墨章 namespace：`.inkchapter-*` / `--ink-ui-*` / 文档级 `--inkchapter-*` token；禁 `button{} / input{} / svg{} / [role=tab]{}` 全局选择器；禁直接覆盖 Typora 原生通用选择器。
- 禁 inline width hack（如 `style="width:137px"`、`margin-left:11px`），优先 class/token。
- 编译产物 scoped；ownership selector 不得携带 viewport 几何；禁 999999/2147483647 z-index；新增样式类建议遵循 BEM 式 `inkchapter-…__…` 命名。
- Typora API 与 DOM 操作集中在 infrastructure（不在此页展开，见对应模块文档）。

## 9. 结构门禁与当前工程状态

### 9.1 单实例/门禁（Runtime 结构硬约束）

```text
toolbarCount    = 1        （常驻单实例，suppressed 只隐藏不销毁）
navigatorCount  = 1        （常驻单实例 DOM，hidden 不销毁/不重建）
drawerCount     <= 1       （DUPLICATE_MOUNT_GATE）
settings root   = 1        （workbench tabs = 1 group、active content = 1）
```

文档切换/主题切换/reload 后必须复查：不重复 mount、无重复 listener、无残留 observer、无状态串文档。

### 9.2 工程状态摘要（截至 2026-09，git HEAD = `37c14f3`）

已提交（`git log`：`37c14f3` = UI Phase 2-C workbench + 2-B.2/2-B.3/2-B.3.1 visible-editor geometry & navigator safe-rail；前序 `48f6c5f` = Phase 2-B 响应式、`6b3cf21` = Phase 1 foundation）：

```text
UI Phase 1              已提交：scoped --ink-ui-* token、右上角工具组、右侧导航组、
                        diagnostics badge/drawer 基础、Esc cleanup、单实例与 lifecycle 防护
UI Phase 2-B            已提交：gutter-aware navigator、toolbar full/compact/suppressed、
                        diagnostics sheet（2-B.2 visible-editor geometry 修正、2-B.3
                        runtime wiring、2-B.3.1 safe-rail 工程）
UI Phase 2-C            PHASE_2C_SETTINGS_WORKBENCH=ENGINEERING_PASS（Settings Workbench
                        4-tab 单实例代码已提交至 37c14f3，详见 settings-ui.md）
```

仍待人工视觉验收（**PENDING_USER_MANUAL_CHECK**，未执行截图前禁止写 PASS）：

```text
RESPONSIVE_NAV_VISUAL=PENDING_USER_MANUAL_CHECK
RESPONSIVE_TOOLBAR_VISUAL=PENDING_USER_MANUAL_CHECK
RESPONSIVE_DIAGNOSTICS_VISUAL=PENDING_USER_MANUAL_CHECK
SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK
DARK_THEME_VISUAL=PENDING_USER_MANUAL_CHECK
```

后续阶段阻塞（按任务模板自报）：

```text
UI_PHASE_2D+ = BLOCKED_BY_PHASE_2C_VISUAL_ACCEPTANCE
Phase 2-D（标题格式双栏编辑器 / Form Grid / 保存语义）  未开始
Phase 2-E（Preset 降噪 / 图/表/代码/公式对象矩阵）      未开始
Phase 2-F（Diagnostics 扁平化 / Caption token / Menu）  未开始
Phase 2-G（Typora Theme Native / Light/Dark 收尾）      未开始
UI Visual Consolidation V1（Problems Control/Smart Summary 等组件视觉）= NOT_STARTED
（注：工作区存在尚未提交的 Native+ 视觉落盘改动，均未人工验收）
```

本页正文为**规范目标**，其中 Phase 2-D~2-G 涉及的组件形态（双栏、矩阵等）属规划内容，不代表已实现。

### 9.3 业务冻结清单（UI 任务不得触碰）

```text
标题编号算法 / 侧栏目录编号 / 图 / 表 / 代码 / 公式编号算法
strict 标题诊断规则（含 severity 判定）/ 文档尾部空行规则
caption 名称数据模型 / 诊断扫描规则与判定
scope 行为与语义（global/document 继承）/ config key / config schema
文档锁定语义 / Navigator scroll 行为
```

UI 改造中发现业务问题只记录、不借机扩范围。

## 来源

以下均为历史 UI 任务模板（正文 STATE 可采信，占位 PASS 不采信）：

- `Typora墨章插件_UI布局优化_Trae提示词.md`
- `ZCode-DeepSeekV4-Typora-UI-Phase2-Fix-Prompt.md`
- `ZCode-DeepSeekV4-UI-Phase2B-Runtime-Responsive-Fix.md`
- `ZCode-DeepSeekV4-Typora-Phase2B1-Phase2C-Visual-Closure.md`
- `ZCode-DeepSeekV4-Typora-Phase2B2-Visible-Editor-Geometry-Fix.md`
- `ZCode-DeepSeekV4-Typora-Phase2B3-Navigator-Runtime-Wiring.md`
- `ZCode-DeepSeekV4-Typora-Phase2B3-Navigator-DevTools-Fix.md`
- `ZCode-DeepSeekV4-Typora-Phase2B3-1-Navigator-Safe-Rail-Visual-Correction.md`
- `ZCode-DeepSeekV4-Typora-Phase2B3-2-Test-Convergence-Drift-Closure.md`
- `ZCode-DeepSeekV4-Typora-InkChapter-UI-Visual-Consolidation-V1.md`
- `ZCode-DeepSeekV4-Typora-InkChapter-UI-Visual-Consolidation-GreenBaseline.md`
- `ZCode-DeepSeekV4-Typora-UI-Phase2C-2G-Visual-Refactor.md`
- `ZCode-DeepSeekV4-Typora-InkChapter-UI-FIRST-Full-Execution.md`
- `ZCode-DeepSeekV4-Typora-InkChapter-UI-FINAL-OneShot-Execution.md`

工程事实交叉核对：`git log`（HEAD `37c14f3`）与 `src/settings/heading-numbering-setting-tab.ts`（Phase 2-C Workbench Shell）、`src/style.scss`（`--ink-ui-*` / `.inkchapter-wb-*`）等源码。

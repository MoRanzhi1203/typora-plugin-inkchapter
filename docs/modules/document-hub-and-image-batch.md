# Document Hub & Image Batch（状态方块 / 一体化可展开工具栏 / 图片批量 / 导航器规则）

> 适用版本：V5.2（一体化重构 + Fluent Compact 精修）。
> 相关源码：`src/document-utilities/document-status-indicator.ts`、`document-hub-model.ts`、
> `document-hub-controller.ts`、`document-utility-overlay-host.ts`；
> `src/image-management/document-image-batch.ts`、`document-image-batch-service.ts`；
> 设置页 `src/settings/image-management-setting-tab.ts` 及三级作用域服务。

## §1 视觉根因（白色外壳）与最终外壳处理

右侧“白色圆角按钮/浮窗”并不是方块自身的样式，而是**祖先节点**：

```scss
/* src/style.scss（历史规则） */
.inkchapter-doc-toolbar {
  background: var(--ink-ui-utility-surface, #fff);
  border: 1px solid var(--ink-ui-utility-border, #ddd);
  border-radius: var(--ink-ui-utility-radius-toolbar, 6px);
  box-shadow: var(--ink-ui-shadow-float, 0 2px 10px rgba(0, 0, 0, .12));
  padding: 1px 4px;
}
```

V5.1/V5.2 的状态方块与标签栏都挂在这个容器内，所以只改内部方块会留下“白壳”。
当前处理：

- `.inkchapter-doc-toolbar` 只中和视觉外壳（`background: transparent`、`border-color: transparent`、
  `box-shadow: none`），**保留**历史 geometry 需要的 32px/4px 尺寸契约；
- 承载节点 `.inkchapter-doc-status-host` 显式 `32px × 32px`，避免 toolbar 宽度归零导致
  “不可渲染”判定；
- 组件根 `.inkchapter-doc-toolbar-ui` 以 host 的 rect 锚定 `top`，整个组件使用固定的
  `right: 12px` inset（不再由方块单独决定右端位置）；
- 旧 `.inkchapter-doc-toolbar` 仅作为 32×32 锚点容器，不再承担任何宽度/背景职责。

## §2 收起态：一个纯色方块

- 15px 纯色方块（圆角 3px），32px 透明热区：`background: transparent`、`border: 0`、`box-shadow: none`。
- 颜色：`GREEN #2f986d` / `YELLOW #d49a26` / `RED #d24d57` / `GRAY #929aa4`
  （错误优先；未检查/检测中/结构未验证不冒充绿色）。
- 锁定时仅在方块外显示 1.5px 中性细线框（22×22 框、`currentColor`），不改变三色；
  `focus-visible` 用虚线轮廓，与锁定实线框区分。
- 收起态 layout 宽 40px、高 36px（`root` 为 `pointer-events: none`），仅状态按钮的 32×32
  热区可命中；布局在 `pointer-events` 上不覆盖编辑区，点击热区外 20px 即命中编辑器。
- **收起/展开方块位置稳定**：header 的 grid 列由 `tabs { grid-column: 1 }` 与
  `status { grid-column: 2 }` 显式固定；tabs 隐藏时状态按钮仍留在 38px 状态列，不会自动
  落入第一列造成方块漂移。

## §3 展开态：单一等宽布局权威 + Fluent Compact 视觉

```text
.inkchapter-doc-toolbar-ui                 (fixed，right:12px / top 锚定；不承载宽度)
└─ .inkchapter-doc-expand__layout          (唯一宽度权威：收起 40px / 展开 min(360px, 可用))
   ├─ .inkchapter-doc-expand__row          (header，height 36px；grid = 1fr + 38px 状态列)
   │   ├─ .inkchapter-doc-expand__tabs     (3 等分 Segmented 标签，grid-column:1)
   │   └─ button.inkchapter-doc-status     (32px 热区、15px 方块，grid-column:2)
   └─ .inkchapter-doc-expand__panel        (content，width:100%；唯一内容区)
```

- **P0 几何契约**：header 与 content 是同一 layout 的两个 `width:100%`、`box-sizing:border-box`
  子项；`abs(left 差) / abs(right 差) / abs(width 差)` 均 ≤ 1 CSS px。状态列（38px，含
  32px 热区与方块右侧留白）计入 header 总宽度。
- 展开宽度由 JS 写入 `--inkchapter-toolbar-available`，CSS `width: min(360px, var(...))`
  只收缩不移动右锚点；窗口 resize 时重算。
- 单击色块：`data-expanded=true` 立即切换布局宽度（无宽度动画），tabs 以 `clip-path`
  从右向左揭示（180ms）、panel 淡入（120ms）；右端方块不动。
- 再次点击当前标签不再制造空白内容区；点其他标签只替换同一 `content` 内的内容。
- 再次单击色块 / Esc / 外部点击 / 切换文档：整体收起；tabs/panel `hidden`，layout 缩回
  40px，不拦截指针；不重建 DOM。
- 双击色块：只切换真实锁定（260ms 手势仲裁）。
- 视觉 tokens（局部 `.inkchapter-doc-toolbar-ui`，浅色）：`--ink-doc-surface #fafaf9`、
  `--ink-doc-hairline #e7e9ec`、`--ink-doc-text #293241`、`--ink-doc-secondary #737d89`、
  `--ink-doc-selection #e9eef4`、`--ink-doc-radius 6px`；深色覆盖为 `#252526 / #3a3a3a /
  #e6e6e6 / #a0a0a0 / #333333`。
- 面板为单一浅色面：`background: var(--ink-doc-surface)`、1px hairline、6px 圆角、无阴影；
  header 36px，三标签 12.5px，选中为低饱和 `--ink-doc-selection` 背景 + 主文字色（Fluent
  Segmented 感），未选中为 secondary 色。

### §3.1 检测标签（直接诊断列表）

- **没有**摘要页、没有「详情」「返回」按钮、没有第二个诊断抽屉；展开即列表。
- 顶部只保留：真实非零数量概要（如 `11 项警告`、混合 `1 项错误 · 11 项警告`）、筛选
  popup 入口（漏斗图标）与重新检测图标；**不重复“文档检测”大标题**。
- 每行三列栅格：6px 严重级别色点 / 标题 + 可选说明 / 稳定 40px 右对齐行号
  （`L<行号>`，空行号也占位）；标题 13px 单行截断，说明 12px、最多两行。
- 数据来源：host 用 `flattenDiagnosticsToProjections` + `sortProjectionsByDocumentPosition`
  生成列表（目标组/多目标单行规则与文档位置排序完全复用历史实现），
  再以 `resolveDiagnosticCopy` 取标题/说明；**不重新计算诊断**。
- 筛选：点击漏斗打开 Fluent 菜单 popup（`全部/错误/警告/提示` + 计数），选择只做视图过滤；
  Esc 或面板内其他位置点击关闭 popup（不关闭工具栏）；空筛选结果显示 `没有匹配项`，
  不用“未发现问题”冒充扫描成功。
- 点击行：调用 host 既有 `locateDiagnostic(diagnosticId)` 真实定位事务，随后收起工具栏。
- 列表独立滚动（`max-height: min(380px, 可用面板高度 - 64px)`）。零诊断时只由概要表达：
  已检查且 0/0/0 显示 `未发现问题`（GREEN）；未知/未验证/空工作区显示 `未检查`（GRAY），
  不再在列表里重复健康文案；筛选后无命中才显示 `没有匹配项`。

### §3.2 状态权威（V5.2 STATUS-AUTHORITY）

- 方块颜色与列表/筛选计数来自**同一份已准入快照**：列表先经 `selectDocumentDiagnostics`
  （document 域）过滤，计数直接由列表条目派生；不再用第二套 projection 计数。
- 颜色优先级（`resolveDocumentStatusCode`）：
  1. 无文档 / 检测关闭 / 检测中 / 无投影 → GRAY `#929aa4`
  2. error > 0 → RED `#d24d57`
  3. warning > 0 → YELLOW `#d49a26`（结构未验证也绝不吞掉已知警告）
  4. hint > 0 → HINT `#66869f`（提示专用色，不冒充警告）
  5. 0/0/0：结构已验证 → GREEN `#2f986d`；未验证 → GRAY（不冒充健康）
- 文档身份防御：`snapshot.documentKey !== 当前 documentKey` 时视为 stale（GRAY + 空列表）；
  正常准入由 `admitDiagnosticsSnapshot` 按 documentKey + revision 丢弃迟到结果。
- 锁定只改外框（`currentColor` 细线），不参与颜色判定。
- 回归：`document-hub-status-authority-v1.test.ts`（unverified+warning=YELLOW、颜色矩阵、
  A→B→A、stale 隔离）+ `document-status-indicator.test.ts`。

## §4 图片标签与约束

- 未启用：一行「图片管理未启用」+ 配置。
- 当前文档无图片：一行「当前文档无图片」+ 设置；批量按钮保留但禁用，`title/aria-description`
  给出原因（不显示 0 计数行）。
- 有图片：概要为「范围 · N 处引用」；独立事实行只显示预检支持的非零项：
  `可上传 N · 可下载 N · 缺失 N · 可复用 N`（缺失本地图绝不并入可上传）；
  可选一行 `插入：… · 自动同步：…` 摘要；主操作两列等宽「上传全部」「下载全部」，
  次级行「检查并补齐双链」「当前文档设置」。
- 批量操作沿用 `预检 → 用户确认 → 执行`，复用 `REUSED_*`/`NEW` 语义，默认不改写 Markdown；
  预检不创建任何目录，实际落盘必须经用户确认。
- 详细配置进入完整设置页，不在工具栏内展开表单。

## §4.1 锁定标签

- 仅一行：锁图标 + `编辑中` / `已锁定` + 右侧 `锁定` / `解锁` 按钮。
- 与色块双击共用同一 `editGuard` 锁定服务；锁定成功后色块细框同步，失败保持旧状态并提示。
- 内容区宽度始终等于检测/图片标签，仅高度随内容变小。

## §5 生命周期与隔离

- 文档切换（host `reconcileActiveDocument` 的 full 分支）调用 `close()`，清空上一文档详情。
- 图片摘要/工具栏渲染失败只影响自身（fail-open），不中断诊断、几何或导航器。
- 导航器规则保持：只有真实纵向滚动范围才显示；短文档隐藏；长短切换与窗口尺寸变化后重算。
- UI 节点仅在 overlay 宿主内，绝不进入 `#write` 或 Markdown 序列化内容。
- 单实例：一个 `.inkchapter-doc-toolbar-ui` / `.inkchapter-doc-expand__layout` / panel；
  标签切换只替换 content 子节点。

## §6 测试

- `document-hub-controller.test.ts`：收起无白壳、锁框中性、单击/双击仲裁、三标签单内容区、
  等宽布局权威（header/content 同父 + width:100% + 状态列在 header 内）、Fluent tokens
  与深浅主题、15px 方块 / 36px header、筛选 popup 交互与空结果、图片等宽主操作与空状态、
  锁定单行与图标、方向键焦点、Esc/外部关闭、单实例。
- `document-status-indicator.test.ts`：新语义色 `#2f986d/#d49a26/#d24d57/#929aa4`。
- `document-hub-model.test.ts`、批量服务测试、`document-utility-navigator-document-switch.test.ts`、
  host 集成与密度测试。

## §7 真实 GUI 验收（Compact Inspector 最终轮）

- 已完成（2026-11-10，125% DPI，1536×782 视口）：
  - 论文 `01-中文学术论文模板.md`：1 项警告 → `data-status=YELLOW`，方块 `rgb(212,154,38)`
    （`#d49a26`），summary `1 项警告`；
  - `Document-Diagnostics-Code-Integrity-Test.md`：11 项警告 → YELLOW / 11 项；
  - `Figure-Standalone-Block-Invariant-Test.md`：7 项错误 → RED `rgb(210,77,87)`；
  - 展开 header/content `1164.8–1523.2`，宽 `358.4`，差值 `0/0/0`；header 36px、panel padding 12px；
  - 锁定标签：锁图标 + `编辑中` + 右侧按钮，切换标签后颜色不变；
  - 展开/收起方块位置稳定；无 360px 透明覆盖层。
- 待人工（NEEDS_MANUAL）：
  - `Phase7-Formula-Runtime-Test.md` 的 GRAY/`未检查` 文案（代码 + 单测固化；GUI 快速打开未切换成功）；
  - 有图文档的 `可上传/可下载/缺失/可复用` 事实行（单测覆盖；GUI 有图文档未重测）；
  - 深色主题与 100%/150% DPI 下的新色值截图；
  - 窗口拖拽/侧栏拖拽、锁定状态真实键入阻断、图片网络传输。

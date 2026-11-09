# Document Hub & Image Batch（状态方块 / 一体化可展开工具栏 / 图片批量 / 导航器规则）

> 适用版本：V5.2（一体化重构 + V5.2 布局重设计）。
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
- 组件根 `.inkchapter-doc-toolbar-ui` 以 host 的 rect 锚定（`right/top`），不占用 rAF 队列；
- 旧 `.inkchapter-doc-toolbar` 仅作为 32×32 锚点容器，不再承担任何宽度/背景职责。

## §2 收起态：一个纯色方块

- 12px 纯色方块（圆角 2px），32px 透明热区：`background: transparent`、`border: 0`、`box-shadow: none`。
- 颜色：`GREEN` / `YELLOW` / `RED` / `GRAY`（错误优先；未检查/检测中/结构未验证不冒充绿色）。
- 锁定时仅在方块外显示 1.5px 中性细线框（20×20 框、`currentColor`），不改变三色；
  `focus-visible` 用虚线轮廓，与锁定实线框区分。
- 收起态布局宽度固定 32px，`root` 为 `pointer-events: none`，仅 32×32 状态按钮可命中；
  **不存在 360px 透明覆盖层**，不遮挡 Markdown 编辑区。

## §3 展开态：单一等宽布局权威

```text
.inkchapter-doc-toolbar-ui                 (fixed，右/上锚定，唯一 DOM 宿主；不承载宽度)
└─ .inkchapter-doc-expand__layout          (唯一宽度权威：收起 32px / 展开 min(360px, 可用))
   ├─ .inkchapter-doc-expand__row          (header，width:100%；grid = 1fr + 32px 状态热区)
   │   ├─ .inkchapter-doc-expand__tabs     (3 等分标签，仅展开时 display:grid)
   │   └─ button.inkchapter-doc-status     (12px 色块 + 32px 透明热区，热区计入 header 总宽)
   └─ .inkchapter-doc-expand__panel        (content，width:100%；唯一内容区)
```

- **P0 几何契约**：header 与 content 是同一 layout 的两个 `width:100%`、`box-sizing:border-box`
  子项；`abs(left 差) / abs(right 差) / abs(width 差)` 均必须 ≤ 1 CSS px。状态热区是 header
  grid 的第二列（32px），绝不悬挂在 header 外侧。
- 展开宽度由 JS 写入 `--inkchapter-toolbar-available`（视口 - 右锚点 - 8px），CSS
  `width: min(360px, var(...))` 只收缩不移动右锚点；窗口 resize 时重算。
- 单击色块：`data-expanded=true` 立即切换布局宽度（不做宽度动画，避免动画帧节流造成测量/视觉
  漂移）；tabs 以 `clip-path` 从右向左揭示（180ms）、panel 淡入（120ms），右端色块不动。
- 再次点击当前标签不再制造空白内容区；点其他标签只替换同一 `content` 内的内容。
- 再次单击色块 / Esc / 外部点击 / 切换文档：整体收起；收起时 `tabs/panel` 均 `hidden`，
  layout 缩回 32px，不拦截指针；不重建 DOM。
- 双击色块：只切换真实锁定（260ms 手势仲裁，不触发展开/收起闪烁）。
- 内容区背景为单一浅色面（浅色 `#fafafa` / 深色 `#262626`），无边框、无阴影、无重复卡片；
  高度由内容自然决定，列表超出时内部滚动。

### §3.1 检测标签（直接诊断列表）

- **没有**摘要页、没有「详情」「返回」按钮、没有第二个诊断抽屉；展开即列表。
- 顶部只保留：真实非零数量概要（如 `3 错误 · 11 警告`）、四个严重级别筛选
  （`全部/错误/警告/提示`，带真实计数）、一个重新检测图标按钮；**不重复“文档检测”大标题**。
- 每行三列栅格：6px 严重级别色点 / 标题 + 可选说明 / 右对齐行号（`L<行号>`，固定 34px 列，
  行号列空时也占位以保持对齐）。
- 标题约 12.5px 单行截断；说明约 11px、最多两行（`-webkit-line-clamp:2`），缺失时不产生空白行。
- 数据来源：host 用 `flattenDiagnosticsToProjections` + `sortProjectionsByDocumentPosition`
  生成列表（目标组/多目标单行规则与文档位置排序完全复用历史实现），
  再以 `resolveDiagnosticCopy` 取标题/说明；**不重新计算诊断**。
- 筛选：仅做视图过滤（`severityFilter`），不改变快照、不重排幸存条目；默认 `全部`。
- 点击行：调用 host 既有 `locateDiagnostic(diagnosticId)` 真实定位事务，随后收起工具栏；
  不会在同一次操作中打开旧诊断抽屉。
- 列表独立滚动（`max-height: min(340px, 可用面板高度 - 64px)`），空快照显示「未发现问题」，
  不显示 0 计数卡片。

## §4 图片标签与约束

- 未启用：一行「图片管理未启用」+ 配置。
- 当前文档无图片：一行「当前文档没有图片」+ 设置；批量按钮保留但禁用，`title/aria-description`
  给出原因（不显示 0 计数行）。
- 有图片：概要为「范围 · N 处引用」，可选一行 `插入：… · 自动同步：…` 摘要；
  主操作行「上传全部」「下载全部」，次级行「检查并补齐双链」「文档设置」。
  批量操作沿用 `预检 → 用户确认 → 执行`，复用 `REUSED_*`/`NEW` 语义，默认不改写 Markdown；
  预检不创建任何目录，实际落盘必须经用户确认。
- 详细配置进入完整设置页，不在工具栏内展开表单。

## §4.1 锁定标签

- 仅一行：`当前文档可编辑` / `当前文档已锁定` + `锁定` / `解锁` 按钮。
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
  等宽布局权威（header/content 同父 + width:100% + 状态热区在 header 内）、CSS 契约
  （layout 360/32、tabs 三等分、panel 无 max-width）、measureLayout 差值契约、方向键焦点、
  图片空状态与禁用原因、锁定文案、Esc/外部关闭、单实例。
- `document-hub-model.test.ts`、`document-status-indicator.test.ts`、批量服务测试、
  `document-utility-navigator-document-switch.test.ts`、host 集成与密度测试。

## §7 真实 GUI 验收（本轮已完成 / 待人工）

- 已完成：浅色 125% DPI、100% DPI、150% DPI 下展开测量 header/content 左/右/宽度差均为 0；
  收起态 32px 命中区与纯色方块；检测/图片/锁定切换同宽；诊断行点击后工具栏关闭并真实滚动
  （scrollTop 0 → 889.6）；双击色块锁定/解锁并写入 `#write.inkchapter-document-locked`；
  长文档（scrollHeight 1846 > clientHeight 586）导航器显示；深色主题（#262626 + 浅色文字）。
- 待人工：真实窗口由大变小/侧栏拖拽后复测（自动化窗口 resize 在遮挡窗口下渲染进程不重排）；
  短文档导航器隐藏（需切换短文档）；图片真实上传/下载/补链（需凭据/网络，默认不自动执行）；
  锁定状态下真实键入阻断（避免修改 Markdown，未做真实按键注入）。

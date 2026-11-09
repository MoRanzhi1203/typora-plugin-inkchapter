# Document Hub & Image Batch（状态方块 / 一体化可展开工具栏 / 图片批量 / 导航器规则）

> 适用版本：V5.2（一体化重构）。
> 相关源码：`src/document-utilities/document-status-indicator.ts`、`document-hub-model.ts`、
> `document-hub-controller.ts`、`document-utility-overlay-host.ts`；
> `src/image-management/document-image-batch.ts`、`document-image-batch-service.ts`；
> 设置页 `src/settings/image-management-setting-tab.ts` 及三级作用域服务。

## §1 视觉根因（白色外壳）

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
V5.2 的修复：

- `.inkchapter-doc-toolbar` 只中和视觉外壳（`background: transparent`、`border-color: transparent`、
  `box-shadow: none`），**保留**历史 geometry 需要的尺寸/密度契约；
- 承载节点 `.inkchapter-doc-status-host` 显式 `32px × 32px`，避免 toolbar 宽度归零导致
  “不可渲染”判定；
- 组件根 `.inkchapter-doc-toolbar-ui` 以 host 的 rect 锚定（`right/top`），不占用 rAF 队列。

## §2 收起态：一个纯色方块

- 12px 纯色方块（圆角 2px），32px 透明热区：`background: transparent`、`border: 0`、`box-shadow: none`。
- 颜色：`GREEN` / `YELLOW` / `RED` / `GRAY`（错误优先；未检查/检测中/结构未验证不冒充绿色）。
- 锁定时仅在方块外约 3px 显示 1.5px 中性细线框（`currentColor`），不改变三色；
  `focus-visible` 用虚线轮廓，与锁定实线框区分。
- hover 只做亮度变化，不产生白色按钮外壳。

## §3 展开态：一体化横向工具栏

```text
.inkchapter-doc-toolbar-ui           (fixed，右端锚定，唯一 DOM 宿主)
├─ .inkchapter-doc-expand__row        (横向：标签栏 + 方块)
│   ├─ .inkchapter-doc-expand__tabs   (检测｜图片｜锁定，仅展开时显示)
│   └─ button.inkchapter-doc-status   (色块 + 透明热区)
└─ .inkchapter-doc-expand__panel      (唯一内容区，仅选中标签时显示，最小高度)
```

- 单击色块：标签栏从色块左侧展开（`clip-path + transform + opacity`，180ms；支持
  `prefers-reduced-motion`），默认进入**检测**标签并**直接渲染诊断列表**（无摘要过渡页）。
- 再点当前标签：内容区收起（标签栏保留）；点其他标签切换。
- 再次单击色块 / Esc / 外部点击 / 切换文档：整体收起；收起时 `tabs/panel` 均 `hidden`，
  不占视觉空间、不拦截指针；不重建 DOM。
- 双击色块：只切换真实锁定（260ms 手势仲裁，不触发展开/收起闪烁）。
- 内容区保持紧凑：检测为紧凑诊断列表 + 严重级别筛选；图片 1–2 行摘要 + 操作；锁定一行状态 + 按钮。

### §3.1 检测标签（直接诊断列表）

- **没有**摘要页、没有「详情」「返回」按钮、没有第二个诊断抽屉；展开即列表。
- 每行：严重级别小色点（6px，不重复「错误/警告」全文）、规范化标题
  （`resolveDiagnosticCopy.title`）、可选一行说明（description，单行截断）、文档位置 `L<行号>`。
- 数据来源：host 用 `flattenDiagnosticsToProjections` + `sortProjectionsByDocumentPosition`
  生成列表（目标组/多目标单行规则与文档位置排序完全复用历史实现），
  再以 `resolveDiagnosticCopy` 取标题/说明；**不重新计算诊断**。
- 筛选：`全部 / 错误 / 警告 / 提示` 仅做视图过滤（`severityFilter`），不改变快照、
  不重排幸存条目；默认 `全部`。
- 点击行：调用 host 既有 `locateDiagnostic(diagnosticId)` 真实定位事务（文档身份、诊断 ID、
  目标实例、目标组语义、Active 状态、精确滚动目标全部沿用），随后收起工具栏；
  不会在同一次操作中打开旧诊断抽屉。
- 列表独立滚动（`max-height: 260px`），空快照显示「未发现问题」，不显示 0 计数卡片。

## §4 图片标签与约束

- 未启用：一行「图片管理未启用」+ 配置。
- 当前文档无图片：一行「当前文档没有图片」+ 设置（不显示 0 计数，不显示无效批量按钮）。
- 有图片：一行来源 + 引用数；按钮「上传全部」「下载全部」「双链」「设置」。
  批量操作沿用 `预检 → 用户确认 → 执行`，复用 `REUSED_*`/`NEW` 语义，默认不改写 Markdown；
  预检不创建任何目录，实际落盘必须经用户确认。
- 详细配置进入完整设置页，不在工具栏内展开表单。

## §5 生命周期与隔离

- 文档切换（host `reconcileActiveDocument` 的 full 分支）调用 `close()`，清空上一文档详情。
- 图片摘要/工具栏渲染失败只影响自身（fail-open），不中断诊断、几何或导航器。
- 导航器规则保持：只有真实纵向滚动范围才显示；短文档隐藏；长短切换与窗口尺寸变化后重算。
- UI 节点仅在 overlay 宿主内，绝不进入 `#write` 或 Markdown 序列化内容。

## §6 测试

- `document-hub-controller.test.ts`：收起无白壳、锁框中性、单击/双击仲裁、三标签单内容区、
  详情内部切换、图片空状态与按钮禁用、Esc/外部关闭、单实例、CSS 契约（透明热区/12px/1.5px/
  reduced-motion）。
- `document-hub-model.test.ts`、`document-status-indicator.test.ts`、批量服务测试、
  `document-utility-navigator-document-switch.test.ts`、host 集成与密度测试。

## §7 尚未验证（GUI）

- 真实 Typora 中单击展开/双击锁定/标签点击（125% DPI 合成点击不可靠；合成鼠标事件无法触发
  该窗口内的 DOM click）。
- 展开动画、锁框与焦点视觉、深浅主题、100/125/150% DPI。
- 图片按钮的真实上传/下载/补链（需凭据/网络，默认不自动执行）。

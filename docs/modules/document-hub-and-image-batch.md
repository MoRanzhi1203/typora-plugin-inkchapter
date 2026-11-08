# Document Hub & Image Batch（状态方块 / 可展开工具栏 / 图片批量 / 导航器规则）

> 适用版本：V5.2（提交见 Git 历史）。
> 相关源码：`src/document-utilities/document-status-indicator.ts`、`document-hub-model.ts`、
> `document-hub-controller.ts`、`document-utility-overlay-host.ts`；
> `src/image-management/document-image-batch.ts`、`document-image-batch-service.ts`；
> 设置页 `src/settings/image-management-setting-tab.ts` 及三级作用域服务。

## §1 收起态：纯色状态方块

- 右上角唯一常驻入口是 `.inkchapter-doc-status`（32px 透明热区）。
- 收起时只显示 12px 纯色方块（圆角 2px）：`GREEN` / `YELLOW` / `RED` / `GRAY`。
  颜色语义与 V5.1 一致：错误优先于警告；未检查/检测中/结构未验证不冒充绿色。
- 热区 `background: transparent`、`border: 0`、`box-shadow: none`，没有白色圆角外壳；
  hover 只做轻微亮度变化，激活/展开不恢复白框。
- **只有真实锁定**才在方块外约 3px 显示 1.5px 中性色细线方框（`__lock-frame`），
  锁定不改变三色；`focus-visible` 使用虚线焦点轮廓，与锁定实线框区分。
- 方块以 `data-status / data-error-count / data-warning-count / data-hint-count / data-locked`
  暴露投影；不显示常驻数字或「编辑」按钮。

## §2 展开态：左向标签栏 + 单一内容区

- 单击色块（260ms 仲裁窗口后）展开横向标签栏：**检测（默认）｜图片｜锁定**；
  右端锚定在色块，内容向左展开（`clip-path + transform + opacity`，180ms；支持
  `prefers-reduced-motion`）。
- 再次单击、Esc、点击外部、切换文档都会收起。
- 三个标签共用**一个**内容区（`.inkchapter-doc-expand__panel`），切换标签只替换该容器内容；
  不创建第二层浮窗，不打开旧诊断抽屉。
- 双击色块只切换真实锁定一次：手势仲裁器取消待执行的单击展开，不产生「展开→收起」闪烁。
  锁定失败时不会本地伪装成已锁定（状态只由 host 的 `update()` 推送真实状态）。
- 锁定标签与双击共用同一个 `toggleLock` 入口；锁定后仍可查看检测与图片状态。

### 检测标签

- 默认紧凑摘要：`N 错误 · M 警告`（未检查显示「尚未检测或检测不可用」）；
  按钮「重新检测」与「详情」。
- 「详情」在同容器内切换为诊断列表（来自真实快照，可滚动）；点击条目不打开旧抽屉，
  关闭工具栏后调用现有定位入口。列表为空显示「未发现问题」。

### 图片标签

- 未启用：一行「图片管理未启用」+「配置当前文档」。
- 已启用：生效来源、当前生效的 Typora 原生插入方式（只读展示）、自动同步、引用统计、
  可复用、待传输；按钮「上传本文图片」「下载本文图片」「检查并补齐双链」「当前文档高级设置」。
- 无待传项时按钮禁用并给出 `title` 原因；锁定时上传需先解锁。
- 只打开标签/查看预检**不创建任何目录、不传文件、不改写 Markdown**；实际落盘必须经
  `预检 → 用户确认 → 执行`，沿用 V4.0 SHA-256 去重与 `REUSED_*` / `NEW` 语义。

## §3 生命周期与隔离

- 展开容器只创建一次；打开/关闭只切换 `hidden` 与动画类，不重复建 DOM。
- 文档切换（host `reconcileActiveDocument` 的 full 分支）调用 `close()`，清空上一文档详情。
- `documentHub` 注入失败/图片摘要异步失败只影响工具栏自身（fail-open），不中断诊断、
  几何或右下角导航器。
- 导航器规则保持：只有真实纵向滚动范围的活动文档才显示；短文档隐藏；长短切换与窗口
  尺寸变化后重新计算。
- 所有 UI 节点都在 overlay 宿主中，绝不进入 `#write` 或 Markdown 序列化内容。

## §4 测试与证据

- 状态/模型：`document-status-indicator.test.ts`、`document-hub-model.test.ts`
- 工具栏契约：`document-hub-controller.test.ts`（收起无白壳、锁框中性、单击/双击仲裁、
  三标签单内容区、详情内部切换、图片按钮回调/禁用、Esc/外部关闭、单实例、CSS 契约）
- 批量：`document-image-batch.test.ts`、`document-image-batch-service.test.ts`
- 导航器：`document-utility-navigator-document-switch.test.ts` 等
- Host 集成：`document-utility-overlay-host.test.ts`、`document-utilities-interaction.test.ts`、
  `document-utility-toolbar-density.test.ts`

## §5 尚未验证（GUI）

- 真实 Typora 中单击/双击的鼠标手势（125% DPI 自动点击不可靠，需人工确认）。
- 展开动画、标签切换、详情滚动、锁框与焦点视觉。
- 图片标签按钮的真实上传/下载/补链（需凭据与网络，且默认不自动执行）。
- 100% / 125% / 150% DPI、浅/深主题、窗口缩放与侧栏拖拽下的定位。

# Document Hub & Image Batch（文档状态方块 / 文档管理中心 / 图片批量 / 导航器规则）

> 适用版本：V5.1（提交 `de98c14` 起，导航器修复至 `05e1edc`）。
> 相关源码：`src/document-utilities/document-status-indicator.ts`、`document-hub-model.ts`、
> `document-hub-controller.ts`、`document-utility-overlay-host.ts`；
> `src/image-management/document-image-batch.ts`、`document-image-batch-service.ts`；
> 设置页 `src/settings/image-management-setting-tab.ts` 及其三级作用域服务。

## §1 状态方块

- 右上角唯一常驻入口：`.inkchapter-doc-status`，方块 12px、热区 32px（按 DPI 由 CSS 处理）。
- 颜色语义（`resolveDocumentStatusCode`）：
  - `GREEN`：有活动文档、检测完成、结构已验证、0 error / 0 warning。
  - `YELLOW`：无 error、至少 1 warning。
  - `RED`：至少 1 error。
  - `GRAY`：无活动文档 / 检测关闭 / 检测中 / 结构未验证 / 无投影。
- 锁定只增加独立外框（`.inkchapter-doc-status__frame` 的 `borderColor`），**不改变检测颜色**。
- 方块同时以 `data-status / data-error-count / data-warning-count / data-hint-count / data-locked`
  暴露投影，供运行时审计读取（不再依赖已隐藏的旧计数条）。
- 旧 `.inkchapter-problems-control` 与 `.inkchapter-doc-toolbar__btn--lock` 仅作为**隐藏兼容节点**存在
  （`hidden` + `aria-hidden` + CSS `display:none !important`），不对用户可见。

## §2 文档管理中心

- 点击状态方块打开 `.inkchapter-doc-hub`（fixed 浮层，独立于 `#write`，绝不进入 Markdown 序列化）。
- 分区：文档检测（状态、重新检测、查看详情）、文档锁定（锁定/解锁）、当前文档图片
  （策略、生效来源、引用数、可复用、待传输、双链完整、上传全部/下载全部/检查补齐双链/图片设置）。
- 按钮可用性由 `buildDocumentHubModel` 计算；禁用时 `title` 说明原因（未保存文档、已锁定、无待传项等）。
- Esc 与外部点击关闭；`dispose` 释放监听与 DOM。

## §3 图片批量服务

- `DocumentImageBatchService.preview(kind)`：只读；解析当前 Markdown 图片引用、读取已验证资产知识，
  输出本地/远程引用数、可复用数、待上传/下载数、拟创建目录与阻断原因。**不访问文件系统、不创建目录**。
- `run(kind)`：先 `confirm` 用户确认，再逐目标执行；同一目标只处理一次；单项失败不中断；
  结果区分 `REUSED_*` / `UPLOADED_NEW` / `DOWNLOADED_NEW`，失败计入 `failed`。
- 默认**不改写 Markdown**：批量上传/下载只落盘/登记；引用改写属于独立授权操作。
- 上传不可用、无项目目录等情况下返回 `blockedReasons`，执行被拒绝而不是静默跳过。

## §4 导航器显示规则（P0 修复后最终行为）

- 无活动 Markdown → 隐藏。
- 有活动文档但**正文没有真实纵向滚动范围**（`scrollHeight > clientHeight + 1` 不成立）→ 隐藏。
- 有真实纵向滚动范围 → 显示；上箭头仅 `scrollTop > 0` 可用，下箭头仅在未到底时可用。
- 文档切换：`CANONICAL_FRAME_NOT_READY` 只是切换瞬时状态，不构成永久隐藏；真实活动文件 + 文档键存在时
  仍视为 eligible（`ACTIVE_DOCUMENT_CANONICAL_PENDING`），等布局就绪后由几何 pass 提交最终 presentation。
- 可见性同时拥有 `hidden` 与 inline `display` 两个通道：隐藏写 `display:none`，可见时移除 inline display，
  避免「hidden=false 但 display:none 残留」导致切换后不可见。
- 同一窗口只有一个导航器实例；不通过销毁/重建 DOM 维持显示，不使用轮询。

## §5 测试与证据

- 状态判定：`document-status-indicator.test.ts`
- 面板模型：`document-hub-model.test.ts`
- 面板 DOM 契约：`document-hub-controller.test.ts`
- 批量预检/执行：`document-image-batch.test.ts`、`document-image-batch-service.test.ts`
- 切文档回归：`document-utility-navigator-document-switch.test.ts`（短→短、短→长、长→短、长→长、
  长→短→长、长→长→短、连续 10 次切换、窗口缩放、编辑改高度、顶部/底部箭头、无文档、图片摘要抛错）
- 面板/状态方块下导航器不受影响：host `documentHub` provider 失败时导航器仍按真实滚动范围显示。

## §6 尚未验证（GUI）

- 长文档上下箭头的真实点击滚动（125% DPI 自动点击不可靠，需人工）。
- 文档管理中心打开时切换文档、侧栏拖拽、窗口最大化/还原后的导航器重算。
- 100% / 125% / 150% DPI 的逐项视觉验收。

# Custom 多级组合格式

## 用户可见功能

当用户选择「自定义」预设时，设置页展开 Custom 编辑器：每个标题级别（H1-H6）显示一个可折叠面板，包含：
- 格式片段拖拽编辑区：用户可拖拽「当前级别编号」和「文本分隔符」片段来组合格式
- 插入按钮：添加字面文本（如「章」「节」）或引用上级标题编号
- 实时预览：每个级别下方显示格式预览效果

## 预期表现

- Custom 面板正确展开，H1-H6 各有一个编辑区
- 格式片段列表可拖拽排序
- 「当前级别」段始终存在且不可删除
- 插入字面文本和上级引用后预览立即更新
- 全局预览区与逐级迷你预览一致
- 切换 H1 可见性后，格式配置自动适配（双变体存储）

## 当前真实表现

基于代码分析（存在缺陷，未 Runtime 验证）：

**已实现的数据模型**:
- 两阶段数据模型（schemaVersion >= 7）：
  - Layer 1: `HeadingLevelNumberTemplate` — 每级编号模板（token + prefix + suffix）
  - Layer 2: `ContextualFormatSegment[]` — 上下文多级组合格式片段
- 双变体存储（`contextualFormatVariants`）：
  - `withLevelOne` — H1 可见时的格式
  - `withoutLevelOne` — H1 隐藏时的格式
- 拖拽工具函数（`format-drag-utils.ts`）：支持 `moveSegmentToResolvedIndex`、`normalizeContextualFormatAfterDrag`

**已知缺陷**:
1. **空拖拽栏**: 格式片段列表可能为空（`ensureCurrentLevelSegment` 未充分调用）
2. **缺失当前段**: 在 `render()` 的 `renderCustomPanels` 之前调用 `ensureAllLevelsHaveCurrentSegment`，但该函数实现可能不完整
3. **预览不一致**: 预览数据源使用 `renderContextualFormat`，与实际文档编号计算可能脱节

**诊断报告确认**（`custom-regression-diagnosis/2026-07-31-2200/10-root-cause-report.md`）:
- 拖拽栏 `inkchapter-drag-bar` 为空
- 缺少 `current-segment` 的占位符
- 预览使用独立渲染路径而非实际 `computeHeadingNumbering` 结果

## 当前状态

存在缺陷

## 已实现内容

- Custom 预设选项和面板框架
- H1-H6 可折叠面板 UI
- 字面文本插入和上级级别引用插入
- 拖拽排序函数库（`format-drag-utils.ts`）
- 双变体格式存储（H1 开/关各一套）
- 上下文多级组合格式数据模型
- 拖拽状态管理（`DragState`）
- 实时预览更新

## 未完成内容

- 空拖拽栏修复（确保初始格式片段列表非空）
- 当前段始终存在与不可删除保护
- 预览与实际编号一致性修复
- insert-literal 和 insert-level-reference 的编辑器集成
- Runtime 验证

## 用户操作方式

1. 在设置页点击「自定义」预设卡片
2. 展开 Custom 面板
3. 选择一个标题级别（H1-H6）
4. 拖拽格式片段调整顺序
5. 使用插入按钮添加文本或引用
6. 观察预览区变化

## 相关代码

- `src/settings/heading-numbering-setting-tab.ts` — Custom 编辑器完整 UI（`renderCustomPanels`）
- `src/heading-numbering/format-drag-utils.ts` — 拖拽工具函数
- `src/heading-numbering/numbering-engine.ts` — `renderContextualFormat`、`ensureCurrentLevelSegment`
- `src/heading-numbering/heading-types.ts` — `ContextualFormatSegment`、`HeadingLevelNumberTemplate`
- `src/heading-numbering/token-formatter.ts` — Token 样式格式化

## 验证证据

- 2026-07-31 Custom 回归诊断报告（`docs/analysis/custom-regression-diagnosis/2026-07-31-2200/10-root-cause-report.md`）确认三个缺陷
- 无 Runtime 验证证据

## 已知问题

1. 空拖拽栏：打开 Custom 面板时格式片段列表为空
2. 缺失当前段：`ensureCurrentLevelSegment` 未正确生成当前级别的 level-reference 段
3. 预览不一致：设置页预览与实际文档编号显示不同

## 历史修复记录

- Word 风格编辑器 Phase4（`trae-inkchapter-word-style-editor-phase4-corrected`）
- 安全 Custom 设置 Phase2（`trae-inkchapter-safe-custom-settings-phase2`）
- 稳定重建 Phase1（`trae-inkchapter-stable-rebuild-phase1`）
- 上下文多级引用格式化（`trae-contextual-multilevel-reference-formatting`）
- 两阶段级别模板编辑器（`trae-two-stage-level-template-and-composition-editor`）
- 自由拖拽与纯级别引用（`trae-free-drag-and-pure-level-reference-insertion`）
- 格式标签拖拽卡死修复（`trae-fix-format-tag-drag-freeze`）
- Custom 回归诊断（`trae-diagnose-custom-regression-after-partial-fix`）
- 多个 pending 提示词指向 Custom 修复

## 当前唯一下一步

在统一好的 Runtime 环境中手动打开 Custom 编辑器，收集真实错误日志和 DOM 截图，作为一键修复的精确依据。
## 2026-08-19 Cleanup 吸收

- `trae-object-numbering-v2-table-figure-code-formula.md`
- `trae-object-heading-ordinal-formula-ownership-quiescence-export-v2.5.3.md`

这两类 legacy prompt 已并入本页的自定义多级格式数据模型与拖拽/预览规则。

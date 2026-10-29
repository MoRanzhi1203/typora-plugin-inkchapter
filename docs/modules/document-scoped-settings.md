# 文档级配置

## 用户可见功能

用户可以分别为每个文档配置独立的标题编号设置，而不影响全局默认。设置页提供「全局默认」和「当前文档」两个作用域切换标签。文档级设置可以覆盖：启用/禁用、H1 可见性、预设、Custom 格式、级别样式等全部编号参数。

## 预期表现

- 打开文档 A，配置 Custom 编号格式，关闭文档 B 的自定义格式
- 切换回文档 A 时，Custom 格式保持不变
- 新文档默认使用全局设置
- 「恢复默认」按钮清除文档级覆盖，回到全局设置
- 设置页顶部作用域标签清晰指示当前编辑的是全局还是文档设置

## 当前真实表现

基于代码分析（部分实现，验证不足）：

**已实现的数据架构**:
- `HeadingNumberingScopeStore` 接口：
  - `globalDefault: HeadingNumberingSettings` — 全局默认配置
  - `documentOverrides: Record<string, HeadingNumberingDocumentOverride>` — 按文档路径存储覆盖
- 文档 Key 生成：`generateDocumentKey(absolutePath, vaultRoot)` 生成基于 vault 的相对路径
- 配置解析：`resolveEffectiveSettings(store, documentKey)` 返回 `DocumentNumberingContext`
  - 有文档覆盖时：`deepMergeSettings(global, documentOverride)`
  - 无覆盖时：`deepCloneSettings(global)`
- 保存：`saveHeadingSettings(store, request)` 按 scope（global/document）写入
- 删除覆盖：`removeDocumentOverride(store, documentKey)`
- 迁移：`migrateHeadingNumberingToScopeStore()` 从旧 `headingNumbering` 字段迁移

**设置页 UI**:
- `renderScopeBar(s)` 渲染作用域选择标签（全局/当前文档）
- `headingScope` 状态跟踪当前编辑的作用域
- `headingDraft` 未保存的修改暂存

## 当前状态

部分实现

## 已实现内容

- 全局默认 + 文档覆盖数据模型
- 文档 Key 生成（vault 相对路径）
- Deep merge 配置合并
- 配置保存/删除/查询 API
- 旧配置迁移（`headingNumbering` → `headingNumberingScopes`）
- 设置页作用域切换 UI
- Draft 暂存（未保存修改）

## 未完成内容

- 充足的 Runtime 验证（多次文档切换、配置持久化测试）
- 多文档并发编辑场景测试
- 文档覆盖在文件重命名后的跟踪

## 用户操作方式

1. 打开插件设置页
2. 在顶部作用域栏选择「当前文档」
3. 修改编号设置（预设、Custom 格式等）
4. 修改只对当前文档生效
5. 选择「全局默认」恢复全局设置编辑
6. 点击「恢复默认」清除当前文档的覆盖

## 相关代码

- `src/heading-numbering/heading-numbering-scope-store.ts` — 作用域存储核心（286 行）
- `src/settings/heading-numbering-setting-tab.ts` — `renderScopeBar`、`headingScope`、`headingDraft`
- `src/heading-numbering/heading-types.ts` — `HeadingNumberingScopeStore`、`DocumentNumberingContext`
- `src/heading-numbering/heading-numbering-service.ts` — `getActiveFilePath()` 获取当前文档路径
- `src/settings/default-settings.ts` — `DEFAULT_SETTINGS.headingNumberingScopes`

## 验证证据

- 代码审查确认完整的作用域存储架构
- 对应的已执行提示词确认实现（`trae-fix-document-scoped-heading-numbering-settings`）
- 无 Runtime 验证证据

## 已知问题

- 验证不足：缺少多次文档切换后的配置持久化确认
- 文档重命名后覆盖可能丢失（key 基于路径）

## 历史修复记录

- 文档级配置实现（`trae-fix-document-scoped-heading-numbering-settings.md`）

## 当前唯一下一步

在 test vault 中创建两个文档，配置不同的编号设置，验证切换后各自保持且互不干扰。
## 2026-08-19 Cleanup 吸收

- `trae-document-format-inheritance-state-model-fix.md`
- `trae-fix-document-scoped-heading-numbering-settings.md`

本页保留文档级覆盖、继承恢复、作用域切换与持久化规则，不再单独保留上面两份 prompt 文档。

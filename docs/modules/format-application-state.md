# 格式应用状态管理

## 用户可见功能

用户在格式库中选择系统预设或自定义格式，将其应用到全局默认或当前文档。应用后的文档保持格式快照独立于格式模板——编辑格式模板不会自动改变已应用的文档。

## 当前状态关系

### 三层状态

| 层 | 存储位置 | 含义 | 是否可变 |
|----|---------|------|---------|
| Format Definition | `settings.formatLibrary.formats[]` | 格式模板的当前定义 | 用户可编辑 |
| Applied Snapshot | `globalDefault` 或 `documentOverrides[docKey].settings` | 应用时刻的格式快照 | 仅应用时写入 |
| Effective Settings | `resolveEffectiveSettings()` 运行时计算 | 文档的实际生效配置 | 每次访问计算 |

### formatSource

每个 scope（全局/文档）的 `formatSource` 记录当前应用的格式来源：
- `{ type: 'built-in', presetId: 'decimal-hierarchical' }` — 系统预设
- `{ type: 'custom', formatId: 'xxx', version: 3 }` — 自定义格式 + 版本

### 版本与更新

- 格式定义有 `version` 字段，每次保存时递增
- 应用时记录 `formatSource.version` 作为 `versionAtApply`
- `versionAtApply < format.version` → 显示"应用更新"按钮
- 点击"应用更新"后 snapshot 更新为新版本，versionAtApply 同步

### 继承与恢复

- 文档选择"继承全局"时，清除 `documentOverrides[docKey]`（包括 formatSource）
- 恢复继承后不残留 stale formatSource
- 格式来源切换（内置↔自定义）时自动清理旧 formatSource

## 设计约束

1. 格式定义和已应用快照是独立副本——编辑其一不影响另一个
2. `formatSource.version` 是 staleness 检测的权威来源
3. 排版覆盖（layoutOverrides）不改变 formatSource——格式身份独立于排版
4. Scope 切换（全局↔文档）必须携带或清理正确的 formatSource

## 相关代码

- `src/heading-numbering/format-library.ts` — 格式 CRUD、版本管理
- `src/heading-numbering/heading-numbering-scope-store.ts` — 作用域保存、formatSource 持久化
- `src/heading-numbering/heading-numbering-service.ts` — 应用格式、scope 切换
- `src/heading-numbering/heading-types.ts` — `NumberingFormatSource`、`FormatBasedOn`
- `src/settings/heading-numbering-setting-tab.ts` — "应用更新"按钮逻辑

## 当前状态

已实现但未验收

## 已知问题

- GUI Runtime 验证证据不足（格式更新后按钮状态、formatSource 跨文档隔离）
## 2026-08-19 Cleanup 吸收

- `trae-format-library-live-reference-effective-sync-p0-fix.md`
- `trae-document-format-inheritance-state-model-fix.md`

这两类 prompt 的结论已并入格式定义 / applied snapshot / effective settings 三层模型，不再保留单独提示词文档。

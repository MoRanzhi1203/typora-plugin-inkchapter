# 特殊标题排除

## 用户可见功能

用户可以为特定的标题配置「不参与编号」——例如「摘要」「Abstract」「参考文献」「References」「关键词」「Keywords」等。这些标题不分配编号，后续标题的计数器行为可选择「跳过」（不计数）或「计数但隐藏」。

## 预期表现

- 默认候选列表包含常见不编号标题：摘要、Abstract、关键词、Keywords、参考文献、References、目录、附录 等
- 用户可启用/禁用名称匹配
- 匹配模式：`trim`（精确匹配去空白后）
- 匹配动作：`prompt`（提示用户是否为该标题设置不编号）
- 计数器策略：`skip`（不编号标题不递增计数器）或 `consume-and-hide`（递增但隐藏）
- 上下级引用正确处理不编号祖先

## 当前真实表现

基于代码分析（未 Runtime 验证）：

**数据模型**（`DEFAULT_SETTINGS.specialNumbering`）:
```typescript
specialNumbering: {
  unnumberedCounterPolicy: 'skip',
  nameSettings: {
    enabled: true,
    candidates: DEFAULT_NAME_CANDIDATES.map(text => ({ text, enabled: true })),
    matchMode: 'trim',
    matchAction: 'prompt',
  },
}
```

**枚举引擎**（`numbering-engine.ts`）:
- `computeHeadingNumbering()` 接受 `overrideMap` 参数：`Map<headingKey, 'numbered' | 'unnumbered'>`
- 不编号标题：计数器策略 `skip`（不递增）或按 `counterPolicy` 处理
- 不编号祖先：下级引用时自动排除（不暴露隐藏编号路径）

**覆盖存储**（`heading-override-store.ts`）:
- `HeadingOverrideStore` 类管理每标题的覆盖状态
- 基于标题指纹（`generateHeadingFingerprint`）匹配
- 支持手动、批量、名称规则三种覆盖来源
- 文档级别持久化

**Preset 定义**（`heading-types.ts`）:
- `DEFAULT_NAME_CANDIDATES` 定义默认不编号候选名称
- 包含中英文常见学术文档特殊标题

## 当前状态

已实现但未验收

## 已实现内容

- 默认不编号候选名称列表
- 名称匹配引擎（trim 模式）
- 计数器策略（skip/consume-and-hide）
- 标题指纹匹配
- 手动/批量/名称规则覆盖
- 文档级覆盖持久化
- 上下级正确处理不编号祖先

## 未完成内容

- Runtime 验证（在测试文档中确认「摘要」「参考文献」不参与编号）
- 用户自定义候选名称功能
- 匹配操作日志

## 用户操作方式

1. 在文档中创建标题「摘要」或「Abstract」
2. 确认该标题不显示编号
3. 后续标题的编号计数器正确处理（跳过或计数但隐藏）
4. 在设置中可自定义匹配规则

## 相关代码

- `src/heading-numbering/heading-override-store.ts` — 覆盖管理（50+ 行）
- `src/heading-numbering/numbering-engine.ts` — `computeHeadingNumbering` 中的 overrideMap 处理
- `src/heading-numbering/heading-types.ts` — `DEFAULT_NAME_CANDIDATES`、`HeadingNumberingOverride`
- `src/heading-numbering/heading-numbering-service.ts` — 覆盖存储实例化
- `src/settings/default-settings.ts` — `specialNumbering` 默认值

## 验证证据

- 代码审查确认覆盖逻辑完整
- 对应已执行提示词确认实现（`trae-special-heading-numbering-overrides`）
- 无 Runtime 验证证据

## 已知问题

无

## 历史修复记录

- 特殊标题编号覆盖实现（`trae-special-heading-numbering-overrides.md`）

## 当前唯一下一步

使用测试模板「07-重复标题与特殊标题测试.md」在 Typora 中验证特殊标题排除功能。

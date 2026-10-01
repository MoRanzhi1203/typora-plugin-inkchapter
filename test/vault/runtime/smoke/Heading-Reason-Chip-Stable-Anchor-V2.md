# Heading Reason Chip Stable Anchor V2 — Runtime Fixture

本 fixture 验证 **Heading Reason Chip Stable Anchor V2**（§13）：标题跳级 reason chip
必须始终与标题**同一行右侧**，任何交互（click / switch / drawer / resize / scroll /
文档切换）都不得把它移到下一行。

预期产生：
- 3 个 heading level gap error（`H3 → H6 · 缺 H4、H5`、`H2 → H4 · 缺 H3`、`H4 → H6 · 缺 H5`）
- 1 个 table missing name warning

# 主标题

## 合法二级标题

### 合法三级标题

###### 深层六级标题

## 第二节

#### 四级小节

###### 六级子节

| 列A | 列B |
| --- | --- |
| A1 | B1 |

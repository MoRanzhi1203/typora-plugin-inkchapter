# Source Syntax 交互 Fixture — Formula Block（未闭合）

本文件用于验证 FORMULA_BLOCK_UNCLOSED 的 first-click marker 与 Active Switch。

## 1 一级标题

正文段落，用于 Active Switch 的 Heading 目标。

## 1.2 标题跳级（Heading 目标）

上面从 H1 跳到 H2 的 1.2 会触发 HEADING_LEVEL_GAP。

## 1.3 末尾未闭合公式块

下面是一个故意未闭合的 display formula，文件在此结束（没有 closing $$）：

$$
a^2 + b^2 = c^2

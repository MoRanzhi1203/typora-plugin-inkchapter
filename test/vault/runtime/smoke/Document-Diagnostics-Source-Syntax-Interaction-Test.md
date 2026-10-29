# Source Syntax 交互 Fixture — Code Fence（未闭合）

本文件是 Document Diagnostics Source-Syntax interaction 的长期运行 fixture。
用于验证 CODE_FENCE_UNCLOSED 的 Source Range → DOM Projection → Visual Commit → ACTIVE，
以及 Active Switch / Drawer Viewport / Dynamic Refresh。

## 1 一级标题

这是一段正常正文，用于确认 Active Switch 时 old carrier 会被移除。

## 1.2 正常闭合代码块（干扰项 A）

下面是一个**正常闭合**的代码块；定位时绝不能被当成未闭合围栏的目标：

```js
const a = 1
```

## 1.3 水平线（干扰项 B）

下面是一条水平线；定位 frontmatter 绝不能被误选为它：

---

## 1.4 标题跳级（Heading 目标）

上面从 H1 跳到 H2 的 1.4 会触发 HEADING_LEVEL_GAP，用于 Active Switch 的 Heading 目标。

正文一。




正文二（上面连续 3 个空行用于 Blank-space 目标）。

## 1.5 末尾未闭合代码围栏（唯一目标）

下面是一个故意未闭合的 fenced code block，文件在此结束（没有 closing fence）。
点击 Drawer 中「代码块未闭合」行后，opening line 必须出现 Error active marker；
且必须按 source range 选中这一个未闭合 opener，而不是上面的正常 js 代码块。

```python
print("hello")
print("world")

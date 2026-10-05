# Source Diagnostics Fixture — Empty Block Container（空代码块内容区）

TRAE V6 的长期运行 fixture。用于验证 CODE_EMPTY_BLOCK 的
Canonical Code Block → Content Container Geometry → Hint Presentation → Visual Commit 闭环。
点击 Drawer 中「代码块为空」后，**空代码块的内容区**（不是 caption「代码 N」，不是行号 gutter，
不是整条编辑器宽度）应出现 Hint（低强调冷灰蓝）active marker。

## 1 空代码块（Case A：带语言、带名称）

下面这个代码块没有任何内容；它是本 fixture 的**主目标**：

```python
```

## 2 空代码块（Case C：无语言标识）

下面这个代码块同样为空，并且没有语言标识（会额外产生 CODE_MISSING_LANGUAGE）：

```
```

## 3 普通非空代码块（Case D：不得产生 CODE_EMPTY_BLOCK）

下面这个代码块有内容，用于确认 CODE_EMPTY_BLOCK 不会误报，
也用于 Active Switch 时确认不会误选：

```python
print("hello")
print("world")
```

## 4 有内容的代码块（干扰项）

```js
const a = 1
```

## 5 标题跳级（Active Switch 目标）

从 H1（`## 1`）直接跳到 H2（`## 5`）会触发 HEADING_LEVEL_GAP，用于 Active Switch。

正文一。




正文二（上面连续 3 个空行用于 Blank-space 目标）。

# Figure Token Locator + 本地路径写回 Fixture

用于验证：Runtime file URL vs Markdown relative destination 的 canonical 匹配、嵌入式/内联图片 token 解析、duplicate occurrence 消歧、remote URL 不被误改。

## embedded（行首带句号）

。![](../../path/a%20b.png)

## inline（正文中间）

正文 ![已有](../../path/a%20b.png) 后续

## duplicate（两个相同 src）

![](same.png)

![](same.png)

## HTTP URL

![HTTP](https://example.com/a%20b.png)

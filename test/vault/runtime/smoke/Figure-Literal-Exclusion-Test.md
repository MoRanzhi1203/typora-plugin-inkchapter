# Figure Literal Exclusion — Runtime Fixture

本 fixture 验证 Markdown Literal Exclusion V1：inline code / fenced code / indented code 中的
`![](a.png)` / `[text](url)` 只是文本示例，不得进入 Figure / Link / Resource 业务链。

## Case A inline code image syntax

`![](a.png)`

## Case B text + inline code image syntax

before `![](a.png)` after

## Case C multiple code literal image syntax

`![](a.png)` `![](b.png)`

## Case D inline code link

`[example](https://example.com)`

## Case E fenced markdown example

```md
![](a.png)
![alt](b.png)
[text](https://example.com)
```

## Case E2 indented code image syntax

    ![](a.png)

## Case F literal plus real figure

示例：`![](fake.png)`

![real](assets/figure-diagnostic-locator-v1/a-visible.png)

## Case G inline fake + real mixed paragraph

before `![](fake.png)` ![real-mixed](assets/figure-diagnostic-locator-v1/a-visible.png)

## Case H double backtick image syntax

``![](a.png)``

## Case I alt binding description sentence（当前截图回归）

本文验证：Markdown 图片 `![alt](path)` 中的 alt 是图片图名的 canonical source of truth。

## 结束

本 fixture 结束。

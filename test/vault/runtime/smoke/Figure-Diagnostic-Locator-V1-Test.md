# Figure Diagnostic Locator V1 — Runtime Fixture

本 fixture 专门验证 V1 图片诊断定位模型：块级诊断定位整个 owning block，occurrence 诊断定位真实可见的图片 occurrence，重复路径图片必须分别可定位，只有明确声明 `[EXPECTED_MISSING]` 的 Case 才允许资源缺失。

资源策略：除 `[EXPECTED_MISSING]` Case 外，所有图片都必须真实存在、可渲染、可 decode。

## Case S1 文字 + 图片（structure source-block）[EXPECTED_VISIBLE]

before ![S1](assets/figure-diagnostic-locator-v1/a-visible.png)

## Case S2 图片 + 文字（structure source-block）[EXPECTED_VISIBLE]

![S2](assets/figure-diagnostic-locator-v1/a-visible.png) after

## Case S3 同块双图（structure source-block）[EXPECTED_VISIBLE]

![S3a](assets/figure-diagnostic-locator-v1/a-visible.png) ![S3b](assets/figure-diagnostic-locator-v1/b-visible.png)

## Case S4 文字 + 图片 + 图片（structure source-block）[EXPECTED_VISIBLE]

before ![S4a](assets/figure-diagnostic-locator-v1/a-visible.png) middle ![S4b](assets/figure-diagnostic-locator-v1/b-visible.png)

## Case W1 两个合法重复路径图片块（duplicate destination occurrences）[EXPECTED_VISIBLE]

![](assets/figure-diagnostic-locator-v1/repeated-visible.png)

![](assets/figure-diagnostic-locator-v1/repeated-visible.png)

## Case W2 合法独立图片缺图名（occurrence locate）[EXPECTED_VISIBLE]

![](assets/figure-diagnostic-locator-v1/b-visible.png)

## Case W3 本地图片不存在（missing-image fallback）[EXPECTED_MISSING]

![W3 expected missing](missing-local-image.png)

## Case S5 同块完全相同的两个段落（block identity 稳定）[EXPECTED_VISIBLE]

before ![](assets/figure-diagnostic-locator-v1/a-visible.png)

before ![](assets/figure-diagnostic-locator-v1/a-visible.png)

## 结束

本 fixture 结束。

# 标题图片检测验收 Fixture

本 fixture 验证 H1–H6 标题中的图片检测与修复。图片必须移出标题并成为独立图片段落。

## 标题文字后存在图片 ![后置](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

### ![前置](assets/phase7-strict-h1-boundary/boundary-b-figure.png) 标题文字

#### 前文 ![中置](assets/phase7-strict-h1-boundary/boundary-a-figure.png) 后文

##### ![多图一](assets/phase7-strict-h1-boundary/boundary-a-figure.png) ![多图二](assets/phase7-strict-h1-boundary/boundary-b-figure.png)

###### ![仅图片](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

## 空路径图片 ![]()

## 有 alt 无路径 ![说明]()

## 行内代码不应命中 `![不应检测](assets/phase7-strict-h1-boundary/boundary-a-figure.png)`

## 转义图片不应命中 \![不应检测](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

```md
## 代码围栏内不应命中 ![不应检测](assets/phase7-strict-h1-boundary/boundary-a-figure.png)
```

## 结束

本 fixture 结束。

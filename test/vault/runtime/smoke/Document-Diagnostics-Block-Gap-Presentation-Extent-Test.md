# Block-Gap Presentation Extent Test (Case B)

本文件用于验证 `EXCESSIVE_INTERNAL_BLANK_LINES` 的 **Case B**：

```text
Figure（image-only paragraph）
+ InkChapter 生成的图题（图 N-M …）
→ 5 个连续空行（>=3 ⇒ Warning）
→ ## 章节 B
```

期望：黄色区域只覆盖「图题结束之后 → 章节 B 之前」的真实空白，
**不得**覆盖第一张图片、图题、或章节 B。

![缺失图片诊断目标](missing-assets/__inkchapter_presentation_extent_missing_image__.png)





## 章节 B

正文 B：用于确认 gap 的 next 边界就是本标题的 Presentation Extent。

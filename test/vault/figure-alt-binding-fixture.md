# 图片图名与 Markdown Alt 绑定 Fixture

本文档用于验证：Markdown 图片 `![alt](path)` 中的 `alt` 是图片"图名"的 canonical source of truth，以及图片路径 display decode 不影响 storage。

## 空 alt 图片

![](a.png)

## 中文 alt 图片

![系统架构](b.png)

## 空格路径图片

![空格路径](a%20b.png)

## 中文 percent-encoded path 图片

![中文路径](../../../Downloads/ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5%2013_38_00.png)

## Duplicate 图片（同路径出现两次，需按 occurrence 区分）

![重复图片一](dup.png)

![重复图片二](dup.png)

## HTTP 图片

![远程图片](https://example.com/remote%20image.png)

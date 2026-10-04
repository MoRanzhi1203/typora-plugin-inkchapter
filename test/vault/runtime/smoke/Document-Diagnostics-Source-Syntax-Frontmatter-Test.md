---
title: 未闭合 Front Matter
author: InkChapter
tags:
  - source-syntax

# 正文标题

本文件用于验证 FRONTMATTER_UNCLOSED 的 first-click marker。

文档开头的 `---` 起始分隔符故意没有对应的结束分隔符，
因此整个文件都落在 Front Matter 保护范围内，诊断目标为 opening `---` 行。

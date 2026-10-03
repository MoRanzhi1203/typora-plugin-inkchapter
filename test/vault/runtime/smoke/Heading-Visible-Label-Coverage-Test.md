# Heading Visible Label Coverage 测试夹具

本文档用于验证 heading diagnostic 的 **VISUAL coverage**：运行时显示的完整标题标签
（自动编号前缀 + 标题正文）必须被整体 text-tight 覆盖，而 **SOURCE identity** 仍然
只基于 Markdown 源标题文本。

- 语义身份（SOURCE）：`## 小节` → `小节`
- 可见标签（VISUAL）：运行时 `一、小节` → 覆盖 `[一、小节]`
- reason chip 必须排除：`[一、小节] [原因]`

## 小节

正文段落，用于让本文档不是「只有标题结构」。中文编号期望：`一、小节`。

## 方法

第一处「方法」标题，与下方同名标题构成 duplicate source title 用例。

本段正文用于区分相邻段落。

### 参数估计

三级标题；十进制样式下期望多级编号 `1.1 参数估计`。

## 方法

第二处「方法」标题 —— duplicate source title 必须仍然成立，自动编号不得掩盖重复标题。

## 小节

第二处「小节」标题 —— 同上。

## 这是一个非常长的标题，用于验证标题换行时一个 semantic target 会产生多个 visual fragments，且每个 fragment 都保持 text-tight 而不跨越相邻块

上面这段正文存在，所以本文档不是 headings-only。

## 

空标题：自动编号仍会渲染，但 semantic source text 必须视为空。

#### 跳级标题

H2 → H4 跳级，用于 HEADING_LEVEL_GAP 的 reason chip 用例（chip 必须排除在 coverage 之外）。

## 动态重编号用例 A

插入同级标题前，本标题的编号固定。

## 动态重编号用例 B

最后一个标题。

# Document Diagnostics Heading Authority Test

> 专用 fixture：验证只有真实 Canonical Heading Node 才参与标题结构诊断。
> 普通文本 hash marker（`#`、`##`、`####`，通过 `\` 转义保持为普通段落）
> 不得进入结构序列、不得产生 Error/Warning、不得影响 H1 count / 章节边界 /
> Outline / Caption / Formula scope。
> 标题文本不含任何字面序号前缀；层级由 `#` 级别表达，编号由模板另行处理。

## 真实标题区段（canonical headings）

### 三级小节

###### 深层六级标题

## 普通文本 hash marker 区段（plain text markers，不是标题）

下面这些行是普通段落文本，Typora 未将其转换为 Heading Node：

\#

\##

\####

> 说明：以上 `\#`、`\##`、`\####` 均为转义后的普通文本，视觉上不渲染为标题。

## 真实跳级区段（real heading gaps）

#### 四级小节

###### 六级子节

> 期望（strict）：`H3 -> H6`、`H2 -> H4`、`H4 -> H6` 各产生一条
> `HEADING_LEVEL_GAP` ERROR；普通文本 hash marker 不产生任何额外诊断。

## canonical / plain 对照清单

| 行 | 类别 | 说明 |
|---|---|---|
| `# Document Diagnostics Heading Authority Test` | canonical H1 | 文档唯一一级标题 |
| `## 真实标题区段` | canonical H2 | 二级章节 |
| `### 三级小节` | canonical H3 | 三级小节 |
| `###### 深层六级标题` | canonical H6 | 六级深层标题 |
| `\#` | plain text marker | 转义后为普通文本，非 H1 |
| `\##` | plain text marker | 转义后为普通文本，非 H2 |
| `\####` | plain text marker | 转义后为普通文本，非 H4 |
| `## 真实跳级区段` | canonical H2 | 跳级起点（H3→H6 之后回退到 H2，正常） |
| `#### 四级小节` | canonical H4 | H2→H4 跳级（缺 H3） |
| `###### 六级子节` | canonical H6 | H4→H6 跳级（缺 H5） |

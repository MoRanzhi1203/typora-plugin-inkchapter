# 内部连续空行测试夹具（EXCESSIVE_INTERNAL_BLANK_LINES）

用于验证：文档内部两个有效内容块之间 0~2 个连续空行 → PASS；3 个及以上 → Warning（不升级 Error，也不产生 Hint）。

## Case A — 1 个空行（PASS）

Case A 正文第一段。

Case A 正文第二段。

## Case B — 2 个空行（PASS）

Case B 正文第一段。


Case B 正文第二段。

## Case C — 3 个空行（Warning 1）

Case C 正文第一段。



Case C 正文第二段。

## Case D — 5 个空行（Warning 1，actualBlankLines=5）

Case D 正文第一段。





Case D 正文第二段。

## Case E — 标题 → 段落（Warning 1）

### Case E1 子标题



Case E 段落。

## Case F — 段落 → 标题（Warning 1）

Case F 段落。



### Case F1 子标题

Case F1 段落。

## Case G — 标题 → 标题（Warning 1）

### Case G1 标题



### Case G2 标题

Case G2 段落。

## Case H — 段落 → 段落（Warning 1）

Case H 段落一。



Case H 段落二。

## Case I — 对象周边的 gap

### I-1 图 → 段落（Warning 1）

![示例图 I](https://example.com/figure-i.png)



图 I 之后的正文。

### I-2 表格 → 段落（Warning 1）

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |



表 I 之后的正文。

### I-3 代码 → 段落（Warning 1）

```ts
const i1 = 1
```



代码 I 之后的正文。

### I-4 公式 → 段落（Warning 1）

$$
i1 = 1
$$



公式 I 之后的正文。

### I-5 列表 → 段落（Warning 1）

- 列表项 I-1
- 列表项 I-2



列表 I 之后的正文。

### I-6 引用 → 段落（Warning 1）

> 引用 I



引用 I 之后的正文。

## Case J — fenced code 内部空行（PASS）

```ts
const j1 = 1



const j2 = 2
```

Case J 之后的正文。

## Case K — 公式内部空行（PASS）

$$
k1 = 1



k2 = 2
$$

Case K 之后的正文。

## Case L — 文档末尾空行（只由 EOF 规则报告）

Case L 正文。




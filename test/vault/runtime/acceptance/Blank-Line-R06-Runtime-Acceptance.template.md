# R06 Blank-Line Runtime Acceptance

This fixture is copied to `Blank-Line-R06-Runtime-Acceptance.md` before every
runtime acceptance run (`scripts/run-blank-line-acceptance.mjs`). It is never a
user document: the runner is gated on this exact path inside `test/vault`.

段落 A（文首正文，用于正文→正文空行诊断）。




段落 B（与段落 A 之间多出 3 个源码空行）。

## 小节标题一




小节标题一下方的正文（标题→正文之间多出空行）。

### 子节标题一（标题→标题之间多出空行）




- 列表项一
- 列表项二

列表之后的正文（列表→正文之间多出空行）。




```ts
const value = 1
```

代码块之后的正文（代码块→正文之间多出空行）。




| 列一 | 列二 |
| --- | --- |
| A | B |

表格之后的正文（表格→正文之间多出空行）。

$$
E = mc^2
$$

公式块之后的正文（公式块→正文之间多出空行）。




文末最后一段（文末多出空行，必须恰好保留 1 个）。




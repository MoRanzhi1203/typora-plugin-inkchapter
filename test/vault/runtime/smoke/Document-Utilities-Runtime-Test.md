# Document Utilities Runtime Test

## 第一章：准备

### 测试段落

这是一个用于验证 Phase 7R.3.11 文档工具（诊断 / 锁定 / 滚动）的可复用测试文档。

它可以安全地用于编辑锁定实验：锁定后尝试输入、粘贴、剪切、拖放都应被阻止，
而选中、复制、滚动、诊断定位、↑/↓ 导航都应保持可用。

## 有意的标题层级缺口

#### 跳级标题

这里是 H4，而它的上一级是 H2（缺少 H3 父级）——这会产生一个 HEADING_LEVEL_GAP 警告。

### 缺少语言标识的代码块

```
print("这段代码块没有声明语言，应产生 CODE_MISSING_LANGUAGE 警告")
```

### 表格（未命名）

| 列A | 列B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |

### 一个安全的本地失效链接

[丢失的本地文件](missing-local-target.md)

## 第二章：长文档滚动内容

本节用于验证 ↑/↓ 滚动导航与按钮禁用状态（文档足够长，可滚动）。

### 段落

滚动内容段落 1：Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

滚动内容段落 2：Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

滚动内容段落 3：Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium,
totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

滚动内容段落 4：Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni
dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.

滚动内容段落 5：Consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore
magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam.

滚动内容段落 6：Nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate
velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur.

滚动内容段落 7：At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum
deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.

滚动内容段落 8：Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.
Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio.

滚动内容段落 9：Cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est,
omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet.

滚动内容段落 10：Ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente
delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.

滚动内容段落 11：此处重复一些中文占位内容以增加文档长度，确保滚动条真实存在，从而能够验证顶部与底部按钮的
禁用状态切换，以及从文档中部滚动到顶部/底部的行为。

滚动内容段落 12：继续补充占位内容。文档越长，越能稳定复现滚动导航的 disabled 状态（顶部时 ↑ 禁用、底部时 ↓ 禁用）。

滚动内容段落 13：这一段落用于在长文档中提供足够的中间位置，供手动测试从中部位置分别点击 ↑ 与 ↓。

滚动内容段落 14：Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.

滚动内容段落 15：Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

滚动内容段落 16：Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

滚动内容段落 17：Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

滚动内容段落 18：Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.

滚动内容段落 19：Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta.

滚动内容段落 20：Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni.

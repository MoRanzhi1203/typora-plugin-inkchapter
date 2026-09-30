# Trae 修复任务：Figure Scanner Literal Exclusion V1

> 项目：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> 本轮不是只读审计，也不是继续修改 Active State Machine、Figure Diagnostic Locator 或 Standalone Object Block Invariant 主规则。
>
> 当前问题已经明确收敛为：**Markdown 图片/链接扫描器把 inline code / fenced code / literal 区域中的 `![](path)` / `[text](url)` 误当成真实图片或链接候选。**
>
> 本轮必须按“一次性完整执行模式”完成：
>
> **事实审计 → literal/code 区域识别 → image/link scanner 前置排除 → Figure candidate 收敛 → Resource Resolution 收敛 → Structure Diagnostic 收敛 → 编号/图名/定位链路回归 → fixture → targeted tests → typecheck → full tests → build → deploy → Runtime 验收 → 最终证据报告**

---

## 0. 本轮唯一目标

建立明确不变量：

```text
只有 Markdown 解析后具有真实 image/link 语义的 token
才能进入 Figure / Link / Resource 业务链路。
```

而：

```md
`![](a.png)`
```

```md
`[text](https://example.com)`
```

```md
before `![](a.png)` after
```

```md
`![](a.png)` `![](b.png)`
```

以及：

````md
```md
![](a.png)
[text](url)
```
````

都只是：

```text
literal/code text
```

必须满足：

```text
figureOccurrenceCount = 0
linkOccurrenceCount = 0
resourceResolutionCount = 0
figureCanonicalTargetCount = 0
figureStructureDiagnosticCount = 0
figureMissingNameCount = 0
figureLocalMissingCount = 0
```

---

## 1. 当前错误行为

当前 fixture 中存在说明文本类似：

```md
Markdown 图片 `![alt](path)` 中的 alt 是图片图名……
```

其中：

```md
`![alt](path)`
```

已经被反引号包裹，因此 Markdown 语义是：

```text
inline code
```

它不是图片对象。

如果当前文档检测出现：

```text
图片块格式不规范
```

说明 scanner 当前扫描顺序错误：

```text
先正则找 ![](...)
→ 再判断 block
```

而没有先识别：

```text
code/literal exclusion ranges
```

---

## 2. 根因定义

本轮围绕以下根因闭环：

```text
ROOT_1
图片 scanner 直接扫描 raw Markdown 文本，
没有先排除 inline code span。

ROOT_2
链接 scanner / resource scanner 可能复用同一 raw token 扫描，
导致 code span 内链接/图片也进入资源解析。

ROOT_3
Standalone Object Block Invariant
接收到的是已经污染的 figure candidate set，
因此把本应是普通文本的段落判成 IMAGE_MIXED_WITH_TEXT。

ROOT_4
FIGURE_MISSING_NAME / FIGURE_LOCAL_IMAGE_MISSING
可能对 code literal 中的伪图片继续产生 Warning。

ROOT_5
Figure numbering / caption / locator
可能对 literal 中的伪 token 建立错误 business target。

ROOT_6
当前测试缺少“literal image syntax 必须完全不可见于业务层”的硬 Gate。
```

---

## 3. 核心原则：Parser Exclusion Before Candidate Discovery

正确顺序必须改为：

```text
Markdown source
   ↓
识别 literal/code ranges
   ├─ inline code
   ├─ fenced code block
   ├─ indented code block（如当前 parser 支持）
   └─ 其它项目已定义 literal region
   ↓
建立 exclusion ranges
   ↓
Image / Link token scanning
   ↓
过滤任何与 exclusion range 相交的 token
   ↓
真实 Figure / Link candidate
   ↓
后续业务链
```

禁止：

```text
先扫 image token
→ 后面再猜是不是 code
```

---

## 4. Inline Code 必须优先排除

示例：

```md
`![](a.png)`
```

必须：

```ini
RAW_IMAGE_SYNTAX_MATCH_COUNT=1
EXCLUDED_CODE_LITERAL_IMAGE_COUNT=1
ADMITTED_IMAGE_OCCURRENCE_COUNT=0
```

对外业务：

```ini
FIGURE_CANDIDATE_COUNT=0
RESOURCE_RESOLUTION_COUNT=0
FIGURE_DIAGNOSTIC_COUNT=0
```

---

## 5. Mixed Paragraph 中 Inline Code 仍然是普通正文

```md
before `![](a.png)` after
```

必须判断为普通正文 paragraph，不得触发：

```text
IMAGE_MIXED_WITH_TEXT
```

硬 Gate：

```ini
IMAGE_MIXED_WITH_TEXT_FROM_CODE_LITERAL_COUNT=0
```

---

## 6. 多个 Inline Code 图片不能触发“同块多图”

```md
`![](a.png)` `![](b.png)`
```

必须：

```text
REAL_IMAGE_OCCURRENCE_COUNT=0
IMAGE_MULTIPLE_IN_BLOCK=false
FIGURE_BLOCK_STRUCTURE_INVALID_COUNT=0
```

---

## 7. Fenced Code Block 必须整体排除

````md
```md
![](a.png)
![alt](b.png)
[text](https://example.com)
```
````

整个 fence 内不得进入：

```text
figure scanner
link scanner
resource scanner
diagnostic scanner
numbering
caption
locator
```

---

## 8. Code Fence 本身仍属于 Code Business Object

禁止产生：

```text
Code Block
+
Fake Figure inside
```

的双重业务对象。

---

## 9. Indented Code

若当前项目 parser 认定：

```md
    ![](a.png)
```

为 indented code，则必须：

```text
figureOccurrenceCount=0
```

否则以当前真实 parser 行为为准，不强行扩展。

---

## 10. Inline HTML / Other Literal Context

先审计项目实际 parser。只排除明确属于 literal/code 的 source range，不要把真实 HTML `<img>` 盲目排除。

---

## 11. 建立统一 Literal Exclusion Range

建议：

```ts
interface MarkdownLiteralRange {
  start: number;
  end: number;
  kind: 'inline-code' | 'fenced-code' | 'indented-code';
}
```

实际命名按项目现有 parser/tokenizer 调整。

要求使用和现有：

```text
FigureSourceOccurrence
LinkSourceOccurrence
ResourceReference
```

一致的 source coordinate system。

---

## 12. Scanner 过滤语义

任何候选 `[candidateStart,candidateEnd)` 与 literal range 有重叠：

```text
candidateStart < literalEnd
AND
candidateEnd > literalStart
```

都必须：

```text
EXCLUDE
```

不要只检查 candidate 起点。

---

## 13. Scanner Authority 必须统一

审计并收敛以下入口：

```text
parseImageSourceOccurrences
resource scanner
figure candidate scanner
link scanner
source occurrence scanner
missing resource scanner
caption scanner
```

避免只修一个入口，另一个仍误扫。

优先共享：

```text
literal exclusion ranges
```

或：

```text
isSourceRangeLiteral(start,end)
```

---

## 14. Figure Candidate Gate

```text
CODE_LITERAL_IMAGE_SYNTAX
=> FIGURE_CANDIDATE_COUNT = 0
```

---

## 15. Resource Resolution Gate

```md
`![](missing.png)`
```

绝不能产生：

```text
LOCAL_LINK_TARGET_NOT_FOUND
FIGURE_LOCAL_IMAGE_MISSING
```

硬 Gate：

```ini
CODE_LITERAL_IMAGE_RESOURCE_RESOLUTION_COUNT=0
```

---

## 16. Figure Missing Name Gate

```md
`![](a.png)`
```

不得产生：

```text
FIGURE_MISSING_NAME
```

硬 Gate：

```ini
CODE_LITERAL_FIGURE_MISSING_NAME_COUNT=0
```

---

## 17. Figure Structure Gate

```md
before `![](a.png)` after
```

不得产生：

```text
FIGURE_BLOCK_STRUCTURE_INVALID
```

硬 Gate：

```ini
CODE_LITERAL_FIGURE_STRUCTURE_INVALID_COUNT=0
```

---

## 18. Figure Numbering / Caption Gate

```md
`![示例](a.png)`
```

不得进入：

```text
normal Figure canonical target
caption render plan
numbering plan
```

---

## 19. Figure Locator Gate

code literal 不产生 Figure diagnostic，也不得建立：

```text
figure diagnostic locator target
```

硬 Gate：

```ini
CODE_LITERAL_FIGURE_LOCATOR_TARGET_COUNT=0
```

---

## 20. Link Scanner 同步处理

```md
`[OpenAI](https://openai.com)`
```

只作为 inline code text，不得成为：

```text
link candidate
resource reference
external link diagnostic
```

---

## 21. Escaped Markdown

例如：

```md
\![](a.png)
```

是否是真图片必须按当前 Markdown parser 的真实 escape 规则判断，不允许简单正则误判。

---

## 22. Backtick Edge Cases

至少测试：

```md
`![](a.png)`
```

```md
``![](a.png)``
```

```md
`text ![](a.png) text`
```

```md
before `![](a.png)` after
```

```md
`![](a.png)` ![](real.png)
```

最后一个必须：

```text
code literal image = excluded
real image = admitted
```

---

## 23. Mixed Literal + Real Figure

```md
说明：`![](example.png)`

![](assets/real.png)
```

要求：

```ini
RAW_IMAGE_SYNTAX_MATCH_COUNT=2
EXCLUDED_CODE_LITERAL_IMAGE_COUNT=1
ADMITTED_IMAGE_OCCURRENCE_COUNT=1
```

只有真实图片进入编号/诊断/定位。

---

## 24. 同段 Literal + Real Figure

```md
before `![](fake.png)` ![](real.png)
```

真实图片仍与正文混排，所以可触发：

```text
IMAGE_MIXED_WITH_TEXT
```

但 fake code token 必须：

```text
image count = 0
```

最终：

```ini
REAL_IMAGE_OCCURRENCE_COUNT=1
```

---

## 25. Source-first Authority

literal/code 判断必须基于 Markdown source parse，不以 DOM 样式作为 primary authority。

---

## 26. 新增 Audit

建议：

```text
MARKDOWN-LITERAL-EXCLUSION-AUDIT
```

字段至少：

```yaml
documentKey:
sourceRevision:

inlineCodeRangeCount:
fencedCodeRangeCount:
indentedCodeRangeCount:

rawImageSyntaxMatchCount:
rawLinkSyntaxMatchCount:

excludedImageCandidateCount:
excludedLinkCandidateCount:

admittedImageCandidateCount:
admittedLinkCandidateCount:

decision:
reason:
```

---

## 27. Figure 专项 Audit

建议：

```text
FIGURE-LITERAL-EXCLUSION-AUDIT
```

字段：

```yaml
documentKey:
rawFigureLikeSyntaxCount:
excludedByInlineCodeCount:
excludedByFenceCount:
excludedByOtherLiteralCount:
realFigureOccurrenceCount:
figureCanonicalTargetCount:
figureDiagnosticCount:
figureResourceResolutionCount:
decision:
reason:
```

---

## 28. 新增硬 Gate

```ini
CODE_LITERAL_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT=0
CODE_LITERAL_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT=0
CODE_LITERAL_IMAGE_RESOURCE_RESOLUTION_COUNT=0
CODE_LITERAL_FIGURE_MISSING_NAME_COUNT=0
CODE_LITERAL_FIGURE_LOCAL_IMAGE_MISSING_COUNT=0
CODE_LITERAL_FIGURE_STRUCTURE_INVALID_COUNT=0
CODE_LITERAL_FIGURE_NUMBERED_COUNT=0
CODE_LITERAL_FIGURE_CAPTIONED_COUNT=0
CODE_LITERAL_FIGURE_LOCATOR_TARGET_COUNT=0
```

Fence：

```ini
FENCED_CODE_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT=0
FENCED_CODE_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT=0
FENCED_CODE_RESOURCE_RESOLUTION_COUNT=0
FENCED_CODE_FIGURE_DIAGNOSTIC_COUNT=0
```

正向：

```ini
REAL_IMAGE_OUTSIDE_LITERAL_REJECTED_COUNT=0
REAL_LINK_OUTSIDE_LITERAL_REJECTED_COUNT=0
```

---

## 29. 新建 Runtime Fixture

建议：

```text
test/vault/runtime/smoke/Figure-Literal-Exclusion-Test.md
```

### Case A

```md
## Case A inline code image syntax

`![](a.png)`
```

期待：

```text
0 Figure
0 Resource Missing
0 Figure Diagnostic
```

### Case B

```md
## Case B text + inline code image syntax

before `![](a.png)` after
```

期待：

```text
普通正文
0 Figure
0 IMAGE_MIXED_WITH_TEXT
```

### Case C

```md
## Case C multiple code literal image syntax

`![](a.png)` `![](b.png)`
```

期待：

```text
0 Figure
0 IMAGE_MULTIPLE_IN_BLOCK
```

### Case D

```md
## Case D inline code link

`[example](https://example.com)`
```

期待：

```text
0 Link Candidate
```

### Case E

````md
## Case E fenced markdown example

```md
![](a.png)
![alt](b.png)
[text](https://example.com)
```
````

期待：

```text
0 Figure
0 Link
0 Resource Resolution
```

### Case F

```md
## Case F literal plus real figure

示例：`![](fake.png)`

![real](assets/figure-diagnostic-locator-v1/a-visible.png)
```

期待：

```text
fake excluded
real admitted
```

### Case G

```md
## Case G inline fake + real mixed paragraph

before `![](fake.png)` ![real](assets/figure-diagnostic-locator-v1/a-visible.png)
```

期待：

```text
real image count = 1
fake image count = 0
FIGURE_BLOCK_STRUCTURE_INVALID = 1
reason = IMAGE_MIXED_WITH_TEXT
```

### Case H

```md
``![](a.png)``
```

期待：

```text
0 Figure
```

### Case I：当前截图回归

```md
本文验证：Markdown 图片 `![alt](path)` 中的 alt 是图片图名的 canonical source of truth。
```

必须：

```text
0 Figure
0 Figure Structure Error
0 Missing Resource Warning
```

---

## 30. 对 figure-alt-binding-fixture.md 的回归

打开：

```text
fixtures/figure/figure-alt-binding-fixture.md
```

顶部说明中的：

```md
`![alt](path)`
```

必须不再产生：

```text
图片块格式不规范
```

这是本轮必测 Runtime 回归点。

---

## 31. 正常 Figure 行为不能回归

真实非 literal 图片仍必须正常进入：

```text
Figure Candidate
caption
numbering
diagnostic
locator
```

---

## 32. Alt Binding 不能回归

当前 fixture 的：

```text
空 alt
中文 alt
空格路径
percent-encoded path
```

原有 caption / numbering / alt canonical source 行为必须保持。

---

## 33. 测试要求

至少新增：

```text
inline code exclusion tests
fenced code exclusion tests
mixed real + fake token tests
range-overlap boundary tests
escaped token regression tests
nested/multi-backtick delimiter tests
resource scanner literal exclusion tests
standalone invariant clean candidate tests
caption/numbering exclusion tests
```

---

## 34. Runtime Hard Gates

```ini
INLINE_CODE_IMAGE_FALSE_POSITIVE_COUNT=0
INLINE_CODE_LINK_FALSE_POSITIVE_COUNT=0
FENCED_CODE_IMAGE_FALSE_POSITIVE_COUNT=0
FENCED_CODE_LINK_FALSE_POSITIVE_COUNT=0
LITERAL_RESOURCE_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_DIAGNOSTIC_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_NUMBERING_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_CAPTION_FALSE_POSITIVE_COUNT=0
REAL_FIGURE_REGRESSION_COUNT=0
```

---

## 35. 禁止项

```text
1. 只在 Drawer 隐藏错误，不修 scanner authority。
2. 只过滤 FIGURE_BLOCK_STRUCTURE_INVALID UI。
3. 修改源文档来规避扫描。
4. 用字符串 replace 删除 `![](...)`。
5. 为排除 literal 破坏正常 code block detection。
6. 为排除 fake Figure 误删真实 Figure。
7. 只修 Figure scanner，不修 Resource scanner。
8. 只修 Resource scanner，不修 Figure candidate scanner。
9. 以 DOM code 样式作为 primary authority。
10. 用 setTimeout/轮询兜底。
11. 删除现有真实 Figure Case 来让测试通过。
12. 修改 V2/V2.1 作为本轮主修复。
```

---

## 36. 静态 Gate

按项目真实 package scripts 执行：

```ini
TARGETED_TESTS=PASS
TYPECHECK=PASS
FULL_TESTS=PASS
BUILD=PASS
```

如存在 lint / contract / runtime structure / identity，一并执行。

---

## 37. 部署 Gate

```text
dist\plugins\fanzhi.inkchapter
→
test\vault\.typora\plugins
```

要求：

```ini
DEPLOY_SHA_GATE=PASS
```

---

## 38. Runtime Identity

如重启 Typora，验证：

```text
process
window handle
window title
target vault
plugin build identity
deployed SHA
```

---

## 39. Runtime Acceptance Matrix

至少真实检查：

```text
A inline code image
B text + inline image code
C multiple inline image code
D inline code link
E fenced code
F literal + real figure
G literal fake + real mixed figure
I current alt-binding description sentence
```

---

## 40. Feature Gate

Feature：

```text
FEATURE_FIGURE_LITERAL_EXCLUSION_V1
```

PASS 条件：

```ini
CODE_LITERAL_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT=0
CODE_LITERAL_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT=0
CODE_LITERAL_IMAGE_RESOURCE_RESOLUTION_COUNT=0
CODE_LITERAL_FIGURE_MISSING_NAME_COUNT=0
CODE_LITERAL_FIGURE_LOCAL_IMAGE_MISSING_COUNT=0
CODE_LITERAL_FIGURE_STRUCTURE_INVALID_COUNT=0
CODE_LITERAL_FIGURE_NUMBERED_COUNT=0
CODE_LITERAL_FIGURE_CAPTIONED_COUNT=0
CODE_LITERAL_FIGURE_LOCATOR_TARGET_COUNT=0

FENCED_CODE_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT=0
FENCED_CODE_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT=0
FENCED_CODE_RESOURCE_RESOLUTION_COUNT=0
FENCED_CODE_FIGURE_DIAGNOSTIC_COUNT=0

REAL_IMAGE_OUTSIDE_LITERAL_REJECTED_COUNT=0
REAL_LINK_OUTSIDE_LITERAL_REJECTED_COUNT=0

INLINE_CODE_IMAGE_FALSE_POSITIVE_COUNT=0
INLINE_CODE_LINK_FALSE_POSITIVE_COUNT=0
FENCED_CODE_IMAGE_FALSE_POSITIVE_COUNT=0
FENCED_CODE_LINK_FALSE_POSITIVE_COUNT=0
LITERAL_RESOURCE_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_DIAGNOSTIC_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_NUMBERING_FALSE_POSITIVE_COUNT=0
LITERAL_FIGURE_CAPTION_FALSE_POSITIVE_COUNT=0
REAL_FIGURE_REGRESSION_COUNT=0
```

---

## 41. 最终报告格式

```ini
TARGETED_TESTS=
TYPECHECK=
FULL_TESTS=
BUILD=
DEPLOY_SHA_GATE=
RUNTIME_IDENTITY=

FEATURE_FIGURE_LITERAL_EXCLUSION_V1=
GLOBAL_RUNTIME_DECISION=

FINAL_DECISION=
```

最终报告必须展示：

```text
当前 figure-alt-binding-fixture.md 顶部 `![alt](path)`：
excludedByInlineCode=1
realFigureOccurrenceCount=0
figureStructureDiagnosticCount=0
```

并证明：

```text
真实 ![](real.png)
仍然 admitted=1
```

---

## 42. 一次性执行流程

现在直接执行：

```text
审计 image/link/resource scanners
→ 找到 source token authority
→ 建立 literal range scanner
→ inline code exclusion
→ fenced code exclusion
→ resource scanner 接入 exclusion
→ figure candidate scanner 接入 exclusion
→ standalone invariant 接入干净 candidate set
→ diagnostics 回归
→ caption/numbering 回归
→ locator 回归
→ 新 fixture
→ targeted tests
→ typecheck
→ full tests
→ build
→ deploy
→ SHA gate
→ Runtime identity
→ Runtime acceptance
→ global runtime scan
→ final evidence report
```

---

## 43. 最终不变量

最终必须稳定满足：

```text
`![](a.png)`
=
文本

不是：
图片
资源
Figure
诊断目标
编号对象
图名对象
Locator target
```

以及：

```text
真实 ![](a.png)
=
真实 Figure
```

二者必须从 scanner 第一层就彻底区分。

**本轮不是只读审计。发现问题后直接修改，并继续执行所有可执行 Gate，禁止中途停下等待下一轮。**

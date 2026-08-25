# ATX Marker Parser Behavior Test

> 专用 fixture：验证 Typora 对 ATX 标题标记的实际解析行为，以及
> `LATENT_ATX_HEADING_MARKER` / 转义 IGNORE / 结构隔离。
> 依据真实 Typora parser 行为判定，不采用插件自创的 Markdown 规则。
> 标题文本不含任何字面序号前缀；层级由 `#` 级别表达，编号由模板另行处理。

## Canonical heading section（真实标题）

### 三级小节

###### 深层六级

## Escaped（必须 IGNORE，不产生任何 Error/Warning/Hint）

\#

\##

\####

## Unescaped 行首 hash（按 Typora 实际解析结果：
## 若成为 Heading Node 则由 EMPTY_HEADING 接管，否则为 LATENT_ATX_HEADING_MARKER）

#

##

####

## Inline hash（必须 IGNORE，非行首 ATX 候选）

C#
价格 #1

## Parser variants（验证 Typora 对「# + 无空格」vs「# + 空格」的差异）

#text
##text
# text
## text
#######

## Leading whitespace（验证前导空格是否产生 Heading Node）

 ##
  ##
   ##
    ##

## Fenced code 内的 hash（必须 IGNORE）

```text
##
#
```

## Real gap section（真实结构跳级）

#### 四级标题

###### 六级标题

> 期望（strict）：
> - 真实 gap（H2 -> H4、H4 -> H6）= HEADING_LEVEL_GAP ERROR
> - 真实空标题（若 Typora 生成空 Heading Node）= HEADING_EMPTY_TEXT ERROR
> - 未转义、未成为 Heading 的行 = LATENT_ATX_HEADING_MARKER WARNING
> - `\# / \## / \####`、inline `#`、`#text`（无空格）、fence 内 `##` = IGNORE

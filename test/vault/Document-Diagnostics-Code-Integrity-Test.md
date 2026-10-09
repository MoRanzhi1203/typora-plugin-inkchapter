<!--
Document Diagnostics smoke fixture -- CODE INTEGRITY / CAPTION / NUMBERING (P1).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  CODE_MISSING_NAME               = 1  (no caption/title name on the code block)
  CODE_MISSING_LANGUAGE           = 1  (the first fence has NO language tag)
  CODE_DUPLICATE_NAME             = 0
  CODE_EMPTY_BLOCK                = 1  (the empty fence below)
  CODE_MANUAL_NUMBER_PREFIX       = 1  ("代码 3" typed while auto-numbering is ON)
  CODE_ORPHAN_CAPTION             = 0
  CODE_MULTIPLE_CAPTIONS          = 0
  CODE_CAPTION_FORMAT_INVALID     = 0
  CODE_NUMBER_DUPLICATE           = 0
  CODE_NUMBER_ORDER_INVALID       = 0
  EXCESSIVE_INTERNAL_BLANK_LINES  = 1  (3 blank lines between the empty fence and
                                         the caption paragraph -- Block-Gap target)
-->

# Code Integrity Fixture

Intro body.

```
const noLanguage = true
```

```ts
const hasLanguage = true
```

```

```







代码 3 Manual prefix code caption

```js
const trailing = 1
```










<!--
Document Diagnostics smoke fixture — TABLE INTEGRITY / CAPTION / NUMBERING (P1).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  TABLE_MISSING_NAME              = 1  (the first table has no caption/title name)
  TABLE_DUPLICATE_NAME            = 0  (no two tables share a name)
  TABLE_EMPTY_CONTENT             = 1  (the header-only table below)
  TABLE_MANUAL_NUMBER_PREFIX      = 1  ("表 2" typed while auto-numbering is ON)
  TABLE_BLOCK_STRUCTURE_INVALID   = 0
  TABLE_ORPHAN_CAPTION            = 0
  TABLE_MULTIPLE_CAPTIONS         = 0
  TABLE_CAPTION_FORMAT_INVALID    = 0
  TABLE_NUMBER_DUPLICATE          = 0
  TABLE_NUMBER_ORDER_INVALID      = 0
-->
# Table Integrity Fixture

Intro body.

| A | B |
|---|---|
| 1 | 2 |

| H1 | H2 |
|---|---|

表 2 Manual prefix table caption

| X | Y |
|---|---|
| 9 | 8 |
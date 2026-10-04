<!--
Document Diagnostics smoke fixture — HEADING STRUCTURE (P0).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  HEADING_LEVEL_GAP                  = 1  (H1 -> H4 jump)
  HEADING_EMPTY_TEXT                 = 1  (the empty "## " heading below)
  HEADING_DUPLICATE_TEXT             = 1  (the two "Repeated" headings form ONE group)
  HEADING_DUPLICATE_IDENTITY         = 0  (distinct source lines -> distinct identities)
  HEADING_MANUAL_NUMBER_PREFIX       = 1  ("三、" typed while auto-numbering is ON)
  HEADING_AUTO_NUMBER_CONFLICT       = 0  (only asserted when auto-numbering is effective)
  STRICT_SINGLE_H1_NO_H1             = 0  (the document HAS exactly one H1)
  STRICT_SINGLE_H1_MULTIPLE_H1       = 0
  LATENT_ATX_HEADING_MARKER          = 1  (the escaped marker line below)
-->
# Heading Structure Fixture

Intro body so the document is not headings-only.

## 

#### Deep jump after an empty heading

三、Manual prefix heading

## Repeated

body

## Repeated

another body

\# Escaped marker that is not a heading
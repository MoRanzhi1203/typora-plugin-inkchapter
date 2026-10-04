<!--
Document Diagnostics smoke fixture — LINK / ANCHOR INTEGRITY (P2).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  LINK_LOCAL_ANCHOR_MISSING          = 1  ([jump](#nowhere) has no matching heading id)
  LINK_LOCAL_TARGET_MISSING          = 1  (./assets/missing-target.md does not exist)
  HEADING_ANCHOR_COLLISION           = 1  (the two "Collide" headings collide -> ONE group)
  LINK_LOCAL_FILE_ANCHOR_MISSING     = DEFERRED_BY_SPEC (never emitted)
  FIGURE_REFERENCE_TARGET_MISSING    = DEFERRED
  TABLE_REFERENCE_TARGET_MISSING     = DEFERRED
  FORMULA_REFERENCE_TARGET_MISSING   = DEFERRED
  BLOCKQUOTE_EMPTY                   = 1  (the empty blockquote below)
-->
# Link Anchor Fixture

Intro body. See [jump](#nowhere) and [missing file](./assets/missing-target.md).

## Collide

body

## Collide

other body

> 
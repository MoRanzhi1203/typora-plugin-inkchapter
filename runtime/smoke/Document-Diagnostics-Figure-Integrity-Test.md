<!--
Document Diagnostics smoke fixture — FIGURE INTEGRITY / CAPTION / NUMBERING (P1).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  FIGURE_MISSING_NAME              = 1  (first image has empty alt)
  FIGURE_LOCAL_IMAGE_MISSING       = 1  (the second image path does not exist)
  FIGURE_DUPLICATE_NAME            = 0  (no two images share a name)
  FIGURE_MANUAL_NUMBER_PREFIX      = 1  ("图 1" typed while auto-numbering is ON)
  FIGURE_BLOCK_STRUCTURE_INVALID   = 0  (no structural violation, e.g. caption inside a figure)
  FIGURE_ORPHAN_CAPTION            = 1  (a caption line with no owning figure above it)
  FIGURE_MULTIPLE_CAPTIONS         = 0  (each owner carries ONE caption)
  FIGURE_CAPTION_FORMAT_INVALID    = 0
  FIGURE_NUMBER_DUPLICATE          = 0
  FIGURE_NUMBER_ORDER_INVALID      = 0
The sibling assets are intentionally absent so the missing image is judgeable.
-->
# Figure Integrity Fixture

Intro body.

![](./assets/figure-without-name.png)

![Named figure](./assets/figure-missing-target.png)

图 1 Manual prefix caption

<!-- Orphan caption below: no owning figure immediately above it. -->

: Orphan caption with no owner.
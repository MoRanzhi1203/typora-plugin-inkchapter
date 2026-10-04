<!--
Document Diagnostics smoke fixture — FORMULA INTEGRITY / NUMBERING (P1).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  FORMULA_DUPLICATE_VISIBLE_TAG      = 1  (two display formulas share the same tag (1))
  FORMULA_EMPTY_CONTENT              = 1  (the empty display block below)
  FORMULA_BLOCK_STRUCTURE_INVALID    = 0
  FORMULA_NUMBER_ORDER_INVALID       = 1  (tags appear out of order)
  FORMULA_NUMBER_SECTION_MISMATCH    = 0  (only asserted when sections are numbered)
  FIGURE_REFERENCE_TARGET_MISSING    = DEFERRED (never emitted by the producer)
  TABLE_REFERENCE_TARGET_MISSING     = DEFERRED
  FORMULA_REFERENCE_TARGET_MISSING   = DEFERRED
-->

# Formula Integrity Fixture

Intro body.

$$
a = b \tag{1}
$$

$$
c = d \tag{2}
$$

$$

$$

$$
e = f \tag{1}
$$
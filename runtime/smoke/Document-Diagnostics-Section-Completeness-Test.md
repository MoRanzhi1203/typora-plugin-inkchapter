<!--
Document Diagnostics smoke fixture — SECTION COMPLETENESS (P0).
Expected (uniquely judgeable; FRESH window, InkChapter loaded):
  SECTION_EMPTY                    = 1  ("## Empty leaf" owns no body and no subheading)
  SECTION_ONLY_SUBHEADINGS         = 1  ("## Only subheadings" owns only "### Child")
  DOCUMENT_HEADING_ONLY_NO_BODY    = 0  (document has substantive body)
  DOCUMENT_HEADINGS_ONLY_NO_BODY   = 0  (document has substantive body)
  SECTION_EMPTY_AND_ONLY_SUBHEADINGS_COEXIST = 0  (mutually exclusive per heading)
Document a SEPARATE headings-only document manually to exercise
DOCUMENT_HEADINGS_ONLY_NO_BODY (that shape cannot coexist here).
-->
# Section Completeness Fixture

Intro body paragraph.

## With body

This section has substantive body text.

## Empty leaf

## Only subheadings

### Child

child body
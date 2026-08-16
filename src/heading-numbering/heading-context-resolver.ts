/**
 * Heading Context Resolver — pure mapping from a target's document order to the
 * nearest preceding H1/H2/H3 heading numbers.
 *
 * The heading numbers MUST come from the existing Heading Numbering state (the
 * `data-inkchapter-heading-number` attribute rendered on headings); this module
 * never parses heading text with its own regex.
 */

export interface HeadingContextEntry {
  level: 1 | 2 | 3
  number: string
  documentOrder: number
}

export interface ResolvedHeadingContext {
  h1?: string
  h2?: string
  h3?: string
}

/**
 * Resolve the nearest preceding H1/H2/H3 heading numbers for a target whose
 * position is `targetDocumentOrder` (the count of headings that precede it).
 * Fallback is undefined (callers map to "0" per spec).
 */
export function resolveHeadingContext(
  headings: HeadingContextEntry[],
  targetDocumentOrder: number,
): ResolvedHeadingContext {
  let h1: string | undefined
  let h2: string | undefined
  let h3: string | undefined
  for (const h of headings) {
    if (h.documentOrder >= targetDocumentOrder) break
    if (h.level === 1) h1 = h.number
    else if (h.level === 2) h2 = h.number
    else if (h.level === 3) h3 = h.number
  }
  return { h1, h2, h3 }
}

/** Extract the chapter number from an H1 heading number (first segment). */
export function chapterFromHeadingNumber(number: string | undefined): string {
  if (number === undefined || number === '') return '0'
  const seg = number.split(/[.\-/]/).filter(Boolean)
  return seg[0] ?? number
}

/** Extract the section number from an H2 heading number (last segment). */
export function sectionFromHeadingNumber(number: string | undefined): string {
  if (number === undefined || number === '') return '0'
  const seg = number.split(/[.\-/]/).filter(Boolean)
  return seg.length > 0 ? seg[seg.length - 1] : number
}

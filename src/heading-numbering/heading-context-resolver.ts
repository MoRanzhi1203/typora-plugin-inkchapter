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
  /**
   * Structured numeric ordinals (1-based). These are the ONLY authority for
   * object numbering — never parsed from the display label text.
   *
   * - chapterOrdinal: 1-based H1 index across the document.
   * - sectionOrdinal: 1-based H2 index WITHIN the current H1 (resets at each H1).
   * - subsectionOrdinal: 1-based H3 index WITHIN the current H2 (resets at each H2).
   */
  chapterOrdinal?: number
  sectionOrdinal?: number
  subsectionOrdinal?: number
}

/**
 * Resolve the nearest preceding H1/H2/H3 heading numbers for a target whose
 * position is `targetDocumentOrder` (the count of headings that precede it).
 *
 * Numeric ordinals are computed as LOCAL ordinals from the heading structure:
 * section resets per H1, subsection resets per H2. This is independent of the
 * display label (e.g. "二、环境准备" still yields sectionOrdinal=2).
 */
export function resolveHeadingContext(
  headings: HeadingContextEntry[],
  targetDocumentOrder: number,
): ResolvedHeadingContext {
  let h1: string | undefined
  let h2: string | undefined
  let h3: string | undefined
  let chapterOrdinal: number | undefined
  let sectionOrdinal: number | undefined
  let subsectionOrdinal: number | undefined
  let chapter = 0
  let section = 0
  let subsection = 0
  for (const h of headings) {
    if (h.documentOrder >= targetDocumentOrder) break
    if (h.level === 1) {
      h1 = h.number
      chapter++
      section = 0
      subsection = 0
      chapterOrdinal = chapter
      sectionOrdinal = undefined
      subsectionOrdinal = undefined
    } else if (h.level === 2) {
      h2 = h.number
      section++
      subsection = 0
      sectionOrdinal = section
      subsectionOrdinal = undefined
    } else if (h.level === 3) {
      h3 = h.number
      subsection++
      subsectionOrdinal = subsection
    }
  }
  return { h1, h2, h3, chapterOrdinal, sectionOrdinal, subsectionOrdinal }
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

// ── Logical heading role mapping (v2.5.1) ────────────────────────────

export type LogicalHeadingMode = 'strict' | 'loose'

/** Physical heading level that plays each logical numbering role. */
export interface LogicalHeadingRoleMap {
  chapterPhysicalLevel: number
  sectionPhysicalLevel: number
  subsectionPhysicalLevel: number
}

/**
 * The first participating heading level is the logical chapter, the second is
 * the logical section, the third is the logical subsection. Never a hard-coded
 * H1/H2/H3 mapping.
 */
export function resolveLogicalHeadingRoleMap(mode: LogicalHeadingMode): LogicalHeadingRoleMap {
  if (mode === 'loose') {
    return { chapterPhysicalLevel: 1, sectionPhysicalLevel: 2, subsectionPhysicalLevel: 3 }
  }
  return { chapterPhysicalLevel: 2, sectionPhysicalLevel: 3, subsectionPhysicalLevel: 4 }
}

export interface LogicalHeadingContextEntry {
  physicalLevel: number
  number: string
  documentOrder: number
}

export interface ResolvedLogicalHeadingContext {
  chapterOrdinal?: number
  sectionOrdinal?: number
  subsectionOrdinal?: number
  chapterNumber?: string
  sectionNumber?: string
  subsectionNumber?: string
}

/**
 * Resolve the logical chapter/section/subsection ordinals for a target from
 * the nearest preceding headings mapped through the role map. Ordinals come
 * from the structured heading number (never parsed from display text).
 */
export function resolveLogicalHeadingContext(
  headings: LogicalHeadingContextEntry[],
  targetDocumentOrder: number,
  roleMap: LogicalHeadingRoleMap,
): ResolvedLogicalHeadingContext {
  let chapterNumber: string | undefined
  let sectionNumber: string | undefined
  let subsectionNumber: string | undefined
  for (const h of headings) {
    if (h.documentOrder >= targetDocumentOrder) break
    if (h.physicalLevel === roleMap.chapterPhysicalLevel) {
      chapterNumber = h.number
      sectionNumber = undefined
      subsectionNumber = undefined
    } else if (h.physicalLevel === roleMap.sectionPhysicalLevel) {
      sectionNumber = h.number
      subsectionNumber = undefined
    } else if (h.physicalLevel === roleMap.subsectionPhysicalLevel) {
      subsectionNumber = h.number
    }
  }
  const toOrd = (s: string | undefined): number | undefined => {
    if (s === undefined || s === '') return undefined
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n >= 1 ? n : undefined
  }
  return {
    chapterOrdinal: toOrd(chapterFromHeadingNumber(chapterNumber)),
    sectionOrdinal: toOrd(sectionFromHeadingNumber(sectionNumber)),
    subsectionOrdinal: toOrd(sectionFromHeadingNumber(subsectionNumber)),
    chapterNumber,
    sectionNumber,
    subsectionNumber,
  }
}

/**
 * V5.12-R8 §4/§6 — SINGLE Markdown resource-reference scanner.
 *
 * One regex, one offset computation. Every consumer (local-resource validity,
 * missing-image diagnostics, figure full-token / destination ranges, the
 * locate resolver's own re-scan) derives its offsets from THIS module — never
 * from a second parser and never from `indexOf('![')` guessing.
 *
 * Two views are exposed:
 *
 *   `parseLocalLinkTargets`       — LOCAL destinations only (scheme / `#fragment`
 *                                   / mailto excluded). Backward-compatible with
 *                                   the pre-R8 contract, plus additive offsets.
 *   `parseImageSourceOccurrences` — EVERY Markdown image occurrence (local,
 *                                   remote, data) with its full token range and
 *                                   destination/path range.
 *
 * A single occurrence therefore always carries BOTH ranges:
 *   FULL_TOKEN_RANGE  `![alt](dest "title")`
 *   DESTINATION_RANGE `dest`
 */

export type ResourceKind = 'image' | 'link'

/**
 * V1 — Parser Exclusion Before Candidate Discovery. Literal/code regions
 * (inline code spans, fenced code blocks, indented code) are resolved FIRST and
 * every token that INTERSECTS such a region is excluded from the candidate set.
 */
import { computeMarkdownLiteralRanges, isSourceRangeLiteral } from './document-markdown-literal-exclusion-v1'

/** V5.12-R8 §4 — resource classification (remote/data must never be "local missing"). */
export type ResourceClass = 'local' | 'remote' | 'data' | 'other'

/**
 * Phase 7R.3.11.8B.7.3 — local resource reference fact.
 * `resourceKind` distinguishes image Markdown (`![..](dest)`, rendered as an
 * `<img>` block) from plain links (`[..](dest)`, rendered as an `<a>`).
 *
 * V4 — every fact additionally carries its SOURCE ANCHOR (absolute Markdown
 * offsets + line span + the full raw source line). This lets missing-image
 * diagnostics be produced from the Markdown SOURCE alone — a broken image whose
 * live `<img>` is stripped by Typora still yields FIGURE_LOCAL_IMAGE_MISSING
 * and stays locatable through the source-range anchor.
 *
 * V5.12-R8 §4 — the fact additionally carries the DESTINATION/PATH range and
 * the alt text, so one occurrence can serve both the full-token rule
 * (FIGURE_MISSING_NAME) and the destination rule (FIGURE_LOCAL_IMAGE_MISSING).
 */
export interface LocalResourceReference {
  target: string
  resourceKind?: ResourceKind
  /** Absolute [start,end) offset of the reference token inside the Markdown. */
  sourceStart?: number
  sourceEnd?: number
  /** 0-based source line span of the reference. */
  startLine?: number
  endLine?: number
  /**
   * V5.12-R5 §5 — 0-based column offsets derived ONCE from the Markdown source
   * (line start), carried with the occurrence fact. Never inferred from the DOM.
   */
  startColumn?: number
  endColumn?: number
  /** Full raw text of the source line that contains the reference. */
  rawText?: string
  /** V5.12-R8 §4 — destination/path span (excludes an optional `"title"`). */
  destinationStart?: number
  destinationEnd?: number
  /** V5.12-R8 §4 — the full Markdown reference token (`![alt](dest)`). */
  rawToken?: string
  /** V5.12-R8 §4 — Markdown alt text (the canonical figure name). */
  altText?: string
  /** V5.12-R8 §4 — resource class (local | remote | data | other). */
  resourceClass?: ResourceClass
}

/** One Markdown image occurrence (the unified Figure Source Occurrence view). */
export interface ImageSourceOccurrence {
  rawToken: string
  rawDestination: string
  altText: string
  /** Whole `![alt](dest)`. */
  tokenStart: number
  tokenEnd: number
  /** Destination/path only (excludes `"title"`). */
  destinationStart: number
  destinationEnd: number
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  rawText: string
  resourceClass: ResourceClass
  isLocal: boolean
}

/** Line-relative span of one reference (same coordinate system as the scanner). */
export interface ReferenceSpan {
  tokenStart: number
  tokenEnd: number
  destinationStart: number
  destinationEnd: number
  rawToken: string
  rawDestination: string
  altText: string
  resourceKind: ResourceKind
  resourceClass: ResourceClass
}

/** The ONE reference-shape authority: `![alt](dest)` / `[alt](dest)`. */
function createReferencePattern(): RegExp {
  return /(!?)\[([^\]]*)\]\(([^)]+)\)/g
}

function countLineBreaks(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/**
 * V5.12-R8 §4/§9 — resource classification. A remote / data URL is NEVER a
 * local resource, so it can never be reported as a missing local file.
 */
export function classifyResourceClass(target: string): ResourceClass {
  if (/^data:/i.test(target)) return 'data'
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return 'remote'
  if (target.startsWith('#')) return 'other'
  return 'local'
}

/** True for a destination the plugin is allowed to check on the filesystem. */
export function isLocalResourceDestination(target: string): boolean {
  if (!target) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // scheme (incl. data:, mailto:, http:)
  if (target.startsWith('#')) return false // in-document anchor
  return true
}

interface ScannedReference extends ReferenceSpan {
  sourceStart: number
  sourceEnd: number
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  rawText: string
  isLocal: boolean
}

/**
 * THE scanner. Returns every Markdown reference in document order with its
 * full token span + destination span, in ABSOLUTE document offsets.
 */
function scanMarkdownReferences(markdown: string): ScannedReference[] {
  const out: ScannedReference[] = []
  if (!markdown) return out
  // §3/§12/§13 — the ONE literal exclusion authority. A token that OVERLAPS a
  // literal/code range is TEXT, never a resource candidate.
  const literalRanges = computeMarkdownLiteralRanges(markdown)
  const re = createReferencePattern()
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const resourceKind: ResourceKind = m[1] === '!' ? 'image' : 'link'
    const altText = m[2] ?? ''
    const destinationText = m[3]
    const rawDestination = destinationText.trim().split(/\s+/)[0]
    if (!rawDestination) continue
    const sourceStart = m.index
    const sourceEnd = m.index + m[0].length
    if (isSourceRangeLiteral(literalRanges, sourceStart, sourceEnd)) continue
    // Destination/path span: the raw destination text sits immediately before
    // the closing `)`, and the path is its first whitespace-separated token.
    const destinationTextStart = sourceEnd - 1 - destinationText.length
    const leadingWhitespace = destinationText.length - destinationText.trimStart().length
    const destinationStart = destinationTextStart + leadingWhitespace
    const destinationEnd = destinationStart + rawDestination.length
    const startLine = countLineBreaks(markdown.slice(0, sourceStart))
    const endLine = startLine + countLineBreaks(m[0])
    const lineStart = markdown.lastIndexOf('\n', sourceStart - 1) + 1
    const nextNl = markdown.indexOf('\n', sourceEnd)
    const rawText = markdown.slice(lineStart, nextNl < 0 ? markdown.length : nextNl)
    const endLineStart = markdown.lastIndexOf('\n', Math.max(0, sourceEnd - 1)) + 1
    out.push({
      rawToken: m[0],
      rawDestination,
      altText,
      tokenStart: sourceStart,
      tokenEnd: sourceEnd,
      destinationStart,
      destinationEnd,
      resourceKind,
      resourceClass: classifyResourceClass(rawDestination),
      isLocal: isLocalResourceDestination(rawDestination),
      sourceStart,
      sourceEnd,
      startLine,
      endLine,
      startColumn: Math.max(0, sourceStart - lineStart),
      endColumn: Math.max(0, sourceEnd - endLineStart),
      rawText,
    })
  }
  return out
}

/**
 * V1 §31 — the scanner's REAL admitted candidate counts (image + link), i.e.
 * AFTER the literal exclusion. The literal-exclusion gate compares these with
 * the literal-derived expectation so a real token can never be silently dropped.
 */
export function scanAdmittedReferenceCounts(markdown: string): { imageCount: number; linkCount: number } {
  let imageCount = 0
  let linkCount = 0
  for (const ref of scanMarkdownReferences(markdown ?? '')) {
    if (ref.resourceKind === 'image') imageCount++
    else linkCount++
  }
  return { imageCount, linkCount }
}

/**
 * V1 §27/§31 — the admitted reference SPANS (absolute offsets, post-exclusion).
 * Used by the literal-exclusion gate to decide whether a block-level structure
 * diagnostic really owns a REAL image (a legitimate mixed block) or owns nothing
 * but literal text (a false positive).
 */
export function scanAdmittedReferenceSpans(
  markdown: string,
): Array<{ start: number; end: number; resourceKind: ResourceKind }> {
  return scanMarkdownReferences(markdown ?? '').map(r => ({
    start: r.sourceStart,
    end: r.sourceEnd,
    resourceKind: r.resourceKind,
  }))
}

/**
 * Safe local-relative resource parsing from Markdown (no network).
 * Every occurrence of a local destination is returned in document order;
 * identical destinations appear once per occurrence. Each occurrence carries
 * its resource kind plus a source anchor (offset range + line span + raw line
 * text) so downstream rules never depend on a rendered DOM node existing.
 */
export function parseLocalLinkTargets(markdown: string): Array<string | LocalResourceReference> {
  const out: Array<string | LocalResourceReference> = []
  for (const ref of scanMarkdownReferences(markdown)) {
    if (!ref.isLocal) continue
    out.push({
      target: ref.rawDestination,
      resourceKind: ref.resourceKind,
      sourceStart: ref.sourceStart,
      sourceEnd: ref.sourceEnd,
      startLine: ref.startLine,
      endLine: ref.endLine,
      startColumn: ref.startColumn,
      endColumn: ref.endColumn,
      rawText: ref.rawText,
      destinationStart: ref.destinationStart,
      destinationEnd: ref.destinationEnd,
      rawToken: ref.rawToken,
      altText: ref.altText,
      resourceClass: ref.resourceClass,
    })
  }
  return out
}

/**
 * Phase I (spec §10) — IN-DOCUMENT anchor references `[x](#target)` (link kind),
 * literal-excluded by the SAME scanner as every other reference. `#target` is
 * classified `resourceClass='other'` (never a filesystem resource), so these
 * facts are deliberately SEPARATE from `parseLocalLinkTargets` (which only
 * returns checkable local files). `target` is the anchor WITHOUT the leading
 * `#`, exactly as written in the Markdown source.
 */
export interface LocalAnchorReference {
  /** Anchor name without the leading `#` (the raw source token). */
  target: string
  /** The raw Markdown destination including `#`. */
  rawDestination: string
  sourceStart: number
  sourceEnd: number
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  rawText: string
  destinationStart: number
  destinationEnd: number
}

export function parseLocalAnchorTargets(markdown: string): LocalAnchorReference[] {
  const out: LocalAnchorReference[] = []
  for (const ref of scanMarkdownReferences(markdown ?? '')) {
    if (ref.resourceKind !== 'link') continue
    if (!ref.rawDestination.startsWith('#')) continue
    const target = ref.rawDestination.slice(1)
    if (target === '') continue
    out.push({
      target,
      rawDestination: ref.rawDestination,
      sourceStart: ref.sourceStart,
      sourceEnd: ref.sourceEnd,
      startLine: ref.startLine,
      endLine: ref.endLine,
      startColumn: ref.startColumn,
      endColumn: ref.endColumn,
      rawText: ref.rawText,
      destinationStart: ref.destinationStart,
      destinationEnd: ref.destinationEnd,
    })
  }
  return out
}

/**
 * V5.12-R8 §4 — EVERY Markdown image occurrence (local / remote / data), with
 * both the full token range and the destination range.
 */
export function parseImageSourceOccurrences(markdown: string): ImageSourceOccurrence[] {
  const out: ImageSourceOccurrence[] = []
  for (const ref of scanMarkdownReferences(markdown)) {
    if (ref.resourceKind !== 'image') continue
    out.push({
      rawToken: ref.rawToken,
      rawDestination: ref.rawDestination,
      altText: ref.altText,
      tokenStart: ref.tokenStart,
      tokenEnd: ref.tokenEnd,
      destinationStart: ref.destinationStart,
      destinationEnd: ref.destinationEnd,
      startLine: ref.startLine,
      endLine: ref.endLine,
      startColumn: ref.startColumn,
      endColumn: ref.endColumn,
      rawText: ref.rawText,
      resourceClass: ref.resourceClass,
      isLocal: ref.isLocal,
    })
  }
  return out
}

/**
 * V5.12-R8 §6/§7 — the reference spans on ONE source line, in the scanner's own
 * coordinate system. The locate resolver re-derives its OWN offsets with this
 * function so the resolved range is directly comparable to the expected one.
 */
export function findReferenceSpans(lineText: string): ReferenceSpan[] {
  const out: ReferenceSpan[] = []
  const re = createReferencePattern()
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText)) !== null) {
    const resourceKind: ResourceKind = m[1] === '!' ? 'image' : 'link'
    const destinationText = m[3]
    const rawDestination = destinationText.trim().split(/\s+/)[0]
    if (!rawDestination) continue
    const tokenStart = m.index
    const tokenEnd = m.index + m[0].length
    const destinationTextStart = tokenEnd - 1 - destinationText.length
    const leadingWhitespace = destinationText.length - destinationText.trimStart().length
    const destinationStart = destinationTextStart + leadingWhitespace
    out.push({
      tokenStart,
      tokenEnd,
      destinationStart,
      destinationEnd: destinationStart + rawDestination.length,
      rawToken: m[0],
      rawDestination,
      altText: m[2] ?? '',
      resourceKind,
      resourceClass: classifyResourceClass(rawDestination),
    })
  }
  return out
}

/** The reference span on `lineText` that CONTAINS `offsetInLine`. */
export function findReferenceSpanAt(lineText: string, offsetInLine: number): ReferenceSpan | null {
  for (const span of findReferenceSpans(lineText)) {
    if (offsetInLine >= span.tokenStart && offsetInLine < span.tokenEnd) return span
  }
  return null
}

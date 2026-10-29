/**
 * TRAE V3 §7.2 — `DocumentDefinitionReferenceIndex`.
 *
 * THE ONE shared index over the four definition / reference universes:
 *
 *   - footnote references         `正文[^abc]`
 *   - footnote definitions        `[^abc]: 内容`  (+ continuation lines)
 *   - reference-style link refs   `[text][label]` / `[label][]`
 *   - reference-style link defs   `[label]: https://…`
 *
 * Footnote and reference-style link NEVER own a separate whole-document scanner —
 * they share THIS index (and its single `normalizeDefinitionLabel` authority).
 *
 * GUARANTEE: for ONE `documentKey` + `sourceRevision` the index is built AT MOST
 * ONCE (`getDocumentDefinitionReferenceIndex`). Every rule reads the index.
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import {
  buildSourceLineSpans,
  isRangeProtected,
  type SourceSyntaxSnapshot,
} from './document-source-syntax-authority'

// ── the label authority ────────────────────────────────────

/**
 * §2.4 — the ONE footnote / reference label normalisation authority. Rules MUST
 * consume this; they must never each `trim`/`toLowerCase` on their own.
 */
export function normalizeDefinitionLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ── the index model ────────────────────────────────────────

export interface DefinitionReferenceOccurrence {
  /** Normalized label. */
  label: string
  /** Raw label exactly as written. */
  rawLabel: string
  startLine: number
  endLine: number
  sourceStart: number
  sourceEnd: number
  rawText: string
}

export interface FootnoteDefinitionOccurrence extends DefinitionReferenceOccurrence {
  /** Body text (definition line payload + continuation lines). */
  body: string
  /** True when the body is empty after trimming (continuation lines count). */
  empty: boolean
}

export interface LinkDefinitionOccurrence extends DefinitionReferenceOccurrence {
  /** The link destination (first whitespace-delimited token of the payload). */
  destination: string
}

export interface DefinitionReferenceGroup<T> {
  label: string
  rawLabel: string
  references: T[]
  definitions: T[]
}

export interface DocumentDefinitionReferenceIndex {
  footnoteReferences: DefinitionReferenceOccurrence[]
  footnoteDefinitions: FootnoteDefinitionOccurrence[]
  linkReferences: DefinitionReferenceOccurrence[]
  linkDefinitions: LinkDefinitionOccurrence[]
  /** normalized label → group (references + definitions) for footnotes. */
  footnoteGroups: ReadonlyMap<string, DefinitionReferenceGroup<DefinitionReferenceOccurrence>>
  /** normalized label → group for reference-style links. */
  linkGroups: ReadonlyMap<string, DefinitionReferenceGroup<DefinitionReferenceOccurrence>>
  sourceRevision: string
}

const FOOTNOTE_REFERENCE_RE = /\[\^([^\]\s][^\]]*)\]/g
const DEFINITION_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$/
// A reference-style link: `[text][label]` / `[text][]` (NOT an image, NOT inline).
// The lookbehind additionally rejects `array[i][j]`-style indexing (a word / `]`
// / `)` / `!` immediately before the opening bracket) so prose subscripting is
// never mis-read as a reference-style link.
const LINK_REFERENCE_SOURCE = /(?<![\w\]\)!\\])\[((?:[^[\]\\]|\\.)*)\]\[([^[\]]*)\]/g.source

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function overlaps(ranges: ReadonlyArray<{ start: number; end: number }>, start: number, end: number): boolean {
  for (const r of ranges) if (start < r.end && end > r.start) return true
  return false
}

/**
 * §7.2 — build the shared index in a single line-oriented pass over the source.
 * Every candidate is discarded when it intersects a protected range (code
 * fence / formula / front matter / literal code).
 */
export function buildDocumentDefinitionReferenceIndex(
  markdown: string,
  sourceRevision: string = '',
  snapshot: SourceSyntaxSnapshot | null = null,
): DocumentDefinitionReferenceIndex {
  const empty: DocumentDefinitionReferenceIndex = {
    footnoteReferences: [],
    footnoteDefinitions: [],
    linkReferences: [],
    linkDefinitions: [],
    footnoteGroups: new Map(),
    linkGroups: new Map(),
    sourceRevision,
  }
  if (!markdown) return empty

  const lines = buildSourceLineSpans(markdown)
  const footnoteDefinitions: FootnoteDefinitionOccurrence[] = []
  const linkDefinitions: LinkDefinitionOccurrence[] = []
  const footnoteLabelRanges: Array<{ start: number; end: number }> = []

  // ── definitions (line-oriented, with footnote continuation lines) ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.blank || isRangeProtected(snapshot, line.start, line.contentEnd)) continue
    const m = DEFINITION_RE.exec(line.text)
    if (!m) continue
    const rawLabel = m[1]
    const labelTokenStart = line.start + line.text.indexOf(`[${rawLabel}]`)
    const labelTokenEnd = labelTokenStart + rawLabel.length + 2
    const isFootnote = rawLabel.startsWith('^')
    if (isFootnote) {
      const cleanLabel = rawLabel.slice(1)
      if (cleanLabel === '') continue
      // continuation lines: blank OR indented ≥1 space, until a real block ends.
      let endLine = line.index
      let body = m[2] ?? ''
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]
        if (isRangeProtected(snapshot, next.start, next.contentEnd)) break
        if (next.blank) { endLine = next.index; body += '\n'; continue }
        if (/^[ \t]/.test(next.text)) { endLine = next.index; body += '\n' + next.text; continue }
        break
      }
      footnoteLabelRanges.push({ start: labelTokenStart, end: labelTokenEnd })
      footnoteDefinitions.push({
        label: normalizeDefinitionLabel(cleanLabel),
        rawLabel,
        startLine: line.index,
        endLine,
        sourceStart: labelTokenStart,
        sourceEnd: labelTokenEnd,
        rawText: line.text,
        body,
        empty: body.trim() === '',
      })
    } else {
      const destination = (m[2] ?? '').trim().split(/\s+/)[0] ?? ''
      linkDefinitions.push({
        label: normalizeDefinitionLabel(rawLabel),
        rawLabel,
        startLine: line.index,
        endLine: line.index,
        sourceStart: labelTokenStart,
        sourceEnd: labelTokenEnd,
        rawText: line.text,
        destination,
      })
    }
  }

  // ── footnote references ──
  const footnoteReferences: DefinitionReferenceOccurrence[] = []
  for (const line of lines) {
    if (line.blank || isRangeProtected(snapshot, line.start, line.contentEnd)) continue
    const re = new RegExp(FOOTNOTE_REFERENCE_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(line.text)) !== null) {
      const start = line.start + m.index
      const end = start + m[0].length
      if (isEscapedAt(line.text, m.index)) continue
      if (overlaps(footnoteLabelRanges, start, end)) continue
      footnoteReferences.push({
        label: normalizeDefinitionLabel(m[1]),
        rawLabel: m[1],
        startLine: line.index,
        endLine: line.index,
        sourceStart: start,
        sourceEnd: end,
        rawText: line.text,
      })
    }
  }

  // ── reference-style link references ──
  const linkReferences: DefinitionReferenceOccurrence[] = []
  for (const line of lines) {
    if (line.blank || isRangeProtected(snapshot, line.start, line.contentEnd)) continue
    const re = new RegExp(LINK_REFERENCE_SOURCE, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(line.text)) !== null) {
      const rawId = m[2]
      const label = normalizeDefinitionLabel(rawId === '' ? m[1] : rawId)
      if (label === '') continue
      const start = line.start + m.index
      const end = start + m[0].length
      linkReferences.push({
        label,
        rawLabel: rawId === '' ? m[1] : rawId,
        startLine: line.index,
        endLine: line.index,
        sourceStart: start,
        sourceEnd: end,
        rawText: line.text,
      })
    }
  }

  return {
    footnoteReferences,
    footnoteDefinitions,
    linkReferences,
    linkDefinitions,
    footnoteGroups: groupBy(footnoteReferences, footnoteDefinitions),
    linkGroups: groupBy(linkReferences, linkDefinitions),
    sourceRevision,
  }
}

function groupBy<T extends DefinitionReferenceOccurrence>(
  references: readonly DefinitionReferenceOccurrence[],
  definitions: readonly T[],
): ReadonlyMap<string, DefinitionReferenceGroup<DefinitionReferenceOccurrence>> {
  const groups = new Map<string, { label: string; rawLabel: string; references: DefinitionReferenceOccurrence[]; definitions: DefinitionReferenceOccurrence[] }>()
  const ensure = (label: string, rawLabel: string): { label: string; rawLabel: string; references: DefinitionReferenceOccurrence[]; definitions: DefinitionReferenceOccurrence[] } => {
    let g = groups.get(label)
    if (!g) { g = { label, rawLabel, references: [], definitions: [] }; groups.set(label, g) }
    return g
  }
  for (const r of references) ensure(r.label, r.rawLabel).references.push(r)
  for (const d of definitions) ensure(d.label, d.rawLabel).definitions.push(d as unknown as DefinitionReferenceOccurrence)
  return groups as ReadonlyMap<string, DefinitionReferenceGroup<DefinitionReferenceOccurrence>>
}

// ── §9 — build-once (memoised per documentKey + sourceRevision) ─────────────

interface IndexCacheEntry {
  key: string
  markdown: string
  index: DocumentDefinitionReferenceIndex
}

const INDEX_CACHE_LIMIT = 8
const indexCache: IndexCacheEntry[] = []
let definitionReferenceIndexBuildCount = 0

/**
 * §14/§9 — the ONE entry point every rule consumes. For a given
 * `documentKey` + `sourceRevision` the index is built AT MOST ONCE.
 */
export function getDocumentDefinitionReferenceIndex(
  documentKey: string | null,
  markdown: string,
  sourceRevision: number | null | undefined,
  snapshot: SourceSyntaxSnapshot | null,
): DocumentDefinitionReferenceIndex {
  const key = `${documentKey ?? ''}\u0000${sourceRevision ?? ''}`
  const hit = indexCache.find(e => e.key === key && e.markdown === markdown)
  if (hit) return hit.index
  const index = buildDocumentDefinitionReferenceIndex(markdown, String(sourceRevision ?? ''), snapshot)
  definitionReferenceIndexBuildCount++
  indexCache.unshift({ key, markdown, index })
  while (indexCache.length > INDEX_CACHE_LIMIT) indexCache.pop()
  return index
}

/** §14 — how many real index builds ran (test / audit hook). */
export function getDocumentDefinitionReferenceIndexBuildCount(): number {
  return definitionReferenceIndexBuildCount
}

/** Test / audit hook — clear the memo cache and the build counter. */
export function resetDocumentDefinitionReferenceIndex(): void {
  indexCache.length = 0
  definitionReferenceIndexBuildCount = 0
}

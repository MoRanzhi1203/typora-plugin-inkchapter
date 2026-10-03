/**
 * Document Diagnostics VNext — Requirements Gap Closure V1 (§12–§29).
 *
 * ONE pure, source-only analysis module for the VNext rules whose authority is
 * the user's Markdown itself. It NEVER reads the DOM, NEVER writes Markdown and
 * NEVER holds plugin state:
 *
 *   analyzeDocumentCompleteness  → §12/§13/§16/§17
 *   detectManualNumberPrefix     → §24
 *   analyzeTableBlocks           → §18
 *   analyzeDisplayFormulaBlocks  → §19/§20
 *   analyzeEmptySourceObjects    → §28
 *
 * Every analyzer returns PROVABLE facts. When the canonical source shape cannot
 * be proven the result is empty/silent — a hint is never guessed (§39).
 */
import { normalizeCanonicalHeadingText } from './latent-atx-heading-marker'
// Heading Auto-Number Conflict Diagnostics V1 §7 — the ONE manual-number prefix
// parser authority (this module keeps only the LEGACY narrow view).
import { detectLegacyManualNumberPrefix } from './document-diagnostics-heading-manual-number-prefix-v1'

// ── Shared source scanning helpers ──────────────────────────────────────────

/** 0-based line index → { text (CR stripped), start (abs offset), end (abs offset) }. */
interface SourceLine {
  index: number
  text: string
  start: number
  end: number
}

function splitSourceLines(markdown: string): SourceLine[] {
  const out: SourceLine[] = []
  let offset = 0
  const raw = markdown.split('\n')
  for (let i = 0; i < raw.length; i++) {
    const withCr = raw[i]
    const text = withCr.endsWith('\r') ? withCr.slice(0, -1) : withCr
    out.push({ index: i, text, start: offset, end: offset + text.length })
    offset += withCr.length + 1
  }
  return out
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*?)[ \t]*$|$)/
const SETEXT_UNDERLINE_RE = /^\s{0,3}(?:=+|-+)\s*$/

/** §16/§18 — the container marker literally carried by a source line. */
export type SourceContainerKind = 'list-item' | 'blockquote' | null

export function sourceContainerKindOfLine(text: string): SourceContainerKind {
  if (/^\s{0,3}>/.test(text)) return 'blockquote'
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(text)) return 'list-item'
  return null
}

/** True when the line is blank / whitespace only. */
function isBlank(text: string): boolean {
  return text.trim() === ''
}

/**
 * §18/§19 — the line CONTENT once the block container marker is removed
 * (`> ` blockquote, `- ` / `1. ` list item). Shape tests always run on the
 * CONTENT, while the marker itself is what proves "not a standalone block".
 */
function stripContainerMarker(text: string): string {
  let t = text
  // one or more blockquote markers
  while (/^\s{0,3}>\s?/.test(t)) t = t.replace(/^\s{0,3}>\s?/, '')
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
  return t
}

// ── §12/§13/§16/§17 — document + section completeness ──────────────────────

export interface CompletenessHeadingFact {
  level: number
  text: string
}

export interface SectionCompletenessHint {
  headingIndex: number
  code: 'SECTION_EMPTY' | 'SECTION_ONLY_SUBHEADINGS'
  /** 0-based heading source line (the canonical locate target). */
  startLine: number
  /** 0-based exclusive end line of the section. */
  endLine: number
}

export interface DocumentCompletenessAnalysis {
  /** Number of canonical headings considered. */
  headingCount: number
  /** §12 — every heading source line resolved (no unverifiable verdict). */
  verifiable: boolean
  /**
   * §12/§15 — the WHOLE document carries no substantive body (the single
   * authority `hasSubstantiveNonHeadingContent` result, computed here for the
   * document level so the section rules can never re-derive their own).
   */
  bodyless: boolean
  /** §16/§17 — per-heading section hints (empty when unverifiable / bodyless). */
  sectionHints: SectionCompletenessHint[]
}

/** ATX candidates (fence-aware) with their canonical "level:normalizedText" key. */
function scanAtxCandidates(lines: readonly SourceLine[]): Array<{ line: number; key: string }> {
  const out: Array<{ line: number; key: string }> = []
  let inFence = false
  let fenceChar = ''
  for (const l of lines) {
    const fence = FENCE_RE.exec(l.text)
    if (fence) {
      const char = fence[1][0]
      if (!inFence) { inFence = true; fenceChar = char }
      else if (fenceChar === char) inFence = false
      continue
    }
    if (inFence) continue
    const m = ATX_RE.exec(l.text)
    if (!m) continue
    out.push({ line: l.index, key: `${m[1].length}:${normalizeCanonicalHeadingText(m[2] ?? '')}` })
  }
  return out
}

/**
 * §15/§16 — resolve the SOURCE LINE of every canonical heading, in document
 * order. Two authorities, exactly like the single-heading rule: the Typora
 * `data-line` stamp, then the ATX text-key safety net (in-order, each candidate
 * consumed once). Any unresolved heading ⇒ the whole verdict is unverifiable.
 */
export function resolveCanonicalHeadingLines(
  markdown: string,
  headings: readonly CompletenessHeadingFact[],
  elements: readonly (HTMLElement | null)[] = [],
): { lines: number[]; verifiable: boolean } {
  const lines = splitSourceLines(markdown)
  const candidates = scanAtxCandidates(lines)
  const used = new Set<number>()
  const resolved: number[] = []
  let cursor = 0
  let verifiable = true
  for (let i = 0; i < headings.length; i++) {
    const dl = elements[i]?.getAttribute?.('data-line') ?? null
    const fromStamp = dl != null && dl !== '' ? Number.parseInt(dl, 10) : Number.NaN
    if (Number.isInteger(fromStamp) && fromStamp >= 0 && !used.has(fromStamp)) {
      used.add(fromStamp)
      resolved.push(fromStamp)
      continue
    }
    const key = `${headings[i].level}:${normalizeCanonicalHeadingText(headings[i].text)}`
    let found = -1
    for (let c = cursor; c < candidates.length; c++) {
      if (used.has(candidates[c].line)) continue
      if (candidates[c].key !== key) continue
      found = candidates[c].line
      cursor = c + 1
      break
    }
    if (found < 0) { verifiable = false; resolved.push(-1); continue }
    used.add(found)
    resolved.push(found)
  }
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i] >= 0 && resolved[i - 1] >= 0 && resolved[i] <= resolved[i - 1]) verifiable = false
  }
  return { lines: resolved, verifiable }
}

/**
 * §12–§17 — the ONE document/section completeness analysis.
 *
 * `headerLines` are the source lines owned by canonical headings (already
 * computed by the caller with the SAME authority the single-heading rule uses);
 * they are excluded from every "is there body content" verdict.
 */
export function analyzeDocumentCompleteness(
  markdown: string | null | undefined,
  headings: readonly CompletenessHeadingFact[],
  elements: readonly (HTMLElement | null)[],
  headerLines: ReadonlySet<number>,
): DocumentCompletenessAnalysis {
  const headingCount = headings.length
  if (markdown == null || headingCount === 0) {
    return { headingCount, verifiable: false, bodyless: false, sectionHints: [] }
  }
  const lines = splitSourceLines(markdown)
  // §15 — document-level substantive body (blank + heading lines + a setext
  // underline directly beneath a heading are NOT body).
  let bodyless = true
  let previousWasHeading = false
  for (const l of lines) {
    if (isBlank(l.text)) { previousWasHeading = false; continue }
    if (headerLines.has(l.index)) { previousWasHeading = true; continue }
    if (previousWasHeading && SETEXT_UNDERLINE_RE.test(l.text)) { previousWasHeading = false; continue }
    bodyless = false
    break
  }

  const { lines: resolved, verifiable } = resolveCanonicalHeadingLines(markdown, headings, elements)
  if (!verifiable || bodyless) {
    return { headingCount, verifiable, bodyless, sectionHints: [] }
  }

  // §16/§17 — section boundaries: a section ends at the next heading whose
  // level is <= its own (or EOF). Any heading strictly inside that window is a
  // DESCENDANT by construction.
  const sectionHints: SectionCompletenessHint[] = []
  for (let i = 0; i < headingCount; i++) {
    const startLine = resolved[i]
    let endIdx = headingCount
    for (let j = i + 1; j < headingCount; j++) {
      if (headings[j].level <= headings[i].level) { endIdx = j; break }
    }
    const endLine = endIdx < headingCount ? resolved[endIdx] : lines.length
    const hasDescendant = endIdx > i + 1
    let hasBody = false
    for (let k = startLine + 1; k < endLine && k < lines.length; k++) {
      const text = lines[k].text
      if (isBlank(text)) continue
      if (headerLines.has(k)) continue
      hasBody = true
      break
    }
    if (hasBody) continue
    sectionHints.push({
      headingIndex: i,
      code: hasDescendant ? 'SECTION_ONLY_SUBHEADINGS' : 'SECTION_EMPTY',
      startLine,
      endLine,
    })
  }
  return { headingCount, verifiable, bodyless, sectionHints }
}

// ── §24 — manual number prefix ─────────────────────────────────────────────

export type ManualNumberPrefixFamily = 'arabic' | 'cjk-enum' | 'cjk-paren'

export interface ManualNumberPrefixMatch {
  family: ManualNumberPrefixFamily
  matched: string
}

/**
 * §24 — a STRICT manual-number prefix view of the ONE parser authority.
 *
 * The PARSER now lives in `document-diagnostics-heading-manual-number-prefix-v1`
 * (`resolveHeadingManualNumberPrefix`), which the Heading Auto-Number Conflict
 * rule also consumes — there is exactly ONE manual-number prefix authority
 * (`DUPLICATE_HEADING_MANUAL_NUMBER_PREFIX_AUTHORITY_COUNT=0`). This function is
 * the LEGACY, deliberately NARROWER view: it keeps the historical conservative
 * scope (arabic dotted / separated, CJK enum, CJK parenthesized) and never
 * widens to `roman` / `chapter-style`, so a rule that never fired before cannot
 * start firing.
 *
 * The §24 negative list can never match:
 *   `2026 年计划`  (no separator after the run)     `5G` / `3D` / `R2` (no digit start)
 *   `ISO 9001`     (no digit start)                `2026.10 发布` (4-digit first segment)
 *   `一对一` / `三分之一` (no separator)
 */
export function detectManualNumberPrefix(text: string | null | undefined): ManualNumberPrefixMatch | null {
  return detectLegacyManualNumberPrefix(text)
}

// ── §18/§19/§28 — source block spans ───────────────────────────────────────

export interface SourceBlockSpan {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  sourceStart: number
  sourceEnd: number
  /** The canonical raw text the locate resolver re-anchors against. */
  rawText: string
  containerKind: SourceContainerKind
}

/** §18 — a GFM table whose header/delimiter row carries a list/blockquote marker. */
export function analyzeTableBlocks(markdown: string | null | undefined): SourceBlockSpan[] {
  if (markdown == null) return []
  const lines = splitSourceLines(markdown)
  const out: SourceBlockSpan[] = []
  const isDelimiter = (t: string): boolean => {
    const s = stripContainerMarker(t).trim()
    if (!s.includes('|')) return false
    if (!/-/.test(s)) return false
    return /^\|?[\s:|-]+\|?$/.test(s) && /\|/.test(s)
  }
  for (let i = 0; i < lines.length; i++) {
    if (!isDelimiter(lines[i].text)) continue
    // The header row is the nearest preceding line with a pipe.
    let header = -1
    for (let j = i - 1; j >= 0; j--) {
      if (isBlank(lines[j].text)) break
      if (stripContainerMarker(lines[j].text).includes('|')) { header = j; break }
      break
    }
    if (header < 0) continue
    const marker = sourceContainerKindOfLine(lines[header].text) ?? sourceContainerKindOfLine(lines[i].text)
    if (marker == null) continue
    let end = i
    while (
      end + 1 < lines.length
      && !isBlank(lines[end + 1].text)
      && stripContainerMarker(lines[end + 1].text).includes('|')
    ) end++
    out.push({
      startLine: header,
      endLine: end,
      startColumn: 0,
      endColumn: lines[end].text.length,
      sourceStart: lines[header].start,
      sourceEnd: lines[end].end,
      rawText: lines[header].text,
      containerKind: marker,
    })
  }
  return out
}

export interface DisplayFormulaSpan extends SourceBlockSpan {
  /** §20 — the formula body is empty (whitespace only). */
  empty: boolean
}

/** §19/§20 — `$$` DISPLAY formula blocks (inline `$…$` is never considered). */
export function analyzeDisplayFormulaBlocks(markdown: string | null | undefined): DisplayFormulaSpan[] {
  if (markdown == null) return []
  const lines = splitSourceLines(markdown)
  const out: DisplayFormulaSpan[] = []
  let inFence = false
  let fenceChar = ''
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text
    const fence = FENCE_RE.exec(t)
    if (fence) {
      const char = fence[1][0]
      if (!inFence) { inFence = true; fenceChar = char }
      else if (fenceChar === char) inFence = false
      continue
    }
    if (inFence) continue
    // An escaped `\$$` is literal text, never a delimiter.
    const openIdx = findUnescapedDoubleDollar(t, 0)
    if (openIdx < 0) continue
    const closeIdx = findUnescapedDoubleDollar(t, openIdx + 2)
    let end = i
    let empty: boolean
    if (closeIdx >= 0) {
      empty = t.slice(openIdx + 2, closeIdx).trim() === ''
    } else {
      let body = t.slice(openIdx + 2)
      end = i
      let closed = false
      for (let j = i + 1; j < lines.length; j++) {
        const cIdx = findUnescapedDoubleDollar(lines[j].text, 0)
        if (cIdx >= 0) { body += '\n' + lines[j].text.slice(0, cIdx); end = j; closed = true; break }
        body += '\n' + lines[j].text
        end = j
      }
      if (!closed) continue // unclosed `$$` is a different (fence-level) concern
      empty = body.trim() === ''
    }
    out.push({
      startLine: i,
      endLine: end,
      startColumn: openIdx,
      endColumn: lines[end].text.length,
      sourceStart: lines[i].start + openIdx,
      sourceEnd: lines[end].end,
      rawText: lines[i].text,
      containerKind: sourceContainerKindOfLine(t),
      empty,
    })
    i = end
  }
  return out
}

function findUnescapedDoubleDollar(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    if (text[i] !== '$' || text[i + 1] !== '$') continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++
    if (backslashes % 2 === 1) continue
    return i
  }
  return -1
}

export interface EmptySourceObjects {
  codeBlocks: SourceBlockSpan[]
  tables: SourceBlockSpan[]
  formulas: SourceBlockSpan[]
  blockquotes: SourceBlockSpan[]
}

/** §28 — empty code block / table body / display formula / blockquote. */
export function analyzeEmptySourceObjects(markdown: string | null | undefined): EmptySourceObjects {
  const empty: EmptySourceObjects = { codeBlocks: [], tables: [], formulas: [], blockquotes: [] }
  if (markdown == null) return empty
  const lines = splitSourceLines(markdown)

  // Code — a fenced block with no non-blank line inside.
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE_RE.exec(lines[i].text)
    if (!fence) continue
    const char = fence[1][0]
    let end = lines.length - 1
    for (let j = i + 1; j < lines.length; j++) {
      const close = FENCE_RE.exec(lines[j].text)
      if (close && close[1][0] === char) { end = j; break }
    }
    let hasContent = false
    for (let k = i + 1; k < end; k++) {
      if (!isBlank(lines[k].text)) { hasContent = true; break }
    }
    if (!hasContent) {
      empty.codeBlocks.push({
        startLine: i, endLine: end, startColumn: 0, endColumn: lines[end].text.length,
        sourceStart: lines[i].start, sourceEnd: lines[end].end, rawText: lines[i].text, containerKind: sourceContainerKindOfLine(lines[i].text),
      })
    }
    i = end
  }

  // Table — header + delimiter with ZERO body rows.
  const isDelimiter = (t: string): boolean => {
    const s = stripContainerMarker(t).trim()
    return s.includes('|') && /-/.test(s) && /^\|?[\s:|-]+\|?$/.test(s)
  }
  for (let i = 0; i < lines.length; i++) {
    if (!isDelimiter(lines[i].text)) continue
    let header = -1
    for (let j = i - 1; j >= 0; j--) {
      if (isBlank(lines[j].text)) break
      if (stripContainerMarker(lines[j].text).includes('|')) { header = j; break }
      break
    }
    if (header < 0) continue
    let bodyRows = 0
    let end = i
    for (let j = i + 1; j < lines.length; j++) {
      if (isBlank(lines[j].text) || !stripContainerMarker(lines[j].text).includes('|')) break
      bodyRows++
      end = j
    }
    if (bodyRows === 0) {
      empty.tables.push({
        startLine: header, endLine: end, startColumn: 0, endColumn: lines[end].text.length,
        sourceStart: lines[header].start, sourceEnd: lines[end].end, rawText: lines[header].text, containerKind: sourceContainerKindOfLine(lines[header].text),
      })
    }
    i = end
  }

  // Formula — the `$$` display block with an empty body.
  for (const f of analyzeDisplayFormulaBlocks(markdown)) {
    if (f.empty) empty.formulas.push({ ...f })
  }

  // Blockquote — `>` with nothing after it.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s{0,3}>\s*$/.test(lines[i].text)) continue
    let end = i
    while (end + 1 < lines.length && /^\s{0,3}>\s*$/.test(lines[end + 1].text)) end++
    empty.blockquotes.push({
      startLine: i, endLine: end, startColumn: 0, endColumn: lines[end].text.length,
      sourceStart: lines[i].start, sourceEnd: lines[end].end, rawText: lines[i].text, containerKind: 'blockquote',
    })
    i = end
  }
  return empty
}

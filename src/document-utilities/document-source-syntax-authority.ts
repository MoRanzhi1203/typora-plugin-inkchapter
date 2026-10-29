/**
 * TRAE V3 §7.1 — `DocumentSourceSyntaxAuthority`.
 *
 * THE ONE stateful, single-pass Markdown SOURCE structure parser. It models:
 *
 *   Front Matter      — only a legal opener at the DOCUMENT START (`---`).
 *   Code Fence        — ``` / ~~~ with char + opening length + closing length.
 *   Formula Block     — a `$$` display block (never an inline `$…$`).
 *   Protected Ranges  — front matter / code fence / formula / literal code
 *                       (inline + indented), so NOTHING inside them can be
 *                       mis-detected as `$$` / footnote / reference link /
 *                       table / inline link by a downstream parser.
 *
 * It also owns the Source Table STRUCTURE authority (`parseDocumentSourceTables`)
 * so table-header integrity is NEVER guessed from Typora's normalized DOM.
 *
 * GUARANTEE: for ONE `documentKey` + `sourceRevision` the whole document is
 * parsed AT MOST ONCE (`getDocumentSourceSyntaxSnapshot`). Every rule consumes
 * the returned snapshot — no rule re-scans the whole document.
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import { computeMarkdownLiteralRanges, isSourceRangeLiteral } from './document-markdown-literal-exclusion-v1'

// ── §7.1 — the snapshot model ──────────────────────────────

export interface SourceRange {
  /** Absolute offset of the first character (inclusive). */
  start: number
  /** Absolute offset AFTER the last character (exclusive). */
  end: number
  startLine: number
  endLine: number
}

export type SourceFenceKind = 'backtick' | 'tilde'

export interface CodeFenceSourceBlock {
  kind: 'code-fence'
  fenceKind: SourceFenceKind
  fenceChar: '`' | '~'
  /** Opening fence run length (3+). */
  fenceLength: number
  infoString: string
  /** 0-based opening line index. */
  openLine: number
  openStart: number
  openEnd: number
  /** 0-based closing line index, null when unclosed. */
  closeLine: number | null
  closed: boolean
  /** Opener → closing line (or EOF when unclosed) — the protected range. */
  protectedRange: SourceRange
  /** `fence:<kind>:<openStart>` — the canonical opener identity (never a line). */
  openerIdentity: string
}

export interface FormulaSourceBlock {
  kind: 'formula-block'
  openLine: number
  openStart: number
  closeLine: number | null
  closed: boolean
  empty: boolean
  protectedRange: SourceRange
  /** `formula:<openStart>` — the canonical opener identity. */
  openerIdentity: string
}

export interface FrontMatterSourceState {
  closed: boolean
  openLine: number
  closeLine: number | null
  protectedRange: SourceRange
  /** `frontmatter:<openStart>` — the canonical identity. */
  identity: string
  /** Raw body between the delimiters (without the delimiters). */
  body: string
  /**
   * §4.2 — a canonical YAML validator is REQUIRED to decide malformed front
   * matter; the repo has none, so this is always DEFERRED_BY_SPEC.
   */
  malformedVerdict: 'DEFERRED_BY_SPEC'
}

export interface SourceSyntaxSnapshot {
  protectedRanges: SourceRange[]
  codeFences: CodeFenceSourceBlock[]
  formulaBlocks: FormulaSourceBlock[]
  frontMatter: FrontMatterSourceState | null
  sourceRevision: string
}

/** §7.1 — a 0-based source line with absolute offsets (CR stripped from text). */
export interface SourceLineSpan {
  index: number
  text: string
  start: number
  /** Offset AFTER the line break (exclusive). */
  end: number
  /** Offset of the line content end (excludes CR / line break). */
  contentEnd: number
  blank: boolean
}

export function buildSourceLineSpans(markdown: string): SourceLineSpan[] {
  const lines: SourceLineSpan[] = []
  let start = 0
  let index = 0
  for (let i = 0; i < markdown.length; i++) {
    if (markdown.charCodeAt(i) !== 10) continue
    let contentEnd = i
    if (contentEnd > start && markdown.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1
    const text = markdown.slice(start, contentEnd)
    lines.push({ index, start, end: i + 1, contentEnd, text, blank: text.trim() === '' })
    start = i + 1
    index++
  }
  const text = markdown.slice(start)
  lines.push({ index, start, end: markdown.length, contentEnd: markdown.length, text, blank: text.trim() === '' })
  return lines
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FRONT_MATTER_OPEN_RE = /^---[ \t]*$/
const FRONT_MATTER_CLOSE_RE = /^(?:---|\.\.\.)[ \t]*$/

/** True when the character at `index` is escaped by an odd backslash run. */
function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

/** The offset of the next unescaped `$$` at/after `from`, or -1. */
function findUnescapedDoubleDollar(text: string, from: number): number {
  for (let i = Math.max(0, from); i < text.length - 1; i++) {
    if (text[i] !== '$' || text[i + 1] !== '$') continue
    if (isEscapedAt(text, i)) continue
    return i
  }
  return -1
}

function rangeOf(lines: readonly SourceLineSpan[], startLine: number, endLine: number): SourceRange {
  const first = lines[startLine]
  const last = lines[endLine] ?? lines[lines.length - 1]
  return { start: first.start, end: last.end, startLine, endLine }
}

/**
 * §1.1/§8 — a STATEFUL code-fence scan. A fence opens with 3+ backticks /
 * tildes (≤3 leading spaces) and closes ONLY with a fence of the SAME character
 * and at least the SAME length; an unclosed fence runs from the opener to EOF.
 * NEVER a "search for the next ```" heuristic.
 */
function scanCodeFences(lines: readonly SourceLineSpan[], skip: (offset: number) => boolean): CodeFenceSourceBlock[] {
  const out: CodeFenceSourceBlock[] = []
  let open: { fenceChar: '`' | '~'; fenceLength: number; openLine: number; openStart: number; openEnd: number; infoString: string } | null = null
  for (const line of lines) {
    if (open == null && skip(line.start)) continue
    const m = FENCE_RE.exec(line.text)
    if (open == null) {
      if (!m) continue
      const run = m[1]
      open = {
        fenceChar: run[0] as '`' | '~',
        fenceLength: run.length,
        openLine: line.index,
        openStart: line.start,
        openEnd: line.contentEnd,
        infoString: (m[2] ?? '').trim(),
      }
      continue
    }
    if (!m) continue
    const run = m[1]
    if (run[0] !== open.fenceChar || run.length < open.fenceLength) continue
    const endLine = line.index
    out.push({
      kind: 'code-fence',
      fenceKind: open.fenceChar === '`' ? 'backtick' : 'tilde',
      fenceChar: open.fenceChar,
      fenceLength: open.fenceLength,
      infoString: open.infoString,
      openLine: open.openLine,
      openStart: open.openStart,
      openEnd: open.openEnd,
      closeLine: endLine,
      closed: true,
      protectedRange: rangeOf(lines, open.openLine, endLine),
      openerIdentity: `fence:${open.fenceChar}:${open.openStart}`,
    })
    open = null
  }
  if (open != null) {
    const endLine = lines.length - 1
    out.push({
      kind: 'code-fence',
      fenceKind: open.fenceChar === '`' ? 'backtick' : 'tilde',
      fenceChar: open.fenceChar,
      fenceLength: open.fenceLength,
      infoString: open.infoString,
      openLine: open.openLine,
      openStart: open.openStart,
      openEnd: open.openEnd,
      closeLine: null,
      closed: false,
      protectedRange: rangeOf(lines, open.openLine, endLine),
      openerIdentity: `fence:${open.fenceChar}:${open.openStart}`,
    })
  }
  return out
}

/**
 * §1.2/§8 — a STATEFUL `$$` display-formula scan, run ONLY outside code fences
 * and front matter (Parser Precedence §8.1 → §8.2 → §8.3). A `$$` inside a code
 * fence can therefore never open a formula block.
 */
function scanFormulaBlocks(lines: readonly SourceLineSpan[], skip: (offset: number) => boolean): FormulaSourceBlock[] {
  const out: FormulaSourceBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (skip(line.start)) { i++; continue }
    const openIdx = findUnescapedDoubleDollar(line.text, 0)
    if (openIdx < 0) { i++; continue }
    const sameLineClose = findUnescapedDoubleDollar(line.text, openIdx + 2)
    if (sameLineClose >= 0) {
      const empty = line.text.slice(openIdx + 2, sameLineClose).trim() === ''
      out.push({
        kind: 'formula-block',
        openLine: line.index,
        openStart: line.start + openIdx,
        closeLine: line.index,
        closed: true,
        empty,
        protectedRange: rangeOf(lines, line.index, line.index),
        openerIdentity: `formula:${line.start + openIdx}`,
      })
      i++
      continue
    }
    let endLine = line.index
    let closed = false
    for (let j = i + 1; j < lines.length; j++) {
      if (skip(lines[j].start)) break
      endLine = lines[j].index
      if (findUnescapedDoubleDollar(lines[j].text, 0) >= 0) { closed = true; break }
    }
    out.push({
      kind: 'formula-block',
      openLine: line.index,
      openStart: line.start + openIdx,
      closeLine: closed ? endLine : null,
      closed,
      empty: false,
      protectedRange: rangeOf(lines, line.index, endLine),
      openerIdentity: `formula:${line.start + openIdx}`,
    })
    i = closed ? endLine + 1 : lines.length
  }
  return out
}

/** §4 — Front Matter is recognised ONLY at the document start. */
function scanFrontMatter(markdown: string, lines: readonly SourceLineSpan[]): FrontMatterSourceState | null {
  if (lines.length === 0) return null
  const first = lines[0]
  if (!FRONT_MATTER_OPEN_RE.test(first.text)) return null
  for (let j = 1; j < lines.length; j++) {
    if (!FRONT_MATTER_CLOSE_RE.test(lines[j].text)) continue
    const bodyStart = first.contentEnd
    const bodyEnd = lines[j].start
    return {
      closed: true,
      openLine: 0,
      closeLine: j,
      protectedRange: rangeOf(lines, 0, j),
      identity: `frontmatter:${first.start}`,
      body: markdown.slice(bodyStart, bodyEnd),
      malformedVerdict: 'DEFERRED_BY_SPEC',
    }
  }
  return {
    closed: false,
    openLine: 0,
    closeLine: null,
    protectedRange: rangeOf(lines, 0, lines.length - 1),
    identity: `frontmatter:${first.start}`,
    body: markdown.slice(first.contentEnd),
    malformedVerdict: 'DEFERRED_BY_SPEC',
  }
}

/** §8 — pure parse of the entire source syntax model (uncached). */
export function parseDocumentSourceSyntax(markdown: string, sourceRevision: string = ''): SourceSyntaxSnapshot {
  if (!markdown) {
    return { protectedRanges: [], codeFences: [], formulaBlocks: [], frontMatter: null, sourceRevision }
  }
  const lines = buildSourceLineSpans(markdown)
  const frontMatter = scanFrontMatter(markdown, lines)
  const inFrontMatter = frontMatter != null
    ? (offset: number): boolean => offset >= frontMatter.protectedRange.start && offset < frontMatter.protectedRange.end
    : (): boolean => false
  const codeFences = scanCodeFences(lines, inFrontMatter)
  const inFence = (offset: number): boolean =>
    codeFences.some(f => offset >= f.protectedRange.start && offset < f.protectedRange.end)
  const skipForFormula = (offset: number): boolean => inFrontMatter(offset) || inFence(offset)
  const formulaBlocks = scanFormulaBlocks(lines, skipForFormula)

  const literalRanges = computeMarkdownLiteralRanges(markdown)
  const protectedRanges: SourceRange[] = []
  if (frontMatter) protectedRanges.push(frontMatter.protectedRange)
  for (const f of codeFences) protectedRanges.push(f.protectedRange)
  for (const f of formulaBlocks) protectedRanges.push(f.protectedRange)
  for (const r of literalRanges) {
    // Inline / indented literal code — a source range with its own line span.
    const startLine = lineIndexOfOffset(lines, r.start)
    const endLine = lineIndexOfOffset(lines, Math.max(r.start, r.end - 1))
    protectedRanges.push({ start: r.start, end: r.end, startLine, endLine })
  }
  protectedRanges.sort((a, b) => a.start - b.start || a.end - b.end)
  return { protectedRanges, codeFences, formulaBlocks, frontMatter, sourceRevision }
}

export function lineIndexOfOffset(lines: readonly SourceLineSpan[], offset: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= offset) { ans = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return ans
}

/** True when `offset` sits inside ANY protected range (fence / formula / front matter / literal code). */
export function isOffsetProtected(snapshot: SourceSyntaxSnapshot | null, offset: number): boolean {
  if (!snapshot) return false
  return snapshot.protectedRanges.some(r => offset >= r.start && offset < r.end)
}

/** True when the `[start,end)` candidate OVERLAPS any protected range. */
export function isRangeProtected(snapshot: SourceSyntaxSnapshot | null, start: number, end: number): boolean {
  if (!snapshot) return false
  for (const r of snapshot.protectedRanges) {
    if (start < r.end && end > r.start) return true
  }
  return false
}

// ── §7 — parse-once (memoised per documentKey + sourceRevision) ─────────────

interface SyntaxCacheEntry {
  key: string
  markdown: string
  snapshot: SourceSyntaxSnapshot
}

const SYNTAX_CACHE_LIMIT = 8
const syntaxCache: SyntaxCacheEntry[] = []
let sourceSyntaxParseCount = 0

function syntaxCacheKey(documentKey: string | null, sourceRevision: number | null | undefined): string {
  return `${documentKey ?? ''}\u0000${sourceRevision ?? ''}`
}

/**
 * §14 — the ONE entry point every rule consumes. For a given
 * `documentKey` + `sourceRevision` the source is parsed AT MOST ONCE; a
 * different markdown under the same key re-parses (never a stale snapshot).
 */
export function getDocumentSourceSyntaxSnapshot(
  documentKey: string | null,
  markdown: string,
  sourceRevision: number | null | undefined,
): SourceSyntaxSnapshot {
  const key = syntaxCacheKey(documentKey, sourceRevision)
  const hit = syntaxCache.find(e => e.key === key && e.markdown === markdown)
  if (hit) return hit.snapshot
  const snapshot = parseDocumentSourceSyntax(markdown, String(sourceRevision ?? ''))
  sourceSyntaxParseCount++
  syntaxCache.unshift({ key, markdown, snapshot })
  while (syntaxCache.length > SYNTAX_CACHE_LIMIT) syntaxCache.pop()
  return snapshot
}

/** §14 — how many real parses ran (test / audit hook). */
export function getDocumentSourceSyntaxParseCount(): number {
  return sourceSyntaxParseCount
}

/** Test / audit hook — clear the memo cache and the parse counter. */
export function resetDocumentSourceSyntaxAuthority(): void {
  syntaxCache.length = 0
  sourceSyntaxParseCount = 0
}

// ── §5 — Source Table STRUCTURE authority ───────────────────────────────────

export interface SourceTableCell {
  /** Raw cell text (as written, trimmed). */
  raw: string
  /** Semantic text (markdown emphasis / code markers removed, whitespace collapsed). */
  semantic: string
  /** Absolute [start,end) offsets of the raw cell text. */
  start: number
  end: number
}

export interface SourceTableStructure {
  kind: 'table'
  /** 0-based header row line index. */
  headerLine: number
  /** 0-based delimiter row line index (headerLine + 1). */
  delimiterLine: number
  headerCells: SourceTableCell[]
  /** `table:<headerLine>:<headerStart>` — canonical table identity. */
  identity: string
}

const TABLE_DELIMITER_RE = /^\s*\|?[\s:|-]+\|?\s*$/

/** §5 — split one table row into cells (unescaped `|`), with absolute offsets. */
function splitTableRow(line: SourceLineSpan): SourceTableCell[] {
  const text = line.text
  const cells: SourceTableCell[] = []
  let cellStart = 0
  let sawPipe = false
  let i = 0
  const flush = (end: number): void => {
    const rawStart = cellStart
    const rawEnd = end
    let raw = text.slice(rawStart, rawEnd)
    let lead = raw.length - raw.trimStart().length
    let trimmed = raw.trim()
    cells.push({
      raw: trimmed,
      semantic: normalizeHeaderSemanticText(trimmed),
      start: line.start + rawStart + lead,
      end: line.start + rawStart + lead + trimmed.length,
    })
  }
  for (; i < text.length; i++) {
    if (text[i] !== '|' || isEscapedAt(text, i)) continue
    sawPipe = true
    flush(i)
    cellStart = i + 1
  }
  if (sawPipe) {
    // Trailing segment after the last pipe is only a cell when it is non-empty
    // (a closing boundary pipe produces an empty tail that GFM discards).
    const tail = text.slice(cellStart)
    if (tail.trim() !== '' || cells.length === 0) flush(text.length)
  } else {
    flush(text.length)
  }
  // GFM: a leading boundary pipe produces an empty first cell that is discarded.
  if (sawPipe && cells.length > 1 && cells[0].raw === '' && text.trimStart().startsWith('|')) cells.shift()
  return cells
}

/**
 * §5.2 — the ONE header semantic-text normalisation authority. It strips the
 * common inline Markdown formatting markers and collapses whitespace, so a rule
 * NEVER handles Markdown formatting itself.
 */
export function normalizeHeaderSemanticText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTableDelimiter(raw: string): boolean {
  const s = raw.trim()
  if (!s.includes('|')) return false
  if (!s.includes('-')) return false
  return TABLE_DELIMITER_RE.test(s)
}

/**
 * §5 — the Source Table Structure authority. A GFM table = a header row of `|`
 * cells immediately followed by a delimiter row. Detection runs on the SOURCE
 * only; a table inside a protected range (fence / formula / front matter) is
 * NEVER a candidate. NEVER reverse-engineered from Typora's `<th>` DOM.
 */
export function parseDocumentSourceTables(
  markdown: string,
  snapshot: SourceSyntaxSnapshot | null = null,
): SourceTableStructure[] {
  if (!markdown) return []
  const lines = buildSourceLineSpans(markdown)
  const out: SourceTableStructure[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]
    const delimiter = lines[i + 1]
    if (header.blank || !header.text.includes('|')) continue
    if (!isTableDelimiter(delimiter.text)) continue
    const headerTokenRange = { start: header.start, end: header.contentEnd }
    if (isRangeProtected(snapshot, headerTokenRange.start, headerTokenRange.end)) continue
    if (isRangeProtected(snapshot, delimiter.start, delimiter.contentEnd)) continue
    const headerCells = splitTableRow(header)
    if (headerCells.length === 0) continue
    out.push({
      kind: 'table',
      headerLine: header.index,
      delimiterLine: delimiter.index,
      headerCells,
      identity: `table:${header.start}`,
    })
  }
  return out
}

/** Re-export the literal-overlap helper so consumers use ONE exclusion rule. */
export const isSourceRangeLiteralRange = isSourceRangeLiteral

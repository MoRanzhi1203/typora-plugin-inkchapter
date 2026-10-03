/**
 * Document Diagnostics — INTERNAL BLANK-LINE POLICY V1
 * (`EXCESSIVE_INTERNAL_BLANK_LINES`).
 *
 * The product semantics are fixed:
 *
 *   文档内部两个有效内容块之间
 *   0~2 个连续空行 → PASS
 *   3 个及以上连续空行 → Warning
 *
 * This module is the ONE authority for
 *
 *   1. `INTERNAL_BLANK_LINE_POLICY` — the threshold constants. NO producer /
 *      locator / test may hardcode `2` or `3` independently.
 *   2. `DocumentBlockGap` — the source-only BLOCK GAP model: every gap is
 *      proven from the canonical Markdown SOURCE (line map + block ownership),
 *      NEVER from DOM margins / computed style / visual whitespace height.
 *   3. `analyzeInternalBlankLineGaps` — the pure analyzer behind the single
 *      business rule `EXCESSIVE_INTERNAL_BLANK_LINES`.
 *
 * Separation contract (never merges):
 *   - `DOCUMENT_TERMINAL_NEWLINE_MISSING` / `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE`
 *     own the EOF (after the LAST content block);
 *   - this rule owns ONLY the gaps BETWEEN two content blocks;
 *   - leading blank lines (before the FIRST content block) belong to neither.
 *
 * Exclusion contract: blank lines INSIDE a fenced code block, a display
 * formula, YAML front matter or an HTML block are content — never a gap.
 * A blank run inside ONE list / blockquote container is a loose-list / lazy
 * quote formatting choice, not a sibling block gap (§15).
 */
import { normalizeCanonicalHeadingText } from './latent-atx-heading-marker'

// ── §3 — the ONE threshold authority ────────────────────────────────────────

export interface InternalBlankLinePolicy {
  /** 0..passMaxBlankLines consecutive blank lines are legal inside the body. */
  passMaxBlankLines: number
  /** `warningThreshold` (and above) consecutive blank lines are a Warning. */
  warningThreshold: number
}

/**
 * §3/§32 — the SINGLE threshold authority. `passMaxBlankLines` and
 * `warningThreshold` are adjacent by construction (`warning = pass + 1`), so a
 * document can never fall into an undefined band.
 */
export const INTERNAL_BLANK_LINE_POLICY: InternalBlankLinePolicy = {
  passMaxBlankLines: 2,
  warningThreshold: 3,
}

/** §9 — the rule code (the ONLY business rule for internal blank-line gaps). */
export const EXCESSIVE_INTERNAL_BLANK_LINES_CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'

/** §9 — the machine ruleId carried in the diagnostic metadata. */
export const EXCESSIVE_INTERNAL_BLANK_LINES_RULE_ID = 'EXCESSIVE-INTERNAL-BLANK-LINES'

/** §33 — the source audit event. */
export const DOCUMENT_INTERNAL_BLANK_LINE_AUDIT_EVENT = 'DOCUMENT-INTERNAL-BLANK-LINE-AUDIT'

/** §34 — the runtime UI audit event. */
export const DOCUMENT_INTERNAL_BLANK_LINE_RUNTIME_AUDIT_EVENT = 'DOCUMENT-INTERNAL-BLANK-LINE-RUNTIME-AUDIT'

// ── §7 — the DocumentBlockGap model ────────────────────────────────────────

/** §7/§8 — the canonical kind of a content block taking part in a gap. */
export type DocumentBlockKind =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'formula'
  | 'table'
  | 'list'
  | 'blockquote'
  | 'html'
  | 'front-matter'
  | 'thematic-break'

/**
 * §7/§33 — ONE proven gap between two sibling content blocks. Every field is
 * derived from the canonical source line map (never from the DOM).
 */
export interface DocumentBlockGap {
  previousBlockIdentity: string
  previousBlockKind: DocumentBlockKind
  /** 0-based source line of the previous block's first content line. */
  previousBlockStartLine: number
  nextBlockIdentity: string
  nextBlockKind: DocumentBlockKind
  /** 0-based source line of the next block's first content line. */
  nextBlockStartLine: number
  previousBlockSourceEnd: number
  nextBlockSourceStart: number
  /** 0-based index of the FIRST blank line of the run. */
  firstBlankLine: number
  /** 0-based index of the LAST blank line of the run. */
  lastBlankLine: number
  actualBlankLines: number
  /**
   * §22/§23 — the ANCHOR of the diagnostic. The blank area owns no DOM node, so
   * the anchor is the NEXT block's first content line (its visible text is what
   * the locate resolver verifies against the live block).
   */
  nextBlockAnchorText: string
}

// ── source line map ────────────────────────────────────────────────────────

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
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const BLOCKQUOTE_RE = /^ {0,3}>/
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/
const HTML_OPEN_RE = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)(?:\s|\/?>|$)/
const FRONT_MATTER_DELIM_RE = /^(?:---|\+\+\+|\.\.\.)[ \t]*$/

const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu',
  'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'source',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
  'script', 'style', 'pre', 'canvas', 'video', 'audio', 'math', 'noscript', 'template', 'svg',
])

interface ProtectedRegion {
  kind: 'code' | 'formula' | 'front-matter' | 'html'
}

/** §14 — void HTML tags never open a multi-line HTML block. */
const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

interface LineClassification {
  /** Blank line (whitespace-only) — §5. */
  blank: boolean
  /** Non-null when the line sits INSIDE a protected region (its blanks are content). */
  protectedRegion: ProtectedRegion | null
  /** Container marker literally carried by the line / inherited by continuation. */
  container: 'list-item' | 'blockquote' | null
  /** True when the line STARTS a new content block. */
  blockStart: boolean
  /** True when the line ENDS a content block (so a following blank run is a gap). */
  blockEnd: boolean
  kind: DocumentBlockKind
}

function isBlank(text: string): boolean {
  return text.trim() === ''
}

function normalizeIdentityText(text: string): string {
  return normalizeCanonicalHeadingText(text).replace(/\s+/g, ' ').trim()
}

function sourceContainerKind(text: string): 'list-item' | 'blockquote' | null {
  if (BLOCKQUOTE_RE.test(text)) return 'blockquote'
  if (LIST_ITEM_RE.test(text)) return 'list-item'
  return null
}

function leadingSpaces(text: string): number {
  const m = /^[ ]*/.exec(text)
  return m ? m[0].length : 0
}

/**
 * §4/§5/§6 — build the per-line classification from the canonical source ONLY.
 *
 * Protected regions are computed BEFORE gap scanning so a blank line inside a
 * fenced code block / display formula / front matter / HTML block can never be
 * mistaken for a sibling gap. Only the region INTERIOR is protected: the
 * opening / closing delimiter lines stay ordinary content, so a real gap
 * directly after such a block is still reported.
 */
function classifyLines(markdown: string): { lines: SourceLine[]; classOf: LineClassification[] } {
  const lines = splitSourceLines(markdown)
  const n = lines.length
  const classOf: LineClassification[] = lines.map(l => ({
    blank: isBlank(l.text),
    protectedRegion: null,
    container: null,
    blockStart: false,
    blockEnd: false,
    kind: 'paragraph',
  }))
  const protectedOf: (ProtectedRegion | null)[] = new Array(n).fill(null)

  // ── front matter: only when the file OPENS with a delimiter (YAML / TOML) ──
  let scanFrom = 0
  if (n > 0 && FRONT_MATTER_DELIM_RE.test(lines[0].text)) {
    for (let j = 1; j < n; j++) {
      if (FRONT_MATTER_DELIM_RE.test(lines[j].text)) {
        for (let k = 1; k < j; k++) protectedOf[k] = { kind: 'front-matter' }
        for (let k = 0; k <= j; k++) if (classOf[k].kind === 'paragraph') classOf[k].kind = 'front-matter'
        classOf[0].blockStart = true
        classOf[j].blockEnd = true
        scanFrom = j + 1
        break
      }
    }
  }

  let i = scanFrom
  while (i < n) {
    const line = lines[i]
    if (isBlank(line.text)) { i++; continue }

    // ── fenced code block ──────────────────────────────────────────────────
    const fence = FENCE_RE.exec(line.text)
    if (fence) {
      const char = fence[1][0]
      const openLen = fence[1].length
      let close = -1
      for (let j = i + 1; j < n; j++) {
        const m = FENCE_RE.exec(lines[j].text)
        if (m && m[1][0] === char && m[1].length >= openLen) { close = j; break }
      }
      const end = close >= 0 ? close : n - 1
      for (let k = i + 1; k < (close >= 0 ? close : n); k++) protectedOf[k] = { kind: 'code' }
      for (let k = i; k <= end; k++) classOf[k].kind = 'code'
      classOf[i].blockStart = true
      classOf[end].blockEnd = true
      i = end + 1
      continue
    }

    // ── display formula (`$$` … `$$`) — inline `$…$` is never a block ──────
    const dollar = findUnescapedDoubleDollar(line.text, 0)
    if (dollar >= 0) {
      const sameLineClose = findUnescapedDoubleDollar(line.text, dollar + 2)
      let close = -1
      if (sameLineClose < 0) {
        for (let j = i + 1; j < n; j++) {
          if (findUnescapedDoubleDollar(lines[j].text, 0) >= 0) { close = j; break }
        }
      }
      const end = sameLineClose >= 0 ? i : (close >= 0 ? close : n - 1)
      for (let k = i; k <= end; k++) classOf[k].kind = 'formula'
      if (sameLineClose < 0 && close >= 0) {
        for (let k = i + 1; k < close; k++) protectedOf[k] = { kind: 'formula' }
      } else if (sameLineClose < 0) {
        for (let k = i + 1; k <= end; k++) protectedOf[k] = { kind: 'formula' }
      }
      classOf[i].blockStart = true
      classOf[end].blockEnd = true
      i = end + 1
      continue
    }

    // ── block-level HTML ───────────────────────────────────────────────────
    const htmlOpen = HTML_OPEN_RE.exec(line.text)
    if (htmlOpen && HTML_BLOCK_TAGS.has(htmlOpen[1].toLowerCase())) {
      const tag = htmlOpen[1].toLowerCase()
      // §14 — a blank line INSIDE an HTML block is CONTENT, never a gap. The
      // block therefore extends to its MATCHING close tag when one exists in the
      // document; a void / self-closing tag (or a block without a close tag)
      // falls back to the CommonMark "type 6" rule (ends at a blank line).
      const voidTag = VOID_HTML_TAGS.has(tag) || /\/>[ \t]*$/.test(line.text)
      let close = -1
      if (!voidTag) {
        const closeRe = new RegExp(`</${tag}[ \\t]*>`, 'i')
        for (let j = i; j < n; j++) {
          if (closeRe.test(lines[j].text)) { close = j; break }
        }
      }
      if (close < 0 && !voidTag) {
        for (let j = i + 1; j < n; j++) {
          if (isBlank(lines[j].text)) break
          close = j
        }
      }
      const end = close >= 0 ? close : i
      for (let k = i; k <= end; k++) classOf[k].kind = 'html'
      for (let k = i + 1; k < end; k++) protectedOf[k] = { kind: 'html' }
      classOf[i].blockStart = true
      classOf[end].blockEnd = true
      i = end + 1
      continue
    }

    // ── ATX heading ────────────────────────────────────────────────────────
    if (ATX_RE.test(line.text)) {
      classOf[i].kind = 'heading'
      classOf[i].blockStart = true
      classOf[i].blockEnd = true
      i++
      continue
    }

    // ── thematic break ─────────────────────────────────────────────────────
    if (THEMATIC_BREAK_RE.test(line.text)) {
      classOf[i].kind = 'thematic-break'
      classOf[i].blockStart = true
      classOf[i].blockEnd = true
      i++
      continue
    }

    // ── blockquote / list run ──────────────────────────────────────────────
    const marker = sourceContainerKind(line.text)
    if (marker != null) {
      const kind: DocumentBlockKind = marker === 'blockquote' ? 'blockquote' : 'list'
      let j = i
      while (j < n) {
        const t = lines[j].text
        if (isBlank(t)) {
          // A blank line only ends the container when the next non-blank line
          // leaves the container (a loose list / lazy quote keeps it open).
          let k = j
          while (k < n && isBlank(lines[k].text)) k++
          if (k >= n) break
          const nextMarker = sourceContainerKind(lines[k].text)
          const continued = nextMarker === marker || leadingSpaces(lines[k].text) > 0
          if (!continued) break
          j = k
          continue
        }
        const curMarker = sourceContainerKind(t)
        const indented = leadingSpaces(t) > 0
        if (curMarker === marker || indented) { j++; continue }
        break
      }
      const end = j - 1
      for (let k = i; k <= end; k++) {
        if (classOf[k].kind !== 'paragraph') continue
        classOf[k].kind = kind
        classOf[k].container = sourceContainerKind(lines[k].text) ?? marker
      }
      classOf[i].blockStart = true
      classOf[end].blockEnd = true
      i = end + 1
      continue
    }

    // ── table (header + delimiter + body rows) ─────────────────────────────
    if (i + 1 < n && isTableDelimiter(lines[i + 1].text) && lines[i].text.includes('|')) {
      let j = i + 1
      while (j + 1 < n && !isBlank(lines[j + 1].text) && lines[j + 1].text.includes('|')) j++
      for (let k = i; k <= j; k++) classOf[k].kind = 'table'
      classOf[i].blockStart = true
      classOf[j].blockEnd = true
      i = j + 1
      continue
    }

    // ── paragraph (with lazy continuation lines) ───────────────────────────
    {
      let j = i
      while (j < n) {
        const t = lines[j].text
        if (isBlank(t)) break
        if (j > i) {
          if (ATX_RE.test(t) || FENCE_RE.test(t) || THEMATIC_BREAK_RE.test(t)) break
          if (sourceContainerKind(t) != null) break
          if (findUnescapedDoubleDollar(t, 0) >= 0 && leadingSpaces(t) === 0) break
          if (i + 1 < n && isTableDelimiter(t) && lines[j - 1].text.includes('|')) break
        }
        j++
      }
      const end = j - 1
      for (let k = i; k <= end; k++) classOf[k].kind = 'paragraph'
      classOf[i].blockStart = true
      classOf[end].blockEnd = true
      i = end + 1
      continue
    }
  }

  // Indented continuation lines inherit the container of the previous content
  // line (a lazy list-item continuation), so a following gap is compared against
  // the container, not against a bare paragraph.
  let previousContainer: 'list-item' | 'blockquote' | null = null
  for (let k = 0; k < n; k++) {
    const c = classOf[k]
    if (protectedOf[k] != null) c.protectedRegion = protectedOf[k]
    if (c.blank) continue
    if (c.container == null && leadingSpaces(lines[k].text) > 0 && previousContainer != null && c.kind === 'paragraph') {
      c.container = previousContainer
    }
    previousContainer = c.container
  }
  return { lines, classOf }
}

function isTableDelimiter(text: string): boolean {
  const s = text.trim()
  if (!s.includes('|')) return false
  if (!/-/.test(s)) return false
  return /^\|?[\s:|-]+\|?$/.test(s)
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

/** §22/§23 — the NEXT block's visible anchor text (what the DOM must match). */
function nextBlockAnchorText(
  kind: DocumentBlockKind,
  lines: readonly SourceLine[],
  startLine: number,
  endLine: number,
): string {
  const slice = lines.slice(startLine, endLine + 1).filter(l => !isBlank(l.text))
  const joined = slice.map(l => l.text).join('\n')
  switch (kind) {
    case 'heading': {
      const first = lines[startLine]?.text ?? ''
      const m = ATX_RE.exec(first)
      return normalizeIdentityText(m ? (m[2] ?? '') : first.replace(/^\s{0,3}#{1,6}\s*/, ''))
    }
    case 'blockquote':
      return normalizeIdentityText(slice.map(l => l.text.replace(/^ {0,3}>[ \t]?/, '')).join('\n'))
    case 'list':
      // Typora stamps `data-line` on the FIRST list item container.
      return normalizeIdentityText((slice[0]?.text ?? '').replace(LIST_ITEM_RE, ''))
    case 'code':
      return normalizeIdentityText(joined)
    case 'formula':
      return normalizeIdentityText(joined.replace(/\$\$/g, ''))
    default:
      return normalizeIdentityText(joined)
  }
}

/**
 * §7/§8/§10/§11/§12/§13/§14/§15 — the ONE source-only BLOCK GAP analyzer.
 *
 * Returns every gap (>= 1 blank line) between two sibling content blocks, in
 * document order. EOF / leading blank runs are structurally excluded here (the
 * EOF rules own the former; this rule owns neither).
 */
export function collectDocumentBlockGaps(markdown: string | null | undefined): DocumentBlockGap[] {
  if (markdown == null) return []
  const { lines, classOf } = classifyLines(markdown)
  const n = lines.length
  if (n === 0) return []

  // Block extents: maximal non-blank content runs separated by GAP runs.
  const runs: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < n) {
    if (classOf[i].blank) { i++; continue }
    const start = i
    while (i < n && !classOf[i].blank) i++
    runs.push({ start, end: i - 1 })
  }

  // §20 — the identity ordinal: the Nth block (document order) sharing the same
  // (kind, normalized first-line text). Text-based, so inserting / removing
  // BLANK LINES never changes a block's identity (Hard Gate
  // INTERNAL_BLANK_LINE_UNSTABLE_IDENTITY_COUNT / EDIT_DUPLICATE).
  const ordinalByKey = new Map<string, number>()
  const identityOfRun = (run: { start: number; end: number }): { identity: string; kind: DocumentBlockKind; anchor: string } => {
    const kind = classOf[run.start].kind
    const keyText = normalizeIdentityText(lines[run.start].text)
    const key = `${kind}:${keyText}`
    const ordinal = ordinalByKey.get(key) ?? 0
    ordinalByKey.set(key, ordinal + 1)
    return {
      identity: `${key}#${ordinal}`,
      kind,
      anchor: nextBlockAnchorText(kind, lines, run.start, run.end),
    }
  }

  const gaps: DocumentBlockGap[] = []
  let runIdx = 0
  let cursor = 0
  // Pre-compute identities in DOCUMENT ORDER so the ordinal is deterministic.
  const runIdentities = runs.map(r => identityOfRun(r))

  while (cursor < n) {
    if (!classOf[cursor].blank) { cursor++; continue }
    const runStart = cursor
    while (cursor < n && classOf[cursor].blank) cursor++
    const runEnd = cursor - 1
    const before = runStart - 1
    const after = cursor
    // §11 — leading blank lines (no previous content block) are never internal.
    // §10 — trailing blank lines (no next content block) belong to the EOF rules.
    if (before < 0 || after >= n) continue
    const prevClass = classOf[before]
    const nextClass = classOf[after]
    // §7 — a gap is BETWEEN two blocks: the left line must END a block and the
    // right line must START one. A blank run INSIDE a block (code fence body,
    // display formula, front matter, HTML block, multi-line paragraph, table)
    // therefore never qualifies.
    if (!prevClass.blockEnd || !nextClass.blockStart) continue
    // §12/§13/§14 — a blank line inside a protected region is CONTENT.
    if (prevClass.protectedRegion != null || nextClass.protectedRegion != null) continue
    // §15 — one list / blockquote container spanning the blank run is a loose
    // list / lazy quote, not a sibling gap.
    if (prevClass.container != null && prevClass.container === nextClass.container) continue

    while (runIdx < runs.length && runs[runIdx].end < before) runIdx++
    const prevRun = runs[runIdx]
    const nextRun = runs[runIdx + 1]
    if (!prevRun || !nextRun || prevRun.end !== before || nextRun.start !== after) continue
    gaps.push({
      previousBlockIdentity: runIdentities[runIdx].identity,
      previousBlockKind: runIdentities[runIdx].kind,
      previousBlockStartLine: prevRun.start,
      nextBlockIdentity: runIdentities[runIdx + 1].identity,
      nextBlockKind: runIdentities[runIdx + 1].kind,
      nextBlockStartLine: nextRun.start,
      previousBlockSourceEnd: lines[before].end,
      nextBlockSourceStart: lines[after].start,
      firstBlankLine: runStart,
      lastBlankLine: runEnd,
      actualBlankLines: runEnd - runStart + 1,
      nextBlockAnchorText: runIdentities[runIdx + 1].anchor,
    })
  }
  return gaps
}

/**
 * §32 — the fixed threshold contract, expressed ONLY through the policy
 * authority:
 *
 *   0/1/2 → no diagnostic      3/4/5/… → Warning
 */
export function isExcessiveInternalBlankRun(
  actualBlankLines: number,
  policy: InternalBlankLinePolicy = INTERNAL_BLANK_LINE_POLICY,
): boolean {
  return actualBlankLines >= policy.warningThreshold
}

/**
 * §6/§9/§32 — the analyzable gaps of ONE document: every sibling gap whose run
 * is at or above `warningThreshold`. ONE gap → ONE entry (never one per blank
 * line).
 */
export function analyzeInternalBlankLineGaps(markdown: string | null | undefined): DocumentBlockGap[] {
  return collectDocumentBlockGaps(markdown).filter(g => isExcessiveInternalBlankRun(g.actualBlankLines))
}

/** §20/§29 — the stable diagnostic identity of ONE gap. */
export function internalBlankGapIdentity(gap: DocumentBlockGap): string {
  return `blank-gap:${gap.previousBlockIdentity}>>${gap.nextBlockIdentity}`
}

/**
 * §12/§13/§14 — the protected source region containing ONE line, or null. The
 * runtime gate uses this to prove that no reported gap run sits inside a fenced
 * code block / display formula / front matter / HTML block.
 */
export function protectedRegionKindAtLine(
  markdown: string | null | undefined,
  line: number,
): 'code' | 'formula' | 'front-matter' | 'html' | null {
  if (markdown == null || !Number.isInteger(line) || line < 0) return null
  const { classOf } = classifyLines(markdown)
  if (line >= classOf.length) return null
  return classOf[line].protectedRegion?.kind ?? null
}

/** §10/§11 — the last non-blank source line index (-1 when the source is blank). */
export function lastContentSourceLine(markdown: string | null | undefined): number {
  if (markdown == null) return -1
  const lines = splitSourceLines(markdown)
  let last = -1
  for (let i = 0; i < lines.length; i++) if (!isBlank(lines[i].text)) last = i
  return last
}

/** §11 — the FIRST non-blank source line index (-1 when the source is blank). */
export function firstContentSourceLine(markdown: string | null | undefined): number {
  if (markdown == null) return -1
  const lines = splitSourceLines(markdown)
  for (let i = 0; i < lines.length; i++) if (!isBlank(lines[i].text)) return i
  return -1
}

/** §12 — the Drawer-facing detail copy (carries `actualBlankLines`). */
export function internalBlankLineDetail(actualBlankLines: number): string {
  return `当前两个内容块之间存在 ${actualBlankLines} 个连续空行，建议压缩为 1 个空行。`
}

// ── §35 — the hard gates ───────────────────────────────────────────────────

export const INTERNAL_BLANK_LINE_V1_GATE_KEYS = [
  'excessiveInternalBlankLinesWrongSeverity',
  'duplicateInternalBlankLineThresholdAuthority',
  'internalBlankLineDomGeometryDetection',
  'internalBlankLineOneGapMultiDiagnostic',
  'internalBlankLineDuplicateDiagnosticId',
  'eofBlankLineReportedAsInternal',
  'internalBlankLineReportedAsEof',
  'leadingBlankLineReportedAsInternal',
  'codeFenceInternalBlankLineFalsePositive',
  'formulaInternalBlankLineFalsePositive',
  'frontMatterBlankLineFalsePositive',
  'htmlBlockBlankLineFalsePositive',
  'internalBlankLineUnstableIdentity',
  'internalBlankLinePollingRefresh',
  'internalBlankLineFirstClickNotActivated',
  'internalBlankLineClickDrawerScrollDriftGt1px',
  'internalBlankLineClickDrawerViewportAnchorChanged',
  'internalBlankLineEditDuplicateDiagnostic',
  'internalBlankLineWrongFilter',
  'internalBlankLineToolbarWarningCountMismatch',
  'unrequestedEofRuleChange',
  'unrequestedTargetGroupChange',
  'unrequestedDrawerViewportChange',
  'unrequestedSeverityColorChange',
  'unrelatedProductionFileChange',
] as const

export type InternalBlankLineV1GateKey = typeof INTERNAL_BLANK_LINE_V1_GATE_KEYS[number]

export const INTERNAL_BLANK_LINE_V1_GATE_LABELS: Record<InternalBlankLineV1GateKey, string> = {
  excessiveInternalBlankLinesWrongSeverity: 'EXCESSIVE_INTERNAL_BLANK_LINES_WRONG_SEVERITY_COUNT',
  duplicateInternalBlankLineThresholdAuthority: 'DUPLICATE_INTERNAL_BLANK_LINE_THRESHOLD_AUTHORITY_COUNT',
  internalBlankLineDomGeometryDetection: 'INTERNAL_BLANK_LINE_DOM_GEOMETRY_DETECTION_COUNT',
  internalBlankLineOneGapMultiDiagnostic: 'INTERNAL_BLANK_LINE_ONE_GAP_MULTI_DIAGNOSTIC_COUNT',
  internalBlankLineDuplicateDiagnosticId: 'INTERNAL_BLANK_LINE_DUPLICATE_DIAGNOSTIC_ID_COUNT',
  eofBlankLineReportedAsInternal: 'EOF_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT',
  internalBlankLineReportedAsEof: 'INTERNAL_BLANK_LINE_REPORTED_AS_EOF_COUNT',
  leadingBlankLineReportedAsInternal: 'LEADING_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT',
  codeFenceInternalBlankLineFalsePositive: 'CODE_FENCE_INTERNAL_BLANK_LINE_FALSE_POSITIVE_COUNT',
  formulaInternalBlankLineFalsePositive: 'FORMULA_INTERNAL_BLANK_LINE_FALSE_POSITIVE_COUNT',
  frontMatterBlankLineFalsePositive: 'FRONT_MATTER_BLANK_LINE_FALSE_POSITIVE_COUNT',
  htmlBlockBlankLineFalsePositive: 'HTML_BLOCK_BLANK_LINE_FALSE_POSITIVE_COUNT',
  internalBlankLineUnstableIdentity: 'INTERNAL_BLANK_LINE_UNSTABLE_IDENTITY_COUNT',
  internalBlankLinePollingRefresh: 'INTERNAL_BLANK_LINE_POLLING_REFRESH_COUNT',
  internalBlankLineFirstClickNotActivated: 'INTERNAL_BLANK_LINE_FIRST_CLICK_NOT_ACTIVATED_COUNT',
  internalBlankLineClickDrawerScrollDriftGt1px: 'INTERNAL_BLANK_LINE_CLICK_DRAWER_SCROLL_DRIFT_GT_1PX_COUNT',
  internalBlankLineClickDrawerViewportAnchorChanged: 'INTERNAL_BLANK_LINE_CLICK_DRAWER_VIEWPORT_ANCHOR_CHANGED_COUNT',
  internalBlankLineEditDuplicateDiagnostic: 'INTERNAL_BLANK_LINE_EDIT_DUPLICATE_DIAGNOSTIC_COUNT',
  internalBlankLineWrongFilter: 'INTERNAL_BLANK_LINE_WRONG_FILTER_COUNT',
  internalBlankLineToolbarWarningCountMismatch: 'INTERNAL_BLANK_LINE_TOOLBAR_WARNING_COUNT_MISMATCH',
  unrequestedEofRuleChange: 'UNREQUESTED_EOF_RULE_CHANGE_COUNT',
  unrequestedTargetGroupChange: 'UNREQUESTED_TARGET_GROUP_CHANGE_COUNT',
  unrequestedDrawerViewportChange: 'UNREQUESTED_DRAWER_VIEWPORT_CHANGE_COUNT',
  unrequestedSeverityColorChange: 'UNREQUESTED_SEVERITY_COLOR_CHANGE_COUNT',
  unrelatedProductionFileChange: 'UNRELATED_PRODUCTION_FILE_CHANGE_COUNT',
}

export type InternalBlankLineV1Counters = Record<InternalBlankLineV1GateKey, number>

export function createInternalBlankLineV1Counters(): InternalBlankLineV1Counters {
  return INTERNAL_BLANK_LINE_V1_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as InternalBlankLineV1Counters)
}

export function formatInternalBlankLineV1GateReport(
  counters: Readonly<InternalBlankLineV1Counters>,
): string[] {
  return INTERNAL_BLANK_LINE_V1_GATE_KEYS.map(key => `${INTERNAL_BLANK_LINE_V1_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateInternalBlankLineV1Gates(
  counters: Readonly<InternalBlankLineV1Counters>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = INTERNAL_BLANK_LINE_V1_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failing: failing.map(k => INTERNAL_BLANK_LINE_V1_GATE_LABELS[k]) }
}

// ── §36 — positive coverage ────────────────────────────────────────────────

export const INTERNAL_BLANK_LINE_V1_COVERAGE_KEYS = [
  'warningRuntime',
  'threshold3Runtime',
  'headingToParagraphRuntime',
  'paragraphToHeadingRuntime',
  'headingToHeadingRuntime',
  'paragraphToParagraphRuntime',
  'dynamicDisappearRuntime',
  'dynamicReappearRuntime',
  'firstClickActiveRuntime',
  'drawerViewportStableRuntime',
] as const

export type InternalBlankLineV1CoverageKey = typeof INTERNAL_BLANK_LINE_V1_COVERAGE_KEYS[number]

export type InternalBlankLineV1Coverage = Record<InternalBlankLineV1CoverageKey, number>

export function createInternalBlankLineV1Coverage(): InternalBlankLineV1Coverage {
  return INTERNAL_BLANK_LINE_V1_COVERAGE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as InternalBlankLineV1Coverage)
}

export function formatInternalBlankLineV1CoverageReport(
  coverage: Readonly<InternalBlankLineV1Coverage>,
): string[] {
  const label: Record<InternalBlankLineV1CoverageKey, string> = {
    warningRuntime: 'INTERNAL_BLANK_LINE_WARNING_RUNTIME_COUNT',
    threshold3Runtime: 'INTERNAL_BLANK_LINE_THRESHOLD_3_RUNTIME_COUNT',
    headingToParagraphRuntime: 'INTERNAL_BLANK_LINE_HEADING_TO_PARAGRAPH_RUNTIME_COUNT',
    paragraphToHeadingRuntime: 'INTERNAL_BLANK_LINE_PARAGRAPH_TO_HEADING_RUNTIME_COUNT',
    headingToHeadingRuntime: 'INTERNAL_BLANK_LINE_HEADING_TO_HEADING_RUNTIME_COUNT',
    paragraphToParagraphRuntime: 'INTERNAL_BLANK_LINE_PARAGRAPH_TO_PARAGRAPH_RUNTIME_COUNT',
    dynamicDisappearRuntime: 'INTERNAL_BLANK_LINE_DYNAMIC_DISAPPEAR_RUNTIME_COUNT',
    dynamicReappearRuntime: 'INTERNAL_BLANK_LINE_DYNAMIC_REAPPEAR_RUNTIME_COUNT',
    firstClickActiveRuntime: 'INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_RUNTIME_COUNT',
    drawerViewportStableRuntime: 'INTERNAL_BLANK_LINE_DRAWER_VIEWPORT_STABLE_RUNTIME_COUNT',
  }
  return INTERNAL_BLANK_LINE_V1_COVERAGE_KEYS.map(key => `${label[key]}=${coverage[key] ?? 0}`)
}

/**
 * §36 — attribute ONE observed group into the positive-coverage buckets. Pure:
 * the caller passes the already-measured facts of a single activation.
 */
export function noteInternalBlankLineCoverage(
  coverage: InternalBlankLineV1Coverage,
  facts: {
    actualBlankLines: number
    previousBlockKind: DocumentBlockKind | null
    nextBlockKind: DocumentBlockKind | null
    firstClickActivated: boolean
    drawerViewportStable: boolean
  },
): void {
  coverage.warningRuntime++
  if (facts.actualBlankLines === INTERNAL_BLANK_LINE_POLICY.warningThreshold) coverage.threshold3Runtime++
  const pair = `${facts.previousBlockKind}>${facts.nextBlockKind}`
  if (pair === 'heading>paragraph') coverage.headingToParagraphRuntime++
  if (pair === 'paragraph>heading') coverage.paragraphToHeadingRuntime++
  if (pair === 'heading>heading') coverage.headingToHeadingRuntime++
  if (pair === 'paragraph>paragraph') coverage.paragraphToParagraphRuntime++
  if (facts.firstClickActivated) coverage.firstClickActiveRuntime++
  if (facts.drawerViewportStable) coverage.drawerViewportStableRuntime++
}

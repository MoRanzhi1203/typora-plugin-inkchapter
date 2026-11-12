/**
 * V1 — Figure-in-heading invariant (H1–H6) + empty image source scanner.
 *
 * The authority is the Markdown SOURCE, never the rendered `<img>` (Typora may
 * not have materialized an unfinished image node at all). The scan:
 *
 *   source → literal/code ranges → ATX heading lines → image tokens
 *          → escaped / literal tokens excluded → heading image facts
 *
 * A heading image is ALWAYS structurally invalid: an image must be a standalone
 * paragraph, so it can never be a heading payload. An image with an EMPTY
 * destination (`![]()`, `![alt]()`, `![alt](   )`) is still a real image token:
 * it is preserved verbatim and reported by the independent resource rule
 * `FIGURE_EMPTY_SOURCE` (the structure repair must never delete or invent a
 * path).
 *
 * V2 §5.5 — a heading may also carry an IMAGE-SYNTAX FRAGMENT that the Markdown
 * model can not admit as a complete token (unbalanced parens, an editing state
 * that was never closed, …). That fragment is `FIGURE_SYNTAX_IN_HEADING`, and
 * the heading repair moves it out of the heading too so no `![](...)` residue
 * can ever stay in heading text. A complete token always wins (no double report
 * for the same image node).
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import {
  computeMarkdownLiteralRanges,
  isSourceRangeLiteral,
  type MarkdownLiteralRange,
} from './document-markdown-literal-exclusion-v1'

export const FIGURE_IN_HEADING_CODE = 'FIGURE_IN_HEADING'
export const FIGURE_SYNTAX_IN_HEADING_CODE = 'FIGURE_SYNTAX_IN_HEADING'
export const FIGURE_EMPTY_SOURCE_CODE = 'FIGURE_EMPTY_SOURCE'

/** One Markdown image token found on a source line. */
export interface SourceImageToken {
  /** Absolute offset of `!` (inclusive). */
  tokenStart: number
  /** Absolute offset AFTER `)` (exclusive). */
  tokenEnd: number
  rawToken: string
  altText: string
  /** Empty when the destination is empty / whitespace-only / `<>`. */
  destination: string
  /** True for the unfinished `![]( )` / `![alt]()` editor state. */
  emptyDestination: boolean
  /** 0-based source line index. */
  lineIndex: number
}

/** A `![...](` run that is NOT a complete image token. */
export interface HeadingSyntaxFragment {
  /** Absolute offset of `!` (inclusive). */
  start: number
  /** Absolute offset AFTER the fragment (exclusive). */
  end: number
  raw: string
  lineIndex: number
}

/** One ATX heading (H1–H6) that owns at least one real image token. */
export interface HeadingImageEntry {
  level: number
  lineIndex: number
  /** Absolute offset of the line start (inclusive). */
  lineStart: number
  /** Absolute offset of the line content end (exclusive of EOL). */
  lineEnd: number
  /** Absolute offset where the heading content starts (after `### `). */
  headingTextStart: number
  /** Absolute offset where the heading content ends (closing #s excluded). */
  headingTextEnd: number
  /** Heading text with every image token / syntax fragment removed. */
  textWithoutImages: string
  /** True when the heading has NO effective text besides its images. */
  imageOnly: boolean
  images: SourceImageToken[]
  /** Incomplete image-link syntax that must leave the heading as well. */
  syntaxFragments: HeadingSyntaxFragment[]
}

/** One ATX heading that owns ONLY incomplete image-link syntax. */
export interface HeadingSyntaxEntry {
  level: number
  lineIndex: number
  lineStart: number
  lineEnd: number
  headingTextStart: number
  headingTextEnd: number
  /** Heading text with every syntax fragment removed. */
  textWithoutSyntax: string
  /** True when the heading has NO effective text besides the fragments. */
  syntaxOnly: boolean
  syntaxFragments: HeadingSyntaxFragment[]
}

const ATX_HEADING_RE = /^( {0,3})(#{1,6})([ \t]+)(.*)$/

interface LineSpan {
  index: number
  start: number
  contentEnd: number
  end: number
  text: string
}

function buildLines(source: string): LineSpan[] {
  const lines: LineSpan[] = []
  let start = 0
  let index = 0
  for (let i = 0; i <= source.length; i++) {
    if (i !== source.length && source.charCodeAt(i) !== 10) continue
    let contentEnd = i
    if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 13) contentEnd--
    lines.push({
      index,
      start,
      contentEnd,
      end: i + 1,
      text: source.slice(start, contentEnd),
    })
    start = i + 1
    index++
  }
  return lines
}

/** True when `offset` is escaped by an ODD number of preceding backslashes. */
function isEscapedAt(text: string, offsetInText: number): boolean {
  let backslashes = 0
  for (let i = offsetInText - 1; i >= 0 && text.charAt(i) === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

/**
 * Parse the destination / optional title of `![alt]( ... )`.
 *
 * The scan is BALANCED-PAREN aware (CommonMark allows `a(b).png`) and lenient
 * about spaces inside a destination that also carries a title, so a real token
 * is never split into `![alt](a(b)` + `.png)` residue (V2 §5.5 / §15).
 */
function parseDestinationText(content: string): string {
  const trimmed = content.trim()
  if (trimmed === '') return ''
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>')
    if (close > 0) return trimmed.slice(1, close).trim()
    return trimmed.slice(1).trim()
  }
  const titled = /^(.*?)[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:\\.|[^)\\])*\))[ \t]*$/.exec(trimmed)
  if (titled) return titled[1].trim()
  return trimmed
}

interface ParsedImage {
  end: number
  altText: string
  destination: string
  emptyDestination: boolean
}

/**
 * Parse ONE image token starting at `start` (absolute offset in `lineText`).
 * Returns `null` when the token is not complete on this line.
 */
function parseImageTokenAt(lineText: string, start: number): ParsedImage | null {
  if (lineText.charAt(start) !== '!' || lineText.charAt(start + 1) !== '[') return null
  let i = start + 2
  let alt = ''
  while (i < lineText.length) {
    const ch = lineText.charAt(i)
    if (ch === '\\' && i + 1 < lineText.length) {
      alt += lineText.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === ']') break
    alt += ch
    i++
  }
  if (lineText.charAt(i) !== ']' || lineText.charAt(i + 1) !== '(') return null
  i += 2
  let depth = 0
  let content = ''
  let closed = false
  while (i < lineText.length) {
    const ch = lineText.charAt(i)
    if (ch === '\\' && i + 1 < lineText.length) {
      content += lineText.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '(') {
      depth++
      content += ch
      i++
      continue
    }
    if (ch === ')') {
      if (depth === 0) {
        closed = true
        break
      }
      depth--
      content += ch
      i++
      continue
    }
    content += ch
    i++
  }
  if (!closed) return null
  const destination = parseDestinationText(content)
  return {
    end: i + 1,
    altText: alt,
    destination,
    emptyDestination: destination.trim() === '',
  }
}

function scanLineTokens(
  line: LineSpan,
  literals: readonly MarkdownLiteralRange[],
): SourceImageToken[] {
  const out: SourceImageToken[] = []
  let cursor = 0
  while (cursor < line.text.length) {
    const at = line.text.indexOf('![', cursor)
    if (at < 0) break
    cursor = at + 1
    if (isEscapedAt(line.text, at)) continue
    const tokenStart = line.start + at
    if (isSourceRangeLiteral(literals, tokenStart, tokenStart + 2)) continue
    const parsed = parseImageTokenAt(line.text, at)
    if (parsed == null) continue
    const tokenEnd = line.start + parsed.end
    if (isSourceRangeLiteral(literals, tokenStart, tokenEnd)) continue
    out.push({
      tokenStart,
      tokenEnd,
      rawToken: line.text.slice(at, parsed.end),
      altText: parsed.altText,
      destination: parsed.destination,
      emptyDestination: parsed.emptyDestination,
      lineIndex: line.index,
    })
    cursor = parsed.end
  }
  return out
}

/** Every real (non-literal, non-escaped) Markdown image token of the source. */
export function scanSourceImageTokens(source: string): SourceImageToken[] {
  if (source == null || source === '') return []
  const literals = computeMarkdownLiteralRanges(source)
  const out: SourceImageToken[] = []
  for (const line of buildLines(source)) {
    out.push(...scanLineTokens(line, literals))
  }
  return out
}

interface RemovalRange {
  start: number
  end: number
}

/** Remove the given ranges from one [rangeStart, rangeEnd) source range. */
function removeRanges(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  ranges: readonly RemovalRange[],
): string {
  let out = ''
  let cursor = rangeStart
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.end <= cursor) continue
    const start = Math.max(cursor, range.start)
    out += source.slice(cursor, start)
    cursor = Math.max(cursor, range.end)
  }
  out += source.slice(cursor, rangeEnd)
  return out
}

/**
 * Detect the image-syntax fragments of one heading line: `![...](` runs that
 * are neither a complete token nor literal text. Scan only the GAPS between
 * real tokens, so a complete token can never be swallowed twice.
 */
function scanSyntaxFragments(
  line: LineSpan,
  headingTextStart: number,
  headingTextEnd: number,
  tokens: readonly SourceImageToken[],
  literals: readonly MarkdownLiteralRange[],
): HeadingSyntaxFragment[] {
  const gaps: { start: number; end: number }[] = []
  let cursor = headingTextStart
  for (const token of tokens) {
    if (token.tokenStart > cursor) gaps.push({ start: cursor, end: token.tokenStart })
    cursor = Math.max(cursor, token.tokenEnd)
  }
  if (cursor < headingTextEnd) gaps.push({ start: cursor, end: headingTextEnd })
  const out: HeadingSyntaxFragment[] = []
  for (const gap of gaps) {
    const relativeStart = gap.start - line.start
    const relativeEnd = gap.end - line.start
    const gapText = line.text.slice(relativeStart, relativeEnd)
    const at = gapText.indexOf('![')
    if (at < 0 || isEscapedAt(line.text, relativeStart + at)) continue
    const absoluteStart = gap.start + at
    if (isSourceRangeLiteral(literals, absoluteStart, absoluteStart + 2)) continue
    // Only a real image-link shape (`![alt](`) is a syntax fragment — never any
    // heading that merely contains `!` and `[` (V2 §5.2).
    if (!/^!\[[^\]\n]*\]\(/.test(gapText.slice(at))) continue
    const raw = gapText.slice(at).replace(/[ \t]+$/, '')
    if (raw === '') continue
    out.push({
      start: absoluteStart,
      end: absoluteStart + raw.length,
      raw,
      lineIndex: line.index,
    })
  }
  return out
}

interface HeadingLineAnalysis {
  level: number
  line: LineSpan
  headingTextStart: number
  headingTextEnd: number
  tokens: SourceImageToken[]
  fragments: HeadingSyntaxFragment[]
}

function analyzeHeadingLine(
  line: LineSpan,
  literals: readonly MarkdownLiteralRange[],
): HeadingLineAnalysis | null {
  const match = ATX_HEADING_RE.exec(line.text)
  if (match == null) return null
  const indent = match[1]
  const hashes = match[2]
  const spacing = match[3]
  const content = match[4] ?? ''
  const headingTextStart = line.start + indent.length + hashes.length + spacing.length
  // A closing sequence (`## title ##`) is heading syntax, not heading text.
  const closing = /[ \t]+#+[ \t]*$/.exec(content)
  const contentEnd = closing ? closing.index : content.length
  const headingTextEnd = headingTextStart + contentEnd
  const tokens = scanLineTokens(line, literals)
    .filter(token => token.tokenStart >= headingTextStart && token.tokenEnd <= headingTextEnd)
  const fragments = scanSyntaxFragments(line, headingTextStart, headingTextEnd, tokens, literals)
  if (tokens.length === 0 && fragments.length === 0) return null
  return { level: hashes.length, line, headingTextStart, headingTextEnd, tokens, fragments }
}

function removalsOf(analysis: HeadingLineAnalysis): RemovalRange[] {
  return [
    ...analysis.tokens.map(token => ({ start: token.tokenStart, end: token.tokenEnd })),
    ...analysis.fragments.map(fragment => ({ start: fragment.start, end: fragment.end })),
  ]
}

function normalizeHeadingText(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim()
}

function isImageOnly(text: string): boolean {
  return text.replace(/[*_~`]+/g, '').trim() === ''
}

/**
 * §1 — every ATX heading (H1–H6) owning at least one REAL image token.
 *
 * An image token inside inline code / a fenced code block is never an image
 * (literal exclusion); an escaped `\![alt](src)` is literal text. Neither can
 * produce a heading image diagnostic. Incomplete image-link syntax fragments of
 * the same heading are carried on the entry so the repair extracts them too.
 */
export function analyzeHeadingImages(source: string): HeadingImageEntry[] {
  if (source == null || source === '') return []
  const literals = computeMarkdownLiteralRanges(source)
  const out: HeadingImageEntry[] = []
  for (const line of buildLines(source)) {
    const analysis = analyzeHeadingLine(line, literals)
    if (analysis == null || analysis.tokens.length === 0) continue
    const textWithoutImages = normalizeHeadingText(
      removeRanges(source, analysis.headingTextStart, analysis.headingTextEnd, removalsOf(analysis)),
    )
    out.push({
      level: analysis.level,
      lineIndex: line.index,
      lineStart: line.start,
      lineEnd: line.contentEnd,
      headingTextStart: analysis.headingTextStart,
      headingTextEnd: analysis.headingTextEnd,
      textWithoutImages,
      imageOnly: isImageOnly(textWithoutImages),
      images: analysis.tokens,
      syntaxFragments: analysis.fragments,
    })
  }
  return out
}

/**
 * §5.5 — headings that own ONLY incomplete image-link syntax (no complete
 * token). They are `FIGURE_SYNTAX_IN_HEADING`; a heading with real tokens is
 * owned by `FIGURE_IN_HEADING` and never double-reports the same node.
 */
export function analyzeHeadingImageSyntax(source: string): HeadingSyntaxEntry[] {
  if (source == null || source === '') return []
  const literals = computeMarkdownLiteralRanges(source)
  const out: HeadingSyntaxEntry[] = []
  for (const line of buildLines(source)) {
    const analysis = analyzeHeadingLine(line, literals)
    if (analysis == null || analysis.tokens.length > 0 || analysis.fragments.length === 0) continue
    const textWithoutSyntax = normalizeHeadingText(
      removeRanges(source, analysis.headingTextStart, analysis.headingTextEnd, removalsOf(analysis)),
    )
    out.push({
      level: analysis.level,
      lineIndex: line.index,
      lineStart: line.start,
      lineEnd: line.contentEnd,
      headingTextStart: analysis.headingTextStart,
      headingTextEnd: analysis.headingTextEnd,
      textWithoutSyntax,
      syntaxOnly: isImageOnly(textWithoutSyntax),
      syntaxFragments: analysis.fragments,
    })
  }
  return out
}

export interface HeadingImageFixOutcome {
  changed: boolean
  text: string
  refusal: string | null
}

function headingMarker(source: string, headingTextStart: number, lineStart: number): string {
  return source.slice(lineStart, headingTextStart).replace(/[ \t]+$/, ' ')
}

function buildHeadingFix(
  source: string,
  input: {
    lineStart: number
    lineEnd: number
    headingTextStart: number
    headingTextEnd: number
    remainingText: string
    removedRaw: readonly string[]
  },
): HeadingImageFixOutcome {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lineText = source.slice(input.lineStart, input.lineEnd)
  const blocks = input.removedRaw.filter(raw => raw.trim() !== '')
  if (input.remainingText === '') {
    const replacement = blocks.join(eol + eol)
    return { changed: replacement !== lineText, text: replacement, refusal: null }
  }
  const heading = headingMarker(source, input.headingTextStart, input.lineStart) + input.remainingText
  const replacement = blocks.length > 0
    ? `${heading}${eol}${eol}${blocks.join(eol + eol)}`
    : heading
  return { changed: replacement !== lineText, text: replacement, refusal: null }
}

/**
 * §2 — repair ONE heading:
 *   - keep the H1–H6 marker + every heading text character when text remains;
 *   - move every image token (original order, original bytes) OUTSIDE the
 *     heading as standalone image paragraphs;
 *   - move any incomplete image-syntax fragment out as well (no residue);
 *   - an image-only heading loses the heading structure, while its images stay;
 *   - an empty-path token is preserved verbatim (never deleted, never invented).
 */
export function buildHeadingImageFix(source: string, entry: HeadingImageEntry): HeadingImageFixOutcome {
  if (source == null || entry == null) {
    return { changed: false, text: source ?? '', refusal: '标题图片信息不可用。' }
  }
  if (entry.images.length === 0 && entry.syntaxFragments.length === 0) {
    return { changed: false, text: source, refusal: '该标题不包含真实图片。' }
  }
  const removed = [
    ...entry.images.map(token => ({ start: token.tokenStart, raw: token.rawToken })),
    ...entry.syntaxFragments.map(fragment => ({ start: fragment.start, raw: fragment.raw })),
  ].sort((a, b) => a.start - b.start)
  return buildHeadingFix(source, {
    lineStart: entry.lineStart,
    lineEnd: entry.lineEnd,
    headingTextStart: entry.headingTextStart,
    headingTextEnd: entry.headingTextEnd,
    remainingText: entry.textWithoutImages,
    removedRaw: removed.map(item => item.raw),
  })
}

/**
 * §5.5 — repair ONE syntax-only heading: move the incomplete image-link syntax
 * out as standalone paragraphs, keep the heading text / level, and drop an
 * empty heading marker when nothing else remains.
 */
export function buildHeadingSyntaxFix(source: string, entry: HeadingSyntaxEntry): HeadingImageFixOutcome {
  if (source == null || entry == null) {
    return { changed: false, text: source ?? '', refusal: '标题图片语法信息不可用。' }
  }
  if (entry.syntaxFragments.length === 0) {
    return { changed: false, text: source, refusal: '该标题不包含图片链接语法。' }
  }
  const removed = [...entry.syntaxFragments].sort((a, b) => a.start - b.start)
  return buildHeadingFix(source, {
    lineStart: entry.lineStart,
    lineEnd: entry.lineEnd,
    headingTextStart: entry.headingTextStart,
    headingTextEnd: entry.headingTextEnd,
    remainingText: entry.textWithoutSyntax,
    removedRaw: removed.map(fragment => fragment.raw),
  })
}

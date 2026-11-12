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
 * Pure: no DOM, no host state, no filesystem.
 */
import {
  computeMarkdownLiteralRanges,
  isSourceRangeLiteral,
  type MarkdownLiteralRange,
} from './document-markdown-literal-exclusion-v1'

export const FIGURE_IN_HEADING_CODE = 'FIGURE_IN_HEADING'
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
  /** Heading text with every image token removed and whitespace collapsed. */
  textWithoutImages: string
  /** True when the heading has NO effective text besides its images. */
  imageOnly: boolean
  images: SourceImageToken[]
}

const ATX_HEADING_RE = /^( {0,3})(#{1,6})([ \t]+)(.*)$/
const IMAGE_TOKEN_RE = /!\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g

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

function parseDestination(destinationText: string): string {
  const trimmed = destinationText.trim()
  if (trimmed === '') return ''
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>')
    if (close > 0) return trimmed.slice(1, close).trim()
    return trimmed.slice(1).trim()
  }
  return trimmed.split(/\s+/)[0] ?? ''
}

function scanLineTokens(
  line: LineSpan,
  literals: readonly MarkdownLiteralRange[],
): SourceImageToken[] {
  const out: SourceImageToken[] = []
  IMAGE_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMAGE_TOKEN_RE.exec(line.text)) !== null) {
    const relativeStart = match.index
    if (isEscapedAt(line.text, relativeStart)) continue
    const tokenStart = line.start + relativeStart
    const tokenEnd = tokenStart + match[0].length
    if (isSourceRangeLiteral(literals, tokenStart, tokenEnd)) continue
    const destination = parseDestination(match[2] ?? '')
    out.push({
      tokenStart,
      tokenEnd,
      rawToken: match[0],
      altText: match[1] ?? '',
      destination,
      emptyDestination: destination.trim() === '',
      lineIndex: line.index,
    })
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

/** Remove the given tokens from one [rangeStart, rangeEnd) source range. */
function removeTokens(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  tokens: readonly SourceImageToken[],
): string {
  let out = ''
  let cursor = rangeStart
  for (const token of tokens) {
    out += source.slice(cursor, token.tokenStart)
    cursor = token.tokenEnd
  }
  out += source.slice(cursor, rangeEnd)
  return out
}

/**
 * §1 — every ATX heading (H1–H6) owning at least one REAL image token.
 *
 * An image token inside inline code / a fenced code block is never an image
 * (literal exclusion); an escaped `\![alt](src)` is literal text. Neither can
 * produce a heading image diagnostic.
 */
export function analyzeHeadingImages(source: string): HeadingImageEntry[] {
  if (source == null || source === '') return []
  const literals = computeMarkdownLiteralRanges(source)
  const out: HeadingImageEntry[] = []
  for (const line of buildLines(source)) {
    const match = ATX_HEADING_RE.exec(line.text)
    if (match == null) continue
    const indent = match[1]
    const hashes = match[2]
    const spacing = match[3]
    const content = match[4] ?? ''
    const headingTextStart = line.start + indent.length + hashes.length + spacing.length
    // A closing sequence (`## title ##`) is heading syntax, not heading text.
    const closing = /[ \t]+#+[ \t]*$/.exec(content)
    const contentEnd = closing ? closing.index : content.length
    const headingTextEnd = headingTextStart + contentEnd
    const images = scanLineTokens(line, literals)
      .filter(token => token.tokenStart >= headingTextStart && token.tokenEnd <= headingTextEnd)
    if (images.length === 0) continue
    const textWithoutImages = removeTokens(source, headingTextStart, headingTextEnd, images)
      .replace(/[ \t]+/g, ' ')
      .trim()
    // Formatting markers that only wrapped the removed image are not text.
    const semanticText = textWithoutImages.replace(/[*_~`]+/g, '').trim()
    out.push({
      level: hashes.length,
      lineIndex: line.index,
      lineStart: line.start,
      lineEnd: line.contentEnd,
      headingTextStart,
      headingTextEnd,
      textWithoutImages,
      imageOnly: semanticText === '',
      images,
    })
  }
  return out
}

export interface HeadingImageFixOutcome {
  changed: boolean
  text: string
  refusal: string | null
}

/**
 * §2 — repair ONE heading:
 *   - keep the H1–H6 marker + every heading text character when text remains;
 *   - move every image token (original order, original bytes) OUTSIDE the
 *     heading as standalone image paragraphs;
 *   - an image-only heading loses the heading structure, while its images stay;
 *   - an empty-path token is preserved verbatim (never deleted, never invented).
 */
export function buildHeadingImageFix(source: string, entry: HeadingImageEntry): HeadingImageFixOutcome {
  if (source == null || entry == null) {
    return { changed: false, text: source ?? '', refusal: '标题图片信息不可用。' }
  }
  if (entry.images.length === 0) {
    return { changed: false, text: source, refusal: '该标题不包含真实图片。' }
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lineText = source.slice(entry.lineStart, entry.lineEnd)
  const markerText = lineText.slice(0, entry.headingTextStart - entry.lineStart)
  const imageBlocks = entry.images.map(token => token.rawToken)
  if (entry.textWithoutImages === '') {
    const replacement = imageBlocks.join(eol + eol)
    return { changed: replacement !== lineText, text: replacement, refusal: null }
  }
  const heading = markerText.replace(/[ \t]+$/, ' ') + entry.textWithoutImages
  const replacement = `${heading}${eol}${eol}${imageBlocks.join(eol + eol)}`
  return { changed: replacement !== lineText, text: replacement, refusal: null }
}

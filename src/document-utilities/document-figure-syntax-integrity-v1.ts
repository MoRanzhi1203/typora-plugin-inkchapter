/**
 * V3 — Figure syntax INTEGRITY scanner (stateful, source-authoritative).
 *
 * Typora only renders an `<img>` after the whole `![alt](destination)` token is
 * valid, so a missing `)` / `]` never produces a DOM image and the existing
 * image rules cannot see it. This module scans the Markdown SOURCE itself:
 *
 *   source → literal ranges (fence / inline code) → HTML exclusion ranges
 *          → line state machine over every real `![` candidate
 *          → unclosed destination / unclosed alt / malformed / invalid destination
 *
 * It NEVER trusts a rendered `<img>` and never treats arbitrary `!` + `[` as an
 * image. Complete tokens are left to the existing figure rules; an empty
 * destination belongs to the independent `FIGURE_EMPTY_SOURCE` resource rule.
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import {
  computeMarkdownLiteralRanges,
  isSourceRangeLiteral,
  type MarkdownLiteralRange,
} from './document-markdown-literal-exclusion-v1'

export const FIGURE_UNCLOSED_DESTINATION_CODE = 'FIGURE_UNCLOSED_DESTINATION'
export const FIGURE_UNCLOSED_ALT_CODE = 'FIGURE_UNCLOSED_ALT'
export const FIGURE_MALFORMED_SYNTAX_CODE = 'FIGURE_MALFORMED_SYNTAX'
export const FIGURE_INVALID_DESTINATION_CODE = 'FIGURE_INVALID_DESTINATION'

export type FigureSyntaxIssueCode =
  | typeof FIGURE_UNCLOSED_DESTINATION_CODE
  | typeof FIGURE_UNCLOSED_ALT_CODE
  | typeof FIGURE_MALFORMED_SYNTAX_CODE
  | typeof FIGURE_INVALID_DESTINATION_CODE

export type FigureSyntaxRepairKind = 'append-closing-paren' | 'insert-closing-bracket'

export interface FigureSyntaxIssue {
  code: FigureSyntaxIssueCode
  severity: 'error'
  title: string
  detail: string
  /** Absolute offset of `![` (inclusive). */
  start: number
  /** Absolute offset AFTER the candidate (exclusive). */
  end: number
  lineIndex: number
  startLine: number
  endLine: number
  rawToken: string
  /** Best-effort destination text (never invented). */
  destination: string
  /** Deterministic repair when the boundary is provable, otherwise null. */
  repair: FigureSyntaxRepairKind | null
  /** Absolute insertion offset for the repair (repair !== null). */
  repairAt: number | null
  /** Why no automatic repair is offered. */
  refusal: string | null
}

const ATX_HEADING_RE = /^( {0,3})(#{1,6})([ \t]+)/
const BLANK_RE = /^[ \t]*$/

interface LineSpan {
  index: number
  start: number
  contentEnd: number
  end: number
  text: string
  blank: boolean
  paragraphStart: number
  heading: boolean
}

interface ExclusionRange {
  start: number
  end: number
}

function buildLines(source: string): LineSpan[] {
  const rawLines: { index: number; start: number; contentEnd: number; end: number; text: string }[] = []
  let start = 0
  let index = 0
  for (let i = 0; i <= source.length; i++) {
    if (i !== source.length && source.charCodeAt(i) !== 10) continue
    let contentEnd = i
    if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 13) contentEnd--
    rawLines.push({ index, start, contentEnd, end: i + 1, text: source.slice(start, contentEnd) })
    start = i + 1
    index++
  }
  const lines: LineSpan[] = []
  let paragraphStart = 0
  for (const line of rawLines) {
    const blank = BLANK_RE.test(line.text)
    if (blank) paragraphStart = line.index + 1
    lines.push({
      ...line,
      blank,
      paragraphStart: blank ? line.index : paragraphStart,
      heading: ATX_HEADING_RE.test(line.text),
    })
  }
  return lines
}

/** True when `offset` is escaped by an ODD number of preceding backslashes. */
function isEscapedAt(text: string, offsetInText: number): boolean {
  let backslashes = 0
  for (let i = offsetInText - 1; i >= 0 && text.charAt(i) === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function isEscapedInSource(source: string, offset: number): boolean {
  let backslashes = 0
  for (let i = offset - 1; i >= 0 && source.charAt(i) === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

/**
 * HTML regions where `![` is plain text, never a Markdown image: comments and
 * raw-text elements (`script` / `style` / `pre` / `textarea` / `code`).
 */
function computeHtmlExclusionRanges(source: string): ExclusionRange[] {
  const out: ExclusionRange[] = []
  const commentRe = /<!--[\s\S]*?-->/g
  let match: RegExpExecArray | null
  while ((match = commentRe.exec(source)) !== null) {
    out.push({ start: match.index, end: match.index + match[0].length })
  }
  const rawTextRe = /<(script|style|pre|textarea|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
  while ((match = rawTextRe.exec(source)) !== null) {
    out.push({ start: match.index, end: match.index + match[0].length })
  }
  return out
}

function insideRanges(ranges: readonly ExclusionRange[], start: number, end: number): boolean {
  return ranges.some(range => start < range.end && end > range.start)
}

interface AltParse {
  closed: boolean
  /** Index of the unescaped `]` in the line (or -1). */
  closeIndex: number
  /** First unescaped `(` seen before the closing bracket (or -1). */
  firstParen: number
  /** True when an unescaped `[` appears inside the alt text. */
  nestedBracket: boolean
}

function parseAlt(text: string, at: number): AltParse {
  let firstParen = -1
  let nestedBracket = false
  let i = at + 2
  while (i < text.length) {
    const ch = text.charAt(i)
    if (ch === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (ch === ']') return { closed: true, closeIndex: i, firstParen, nestedBracket }
    if (ch === '(' && firstParen < 0) firstParen = i
    if (ch === '[') nestedBracket = true
    i++
  }
  return { closed: false, closeIndex: -1, firstParen, nestedBracket }
}

interface ParenScan {
  /** Index of the closing `)` (or -1 when the line ends / a new `![` starts). */
  closeIndex: number
  content: string
  /** Offset of a NEW `![` candidate that stopped the scan (or -1). */
  stopIndex: number
}

function scanParenContent(text: string, openIndex: number): ParenScan {
  let depth = 0
  let i = openIndex + 1
  while (i < text.length) {
    const ch = text.charAt(i)
    if (ch === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    // A new image candidate always starts a NEW token; an unclosed destination
    // must not swallow it (V3 §3 — multiple candidates).
    if (ch === '!' && text.charAt(i + 1) === '[' && !isEscapedAt(text, i)) {
      return { closeIndex: -1, content: text.slice(openIndex + 1, i), stopIndex: i }
    }
    if (ch === '(') {
      depth++
      i++
      continue
    }
    if (ch === ')') {
      if (depth === 0) return { closeIndex: i, content: text.slice(openIndex + 1, i), stopIndex: -1 }
      depth--
      i++
      continue
    }
    i++
  }
  return { closeIndex: -1, content: text.slice(openIndex + 1), stopIndex: -1 }
}

type DestinationVerdict =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'malformed'; reason: string }

function isValidTitle(text: string): boolean {
  if (text.length < 2) return false
  const first = text.charAt(0)
  const last = text.charAt(text.length - 1)
  if (first === '"') return last === '"' && !isEscapedAt(text, text.length - 1)
  if (first === "'") return last === "'" && !isEscapedAt(text, text.length - 1)
  if (first === '(') return last === ')' && !isEscapedAt(text, text.length - 1)
  return false
}

function findUnescaped(text: string, needle: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text.charAt(i) === needle && !isEscapedAt(text, i)) return i
  }
  return -1
}

/** Validate one `(...)` content: destination + optional title. */
function validateDestination(content: string): DestinationVerdict {
  const text = content.trim()
  if (text === '') return { kind: 'empty' }
  if (text.startsWith('<')) {
    const close = findUnescaped(text, '>', 1)
    if (close < 0) return { kind: 'invalid', reason: '尖括号包裹的图片路径缺少 `>`。' }
    const rest = text.slice(close + 1).trim()
    if (rest !== '' && !isValidTitle(rest)) {
      return { kind: 'invalid', reason: '图片路径后的标题语法不合法。' }
    }
    return { kind: 'ok' }
  }
  // Typora accepts spaces inside a path when a quoted title follows
  // (`assets/图 片.png "标题"`). Treat the trailing title as the separator.
  const tailTitle = /^(.*?)[ \t]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))[ \t]*$/.exec(text)
  if (tailTitle != null && tailTitle[1].trim() !== '') {
    const destination = tailTitle[1].trim()
    if (/[\u0000-\u001f]/.test(destination)) {
      return { kind: 'invalid', reason: '图片路径包含非法控制字符。' }
    }
    return { kind: 'ok' }
  }
  let i = 0
  let destination = ''
  while (i < text.length) {
    const ch = text.charAt(i)
    if (ch === '\\' && i + 1 < text.length) {
      destination += text.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === ' ' || ch === '\t') break
    destination += ch
    i++
  }
  const rest = text.slice(i).trim()
  if (destination === '') return { kind: 'empty' }
  if (rest !== '') {
    if (rest.charAt(0) === '"' || rest.charAt(0) === "'" || rest.charAt(0) === '(') {
      if (!isValidTitle(rest)) {
        return { kind: 'malformed', reason: '图片标题缺少闭合引号或括号。' }
      }
    } else {
      return { kind: 'invalid', reason: '图片路径后存在无法解析的内容。' }
    }
  }
  if (/[\u0000-\u001f]/.test(destination)) {
    return { kind: 'invalid', reason: '图片路径包含非法控制字符。' }
  }
  return { kind: 'ok' }
}

function titleOf(code: FigureSyntaxIssueCode): string {
  if (code === FIGURE_UNCLOSED_DESTINATION_CODE) return '图片链接括号未闭合'
  if (code === FIGURE_UNCLOSED_ALT_CODE) return '图片描述方括号未闭合'
  if (code === FIGURE_INVALID_DESTINATION_CODE) return '图片路径语法不合法'
  return '图片链接语法不完整'
}

function detailOf(code: FigureSyntaxIssueCode): string {
  if (code === FIGURE_UNCLOSED_DESTINATION_CODE) {
    return '图片语法的目标路径缺少右圆括号 `)`，Typora 无法把它渲染成图片。'
  }
  if (code === FIGURE_UNCLOSED_ALT_CODE) {
    return '图片描述的方括号 `]` 未闭合，无法无歧义地区分描述与路径。'
  }
  if (code === FIGURE_INVALID_DESTINATION_CODE) {
    return '图片路径语法不合法，无法解析为有效的图片目标。'
  }
  return '图片链接语法不完整或分隔结构不合法。'
}

interface MutableIssue extends FigureSyntaxIssue {
  paragraphStart: number
  /** End of this candidate's line content (repair boundary). */
  repairBoundary: number
  paragraphFinal: boolean
}

function makeIssue(
  code: FigureSyntaxIssueCode,
  line: LineSpan,
  startInLine: number,
  endInLine: number,
  destination: string,
  refusal: string | null,
): MutableIssue {
  const start = line.start + startInLine
  const end = line.start + endInLine
  return {
    code,
    severity: 'error',
    title: titleOf(code),
    detail: detailOf(code),
    start,
    end,
    lineIndex: line.index,
    startLine: line.index,
    endLine: line.index,
    rawToken: line.text.slice(startInLine, endInLine),
    destination,
    repair: null,
    repairAt: null,
    refusal,
    paragraphStart: line.paragraphStart,
    repairBoundary: line.contentEnd,
    paragraphFinal: false,
  }
}

/**
 * Scan every real `![` candidate of the source. A completed, valid token and an
 * empty destination produce NO issue here (they belong to the existing figure /
 * empty-source rules).
 */
export function analyzeFigureSyntax(source: string): FigureSyntaxIssue[] {
  if (source == null || source === '') return []
  const literals: readonly MarkdownLiteralRange[] = computeMarkdownLiteralRanges(source)
  const htmlRanges = computeHtmlExclusionRanges(source)
  const lines = buildLines(source)
  const issues: MutableIssue[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line.blank || line.text.indexOf('![') < 0) continue
    const nextLine = lines[lineIndex + 1]
    const paragraphFinal = line.heading || nextLine == null || nextLine.blank
    let cursor = 0
    while (cursor < line.text.length) {
      const at = line.text.indexOf('![', cursor)
      if (at < 0) break
      cursor = at + 1
      if (isEscapedAt(line.text, at)) continue
      const absoluteStart = line.start + at
      if (isSourceRangeLiteral(literals, absoluteStart, absoluteStart + 2)) continue
      if (insideRanges(htmlRanges, absoluteStart, absoluteStart + 2)) continue

      const alt = parseAlt(line.text, at)
      if (!alt.closed) {
        // `![alt(path)` — a missing `]` but an explicit `(` + `)` pair.
        if (alt.firstParen < 0) continue
        if (isEscapedInSource(source, line.start + alt.firstParen)) continue
        const paren = scanParenContent(line.text, alt.firstParen)
        if (paren.closeIndex < 0) {
          const endInLine = paren.stopIndex >= 0 ? paren.stopIndex : line.text.length
          const issue = makeIssue(
            FIGURE_UNCLOSED_ALT_CODE, line, at, endInLine,
            line.text.slice(alt.firstParen + 1, endInLine), '图片描述与路径同时缺少闭合符号，请手动补全。',
          )
          issue.paragraphFinal = paragraphFinal
          issues.push(issue)
          cursor = endInLine
          continue
        }
        const altText = line.text.slice(at + 2, alt.firstParen)
        const ambiguous = alt.nestedBracket || /(^|[^\\])[()]/.test(altText)
        const issue = makeIssue(
          FIGURE_UNCLOSED_ALT_CODE, line, at, paren.closeIndex + 1,
          paren.content.trim(),
          ambiguous ? '描述文本中包含括号或方括号，无法无歧义地确定 `]` 的位置，请手动修复。' : null,
        )
        issue.paragraphFinal = paragraphFinal
        if (!ambiguous) {
          issue.repair = 'insert-closing-bracket'
          issue.repairAt = line.start + alt.firstParen
        }
        issues.push(issue)
        cursor = paren.closeIndex + 1
        continue
      }

      const afterAlt = alt.closeIndex + 1
      let openParen = afterAlt
      while (openParen < line.text.length && (line.text.charAt(openParen) === ' ' || line.text.charAt(openParen) === '\t')) openParen++
      if (line.text.charAt(openParen) !== '(') {
        // `![alt]` without a destination is plain text, not an image candidate.
        cursor = afterAlt
        continue
      }
      if (openParen > afterAlt) {
        const issue = makeIssue(
          FIGURE_MALFORMED_SYNTAX_CODE, line, at, openParen + 1,
          '', '图片描述与路径之间存在多余空白，无法自动修复，请手动调整。',
        )
        issue.paragraphFinal = paragraphFinal
        issues.push(issue)
        cursor = openParen + 1
        continue
      }

      const paren = scanParenContent(line.text, openParen)
      if (paren.closeIndex < 0) {
        const endInLine = paren.stopIndex >= 0 ? paren.stopIndex : line.text.length
        const partial = paren.content.trim()
        if (partial.startsWith('<') && findUnescaped(partial, '>', 1) < 0) {
          const issue = makeIssue(
            FIGURE_INVALID_DESTINATION_CODE, line, at, endInLine,
            partial, '尖括号包裹的图片路径缺少 `>`，且整体缺少右圆括号，请手动修复。',
          )
          issue.paragraphFinal = paragraphFinal
          issues.push(issue)
          cursor = endInLine
          continue
        }
        const issue = makeIssue(
          FIGURE_UNCLOSED_DESTINATION_CODE, line, at, endInLine,
          partial, null,
        )
        issue.paragraphFinal = paragraphFinal
        issue.repairBoundary = line.contentEnd
        issues.push(issue)
        cursor = endInLine
        continue
      }

      const verdict = validateDestination(paren.content)
      if (verdict.kind === 'invalid') {
        const issue = makeIssue(
          FIGURE_INVALID_DESTINATION_CODE, line, at, paren.closeIndex + 1,
          paren.content.trim(), verdict.reason,
        )
        issue.paragraphFinal = paragraphFinal
        issues.push(issue)
      } else if (verdict.kind === 'malformed') {
        const issue = makeIssue(
          FIGURE_MALFORMED_SYNTAX_CODE, line, at, paren.closeIndex + 1,
          paren.content.trim(), verdict.reason,
        )
        issue.paragraphFinal = paragraphFinal
        issues.push(issue)
      }
      // 'ok' → owned by the normal figure rules; 'empty' → FIGURE_EMPTY_SOURCE.
      cursor = paren.closeIndex + 1
    }
  }

  // §4.1 — a missing `)` may only be appended when the whole paragraph owns
  // EXACTLY ONE syntax issue, the line really ends the paragraph, and no other
  // unclosed structure exists. Otherwise the diagnostic stays manual.
  const issuesByParagraph = new Map<number, MutableIssue[]>()
  for (const issue of issues) {
    const list = issuesByParagraph.get(issue.paragraphStart) ?? []
    list.push(issue)
    issuesByParagraph.set(issue.paragraphStart, list)
  }
  for (const issue of issues) {
    const group = issuesByParagraph.get(issue.paragraphStart) ?? []
    if (issue.code === FIGURE_UNCLOSED_DESTINATION_CODE && issue.refusal == null) {
      if (!issue.paragraphFinal) {
        issue.refusal = '图片语法未在段落结尾闭合，可能还有后续内容，请手动补全 `)`。'
      } else if (group.length !== 1) {
        issue.refusal = '当前段落还存在其他未闭合的图片语法，请手动补全 `)`。'
      } else {
        issue.repair = 'append-closing-paren'
        issue.repairAt = issue.repairBoundary
      }
    }
  }

  return issues.map(({ paragraphStart: _paragraphStart, repairBoundary: _repairBoundary, paragraphFinal: _paragraphFinal, ...issue }) => issue)
}

export interface FigureSyntaxFixOutcome {
  changed: boolean
  text: string
  refusal: string | null
}

/**
 * §4.1/§4.2 — apply the ONE deterministic repair of an issue. The original
 * destination bytes are never rewritten: only `)` or `]` is inserted.
 */
export function buildFigureSyntaxFix(source: string, issue: FigureSyntaxIssue): FigureSyntaxFixOutcome {
  if (source == null || issue == null) {
    return { changed: false, text: source ?? '', refusal: '图片语法信息不可用。' }
  }
  if (issue.repair == null || issue.repairAt == null) {
    return { changed: false, text: source, refusal: issue.refusal ?? '该图片语法无法安全自动修复，请手动补全。' }
  }
  if (issue.repair === 'append-closing-paren') {
    const at = Math.max(0, Math.min(issue.repairAt, source.length))
    return { changed: true, text: source.slice(0, at) + ')' + source.slice(at), refusal: null }
  }
  if (issue.repair === 'insert-closing-bracket') {
    const at = Math.max(0, Math.min(issue.repairAt, source.length))
    return { changed: true, text: source.slice(0, at) + ']' + source.slice(at), refusal: null }
  }
  return { changed: false, text: source, refusal: issue.refusal ?? '该图片语法无法安全自动修复，请手动补全。' }
}

/** Every syntax rule id (used by the fix capability matrix / UI). */
export const FIGURE_SYNTAX_ISSUE_CODES: readonly FigureSyntaxIssueCode[] = [
  FIGURE_UNCLOSED_DESTINATION_CODE,
  FIGURE_UNCLOSED_ALT_CODE,
  FIGURE_MALFORMED_SYNTAX_CODE,
  FIGURE_INVALID_DESTINATION_CODE,
]

/**
 * Document Diagnostics — Markdown FORMAT Integrity (source-level, V1).
 *
 * Three user-visible排版错误 that Typora silently renders "wrong" (never a
 * structural break, so all are WARNINGs):
 *
 *  1. `LIST_EMPTY_ITEM` — a list marker line with NO content (`-` / `1.` alone).
 *     Typora renders an empty bullet that carries no information; deleting the
 *     line restores the intended list.
 *  2. `FORMULA_SINGLE_LINE_BLOCK` — `$$\sum_{i=1}^{n} x_i$$` written on ONE line.
 *     REAL EVIDENCE (Typora 1.6.7, `runtime/gui-acceptance/snap-Z.json`): it is
 *     rendered as a plain `<p>` with the raw `$$…$$` text — `mathBlockCount=0`.
 *     Typora only renders a display formula when `$$` owns its own line.
 *  3. `FIGURE_MIXED_WITH_TEXT` — an image token sharing a paragraph with正文.
 *     The figure object model requires a standalone block (V5.15 invariant).
 *
 * ALL THREE are pure text rules over the EXACT document text (`eofMarkdown`),
 * never the block-level structural serializer (whose fenced-code bodies are DOM
 * text and whose line numbers shift). Literal ranges (fenced / inline code) are
 * excluded so nothing inside code is ever "fixed".
 */
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'
import { computeMarkdownLiteralRanges, isSourceRangeLiteral, type MarkdownLiteralRange } from './document-markdown-literal-exclusion-v1'

export const LIST_EMPTY_ITEM_CODE = 'LIST_EMPTY_ITEM'
export const FORMULA_SINGLE_LINE_BLOCK_CODE = 'FORMULA_SINGLE_LINE_BLOCK'
export const FIGURE_MIXED_WITH_TEXT_CODE = 'FIGURE_MIXED_WITH_TEXT'

/** Registry ↔ producer allow-list (no code outside this list may be emitted). */
export const FORMAT_INTEGRITY_DIAGNOSTIC_CODES: readonly string[] = [
  LIST_EMPTY_ITEM_CODE,
  FORMULA_SINGLE_LINE_BLOCK_CODE,
  FIGURE_MIXED_WITH_TEXT_CODE,
]

export interface FormatIntegrityInput {
  /** The EXACT document text (editor mirror), never the structural serializer. */
  markdown: string
  documentKey: string | null
  sourceRevision?: number | null
}

interface SourceLine {
  /** 0-based. */
  index: number
  text: string
  start: number
  end: number
}

/** `- item` / `* item` / `1. item` / `1) item`, with a leading indent. */
const LIST_MARKER_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/
/** A marker line that carries NO content at all. */
const EMPTY_LIST_MARKER_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]*$/
/** A display formula written on a single line. */
const SINGLE_LINE_FORMULA_RE = /^\s*\$\$(?!\$)(.+?)\$\$\s*$/
/** A Markdown image token (inline / reference-free form). */
const IMAGE_TOKEN_RE = /!\[[^\]]*\]\([^()\s]*(?:\([^)]*\)[^()\s]*)*\)/g

function splitLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  let index = 0
  while (start <= markdown.length) {
    const nl = markdown.indexOf('\n', start)
    if (nl < 0) {
      if (start < markdown.length) {
        const raw = markdown.slice(start)
        lines.push({ index, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start, end: markdown.length })
      }
      break
    }
    const raw = markdown.slice(start, nl)
    lines.push({
      index,
      text: raw.endsWith('\r') ? raw.slice(0, -1) : raw,
      start,
      end: nl + 1,
    })
    start = nl + 1
    index++
  }
  return lines
}

function isBlank(text: string): boolean {
  return text.trim() === ''
}

function literalRanges(markdown: string): ReturnType<typeof computeMarkdownLiteralRanges> {
  try {
    return computeMarkdownLiteralRanges(markdown)
  } catch {
    return []
  }
}

function inLiteral(markdown: string, ranges: readonly MarkdownLiteralRange[], line: SourceLine): boolean {
  void markdown
  try {
    return isSourceRangeLiteral(ranges, line.start, line.end)
  } catch {
    return false
  }
}

function sourceLocation(line: SourceLine, rawText: string): DiagnosticLocation {
  return {
    kind: 'source-range',
    startLine: line.index + 1,
    startColumn: 0,
    endLine: line.index + 1,
    endColumn: line.text.length,
    rawText,
  }
}

function makeDiagnostic(
  input: FormatIntegrityInput,
  spec: {
    code: string
    category: DocumentDiagnostic['category']
    message: string
    detail: string
    line: SourceLine
    metadata: Record<string, unknown>
  },
): DocumentDiagnostic {
  const docKey = input.documentKey ?? ''
  const identity = `${spec.code}:line:${spec.line.index + 1}`
  return {
    domain: 'document',
    id: `${docKey}::${spec.code}::line:${spec.line.index + 1}`,
    documentKey: docKey,
    severity: 'warning',
    category: spec.category,
    code: spec.code,
    message: spec.message,
    detail: spec.detail,
    stableIdentity: identity,
    targetIdentity: identity,
    metadata: {
      ...spec.metadata,
      lineNumber: spec.line.index,
      lineText: spec.line.text,
      sourceRevision: input.sourceRevision ?? null,
    },
    location: sourceLocation(spec.line, spec.line.text),
  }
}

/** Split one line into alternating text / image segments (whitespace trimmed). */
export function splitImageSegments(text: string): string[] {
  const segments: string[] = []
  let cursor = 0
  IMAGE_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMAGE_TOKEN_RE.exec(text)) != null) {
    const before = text.slice(cursor, match.index).trim()
    if (before !== '') segments.push(before)
    segments.push(match[0])
    cursor = match.index + match[0].length
  }
  const after = text.slice(cursor).trim()
  if (after !== '') segments.push(after)
  return segments
}

/** True when a line carries an image token AND other visible text. */
export function isImageMixedWithText(text: string): boolean {
  const segments = splitImageSegments(text)
  return segments.length > 1 && segments.some(s => !s.startsWith('!['))
}

/** A list marker line with no content (the ONE empty-item shape). */
export function isEmptyListMarker(text: string): boolean {
  return EMPTY_LIST_MARKER_RE.test(text)
}

/** The inner LaTeX source when the line is a single-line `$$…$$` display formula. */
export function singleLineDisplayFormulaSource(text: string): string | null {
  const match = SINGLE_LINE_FORMULA_RE.exec(text)
  return match == null ? null : match[1]
}

export function computeFormatIntegrityDiagnostics(input: FormatIntegrityInput): DocumentDiagnostic[] {
  const out: DocumentDiagnostic[] = []
  const markdown = input.markdown
  if (typeof markdown !== 'string' || markdown.trim() === '') return out
  const lines = splitLines(markdown)
  const ranges = literalRanges(markdown)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isBlank(line.text)) continue
    if (inLiteral(markdown, ranges, line)) continue

    // ── 1. Empty list item ────────────────────────────────────────────────
    if (EMPTY_LIST_MARKER_RE.test(line.text)) {
      // `- ` followed by a MORE-indented block is a legal parent item that owns
      // child content (CommonMark) — never an empty item.
      const next = lines[i + 1] ?? null
      const ownsChild = next != null
        && !isBlank(next.text)
        && leadingIndent(next.text) > leadingIndent(line.text)
      if (!ownsChild) {
        const marker = (EMPTY_LIST_MARKER_RE.exec(line.text)?.[2] ?? '-')
        out.push(makeDiagnostic(input, {
          code: LIST_EMPTY_ITEM_CODE,
          category: 'document',
          message: '列表项为空',
          detail: `第 ${line.index + 1} 行只有列表标记「${marker}」，没有任何内容；删除该行可恢复列表结构。`,
          line,
          metadata: { reason: 'EMPTY_LIST_ITEM', marker },
        }))
        continue
      }
    }

    // ── 2. Single-line display formula ────────────────────────────────────
    const formula = SINGLE_LINE_FORMULA_RE.exec(line.text)
    if (formula != null) {
      const previous = lines[i - 1] ?? null
      const next = lines[i + 1] ?? null
      const ownsParagraph = (previous == null || isBlank(previous.text))
        && (next == null || isBlank(next.text))
      if (ownsParagraph && formula[1].trim() !== '') {
        out.push(makeDiagnostic(input, {
          code: FORMULA_SINGLE_LINE_BLOCK_CODE,
          category: 'formula',
          message: '单行公式不会被渲染',
          detail: `第 ${line.index + 1} 行的 \`$$…$$\` 写在了一行内，Typora 会把它当作普通文字；需拆成 \`$$\`、公式、\`$$\` 三行。`,
          line,
          metadata: { reason: 'SINGLE_LINE_DISPLAY_FORMULA', formulaSource: formula[1] },
        }))
        continue
      }
    }

    // ── 3. Image mixed with text ──────────────────────────────────────────
    if (line.text.includes('![') && isImageMixedWithText(line.text)) {
      // List / quote images are owned by the structure rules, never duplicated here.
      const container = containerMarkerOf(line.text)
      if (container == null) {
        const segmentCount = splitImageSegments(line.text).length
        out.push(makeDiagnostic(input, {
          code: FIGURE_MIXED_WITH_TEXT_CODE,
          category: 'figure',
          message: '图片与正文混排',
          detail: `第 ${line.index + 1} 行的图片与文字在同一段落内；分段后可拆成 ${segmentCount} 个独立块。`,
          line,
          metadata: { reason: 'FIGURE_MIXED_WITH_TEXT', segmentCount },
        }))
      }
    }
  }

  return out
}

function leadingIndent(text: string): number {
  let n = 0
  for (const ch of text) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

/** `-` / `*` / `+` / `1.` / `>` prefix, or null when the line is a plain paragraph. */
function containerMarkerOf(text: string): string | null {
  if (LIST_MARKER_RE.test(text)) return 'list'
  if (/^\s*>/.test(text)) return 'quote'
  return null
}

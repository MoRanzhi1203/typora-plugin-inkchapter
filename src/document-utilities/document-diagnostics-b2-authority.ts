/**
 * B2 §B2-01/02/03/06 — source-only analyzers for the new rule families.
 *
 * Pure: no DOM, no filesystem, no host state. Every analyzer returns PROVABLE
 * facts; when the source shape cannot be proven the result is empty (never a
 * guessed warning).
 */
import { buildSourceLineSpans, isRangeProtected, parseDocumentSourceSyntax, splitTableRow } from './document-source-syntax-authority'
import { analyzeDisplayFormulaBlocks } from './document-diagnostics-vnext-authority'

export const B2_FORMULA_SOURCE_LENGTH_LIMIT = 300
export const B2_FORMULA_SOURCE_LINE_LIMIT = 120

export interface SourceIssueSpan {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  rawText: string
  detail: string
}

function lineText(markdown: string, line: number): string {
  const lines = markdown.split('\n')
  const raw = lines[line] ?? ''
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw
}

// ── B2-01 — Front Matter YAML subset validation ─────────────────────────────

export interface FrontMatterSyntaxIssue {
  /** 0-based line relative to the front-matter BODY (excluding the delimiter). */
  bodyLine: number
  code: 'TAB_INDENTATION' | 'DUPLICATE_KEY' | 'MISSING_COLON'
  message: string
}

/**
 * Conservative YAML mapping validation for the subset a Typora front matter
 * actually uses. It only reports PROVABLE syntax problems:
 *   - a tab used for indentation;
 *   - a duplicate top-level key;
 *   - a non-comment top-level line that is neither `key:` nor a list item.
 *
 * Indented lines, block scalars and flow collections are deliberately not
 * parsed further: a partial YAML parser must never fabricate an error. A real
 * YAML parser is still the long-term authority; this is the safe subset.
 */
export function analyzeFrontMatterBody(body: string): FrontMatterSyntaxIssue[] {
  const issues: FrontMatterSyntaxIssue[] = []
  const seen = new Set<string>()
  const lines = body.split('\n')
  let blockScalarIndent: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    const indentMatch = /^[ \t]*/.exec(raw)
    const indentText = indentMatch?.[0] ?? ''
    if (indentText.includes('\t')) {
      issues.push({ bodyLine: i, code: 'TAB_INDENTATION', message: 'Front Matter 缩进包含 Tab。' })
      continue
    }
    // A block scalar (`key: |` / `key: >`) owns every following indented line.
    if (blockScalarIndent != null) {
      if (indentText.length > blockScalarIndent) continue
      blockScalarIndent = null
    }
    if (indentText.length > 0) continue // nested mapping / sequence: do not judge
    if (/^\s*-\s+/.test(raw)) continue // top-level sequence item
    const keyMatch = /^([^\s:#][^:#]*?)\s*:\s*(.*)$/.exec(raw)
    if (!keyMatch) {
      issues.push({ bodyLine: i, code: 'MISSING_COLON', message: 'Front Matter 顶层行缺少键值分隔冒号。' })
      continue
    }
    const key = keyMatch[1].trim()
    if (seen.has(key)) {
      issues.push({ bodyLine: i, code: 'DUPLICATE_KEY', message: `Front Matter 顶层键「${key}」重复。` })
      continue
    }
    seen.add(key)
    const value = keyMatch[2].trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>' || value === '|+' || value === '>+') {
      blockScalarIndent = indentText.length
    }
  }
  return issues
}

// ── B2-02 — table column count ──────────────────────────────────────────────

export interface TableColumnMismatch extends SourceIssueSpan {
  expected: number
  actual: number
  identity: string
}

/**
 * A GFM table's header, delimiter and every body row must expose the SAME cell
 * count. Escaped pipes / inline code are handled by `splitTableRow` (the ONE
 * table tokenizer); protected ranges (fences / formulas / front matter) are
 * never table candidates.
 */
export function analyzeTableColumnMismatches(markdown: string | null | undefined): TableColumnMismatch[] {
  if (markdown == null || markdown === '') return []
  const syntax = parseDocumentSourceSyntax(markdown)
  const lines = buildSourceLineSpans(markdown)
  const out: TableColumnMismatch[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]
    const delimiter = lines[i + 1]
    if (header.blank || !header.text.includes('|')) continue
    if (!delimiter.text.includes('|') || !/-/.test(delimiter.text)) continue
    const headerRange = { start: header.start, end: header.contentEnd }
    if (isRangeProtected(syntax, headerRange.start, headerRange.end)) continue
    const headerCells = splitTableRow(header)
    if (headerCells.length === 0) continue
    const expected = headerCells.length
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j]
      if (row.blank || !row.text.includes('|')) break
      const isDelimiter = j === i + 1
      const cells = splitTableRow(row)
      if (cells.length !== expected) {
        out.push({
          startLine: row.index,
          startColumn: 0,
          endLine: row.index,
          endColumn: row.text.length,
          rawText: row.text,
          identity: `table-col:${header.start}:${row.index}`,
          expected,
          actual: cells.length,
          detail: isDelimiter
            ? `表头有 ${expected} 列，分隔行有 ${cells.length} 列。`
            : `表头有 ${expected} 列，该数据行有 ${cells.length} 列。`,
        })
        break // one diagnostic per table is enough; the first mismatch is the root
      }
    }
  }
  return out
}

// ── B2-03 — list indentation (conservative tree) ────────────────────────────

export interface ListIndentIssue extends SourceIssueSpan {
  indent: number
  expected: string
}

function indentWidth(text: string): number {
  let width = 0
  for (const ch of text) width += ch === '\t' ? 4 : 1
  return width
}

/**
 * Conservative list-tree indentation check. It only reports a DEDENT to an
 * indentation that never existed in the current list stack (e.g. parent 0,
 * child 2, next sibling 1). This is provably inconsistent regardless of the
 * legal Markdown allowance for 1–3 space continuation indents.
 *
 * A blank line ends the current list run; fenced / formula / front-matter
 * protected lines are never list items. Mixed markers and ordered lists that
 * start at a non-1 number are deliberately NOT errors.
 */
export function analyzeListIndentation(markdown: string | null | undefined): ListIndentIssue[] {
  if (markdown == null || markdown === '') return []
  const syntax = parseDocumentSourceSyntax(markdown)
  const lines = buildSourceLineSpans(markdown)
  const out: ListIndentIssue[] = []
  let stack: number[] = []
  let inRun = false
  const itemRe = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/
  for (const line of lines) {
    if (line.blank) {
      inRun = false
      stack = []
      continue
    }
    if (isRangeProtected(syntax, line.start, line.contentEnd)) {
      inRun = false
      stack = []
      continue
    }
    const m = itemRe.exec(line.text)
    if (!m) {
      inRun = false
      stack = []
      continue
    }
    const indent = indentWidth(m[1])
    if (!inRun) {
      inRun = true
      stack = [indent]
      continue
    }
    if (indent > stack[stack.length - 1]) {
      stack.push(indent)
      continue
    }
    if (stack.includes(indent)) {
      while (stack.length > 0 && stack[stack.length - 1] > indent) stack.pop()
      continue
    }
    out.push({
      startLine: line.index,
      startColumn: 0,
      endLine: line.index,
      endColumn: line.text.length,
      rawText: line.text,
      indent,
      expected: stack.map(n => String(n)).join(' / '),
      detail: `列表项缩进 ${indent} 与当前父级/同级缩进（${stack.join(' / ')}）不一致。`,
    })
    // Recover at the nearest existing level so one bad line does not cascade.
    while (stack.length > 0 && stack[stack.length - 1] > indent) stack.pop()
    if (stack.length === 0) stack = [indent]
  }
  return out
}

// ── B2-05 — image format support (conservative, source-only) ───────────────

/**
 * Explicit NON-image file extensions. Deliberately NOT an allow-list: an
 * unknown/new image extension (avif, jxl, …) never reports. Only a destination
 * that PROVABLY points at a non-image document is flagged.
 */
export const NON_IMAGE_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z', 'tar', 'gz',
  'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv',
  'html', 'htm', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'css', 'scss',
])

export interface ImageFormatSupportIssue {
  extension: string
  destination: string
}

/**
 * A Markdown image destination is a non-image file when its path ends with one
 * of the EXPLICIT non-image extensions. Query / fragment / percent encoding are
 * stripped first. No extension or an unknown extension → no verdict.
 */
export function detectNonImageDestination(rawDestination: string | null | undefined): ImageFormatSupportIssue | null {
  const raw = String(rawDestination ?? '').trim()
  if (raw === '' || /^(?:https?:|data:|blob:)/i.test(raw)) return null
  let path = raw.split('#')[0].split('?')[0]
  try { path = decodeURIComponent(path) } catch { /* keep raw */ }
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  const ext = base.slice(dot + 1).toLowerCase()
  if (!NON_IMAGE_FILE_EXTENSIONS.includes(ext)) return null
  return { extension: ext, destination: raw }
}

// ── B2-06 — formula source metrics ──────────────────────────────────────────

export interface FormulaSourceMetric extends SourceIssueSpan {
  ordinal: number
  charCount: number
  maxLineLength: number
  longLineIndex: number
  canonicalIdentity: string
}

function stripFormulaNumberMarkers(body: string): string {
  // `\tag{...}` is an auto/manual numbering marker, not mathematical content.
  return body.replace(/\\tag\{[^}]*\}/g, '')
}

/**
 * Extract display-formula bodies and their source metrics. Inline `$…$` math is
 * never considered. Unicode is counted by code point (not UTF-16 units).
 */
export function analyzeFormulaSourceMetrics(markdown: string | null | undefined): FormulaSourceMetric[] {
  if (markdown == null || markdown === '') return []
  const spans = analyzeDisplayFormulaBlocks(markdown)
  const out: FormulaSourceMetric[] = []
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (span.empty) continue
    const lines: string[] = []
    for (let l = span.startLine; l <= span.endLine; l++) lines.push(lineText(markdown, l))
    let body = lines.join('\n')
    const firstOpen = body.indexOf('$$')
    if (firstOpen >= 0) body = body.slice(firstOpen + 2)
    const lastClose = body.lastIndexOf('$$')
    if (lastClose >= 0) body = body.slice(0, lastClose)
    body = stripFormulaNumberMarkers(body)
    const bodyLines = body.split('\n').map(l => l.trim())
    const charCount = [...body.replace(/\s+/g, '')].length
    let maxLineLength = 0
    let longLineIndex = 0
    for (let k = 0; k < bodyLines.length; k++) {
      const len = [...bodyLines[k]].length
      if (len > maxLineLength) {
        maxLineLength = len
        longLineIndex = k
      }
    }
    out.push({
      startLine: span.startLine,
      startColumn: span.startColumn,
      endLine: span.endLine,
      endColumn: span.endColumn,
      rawText: span.rawText,
      ordinal: i,
      charCount,
      maxLineLength,
      longLineIndex,
      canonicalIdentity: `block:formula:${i}`,
      detail: `${charCount} 字符 / 最长行 ${maxLineLength} 字符`,
    })
  }
  return out
}

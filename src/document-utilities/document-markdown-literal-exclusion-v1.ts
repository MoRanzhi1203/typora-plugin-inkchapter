/**
 * V1 — Markdown LITERAL EXCLUSION authority (pure contract).
 *
 * THE DEFECT (proved by the real runtime):
 *   the resource scanner runs a raw `!\[..\]\(..\)` regex over the WHOLE
 *   Markdown, so syntax that is only *literal text* — `` `![](a.png)` ``,
 *   a fenced example block, an indented code line — was admitted as a real
 *   Figure / Link / Resource candidate. That produced
 *   `FIGURE_BLOCK_STRUCTURE_INVALID` ("图片块格式不规范"), `FIGURE_MISSING_NAME`,
 *   `FIGURE_LOCAL_IMAGE_MISSING` and resource resolution for text examples.
 *
 *   ROOT_1 = IMAGE_SCANNER_RUNS_ON_RAW_TEXT_WITHOUT_INLINE_CODE_EXCLUSION
 *   ROOT_2 = LINK_RESOURCE_SCANNER_REUSES_THE_SAME_RAW_TOKEN_SCAN
 *   ROOT_3 = STANDALONE_OBJECT_BLOCK_INVARIANT_RECEIVES_A_POLLUTED_CANDIDATE_SET
 *   ROOT_4 = LITERAL_PSEUDO_TOKENS_REACH_DIAGNOSTICS
 *   ROOT_5 = LITERAL_PSEUDO_TOKENS_REACH_NUMBERING_CAPTION_LOCATOR
 *   ROOT_6 = NO_HARD_GATE_PROVES_LITERAL_SYNTAX_IS_INVISIBLE_TO_BUSINESS
 *
 * THE INVARIANT (Parser Exclusion Before Candidate Discovery):
 *
 *   Markdown source → literal/code ranges → exclusion → token scan
 *   → filter any token intersecting an exclusion range → real candidates
 *
 * A token is EXCLUDED when the ranges OVERLAP:
 *   candidateStart < literalEnd && candidateEnd > literalStart
 * (never a start-offset-only test).
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'

// ── §11 — the literal range model ─────────────────────────

export type MarkdownLiteralKind = 'inline-code' | 'fenced-code' | 'indented-code'

export interface MarkdownLiteralRange {
  /** Absolute Markdown offset of the first character (inclusive). */
  start: number
  /** Absolute Markdown offset AFTER the last character (exclusive). */
  end: number
  kind: MarkdownLiteralKind
}

/** §26 — the ONE literal exclusion audit. */
export const MARKDOWN_LITERAL_EXCLUSION_AUDIT = 'MARKDOWN-LITERAL-EXCLUSION-AUDIT'
/** §27 — the Figure-scoped literal exclusion audit. */
export const FIGURE_LITERAL_EXCLUSION_AUDIT = 'FIGURE-LITERAL-EXCLUSION-AUDIT'

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const INDENTED_CODE_RE = /^(?: {4}|\t)/

interface LineSpan {
  index: number
  start: number
  /** Offset AFTER the line break (exclusive). */
  end: number
  /** Offset of the line content end (excludes CR / line break). */
  contentEnd: number
  text: string
  blank: boolean
}

function buildLineSpans(markdown: string): LineSpan[] {
  const lines: LineSpan[] = []
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

/**
 * §7 — fenced code blocks. A fence opens with 3+ backticks / tildes (≤3 leading
 * spaces) and closes with a fence of the SAME character and at least the same
 * length; an unclosed fence runs to the end of the document.
 */
function computeFencedRanges(lines: readonly LineSpan[]): MarkdownLiteralRange[] {
  const out: MarkdownLiteralRange[] = []
  let open: { char: string; length: number; start: number } | null = null
  for (const line of lines) {
    const m = FENCE_OPEN_RE.exec(line.text)
    if (open == null) {
      if (!m) continue
      open = { char: m[1][0], length: m[1].length, start: line.start }
      continue
    }
    const closer = m != null && m[1][0] === open.char && m[1].length >= open.length
    if (!closer) continue
    out.push({ start: open.start, end: line.end, kind: 'fenced-code' })
    open = null
  }
  if (open != null) out.push({ start: open.start, end: lines[lines.length - 1]?.end ?? open.start, kind: 'fenced-code' })
  return out
}

/** True when the offset falls inside ANY of the given ranges. */
function insideAny(ranges: readonly MarkdownLiteralRange[], offset: number): boolean {
  return ranges.some(r => offset >= r.start && offset < r.end)
}

/**
 * §9 — indented code: a run of ≥1 lines indented by 4+ spaces / a tab that
 * STARTS right after a blank line (or the document start) and is NOT inside a
 * fence. Deliberately conservative: a list continuation / lazy paragraph
 * continuation is never treated as code.
 */
function computeIndentedRanges(
  lines: readonly LineSpan[],
  excluded: readonly MarkdownLiteralRange[],
): MarkdownLiteralRange[] {
  const out: MarkdownLiteralRange[] = []
  let runStart: number | null = null
  let runEnd = 0
  let previousWasBlank = true
  const flush = (): void => {
    if (runStart != null) out.push({ start: runStart, end: runEnd, kind: 'indented-code' })
    runStart = null
  }
  for (const line of lines) {
    if (insideAny(excluded, line.start)) {
      flush()
      previousWasBlank = false
      continue
    }
    if (line.blank) {
      flush()
      previousWasBlank = true
      continue
    }
    const indented = INDENTED_CODE_RE.test(line.text)
    if (indented && (runStart != null || previousWasBlank)) {
      if (runStart == null) runStart = line.start
      runEnd = line.contentEnd
    } else {
      flush()
    }
    previousWasBlank = false
  }
  flush()
  return out
}

/**
 * §4/§22 — inline code spans (CommonMark backtick runs). A span opens with a
 * run of N backticks and closes with the NEXT run of EXACTLY N backticks; an
 * unmatched run is literal text, not a code span. Spans never start inside a
 * fence / indented code range.
 */
function computeInlineCodeRanges(
  markdown: string,
  excluded: readonly MarkdownLiteralRange[],
): MarkdownLiteralRange[] {
  const out: MarkdownLiteralRange[] = []
  for (let i = 0; i < markdown.length; i++) {
    if (markdown.charCodeAt(i) !== 96) continue
    if (insideAny(out, i) || insideAny(excluded, i)) continue
    let runEnd = i
    while (runEnd < markdown.length && markdown.charCodeAt(runEnd) === 96) runEnd++
    const runLength = runEnd - i
    // Find the next run of EXACTLY the same length.
    let cursor = runEnd
    let closed: number | null = null
    while (cursor < markdown.length) {
      const next = markdown.indexOf('`', cursor)
      if (next < 0) break
      let end = next
      while (end < markdown.length && markdown.charCodeAt(end) === 96) end++
      if (end - next === runLength) {
        closed = end
        break
      }
      cursor = end
    }
    if (closed == null) {
      i = runEnd - 1
      continue
    }
    out.push({ start: i, end: closed, kind: 'inline-code' })
    i = closed - 1
  }
  return out
}

/**
 * §11/§13 — the ONE literal exclusion authority: every literal/code source range
 * of the Markdown, in document order, in the SAME absolute coordinate system the
 * resource scanner uses.
 */
export function computeMarkdownLiteralRanges(markdown: string): MarkdownLiteralRange[] {
  if (!markdown) return []
  const lines = buildLineSpans(markdown)
  const fenced = computeFencedRanges(lines)
  const indented = computeIndentedRanges(lines, fenced)
  const block = [...fenced, ...indented].sort((a, b) => a.start - b.start)
  const inline = computeInlineCodeRanges(markdown, block)
  return [...block, ...inline].sort((a, b) => a.start - b.start)
}

/**
 * §12 — a candidate `[start,end)` is literal when it OVERLAPS any literal range.
 * Never a start-offset-only test.
 */
export function isSourceRangeLiteral(
  ranges: readonly MarkdownLiteralRange[],
  start: number,
  end: number,
): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true
  }
  return false
}

/** The literal kind at an offset (null when the offset is not literal). */
export function literalKindAt(
  ranges: readonly MarkdownLiteralRange[],
  offset: number,
): MarkdownLiteralKind | null {
  const hit = ranges.find(r => offset >= r.start && offset < r.end)
  return hit ? hit.kind : null
}

// ── §28/§34/§40 — the hard gates ──────────────────────────

export const FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS = [
  'codeLiteralImageSyntaxAdmittedAsFigure',
  'codeLiteralLinkSyntaxAdmittedAsLink',
  'codeLiteralImageResourceResolution',
  'codeLiteralFigureMissingName',
  'codeLiteralFigureLocalImageMissing',
  'codeLiteralFigureStructureInvalid',
  'codeLiteralFigureNumbered',
  'codeLiteralFigureCaptioned',
  'codeLiteralFigureLocatorTarget',
  'codeLiteralImageMixedWithText',
  'fencedCodeImageSyntaxAdmittedAsFigure',
  'fencedCodeLinkSyntaxAdmittedAsLink',
  'fencedCodeResourceResolution',
  'fencedCodeFigureDiagnostic',
  'realImageOutsideLiteralRejected',
  'realLinkOutsideLiteralRejected',
  'inlineCodeImageFalsePositive',
  'inlineCodeLinkFalsePositive',
  'fencedCodeImageFalsePositive',
  'fencedCodeLinkFalsePositive',
  'literalResourceFalsePositive',
  'literalFigureDiagnosticFalsePositive',
  'literalFigureNumberingFalsePositive',
  'literalFigureCaptionFalsePositive',
  'realFigureRegression',
] as const

export type FigureLiteralExclusionV1GateKey = typeof FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS[number]

export const FIGURE_LITERAL_EXCLUSION_V1_GATE_LABELS: Readonly<Record<FigureLiteralExclusionV1GateKey, string>> = {
  codeLiteralImageSyntaxAdmittedAsFigure: 'CODE_LITERAL_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT',
  codeLiteralLinkSyntaxAdmittedAsLink: 'CODE_LITERAL_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT',
  codeLiteralImageResourceResolution: 'CODE_LITERAL_IMAGE_RESOURCE_RESOLUTION_COUNT',
  codeLiteralFigureMissingName: 'CODE_LITERAL_FIGURE_MISSING_NAME_COUNT',
  codeLiteralFigureLocalImageMissing: 'CODE_LITERAL_FIGURE_LOCAL_IMAGE_MISSING_COUNT',
  codeLiteralFigureStructureInvalid: 'CODE_LITERAL_FIGURE_STRUCTURE_INVALID_COUNT',
  codeLiteralFigureNumbered: 'CODE_LITERAL_FIGURE_NUMBERED_COUNT',
  codeLiteralFigureCaptioned: 'CODE_LITERAL_FIGURE_CAPTIONED_COUNT',
  codeLiteralFigureLocatorTarget: 'CODE_LITERAL_FIGURE_LOCATOR_TARGET_COUNT',
  codeLiteralImageMixedWithText: 'IMAGE_MIXED_WITH_TEXT_FROM_CODE_LITERAL_COUNT',
  fencedCodeImageSyntaxAdmittedAsFigure: 'FENCED_CODE_IMAGE_SYNTAX_ADMITTED_AS_FIGURE_COUNT',
  fencedCodeLinkSyntaxAdmittedAsLink: 'FENCED_CODE_LINK_SYNTAX_ADMITTED_AS_LINK_COUNT',
  fencedCodeResourceResolution: 'FENCED_CODE_RESOURCE_RESOLUTION_COUNT',
  fencedCodeFigureDiagnostic: 'FENCED_CODE_FIGURE_DIAGNOSTIC_COUNT',
  realImageOutsideLiteralRejected: 'REAL_IMAGE_OUTSIDE_LITERAL_REJECTED_COUNT',
  realLinkOutsideLiteralRejected: 'REAL_LINK_OUTSIDE_LITERAL_REJECTED_COUNT',
  inlineCodeImageFalsePositive: 'INLINE_CODE_IMAGE_FALSE_POSITIVE_COUNT',
  inlineCodeLinkFalsePositive: 'INLINE_CODE_LINK_FALSE_POSITIVE_COUNT',
  fencedCodeImageFalsePositive: 'FENCED_CODE_IMAGE_FALSE_POSITIVE_COUNT',
  fencedCodeLinkFalsePositive: 'FENCED_CODE_LINK_FALSE_POSITIVE_COUNT',
  literalResourceFalsePositive: 'LITERAL_RESOURCE_FALSE_POSITIVE_COUNT',
  literalFigureDiagnosticFalsePositive: 'LITERAL_FIGURE_DIAGNOSTIC_FALSE_POSITIVE_COUNT',
  literalFigureNumberingFalsePositive: 'LITERAL_FIGURE_NUMBERING_FALSE_POSITIVE_COUNT',
  literalFigureCaptionFalsePositive: 'LITERAL_FIGURE_CAPTION_FALSE_POSITIVE_COUNT',
  realFigureRegression: 'REAL_FIGURE_REGRESSION_COUNT',
}

export type FigureLiteralExclusionV1Counters = Record<FigureLiteralExclusionV1GateKey, number>

export function createFigureLiteralExclusionV1Counters(): FigureLiteralExclusionV1Counters {
  return FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FigureLiteralExclusionV1Counters)
}

export function formatFigureLiteralExclusionV1GateReport(
  counters: Readonly<FigureLiteralExclusionV1Counters>,
): string[] {
  return FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS.map(k => `${FIGURE_LITERAL_EXCLUSION_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateFigureLiteralExclusionV1Gates(
  counters: Readonly<FigureLiteralExclusionV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: FigureLiteralExclusionV1GateKey[] } {
  const failedChecks = FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §26/§27 — the audit facts ─────────────────────────────

export interface LiteralExclusionFacts {
  inlineCodeRangeCount: number
  fencedCodeRangeCount: number
  indentedCodeRangeCount: number
  rawImageSyntaxMatchCount: number
  rawLinkSyntaxMatchCount: number
  excludedImageCandidateCount: number
  excludedLinkCandidateCount: number
  admittedImageCandidateCount: number
  admittedLinkCandidateCount: number
  excludedImageByInlineCodeCount: number
  excludedImageByFenceCount: number
  excludedImageByIndentedCodeCount: number
}

const RAW_REFERENCE_RE = /(!?)\[([^\]]*)\]\(([^)]+)\)/g

/**
 * §26 — compute the raw vs excluded vs admitted counts with the SAME overlap
 * rule the scanner uses. Exposed so the audit and the tests share ONE authority.
 */
export function computeLiteralExclusionFacts(markdown: string): LiteralExclusionFacts {
  const ranges = computeMarkdownLiteralRanges(markdown)
  const facts: LiteralExclusionFacts = {
    inlineCodeRangeCount: ranges.filter(r => r.kind === 'inline-code').length,
    fencedCodeRangeCount: ranges.filter(r => r.kind === 'fenced-code').length,
    indentedCodeRangeCount: ranges.filter(r => r.kind === 'indented-code').length,
    rawImageSyntaxMatchCount: 0,
    rawLinkSyntaxMatchCount: 0,
    excludedImageCandidateCount: 0,
    excludedLinkCandidateCount: 0,
    admittedImageCandidateCount: 0,
    admittedLinkCandidateCount: 0,
    excludedImageByInlineCodeCount: 0,
    excludedImageByFenceCount: 0,
    excludedImageByIndentedCodeCount: 0,
  }
  const re = new RegExp(RAW_REFERENCE_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const isImage = m[1] === '!'
    const start = m.index
    const end = m.index + m[0].length
    if (isImage) facts.rawImageSyntaxMatchCount++
    else facts.rawLinkSyntaxMatchCount++
    const kind = ranges.find(r => start < r.end && end > r.start)?.kind ?? null
    if (kind == null) {
      if (isImage) facts.admittedImageCandidateCount++
      else facts.admittedLinkCandidateCount++
      continue
    }
    if (isImage) {
      facts.excludedImageCandidateCount++
      if (kind === 'inline-code') facts.excludedImageByInlineCodeCount++
      else if (kind === 'fenced-code') facts.excludedImageByFenceCount++
      else facts.excludedImageByIndentedCodeCount++
    } else {
      facts.excludedLinkCandidateCount++
    }
  }
  return facts
}

/** §19 — every locatable source offset a diagnostic carries (for overlap tests). */
function diagnosticSourceRanges(d: DocumentDiagnostic): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  const loc: DiagnosticLocation | undefined = d.location
  const push = (s: unknown, e: unknown): void => {
    if (typeof s === 'number' && typeof e === 'number' && e > s) out.push({ start: s, end: e })
  }
  if (loc) {
    if (loc.kind === 'source-range' || loc.kind === 'figure-occurrence') {
      push(loc.sourceStart, loc.sourceEnd)
      push(loc.tokenStart, loc.tokenEnd)
      push(loc.destinationStart, loc.destinationEnd)
    } else if (loc.kind === 'source-block') {
      push(loc.sourceStart, loc.sourceEnd)
    }
  }
  const m = (d.metadata ?? {}) as Record<string, unknown>
  push(m.sourceStart, m.sourceEnd)
  push(m.tokenStart, m.tokenEnd)
  push(m.destinationStart, m.destinationEnd)
  return out
}

/**
 * §28/§34 — evaluate the literal exclusion gates against the CURRENT document's
 * diagnostics + markdown. A diagnostic that overlaps a literal range is a REAL
 * false positive, never a heuristic.
 */
export function evaluateLiteralExclusionAgainstDiagnostics(input: {
  markdown: string | null
  diagnostics: readonly DocumentDiagnostic[]
  /** The scanner's REAL admitted counts (from the ONE resource scanner). */
  admittedImageCount?: number
  admittedLinkCount?: number
  /**
   * The scanner's REAL admitted spans (absolute offsets, post-exclusion). A
   * BLOCK-level structure diagnostic is only a literal false positive when the
   * block owns NO admitted real image token.
   */
  admittedSpans?: ReadonlyArray<{ start: number; end: number; resourceKind: 'image' | 'link' }>
}): {
  counters: FigureLiteralExclusionV1Counters
  facts: LiteralExclusionFacts
  literalFalsePositiveDiagnosticIds: string[]
} {
  const counters = createFigureLiteralExclusionV1Counters()
  const markdown = input.markdown ?? ''
  const ranges = computeMarkdownLiteralRanges(markdown)
  const facts = computeLiteralExclusionFacts(markdown)
  const literalDiagIds: string[] = []
  const admittedImages = input.admittedSpans?.filter(s => s.resourceKind === 'image') ?? []

  for (const d of input.diagnostics) {
    const rangesOf = diagnosticSourceRanges(d)
    if (!rangesOf.some(r => isSourceRangeLiteral(ranges, r.start, r.end))) continue
    if (d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID') {
      // §10/§24 — a block whose owning span CONTAINS an admitted real image is a
      // legitimate mixed block (the literal range merely sits inside it). Only a
      // block that owns NO real image at all is a literal false positive.
      const blockSpan = rangesOf.reduce(
        (acc, r) => ({ start: Math.min(acc.start, r.start), end: Math.max(acc.end, r.end) }),
        { start: Number.MAX_SAFE_INTEGER, end: -1 },
      )
      const ownsRealImage = admittedImages.some(s => s.start >= blockSpan.start && s.end <= blockSpan.end)
      if (ownsRealImage) continue
    }
    literalDiagIds.push(d.id)
    switch (d.code) {
      case 'FIGURE_MISSING_NAME':
        counters.codeLiteralFigureMissingName++
        counters.literalFigureDiagnosticFalsePositive++
        counters.inlineCodeImageFalsePositive++
        break
      case 'FIGURE_LOCAL_IMAGE_MISSING':
        counters.codeLiteralFigureLocalImageMissing++
        counters.literalFigureDiagnosticFalsePositive++
        counters.literalResourceFalsePositive++
        counters.codeLiteralImageResourceResolution++
        counters.inlineCodeImageFalsePositive++
        break
      case 'FIGURE_BLOCK_STRUCTURE_INVALID':
        counters.codeLiteralFigureStructureInvalid++
        counters.literalFigureDiagnosticFalsePositive++
        counters.codeLiteralImageMixedWithText++
        counters.inlineCodeImageFalsePositive++
        break
      case 'LINK_LOCAL_TARGET_MISSING':
        counters.codeLiteralLinkSyntaxAdmittedAsLink++
        counters.literalResourceFalsePositive++
        counters.inlineCodeLinkFalsePositive++
        break
      default:
        break
    }
  }

  const admittedImageCount = typeof input.admittedImageCount === 'number' ? input.admittedImageCount : facts.admittedImageCandidateCount
  const admittedLinkCount = typeof input.admittedLinkCount === 'number' ? input.admittedLinkCount : facts.admittedLinkCandidateCount
  counters.realImageOutsideLiteralRejected = Math.max(0, facts.admittedImageCandidateCount - admittedImageCount)
  counters.realLinkOutsideLiteralRejected = Math.max(0, facts.admittedLinkCandidateCount - admittedLinkCount)
  return { counters, facts, literalFalsePositiveDiagnosticIds: literalDiagIds }
}

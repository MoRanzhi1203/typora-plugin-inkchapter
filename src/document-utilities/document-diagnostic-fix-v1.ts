/**
 * Diagnostic fix planning V1 — PURE source patches, no disk / DOM writes.
 *
 * The planner turns ONE published diagnostic into a minimal source patch plan:
 *   preflight (lock / stale snapshot / source hash / identity)
 *   → fixer (source-range patch)
 *   → conflict check
 *   → line-hunk preview.
 *
 * Applying a plan to the live editor is deliberately NOT implemented here. The
 * only safe production path is a verified Typora edit transaction; until that
 * adapter is proven, `applySupported` stays false and the UI must not execute
 * the patch. `applyPatchesToMarkdown` exists for tests/preview only.
 */
import type {
  DiagnosticLocation,
  DocumentDiagnostic,
  DocumentDiagnosticsSnapshot,
} from './diagnostics-types'
import { parseFencedCodeBlocks } from './content-block-toolbar-code-source'
import { isRangeProtected, parseDocumentSourceSyntax } from './document-source-syntax-authority'
// R9 — the ONE whitespace contract shared with the source scanner / marker.
import { isWhitespaceOnlyText } from './document-diagnostic-whitespace-semantics-v1'
import {
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  FIGURE_INLINE_FORMAT_CODE,
  FIGURE_IN_LIST_CODE,
  FIGURE_IN_QUOTE_CODE,
  FIGURE_MULTIPLE_SAME_BLOCK_CODE,
  FIGURE_TEXT_MIXED_CODE,
  analyzeFigureStandaloneSourceBlocks,
  buildFigureBlockFixText,
  figureBlockFixRefusalReason,
  isFigureBlockAutoFixable,
  type FigureStandaloneSourceBlock,
} from './document-standalone-object-block-invariant-v515'
import { parseImageSourceOccurrences, type ImageSourceOccurrence } from './document-resource-scanner'
import {
  analyzeHeadingImages,
  analyzeHeadingImageSyntax,
  buildHeadingImageFix,
  buildHeadingSyntaxFix,
  scanSourceImageTokens,
  FIGURE_EMPTY_SOURCE_CODE,
  FIGURE_IN_HEADING_CODE,
  FIGURE_SYNTAX_IN_HEADING_CODE,
  type HeadingImageEntry,
  type HeadingSyntaxEntry,
} from './document-figure-heading-invariant-v1'
// V3 — image syntax completeness (missing `)` / `]`).
import {
  analyzeFigureSyntax,
  buildFigureSyntaxFix,
  FIGURE_UNCLOSED_DESTINATION_CODE,
  FIGURE_UNCLOSED_ALT_CODE,
  type FigureSyntaxIssue,
} from './document-figure-syntax-integrity-v1'
import {
  FORMULA_SINGLE_LINE_BLOCK_CODE,
  LIST_EMPTY_ITEM_CODE,
  isEmptyListMarker,
  singleLineDisplayFormulaSource,
} from './document-format-integrity-v1'
// CURRENT-DOCUMENT RE-LOCATION — the gap is re-derived from the live Markdown by
// its STABLE block identity, never from a possibly stale line range.
import {
  analyzeInternalBlankLineGaps,
  internalBlankGapIdentity,
} from './document-diagnostic-internal-blank-lines-v1'

export type DiagnosticFixSupport = 'AUTO' | 'REQUIRES_INPUT' | 'MANUAL' | 'UNSUPPORTED'

export type FixBlockerCode =
  | 'DOCUMENT_LOCKED'
  | 'STALE_DOCUMENT'
  | 'STALE_DIAGNOSTIC'
  | 'STALE_SOURCE'
  | 'NO_FIXER'
  | 'REQUIRES_INPUT'
  | 'CAPTION_NAME_SERVICE_REQUIRED'
  | 'INVALID_FACT'
  | 'PATCH_OUT_OF_BOUNDS'
  | 'PATCH_CONFLICT'
  | 'NOT_APPLICABLE'
  | 'STRUCTURE_NOT_AUTO_FIXABLE'
  | 'TRANSACTION_AUTHORITY_UNVERIFIED'

export interface FixBlocker {
  code: FixBlockerCode
  message: string
}

export interface DiagnosticFixPatch {
  /** Half-open source range [start, end). Insertions use start === end. */
  start: number
  end: number
  before: string
  after: string
  lineStart: number
  lineEnd: number
  kind: 'delete-lines' | 'replace-tail' | 'insert-language' | 'insert-figure-name' | 'insert-syntax' | 'replace-line' | 'replace-block'
}

export interface FixPreviewHunk {
  startLine: number
  endLine: number
  before: string[]
  after: string[]
  diff: string[]
}

export interface FixPreview {
  hunks: FixPreviewHunk[]
  changedLineCount: number
}

export interface FixPlan {
  diagnosticId: string
  code: string
  support: DiagnosticFixSupport
  label: string
  patches: readonly DiagnosticFixPatch[]
  blockers: readonly FixBlocker[]
  preview: FixPreview | null
  applySupported: boolean
  applyBlockedReason: FixBlockerCode | null
  expected: {
    documentKey: string
    revision: number
    markdownHash: string
  }
  requiresInput?: {
    field: 'name' | 'language'
    label: string
    placeholder?: string
  }
  ok: boolean
}

export interface FixContext {
  markdown: string
  /** Markdown the snapshot was computed from; hash must match `markdown`. */
  snapshotMarkdown?: string
  documentKey: string
  snapshot: DocumentDiagnosticsSnapshot | null
  locked: boolean
  expectedRevision?: number
  input?: { name?: string; language?: string }
}

export interface Fixer {
  code: string
  support: DiagnosticFixSupport
  label: string
  requiresInput?: FixPlan['requiresInput']
  build(diagnostic: DocumentDiagnostic, ctx: FixContext): {
    patches?: DiagnosticFixPatch[]
    blockers?: FixBlocker[]
  }
}

export interface FixLine {
  text: string
  start: number
  end: number
  eol: '\n' | '\r\n' | '\r' | ''
  index: number
}

export function splitFixLines(markdown: string): FixLine[] {
  const lines: FixLine[] = []
  let start = 0
  let index = 0
  while (start <= markdown.length) {
    const nl = markdown.indexOf('\n', start)
    if (nl < 0) {
      if (start < markdown.length) {
        lines.push({ text: markdown.slice(start), start, end: markdown.length, eol: '', index })
      }
      break
    }
    let textEnd = nl
    let eol: FixLine['eol'] = '\n'
    if (textEnd > start && markdown[textEnd - 1] === '\r') {
      textEnd--
      eol = '\r\n'
    }
    lines.push({ text: markdown.slice(start, textEnd), start, end: nl + 1, eol, index })
    start = nl + 1
    index++
  }
  return lines
}

export function fixMarkdownHash(markdown: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < markdown.length; i++) {
    hash ^= markdown.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${markdown.length.toString(16)}-${hash.toString(16).padStart(8, '0')}`
}

function blocker(code: FixBlockerCode, message: string): FixBlocker {
  return { code, message }
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function locationOf(diagnostic: DocumentDiagnostic): DiagnosticLocation | null {
  return diagnostic.location ?? null
}

function sourceStartOf(location: DiagnosticLocation | null): number | null {
  const value = (location as { sourceStart?: unknown } | null)?.sourceStart
  return typeof value === 'number' ? value : null
}

// ── Fixers ─────────────────────────────────────────────────────────────────

export interface CurrentInternalBlankRange {
  first: number
  last: number
  actual: number
}

/**
 * Re-locate ONE internal blank gap in the CURRENT Markdown by its stable
 * block-pair identity (`targetIdentity`). Returns null when the document no
 * longer owns that gap.
 *
 * This is the authoritative fix-time location: the recorded `firstBlankLine` /
 * `lastBlankLine` may belong to an older revision (unsaved-buffer edits,
 * debounced diagnostics), so they can never be used to delete text on their own.
 */
export function resolveCurrentInternalBlankRange(
  diagnostic: DocumentDiagnostic,
  markdown: string,
): CurrentInternalBlankRange | null {
  const identity = typeof diagnostic.targetIdentity === 'string' ? diagnostic.targetIdentity : null
  if (identity == null) return null
  const match = analyzeInternalBlankLineGaps(markdown)
    .find(g => internalBlankGapIdentity(g) === identity)
  if (match == null) return null
  return { first: match.firstBlankLine, last: match.lastBlankLine, actual: match.actualBlankLines }
}

export const INTERNAL_BLANK_LINES_FIX: Fixer = {
  code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
  support: 'AUTO',
  label: '压缩连续空行',
  build(diagnostic, ctx) {
    const meta = diagnostic.metadata ?? {}
    let first = asNumber(meta.firstBlankLine)
    let last = asNumber(meta.lastBlankLine)
    let actual = asNumber(meta.actualBlankLines)
    const pass = asNumber(meta.passMaxBlankLines) ?? 1
    const identity = typeof diagnostic.targetIdentity === 'string' ? diagnostic.targetIdentity : null
    if (identity != null) {
      const located = resolveCurrentInternalBlankRange(diagnostic, ctx.markdown)
      if (located == null) {
        // The semantic gap is gone (the document was fixed / re-structured).
        // NEVER fall back to the stale range: deleting by an old line number is
        // exactly how a non-blank line gets targeted.
        return { blockers: [blocker('STALE_DIAGNOSTIC', '当前文档已不存在该空行区间，诊断已刷新，请重新检测。')] }
      }
      first = located.first
      last = located.last
      actual = located.actual
    }
    if (first == null || last == null || actual == null || last < first) {
      return { blockers: [blocker('INVALID_FACT', '空行区间元数据缺失或不合法。')] }
    }
    const lines = splitFixLines(ctx.markdown)
    if (first >= lines.length || last >= lines.length) {
      return { blockers: [blocker('PATCH_OUT_OF_BOUNDS', '空行区间超出当前文档。')] }
    }
    if (first === 0) {
      return { blockers: [blocker('NOT_APPLICABLE', '首部空行不属于内部空行规则。')] }
    }
    for (let i = first; i <= last; i++) {
      if (!isWhitespaceOnlyText(lines[i].text)) {
        return { blockers: [blocker('INVALID_FACT', `第 ${i + 1} 行不是空行，拒绝批量删除。`)] }
      }
    }
    const removeStart = first + pass
    if (removeStart > last) {
      return { blockers: [blocker('NOT_APPLICABLE', '空行数量已在允许范围内。')] }
    }
    const start = lines[removeStart].start
    const end = lines[last].end
    if (isRangeProtected(parseDocumentSourceSyntax(ctx.markdown), start, end)) {
      return { blockers: [blocker('INVALID_FACT', '空行位于代码/公式/受保护块内，拒绝删除。')] }
    }
    return {
      patches: [{
        start,
        end,
        before: ctx.markdown.slice(start, end),
        after: '',
        lineStart: removeStart,
        lineEnd: last,
        kind: 'delete-lines',
      }],
    }
  },
}

export const LEADING_BLANK_LINES_FIX: Fixer = {
  code: 'DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE',
  support: 'AUTO',
  label: '删除文首多余空行',
  build(diagnostic, ctx) {
    const meta = diagnostic.metadata ?? {}
    const count = asNumber(meta.leadingBlankLineCount)
    if (count == null || count <= 0) {
      return { blockers: [blocker('NOT_APPLICABLE', '文首没有多余空行。')] }
    }
    const lines = splitFixLines(ctx.markdown)
    if (count >= lines.length) {
      // A fully blank document is DOCUMENT_EMPTY, never a leading-blank repair.
      return { blockers: [blocker('INVALID_FACT', '文档没有正文行。')] }
    }
    for (let i = 0; i < count; i++) {
      if (!isWhitespaceOnlyText(lines[i].text)) {
        return { blockers: [blocker('INVALID_FACT', `第 ${i + 1} 行不是空行，拒绝删除。`)] }
      }
    }
    const end = lines[count].start
    return {
      patches: [{
        start: 0,
        end,
        before: ctx.markdown.slice(0, end),
        after: '',
        lineStart: 0,
        lineEnd: count - 1,
        kind: 'delete-lines',
      }],
    }
  },
}

export const TERMINAL_NEWLINE_FIX: Fixer = {
  code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING',
  support: 'AUTO',
  label: '补齐末尾换行',
  build(_diagnostic, ctx) {
    const md = ctx.markdown
    if (md === '') return { blockers: [blocker('NOT_APPLICABLE', '空文档没有可补齐的末尾换行。')] }
    if (md.endsWith('\n')) return { blockers: [blocker('NOT_APPLICABLE', '文档已经以换行结束。')] }
    const lines = splitFixLines(md)
    const last = Math.max(0, lines.length - 1)
    return {
      patches: [{
        start: md.length,
        end: md.length,
        before: '',
        after: '\n',
        lineStart: last,
        lineEnd: last,
        kind: 'replace-tail',
      }],
    }
  },
}

export const TRAILING_BLANK_LINES_FIX: Fixer = {
  code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
  support: 'AUTO',
  label: '删除文末多余空行',
  build(diagnostic, ctx) {
    const meta = diagnostic.metadata ?? {}
    const extra = asNumber(meta.extraTrailingBlankLineCount) ?? 0
    if (extra <= 0) return { blockers: [blocker('NOT_APPLICABLE', '文末没有多余空行。')] }
    const lines = splitFixLines(ctx.markdown)
    let lastContent = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!isWhitespaceOnlyText(lines[i].text)) { lastContent = i; break }
    }
    if (lastContent < 0) return { blockers: [blocker('INVALID_FACT', '文档没有正文行。')] }
    // Normal `text\n` has one trailing empty line; >1 means extra blanks.
    const trailingEmpty = lines.length - 1 - lastContent
    if (trailingEmpty <= 1) return { blockers: [blocker('NOT_APPLICABLE', '文末只有一个换行。')] }
    const start = lines[lastContent].end
    const end = ctx.markdown.length
    if (isRangeProtected(parseDocumentSourceSyntax(ctx.markdown), start, end)) {
      return { blockers: [blocker('INVALID_FACT', '文末空行位于未闭合代码/公式块内，拒绝删除。')] }
    }
    return {
      patches: [{
        start,
        end,
        before: ctx.markdown.slice(start, end),
        // The content line already owns its EOL; remove only the EXTRA newlines.
        after: '',
        lineStart: lastContent + 1,
        lineEnd: lines.length - 1,
        kind: 'replace-tail',
      }],
    }
  },
}

/**
 * Locate the diagnostic's source line inside the CURRENT Markdown. The recorded
 * `lineNumber` is preferred, but every candidate must still look like the shape
 * the diagnostic described — a stale/duplicated fact never deletes content.
 */
function locateDiagnosticLine(
  ctx: FixContext,
  diagnostic: DocumentDiagnostic,
  matches: (text: string) => boolean,
): { line: FixLine; index: number } | { blocker: FixBlocker } {
  const meta = diagnostic.metadata ?? {}
  const recorded = asNumber(meta.lineNumber)
  const expectedText = typeof meta.lineText === 'string' ? meta.lineText : null
  const lines = splitFixLines(ctx.markdown)
  if (recorded != null && recorded < lines.length && matches(lines[recorded].text)) {
    return { line: lines[recorded], index: recorded }
  }
  const candidates: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!matches(lines[i].text)) continue
    if (expectedText != null && lines[i].text !== expectedText) continue
    candidates.push(i)
  }
  if (candidates.length === 0) return { blocker: blocker('STALE_DIAGNOSTIC', '目标行已变化，请重新检测后再修复。') }
  if (candidates.length > 1) return { blocker: blocker('STALE_DIAGNOSTIC', '存在多处相同格式，请重新检测后再修复。') }
  return { line: lines[candidates[0]], index: candidates[0] }
}

function documentEol(markdown: string): string {
  return markdown.includes('\r\n') ? '\r\n' : '\n'
}

/** `LIST_EMPTY_ITEM` — delete the contentless marker line. */
export const LIST_EMPTY_ITEM_FIX: Fixer = {
  code: LIST_EMPTY_ITEM_CODE,
  support: 'AUTO',
  label: '删除空列表项',
  build(diagnostic, ctx) {
    const located = locateDiagnosticLine(ctx, diagnostic, isEmptyListMarker)
    if ('blocker' in located) return { blockers: [located.blocker] }
    const { line, index } = located
    return {
      patches: [{
        start: line.start,
        end: line.end,
        before: ctx.markdown.slice(line.start, line.end),
        after: '',
        lineStart: index,
        lineEnd: index,
        kind: 'delete-lines',
      }],
    }
  },
}

/** `FORMULA_SINGLE_LINE_BLOCK` — expand `$$x$$` into the renderable 3-line block. */
export const FORMULA_SINGLE_LINE_BLOCK_FIX: Fixer = {
  code: FORMULA_SINGLE_LINE_BLOCK_CODE,
  support: 'AUTO',
  label: '拆成独立公式块',
  build(diagnostic, ctx) {
    const located = locateDiagnosticLine(
      ctx,
      diagnostic,
      text => singleLineDisplayFormulaSource(text) != null,
    )
    if ('blocker' in located) return { blockers: [located.blocker] }
    const { line, index } = located
    const source = singleLineDisplayFormulaSource(line.text)
    if (source == null || source.trim() === '') {
      return { blockers: [blocker('INVALID_FACT', '公式源码为空，拒绝改写。')] }
    }
    const eol = documentEol(ctx.markdown)
    return {
      patches: [{
        start: line.start,
        end: line.start + line.text.length,
        before: line.text,
        after: `$$${eol}${source.trim()}${eol}$$`,
        lineStart: index,
        lineEnd: index,
        kind: 'replace-line',
      }],
    }
  },
}

/**
 * Resolve the diagnostic's owning block in the CURRENT Markdown.
 *
 * The recorded absolute block span is preferred (it is the locator target), but
 * the block is always RE-ANALYSED from the live text: a stale span that no
 * longer describes an invalid image block must never be rewritten.
 */
function locateStructureBlock(
  ctx: FixContext,
  diagnostic: DocumentDiagnostic,
): { block: FigureStandaloneSourceBlock; occurrences: ImageSourceOccurrence[] } | { blocker: FixBlocker } {
  const meta = diagnostic.metadata ?? {}
  const occurrences = parseImageSourceOccurrences(ctx.markdown)
  if (occurrences.length === 0) {
    return { blocker: blocker('STALE_DIAGNOSTIC', '当前文档已没有图片，请重新检测。') }
  }
  const blocks = analyzeFigureStandaloneSourceBlocks({ source: ctx.markdown, occurrences })
  const start = asNumber(meta.sourceStart)
  const end = asNumber(meta.sourceEnd)
  if (start != null && end != null) {
    const exact = blocks.find(b => b.blockStart === start && b.blockEnd === end)
    if (exact) return { block: exact, occurrences }
  }
  const startLine = asNumber(meta.startLine)
  if (startLine != null) {
    const byLine = blocks.filter(b => b.startLine === startLine)
    if (byLine.length === 1) return { block: byLine[0], occurrences }
  }
  const identity = typeof meta.owningBlockIdentity === 'string' ? meta.owningBlockIdentity : null
  if (identity != null) {
    const byIdentity = blocks.filter(b => b.owningBlockIdentity === identity)
    if (byIdentity.length === 1) return { block: byIdentity[0], occurrences }
  }
  return { blocker: blocker('STALE_DIAGNOSTIC', '目标图片块已变化，请重新检测后再修复。') }
}

/**
 * Figure structure repair — ONE block-level fixer family.
 *
 * The block itself is the unit of repair (one diagnostic per block), so a
 * paragraph carrying two images and text is repaired in ONE write. The concrete
 * transformation depends on the block's real container:
 *   - paragraph / figure → split into text + one block per image;
 *   - top-level list item → remove the list marker (images become blocks);
 *   - blockquote → remove EVERY quote level of the image's own line;
 *   - table / nested list / irregular quote → explicit refusal, no write.
 */
function buildFigureStructureFix(diagnostic: DocumentDiagnostic, ctx: FixContext) {
  const located = locateStructureBlock(ctx, diagnostic)
  if ('blocker' in located) return { blockers: [located.blocker] }
  const { block } = located
  if (block.result.decision === 'VALID_STANDALONE_FIGURE') {
    return { blockers: [blocker('NOT_APPLICABLE', '该图片块已经独立成块，无需修复。')] }
  }
  const refusal = figureBlockFixRefusalReason(block)
  if (refusal != null) {
    return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', refusal)] }
  }
  if (!isFigureBlockAutoFixable(block)) {
    return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', '该图片块的结构无法在不改变语义的前提下自动修复。')] }
  }
  const outcome = buildFigureBlockFixText({ source: ctx.markdown, block })
  if (outcome.refusal != null) {
    return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', outcome.refusal)] }
  }
  const before = ctx.markdown.slice(block.blockStart, block.blockEnd)
  if (outcome.changed === false || outcome.text === before) {
    return { blockers: [blocker('NOT_APPLICABLE', '该图片块无需修复。')] }
  }
  return {
    patches: [{
      start: block.blockStart,
      end: block.blockEnd,
      before,
      after: outcome.text,
      lineStart: block.startLine,
      lineEnd: block.endLine,
      kind: 'replace-block' as const,
    }],
  }
}

function figureStructureFixer(code: string, label: string): Fixer {
  return {
    code,
    support: 'AUTO',
    label,
    build(diagnostic, ctx) {
      return buildFigureStructureFix(diagnostic, ctx)
    },
  }
}

export const FIGURE_BLOCK_STRUCTURE_INVALID_FIX = figureStructureFixer(
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  '拆成独立图片块',
)
export const FIGURE_MULTIPLE_SAME_BLOCK_FIX = figureStructureFixer(
  FIGURE_MULTIPLE_SAME_BLOCK_CODE,
  '拆分为独立图片段落',
)
export const FIGURE_TEXT_MIXED_FIX = figureStructureFixer(
  FIGURE_TEXT_MIXED_CODE,
  '拆分图片与正文',
)
export const FIGURE_IN_LIST_FIX = figureStructureFixer(
  FIGURE_IN_LIST_CODE,
  '移除图片列表格式',
)
export const FIGURE_IN_QUOTE_FIX = figureStructureFixer(
  FIGURE_IN_QUOTE_CODE,
  '移除图片引用格式',
)
export const FIGURE_INLINE_FORMAT_FIX = figureStructureFixer(
  FIGURE_INLINE_FORMAT_CODE,
  '移除图片行内格式',
)

/** Locate the heading entry described by a FIGURE_IN_HEADING diagnostic. */
function locateHeadingEntry(
  diagnostic: DocumentDiagnostic,
  markdown: string,
): HeadingImageEntry | null {
  const meta = diagnostic.metadata ?? {}
  const sourceStart = asNumber(meta.sourceStart)
  const sourceEnd = asNumber(meta.sourceEnd)
  const startLine = asNumber(meta.startLine)
  const entries = analyzeHeadingImages(markdown)
  if (sourceStart != null && sourceEnd != null) {
    const exact = entries.find(entry => entry.lineStart === sourceStart && entry.lineEnd === sourceEnd)
    if (exact) return exact
  }
  if (startLine != null) {
    const byLine = entries.filter(entry => entry.lineIndex === startLine)
    if (byLine.length === 1) return byLine[0]
  }
  const identity = typeof meta.owningBlockIdentity === 'string' ? meta.owningBlockIdentity : ''
  const match = /^src-block:(\d+)$/.exec(identity)
  if (match) {
    const byIdentity = entries.filter(entry => entry.lineIndex === Number.parseInt(match[1], 10))
    if (byIdentity.length === 1) return byIdentity[0]
  }
  return null
}

/**
 * `FIGURE_IN_HEADING` — move every image out of an H1–H6 heading:
 *   - text remains, the heading level is unchanged;
 *   - every image token (including an empty-path `![]()`) is preserved verbatim
 *     and becomes a standalone paragraph in its original order;
 *   - an image-only heading loses the heading marker, images stay.
 */
export const FIGURE_IN_HEADING_FIX: Fixer = {
  code: FIGURE_IN_HEADING_CODE,
  support: 'AUTO',
  label: '将图片移出标题',
  build(diagnostic, ctx) {
    const entry = locateHeadingEntry(diagnostic, ctx.markdown)
    if (entry == null) {
      return { blockers: [blocker('STALE_DIAGNOSTIC', '目标标题已变化，请重新检测后再修复。')] }
    }
    const outcome = buildHeadingImageFix(ctx.markdown, entry)
    if (outcome.refusal != null) {
      return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', outcome.refusal)] }
    }
    const before = ctx.markdown.slice(entry.lineStart, entry.lineEnd)
    if (outcome.changed === false || outcome.text === before) {
      return { blockers: [blocker('NOT_APPLICABLE', '该标题无需修复。')] }
    }
    return {
      patches: [{
        start: entry.lineStart,
        end: entry.lineEnd,
        before,
        after: outcome.text,
        lineStart: entry.lineIndex,
        lineEnd: entry.lineIndex,
        kind: 'replace-block',
      }],
    }
  },
}

/** Locate the syntax-only heading entry described by its diagnostic. */
function locateHeadingSyntaxEntry(
  diagnostic: DocumentDiagnostic,
  markdown: string,
): HeadingSyntaxEntry | null {
  const meta = diagnostic.metadata ?? {}
  const sourceStart = asNumber(meta.sourceStart)
  const sourceEnd = asNumber(meta.sourceEnd)
  const startLine = asNumber(meta.startLine)
  const entries = analyzeHeadingImageSyntax(markdown)
  if (sourceStart != null && sourceEnd != null) {
    const exact = entries.find(entry => entry.lineStart === sourceStart && entry.lineEnd === sourceEnd)
    if (exact) return exact
  }
  if (startLine != null) {
    const byLine = entries.filter(entry => entry.lineIndex === startLine)
    if (byLine.length === 1) return byLine[0]
  }
  const identity = typeof meta.owningBlockIdentity === 'string' ? meta.owningBlockIdentity : ''
  const match = /^src-block:(\d+)$/.exec(identity)
  if (match) {
    const byIdentity = entries.filter(entry => entry.lineIndex === Number.parseInt(match[1], 10))
    if (byIdentity.length === 1) return byIdentity[0]
  }
  return null
}

/**
 * `FIGURE_SYNTAX_IN_HEADING` — move incomplete image-link syntax out of an
 * H1–H6 heading. A heading that also owns a COMPLETE token is owned by
 * `FIGURE_IN_HEADING` (that repair extracts both), so this fixer never competes
 * with it for the same image node.
 */
export const FIGURE_SYNTAX_IN_HEADING_FIX: Fixer = {
  code: FIGURE_SYNTAX_IN_HEADING_CODE,
  support: 'AUTO',
  label: '将图片语法移出标题',
  build(diagnostic, ctx) {
    const entry = locateHeadingSyntaxEntry(diagnostic, ctx.markdown)
    if (entry == null) {
      return { blockers: [blocker('STALE_DIAGNOSTIC', '目标标题已变化，请重新检测后再修复。')] }
    }
    const outcome = buildHeadingSyntaxFix(ctx.markdown, entry)
    if (outcome.refusal != null) {
      return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', outcome.refusal)] }
    }
    const before = ctx.markdown.slice(entry.lineStart, entry.lineEnd)
    if (outcome.changed === false || outcome.text === before) {
      return { blockers: [blocker('NOT_APPLICABLE', '该标题无需修复。')] }
    }
    return {
      patches: [{
        start: entry.lineStart,
        end: entry.lineEnd,
        before,
        after: outcome.text,
        lineStart: entry.lineIndex,
        lineEnd: entry.lineIndex,
        kind: 'replace-block',
      }],
    }
  },
}

/** Locate the V3 syntax issue described by a diagnostic. */
function locateFigureSyntaxIssue(
  diagnostic: DocumentDiagnostic,
  markdown: string,
  code: string,
): FigureSyntaxIssue | null {
  const meta = diagnostic.metadata ?? {}
  const sourceStart = asNumber(meta.sourceStart) ?? sourceStartOf(locationOf(diagnostic))
  const startLine = asNumber(meta.startLine)
  const candidates = analyzeFigureSyntax(markdown).filter(issue => issue.code === code)
  if (sourceStart != null) {
    const exact = candidates.find(issue => issue.start === sourceStart)
    if (exact) return exact
  }
  if (startLine != null) {
    const byLine = candidates.filter(issue => issue.startLine === startLine)
    if (byLine.length === 1) return byLine[0]
  }
  const rawToken = typeof meta.rawToken === 'string' ? meta.rawToken : ''
  if (rawToken !== '') {
    const byRaw = candidates.filter(issue => issue.rawToken === rawToken)
    if (byRaw.length === 1) return byRaw[0]
  }
  return null
}

/**
 * V3 §4.1/§4.2 — the ONLY automatic syntax repair: insert the missing `)` at a
 * proven paragraph boundary, or the missing `]` before an unambiguous `(`.
 * Every original byte (URL / alt / title) is preserved.
 */
function buildFigureSyntaxFixPatch(
  diagnostic: DocumentDiagnostic,
  ctx: FixContext,
  code: string,
): { patches?: DiagnosticFixPatch[]; blockers?: FixBlocker[] } {
  const issue = locateFigureSyntaxIssue(diagnostic, ctx.markdown, code)
  if (issue == null) {
    return { blockers: [blocker('STALE_DIAGNOSTIC', '目标图片语法已变化，请重新检测后再修复。')] }
  }
  const outcome = buildFigureSyntaxFix(ctx.markdown, issue)
  if (outcome.refusal != null) {
    return { blockers: [blocker('STRUCTURE_NOT_AUTO_FIXABLE', outcome.refusal)] }
  }
  if (!outcome.changed || issue.repairAt == null) {
    return { blockers: [blocker('NOT_APPLICABLE', '该图片语法无需修复。')] }
  }
  const insertAt = issue.repairAt
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > ctx.markdown.length) {
    return { blockers: [blocker('PATCH_OUT_OF_BOUNDS', '图片语法修复位置超出当前文档。')] }
  }
  const insertText = code === FIGURE_UNCLOSED_ALT_CODE ? ']' : ')'
  if (code === FIGURE_UNCLOSED_ALT_CODE && ctx.markdown.charAt(insertAt) !== '(') {
    return { blockers: [blocker('INVALID_FACT', '无法确定 `]` 的插入位置，请手动修复。')] }
  }
  return {
    patches: [{
      start: insertAt,
      end: insertAt,
      before: '',
      after: insertText,
      lineStart: issue.startLine,
      lineEnd: issue.endLine,
      kind: 'insert-syntax',
    }],
  }
}

export const FIGURE_UNCLOSED_DESTINATION_FIX: Fixer = {
  code: FIGURE_UNCLOSED_DESTINATION_CODE,
  support: 'AUTO',
  label: '补全图片链接括号',
  build(diagnostic, ctx) {
    return buildFigureSyntaxFixPatch(diagnostic, ctx, FIGURE_UNCLOSED_DESTINATION_CODE)
  },
}

export const FIGURE_UNCLOSED_ALT_FIX: Fixer = {
  code: FIGURE_UNCLOSED_ALT_CODE,
  support: 'AUTO',
  label: '补全图片描述方括号',
  build(diagnostic, ctx) {
    return buildFigureSyntaxFixPatch(diagnostic, ctx, FIGURE_UNCLOSED_ALT_CODE)
  },
}

/** Build a line-deletion patch that keeps block spacing canonical. */
function buildWholeLineRemovalPatch(markdown: string, lineIndex: number): DiagnosticFixPatch | null {
  const lines = splitFixLines(markdown)
  const line = lines[lineIndex]
  if (!line) return null
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  let start = line.start
  const end = line.end
  const before = markdown.slice(0, start)
  const after = markdown.slice(end)
  // Removing a line between two blank lines would leave two blank lines:
  // absorb ONE preceding EOL so exactly one blank line remains.
  if (before.endsWith(eol + eol) && after.startsWith(eol)) start -= eol.length
  return {
    start,
    end,
    before: markdown.slice(start, end),
    after: '',
    lineStart: lineIndex,
    lineEnd: lineIndex,
    kind: 'delete-lines' as const,
  }
}

/**
 * `FIGURE_EMPTY_SOURCE` — remove an unfinished image node without inventing a
 * path:
 *   - a standalone / inline `![]()` token is removed (surrounding text stays);
 *   - a token inside an H1–H6 heading is removed together with the heading
 *     structure repair, so ONE action fixes both the heading payload and the
 *     empty resource; valid images of that heading still move out in order.
 */
export const FIGURE_EMPTY_SOURCE_FIX: Fixer = {
  code: FIGURE_EMPTY_SOURCE_CODE,
  support: 'AUTO',
  label: '删除空图片占位符',
  build(diagnostic, ctx) {
    const meta = diagnostic.metadata ?? {}
    const location = locationOf(diagnostic)
    const sourceStart = asNumber((location as { sourceStart?: unknown } | null)?.sourceStart)
    const sourceEnd = asNumber((location as { sourceEnd?: unknown } | null)?.sourceEnd)
    const rawToken = typeof meta.rawToken === 'string' ? meta.rawToken : ''
    const tokens = scanSourceImageTokens(ctx.markdown).filter(token => token.emptyDestination)
    const token = tokens.find(t => t.tokenStart === sourceStart && t.tokenEnd === sourceEnd)
      ?? tokens.find(t => rawToken !== '' && t.rawToken === rawToken
        && (asNumber(meta.startLine) == null || t.lineIndex === asNumber(meta.startLine)))
    if (token == null) {
      return { blockers: [blocker('STALE_DIAGNOSTIC', '目标空图片已变化，请重新检测后再修复。')] }
    }
    const eol = ctx.markdown.includes('\r\n') ? '\r\n' : '\n'
    const heading = analyzeHeadingImages(ctx.markdown)
      .find(entry => entry.images.some(image => image.tokenStart === token!.tokenStart))
    if (heading != null) {
      const validImages = heading.images
        .filter(image => !image.emptyDestination)
        .map(image => image.rawToken)
      const marker = ctx.markdown
        .slice(heading.lineStart, heading.headingTextStart)
        .replace(/[ \t]+$/, ' ')
      let after = heading.textWithoutImages === '' ? '' : `${marker}${heading.textWithoutImages}`
      if (validImages.length > 0) {
        after += (after === '' ? '' : eol + eol) + validImages.join(eol + eol)
      }
      if (after === '') {
        const patch = buildWholeLineRemovalPatch(ctx.markdown, heading.lineIndex)
        return patch ? { patches: [patch] } : { blockers: [blocker('INVALID_FACT', '无法移除该空图片行。')] }
      }
      const before = ctx.markdown.slice(heading.lineStart, heading.lineEnd)
      return {
        patches: [{
          start: heading.lineStart,
          end: heading.lineEnd,
          before,
          after,
          lineStart: heading.lineIndex,
          lineEnd: heading.lineIndex,
          kind: 'replace-block',
        }],
      }
    }
    const lines = splitFixLines(ctx.markdown)
    const line = lines[token.lineIndex]
    if (!line) {
      return { blockers: [blocker('PATCH_OUT_OF_BOUNDS', '空图片所在行不存在。')] }
    }
    const relativeStart = token.tokenStart - line.start
    const relativeEnd = token.tokenEnd - line.start
    if (relativeStart < 0 || relativeEnd > line.text.length) {
      return { blockers: [blocker('INVALID_FACT', '空图片 token 与当前源码不一致。')] }
    }
    const remaining = (line.text.slice(0, relativeStart) + line.text.slice(relativeEnd))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+$/, '')
    if (remaining.trim() === '') {
      const patch = buildWholeLineRemovalPatch(ctx.markdown, token.lineIndex)
      return patch ? { patches: [patch] } : { blockers: [blocker('INVALID_FACT', '无法移除该空图片行。')] }
    }
    return {
      patches: [{
        start: line.start,
        end: line.start + line.text.length,
        before: line.text,
        after: remaining,
        lineStart: token.lineIndex,
        lineEnd: token.lineIndex,
        kind: 'replace-line',
      }],
    }
  },
}

function parseCodeOrdinal(diagnostic: DocumentDiagnostic): number | null {
  const location = locationOf(diagnostic)
  const stable = location && 'stableIdentity' in location ? String(location.stableIdentity ?? '') : ''
  const target = String(diagnostic.targetIdentity ?? '')
  const match = /(?:block:code:|code:)(\d+)/.exec(stable) ?? /(?:block:code:|code:)(\d+)/.exec(target)
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export const CODE_LANGUAGE_FIX: Fixer = {
  code: 'CODE_MISSING_LANGUAGE',
  support: 'REQUIRES_INPUT',
  label: '补充代码语言',
  requiresInput: { field: 'language', label: '代码语言', placeholder: 'python / ts / bash' },
  build(diagnostic, ctx) {
    const language = String(ctx.input?.language ?? '').trim()
    if (!/^[A-Za-z0-9_+#.-]{1,32}$/.test(language)) {
      return { blockers: [blocker('REQUIRES_INPUT', '请输入合法的代码语言标识（不含空格/换行）。')] }
    }
    const ordinal = parseCodeOrdinal(diagnostic)
    if (ordinal == null) return { blockers: [blocker('INVALID_FACT', '无法解析代码块序号。')] }
    const blocks = parseFencedCodeBlocks(ctx.markdown)
    const block = blocks[ordinal]
    if (!block) return { blockers: [blocker('STALE_DIAGNOSTIC', '代码块序号与当前源不一致。')] }
    const lines = splitFixLines(ctx.markdown)
    const line = lines[block.lineStart]
    if (!line) return { blockers: [blocker('PATCH_OUT_OF_BOUNDS', '代码围栏行不存在。')] }
    const opening = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(line.text)
    if (!opening) return { blockers: [blocker('INVALID_FACT', '起始围栏格式无法解析。')] }
    if (opening[3].trim() !== '') {
      return { blockers: [blocker('NOT_APPLICABLE', '该代码块已有语言信息。')] }
    }
    const insertAt = line.start + opening[1].length + opening[2].length
    return {
      patches: [{
        start: insertAt,
        end: insertAt,
        before: '',
        after: language,
        lineStart: block.lineStart,
        lineEnd: block.lineStart,
        kind: 'insert-language',
      }],
    }
  },
}

export const FIGURE_NAME_FIX: Fixer = {
  code: 'FIGURE_MISSING_NAME',
  support: 'REQUIRES_INPUT',
  label: '补充图名',
  requiresInput: { field: 'name', label: '图名', placeholder: '系统架构' },
  build(diagnostic, ctx) {
    const name = String(ctx.input?.name ?? '').trim()
    if (name === '' || name.length > 200 || /[\r\n\]]/.test(name)) {
      return { blockers: [blocker('REQUIRES_INPUT', '图名不能为空、不能包含 ] 或换行。')] }
    }
    const meta = diagnostic.metadata ?? {}
    const tokenStart = asNumber(meta.tokenStart) ?? sourceStartOf(locationOf(diagnostic))
    const rawToken = typeof meta.rawToken === 'string' ? meta.rawToken : ''
    if (tokenStart == null || !rawToken.startsWith('![')) {
      return { blockers: [blocker('INVALID_FACT', '图名诊断缺少完整图片 token。')] }
    }
    const close = rawToken.indexOf('](')
    if (close < 2) return { blockers: [blocker('INVALID_FACT', '图片 token 缺少 alt 边界。')] }
    const alt = rawToken.slice(2, close)
    if (alt.trim() !== '') return { blockers: [blocker('NOT_APPLICABLE', '该图片已有图名。')] }
    const start = tokenStart + 2
    return {
      patches: [{
        start,
        end: start,
        before: '',
        after: name,
        lineStart: typeof meta.startLine === 'number' ? meta.startLine : 0,
        lineEnd: typeof meta.endLine === 'number' ? meta.endLine : 0,
        kind: 'insert-figure-name',
      }],
    }
  },
}

function manualCaptionFixer(code: string, label: string): Fixer {
  return {
    code,
    support: 'MANUAL',
    label,
    requiresInput: { field: 'name', label },
    build() {
      return {
        blockers: [blocker(
          'CAPTION_NAME_SERVICE_REQUIRED',
          '该名称属于题注服务，必须走现有命名事务，不能在 Markdown 中伪造。',
        )],
      }
    },
  }
}

export const CODE_NAME_FIX = manualCaptionFixer('CODE_MISSING_NAME', '代码块名称')
export const TABLE_NAME_FIX = manualCaptionFixer('TABLE_MISSING_NAME', '表名')

// ── Registry ───────────────────────────────────────────────────────────────

export class DiagnosticFixRegistry {
  private readonly fixers = new Map<string, Fixer>()

  register(fixer: Fixer): this {
    this.fixers.set(fixer.code, fixer)
    return this
  }

  get(code: string): Fixer | null {
    return this.fixers.get(code) ?? null
  }

  has(code: string): boolean {
    return this.fixers.has(code)
  }

  list(): readonly Fixer[] {
    return [...this.fixers.values()]
  }
}

export function createDefaultDiagnosticFixRegistry(): DiagnosticFixRegistry {
  return new DiagnosticFixRegistry()
    .register(INTERNAL_BLANK_LINES_FIX)
    .register(LEADING_BLANK_LINES_FIX)
    .register(TERMINAL_NEWLINE_FIX)
    .register(TRAILING_BLANK_LINES_FIX)
    .register(LIST_EMPTY_ITEM_FIX)
    .register(FORMULA_SINGLE_LINE_BLOCK_FIX)
    .register(FIGURE_BLOCK_STRUCTURE_INVALID_FIX)
    .register(FIGURE_MULTIPLE_SAME_BLOCK_FIX)
    .register(FIGURE_TEXT_MIXED_FIX)
    .register(FIGURE_IN_LIST_FIX)
    .register(FIGURE_IN_QUOTE_FIX)
    .register(FIGURE_INLINE_FORMAT_FIX)
    .register(FIGURE_IN_HEADING_FIX)
    .register(FIGURE_SYNTAX_IN_HEADING_FIX)
    .register(FIGURE_UNCLOSED_DESTINATION_FIX)
    .register(FIGURE_UNCLOSED_ALT_FIX)
    .register(FIGURE_EMPTY_SOURCE_FIX)
    .register(CODE_LANGUAGE_FIX)
    .register(FIGURE_NAME_FIX)
    .register(CODE_NAME_FIX)
    .register(TABLE_NAME_FIX)
}

// ── Planner ────────────────────────────────────────────────────────────────

function validatePatch(markdown: string, patch: DiagnosticFixPatch): FixBlocker | null {
  if (!Number.isInteger(patch.start) || !Number.isInteger(patch.end)) {
    return blocker('PATCH_OUT_OF_BOUNDS', '补丁偏移不是整数。')
  }
  if (patch.start < 0 || patch.end < patch.start || patch.end > markdown.length) {
    return blocker('PATCH_OUT_OF_BOUNDS', '补丁范围超出当前文档。')
  }
  if (markdown.slice(patch.start, patch.end) !== patch.before) {
    return blocker('STALE_SOURCE', '补丁的 before 与当前源不一致。')
  }
  return null
}

export function buildFixPreview(markdown: string, patches: readonly DiagnosticFixPatch[]): FixPreview {
  const lines = splitFixLines(markdown)
  const hunks: FixPreviewHunk[] = []
  for (const patch of patches) {
    const startLine = Math.max(0, patch.lineStart - 1)
    const endLine = Math.min(lines.length - 1, patch.lineEnd + 1)
    const before: string[] = []
    for (let i = startLine; i <= endLine; i++) before.push(lines[i]?.text ?? '')
    const after = patch.after === ''
      ? []
      : patch.after.split(/\r\n|\r|\n/).filter((_, i, arr) => i < arr.length - (patch.after.endsWith('\n') ? 1 : 0))
    hunks.push({
      startLine: startLine + 1,
      endLine: endLine + 1,
      before,
      after,
      diff: [
        ...before.map(line => `- ${line}`),
        ...after.map(line => `+ ${line}`),
      ],
    })
  }
  return { hunks, changedLineCount: hunks.reduce((n, h) => n + Math.max(h.before.length, h.after.length), 0) }
}

function patchesConflict(a: readonly DiagnosticFixPatch[], b: readonly DiagnosticFixPatch[]): boolean {
  for (const p of a) {
    for (const q of b) {
      if (p.start === p.end && q.start === q.end) {
        if (p.start === q.start) return true
      } else if (p.start < q.end && q.start < p.end) return true
    }
  }
  return false
}

export function planDiagnosticFix(
  registry: DiagnosticFixRegistry,
  diagnosticId: string,
  ctx: FixContext,
): FixPlan {
  const expectedHash = fixMarkdownHash(ctx.snapshotMarkdown ?? ctx.markdown)
  const plan: FixPlan = {
    diagnosticId,
    code: '',
    support: 'UNSUPPORTED',
    label: '',
    patches: [],
    blockers: [],
    preview: null,
    applySupported: false,
    applyBlockedReason: 'TRANSACTION_AUTHORITY_UNVERIFIED',
    expected: {
      documentKey: ctx.documentKey,
      revision: ctx.snapshot?.revision ?? 0,
      markdownHash: expectedHash,
    },
    ok: false,
  }
  const blockers: FixBlocker[] = []
  if (ctx.locked) blockers.push(blocker('DOCUMENT_LOCKED', '文档已锁定，不能修复。'))
  if (!ctx.snapshot || ctx.snapshot.documentKey !== ctx.documentKey) {
    blockers.push(blocker('STALE_DOCUMENT', '诊断快照不属于当前文档。'))
  }
  if (ctx.expectedRevision != null && ctx.snapshot?.revision !== ctx.expectedRevision) {
    blockers.push(blocker('STALE_SOURCE', '诊断快照版本已过期。'))
  }
  if (ctx.snapshotMarkdown != null && fixMarkdownHash(ctx.snapshotMarkdown) !== fixMarkdownHash(ctx.markdown)) {
    blockers.push(blocker('STALE_SOURCE', '编辑器源已变化，请重新检测。'))
  }
  const diagnostic = ctx.snapshot?.diagnostics.find(d => d.id === diagnosticId) ?? null
  if (!diagnostic) {
    blockers.push(blocker('STALE_DIAGNOSTIC', '该诊断已不在最新快照中。'))
    return { ...plan, blockers, ok: false }
  }
  plan.code = diagnostic.code
  plan.expected = { ...plan.expected, revision: ctx.snapshot?.revision ?? 0 }
  if (diagnostic.documentKey !== ctx.documentKey) {
    blockers.push(blocker('STALE_DOCUMENT', '诊断记录不属于当前文档。'))
  }
  const fixer = registry.get(diagnostic.code)
  if (!fixer) {
    blockers.push(blocker('NO_FIXER', '该诊断没有可用的修复器。'))
    return { ...plan, support: 'UNSUPPORTED', blockers, ok: false }
  }
  plan.support = fixer.support
  plan.label = fixer.label
  plan.requiresInput = fixer.requiresInput
  if (fixer.requiresInput) {
    const value = fixer.requiresInput.field === 'language' ? ctx.input?.language : ctx.input?.name
    if (value == null || String(value).trim() === '') {
      blockers.push(blocker('REQUIRES_INPUT', `需要提供${fixer.requiresInput.label}。`))
    }
  }
  if (blockers.length > 0) return { ...plan, blockers, ok: false }
  const built = fixer.build(diagnostic, ctx)
  for (const b of built.blockers ?? []) blockers.push(b)
  for (const patch of built.patches ?? []) {
    const invalid = validatePatch(ctx.markdown, patch)
    if (invalid) blockers.push(invalid)
  }
  const patches = built.patches ?? []
  return {
    ...plan,
    patches,
    blockers,
    preview: patches.length > 0 ? buildFixPreview(ctx.markdown, patches) : null,
    ok: blockers.length === 0 && patches.length > 0,
  }
}

export function planManyFixes(
  registry: DiagnosticFixRegistry,
  diagnosticIds: readonly string[],
  ctx: FixContext,
): FixPlan[] {
  const plans: FixPlan[] = []
  for (const id of diagnosticIds) {
    const plan = planDiagnosticFix(registry, id, ctx)
    if (plan.ok && plans.some(p => p.ok && patchesConflict(p.patches, plan.patches))) {
      plans.push({ ...plan, blockers: [...plan.blockers, blocker('PATCH_CONFLICT', '与其他待修复项范围重叠。')], ok: false })
    } else {
      plans.push(plan)
    }
  }
  return plans
}

/** Plan every AUTO fixer present in the current snapshot (excluding conflicts). */
export function planAllAutoFixes(registry: DiagnosticFixRegistry, ctx: FixContext): FixPlan[] {
  const autoCodes = new Set(registry.list().filter(f => f.support === 'AUTO').map(f => f.code))
  const ids = (ctx.snapshot?.diagnostics ?? []).filter(d => autoCodes.has(d.code)).map(d => d.id)
  return planManyFixes(registry, ids, ctx)
}

/** TEST/PREVIEW ONLY — production must use a verified Typora transaction. */
export function applyPatchesToMarkdown(markdown: string, patches: readonly DiagnosticFixPatch[]): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start || b.end - a.end)
  let out = markdown
  for (const patch of sorted) out = out.slice(0, patch.start) + patch.after + out.slice(patch.end)
  return out
}

// ── Post-fix re-diagnosis contract ─────────────────────────────────────────

export interface FixVerification {
  diagnosticId: string
  /** The original diagnostic is absent from the NEW snapshot. */
  cleared: boolean
  /** New diagnostics that were not present before (must be inspected by user). */
  introducedIds: readonly string[]
  remainingCount: number
}

/**
 * The post-fix re-diagnosis contract. The caller MUST re-run the real document
 * diagnostics on the edited Markdown and pass the NEW snapshot here; this
 * function never guesses a fix succeeded from the patch alone.
 */
export function verifyFixOutcome(
  diagnosticId: string,
  before: DocumentDiagnosticsSnapshot,
  after: DocumentDiagnosticsSnapshot,
): FixVerification {
  const beforeIds = new Set(before.diagnostics.map(d => d.id))
  const afterIds = new Set(after.diagnostics.map(d => d.id))
  return {
    diagnosticId,
    cleared: !afterIds.has(diagnosticId),
    introducedIds: [...afterIds].filter(id => !beforeIds.has(id)).sort(),
    remainingCount: after.diagnostics.length,
  }
}

/**
 * The production transaction adapter is intentionally not implemented until a
 * verified Typora range-edit transaction exists. A caller can inject a test
 * adapter, but the default is a hard BLOCKED result.
 */
export interface DiagnosticFixTransactionAdapter {
  available: boolean
  apply(input: {
    markdown: string
    patches: readonly DiagnosticFixPatch[]
    expectedMarkdownHash: string
  }): Promise<{ ok: boolean; reason: string }>
}

export function createUnavailableFixTransactionAdapter(): DiagnosticFixTransactionAdapter {
  return {
    available: false,
    async apply() {
      return { ok: false, reason: 'TRANSACTION_AUTHORITY_UNVERIFIED' }
    },
  }
}

/**
 * V5.15 — Standalone Object Block Invariant (figure / table / formula).
 *
 * ONE business object = ONE standalone owning block = ONE canonical business
 * target. This module owns the shared, PURE structure authority:
 *
 *   raw object occurrence discovery
 *        ↓
 *   resolve owning block (Markdown block ownership / DOM block ownership)
 *        ↓
 *   Standalone Object Structure Gate
 *        ↓
 *   valid  → normal canonical target → numbering → caption / name → locate
 *   invalid→ ONE merged structural diagnostic + exclusion from the normal
 *            business chain (numbering / caption / naming) while the
 *            diagnostic itself stays locatable on the WHOLE owning block.
 *
 * Images carry the strictest rule set:
 *   1. an image may not share its owning block with normal body text;
 *   2. an owning block may not contain more than one image;
 *   3. an image must be a standalone block (never a list item / blockquote
 *      payload / code / table cell);
 *   4. the image syntax itself (alt / title / link wrapper) is part of the
 *      image object and is NEVER "mixed text";
 *   5. a violating block never enters the normal figure numbering / caption /
 *      naming / business locate chain.
 *
 * The table / formula kinds share the SAME abstraction; their existing parser
 * behaviour is already `1 block : 1 object`, so for them this module is an
 * invariant audit surface only (no behavioural rewrite).
 *
 * Pure: no host state, no audit emission. DOM reading is limited to the
 * read-only descriptors below (the same convention the other
 * document-diagnostics geometry modules already use).
 */

import { parseImageSourceOccurrences, type ImageSourceOccurrence } from './document-resource-scanner'
// V1 §7 — the ONE stable DOM owning-block identity authority (never `dom-block:p:na`).
import { buildDomBlockIdentity } from './document-diagnostic-locator-authority-v1'

// ── §4 — the unified abstraction ───────────────────────────────────────────

export type StandaloneObjectKind = 'figure' | 'table' | 'formula'

export type StandaloneObjectViolation =
  | 'MIXED_WITH_TEXT'
  | 'MULTIPLE_OBJECTS_IN_BLOCK'
  | 'NON_STANDALONE_CONTAINER'

/** The owning container of the object (Markdown block kind or DOM block kind). */
export type StandaloneContainerKind =
  | 'paragraph'
  | 'figure'
  | 'list-item'
  | 'blockquote'
  | 'table'
  | 'code'

/** Containers that can legitimately host a standalone business object. */
const STANDALONE_CONTAINER_KINDS: ReadonlySet<StandaloneContainerKind> = new Set(['paragraph', 'figure'])

/** §8.1 — the internal figure reason codes (one per violation kind). */
export const IMAGE_MIXED_WITH_TEXT_CODE = 'IMAGE_MIXED_WITH_TEXT'
export const IMAGE_MULTIPLE_IN_BLOCK_CODE = 'IMAGE_MULTIPLE_IN_BLOCK'
export const IMAGE_NOT_STANDALONE_BLOCK_CODE = 'IMAGE_NOT_STANDALONE_BLOCK'

/** §8 — the single published structural rule id (severity = error). */
export const FIGURE_BLOCK_STRUCTURE_INVALID_CODE = 'FIGURE_BLOCK_STRUCTURE_INVALID'

export interface StandaloneObjectBlockFacts {
  kind: StandaloneObjectKind
  owningBlockIdentity: string
  /** how many business objects the owning block contains. */
  objectCount: number
  /** the residual text of the owning block once every object token is removed. */
  nonObjectSemanticContentText: string
  containerKind: StandaloneContainerKind
}

export interface StandaloneObjectBlockAnalysis {
  kind: StandaloneObjectKind
  owningBlockIdentity: string
  objectCount: number
  nonObjectSemanticContentCount: number
  nonObjectSemanticContentText: string
  containerKind: StandaloneContainerKind
  standalone: boolean
  violations: StandaloneObjectViolation[]
}

/**
 * §2/§4 — the ONE structural decision for an owning block. Pure function of the
 * block facts: object count + non-object semantic content + container kind.
 */
export function analyzeStandaloneObjectBlock(
  facts: StandaloneObjectBlockFacts,
): StandaloneObjectBlockAnalysis {
  const violations: StandaloneObjectViolation[] = []
  const residual = (facts.nonObjectSemanticContentText ?? '').replace(/\s+/g, ' ').trim()
  if (!STANDALONE_CONTAINER_KINDS.has(facts.containerKind)) violations.push('NON_STANDALONE_CONTAINER')
  if ((facts.objectCount ?? 0) > 1) violations.push('MULTIPLE_OBJECTS_IN_BLOCK')
  if (residual.length > 0) violations.push('MIXED_WITH_TEXT')
  return {
    kind: facts.kind,
    owningBlockIdentity: facts.owningBlockIdentity,
    objectCount: facts.objectCount ?? 0,
    nonObjectSemanticContentCount: residual.length,
    nonObjectSemanticContentText: residual,
    containerKind: facts.containerKind,
    standalone: violations.length === 0,
    violations,
  }
}

// ── §5 — the figure structure result model ─────────────────────────────────

export type FigureBlockStructureDecision =
  | 'VALID_STANDALONE_FIGURE'
  | 'INVALID_MIXED_WITH_TEXT'
  | 'INVALID_MULTIPLE_IMAGES'
  | 'INVALID_NON_STANDALONE_CONTAINER'
  | 'INVALID_COMPOSITE'

export interface FigureBlockStructureResult {
  owningBlockIdentity: string
  imageOccurrenceCount: number
  hasNonImageSemanticContent: boolean
  nonImageContentSummary: string
  containerKind: StandaloneContainerKind
  decision: FigureBlockStructureDecision
  violations: StandaloneObjectViolation[]
  /** §8.1 — the internal reason codes for the UI / audit. */
  violationCodes: string[]
}

/** Map one violation kind to its published internal reason code. */
export function figureViolationCode(violation: StandaloneObjectViolation): string {
  if (violation === 'MIXED_WITH_TEXT') return IMAGE_MIXED_WITH_TEXT_CODE
  if (violation === 'MULTIPLE_OBJECTS_IN_BLOCK') return IMAGE_MULTIPLE_IN_BLOCK_CODE
  return IMAGE_NOT_STANDALONE_BLOCK_CODE
}

function figureDecisionFor(violations: readonly StandaloneObjectViolation[]): FigureBlockStructureDecision {
  if (violations.length === 0) return 'VALID_STANDALONE_FIGURE'
  if (violations.length > 1) return 'INVALID_COMPOSITE'
  if (violations[0] === 'MIXED_WITH_TEXT') return 'INVALID_MIXED_WITH_TEXT'
  if (violations[0] === 'MULTIPLE_OBJECTS_IN_BLOCK') return 'INVALID_MULTIPLE_IMAGES'
  return 'INVALID_NON_STANDALONE_CONTAINER'
}

/** §5 — the figure projection of the unified analysis. */
export function analyzeFigureBlockStructure(facts: StandaloneObjectBlockFacts): FigureBlockStructureResult {
  const analysis = analyzeStandaloneObjectBlock({ ...facts, kind: 'figure' })
  return {
    owningBlockIdentity: analysis.owningBlockIdentity,
    imageOccurrenceCount: analysis.objectCount,
    hasNonImageSemanticContent: analysis.nonObjectSemanticContentCount > 0,
    nonImageContentSummary: analysis.nonObjectSemanticContentText,
    containerKind: analysis.containerKind,
    decision: figureDecisionFor(analysis.violations),
    violations: analysis.violations,
    violationCodes: analysis.violations.map(figureViolationCode),
  }
}

/** §25 — the user-facing copy for a structure result (ONE merged message). */
export function figureStructureUserCopy(result: FigureBlockStructureResult): { title: string; detail: string } {
  const mixed = result.violations.includes('MIXED_WITH_TEXT')
  const multiple = result.violations.includes('MULTIPLE_OBJECTS_IN_BLOCK')
  const container = result.violations.includes('NON_STANDALONE_CONTAINER')
  let detail = '图片必须独立成块，且每个图片块只能包含一张图片。'
  if (mixed && multiple) {
    detail = '当前段落同时包含正文和多张图片。图片必须独立成块，且每个图片块只能包含一张图片。'
  } else if (mixed) {
    detail = '图片必须作为独立块插入，不能与普通正文内容处于同一段落。'
  } else if (multiple) {
    detail = '每个图片块只能包含一张图片，请将多张图片拆分为独立图片块。'
  } else if (container) {
    detail = '图片必须作为独立块插入，不能放在列表项、引用或代码块中。'
  }
  return { title: '图片块格式不规范', detail }
}

// ── §3 — Markdown block ownership (source authority) ───────────────────────

interface SourceLine {
  /** 0-based line index in the Markdown source. */
  index: number
  text: string
  /** absolute offset of the line start (inclusive). */
  start: number
  /** absolute offset AFTER the line break (exclusive). */
  end: number
  /** offset of the line's content end (excludes a CR / the line break). */
  contentEnd: number
  blank: boolean
  kind: 'paragraph' | 'blockquote' | 'list-item' | 'code' | 'fence'
}

const FENCE_RE = /^\s*(```|~~~)/
const BLOCKQUOTE_RE = /^\s*>/
const LIST_RE = /^\s*([-*+]|\d+[.)])\s+/
const INDENTED_CODE_RE = /^( {4,}|\t)/

function buildSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  let index = 0
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) !== 10) continue
    let contentEnd = i
    if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1
    lines.push(makeSourceLine(source, index, start, contentEnd, i + 1))
    start = i + 1
    index++
  }
  lines.push(makeSourceLine(source, index, start, source.length, source.length))
  return lines
}

function makeSourceLine(source: string, index: number, start: number, contentEnd: number, end: number): SourceLine {
  const text = source.slice(start, contentEnd)
  const trimmed = text.trim()
  let kind: SourceLine['kind'] = 'paragraph'
  if (FENCE_RE.test(text)) kind = 'fence'
  else if (BLOCKQUOTE_RE.test(text)) kind = 'blockquote'
  else if (LIST_RE.test(text)) kind = 'list-item'
  else if (INDENTED_CODE_RE.test(text)) kind = 'code'
  return { index, text, start, end, contentEnd, blank: trimmed === '', kind }
}

/** One Markdown owning block (paragraph / list item / blockquote / code span). */
export interface FigureStandaloneSourceBlock {
  owningBlockIdentity: string
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  /** absolute source span of the WHOLE owning block (the locate target). */
  blockStart: number
  blockEnd: number
  rawText: string
  containerKind: StandaloneContainerKind
  imageOccurrenceCount: number
  hasNonImageSemanticContent: boolean
  nonImageContentSummary: string
  /** tokenStart of every image occurrence owned by this block. */
  tokenStarts: number[]
  result: FigureBlockStructureResult
}

interface SourceBlockRange {
  /** 0-based line index of the first line of the owning block. */
  startLineIndex: number
  /** 0-based line index of the last line of the owning block. */
  endLineIndex: number
  start: number
  end: number
  startColumn: number
  endColumn: number
  containerKind: StandaloneContainerKind
}

function containerKindForLines(lines: readonly SourceLine[]): StandaloneContainerKind {
  if (lines.some(l => l.kind === 'fence' || l.kind === 'code')) return 'code'
  const first = lines[0]
  if (first == null) return 'paragraph'
  if (first.kind === 'blockquote') return 'blockquote'
  if (first.kind === 'list-item') return 'list-item'
  return 'paragraph'
}

/**
 * §3 — group the Markdown source into owning blocks by REAL block ownership
 * (blank-line separated runs, fence aware), never by a single-line trim test.
 */
function groupSourceBlocks(source: string): SourceBlockRange[] {
  const lines = buildSourceLines(source)
  const out: SourceBlockRange[] = []
  let inFence = false
  let current: SourceLine[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    const last = current[current.length - 1]
    out.push({
      startLineIndex: first.index,
      endLineIndex: last.index,
      start: first.start,
      end: last.contentEnd,
      startColumn: 0,
      endColumn: last.text.length,
      containerKind: containerKindForLines(current),
    })
    current = []
  }
  for (const line of lines) {
    if (inFence) {
      current.push(line)
      if (FENCE_RE.test(line.text)) {
        inFence = false
        flush()
      }
      continue
    }
    if (FENCE_RE.test(line.text)) {
      flush()
      current.push(line)
      inFence = true
      continue
    }
    if (line.blank) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return out
}

/** Strip the container markers a residual fragment may still carry. */
function stripContainerMarkers(residualLine: string): string {
  return residualLine
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .trim()
}

/**
 * §2/§3 — analyse EVERY image owning block of a Markdown source.
 *
 * The authority is Markdown block ownership + image occurrence count +
 * non-image semantic content count. Only blocks that really own at least one
 * image occurrence are returned.
 */
export function analyzeFigureStandaloneSourceBlocks(input: {
  source: string
  occurrences: readonly { tokenStart: number; tokenEnd: number }[]
}): FigureStandaloneSourceBlock[] {
  const source = input.source ?? ''
  if (source === '') return []
  const occurrences = input.occurrences ?? []
  const blocks = groupSourceBlocks(source)
  const out: FigureStandaloneSourceBlock[] = []
  for (const block of blocks) {
    const owned = occurrences
      .filter(o => o.tokenStart >= block.start && o.tokenStart < block.end)
      .sort((a, b) => a.tokenStart - b.tokenStart)
    if (owned.length === 0) continue
    // Residual = the block text with EVERY image token removed.
    let residual = ''
    let cursor = block.start
    for (const o of owned) {
      residual += source.slice(cursor, o.tokenStart)
      cursor = Math.max(cursor, o.tokenEnd)
    }
    residual += source.slice(cursor, block.end)
    const summary = residual
      .split('\n')
      .map(stripContainerMarkers)
      .filter(t => t !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const result = analyzeFigureBlockStructure({
      kind: 'figure',
      owningBlockIdentity: `src-block:${block.startLineIndex}`,
      objectCount: owned.length,
      nonObjectSemanticContentText: summary,
      containerKind: block.containerKind,
    })
    out.push({
      owningBlockIdentity: result.owningBlockIdentity,
      startLine: block.startLineIndex,
      endLine: block.endLineIndex,
      startColumn: block.startColumn,
      endColumn: block.endColumn,
      blockStart: block.start,
      blockEnd: block.end,
      rawText: source.slice(block.start, block.end),
      containerKind: block.containerKind,
      imageOccurrenceCount: owned.length,
      hasNonImageSemanticContent: result.hasNonImageSemanticContent,
      nonImageContentSummary: summary,
      tokenStarts: owned.map(o => o.tokenStart),
      result,
    })
  }
  return out
}

// ── §5 — DOM owning-block descriptor (read-only) ───────────────────────────

export interface FigureOwningBlockDomFacts {
  owningBlockIdentity: string
  containerKind: StandaloneContainerKind
  imageCountInBlock: number
  nonImageSemanticText: string
}

const CAPTION_PROJECTION_SELECTOR = '[data-inkchapter-caption]'

/**
 * §2.1 — the image's OWN object subtree (the `md-image` wrapper carrying the alt
 * / title metadata). The alt text is part of the image syntax, so it must never
 * be counted as "body text mixed with the image".
 */
function imageObjectRoot(img: HTMLElement, block: HTMLElement): HTMLElement {
  let node: HTMLElement = img
  for (let depth = 0; depth < 4; depth++) {
    const parent = node.parentElement
    if (parent == null || parent === block) break
    if (parent.tagName === 'P' || parent.tagName === 'FIGURE') break
    if (parent.querySelectorAll('img').length !== 1) break
    node = parent
  }
  return node
}

function collectSemanticText(node: Node, skip: ReadonlySet<HTMLElement>, out: string[]): void {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? ''
    if (text.trim() !== '') out.push(text)
    return
  }
  if (node.nodeType !== 1) return
  const el = node as HTMLElement
  if (el.tagName === 'IMG') return // the image token itself is never "mixed text"
  if (skip.has(el)) return // the image object wrapper (alt / title metadata)
  if (el.matches?.(CAPTION_PROJECTION_SELECTOR)) return // the projection is not document text
  for (const child of Array.from(el.childNodes)) collectSemanticText(child, skip, out)
}

/**
 * §3 — read the owning-block facts of a rendered image from the DOM. The DOM is
 * the LIVE projection of the Markdown block ownership; the analysis itself
 * stays in `analyzeFigureBlockStructure` (pure).
 */
export function describeFigureOwningBlockDom(img: HTMLElement): FigureOwningBlockDomFacts {
  const block = (img.closest('figure') ?? img.closest('p') ?? img.parentElement ?? img) as HTMLElement
  let containerKind: StandaloneContainerKind = 'paragraph'
  if (block.tagName === 'FIGURE') containerKind = 'figure'
  else if (img.closest('table, td, th') != null) containerKind = 'table'
  else if (img.closest('pre, code, .md-codeblock') != null) containerKind = 'code'
  else if (img.closest('blockquote') != null) containerKind = 'blockquote'
  else if (img.closest('li') != null) containerKind = 'list-item'
  const blockImages = Array.from(block.querySelectorAll<HTMLElement>('img'))
    .filter(el => el.closest(CAPTION_PROJECTION_SELECTOR) == null)
  const imageCountInBlock = blockImages.length
  const skip = new Set<HTMLElement>(blockImages.map(el => imageObjectRoot(el, block)))
  const parts: string[] = []
  collectSemanticText(block, skip, parts)
  // V1 §7 — a RESOLVABLE DOM owning-block identity: a Typora runtime id, the
  // `data-line` stamp, the element id, or a deterministic structural fallback.
  // `dom-block:p:na` is never produced (it can not be resolved at click time).
  const runtimeId = block.getAttribute('data-node-id') ?? block.getAttribute('data-block-id')
  const dataLine = block.getAttribute('data-line') ?? img.getAttribute('data-line')
  const parent = block.parentElement
  const ordinal = parent ? Array.from(parent.children).indexOf(block) : 0
  const destinationSignature = blockImages
    .map(el => el.getAttribute('src') ?? '')
    .filter(v => v !== '')
    .join(',')
  const owningBlockIdentity = buildDomBlockIdentity({
    tag: block.tagName,
    runtimeId,
    dataLine,
    elementId: block.id !== '' ? block.id : null,
    ordinal,
    structuralSignature: `${imageCountInBlock}:${destinationSignature}`,
  })
  return {
    owningBlockIdentity,
    containerKind,
    imageCountInBlock,
    nonImageSemanticText: parts.join(' ').replace(/\s+/g, ' ').trim(),
  }
}

/** Convenience: the DOM structure result for one rendered image. */
export function analyzeFigureBlockStructureDom(img: HTMLElement): FigureBlockStructureResult {
  const facts = describeFigureOwningBlockDom(img)
  return analyzeFigureBlockStructure({
    kind: 'figure',
    owningBlockIdentity: facts.owningBlockIdentity,
    objectCount: facts.imageCountInBlock,
    nonObjectSemanticContentText: facts.nonImageSemanticText,
    containerKind: facts.containerKind,
  })
}

// ── §11/§12 — deterministic auto-fix (split blocks only) ───────────────────

export interface StandaloneFigureBlockFixResult {
  changed: boolean
  output: string
  splitBlockCount: number
}

function detectEol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * §11 — deterministic structure fix. It ONLY splits blocks: text is preserved,
 * images are preserved (path / alt / link destination / order untouched) and
 * the result keeps exactly ONE blank line between the produced blocks.
 *
 * §11 cases: text+image, image+image, text+multi-image. List / blockquote
 * payloads are diagnostics-only (a fix would have to invent container
 * semantics), so they are left byte-identical.
 *
 * Idempotent by construction: after the fix no line carries an image token
 * together with other content and no line carries two tokens.
 */
export function buildStandaloneFigureBlockFix(source: string): StandaloneFigureBlockFixResult {
  if (!source) return { changed: false, output: source, splitBlockCount: 0 }
  const eol = detectEol(source)
  const occurrences = parseImageSourceOccurrences(source)
  if (occurrences.length === 0) return { changed: false, output: source, splitBlockCount: 0 }
  const blocks = analyzeFigureStandaloneSourceBlocks({ source, occurrences })
  const fixable = blocks.filter(b =>
    !b.result.violations.includes('NON_STANDALONE_CONTAINER')
    && b.result.decision !== 'VALID_STANDALONE_FIGURE')
  if (fixable.length === 0) return { changed: false, output: source, splitBlockCount: 0 }

  const byStart = new Map<number, FigureStandaloneSourceBlock>()
  for (const b of fixable) byStart.set(b.blockStart, b)
  let output = ''
  let cursor = 0
  let splits = 0
  for (const b of [...fixable].sort((x, y) => x.blockStart - y.blockStart)) {
    if (b.blockStart < cursor) continue
    output += source.slice(cursor, b.blockStart)
    output += buildSplitBlockText(source, b, occurrences, eol)
    cursor = b.blockEnd
    splits++
  }
  output += source.slice(cursor)
  const changed = output !== source
  return { changed, output: changed ? output : source, splitBlockCount: splits }
}

function buildSplitBlockText(
  source: string,
  block: FigureStandaloneSourceBlock,
  occurrences: readonly ImageSourceOccurrence[],
  eol: string,
): string {
  const owned = occurrences
    .filter(o => block.tokenStarts.includes(o.tokenStart))
    .sort((a, b) => a.tokenStart - b.tokenStart)
  const parts: string[] = []
  let cursor = block.blockStart
  for (const o of owned) {
    const before = source.slice(cursor, o.tokenStart)
    const text = before.split('\n').map(stripContainerMarkers).filter(t => t !== '').join(' ')
    if (text !== '') parts.push(text)
    parts.push(source.slice(o.tokenStart, o.tokenEnd))
    cursor = o.tokenEnd
  }
  const tail = source.slice(cursor, block.blockEnd)
    .split('\n').map(stripContainerMarkers).filter(t => t !== '').join(' ')
  if (tail !== '') parts.push(tail)
  return parts.join(eol + eol)
}

// ── §16/§18/§19 — the V5.15 hard gates ─────────────────────────────────────

export const FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS = [
  'mixedWithTextAdmittedAsNormalTarget',
  'multiImageBlockAdmittedAsNormalTarget',
  'nonStandaloneContainerAdmittedAsNormalTarget',
  'invalidFigureBlockNumbered',
  'invalidFigureBlockCaptioned',
  'invalidFigureBlockWithMissingNameDiagnostic',
  'structureDuplicateDiagnostic',
  'structureUnlocatableDiagnostic',
  'validStandaloneFigureRejected',
  'validStandaloneFigureNumberingRegression',
  'validStandaloneFigureCaptionRegression',
] as const

export type FigureBlockStructureV515GateKey = typeof FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS[number]

export const FIGURE_BLOCK_STRUCTURE_V515_GATE_LABELS: Readonly<Record<FigureBlockStructureV515GateKey, string>> = {
  mixedWithTextAdmittedAsNormalTarget: 'FIGURE_MIXED_WITH_TEXT_ADMITTED_AS_NORMAL_TARGET_COUNT',
  multiImageBlockAdmittedAsNormalTarget: 'FIGURE_MULTI_IMAGE_BLOCK_ADMITTED_AS_NORMAL_TARGET_COUNT',
  nonStandaloneContainerAdmittedAsNormalTarget: 'FIGURE_NON_STANDALONE_CONTAINER_ADMITTED_AS_NORMAL_TARGET_COUNT',
  invalidFigureBlockNumbered: 'INVALID_FIGURE_BLOCK_NUMBERED_COUNT',
  invalidFigureBlockCaptioned: 'INVALID_FIGURE_BLOCK_CAPTIONED_COUNT',
  invalidFigureBlockWithMissingNameDiagnostic: 'INVALID_FIGURE_BLOCK_WITH_MISSING_NAME_DIAGNOSTIC_COUNT',
  structureDuplicateDiagnostic: 'FIGURE_STRUCTURE_DUPLICATE_DIAGNOSTIC_COUNT',
  structureUnlocatableDiagnostic: 'FIGURE_STRUCTURE_UNLOCATABLE_DIAGNOSTIC_COUNT',
  validStandaloneFigureRejected: 'VALID_STANDALONE_FIGURE_REJECTED_COUNT',
  validStandaloneFigureNumberingRegression: 'VALID_STANDALONE_FIGURE_NUMBERING_REGRESSION_COUNT',
  validStandaloneFigureCaptionRegression: 'VALID_STANDALONE_FIGURE_CAPTION_REGRESSION_COUNT',
}

export type FigureBlockStructureV515Counters = Record<FigureBlockStructureV515GateKey, number>

export function createFigureBlockStructureV515Counters(): FigureBlockStructureV515Counters {
  return FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as FigureBlockStructureV515Counters)
}

export function formatFigureBlockStructureV515GateReport(
  counters: Readonly<FigureBlockStructureV515Counters>,
): string[] {
  return FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS.map(k => `${FIGURE_BLOCK_STRUCTURE_V515_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateFigureBlockStructureV515Gates(
  counters: Readonly<FigureBlockStructureV515Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: FigureBlockStructureV515GateKey[] } {
  const failedChecks = FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §16/§17 — the DETECTION / coverage surface (non-zero is expected here). */
export interface FigureBlockStructureV515CoverageCounters {
  figureBlocksAnalyzed: number
  validStandaloneFigureBlocks: number
  invalidFigureBlocks: number
  structureDiagnosticsPublished: number
  mergedViolationMultiplicity: number
  figuresExcludedFromNormalTargets: number
}

export function createFigureBlockStructureV515CoverageCounters(): FigureBlockStructureV515CoverageCounters {
  return {
    figureBlocksAnalyzed: 0,
    validStandaloneFigureBlocks: 0,
    invalidFigureBlocks: 0,
    structureDiagnosticsPublished: 0,
    mergedViolationMultiplicity: 0,
    figuresExcludedFromNormalTargets: 0,
  }
}

export function formatFigureBlockStructureV515CoverageReport(
  counters: Readonly<FigureBlockStructureV515CoverageCounters>,
): string[] {
  return [
    `FIGURE_BLOCKS_ANALYZED_COUNT=${counters.figureBlocksAnalyzed}`,
    `VALID_STANDALONE_FIGURE_BLOCK_COUNT=${counters.validStandaloneFigureBlocks}`,
    `INVALID_FIGURE_BLOCK_COUNT=${counters.invalidFigureBlocks}`,
    `FIGURE_STRUCTURE_DIAGNOSTIC_PUBLISHED_COUNT=${counters.structureDiagnosticsPublished}`,
    `FIGURE_STRUCTURE_MERGED_VIOLATION_MULTIPLICITY=${counters.mergedViolationMultiplicity}`,
    `FIGURE_EXCLUDED_FROM_NORMAL_TARGET_COUNT=${counters.figuresExcludedFromNormalTargets}`,
  ]
}

// ── The process-wide diagnostic slot (ONE accumulator, resettable) ──────────

let gateCounters = createFigureBlockStructureV515Counters()
let coverageCounters = createFigureBlockStructureV515CoverageCounters()
let publishedStructureDiagnostics = new Set<string>()

export function resetFigureBlockStructureV515State(): void {
  gateCounters = createFigureBlockStructureV515Counters()
  coverageCounters = createFigureBlockStructureV515CoverageCounters()
  publishedStructureDiagnostics = new Set<string>()
}

/**
 * §16/§18 — open ONE DOM admission pass (called by the diagnostics authority
 * before it walks the live DOM). Only the COVERAGE surface is pass-scoped (so
 * the counts describe the current document); the hard-gate counters stay
 * cumulative on purpose — a forbidden admission observed once can never be
 * masked by a later pass.
 */
export function beginFigureBlockStructureV515DomPass(): void {
  coverageCounters = createFigureBlockStructureV515CoverageCounters()
}

/**
 * §18 — open ONE source structure pass. Duplicate detection is scoped to a
 * single diagnostics compute: re-publishing the same owning block in a LATER
 * snapshot (a normal recompute) is never a duplicate.
 */
export function beginFigureStructureDiagnosticPass(): void {
  publishedStructureDiagnostics = new Set<string>()
}

export function getFigureBlockStructureV515Counters(): FigureBlockStructureV515Counters {
  return { ...gateCounters }
}

export function getFigureBlockStructureV515CoverageCounters(): FigureBlockStructureV515CoverageCounters {
  return { ...coverageCounters }
}

export function getFigureBlockStructureV515GateReport(): string[] {
  return formatFigureBlockStructureV515GateReport(gateCounters)
}

export function getFigureBlockStructureV515CoverageReport(): string[] {
  return formatFigureBlockStructureV515CoverageReport(coverageCounters)
}

export function getFigureBlockStructureV515GateDecision(): {
  decision: 'PASS' | 'FAIL'
  failedChecks: readonly string[]
} {
  const verdict = evaluateFigureBlockStructureV515Gates(gateCounters)
  return {
    decision: verdict.decision,
    failedChecks: verdict.failedChecks.map(k => FIGURE_BLOCK_STRUCTURE_V515_GATE_LABELS[k]),
  }
}

/**
 * §18/§19 — record that a figure block reached a NORMAL business target
 * admission decision (numbering / caption plan / diagnostics figures list).
 *
 * `admitted` = the caller really let this image into the normal target set.
 */
export function noteFigureBlockAdmission(
  result: FigureBlockStructureResult,
  admitted: boolean,
): void {
  coverageCounters.figureBlocksAnalyzed++
  if (result.decision === 'VALID_STANDALONE_FIGURE') {
    coverageCounters.validStandaloneFigureBlocks++
    if (!admitted) gateCounters.validStandaloneFigureRejected++
    return
  }
  coverageCounters.invalidFigureBlocks++
  if (!admitted) {
    coverageCounters.figuresExcludedFromNormalTargets++
    return
  }
  // An INVALID block was admitted into the normal business chain.
  if (result.violations.includes('MIXED_WITH_TEXT')) gateCounters.mixedWithTextAdmittedAsNormalTarget++
  if (result.violations.includes('MULTIPLE_OBJECTS_IN_BLOCK')) gateCounters.multiImageBlockAdmittedAsNormalTarget++
  if (result.violations.includes('NON_STANDALONE_CONTAINER')) gateCounters.nonStandaloneContainerAdmittedAsNormalTarget++
  coverageCounters.figuresExcludedFromNormalTargets++
}

/** §18 — record that an admitted figure target really got a caption / number. */
export function noteInvalidFigureBlockNumberedOrCaptioned(result: FigureBlockStructureResult): void {
  if (result.decision === 'VALID_STANDALONE_FIGURE') return
  gateCounters.invalidFigureBlockNumbered++
  gateCounters.invalidFigureBlockCaptioned++
}

/** §18 — record a normal figure naming diagnostic produced for an INVALID block. */
export function noteInvalidFigureBlockNamingDiagnostic(): void {
  gateCounters.invalidFigureBlockWithMissingNameDiagnostic++
}

/** §19 — a valid standalone figure that lost its numbering / caption. */
export function noteValidStandaloneFigureNumberingRegression(): void {
  gateCounters.validStandaloneFigureNumberingRegression++
}

export function noteValidStandaloneFigureCaptionRegression(): void {
  gateCounters.validStandaloneFigureCaptionRegression++
}

/**
 * §18 — record the publication of ONE merged structural diagnostic for a block.
 * A second publication for the SAME block is a duplicate (hard gate).
 */
export function noteFigureStructureDiagnosticPublished(input: {
  owningBlockIdentity: string
  violationCount: number
  locatable: boolean
}): void {
  const key = input.owningBlockIdentity
  if (publishedStructureDiagnostics.has(key)) gateCounters.structureDuplicateDiagnostic++
  publishedStructureDiagnostics.add(key)
  coverageCounters.structureDiagnosticsPublished++
  if (input.violationCount > 1) coverageCounters.mergedViolationMultiplicity++
  if (!input.locatable) gateCounters.structureUnlocatableDiagnostic++
}

// ── §16/§17 — the runtime audit contract ───────────────────────────────────

export const DOCUMENT_DIAGNOSTIC_STANDALONE_OBJECT_BLOCK_AUDIT =
  'DOCUMENT-DIAGNOSTIC-STANDALONE-OBJECT-BLOCK-AUDIT'
export const FIGURE_BLOCK_STRUCTURE_AUDIT = 'FIGURE-BLOCK-STRUCTURE-AUDIT'

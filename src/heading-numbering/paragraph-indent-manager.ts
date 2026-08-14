/**
 * Paragraph Indent Manager — manages paragraph-level indent semantics.
 *
 * Responsibilities:
 * 1. Parse `<!-- inkchapter:paragraph-indent=2 -->` markers from Markdown source
 * 2. Apply text-indent styles to paragraph DOM elements
 * 3. Detect formula continuation (paragraph → display math → paragraph)
 * 4. Handle `..` / `。。` + Enter shortcut for force-indent-2 paragraphs
 * 5. Handle Backspace at logical start to remove force-indent (→ force-flush)
 */

import type {
  ParagraphIndentMode,
  ParagraphIndentOverride,
  ParagraphLayoutContext,
  ParagraphLayoutSettings,
} from './heading-types'
import { PARAGRAPH_INDENT_MARKER, resolveParagraphIndent } from './heading-types'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

const INDENT_MARKER_COMMENT = `<!-- ${PARAGRAPH_INDENT_MARKER} -->`

// CSS class applied for effective visual indent-2 projection.
// This is PURELY a visual artifact — NEVER used to determine semantic mode.
const EFFECTIVE_INDENT_CLASS = 'inkchapter-paragraph-effective-indent-2'

// CSS class applied for effective visual flush projection.
// Ensures computed text-indent=0 even when parent has text-indent inheritance.
// Mutually exclusive with EFFECTIVE_INDENT_CLASS.
const EFFECTIVE_FLUSH_CLASS = 'inkchapter-paragraph-effective-flush'

// ── Writer Registry (dev-only diagnostic) ──────────────────────────
// Tracks the full writer history for each paragraph.
// Write-only diagnostic — never used to gate behavior.

/** High-level writer IDs for tracing paragraph state modifications. */
export const WriterIds = {
  ENTER_COMMIT_SEMANTIC: 'W-ENTER-COMMIT-SEMANTIC',
  ENTER_COMMIT_VISUAL: 'W-ENTER-COMMIT-VISUAL',
  CARET_ENTER_RESTORE: 'W-CARET-ENTER-RESTORE',
  BACKSPACE_SEMANTIC: 'W-BACKSPACE-SEMANTIC',
  EXPLICIT_UI_SEMANTIC: 'W-EXPLICIT-UI-SEMANTIC',
  REFRESH_VISUAL: 'W-REFRESH-VISUAL',
  LOCAL_PROJECTION_VISUAL: 'W-LOCAL-PROJECTION-VISUAL',
  SETTINGS_REFRESH_VISUAL: 'W-SETTINGS-REFRESH-VISUAL',
  REHYDRATE_SEMANTIC: 'W-REHYDRATE-SEMANTIC',
  REHYDRATE_VISUAL: 'W-REHYDRATE-VISUAL',
  SIDECAR_RECONSTRUCT_SEMANTIC: 'W-SIDECAR-RECONSTRUCT-SEMANTIC',
  SIDECAR_RECONSTRUCT_VISUAL: 'W-SIDECAR-RECONSTRUCT-VISUAL',
  DOM_REBUILD_RESTORE: 'W-DOM-REBUILD-RESTORE',
  LEGACY_MARKER_VISUAL: 'W-LEGACY-MARKER-VISUAL',
  LEGACY_MIGRATION_SEMANTIC: 'W-LEGACY-MIGRATION-SEMANTIC',
  SIDECAR_WRITE: 'W-SIDECAR-WRITE',
  SIDECAR_LOAD: 'W-SIDECAR-LOAD',
  CARET_OTHER: 'W-CARET-OTHER',
  PENDING_CONTINUITY_SEMANTIC: 'W-PENDING-CONTINUITY-SEMANTIC',
  PENDING_CONTINUITY_VISUAL: 'W-PENDING-CONTINUITY-VISUAL',
  PENDING_CONTINUITY_CARET: 'W-PENDING-CONTINUITY-CARET',
  EMPTY_SPECIAL_ROLLBACK: 'W-EMPTY-SPECIAL-ROLLBACK',
} as const

// ── R58.7: Plugin Selection Write Audit sink (read-only observation) ──
// All plugin selection writers must route through this sink so the service
// can emit PLUGIN-SELECTION-WRITE-AUDIT for every raw write site.

export interface PluginSelectionWriteAuditEntry {
  writeId: string
  caller: string
  reason: string
  runtimeId: string
  logicalOffsetBefore: number | null
  logicalOffsetRequested: number | null
  success: boolean
}

let pluginSelectionWriteSink: ((entry: PluginSelectionWriteAuditEntry) => void) | null = null

export function setPluginSelectionWriteSink(
  sink: ((entry: PluginSelectionWriteAuditEntry) => void) | null,
): void {
  pluginSelectionWriteSink = sink
}

export function emitPluginSelectionWrite(entry: PluginSelectionWriteAuditEntry): void {
  pluginSelectionWriteSink?.(entry)
}

// ── P0-4: Structured Caret Write Result ────────────────────────────

export interface CaretWriteResult {
  success: boolean
  caretWritten: boolean
  targetConnected: boolean
  realmSafe: boolean
  method: 'owner-realm-range' | 'cursor-api' | 'none'
  resolvedParagraphIdentity: string | null
  failReason?: string
}

// ── P0-5: One-Shot Paragraph Replacement Handoff ───────────────────

export interface OneShotParagraphReplacementHandoff {
  handoffId: string
  sourceTxnId: string

  /** R58.2: Canonical record identity carried through DOM replacement. */
  canonicalRecordId?: string

  /** R58.7 Phase A.1.3.1a: Runtime scope identity for cross-scope guard. */
  scopeId: string

  preElement: HTMLElement
  preOrdinal: number
  preIdentity: string

  tokenConsumed: boolean
  /** Current semantic — may be updated by Backspace/FORCE_FLUSH. NOT a frozen snapshot. */
  semantic: ParagraphIndentSemanticMode
  /** Diagnostic: semantic at handoff creation time. */
  semanticAtCreation: ParagraphIndentSemanticMode
  /** Runtime ID of preElement at creation time (diagnostic). */
  preRuntimeId: string

  consumed: boolean

  // After replacement
  replacementResolved: boolean
  replacementElement: HTMLElement | null
  replacementOrdinal: number | null
  replacementIdentity: string | null

  semanticTransferred: boolean
  visualTransferred: boolean
}

// ── R58: Live Canonical Record Binding ──────────────────────────────

/**
 * Live binding between a Typora paragraph element and its canonical sidecar record.
 * Ensures Enter/Backspace/merge mutations reuse the same record lineage,
 * and prevents temporary/live records from entering generic heuristic rehydrate.
 */
export interface LiveParagraphRecordBinding {
  /** Canonical sidecar record identity. */
  recordId: string
  /** Enter transaction ID that created this binding. */
  txnId: string
  /** Current live paragraph element. Updated on DOM replacement. */
  currentElement: HTMLElement
  /** Runtime object-identity ID (WeakMap-based). */
  currentRuntimeId: string
  /** Replacement generation counter. */
  generation: number
  /** True if the record is still provisional (empty paragraph). */
  temporary: boolean
  /** True if this record was created by the current live editing session. */
  live: boolean
  /** Document key for scope isolation. */
  documentKey: string
  /** Timestamp of binding creation. */
  createdAt: number
}

export type EnterCommitSuccessFields = {
  tokenSuccess: boolean
  semanticSuccess: boolean
  visualSuccess: boolean
  caretSuccess: boolean
  overallSuccess: boolean
}

// ── r56: Paragraph-Local Caret Types ────────────────────────────────

export interface CommandParagraphCaretTarget {
  txnId: string
  paragraph: HTMLElement
  paragraphIdentity: string
  paragraphOrdinal: number
  localLogicalOffset: 0
}

export interface ParagraphLocalCaretWriteResult {
  attempted: boolean
  success: boolean
  failureReason?: string
  writerType: 'paragraph-local-range' | 'none'
  targetParagraphIdentity: string
  targetParagraphOrdinal: number
  targetConnected: boolean
  selectionContainerType?: string
  selectionOffset?: number
  resolvedSelectionParagraphIdentity?: string
  resolvedSelectionParagraphOrdinal?: number
  localLogicalOffset?: number
  sameAsCommandParagraph: boolean
}

// ── r57: Unified Selection Resolver ─────────────────────────────────

export interface SelectionParagraphResolution {
  selectionExists: boolean
  anchorNodeType?: number
  anchorNodeName?: string
  normalizedElement?: Element | null
  paragraph?: HTMLElement | null
  paragraphRuntimeId?: string
  paragraphOrdinal?: number
  localLogicalOffset?: number
  insideEditorRoot: boolean
  reason?: string
}

/** Normalize selection anchor node to element. TextNode → parentElement. */
function normalizeSelectionNodeToElement(node: Node | null): Element | null {
  if (!node) return null
  if (node.nodeType === 1) return node as Element
  if (node.nodeType === 3) return (node as Text).parentElement
  return (node as any).parentElement ?? null
}

/** Unified public entry: resolve selection to body paragraph. */
export function resolveSelectionParagraph(
  selection: Selection | null,
  editorRoot: HTMLElement,
  getRuntimeId: (el: object) => string,
): SelectionParagraphResolution {
  const result: SelectionParagraphResolution = {
    selectionExists: false,
    insideEditorRoot: false,
  }

  if (!selection?.rangeCount || !selection.isCollapsed) {
    result.reason = 'no-valid-selection'
    return result
  }

  const anchor = selection.getRangeAt(0).startContainer
  result.anchorNodeType = anchor.nodeType
  result.anchorNodeName = anchor.nodeName
  result.selectionExists = true

  // Normalize TextNode → Element
  const normalized = normalizeSelectionNodeToElement(anchor)
  if (!normalized) {
    result.reason = 'normalized-to-null'
    return result
  }
  result.normalizedElement = normalized

  // Check inside editor root
  result.insideEditorRoot = editorRoot.contains(normalized)

  // Closest body P (not heading/list/blockquote)
  const closest = normalized.closest('p')
  if (!closest) {
    result.reason = 'no-closest-P'
    return result
  }

  // Exclude paragraphs inside excluded contexts
  const excluded = closest.closest('pre, code, .md-codeblock, li, blockquote, table, .md-math-block')
  if (excluded) {
    result.reason = 'inside-excluded-context'
    return result
  }

  const para = closest as HTMLElement
  result.paragraph = para
  result.paragraphRuntimeId = getRuntimeId(para)

  // Ordinal
  const allParas = editorRoot.querySelectorAll<HTMLElement>('p')
  let ordinal = -1
  for (let i = 0; i < allParas.length; i++) {
    if (allParas[i] === para) { ordinal = i; break }
  }
  result.paragraphOrdinal = ordinal >= 0 ? ordinal : undefined

  // Local logical offset from selection
  result.localLogicalOffset = selection.anchorOffset

  return result
}

// ── R58.6.4: Unified SelectionTruth ─────────────────────────────────

export interface SelectionTruth {
  selectionExists: boolean
  paragraph: HTMLElement | null
  runtimeId: string | null
  ordinal: number | null
  logicalOffset: number | null
  collapsed: boolean
  anchorNodeConnected: boolean
  focusNodeConnected: boolean
  insideEditor: boolean
  source?: string
}

/**
 * R58.6.4: Single authoritative selection identity resolver.
 * All selection consumers must use this ONE function.
 */
export function resolveSelectionTruth(
  editorRoot: HTMLElement,
  getRuntimeId: (el: object) => string,
  source: string,
): SelectionTruth {
  const sel = window.getSelection()
  const result: SelectionTruth = {
    selectionExists: false,
    paragraph: null,
    runtimeId: null,
    ordinal: null,
    logicalOffset: null,
    collapsed: true,
    anchorNodeConnected: false,
    focusNodeConnected: false,
    insideEditor: false,
    source,
  }

  if (!sel?.rangeCount) {
    emitRuntimeAudit('SELECTION-TRUTH', {
      source,
      runtimeId: null,
      ordinal: null,
      logicalOffset: null,
      selectionExists: false,
      collapsed: true,
      anchorConnected: false,
      focusConnected: false,
      insideEditor: false,
    })
    return result
  }

  const range = sel.getRangeAt(0)
  result.selectionExists = true
  result.collapsed = range.collapsed
  result.anchorNodeConnected = range.startContainer.isConnected || false
  result.focusNodeConnected = range.endContainer.isConnected || false

  // Resolve paragraph via existing resolver
  const selRes = resolveSelectionParagraph(sel, editorRoot, getRuntimeId)
  if (selRes.paragraph) {
    result.paragraph = selRes.paragraph
    result.runtimeId = selRes.paragraphRuntimeId ?? null
    result.ordinal = selRes.paragraphOrdinal ?? null
    result.logicalOffset = selRes.localLogicalOffset ?? null
    result.insideEditor = selRes.insideEditorRoot
  }

  emitRuntimeAudit('SELECTION-TRUTH', {
    source,
    runtimeId: result.runtimeId ?? 'null',
    ordinal: result.ordinal ?? 'null',
    logicalOffset: result.logicalOffset ?? 'null',
    collapsed: result.collapsed,
    anchorConnected: result.anchorNodeConnected,
    focusConnected: result.focusNodeConnected,
    insideEditor: result.insideEditor,
  })
  return result
}

// ── R58.6.5: CaretExpectation + Selection Continuity Verify ──────────

export type CaretExpectationReason =
  | 'SPECIAL_COMMAND_CURRENT_PARAGRAPH'
  | 'SPLIT_NEW_PARAGRAPH'
  | 'MERGE_DESTINATION'

export interface CaretExpectation {
  expectationId: string
  documentKey: string
  scopeId: string
  expectedElement: HTMLElement
  expectedRuntimeId: string
  expectedLogicalOffset: number | null
  canonicalRecordId: string | null
  generation: number
  reason: CaretExpectationReason
  createdAt: number
  active: boolean
  restoreAttempts: number
  intentEpoch: number
  /** R58.7: Paragraph text content snapshot at creation — restore gate insurance. */
  expectedTextContent?: string
}

export interface CaretVerificationResult {
  expectationId: string
  expectedRuntimeId: string
  actualRuntimeId: string | null
  expectedLogicalOffset: number | null
  actualLogicalOffset: number | null
  paragraphMatches: boolean
  offsetMatches: boolean
  connected: boolean
  verified: boolean
  caretWriteAttempted: boolean
}

export function verifyCaretExpectation(
  expectation: CaretExpectation,
  editorRoot: HTMLElement,
  getRuntimeId: (el: object) => string,
  source: 'MICROTASK' | 'RAF' | 'OBS',
): CaretVerificationResult {
  const truth = resolveSelectionTruth(editorRoot, getRuntimeId, `VERIFY-${source}`)
  const actualRtId = truth.runtimeId
  const paragraphMatches = actualRtId !== null && actualRtId === expectation.expectedRuntimeId
  const offsetMatches = truth.logicalOffset === expectation.expectedLogicalOffset
  const connected = expectation.expectedElement.isConnected
  const verified = paragraphMatches && offsetMatches && connected

  console.info(
    `[InkChapter] SELECTION-CONTINUITY-VERIFY: ` +
    `expectationId=${expectation.expectationId} ` +
    `reason=${expectation.reason} ` +
    `source=${source} ` +
    `expectedRuntimeId=${expectation.expectedRuntimeId} ` +
    `actualRuntimeId=${actualRtId ?? 'null'} ` +
    `expectedLogicalOffset=${expectation.expectedLogicalOffset} ` +
    `actualLogicalOffset=${truth.logicalOffset} ` +
    `paragraphMatches=${paragraphMatches} ` +
    `offsetMatches=${offsetMatches} ` +
    `connected=${connected} ` +
    `verified=${verified} ` +
    `caretWriteAttempted=false`,
  )
  return { expectationId: expectation.expectationId, expectedRuntimeId: expectation.expectedRuntimeId, actualRuntimeId: actualRtId, expectedLogicalOffset: expectation.expectedLogicalOffset, actualLogicalOffset: truth.logicalOffset, paragraphMatches, offsetMatches, connected, verified, caretWriteAttempted: false }
}

export function restoreLogicalCaret(
  expectation: CaretExpectation,
  editorRoot: HTMLElement,
  getRuntimeId: (el: object) => string,
): { success: boolean; actualRuntimeId: string | null; actualLogicalOffset: number | null } {
  if (expectation.restoreAttempts >= 1) {
    console.error(`[InkChapter] CARET-CONTINUITY-RESTORE-FAILED: expectationId=${expectation.expectationId} reason=DUPLICATE_RESTORE_BLOCKED restoreAttempts=${expectation.restoreAttempts} ACTION=HARD_STOP`)
    return { success: false, actualRuntimeId: null, actualLogicalOffset: null }
  }
  expectation.restoreAttempts++
  const el = expectation.expectedElement
  if (!el?.isConnected) {
    emitRuntimeAudit('CARET-CONTINUITY-RESTORE', {
      expectationId: expectation.expectationId,
      reason: expectation.reason,
      attempt: expectation.restoreAttempts,
      decision: 'FAIL (disconnected)',
    })
    return { success: false, actualRuntimeId: null, actualLogicalOffset: null }
  }
  emitRuntimeAudit('CARET-CONTINUITY-RESTORE', {
    expectationId: expectation.expectationId,
    reason: expectation.reason,
    toRuntimeId: expectation.expectedRuntimeId,
    targetLogicalOffset: expectation.expectedLogicalOffset,
    attempt: expectation.restoreAttempts,
    decision: 'ATTEMPT',
  })
  const repairResult = repairCaretAtParagraphLogicalStart(el, editorRoot, expectation.expectedRuntimeId, getRuntimeId)
  const truth = resolveSelectionTruth(editorRoot, getRuntimeId, 'RESTORE-VERIFY')
  const actualRtId = truth.runtimeId
  const success = repairResult.success && actualRtId === expectation.expectedRuntimeId
  console.info(`[InkChapter] CARET-CONTINUITY-RESTORE-RESULT: expectationId=${expectation.expectationId} actualRuntimeId=${actualRtId ?? 'null'} decision=${success ? 'SUCCESS' : 'FAIL'}`)
  return { success, actualRuntimeId: actualRtId, actualLogicalOffset: truth.logicalOffset }
}

// ── r57-stub placeholder ─────────────────────────────────────────────
export interface RuntimeParagraphContinuity {
  txnId: string
  currentElement: HTMLElement
  currentRuntimeId: string
  generation: number
}

// ── r57: Verify-First Caret ─────────────────────────────────────────

export interface PostTokenSelectionResult {
  txnId: string

  /** Runtime ID of the command target paragraph. */
  commandRuntimeId: string

  /** anchorNode diagnostic. */
  anchorNodeType?: number
  anchorNodeName?: string

  /** Resolution: resolved paragraph runtime ID from selection. */
  resolvedParagraphRuntimeId: string | null
  /** Resolution: ordinal index among all body P elements. */
  resolvedParagraphOrdinal?: number
  /** Resolution: local logical offset (= selection.anchorOffset). */
  localLogicalOffset?: number

  /** True if selected paragraph IS the command target (object identity). */
  sameAsCommandTarget: boolean

  /** True if selection is already at the correct position. */
  alreadyCorrect: boolean

  /** Whether caret repair was attempted. */
  repairAttempted: boolean
  /** Whether caret write was attempted (false when alreadyCorrect=true). */
  caretWriteAttempted: boolean
  /** Final caret success status. */
  caretSuccess: boolean
}

export interface CaretRepairResult {
  attempted: boolean
  success: boolean
  failureReason?: string
  method: 'text-leaf' | 'paragraph-structural' | 'none'
  targetElement?: HTMLElement
  targetRuntimeId?: string
  textLeafFound: boolean
  /** Readback: resolved paragraph after repair. */
  resolvedParagraphRuntimeId?: string
  resolvedParagraphOrdinal?: number
  localLogicalOffset?: number
  sameAsCommandParagraph: boolean
}

/**
 * Find the first caret-bearing text leaf inside a paragraph.
 * For the known empty-paragraph structure P > SPAN > #text, this returns
 * the Text node. Falls back to any Text descendant.
 */
export function findCaretBearingTextLeaf(paragraph: HTMLElement): Text | null {
  // P0: prefer SPAN > #text (known Typora empty paragraph structure)
  const spans = paragraph.querySelectorAll('span')
  for (const span of spans) {
    for (let i = 0; i < span.childNodes.length; i++) {
      const child = span.childNodes[i]
      if (child.nodeType === 3) return child as Text
    }
  }

  // Fallback: any direct Text child
  for (let i = 0; i < paragraph.childNodes.length; i++) {
    if (paragraph.childNodes[i].nodeType === 3) return paragraph.childNodes[i] as Text
  }

  // Deep fallback: any Text descendant
  const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  const firstText = walker.nextNode()
  return firstText as Text | null
}

/**
 * Write caret at a specific Text node offset using the paragraph's owner document.
 * Uses ownerDocument.createRange() and ownerDocument.defaultView.getSelection().
 */
export function writeCaretAtTextLeaf(
  textNode: Text,
  offset: number,
): { success: boolean; failReason?: string } {
  try {
    const doc = textNode.ownerDocument
    const win = doc.defaultView
    if (!win) return { success: false, failReason: 'no-defaultView' }
    const sel = win.getSelection()
    if (!sel) return { success: false, failReason: 'no-selection' }
    const range = doc.createRange()
    range.setStart(textNode, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    return { success: true }
  } catch (e) {
    return { success: false, failReason: `range-error: ${e}` }
  }
}

/**
 * Repair caret: set caret at paragraph logical start (offset=0).
 *
 * Priority:
 * 1. Find caret-bearing Text leaf (SPAN > #text or descendant) → write #text,0
 * 2. Fallback: setStart(paragraph, 0)
 *
 * NEVER uses neighbor-paragraph or global text offset.
 * Range from paragraph.ownerDocument. Selection from ownerDocument.defaultView.
 *
 * After write, does a readback via resolveSelectionParagraph to verify.
 */
export function repairCaretAtParagraphLogicalStart(
  paragraph: HTMLElement,
  editorRoot: HTMLElement,
  commandRuntimeId: string,
  getRuntimeId: (el: object) => string,
): CaretRepairResult {
  const result: CaretRepairResult = {
    attempted: true,
    success: false,
    method: 'none',
    textLeafFound: false,
    sameAsCommandParagraph: false,
  }

  if (!paragraph || paragraph.nodeType !== 1) {
    result.failureReason = 'null-or-not-element'
    return result
  }
  const ownerDoc = paragraph.ownerDocument
  if (!ownerDoc) { result.failureReason = 'no-ownerDocument'; return result }
  if (!paragraph.isConnected) { result.failureReason = 'disconnected'; return result }

  result.targetElement = paragraph
  result.targetRuntimeId = getRuntimeId(paragraph)

  // Priority 1: find text leaf
  const textLeaf = findCaretBearingTextLeaf(paragraph)
  if (textLeaf) {
    result.textLeafFound = true
    const writeResult = writeCaretAtTextLeaf(textLeaf, 0)
    if (writeResult.success) {
      result.method = 'text-leaf'
    }
  }

  // Priority 2: paragraph structural fallback
  if (!result.textLeafFound || !result.method) {
    try {
      const range = ownerDoc.createRange()
      range.setStart(paragraph, 0)
      range.collapse(true)
      const sel = ownerDoc.defaultView?.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
        result.method = 'paragraph-structural'
      }
    } catch {
      result.failureReason = 'paragraph-structural-range-error'
      return result
    }
  }

  // Readback: verify via resolveSelectionParagraph
  const sel = ownerDoc.defaultView?.getSelection()
  const readback = resolveSelectionParagraph(sel ?? null, editorRoot, getRuntimeId)
  if (readback.paragraphRuntimeId) {
    result.resolvedParagraphRuntimeId = readback.paragraphRuntimeId
    result.resolvedParagraphOrdinal = readback.paragraphOrdinal
    result.localLogicalOffset = readback.localLogicalOffset
    result.sameAsCommandParagraph = readback.paragraphRuntimeId === commandRuntimeId
  }

  result.success = result.sameAsCommandParagraph && (result.localLogicalOffset ?? -1) === 0

  // CARET-REPAIR trace
  emitRuntimeAudit('CARET-REPAIR', {
    commandRuntimeId,
    method: result.method,
    textLeafFound: result.textLeafFound,
    resolvedRuntimeId: result.resolvedParagraphRuntimeId ?? 'null',
    localOffset: result.localLogicalOffset,
    sameAsCommand: result.sameAsCommandParagraph,
    success: result.success,
    failureReason: result.failureReason ?? 'none',
  })

  return result
}

// ── Writer Record ──────────────────────────────────────────────────

export interface WriterRecord {
  timestamp: number
  relativeMs: number
  writerId: string
  reason: string
  txnId?: string
  paragraphIdentity?: string
  beforeSemantic?: string
  afterSemantic?: string
  beforeClass?: string
  afterClass?: string
}

const writerHistoryMap = new WeakMap<HTMLElement, WriterRecord[]>()
const MAX_WRITER_HISTORY = 50

/** Record a paragraph state write with high-level writer context. fail-open. */
export function recordParagraphWrite(
  el: HTMLElement,
  writerId: string,
  reason: string,
  options?: { txnId?: string; beforeSemantic?: string; afterSemantic?: string; beforeClass?: string; afterClass?: string },
): void {
  try {
    const history = writerHistoryMap.get(el) ?? []
    const record: WriterRecord = {
      timestamp: performance.now(),
      relativeMs: history.length > 0 ? performance.now() - history[0].timestamp : 0,
      writerId,
      reason,
      ...options,
    }
    history.push(record)
    if (history.length > MAX_WRITER_HISTORY) history.shift()
    writerHistoryMap.set(el, history)
  } catch { /* fail-open */ }
}

/** Read the full writer history for a paragraph element. */
export function getParagraphWriterHistory(el: HTMLElement): WriterRecord[] {
  return writerHistoryMap.get(el) ?? []
}

/** Read the last writer for a paragraph element. */
export function getLastParagraphWriter(el: HTMLElement): WriterRecord | null {
  const h = writerHistoryMap.get(el)
  return h && h.length > 0 ? h[h.length - 1] : null
}

// ────────────────────────────────────────────────────────────────────

// Typora invisible characters and placeholder patterns to strip during normalization.
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF]/g

// Excluded context selectors — must not trigger shortcut in these elements
const EXCLUDED_PARENT_SELECTORS = [
  'pre', 'code', '.md-codeblock',
  '.md-math-block', '.math', 'mjx-container',
  'blockquote', '.md-blockquote',
  'li', 'ul', 'ol',
  'table', 'th', 'td',
  'sup', '.md-footnote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]

/**
 * Scans Markdown source for paragraph indent markers.
 * Returns a Set of paragraph indices that have force-indent-2.
 */
export function parseIndentMarkers(markdown: string): Set<number> {
  const markers = new Set<number>()
  if (!markdown) return markers

  const lines = markdown.split('\n')
  let paraIndex = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip heading lines (start with #)
    if (/^#{1,6}\s/.test(line)) {
      i++
      // Consume the paragraph block (heading content)
      while (i < lines.length && lines[i].trim() !== '') i++
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // Skip blank lines — they separate paragraphs
    if (line.trim() === '') {
      i++
      continue
    }

    // Check if this line is a marker comment
    const trimmed = line.trim()
    if (trimmed === INDENT_MARKER_COMMENT) {
      markers.add(paraIndex)
      i++
      // Skip blank lines after marker
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // Skip fenced code blocks
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      i++
      while (i < lines.length && !/^(```|~~~)/.test(lines[i].trim())) i++
      i++ // skip closing fence
      continue
    }

    // Skip display math blocks ($$ ... $$)
    if (trimmed.startsWith('$$') && trimmed.length > 2) {
      i++
      while (i < lines.length && !lines[i].trim().endsWith('$$')) i++
      i++
      continue
    }

    // Skip list items, blockquotes, tables (non-paragraph structures)
    if (/^[\s]*[-*+>|]/.test(line) || /^\d+\.\s/.test(line)) {
      i++
      // Consume the block
      while (i < lines.length && lines[i].trim() !== '') i++
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // This is a paragraph — consume it
    paraIndex++
    i++
    // Consume continuation lines (non-blank, non-structural)
    while (i < lines.length && lines[i].trim() !== '' && !isStructuralLine(lines[i])) {
      i++
    }
    // Skip trailing blank lines
    while (i < lines.length && lines[i].trim() === '') i++
  }

  return markers
}

function isStructuralLine(line: string): boolean {
  const t = line.trim()
  if (t === '') return false
  if (/^#{1,6}\s/.test(t)) return true
  if (/^```|^~~~/.test(t)) return true
  if (/^[\s]*[-*+>|]/.test(t)) return true
  if (/^\d+\.\s/.test(t)) return true
  return false
}

/**
 * Determine if a paragraph DOM element follows a display math block.
 * Checks the previous sibling in the DOM tree.
 */
export function isAfterDisplayMath(paragraph: HTMLElement): boolean {
  let prev = paragraph.previousElementSibling
  while (prev) {
    // Skip blank/intermediate elements
    if (prev.querySelector('.md-math-block, mjx-container[display="true"]')) {
      return true
    }
    // Check if the element itself is a math block
    if (prev.classList.contains('md-math-block')) return true
    const mjx = prev.querySelector?.('mjx-container[display="true"]')
    if (mjx) return true
    // Check for MathJax display math wrapper
    if (prev.tagName === 'P' && prev.querySelector('mjx-container[display="true"]')) return true

    // Stop checking at structural elements (headings, lists, blockquotes, code, tables)
    const tag = prev.tagName
    if (/^H[1-6]$/.test(tag)) break
    if (['UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR'].includes(tag)) break
    if (prev.classList.contains('md-codeblock')) break
    if (prev.classList.contains('md-footnote')) break

    // If this is a non-blank paragraph, it's not a direct continuation
    if (tag === 'P' && prev.textContent?.trim()) break

    prev = prev.previousElementSibling
  }
  return false
}

/**
 * Determine if a DOM node is inside an excluded context (code, math, list, quote, table, footnote).
 */
export function isInExcludedContext(node: Node | null): boolean {
  if (!node) return true
  let el: Node | null = node
  while (el) {
    if (!(el instanceof Element)) {
      el = el.parentNode
      continue
    }
    const tag = el.tagName
    if (tag === 'PRE' || tag === 'CODE') return true
    if (tag === 'BLOCKQUOTE') return true
    if (tag === 'LI' || tag === 'UL' || tag === 'OL') return true
    if (tag === 'TABLE' || tag === 'TH' || tag === 'TD') return true
    if (/^H[1-6]$/.test(tag)) return true
    if (el.classList.contains('md-codeblock')) return true
    if (el.classList.contains('md-math-block')) return true
    if (el.classList.contains('md-footnote')) return true
    if (el.closest?.('mjx-container') && !el.closest?.('[display="true"]')) return true
    el = el.parentElement
  }
  return false
}

/**
 * Get the current paragraph element from cursor position.
 */
export function getCurrentParagraphElement(): HTMLParagraphElement | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null

  const node = sel.getRangeAt(0).startContainer
  if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
    return node.parentElement.closest('p')
  }
  if (node instanceof Element) {
    return node.closest('p')
  }
  return null
}

/**
 * Check if the cursor is at the end of its text node content.
 */
export function isCursorAtEnd(): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const node = range.startContainer
  if (node.nodeType === Node.TEXT_NODE) {
    return range.startOffset >= (node.textContent?.length ?? 0)
  }
  // For element nodes, cursor is at end if at the last child
  if (node instanceof Element && node.childNodes.length > 0) {
    return range.startOffset >= node.childNodes.length
  }
  return range.startOffset >= ((node.textContent?.length) ?? 0)
}

/**
 * Check if the current context qualifies for the indent shortcut.
 */
export function canTriggerIndentShortcut(): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return false
  const node = sel.getRangeAt(0).startContainer
  return !isInExcludedContext(node)
}

/**
 * Apply visual indent projection to a paragraph DOM element.
 * Purely visual — does NOT affect semantic state.
 * @deprecated Prefer applyEffectiveParagraphIndent() for unified visual projection.
 */
function applyParagraphIndent(el: HTMLElement, indentValue: string): void {
  if (indentValue === '2em') {
    el.classList.add(EFFECTIVE_INDENT_CLASS)
  } else {
    el.classList.remove(EFFECTIVE_INDENT_CLASS)
    el.style.textIndent = ''
  }
}

/**
 * Legacy migration: scan editor DOM for indent marker comments and
 * apply FORCE_INDENT semantic + effective projection to the following paragraph.
 * Returns the count of markers found.
 *
 * @deprecated New paragraphs use applyParagraphIndentOverride() → sidecar.
 * This function exists only for legacy HTML comment marker migration.
 */
export function applyIndentMarkersFromDOM(editorRoot: HTMLElement): number {
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_COMMENT,
    { acceptNode: (node) => node.nodeValue?.trim() === INDENT_MARKER_COMMENT ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP },
  )

  let count = 0
  const markerNodes: Comment[] = []
  while (walker.nextNode()) {
    markerNodes.push(walker.currentNode as Comment)
  }

  for (const comment of markerNodes) {
    let next: Node | null = comment.nextSibling
    while (next) {
      if (next.nodeType === Node.ELEMENT_NODE) {
        const el = next as HTMLElement
        if (el.tagName === 'P') {
          // Set semantic FORCE_INDENT + apply effective projection
          setParagraphIndentMode(el, 'force-indent', WriterIds.LEGACY_MIGRATION_SEMANTIC)
          applyEffectiveParagraphIndent(el, 'indent-2', WriterIds.LEGACY_MARKER_VISUAL)
          count++
          break
        }
        if (/^(H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(el.tagName)) break
        if (el.classList.contains('md-codeblock')) break
        if (el.classList.contains('md-math-block')) break
      }
      next = next.nextSibling
    }
  }

  return count
}

/**
 * Apply paragraph indent styles based on semantic mode and settings.
 *
 * For EACH paragraph, recomputes:
 *   semantic = getParagraphIndentMode(p)          (reads data-inkchapter-indent-mode only)
 *   structural = isFormulaContinuation
 *   effective = resolveEffectiveParagraphIndent(semantic, defaultIndent, structural)
 *   applyEffectiveParagraphIndent(p, effective)
 *
 * NO paragraph is skipped based on visual class.
 * Every paragraph gets its effective indent recomputed from semantic + settings.
 * This ensures:
 *   - AUTO + default indent-2 → semantic AUTO, visual 2em
 *   - default switch flush → same paragraph immediately 0
 *   - force-indent → always 2em regardless of default
 *   - force-flush → always 0 regardless of default
 */
export function refreshParagraphIndentStyles(
  editorRoot: HTMLElement,
  settings: ParagraphLayoutSettings,
  isComposing: boolean = false,
): void {
  // First, run legacy marker migration (converts HTML comments to sidecar)
  applyIndentMarkersFromDOM(editorRoot)

  const paragraphs = editorRoot.querySelectorAll<HTMLParagraphElement>('p')

  for (const p of paragraphs) {
    // Skip excluded paragraphs
    if (isInExcludedContext(p)) continue

    // Skip empty paragraphs
    if (!p.textContent?.trim()) continue

    // ── Full recompute: semantic → structural/transient → effective → project ──
    const semantic = getParagraphIndentMode(p)

    const structuralContext = {
      isFormulaContinuation: settings.flushAfterDisplayMath
        ? isAfterDisplayMath(p)
        : false,
    }

    const isEditingToken = isIndentShortcutEditingToken(p, settings.indentShortcutEnabled)

    const effective = resolveEffectiveParagraphIndent(
      semantic,
      settings.defaultIndent,
      structuralContext,
      { isShortcutEditingToken: isEditingToken },
    )

    applyEffectiveParagraphIndent(p, effective, WriterIds.REFRESH_VISUAL)
  }
}

/**
 * Build Markdown source with a canonical paragraph indent marker.
 *
 * CANONICAL FORMAT (the only acceptable serialization):
 * ```
 * <!-- inkchapter:paragraph-indent=2 -->
 *
 * target paragraph content
 * ```
 *
 * That is: MARKER on its own line, then a BLANK LINE, then TARGET PARAGRAPH.
 *
 * FORBIDDEN formats (must never be generated):
 * - `<!-- inkchapter:paragraph-indent=2 -->target text`  (same line)
 * - `<!-- inkchapter:paragraph-indent=2 -->\ntarget text` (no blank line)
 *
 * The function replaces the command line (".." or "。。") with a canonical
 * marker block. The target paragraph (the blank line Typora creates after
 * Enter) is preserved as-is.
 *
 * @returns The modified Markdown string, or null if no command found.
 */
export function injectShortcutMarkerInMarkdown(markdown: string): string | null {
  if (!markdown) return null

  const lines = markdown.split('\n')

  // Find the paragraph that is exactly a command token (search from end)
  let targetLineIdx = -1
  let foundToken: IndentCommandToken = null

  for (let i = lines.length - 1; i >= 0; i--) {
    const token = recognizeParagraphIndentCommand(lines[i])
    if (token) {
      const prevBlank = i === 0 || lines[i - 1].trim() === ''
      const nextBlank = i === lines.length - 1 || (i + 1 < lines.length && lines[i + 1].trim() === '')
      if (prevBlank && nextBlank) {
        targetLineIdx = i
        foundToken = token
        break
      }
    }
  }

  if (targetLineIdx < 0) return null

  // Collect the lines before the command
  const before = lines.slice(0, targetLineIdx)

  // After the command line: Typora creates a blank line then the target paragraph
  // (which is the new empty paragraph created by Enter).
  // Structure: [command line] [blank/empty line: target paragraph] [rest]
  const after = lines.slice(targetLineIdx + 1)

  // Build canonical output: marker + blank + target paragraph + rest
  const result = [
    ...before,
    INDENT_MARKER_COMMENT,   // canonical marker on its own line
    '',                       // blank line separator
    ...after,                 // target paragraph + rest of document
  ].join('\n')

  return result
}

/**
 * Canonicalize all paragraph indent markers in a Markdown string.
 *
 * This is a safe, idempotent operation that fixes:
 * - **Same-line markers**: `<!-- inkchapter:paragraph-indent=2 -->text` → canonical
 * - **Missing blank line**: marker followed immediately by paragraph → canonical
 * - **Duplicate markers**: consecutive markers → single marker
 * - **Orphan markers**: marker at EOF with no target → removed
 *
 * Normal (non-indent) HTML comments are NEVER modified.
 *
 * @returns The canonicalized Markdown string.
 */
export function canonicalizeParagraphIndentMarkers(markdown: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check if this line contains (or is) an indent marker
    const markerMatch = trimmed.match(/^<!--\s*inkchapter:paragraph-indent=2\s*-->/)

    if (markerMatch) {
      // Extract any text after the marker on the same line (broken same-line format)
      const afterMarker = trimmed.slice(markerMatch[0].length).trim()

      // Skip this line in output — we'll emit canonical marker
      i++

      // Count consecutive duplicate markers
      while (i < lines.length) {
        const nextTrim = lines[i].trim()
        if (nextTrim === INDENT_MARKER_COMMENT) {
          i++ // skip duplicate
        } else {
          break
        }
      }

      // Check for orphan: marker at EOF with no target
      if (i >= lines.length) {
        if (afterMarker) {
          // Same-line marker with text but at EOF — keep the text as a paragraph
          result.push(INDENT_MARKER_COMMENT)
          result.push('')
          result.push(afterMarker)
        }
        // Else: orphan marker, skip it entirely
        continue
      }

      // Skip blank lines between marker and target
      while (i < lines.length && lines[i].trim() === '') {
        i++
      }

      // Now emit canonical marker + blank + content
      result.push(INDENT_MARKER_COMMENT)
      result.push('')

      if (afterMarker) {
        // Same-line marker: the text after marker is the target paragraph
        result.push(afterMarker)
      }
      // else: the next content line(s) are the target paragraph
      // They will be consumed by the normal loop below (we already skipped blanks)

      continue
    }

    // Normal line — pass through unchanged
    result.push(line)
    i++
  }

  return result.join('\n')
}

/**
 * Focus the paragraph after a specific marker index.
 *
 * Index 0 = first marker, 1 = second, etc.
 * This is the target identity recovery mechanism — it does NOT use
 * "last marker" as the sole recovery algorithm.
 */
export function focusParagraphAfterMarkerIndex(editorRoot: HTMLElement, markerIndex: number): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markerIndex < 0 || markerIndex >= markers.length) return false

  const marker = markers[markerIndex]
  const p = findNextParagraphAfter(marker)
  if (!p) return false

  const sel = window.getSelection()
  if (!sel) return false
  const range = document.createRange()
  const firstText = findFirstTextNode(p)
  if (firstText) {
    range.setStart(firstText, 0)
  } else {
    range.setStart(p, 0)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  emitPluginSelectionWrite({
    writeId: `focus-marker-${markerIndex}-${Date.now()}`,
    caller: 'LEGACY-MARKER-FOCUS',
    reason: 'legacy-marker-focus',
    runtimeId: getElementIdentity(p),
    logicalOffsetBefore: null,
    logicalOffsetRequested: 0,
    success: true,
  })
  p.scrollIntoView?.({ block: 'nearest' })
  return true
}

/**
 * Apply force-indent to the paragraph after a specific marker index.
 * Returns true if applied successfully.
 */
export function applyIndentByMarkerIndex(editorRoot: HTMLElement, markerIndex: number): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markerIndex < 0 || markerIndex >= markers.length) return false

  const marker = markers[markerIndex]
  const p = findNextParagraphAfter(marker)
  if (!p) return false

  applyEffectiveParagraphIndent(p, 'indent-2', WriterIds.LEGACY_MARKER_VISUAL)
  return true
}

function collectIndentMarkers(editorRoot: HTMLElement): Comment[] {
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_COMMENT,
    { acceptNode: (node) => node.nodeValue?.trim() === PARAGRAPH_INDENT_MARKER ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP },
  )
  const markers: Comment[] = []
  while (walker.nextNode()) {
    markers.push(walker.currentNode as Comment)
  }
  return markers
}

function findNextParagraphAfter(comment: Comment): HTMLElement | null {
  let next: Node | null = comment.nextSibling
  while (next) {
    if (next.nodeType === Node.ELEMENT_NODE) {
      const el = next as HTMLElement
      if (el.tagName === 'P') return el
      if (/^(H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(el.tagName)) return null
      if (el.classList.contains('md-codeblock')) return null
      if (el.classList.contains('md-math-block')) return null
    }
    next = next.nextSibling
  }
  return null
}

/**
 * Position cursor in the first empty paragraph after the LAST indent marker.
 * @deprecated Prefer `focusParagraphAfterMarkerIndex` for target-specific recovery.
 */
export function focusNewIndentParagraph(editorRoot: HTMLElement): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markers.length === 0) return false
  return focusParagraphAfterMarkerIndex(editorRoot, markers.length - 1)
}

function findFirstTextNode(el: Node): Text | null {
  if (el.nodeType === Node.TEXT_NODE) return el as Text
  for (const child of el.childNodes) {
    const found = findFirstTextNode(child)
    if (found) return found
  }
  return null
}

/**
 * Recognizer: check if text is an indent shortcut command token.
 * Only exact matches — ".." or "。。" — trigger. No prefix/suffix variants.
 */
export type IndentCommandToken = '..' | '。。' | null

export function recognizeParagraphIndentCommand(text: string): IndentCommandToken {
  const trimmed = text.trim()
  if (trimmed === '..') return '..'
  if (trimmed === '。。') return '。。'
  return null
}

// ── Unified Semantic Paragraph Indent Setter ─────────────────────────────

/** Data attribute storing the semantic indent mode. */
export const INDENT_MODE_ATTR = 'data-inkchapter-indent-mode'

/** Semantic indent mode for a paragraph block. */
export type ParagraphIndentSemanticMode = 'auto' | 'force-indent' | 'force-flush'

/** Effective visual indent result. */
export type ParagraphEffectiveIndent = 'flush' | 'indent-2'

/**
 * Get the user-visible text from a paragraph element.
 *
 * Filters Typora-invisible auxiliary content (zero-width chars) but
 * PRESERVES user-real whitespace. NO trim() — user spaces are real content.
 *
 * This is the SINGLE canonical text source for:
 *   1. Enter exact-token recognition (readParagraphIndentCommand)
 *   2. Token consumer precondition
 *   3. All DOM text query paths in paragraph indent command chain
 */
export function getUserVisibleParagraphText(paragraph: HTMLElement): string {
  const raw = paragraph.textContent ?? ''
  return raw.replace(ZERO_WIDTH_CHARS, '')
}

/**
 * Read the indent command token from a paragraph's user-visible text.
 *
 * Pure reader — no side effects. Returns the exact token if the paragraph's
 * entire user-visible content is strictly ".." or "。。", null otherwise.
 *
 * Matching rules (strict):
 *   ".."  → '..'
 *   "。。" → '。。'
 *   "。。 " → null (trailing user space)
 *   " 。。" → null (leading user space)
 *   "。。。" → null (extra char)
 *   "abc" → null
 *   " .." → null
 */
export function readParagraphIndentCommand(paragraph: HTMLElement): '..' | '。。' | null {
  const text = getUserVisibleParagraphText(paragraph)
  if (text === '..') return '..'
  if (text === '。。') return '。。'
  return null
}

/**
 * Check if the current paragraph is in shortcut command editing state.
 *
 * This is a PURELY VISUAL transient state — NO semantic/sidecar/Markdown writes.
 * Returns true when:
 *   1. shortcut is enabled
 *   2. paragraph is ordinary body (not heading/code/quote)
 *   3. semantic is AUTO (not already FORCE_INDENT or FORCE_FLUSH)
 *   4. user-visible text is exactly one of: "." "。" ".." "。。"
 *
 * When this returns true, the visual projection should be FLUSH (0em).
 * When the user types more chars (e.g. "。。。" or "。测试"), this returns false
 * and the paragraph reverts to document default layout.
 */
export function isIndentShortcutEditingToken(
  paragraph: HTMLElement,
  indentShortcutEnabled: boolean,
): boolean {
  if (!indentShortcutEnabled) return false
  if (isInExcludedContext(paragraph)) return false
  if (getParagraphIndentMode(paragraph) !== 'auto') return false

  const text = getUserVisibleParagraphText(paragraph)
  // Exact tokens: '.' (U+002E), '\u3002' (CJK full stop), '..', '\u3002\u3002'
  return text === '.' || text === '\u3002' || text === '..' || text === '\u3002\u3002'
}

/**
 * Check if the caret is at the end of the paragraph's token text.
 *
 * Used to ensure that `。│。` (caret between chars) does NOT trigger
 * the indent command — only `。。│` (caret at end) does.
 *
 * @param tokenLength Number of characters in the token (always 2 for `..`/`。。`)
 */
export function isCaretAtTokenEnd(paragraph: HTMLElement, tokenLength: number = 2): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.isCollapsed) return false

  const range = sel.getRangeAt(0)
  const { startContainer, startOffset } = range

  // Caret must be inside the paragraph (walk up from startContainer)
  let ancestor: Node | null = startContainer
  let inside = false
  while (ancestor) {
    if (ancestor === paragraph) { inside = true; break }
    ancestor = ancestor.parentNode
  }
  if (!inside) return false

  // Overall text must match token length
  const visibleText = getUserVisibleParagraphText(paragraph)
  if (visibleText.length !== tokenLength) return false

  // Count visible chars from paragraph start to caret position
  let charCount = 0
  countVisibleCharsBefore(paragraph, startContainer, startOffset, c => { charCount = c })

  return charCount === tokenLength
}

/** Recursively count visible (non-ZWSP) characters before the caret point. */
function countVisibleCharsBefore(
  node: Node,
  targetContainer: Node,
  targetOffset: number,
  setCount: (c: number) => void,
): boolean {
  if (node === targetContainer) {
    const text = (node.textContent ?? '').slice(0, targetOffset)
    setCount(text.replace(ZERO_WIDTH_CHARS, '').length)
    return true // found
  }

  let count = 0
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child.nodeType === Node.TEXT_NODE) {
      if (child === targetContainer) {
        const text = (child.textContent ?? '').slice(0, targetOffset)
        count += text.replace(ZERO_WIDTH_CHARS, '').length
        setCount(count)
        return true
      }
      count += (child.textContent ?? '').replace(ZERO_WIDTH_CHARS, '').length
    } else if (child.contains(targetContainer)) {
      const result = countVisibleCharsBefore(child, targetContainer, targetOffset, innerCount => {
        count += innerCount
        setCount(count)
      })
      if (result) return true
    } else {
      // Sibling before caret — count its visible text
      count += (child.textContent ?? '').replace(ZERO_WIDTH_CHARS, '').length
    }
  }
  return false
}

/**
 * Resolve the effective visual indent from semantic mode,
 * document default, structural context, and transient editing state.
 *
 * Rules (priority order):
 *   1. FORCE_INDENT           → indent-2
 *   2. FORCE_FLUSH            → flush
 *   3. TRANSIENT editing token → flush  (visual only, NO semantic write)
 *   4. AUTO + structural flush → flush
 *   5. AUTO                   → document default
 *
 * This is the SINGLE source of truth for what indent a paragraph should have.
 * Every visual projection MUST go through this resolver.
 */
export function resolveEffectiveParagraphIndent(
  semanticMode: ParagraphIndentSemanticMode,
  documentDefault: ParagraphIndentMode,
  structuralContext: { isFormulaContinuation: boolean } = { isFormulaContinuation: false },
  transientOptions?: { isShortcutEditingToken: boolean },
): ParagraphEffectiveIndent {
  if (semanticMode === 'force-indent') return 'indent-2'
  if (semanticMode === 'force-flush') return 'flush'
  // AUTO
  if (transientOptions?.isShortcutEditingToken) return 'flush' // transient visual, NOT semantic
  if (structuralContext.isFormulaContinuation) return 'flush'
  return documentDefault === 'indent-2' ? 'indent-2' : 'flush'
}

/**
 * Apply the effective visual indent to a paragraph DOM element.
 *
 * This is the SINGLE place where visual projection happens.
 * Clears all stale visual state (class, inline style) before applying.
 * NEVER modifies semantic state.
 */
export function applyEffectiveParagraphIndent(
  paragraph: HTMLElement,
  effective: ParagraphEffectiveIndent,
  writerId?: string,
): void {
  // Clear all visual state first
  paragraph.classList.remove(EFFECTIVE_INDENT_CLASS)
  paragraph.classList.remove(EFFECTIVE_FLUSH_CLASS)
  paragraph.style.textIndent = ''

  if (effective === 'indent-2') {
    paragraph.classList.add(EFFECTIVE_INDENT_CLASS)
  } else {
    // FLUSH: apply explicit flush class to prevent parent text-indent inheritance
    paragraph.classList.add(EFFECTIVE_FLUSH_CLASS)
  }
  recordParagraphWrite(paragraph, writerId ?? 'applyEffectiveParagraphIndent', effective)
}

/**
 * Rollback a provisional semantic + visual projection to AUTO.
 * Used by the EmptySpecial transaction rollback path so a BLOCKED transaction
 * leaves zero committed projection side effects. Never used by NormalEnter.
 */
export function clearParagraphIndentVisualAndSemantic(paragraph: HTMLElement, writerId?: string): void {
  paragraph.removeAttribute(INDENT_MODE_ATTR)
  paragraph.classList.remove(EFFECTIVE_INDENT_CLASS)
  paragraph.classList.remove(EFFECTIVE_FLUSH_CLASS)
  paragraph.style.textIndent = ''
  recordParagraphWrite(paragraph, writerId ?? 'clearParagraphIndentVisualAndSemantic', 'auto')
}

// ── Atomic Rehydrate Helper ──────────────────────────────────────────
// Guarantees: new DOM paragraph after rebuild gets BOTH semantic AND
// effective visual in ONE synchronous call. Never depends on future
// refreshParagraphIndentStyles to complete the visual.

/** Context for atomic rehydrate — identifies the source and writer IDs. */
export interface RehydrateContext {
  source: 'rehydrate' | 'sidecar-reconstruct' | 'dom-rebuild-restore'
  semanticWriterId: string
  visualWriterId: string
}

/**
 * Atomic rehydrate: restore semantic AND effective visual on a paragraph.
 *
 * For ANY paragraph that receives explicit semantic (FORCE_INDENT/FORCE_FLUSH)
 * or AUTO during DOM rebuild / sidecar load / rehydrate, this function
 * guarantees that the SAME paragraph element gets correct effective visual
 * before the call returns.
 *
 * Explicit semantic (force-indent/force-flush) always wins over transient
 * shortcut visual. AUTO resolves based on structure + document default.
 *
 * @param paragraph - The exact paragraph element to rehydrate
 * @param mode - Semantic mode to restore
 * @param settings - Current paragraph layout settings
 * @param context - Writer IDs and source identifier
 */
export function rehydrateParagraphIndentState(
  paragraph: HTMLElement,
  mode: ParagraphIndentSemanticMode,
  settings: ParagraphLayoutSettings,
  context: RehydrateContext,
): void {
  // 1. Write semantic state on this exact paragraph
  setParagraphIndentMode(paragraph, mode, context.semanticWriterId)

  // 2. Compute structural context
  const structuralContext = {
    isFormulaContinuation: settings.flushAfterDisplayMath
      ? isAfterDisplayMath(paragraph)
      : false,
  }

  // 3. Resolve effective visual using canonical resolver.
  //    No transientOptions.isShortcutEditingToken — explicit semantic
  //    (force-indent/force-flush) always wins in rehydrate.
  //    AUTO resolves based on structure + document default.
  const effective = resolveEffectiveParagraphIndent(
    mode,
    settings.defaultIndent,
    structuralContext,
  )

  // 4. Apply visual on the SAME paragraph element
  applyEffectiveParagraphIndent(paragraph, effective, context.visualWriterId)
}

// ── Pending Logical Paragraph Identity ──────────────────────────────
// Stage A runtime identity for post-Enter empty paragraphs.
// Maintains semantic, visual, and caret continuity across DOM rebuilds
// WITHOUT depending on sidecar heuristic anchors.

export interface PendingLogicalParagraphState {
  pendingId: string
  sourceTxnId: string
  semantic: ParagraphIndentSemanticMode
  createdAt: number
  originalElement: HTMLElement
  originalParagraphOrdinal: number
  originalPreviousParagraphFingerprint?: string
  originalNextParagraphFingerprint?: string
  originalSelectionLogicalOffset: number
  currentElement?: HTMLElement
  caretOwnedByPending: boolean
  promoted: boolean
  promotedRecordId?: string
  state: 'COMMAND_COMMITTED_PENDING_EMPTY' | 'DOM_REBOUND_PENDING' | 'CONTENT_STABLE_PROMOTED' | 'USER_SELECTION_RELEASED' | 'DOCUMENT_SWITCHED'
}

/**
 * Release caret ownership if user has moved selection away from pending paragraph.
 * Call on keydown/mousedown/selectionchange.
 */
export function releasePendingCaretIfUserMoved(
  pending: PendingLogicalParagraphState | null,
  selection: Selection | null,
): boolean {
  if (!pending || !pending.caretOwnedByPending) return false
  if (pending.state === 'USER_SELECTION_RELEASED') return false
  if (!selection?.rangeCount) return true

  const range = selection.getRangeAt(0)
  const currentPara = pending.currentElement ?? pending.originalElement

  if (!currentPara || !currentPara.isConnected) {
    // Element disconnected but not yet rebound — don't release yet
    return false
  }

  // Check if selection anchor is still in or near the pending paragraph
  const startInPending = currentPara.contains(range.startContainer)
  if (!startInPending) {
    pending.caretOwnedByPending = false
    pending.state = 'USER_SELECTION_RELEASED'
    return true
  }
  return false
}

/**
 * Resolve which new DOM paragraph replaced the pending original element.
 * Uses LOCAL mutation context (removed/added in same batch), not sidecar.
 *
 * Returns the replacement HTMLElement if uniquely identified, null otherwise.
 */
export function resolvePendingReplacementParagraph(
  pending: PendingLogicalParagraphState,
  removedElement: HTMLElement,
  addedElements: HTMLElement[],
): HTMLElement | null {
  // Only paragraph elements
  const addedParagraphs = addedElements.filter(
    (el): el is HTMLParagraphElement => el.tagName === 'P' && el.isConnected,
  )
  if (addedParagraphs.length === 0) return null
  if (addedParagraphs.length === 1) return addedParagraphs[0]

  // Multiple candidates — use ordinal proximity
  const targetOrdinal = pending.originalParagraphOrdinal
  let best: HTMLElement | null = null
  let bestDistance = Infinity

  for (const para of addedParagraphs) {
    const parent = para.parentElement
    if (!parent) continue
    const siblings = Array.from(parent.querySelectorAll('p'))
    const idx = siblings.indexOf(para)
    if (idx < 0) continue
    const dist = Math.abs(idx - targetOrdinal)
    if (dist < bestDistance) {
      bestDistance = dist
      best = para
    }
  }

  // Only accept if within tight tolerance
  if (best && bestDistance <= 2) return best
  return null
}

/**
 * Generate paragraph fingerprint for continuity comparison.
 */
export function generateParagraphFingerprint(para: HTMLElement | null): string | undefined {
  if (!para) return undefined
  const text = (para.textContent ?? '').trim().slice(0, 40)
  return text ? `fp:${text.length}:${text}` : undefined
}

// ── Rehydrate Match Provenance ───────────────────────────────────────
// Enumerates how a sidecar record was matched to a DOM paragraph.
// Every rehydrate decision MUST record its strategy.

export const RehydrateMatchStrategy = {
  RECORD_ID: 'MATCH-RECORD-ID',
  EXACT_ANCHOR: 'MATCH-EXACT-ANCHOR',
  NORMALIZED_ANCHOR: 'MATCH-NORMALIZED-ANCHOR',
  PROMOTED_ANCHOR: 'MATCH-PROMOTED-ANCHOR',
  INDEX_FALLBACK: 'MATCH-INDEX-FALLBACK',
  PROXIMITY: 'MATCH-PROXIMITY',
  LEGACY: 'MATCH-LEGACY',
  NONE: 'MATCH-NONE',
} as const

export type RehydrateMatchStrategy = (typeof RehydrateMatchStrategy)[keyof typeof RehydrateMatchStrategy]

export const RehydrateConfidence = {
  EXACT: 'exact',
  STRONG: 'strong',
  WEAK: 'weak',
  AMBIGUOUS: 'ambiguous',
} as const

export type RehydrateConfidenceLevel = (typeof RehydrateConfidence)[keyof typeof RehydrateConfidence]

export interface CandidateRecord {
  recordId: string
  mode: string
  anchorRaw?: unknown
  anchorNormalized?: unknown
  index: number | null
  distance?: number
  score?: number
  source: string
}

export interface RehydrateMatchProvenance {
  timestamp: number
  rehydrateAttemptId: string
  txnId: string | null
  observationId: string | null

  targetParagraphIdentity: string
  targetText: string | null
  targetUserVisibleText: string | null

  currentSemantic: string

  candidateRecords: CandidateRecord[]
  candidateCount: number

  selectedRecordId: string | null
  selectedRecordMode: string | null

  matchStrategy: RehydrateMatchStrategy
  matchConfidence: RehydrateConfidenceLevel
  ambiguityDetected: boolean

  /** True if rehydrate was blocked due to ambiguity/weak match */
  rehydrateBlocked: boolean
  /** Reason for blocking, if applicable */
  blockReason?: string
}

// ── Two-Pass Rehydrate Pipeline Types (r53 P0-A) ────────────────────────

/**
 * Phase 1: A fully resolved candidate from a single sidecar record.
 * No semantic/visual/sidecar/caret writers are allowed during Phase 1.
 */
export interface RehydrateResolvedCandidate {
  recordId: string
  recordMode: 'force-indent' | 'force-flush'
  record: import('./paragraph-layout-store').ParagraphIndentOverrideRecord

  targetParagraph: HTMLElement
  targetParagraphIndex: number

  strategy: RehydrateMatchStrategy
  confidence: RehydrateConfidenceLevel

  score: number
  candidateCountAtGroup: number
}

/**
 * Phase 2: All candidates grouped by their target paragraph.
 */
export interface RehydrateOwnershipGroup {
  targetParagraphIndex: number
  targetParagraph: HTMLElement
  targetElementIdentity: string
  candidates: RehydrateResolvedCandidate[]
  candidateRecordIds: string[]
  candidateModes: string[]
  candidateCount: number
  decision: 'apply' | 'block'
  reason: string
  winner?: RehydrateResolvedCandidate
}

/**
 * Complete rehydrate plan after the two-pass pipeline.
 */
export interface ParagraphRehydratePlan {
  planId: string
  documentKey: string
  allRecords: import('./paragraph-layout-store').ParagraphIndentOverrideRecord[]
  resolvedCandidates: RehydrateResolvedCandidate[]
  groups: RehydrateOwnershipGroup[]
  winners: RehydrateResolvedCandidate[]
  blockedGroups: RehydrateOwnershipGroup[]
  /** Phase 1 writer count — must be 0 per invariant */
  phase1WriterCount: number
}

/**
 * Deterministic paragraph identity suitable for log comparison.
 */
export function getElementIdentity(el: HTMLElement): string {
  return `${el.tagName}:${el.className?.slice(0, 40) ?? ''}:${el.textContent?.slice(0, 30) ?? ''}:${el.getAttribute('data-line') ?? ''}`
}

/**
 * Phase 2: Build ownership groups from resolved candidates.
 * Groups are keyed by targetParagraphIndex then by element identity.
 * Must be called AFTER all candidates are fully resolved.
 */
export function buildRehydrateOwnershipGroups(
  candidates: RehydrateResolvedCandidate[],
): RehydrateOwnershipGroup[] {
  const groupMap = new Map<number, RehydrateResolvedCandidate[]>()

  for (const c of candidates) {
    const existing = groupMap.get(c.targetParagraphIndex)
    if (existing) {
      existing.push(c)
    } else {
      groupMap.set(c.targetParagraphIndex, [c])
    }
  }

  const groups: RehydrateOwnershipGroup[] = []

  for (const [idx, groupCandidates] of groupMap) {
    const targetPara = groupCandidates[0].targetParagraph
    const decision: 'apply' | 'block' = groupCandidates.length > 1 ? 'block' : 'apply'
    const reason = groupCandidates.length > 1
      ? `multi-owner: ${groupCandidates.length} candidates at index=${idx} — ambiguous ownership`
      : 'single-owner'

    const group: RehydrateOwnershipGroup = {
      targetParagraphIndex: idx,
      targetParagraph: targetPara,
      targetElementIdentity: getElementIdentity(targetPara),
      candidates: groupCandidates,
      candidateRecordIds: groupCandidates.map(c => c.recordId),
      candidateModes: [...new Set(groupCandidates.map(c => c.recordMode))],
      candidateCount: groupCandidates.length,
      decision,
      reason,
    }

    if (decision === 'apply') {
      group.winner = groupCandidates[0]
    }

    groups.push(group)
  }

  return groups
}

/**
 * Determines if a rehydrate should proceed given the match quality and
 * the paragraph's current runtime semantic.
 *
 * Rules:
 *   exact/strong → always allow
 *   weak → only if paragraph has no explicit runtime semantic (auto or none)
 *   ambiguous → blocked (safe no-op)
 *
 * @returns null if rehydrate should proceed; blockReason string if blocked
 */
export function evaluateRehydrateSafety(
  provenance: RehydrateMatchProvenance,
): string | null {
  const c = provenance.matchConfidence

  if (c === RehydrateConfidence.EXACT || c === RehydrateConfidence.STRONG) {
    return null // safe to rehydrate
  }

  if (c === RehydrateConfidence.AMBIGUOUS) {
    return 'ambiguous match — rehydrate blocked'
  }

  // WEAK: default BLOCK.
  // AUTO does NOT prove this sidecar record belongs to the paragraph —
  // a freshly DOM-rebuilt paragraph starts as AUTO and can be overwritten.
  // Weak match is only safe when candidateCount=1 AND at least one strong
  // neighbor (beforeHash/afterHash) is confirmed. That check happens at
  // the candidate resolution level, not here.
  if (c === RehydrateConfidence.WEAK) {
    return `weak match blocked (currentSemantic=${provenance.currentSemantic}) — cannot prove record identity`
  }

  return null
}

/**
 * Convert an AnchorResolveResult's confidence to RehydrateConfidence.
 */
export function anchorConfidenceToRehydrateConfidence(
  confidence: 'exact' | 'high' | 'medium' | 'fallback',
): RehydrateConfidenceLevel {
  switch (confidence) {
    case 'exact': return RehydrateConfidence.EXACT
    case 'high': return RehydrateConfidence.STRONG
    case 'medium': return RehydrateConfidence.WEAK
    case 'fallback': return RehydrateConfidence.WEAK
  }
}

// ── Shared Safe Rehydrate Decision ───────────────────────────────────
// Unified safety check used by BOTH rehydrateParagraphIndentOverrides
// AND reconstructParagraphOverridesFromSidecar. Ensures the same rules
// are applied to all rehydrate paths.

import {
  type ParagraphAnchorCandidate,
  resolveParagraphAnchorCandidates,
  type AnchorResolveResult,
} from './paragraph-layout-store'

export interface SafeRehydrateDecision {
  paragraph: HTMLElement | null
  paragraphIndex: number | null

  strategy: RehydrateMatchStrategy
  confidence: RehydrateConfidenceLevel

  candidateCount: number
  ambiguityDetected: boolean
  topScoreUnique: boolean

  selectedRecordId: string | null
  selectedRecordMode: string | null

  blocked: boolean
  blockReason?: string
}

/**
 * Build a single safe rehydrate decision from anchor resolution results.
 *
 * Resolution priority:
 * 1. Run resolveParagraphAnchorCandidates to get ALL candidates
 * 2. If empty → MATCH-NONE, blocked
 * 3. Check for equal-score ties at the top → ambiguous, blocked
 * 4. If top score unique AND confidence is exact/strong → allow
 * 5. Otherwise → weak, blocked (unless anchor has textHash match)
 *
 * This is the SINGLE decision point — both rehydrate and reconstruct
 * MUST go through this function.
 */
export function resolveSafeRehydrateDecision(
  anchor: {
    textHash?: string
    lastKnownOrdinal: number
    beforeHash?: string
    afterHash?: string
  },
  allParagraphs: HTMLElement[],
  recordId: string,
  recordMode: string,
): SafeRehydrateDecision {
  // Convert to ParagraphAnchor-compatible shape
  const paraAnchor = {
    lastKnownOrdinal: anchor.lastKnownOrdinal,
    textHash: anchor.textHash,
    beforeHash: anchor.beforeHash,
    afterHash: anchor.afterHash,
  }

  const candidates = resolveParagraphAnchorCandidates(paraAnchor, allParagraphs)

  if (candidates.length === 0) {
    return {
      paragraph: null,
      paragraphIndex: null,
      strategy: RehydrateMatchStrategy.NONE,
      confidence: RehydrateConfidence.AMBIGUOUS,
      candidateCount: 0,
      ambiguityDetected: false,
      topScoreUnique: false,
      selectedRecordId: recordId,
      selectedRecordMode: recordMode,
      blocked: true,
      blockReason: 'no paragraph candidates resolved',
    }
  }

  // Check for equal-score ties among top candidates
  const topScore = candidates[0].score
  const topCandidates = candidates.filter(c => c.score === topScore)
  const topScoreUnique = topCandidates.length === 1

  // Ambiguity: equal scores at top AND different paragraphs
  const ambiguityDetected = !topScoreUnique

  const best = candidates[0]
  const confidence = anchorConfidenceToRehydrateConfidence(best.confidence)

  // Determine strategy
  let strategy: RehydrateMatchStrategy
  if (best.textHashMatch) {
    strategy = RehydrateMatchStrategy.EXACT_ANCHOR
  } else if (best.neighborScore > 0 && best.ordinalProximityBonus > 0) {
    strategy = RehydrateMatchStrategy.NORMALIZED_ANCHOR
  } else if (best.neighborScore > 0) {
    strategy = RehydrateMatchStrategy.PROXIMITY
  } else {
    strategy = RehydrateMatchStrategy.INDEX_FALLBACK
  }

  // Block if candidateCount > 1 (multi-owner), ambiguous, or weak
  let blocked = false
  let blockReason: string | undefined

  // CRITICAL: candidateCount > 1 means multiple sidecar records claim the same
  // logical paragraph. Even if all have the same mode and exact anchors,
  // ownership is ambiguous — BLOCK.
  if (candidates.length > 1) {
    blocked = true
    blockReason = `multi-owner: ${candidates.length} candidates for same paragraph — ambiguous ownership`
  } else if (ambiguityDetected) {
    blocked = true
    const tieIndices = topCandidates.map(c => c.index).join(',')
    blockReason = `ambiguous: ${topCandidates.length} candidates with score=${topScore} at indices [${tieIndices}]`
  } else if (confidence === RehydrateConfidence.WEAK) {
    blocked = true
    blockReason = 'weak match blocked — cannot prove record identity'
  }

  const para = allParagraphs[best.index] ?? null

  return {
    paragraph: para,
    paragraphIndex: best.index,
    strategy,
    confidence,
    candidateCount: candidates.length,
    ambiguityDetected,
    topScoreUnique,
    selectedRecordId: recordId,
    selectedRecordMode: recordMode,
    blocked,
    blockReason,
  }
}

/**
 * Unified semantic entry point: set the indent mode for a paragraph.
 *
 * This is the single place where force-indent / force-flush / auto state
 * is written to the DOM.  All consumers (shortcut probe, formula continuation,
 * future context-menu) MUST go through this function.
 *
 * The layout resolver (`refreshParagraphIndentStyles`) reads this state
 * and produces the final CSS class / attribute / render output.
 *
 * Rendering chain:
 *   semantic = force-indent
 *   → setParagraphIndentMode(block, 'force-indent')
 *   → EFFECTIVE_INDENT_CLASS + data-inkchapter-indent-mode="force-indent"
 *   → refreshParagraphIndentStyles skips (already marked)
 *   → CSS: .inkchapter-paragraph-indent-2 { text-indent: 2em }
 */
export function setParagraphIndentMode(
  paragraph: HTMLElement,
  mode: ParagraphIndentSemanticMode,
  writerId?: string,
): void {
  // Semantic only — writes data-inkchapter-indent-mode attribute.
  // Visual projection is handled separately by resolveEffectiveParagraphIndent
  // and applyEffectiveParagraphIndent.
  paragraph.removeAttribute(INDENT_MODE_ATTR)

  if (mode === 'force-indent') {
    paragraph.setAttribute(INDENT_MODE_ATTR, 'force-indent')
  } else if (mode === 'force-flush') {
    paragraph.setAttribute(INDENT_MODE_ATTR, 'force-flush')
  }
  recordParagraphWrite(paragraph, writerId ?? 'setParagraphIndentMode', mode)
  // 'auto': attribute absent = AUTO
}

/**
 * Get the current semantic indent mode from a paragraph element.
 *
 * Reads ONLY from data-inkchapter-indent-mode attribute.
 * NEVER reads from CSS classes — visual projection is NOT semantic state.
 */
export function getParagraphIndentMode(el: HTMLElement): ParagraphIndentSemanticMode {
  const attr = el.getAttribute(INDENT_MODE_ATTR)
  if (attr === 'force-indent') return 'force-indent'
  if (attr === 'force-flush') return 'force-flush'
  return 'auto'
}

// ── Block Resolvers (selection-based, no full-scan) ──────────────────────

/** Tags that represent content blocks in Typora's editor DOM. */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'])

/**
 * Resolve the current content block element from the browser selection.
 *
 * Starts at `selection.anchorNode` and walks up to the nearest block-level
 * element inside `editorRoot`.  Does **not** assume the block is a `<p>`.
 *
 * @returns The block element, or null if no valid block is found.
 */
export function resolveCurrentBlockFromSelection(
  editorRoot: HTMLElement,
): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null

  let node: Node | null = sel.getRangeAt(0).startContainer
  while (node && node !== editorRoot) {
    if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
      // Verify it's inside editorRoot (not sidebar, settings, etc.)
      if (editorRoot.contains(node)) return node
    }
    node = node.parentNode
  }
  return null
}

/**
 * Resolve the previous content block sibling of `currentBlock`.
 *
 * Walks `previousElementSibling` until a block-level element is found,
 * skipping blank/interstitial elements (e.g. empty spans, line markers).
 *
 * @returns The previous block element, or null if none exists.
 */
export function resolvePreviousBlock(
  currentBlock: HTMLElement,
  editorRoot: HTMLElement,
): HTMLElement | null {
  let prev = currentBlock.previousElementSibling
  while (prev) {
    if (!editorRoot.contains(prev)) return null

    if (prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName)) {
      return prev
    }

    // Skip interstitial elements: empty spans, comment nodes, br-only, etc.
    const tag = prev.tagName
    if (tag === 'BR' || tag === 'HR' || tag === 'SCRIPT' || tag === 'STYLE') {
      prev = prev.previousElementSibling
      continue
    }

    // If it's a non-block element with no text content, skip
    if (!BLOCK_TAGS.has(tag) && !prev.textContent?.trim()) {
      prev = prev.previousElementSibling
      continue
    }

    // Any other element — stop to avoid crossing structural boundaries
    break
  }
  return null
}

/**
 * Check if an element is a regular content block (paragraph-like).
 * Excludes headings, list items, code blocks, blockquotes, tables.
 */
export function isContentBlock(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === 'P') return true
  // Exclude non-paragraph blocks
  if (/^H[1-6]$/.test(tag)) return false
  if (tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'TABLE') return false
  return false
}

// ── Runtime Block Probe (development diagnostic) ─────────────────────────

let blockProbeFired = false

/**
 * Development-only runtime block probe.
 *
 * Outputs the real DOM structure around the current selection to the console
 * (and optionally to a diagnostic file) so we can verify:
 * - selection.anchorNode type and position
 * - current block tag, class, attributes, outerHTML summary
 * - previous block structure
 * - parent chain
 */
export function writeBlockProbeDiagnostic(
  editorRoot: HTMLElement,
  reason: string,
  writeFile?: (filename: string, data: string) => void,
): void {
  // Fire only once per session to avoid log spam
  if (blockProbeFired) return
  blockProbeFired = true

  const sel = window.getSelection()
  const lines: string[] = [
    `=== InkChapter Runtime Block Probe ===`,
    `Refresh reason: ${reason}`,
    `Editor root: ${editorRoot.id || editorRoot.tagName} (${editorRoot.className?.slice(0, 80) || 'no class'})`,
    ``,
  ]

  if (sel?.rangeCount) {
    const anchorNode = sel.getRangeAt(0).startContainer
    lines.push(`-- Selection --`)
    lines.push(`anchorNode: ${anchorNode.nodeName} (type=${anchorNode.nodeType})`)
    if (anchorNode.nodeType === Node.TEXT_NODE) {
      lines.push(`anchorOffset: ${sel.getRangeAt(0).startOffset}`)
      lines.push(`textContent (first 40): "${anchorNode.textContent?.slice(0, 40)}"`)
    }
    lines.push(`anchorNode parent: ${anchorNode.parentElement?.tagName || 'null'}`)
    lines.push(``)
  } else {
    lines.push(`-- Selection: none --`)
    lines.push(``)
  }

  const currentBlock = resolveCurrentBlockFromSelection(editorRoot)
  if (currentBlock) {
    lines.push(`-- Current Block (B) --`)
    lines.push(`tag: ${currentBlock.tagName}`)
    lines.push(`class: ${currentBlock.className?.slice(0, 120) || '(none)'}`)
    lines.push(`id: ${currentBlock.id || '(none)'}`)
    const attrs: string[] = []
    for (const a of currentBlock.attributes) {
      if (a.name !== 'class' && a.name !== 'id') {
        attrs.push(`${a.name}="${a.value}"`)
      }
    }
    lines.push(`attrs: ${attrs.join(' ') || '(none)'}`)
    lines.push(`textContent (first 60): "${currentBlock.textContent?.slice(0, 60)}"`)
    lines.push(`outerHTML (first 200): ${(currentBlock.outerHTML ?? '').slice(0, 200)}`)

    const prevBlock = resolvePreviousBlock(currentBlock, editorRoot)
    if (prevBlock) {
      lines.push(``)
      lines.push(`-- Previous Block (A) --`)
      lines.push(`tag: ${prevBlock.tagName}`)
      lines.push(`class: ${prevBlock.className?.slice(0, 120) || '(none)'}`)
      lines.push(`textContent: "${prevBlock.textContent?.slice(0, 60)}"`)
      lines.push(`outerHTML (first 200): ${(prevBlock.outerHTML ?? '').slice(0, 200)}`)
    } else {
      lines.push(`-- Previous Block: null --`)
    }
  } else {
    lines.push(`-- Current Block: null (Branch B: selection→block resolver failed) --`)
  }

  // Parent chain from anchorNode
  if (sel?.rangeCount) {
    lines.push(``)
    lines.push(`-- Parent Chain --`)
    let n: Node | null = sel.getRangeAt(0).startContainer
    while (n) {
      const tag = n instanceof Element ? n.tagName : n.nodeName
      const cls = n instanceof Element ? (n.className?.slice(0, 60) || '') : ''
      const id = n instanceof Element && n.id ? ` id=${n.id}` : ''
      lines.push(`  ${tag}${id}${cls ? ` .${cls}` : ''}`)
      if (n === editorRoot) break
      n = n.parentNode
    }
  }

  const output = lines.join('\n')
  console.info(output)

  if (writeFile) {
    try {
      writeFile('inkchapter-block-probe.txt', output)
    } catch { /* ignore */ }
  }
}

// ── Inline Paragraph Command Probe (corrected semantics) ─────────────────

/** Result of a successful inline command probe (same-paragraph model). */
export interface InlineCommandResult {
  /** The command paragraph — this IS the force-indent target. */
  currentBlock: HTMLElement
  /** The command token that was recognized. */
  token: '..' | '。。'
}

/**
 * Dedupe guard: prevent same command paragraph from being processed twice.
 */
const processedCommands = new Set<HTMLElement>()

/**
 * Probe current selection for an inline paragraph indent command.
 *
 * CORRECTED SEMANTICS (R35): Enter is a command SUBMIT, not a paragraph break.
 * The command paragraph A IS the force-indent target.
 * There is NO next paragraph B.
 *
 * Conditions (all must be true):
 * 1. indentShortcutEnabled is true
 * 2. Current block resolved from selection is a content block
 * 3. Current block NOT in excluded context
 * 4. Current block textContent (trimmed) is exactly ".." or "。。"
 * 5. Cursor is inside the current block
 * 6. (Optional) hasParagraphCommandMutation flag for mutex
 *
 * @returns InlineCommandResult if a command is detected, null otherwise.
 */
export function probeInlineParagraphCommand(
  editorRoot: HTMLElement,
  settings: { indentShortcutEnabled: boolean },
): InlineCommandResult | null {
  if (!settings.indentShortcutEnabled) return null

  const currentBlock = resolveCurrentBlockFromSelection(editorRoot)
  if (!currentBlock) return null
  if (!isContentBlock(currentBlock)) return null
  if (isInExcludedContext(currentBlock)) return null

  const token = readParagraphIndentCommand(currentBlock)
  if (!token) return null

  // Cursor must be in the command block
  const sel = window.getSelection()
  if (sel?.rangeCount) {
    const selNode = sel.getRangeAt(0).startContainer
    if (!currentBlock.contains(selNode)) return null
  }

  // Dedupe
  if (processedCommands.has(currentBlock)) return null
  processedCommands.add(currentBlock)

  return { currentBlock, token }
}

/**
 * Reset the block probe diagnostic flag (for testing).
 */
export function resetBlockProbeDiagnostic(): void {
  blockProbeFired = false
}

/**
 * Clear dedupe guards (for testing).
 */
export function resetProcessedPairs(): void {
  processedCommands.clear()
}

// ── Mutation Classifier (used by main MutationObserver) ──────────────────

/** Maximum added+removed nodes to consider a "small-scale" structural edit. */
const SMALL_MUTATION_THRESHOLD = 10

/** Result of classifying editor mutations. */
export interface MutationClassification {
  /** A heading was added, removed, or its text changed. */
  headingMutation: boolean
  /** A small-scale paragraph-level childList mutation occurred (potential shortcut). */
  paragraphCommandCandidate: boolean
  /** The mutation batch is too large to be a user keystroke (paste, load, rerender). */
  largeBatch: boolean
}

/**
 * Classify a batch of MutationRecords from the main editor MutationObserver.
 *
 * This does NOT scan the full document — it only inspects the mutation records
 * themselves to determine if they represent:
 * - heading structural change (→ 'editor-mutation')
 * - small paragraph childList change (→ 'paragraph-command-mutation' candidate)
 * - large batch (paste/document load → no shortcut candidate)
 */
export function classifyEditorMutation(
  mutations: MutationRecord[],
  root: HTMLElement,
  options?: { suppressParagraphDetection?: boolean },
): MutationClassification {
  let headingMutation = false
  let paragraphCommandCandidate = false
  let largeBatch = false

  let totalAdded = 0
  let totalRemoved = 0

  for (const m of mutations) {
    totalAdded += m.addedNodes.length
    totalRemoved += m.removedNodes.length

    // ── Heading check ──
    if (!headingMutation) {
      // Check added/removed for heading elements
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i]
        if (node instanceof HTMLElement && isHeadingOrContainsHeading(node)) {
          headingMutation = true
        }
      }
      for (let i = 0; i < m.removedNodes.length; i++) {
        const node = m.removedNodes[i]
        if (node instanceof HTMLElement && isHeadingOrContainsHeading(node)) {
          headingMutation = true
        }
      }
      // characterData on heading ancestors
      if (m.type === 'characterData' && m.target.parentElement) {
        const ancestor = m.target.parentElement.closest('h1, h2, h3, h4, h5, h6')
        if (ancestor && root.contains(ancestor)) {
          headingMutation = true
        }
      }
    }

    // ── Paragraph structural candidate ──
    if (!paragraphCommandCandidate && !options?.suppressParagraphDetection) {
      // Only childList mutations matter for paragraph structural changes
      if (m.type === 'childList') {
        // Mutation target must be in editor root
        if (root.contains(m.target as Node)) {
          // Check if any added/removed node relates to content blocks
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              const tag = node.tagName
              if (tag === 'P' || BLOCK_TAGS.has(tag)) {
                paragraphCommandCandidate = true
                break
              }
            }
          }
          if (!paragraphCommandCandidate) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i]
              if (node instanceof HTMLElement) {
                const tag = node.tagName
                if (tag === 'P' || BLOCK_TAGS.has(tag)) {
                  paragraphCommandCandidate = true
                  break
                }
              }
            }
          }
        }
      }
    }
  }

  // Large batch: paste, document load, rerender, plugin-authored reload
  largeBatch = (totalAdded + totalRemoved) > SMALL_MUTATION_THRESHOLD

  // Large batches invalidate paragraph command candidate
  if (largeBatch) {
    paragraphCommandCandidate = false
  }

  return { headingMutation, paragraphCommandCandidate, largeBatch }
}

/** Helper: check if element is or contains a heading. (Exported for classifier.) */
function isHeadingOrContainsHeading(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
    return true
  }
  return el.querySelector('h1, h2, h3, h4, h5, h6') !== null
}

// ── Backspace Indent Removal (force-indent → force-flush) ──────────────

/**
 * Check if the caret is at the logical start of the paragraph's text content.
 *
 * A caret is at logical start when there are NO user-editable text characters
 * between the paragraph's first content position and the current caret position.
 *
 * Covers:
 * - Plain text node: `<p>│text</p>` → true
 * - Inline span wrapper: `<p><span>│text</span></p>` → true
 * - Empty paragraph (BR): `<p><br></p>` with caret before BR → true
 * - Multiple inline spans: `<p><span>A</span><span>│B</span></p>` → false
 * - Caret inside text: `<p>te│xt</p>` → false
 * - Placeholder span with no text → treated as empty
 *
 * Uses Range API to create a range from block start to cursor position,
 * then checks if any non-whitespace text exists in that range.
 */
export function isCaretAtLogicalStartOfParagraph(paragraph: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.isCollapsed) return false

  const cursorRange = sel.getRangeAt(0)
  const { startContainer, startOffset } = cursorRange

  try {
    const range = document.createRange()
    range.setStart(paragraph, 0)
    range.setEnd(startContainer, startOffset)

    const textBefore = range.toString().trim()
    return textBefore.length === 0
  } catch {
    // Range creation failed (e.g., nodes not in same tree) — assume not at start
    return false
  }
}

/**
 * Resolve the current body paragraph element from the selection.
 *
 * Returns null if:
 * - No selection / no range
 * - Current block is not a <p> tag
 * - Current block is in excluded context (heading, list, code, etc.)
 * - Current block is not a content block
 */
export function resolveCurrentBodyParagraph(editorRoot: HTMLElement): HTMLElement | null {
  const block = resolveCurrentBlockFromSelection(editorRoot)
  if (!block || block.tagName !== 'P') return null
  if (!isContentBlock(block)) return null
  if (isInExcludedContext(block)) return null
  return block
}

/**
 * Context for the Backspace indent removal decision.
 */
export interface BackspaceIndentCommandContext {
  paragraph: HTMLElement
  mode: ParagraphIndentSemanticMode
  caretAtLogicalStart: boolean
  selectionCollapsed: boolean
  composing: boolean
  excludedContext: boolean
}

/**
 * Determine whether InkChapter should consume the Backspace key
 * to remove force-indent from the current paragraph.
 *
 * Returns true only when ALL conditions are met:
 * 1. indentShortcutEnabled is true
 * 2. Not in IME composition
 * 3. Selection is collapsed
 * 4. Current paragraph resolved and not excluded
 * 5. Paragraph mode is force-indent
 * 6. Caret is at logical start of paragraph text
 */
export function shouldConsumeBackspaceForIndentRemoval(
  editorRoot: HTMLElement,
  settings: { indentShortcutEnabled: boolean },
  isComposing: boolean,
): BackspaceIndentCommandContext | null {
  if (!settings.indentShortcutEnabled) return null

  const sel = window.getSelection()
  if (!sel?.rangeCount) return null

  if (isComposing) {
    return {
      paragraph: null!,
      mode: 'auto',
      caretAtLogicalStart: false,
      selectionCollapsed: sel.isCollapsed,
      composing: true,
      excludedContext: false,
    }
  }

  if (!sel.isCollapsed) {
    return {
      paragraph: null!,
      mode: 'auto',
      caretAtLogicalStart: false,
      selectionCollapsed: false,
      composing: false,
      excludedContext: false,
    }
  }

  const paragraph = resolveCurrentBodyParagraph(editorRoot)
  if (!paragraph) {
    return {
      paragraph: null!,
      mode: 'auto',
      caretAtLogicalStart: false,
      selectionCollapsed: true,
      composing: false,
      excludedContext: true,
    }
  }

  const mode = getParagraphIndentMode(paragraph)
  if (mode !== 'force-indent') {
    return {
      paragraph,
      mode,
      caretAtLogicalStart: false,
      selectionCollapsed: true,
      composing: false,
      excludedContext: false,
    }
  }

  const atLogicalStart = isCaretAtLogicalStartOfParagraph(paragraph)
  if (!atLogicalStart) {
    return {
      paragraph,
      mode,
      caretAtLogicalStart: false,
      selectionCollapsed: true,
      composing: false,
      excludedContext: false,
    }
  }

  return {
    paragraph,
    mode,
    caretAtLogicalStart: true,
    selectionCollapsed: true,
    composing: false,
    excludedContext: false,
  }
}

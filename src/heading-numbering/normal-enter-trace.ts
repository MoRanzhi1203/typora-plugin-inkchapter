/**
 * Normal Enter Force-Indent Runtime Trace (P0 Diagnostic)
 *
 * Writes structured trace events to a JSONL file so we can capture
 * the real DOM / mutation / rehydrate / render chain during a normal Enter.
 *
 * DEV ONLY — must not ship in production.
 * DEFAULT OFF — only enabled via explicit opt-in.
 *
 * Trace file: test/vault/inkchapter-normal-enter-trace.jsonl
 *
 * ── Build Marker ───────────────────────────
 * inkchapter-backspace-trace-isolation-r37-a1b2c
 * Search for this string in loaded bundle to confirm this build.
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Build Marker ─────────────────────────────────────────────────────

/** Unique build marker for this isolation version. */
export const BUILD_MARKER = 'inkchapter-backspace-trace-isolation-r37-a1b2c'

// ── Explicit Opt-in ──────────────────────────────────────────────────

/** Trace is OFF by default. Enable only via explicit window flag. */
export function isTraceExplicitlyEnabled(): boolean {
  return Boolean((window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__)
}

// ── State ────────────────────────────────────────────────────────────

let active = false
let tracePath: string | null = null
let traceSessionId = ''
let eventSeq = 0
let traceFailed = false
let traceErrorReported = false

// ── WeakMap-based Node Identity (NEVER writes to DOM) ────────────────

let traceNodeCounter = 0
const traceNodeIds = new WeakMap<Node, string>()

/**
 * Get or assign a stable trace identity for any DOM node.
 *
 * Accepts: Node, Element, HTMLElement, Text, Comment, DocumentFragment,
 *          any other Node subtype, null, undefined.
 *
 * NEVER throws. NEVER writes to DOM dataset/attributes.
 * Uses WeakMap for identity — observer-external metadata only.
 *
 * @returns Stable trace label string, or null if input is non-Node.
 */
export function identifyNode(node: unknown): string | null {
  if (!active || traceFailed) return null

  // null / undefined / non-Node
  if (node == null) return null
  if (!(node instanceof Node)) return null

  // DocumentFragment — identity by child size
  if (node instanceof DocumentFragment) {
    const key = `frag-${node.childNodes.length}`
    return key
  }

  // WeakMap lookup
  const existing = traceNodeIds.get(node)
  if (existing) return existing

  // Build stable key based on node type
  let stableKey: string
  if (node instanceof HTMLElement) {
    stableKey = `${node.tagName}:${node.className?.slice(0, 40) ?? ''}:${node.textContent?.slice(0, 30) ?? ''}:${node.getAttribute?.('data-line') ?? ''}`
  } else if (node instanceof Element) {
    // SVGElement or other non-HTML Element
    stableKey = `${node.tagName}:${node.getAttribute?.('class')?.slice(0, 40) ?? ''}`
  } else if (node.nodeType === Node.TEXT_NODE) {
    stableKey = `#text:${node.textContent?.slice(0, 40) ?? ''}`
  } else if (node.nodeType === Node.COMMENT_NODE) {
    stableKey = `#comment:${node.textContent?.slice(0, 40) ?? ''}`
  } else {
    stableKey = `${node.nodeName}:t${node.nodeType}:${node.textContent?.slice(0, 40) ?? ''}`
  }

  const id = `N${++traceNodeCounter}`
  traceNodeIds.set(node, id)

  // Also cache by stableKey to answer "is this A or A'?" queries
  if (!knownIdentities.has(stableKey)) {
    knownIdentities.set(stableKey, id)
  }

  return id
}

/** Track all paragraph identities encountered — for answering "is this A or A'?" */
let knownIdentities = new Map<string, string>() // identityKey → id

// ── Public API ────────────────────────────────────────────────────────

export interface TraceState {
  active: boolean
  sessionId: string
  eventSeq: number
  failed: boolean
}

export function getTraceState(): TraceState {
  return { active, sessionId: traceSessionId, eventSeq, failed: traceFailed }
}

/**
 * Activate the trace for the current Typora session.
 * ONLY works when explicitly opted-in via `window.__INKCHAPTER_NORMAL_ENTER_TRACE__`.
 */
export function activateNormalEnterTrace(vaultRootHint?: string): void {
  // Reject if not explicitly opted in
  if (!isTraceExplicitlyEnabled()) return
  if (active) return
  if (traceFailed) return // Don't restart after failure

  let vaultRoot = vaultRootHint
  if (!vaultRoot) {
    vaultRoot = (globalThis as any).__inkchapter_vault_root__ ?? undefined
  }
  if (!vaultRoot) {
    const cwd = process.cwd()
    const testVault = path.join(cwd, 'test', 'vault')
    if (fs.existsSync(testVault)) {
      vaultRoot = testVault
    }
  }
  if (!vaultRoot) return

  tracePath = path.join(vaultRoot, 'inkchapter-normal-enter-trace.jsonl')
  traceSessionId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  eventSeq = 0
  knownIdentities = new Map()
  traceFailed = false
  traceErrorReported = false
  active = true

  writeLine({
    phase: 'TRACE_START',
    sessionId: traceSessionId,
    traceFilePath: tracePath,
    timestamp: Date.now(),
    note: 'Normal Enter force-indent diagnostic trace active. Execute: 。。→Enter→type text→Normal Enter→read trace',
  })
}

export function deactivateNormalEnterTrace(): void {
  if (!active) return
  writeLine({
    phase: 'TRACE_END',
    sessionId: traceSessionId,
    timestamp: Date.now(),
  })
  active = false
  tracePath = null
  eventSeq = 0
}

// ── Fail-open Safe Trace Wrapper ────────────────────────────────────

/**
 * Execute a trace action safely.
 *
 * If trace is disabled: no-op.
 * If trace action throws: log error ONCE, disable trace, NEVER re-throw.
 * Business callbacks MUST continue after trace failure.
 */
export function safeTrace(action: () => void): void {
  if (!active) return
  if (traceFailed) return

  try {
    action()
  } catch (error) {
    traceFailed = true
    if (!traceErrorReported) {
      traceErrorReported = true
      console.warn('[InkChapter] Normal Enter Trace failed, disabling trace:', error)
    }
    // Deactivate to prevent further attempts
    active = false
    tracePath = null
    eventSeq = 0
  }
}

// ── Trace Writers (called from heading-numbering-service) ──────────────

export function traceT0_BeforeNormalEnter(data: T0Data): void {
  safeTrace(() => emit('T0_BEFORE_ENTER', data))
}

export function traceT1_AfterNormalEnter(data: T1Data): void {
  safeTrace(() => emit('T1_AFTER_ENTER', data))
}

export function traceT2_MutationRecords(records: T2Record[]): void {
  safeTrace(() => emit('T2_MUTATION_RECORDS', { records, recordCount: records.length }))
}

export function traceT3_Classifier(data: T3Data): void {
  safeTrace(() => emit('T3_CLASSIFIER', data))
}

export function traceT4_RequestRefresh(data: T4Data): void {
  safeTrace(() => emit('T4_REQUEST_REFRESH', data))
}

export function traceT5_DoRefresh(data: T5Data): void {
  safeTrace(() => emit('T5_DO_REFRESH', data))
}

export function traceT6_Rehydrate(data: T6Data): void {
  safeTrace(() => emit('T6_REHYDRATE', data))
}

export function traceT7_RefreshStyles(data: T7Data): void {
  safeTrace(() => emit('T7_REFRESH_STYLES', data))
}

export function traceT8_FinalState(data: T8Data): void {
  safeTrace(() => emit('T8_FINAL_STATE', data))
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Legacy wrapper: calls `identifyNode` for HTMLElement specifically.
 * Returns null for non-active, non-HTML-element, or trace failure.
 */
export function identifyElement(el: HTMLElement | null | undefined): string | null {
  return identifyNode(el ?? null)
}

/**
 * Summarize an element for trace output.
 * Safe for any node type — handles non-HTMLElement gracefully.
 */
export function summarizeElement(el: unknown): Record<string, unknown> | null {
  if (!active || traceFailed) return null
  if (!el) return null

  // Non-Element nodes (Text, Comment, DocumentFragment, etc.)
  if (!(el instanceof Element)) {
    if (el instanceof Text) {
      return {
        nodeType: 'Text',
        textContent: el.textContent?.slice(0, 80) ?? '',
      }
    }
    if (el instanceof Comment) {
      return {
        nodeType: 'Comment',
        textContent: el.textContent?.slice(0, 80) ?? '',
      }
    }
    if (el instanceof DocumentFragment) {
      return {
        nodeType: 'DocumentFragment',
        childCount: el.childNodes.length,
      }
    }
    return null
  }

  // HTMLElement — full summary
  if (el instanceof HTMLElement) {
    return {
      tag: el.tagName,
      id: el.id || undefined,
      className: el.className ? String(el.className).slice(0, 120) : undefined,
      indentMode: el.getAttribute('data-inkchapter-indent-mode') ?? undefined,
      traceId: identifyNode(el) ?? undefined,
      forceIndentClass: el.classList.contains('inkchapter-paragraph-effective-indent-2'),
      textContent: el.textContent?.slice(0, 80) ?? '',
      isConnected: el.isConnected,
      dataLine: el.getAttribute('data-line') ?? undefined,
    }
  }

  // Other Element (e.g. SVG) — minimal summary
  return {
    tag: el.tagName,
    nodeType: 'Element',
    textContent: el.textContent?.slice(0, 80) ?? '',
  }
}

export function summarizeSelection(): Record<string, unknown> {
  if (!active || traceFailed) return { type: 'disabled' }

  const sel = window.getSelection()
  if (!sel?.rangeCount) return { type: 'none' }
  const r = sel.getRangeAt(0)
  const start = r.startContainer
  const end = r.endContainer
  return {
    collapsed: r.collapsed,
    anchorNode: start.nodeName,
    anchorNodeType: start.nodeType,
    anchorOffset: r.startOffset,
    focusNode: end.nodeName,
    focusOffset: r.endOffset,
    startText: start.textContent?.slice(Math.max(0, r.startOffset - 10), r.startOffset + 20) ?? '',
  }
}

export function getComputedIndent(el: HTMLElement): string {
  try {
    return window.getComputedStyle(el).textIndent
  } catch {
    return 'error'
  }
}

// ── Internal ──────────────────────────────────────────────────────────

function emit(phase: string, data: object): void {
  if (!active || traceFailed) return
  writeLine({
    seq: ++eventSeq,
    phase,
    sessionId: traceSessionId,
    timestamp: Date.now(),
    ...data,
  } as Record<string, unknown>)
}

function writeLine(obj: object): void {
  if (!tracePath) return
  try {
    const dir = path.dirname(tracePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(tracePath, JSON.stringify(obj) + '\n', 'utf8')
  } catch {
    // Silent — trace failure must not break runtime
  }
}

// ── Types ─────────────────────────────────────────────────────────────

export interface T0Data {
  documentKey: string | null
  editorRootIdentity: string | null
  aElement: Record<string, unknown> | null
  aOrdinal: number
  aPreviousBlockSummary: Record<string, unknown> | null
  aNextBlockSummary: Record<string, unknown> | null
  aTextNormalized: string
  selection: Record<string, unknown>
  overrideRecordId: string | null
  overrideMode: string | null
  overrideTemporary: boolean | null
  overrideAnchor: Record<string, unknown> | null
  inMemoryOverrideCount: number
  sidecarWritePending: boolean
}

export interface T1Data {
  oldAIsConnected: boolean
  oldAIdentityLabel: string | null
  oldAElement: Record<string, unknown> | null
  selection: Record<string, unknown>
  caretBlock: Record<string, unknown> | null
  previousBlock: Record<string, unknown> | null
  domModel: string
}

export interface T2Record {
  type: string
  targetTag: string
  targetClass: string | undefined
  targetIdentity: string | null
  addedCount: number
  addedSummaries: Record<string, unknown>[]
  removedCount: number
  removedSummaries: Record<string, unknown>[]
}

export interface T3Data {
  headingMutation: boolean
  paragraphCommandCandidate: boolean
  largeBatch: boolean
  suppressed: boolean
  paragraphMutationEpoch: number
  didRequestRefresh: boolean
  refreshReason: string | null
}

export interface T4Data {
  reasonsBeforeAdd: string[]
  reasonAdded: string
  reasonsAfterAdd: string[]
  rafAlreadyPending: boolean
  primaryReason: string | null
  hasParagraphMutation: boolean
}

export interface T5Data {
  doRefreshCount: number
  primaryReason: string
  allPendingReasons: string[]
  editorRootDetected: boolean
  documentKey: string | null
  willCallRehydrate: boolean
  willCallRefreshStyles: boolean
}

export interface T6Data {
  overrideCount: number
  targetRecordId: string | null
  targetRecordMode: string | null
  targetRecordTemporary: boolean | null
  targetRecordAnchor: Record<string, unknown> | null
  candidateParagraphCount: number
  resolveResult: 'null' | 'A' | 'Aprime' | 'B' | 'other' | null
  resolvedElement: Record<string, unknown> | null
  resolvedText: string | null
  resolvedOrdinal: number | null
  beforeApplyClass: string | null
  beforeApplyData: string | null
  afterApplyClass: string | null
  afterApplyData: string | null
  promotionHappened: boolean
  promotionAnchorTextHash: string | null
}

export interface T7Data {
  targetElement: Record<string, unknown> | null
  beforeClass: string | null
  beforeDataMode: string | null
  afterClass: string | null
  afterDataMode: string | null
  didRendererClear: boolean
}

export interface T8Data {
  targetElement: Record<string, unknown> | null
  targetClass: string | null
  targetDataMode: string | null
  computedTextIndent: string
  selectionCurrentBlock: Record<string, unknown> | null
}

/**
 * Paragraph Indent Visual Forensic Probe — HARD-STOP diagnostic only.
 *
 * Captures T-1 through T7 timeline data when user types "." or "。" in an
 * empty paragraph with defaultIndent=indent-2, to identify the REAL visual
 * source of the unexpected 2em indent.
 *
 * DEFAULT OFF — enable via window.__INKCHAPTER_PARAGRAPH_FORENSIC__ = true.
 * Fail-open — errors disable probe, never affect business logic.
 * NEVER mutates DOM, semantic, sidecar, or Markdown.
 *
 * Output: test/vault/.typora/inkchapter-paragraph-indent-forensic.json
 *
 * Build Marker: inkchapter-paragraph-indent-visual-forensic-r43-e2f0d
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Build Marker ─────────────────────────────────────────────────────

export const INKCHAPTER_BUILD_ID = 'inkchapter-formula-call-owner-composite-slot-async-closure-v2.5.7-r5.4.3.11'

/** Runtime gate revision — infrastructure only, no business logic changes. */
export const RUNTIME_GATE_REVISION = 'r58-lifecycle-repair'

// Legacy alias for backward compatibility
export const FORENSIC_BUILD_MARKER = INKCHAPTER_BUILD_ID

// ── State ────────────────────────────────────────────────────────────

let active = false
let failed = false
let errorReported = false
let sessionId = ''
let outputPath: string | null = null

const traceNodeIds = new WeakMap<Node, string>()
let traceNodeCounter = 0

interface ForensicEntry {
  seq: number
  phase: string
  timestamp: number
  [key: string]: unknown
}

let entries: ForensicEntry[] = []
let seq = 0

// ── Session Management ───────────────────────────────────────────────

export function isForensicActive(): boolean {
  return active && !failed
}

export function activateForensic(vaultRoot?: string): void {
  if (!(window as any).__INKCHAPTER_PARAGRAPH_FORENSIC__) {
    // Log once so user knows why probe didn't activate
    if (!(window as any).__inkchapter_forensic_flag_checked) {
      (window as any).__inkchapter_forensic_flag_checked = true
      console.info('[InkChapter Forensic] Not activated — set window.__INKCHAPTER_PARAGRAPH_FORENSIC__ = true and call __inkchapter_activate_forensic__()')
    }
    return
  }
  if (active || failed) return

  let root = vaultRoot
  if (!root) {
    root = (globalThis as any).__inkchapter_vault_root__ ?? undefined
  }
  if (!root) {
    const cwd = process.cwd()
    const tv = path.join(cwd, 'test', 'vault')
    if (fs.existsSync(tv)) root = tv
  }
  if (!root) return

  outputPath = path.join(root, '.typora', 'inkchapter-paragraph-indent-forensic.json')
  sessionId = `forensic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  entries = []
  seq = 0
  failed = false
  errorReported = false
  active = true

  writeEntry({ phase: 'FORENSIC_START', buildMarker: FORENSIC_BUILD_MARKER, sessionId, outputPath })
  console.info(`[InkChapter Forensic] ACTIVE — session=${sessionId} output=${outputPath}`)
}

export function deactivateForensic(): void {
  if (!active) return
  writeEntry({ phase: 'FORENSIC_END', sessionId })
  flushEntries()
  active = false
  outputPath = null
  entries = []
  seq = 0
}

// ── Fail-open Safe Wrapper ───────────────────────────────────────────

export function safeForensic(action: () => void): void {
  if (!active || failed) return
  try {
    action()
  } catch (e) {
    failed = true
    if (!errorReported) {
      errorReported = true
      console.warn('[InkChapter Forensic] Probe failed, disabling:', e)
    }
  }
}

// ── Node Identity (WeakMap, NEVER writes DOM) ────────────────────────

function nodeId(node: unknown): string | null {
  if (!(node instanceof Node)) return null
  const existing = traceNodeIds.get(node)
  if (existing) return existing
  const id = `N${++traceNodeCounter}`
  traceNodeIds.set(node, id)
  return id
}

// ── Data Collection Helpers ──────────────────────────────────────────

export interface ForensicParagraphState {
  nodeId: string | null
  tag: string
  className: string
  attributes: Record<string, string>
  inlineStyle: string
  innerHTML: string
  textContent: string
  semantic: string
  candidate: string
  documentDefault: string
  effective: string
  hasIndentClass: boolean
  hasFlushClass: boolean
  computedTextIndent: string
  computedMarginLeft: string
  computedPaddingLeft: string
  computedTransform: string
  paragraphLeft: number
  caretX: number
  glyphX: number
  visualOffsetPx: number
}

export function captureParagraphState(paragraph: HTMLElement): ForensicParagraphState {
  const cs = window.getComputedStyle(paragraph)
  const rect = paragraph.getBoundingClientRect()

  // Caret position
  let caretX = 0
  const sel = window.getSelection()
  if (sel?.rangeCount && sel.isCollapsed) {
    const r = sel.getRangeAt(0).cloneRange()
    r.collapse(true)
    const cr = r.getBoundingClientRect()
    caretX = cr.left || 0
  }

  // First text glyph position
  let glyphX = 0
  const firstText = findDeepFirstText(paragraph)
  if (firstText && firstText.textContent?.trim()) {
    const r = document.createRange()
    r.setStart(firstText, 0)
    r.setEnd(firstText, 1)
    const gr = r.getBoundingClientRect()
    glyphX = gr.left || 0
  }

  const visualOffsetPx = glyphX > 0 ? glyphX - rect.left : caretX - rect.left

  // Collect attributes
  const attributes: Record<string, string> = {}
  for (const attr of paragraph.attributes) {
    attributes[attr.name] = attr.value
  }

  return {
    nodeId: nodeId(paragraph),
    tag: paragraph.tagName,
    className: paragraph.className ? String(paragraph.className) : '',
    attributes,
    inlineStyle: paragraph.getAttribute('style') ?? '',
    innerHTML: paragraph.innerHTML.slice(0, 300),
    textContent: paragraph.textContent ?? '',
    semantic: paragraph.getAttribute('data-inkchapter-indent-mode') ?? 'auto',
    candidate: '',
    documentDefault: '',
    effective: '',
    hasIndentClass: paragraph.classList.contains('inkchapter-paragraph-effective-indent-2'),
    hasFlushClass: paragraph.classList.contains('inkchapter-paragraph-effective-flush'),
    computedTextIndent: cs.textIndent,
    computedMarginLeft: cs.marginLeft,
    computedPaddingLeft: cs.paddingLeft,
    computedTransform: cs.transform !== 'none' ? cs.transform : '',
    paragraphLeft: rect.left,
    caretX,
    glyphX,
    visualOffsetPx,
  }
}

export interface ForensicParentState {
  nodeId: string | null
  tag: string
  className: string
  computedTextIndent: string
  computedMarginLeft: string
  computedPaddingLeft: string
  computedTransform: string
}

export function captureParentChain(paragraph: HTMLElement): ForensicParentState[] {
  const chain: ForensicParentState[] = []
  let el: HTMLElement | null = paragraph.parentElement
  while (el) {
    const cs = window.getComputedStyle(el)
    chain.push({
      nodeId: nodeId(el),
      tag: el.tagName,
      className: el.className ? String(el.className).slice(0, 120) : '',
      computedTextIndent: cs.textIndent,
      computedMarginLeft: cs.marginLeft,
      computedPaddingLeft: cs.paddingLeft,
      computedTransform: cs.transform !== 'none' ? cs.transform : '',
    })
    if (el.id === 'write') break
    el = el.parentElement
  }
  return chain
}

export interface ForensicSelectionState {
  anchorNodeType: string
  anchorNodeName: string
  anchorNodeId: string | null
  anchorOffset: number
  collapsed: boolean
  resolvedBlockTag: string | null
  resolvedBlockId: string | null
  resolvedIsExpectedParagraph: boolean
}

export function captureSelectionState(expectedParagraph: HTMLElement): ForensicSelectionState {
  const sel = window.getSelection()
  if (!sel?.rangeCount) {
    return { anchorNodeType: 'none', anchorNodeName: '', anchorNodeId: null, anchorOffset: -1, collapsed: true, resolvedBlockTag: null, resolvedBlockId: null, resolvedIsExpectedParagraph: false }
  }
  const r = sel.getRangeAt(0)
  const anchor = r.startContainer

  // Resolve block from selection
  let block: Element | null = null
  if (anchor instanceof Element) {
    block = anchor.closest('p')
  } else if (anchor.parentElement) {
    block = anchor.parentElement.closest('p')
  }

  return {
    anchorNodeType: anchor.nodeType === Node.TEXT_NODE ? 'Text' : anchor.nodeName,
    anchorNodeName: anchor.nodeName,
    anchorNodeId: nodeId(anchor),
    anchorOffset: r.startOffset,
    collapsed: r.collapsed,
    resolvedBlockTag: block?.tagName ?? null,
    resolvedBlockId: block instanceof HTMLElement ? nodeId(block) : null,
    resolvedIsExpectedParagraph: block === expectedParagraph,
  }
}

export interface ForensicCSSRule {
  selector: string
  value: string
  important: boolean
}

export function captureMatchedCSSRules(_element: HTMLElement, _property: string): ForensicCSSRule[] {
  // getMatchedCSSRules is deprecated and unavailable at runtime.
  // CSS matching evidence must be collected manually via DevTools.
  return []
}

// ── Write Entry ──────────────────────────────────────────────────────

export function writeForensicEntry(phase: string, data: Record<string, unknown>): void {
  writeEntry({ phase, ...data })
}

function writeEntry(data: Record<string, unknown>): void {
  entries.push({
    seq: ++seq,
    timestamp: Date.now(),
    ...data,
  } as ForensicEntry)
  // Flush after T7 (seq >= 8) or on END
  if (seq >= 12) flushEntries()
}

function flushEntries(): void {
  if (!outputPath || entries.length === 0) return
  try {
    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const lines = entries.map(e => JSON.stringify(e)).join('\n')
    fs.writeFileSync(outputPath, lines + '\n', 'utf8')
  } catch { /* silent */ }
}

// ── Helpers ──────────────────────────────────────────────────────────

function findDeepFirstText(el: Node): Text | null {
  if (el.nodeType === Node.TEXT_NODE) return el as Text
  for (const child of el.childNodes) {
    const found = findDeepFirstText(child)
    if (found) return found
  }
  return null
}

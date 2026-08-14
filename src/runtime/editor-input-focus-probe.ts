/**
 * Editor Input Focus Probe — PURE OBSERVABILITY ONLY.
 *
 * Read-only capture of renderer focus/selection authority for the E2 input
 * gate. This module MUST NOT change focus, selection, DOM, canonical records,
 * sidecar, or any business state.
 *
 * It only:
 *   - reads document.activeElement
 *   - reads window.getSelection()
 *   - reads editorRoot / paragraph / runtimeId / logicalOffset via read-only paths
 *   - emits EDITOR-INPUT-FOCUS-PROBE and EDITOR-INPUT-FOCUS-PROBE-SAFETY audits
 */

import { emitRuntimeAudit } from './forensic-log-sink'
import {
  resolveCurrentBodyParagraph,
  resolveSelectionParagraph,
} from '../heading-numbering/paragraph-indent-manager'

export type FocusProbePhase =
  | 'BEFORE_ACQUIRE'
  | 'AFTER_ACQUIRE'
  | 'BEFORE_INPUT'
  | 'AFTER_INPUT'
  | 'ON_DEMAND'

export type FocusProbeDecision =
  | 'EDITOR_INPUT_NOT_FOCUSED'
  | 'EDITOR_SELECTION_NOT_OWNED'
  | 'EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED'
  | 'EDITOR_FOCUS_AUTHORITY_PASS'
  | 'EDITOR_ROOT_UNAVAILABLE'
  | 'SELECTION_UNAVAILABLE'

export interface EditorInputFocusProbePayload {
  phase: FocusProbePhase
  timestamp: number
  editorInstanceId: string | null
  editorRootConnected: boolean
  activeElementTag: string | null
  activeElementId: string | null
  activeElementClassName: string | null
  activeElementContentEditable: string | null
  activeElementIsContentEditable: boolean | null
  activeElementInsideEditorRoot: boolean | null
  selectionRangeCount: number
  selectionCollapsed: boolean | null
  selectionAnchorNodeType: number | null
  selectionFocusNodeType: number | null
  selectionAnchorInsideEditor: boolean | null
  selectionFocusInsideEditor: boolean | null
  selectionRuntimeId: string | null
  currentParagraphRuntimeId: string | null
  logicalOffset: number | null
  decision: FocusProbeDecision
  overall: boolean
}

export interface FocusProbeContext {
  editorRoot: HTMLElement | null
  editorInstanceId: string | null
  /** Read-only runtimeId peek — MUST NOT create a new WeakMap identity. */
  peekRuntimeId: (el: HTMLElement) => string | null
}

export interface FocusAuthorityInput {
  editorRootConnected: boolean
  activeElementInsideEditorRoot: boolean | null
  selectionAvailable: boolean
  selectionRangeCount: number
  selectionAnchorInsideEditor: boolean | null
  selectionFocusInsideEditor: boolean | null
  currentParagraphRuntimeId: string | null
  logicalOffset: number | null
}

/**
 * Pure focus-authority decision (§5). No DOM access, no side effects.
 */
export function decideFocusAuthority(input: FocusAuthorityInput): FocusProbeDecision {
  if (!input.editorRootConnected) {
    return 'EDITOR_ROOT_UNAVAILABLE'
  }
  if (input.activeElementInsideEditorRoot === false) {
    return 'EDITOR_INPUT_NOT_FOCUSED'
  }
  if (!input.selectionAvailable) {
    return 'SELECTION_UNAVAILABLE'
  }
  if (
    input.selectionRangeCount === 0 ||
    input.selectionAnchorInsideEditor === false ||
    input.selectionFocusInsideEditor === false
  ) {
    return 'EDITOR_SELECTION_NOT_OWNED'
  }
  if (input.currentParagraphRuntimeId == null || input.logicalOffset == null) {
    return 'EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED'
  }
  return 'EDITOR_FOCUS_AUTHORITY_PASS'
}

function toNumOrNull(v: number | undefined): number | null {
  return typeof v === 'number' ? v : null
}

/**
 * Read-only capture of the renderer focus authority. Emits the audit event and
 * returns the payload. Does not mutate anything.
 */
export function captureEditorInputFocusProbe(
  phase: FocusProbePhase,
  ctx: FocusProbeContext,
): EditorInputFocusProbePayload {
  const editorRoot = ctx.editorRoot
  const editorRootConnected = !!editorRoot && editorRoot.isConnected

  // ── activeElement (read-only) ──
  let activeElement: Element | null = null
  try {
    activeElement = document.activeElement
  } catch { /* ignore */ }
  const activeEl = activeElement as HTMLElement | null
  const activeElementInsideEditorRoot =
    activeEl && editorRoot ? editorRoot.contains(activeEl) : activeEl ? false : null

  // ── selection (read-only) ──
  let sel: Selection | null = null
  try {
    sel = window.getSelection()
  } catch { /* ignore */ }
  const selectionAvailable = !!sel
  const selectionRangeCount = sel?.rangeCount ?? 0
  const selectionCollapsed = sel && sel.rangeCount > 0 ? sel.isCollapsed : null
  const anchorNode = sel && sel.rangeCount > 0 ? sel.anchorNode : null
  const focusNode = sel && sel.rangeCount > 0 ? sel.focusNode : null
  const selectionAnchorNodeType = anchorNode ? anchorNode.nodeType : null
  const selectionFocusNodeType = focusNode ? focusNode.nodeType : null
  const selectionAnchorInsideEditor =
    anchorNode && editorRoot ? editorRoot.contains(anchorNode) : anchorNode ? false : null
  const selectionFocusInsideEditor =
    focusNode && editorRoot ? editorRoot.contains(focusNode) : focusNode ? false : null

  // ── paragraph / runtimeId / logicalOffset (read-only) ──
  const currentParagraph = editorRoot ? resolveCurrentBodyParagraph(editorRoot) : null
  const currentParagraphRuntimeId = currentParagraph ? (ctx.peekRuntimeId(currentParagraph) ?? null) : null

  let selectionRuntimeId: string | null = null
  let logicalOffset: number | null = null
  if (editorRoot && sel) {
    const selRes = resolveSelectionParagraph(
      sel,
      editorRoot,
      (el: object) => ctx.peekRuntimeId(el as HTMLElement) ?? '',
    )
    selectionRuntimeId = selRes.paragraphRuntimeId || null
    logicalOffset = toNumOrNull(selRes.localLogicalOffset)
  }

  const decision = decideFocusAuthority({
    editorRootConnected,
    activeElementInsideEditorRoot,
    selectionAvailable,
    selectionRangeCount,
    selectionAnchorInsideEditor,
    selectionFocusInsideEditor,
    currentParagraphRuntimeId,
    logicalOffset,
  })

  const payload: EditorInputFocusProbePayload = {
    phase,
    timestamp: Date.now(),
    editorInstanceId: ctx.editorInstanceId,
    editorRootConnected,
    activeElementTag: activeEl?.tagName ?? null,
    activeElementId: activeEl?.id || null,
    activeElementClassName: activeEl && activeEl.className ? String(activeEl.className) : null,
    activeElementContentEditable: activeEl ? activeEl.getAttribute('contenteditable') : null,
    activeElementIsContentEditable: activeEl ? activeEl.isContentEditable : null,
    activeElementInsideEditorRoot,
    selectionRangeCount,
    selectionCollapsed,
    selectionAnchorNodeType,
    selectionFocusNodeType,
    selectionAnchorInsideEditor,
    selectionFocusInsideEditor,
    selectionRuntimeId,
    currentParagraphRuntimeId,
    logicalOffset,
    decision,
    overall: decision === 'EDITOR_FOCUS_AUTHORITY_PASS',
  }

  emitRuntimeAudit('EDITOR-INPUT-FOCUS-PROBE', { ...payload })
  return payload
}

export interface FocusProbeSafetySnapshot {
  activeElementIdentity: unknown
  selectionRangeCount: number
  selectionAnchorIdentity: unknown
  selectionFocusIdentity: unknown
  markdownLength: number
}

/** Capture a read-only safety snapshot before/after the probe. */
export function captureFocusProbeSafetySnapshot(editorRoot: HTMLElement | null): FocusProbeSafetySnapshot {
  let sel: Selection | null = null
  try {
    sel = window.getSelection()
  } catch { /* ignore */ }
  return {
    activeElementIdentity: document.activeElement ?? null,
    selectionRangeCount: sel?.rangeCount ?? 0,
    selectionAnchorIdentity: sel && sel.rangeCount > 0 ? sel.anchorNode : null,
    selectionFocusIdentity: sel && sel.rangeCount > 0 ? sel.focusNode : null,
    markdownLength: editorRoot?.textContent?.length ?? 0,
  }
}

/** Pure safety comparison — returns unchanged + diff labels. */
export function compareFocusProbeSafety(
  before: FocusProbeSafetySnapshot,
  after: FocusProbeSafetySnapshot,
): { unchanged: boolean; diffs: string[] } {
  const diffs: string[] = []
  if (before.activeElementIdentity !== after.activeElementIdentity) diffs.push('activeElement')
  if (before.selectionRangeCount !== after.selectionRangeCount) diffs.push('selectionRangeCount')
  if (before.selectionAnchorIdentity !== after.selectionAnchorIdentity) diffs.push('selectionAnchor')
  if (before.selectionFocusIdentity !== after.selectionFocusIdentity) diffs.push('selectionFocus')
  if (before.markdownLength !== after.markdownLength) diffs.push('markdown')
  return { unchanged: diffs.length === 0, diffs }
}

export interface FocusProbeSafetyResult {
  unchanged: boolean
  diffs: string[]
}

/**
 * Run the read-only probe wrapped in a safety self-check. Emits
 * EDITOR-INPUT-FOCUS-PROBE-SAFETY and returns the probe payload.
 */
export function runEditorInputFocusProbeWithSafety(
  phase: FocusProbePhase,
  ctx: FocusProbeContext,
): EditorInputFocusProbePayload {
  const before = captureFocusProbeSafetySnapshot(ctx.editorRoot)
  const payload = captureEditorInputFocusProbe(phase, ctx)
  const after = captureFocusProbeSafetySnapshot(ctx.editorRoot)
  const safety = compareFocusProbeSafety(before, after)
  emitRuntimeAudit('EDITOR-INPUT-FOCUS-PROBE-SAFETY', {
    phase,
    editorInstanceId: ctx.editorInstanceId,
    unchanged: safety.unchanged,
    diffs: safety.diffs,
  })
  return payload
}

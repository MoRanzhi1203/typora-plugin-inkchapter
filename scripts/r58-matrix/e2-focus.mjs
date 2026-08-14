// e2-focus.mjs — Pure E2 editor input focus authority evaluation.
// No fs / no Win32 / no Typora side effects. Shared by the CLI harness and
// FOCUS-1..10 contract tests. The harness supplies Win32 observations from the
// helper and marks the renderer probe unavailable (harness cannot read the
// Electron renderer DOM without a business build change).

export const FOCUS_VERDICTS = {
  FOREGROUND_WINDOW_MISMATCH: 'FOREGROUND_WINDOW_MISMATCH',
  WIN32_FOCUSED_CHILD_NOT_FOUND: 'WIN32_FOCUSED_CHILD_NOT_FOUND',
  EDITOR_INPUT_NOT_FOCUSED: 'EDITOR_INPUT_NOT_FOCUSED',
  EDITOR_SELECTION_NOT_OWNED: 'EDITOR_SELECTION_NOT_OWNED',
  EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED: 'EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED',
  EDITOR_FOCUS_AUTHORITY_PASS: 'EDITOR_FOCUS_AUTHORITY_PASS',
  RENDERER_FOCUS_PROBE_UNAVAILABLE: 'RENDERER_FOCUS_PROBE_UNAVAILABLE',
  FOCUSED_EDITOR_DID_NOT_OBSERVE_KEYBOARD_EVENT: 'FOCUSED_EDITOR_DID_NOT_OBSERVE_KEYBOARD_EVENT',
};

/**
 * Pure focus authority evaluation. Verdict order:
 *   top-level foreground → renderer probe availability → activeElement ownership
 *   → selection ownership → paragraph identity → PASS.
 * Win32 focused-child observation is recorded separately and does NOT by itself
 * produce EDITOR_INPUT_NOT_FOCUSED.
 */
export function evaluateFocusAuthority(snapshot) {
  const s = snapshot || {};
  const result = {
    overall: false,
    decision: null,
    win32Decision: null,
  };

  if (s.foregroundMatchesTarget === true && (s.focusedChildHwnd == null || s.focusedChildHwnd === 0)) {
    result.win32Decision = FOCUS_VERDICTS.WIN32_FOCUSED_CHILD_NOT_FOUND;
  }

  if (s.foregroundMatchesTarget === false) {
    result.decision = FOCUS_VERDICTS.FOREGROUND_WINDOW_MISMATCH;
    return result;
  }

  if (s.rendererProbeAvailable !== true) {
    result.decision = FOCUS_VERDICTS.RENDERER_FOCUS_PROBE_UNAVAILABLE;
    return result;
  }

  if (s.activeElementInsideEditorRoot === false) {
    result.decision = FOCUS_VERDICTS.EDITOR_INPUT_NOT_FOCUSED;
    return result;
  }

  if (s.selectionRangeCount === 0 || s.selectionAnchorInsideEditor === false || s.selectionFocusInsideEditor === false) {
    result.decision = FOCUS_VERDICTS.EDITOR_SELECTION_NOT_OWNED;
    return result;
  }

  if (s.currentParagraphRuntimeId != null && s.logicalOffset != null) {
    result.decision = FOCUS_VERDICTS.EDITOR_FOCUS_AUTHORITY_PASS;
    result.overall = true;
    return result;
  }

  result.decision = FOCUS_VERDICTS.EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED;
  return result;
}

/**
 * Build one focus snapshot from a raw Win32 focus-probe result. Renderer
 * (document.activeElement / selection) is NOT readable by the harness and is
 * therefore recorded as rendererProbeAvailable=false (RENDERER_FOCUS_PROBE_UNAVAILABLE),
 * not guessed.
 */
export function buildFocusSnapshot(phase, win32Probe, targetHwnd) {
  const fg = win32Probe && typeof win32Probe.foregroundHwnd === 'number' ? win32Probe.foregroundHwnd : null;
  return {
    phase,
    timestamp: Date.now(),
    targetPid: win32Probe && win32Probe.targetPid != null ? win32Probe.targetPid : null,
    targetHwnd: targetHwnd ?? null,
    foregroundHwnd: fg,
    foregroundMatchesTarget: fg != null && fg === targetHwnd,
    foregroundThreadId: win32Probe && win32Probe.foregroundThreadId != null ? win32Probe.foregroundThreadId : null,
    focusedChildHwnd: win32Probe && win32Probe.focusedChildHwnd != null ? win32Probe.focusedChildHwnd : null,
    activeHwnd: win32Probe && win32Probe.activeHwnd != null ? win32Probe.activeHwnd : null,
    captureHwnd: win32Probe && win32Probe.captureHwnd != null ? win32Probe.captureHwnd : null,
    caretHwnd: win32Probe && win32Probe.caretHwnd != null ? win32Probe.caretHwnd : null,
    rendererProbeAvailable: false,
    editorInstanceId: null,
    activeElementTag: null,
    activeElementId: null,
    activeElementClassName: null,
    activeElementContentEditable: null,
    activeElementIsContentEditable: null,
    activeElementInsideEditorRoot: null,
    selectionRangeCount: null,
    selectionAnchorInsideEditor: null,
    selectionFocusInsideEditor: null,
    selectionCollapsed: null,
    selectionRuntimeId: null,
    currentParagraphRuntimeId: null,
    logicalOffset: null,
  };
}

/**
 * Build the editor-input-focus-audit.json artifact object (before the harness
 * applies the buildId/runtimeSessionId/auditPath/trialId binding). The four
 * snapshots share one finalDecision/overall computed from evaluateFocusAuthority.
 */
export function buildFocusAuditArtifact({ beforeAcquire, afterAcquire, beforeInput, afterInput }) {
  const final = evaluateFocusAuthority(beforeInput || afterInput || {});
  return {
    beforeAcquire: beforeAcquire || {},
    afterAcquire: afterAcquire || {},
    beforeInput: beforeInput || {},
    afterInput: afterInput || {},
    finalDecision: final.decision,
    overall: final.overall,
  };
}

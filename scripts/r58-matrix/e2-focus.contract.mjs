// e2-focus.contract.mjs — FOCUS-1..10 contract tests for the E2 editor input
// focus authority pure-observation gate.
import { strict as assert } from 'node:assert';
import { evaluateFocusAuthority, buildFocusAuditArtifact, buildFocusSnapshot, FOCUS_VERDICTS as F } from './e2-focus.mjs';
import { isStaleArtifact, buildTrialBinding } from './e2-input.mjs';

const BUILD_ID = 'inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq';
const SESSION = 'sess-1786672539069';

function mkSnapshot(overrides = {}) {
  return {
    phase: 'BEFORE_INPUT',
    foregroundMatchesTarget: true,
    rendererProbeAvailable: true,
    focusedChildHwnd: 123,
    activeElementInsideEditorRoot: null,
    selectionRangeCount: null,
    selectionAnchorInsideEditor: null,
    selectionFocusInsideEditor: null,
    currentParagraphRuntimeId: null,
    logicalOffset: null,
    ...overrides,
  };
}

let seq = 0;
function test(name, fn) {
  seq++;
  fn();
  console.log(`  FOCUS-${seq} ${name}: PASS`);
}

console.log('e2-focus.contract');

// FOCUS-1 — foreground correct + activeElement outside editor → EDITOR_INPUT_NOT_FOCUSED.
test('activeElement outside editor → EDITOR_INPUT_NOT_FOCUSED', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ activeElementInsideEditorRoot: false }));
  assert.equal(r.overall, false);
  assert.equal(r.decision, F.EDITOR_INPUT_NOT_FOCUSED);
});

// FOCUS-2 — activeElement inside + selectionRangeCount=0 → EDITOR_SELECTION_NOT_OWNED.
test('selectionRangeCount=0 → EDITOR_SELECTION_NOT_OWNED', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ activeElementInsideEditorRoot: true, selectionRangeCount: 0 }));
  assert.equal(r.decision, F.EDITOR_SELECTION_NOT_OWNED);
});

// FOCUS-3 — activeElement inside + anchor outside → EDITOR_SELECTION_NOT_OWNED.
test('anchor outside editor → EDITOR_SELECTION_NOT_OWNED', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ activeElementInsideEditorRoot: true, selectionRangeCount: 1, selectionAnchorInsideEditor: false, selectionFocusInsideEditor: true }));
  assert.equal(r.decision, F.EDITOR_SELECTION_NOT_OWNED);
});

// FOCUS-4 — activeElement/selection/runtimeId/logicalOffset all valid → PASS.
test('full authority → EDITOR_FOCUS_AUTHORITY_PASS', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ activeElementInsideEditorRoot: true, selectionRangeCount: 1, selectionAnchorInsideEditor: true, selectionFocusInsideEditor: true, currentParagraphRuntimeId: 'p1', logicalOffset: 2 }));
  assert.equal(r.overall, true);
  assert.equal(r.decision, F.EDITOR_FOCUS_AUTHORITY_PASS);
});

// FOCUS-5 — renderer focus probe unavailable → RENDERER_FOCUS_PROBE_UNAVAILABLE.
test('renderer probe unavailable → RENDERER_FOCUS_PROBE_UNAVAILABLE', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ rendererProbeAvailable: false }));
  assert.equal(r.overall, false);
  assert.equal(r.decision, F.RENDERER_FOCUS_PROBE_UNAVAILABLE);
});

// FOCUS-6 — focusedChildHwnd missing but renderer authority PASS → not EDITOR_INPUT_NOT_FOCUSED.
test('child focus missing + renderer PASS → not EDITOR_INPUT_NOT_FOCUSED', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ focusedChildHwnd: null, activeElementInsideEditorRoot: true, selectionRangeCount: 1, selectionAnchorInsideEditor: true, selectionFocusInsideEditor: true, currentParagraphRuntimeId: 'p1', logicalOffset: 2 }));
  assert.equal(r.decision, F.EDITOR_FOCUS_AUTHORITY_PASS);
  assert.equal(r.win32Decision, F.WIN32_FOCUSED_CHILD_NOT_FOUND);
  assert.notEqual(r.decision, F.EDITOR_INPUT_NOT_FOCUSED);
});

// FOCUS-7 — foreground mismatch → FOREGROUND_WINDOW_MISMATCH.
test('foreground mismatch → FOREGROUND_WINDOW_MISMATCH', () => {
  const r = evaluateFocusAuthority(mkSnapshot({ foregroundMatchesTarget: false }));
  assert.equal(r.decision, F.FOREGROUND_WINDOW_MISMATCH);
});

// FOCUS-8 — focus audit binds current build/session/auditPath/trialId.
test('focus audit binds current authority', () => {
  const snap = buildFocusSnapshot('BEFORE_INPUT', { foregroundHwnd: 1, targetPid: 1 }, 1);
  const artifact = buildFocusAuditArtifact({ beforeAcquire: snap, afterAcquire: snap, beforeInput: snap, afterInput: snap });
  const binding = buildTrialBinding({ buildId: BUILD_ID, runtimeSessionId: SESSION, auditPath: 'runtime-sess.log', trialId: 'e2-01', trialStartedAt: 't0' });
  const bound = { ...artifact, ...binding };
  assert.equal(bound.buildId, BUILD_ID);
  assert.equal(bound.runtimeSessionId, SESSION);
  assert.equal(bound.trialId, 'e2-01');
  assert.ok('finalDecision' in bound);
});

// FOCUS-9 — wrong-session focus artifact → DROP_STALE.
test('wrong-session focus artifact → DROP_STALE', () => {
  assert.equal(isStaleArtifact({ buildId: BUILD_ID, runtimeSessionId: 'sess-old' }, { buildId: BUILD_ID, runtimeSessionId: SESSION }), true);
});

// FOCUS-10 — any INVALID still produces a non-null, classifiable focus audit.
test('INVALID still produces focus audit artifact', () => {
  const snap = buildFocusSnapshot('BEFORE_INPUT', { foregroundHwnd: 1 }, 1);
  const artifact = buildFocusAuditArtifact({ beforeAcquire: snap, afterAcquire: snap, beforeInput: snap, afterInput: snap });
  assert.ok(artifact);
  assert.ok(typeof artifact.finalDecision === 'string');
  assert.equal(artifact.overall, false);
  assert.equal(artifact.finalDecision, F.RENDERER_FOCUS_PROBE_UNAVAILABLE);
});

console.log('  RESULT=PASS');

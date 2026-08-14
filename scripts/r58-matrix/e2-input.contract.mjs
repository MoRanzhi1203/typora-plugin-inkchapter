// e2-input.contract.mjs — INPUT-1..10 contract tests for the E2 input gate,
// foreground safety, token provenance, and trial artifact authority.
import { strict as assert } from 'node:assert';
import {
  evaluateInjectionGate,
  evaluateTokenProof,
  isStaleArtifact,
  evaluateTrialDeltaAuthority,
  buildTrialBinding,
  INVALID_REASONS as R,
} from './e2-input.mjs';

const BUILD_ID = 'inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq';
const STALE_BUILD = 'inkchapter-r58-7-p0-empty-special-arm-obs-es2b7q';
const SESSION = 'sess-new';
const STALE_SESSION = 'sess-1786634957368';

function baseAudit(overrides = {}) {
  return {
    acquireAttempted: true,
    acquireSucceeded: true,
    foregroundMatchAfterAcquire: true,
    foregroundMatchBeforeInput: true,
    injectionAttempted: true,
    requestedInputCount: 2,
    sendInputReturnCount: 2,
    foregroundMatchAfterInput: true,
    ...overrides,
  };
}

let seq = 0;
function test(name, fn) {
  seq++;
  fn();
  console.log(`  INPUT-${seq} ${name}: PASS`);
}

console.log('e2-input.contract');

// INPUT-1 — foreground mismatch → SendInput never called.
test('foreground mismatch → no SendInput', () => {
  const audit = baseAudit({ foregroundMatchAfterAcquire: false, injectionAttempted: false, requestedInputCount: 0, sendInputReturnCount: 0, foregroundMatchBeforeInput: false, foregroundMatchAfterInput: false });
  const r = evaluateInjectionGate(audit);
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.FOREGROUND_WINDOW_MISMATCH);
  assert.equal(audit.injectionAttempted, false);
  assert.equal(audit.sendInputReturnCount, 0);
});

// INPUT-2 — acquire succeeds + target foreground → injection allowed.
test('acquire + target foreground → allowed', () => {
  const r = evaluateInjectionGate(baseAudit());
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.invalidReason, null);
});

// INPUT-3 — foreground lost before input → block.
test('foreground lost before input → block', () => {
  const audit = baseAudit({ foregroundMatchBeforeInput: false, injectionAttempted: false, requestedInputCount: 0, sendInputReturnCount: 0 });
  const r = evaluateInjectionGate(audit);
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.FOREGROUND_LOST_BEFORE_INPUT);
});

// INPUT-4 — requested=2 returned<2 → SENDINPUT_PARTIAL_OR_FAILED.
test('partial SendInput → SENDINPUT_PARTIAL_OR_FAILED', () => {
  const audit = baseAudit({ requestedInputCount: 2, sendInputReturnCount: 1 });
  const r = evaluateInjectionGate(audit);
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.SENDINPUT_PARTIAL_OR_FAILED);
});

// INPUT-5 — foreground lost after input → invalid.
test('foreground lost after input → invalid', () => {
  const audit = baseAudit({ foregroundMatchAfterInput: false });
  const r = evaluateInjectionGate(audit);
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.FOREGROUND_LOST_DURING_INPUT);
});

// INPUT-6 — old Build delta ignored / archived.
test('old Build delta DROP_STALE', () => {
  const artifact = { buildId: STALE_BUILD, runtimeSessionId: SESSION };
  assert.equal(isStaleArtifact(artifact, { buildId: BUILD_ID, runtimeSessionId: SESSION }), true);
  const r = evaluateTrialDeltaAuthority({ available: true, buildId: STALE_BUILD, runtimeSessionId: SESSION, contaminated: false }, { buildId: BUILD_ID, runtimeSessionId: SESSION });
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.TRIAL_DELTA_STALE_BUILD);
  assert.equal(r.dropStale, true);
});

// INPUT-7 — wrong-session artifact DROP_STALE.
test('wrong-session artifact DROP_STALE', () => {
  const artifact = { buildId: BUILD_ID, runtimeSessionId: STALE_SESSION };
  assert.equal(isStaleArtifact(artifact, { buildId: BUILD_ID, runtimeSessionId: SESSION }), true);
  const r = evaluateTrialDeltaAuthority({ available: true, buildId: BUILD_ID, runtimeSessionId: STALE_SESSION, contaminated: false }, { buildId: BUILD_ID, runtimeSessionId: SESSION });
  assert.equal(r.invalidReason, R.TRIAL_DELTA_STALE_SESSION);
  assert.equal(r.dropStale, true);
});

// INPUT-8 — current session delta accepted.
test('current session delta accepted', () => {
  const r = evaluateTrialDeltaAuthority({ available: true, buildId: BUILD_ID, runtimeSessionId: SESSION, contaminated: false }, { buildId: BUILD_ID, runtimeSessionId: SESSION });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.invalidReason, null);
});

// INPUT-9 — current trial no delta → CURRENT_TRIAL_DELTA_NOT_AVAILABLE (no fallback).
test('no current delta → CURRENT_TRIAL_DELTA_NOT_AVAILABLE', () => {
  const r = evaluateTrialDeltaAuthority(null, { buildId: BUILD_ID, runtimeSessionId: SESSION });
  assert.equal(r.verdict, 'INVALID');
  assert.equal(r.invalidReason, R.CURRENT_TRIAL_DELTA_NOT_AVAILABLE);
  assert.equal(r.dropStale, false);
});

// INPUT-10 — summary / input-audit / token-proof Build+session authority一致.
test('summary/input/token authority consistent', () => {
  const binding = buildTrialBinding({ buildId: BUILD_ID, runtimeSessionId: SESSION, auditPath: 'runtime-sess-new.log', trialId: 'e2-01', trialStartedAt: 't0' });
  const summary = { ...binding, verdict: 'PASS' };
  const inputAudit = { ...binding, requestedInputCount: 2 };
  const tokenProof = { ...binding, tokenText: '。。' };
  for (const artifact of [summary, inputAudit, tokenProof]) {
    assert.equal(isStaleArtifact(artifact, { buildId: BUILD_ID, runtimeSessionId: SESSION }), false);
    assert.equal(artifact.buildId, BUILD_ID);
    assert.equal(artifact.runtimeSessionId, SESSION);
    assert.equal(artifact.trialId, 'e2-01');
  }
});

// Bonus: token proof precise reasons.
test('token proof precise reasons', () => {
  const pass = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 1, inputCount: 1, compositionStartCount: 1, compositionEndCount: 1, visibleText: '。。', logicalOffset: 2, compositionSessionId: 'ime-1' });
  assert.equal(pass.verdict, 'PASS');
  assert.equal(pass.imeProvenance, true);

  const textMismatch = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 1, inputCount: 1, compositionStartCount: 1, compositionEndCount: 1, visibleText: '..', logicalOffset: 2 });
  assert.equal(textMismatch.invalidReason, R.SPECIAL_TOKEN_TEXT_MISMATCH);

  const offsetMismatch = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 1, inputCount: 1, compositionStartCount: 1, compositionEndCount: 1, visibleText: '。。', logicalOffset: 1 });
  assert.equal(offsetMismatch.invalidReason, R.SPECIAL_TOKEN_OFFSET_MISMATCH);
});

console.log('  RESULT=PASS');

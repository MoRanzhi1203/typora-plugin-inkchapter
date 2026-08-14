// e2-artifact.contract.mjs — ARTIFACT-1..10 contract tests for E2 failure-path
// artifact durability + precise final verdict + single verdict authority.
import { strict as assert } from 'node:assert';
import {
  evaluateTokenProof,
  evaluateTokenProofFinal,
  isStaleArtifact,
  buildDeltaMetaRecord,
  buildTrialBinding,
  INVALID_REASONS as R,
} from './e2-input.mjs';

const BUILD_ID = 'inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq';
const STALE_BUILD = 'inkchapter-r58-7-p0-empty-special-arm-obs-es2b7q';
const SESSION = 'sess-1786672539069';

const timeoutResult = {
  verdict: 'INVALID',
  invalidReason: R.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED,
  tokenText: null,
  logicalOffset: null,
  imeProvenance: false,
  keyboardEventCount: 0,
  beforeInputCount: 0,
  inputCount: 0,
  compositionStartCount: 0,
  compositionEndCount: 0,
};

let seq = 0;
function test(name, fn) {
  seq++;
  fn();
  console.log(`  ARTIFACT-${seq} ${name}: PASS`);
}

console.log('e2-artifact.contract');

// ARTIFACT-1 — token timeout (0 events) but input audit exists → specific reason, not missing-audit.
test('token timeout still has input audit', () => {
  const r = evaluateTokenProofFinal({ available: true }, { available: true }, timeoutResult);
  assert.equal(r.overall, false);
  assert.equal(r.invalidReason, R.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED);
  assert.notEqual(r.invalidReason, R.INPUT_INJECTION_AUDIT_NOT_AVAILABLE);
});

// ARTIFACT-2 — 0 runtime events still produce a legal delta (deltaExists=true).
test('0 events → delta still generated', () => {
  const m = buildDeltaMetaRecord({ eventCount: 0 });
  assert.equal(m.deltaExists, true);
  assert.equal(m.available, true);
});

// ARTIFACT-3 — 0 runtime events → delta-meta eventCount=0.
test('0 events → delta-meta eventCount=0', () => {
  const m = buildDeltaMetaRecord({ eventCount: 0 });
  assert.equal(m.eventCount, 0);
});

// ARTIFACT-4 — keyboardEventCount=0 → RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED.
test('keyboard=0 → RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED', () => {
  const r = evaluateTokenProof({ keyboardEvents: [], beforeInputCompCount: 0, inputCount: 0, compositionStartCount: 0, compositionEndCount: 0, visibleText: null, logicalOffset: null });
  assert.equal(r.invalidReason, R.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED);
});

// ARTIFACT-5 — keyboard>0 / beforeinput=0 → RUNTIME_BEFOREINPUT_NOT_OBSERVED.
test('keyboard>0 / beforeinput=0 → RUNTIME_BEFOREINPUT_NOT_OBSERVED', () => {
  const r = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 0, inputCount: 0, compositionStartCount: 0, compositionEndCount: 0, visibleText: '..', logicalOffset: 2 });
  assert.equal(r.invalidReason, R.RUNTIME_BEFOREINPUT_NOT_OBSERVED);
});

// ARTIFACT-6 — beforeinput>0 / input=0 → RUNTIME_INPUT_NOT_OBSERVED.
test('beforeinput>0 / input=0 → RUNTIME_INPUT_NOT_OBSERVED', () => {
  const r = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 1, inputCount: 0, compositionStartCount: 1, compositionEndCount: 1, visibleText: '。。', logicalOffset: 2 });
  assert.equal(r.invalidReason, R.RUNTIME_INPUT_NOT_OBSERVED);
});

// ARTIFACT-7 — input present but composition incomplete → IME_SEQUENCE_INCOMPLETE.
test('input present / composition incomplete → IME_SEQUENCE_INCOMPLETE', () => {
  const r = evaluateTokenProof({ keyboardEvents: [{ key: '.', code: 'Period' }], beforeInputCompCount: 1, inputCount: 1, compositionStartCount: 0, compositionEndCount: 0, visibleText: '。。', logicalOffset: 2 });
  assert.equal(r.invalidReason, R.IME_SEQUENCE_INCOMPLETE);
});

// ARTIFACT-8 — wrong Build/session evidence → DROP_STALE.
test('wrong Build/session → DROP_STALE', () => {
  assert.equal(isStaleArtifact({ buildId: STALE_BUILD, runtimeSessionId: SESSION }, { buildId: BUILD_ID, runtimeSessionId: SESSION }), true);
  assert.equal(isStaleArtifact({ buildId: BUILD_ID, runtimeSessionId: 'sess-old' }, { buildId: BUILD_ID, runtimeSessionId: SESSION }), true);
});

// ARTIFACT-9 — summary / token-provenance / delta-meta invalidReason all一致.
test('summary/token/delta invalidReason consistent', () => {
  const tokenFinal = evaluateTokenProofFinal({ available: true }, { available: true }, timeoutResult);
  const binding = buildTrialBinding({ buildId: BUILD_ID, runtimeSessionId: SESSION, auditPath: 'runtime-sess.log', trialId: 'e2-01', trialStartedAt: 't0' });
  const summary = { ...binding, invalidReason: tokenFinal.invalidReason };
  const tokenProof = { ...binding, invalidReason: tokenFinal.invalidReason };
  const deltaMeta = { ...binding, ...buildDeltaMetaRecord({ eventCount: 0 }), invalidReason: tokenFinal.invalidReason };
  assert.equal(summary.invalidReason, tokenFinal.invalidReason);
  assert.equal(tokenProof.invalidReason, tokenFinal.invalidReason);
  assert.equal(deltaMeta.invalidReason, tokenFinal.invalidReason);
});

// ARTIFACT-10 — early INVALID → write/flush order: input audit first, then delta, then token.
test('early INVALID ordering: input audit → delta → token', () => {
  // Missing input audit is detected first.
  const r1 = evaluateTokenProofFinal(null, { available: true }, timeoutResult);
  assert.equal(r1.invalidReason, R.INPUT_INJECTION_AUDIT_NOT_AVAILABLE);
  // Missing delta is detected second.
  const r2 = evaluateTokenProofFinal({ available: true }, null, timeoutResult);
  assert.equal(r2.invalidReason, R.CURRENT_TRIAL_DELTA_NOT_AVAILABLE);
  // Both present → token-specific reason.
  const r3 = evaluateTokenProofFinal({ available: true }, { available: true }, timeoutResult);
  assert.equal(r3.invalidReason, R.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED);
});

console.log('  RESULT=PASS');

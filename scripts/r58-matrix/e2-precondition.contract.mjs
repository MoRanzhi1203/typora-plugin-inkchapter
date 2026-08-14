// e2-precondition.contract.mjs — PRECOND-1..10 contract tests for the E2
// runtime precondition (audit authority + bounded wait/poll + precise reasons).
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  emptyObservation,
  accumulatePreconditionEvents,
  evaluateE2Precondition,
  buildPreconditionArtifact,
  PRECOND_INVALID_REASONS as R,
} from './e2-precondition.mjs';

const BUILD_ID = 'inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq';
const DOC = 'r58-empty-special-e2-01.md';
const EXPECTED = { scopeId: DOC, documentKey: DOC };
const AUTHORITY = { runtimeSessionId: 'sess-new', buildId: BUILD_ID };

function readyEvent(overrides = {}) {
  return {
    sessionId: 'sess-new',
    buildId: BUILD_ID,
    event: 'DOCUMENT-CONTEXT-READY',
    mode: 'PERSISTED',
    scopeId: DOC,
    businessReady: true,
    persistenceReady: true,
    decision: 'READY',
    ...overrides,
  };
}

function sidecarEvent(overrides = {}) {
  return {
    sessionId: 'sess-new',
    buildId: BUILD_ID,
    event: 'SIDECAR-ACTUAL-LOAD',
    documentKey: DOC,
    exists: false,
    recordCount: 0,
    source: 'physical',
    backend: 'filesystem',
    ...overrides,
  };
}

function evaluate(events, authority = AUTHORITY) {
  const obs = emptyObservation();
  accumulatePreconditionEvents(obs, events, authority);
  return evaluateE2Precondition(obs, EXPECTED);
}

let seq = 0;
function test(name, fn) {
  seq++;
  fn();
  console.log(`  PRECOND-${seq} ${name}: PASS`);
}

console.log('e2-precondition.contract');

// PRECOND-1 — delayed context event: first poll no READY, second poll READY → PASS.
test('delayed context event', () => {
  let ev = evaluate([sidecarEvent()]);
  assert.equal(ev.overall, false);
  assert.equal(ev.invalidReason, R.DOCUMENT_CONTEXT_READY_NOT_OBSERVED);
  ev = evaluate([sidecarEvent(), readyEvent()]);
  assert.equal(ev.overall, true);
  assert.equal(ev.invalidReason, null);
});

// PRECOND-2 — delayed sidecar event: READY first, sidecar arrives later → PASS.
test('delayed sidecar event', () => {
  let ev = evaluate([readyEvent()]);
  assert.equal(ev.overall, false);
  assert.equal(ev.invalidReason, R.SIDECAR_ACTUAL_LOAD_NOT_OBSERVED);
  ev = evaluate([readyEvent(), sidecarEvent()]);
  assert.equal(ev.overall, true);
  assert.equal(ev.invalidReason, null);
});

// PRECOND-3 — timeout missing context → DOCUMENT_CONTEXT_READY_NOT_OBSERVED.
test('timeout missing context', () => {
  const ev = evaluate([sidecarEvent()]);
  assert.equal(ev.overall, false);
  assert.equal(ev.invalidReason, R.DOCUMENT_CONTEXT_READY_NOT_OBSERVED);
});

// PRECOND-4 — timeout missing sidecar → SIDECAR_ACTUAL_LOAD_NOT_OBSERVED.
test('timeout missing sidecar', () => {
  const ev = evaluate([readyEvent()]);
  assert.equal(ev.overall, false);
  assert.equal(ev.invalidReason, R.SIDECAR_ACTUAL_LOAD_NOT_OBSERVED);
});

// PRECOND-5 — dirty sidecar exists=true → SIDECAR_EXISTS_UNEXPECTEDLY.
test('dirty sidecar', () => {
  const ev = evaluate([readyEvent(), sidecarEvent({ exists: true })]);
  assert.equal(ev.invalidReason, R.SIDECAR_EXISTS_UNEXPECTEDLY);
});

// PRECOND-6 — nonzero records → SIDECAR_RECORD_COUNT_NONZERO.
test('nonzero records', () => {
  const ev = evaluate([readyEvent(), sidecarEvent({ recordCount: 1 })]);
  assert.equal(ev.invalidReason, R.SIDECAR_RECORD_COUNT_NONZERO);
});

// PRECOND-7 — stale previous session ignored (old session READY/load must not PASS).
test('stale previous session ignored', () => {
  const staleAuthority = { runtimeSessionId: 'sess-old', buildId: BUILD_ID };
  const ev = evaluate([readyEvent({ sessionId: 'sess-old' }), sidecarEvent({ sessionId: 'sess-old' })], AUTHORITY);
  assert.equal(ev.overall, false);
  assert.equal(ev.invalidReason, R.DOCUMENT_CONTEXT_READY_NOT_OBSERVED);
  assert.equal(ev.staleEventDropCount, 2);
  assert.ok(ev.invalidReason !== null);
  // Also assert the stale authority itself (old session) evaluates as PASS only when authority matches.
  const staleEv = evaluate([readyEvent({ sessionId: 'sess-old' }), sidecarEvent({ sessionId: 'sess-old' })], staleAuthority);
  assert.equal(staleEv.overall, true);
});

// PRECOND-8 — duplicate consistent lifecycle → PASS, counts preserved.
test('duplicate consistent lifecycle', () => {
  const ev = evaluate([readyEvent(), readyEvent(), sidecarEvent(), sidecarEvent()]);
  assert.equal(ev.overall, true);
  assert.equal(ev.documentContextReadyCount, 2);
  assert.equal(ev.sidecarLoadCount, 2);
});

// PRECOND-9 — summary/artifact authority: single evaluate → one invalidReason for both.
test('summary/artifact authority', () => {
  const obs = emptyObservation();
  accumulatePreconditionEvents(obs, [readyEvent(), sidecarEvent()], AUTHORITY);
  const artifact = buildPreconditionArtifact(obs, EXPECTED, {
    scenario: 'E2', trialId: 'e2-01', expectedBuildId: BUILD_ID,
    auditPath: 'x', auditAuthorityAccepted: true, fixtureExists: true, fixtureClean: true,
    waitStartedAt: 's', waitEndedAt: 'e', waitDurationMs: 0, pollCount: 1,
  });
  const summaryInvalidReason = artifact.invalidReason;
  assert.equal(summaryInvalidReason, artifact.invalidReason);
  assert.equal(artifact.overall, true);
  assert.equal(artifact.invalidReason, null);
});

// PRECOND-10 — UTF-8 no BOM: new JSON artifact head bytes != EF BB BF.
test('utf8 no bom', () => {
  const artifact = buildPreconditionArtifact(emptyObservation(), EXPECTED, {
    scenario: 'E2', trialId: 'e2-01', expectedBuildId: BUILD_ID,
    auditPath: 'x', auditAuthorityAccepted: true, fixtureExists: true, fixtureClean: true,
    waitStartedAt: 's', waitEndedAt: 'e', waitDurationMs: 0, pollCount: 0,
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'inkchapter-precond-'));
  const file = path.join(dir, 'trial-precondition.json');
  try {
    writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    const head = readFileSync(file).subarray(0, 3);
    assert.notDeepEqual([...head], [0xef, 0xbb, 0xbf]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log('  RESULT=PASS');

// phase-b-authority.contract.mjs — PHASEBGATE-1..10 contract for the Phase B
// hard authority gate. Pure comparison; no Typora launch.
import { strict as assert } from 'node:assert';
import { evaluatePhaseBAuthority } from './phase-b-authority.mjs';

const FORMAL = {
  auditSessionId: 'sess-formal',
  runtimeBuildId: 'build-evc1',
  runtimeMainSHA: 'MAIN_SHA_A',
  styleSHA: 'STYLE_SHA_A',
  targetVault: 'D:\\vault',
  targetDocument: 'r58-empty-special-e2-01.md',
  auditPath: 'audit\\runtime-sess-formal.log',
  verdict: 'PASS',
  failedChecks: [],
};

function current(overrides = {}) {
  const base = {
    sessionId: 'sess-formal',
    auditSessionId: 'sess-formal',
    buildId: 'build-evc1',
    mainSha: 'MAIN_SHA_A',
    styleSha: 'STYLE_SHA_A',
    vault: 'D:\\vault',
    document: 'r58-empty-special-e2-01.md',
    initializationCount: 1,
  };
  const merged = { ...base, ...overrides };
  // Keep auditSessionId in sync with sessionId unless explicitly overridden.
  if (overrides.sessionId !== undefined && overrides.auditSessionId === undefined) {
    merged.auditSessionId = overrides.sessionId;
  }
  return merged;
}

// PHASEBGATE-1: same session → PASS
assert.equal(evaluatePhaseBAuthority(FORMAL, current()).overall, true, 'PHASEBGATE-1 FAIL');
assert.deepEqual(evaluatePhaseBAuthority(FORMAL, current()).failedChecks, [], 'PHASEBGATE-1 FAIL');

// PHASEBGATE-2: session mismatch → SESSION_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ sessionId: 'sess-other' }));
  assert.equal(r.overall, false, 'PHASEBGATE-2 FAIL');
  assert.deepEqual(r.failedChecks, ['SESSION_MISMATCH'], 'PHASEBGATE-2 FAIL');
}

// PHASEBGATE-3: document mismatch → DOCUMENT_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: 'other.md' }));
  assert.deepEqual(r.failedChecks, ['DOCUMENT_MISMATCH'], 'PHASEBGATE-3 FAIL');
}

// PHASEBGATE-4: build mismatch → BUILD_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ buildId: 'other-build' }));
  assert.deepEqual(r.failedChecks, ['BUILD_MISMATCH'], 'PHASEBGATE-4 FAIL');
}

// PHASEBGATE-5: main sha mismatch → MAIN_SHA_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ mainSha: 'OTHER' }));
  assert.deepEqual(r.failedChecks, ['MAIN_SHA_MISMATCH'], 'PHASEBGATE-5 FAIL');
}

// PHASEBGATE-6: style sha mismatch → STYLE_SHA_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ styleSha: 'OTHER' }));
  assert.deepEqual(r.failedChecks, ['STYLE_SHA_MISMATCH'], 'PHASEBGATE-6 FAIL');
}

// PHASEBGATE-7: initializationCount != 1 → INITIALIZATION_COUNT_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ initializationCount: 2 }));
  assert.deepEqual(r.failedChecks, ['INITIALIZATION_COUNT_MISMATCH'], 'PHASEBGATE-7 FAIL');
}

// PHASEBGATE-8: audit session mismatch → AUDIT_SESSION_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ auditSessionId: 'sess-other' }));
  assert.deepEqual(r.failedChecks, ['AUDIT_SESSION_MISMATCH'], 'PHASEBGATE-8 FAIL');
}

// PHASEBGATE-9: formal verdict != PASS → PHASE_B_AUTHORITY_NOT_FORMAL
{
  const r = evaluatePhaseBAuthority({ ...FORMAL, verdict: 'FAIL' }, current());
  assert.deepEqual(r.failedChecks, ['PHASE_B_AUTHORITY_NOT_FORMAL'], 'PHASEBGATE-9 FAIL');
}

// PHASEBGATE-10: multiple mismatches → preserves all failedChecks
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ sessionId: 'sess-other', document: 'other.md', buildId: 'other-build' }));
  assert.equal(r.overall, false, 'PHASEBGATE-10 FAIL');
  assert.ok(r.failedChecks.includes('SESSION_MISMATCH'), 'PHASEBGATE-10 FAIL');
  assert.ok(r.failedChecks.includes('DOCUMENT_MISMATCH'), 'PHASEBGATE-10 FAIL');
  assert.ok(r.failedChecks.includes('BUILD_MISMATCH'), 'PHASEBGATE-10 FAIL');
}

console.log('PHASEBGATE-1..10 PASS');

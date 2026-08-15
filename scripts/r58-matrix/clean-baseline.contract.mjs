// clean-baseline.contract.mjs — CB-1..9: A1 clean-baseline authority condition.
//
// Verifies cleanBaseline is derived from the frozen authority (pre-trial), not
// from the authority→verdict transaction window. The startup SIDECAR-ACTUAL-LOAD
// is emitted BEFORE auditStartOffset and therefore must be read pre-authority.
import { strict as assert } from 'node:assert';
import { evaluateCleanBaseline } from './trial-verdict.mjs';

function cleanAuthority(overrides = {}) {
  return {
    decision: 'ACCEPT',
    documentAuthorityOk: true,
    documentOk: true,
    sidecarStateBefore: { exists: false, recordCount: 0 },
    preAuthoritySidecarLoad: { exists: false, recordCount: 0, source: 'physical' },
    preAuthorityPersistedLoadCount: 0,
    preAuthorityPersistedHistoricalCount: 0,
    ...overrides,
  };
}

// CB-1: clean startup load before authority + clean authority state → PASS
{
  const r = evaluateCleanBaseline(cleanAuthority());
  assert.equal(r.cleanBaseline, true, 'CB-1 FAIL: cleanBaseline');
  assert.deepEqual(r.failedChecks, [], 'CB-1 FAIL: failedChecks');
}

// CB-2: sidecar exists=true → FAIL (existing policy)
{
  const r = evaluateCleanBaseline(cleanAuthority({ sidecarStateBefore: { exists: true, recordCount: 0 } }));
  assert.equal(r.cleanBaseline, false, 'CB-2 FAIL: cleanBaseline');
  assert.ok(r.failedChecks.includes('sidecarStateBefore!=clean'), 'CB-2 FAIL: failedChecks');
}

// CB-3: sidecar recordCount>0 → FAIL
{
  const r = evaluateCleanBaseline(cleanAuthority({ sidecarStateBefore: { exists: true, recordCount: 3 } }));
  assert.equal(r.cleanBaseline, false, 'CB-3 FAIL: cleanBaseline');
}

// CB-4: runtime loader evidence missing → FAIL
{
  const r = evaluateCleanBaseline(cleanAuthority({ preAuthoritySidecarLoad: null }));
  assert.equal(r.cleanBaseline, false, 'CB-4 FAIL: cleanBaseline');
  assert.ok(r.failedChecks.includes('preAuthoritySidecarLoad!=clean'), 'CB-4 FAIL: failedChecks');
}

// CB-5: runtime loader source != physical → FAIL
{
  const r = evaluateCleanBaseline(cleanAuthority({
    preAuthoritySidecarLoad: { exists: false, recordCount: 0, source: 'disabled (vaultRoot unknown, TEMP fallback blocked)' },
  }));
  assert.equal(r.cleanBaseline, false, 'CB-5 FAIL: cleanBaseline');
}

// CB-6: wrong document (documentAuthorityOk=false) → FAIL (never PASS)
{
  const r = evaluateCleanBaseline(cleanAuthority({ documentAuthorityOk: false }));
  assert.equal(r.cleanBaseline, false, 'CB-6 FAIL: cleanBaseline');
  assert.ok(r.failedChecks.includes('documentAuthorityOk!=true'), 'CB-6 FAIL: failedChecks');
}

// CB-7: wrong document (documentOk=false) → FAIL (never PASS)
{
  const r = evaluateCleanBaseline(cleanAuthority({ documentOk: false }));
  assert.equal(r.cleanBaseline, false, 'CB-7 FAIL: cleanBaseline');
}

// CB-8: session/build/SHA mismatch (authority REJECT) → FAIL (never PASS)
{
  const r = evaluateCleanBaseline(cleanAuthority({ decision: 'REJECT' }));
  assert.equal(r.cleanBaseline, false, 'CB-8 FAIL: cleanBaseline');
  assert.ok(r.failedChecks.includes('authority!=ACCEPT'), 'CB-8 FAIL: failedChecks');
}

// CB-9: pre-authority persisted records present → FAIL (no loosening)
{
  const rLoad = evaluateCleanBaseline(cleanAuthority({ preAuthorityPersistedLoadCount: 1 }));
  assert.equal(rLoad.cleanBaseline, false, 'CB-9a FAIL: persistedLoadCount');
  assert.ok(rLoad.failedChecks.includes('preAuthorityPersistedRecords!=0'), 'CB-9a FAIL: failedChecks');

  const rHist = evaluateCleanBaseline(cleanAuthority({ preAuthorityPersistedHistoricalCount: 1 }));
  assert.equal(rHist.cleanBaseline, false, 'CB-9b FAIL: persistedHistoricalCount');
  assert.ok(rHist.failedChecks.includes('preAuthorityPersistedRecords!=0'), 'CB-9b FAIL: failedChecks');
}

console.log('CB-1 clean startup load + clean authority PASS');
console.log('CB-2 sidecar exists=true FAIL');
console.log('CB-3 sidecar recordCount>0 FAIL');
console.log('CB-4 runtime loader missing FAIL');
console.log('CB-5 runtime loader non-physical FAIL');
console.log('CB-6 documentAuthorityOk=false FAIL');
console.log('CB-7 documentOk=false FAIL');
console.log('CB-8 authority REJECT FAIL');
console.log('CB-9 persisted records FAIL');

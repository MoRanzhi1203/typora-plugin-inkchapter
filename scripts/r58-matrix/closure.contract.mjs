// closure.contract.mjs — static contract tests for the R58.7 closure infra
// (fixture-manager / trial-verdict / closure-report-writer / scenarios).
// Run WITHOUT Typora.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedHistoricalFixture, verifySidecar, verifyFixture, cleanSidecar } from './fixture-manager.mjs';
import { parseJsonLines, normalizeVerdict, evaluateFailurePath, collectGlobalCounters } from './trial-verdict.mjs';
import { buildClosureSummary } from './closure-report-writer.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'scenarios.json'), 'utf8'));

// ── CLOSURE-* ────────────────────────────────────────────────────────────
const REQUIRED = ['E1', 'E2', 'E3', 'A1-01', 'A1-02', 'A1-03', 'A2-01', 'A3-01', 'B1-01', 'B1-02', 'FAILURE-PATH'];
for (const s of REQUIRED) {
  assert.ok(scenarios.scenarioMap?.[s], `CLOSURE-1 FAIL: scenarioMap missing ${s}`);
}
assert.equal(scenarios.scenarioMap['FAILURE-PATH'].parser, 'empty-special-negative', 'CLOSURE-2 FAIL: FAILURE-PATH parser');
assert.equal(scenarios.scenarioMap['B1-01'].sidecarPolicy, 'seed', 'CLOSURE-3 FAIL: B1 sidecarPolicy');
assert.equal(scenarios.scenarioMap['E1'].parser, 'empty-special', 'CLOSURE-4 FAIL: E1 parser');
assert.equal(scenarios.scenarioMap['A1-01'].parser, 'matrix', 'CLOSURE-5 FAIL: A1 parser');

// ── B1SEED-* ─────────────────────────────────────────────────────────────
const tmp = mkdtempSync(path.join(tmpdir(), 'ink-b1seed-'));
try {
  const seed = seedHistoricalFixture('r58-b1-historical-01.md', tmp);
  assert.equal(seed.recordCount, 1, 'B1SEED-1 FAIL: recordCount');
  assert.equal(seed.expectedLoadState, 'PERSISTED_HISTORICAL', 'B1SEED-2 FAIL: expectedLoadState');
  assert.equal(seed.seedOrigin, 'persisted', 'B1SEED-3 FAIL: seedOrigin');

  const sidecar = JSON.parse(readFileSync(seed.sidecar, 'utf8'));
  assert.equal(sidecar.schemaVersion, 1, 'B1SEED-4 FAIL: schemaVersion');
  assert.equal(sidecar.paragraphOverrides.length, 1, 'B1SEED-5 FAIL: paragraphOverrides length');
  assert.equal(sidecar.paragraphOverrides[0].mode, 'force-indent', 'B1SEED-6 FAIL: mode');
  assert.equal(sidecar.paragraphOverrides[0].anchor.lastKnownOrdinal, 0, 'B1SEED-7 FAIL: anchor ordinal');
  assert.equal(sidecar.paragraphOverrides[0].temporary, true, 'B1SEED-8 FAIL: temporary');
  // No live binding fields (must not fabricate runtime live binding).
  assert.ok(!('scopeId' in sidecar.paragraphOverrides[0]), 'B1SEED-9 FAIL: leaked live binding');

  const fixtureState = verifyFixture('r58-b1-historical-01.md', tmp);
  assert.equal(fixtureState.exists, true, 'B1SEED-10 FAIL: fixture exists');
  assert.equal(fixtureState.bytesHex, Buffer.from('\u5386\u53f2\u6bb5\u843d\n', 'utf8').toString('hex').toUpperCase(), 'B1SEED-11 FAIL: fixture bytes');

  const clean = cleanSidecar('r58-b1-historical-01.md', tmp);
  assert.equal(clean.removed, true, 'B1SEED-12 FAIL: cleanSidecar');
  assert.equal(verifySidecar('r58-b1-historical-01.md', tmp).exists, false, 'B1SEED-13 FAIL: sidecar gone');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── VERDICT-* ────────────────────────────────────────────────────────────
const failPathEvents = [
  { event: 'EMPTY-SPECIAL-TEST-HOOK', consumed: true, effectiveVisualVerify: false },
  { event: 'EMPTY-SPECIAL-ROLLBACK', overall: true },
  { event: 'EMPTY-SPECIAL-TRANSACTION-CLOSE', finalState: 'BLOCKED', terminal: true, overall: true },
];
const parsed = { events: failPathEvents, lineCount: 3, parseFailureCount: 0 };

const passVerdict = evaluateFailurePath({
  events: parsed.events,
  recordCountBefore: 0,
  recordCountAfter: 0,
  sidecarCountBefore: 0,
  sidecarCountAfter: 0,
  awaitingCount: 0,
});
assert.equal(passVerdict.verdict, 'FAIL', 'VERDICT-1 FAIL: failure-path Runtime Verdict should be FAIL (expected), got ' + passVerdict.verdict);
assert.equal(passVerdict.controlledNegativePass, true, 'VERDICT-1 FAIL: controlledNegativePass');
assert.equal(passVerdict.firstFail, 'CONTROLLED_NEGATIVE_INJECTION', 'VERDICT-1 FAIL: firstFail');
assert.equal(passVerdict.rollbackExecuted, true, 'VERDICT-2 FAIL: rollbackExecuted');
assert.equal(passVerdict.canonicalCreated, false, 'VERDICT-3 FAIL: canonicalCreated');

const canonicalLeak = evaluateFailurePath({
  events: [...parsed.events, { event: 'EMPTY-SPECIAL-CANONICAL-COMMIT', success: true }],
  recordCountBefore: 0, recordCountAfter: 0, sidecarCountBefore: 0, sidecarCountAfter: 0, awaitingCount: 0,
});
assert.equal(canonicalLeak.verdict, 'PASS', 'VERDICT-4 FAIL: committed despite injection should be false-pass (PASS)');
assert.ok(canonicalLeak.failedChecks.includes('FALSE_PASS'), 'VERDICT-5 FAIL: false-pass marker');
assert.equal(canonicalLeak.controlledNegativePass, false, 'VERDICT-5 FAIL: controlledNegativePass');

const noRollback = evaluateFailurePath({
  events: [{ event: 'EMPTY-SPECIAL-TEST-HOOK', consumed: true, effectiveVisualVerify: false }],
  recordCountBefore: 0, recordCountAfter: 0, sidecarCountBefore: 0, sidecarCountAfter: 0, awaitingCount: 0,
});
assert.equal(noRollback.verdict, 'FAIL', 'VERDICT-6 FAIL: no rollback should FAIL');
assert.ok(noRollback.failedChecks.includes('rollbackExecuted!=true'), 'VERDICT-7 FAIL');

const norm = normalizeVerdict(
  { verdict: 'PASS', failedChecks: [], final: { canonicalOwnerCorrect: true, semanticCorrect: true, visualIndentCorrect: true, caretLogicalCorrect: true, caretVisualCorrect: true } },
  { events: [{ event: 'EMPTY-SPECIAL-FINAL', txnId: 'tx-1', recordId: 'rec-1', runtimeId: 'rt-1' }] },
);
assert.equal(norm.verdict, 'PASS', 'VERDICT-8 FAIL: normalize PASS');
assert.deepEqual(norm.txnIds, ['tx-1'], 'VERDICT-9 FAIL: txnIds');
assert.deepEqual(norm.recordIds, ['rec-1'], 'VERDICT-10 FAIL: recordIds');
assert.equal(norm.canonicalOwnerCorrect, true, 'VERDICT-11 FAIL: canonicalOwnerCorrect');

const counters = collectGlobalCounters([
  { event: 'PLUGIN-SELECTION-WRITE-AUDIT' },
  { event: 'CARET-CONTINUITY-RESTORE' },
  { event: 'CARET-REPAIR' },
  { event: 'CANONICAL-SCOPE-MISMATCH' },
  { event: 'AWAITING-TRANSFER-LEAK-AUDIT', awaitingCount: 2 },
]);
assert.equal(counters.selectionWriteCount, 1, 'VERDICT-12 FAIL: selectionWriteCount');
assert.equal(counters.caretRestoreCount, 1, 'VERDICT-13 FAIL: caretRestoreCount');
assert.equal(counters.caretRepairCount, 1, 'VERDICT-14 FAIL: caretRepairCount');
assert.equal(counters.mismatchCount, 1, 'VERDICT-15 FAIL: mismatchCount');
assert.equal(counters.awaitingCount, 2, 'VERDICT-16 FAIL: awaitingCount');

// ── AUTHORITY-* ──────────────────────────────────────────────────────────
const allPassTrials = REQUIRED.map((s) => ({ scenario: s, verdict: 'PASS', failedChecks: [] }));
const summary = buildClosureSummary(allPassTrials, { buildId: 'B', mainSHA: 'M', styleSHA: 'S', strictStartup: 'PASS' });
assert.equal(summary.finalClosure, 'PASS', 'AUTHORITY-1 FAIL: finalClosure');
assert.equal(summary.reducedMatrixPass, true, 'AUTHORITY-2 FAIL: reducedMatrixPass');
assert.equal(summary.reducedMatrixPassCount, 7, 'AUTHORITY-3 FAIL: matrix count');

const missingTrials = REQUIRED.filter((s) => s !== 'E1').map((s) => ({ scenario: s, verdict: 'PASS', failedChecks: [] }));
const missingSummary = buildClosureSummary(missingTrials, { buildId: 'B', mainSHA: 'M', styleSHA: 'S', strictStartup: 'PASS' });
assert.equal(missingSummary.finalClosure, 'NOT_PASSED', 'AUTHORITY-4 FAIL: missing E1 must not PASS');

console.log('CLOSURE-1..5, B1SEED-1..13, VERDICT-1..16, AUTHORITY-1..4 PASS');

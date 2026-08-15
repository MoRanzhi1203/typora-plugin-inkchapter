// raf-race.contract.mjs — RAF-RACE-1..12: RAF-race EmptySpecial stress verdict.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScenario } from './fixture-manager.mjs';
import { evaluateRafRace } from './trial-verdict.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'scenarios.json'), 'utf8'));

// RAF-RACE-1: scenario → fixture map
const map = resolveScenario('RAF-RACE', scenarios);
assert.ok(map, 'RAF-RACE-1 FAIL: scenario missing');
assert.equal(map.fixture, 'r58-empty-equivalent-raf-race-01.md', 'RAF-RACE-1 FAIL: fixture');

// RAF-RACE-2: expectedTxnCount = 5
assert.equal(map.expectedTxnCount, 5, 'RAF-RACE-2 FAIL: expectedTxnCount');

function txn(txnId, opts = {}) {
  const evs = [];
  const blocked = !!opts.blocked;
  const blockedReason = opts.preCommit ? 'PRE_COMMIT_VERIFY_FAILED' : (blocked ? 'SOME_BLOCK' : undefined);
  evs.push({
    event: 'EMPTY-SPECIAL-FINAL',
    txnId,
    overall: !blocked,
    blockedReason,
    visualIndentCorrect: true,
    caretLogicalCorrect: true,
    caretVisualCorrect: true,
    unexpectedMerge: false,
    unexpectedDelete: false,
  });
  evs.push({
    event: 'EMPTY-SPECIAL-TRANSACTION-CLOSE',
    txnId,
    finalState: blocked ? 'BLOCKED' : 'COMMITTED',
    terminal: true,
    overall: !blocked,
  });
  if (opts.zeroText) {
    evs.push({
      event: 'EMPTY-BLOCK-DOM-SNAPSHOT',
      txnId,
      phase: 'AFTER_RAF',
      childNodeCount: 1,
      childNodeSummaries: ['text:'],
    });
    evs.push({
      event: 'EMPTY-SPECIAL-EMPTY-VISUAL-PROJECTION',
      txnId,
      emptyEquivalent: !opts.misclassified,
      projectionMode: opts.misclassified ? 'TEXT_INDENT' : 'EMPTY_PADDING',
    });
  }
  return evs;
}

function raf(txns, extra = []) {
  const events = [];
  for (const t of txns) events.push(...t);
  events.push(...extra);
  return evaluateRafRace(events, { expectedTxnCount: 5 });
}

// RAF-RACE-3: 5 committed → PASS
{
  const r = raf(['t1', 't2', 't3', 't4', 't5'].map((id) => txn(id)));
  assert.equal(r.verdict, 'PASS', 'RAF-RACE-3 FAIL: 5 committed, got ' + JSON.stringify(r.failedChecks));
  assert.equal(r.txnCount, 5, 'RAF-RACE-3 FAIL: txnCount');
  assert.equal(r.distinctTxnCount, 5, 'RAF-RACE-3 FAIL: distinctTxnCount');
}

// RAF-RACE-4: fewer than 5 must not PASS
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)));
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-4 FAIL: 4 txn should FAIL');
}

// RAF-RACE-5: BLOCKED → FAIL
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)).concat([txn('t5', { blocked: true })]));
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-5 FAIL: blocked should FAIL');
  assert.equal(r.blockedCount, 1, 'RAF-RACE-5 FAIL: blockedCount');
}

// RAF-RACE-6: PRE_COMMIT_VERIFY_FAILED → FAIL
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)).concat([txn('t5', { blocked: true, preCommit: true })]));
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-6 FAIL: pre-commit should FAIL');
  assert.equal(r.preCommitVerifyFailedCount, 1, 'RAF-RACE-6 FAIL: preCommitVerifyFailedCount');
}

// RAF-RACE-7: zero-text misclassified (emptyEquivalent=false) → FAIL
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)).concat([txn('t5', { zeroText: true, misclassified: true })]));
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-7 FAIL: zero-text misclassified');
  assert.ok(r.failedChecks.includes('zeroTextMisclassified'), 'RAF-RACE-7 FAIL: zeroTextMisclassified');
}

// RAF-RACE-8: TEXT_INDENT (misclassified projection) → FAIL
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)).concat([txn('t5', { zeroText: true, misclassified: true })]));
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-8 FAIL: TEXT_INDENT should FAIL');
}

// RAF-RACE-9: EMPTY_PADDING correct zero-text → PASS
{
  const r = raf(['t1', 't2', 't3', 't4'].map((id) => txn(id)).concat([txn('t5', { zeroText: true })]));
  assert.equal(r.verdict, 'PASS', 'RAF-RACE-9 FAIL: EMPTY_PADDING zero-text, got ' + JSON.stringify(r.failedChecks));
  assert.equal(r.textEmptyNodeObserved, true, 'RAF-RACE-9 FAIL: textEmptyNodeObserved');
  assert.equal(r.exactRaceReproduction, true, 'RAF-RACE-9 FAIL: exactRaceReproduction');
}

// RAF-RACE-10: no zero-text observed → still stress PASS, exact-race-reproduction=false
{
  const r = raf(['t1', 't2', 't3', 't4', 't5'].map((id) => txn(id)));
  assert.equal(r.verdict, 'PASS', 'RAF-RACE-10 FAIL: no zero-text stress PASS');
  assert.equal(r.textEmptyNodeObserved, false, 'RAF-RACE-10 FAIL: textEmptyNodeObserved');
  assert.equal(r.exactRaceReproduction, false, 'RAF-RACE-10 FAIL: exactRaceReproduction');
}

// RAF-RACE-11: leak (awaiting) → FAIL
{
  const r = raf(
    ['t1', 't2', 't3', 't4', 't5'].map((id) => txn(id)),
    [{ event: 'AWAITING-TRANSFER-LEAK-AUDIT', awaitingCount: 1 }],
  );
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-11 FAIL: awaiting leak');
}

// RAF-RACE-12: selection/caret write → FAIL
{
  const r = raf(
    ['t1', 't2', 't3', 't4', 't5'].map((id) => txn(id)),
    [{ event: 'PLUGIN-SELECTION-WRITE-AUDIT' }],
  );
  assert.equal(r.verdict, 'FAIL', 'RAF-RACE-12 FAIL: selection write');
}

console.log('RAF-RACE-1..12 PASS');

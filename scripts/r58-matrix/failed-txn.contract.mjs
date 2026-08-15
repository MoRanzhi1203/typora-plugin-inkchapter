// failed-txn.contract.mjs — FAILED-TXN-1..10: Failed-Txn controlled-negative
// verdict semantics (harness-only; the RC1 src hook FORCE_VISUAL_VERIFY_FAIL_ONCE
// is the injection mechanism).
import { strict as assert } from 'node:assert';
import { evaluateFailurePath, collectIds } from './trial-verdict.mjs';

const NEG_TXN = 'txn-NEG-1';

const CORRECT = [
  { event: 'EMPTY-SPECIAL-TEST-HOOK', txnId: NEG_TXN, consumed: true, effectiveVisualVerify: false, originalVisualVerify: true },
  { event: 'EMPTY-SPECIAL-ROLLBACK', txnId: NEG_TXN, overall: true },
  { event: 'EMPTY-SPECIAL-TRANSACTION-CLOSE', txnId: NEG_TXN, finalState: 'BLOCKED', terminal: true, overall: true, observerDisconnected: true, timeoutCleared: true, activeTxnCleared: true },
];

const r = evaluateFailurePath({
  events: CORRECT,
  recordCountBefore: 0,
  recordCountAfter: 0,
  sidecarCountBefore: 0,
  sidecarCountAfter: 0,
  awaitingCount: 0,
});

// FAILED-TXN-1: negative marker exists → verdict must NOT be PASS
assert.notEqual(r.verdict, 'PASS', 'FAILED-TXN-1 FAIL: negative verdict should not be PASS');
assert.equal(r.verdict, 'FAIL', 'FAILED-TXN-1 FAIL: expected FAIL');

// FAILED-TXN-2: unique txn locatable
assert.equal(r.txnIds.length, 1, 'FAILED-TXN-2 FAIL: txnIds count');
assert.equal(r.txnIds[0], NEG_TXN, 'FAILED-TXN-2 FAIL: txnId');

// FAILED-TXN-3: deterministic failure reason
assert.equal(r.firstFail, 'CONTROLLED_NEGATIVE_INJECTION', 'FAILED-TXN-3 FAIL: firstFail');

// FAILED-TXN-4: terminal close
assert.equal(r.terminal, true, 'FAILED-TXN-4 FAIL: terminal');

// FAILED-TXN-5: cleanup complete
assert.equal(r.observerDisconnected, true, 'FAILED-TXN-5 FAIL: observerDisconnected');
assert.equal(r.timeoutCleared, true, 'FAILED-TXN-5 FAIL: timeoutCleared');
assert.equal(r.activeTxnCleared, true, 'FAILED-TXN-5 FAIL: activeTxnCleared');

// FAILED-TXN-6: awaitingCount=0
assert.equal(r.awaitingCount, 0, 'FAILED-TXN-6 FAIL: awaitingCount');

// FAILED-TXN-7: no orphan canonical record
assert.equal(r.canonicalCreated, false, 'FAILED-TXN-7 FAIL: canonicalCreated');
assert.equal(r.orphanCanonicalCount, 0, 'FAILED-TXN-7 FAIL: orphanCanonicalCount');

// FAILED-TXN-8: no unexpected sidecar write
assert.equal(r.sidecarLeak, false, 'FAILED-TXN-8 FAIL: sidecarLeak');
assert.equal(r.unexpectedSidecarWrite, false, 'FAILED-TXN-8 FAIL: unexpectedSidecarWrite');

// FAILED-TXN-9: session/build isolation (no E3 positive txn pollution)
assert.ok(!r.txnIds.includes('txn-2-1786775996915'), 'FAILED-TXN-9 FAIL: E3 txn leaked');

// FAILED-TXN-10: negative transaction does not pollute subsequent window
assert.equal(r.txnIds.length, 1, 'FAILED-TXN-10 FAIL: more than one txn in negative window');

// False-pass gate: committed despite injection → verdict PASS + controlledNegativePass=false
const falsePass = evaluateFailurePath({
  events: [
    { event: 'EMPTY-SPECIAL-TEST-HOOK', txnId: NEG_TXN, consumed: true, effectiveVisualVerify: false },
    { event: 'EMPTY-SPECIAL-CANONICAL-COMMIT', txnId: NEG_TXN, success: true },
    { event: 'EMPTY-SPECIAL-TRANSACTION-CLOSE', txnId: NEG_TXN, finalState: 'COMMITTED', terminal: true, overall: true },
  ],
  recordCountBefore: 0, recordCountAfter: 0, sidecarCountBefore: 0, sidecarCountAfter: 0, awaitingCount: 0,
});
assert.equal(falsePass.verdict, 'PASS', 'FAILED-TXN gate: false-pass should be verdict PASS');
assert.equal(falsePass.controlledNegativePass, false, 'FAILED-TXN gate: false-pass controlledNegativePass');
assert.equal(falsePass.firstFail, 'FALSE_PASS', 'FAILED-TXN gate: false-pass firstFail');

console.log('FAILED-TXN-1..10 PASS');

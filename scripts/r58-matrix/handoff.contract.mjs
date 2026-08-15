// handoff.contract.mjs — authority → verdict window handoff + boundary guards.
//
// HANDOFF-1..8  : baseline handoff (authority binding, no 0..0 fallback)
// CONTRACT-H1   : scenario mismatch → INVALID
// CONTRACT-H2   : invalid byte window → INVALID
// CONTRACT-H3   : authority.auditPath strong binding (never latest)
import { strict as assert } from 'node:assert';
import { resolveVerdictWindow } from './trial-verdict.mjs';

const ACCEPT = {
  scenario: 'E1',
  sessionId: 'sess-1786746717602',
  auditPath: 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\.typora\\inkchapter\\audit\\runtime-sess-1786746717602.log',
  auditStartOffset: 5058,
  decision: 'ACCEPT',
};

// ── HANDOFF-1..8 (baseline) ──────────────────────────────────────────────
const d = resolveVerdictWindow(ACCEPT, 'E1', null, null, 78251);
assert.equal(d.ok, true, 'HANDOFF-1 FAIL: not ok');
assert.equal(d.auditStartOffset, 5058, 'HANDOFF-1 FAIL: from != authority.auditStartOffset');
assert.equal(d.auditEndOffset, 78251, 'HANDOFF-2 FAIL: to != statSize');
assert.equal(d.windowSource, 'authority-default', 'HANDOFF-3 FAIL: windowSource');

const e = resolveVerdictWindow(ACCEPT, 'E1', 5058, 53569, 78251);
assert.equal(e.windowSource, 'explicit-cli', 'HANDOFF-4 FAIL: windowSource');
assert.equal(e.auditEndOffset, 53569, 'HANDOFF-4 FAIL: to override');

const m = resolveVerdictWindow(null, 'E1', null, null, 78251);
assert.equal(m.ok, false, 'HANDOFF-5 FAIL: missing authority should not ok');
assert.equal(m.reason, 'AUTHORITY_MISSING_OR_REJECT', 'HANDOFF-5 FAIL: reason');

const r = resolveVerdictWindow({ ...ACCEPT, decision: 'REJECT' }, 'E1', null, null, 78251);
assert.equal(r.ok, false, 'HANDOFF-6 FAIL: reject authority should not ok');

assert.notEqual(d.auditStartOffset, 0, 'HANDOFF-7 FAIL: start fallback 0');
assert.notEqual(d.auditEndOffset, 0, 'HANDOFF-7 FAIL: end fallback 0');

assert.equal(d.authorityDecision, 'ACCEPT', 'HANDOFF-8 FAIL: authorityDecision');
assert.equal(m.authorityDecision, 'MISSING', 'HANDOFF-8 FAIL: missing decision');
assert.equal(r.authorityDecision, 'REJECT', 'HANDOFF-8 FAIL: reject decision');

// ── CONTRACT-H1: scenario mismatch → INVALID ─────────────────────────────
const h1 = resolveVerdictWindow({ ...ACCEPT, scenario: 'E3' }, 'E1', null, null, 78251);
assert.equal(h1.ok, false, 'CONTRACT-H1 FAIL: scenario mismatch should not ok');
assert.equal(h1.reason, 'AUTHORITY_SCENARIO_MISMATCH', 'CONTRACT-H1 FAIL: reason');
assert.equal(h1.auditStartOffset, null, 'CONTRACT-H1 FAIL: must not fallback to 0');

// ── CONTRACT-H2: invalid byte window → INVALID ───────────────────────────
const h2a = resolveVerdictWindow(ACCEPT, 'E1', -5, null, 78251); // from < 0
assert.equal(h2a.ok, false, 'CONTRACT-H2 FAIL: from<0');
assert.equal(h2a.reason, 'INVALID_AUDIT_WINDOW', 'CONTRACT-H2 FAIL: from<0 reason');

const h2b = resolveVerdictWindow(ACCEPT, 'E1', 100, 50, 78251); // from > to
assert.equal(h2b.ok, false, 'CONTRACT-H2 FAIL: from>to');
assert.equal(h2b.reason, 'INVALID_AUDIT_WINDOW', 'CONTRACT-H2 FAIL: from>to reason');

const h2c = resolveVerdictWindow(ACCEPT, 'E1', null, 999999, 78251); // to > fileSize
assert.equal(h2c.ok, false, 'CONTRACT-H2 FAIL: to>fileSize');
assert.equal(h2c.reason, 'INVALID_AUDIT_WINDOW', 'CONTRACT-H2 FAIL: to>fileSize reason');

const h2d = resolveVerdictWindow(ACCEPT, 'E1', NaN, null, 78251); // non-finite from
assert.equal(h2d.ok, false, 'CONTRACT-H2 FAIL: non-finite from');
assert.equal(h2d.reason, 'INVALID_AUDIT_WINDOW', 'CONTRACT-H2 FAIL: non-finite reason');

const h2e = resolveVerdictWindow(ACCEPT, 'E1', null, Infinity, 78251); // non-finite to
assert.equal(h2e.ok, false, 'CONTRACT-H2 FAIL: non-finite to');
assert.equal(h2e.reason, 'INVALID_AUDIT_WINDOW', 'CONTRACT-H2 FAIL: non-finite to reason');

// ── CONTRACT-H3: authority.auditPath strong binding (never latest) ───────
const h3 = resolveVerdictWindow({ ...ACCEPT, auditPath: 'P1', sessionId: 'S1' }, 'E1', null, null, 100);
assert.equal(h3.auditPath, 'P1', 'CONTRACT-H3 FAIL: not bound to P1');
// P2 (newer) must never replace P1 — resolution is pure over authority only.
assert.notEqual(h3.auditPath, 'P2', 'CONTRACT-H3 FAIL: switched to latest');

console.log('HANDOFF-1..8 PASS');
console.log('CONTRACT-H1 (scenario mismatch) PASS');
console.log('CONTRACT-H2 (invalid window) PASS');
console.log('CONTRACT-H3 (bound auditPath) PASS');

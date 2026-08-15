// authority-document-source.contract.mjs — DOC-SOURCE-1..6: current-document
// source resolution (last valid same-session same-build file-open + ready context).
import { strict as assert } from 'node:assert';
import { resolveCurrentDocumentAuthority } from './trial-verdict.mjs';

const E1 = 'D:\\vault\\r58-empty-special-e1-01.md';
const E3 = 'D:\\vault\\r58-empty-special-e3-01.md';
const OTHER = 'D:\\vault\\r58-other.md';

function rec(event, sessionId, buildId, payload) {
  return { event, sessionId, buildId, tsIso: new Date().toISOString(), payload };
}

function isE3(r) {
  return r.ok && String(r.documentKey).toLowerCase().includes('r58-empty-special-e3-01.md');
}

// DOC-SOURCE-1: same session E1 → E3 must resolve to E3 (last event)
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E1 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E1 }),
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E3 }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.ok(isE3(r), 'DOC-SOURCE-1 FAIL: expected E3, got ' + r.documentKey);
}

// DOC-SOURCE-2: plugin-onload E1 must not override later file-open E3
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'plugin-onload', activeDoc: E1 }),
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E3 }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.ok(isE3(r), 'DOC-SOURCE-2 FAIL: expected E3, got ' + r.documentKey);
}

// DOC-SOURCE-3: latest identity + context both E3 → ok=true
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E3 }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.equal(r.ok, true, 'DOC-SOURCE-3 FAIL: ok');
  assert.equal(r.runtimeDocument, E3, 'DOC-SOURCE-3 FAIL: runtimeDocument');
  assert.equal(r.contextDocument, E3, 'DOC-SOURCE-3 FAIL: contextDocument');
}

// DOC-SOURCE-4: identity/context divergence → DOCUMENT_AUTHORITY_DIVERGENCE
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E1 }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.equal(r.ok, false, 'DOC-SOURCE-4 FAIL: ok');
  assert.equal(r.reason, 'DOCUMENT_AUTHORITY_DIVERGENCE', 'DOC-SOURCE-4 FAIL: reason');
  assert.equal(r.documentKey, null, 'DOC-SOURCE-4 FAIL: documentKey');
}

// DOC-SOURCE-5: other session later events must not pollute current session
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E3 }),
    rec('RUNTIME-IDENTITY-FINAL', 'sess-2', 'rc1', { reason: 'file-open', activeDoc: OTHER }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-2', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: OTHER }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.ok(isE3(r), 'DOC-SOURCE-5 FAIL: session pollution, got ' + r.documentKey);
}

// DOC-SOURCE-6: other build later events must not pollute current build
{
  const r = resolveCurrentDocumentAuthority([
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'rc1', { reason: 'file-open', activeDoc: E3 }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'rc1', { businessReady: true, persistenceReady: true, activeFilePath: E3 }),
    rec('RUNTIME-IDENTITY-FINAL', 'sess-1', 'other-build', { reason: 'file-open', activeDoc: OTHER }),
    rec('DOCUMENT-CONTEXT-STATE', 'sess-1', 'other-build', { businessReady: true, persistenceReady: true, activeFilePath: OTHER }),
  ], { sessionId: 'sess-1', buildId: 'rc1' });
  assert.ok(isE3(r), 'DOC-SOURCE-6 FAIL: build pollution, got ' + r.documentKey);
}

console.log('DOC-SOURCE-1 Same Session E1→E3 Last Event PASS');
console.log('DOC-SOURCE-2 Plugin-Onload Cannot Override Later File-Open PASS');
console.log('DOC-SOURCE-3 Latest Identity + Context E3 PASS');
console.log('DOC-SOURCE-4 Identity/Context Divergence PASS');
console.log('DOC-SOURCE-5 Session Isolation PASS');
console.log('DOC-SOURCE-6 Build Isolation PASS');

// authority-document.contract.mjs — AUTH-DOC-1..5: authority document-identity
// validation (scenario fixture must EXACTLY match current Runtime documentKey).
import { strict as assert } from 'node:assert';
import { evaluateAuthorityDocumentIdentity } from './trial-verdict.mjs';

const E3_FIXTURE = 'r58-empty-special-e3-01.md';

// Simulate the full gate decision (buildOk && shaOk && styleOk && initOk && documentOk).
function decide(buildOk, shaOk, styleOk, initOk, doc) {
  const failedChecks = [];
  if (!buildOk) failedChecks.push('BUILD_MISMATCH');
  if (!shaOk) failedChecks.push('MAIN_SHA_MISMATCH');
  if (!styleOk) failedChecks.push('STYLE_SHA_MISMATCH');
  if (!initOk) failedChecks.push('INITIALIZATION_COUNT_MISMATCH');
  if (!doc.documentOk) failedChecks.push('DOCUMENT_MISMATCH');
  const decision = (buildOk && shaOk && styleOk && initOk && doc.documentOk) ? 'ACCEPT' : 'REJECT';
  return { decision, failedChecks };
}

// AUTH-DOC-1: correct document → ACCEPT
{
  const doc = evaluateAuthorityDocumentIdentity(E3_FIXTURE, 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\r58-empty-special-e3-01.md');
  assert.equal(doc.documentOk, true, 'AUTH-DOC-1 FAIL: documentOk');
  assert.equal(doc.actualDocument, E3_FIXTURE, 'AUTH-DOC-1 FAIL: actualDocument');
  const d = decide(true, true, true, true, doc);
  assert.equal(d.decision, 'ACCEPT', 'AUTH-DOC-1 FAIL: decision');
  assert.deepEqual(d.failedChecks, [], 'AUTH-DOC-1 FAIL: failedChecks');
}

// AUTH-DOC-2: E3 requested but current document is E1 → REJECT + DOCUMENT_MISMATCH
{
  const doc = evaluateAuthorityDocumentIdentity(E3_FIXTURE, 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\r58-empty-special-e1-01.md');
  assert.equal(doc.documentOk, false, 'AUTH-DOC-2 FAIL: documentOk');
  assert.equal(doc.actualDocument, 'r58-empty-special-e1-01.md', 'AUTH-DOC-2 FAIL: actualDocument');
  const d = decide(true, true, true, true, doc);
  assert.equal(d.decision, 'REJECT', 'AUTH-DOC-2 FAIL: decision');
  assert.ok(d.failedChecks.includes('DOCUMENT_MISMATCH'), 'AUTH-DOC-2 FAIL: DOCUMENT_MISMATCH');
}

// AUTH-DOC-3: empty documentKey → REJECT (not ACCEPT despite correct SHA/build)
{
  const docNull = evaluateAuthorityDocumentIdentity(E3_FIXTURE, null);
  assert.equal(docNull.documentOk, false, 'AUTH-DOC-3 FAIL: null documentOk');
  const d1 = decide(true, true, true, true, docNull);
  assert.equal(d1.decision, 'REJECT', 'AUTH-DOC-3 FAIL: null decision');

  const docEmpty = evaluateAuthorityDocumentIdentity(E3_FIXTURE, '');
  assert.equal(docEmpty.documentOk, false, 'AUTH-DOC-3 FAIL: empty documentOk');
  const d2 = decide(true, true, true, true, docEmpty);
  assert.equal(d2.decision, 'REJECT', 'AUTH-DOC-3 FAIL: empty decision');
}

// AUTH-DOC-4: Windows path normalization (case-insensitive + separator)
{
  const docUpper = evaluateAuthorityDocumentIdentity(E3_FIXTURE, 'd:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\R58-EMPTY-SPECIAL-E3-01.MD');
  assert.equal(docUpper.documentOk, true, 'AUTH-DOC-4 FAIL: case difference');

  const docFwd = evaluateAuthorityDocumentIdentity(E3_FIXTURE, 'D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/r58-empty-special-e3-01.md');
  assert.equal(docFwd.documentOk, true, 'AUTH-DOC-4 FAIL: separator difference');
}

// AUTH-DOC-5: basename exact match (contains weak match must fail)
{
  const doc = evaluateAuthorityDocumentIdentity(E3_FIXTURE, 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\backup-r58-empty-special-e3-01.md');
  assert.equal(doc.documentOk, false, 'AUTH-DOC-5 FAIL: contains weak match should fail');
}

console.log('AUTH-DOC-1 Correct Document PASS');
console.log('AUTH-DOC-2 Wrong Scenario Document PASS');
console.log('AUTH-DOC-3 Empty DocumentKey PASS');
console.log('AUTH-DOC-4 Windows Path Normalization PASS');
console.log('AUTH-DOC-5 Basename Exact Match PASS');

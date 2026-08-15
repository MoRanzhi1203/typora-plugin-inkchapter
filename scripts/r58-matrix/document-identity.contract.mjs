// document-identity.contract.mjs — AUTHDOC-1..8 for document identity normalization.
import { strict as assert } from 'node:assert'
import { normalizeDocumentIdentity } from './document-identity.mjs'
import { evaluatePhaseBAuthority } from './phase-b-authority.mjs'

const VAULT = 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault'
const DOC = 'r58-empty-special-e2-01.md'
const ABS = 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\r58-empty-special-e2-01.md'

const FORMAL = {
  auditSessionId: 'sess-f',
  runtimeBuildId: 'build-evc1',
  runtimeMainSHA: 'MAIN',
  styleSHA: 'STYLE',
  targetVault: VAULT,
  targetDocument: DOC,
  auditPath: 'audit\\runtime-sess-f.log',
  verdict: 'PASS',
  failedChecks: [],
}

function current(overrides = {}) {
  const base = {
    sessionId: 'sess-f',
    auditSessionId: 'sess-f',
    buildId: 'build-evc1',
    mainSha: 'MAIN',
    styleSha: 'STYLE',
    vault: VAULT,
    document: DOC,
    initializationCount: 1,
  }
  const merged = { ...base, ...overrides }
  if (overrides.sessionId !== undefined && overrides.auditSessionId === undefined) merged.auditSessionId = overrides.sessionId
  return merged
}

// AUTHDOC-1: basename vs absolute → same key, PASS
{
  const a = normalizeDocumentIdentity({ rawDocument: DOC, vaultRoot: VAULT })
  const b = normalizeDocumentIdentity({ rawDocument: ABS, vaultRoot: VAULT })
  assert.equal(a.comparisonKey, b.comparisonKey, 'AUTHDOC-1 FAIL')
  assert.equal(a.comparisonKey, 'r58-empty-special-e2-01.md', 'AUTHDOC-1 FAIL')
  assert.ok(a.insideVault && b.insideVault, 'AUTHDOC-1 FAIL')
}

// AUTHDOC-2: vault-relative vs absolute → same key
{
  const a = normalizeDocumentIdentity({ rawDocument: DOC, vaultRoot: VAULT })
  const b = normalizeDocumentIdentity({ rawDocument: 'D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/r58-empty-special-e2-01.md', vaultRoot: VAULT })
  assert.equal(a.comparisonKey, b.comparisonKey, 'AUTHDOC-2 FAIL')
}

// AUTHDOC-3: backslash vs forward slash → same key
{
  const a = normalizeDocumentIdentity({ rawDocument: 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault\\r58-empty-special-e2-01.md', vaultRoot: VAULT })
  const b = normalizeDocumentIdentity({ rawDocument: 'D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/r58-empty-special-e2-01.md', vaultRoot: VAULT })
  assert.equal(a.comparisonKey, b.comparisonKey, 'AUTHDOC-3 FAIL')
}

// AUTHDOC-4: Windows path case difference → same key
{
  const a = normalizeDocumentIdentity({ rawDocument: 'R58-EMPTY-SPECIAL-E2-01.MD', vaultRoot: VAULT })
  const b = normalizeDocumentIdentity({ rawDocument: DOC, vaultRoot: VAULT })
  assert.equal(a.comparisonKey, b.comparisonKey, 'AUTHDOC-4 FAIL')
}

// AUTHDOC-5: different filename → DOCUMENT_MISMATCH
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: 'other.md' }))
  assert.equal(r.overall, false, 'AUTHDOC-5 FAIL')
  assert.ok(r.failedChecks.includes('DOCUMENT_MISMATCH'), 'AUTHDOC-5 FAIL')
}

// AUTHDOC-6: same basename but outside vault → DOCUMENT_OUTSIDE_VAULT
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: 'D:\\OtherVault\\r58-empty-special-e2-01.md' }))
  assert.ok(r.failedChecks.includes('DOCUMENT_OUTSIDE_VAULT'), 'AUTHDOC-6 FAIL')
}

// AUTHDOC-7: ../ escape → DOCUMENT_OUTSIDE_VAULT
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: '..\\outside\\r58-empty-special-e2-01.md' }))
  assert.ok(r.failedChecks.includes('DOCUMENT_OUTSIDE_VAULT'), 'AUTHDOC-7 FAIL')
}

// AUTHDOC-8: missing document → DOCUMENT_IDENTITY_INVALID
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: '' }))
  assert.ok(r.failedChecks.includes('DOCUMENT_IDENTITY_INVALID'), 'AUTHDOC-8 FAIL')
}

// The SAME file (basename vs absolute) must now PASS authority.
{
  const r = evaluatePhaseBAuthority(FORMAL, current({ document: ABS }))
  assert.equal(r.overall, true, 'authority should PASS for same file (different representation)')
  assert.equal(r.documentMatch, true)
  assert.equal(r.formalDocumentKey, 'r58-empty-special-e2-01.md')
  assert.equal(r.currentDocumentKey, 'r58-empty-special-e2-01.md')
}

console.log('AUTHDOC-1..8 PASS')

// phase-b-authority.mjs — pure Phase B hard authority comparison (PHASEBGATE-1..10
// + document normalization). Read-only; no Typora launch, no PowerShell, no mutation.

import { normalizeDocumentIdentity } from './document-identity.mjs'

export const PHASE_B_FAILED_CHECKS = [
  'SESSION_MISMATCH',
  'DOCUMENT_MISMATCH',
  'DOCUMENT_OUTSIDE_VAULT',
  'DOCUMENT_IDENTITY_INVALID',
  'BUILD_MISMATCH',
  'MAIN_SHA_MISMATCH',
  'STYLE_SHA_MISMATCH',
  'VAULT_MISMATCH',
  'INITIALIZATION_COUNT_MISMATCH',
  'AUDIT_SESSION_MISMATCH',
]

/** Normalize the formal strict-startup.json artifact into comparable fields. */
export function normalizeFormalAuthority(strictStartup) {
  if (!strictStartup || typeof strictStartup !== 'object') return null
  return {
    sessionId: strictStartup.auditSessionId ?? strictStartup.formalSessionId ?? null,
    buildId: strictStartup.runtimeBuildId ?? strictStartup.buildId ?? null,
    mainSha: strictStartup.runtimeMainSHA ?? null,
    styleSha: strictStartup.styleSHA ?? null,
    vault: strictStartup.targetVault ?? null,
    document: strictStartup.targetDocument ?? null,
    auditPath: strictStartup.auditPath ?? null,
    verdict: strictStartup.verdict ?? null,
    failedChecks: Array.isArray(strictStartup.failedChecks) ? strictStartup.failedChecks : null,
  }
}

/**
 * Compare the formal Strict Startup authority against the CURRENT runtime
 * authority. Document comparison uses a normalized vault-relative key, so a
 * basename / vault-relative / absolute representation of the SAME file matches.
 */
export function evaluatePhaseBAuthority(formal, current) {
  const f = normalizeFormalAuthority(formal)
  if (!f || f.verdict !== 'PASS' || (f.failedChecks && f.failedChecks.length > 0)) {
    return { overall: false, failedChecks: ['PHASE_B_AUTHORITY_NOT_FORMAL'], documentMatch: false }
  }

  const c = current ?? {}
  const vault = f.vault ?? c.vault ?? null
  const failedChecks = []

  if (c.sessionId !== f.sessionId) failedChecks.push('SESSION_MISMATCH')
  if (c.buildId !== f.buildId) failedChecks.push('BUILD_MISMATCH')
  if (c.mainSha !== f.mainSha) failedChecks.push('MAIN_SHA_MISMATCH')
  if (c.styleSha !== f.styleSha) failedChecks.push('STYLE_SHA_MISMATCH')
  if (c.vault !== f.vault) failedChecks.push('VAULT_MISMATCH')
  if (c.initializationCount !== 1) failedChecks.push('INITIALIZATION_COUNT_MISMATCH')
  if (c.auditSessionId != null && c.auditSessionId !== c.sessionId) failedChecks.push('AUDIT_SESSION_MISMATCH')

  const formalDoc = normalizeDocumentIdentity({ rawDocument: f.document, vaultRoot: vault })
  const currentDoc = normalizeDocumentIdentity({ rawDocument: c.document, vaultRoot: vault })

  let documentMatch = false
  if (!formalDoc.valid) {
    failedChecks.push(formalDoc.reason || 'DOCUMENT_IDENTITY_INVALID')
  } else if (!currentDoc.valid) {
    failedChecks.push(currentDoc.reason || 'DOCUMENT_IDENTITY_INVALID')
  } else {
    documentMatch = formalDoc.comparisonKey === currentDoc.comparisonKey
    if (!documentMatch) failedChecks.push('DOCUMENT_MISMATCH')
  }

  return {
    overall: failedChecks.length === 0,
    failedChecks,
    documentMatch,
    formalDocumentRaw: f.document,
    currentDocumentRaw: c.document ?? null,
    formalDocumentAbsolute: formalDoc.absolutePath,
    currentDocumentAbsolute: currentDoc.absolutePath,
    formalDocumentKey: formalDoc.comparisonKey,
    currentDocumentKey: currentDoc.comparisonKey,
    formalDocumentInsideVault: formalDoc.insideVault,
    currentDocumentInsideVault: currentDoc.insideVault,
  }
}

// phase-b-authority.mjs — pure Phase B hard authority comparison (PHASEBGATE-1..10).
// Read-only; no Typora launch, no PowerShell, no file mutation.

export const PHASE_B_FAILED_CHECKS = [
  'SESSION_MISMATCH',
  'DOCUMENT_MISMATCH',
  'BUILD_MISMATCH',
  'MAIN_SHA_MISMATCH',
  'STYLE_SHA_MISMATCH',
  'VAULT_MISMATCH',
  'INITIALIZATION_COUNT_MISMATCH',
  'AUDIT_SESSION_MISMATCH',
];

/** Normalize the formal strict-startup.json artifact into comparable fields. */
export function normalizeFormalAuthority(strictStartup) {
  if (!strictStartup || typeof strictStartup !== 'object') return null;
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
  };
}

/**
 * Compare the formal Strict Startup authority against the CURRENT runtime
 * authority. Returns `{ overall, failedChecks }`; any mismatch is a hard STOP.
 */
export function evaluatePhaseBAuthority(formal, current) {
  const f = normalizeFormalAuthority(formal);
  if (!f || f.verdict !== 'PASS' || (f.failedChecks && f.failedChecks.length > 0)) {
    return { overall: false, failedChecks: ['PHASE_B_AUTHORITY_NOT_FORMAL'] };
  }

  const c = current ?? {};
  const failedChecks = [];
  if (c.sessionId !== f.sessionId) failedChecks.push('SESSION_MISMATCH');
  if (c.buildId !== f.buildId) failedChecks.push('BUILD_MISMATCH');
  if (c.mainSha !== f.mainSha) failedChecks.push('MAIN_SHA_MISMATCH');
  if (c.styleSha !== f.styleSha) failedChecks.push('STYLE_SHA_MISMATCH');
  if (c.document !== f.document) failedChecks.push('DOCUMENT_MISMATCH');
  if (c.vault !== f.vault) failedChecks.push('VAULT_MISMATCH');
  if (c.initializationCount !== 1) failedChecks.push('INITIALIZATION_COUNT_MISMATCH');
  if (c.auditSessionId != null && c.auditSessionId !== c.sessionId) failedChecks.push('AUDIT_SESSION_MISMATCH');

  return { overall: failedChecks.length === 0, failedChecks };
}

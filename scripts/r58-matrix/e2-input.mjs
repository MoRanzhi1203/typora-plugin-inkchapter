// e2-input.mjs — Pure E2 input gate / token provenance / trial artifact authority.
// No fs / no Win32 / no Typora side effects. Shared by the CLI harness and
// contract tests (INPUT-1..10).

export const INVALID_REASONS = {
  FOREGROUND_ACQUIRE_FAILED: 'FOREGROUND_ACQUIRE_FAILED',
  FOREGROUND_WINDOW_MISMATCH: 'FOREGROUND_WINDOW_MISMATCH',
  FOREGROUND_LOST_BEFORE_INPUT: 'FOREGROUND_LOST_BEFORE_INPUT',
  FOREGROUND_LOST_DURING_INPUT: 'FOREGROUND_LOST_DURING_INPUT',
  SENDINPUT_PARTIAL_OR_FAILED: 'SENDINPUT_PARTIAL_OR_FAILED',
  EDITOR_INPUT_NOT_FOCUSED: 'EDITOR_INPUT_NOT_FOCUSED',
  RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED: 'RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED',
  RUNTIME_BEFOREINPUT_NOT_OBSERVED: 'RUNTIME_BEFOREINPUT_NOT_OBSERVED',
  RUNTIME_INPUT_NOT_OBSERVED: 'RUNTIME_INPUT_NOT_OBSERVED',
  IME_SEQUENCE_INCOMPLETE: 'IME_SEQUENCE_INCOMPLETE',
  SPECIAL_TOKEN_TEXT_MISMATCH: 'SPECIAL_TOKEN_TEXT_MISMATCH',
  SPECIAL_TOKEN_OFFSET_MISMATCH: 'SPECIAL_TOKEN_OFFSET_MISMATCH',
  TOKEN_PROOF_TIMEOUT: 'TOKEN_PROOF_TIMEOUT',
  INPUT_INJECTION_AUDIT_NOT_AVAILABLE: 'INPUT_INJECTION_AUDIT_NOT_AVAILABLE',
  CURRENT_TRIAL_DELTA_NOT_AVAILABLE: 'CURRENT_TRIAL_DELTA_NOT_AVAILABLE',
  TRIAL_DELTA_STALE_BUILD: 'TRIAL_DELTA_STALE_BUILD',
  TRIAL_DELTA_STALE_SESSION: 'TRIAL_DELTA_STALE_SESSION',
  TRIAL_DELTA_SESSION_CONTAMINATION: 'TRIAL_DELTA_SESSION_CONTAMINATION',
};

/**
 * Pure foreground input-safety gate.
 * Hard invariant: foreground != targetHwnd → SendInput never happens.
 * The caller (injectKeys) must already set injectionAttempted=false and
 * requestedInputCount=0 when any pre-input foreground check fails.
 */
export function evaluateInjectionGate(audit) {
  if (!audit) return { verdict: 'INVALID', invalidReason: INVALID_REASONS.SENDINPUT_PARTIAL_OR_FAILED };
  if (audit.acquireAttempted === false || audit.acquireSucceeded === false) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.FOREGROUND_ACQUIRE_FAILED };
  }
  if (audit.foregroundMatchAfterAcquire !== true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.FOREGROUND_WINDOW_MISMATCH };
  }
  if (audit.foregroundMatchBeforeInput !== true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.FOREGROUND_LOST_BEFORE_INPUT };
  }
  if (audit.injectionAttempted !== true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.FOREGROUND_LOST_BEFORE_INPUT };
  }
  if (audit.sendInputReturnCount !== audit.requestedInputCount) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.SENDINPUT_PARTIAL_OR_FAILED };
  }
  if (audit.foregroundMatchAfterInput !== true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.FOREGROUND_LOST_DURING_INPUT };
  }
  return { verdict: 'PASS', invalidReason: null };
}

/**
 * Pure token provenance evaluation.
 * tokenData is derived from the current-session trial delta events by the caller.
 */
export function evaluateTokenProof(tokenData) {
  const t = tokenData || {};
  const keyboardCount = Array.isArray(t.keyboardEvents) ? t.keyboardEvents.length : 0;
  const beforeInputCompCount = t.beforeInputCompCount || 0;
  const inputCount = t.inputCount || 0;
  const compStartCount = t.compositionStartCount || 0;
  const compEndCount = t.compositionEndCount || 0;
  const visibleText = t.visibleText;
  const logicalOffset = t.logicalOffset;
  const compositionSessionId = t.compositionSessionId;

  const result = {
    verdict: 'INVALID',
    invalidReason: null,
    tokenText: visibleText ?? null,
    logicalOffset: logicalOffset ?? null,
    imeProvenance: false,
    keyboardEventCount: keyboardCount,
    beforeInputCount: beforeInputCompCount,
    inputCount,
    compositionStartCount: compStartCount,
    compositionEndCount: compEndCount,
    compositionSessionId: compositionSessionId ?? null,
    physicalPeriodConfirmed: false,
  };

  if (keyboardCount === 0) {
    result.invalidReason = INVALID_REASONS.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED;
    return result;
  }
  if (beforeInputCompCount === 0) {
    result.invalidReason = INVALID_REASONS.RUNTIME_BEFOREINPUT_NOT_OBSERVED;
    return result;
  }
  if (inputCount === 0) {
    result.invalidReason = INVALID_REASONS.RUNTIME_INPUT_NOT_OBSERVED;
    return result;
  }
  if (compStartCount === 0 || compEndCount === 0) {
    result.invalidReason = INVALID_REASONS.IME_SEQUENCE_INCOMPLETE;
    return result;
  }
  if (visibleText !== '。。') {
    result.invalidReason = INVALID_REASONS.SPECIAL_TOKEN_TEXT_MISMATCH;
    return result;
  }
  if (logicalOffset !== 2) {
    result.invalidReason = INVALID_REASONS.SPECIAL_TOKEN_OFFSET_MISMATCH;
    return result;
  }

  result.verdict = 'PASS';
  result.invalidReason = null;
  result.imeProvenance = true;
  return result;
}

/**
 * True when an artifact belongs to a different build or session than expected.
 * Stale artifacts must be DROP_STALE and must not participate in the verdict.
 */
export function isStaleArtifact(artifact, expected) {
  if (!artifact || typeof artifact !== 'object') return true;
  if (expected.buildId != null && artifact.buildId !== expected.buildId) return true;
  if (expected.runtimeSessionId != null && artifact.runtimeSessionId !== expected.runtimeSessionId) return true;
  return false;
}

/**
 * Single final token verdict authority. Requires the durable input-injection
 * audit and the durable current-trial delta meta before evaluating the token
 * observation. All three artifacts (summary / token-provenance / delta-meta)
 * must reference the SAME returned invalidReason.
 */
export function evaluateTokenProofFinal(inputAudit, deltaMeta, tokenProof) {
  const empty = {
    overall: false,
    invalidReason: null,
    tokenText: null,
    logicalOffset: null,
    imeProvenance: false,
    keyboardEventCount: 0,
    beforeInputCount: 0,
    inputCount: 0,
    compositionStartCount: 0,
    compositionEndCount: 0,
  };
  if (!inputAudit || inputAudit.available !== true) {
    return { ...empty, invalidReason: INVALID_REASONS.INPUT_INJECTION_AUDIT_NOT_AVAILABLE };
  }
  if (!deltaMeta || deltaMeta.available !== true) {
    return { ...empty, invalidReason: INVALID_REASONS.CURRENT_TRIAL_DELTA_NOT_AVAILABLE };
  }
  const r = tokenProof || empty;
  return {
    overall: r.verdict === 'PASS',
    invalidReason: r.verdict === 'PASS' ? null : r.invalidReason,
    tokenText: r.tokenText ?? null,
    logicalOffset: r.logicalOffset ?? null,
    imeProvenance: !!r.imeProvenance,
    keyboardEventCount: r.keyboardEventCount ?? 0,
    beforeInputCount: r.beforeInputCount ?? 0,
    inputCount: r.inputCount ?? 0,
    compositionStartCount: r.compositionStartCount ?? 0,
    compositionEndCount: r.compositionEndCount ?? 0,
  };
}

/**
 * Pure trial delta authority.
 * delta = { available, buildId, runtimeSessionId, contaminated }.
 */
export function evaluateTrialDeltaAuthority(delta, expected) {
  if (!delta || delta.available !== true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.CURRENT_TRIAL_DELTA_NOT_AVAILABLE, dropStale: false };
  }
  if (delta.contaminated === true) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.TRIAL_DELTA_SESSION_CONTAMINATION, dropStale: true };
  }
  if (delta.buildId !== expected.buildId) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.TRIAL_DELTA_STALE_BUILD, dropStale: true };
  }
  if (delta.runtimeSessionId !== expected.runtimeSessionId) {
    return { verdict: 'INVALID', invalidReason: INVALID_REASONS.TRIAL_DELTA_STALE_SESSION, dropStale: true };
  }
  return { verdict: 'PASS', invalidReason: null, dropStale: false };
}

/** Build the trial artifact binding metadata (buildId/runtimeSessionId/auditPath/trialId/trialStartedAt/generatedAt). */
export function buildTrialBinding(meta) {
  return {
    buildId: meta.buildId,
    runtimeSessionId: meta.runtimeSessionId,
    auditPath: meta.auditPath,
    trialId: meta.trialId,
    trialStartedAt: meta.trialStartedAt,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
  };
}

/**
 * Canonical trial-delta-meta record. ALWAYS produces `deltaExists:true` even
 * when eventCount=0, so a zero-event current trial still has a legal,
 * authoritative delta artifact (no fallback to historical files).
 */
export function buildDeltaMetaRecord(input) {
  return {
    deltaExists: true,
    available: true,
    byteOffsetStart: input.byteOffsetStart ?? 0,
    byteOffsetEnd: input.byteOffsetEnd ?? 0,
    deltaBytes: input.deltaBytes ?? 0,
    deltaLineCount: input.deltaLineCount ?? 0,
    eventCount: input.eventCount ?? 0,
    keyboardEventCount: input.keyboardEventCount ?? 0,
    beforeInputCount: input.beforeInputCount ?? 0,
    inputCount: input.inputCount ?? 0,
    compositionStartCount: input.compositionStartCount ?? 0,
    compositionEndCount: input.compositionEndCount ?? 0,
    staleEventDropCount: input.staleEventDropCount ?? 0,
    parseFailureCount: input.parseFailureCount ?? 0,
    authorityValid: input.authorityValid ?? true,
    overall: input.overall ?? false,
    invalidReason: input.invalidReason ?? null,
  };
}

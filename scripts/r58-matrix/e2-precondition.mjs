// e2-precondition.mjs — Pure E2 runtime precondition accumulation + evaluation.
// No fs / no Win32 / no Typora side effects. Shared by the CLI harness and
// contract tests so trial-precondition.json and trial-summary.json always
// derive their invalidReason from the SAME evaluateE2Precondition() result.

export const PRECOND_INVALID_REASONS = {
  DOCUMENT_CONTEXT_READY_NOT_OBSERVED: 'DOCUMENT_CONTEXT_READY_NOT_OBSERVED',
  DOCUMENT_CONTEXT_SCOPE_MISMATCH: 'DOCUMENT_CONTEXT_SCOPE_MISMATCH',
  SIDECAR_ACTUAL_LOAD_NOT_OBSERVED: 'SIDECAR_ACTUAL_LOAD_NOT_OBSERVED',
  SIDECAR_DOCUMENT_KEY_MISMATCH: 'SIDECAR_DOCUMENT_KEY_MISMATCH',
  SIDECAR_EXISTS_UNEXPECTEDLY: 'SIDECAR_EXISTS_UNEXPECTEDLY',
  SIDECAR_RECORD_COUNT_NONZERO: 'SIDECAR_RECORD_COUNT_NONZERO',
  SIDECAR_SOURCE_NOT_PHYSICAL: 'SIDECAR_SOURCE_NOT_PHYSICAL',
  AUDIT_SESSION_AUTHORITY_MISMATCH: 'AUDIT_SESSION_AUTHORITY_MISMATCH',
  AUDIT_PRECONDITION_TIMEOUT: 'AUDIT_PRECONDITION_TIMEOUT',
  AUDIT_JSONL_PARSE_FAILURE: 'AUDIT_JSONL_PARSE_FAILURE',
};

function getField(ev, name) {
  if (ev == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(ev, name)) return ev[name];
  if (ev.payload && typeof ev.payload === 'object' && Object.prototype.hasOwnProperty.call(ev.payload, name)) return ev.payload[name];
  return undefined;
}

/** Fresh observation accumulator for one precondition wait/poll loop. */
export function emptyObservation() {
  return {
    documentContextReadyEvents: [],
    sidecarLoadEvents: [],
    staleEventDropCount: 0,
    jsonlParseFailureCount: 0,
    timedOut: false,
    auditFileReadable: true,
  };
}

/**
 * Accumulate raw JSONL events into the observation, scoping to the current
 * accepted audit authority (sessionId + buildId). Stale-session / stale-build
 * events are dropped and counted via staleEventDropCount.
 */
export function accumulatePreconditionEvents(obs, events, authority) {
  const sessionId = authority && authority.runtimeSessionId;
  const buildId = authority && authority.buildId;
  for (const ev of events || []) {
    if (!ev || typeof ev !== 'object' || typeof ev.event !== 'string') continue;
    const isPreconditionEvent = ev.event === 'DOCUMENT-CONTEXT-READY' || ev.event === 'SIDECAR-ACTUAL-LOAD';
    if (isPreconditionEvent) {
      const evSession = getField(ev, 'sessionId');
      const evBuild = getField(ev, 'buildId');
      if (sessionId && evSession != null && evSession !== sessionId) { obs.staleEventDropCount++; continue; }
      if (buildId && evBuild != null && evBuild !== buildId) { obs.staleEventDropCount++; continue; }
    }
    if (ev.event === 'DOCUMENT-CONTEXT-READY') obs.documentContextReadyEvents.push(ev);
    else if (ev.event === 'SIDECAR-ACTUAL-LOAD') obs.sidecarLoadEvents.push(ev);
  }
  return obs;
}

/**
 * Pure evaluation of the accumulated observation against the expected
 * document/scope authority. Returns the single precondition verdict that both
 * trial-precondition.json and trial-summary.invalidReason must reference.
 */
export function evaluateE2Precondition(obs, expected) {
  const readyEvents = (obs && obs.documentContextReadyEvents) || [];
  const sidecarEvents = (obs && obs.sidecarLoadEvents) || [];
  const staleEventDropCount = (obs && obs.staleEventDropCount) || 0;
  const jsonlParseFailureCount = (obs && obs.jsonlParseFailureCount) || 0;

  const result = {
    overall: false,
    invalidReason: null,
    documentContextReadyObserved: readyEvents.length > 0,
    documentContextReadyCount: readyEvents.length,
    documentContextMode: null,
    documentContextScopeId: null,
    documentContextDecision: null,
    documentContextBusinessReady: null,
    documentContextPersistenceReady: null,
    sidecarLoadObserved: sidecarEvents.length > 0,
    sidecarLoadCount: sidecarEvents.length,
    sidecarDocumentKey: null,
    sidecarExists: null,
    sidecarRecordCount: null,
    sidecarSource: null,
    sidecarBackend: null,
    staleEventDropCount,
    jsonlParseFailureCount,
  };

  // Audit file never became readable within the bounded window.
  if (obs && obs.auditFileReadable === false) {
    result.invalidReason = PRECOND_INVALID_REASONS.AUDIT_PRECONDITION_TIMEOUT;
    return result;
  }

  // Malformed JSONL — cannot trust the evidence window.
  if (jsonlParseFailureCount > 0) {
    result.invalidReason = PRECOND_INVALID_REASONS.AUDIT_JSONL_PARSE_FAILURE;
    return result;
  }

  // Context READY gate.
  if (readyEvents.length === 0) {
    result.invalidReason = PRECOND_INVALID_REASONS.DOCUMENT_CONTEXT_READY_NOT_OBSERVED;
    return result;
  }
  const ready = readyEvents[readyEvents.length - 1];
  const readyScopeId = getField(ready, 'scopeId');
  result.documentContextMode = getField(ready, 'mode');
  result.documentContextScopeId = readyScopeId;
  result.documentContextDecision = getField(ready, 'decision');
  result.documentContextBusinessReady = getField(ready, 'businessReady');
  result.documentContextPersistenceReady = getField(ready, 'persistenceReady');
  if (readyScopeId !== expected.scopeId) {
    result.invalidReason = PRECOND_INVALID_REASONS.DOCUMENT_CONTEXT_SCOPE_MISMATCH;
    return result;
  }

  // Sidecar load gate.
  if (sidecarEvents.length === 0) {
    result.invalidReason = PRECOND_INVALID_REASONS.SIDECAR_ACTUAL_LOAD_NOT_OBSERVED;
    return result;
  }
  const sidecar = sidecarEvents[sidecarEvents.length - 1];
  const sidecarDocumentKey = getField(sidecar, 'documentKey');
  result.sidecarDocumentKey = sidecarDocumentKey;
  result.sidecarExists = getField(sidecar, 'exists');
  result.sidecarRecordCount = getField(sidecar, 'recordCount');
  result.sidecarSource = getField(sidecar, 'source');
  result.sidecarBackend = getField(sidecar, 'backend');
  if (sidecarDocumentKey !== expected.documentKey) {
    result.invalidReason = PRECOND_INVALID_REASONS.SIDECAR_DOCUMENT_KEY_MISMATCH;
    return result;
  }
  if (getField(sidecar, 'exists') === true) {
    result.invalidReason = PRECOND_INVALID_REASONS.SIDECAR_EXISTS_UNEXPECTEDLY;
    return result;
  }
  if (getField(sidecar, 'recordCount') !== 0) {
    result.invalidReason = PRECOND_INVALID_REASONS.SIDECAR_RECORD_COUNT_NONZERO;
    return result;
  }
  if (getField(sidecar, 'source') != null && getField(sidecar, 'source') !== 'physical') {
    result.invalidReason = PRECOND_INVALID_REASONS.SIDECAR_SOURCE_NOT_PHYSICAL;
    return result;
  }

  result.overall = true;
  result.invalidReason = null;
  return result;
}

/** Build the full trial-precondition artifact, reusing evaluateE2Precondition. */
export function buildPreconditionArtifact(obs, expected, meta) {
  const evalResult = evaluateE2Precondition(obs, expected);
  return {
    ...evalResult,
    scenario: meta.scenario,
    trialId: meta.trialId,
    expectedBuildId: meta.expectedBuildId,
    expectedDocumentKey: expected.documentKey,
    expectedScopeId: expected.scopeId,
    auditPath: meta.auditPath,
    auditAuthorityAccepted: meta.auditAuthorityAccepted,
    fixtureExists: meta.fixtureExists,
    fixtureClean: meta.fixtureClean,
    waitStartedAt: meta.waitStartedAt,
    waitEndedAt: meta.waitEndedAt,
    waitDurationMs: meta.waitDurationMs,
    pollCount: meta.pollCount,
  };
}

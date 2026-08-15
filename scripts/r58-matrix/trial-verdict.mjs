#!/usr/bin/env node
// trial-verdict.mjs — unified TrialAuthority / TrialVerdict normalization.
//
// All scenarios (E1/E2/E3/A1/A2/A3/B1/FAILURE-PATH) normalize to one schema:
//   verdict: PASS | FAIL | INVALID
//   firstFail / failedChecks / counters / booleans.
//
// INVALID is reserved for infrastructure mismatch (session/document/build/SHA/
// fixture/sidecar/audit-authority). Real invariant failure is FAIL.

'use strict';

const SINGLETON_HOOK = 'EMPTY-SPECIAL-TEST-HOOK';

/** Parse a JSONL string into events + parse metadata. */
export function parseJsonLines(text) {
  const events = [];
  let lineCount = 0;
  let parseFailureCount = 0;
  const rawFailures = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    lineCount++;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object') { events.push(ev); continue; }
      throw new Error('not an object');
    } catch (e) {
      parseFailureCount++;
      rawFailures.push({ line: line.slice(0, 200), error: String((e && e.message) || e) });
    }
  }
  return { events, lineCount, parseFailureCount, rawFailures };
}

/** Read a field from an event (top-level first, then payload). */
export function field(ev, name) {
  if (ev == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(ev, name)) return ev[name];
  if (ev.payload && typeof ev.payload === 'object' && Object.prototype.hasOwnProperty.call(ev.payload, name)) return ev.payload[name];
  return undefined;
}

function eventsNamed(events, name) {
  return events.filter((e) => e && e.event === name);
}

function countEvent(events, name) {
  return eventsNamed(events, name).length;
}

function maxField(events, name, f) {
  let max = null;
  for (const e of eventsNamed(events, name)) {
    const v = field(e, f);
    if (typeof v === 'number' && (max === null || v > max)) max = v;
  }
  return max;
}

/** Collect txn/record/runtime ids from the delta window. */
export function collectIds(events) {
  const txnIds = new Set();
  const recordIds = new Set();
  const runtimeIds = new Set();
  for (const e of events) {
    for (const [k, set] of [
      ['txnId', txnIds],
      ['recordId', recordIds],
      ['runtimeId', runtimeIds],
      ['resolvedRuntimeId', runtimeIds],
    ]) {
      const v = field(e, k);
      if (typeof v === 'string' && v !== '' && v !== 'none') set.add(v);
    }
  }
  return {
    txnIds: Array.from(txnIds),
    recordIds: Array.from(recordIds),
    runtimeIds: Array.from(runtimeIds),
  };
}

/** Global leak/ownership counters. */
export function collectGlobalCounters(events) {
  const awaitingCount = maxField(events, 'AWAITING-TRANSFER-LEAK-AUDIT', 'awaitingCount');
  return {
    selectionWriteCount: countEvent(events, 'PLUGIN-SELECTION-WRITE-AUDIT'),
    caretRestoreCount: countEvent(events, 'CARET-CONTINUITY-RESTORE'),
    caretRepairCount: countEvent(events, 'CARET-REPAIR'),
    awaitingCount: awaitingCount === null ? 0 : awaitingCount,
    mismatchCount: countEvent(events, 'CANONICAL-SCOPE-MISMATCH'),
  };
}

/** Normalize a parser's raw verdict into the unified TrialVerdict schema. */
export function normalizeVerdict(raw, ctx) {
  const ids = collectIds(ctx.events ?? []);
  const counters = collectGlobalCounters(ctx.events ?? []);
  const failedChecks = Array.isArray(raw.failedChecks) ? raw.failedChecks : [];
  const verdict = raw.verdict === 'PASS' || raw.verdict === 'INVALID' ? raw.verdict : (raw.verdict === 'FAIL' ? 'FAIL' : 'FAIL');

  const v = {
    verdict,
    firstFail: failedChecks[0] ?? null,
    failedChecks,
    txnIds: ids.txnIds,
    recordIds: ids.recordIds,
    runtimeIds: ids.runtimeIds,
    selectionWriteCount: counters.selectionWriteCount,
    caretRestoreCount: counters.caretRestoreCount,
    caretRepairCount: counters.caretRepairCount,
    awaitingCount: counters.awaitingCount,
    mismatchCount: counters.mismatchCount,
  };

  if (raw.invalidReason) v.invalidReason = raw.invalidReason;

  // Optional booleans, when present on the raw verdict.
  const boolMap = {
    canonicalIdentityPreserved: 'canonicalIdentityPreserved',
    structurePreserved: 'structurePreserved',
    semanticCorrect: 'semanticCorrect',
    visualCorrect: 'visualCorrect',
    caretLogicalCorrect: 'caretLogicalCorrect',
    caretVisualCorrect: 'caretVisualCorrect',
  };
  for (const [outKey, rawKey] of Object.entries(boolMap)) {
    if (typeof raw[rawKey] === 'boolean') v[outKey] = raw[rawKey];
  }

  // EmptySpecial final booleans.
  if (raw.final && typeof raw.final === 'object') {
    for (const k of ['logicalSlotPreserved', 'paragraphCountPreserved', 'canonicalOwnerCorrect', 'semanticCorrect', 'visualIndentCorrect', 'caretLogicalCorrect', 'caretVisualCorrect']) {
      if (typeof raw.final[k] === 'boolean') {
        if (k === 'visualIndentCorrect') v.visualCorrect = raw.final[k];
        else if (k === 'logicalSlotPreserved' || k === 'paragraphCountPreserved') v.structurePreserved = v.structurePreserved === undefined ? raw.final[k] : (v.structurePreserved && raw.final[k]);
        else v[k] = raw.final[k];
      }
    }
  }

  return v;
}

/**
 * Resolve the verdict audit window from the frozen authority (never latest/0..0).
 * Returns { ok, reason, auditPath, auditStartOffset, auditEndOffset, windowSource }.
 * Boundary guards: scenario mismatch + invalid byte window → ok=false.
 */
export function resolveVerdictWindow(authority, requestedScenario, from, to, statSize) {
  const invalid = (reason) => ({
    ok: false,
    reason,
    authorityDecision: authority?.decision ?? 'MISSING',
    auditPath: authority?.auditPath ?? null,
    auditStartOffset: null,
    auditEndOffset: null,
    windowSource: 'authority',
  });

  if (!authority || authority.decision !== 'ACCEPT' || !authority.auditPath) {
    return invalid('AUTHORITY_MISSING_OR_REJECT');
  }
  if (requestedScenario != null && authority.scenario != null && String(requestedScenario) !== String(authority.scenario)) {
    return invalid('AUTHORITY_SCENARIO_MISMATCH');
  }

  const resolvedFrom = from ?? authority.auditStartOffset ?? 0;
  const resolvedTo = to ?? (typeof statSize === 'number' ? statSize : resolvedFrom);
  const windowSource = (from != null || to != null) ? 'explicit-cli' : 'authority-default';

  if (!isValidAuditWindow(resolvedFrom, resolvedTo, statSize)) {
    return invalid('INVALID_AUDIT_WINDOW');
  }

  return {
    ok: true,
    reason: null,
    authorityDecision: authority.decision,
    auditPath: authority.auditPath,
    auditStartOffset: resolvedFrom,
    auditEndOffset: resolvedTo,
    windowSource,
  };
}

function isValidFiniteInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

function isValidAuditWindow(from, to, fileSize) {
  if (!isValidFiniteInt(from) || !isValidFiniteInt(to)) return false;
  if (from < 0) return false;
  if (from > to) return false;
  if (typeof fileSize === 'number' && Number.isFinite(fileSize) && to > fileSize) return false;
  return true;
}

/**
 * Authority document-identity validation. The scenario fixture must EXACTLY
 * match the current Runtime documentKey (basename, normalized, case-insensitive).
 * Rejects empty documentKey and any non-exact (contains-style) match.
 */
export function evaluateAuthorityDocumentIdentity(expectedDocument, documentKey) {
  const actualDocument = normalizedDocumentBasename(documentKey);
  const documentOk =
    Boolean(expectedDocument) &&
    Boolean(actualDocument) &&
    String(actualDocument).toLowerCase() === String(expectedDocument).toLowerCase();
  return {
    expectedDocument: expectedDocument ?? null,
    actualDocument,
    documentOk,
  };
}

function normalizedDocumentBasename(p) {
  if (!p) return null;
  const norm = String(p).replace(/\\/g, '/');
  const seg = norm.split('/').filter(Boolean).pop();
  return seg ?? null;
}

/**
 * Normalize a document path for authority comparison: separators → backslash,
 * collapse duplicates, lowercase (Windows case-insensitive semantics).
 */
export function normalizeDocumentPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
}

/**
 * Resolve the CURRENT runtime document from the audit record stream.
 *
 * Uses the LAST valid same-session / same-build:
 *   - RUNTIME-IDENTITY-FINAL (payload.reason === 'file-open', payload.activeDoc)
 *   - DOCUMENT-CONTEXT-STATE (businessReady && persistenceReady, activeFilePath)
 *
 * Both must agree (normalized). Never uses `records.find()` (which would return
 * the FIRST file-open — the stale plugin-onload E1).
 */
export function resolveCurrentDocumentAuthority(records, { sessionId, buildId } = {}) {
  let latestRuntimeIdentity = null;
  let latestDocumentContext = null;

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (sessionId && record.sessionId !== sessionId) continue;
    if (buildId && record.buildId !== buildId) continue;

    if (
      record.event === 'RUNTIME-IDENTITY-FINAL' &&
      record.payload?.reason === 'file-open' &&
      typeof record.payload?.activeDoc === 'string' &&
      record.payload.activeDoc.length > 0
    ) {
      latestRuntimeIdentity = record;
    }

    if (
      record.event === 'DOCUMENT-CONTEXT-STATE' &&
      record.payload?.businessReady === true &&
      record.payload?.persistenceReady === true &&
      typeof record.payload?.activeFilePath === 'string' &&
      record.payload.activeFilePath.length > 0
    ) {
      latestDocumentContext = record;
    }
  }

  const runtimeDocument = latestRuntimeIdentity?.payload?.activeDoc ?? null;
  const contextDocument = latestDocumentContext?.payload?.activeFilePath ?? null;
  const runtimeIdentityTs = latestRuntimeIdentity?.tsIso ?? latestRuntimeIdentity?.timestamp ?? null;
  const documentContextTs = latestDocumentContext?.tsIso ?? latestDocumentContext?.timestamp ?? null;

  if (!runtimeDocument || !contextDocument) {
    return {
      ok: false,
      reason: 'DOCUMENT_AUTHORITY_MISSING',
      runtimeDocument,
      contextDocument,
      documentKey: null,
      runtimeIdentityTs,
      documentContextTs,
    };
  }

  if (normalizeDocumentPath(runtimeDocument) !== normalizeDocumentPath(contextDocument)) {
    return {
      ok: false,
      reason: 'DOCUMENT_AUTHORITY_DIVERGENCE',
      runtimeDocument,
      contextDocument,
      documentKey: null,
      runtimeIdentityTs,
      documentContextTs,
    };
  }

  return {
    ok: true,
    reason: null,
    runtimeDocument,
    contextDocument,
    documentKey: contextDocument,
    runtimeIdentityTs,
    documentContextTs,
  };
}

/**
 * A1 clean-baseline (trial 前置 authority 条件).
 *
 * A clean A1 trial requires: the fixture sidecar to be absent at authority time
 * (physical `sidecarStateBefore` + same-session pre-authority Runtime
 * `SIDECAR-ACTUAL-LOAD` exists=false / recordCount=0 / source=physical), no
 * pre-authority persisted records, a valid current document, and an ACCEPTED
 * authority (session/build/SHA all correct).
 *
 * Deliberately NOT derived from the authority→verdict transaction window: the
 * startup loader evidence is emitted BEFORE `auditStartOffset`.
 */
export function evaluateCleanBaseline(authority) {
  const failed = [];
  const sidecar = authority?.sidecarStateBefore ?? null;
  const loader = authority?.preAuthoritySidecarLoad ?? null;
  const persistedLoadCount = authority?.preAuthorityPersistedLoadCount ?? null;
  const persistedHistoricalCount = authority?.preAuthorityPersistedHistoricalCount ?? null;

  const sidecarClean = !!sidecar && sidecar.exists === false && sidecar.recordCount === 0;
  const loaderClean = !!loader && loader.exists === false && loader.recordCount === 0 && loader.source === 'physical';
  const persistedClean = persistedLoadCount === 0 && persistedHistoricalCount === 0;
  const documentAuthorityOk = authority?.documentAuthorityOk === true;
  const documentOk = authority?.documentOk === true;
  const decisionAccept = authority?.decision === 'ACCEPT';

  if (!sidecarClean) failed.push('sidecarStateBefore!=clean');
  if (!loaderClean) failed.push('preAuthoritySidecarLoad!=clean');
  if (!persistedClean) failed.push('preAuthorityPersistedRecords!=0');
  if (!documentAuthorityOk) failed.push('documentAuthorityOk!=true');
  if (!documentOk) failed.push('documentOk!=true');
  if (!decisionAccept) failed.push('authority!=ACCEPT');

  return {
    cleanBaseline: failed.length === 0,
    firstFail: failed[0] ?? null,
    failedChecks: failed,
    sidecarClean,
    loaderClean,
    persistedClean,
    documentAuthorityOk,
    documentOk,
    decisionAccept,
  };
}

/**
 * FAILURE-PATH controlled negative verdict.
 *
 * The transaction outcome is the `verdict`:
 *   - FAIL  → the transaction was blocked/aborted (EXPECTED for the negative)
 *   - PASS  → the transaction committed despite the injection (FALSE-PASS)
 *
 * `controlledNegativePass` is true only when the whole negative mechanism worked
 * (hook consumed → effectiveVisualVerify=false → rollback → no canonical CREATE →
 * no sidecar leak → terminal cleanup → awaiting=0).
 */
export function evaluateFailurePath(ctx) {
  const events = ctx.events ?? [];
  const hook = eventsNamed(events, SINGLETON_HOOK)[0] ?? null;
  const rollback = eventsNamed(events, 'EMPTY-SPECIAL-ROLLBACK')[0] ?? null;
  const commit = eventsNamed(events, 'EMPTY-SPECIAL-CANONICAL-COMMIT')[0] ?? null;
  const close = eventsNamed(events, 'EMPTY-SPECIAL-TRANSACTION-CLOSE')[0] ?? null;

  const testHookConsumed = hook != null && field(hook, 'consumed') === true;
  const effectiveVisualVerify = hook != null ? field(hook, 'effectiveVisualVerify') : undefined;
  const rollbackExecuted = rollback != null && field(rollback, 'overall') === true;
  const canonicalCreated = commit != null && field(commit, 'success') === true;
  const finalState = close != null ? (field(close, 'finalState') ?? field(close, 'state')) : undefined;
  const terminal = close != null ? field(close, 'terminal') : undefined;
  const cleanupOverall = close != null ? field(close, 'overall') : undefined;
  const observerDisconnected = close != null ? field(close, 'observerDisconnected') : undefined;
  const timeoutCleared = close != null ? field(close, 'timeoutCleared') : undefined;
  const activeTxnCleared = close != null ? field(close, 'activeTxnCleared') : undefined;

  const recordCountBefore = ctx.recordCountBefore ?? 0;
  const recordCountAfter = ctx.recordCountAfter ?? 0;
  const sidecarCountBefore = ctx.sidecarCountBefore ?? 0;
  const sidecarCountAfter = ctx.sidecarCountAfter ?? 0;
  const registerCurrentCount = countEvent(events, 'REGISTER_CURRENT');

  const recordCountDeltaOk = recordCountAfter === recordCountBefore;
  const sidecarCountDeltaOk = sidecarCountAfter === sidecarCountBefore;

  const ids = collectIds(events);
  const counters = collectGlobalCounters(events);
  const actualAwaitingCount = counters.awaitingCount;

  // Transaction outcome: committed → false-pass (PASS); otherwise → FAIL.
  const committed = finalState === 'COMMITTED' || canonicalCreated === true;
  const verdict = committed ? 'PASS' : 'FAIL';

  const controlledNegativePass =
    testHookConsumed === true &&
    effectiveVisualVerify === false &&
    rollbackExecuted === true &&
    canonicalCreated === false &&
    registerCurrentCount === 0 &&
    recordCountDeltaOk &&
    sidecarCountDeltaOk &&
    actualAwaitingCount === 0 &&
    terminal === true &&
    cleanupOverall === true;

  const failedChecks = [];
  if (committed) {
    failedChecks.push('FALSE_PASS');
  } else {
    if (!testHookConsumed) failedChecks.push('testHookConsumed!=true');
    if (effectiveVisualVerify !== false) failedChecks.push('effectiveVisualVerify!=false');
    if (!rollbackExecuted) failedChecks.push('rollbackExecuted!=true');
    if (registerCurrentCount !== 0) failedChecks.push('REGISTER_CURRENT>0');
    if (!recordCountDeltaOk) failedChecks.push('recordCount delta!=0');
    if (!sidecarCountDeltaOk) failedChecks.push('sidecarCount delta!=0');
    if (actualAwaitingCount !== 0) failedChecks.push('awaitingCount!=0');
    if (terminal !== true) failedChecks.push('terminal!=true');
    if (cleanupOverall !== true) failedChecks.push('cleanupOverall!=true');
  }

  const firstFail = committed
    ? 'FALSE_PASS'
    : (controlledNegativePass ? 'CONTROLLED_NEGATIVE_INJECTION' : (failedChecks[0] ?? null));

  return {
    verdict,
    firstFail,
    failedChecks,
    controlledNegativePass,
    txnIds: ids.txnIds,
    recordIds: ids.recordIds,
    runtimeIds: ids.runtimeIds,
    selectionWriteCount: counters.selectionWriteCount,
    caretRestoreCount: counters.caretRestoreCount,
    caretRepairCount: counters.caretRepairCount,
    awaitingCount: counters.awaitingCount,
    mismatchCount: counters.mismatchCount,
    rollbackExecuted,
    canonicalCreated,
    sidecarLeak: !sidecarCountDeltaOk,
    verificationFailed: effectiveVisualVerify === false,
    testHookConsumed,
    finalState,
    terminal,
    cleanupOverall,
    observerDisconnected,
    timeoutCleared,
    activeTxnCleared,
    orphanCanonicalCount: registerCurrentCount,
    unexpectedSidecarWrite: !sidecarCountDeltaOk,
    recordCountBefore,
    recordCountAfter,
    sidecarCountBefore,
    sidecarCountAfter,
  };
}

/**
 * RAF-RACE verdict: exactly `expectedTxnCount` independent EmptySpecial
 * transactions in one authority window, all COMMITTED and terminal, with no
 * blocked / PRE_COMMIT_VERIFY_FAILED / visual / caret / leak failures.
 *
 * Zero-length Text Node observation is NOT itself a failure — it only fails if
 * it was misclassified (emptyEquivalent=false or projectionMode=TEXT_INDENT).
 */
export function evaluateRafRace(events, ctx = {}) {
  const expectedTxnCount = ctx.expectedTxnCount ?? 5;
  const failed = [];
  const finals = eventsNamed(events, 'EMPTY-SPECIAL-FINAL');
  const closes = eventsNamed(events, 'EMPTY-SPECIAL-TRANSACTION-CLOSE');
  const projections = eventsNamed(events, 'EMPTY-SPECIAL-EMPTY-VISUAL-PROJECTION');
  const snapshots = eventsNamed(events, 'EMPTY-BLOCK-DOM-SNAPSHOT');

  const txnIds = new Set();
  for (const f of finals) {
    const t = field(f, 'txnId');
    if (typeof t === 'string' && t) txnIds.add(t);
  }
  const txnCount = finals.length;
  const distinctTxnCount = txnIds.size;

  const closeByTxn = new Map();
  for (const c of closes) {
    const t = field(c, 'txnId');
    if (t) closeByTxn.set(t, c);
  }

  let blockedCount = 0;
  let preCommitVerifyFailedCount = 0;
  let visualFailCount = 0;
  let caretLogicalFailCount = 0;
  let caretVisualFailCount = 0;
  let unexpectedMergeCount = 0;
  let unexpectedDeleteCount = 0;
  for (const f of finals) {
    if (field(f, 'blockedReason')) blockedCount++;
    if (field(f, 'blockedReason') === 'PRE_COMMIT_VERIFY_FAILED') preCommitVerifyFailedCount++;
    if (field(f, 'visualIndentCorrect') === false) visualFailCount++;
    if (field(f, 'caretLogicalCorrect') === false) caretLogicalFailCount++;
    if (field(f, 'caretVisualCorrect') === false) caretVisualFailCount++;
    if (field(f, 'unexpectedMerge') === true) unexpectedMergeCount++;
    if (field(f, 'unexpectedDelete') === true) unexpectedDeleteCount++;
  }

  let committedCount = 0;
  let terminalCount = 0;
  for (const c of closeByTxn.values()) {
    const finalState = field(c, 'finalState') ?? field(c, 'state');
    if (finalState === 'COMMITTED') committedCount++;
    if (field(c, 'terminal') === true) terminalCount++;
  }

  // Zero-length Text Node observation + classification.
  const projectionByTxn = new Map();
  for (const p of projections) {
    const t = field(p, 'txnId');
    if (t && !projectionByTxn.has(t)) projectionByTxn.set(t, p);
  }
  let textEmptyNodeObserved = false;
  let zeroTextMisclassified = false;
  for (const s of snapshots) {
    if (field(s, 'phase') !== 'AFTER_RAF') continue;
    const count = field(s, 'childNodeCount');
    const summaries = field(s, 'childNodeSummaries');
    const isZeroTextOnly =
      typeof count === 'number' &&
      count === 1 &&
      Array.isArray(summaries) &&
      summaries.length === 1 &&
      typeof summaries[0] === 'string' &&
      summaries[0].startsWith('text:');
    if (!isZeroTextOnly) continue;
    textEmptyNodeObserved = true;
    const t = field(s, 'txnId');
    const proj = t ? projectionByTxn.get(t) : null;
    if (proj) {
      if (field(proj, 'emptyEquivalent') !== true) zeroTextMisclassified = true;
      if (field(proj, 'projectionMode') !== 'EMPTY_PADDING') zeroTextMisclassified = true;
    }
  }

  const counters = collectGlobalCounters(events);
  const orphanCanonicalCount = countEvent(events, 'REGISTER_CURRENT');

  if (txnCount !== expectedTxnCount) failed.push(`txnCount=${txnCount}`);
  if (distinctTxnCount !== expectedTxnCount) failed.push(`distinctTxnIds=${distinctTxnCount}`);
  if (committedCount !== expectedTxnCount) failed.push(`committedCount=${committedCount}`);
  if (terminalCount !== expectedTxnCount) failed.push(`terminalCount=${terminalCount}`);
  if (blockedCount !== 0) failed.push(`blocked=${blockedCount}`);
  if (preCommitVerifyFailedCount !== 0) failed.push(`preCommitVerifyFailed=${preCommitVerifyFailedCount}`);
  if (visualFailCount !== 0) failed.push(`visualIndentCorrect=false x${visualFailCount}`);
  if (caretLogicalFailCount !== 0) failed.push(`caretLogicalCorrect=false x${caretLogicalFailCount}`);
  if (caretVisualFailCount !== 0) failed.push(`caretVisualCorrect=false x${caretVisualFailCount}`);
  if (unexpectedMergeCount !== 0) failed.push(`unexpectedMerge=${unexpectedMergeCount}`);
  if (unexpectedDeleteCount !== 0) failed.push(`unexpectedDelete=${unexpectedDeleteCount}`);
  if (zeroTextMisclassified) failed.push('zeroTextMisclassified');
  if (counters.awaitingCount !== 0) failed.push(`awaitingCount=${counters.awaitingCount}`);
  if (counters.mismatchCount !== 0) failed.push(`mismatchCount=${counters.mismatchCount}`);
  if (orphanCanonicalCount !== 0) failed.push(`orphanCanonicalCount=${orphanCanonicalCount}`);
  if (counters.selectionWriteCount !== 0) failed.push(`selectionWriteCount=${counters.selectionWriteCount}`);
  if (counters.caretRestoreCount !== 0) failed.push(`caretRestoreCount=${counters.caretRestoreCount}`);
  if (counters.caretRepairCount !== 0) failed.push(`caretRepairCount=${counters.caretRepairCount}`);

  const ids = collectIds(events);

  return {
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    firstFail: failed[0] ?? null,
    failedChecks: failed,
    txnCount,
    distinctTxnCount,
    committedCount,
    blockedCount,
    preCommitVerifyFailedCount,
    visualFailCount,
    caretLogicalFailCount,
    caretVisualFailCount,
    textEmptyNodeObserved,
    exactRaceReproduction: textEmptyNodeObserved && !zeroTextMisclassified,
    txnIds: ids.txnIds,
    recordIds: ids.recordIds,
    runtimeIds: ids.runtimeIds,
    selectionWriteCount: counters.selectionWriteCount,
    caretRestoreCount: counters.caretRestoreCount,
    caretRepairCount: counters.caretRepairCount,
    awaitingCount: counters.awaitingCount,
    mismatchCount: counters.mismatchCount,
    orphanCanonicalCount,
  };
}

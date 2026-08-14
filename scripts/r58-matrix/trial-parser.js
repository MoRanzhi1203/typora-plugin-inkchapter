// trial-parser.js — deterministic JSONL event parser for R58 Final Matrix.
//
// Replaces the old console-regex parser. Reads a JSONL delta (or full audit)
// file and emits a structured verdict JSON. No AI judgment.
//
// Usage:
//   node trial-parser.js --type A1|A2|A3|B1|InputSmoke|Schema --delta <file> --fixture <name> --out <json>

'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const a = { type: 'A1', fixture: '', delta: '', out: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--type') a.type = argv[++i];
    else if (argv[i] === '--fixture') a.fixture = argv[++i];
    else if (argv[i] === '--delta') a.delta = argv[++i];
    else if (argv[i] === '--log') a.delta = argv[++i]; // legacy alias
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  return a;
}

// Read a JSONL file into an array of event objects + parse metadata.
function readJsonLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
  const lines = text.split(/\r?\n/);
  const events = [];
  let lineCount = 0;
  let parseFailureCount = 0;
  const rawFailures = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    lineCount++;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object') {
        events.push(ev);
        continue;
      }
      throw new Error('not an object');
    } catch (e) {
      parseFailureCount++;
      rawFailures.push({ line: line.slice(0, 200), error: String(e && e.message || e) });
    }
  }
  return { events, lineCount, parseFailureCount, rawFailures };
}

// Read a field from an event: top-level first, then payload.
function f(e, name) {
  if (e == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(e, name)) return e[name];
  if (e.payload && typeof e.payload === 'object' && Object.prototype.hasOwnProperty.call(e.payload, name)) return e.payload[name];
  return undefined;
}

function eventsNamed(list, name) {
  return list.filter((e) => e && e.event === name);
}

function hasEvent(list, name) {
  return eventsNamed(list, name).length > 0;
}

function countEvent(list, name) {
  return eventsNamed(list, name).length;
}

// Max numeric value of a field across matching events.
function maxField(list, name, field) {
  let max = null;
  for (const e of eventsNamed(list, name)) {
    const v = f(e, field);
    if (typeof v === 'number' && (max === null || v > max)) max = v;
  }
  return max;
}

// ── Schema audit ──────────────────────────────────────────────────────────

function buildSchemaVerdict(a, data) {
  const buildIds = new Set();
  const sessionIds = new Set();
  const uniqueEvents = new Set();
  for (const e of data.events) {
    if (e.event) uniqueEvents.add(e.event);
    if (e.buildId) buildIds.add(e.buildId);
    if (e.sessionId) sessionIds.add(e.sessionId);
  }
  const overall = data.parseFailureCount === 0 && data.lineCount > 0;
  return {
    mode: 'Schema',
    path: a.delta,
    lineCount: data.lineCount,
    parseSuccessCount: data.events.length,
    parseFailureCount: data.parseFailureCount,
    uniqueEvents: Array.from(uniqueEvents).sort(),
    buildIds: Array.from(buildIds).sort(),
    sessionIds: Array.from(sessionIds).sort(),
    overall,
    verdict: overall ? 'PASS' : 'INVALID',
    failedChecks: overall ? [] : (data.parseFailureCount > 0 ? ['parseFailure>0'] : ['emptyFile']),
    parseFailures: data.rawFailures.slice(0, 5),
  };
}

// ── Shared business-gate helpers ───────────────────────────────────────────

function globalCounters(data, failed) {
  const r = {
    scopeMismatchCount: countEvent(data.events, 'CANONICAL-SCOPE-MISMATCH'),
    awaitingCount: maxField(data.events, 'AWAITING-TRANSFER-LEAK-AUDIT', 'awaitingCount'),
    caretRestoreCount: countEvent(data.events, 'CARET-CONTINUITY-RESTORE'),
    caretRepairCount: countEvent(data.events, 'CARET-REPAIR'),
    pluginSelectionWriteCount: countEvent(data.events, 'PLUGIN-SELECTION-WRITE-AUDIT'),
    sinkErrorCount: countEvent(data.events, 'FORENSIC-SINK-ERROR'),
    droppedCount: maxField(data.events, 'FORENSIC-SINK-FLUSH', 'droppedCount'),
    sinkErrorField: maxField(data.events, 'FORENSIC-SINK-READY', 'errorCount'),
  };

  if (r.scopeMismatchCount > 0) failed.push('scopeMismatch>0');
  if (r.awaitingCount !== null && r.awaitingCount !== 0) failed.push('awaitingCount!=0');
  if (r.droppedCount !== null && r.droppedCount !== 0) failed.push('droppedCount!=0');
  if (r.sinkErrorField !== null && r.sinkErrorField !== 0) failed.push('sinkErrorCount!=0');
  return r;
}

function commitSampleEvents(data) {
  const out = {};
  for (const e of eventsNamed(data.events, 'POST-TEXT-INPUT-STABILITY')) {
    const sample = f(e, 'sample');
    if (typeof sample === 'string') out[sample] = e;
  }
  return out;
}

// ── InputSmoke ────────────────────────────────────────────────────────────

function buildInputSmokeVerdict(a, data) {
  const failed = [];
  const r = {
    mode: 'InputSmoke',
    fixture: a.fixture,
    trustedInput: null,
    imeProvenance: null,
    compositionSession: null,
    compositionTextInput: null,
    compositionSequenceComplete: null,
    textCommit: null,
    postTextInputArmCount: 0,
    superseded: null,
    commit50: null, commit150: null, commit300: null, commit500: null, commit1000: null, commit2200: null,
    probeComplete: null,
    canonicalVisual: null,
    projection: null,
    canonicalFinal: null,
    normalEnterFinal: null,
    awaitingCount: -1,
    scopeMismatchCount: 0,
    caretRestoreCount: 0,
    caretRepairCount: 0,
    pluginSelectionWriteCount: 0,
    sinkErrorCount: 0,
    droppedCount: -1,
    verdict: 'FAIL',
    failedChecks: [],
  };

  // Input provenance (non-business → INVALID, not FAIL)
  const kbp = eventsNamed(data.events, 'KEYBOARD-EVENT-PROVENANCE');
  const trustedKbp = kbp.find((e) => f(e, 'key') === 'Process' && f(e, 'code') === 'Period' && f(e, 'isTrusted') === true);
  r.trustedInput = !!trustedKbp;

  // IME provenance from IME-SELECTION-AUDIT (mirrored into JSONL): full composition sequence.
  const ime = eventsNamed(data.events, 'IME-SELECTION-AUDIT');
  const hasCompStart = ime.some((e) => f(e, 'eventType') === 'compositionstart');
  const hasBeforeInputComp = ime.some((e) => f(e, 'eventType') === 'beforeinput' && f(e, 'inputType') === 'insertCompositionText');
  const hasInput = ime.some((e) => f(e, 'eventType') === 'input');
  const hasCompEnd = ime.some((e) => f(e, 'eventType') === 'compositionend');
  r.compositionSequenceComplete = hasCompStart && hasBeforeInputComp && hasInput && hasCompEnd;

  const commitAudit = eventsNamed(data.events, 'TEXT-COMMIT-AUDIT').find((e) => true);
  const commitCompositionSession = commitAudit ? f(commitAudit, 'compositionSessionId') : undefined;
  r.compositionSession = typeof commitCompositionSession === 'string' && commitCompositionSession !== 'none' && commitCompositionSession !== '';
  r.compositionTextInput = hasBeforeInputComp;
  r.imeProvenance = hasCompStart && hasBeforeInputComp && hasInput && hasCompEnd;

  const textCommit = commitAudit && f(commitAudit, 'visibleText') === '\u3002' && f(commitAudit, 'logicalOffset') === 1;
  r.textCommit = !!textCommit;

  // Business gate
  const c = globalCounters(data, failed);
  r.awaitingCount = c.awaitingCount === null ? -1 : c.awaitingCount;
  r.scopeMismatchCount = c.scopeMismatchCount;
  r.caretRestoreCount = c.caretRestoreCount;
  r.caretRepairCount = c.caretRepairCount;
  r.pluginSelectionWriteCount = c.pluginSelectionWriteCount;
  r.sinkErrorCount = c.sinkErrorCount;
  r.droppedCount = c.droppedCount === null ? -1 : c.droppedCount;

  r.postTextInputArmCount = countEvent(data.events, 'POST-TEXT-INPUT-ARM');
  if (r.postTextInputArmCount !== 1) failed.push('armCount!=' + r.postTextInputArmCount);

  const supersession = eventsNamed(data.events, 'CARET-EXPECTATION-SUPERSESSION-AUDIT').find((e) => f(e, 'superseded') === true && f(e, 'restoreAttempted') === false);
  r.superseded = !!supersession;
  if (!r.superseded) failed.push('supersession');

  const samples = commitSampleEvents(data);
  for (const s of ['COMMIT+50', 'COMMIT+150', 'COMMIT+300', 'COMMIT+500', 'COMMIT+1000', 'COMMIT+2200']) {
    const ev = samples[s];
    const ok = ev && f(ev, 'logicalOffset') === 1 && f(ev, 'insideEditor') === true && f(ev, 'visibleText') === '\u3002';
    r[s.toLowerCase().replace('+', '')] = ok ? 1 : 0;
    if (!ok) failed.push(s + '!=1');
  }

  const complete = eventsNamed(data.events, 'POST-TEXT-INPUT-COMPLETE');
  const activeNone = complete.some((e) => f(e, 'activeObservationAfterComplete') === 'none');
  const pendingZero = complete.some((e) => f(e, 'pendingCallbackCountAfterComplete') === 0);
  r.probeComplete = complete.length >= 1 && activeNone && pendingZero;
  if (!r.probeComplete) failed.push('probeComplete');

  r.canonicalVisual = eventsNamed(data.events, 'CANONICAL-VISUAL-VERIFY').some((e) => f(e, 'overall') === true);
  r.projection = eventsNamed(data.events, 'PROJECTION-VERIFY').some((e) => f(e, 'overall') === true);
  r.canonicalFinal = eventsNamed(data.events, 'CANONICAL-TRANSFER-FINAL-AUDIT').some((e) => f(e, 'overall') === true);
  r.normalEnterFinal = eventsNamed(data.events, 'NORMAL-ENTER-FINAL').some((e) => f(e, 'overall') === true);
  if (!r.canonicalVisual) failed.push('canonicalVisual');
  if (!r.projection) failed.push('projection');
  if (!r.canonicalFinal) failed.push('canonicalFinal');
  if (!r.normalEnterFinal) failed.push('normalEnterFinal');

  if (r.caretRestoreCount !== 0) failed.push('caretRestore>0');
  if (r.caretRepairCount !== 0) failed.push('caretRepair>0');
  if (r.pluginSelectionWriteCount !== 0) failed.push('unexpectedSelectionWrite>0');

  // Infrastructure INVALID (not business FAIL) takes precedence.
  if (data.parseFailureCount > 0) {
    r.verdict = 'INVALID';
    r.invalidReason = 'JSONL_PARSE_FAILURE';
    failed.unshift('JSONL_PARSE_FAILURE');
  } else if (!r.trustedInput) {
    r.verdict = 'INVALID';
    r.invalidReason = 'INPUT_PROVENANCE_MISMATCH';
  } else if (!r.textCommit) {
    r.verdict = 'INVALID';
    r.invalidReason = 'IME_NOT_ACTIVE';
  } else {
    r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  }

  r.failedChecks = failed;
  return r;
}

// ── A1 ────────────────────────────────────────────────────────────────────

function buildA1Verdict(a, data) {
  const failed = [];
  const r = {
    mode: 'A1', fixture: a.fixture,
    scopeAuthority: null, cleanBaseline: null, trustedInput: null, imeProvenance: null,
    postTextInputArmCount: 0, superseded: null,
    commit50: null, commit150: null, commit300: null, commit500: null, commit1000: null, commit2200: null,
    probeComplete: null, canonicalFinal: null, normalEnterFinal: null,
    awaitingCount: -1, scopeMismatchCount: 0, caretRestoreCount: 0, caretRepairCount: 0, pluginSelectionWriteCount: 0,
    sinkErrorCount: 0, droppedCount: -1,
    verdict: 'FAIL', failedChecks: [],
  };

  const c = globalCounters(data, failed);
  r.awaitingCount = c.awaitingCount === null ? -1 : c.awaitingCount;
  r.scopeMismatchCount = c.scopeMismatchCount;
  r.caretRestoreCount = c.caretRestoreCount;
  r.caretRepairCount = c.caretRepairCount;
  r.pluginSelectionWriteCount = c.pluginSelectionWriteCount;
  r.sinkErrorCount = c.sinkErrorCount;
  r.droppedCount = c.droppedCount === null ? -1 : c.droppedCount;

  // Clean baseline: SIDECAR-ACTUAL-LOAD exists=false recordCount=0 source=physical for this fixture.
  const load = eventsNamed(data.events, 'SIDECAR-ACTUAL-LOAD').find(
    (e) => f(e, 'documentKey') === a.fixture || (f(e, 'documentKey') && String(f(e, 'documentKey')).endsWith(a.fixture)),
  );
  const persistedLoadCount = eventsNamed(data.events, 'RECORD-LIFECYCLE').filter((e) => f(e, 'event') === 'PERSISTED_LOAD').length;
  const persistedHistoricalCount = eventsNamed(data.events, 'RECORD-LIFECYCLE').filter((e) => f(e, 'state') === 'PERSISTED_HISTORICAL').length;
  const cleanLoad = load && f(load, 'exists') === false && f(load, 'recordCount') === 0 && f(load, 'source') === 'physical';
  r.cleanBaseline = !!(cleanLoad) && persistedLoadCount === 0 && persistedHistoricalCount === 0;
  if (!r.cleanBaseline) failed.push('cleanBaseline');

  // Scope authority: no scopeId/persistenceKey/documentKey other than the fixture (or null/unknown).
  const scopeFields = ['scopeId', 'persistenceKey', 'documentKey'];
  const stale = [];
  for (const e of data.events) {
    for (const sf of scopeFields) {
      const v = f(e, sf);
      if (v == null) continue;
      const sv = String(v);
      if (sv === 'null' || sv === 'none' || sv === 'unknown') continue;
      if (sv !== a.fixture && !sv.endsWith(a.fixture)) stale.push(sv);
    }
  }
  r.scopeAuthority = stale.length === 0;
  if (!r.scopeAuthority) failed.push('scopeAuthority:' + Array.from(new Set(stale)).join(','));

  r.trustedInput = eventsNamed(data.events, 'KEYBOARD-EVENT-PROVENANCE').some(
    (e) => f(e, 'key') === 'Process' && f(e, 'code') === 'Period' && f(e, 'isTrusted') === true,
  );
  const ime = eventsNamed(data.events, 'IME-SELECTION-AUDIT');
  r.imeProvenance = ime.some((e) => f(e, 'eventType') === 'compositionstart') &&
    ime.some((e) => f(e, 'eventType') === 'beforeinput' && f(e, 'inputType') === 'insertCompositionText') &&
    ime.some((e) => f(e, 'eventType') === 'input') &&
    ime.some((e) => f(e, 'eventType') === 'compositionend');
  if (!r.trustedInput) failed.push('trustedInput');
  if (!r.imeProvenance) failed.push('imeProvenance');

  r.postTextInputArmCount = countEvent(data.events, 'POST-TEXT-INPUT-ARM');
  if (r.postTextInputArmCount !== 1) failed.push('armCount!=' + r.postTextInputArmCount);

  r.superseded = eventsNamed(data.events, 'CARET-EXPECTATION-SUPERSESSION-AUDIT').some(
    (e) => f(e, 'superseded') === true && f(e, 'restoreAttempted') === false,
  );
  if (!r.superseded) failed.push('supersession');

  const samples = commitSampleEvents(data);
  for (const s of ['COMMIT+50', 'COMMIT+150', 'COMMIT+300', 'COMMIT+500', 'COMMIT+1000', 'COMMIT+2200']) {
    const ev = samples[s];
    const ok = ev && f(ev, 'logicalOffset') === 1 && f(ev, 'insideEditor') === true;
    r[s.toLowerCase().replace('+', '')] = ok ? 1 : 0;
    if (!ok) failed.push(s + '!=1');
  }

  const complete = eventsNamed(data.events, 'POST-TEXT-INPUT-COMPLETE');
  r.probeComplete = complete.some((e) => f(e, 'activeObservationAfterComplete') === 'none' && f(e, 'pendingCallbackCountAfterComplete') === 0);
  if (!r.probeComplete) failed.push('probeComplete');

  r.canonicalFinal = eventsNamed(data.events, 'CANONICAL-TRANSFER-FINAL-AUDIT').some((e) => f(e, 'overall') === true);
  r.normalEnterFinal = eventsNamed(data.events, 'NORMAL-ENTER-FINAL').some((e) => f(e, 'overall') === true);
  if (!r.canonicalFinal) failed.push('canonicalFinal');
  if (!r.normalEnterFinal) failed.push('normalEnterFinal');

  if (r.caretRestoreCount !== 0) failed.push('caretRestore>0');
  if (r.caretRepairCount !== 0) failed.push('caretRepair>0');
  if (r.pluginSelectionWriteCount !== 0) failed.push('unexpectedSelectionWrite>0');

  if (data.parseFailureCount > 0) { r.verdict = 'INVALID'; r.invalidReason = 'JSONL_PARSE_FAILURE'; failed.unshift('JSONL_PARSE_FAILURE'); }
  else r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';

  r.failedChecks = failed;
  return r;
}

// ── A2 ────────────────────────────────────────────────────────────────────

function buildA2Verdict(a, data) {
  const failed = [];
  const r = {
    mode: 'A2', fixture: a.fixture, scopeAuthority: null, trustedInput: null,
    sourceCanonicalRecordIdNone: null, canonicalOutcomeNa: null, normalEnterFinal: null,
    awaitingCount: -1, scopeMismatchCount: 0, caretRestoreCount: 0, caretRepairCount: 0, pluginSelectionWriteCount: 0,
    sinkErrorCount: 0, droppedCount: -1,
    verdict: 'FAIL', failedChecks: [],
  };
  const c = globalCounters(data, failed);
  r.awaitingCount = c.awaitingCount === null ? -1 : c.awaitingCount;
  r.scopeMismatchCount = c.scopeMismatchCount;
  r.caretRestoreCount = c.caretRestoreCount;
  r.caretRepairCount = c.caretRepairCount;
  r.pluginSelectionWriteCount = c.pluginSelectionWriteCount;
  r.sinkErrorCount = c.sinkErrorCount;
  r.droppedCount = c.droppedCount === null ? -1 : c.droppedCount;

  r.trustedInput = eventsNamed(data.events, 'KEYBOARD-EVENT-PROVENANCE').some(
    (e) => f(e, 'key') === 'Process' && f(e, 'code') === 'Period' && f(e, 'isTrusted') === true,
  );
  const nef = eventsNamed(data.events, 'NORMAL-ENTER-FINAL');
  r.normalEnterFinal = nef.some((e) => f(e, 'overall') === true);
  r.sourceCanonicalRecordIdNone = nef.some((e) => f(e, 'sourceCanonicalRecordId') === 'none');
  r.canonicalOutcomeNa = nef.some((e) => f(e, 'canonicalOutcomeOverall') === 'n/a');
  if (!r.sourceCanonicalRecordIdNone) failed.push('sourceCanonicalRecordId!=none');
  if (!r.canonicalOutcomeNa) failed.push('canonicalOutcomeOverall!=n/a');
  if (!r.normalEnterFinal) failed.push('normalEnterFinal');
  if (r.caretRestoreCount !== 0) failed.push('caretRestore>0');
  if (r.caretRepairCount !== 0) failed.push('caretRepair>0');
  if (r.pluginSelectionWriteCount !== 0) failed.push('unexpectedSelectionWrite>0');

  if (data.parseFailureCount > 0) { r.verdict = 'INVALID'; r.invalidReason = 'JSONL_PARSE_FAILURE'; failed.unshift('JSONL_PARSE_FAILURE'); }
  else if (!r.trustedInput) { r.verdict = 'INVALID'; r.invalidReason = 'INPUT_PROVENANCE_MISMATCH'; }
  else r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';

  r.failedChecks = failed;
  return r;
}

// ── A3 ────────────────────────────────────────────────────────────────────

function buildA3Verdict(a, data) {
  const failed = [];
  const r = {
    mode: 'A3', fixture: a.fixture,
    canonicalFinal: null, normalEnterFinal: null,
    awaitingCount: -1, scopeMismatchCount: 0, caretRestoreCount: 0, caretRepairCount: 0, pluginSelectionWriteCount: 0,
    sinkErrorCount: 0, droppedCount: -1,
    verdict: 'FAIL', failedChecks: [],
  };
  const c = globalCounters(data, failed);
  r.awaitingCount = c.awaitingCount === null ? -1 : c.awaitingCount;
  r.scopeMismatchCount = c.scopeMismatchCount;
  r.caretRestoreCount = c.caretRestoreCount;
  r.caretRepairCount = c.caretRepairCount;
  r.pluginSelectionWriteCount = c.pluginSelectionWriteCount;
  r.sinkErrorCount = c.sinkErrorCount;
  r.droppedCount = c.droppedCount === null ? -1 : c.droppedCount;

  r.canonicalFinal = eventsNamed(data.events, 'CANONICAL-TRANSFER-FINAL-AUDIT').some((e) => f(e, 'overall') === true);
  r.normalEnterFinal = eventsNamed(data.events, 'NORMAL-ENTER-FINAL').some((e) => f(e, 'overall') === true);
  if (!r.canonicalFinal) failed.push('canonicalFinal');
  if (!r.normalEnterFinal) failed.push('normalEnterFinal');
  if (r.caretRestoreCount !== 0) failed.push('caretRestore>0');
  if (r.caretRepairCount !== 0) failed.push('caretRepair>0');
  if (r.pluginSelectionWriteCount !== 0) failed.push('unexpectedSelectionWrite>0');

  if (data.parseFailureCount > 0) { r.verdict = 'INVALID'; r.invalidReason = 'JSONL_PARSE_FAILURE'; failed.unshift('JSONL_PARSE_FAILURE'); }
  else r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';

  r.failedChecks = failed;
  return r;
}

// ── B1 ────────────────────────────────────────────────────────────────────

function buildB1Verdict(a, data) {
  const failed = [];
  const r = {
    mode: 'B1', fixture: a.fixture, historicalBaseline: null, historicalResolverLeakage: null, duplicateAppend: null,
    awaitingCount: -1, scopeMismatchCount: 0,
    sinkErrorCount: 0, droppedCount: -1,
    verdict: 'FAIL', failedChecks: [],
  };
  const c = globalCounters(data, failed);
  r.awaitingCount = c.awaitingCount === null ? -1 : c.awaitingCount;
  r.scopeMismatchCount = c.scopeMismatchCount;
  r.sinkErrorCount = c.sinkErrorCount;
  r.droppedCount = c.droppedCount === null ? -1 : c.droppedCount;

  const load = eventsNamed(data.events, 'SIDECAR-ACTUAL-LOAD').find(
    (e) => (f(e, 'documentKey') === a.fixture || (f(e, 'documentKey') && String(f(e, 'documentKey')).endsWith(a.fixture))),
  );
  const loadHist = load && f(load, 'exists') === true && typeof f(load, 'recordCount') === 'number' && f(load, 'recordCount') >= 1 && f(load, 'source') === 'physical';
  const persistedLoad = eventsNamed(data.events, 'RECORD-LIFECYCLE').some((e) => f(e, 'event') === 'PERSISTED_LOAD' && f(e, 'state') === 'PERSISTED_HISTORICAL');
  r.historicalBaseline = !!(loadHist) && persistedLoad;
  if (!r.historicalBaseline) failed.push('historicalBaseline');

  // Historical resolver leakage: CURRENT_LIVE/AWAITING/RETIRED must not enter persistent resolver.
  r.historicalResolverLeakage = data.events.some((e) => e.event === 'SINGLE-DOT-CURRENT-SESSION-CANDIDATE' || e.event === 'REHYDRATE-BLOCK-CURRENT-SESSION-MULTI-OWNER');
  r.duplicateAppend = data.events.some((e) => f(e, 'duplicateAppendDetected') === true);
  if (r.historicalResolverLeakage) failed.push('historicalResolverLeakage');
  if (r.duplicateAppend) failed.push('duplicateAppend');

  if (data.parseFailureCount > 0) { r.verdict = 'INVALID'; r.invalidReason = 'JSONL_PARSE_FAILURE'; failed.unshift('JSONL_PARSE_FAILURE'); }
  else r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';

  r.failedChecks = failed;
  return r;
}

function main() {
  const a = parseArgs(process.argv);
  const data = readJsonLines(a.delta);

  let r;
  switch (a.type) {
    case 'Schema': r = buildSchemaVerdict(a, data); break;
    case 'InputSmoke': r = buildInputSmokeVerdict(a, data); break;
    case 'A1': r = buildA1Verdict(a, data); break;
    case 'A2': r = buildA2Verdict(a, data); break;
    case 'A3': r = buildA3Verdict(a, data); break;
    case 'B1': r = buildB1Verdict(a, data); break;
    default: r = { verdict: 'INVALID', invalidReason: 'UNKNOWN_TYPE', failedChecks: ['UNKNOWN_TYPE:' + a.type] };
  }
  r.trial = a.type;
  r.type = a.type;

  if (a.out) {
    try { fs.writeFileSync(a.out, JSON.stringify(r, null, 2)); } catch { /* ignore */ }
  }
  console.log(JSON.stringify(r));
}

main();

// empty-special-trial-parser.js — deterministic verdict parser for the
// EmptySpecial E1/E2/E3 runtime gate (byte-window JSONL delta).
//
// No AI judgment. Reads a single-trial JSONL delta and emits a structured
// verdict: PASS | FAIL | INVALID.
//
// Usage:
//   node empty-special-trial-parser.js --type E1|E2|E3 --delta <file> --fixture <name> --out <json>

'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const a = { type: 'E2', fixture: '', delta: '', out: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--type') a.type = argv[++i];
    else if (argv[i] === '--fixture') a.fixture = argv[++i];
    else if (argv[i] === '--delta') a.delta = argv[++i];
    else if (argv[i] === '--log') a.delta = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  return a;
}

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
      if (ev && typeof ev === 'object') { events.push(ev); continue; }
      throw new Error('not an object');
    } catch (e) {
      parseFailureCount++;
      rawFailures.push({ line: line.slice(0, 200), error: String((e && e.message) || e) });
    }
  }
  return { events, lineCount, parseFailureCount, rawFailures };
}

function f(e, name) {
  if (e == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(e, name)) return e[name];
  if (e.payload && typeof e.payload === 'object' && Object.prototype.hasOwnProperty.call(e.payload, name)) return e.payload[name];
  return undefined;
}

function eventsNamed(list, name) {
  return list.filter((e) => e && e.event === name);
}

// Exactly-one events that must all share the same txnId.
const SINGLETON_EVENTS = [
  'EMPTY-SPECIAL-MUTATION-WINDOW-ARM',
  'EMPTY-SPECIAL-PRE',
  'EMPTY-SPECIAL-TOKEN-CONSUMED',
  'EMPTY-SPECIAL-TRANSACTION-CLOSE',
  'EMPTY-SPECIAL-FINAL',
];

// Required same-txn events (at least one).
const REQUIRED_EVENTS = [
  'EMPTY-SPECIAL-DOM-NORMALIZATION',
  'EMPTY-SPECIAL-SETTLE-AUDIT',
  'EMPTY-SPECIAL-STRUCTURAL-RESOLUTION',
  'EMPTY-SPECIAL-CANONICAL-COMMIT',
  'EMPTY-SPECIAL-CARET-VERIFY',
  'EMPTY-SPECIAL-CARET-GEOMETRY',
  'EMPTY-SPECIAL-VISUAL-VERIFY',
];

function buildVerdict(a, data) {
  const failed = [];
  const r = {
    mode: a.type,
    fixture: a.fixture,
    txnId: null,
    transactionUnique: null,
    arm: null,
    settle: null,
    geometry: null,
    domNormalization: null,
    final: null,
    verdict: 'FAIL',
    failedChecks: [],
    invalidReason: null,
  };

  if (data.parseFailureCount > 0) {
    r.verdict = 'INVALID';
    r.invalidReason = 'JSONL_UTF8_PARSE_FAILURE';
    r.failedChecks = ['JSONL_UTF8_PARSE_FAILURE'];
    return r;
  }

  // ── Singleton events exactly 1 + same txnId ──
  const singletonCounts = {};
  let txnId = null;
  for (const name of SINGLETON_EVENTS) {
    const evs = eventsNamed(data.events, name);
    singletonCounts[name] = evs.length;
    if (evs.length !== 1) {
      r.verdict = 'INVALID';
      r.invalidReason = 'TRIAL_TRANSACTION_AMBIGUOUS';
      r.failedChecks = [name + 'Count=' + evs.length];
      return r;
    }
    const t = f(evs[0], 'txnId');
    if (!t) {
      r.verdict = 'INVALID';
      r.invalidReason = 'TRIAL_TRANSACTION_AMBIGUOUS';
      r.failedChecks = [name + ':missing txnId'];
      return r;
    }
    if (txnId === null) txnId = t;
    else if (t !== txnId) {
      r.verdict = 'INVALID';
      r.invalidReason = 'TRIAL_TRANSACTION_AMBIGUOUS';
      r.failedChecks = ['txnIdMismatch:' + name];
      return r;
    }
  }
  r.txnId = txnId;
  r.transactionUnique = true;

  // ── Required same-txn events ──
  for (const name of REQUIRED_EVENTS) {
    const evs = eventsNamed(data.events, name).filter((e) => f(e, 'txnId') === txnId);
    if (evs.length === 0) failed.push('missing:' + name);
  }

  // ── ARM preconditions ──
  const arm = eventsNamed(data.events, 'EMPTY-SPECIAL-MUTATION-WINDOW-ARM')[0];
  const tokenConsumed = eventsNamed(data.events, 'EMPTY-SPECIAL-TOKEN-CONSUMED')[0];
  const rootConnected = f(arm, 'observerRootConnectedAtArm');
  const rootContainsSource = f(arm, 'observerRootContainsSourceAtArm');
  const sourceConnectedAtArm = f(arm, 'sourceConnectedAtArm');
  const rootIsEditorRoot = f(arm, 'observerRootIsCurrentEditorRoot');
  const armDecision = f(arm, 'decision');
  const observerArmedAt = f(arm, 'observerArmedAt');
  const tokenConsumedAt = f(tokenConsumed, 'tokenConsumedAt');

  r.arm = {
    observerRootConnectedAtArm: rootConnected,
    observerRootContainsSourceAtArm: rootContainsSource,
    sourceConnectedAtArm,
    observerRootIsCurrentEditorRoot: rootIsEditorRoot,
    observerArmedAt,
    tokenConsumedAt,
    decision: armDecision,
  };

  const armPreconditionOk =
    rootConnected === true &&
    rootContainsSource === true &&
    sourceConnectedAtArm === true &&
    rootIsEditorRoot === true &&
    armDecision === 'ARMED';
  if (!armPreconditionOk) {
    r.verdict = 'INVALID';
    r.invalidReason = 'OBSERVER_ARM_PRECONDITION_FAILED';
    r.failedChecks = ['OBSERVER_ARM_PRECONDITION_FAILED'];
    return r;
  }

  // ── Order: observerArmedAt < tokenConsumedAt ──
  if (typeof observerArmedAt === 'number' && typeof tokenConsumedAt === 'number') {
    if (!(observerArmedAt < tokenConsumedAt)) {
      r.verdict = 'INVALID';
      r.invalidReason = 'OBSERVER_ARM_ORDER_INVALID';
      r.failedChecks = ['OBSERVER_ARM_ORDER_INVALID'];
      return r;
    }
  } else {
    r.verdict = 'INVALID';
    r.invalidReason = 'OBSERVER_ARM_ORDER_INVALID';
    r.failedChecks = ['OBSERVER_ARM_ORDER_INVALID:missing timestamps'];
    return r;
  }

  // ── DOM normalization gate ──
  const domN = eventsNamed(data.events, 'EMPTY-SPECIAL-DOM-NORMALIZATION').filter((e) => f(e, 'txnId') === txnId);
  if (domN.length === 0) {
    failed.push('missing:EMPTY-SPECIAL-DOM-NORMALIZATION');
  } else {
    const d = domN[0];
    const decision = f(d, 'decision');
    const nativeOk = f(d, 'nativeEmptyEquivalentAfter') === true;
    const overallOk = f(d, 'overall') === true;
    const mdChanged = f(d, 'markdownContentChanged');
    r.domNormalization = {
      decision,
      nativeEmptyEquivalentAfter: f(d, 'nativeEmptyEquivalentAfter'),
      overall: f(d, 'overall'),
      markdownContentChanged: mdChanged,
    };
    if (decision !== 'NORMALIZED_TO_NATIVE_EMPTY' && decision !== 'ALREADY_NATIVE_EMPTY') {
      if (decision === 'BLOCK_UNSAFE_STRUCTURE') failed.push('domNormalization:BLOCK_UNSAFE_STRUCTURE');
      else failed.push('domNormalization:badDecision');
    }
    if (!nativeOk) failed.push('domNormalization:nativeEmptyEquivalentAfter!=true');
    if (!overallOk) failed.push('domNormalization:overall!=true');
    if (mdChanged !== false) failed.push('domNormalization:markdownContentChanged!=false');
  }

  // ── Settle gate (mutation-authoritative) ──
  const settles = eventsNamed(data.events, 'EMPTY-SPECIAL-SETTLE-AUDIT').filter((e) => f(e, 'txnId') === txnId);
  if (settles.length === 0) {
    failed.push('missing:EMPTY-SPECIAL-SETTLE-AUDIT');
  } else {
    const s = settles[0];
    const decision = f(s, 'decision');
    const relevantCount = f(s, 'relevantMutationCount');
    const quiet = f(s, 'quietBoundaryReached');
    const armedBefore = f(s, 'observerArmedBeforeTokenConsume');
    r.settle = {
      decision,
      relevantMutationCount: relevantCount,
      quietBoundaryReached: quiet,
      observerArmedBeforeTokenConsume: armedBefore,
    };

    if (relevantCount !== 0 && relevantCount < 1) {
      r.verdict = 'INVALID';
      r.invalidReason = 'EMPTY_SPECIAL_MUTATION_NOT_OBSERVED';
      r.failedChecks = ['relevantMutationCount=0'];
      return r;
    }
    if (decision === 'SETTLED_NO_RELEVANT_MUTATION') {
      r.verdict = 'INVALID';
      r.invalidReason = 'EMPTY_SPECIAL_MUTATION_NOT_OBSERVED';
      r.failedChecks = ['decision=SETTLED_NO_RELEVANT_MUTATION'];
      return r;
    }
    if (armedBefore !== true) failed.push('settle:observerArmedBeforeTokenConsume!=true');
    if (typeof relevantCount !== 'number' || relevantCount < 1) failed.push('settle:relevantMutationCount<1');
    if (quiet !== true) failed.push('settle:quietBoundaryReached!=true');
    if (decision !== 'SETTLED_BY_MUTATION_QUIET') failed.push('settle:decision!=' + decision);
  }

  // ── E3: controlled replacement ──
  if (a.type === 'E3') {
    const sr = eventsNamed(data.events, 'EMPTY-SPECIAL-STRUCTURAL-RESOLUTION').filter((e) => f(e, 'txnId') === txnId);
    if (sr.length > 0) {
      const decision = f(sr[0], 'decision');
      const candidateCount = f(sr[0], 'candidateCount');
      if (decision === 'CONTROLLED_REPLACEMENT') {
        if (candidateCount !== 1) failed.push('e3:candidateCount!=' + candidateCount);
      } else if (decision === 'AMBIGUOUS') {
        failed.push('e3:AMBIGUOUS');
      }
    }
  }

  // ── Caret geometry ──
  const geoms = eventsNamed(data.events, 'EMPTY-SPECIAL-CARET-GEOMETRY').filter((e) => f(e, 'txnId') === txnId);
  if (geoms.length === 0) {
    failed.push('missing:EMPTY-SPECIAL-CARET-GEOMETRY');
  } else {
    const g = geoms[0];
    const exp = f(g, 'expectedIndentPx');
    const act = f(g, 'actualCaretIndentPx');
    const overall = f(g, 'overall');
    r.geometry = { expectedIndentPx: exp, actualCaretIndentPx: act, overall };
    if (overall !== true) failed.push('geometry:overall!=true');
    if (typeof exp === 'number' && (exp < 28 || exp > 36)) failed.push('geometry:expectedIndentPx~32');
    if (typeof act === 'number' && (act < 28 || act > 36)) failed.push('geometry:actualCaretIndentPx~32');
  }

  // ── FINAL gate ──
  const fin = eventsNamed(data.events, 'EMPTY-SPECIAL-FINAL')[0];
  const finalBooleans = [
    'overall', 'logicalSlotPreserved', 'paragraphCountPreserved', 'canonicalOwnerCorrect',
    'semanticCorrect', 'visualIndentCorrect', 'caretLogicalCorrect', 'caretVisualCorrect',
  ];
  r.final = {};
  for (const b of finalBooleans) r.final[b] = f(fin, b);
  for (const b of finalBooleans) {
    if (f(fin, b) !== true) failed.push('final:' + b + '!=true');
  }
  if (f(fin, 'unexpectedMerge') !== false) failed.push('final:unexpectedMerge!=false');
  if (f(fin, 'unexpectedDelete') !== false) failed.push('final:unexpectedDelete!=false');

  // ── P0-B invariant: no EMPTY-SPECIAL-MUTATION with same txnId after CLOSE ──
  const closeEvents = eventsNamed(data.events, 'EMPTY-SPECIAL-TRANSACTION-CLOSE');
  if (closeEvents.length > 0) {
    const closeIndex = data.events.indexOf(closeEvents[0]);
    const mutationsAfterClose = data.events.filter((e, i) =>
      i > closeIndex && e.event === 'EMPTY-SPECIAL-MUTATION' && f(e, 'txnId') === txnId
    );
    if (mutationsAfterClose.length > 0) failed.push('mutationAfterClose>0');
    // Terminal cleanup fields must be authoritative.
    if (f(closeEvents[0], 'observerDisconnected') !== true) failed.push('close:observerDisconnected!=true');
    if (f(closeEvents[0], 'activeTxnCleared') !== true) failed.push('close:activeTxnCleared!=true');
    if (f(closeEvents[0], 'terminal') !== true) failed.push('close:terminal!=true');
  }

  // ── P0-C routing: ALLOW_SPECIAL_COMMAND must not route to NORMAL_ENTER ──
  const routes = eventsNamed(data.events, 'SPECIAL-COMMAND-ROUTING-AUDIT');
  for (const rt of routes) {
    if (f(rt, 'admissionDecision') === 'ALLOW_SPECIAL_COMMAND') {
      const selectedPath = f(rt, 'selectedPath');
      if (selectedPath !== 'EMPTY_SPECIAL') failed.push('route:ALLOW_SPECIAL_COMMAND->' + selectedPath);
    }
  }

  // ── Canonical owner + scope leak quick checks ──
  const scopeMismatch = eventsNamed(data.events, 'CANONICAL-SCOPE-MISMATCH').length;
  if (scopeMismatch > 0) failed.push('scopeMismatch>0');
  const awaiting = eventsNamed(data.events, 'AWAITING-TRANSFER-LEAK-AUDIT');
  for (const aw of awaiting) {
    const c = f(aw, 'awaitingCount');
    if (typeof c === 'number' && c !== 0) failed.push('awaitingCount!=0');
  }

  r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  r.failedChecks = failed;
  return r;
}

function main() {
  const a = parseArgs(process.argv);
  const data = readJsonLines(a.delta);
  const r = buildVerdict(a, data);
  r.trial = a.type;
  r.type = a.type;
  if (a.out) {
    try { fs.writeFileSync(a.out, JSON.stringify(r, null, 2)); } catch { /* ignore */ }
  }
  console.log(JSON.stringify(r));
}

main();

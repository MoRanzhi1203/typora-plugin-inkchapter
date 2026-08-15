#!/usr/bin/env node
// r58-closure-gate.mjs — R58.7 unified Node closure harness.
//
// Scenario → fixture / parser / sidecar policy from scenarios.json (single map).
// The harness ONLY does environment / authority / audit-byte-window / verdict.
// It NEVER sends input (no SendInput / focus bridge / CDP / trigger bridge).
//
// Modes:
//   --mode prepare      --scenario <S>       clean/seed fixture+sidecar (+hook config)
//   --mode strict-startup --scenario <S>     close+launch Typora + full startup authority
//   --mode authority    --scenario <S>       read current runtime authority (no launch)
//   --mode open         --scenario <S>       record auditStartOffset for a trial
//   --mode verdict      --scenario <S> --from <n> --to <n> --delta <file>
//   --mode finalize                          write the final closure report

'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  resolveScenario,
  cleanFixture,
  seedHistoricalFixture,
  cleanTestHookConfig,
  writeTestHookConfig,
  verifyFixture,
  verifySidecar,
  cleanSidecar,
  sha256Hex,
  PATHS,
} from './fixture-manager.mjs';
import {
  parseJsonLines,
  normalizeVerdict,
  evaluateFailurePath,
  collectGlobalCounters,
  resolveVerdictWindow,
  evaluateAuthorityDocumentIdentity,
  resolveCurrentDocumentAuthority,
  evaluateRafRace,
  evaluateCleanBaseline,
} from './trial-verdict.mjs';
import { buildClosureSummary, writeClosureReport } from './closure-report-writer.mjs';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const VAULT = PATHS.VAULT;
const DOT_TYPORA = path.join(VAULT, '.typora');
const RUNTIME_MAIN = path.join(DOT_TYPORA, 'plugins', 'dist', 'main.js');
const RUNTIME_STYLE = path.join(DOT_TYPORA, 'plugins', 'dist', 'style.css');
const PROJECT_MAIN = path.join(ROOT, 'dist', 'main.js');
const PROJECT_STYLE = path.join(ROOT, 'dist', 'style.css');
const RUNTIME_LOAD = path.join(DOT_TYPORA, 'inkchapter-runtime-load.json');
const AUDIT_DIR = path.join(DOT_TYPORA, 'inkchapter', 'audit');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts', 'r58-closure');

const WIN32_DIR = path.join(SCRIPT_DIR, 'win32-helper');
const WIN32_CS = path.join(WIN32_DIR, 'R58Win32Helper.cs');
const WIN32_BIN = path.join(WIN32_DIR, 'bin');
const WIN32_DLL = path.join(WIN32_BIN, 'R58Win32Helper.dll');
const WIN32_RUNTIMECONFIG = path.join(WIN32_BIN, 'R58Win32Helper.runtimeconfig.json');
const DEFAULT_TYPORA_EXE = 'D:\\Typora\\Typora.exe';

let TYPORA_EXE = DEFAULT_TYPORA_EXE;

function loadScenarios() {
  return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'scenarios.json'), 'utf8'));
}

function parseArgs(argv) {
  const a = { mode: 'prepare', scenario: 'E2', from: null, to: null, delta: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--mode') a.mode = argv[++i];
    else if (argv[i] === '--scenario') a.scenario = (argv[++i] || '').toUpperCase();
    else if (argv[i] === '--from') a.from = Number(argv[++i]);
    else if (argv[i] === '--to') a.to = Number(argv[++i]);
    else if (argv[i] === '--delta') a.delta = argv[++i];
    else if (argv[i] === '--typora-exe') a.typoraExe = argv[++i];
  }
  return a;
}

function log(msg) {
  process.stdout.write(`[${new Date().toTimeString().slice(0, 8)}] ${msg}\n`);
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readRuntimeLoad() {
  if (!fs.existsSync(RUNTIME_LOAD)) return null;
  try { return JSON.parse(fs.readFileSync(RUNTIME_LOAD, 'utf8')); } catch { return null; }
}

function auditFiles() {
  if (!fs.existsSync(AUDIT_DIR)) return [];
  return fs.readdirSync(AUDIT_DIR)
    .filter((f) => /^runtime-.*\.log$/.test(f))
    .map((f) => path.join(AUDIT_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function sessionIdFromAuditPath(file) {
  if (!file) return null;
  const base = path.basename(file);
  if (!base.startsWith('runtime-') || !base.endsWith('.log')) return null;
  return base.slice('runtime-'.length, -'.log'.length) || null;
}

async function readAllEvents(file) {
  const size = fs.statSync(file).size;
  const buf = await fsp.readFile(file);
  return parseJsonLines(buf.toString('utf8'));
}

async function auditSessionIdentity(file) {
  let readyFound = false;
  let identityFound = false;
  let buildId = null;
  let initializationCount = null;
  let activeDoc = null;
  let parseFailureCount = 0;
  try {
    const data = await readAllEvents(file);
    parseFailureCount = data.parseFailureCount;
    for (const ev of data.events) {
      if (ev.event === 'FORENSIC-SINK-READY' && !readyFound) { readyFound = true; buildId = ev.buildId ?? ev.payload?.buildId ?? null; }
      if (ev.event === 'RUNTIME-IDENTITY-FINAL' && !identityFound) {
        identityFound = true;
        initializationCount = ev.initializationCount ?? ev.payload?.initializationCount ?? null;
        activeDoc = ev.activeDoc ?? ev.payload?.activeDoc ?? null;
      }
    }
  } catch { parseFailureCount = -1; }
  return { auditPath: file, sessionId: sessionIdFromAuditPath(file), readyFound, identityFound, buildId, initializationCount, activeDoc, parseFailureCount };
}

/**
 * Extract the A1 clean-baseline Runtime loader evidence from the pre-authority
 * snapshot (same session/build, BEFORE auditStartOffset). The startup
 * SIDECAR-ACTUAL-LOAD and RECORD-LIFECYCLE PERSISTED_LOAD events are emitted at
 * document load time and therefore never appear in the authority→verdict
 * transaction window — so they must be read here, not from the delta.
 */
function extractPreAuthorityCleanBaseline(records, fixture, sessionId, buildId) {
  const matchesDocument = (e) => {
    if (!fixture) return false;
    const dk = e?.documentKey ?? e?.payload?.documentKey;
    return dk === fixture || (dk != null && String(dk).endsWith(fixture));
  };
  const inScope = (e) => {
    if (!e || typeof e !== 'object') return false;
    if (sessionId != null && e.sessionId !== sessionId) return false;
    if (buildId != null && e.buildId !== buildId) return false;
    return matchesDocument(e);
  };

  const loads = records.filter((e) => e?.event === 'SIDECAR-ACTUAL-LOAD' && inScope(e));
  const load = loads[loads.length - 1] ?? null;
  const preAuthoritySidecarLoad = load
    ? {
        exists: load.payload?.exists ?? load.exists,
        recordCount: load.payload?.recordCount ?? load.recordCount,
        source: load.payload?.source ?? load.source,
        tsIso: load.tsIso ?? load.timestamp ?? null,
      }
    : null;

  const lifecycles = records.filter((e) => e?.event === 'RECORD-LIFECYCLE' && inScope(e));
  const preAuthorityPersistedLoadCount = lifecycles.filter(
    (e) => (e.payload?.event ?? e.event) === 'PERSISTED_LOAD',
  ).length;
  const preAuthorityPersistedHistoricalCount = lifecycles.filter(
    (e) => (e.payload?.state ?? e.state) === 'PERSISTED_HISTORICAL',
  ).length;

  return {
    preAuthoritySidecarLoad,
    preAuthorityPersistedLoadCount,
    preAuthorityPersistedHistoricalCount,
  };
}

// ── Win32 helper (Node direct Roslyn csc.dll; reused, not modified) ─────────
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) { const x = pa[i] || 0; const y = pb[i] || 0; if (x !== y) return x - y; }
  return 0;
}

async function execFileOut(file, args) {
  const { stdout } = await execFileAsync(file, args, { windowsHide: true, timeout: 30000 });
  return String(stdout || '');
}

async function locateDotnetRoot() {
  try {
    const out = await execFileOut('where.exe', ['dotnet']);
    const first = out.split(/\r?\n/).map((s) => s.trim()).find((s) => /[\\/]dotnet(\.exe)?$/i.test(s));
    if (first) return path.dirname(first);
  } catch { /* fall through */ }
  const def = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet');
  if (fs.existsSync(path.join(def, 'dotnet.exe'))) return def;
  throw new Error('cannot locate dotnet root');
}

async function locateRoslynCsc(dotnetRoot) {
  const sdkBase = path.join(dotnetRoot, 'sdk');
  const candidates = [];
  if (fs.existsSync(sdkBase)) {
    for (const d of fs.readdirSync(sdkBase)) {
      const csc = path.join(sdkBase, d, 'Roslyn', 'bincore', 'csc.dll');
      if (fs.existsSync(csc)) candidates.push({ version: d, sdkDir: path.join(sdkBase, d), csc });
    }
  }
  candidates.sort((x, y) => compareVersions(y.version, x.version));
  if (candidates.length > 0) return candidates[0];
  throw new Error('cannot locate Roslyn csc.dll');
}

function locateRefPack(dotnetRoot) {
  const packsDir = path.join(dotnetRoot, 'packs', 'Microsoft.NETCore.App.Ref');
  if (!fs.existsSync(packsDir)) throw new Error('ref pack missing');
  const versions = fs.readdirSync(packsDir).filter((d) => /^\d/.test(d)).sort((a, b) => compareVersions(b, a));
  for (const v of versions) {
    const refRoot = path.join(packsDir, v, 'ref');
    if (!fs.existsSync(refRoot)) continue;
    const subs = fs.readdirSync(refRoot);
    const netDir = subs.includes('net8.0') ? 'net8.0' : subs.find((s) => /^net\d/.test(s));
    if (!netDir) continue;
    const refDir = path.join(refRoot, netDir);
    const dlls = fs.readdirSync(refDir).filter((f) => f.toLowerCase().endsWith('.dll'));
    if (dlls.length > 0) return { version: v, refDir, dlls };
  }
  throw new Error('no reference assemblies found');
}

async function compileHelperViaRoslyn() {
  const dotnetRoot = await locateDotnetRoot();
  const sdk = await locateRoslynCsc(dotnetRoot);
  const ref = locateRefPack(dotnetRoot);
  fs.mkdirSync(WIN32_BIN, { recursive: true });
  const refArgs = ref.dlls.map((d) => '-reference:' + path.join(ref.refDir, d));
  const cscArgs = [sdk.csc, '-nologo', '-noconfig', '-nostdlib+', '-target:exe', '-langversion:latest', '-out:' + WIN32_DLL, WIN32_CS, ...refArgs];
  await execFileAsync('dotnet', cscArgs, { windowsHide: true, timeout: 120000 });
  if (!fs.existsSync(WIN32_DLL)) throw new Error('helper dll missing after compile');
  fs.writeFileSync(WIN32_RUNTIMECONFIG, JSON.stringify({ runtimeOptions: { tfm: 'net8.0', framework: { name: 'Microsoft.NETCore.App', version: ref.version } } }, null, 2) + '\n', 'utf8');
}

function runWin32(args) {
  return new Promise((resolve, reject) => {
    execFile('dotnet', [WIN32_DLL, ...args], { encoding: 'utf8', windowsHide: true, timeout: 45000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error('helper failed: ' + ((stderr && stderr.trim()) || err.message)));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error('helper bad JSON: ' + stdout.slice(0, 300))); }
    });
  });
}

async function ensureHelperBuilt() {
  if (fs.existsSync(WIN32_DLL) && fs.existsSync(WIN32_RUNTIMECONFIG)) {
    try { const self = await runWin32(['enumerate']); if (self && typeof self.count === 'number') return; } catch { /* rebuild */ }
  }
  await compileHelperViaRoslyn();
}

function launchTypora(fixtureAbs) {
  const child = spawn(TYPORA_EXE, [fixtureAbs], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

async function enumerateTypora() { return runWin32(['enumerate']); }
async function closeTypora() { return runWin32(['close']); }

// ── Modes ────────────────────────────────────────────────────────────────────

async function modePrepare(scenario) {
  const map = resolveScenario(scenario, loadScenarios());
  if (!map) { log(`prepare: unknown scenario ${scenario}`); process.exitCode = 2; return; }

  cleanTestHookConfig();

  let result;
  if (map.sidecarPolicy === 'seed') {
    result = seedHistoricalFixture(map.fixture);
  } else {
    result = cleanFixture(map.fixture);
  }

  if (map.type === 'FAILURE-PATH') {
    result.testHookConfig = writeTestHookConfig({
      hook: 'FORCE_VISUAL_VERIFY_FAIL_ONCE',
      document: map.fixture,
      remaining: 1,
    });
  }

  result.scenario = scenario;
  result.fixture = map.fixture;
  result.parser = map.parser;
  result.type = map.type;
  writeJson(path.join(ARTIFACTS_DIR, 'prepare', scenario + '.json'), result);
  log(`prepare scenario=${scenario} fixture=${map.fixture} policy=${map.sidecarPolicy}`);
  console.log(JSON.stringify(result, null, 2));
}

async function modeAuthority(scenario) {
  const map = resolveScenario(scenario, loadScenarios());
  const rl = readRuntimeLoad();
  const files = auditFiles();
  const latest = files[0] ?? null;
  const audit = latest ? await auditSessionIdentity(latest) : null;

  const expected = loadScenarios();
  const mainSha = fs.existsSync(RUNTIME_MAIN) ? sha256Hex(RUNTIME_MAIN) : null;
  const styleSha = fs.existsSync(RUNTIME_STYLE) ? sha256Hex(RUNTIME_STYLE) : null;

  // Current document comes from the SAME audit snapshot (last valid file-open
  // identity + last ready document context), NOT from the stale first identity.
  const auditStartOffset = latest ? fs.statSync(latest).size : 0;
  let currentDocumentAuthority = {
    ok: false,
    reason: 'DOCUMENT_AUTHORITY_MISSING',
    runtimeDocument: null,
    contextDocument: null,
    documentKey: null,
    runtimeIdentityTs: null,
    documentContextTs: null,
  };
  let preAuthorityCleanBaseline = null;
  if (latest) {
    try {
      const snapshotText = fs.readFileSync(latest).subarray(0, auditStartOffset).toString('utf8');
      const records = parseJsonLines(snapshotText).events;
      currentDocumentAuthority = resolveCurrentDocumentAuthority(records, {
        sessionId: audit?.sessionId ?? undefined,
        buildId: expected.buildId,
      });
      preAuthorityCleanBaseline = extractPreAuthorityCleanBaseline(
        records,
        map?.fixture ?? null,
        audit?.sessionId ?? undefined,
        expected.buildId,
      );
    } catch {
      // keep the default DOCUMENT_AUTHORITY_MISSING
    }
  }

  const documentKey = currentDocumentAuthority.documentKey;
  const docIdentity = evaluateAuthorityDocumentIdentity(map?.fixture ?? null, documentKey);

  const authority = {
    trialId: scenario,
    scenario,
    fixture: map?.fixture ?? null,
    sessionId: audit?.sessionId ?? null,
    auditPath: latest,
    auditStartOffset,
    documentKey,
    buildId: rl?.buildMarker ?? audit?.buildId ?? null,
    mainSHA: mainSha,
    styleSHA: styleSha,
    initializationCount: audit?.initializationCount ?? rl?.initializationCount ?? null,
    sidecarStateBefore: map ? verifySidecar(map.fixture) : null,
    preAuthoritySidecarLoad: preAuthorityCleanBaseline?.preAuthoritySidecarLoad ?? null,
    preAuthorityPersistedLoadCount: preAuthorityCleanBaseline?.preAuthorityPersistedLoadCount ?? 0,
    preAuthorityPersistedHistoricalCount: preAuthorityCleanBaseline?.preAuthorityPersistedHistoricalCount ?? 0,
    runtimeIdentityDocument: currentDocumentAuthority.runtimeDocument,
    documentContextDocument: currentDocumentAuthority.contextDocument,
    documentAuthorityOk: currentDocumentAuthority.ok,
    documentAuthorityReason: currentDocumentAuthority.reason,
    runtimeIdentityTs: currentDocumentAuthority.runtimeIdentityTs,
    documentContextTs: currentDocumentAuthority.documentContextTs,
    expectedDocument: docIdentity.expectedDocument,
    actualDocument: docIdentity.actualDocument,
    documentOk: docIdentity.documentOk,
  };

  const buildOk = authority.buildId === expected.buildId;
  const shaOk = mainSha === expected.expectedMainSha;
  const styleOk = styleSha === expected.expectedStyleSha;
  const initOk = authority.initializationCount === 1;

  const failedChecks = [];
  if (!buildOk) failedChecks.push('BUILD_MISMATCH');
  if (!shaOk) failedChecks.push('MAIN_SHA_MISMATCH');
  if (!styleOk) failedChecks.push('STYLE_SHA_MISMATCH');
  if (!initOk) failedChecks.push('INITIALIZATION_COUNT_INVALID');
  if (!currentDocumentAuthority.ok) failedChecks.push(currentDocumentAuthority.reason ?? 'DOCUMENT_AUTHORITY_INVALID');
  else if (!docIdentity.documentOk) failedChecks.push('DOCUMENT_MISMATCH');

  authority.decision = failedChecks.length === 0 ? 'ACCEPT' : 'REJECT';
  authority.failedChecks = failedChecks;

  writeJson(path.join(ARTIFACTS_DIR, 'authority', scenario + '.json'), authority);
  log(`authority scenario=${scenario} decision=${authority.decision} documentAuthorityOk=${currentDocumentAuthority.ok} documentOk=${docIdentity.documentOk} build=${authority.buildId} shaOk=${shaOk}`);
  console.log(JSON.stringify(authority, null, 2));
}

function readAuthorityFile(scenario) {
  const p = path.join(ARTIFACTS_DIR, 'authority', scenario + '.json');
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function buildInvalidVerdict(scenario, fixture, authority, reason) {
  return {
    verdict: 'INVALID',
    invalidReason: reason,
    firstFail: reason,
    failedChecks: [reason],
    scenario,
    fixture,
    sessionId: authority?.sessionId ?? null,
    auditPath: authority?.auditPath ?? null,
    auditStartOffset: null,
    auditEndOffset: null,
    windowSource: 'authority',
    authorityDecision: authority?.decision ?? 'MISSING',
    txnIds: [],
    recordIds: [],
    runtimeIds: [],
    selectionWriteCount: 0,
    caretRestoreCount: 0,
    caretRepairCount: 0,
    awaitingCount: 0,
    mismatchCount: 0,
  };
}

async function modeVerdict(scenario, from, to, deltaFile) {
  const map = resolveScenario(scenario, loadScenarios());

  // 1. Load the frozen authority for this scenario (single source of truth).
  const authority = readAuthorityFile(scenario);
  const statSize = authority?.auditPath && fs.existsSync(authority.auditPath) ? fs.statSync(authority.auditPath).size : 0;
  const window = resolveVerdictWindow(authority, scenario, from, to, statSize);
  if (!window.ok) {
    const invalid = buildInvalidVerdict(scenario, map?.fixture ?? null, authority, window.reason);
    writeJson(path.join(ARTIFACTS_DIR, 'verdict', scenario + '.json'), invalid);
    log(`verdict scenario=${scenario} verdict=INVALID reason=${window.reason}`);
    console.log(JSON.stringify(invalid, null, 2));
    return;
  }

  // 2. Resolved window from the frozen authority (never guess latest / 0..0).
  const resolvedAuditPath = window.auditPath;
  const resolvedFrom = window.auditStartOffset;
  const resolvedTo = window.auditEndOffset;
  const windowSource = window.windowSource;

  // 3. Read the delta window from the resolved audit path.
  const deltaText = deltaFile ? fs.readFileSync(deltaFile, 'utf8') : await readWindowFromPath(resolvedAuditPath, resolvedFrom, resolvedTo);
  const parsed = parseJsonLines(deltaText);

  let verdict;
  if (map?.parser === 'empty-special-negative' || map?.type === 'FAILURE-PATH') {
    const sidecarBefore = map ? await sidecarSnapshot(map.fixture) : { recordCount: 0, sidecarCount: 0 };
    const sidecarAfter = sidecarBefore;
    verdict = evaluateFailurePath({
      events: parsed.events,
      recordCountBefore: sidecarBefore.recordCount,
      recordCountAfter: sidecarAfter.recordCount,
      sidecarCountBefore: sidecarBefore.sidecarCount,
      sidecarCountAfter: sidecarAfter.sidecarCount,
    });
  } else if (map?.parser === 'raf-race') {
    verdict = evaluateRafRace(parsed.events, { expectedTxnCount: map.expectedTxnCount ?? 5 });
  } else if (map?.parser === 'empty-special') {
    const raw = await runParser('empty-special-trial-parser.js', map.type ?? 'E2', map.fixture, deltaText);
    verdict = normalizeVerdict(raw, { events: parsed.events });
  } else {
    const raw = await runParser('trial-parser.js', map.type ?? 'A1', map.fixture, deltaText);
    verdict = normalizeVerdict(raw, { events: parsed.events });
  }

  // 4. Track authority + window provenance on every verdict.
  verdict.scenario = scenario;
  verdict.fixture = map?.fixture ?? null;
  verdict.sessionId = authority.sessionId ?? null;
  verdict.auditPath = resolvedAuditPath;
  verdict.auditStartOffset = resolvedFrom;
  verdict.auditEndOffset = resolvedTo;
  verdict.windowSource = windowSource;
  verdict.authorityDecision = authority.decision;

  if (parsed.parseFailureCount > 0 && verdict.verdict !== 'INVALID') {
    verdict.verdict = 'INVALID';
    verdict.invalidReason = 'JSONL_UTF8_PARSE_FAILURE';
    if (!verdict.failedChecks.includes('JSONL_UTF8_PARSE_FAILURE')) verdict.failedChecks.unshift('JSONL_UTF8_PARSE_FAILURE');
  }

  // 5. A1 clean baseline is a pre-trial AUTHORITY condition, NOT a
  //    transaction-window condition. The parser's delta-window `cleanBaseline`
  //    marker is dropped and re-derived from the frozen authority.
  if (map?.type === 'A1') {
    const cb = evaluateCleanBaseline(authority);
    verdict.cleanBaseline = cb.cleanBaseline;
    verdict.cleanBaselineFailedChecks = cb.failedChecks;
    const existingFailed = Array.isArray(verdict.failedChecks) ? verdict.failedChecks : [];
    const withoutStaleClean = existingFailed.filter((c) => c !== 'cleanBaseline');
    verdict.failedChecks = cb.cleanBaseline
      ? withoutStaleClean
      : [...cb.failedChecks, ...withoutStaleClean];
    if (verdict.verdict !== 'INVALID') {
      verdict.verdict = verdict.failedChecks.length === 0 ? 'PASS' : 'FAIL';
    }
    verdict.firstFail = verdict.failedChecks[0] ?? null;
  }

  writeJson(path.join(ARTIFACTS_DIR, 'verdict', scenario + '.json'), verdict);
  log(`verdict scenario=${scenario} verdict=${verdict.verdict} firstFail=${verdict.firstFail ?? 'none'} window=${resolvedFrom}..${resolvedTo} source=${windowSource}`);
  console.log(JSON.stringify(verdict, null, 2));
}

async function sidecarSnapshot(fixture, _offset) {
  const v = verifySidecar(fixture);
  return { recordCount: v.exists ? v.recordCount : 0, sidecarCount: v.exists ? 1 : 0 };
}

async function readWindowFromPath(auditPath, from, to) {
  if (from == null || to == null) return '';
  if (!fs.existsSync(auditPath)) return '';
  const start = Math.max(0, from);
  const end = Math.max(start, to);
  const buf = await fsp.readFile(auditPath);
  return buf.subarray(start, end).toString('utf8');
}

async function runParser(parserName, type, fixture, deltaText) {
  const tmp = path.join(ARTIFACTS_DIR, 'tmp', `${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, deltaText, 'utf8');
  const parserPath = path.join(SCRIPT_DIR, parserName);
  try {
    const { stdout } = await execFileAsync('node', [parserPath, '--type', type, '--fixture', fixture, '--delta', tmp], { windowsHide: true, timeout: 30000 });
    const out = String(stdout).trim();
    const firstBrace = out.indexOf('{');
    const lastBrace = out.lastIndexOf('}');
    return JSON.parse(out.slice(firstBrace, lastBrace + 1));
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function modeStrictStartup(scenario) {
  const map = resolveScenario(scenario, loadScenarios());
  const targetDoc = map?.fixture ?? 'r58-empty-special-e2-01.md';
  await ensureHelperBuilt();

  const before = await enumerateTypora();
  const close = await closeTypora();
  const startCmdAt = Date.now();
  launchTypora(path.join(VAULT, targetDoc));

  let main = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const en = await enumerateTypora();
    const procs = (en && en.processes) || [];
    main = procs.find((p) => p.mainWindowHandle !== 0 && (p.mainWindowTitle || '').includes(targetDoc)) || null;
    if (main) break;
  }

  const expected = loadScenarios();
  const projectMainSHA = fs.existsSync(PROJECT_MAIN) ? sha256Hex(PROJECT_MAIN) : null;
  const runtimeMainSHA = fs.existsSync(RUNTIME_MAIN) ? sha256Hex(RUNTIME_MAIN) : null;
  const styleSHA = fs.existsSync(PROJECT_STYLE) ? sha256Hex(PROJECT_STYLE) : null;
  const shaMatch = projectMainSHA === runtimeMainSHA && projectMainSHA === expected.expectedMainSha;
  const styleMatch = styleSHA === expected.expectedStyleSha;

  const report = {
    mode: 'strict-startup',
    scenario,
    targetDocument: targetDoc,
    oldProcessExited: close ? close.closed : false,
    processCountAfterClose: close ? close.afterCount : -1,
    newPid: main ? main.pid : null,
    newStartTime: main ? main.startTimeIso : null,
    mainWindowHandle: main ? main.mainWindowHandle : 0,
    mainWindowTitle: main ? main.mainWindowTitle : '',
    projectMainSHA,
    runtimeMainSHA,
    shaMatch,
    styleSHA,
    styleMatch,
    buildId: expected.buildId,
    verdict: (main && shaMatch && styleMatch) ? 'PASS' : 'FAIL',
    failedChecks: [],
  };
  if (!main) report.failedChecks.push('noMainWindow');
  if (!shaMatch) report.failedChecks.push('mainShaMismatch');
  if (!styleMatch) report.failedChecks.push('styleShaMismatch');

  writeJson(path.join(ARTIFACTS_DIR, 'strict-startup', scenario + '.json'), report);
  log(`strict-startup scenario=${scenario} verdict=${report.verdict}`);
  console.log(JSON.stringify(report, null, 2));
}

async function modeOpen(scenario) {
  const latest = auditFiles()[0];
  const authority = {
    scenario,
    trialId: scenario,
    auditPath: latest,
    auditStartOffset: latest ? fs.statSync(latest).size : 0,
    openedAt: new Date().toISOString(),
  };
  writeJson(path.join(ARTIFACTS_DIR, 'open', scenario + '.json'), authority);
  log(`open scenario=${scenario} auditStartOffset=${authority.auditStartOffset}`);
  console.log(JSON.stringify(authority, null, 2));
}

async function modeFinalize() {
  const verdictDir = path.join(ARTIFACTS_DIR, 'verdict');
  const trials = [];
  if (fs.existsSync(verdictDir)) {
    for (const f of fs.readdirSync(verdictDir).filter((f) => f.endsWith('.json'))) {
      try { trials.push(JSON.parse(fs.readFileSync(path.join(verdictDir, f), 'utf8'))); } catch { /* ignore */ }
    }
  }
  const scenarios = loadScenarios();
  const summary = buildClosureSummary(trials, {
    buildId: scenarios.buildId,
    mainSHA: scenarios.expectedMainSha,
    styleSHA: scenarios.expectedStyleSha,
    strictStartup: null,
  });
  const out = writeClosureReport(summary);
  log(`finalize md=${out.mdPath} json=${out.jsonPath} closure=${summary.finalClosure}`);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  TYPORA_EXE = args.typoraExe || process.env.INKCHAPTER_TYPORA_EXE || DEFAULT_TYPORA_EXE;
  log(`r58-closure-gate mode=${args.mode} scenario=${args.scenario}`);

  switch (args.mode) {
    case 'prepare': await modePrepare(args.scenario); break;
    case 'authority': await modeAuthority(args.scenario); break;
    case 'verdict': await modeVerdict(args.scenario, args.from, args.to, args.delta); break;
    case 'strict-startup': await modeStrictStartup(args.scenario); break;
    case 'open': await modeOpen(args.scenario); break;
    case 'finalize': await modeFinalize(); break;
    default: log('unknown mode: ' + args.mode); process.exitCode = 2;
  }
}

main().catch((e) => {
  log('FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

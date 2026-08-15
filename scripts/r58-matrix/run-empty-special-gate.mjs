#!/usr/bin/env node
// run-empty-special-gate.mjs — EmptySpecial E2-01 Runtime Gate (Node/Win32 authority).
//
// NON-POWERSHELL: this harness must never execute powershell.exe / pwsh / *.ps1.
// SHA uses Node crypto. JSONL uses fs.open/fs.read + TextDecoder("utf-8",{fatal:true})
// + JSON.parse. Windows process/window/input is delegated to a minimal local Win32
// helper (Node direct Roslyn csc.dll compile, no dotnet build, no NuGet).
//
// Modes:
//   node run-empty-special-gate.mjs --mode preflight
//   node run-empty-special-gate.mjs --mode strict-startup
//   node run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
//
// Verdicts: PASS | FAIL | INVALID (no retry-until-pass).

'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { emptyObservation, accumulatePreconditionEvents, evaluateE2Precondition, buildPreconditionArtifact } from './e2-precondition.mjs';
import { evaluateInjectionGate, evaluateTokenProof, evaluateTokenProofFinal, isStaleArtifact, evaluateTrialDeltaAuthority, buildTrialBinding, buildDeltaMetaRecord, INVALID_REASONS } from './e2-input.mjs';
import { evaluateFocusAuthority, buildFocusAuditArtifact, buildFocusSnapshot, FOCUS_VERDICTS } from './e2-focus.mjs';
import { evaluatePhaseBAuthority } from './phase-b-authority.mjs';

const execFileAsync = promisify(execFile);

// ── Frozen baseline ──────────────────────────────────────────────────────────
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const VAULT = path.join(ROOT, 'test', 'vault');
const DOT_TYPORA = path.join(VAULT, '.typora');
const DEFAULT_TYPORA_EXE = 'D:\\Typora\\Typora.exe';
let TYPORA_EXE = DEFAULT_TYPORA_EXE;
const PROJECT_MAIN = path.join(ROOT, 'dist', 'main.js');
const PROJECT_STYLE = path.join(ROOT, 'dist', 'style.css');
const RUNTIME_MAIN = path.join(DOT_TYPORA, 'plugins', 'dist', 'main.js');
const RUNTIME_STYLE = path.join(DOT_TYPORA, 'plugins', 'dist', 'style.css');
const RUNTIME_LOAD = path.join(DOT_TYPORA, 'inkchapter-runtime-load.json');
const AUDIT_DIR = path.join(DOT_TYPORA, 'inkchapter', 'audit');
const SIDECAR_DIR = path.join(DOT_TYPORA, 'inkchapter', 'paragraph-layout');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts', 'empty-special-runtime');

const BUILD_ID = 'inkchapter-r58-7-evc3-canonical-transfer-empty-visual-rc3';
const EXPECTED_MAIN_SHA = 'E059EDE4DE878FB467D75C3180E451F6B3B622DD931EF3D04D088DF4B0FA9ED8';
const EXPECTED_STYLE_SHA = '3B9F8AEE699925428770283E1DEAF0FE7A71B041B7A530BD583CFB60B4682B31';

const FIXTURE = 'r58-empty-special-e2-01.md';
const FIXTURE_ABS = path.join(VAULT, FIXTURE);
const SIDECAR_ABS = path.join(SIDECAR_DIR, FIXTURE + '.json');
const EXPECTED_FIXTURE_BYTES = Buffer.from([0xE6, 0x96, 0x87, 0xE6, 0x9C, 0xAC, 0x0A, 0x0A]); // 文本\n\n (no BOM)
const TOKEN = '\u3002\u3002'; // 。。

const VK_OEM_PERIOD = 0xBE;
const VK_RETURN = 0x0D;

const WIN32_DIR = path.join(SCRIPT_DIR, 'win32-helper');
const WIN32_CS = path.join(WIN32_DIR, 'R58Win32Helper.cs');
const WIN32_BIN = path.join(WIN32_DIR, 'bin');
const WIN32_DLL = path.join(WIN32_BIN, 'R58Win32Helper.dll');
const WIN32_RUNTIMECONFIG = path.join(WIN32_BIN, 'R58Win32Helper.runtimeconfig.json');

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { mode: 'preflight', scenario: 'E2', trial: '01', typoraExe: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--mode') a.mode = argv[++i];
    else if (argv[i] === '--scenario') a.scenario = (argv[++i] || '').toUpperCase();
    else if (argv[i] === '--trial') a.trial = argv[++i];
    else if (argv[i] === '--typora-exe') a.typoraExe = argv[++i];
  }
  return a;
}

function logResolvedPaths() {
  log(`resolvedScriptDir=${SCRIPT_DIR}`);
  log(`resolvedRepoRoot=${ROOT}`);
  log(`resolvedTyporaExe=${TYPORA_EXE}`);
  log(`resolvedFixture=${FIXTURE_ABS}`);
  log(`resolvedAuditDir=${AUDIT_DIR}`);
}

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  process.stdout.write(`[${t}] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ── SHA (Node crypto) ────────────────────────────────────────────────────────
function sha256Hex(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex').toUpperCase();
}

// ── JSONL byte-window reading (fs.open/fs.read + TextDecoder fatal) ──────────
function readBytesRange(file, start, end) {
  return new Promise((resolve, reject) => {
    fs.open(file, 'r', (err, fd) => {
      if (err) return reject(err);
      const len = Math.max(0, end - start);
      const buf = Buffer.alloc(len);
      fs.read(fd, buf, 0, len, start, (err2, bytesRead) => {
        fs.close(fd, () => {});
        if (err2) return reject(err2);
        resolve(buf.subarray(0, bytesRead));
      });
    });
  });
}

function decodeUtf8(buf) {
  const dec = new TextDecoder('utf-8', { fatal: true });
  return dec.decode(buf);
}

function parseJsonLines(text) {
  const events = [];
  let lineCount = 0;
  let parseFailureCount = 0;
  const rawFailures = [];
  const lines = text.split(/\r?\n/);
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

function getField(ev, name) {
  if (ev == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(ev, name)) return ev[name];
  if (ev.payload && typeof ev.payload === 'object' && Object.prototype.hasOwnProperty.call(ev.payload, name)) return ev.payload[name];
  return undefined;
}

function eventsNamed(list, name) {
  return list.filter((e) => e && e.event === name);
}

// ── Win32 helper (Node direct Roslyn csc.dll — no dotnet build, no NuGet) ─────
async function dotnetAvailable() {
  try {
    await execFileAsync('dotnet', ['--version'], { windowsHide: true, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function execFileOut(file, args, opts) {
  const { stdout } = await execFileAsync(file, args, opts);
  return String(stdout || '');
}

async function locateDotnetRoot() {
  try {
    const out = await execFileOut('where.exe', ['dotnet'], { windowsHide: true, timeout: 15000 });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find((s) => /[\\/]dotnet(\.exe)?$/i.test(s));
    if (first) return path.dirname(first);
  } catch { /* fall through */ }
  const def = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet');
  if (fs.existsSync(path.join(def, 'dotnet.exe'))) return def;
  throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: cannot locate dotnet root');
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
  throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: cannot locate Roslyn csc.dll');
}

function locateRefPack(dotnetRoot) {
  const packsDir = path.join(dotnetRoot, 'packs', 'Microsoft.NETCore.App.Ref');
  if (!fs.existsSync(packsDir)) {
    throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: Microsoft.NETCore.App.Ref pack missing');
  }
  const versions = fs.readdirSync(packsDir).filter((d) => /^\d/.test(d)).sort((a, b) => compareVersions(b, a));
  for (const v of versions) {
    const refRoot = path.join(packsDir, v, 'ref');
    if (!fs.existsSync(refRoot)) continue;
    const subs = fs.readdirSync(refRoot);
    const netDir = subs.includes('net8.0') ? 'net8.0' : subs.find((s) => /^net\d/.test(s));
    if (!netDir) continue;
    const refDir = path.join(refRoot, netDir);
    let dlls = [];
    try {
      dlls = fs.readdirSync(refDir).filter((f) => f.toLowerCase().endsWith('.dll'));
    } catch { continue; }
    if (dlls.length > 0) return { version: v, refDir, dlls };
  }
  throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: no reference assemblies found');
}

async function compileHelperViaRoslyn() {
  const dotnetRoot = await locateDotnetRoot();
  const sdk = await locateRoslynCsc(dotnetRoot);
  const ref = locateRefPack(dotnetRoot);
  log(`dotnetRoot=${dotnetRoot}`);
  log(`sdkDir=${sdk.sdkDir}`);
  log(`csc=${sdk.csc}`);
  log(`refVersion=${ref.version} refDir=${ref.refDir} refCount=${ref.dlls.length}`);
  fs.mkdirSync(WIN32_BIN, { recursive: true });
  const refArgs = ref.dlls.map((d) => '-reference:' + path.join(ref.refDir, d));
  const cscArgs = [
    sdk.csc,
    '-nologo',
    '-noconfig',
    '-nostdlib+',
    '-target:exe',
    '-langversion:latest',
    '-out:' + WIN32_DLL,
    WIN32_CS,
    ...refArgs,
  ];
  try {
    await execFileAsync('dotnet', cscArgs, { windowsHide: true, timeout: 120000 });
  } catch (e) {
    throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: Roslyn csc compile failed: ' + ((e && e.stderr) || (e && e.message) || e));
  }
  if (!fs.existsSync(WIN32_DLL)) {
    throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: helper dll missing after compile');
  }
  const rc = {
    runtimeOptions: {
      tfm: 'net8.0',
      framework: { name: 'Microsoft.NETCore.App', version: ref.version },
    },
  };
  fs.writeFileSync(WIN32_RUNTIMECONFIG, JSON.stringify(rc, null, 2) + '\n', 'utf8');
  log('helper runtimeconfig written');
}

async function ensureHelperBuilt() {
  if (fs.existsSync(WIN32_DLL) && fs.existsSync(WIN32_RUNTIMECONFIG)) {
    try {
      const self = await runWin32(['enumerate']);
      if (self && typeof self.count === 'number') return;
    } catch { /* rebuild below */ }
  }
  log('compiling Win32 helper via Node direct Roslyn csc.dll (no dotnet build / no NuGet)');
  await compileHelperViaRoslyn();
  const self = await runWin32(['enumerate']);
  if (!self || typeof self.count !== 'number') {
    throw new Error('NON_POWERSHELL_RUNTIME_CAPABILITY_GAP: helper enumerate self-test failed');
  }
  log('helper enumerate self-test OK');
}

function runWin32(args) {
  return new Promise((resolve, reject) => {
    execFile('dotnet', [WIN32_DLL, ...args], { encoding: 'utf8', windowsHide: true, timeout: 45000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error('helper failed: ' + ((stderr && stderr.trim()) || err.message)));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('helper bad JSON: ' + stdout.slice(0, 300)));
      }
    });
  });
}

function enumerateTypora() {
  return runWin32(['enumerate']);
}

function closeTypora() {
  return runWin32(['close']);
}

function getForeground() {
  return runWin32(['foreground']);
}

function setForeground(hwnd) {
  return runWin32(['set-foreground', String(hwnd)]);
}

function sendKey(vk) {
  return runWin32(['send-key', '0x' + vk.toString(16)]);
}

function focusProbe(hwnd) {
  return runWin32(['focus-probe', String(hwnd)]);
}

function launchTypora(fixtureAbs) {
  const child = spawn(TYPORA_EXE, [fixtureAbs], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

// ── Fixture / sidecar ────────────────────────────────────────────────────────
function fixtureState() {
  const fixtureExists = fs.existsSync(FIXTURE_ABS);
  const sidecarExists = fs.existsSync(SIDECAR_ABS);
  let sidecarRecordCount = 0;
  if (sidecarExists) {
    try {
      const j = JSON.parse(fs.readFileSync(SIDECAR_ABS, 'utf8'));
      if (j && Array.isArray(j.paragraphOverrides)) sidecarRecordCount = j.paragraphOverrides.length;
      else if (j && Array.isArray(j.records)) sidecarRecordCount = j.records.length;
      else sidecarRecordCount = -1;
    } catch {
      sidecarRecordCount = -1;
    }
  }
  const fixtureBytes = fixtureExists ? fs.readFileSync(FIXTURE_ABS) : null;
  const fixtureBytesMatch = fixtureBytes ? fixtureBytes.equals(EXPECTED_FIXTURE_BYTES) : false;
  return {
    fixtureName: FIXTURE,
    fixturePath: FIXTURE_ABS,
    fixtureExists,
    fixtureBytesHex: fixtureBytes ? fixtureBytes.toString('hex').toUpperCase() : null,
    fixtureBytesMatch,
    fixtureByteLength: fixtureBytes ? fixtureBytes.length : 0,
    sidecarPath: SIDECAR_ABS,
    sidecarExists,
    sidecarRecordCount,
    clean: fixtureExists && !sidecarExists && fixtureBytesMatch,
  };
}

function removeSidecar() {
  if (fs.existsSync(SIDECAR_ABS)) fs.unlinkSync(SIDECAR_ABS);
}

// ── Runtime load / audit ─────────────────────────────────────────────────────
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

/** Extract sessionId from an audit file name: runtime-<sessionId>.log → <sessionId>. */
function sessionIdFromAuditPath(file) {
  if (!file) return null;
  const base = path.basename(file);
  if (!base.startsWith('runtime-') || !base.endsWith('.log')) return null;
  return base.slice('runtime-'.length, -'.log'.length) || null;
}

function readAllEvents(file) {
  const size = fs.statSync(file).size;
  return readBytesRange(file, 0, size).then(decodeUtf8).then(parseJsonLines);
}

async function auditSessionIdentity(file) {
  let readyFound = false;
  let identityFound = false;
  let sinkReady = null;
  let identity = null;
  let buildId = null;
  let initializationCount = null;
  let activeDoc = null;
  let vaultRoot = null;
  let parseFailureCount = 0;

  try {
    const data = await readAllEvents(file);
    parseFailureCount = data.parseFailureCount;
    for (const ev of data.events) {
      if (ev.event === 'FORENSIC-SINK-READY' && !sinkReady) { sinkReady = ev; readyFound = true; }
      if (ev.event === 'RUNTIME-IDENTITY-FINAL' && !identity) { identity = ev; identityFound = true; }
    }
    buildId = sinkReady ? getField(sinkReady, 'buildId') : null;
    if (identity) {
      initializationCount = getField(identity, 'initializationCount');
      activeDoc = getField(identity, 'activeDoc');
      vaultRoot = getField(identity, 'vaultRoot');
    }
  } catch {
    parseFailureCount = -1;
  }

  return { auditPath: file, sessionId: sessionIdFromAuditPath(file), readyFound, identityFound, sinkReady, identity, buildId, initializationCount, activeDoc, vaultRoot, parseFailureCount };
}

async function resolveAuditFile(sinceMs, buildId, targetDoc) {
  const results = [];
  for (const f of auditFiles()) {
    if (fs.statSync(f).mtimeMs < sinceMs) continue;
    const id = await auditSessionIdentity(f);
    const buildOk = id.readyFound && id.buildId === buildId;
    const initOk = id.identityFound && id.initializationCount === 1;
    let docOk = true;
    if (targetDoc) docOk = id.activeDoc != null && String(id.activeDoc).includes(targetDoc);
    const decision = (id.readyFound && buildOk && id.identityFound && initOk && docOk && id.parseFailureCount === 0) ? 'ACCEPT' : 'REJECT';
    results.push({ ...id, decision });
  }
  const accepted = results.filter((r) => r.decision === 'ACCEPT');
  if (accepted.length === 0) return { decision: 'REJECT', candidates: results };
  if (accepted.length > 1) return { decision: 'AMBIGUOUS', candidates: accepted };
  return accepted[0];
}

// ── Strict startup readiness ─────────────────────────────────────────────────
async function waitRuntimeReady(startCmdAtMs, buildId, targetDoc, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastRuntimeLoad = null;
  let lastRuntimeLoadMtimeMs = null;
  let lastAuthority = null;
  while (Date.now() < deadline) {
    await sleep(500);
    let rlFresh = false;
    let rl = null;
    if (fs.existsSync(RUNTIME_LOAD)) {
      const st = fs.statSync(RUNTIME_LOAD);
      rlFresh = st.mtimeMs >= startCmdAtMs;
      lastRuntimeLoadMtimeMs = st.mtimeMs;
      rl = readRuntimeLoad();
    }
    if (!rlFresh || !rl) continue;

    lastRuntimeLoad = rl;
    const buildOk = rl.buildMarker === buildId;
    const initOk = rl.initializationCount === 1;
    const shaOk = rl.mainJsSha256 === EXPECTED_MAIN_SHA;
    const authority = await resolveAuditFile(startCmdAtMs, buildId, targetDoc);
    lastAuthority = authority;
    const identityOk = authority.decision === 'ACCEPT';

    if (buildOk && initOk && shaOk && identityOk) {
      return {
        ready: true,
        runtimeLoadFresh: rlFresh,
        runtimeLoadMtimeMs: lastRuntimeLoadMtimeMs,
        runtimeBuildOk: buildOk,
        runtimeShaOk: shaOk,
        identityOk,
        runtimeLoad: rl,
        authority,
      };
    }
  }
  return {
    ready: false,
    runtimeLoadFresh: false,
    runtimeLoadMtimeMs: lastRuntimeLoadMtimeMs,
    runtimeBuildOk: false,
    runtimeShaOk: false,
    identityOk: false,
    runtimeLoad: lastRuntimeLoad,
    authority: lastAuthority,
  };
}

// ── Injection (foreground acquire + verify + CAS gate + exact SendInput) ─────
async function injectKeys(hwnd, keys, interKeyDelayMs, captureFocus = false) {
  const audit = {
    targetHwnd: hwnd,
    foregroundHwndBeforeAcquire: null,
    acquireAttempted: false,
    acquireSucceeded: false,
    foregroundHwndAfterAcquire: null,
    foregroundMatchAfterAcquire: false,
    foregroundHwndBeforeInput: null,
    foregroundMatchBeforeInput: false,
    requestedInputCount: keys.length,
    sendInputReturnCount: 0,
    foregroundHwndAfterInput: null,
    foregroundMatchAfterInput: false,
    injectionAttempted: false,
    injectionSucceeded: false,
  };
  const focus = captureFocus ? {} : null;

  // 1. Acquire foreground.
  const fgBefore = await getForeground();
  audit.foregroundHwndBeforeAcquire = fgBefore && fgBefore.foregroundHwnd;
  if (captureFocus) focus.beforeAcquire = await focusProbe(hwnd);
  audit.acquireAttempted = true;
  const acq = await setForeground(hwnd);
  audit.acquireSucceeded = !!(acq && acq.setForegroundOk);
  await sleep(300);

  // 2. Re-verify actual foreground after acquire.
  const fgAfterAcq = await getForeground();
  audit.foregroundHwndAfterAcquire = fgAfterAcq && fgAfterAcq.foregroundHwnd;
  audit.foregroundMatchAfterAcquire = audit.foregroundHwndAfterAcquire === hwnd;
  if (captureFocus) focus.afterAcquire = await focusProbe(hwnd);
  if (!audit.foregroundMatchAfterAcquire) {
    audit.requestedInputCount = 0;
    audit.sendInputReturnCount = 0;
    audit.injectionAttempted = false;
    audit.injectionSucceeded = false;
    if (captureFocus) audit.focus = focus;
    return audit;
  }

  // 3. CAS gate immediately before input.
  const fgBeforeInput = await getForeground();
  audit.foregroundHwndBeforeInput = fgBeforeInput && fgBeforeInput.foregroundHwnd;
  audit.foregroundMatchBeforeInput = audit.foregroundHwndBeforeInput === hwnd;
  if (captureFocus) focus.beforeInput = await focusProbe(hwnd);
  if (!audit.foregroundMatchBeforeInput) {
    audit.requestedInputCount = 0;
    audit.sendInputReturnCount = 0;
    audit.injectionAttempted = false;
    audit.injectionSucceeded = false;
    if (captureFocus) audit.focus = focus;
    return audit;
  }

  // 4. Exact SendInput.
  audit.injectionAttempted = true;
  for (const vk of keys) {
    const r = await sendKey(vk);
    if (r && r.sent === 2) audit.sendInputReturnCount++;
    if (interKeyDelayMs > 0) await sleep(interKeyDelayMs);
  }
  audit.injectionSucceeded = audit.sendInputReturnCount === audit.requestedInputCount;

  // 5. Re-verify foreground after input.
  await sleep(200);
  const fgAfterInput = await getForeground();
  audit.foregroundHwndAfterInput = fgAfterInput && fgAfterInput.foregroundHwnd;
  audit.foregroundMatchAfterInput = audit.foregroundHwndAfterInput === hwnd;
  if (captureFocus) focus.afterInput = await focusProbe(hwnd);

  if (captureFocus) audit.focus = focus;
  return audit;
}

// ── Token proof (。。 + IME provenance + precise invalid reasons) ────────────
async function tokenProvenance(file, offsetBefore) {
  const empty = (reason) => ({ verdict: 'INVALID', invalidReason: reason, tokenText: null, logicalOffset: null, imeProvenance: false, keyboardEventCount: 0, beforeInputCount: 0, inputCount: 0, compositionStartCount: 0, compositionEndCount: 0 });

  if (!fs.existsSync(file)) return empty(INVALID_REASONS.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED);
  const len = fs.statSync(file).size;
  if (len <= offsetBefore) return empty(INVALID_REASONS.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED);

  let deltaText;
  try {
    const bytes = await readBytesRange(file, offsetBefore, len);
    deltaText = decodeUtf8(bytes);
  } catch {
    return empty('JSONL_UTF8_PARSE_FAILURE');
  }
  const data = parseJsonLines(deltaText);
  if (data.parseFailureCount > 0) return empty('JSONL_UTF8_PARSE_FAILURE');

  const keyboard = eventsNamed(data.events, 'KEYBOARD-EVENT-PROVENANCE');
  const ime = eventsNamed(data.events, 'IME-SELECTION-AUDIT');
  const beforeInputComp = ime.filter((e) => getField(e, 'eventType') === 'beforeinput' && getField(e, 'inputType') === 'insertCompositionText');
  const input = ime.filter((e) => getField(e, 'eventType') === 'input');
  const compStart = ime.filter((e) => getField(e, 'eventType') === 'compositionstart');
  const compEnd = ime.filter((e) => getField(e, 'eventType') === 'compositionend');

  const commits = eventsNamed(data.events, 'TEXT-COMMIT-AUDIT');
  const commit = commits.length > 0 ? commits[commits.length - 1] : null;
  const visibleText = commit ? getField(commit, 'visibleText') : null;
  const logicalOffset = commit ? getField(commit, 'logicalOffset') : null;
  const compositionSessionId = commit ? getField(commit, 'compositionSessionId') : null;

  return evaluateTokenProof({
    keyboardEvents: keyboard.map((e) => ({ key: getField(e, 'key'), code: getField(e, 'code') })),
    beforeInputCompCount: beforeInputComp.length,
    inputCount: input.length,
    compositionStartCount: compStart.length,
    compositionEndCount: compEnd.length,
    visibleText,
    logicalOffset,
    compositionSessionId,
  });
}

async function waitForTokenProof(file, offsetBefore, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(400);
    last = await tokenProvenance(file, offsetBefore);
    if (last.verdict === 'PASS') return last;
  }
  return last || { verdict: 'INVALID', invalidReason: INVALID_REASONS.RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED, tokenText: null, logicalOffset: null, imeProvenance: false, keyboardEventCount: 0, beforeInputCount: 0, inputCount: 0, compositionStartCount: 0, compositionEndCount: 0 };
}

// ── Audit event wait / stable flush ──────────────────────────────────────────
async function waitForEvent(file, offsetBefore, eventNames, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    if (!fs.existsSync(file)) continue;
    const len = fs.statSync(file).size;
    if (len <= offsetBefore) continue;
    try {
      const bytes = await readBytesRange(file, offsetBefore, len);
      const text = decodeUtf8(bytes);
      const data = parseJsonLines(text);
      for (const ev of data.events) {
        if (ev && ev.event && eventNames.includes(ev.event)) return ev;
      }
    } catch {
      // not yet a clean UTF-8 boundary; keep polling
    }
  }
  return null;
}

async function waitFileStable(file, stableCount = 3, intervalMs = 400, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  let last = -1;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const len = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (len === last) stable++;
    else { stable = 1; last = len; }
    if (stable >= stableCount) return true;
  }
  return false;
}

// ── Runtime context / sidecar authority precondition (bounded wait/poll) ─────
async function waitForRuntimePreconditions(authority, expectedScopeId, expectedDocumentKey, timeoutMs = 5000, pollIntervalMs = 100) {
  const waitStartedAt = new Date().toISOString();
  const startedMs = Date.now();
  const deadline = startedMs + timeoutMs;
  let pollCount = 0;
  let auditFileReadable = false;
  let lastObservation = emptyObservation();

  while (Date.now() < deadline) {
    pollCount++;
    const file = authority && authority.auditPath;
    if (!file || !fs.existsSync(file)) {
      await sleep(pollIntervalMs);
      continue;
    }

    let parsed;
    try {
      const size = fs.statSync(file).size;
      const bytes = await readBytesRange(file, 0, size);
      const text = decodeUtf8(bytes);
      parsed = parseJsonLines(text);
      auditFileReadable = true;
    } catch {
      // transient partial UTF-8 boundary — keep polling
      await sleep(pollIntervalMs);
      continue;
    }

    const obs = emptyObservation();
    obs.jsonlParseFailureCount = parsed.parseFailureCount;
    accumulatePreconditionEvents(obs, parsed.events, authority);
    lastObservation = obs;

    const evalResult = evaluateE2Precondition(obs, { scopeId: expectedScopeId, documentKey: expectedDocumentKey });
    if (evalResult.overall) {
      return {
        observation: obs,
        evaluation: evalResult,
        waitStartedAt,
        waitEndedAt: new Date().toISOString(),
        waitDurationMs: Date.now() - startedMs,
        pollCount,
        auditFileReadable,
      };
    }
    await sleep(pollIntervalMs);
  }

  lastObservation.auditFileReadable = auditFileReadable;
  lastObservation.timedOut = true;
  const evaluation = evaluateE2Precondition(lastObservation, { scopeId: expectedScopeId, documentKey: expectedDocumentKey });
  return {
    observation: lastObservation,
    evaluation,
    waitStartedAt,
    waitEndedAt: new Date().toISOString(),
    waitDurationMs: Date.now() - startedMs,
    pollCount,
    auditFileReadable,
  };
}

// ── Verdict (self-contained, spec gates) ─────────────────────────────────────
const SINGLETON_EVENTS = [
  'EMPTY-SPECIAL-PRE',
  'EMPTY-SPECIAL-MUTATION-WINDOW-ARM',
  'EMPTY-SPECIAL-TOKEN-CONSUMED',
  'EMPTY-SPECIAL-DOM-NORMALIZATION',
  'EMPTY-SPECIAL-SETTLE-AUDIT',
  'EMPTY-SPECIAL-FINAL',
  'EMPTY-SPECIAL-TRANSACTION-CLOSE',
];

const REQUIRED_EVENTS = [
  'EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE',
  'EMPTY-SPECIAL-STRUCTURAL-RESOLUTION',
  'EMPTY-SPECIAL-CANONICAL-COMMIT',
  'EMPTY-SPECIAL-CARET-VERIFY',
  'EMPTY-SPECIAL-CARET-GEOMETRY',
  'EMPTY-SPECIAL-VISUAL-VERIFY',
];

function buildVerdict(data) {
  const failed = [];
  const r = {
    txnId: null,
    arm: null,
    settle: null,
    geometry: null,
    domNormalization: null,
    spanPredicate: null,
    close: null,
    final: null,
    routing: null,
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

  // ── Singletons exactly 1 + same txnId ──
  let txnId = null;
  for (const name of SINGLETON_EVENTS) {
    const evs = eventsNamed(data.events, name);
    if (evs.length !== 1) {
      r.verdict = 'INVALID';
      r.invalidReason = 'TRIAL_TRANSACTION_AMBIGUOUS';
      r.failedChecks = [name + 'Count=' + evs.length];
      return r;
    }
    const t = getField(evs[0], 'txnId');
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

  // ── Required same-txn events ──
  for (const name of REQUIRED_EVENTS) {
    const evs = eventsNamed(data.events, name).filter((e) => getField(e, 'txnId') === txnId);
    if (evs.length === 0) failed.push('missing:' + name);
  }

  // ── Routing gate ──
  const admission = eventsNamed(data.events, 'ENTER-ADMISSION-AUDIT').find((e) => getField(e, 'decision') === 'ALLOW_SPECIAL_COMMAND');
  const route = eventsNamed(data.events, 'SPECIAL-COMMAND-ROUTING-AUDIT').find((e) => getField(e, 'admissionDecision') === 'ALLOW_SPECIAL_COMMAND');
  if (!admission) failed.push('routing:missing ENTER-ADMISSION-AUDIT ALLOW_SPECIAL_COMMAND');
  if (!route) failed.push('routing:missing SPECIAL-COMMAND-ROUTING-AUDIT');
  if (route) {
    r.routing = { admissionDecision: getField(route, 'admissionDecision'), selectedPath: getField(route, 'selectedPath'), reason: getField(route, 'reason') };
    if (getField(route, 'selectedPath') !== 'EMPTY_SPECIAL') failed.push('route:ALLOW_SPECIAL_COMMAND->' + getField(route, 'selectedPath'));
  }

  // ── ARM preconditions ──
  const arm = eventsNamed(data.events, 'EMPTY-SPECIAL-MUTATION-WINDOW-ARM')[0];
  const token = eventsNamed(data.events, 'EMPTY-SPECIAL-TOKEN-CONSUMED')[0];
  const rootConnected = getField(arm, 'observerRootConnectedAtArm');
  const rootContainsSource = getField(arm, 'observerRootContainsSourceAtArm');
  const sourceConnectedAtArm = getField(arm, 'sourceConnectedAtArm');
  const rootIsEditorRoot = getField(arm, 'observerRootIsCurrentEditorRoot');
  const armDecision = getField(arm, 'decision');
  const observerArmedAt = getField(arm, 'observerArmedAt');
  const tokenConsumedAt = getField(token, 'tokenConsumedAt');
  r.arm = { observerRootConnectedAtArm: rootConnected, observerRootContainsSourceAtArm: rootContainsSource, sourceConnectedAtArm, observerRootIsCurrentEditorRoot: rootIsEditorRoot, observerArmedAt, tokenConsumedAt, decision: armDecision };

  const armPreconditionOk = rootConnected === true && rootContainsSource === true && sourceConnectedAtArm === true && rootIsEditorRoot === true && armDecision === 'ARMED';
  if (!armPreconditionOk) {
    r.verdict = 'INVALID';
    r.invalidReason = 'OBSERVER_ARM_PRECONDITION_FAILED';
    r.failedChecks = ['OBSERVER_ARM_PRECONDITION_FAILED'];
    return r;
  }
  if (!(typeof observerArmedAt === 'number' && typeof tokenConsumedAt === 'number' && observerArmedAt < tokenConsumedAt)) {
    r.verdict = 'INVALID';
    r.invalidReason = 'OBSERVER_ARM_ORDER_INVALID';
    r.failedChecks = ['OBSERVER_ARM_ORDER_INVALID'];
    return r;
  }

  // ── Exact empty span predicate ──
  const spans = eventsNamed(data.events, 'EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE').filter((e) => getField(e, 'txnId') === txnId);
  if (spans.length === 0) failed.push('missing:EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE');
  else {
    const sp = spans[0];
    r.spanPredicate = {
      matchesExpectedMdPlainShape: getField(sp, 'matchesExpectedMdPlainShape'),
      hasNonEmptyTextNode: getField(sp, 'hasNonEmptyTextNode'),
      safeEmptyTextShape: getField(sp, 'safeEmptyTextShape'),
      decision: getField(sp, 'decision'),
    };
    if (getField(sp, 'matchesExpectedMdPlainShape') !== true) failed.push('span:matchesExpectedMdPlainShape!=true');
    if (getField(sp, 'hasNonEmptyTextNode') !== false) failed.push('span:hasNonEmptyTextNode!=false');
    if (getField(sp, 'safeEmptyTextShape') !== true) failed.push('span:safeEmptyTextShape!=true');
    if (getField(sp, 'decision') !== 'SAFE_EMPTY') failed.push('span:decision!=' + getField(sp, 'decision'));
  }

  // ── DOM normalization ──
  const doms = eventsNamed(data.events, 'EMPTY-SPECIAL-DOM-NORMALIZATION').filter((e) => getField(e, 'txnId') === txnId);
  if (doms.length === 0) failed.push('missing:EMPTY-SPECIAL-DOM-NORMALIZATION');
  else {
    const d = doms[0];
    r.domNormalization = { decision: getField(d, 'decision'), nativeEmptyEquivalentAfter: getField(d, 'nativeEmptyEquivalentAfter'), markdownContentChanged: getField(d, 'markdownContentChanged'), overall: getField(d, 'overall') };
    if (getField(d, 'decision') !== 'NORMALIZED_TO_NATIVE_EMPTY') failed.push('domNormalization:decision!=' + getField(d, 'decision'));
    if (getField(d, 'nativeEmptyEquivalentAfter') !== true) failed.push('domNormalization:nativeEmptyEquivalentAfter!=true');
    if (getField(d, 'markdownContentChanged') !== false) failed.push('domNormalization:markdownContentChanged!=false');
    if (getField(d, 'overall') !== true) failed.push('domNormalization:overall!=true');
  }

  // ── Settle (mutation-authoritative) ──
  const settles = eventsNamed(data.events, 'EMPTY-SPECIAL-SETTLE-AUDIT').filter((e) => getField(e, 'txnId') === txnId);
  if (settles.length === 0) failed.push('missing:EMPTY-SPECIAL-SETTLE-AUDIT');
  else {
    const s = settles[0];
    const decision = getField(s, 'decision');
    const relevantCount = getField(s, 'relevantMutationCount');
    const quiet = getField(s, 'quietBoundaryReached');
    r.settle = {
      decision,
      relevantMutationCount: relevantCount,
      quietBoundaryReached: quiet,
      observerRootConnectedAtArm: getField(s, 'observerRootConnectedAtArm'),
      observerRootContainsSourceAtArm: getField(s, 'observerRootContainsSourceAtArm'),
      sourceConnectedAtArm: getField(s, 'sourceConnectedAtArm'),
      observerRootIsCurrentEditorRoot: getField(s, 'observerRootIsCurrentEditorRoot'),
    };
    if (getField(s, 'observerRootConnectedAtArm') !== true) failed.push('settle:observerRootConnectedAtArm!=true');
    if (getField(s, 'observerRootContainsSourceAtArm') !== true) failed.push('settle:observerRootContainsSourceAtArm!=true');
    if (getField(s, 'sourceConnectedAtArm') !== true) failed.push('settle:sourceConnectedAtArm!=true');
    if (getField(s, 'observerRootIsCurrentEditorRoot') !== true) failed.push('settle:observerRootIsCurrentEditorRoot!=true');
    if (!(typeof relevantCount === 'number' && relevantCount >= 1)) {
      r.verdict = 'INVALID';
      r.invalidReason = 'EMPTY_SPECIAL_MUTATION_NOT_OBSERVED';
      r.failedChecks = ['relevantMutationCount<1'];
      return r;
    }
    if (decision === 'SETTLED_NO_RELEVANT_MUTATION') {
      r.verdict = 'INVALID';
      r.invalidReason = 'EMPTY_SPECIAL_MUTATION_NOT_OBSERVED';
      r.failedChecks = ['decision=SETTLED_NO_RELEVANT_MUTATION'];
      return r;
    }
    if (quiet !== true) failed.push('settle:quietBoundaryReached!=true');
    if (decision !== 'SETTLED_BY_MUTATION_QUIET') failed.push('settle:decision!=' + decision);
  }

  // ── Terminal cleanup ──
  const closes = eventsNamed(data.events, 'EMPTY-SPECIAL-TRANSACTION-CLOSE');
  const close = closes.length > 0 ? closes[0] : null;
  if (!close) failed.push('missing:EMPTY-SPECIAL-TRANSACTION-CLOSE');
  else {
    r.close = {
      observerDisconnected: getField(close, 'observerDisconnected'),
      timeoutCleared: getField(close, 'timeoutCleared'),
      activeTxnCleared: getField(close, 'activeTxnCleared'),
      terminal: getField(close, 'terminal'),
      overall: getField(close, 'overall'),
    };
    if (getField(close, 'observerDisconnected') !== true) failed.push('close:observerDisconnected!=true');
    if (getField(close, 'timeoutCleared') !== true) failed.push('close:timeoutCleared!=true');
    if (getField(close, 'activeTxnCleared') !== true) failed.push('close:activeTxnCleared!=true');
    if (getField(close, 'terminal') !== true) failed.push('close:terminal!=true');
    if (getField(close, 'overall') !== true) failed.push('close:overall!=true');

    const closeIdx = data.events.indexOf(close);
    const afterMuts = data.events.filter((e, i) => i > closeIdx && e.event === 'EMPTY-SPECIAL-MUTATION' && getField(e, 'txnId') === txnId);
    if (afterMuts.length > 0) failed.push('mutationAfterClose>0');
  }

  // ── Caret geometry ──
  const geoms = eventsNamed(data.events, 'EMPTY-SPECIAL-CARET-GEOMETRY').filter((e) => getField(e, 'txnId') === txnId);
  if (geoms.length === 0) failed.push('missing:EMPTY-SPECIAL-CARET-GEOMETRY');
  else {
    const g = geoms[0];
    const exp = getField(g, 'expectedIndentPx');
    const act = getField(g, 'actualCaretIndentPx');
    r.geometry = { expectedIndentPx: exp, actualCaretIndentPx: act, overall: getField(g, 'overall') };
    if (getField(g, 'overall') !== true) failed.push('geometry:overall!=true');
    if (!(typeof exp === 'number' && exp >= 28 && exp <= 36)) failed.push('geometry:expectedIndentPx~32');
    if (!(typeof act === 'number' && act >= 28 && act <= 36)) failed.push('geometry:actualCaretIndentPx~32');
  }

  // ── FINAL ──
  const fin = eventsNamed(data.events, 'EMPTY-SPECIAL-FINAL')[0];
  const finalBooleans = ['overall', 'logicalSlotPreserved', 'paragraphCountPreserved', 'canonicalOwnerCorrect', 'semanticCorrect', 'visualIndentCorrect', 'caretLogicalCorrect', 'caretVisualCorrect'];
  r.final = {};
  for (const b of finalBooleans) r.final[b] = getField(fin, b);
  for (const b of finalBooleans) if (getField(fin, b) !== true) failed.push('final:' + b + '!=true');
  if (getField(fin, 'unexpectedMerge') !== false) failed.push('final:unexpectedMerge!=false');
  if (getField(fin, 'unexpectedDelete') !== false) failed.push('final:unexpectedDelete!=false');

  // ── Scope / transfer leaks ──
  const scopeMismatch = eventsNamed(data.events, 'CANONICAL-SCOPE-MISMATCH').length;
  if (scopeMismatch > 0) failed.push('scopeMismatch>0');
  for (const aw of eventsNamed(data.events, 'AWAITING-TRANSFER-LEAK-AUDIT')) {
    const c = getField(aw, 'awaitingCount');
    if (typeof c === 'number' && c !== 0) failed.push('awaitingCount!=0');
  }

  // ── EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG detection ──
  const natOk = r.domNormalization && r.domNormalization.nativeEmptyEquivalentAfter === true;
  const caretVis = r.final && r.final.caretVisualCorrect;
  const actPx = r.geometry && r.geometry.actualCaretIndentPx;
  if (natOk && caretVis === false && typeof actPx === 'number' && actPx < 4) {
    r.visualCaretProjectionBug = 'CONFIRMED / RUNTIME';
  }

  r.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  r.failedChecks = failed;
  return r;
}

// ── Preflight ────────────────────────────────────────────────────────────────
async function preflight() {
  log('preflight START (read-only)');
  const projectMainExists = fs.existsSync(PROJECT_MAIN);
  const runtimeMainExists = fs.existsSync(RUNTIME_MAIN);
  const styleExists = fs.existsSync(PROJECT_STYLE);

  let projectMainSHA = null;
  let runtimeMainSHA = null;
  let styleSHA = null;
  try { if (projectMainExists) projectMainSHA = sha256Hex(PROJECT_MAIN); } catch {}
  try { if (runtimeMainExists) runtimeMainSHA = sha256Hex(RUNTIME_MAIN); } catch {}
  try { if (styleExists) styleSHA = sha256Hex(PROJECT_STYLE); } catch {}

  const shaMatch = projectMainSHA === runtimeMainSHA && projectMainSHA === EXPECTED_MAIN_SHA;
  const styleMatch = styleSHA === EXPECTED_STYLE_SHA;

  const fsState = fixtureState();
  const dotnetOk = await dotnetAvailable();
  const helperSourceExists = fs.existsSync(WIN32_CS);
  const helperBuilt = fs.existsSync(WIN32_DLL) && fs.existsSync(WIN32_RUNTIMECONFIG);

  const report = {
    mode: 'preflight',
    buildId: BUILD_ID,
    expectedBuildId: BUILD_ID,
    expectedMainSHA: EXPECTED_MAIN_SHA,
    expectedStyleSHA: EXPECTED_STYLE_SHA,
    projectMainExists,
    runtimeMainExists,
    projectMainSHA,
    runtimeMainSHA,
    shaMatch,
    styleSHA,
    styleMatch,
    fixture: fsState,
    parserExists: fs.existsSync(path.join(SCRIPT_DIR, 'empty-special-trial-parser.js')),
    auditDirExists: fs.existsSync(AUDIT_DIR),
    dotnetAvailable: dotnetOk,
    helperSourceExists,
    helperBuilt,
    verdict: (shaMatch && styleMatch && fsState.clean && projectMainExists && runtimeMainExists && styleExists && dotnetOk && helperSourceExists) ? 'PASS' : 'FAIL',
  };

  writeJson(path.join(ARTIFACTS_DIR, 'preflight.json'), report);
  log(`preflight shaMatch=${shaMatch} styleMatch=${styleMatch} fixtureClean=${fsState.clean} dotnet=${dotnetOk} verdict=${report.verdict}`);
  return report;
}

// ── Shared strict startup (close old → launch → poll) ───────────────────────
async function performStrictStartup(targetDoc, outFile) {
  log('strict startup START');
  const before = await enumerateTypora();
  const oldPid = (before && before.processes && before.processes.length > 0 && before.processes[0].mainWindowHandle !== 0)
    ? before.processes[0].pid
    : ((before && before.processes && before.processes.length > 0) ? before.processes[0].pid : 0);

  const close = await closeTypora();
  const processCountAfterClose = close ? close.afterCount : -1;
  const oldProcessExited = close ? close.closed : false;

  const startCmdAtMs = Date.now();
  const startCmdAtIso = new Date().toISOString();
  launchTypora(FIXTURE_ABS);

  // Wait for main window.
  const deadline = Date.now() + 30000;
  let main = null;
  while (Date.now() < deadline) {
    await sleep(500);
    const en = await enumerateTypora();
    const procs = (en && en.processes) || [];
    const win = procs.find((p) => p.mainWindowHandle !== 0 && (p.mainWindowTitle || '').includes(targetDoc));
    if (win) { main = win; break; }
  }

  const sha = {
    projectMainSHA: fs.existsSync(PROJECT_MAIN) ? sha256Hex(PROJECT_MAIN) : null,
    runtimeMainSHA: fs.existsSync(RUNTIME_MAIN) ? sha256Hex(RUNTIME_MAIN) : null,
    styleSHA: fs.existsSync(PROJECT_STYLE) ? sha256Hex(PROJECT_STYLE) : null,
  };
  const shaMatch = sha.projectMainSHA === sha.runtimeMainSHA && sha.projectMainSHA === EXPECTED_MAIN_SHA;
  const styleMatch = sha.styleSHA === EXPECTED_STYLE_SHA;

  const ready = await waitRuntimeReady(startCmdAtMs, BUILD_ID, targetDoc);
  const rl = ready.runtimeLoad;
  const authority = ready.authority;

  const newPid = main ? main.pid : null;
  const newStartTime = main ? main.startTimeIso : null;
  const hwnd = main ? main.mainWindowHandle : 0;
  const title = main ? main.mainWindowTitle : '';

  const mandatoryOk = !!(
    oldProcessExited &&
    processCountAfterClose === 0 &&
    main &&
    hwnd !== 0 &&
    title !== '' &&
    shaMatch &&
    styleMatch &&
    ready.ready &&
    rl && rl.buildMarker === BUILD_ID &&
    rl.initializationCount === 1 &&
    rl.mainJsSha256 === EXPECTED_MAIN_SHA &&
    authority && authority.decision === 'ACCEPT'
  );

  const report = {
    mode: 'strict-startup',
    oldPid,
    oldProcessExited,
    processCountAfterClose,
    newPid,
    newStartTime,
    startCmdAtIso,
    mainWindowHandle: hwnd,
    mainWindowTitle: title,
    targetVault: VAULT,
    targetDocument: targetDoc,
    runtimeMainPath: RUNTIME_MAIN,
    projectMainSHA: sha.projectMainSHA,
    runtimeMainSHA: sha.runtimeMainSHA,
    shaMatch,
    styleSHA: sha.styleSHA,
    styleMatch,
    buildId: BUILD_ID,
    runtimeBuildId: rl ? rl.buildMarker : null,
    initializationCount: rl ? rl.initializationCount : null,
    runtimeLoadMtimeMs: ready.runtimeLoadMtimeMs,
    runtimeLoadFresh: ready.runtimeLoadFresh,
    runtimeBuildOk: ready.runtimeBuildOk,
    runtimeShaOk: ready.runtimeShaOk,
    identityOk: ready.identityOk,
    readinessReady: ready.ready,
    auditPath: authority ? authority.auditPath : null,
    auditSessionId: authority ? authority.sessionId : null,
    auditBuildId: authority ? authority.buildId : null,
    auditDecision: authority ? authority.decision : null,
    auditAuthority: authority && authority.auditPath ? {
      auditPath: authority.auditPath,
      runtimeSessionId: authority.sessionId,
      buildId: authority.buildId,
      targetDocument: targetDoc,
      acceptedAt: new Date().toISOString(),
      byteOffsetAtAccept: fs.existsSync(authority.auditPath) ? fs.statSync(authority.auditPath).size : 0,
    } : null,
    strictStartup: mandatoryOk,
    verdict: mandatoryOk ? 'PASS' : 'FAIL',
    failedChecks: [],
  };
  if (!oldProcessExited) report.failedChecks.push('oldProcessNotExited');
  if (processCountAfterClose !== 0) report.failedChecks.push('processCountAfterClose!=0');
  if (!main) report.failedChecks.push('noMainWindow');
  else if (hwnd === 0) report.failedChecks.push('noMainWindowHandle');
  if (!shaMatch) report.failedChecks.push('mainShaMismatch');
  if (!styleMatch) report.failedChecks.push('styleShaMismatch');
  if (!ready.ready) report.failedChecks.push('runtimeNotReady');
  if (!rl || rl.buildMarker !== BUILD_ID) report.failedChecks.push('runtimeBuildMismatch');
  if (!rl || rl.initializationCount !== 1) report.failedChecks.push('initializationCount!=1');
  if (!rl || rl.mainJsSha256 !== EXPECTED_MAIN_SHA) report.failedChecks.push('runtimeMainShaMismatch');
  if (!authority || authority.decision !== 'ACCEPT') report.failedChecks.push('auditSessionAuthority:' + (authority ? authority.decision : 'none'));

  if (outFile) writeJson(outFile, report);
  log(`strict startup verdict=${report.verdict} failedChecks=${report.failedChecks.join(',')}`);
  return report;
}

// ── Run (self-contained strict startup + single E2-01 trial) ────────────────
function archiveStaleTrialArtifacts(trialDir) {
  if (!fs.existsSync(trialDir)) return;
  const entries = fs.readdirSync(trialDir, { withFileTypes: true }).filter((e) => e.isFile());
  if (entries.length === 0) return;
  const archiveDir = path.join(trialDir, 'previous-' + Date.now());
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const e of entries) {
    fs.renameSync(path.join(trialDir, e.name), path.join(archiveDir, e.name));
  }
  log(`archived ${entries.length} stale trial artifact(s) -> ${archiveDir}`);
}

async function run(scenario, trial) {
  const trialId = scenario.toLowerCase() + '-' + trial;
  const trialDir = path.join(ARTIFACTS_DIR, trialId);
  fs.mkdirSync(trialDir, { recursive: true });
  const trialStartedAt = new Date().toISOString();
  archiveStaleTrialArtifacts(trialDir);

  log(`run START scenario=${scenario} trial=${trial}`);

  // Fixture precondition (before any input).
  removeSidecar();
  const before = fixtureState();
  fs.writeFileSync(path.join(trialDir, 'fixture-before.bin'), fs.existsSync(FIXTURE_ABS) ? fs.readFileSync(FIXTURE_ABS) : Buffer.alloc(0));
  writeJson(path.join(trialDir, 'sidecar-before.json'), {
    sidecarExists: before.sidecarExists,
    sidecarRecordCount: before.sidecarRecordCount,
  });

  if (!before.clean) {
    const reason = before.fixtureExists ? (before.sidecarExists ? 'FIXTURE_NOT_CLEAN' : 'FIXTURE_BYTES_MISMATCH') : 'FIXTURE_MISSING';
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: reason, sendEnterCallCount: 0, failedChecks: [reason] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log(`run INVALID reason=${reason}`);
    return rep;
  }

  // Strict startup (close old → launch on fixture → poll readiness).
  const startup = await performStrictStartup(FIXTURE, path.join(trialDir, 'strict-startup.json'));
  if (startup.verdict !== 'PASS') {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: 'STRICT_STARTUP_FAILED', sendEnterCallCount: 0, failedChecks: startup.failedChecks };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log(`run INVALID reason=STRICT_STARTUP_FAILED`);
    return rep;
  }

  const authority = startup.auditPath
    ? await auditSessionIdentity(startup.auditPath)
    : { auditPath: null, identity: null, initializationCount: null, activeDoc: null, vaultRoot: null };
  writeJson(path.join(trialDir, 'runtime-identity.json'), {
    auditPath: authority.auditPath,
    readyFound: authority.readyFound,
    identityFound: authority.identityFound,
    buildId: authority.buildId,
    runtimeSessionId: authority.sessionId,
    initializationCount: authority.initializationCount,
    activeDoc: authority.activeDoc,
    vaultRoot: authority.vaultRoot,
    parseFailureCount: authority.parseFailureCount,
    trialId,
    trialStartedAt,
  });

  const auditPath = startup.auditPath;
  if (!auditPath || !fs.existsSync(auditPath)) {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: 'NO_AUDIT_FILE', sendEnterCallCount: 0, failedChecks: ['NO_AUDIT_FILE'] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log('run INVALID reason=NO_AUDIT_FILE');
    return rep;
  }

  // Trial artifact authority binding (current Build + current accepted session).
  const runtimeSessionId = sessionIdFromAuditPath(auditPath);
  const bindArtifact = (obj) => ({ ...obj, ...buildTrialBinding({ buildId: BUILD_ID, runtimeSessionId, auditPath, trialId, trialStartedAt }) });

  const main = await enumerateTypora();
  const proc = (main && main.processes && main.processes.find((p) => p.mainWindowHandle !== 0 && (p.mainWindowTitle || '').includes(FIXTURE))) || (main && main.processes && main.processes[0]);
  if (!proc || proc.mainWindowHandle === 0) {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: 'NO_MAIN_WINDOW', sendEnterCallCount: 0, failedChecks: ['NO_MAIN_WINDOW'] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log('run INVALID reason=NO_MAIN_WINDOW');
    return rep;
  }
  const hwnd = proc.mainWindowHandle;

  // ── E2 Runtime Precondition (bounded wait/poll on accepted audit authority) ──
  const preconditionAuthority = startup.auditAuthority || {
    auditPath,
    runtimeSessionId: sessionIdFromAuditPath(auditPath),
    buildId: BUILD_ID,
    targetDocument: FIXTURE,
    acceptedAt: new Date().toISOString(),
    byteOffsetAtAccept: fs.existsSync(auditPath) ? fs.statSync(auditPath).size : 0,
  };
  const precondWait = await waitForRuntimePreconditions(preconditionAuthority, FIXTURE, FIXTURE, 5000, 100);
  const precondArtifact = buildPreconditionArtifact(precondWait.observation, { scopeId: FIXTURE, documentKey: FIXTURE }, {
    scenario,
    trialId,
    expectedBuildId: BUILD_ID,
    auditPath,
    auditAuthorityAccepted: !!(startup.auditAuthority && startup.auditAuthority.auditPath === auditPath),
    fixtureExists: before.fixtureExists,
    fixtureClean: before.clean,
    waitStartedAt: precondWait.waitStartedAt,
    waitEndedAt: precondWait.waitEndedAt,
    waitDurationMs: precondWait.waitDurationMs,
    pollCount: precondWait.pollCount,
  });
  writeJson(path.join(trialDir, 'trial-precondition.json'), precondArtifact);
  log(`E2-RUNTIME-PRECONDITION overall=${precondArtifact.overall} invalidReason=${precondArtifact.invalidReason || 'null'} readyCount=${precondArtifact.documentContextReadyCount} sidecarCount=${precondArtifact.sidecarLoadCount}`);
  if (!precondArtifact.overall) {
    const rep = {
      mode: 'run',
      scenario,
      trialId,
      verdict: 'INVALID',
      invalidReason: precondArtifact.invalidReason,
      sendEnterCallCount: 0,
      failedChecks: [precondArtifact.invalidReason],
      precondition: precondArtifact,
    };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log(`run INVALID reason=${precondArtifact.invalidReason}`);
    return rep;
  }

  // Trial byte window starts AFTER the precondition observation (clean window).
  const byteOffsetStart = fs.statSync(auditPath).size;

  // Token input (。。) with foreground gate + focus probe capture.
  const tokenInject = await injectKeys(hwnd, [VK_OEM_PERIOD, VK_OEM_PERIOD], 120, true);
  const tokenInjectGate = evaluateInjectionGate(tokenInject);
  // DURABLE: always write input-injection-audit before any token proof / early return.
  writeJson(path.join(trialDir, 'input-injection-audit.json'), bindArtifact({
    ...tokenInject,
    available: true,
    overall: tokenInjectGate.verdict === 'PASS',
    invalidReason: tokenInjectGate.invalidReason,
  }));
  // DURABLE: always write editor-input-focus-audit (renderer probe is unavailable
  // to the harness, so the finalDecision is classified honestly).
  if (tokenInject.focus) {
    const focusAudit = buildFocusAuditArtifact({
      beforeAcquire: buildFocusSnapshot('BEFORE_ACQUIRE', tokenInject.focus.beforeAcquire, hwnd),
      afterAcquire: buildFocusSnapshot('AFTER_ACQUIRE', tokenInject.focus.afterAcquire, hwnd),
      beforeInput: buildFocusSnapshot('BEFORE_INPUT', tokenInject.focus.beforeInput, hwnd),
      afterInput: buildFocusSnapshot('AFTER_INPUT', tokenInject.focus.afterInput, hwnd),
    });
    writeJson(path.join(trialDir, 'editor-input-focus-audit.json'), bindArtifact(focusAudit));
  }
  if (tokenInjectGate.verdict !== 'PASS') {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: tokenInjectGate.invalidReason, sendEnterCallCount: 0, failedChecks: [tokenInjectGate.invalidReason] };
    writeJson(path.join(trialDir, 'trial-summary.json'), bindArtifact(rep));
    log(`run INVALID reason=${tokenInjectGate.invalidReason}`);
    return rep;
  }

  // Token observation (bounded wait/poll) BEFORE Enter.
  await sleep(500);
  const tokenObs = await waitForTokenProof(auditPath, byteOffsetStart, 5000);

  // DURABLE: always write current-trial delta + delta-meta (even 0 events).
  const tokenObsEnd = fs.statSync(auditPath).size;
  let tokenDeltaText = '';
  if (tokenObsEnd > byteOffsetStart) {
    try {
      tokenDeltaText = decodeUtf8(await readBytesRange(auditPath, byteOffsetStart, tokenObsEnd));
    } catch {
      tokenDeltaText = '';
    }
  }
  fs.writeFileSync(path.join(trialDir, 'trial.delta.jsonl'), tokenDeltaText, 'utf8');
  const tokenDeltaParsed = parseJsonLines(tokenDeltaText);
  const deltaMeta = bindArtifact(buildDeltaMetaRecord({
    byteOffsetStart,
    byteOffsetEnd: tokenObsEnd,
    deltaBytes: tokenObsEnd - byteOffsetStart,
    deltaLineCount: tokenDeltaParsed.lineCount,
    eventCount: tokenDeltaParsed.events.length,
    keyboardEventCount: tokenObs.keyboardEventCount ?? 0,
    beforeInputCount: tokenObs.beforeInputCount ?? 0,
    inputCount: tokenObs.inputCount ?? 0,
    compositionStartCount: tokenObs.compositionStartCount ?? 0,
    compositionEndCount: tokenObs.compositionEndCount ?? 0,
    staleEventDropCount: 0,
    parseFailureCount: tokenDeltaParsed.parseFailureCount,
    authorityValid: true,
    overall: tokenObs.verdict === 'PASS',
    invalidReason: tokenObs.verdict === 'PASS' ? null : tokenObs.invalidReason,
  }));
  writeJson(path.join(trialDir, 'trial-delta-meta.json'), deltaMeta);

  // Single final token verdict authority.
  const tokenFinal = evaluateTokenProofFinal({ available: true }, { available: true }, tokenObs);
  writeJson(path.join(trialDir, 'special-token-provenance.json'), bindArtifact({ ...tokenObs, ...tokenFinal }));
  if (!tokenFinal.overall) {
    const invalidReason = tokenFinal.invalidReason;
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason, sendEnterCallCount: 0, tokenProof: tokenFinal, failedChecks: [invalidReason] };
    writeJson(path.join(trialDir, 'trial-summary.json'), bindArtifact(rep));
    log(`run INVALID reason=${invalidReason}`);
    return rep;
  }

  // Enter (only after token proven).
  const enterInject = await injectKeys(hwnd, [VK_RETURN], 120);
  writeJson(path.join(trialDir, 'input-injection-audit.json'), bindArtifact(enterInject));
  const enterGate = evaluateInjectionGate(enterInject);
  if (enterGate.verdict !== 'PASS') {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: enterGate.invalidReason, sendEnterCallCount: 1, failedChecks: [enterGate.invalidReason] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log(`run INVALID reason=${enterGate.invalidReason}`);
    return rep;
  }

  // Wait for FINAL + stable flush.
  const finalEvent = await waitForEvent(auditPath, byteOffsetStart, ['EMPTY-SPECIAL-FINAL'], 20000);
  if (!finalEvent) {
    const rep = { mode: 'run', scenario, trialId, verdict: 'FAIL', invalidReason: null, sendEnterCallCount: 1, failedChecks: ['NO_EMPTY-SPECIAL-FINAL'] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log('run FAIL reason=NO_EMPTY-SPECIAL-FINAL');
    return rep;
  }
  await sleep(2600);
  await waitFileStable(auditPath, 3, 400, 10000);
  const byteOffsetEnd = fs.statSync(auditPath).size;

  // Byte-window delta (fs.open/fs.read + TextDecoder fatal + JSON.parse).
  let deltaText;
  try {
    const bytes = await readBytesRange(auditPath, byteOffsetStart, byteOffsetEnd);
    deltaText = decodeUtf8(bytes);
  } catch (e) {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: 'JSONL_UTF8_PARSE_FAILURE', sendEnterCallCount: 1, failedChecks: ['JSONL_UTF8_PARSE_FAILURE'] };
    writeJson(path.join(trialDir, 'trial-summary.json'), rep);
    log('run INVALID reason=JSONL_UTF8_PARSE_FAILURE');
    return rep;
  }
  fs.writeFileSync(path.join(trialDir, 'trial.delta.jsonl'), deltaText, 'utf8');

  const parsed = parseJsonLines(deltaText);

  // Verify current Build/session only — no stale es2b7q / previous-session events.
  let contaminated = false;
  let staleCount = 0;
  for (const ev of parsed.events) {
    const evBuild = getField(ev, 'buildId');
    const evSession = getField(ev, 'sessionId');
    if ((evBuild != null && evBuild !== BUILD_ID) || (runtimeSessionId && evSession != null && evSession !== runtimeSessionId)) {
      contaminated = true;
      staleCount++;
    }
  }
  writeJson(path.join(trialDir, 'trial-delta-meta.json'), bindArtifact({
    available: true,
    byteOffsetStart,
    byteOffsetEnd,
    deltaBytes: byteOffsetEnd - byteOffsetStart,
    deltaLineCount: parsed.lineCount,
    eventCount: parsed.events.length,
    keyboardEventCount: tokenObs.keyboardEventCount ?? 0,
    beforeInputCount: tokenObs.beforeInputCount ?? 0,
    inputCount: tokenObs.inputCount ?? 0,
    compositionStartCount: tokenObs.compositionStartCount ?? 0,
    compositionEndCount: tokenObs.compositionEndCount ?? 0,
    staleEventDropCount: staleCount,
    parseFailureCount: parsed.parseFailureCount,
    authorityValid: !contaminated,
    contaminated,
    staleCount,
    overall: !contaminated,
    invalidReason: contaminated ? INVALID_REASONS.TRIAL_DELTA_SESSION_CONTAMINATION : null,
  }));
  if (contaminated) {
    const rep = { mode: 'run', scenario, trialId, verdict: 'INVALID', invalidReason: INVALID_REASONS.TRIAL_DELTA_SESSION_CONTAMINATION, sendEnterCallCount: 1, failedChecks: ['TRIAL_DELTA_SESSION_CONTAMINATION'] };
    writeJson(path.join(trialDir, 'trial-summary.json'), bindArtifact(rep));
    log('run INVALID reason=TRIAL_DELTA_SESSION_CONTAMINATION');
    return rep;
  }

  const verdict = buildVerdict(parsed);

  // Post-trial fixture / sidecar snapshots.
  const after = fixtureState();
  fs.writeFileSync(path.join(trialDir, 'fixture-after.bin'), fs.existsSync(FIXTURE_ABS) ? fs.readFileSync(FIXTURE_ABS) : Buffer.alloc(0));
  writeJson(path.join(trialDir, 'sidecar-after.json'), { sidecarExists: after.sidecarExists, sidecarRecordCount: after.sidecarRecordCount });

  const summary = {
    mode: 'run',
    scenario,
    trialId,
    fixture: FIXTURE,
    auditPath,
    byteOffsetStart,
    byteOffsetEnd,
    deltaBytes: byteOffsetEnd - byteOffsetStart,
    runtimeBuildId: BUILD_ID,
    runtimeMainSHA: EXPECTED_MAIN_SHA,
    sendEnterCallCount: 1,
    tokenProof,
    verdict: verdict.verdict,
    invalidReason: verdict.invalidReason,
    failedChecks: verdict.failedChecks,
    txnId: verdict.txnId,
    routing: verdict.routing,
    spanPredicate: verdict.spanPredicate,
    domNormalization: verdict.domNormalization,
    settle: verdict.settle,
    geometry: verdict.geometry,
    close: verdict.close,
    final: verdict.final,
    visualCaretProjectionBug: verdict.visualCaretProjectionBug || null,
  };
  writeJson(path.join(trialDir, 'trial-summary.json'), bindArtifact(summary));
  log(`run verdict=${verdict.verdict} invalid=${verdict.invalidReason || 'none'} bug=${verdict.visualCaretProjectionBug || 'none'}`);
  return summary;
}

// ── Phase B hard authority gate ─────────────────────────────────────────────
async function currentRuntimeAuthority() {
  const rl = readRuntimeLoad();
  const files = auditFiles();
  const latest = files[0] ?? null;
  const audit = latest ? await auditSessionIdentity(latest) : null;
  return {
    sessionId: audit?.sessionId ?? null,
    auditSessionId: audit?.sessionId ?? null,
    auditPath: latest,
    buildId: rl?.buildMarker ?? audit?.buildId ?? null,
    mainSha: fs.existsSync(RUNTIME_MAIN) ? sha256Hex(RUNTIME_MAIN) : null,
    styleSha: fs.existsSync(RUNTIME_STYLE) ? sha256Hex(RUNTIME_STYLE) : null,
    initializationCount: audit?.initializationCount ?? rl?.initializationCount ?? null,
    document: audit?.activeDoc ?? rl?.activeDoc ?? null,
    vault: audit?.vaultRoot ?? rl?.vaultRoot ?? VAULT,
  };
}

async function phaseBAuthority() {
  log('phase-b authority START');
  const formalPath = path.join(ARTIFACTS_DIR, 'strict-startup.json');
  let formal = null;
  if (fs.existsSync(formalPath)) {
    try { formal = JSON.parse(fs.readFileSync(formalPath, 'utf8')); } catch (e) { formal = { __parseError: String(e) }; }
  }
  const current = await currentRuntimeAuthority();
  const result = evaluatePhaseBAuthority(formal, current);

  log(`formalSessionId=${formal?.auditSessionId ?? formal?.formalSessionId ?? 'null'}`);
  log(`currentSessionId=${current.sessionId ?? 'null'}`);
  log(`formalDocumentRaw=${result.formalDocumentRaw ?? 'null'}`);
  log(`currentDocumentRaw=${result.currentDocumentRaw ?? 'null'}`);
  log(`formalDocumentKey=${result.formalDocumentKey ?? 'null'}`);
  log(`currentDocumentKey=${result.currentDocumentKey ?? 'null'}`);
  log(`documentMatch=${result.documentMatch}`);
  log(`formalBuildId=${formal?.runtimeBuildId ?? formal?.buildId ?? 'null'}`);
  log(`currentBuildId=${current.buildId ?? 'null'}`);
  log(`verdict=${result.overall ? 'PASS' : 'FAIL'} failedChecks=${result.failedChecks.join(',')}`);

  const report = {
    mode: 'phase-b-authority',
    formal: formal ? {
      sessionId: formal.auditSessionId ?? formal.formalSessionId ?? null,
      buildId: formal.runtimeBuildId ?? formal.buildId ?? null,
      mainSha: formal.runtimeMainSHA ?? null,
      styleSha: formal.styleSHA ?? null,
      vault: formal.targetVault ?? null,
      document: formal.targetDocument ?? null,
      verdict: formal.verdict ?? null,
    } : null,
    current,
    ...result,
  };
  writeJson(path.join(ARTIFACTS_DIR, 'phase-b-authority.json'), report);
  return report;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  TYPORA_EXE = args.typoraExe || process.env.INKCHAPTER_TYPORA_EXE || DEFAULT_TYPORA_EXE;
  log(`run-empty-special-gate mode=${args.mode} buildId=${BUILD_ID}`);
  logResolvedPaths();

  if (args.mode === 'preflight') {
    const r = await preflight();
    process.exitCode = r.verdict === 'PASS' ? 0 : 1;
    return;
  }

  if (args.mode === 'paths') {
    process.exitCode = 0;
    return;
  }

  if (args.mode === 'strict-startup') {
    await ensureHelperBuilt();
    const r = await performStrictStartup(FIXTURE, path.join(ARTIFACTS_DIR, 'strict-startup.json'));
    process.exitCode = r.verdict === 'PASS' ? 0 : 1;
    return;
  }

  if (args.mode === 'phase-b-authority') {
    const r = await phaseBAuthority();
    process.exitCode = r.overall ? 0 : 1;
    return;
  }

  if (args.mode === 'run') {
    await ensureHelperBuilt();
    const r = await run(args.scenario, args.trial);
    process.exitCode = r.verdict === 'PASS' ? 0 : 1;
    return;
  }

  log('unknown mode: ' + args.mode);
  process.exitCode = 2;
}

main().catch((e) => {
  log('FATAL: ' + ((e && e.stack) || e));
  try {
    writeJson(path.join(ARTIFACTS_DIR, 'runner-error.json'), { error: String((e && e.message) || e), stack: String((e && e.stack) || '') });
  } catch {}
  process.exit(1);
});

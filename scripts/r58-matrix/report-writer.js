// report-writer.js — generates final-summary.md / final-summary.json for R58 Final Matrix.
//
// Usage: node report-writer.js --dir artifacts/r58-final

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { dir: 'artifacts/r58-final' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i];
  }
  return a;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const a = parseArgs(process.argv);
  const dir = a.dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const scenarios = readJson(path.join(__dirname, 'scenarios.json')) || { trials: [] };
  const startup = readJson(path.join(dir, 'strict-startup.json')) || readJson(path.join(dir, 'startup.json')) || {};
  const sinkSmoke = readJson(path.join(dir, 'sink-runtime-smoke.json')) || {};
  const smoke = readJson(path.join(dir, 'input-smoke.json')) || {};

  const trials = [];
  let pass = 0, fail = 0, invalid = 0;
  for (const t of scenarios.trials || []) {
    const verdict = readJson(path.join(dir, t.trial + '.json'));
    if (!verdict) {
      trials.push({ trial: t.trial, fixture: t.fixture, type: t.type, verdict: 'NOT_RUN' });
      continue;
    }
    verdict.trial = t.trial;
    verdict.fixture = t.fixture;
    verdict.type = t.type;
    trials.push(verdict);
    if (verdict.verdict === 'PASS') pass++;
    else if (verdict.verdict === 'FAIL') fail++;
    else invalid++;
  }

  const total = trials.length;
  const reducedMatrix = pass === 7 && fail === 0 && invalid === 0 ? '7/7 PASS' : 'NOT PASSED';
  const practicalClosure = reducedMatrix === '7/7 PASS' ? 'PASS' : 'FAIL';

  const summary = {
    buildId: scenarios.buildId || '',
    mainSHA: scenarios.expectedMainSha || '',
    styleSHA: scenarios.expectedStyleSha || '',
    strictStartup: startup.strictStartup === true,
    inputSmoke: smoke.verdict || 'NOT_RUN',
    trials,
    passCount: pass,
    failCount: fail,
    invalidCount: invalid,
    totalRun: total,
    reducedMatrix,
    practicalClosure,
    extendedStressMatrix: 'WAIVED / NOT EXECUTED',
    R60: practicalClosure === 'PASS' ? 'MAY PROCEED UNDER REDUCED-MATRIX WAIVER' : 'BLOCKED',
  };

  fs.writeFileSync(path.join(dir, 'final-summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# R58 Final Reduced Matrix Summary');
  lines.push('');
  lines.push('```text');
  lines.push('=== BUILD ===');
  lines.push('buildId: ' + summary.buildId);
  lines.push('mainSHA: ' + summary.mainSHA);
  lines.push('styleSHA: ' + summary.styleSHA);
  lines.push('');
  lines.push('=== STARTUP ===');
  lines.push('oldPid: ' + (startup.oldPid ?? ''));
  lines.push('oldPidExited: ' + (startup.oldPidExited ?? ''));
  lines.push('processCountAfterClose: ' + (startup.processCountAfterClose ?? ''));
  lines.push('newPid: ' + (startup.newPid ?? ''));
  lines.push('startTime: ' + (startup.startTime ?? ''));
  lines.push('mainWindowHandle: ' + (startup.mainWindowHandle ?? ''));
  lines.push('mainWindowTitle: ' + (startup.mainWindowTitle ?? ''));
  lines.push('targetVault: ' + (startup.targetVault ?? ''));
  lines.push('targetDocument: ' + (startup.targetDocument ?? ''));
  lines.push('mainMatch: ' + (startup.mainMatch ?? ''));
  lines.push('cssMatch: ' + (startup.cssMatch ?? ''));
  lines.push('runtimeBuildId: ' + (startup.runtimeBuildId ?? ''));
  lines.push('initializationCount: ' + (startup.initializationCount ?? ''));
  lines.push('strictStartup: ' + (summary.strictStartup ? 'PASS' : 'FAIL'));
  lines.push('');
  lines.push('=== INPUT SMOKE ===');
  lines.push('trustedInput: ' + (smoke.trustedInput ?? ''));
  lines.push('imeProvenance: ' + (smoke.imeProvenance ?? ''));
  lines.push('verdict: ' + (smoke.verdict ?? 'NOT_RUN'));
  lines.push('');
  for (const t of trials) {
    lines.push('=== ' + t.trial + ' ===');
    lines.push('verdict: ' + t.verdict);
    if (t.failedChecks && t.failedChecks.length) lines.push('failedChecks: ' + t.failedChecks.join(', '));
  }
  lines.push('');
  lines.push('=== FINAL ===');
  lines.push('totalPass: ' + pass);
  lines.push('totalFail: ' + fail);
  lines.push('totalInvalid: ' + invalid);
  lines.push('reducedMatrix: ' + reducedMatrix);
  lines.push('practicalClosure: ' + practicalClosure);
  lines.push('extendedStressMatrix: WAIVED / NOT EXECUTED');
  lines.push('R60: ' + summary.R60);
  lines.push('```');
  lines.push('');

  fs.writeFileSync(path.join(dir, 'final-summary.md'), lines.join('\n'));
  console.log(JSON.stringify({ passCount: pass, failCount: fail, invalidCount: invalid, reducedMatrix, practicalClosure, R60: summary.R60 }));
}

main();

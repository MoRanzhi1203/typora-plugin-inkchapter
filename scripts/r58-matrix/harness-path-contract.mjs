// Harness path contract: verify run-empty-special-gate.mjs resolves the SAME
// repo root from any cwd (import.meta.url based, not process.cwd() based).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const HARNESS = path.join(SCRIPT_DIR, 'run-empty-special-gate.mjs');

function runFrom(cwd) {
  const r = spawnSync(process.execPath, [HARNESS, '--mode', 'paths'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  const out = r.stdout || '';
  const grab = (key) => {
    const m = out.match(new RegExp(key + '=(.*)'));
    return m ? m[1].trim() : null;
  };
  return {
    code: r.status,
    scriptDir: grab('resolvedScriptDir'),
    repoRoot: grab('resolvedRepoRoot'),
  };
}

const cwds = {
  repoRoot: REPO_ROOT,
  scriptDir: SCRIPT_DIR,
  unrelated: process.env.TEMP || 'C:\\Windows\\Temp',
};

const results = {};
let failed = false;
for (const [label, cwd] of Object.entries(cwds)) {
  results[label] = runFrom(cwd);
  const r = results[label];
  const okRoot = r.repoRoot === REPO_ROOT;
  const okScript = r.scriptDir === SCRIPT_DIR;
  const okCode = r.code === 0;
  console.log(`[contract] ${label}: cwd=${cwd} exit=${r.code} repoRoot=${r.repoRoot} scriptDir=${r.scriptDir} ok=${okRoot && okScript && okCode}`);
  if (!okRoot || !okScript || !okCode) failed = true;
}

const roots = new Set(Object.values(results).map((r) => r.repoRoot));
if (roots.size !== 1) {
  console.error('[contract] FAIL: resolvedRepoRoot differs across cwd: ' + JSON.stringify([...roots]));
  failed = true;
}

if (failed) {
  console.error('[contract] RESULT=FAIL');
  process.exit(1);
}
console.log('[contract] RESULT=PASS');

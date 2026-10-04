#!/usr/bin/env node
/**
 * Capability Matrix V2 §10 — the ONE generator for
 * `docs/diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md`.
 *
 * It merges the FOUR §10 sources:
 *   1. the ONE registry (`DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`);
 *   2. the Runtime Code Resolver;
 *   3. the Static Test Manifest  — re-derived by scanning the repo's *.test.ts;
 *   4. the Runtime Evidence Manifest — `docs/diagnostics/runtime-evidence/
 *      document-diagnostics-runtime-evidence.json`, VALIDATED against the
 *      CURRENT build SHA (dist/main.js), the on-disk fixtures and the real
 *      audit sessions.
 *
 * The capability authority is TypeScript; this plain-Node ESM script bundles it
 * with the already-present esbuild devDependency (no new deps, no TS runtime) via
 * an in-memory entry, then writes the deterministic markdown it returns.
 *
 * Running it twice produces byte-identical output (no timestamps / randomness),
 * so `git diff` stays clean. The script asserts determinism itself and prints
 * both SHA-256 hashes.
 */
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const srcDir = path.join(root, 'src', 'document-utilities')

const outDir = path.join(root, 'docs', 'diagnostics')
const outFile = path.join(outDir, 'DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md')
const evidenceFile = path.join(outDir, 'runtime-evidence', 'document-diagnostics-runtime-evidence.json')
const sessionsDir = path.join(outDir, 'runtime-evidence', 'sessions')
const distMain = path.join(root, 'dist', 'main.js')

// ── source 3: the Static Test Manifest (scan the repo's *.test.ts) ──────────

/** Recursively collect every `*.test.ts` under `dir`. */
function collectTestFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectTestFiles(full))
    else if (name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function readStaticTestSources() {
  return collectTestFiles(path.join(root, 'src'))
    .sort()
    .map(full => ({
      path: path.relative(root, full).replace(/\\/g, '/'),
      content: readFileSync(full, 'utf8'),
    }))
}

// ── source 4: the Runtime Evidence Manifest + its CURRENT-build environment ──

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readCurrentMainSha256() {
  return existsSync(distMain) ? sha256(readFileSync(distMain)) : null
}

function readRuntimeEvidence() {
  if (!existsSync(evidenceFile)) return []
  const parsed = JSON.parse(readFileSync(evidenceFile, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('runtime evidence manifest must be a JSON ARRAY')
  return parsed
}

function buildEvidenceEnvironment() {
  return {
    currentMainSha256: readCurrentMainSha256(),
    fixtureExists: (fixture) => existsSync(path.resolve(root, fixture)),
    // A "real audit session" is a recorded Fresh-Runtime-Identity session file.
    isKnownSession: (sessionId) => existsSync(path.join(sessionsDir, `${sessionId}.json`)),
  }
}

// ── bundle the TS authority (in-memory entry, no extra source file) ─────────

const result = await build({
  stdin: {
    contents: [
      "export { formatDocumentDiagnosticCapabilityMatrixMarkdown } from './document-diagnostic-capability-summary'",
      "export { buildDocumentDiagnosticStaticTestManifest } from './document-diagnostic-static-test-manifest'",
      "export { resolveDocumentDiagnosticsCapabilityAudit, computeRuntimeClosureGates, resolveDocumentDiagnosticRuntimeClosureAudits, formatDocumentDiagnosticRuntimeClosureAudit } from './document-diagnostic-runtime-closure-authority'",
    ].join('\n'),
    resolveDir: srcDir,
    sourcefile: 'capability-matrix-generator-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  write: false,
  logLevel: 'silent',
})

if (!result.outputFiles || result.outputFiles.length === 0) {
  throw new Error('esbuild produced no output for the capability matrix entry')
}

const tmpFile = path.join(os.tmpdir(), `inkchapter-capability-matrix-${process.pid}.mjs`)
writeFileSync(tmpFile, result.outputFiles[0].text, 'utf8')

let markdownFirst
let markdownSecond
let audit
let gates
let audits
let testFileCount
try {
  const mod = await import(pathToFileURL(tmpFile).href)
  const sources = readStaticTestSources()
  testFileCount = sources.length
  const staticTestManifest = mod.buildDocumentDiagnosticStaticTestManifest(sources)
  const input = {
    staticTestManifest,
    runtimeEvidence: readRuntimeEvidence(),
    evidenceEnvironment: buildEvidenceEnvironment(),
  }
  // §10 — determinism self-check: two evaluations must be byte-identical.
  markdownFirst = mod.formatDocumentDiagnosticCapabilityMatrixMarkdown(input)
  markdownSecond = mod.formatDocumentDiagnosticCapabilityMatrixMarkdown(input)
  audit = mod.resolveDocumentDiagnosticsCapabilityAudit(input)
  gates = mod.computeRuntimeClosureGates(input)
  audits = mod.resolveDocumentDiagnosticRuntimeClosureAudits(input).map(mod.formatDocumentDiagnosticRuntimeClosureAudit)
} finally {
  rmSync(tmpFile, { force: true })
}

const hashFirst = sha256(markdownFirst)
const hashSecond = sha256(markdownSecond)
if (markdownFirst !== markdownSecond) {
  throw new Error(`NON-DETERMINISTIC generation: ${hashFirst} !== ${hashSecond}`)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, markdownFirst, 'utf8')

// §19/§20 — emit the audits (deterministic stdout; no runtime side effects).
process.stdout.write(`Wrote ${path.relative(root, outFile).replace(/\\/g, '/')}\n`)
process.stdout.write(`staticTestFiles=${testFileCount} matrixSha256#1=${hashFirst} matrixSha256#2=${hashSecond}\n`)
process.stdout.write('DOCUMENT-DIAGNOSTICS-CAPABILITY-AUDIT\n')
for (const [key, value] of Object.entries(audit)) {
  process.stdout.write(`  ${key}=${Array.isArray(value) ? value.join(',') : value}\n`)
}
process.stdout.write('DOCUMENT-DIAGNOSTIC-RUNTIME-CLOSURE-GATES\n')
for (const [key, value] of Object.entries(gates)) {
  process.stdout.write(`  ${key}=${value}\n`)
}
process.stdout.write('DOCUMENT-DIAGNOSTIC-RUNTIME-CLOSURE-AUDIT (per family)\n')
for (const lines of audits) {
  for (const line of lines) process.stdout.write(`  ${line}\n`)
}

#!/usr/bin/env node
/**
 * Capability Matrix V1 §5 — the ONE generator for
 * `docs/diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md`.
 *
 * The capability authority is TypeScript; this plain-Node ESM script uses the
 * already-present esbuild devDependency to bundle the summary module (no new
 * deps, no TS runtime) and then writes the deterministic markdown it returns.
 *
 * Running it twice produces byte-identical output (no timestamps / randomness),
 * so `git diff` stays clean.
 */
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

const entry = path.join(root, 'src', 'document-utilities', 'document-diagnostic-capability-summary.ts')
const outDir = path.join(root, 'docs', 'diagnostics')
const outFile = path.join(outDir, 'DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md')

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  write: false,
  logLevel: 'silent',
})

if (!result.outputFiles || result.outputFiles.length === 0) {
  throw new Error('esbuild produced no output for the capability summary entry')
}

const bundled = result.outputFiles[0].text
const tmpFile = path.join(os.tmpdir(), `inkchapter-capability-matrix-${process.pid}.mjs`)
writeFileSync(tmpFile, bundled, 'utf8')

let markdown
try {
  const mod = await import(pathToFileURL(tmpFile).href)
  markdown = mod.formatDocumentDiagnosticCapabilityMatrixMarkdown()
} finally {
  rmSync(tmpFile, { force: true })
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, markdown, 'utf8')
process.stdout.write(`Wrote ${path.relative(root, outFile).replace(/\\/g, '/')}\n`)

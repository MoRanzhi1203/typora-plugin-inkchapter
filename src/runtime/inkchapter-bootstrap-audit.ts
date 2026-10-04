// ── InkChapter Global Bootstrap Provenance (V1 §A) ──────────────────────────
// The EARLIEST evidence that the InkChapter bundle actually executed. It runs at
// MODULE evaluation time — before `initializeForensicSink`, before the
// DocumentContext / Document Utilities / Heading Numbering bootstrap — and it
// writes to a USER-LEVEL path so it can NEVER depend on:
//   vaultRoot / workspaceRoot / activeFile / a local `.typora`.
//
// It records REAL runtime provenance (the executing module path), never a path
// merely because it is "expected" to exist.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const BOOTSTRAP_AUDIT_EVENT = 'INKCHAPTER-BOOTSTRAP-AUDIT'

export type BootstrapLoadSource = 'GLOBAL' | 'VAULT_LOCAL' | 'UNKNOWN'

export interface BootstrapProvenance {
  processId: number
  pluginId: string
  buildMarker: string
  /** Absolute path of the module that is ACTUALLY executing (null when unknown). */
  actualBundlePath: string | null
  actualPluginRoot: string | null
  actualManifestPath: string | null
  frameworkReportedPluginRoot: string | null
  frameworkReportedPluginId: string | null
  globalPluginRootExpected: string
  loadSource: BootstrapLoadSource
  entryModuleEvaluated: boolean
  decision: 'PASS' | 'UNKNOWN'
  reason: string
}

export interface BootstrapProvenanceInput {
  processId: number
  pluginId: string
  buildMarker: string
  /** The executing module file (best-effort, from `__filename`). */
  runtimeModulePath: string | null
  /** Framework-reported plugin root, when the framework exposes one. */
  frameworkReportedPluginRoot: string | null
  frameworkReportedPluginId: string | null
  /** OS user home (injected — never hardcoded). */
  userHome: string | null
}

/** `~/.typora/inkchapter/audit` — the USER-LEVEL audit directory. */
export function resolveUserLevelAuditDir(userHome: string | null): string | null {
  if (userHome == null || userHome.trim() === '') return null
  return path.join(userHome.trim(), '.typora', 'inkchapter', 'audit')
}

function normalise(p: string | null): string | null {
  if (p == null) return null
  return p.replace(/\\/g, '/')
}

function classifyLoadSource(actualBundlePath: string | null, globalRoot: string): BootstrapLoadSource {
  const a = normalise(actualBundlePath)
  if (a == null) return 'UNKNOWN'
  const g = normalise(globalRoot)
  if (g != null && a.startsWith(`${g}/`)) return 'GLOBAL'
  if (a.includes('/.typora/plugins/')) return 'VAULT_LOCAL'
  return 'UNKNOWN'
}

/** Build the bootstrap provenance record (pure — no I/O). */
export function resolveBootstrapProvenance(input: BootstrapProvenanceInput): BootstrapProvenance {
  const userHome = input.userHome == null ? null : input.userHome.trim()
  const globalPluginRootExpected = userHome == null
    ? ''
    : path.join(userHome, '.typora', 'community-plugins', 'plugins', input.pluginId).replace(/\\/g, '/')
  const actualBundlePath = normalise(input.runtimeModulePath)
  const actualPluginRoot = actualBundlePath == null ? null : actualBundlePath.slice(0, actualBundlePath.lastIndexOf('/'))
  const loadSource = classifyLoadSource(actualBundlePath, globalPluginRootExpected)
  const known = actualBundlePath != null
  return {
    processId: input.processId,
    pluginId: input.pluginId,
    buildMarker: input.buildMarker,
    actualBundlePath,
    actualPluginRoot,
    actualManifestPath: actualPluginRoot == null ? null : `${actualPluginRoot}/manifest.json`,
    frameworkReportedPluginRoot: normalise(input.frameworkReportedPluginRoot),
    frameworkReportedPluginId: input.frameworkReportedPluginId ?? null,
    globalPluginRootExpected,
    loadSource,
    entryModuleEvaluated: true,
    decision: known ? 'PASS' : 'UNKNOWN',
    reason: known ? `ENTRY_MODULE_EVALUATED:${loadSource}` : 'ENTRY_MODULE_EVALUATED_BUT_BUNDLE_PATH_UNKNOWN',
  }
}

/**
 * Write the bootstrap audit to the USER-LEVEL audit dir. Fail-open: it must
 * never throw into the bundle bootstrap path.
 */
export function writeBootstrapAudit(record: BootstrapProvenance, userHome: string | null): string | null {
  try {
    const dir = resolveUserLevelAuditDir(userHome)
    if (dir == null) return null
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `bootstrap-${record.processId}.log`)
    const line = JSON.stringify({
      tsEpochMs: Date.now(),
      tsIso: new Date().toISOString(),
      event: BOOTSTRAP_AUDIT_EVENT,
      payload: record,
    })
    fs.appendFileSync(file, line + '\n', 'utf8')
    return file
  } catch {
    return null
  }
}

/** The executing module path, best-effort (`__filename` when the bundle is CJS). */
export function resolveRuntimeModulePath(): string | null {
  try {
    if (typeof __filename === 'string' && __filename !== '') return __filename
  } catch { /* not CJS / not available */ }
  return null
}

/** Best-effort framework-reported plugin metadata (never fabricated). */
export function readFrameworkReportedPluginRoot(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any
    const cand = g?.typora?.communityPlugin?.pluginRoot ?? g?.CommunityPlugin?.pluginRoot
    return typeof cand === 'string' && cand !== '' ? cand : null
  } catch {
    return null
  }
}

/** One-shot bootstrap entry — called at the very top of the plugin entry module. */
export function recordInkChapterBootstrap(pluginId: string, buildMarker: string): void {
  const userHome = (() => {
    try { return os.homedir() } catch { return null }
  })()
  const record = resolveBootstrapProvenance({
    processId: typeof process !== 'undefined' ? process.pid : -1,
    pluginId,
    buildMarker,
    runtimeModulePath: resolveRuntimeModulePath(),
    frameworkReportedPluginRoot: readFrameworkReportedPluginRoot(),
    frameworkReportedPluginId: pluginId,
    userHome,
  })
  writeBootstrapAudit(record, userHome)
}

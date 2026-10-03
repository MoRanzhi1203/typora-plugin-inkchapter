/**
 * Heading Auto-Number Conflict Runtime Bridge (dev/test ONLY).
 *
 * Runtime Closure V1 §7/§8 — the machine cannot drive Typora's DevTools console
 * on this host, and the settings UI / outline toolbar widgets are not exposed to
 * the accessibility tree. This module is the MINIMAL, dev/test-only bridge that
 * lets an external harness (PowerShell) request a REAL configuration transition:
 *
 *   write  <vault>/.typora/inkchapter/heading-conflict-test-bridge.json
 *   { "command": "SET_STRUCTURE_MODE", "arg": "loose", "remaining": 1 }
 *
 * Safety contract (HARD, mirrors `empty-special-test-hook.ts`):
 *  - default disabled: no config file → no effect, `remaining <= 0` → no effect
 *  - ONLY armed inside the test vault (`isTestVaultRoot`)
 *  - NEVER writes the settings JSON by hand: every command goes through the
 *    OFFICIAL setter on `HeadingNumberingService`
 *    (`setHeadingStructureMode` / `toggle` / `applyPreset`) — the same authority
 *    the settings UI and the outline menu use
 *  - one-shot: `remaining` is decremented and the command file is rewritten
 *  - never touches Markdown / Selection / DOM / caret
 */
import * as fs from 'fs'
import * as path from 'path'
import { isTestVaultRoot } from './empty-special-test-hook'

export type HeadingConflictBridgeCommand =
  | 'SET_STRUCTURE_MODE'
  | 'TOGGLE_ENABLED'
  | 'APPLY_PRESET'
  /** §30 F5 — a REAL source edit through the official content authority. */
  | 'SET_SOURCE'
  /** no mutation — write the CURRENT gate/coverage report only */
  | 'REPORT_ONLY'

export interface HeadingConflictBridgeFile {
  command?: string
  arg?: string
  /**
   * Idempotency token. ONE user click can drive SEVERAL refreshes, so the bridge
   * must consume a given command exactly ONCE: a refresh whose nonce equals the
   * last consumed nonce is ignored.
   */
  nonce?: string
  /** Written back after consumption so the harness can confirm the step. */
  consumedNonce?: string
  remaining?: number
}

export interface HeadingConflictBridgeCommandRequest {
  command: string
  arg: string | null
  nonce: string
  remaining: number
}

export interface HeadingConflictBridgeReport {
  command: string
  arg: string | null
  appliedAt: string
  result: string
  /** §20 — the runtime session that produced this report (never merged). */
  runtimeSessionId: string
  reportSequence: number
  settingsRevision: number
  sourceRevision: number
  diagnosticsRevision: number
  baselineEstablished: boolean
  /** §21/§22 — the report is ALWAYS captured after the diagnostics commit. */
  capturePhase: 'POST_COMMIT'
  dualPass: { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[]; unmet: readonly string[] }
  gateReport: string[]
  coverageReport: string[]
}

export function resolveHeadingConflictBridgePath(vaultRoot: string | null | undefined): string | null {
  if (!vaultRoot) return null
  return path.join(vaultRoot, '.typora', 'inkchapter', 'heading-conflict-test-bridge.json')
}

export function resolveHeadingConflictBridgeReportPath(vaultRoot: string | null | undefined): string | null {
  if (!vaultRoot) return null
  return path.join(vaultRoot, '.typora', 'inkchapter', 'heading-conflict-test-bridge-report.json')
}

/** Read the one-shot command (null = not armed, or already consumed). */
export function readHeadingConflictBridgeFile(
  vaultRoot: string | null | undefined,
  lastConsumedNonce?: string | null,
): HeadingConflictBridgeCommandRequest | null {
  if (!isTestVaultRoot(vaultRoot)) return null
  const p = resolveHeadingConflictBridgePath(vaultRoot)
  if (!p) return null
  try {
    if (!fs.existsSync(p)) return null
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const file = parsed as HeadingConflictBridgeFile
    if (typeof file.remaining !== 'number' || file.remaining <= 0) return null
    if (typeof file.command !== 'string' || file.command === '') return null
    const nonce = typeof file.nonce === 'string' && file.nonce !== '' ? file.nonce : `${file.command}:${file.arg ?? ''}`
    // Idempotency: several refreshes can be driven by ONE click — consume once.
    if (lastConsumedNonce != null && lastConsumedNonce === nonce) return null
    if (typeof file.consumedNonce === 'string' && file.consumedNonce === nonce) return null
    return { command: file.command, arg: file.arg ?? null, nonce, remaining: file.remaining }
  } catch {
    return null
  }
}

/** Consume the one-shot command: decrement `remaining` and stamp `consumedNonce`. */
export function consumeHeadingConflictBridgeFile(
  vaultRoot: string | null | undefined,
  command: HeadingConflictBridgeCommandRequest,
): void {
  const p = resolveHeadingConflictBridgePath(vaultRoot)
  if (!p) return
  try {
    fs.writeFileSync(p, JSON.stringify({
      command: command.command,
      arg: command.arg,
      nonce: command.nonce,
      consumedNonce: command.nonce,
      remaining: Math.max(0, command.remaining - 1),
    }, null, 2) + '\n', 'utf8')
  } catch { /* best-effort */ }
}

/** Write the observable result of the bridge (gate + coverage report). */
export function writeHeadingConflictBridgeReport(
  vaultRoot: string | null | undefined,
  report: HeadingConflictBridgeReport,
): boolean {
  const p = resolveHeadingConflictBridgeReportPath(vaultRoot)
  if (!p) return false
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

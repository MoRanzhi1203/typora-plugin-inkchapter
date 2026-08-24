/**
 * Forensic Log Sink — file-backed, machine-parseable runtime audit output.
 *
 * PURPOSE: Mirror the existing `[InkChapter]` runtime audit stream from the
 * console into a session-scoped JSON Lines file, so the automation Runner can
 * read stable structured records instead of scraping console text.
 *
 * PURE OBSERVABILITY — this module MUST NOT:
 *   - mutate business state, transactions, caret, selection, canonical
 *     ownership, DOM, sidecar data, or the historical resolver
 *   - affect business success/failure results
 *   - block the InkChapter main path when a write fails
 *
 * Write failures are fail-open: the business keeps running and the sink only
 * records its own error counters.
 *
 * Output: {vault}/.typora/inkchapter/audit/runtime-<sessionId>.log
 */

import * as fs from 'fs'
import * as path from 'path'
import { INKCHAPTER_BUILD_ID } from '../heading-numbering/paragraph-indent-forensic'
import { captureRuntimeLogTimestamp, formatRuntimeLogTimestamp, type RuntimeLogTimestamp } from './runtime-log-timestamp'

// ── Types ────────────────────────────────────────────────────────────

export type AuditLogLevel = 'info' | 'warn' | 'error'

export interface ForensicSinkStats {
  enabled: boolean
  failed: boolean
  path: string | null
  sessionId: string
  buildId: string
  queuedCount: number
  writtenCount: number
  droppedCount: number
  errorCount: number
  flushScheduled: boolean
  queueLength: number
}

export interface ForensicSinkInitOptions {
  /** Vault root; the sink appends `.typora/inkchapter/audit` to it. */
  vaultRoot?: string | null
  /** Direct audit directory override (used by unit tests). */
  auditDir?: string | null
  buildId?: string
  sessionId?: string
}

/**
 * Envelope fields lifted out of the event payload into the JSONL top level.
 * Everything else is kept under `payload`.
 */
const LIFT_FIELDS = new Set([
  'scopeId',
  'persistenceKey',
  'documentKey',
  'editorInstanceId',
  'intentEpoch',
  'normalEnterTxnId',
  'observationId',
])

// ── State ────────────────────────────────────────────────────────────

let enabled = false
let failed = false
let sessionId = ''
let buildId = INKCHAPTER_BUILD_ID
let outputPath: string | null = null

const writeQueue: string[] = []
let flushScheduled = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

let queuedCount = 0
let writtenCount = 0
let droppedCount = 0
let errorCount = 0

// ── Phase 7R.3.11.7 — state-token dedup + summary counters ──────────
// Consecutive identical-state INFO audits (NO_OP / WAIT / DEFER) are emitted
// ONCE and then counted as suppressed until the state token changes. FAIL /
// write / identity / LOCK / BLOCK / GO_TOP / GO_BOTTOM authority is preserved:
// dedup ONLY applies to the events routed through emitRuntimeAuditStateDedup.
let emittedInfoLogCount = 0
let suppressedInfoLogCount = 0
let warnAuditCount = 0
let errorAuditCount = 0
const dedupLastSignature = new Map<string, string>()

// ── Helpers ──────────────────────────────────────────────────────────

function formatConsoleValue(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function buildConsoleLine(event: string, payload: Record<string, unknown> | undefined, ts: RuntimeLogTimestamp): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(payload ?? {})) {
    parts.push(`${k}=${formatConsoleValue(v)}`)
  }
  const body = parts.length > 0
    ? `${event}: ${parts.join(' ')}`
    : `${event}`
  return `${formatRuntimeLogTimestamp(ts)}[InkChapter] ${body}`
}

function buildRecord(event: string, payload: Record<string, unknown> | undefined, ts: RuntimeLogTimestamp): string {
  const lifted: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (LIFT_FIELDS.has(k)) {
      lifted[k] = v
    } else {
      rest[k] = v
    }
  }

  const record: Record<string, unknown> = {
    tsEpochMs: ts.tsEpochMs,
    tsIso: ts.tsIso,
    // Legacy compatibility fields — keep existing consumers working.
    ts: ts.tsEpochMs,
    timestamp: ts.tsIso,
    sessionId,
    buildId,
    event,
    ...lifted,
  }
  if (Object.keys(rest).length > 0) {
    record.payload = rest
  }
  return JSON.stringify(record)
}

function consoleLog(level: AuditLogLevel, line: string): void {
  if (level === 'warn') console.warn(line)
  else if (level === 'error') console.error(line)
  else console.info(line)
}

function sinkStatsPayload(): Record<string, unknown> {
  return {
    path: outputPath ?? null,
    queuedCount,
    writtenCount,
    droppedCount,
    errorCount,
  }
}

function recordSinkError(message: string): void {
  failed = true
  const ts = formatRuntimeLogTimestamp(captureRuntimeLogTimestamp())
  console.error(
    `${ts}[InkChapter] FORENSIC-SINK-ERROR: ` +
    `path=${outputPath ?? 'null'} ` +
    `queuedCount=${queuedCount} ` +
    `writtenCount=${writtenCount} ` +
    `droppedCount=${droppedCount} ` +
    `errorCount=${errorCount} ` +
    `message=${message}`,
  )
}

function resolveAuditDir(vaultRoot?: string | null): string | null {
  let root = vaultRoot ?? null
  if (!root) {
    root = (globalThis as { __inkchapter_vault_root__?: string }).__inkchapter_vault_root__ ?? null
  }
  if (!root) {
    try {
      const cwd = process.cwd()
      const tv = path.join(cwd, 'test', 'vault')
      if (fs.existsSync(tv)) root = tv
    } catch {
      root = null
    }
  }
  if (!root) return null
  return path.join(root, '.typora', 'inkchapter', 'audit')
}

function scheduleFlush(): void {
  if (!enabled || failed) return
  if (flushScheduled || flushTimer !== null) return
  flushScheduled = true
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushScheduled = false
    flush()
  }, 0)
}

/** Synchronous flush of the current queue. Used by boundaries and tests. */
function flush(): void {
  if (!enabled || !outputPath) return
  if (writeQueue.length === 0) return
  const lines = writeQueue.splice(0, writeQueue.length)
  try {
    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(outputPath, lines.join('\n') + '\n', 'utf8')
    writtenCount += lines.length
  } catch (e) {
    errorCount++
    droppedCount += lines.length
    recordSinkError(String(e))
  }
}

function enqueueRecord(event: string, payload?: Record<string, unknown>, level: AuditLogLevel = 'info'): void {
  // Capture the emission timestamp exactly once (NOT at flush time).
  const ts = captureRuntimeLogTimestamp()

  // Phase 7R.3.11.7 — summary level counters (non-info authority preserved).
  if (level === 'warn') warnAuditCount++
  else if (level === 'error') errorAuditCount++

  // Console mirror always runs — preserves the existing observable stream.
  consoleLog(level, buildConsoleLine(event, payload, ts))

  // File sink is best-effort; never throws into business code.
  if (!enabled || failed) return
  try {
    writeQueue.push(buildRecord(event, payload, ts))
    queuedCount++
  } catch (e) {
    errorCount++
    droppedCount++
    recordSinkError(String(e))
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Unified audit facade. Console + file-backed sink in one place.
 * Pure logger — carries no business logic.
 */
export function emitRuntimeAudit(
  event: string,
  payload?: Record<string, unknown>,
  level: AuditLogLevel = 'info',
): void {
  enqueueRecord(event, payload, level)
  scheduleFlush()
}

// ── Phase 7R.3.11.7 — state-token dedup emission ────────────────────
/**
 * State-dedup audit facade. Consecutive identical-state INFO events are
 * emitted once and counted as suppressed; a state-token CHANGE re-emits.
 *
 * AUTHORITY SAFETY: only INFO-level identical-state noise is ever suppressed.
 * FAIL / write / identity / LOCK / BLOCK / GO_TOP / GO_BOTTOM call sites must
 * keep using `emitRuntimeAudit` directly (or pass a changing signature), so
 * their forensic authority is never deduplicated.
 *
 * `signature` is the state token (e.g. `${documentKey}|${decision}|${reason}`).
 * Identical consecutive signatures → suppressed; otherwise emitted.
 */
export function emitRuntimeAuditStateDedup(
  event: string,
  signature: string,
  payload?: Record<string, unknown>,
): void {
  const last = dedupLastSignature.get(event)
  if (last === signature) {
    suppressedInfoLogCount++
    return
  }
  dedupLastSignature.set(event, signature)
  emittedInfoLogCount++
  enqueueRecord(event, payload, 'info')
  scheduleFlush()
}

/** Forget a dedup state token (safe to call at document-switch boundaries). */
export function resetAuditStateDedup(event?: string): void {
  if (event !== undefined) dedupLastSignature.delete(event)
  else dedupLastSignature.clear()
}

/** Phase 7R.3.11.7 — read-only dedup counters (for the runtime summary). */
export function getAuditDedupCounters(): {
  emittedInfoLogCount: number
  suppressedInfoLogCount: number
  warnAuditCount: number
  errorAuditCount: number
} {
  return { emittedInfoLogCount, suppressedInfoLogCount, warnAuditCount, errorAuditCount }
}

/**
 * Phase 7R.3.11.7 — event-triggered low-frequency audit summary. MUST only be
 * called at a settle boundary (document switch settled / drawer transition
 * settled / DevTools resize settled) — never from a timer or poll.
 */
export function emitInkchapterRuntimeAuditSummary(
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  const { emittedInfoLogCount: emitted, suppressedInfoLogCount: suppressed } = getAuditDedupCounters()
  enqueueRecord('INKCHAPTER-RUNTIME-AUDIT-SUMMARY', {
    trigger: reason,
    emittedInfoLogCount: emitted,
    suppressedInfoLogCount: suppressed,
    errorCount,
    warningCount: warnAuditCount,
    ...extra,
  }, 'info')
  scheduleFlush()
}

/** Initialize the sink (idempotent). Resolves the audit dir and session file. */
export function initializeForensicSink(options: ForensicSinkInitOptions = {}): void {
  if (enabled) return

  const nextBuildId = options.buildId ?? INKCHAPTER_BUILD_ID
  const nextSessionId = options.sessionId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const auditDir = options.auditDir ?? resolveAuditDir(options.vaultRoot)
  if (!auditDir) {
    console.warn(`${formatRuntimeLogTimestamp(captureRuntimeLogTimestamp())}[InkChapter] FORENSIC-SINK-UNAVAILABLE: reason=no-vault-root`)
    return
  }

  try {
    fs.mkdirSync(auditDir, { recursive: true })
  } catch (e) {
    console.warn(`${formatRuntimeLogTimestamp(captureRuntimeLogTimestamp())}[InkChapter] FORENSIC-SINK-UNAVAILABLE: reason=mkdir-failed path=${auditDir} error=${String(e)}`)
    return
  }

  buildId = nextBuildId
  sessionId = nextSessionId
  outputPath = path.join(auditDir, `runtime-${nextSessionId}.log`)
  enabled = true
  failed = false
  queuedCount = 0
  writtenCount = 0
  droppedCount = 0
  errorCount = 0
  writeQueue.length = 0

  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('beforeunload', () => shutdownForensicSink())
    } catch { /* ignore */ }
  }

  // Write the READY marker synchronously so the Runner has a stable byte-offset anchor.
  enqueueRecord('FORENSIC-SINK-READY', sinkStatsPayload(), 'info')
  flush()
}

/** Synchronously flush pending records. Safe to call at document-switch boundaries. */
export function flushForensicSink(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushScheduled = false
  }
  flush()
}

/** Final flush + disable. Safe to call from plugin unload / beforeunload. */
export function shutdownForensicSink(): void {
  if (!enabled) return
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushScheduled = false
  }
  flush()
  enqueueRecord('FORENSIC-SINK-FLUSH', sinkStatsPayload(), 'info')
  flush()
  enabled = false
}

/** Read-only snapshot of sink counters (used by sink self-audits and tests). */
export function getForensicSinkStats(): ForensicSinkStats {
  return {
    enabled,
    failed,
    path: outputPath,
    sessionId,
    buildId,
    queuedCount,
    writtenCount,
    droppedCount,
    errorCount,
    flushScheduled,
    queueLength: writeQueue.length,
  }
}

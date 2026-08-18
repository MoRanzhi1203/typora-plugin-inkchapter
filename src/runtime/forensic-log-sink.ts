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
import * as crypto from 'crypto'
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

  // Console mirror always runs — preserves the existing observable stream.
  consoleLog(level, buildConsoleLine(event, payload, ts))

  // File sink is best-effort; never throws into business code.
  if (!enabled || failed) return
  try {
    writeQueue.push(buildRecord(event, payload, ts))
    queuedCount++;
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

// ── Immutable log export snapshot (v2.5.3) ──────────────────────────

export interface LogFileIdentity {
  path: string | null
  size: number
  sha256: string
}

export interface ForensicLogExportResult {
  sessionId: string
  liveSinkPath: string | null
  exportPath: string | null
  snapshotEndOffset: number
  exportSize: number
  exportSha256: string
  exportHandleClosed: boolean
  exportRegisteredAsLiveSink: boolean
  activeLiveSinkCount: number
  decision: 'PASS' | 'FAIL'
  reason: string | null
}

export interface ForensicLogImmutabilityVerify {
  exportPath: string | null
  exportSizeBefore: number
  exportShaBefore: string
  exportSizeAfter: number
  exportShaAfter: string
  unchanged: boolean
  liveSinkSize: number
  activeLiveSinkCount: number
  decision: 'PASS' | 'FAIL'
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(new Uint8Array(data)).digest('hex').toUpperCase()
}

/** Count of active live sinks (always 0 or 1). */
export function getActiveLiveSinkCount(): number {
  return enabled ? 1 : 0
}

/** Point-in-time identity (size + SHA256) of a log file. */
export function computeLogFileIdentity(filePath: string | null): LogFileIdentity {
  if (!filePath || !fs.existsSync(filePath)) return { path: filePath, size: 0, sha256: '' }
  return { path: filePath, size: fs.statSync(filePath).size, sha256: sha256File(filePath) }
}

/**
 * Export an IMMUTABLE byte snapshot of the live sink into a NEW file. The live
 * sink keeps growing; the export is frozen at `snapshotEndOffset`. The export is
 * never registered as a live sink and its handle is always closed.
 */
export function exportForensicLogSnapshot(): ForensicLogExportResult {
  const activeLiveSinkCount = getActiveLiveSinkCount()
  const base: ForensicLogExportResult = {
    sessionId,
    liveSinkPath: outputPath,
    exportPath: null,
    snapshotEndOffset: 0,
    exportSize: 0,
    exportSha256: '',
    exportHandleClosed: false,
    exportRegisteredAsLiveSink: false,
    activeLiveSinkCount,
    decision: 'FAIL',
    reason: null,
  }

  if (!enabled || !outputPath) {
    base.reason = 'NO_LIVE_SINK'
    emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...base }, 'warn')
    return base
  }

  // flush the live sink so every pending byte is on disk before snapshotting.
  flushForensicSink()

  let statSize = 0
  try {
    statSize = fs.statSync(outputPath).size
  } catch (e) {
    base.reason = `STAT_FAILED:${String(e)}`
    emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...base }, 'error')
    return base
  }

  const snapshotEndOffset = statSize
  const exportDir = path.dirname(outputPath)
  const exportPath = path.join(exportDir, `runtime-${sessionId}-export-${Date.now()}.log`)

  if (exportPath === outputPath) {
    base.reason = 'EXPORT_PATH_EQUALS_LIVE_SINK'
    emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...base }, 'error')
    return base
  }

  let exportHandleClosed = false
  try {
    const srcFd = fs.openSync(outputPath, 'r')
    const dstFd = fs.openSync(exportPath, 'w')
    try {
      const buf = new Uint8Array(64 * 1024)
      let pos = 0
      let remaining = snapshotEndOffset
      while (remaining > 0) {
        const toRead = Math.min(buf.length, remaining)
        const bytesRead = fs.readSync(srcFd, buf, 0, toRead, pos)
        if (bytesRead <= 0) break
        fs.writeSync(dstFd, buf, 0, bytesRead)
        pos += bytesRead
        remaining -= bytesRead
      }
      fs.fsyncSync(dstFd)
    } finally {
      fs.closeSync(dstFd)
      fs.closeSync(srcFd)
      exportHandleClosed = true
    }
  } catch (e) {
    base.reason = `COPY_FAILED:${String(e)}`
    emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...base }, 'error')
    return base
  }

  let exportSize = 0
  let exportSha256 = ''
  try {
    exportSize = fs.statSync(exportPath).size
    exportSha256 = sha256File(exportPath)
  } catch (e) {
    base.reason = `HASH_FAILED:${String(e)}`
    emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...base }, 'error')
    return base
  }

  const result: ForensicLogExportResult = {
    ...base,
    exportPath,
    snapshotEndOffset,
    exportSize,
    exportSha256,
    exportHandleClosed,
    exportRegisteredAsLiveSink: false,
    activeLiveSinkCount,
    decision: 'PASS',
    reason: null,
  }

  emitRuntimeAudit('LOG-EXPORT-SNAPSHOT', { ...result })
  return result
}

/** Re-check the exported file's size + SHA against the snapshot (immutability). */
export function verifyForensicLogExport(result: ForensicLogExportResult): ForensicLogImmutabilityVerify {
  const after = computeLogFileIdentity(result.exportPath)
  const live = computeLogFileIdentity(result.liveSinkPath)
  const unchanged = after.size === result.exportSize && after.sha256 === result.exportSha256
  const verify: ForensicLogImmutabilityVerify = {
    exportPath: result.exportPath,
    exportSizeBefore: result.exportSize,
    exportShaBefore: result.exportSha256,
    exportSizeAfter: after.size,
    exportShaAfter: after.sha256,
    unchanged,
    liveSinkSize: live.size,
    activeLiveSinkCount: getActiveLiveSinkCount(),
    decision: unchanged ? 'PASS' : 'FAIL',
  }
  emitRuntimeAudit('LOG-EXPORT-IMMUTABILITY-VERIFY', { ...verify })
  return verify
}

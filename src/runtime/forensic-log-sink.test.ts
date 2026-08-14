/**
 * Forensic Log Sink unit tests — AUD-1 through AUD-10.
 *
 * These tests exercise the file-backed sink in isolation and verify it is
 * PURE OBSERVABILITY: it never mutates payloads, never throws into business
 * code, preserves order, isolates sessions, and fails open.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  initializeForensicSink,
  shutdownForensicSink,
  flushForensicSink,
  emitRuntimeAudit,
  getForensicSinkStats,
} from './forensic-log-sink'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ink-aud-'))
}

function readLines(file: string): string[] {
  const raw = fs.readFileSync(file, 'utf8')
  return raw.split('\n').filter((l) => l.trim().length > 0)
}

afterEach(() => {
  shutdownForensicSink()
  vi.restoreAllMocks()
})

describe('forensic-log-sink', () => {
  it('AUD-1: sink event does not modify input payload', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud1' })

    const payload: Record<string, unknown> = {
      observationId: 'obs-1',
      scopeId: 'scope-1',
      intentEpoch: 7,
      extra: 'untouched',
    }
    const before = JSON.stringify(payload)
    expect(() => emitRuntimeAudit('TEST-EVENT', payload)).not.toThrow()
    expect(JSON.stringify(payload)).toBe(before)
  })

  it('AUD-2: sink write failure does not affect business return value', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud2' })
    expect(getForensicSinkStats().enabled).toBe(true)

    emitRuntimeAudit('PRE-FAILURE', { a: 1 })

    // Corrupt the audit directory into a file so the next flush fails.
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.writeFileSync(tmp, 'not-a-directory')

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => flushForensicSink()).not.toThrow()
    expect(getForensicSinkStats().failed).toBe(true)

    // Business continues and returns its own result unaffected.
    const business = (): number => {
      emitRuntimeAudit('POST-FAILURE', { a: 2 })
      return 42
    }
    expect(business()).toBe(42)

    errSpy.mockRestore()
  })

  it('AUD-3: event order is preserved', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud3' })

    emitRuntimeAudit('E1', { n: 1 })
    emitRuntimeAudit('E2', { n: 2 })
    emitRuntimeAudit('E3', { n: 3 })
    flushForensicSink()

    const events = readLines(getForensicSinkStats().path!)
      .map((l) => JSON.parse(l).event)
      .filter((e) => e !== 'FORENSIC-SINK-READY')
    expect(events).toEqual(['E1', 'E2', 'E3'])
  })

  it('AUD-4: sessions are isolated to distinct files', () => {
    const tmp = makeTempDir()

    initializeForensicSink({ auditDir: tmp, sessionId: 'session-a' })
    emitRuntimeAudit('FROM_A', { x: 'a' })
    shutdownForensicSink()
    const fileA = getForensicSinkStats().path!

    initializeForensicSink({ auditDir: tmp, sessionId: 'session-b' })
    emitRuntimeAudit('FROM_B', { x: 'b' })
    shutdownForensicSink()
    const fileB = getForensicSinkStats().path!

    expect(fileA).not.toBe(fileB)
    expect(readLines(fileA).map((l) => JSON.parse(l).event)).toContain('FROM_A')
    expect(readLines(fileB).map((l) => JSON.parse(l).event)).toContain('FROM_B')
    expect(readLines(fileA).map((l) => JSON.parse(l).event)).not.toContain('FROM_B')
    expect(readLines(fileB).map((l) => JSON.parse(l).event)).not.toContain('FROM_A')
  })

  it('AUD-5: flush does not lose logs', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud5' })

    for (let i = 0; i < 50; i++) {
      emitRuntimeAudit('BATCH', { i })
    }
    flushForensicSink()

    const lines = readLines(getForensicSinkStats().path!)
    const batchEvents = lines.map((l) => JSON.parse(l).event).filter((e) => e === 'BATCH')
    expect(batchEvents.length).toBe(50)
  })

  it('AUD-6: droppedCount stays zero in a healthy sink', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud6' })

    emitRuntimeAudit('E1', { a: 1 })
    emitRuntimeAudit('E2', { a: 2 })
    flushForensicSink()

    const stats = getForensicSinkStats()
    expect(stats.droppedCount).toBe(0)
    expect(stats.errorCount).toBe(0)
    expect(stats.writtenCount).toBeGreaterThanOrEqual(2)
  })

  it('AUD-7: document-switch flush persists pending records synchronously', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud7' })

    emitRuntimeAudit('DOCUMENT-CONTEXT-TRANSITION', { reason: 'DOCUMENT_SWITCH' })
    // Simulate the document-switch boundary flush.
    flushForensicSink()

    const events = readLines(getForensicSinkStats().path!)
      .map((l) => JSON.parse(l).event)
    expect(events).toContain('DOCUMENT-CONTEXT-TRANSITION')
  })

  it('AUD-8: unload flush persists pending records and disables the sink', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud8' })

    emitRuntimeAudit('LAST-EVENT', { a: 1 })
    shutdownForensicSink()

    expect(getForensicSinkStats().enabled).toBe(false)
    const events = readLines(getForensicSinkStats().path!)
      .map((l) => JSON.parse(l).event)
    expect(events).toContain('LAST-EVENT')
    expect(events).toContain('FORENSIC-SINK-FLUSH')
  })

  it('AUD-9: every JSONL line parses independently', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'aud9' })

    emitRuntimeAudit('JSON-1', { scopeId: 's', observationId: 'o', payloadLike: { nested: true } })
    emitRuntimeAudit('JSON-2', { nothing: null })
    flushForensicSink()

    for (const line of readLines(getForensicSinkStats().path!)) {
      expect(() => JSON.parse(line)).not.toThrow()
      const obj = JSON.parse(line)
      expect(typeof obj.ts).toBe('number')
      expect(typeof obj.sessionId).toBe('string')
      expect(typeof obj.buildId).toBe('string')
      expect(typeof obj.event).toBe('string')
    }
  })

  it('AUD-10: disabled/unavailable sink does not change business semantics', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // Never initialized → sink is disabled; emit must still mirror to console and never throw.
    expect(getForensicSinkStats().enabled).toBe(false)
    const business = (): string => {
      emitRuntimeAudit('DISABLED-EVENT', { a: 1 })
      return 'ok'
    }
    expect(business()).toBe('ok')
    expect(infoSpy).toHaveBeenCalled()

    // Unavailable sink (mkdir fails) → remains disabled, no throw.
    const tmpFile = path.join(makeTempDir(), 'blocker')
    fs.writeFileSync(tmpFile, 'x')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initializeForensicSink({ auditDir: path.join(tmpFile, 'sub') })
    expect(getForensicSinkStats().enabled).toBe(false)
    expect(() => emitRuntimeAudit('UNAVAILABLE-EVENT', { a: 2 })).not.toThrow()

    infoSpy.mockRestore()
    errSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { captureRuntimeLogTimestamp, formatRuntimeLogTimestamp } from './runtime-log-timestamp'
import {
  initializeForensicSink,
  shutdownForensicSink,
  flushForensicSink,
  emitRuntimeAudit,
} from './forensic-log-sink'
import * as logger from '../core/logger'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ink-logts-'))
}

afterEach(() => {
  shutdownForensicSink()
  vi.restoreAllMocks()
})

describe('LOGTS — per-line runtime log timestamp', () => {
  it('LOGTS-1: capture helper returns tsEpochMs + matching tsIso', () => {
    const ts = captureRuntimeLogTimestamp(1700000000123)
    expect(ts.tsEpochMs).toBe(1700000000123)
    expect(ts.tsIso).toBe(new Date(1700000000123).toISOString())
    expect(formatRuntimeLogTimestamp(ts)).toBe('[2023-11-14T22:13:20.123Z][1700000000123]')
  })

  it('LOGTS-2: same now capture produces one consistent timestamp', () => {
    const ts = captureRuntimeLogTimestamp(1700000000123)
    const parsed = Date.parse(ts.tsIso)
    expect(parsed).toBe(ts.tsEpochMs)
  })

  it('LOGTS-3/4: forensic JSONL line contains tsIso + tsEpochMs', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'logts' })
    emitRuntimeAudit('LOGTS-TEST', { a: 1 })
    flushForensicSink()

    const file = path.join(tmp, 'runtime-logts.log')
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()!)
    expect(typeof line.tsIso).toBe('string')
    expect(typeof line.tsEpochMs).toBe('number')
    expect(line.event).toBe('LOGTS-TEST')
  })

  it('LOGTS-5: tsIso and tsEpochMs are mutually consistent (same capture)', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'logts5' })
    emitRuntimeAudit('LOGTS-TEST-5', { b: 2 })
    flushForensicSink()

    const file = path.join(tmp, 'runtime-logts5.log')
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()!)
    expect(Date.parse(line.tsIso)).toBe(line.tsEpochMs)
    // legacy fields kept for backward compatibility
    expect(line.ts).toBe(line.tsEpochMs)
    expect(line.timestamp).toBe(line.tsIso)
  })

  it('LOGTS-6: multiline logger message → every physical line carries timestamp', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('line1\nline2\nline3')
    const output = spy.mock.calls[0][0] as string
    const lines = output.split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]\[\d+\]\[InkChapter\] /)
    }
  })
})

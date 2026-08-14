/**
 * IME Audit Mirror unit tests — IME-AUD-1 through IME-AUD-8.
 *
 * Verifies the pure-observability mirror for IME-SELECTION-AUDIT /
 * IME-EVENT-ORDER into the JSONL sink: console + file, payload unchanged,
 * order preserved, and fail-open on sink failure. No business semantics.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ink-ime-aud-'))
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0)
}

function parsedEvents(file: string): any[] {
  return readLines(file)
    .map((l) => JSON.parse(l))
    .filter((e) => e.event !== 'FORENSIC-SINK-READY' && e.event !== 'FORENSIC-SINK-FLUSH')
}

afterEach(() => {
  shutdownForensicSink()
  vi.restoreAllMocks()
})

describe('IME audit mirror', () => {
  it('IME-AUD-1: compositionstart mirror', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime1' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionstart', inputType: 'none', isComposing: true, compositionSessionId: 'ime-1' })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    expect(evs.some((e) => e.event === 'IME-SELECTION-AUDIT' && e.payload.eventType === 'compositionstart')).toBe(true)
  })

  it('IME-AUD-2: compositionupdate mirror', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime2' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionupdate', inputType: 'none', isComposing: true, compositionSessionId: 'ime-2' })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    expect(evs.some((e) => e.event === 'IME-SELECTION-AUDIT' && e.payload.eventType === 'compositionupdate')).toBe(true)
  })

  it('IME-AUD-3: beforeinput insertCompositionText mirror', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime3' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'beforeinput', inputType: 'insertCompositionText', isComposing: true, compositionSessionId: 'ime-3' })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    expect(evs.some((e) => e.event === 'IME-SELECTION-AUDIT' && e.payload.eventType === 'beforeinput' && e.payload.inputType === 'insertCompositionText')).toBe(true)
  })

  it('IME-AUD-4: input mirror', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime4' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'input', inputType: 'input', isComposing: true, compositionSessionId: 'ime-4' })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    expect(evs.some((e) => e.event === 'IME-SELECTION-AUDIT' && e.payload.eventType === 'input')).toBe(true)
  })

  it('IME-AUD-5: compositionend mirror (+ IME-EVENT-ORDER)', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime5' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionend', inputType: 'none', isComposing: false, compositionSessionId: 'ime-5' })
    emitRuntimeAudit('IME-EVENT-ORDER', { compositionSessionId: 'ime-5', compositionstartTs: 1, lastBeforeInputTs: 2, lastInputTs: 3, compositionEndTs: 4 })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    expect(evs.some((e) => e.event === 'IME-SELECTION-AUDIT' && e.payload.eventType === 'compositionend')).toBe(true)
    expect(evs.some((e) => e.event === 'IME-EVENT-ORDER' && e.payload.compositionSessionId === 'ime-5')).toBe(true)
  })

  it('IME-AUD-6: payload not modified', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime6' })
    const payload: Record<string, unknown> = { eventType: 'compositionstart', inputType: 'none', isComposing: true, compositionSessionId: 'ime-6' }
    const before = JSON.stringify(payload)
    emitRuntimeAudit('IME-SELECTION-AUDIT', payload)
    expect(JSON.stringify(payload)).toBe(before)
  })

  it('IME-AUD-7: event order preserved', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime7' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionstart', inputType: 'none', isComposing: true })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'beforeinput', inputType: 'insertCompositionText', isComposing: true })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'input', inputType: 'input', isComposing: true })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionend', inputType: 'none', isComposing: false })
    flushForensicSink()
    const evs = parsedEvents(getForensicSinkStats().path!)
    const seq = evs.filter((e) => e.event === 'IME-SELECTION-AUDIT').map((e) => e.payload.eventType)
    expect(seq).toEqual(['compositionstart', 'beforeinput', 'input', 'compositionend'])
  })

  it('IME-AUD-8: sink failure does not affect business path', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'ime8' })
    emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionstart', inputType: 'none', isComposing: true })

    // Corrupt the audit dir so the next flush fails (fail-open).
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.writeFileSync(tmp, 'not-a-directory')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => flushForensicSink()).not.toThrow()
    expect(getForensicSinkStats().failed).toBe(true)

    const business = (): string => {
      emitRuntimeAudit('IME-SELECTION-AUDIT', { eventType: 'compositionend', inputType: 'none', isComposing: false })
      return 'ok'
    }
    expect(business()).toBe('ok')
    errSpy.mockRestore()
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  initializeForensicSink,
  shutdownForensicSink,
  flushForensicSink,
  emitRuntimeAudit,
  exportForensicLogSnapshot,
  verifyForensicLogExport,
  getActiveLiveSinkCount,
} from './forensic-log-sink'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ink-exp-'))
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0)
}

afterEach(() => {
  shutdownForensicSink()
})

describe('forensic log export snapshot (v2.5.3)', () => {
  it('export is an immutable snapshot; live sink keeps growing', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'exp1' })

    emitRuntimeAudit('A', { v: 1 })
    emitRuntimeAudit('B', { v: 2 })
    flushForensicSink()

    const livePath = exportForensicLogSnapshot()
    expect(livePath.decision).toBe('PASS')
    expect(livePath.exportPath).not.toBe(livePath.liveSinkPath)
    expect(livePath.exportRegisteredAsLiveSink).toBe(false)
    expect(livePath.exportHandleClosed).toBe(true)
    expect(livePath.activeLiveSinkCount).toBe(1)
    expect(livePath.snapshotEndOffset).toBe(fs.statSync(livePath.liveSinkPath!).size)

    const exportEvents = readLines(livePath.exportPath!).map((l) => JSON.parse(l).event)
    expect(exportEvents).toContain('A')
    expect(exportEvents).toContain('B')
    expect(exportEvents).not.toContain('C')

    // Continue appending to the live sink.
    emitRuntimeAudit('C', { v: 3 })
    flushForensicSink()

    const verify = verifyForensicLogExport(livePath)
    expect(verify.unchanged).toBe(true)
    expect(verify.decision).toBe('PASS')
    expect(verify.exportSizeAfter).toBe(verify.exportSizeBefore)
    expect(verify.exportShaAfter).toBe(verify.exportShaBefore)

    // Live sink grew, export did not.
    expect(verify.liveSinkSize).toBeGreaterThan(verify.exportSizeBefore)
    const liveEvents = readLines(livePath.liveSinkPath!).map((l) => JSON.parse(l).event)
    expect(liveEvents).toContain('C')
  })

  it('activeLiveSinkCount stays 1 during export', () => {
    const tmp = makeTempDir()
    initializeForensicSink({ auditDir: tmp, sessionId: 'exp2' })
    emitRuntimeAudit('E', { v: 1 })
    flushForensicSink()

    expect(getActiveLiveSinkCount()).toBe(1)
    const result = exportForensicLogSnapshot()
    expect(result.activeLiveSinkCount).toBe(1)
    expect(getActiveLiveSinkCount()).toBe(1)
  })
})

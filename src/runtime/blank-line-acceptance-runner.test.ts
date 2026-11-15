/**
 * R06-03 — acceptance DRIVER gates + report sink.
 *
 * The driver must stay OFF in a production vault; it may only run for the
 * dedicated acceptance document inside `test/vault`, with a run token, and it
 * writes exactly one fixed report path.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCEPTANCE_DOCUMENT_IN_VAULT,
  ACCEPTANCE_REPORT_IN_VAULT,
  ACCEPTANCE_REQUEST_IN_VAULT,
  type AcceptanceRunReport,
} from '../document-utilities/document-diagnostic-acceptance-harness-v1'
import { BLANK_LINE_ACCEPTANCE_ENV, installBlankLineAcceptanceRunner } from './blank-line-acceptance-runner'

let root = ''
let vault = ''
let docPath = ''
let requestPath = ''
let reportPath = ''

function writeRequest(token: string): void {
  fs.mkdirSync(path.dirname(requestPath), { recursive: true })
  fs.writeFileSync(requestPath, JSON.stringify({ token }), 'utf8')
}

function passReport(token: string): AcceptanceRunReport {
  return {
    schema: 'inkchapter.blank-line-acceptance/v1',
    requestToken: token,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    documentPath: docPath,
    documentKey: 'doc',
    baselineHash: 'H',
    baselineLineCount: 10,
    baselineDiagnostics: [],
    finalDiagnostics: [],
    finalMarkdownMatchesBaseline: true,
    steps: [],
    failures: [],
    error: null,
    verdict: 'PASS',
    scope: 'test',
    undoApi: { available: true, undoStackLengthStart: 3, undoStackLengthEnd: 3 },
  }
}

function install(runAcceptance: () => Promise<AcceptanceRunReport | null>) {
  return installBlankLineAcceptanceRunner({
    vaultRoot: vault,
    getActiveFilePath: () => docPath,
    runAcceptance,
    subscribeFileOpen: () => () => {},
    delayMs: 0,
    schedule: (fn) => { fn() },
    log: () => {},
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkchapter-r06-'))
  vault = path.join(root, 'test', 'vault')
  docPath = path.join(vault, ACCEPTANCE_DOCUMENT_IN_VAULT)
  requestPath = path.join(vault, ACCEPTANCE_REQUEST_IN_VAULT)
  reportPath = path.join(vault, ACCEPTANCE_REPORT_IN_VAULT)
  fs.mkdirSync(path.dirname(docPath), { recursive: true })
  fs.writeFileSync(docPath, '# fixture\n', 'utf8')
  delete process.env[BLANK_LINE_ACCEPTANCE_ENV]
})

afterEach(() => {
  delete process.env[BLANK_LINE_ACCEPTANCE_ENV]
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('installBlankLineAcceptanceRunner — gates', () => {
  it('does nothing without a run request (production default)', async () => {
    const run = vi.fn(async () => passReport('x'))
    const dispose = install(run)
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    expect(fs.existsSync(reportPath)).toBe(false)
    dispose()
  })

  it('does nothing for a normal document even with a request file', async () => {
    writeRequest('t1')
    const run = vi.fn(async () => passReport('t1'))
    const dispose = installBlankLineAcceptanceRunner({
      vaultRoot: vault,
      getActiveFilePath: () => path.join(vault, 'doc.md'),
      runAcceptance: run,
      subscribeFileOpen: () => () => {},
      delayMs: 0,
      schedule: (fn) => { fn() },
    })
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    dispose()
  })

  it('runs for the acceptance document and writes the report to the fixed path', async () => {
    writeRequest('t2')
    const run = vi.fn(async () => passReport('t2'))
    const dispose = install(run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fs.existsSync(reportPath)).toBe(true))
    const written = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as AcceptanceRunReport
    expect(written.requestToken).toBe('t2')
    expect(written.verdict).toBe('PASS')
    dispose()
  })

  it('never repeats a token that already has a report', async () => {
    writeRequest('t3')
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(passReport('t3')), 'utf8')
    const run = vi.fn(async () => passReport('t3'))
    const dispose = install(run)
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    dispose()
  })

  it('records UNEXECUTED when the editor bridge has no Undo/Redo', async () => {
    writeRequest('t4')
    const dispose = install(async () => null)
    await vi.waitFor(() => expect(fs.existsSync(reportPath)).toBe(true))
    const written = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as AcceptanceRunReport
    expect(written.verdict).toBe('UNEXECUTED')
    expect(written.undoApi.available).toBe(false)
    dispose()
  })
})

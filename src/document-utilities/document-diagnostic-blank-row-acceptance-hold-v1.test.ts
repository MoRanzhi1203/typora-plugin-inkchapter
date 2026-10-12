// @vitest-environment jsdom
/**
 * TRAE §4/§5 — ENTER→BLANK ECHO: the commit-time paint-layer acceptance DRY-RUN
 * must NOT write into the live content document (`#write`) while an Enter
 * transaction's echo window is armed.
 *
 * ROOT CAUSE: the dry-run inserts probe nodes (1 container + N fragments) inside
 * `#write`; Typora then re-runs its end-block re-normalisation → a SECOND
 * `SPLIT_1_TO_2` that adds one extra empty paragraph (+2 LF) for a SINGLE Enter.
 * These tests are FALSIFIABLE: they FAIL if the hold guard is removed or moved
 * after the dry-run's first content-document write.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  armEnterEchoWriteTrace,
  drainEnterEchoWriteTrace,
  isContentDocumentWriteHoldActive,
  noteEnterEchoWrite,
} from './enter-echo-write-trace'

describe('ENTER→BLANK — content-document write hold + write fingerprint', () => {
  it('HOLD-1: the hold is active ONLY inside the armed echo window', () => {
    armEnterEchoWriteTrace('S', 250, 1000)
    expect(isContentDocumentWriteHoldActive(1000)).toBe(true)
    expect(isContentDocumentWriteHoldActive(1249)).toBe(true)
    expect(isContentDocumentWriteHoldActive(1250)).toBe(false)
    // an expired window holds nothing
    armEnterEchoWriteTrace('S', 0, 0)
    expect(isContentDocumentWriteHoldActive(10)).toBe(false)
  })

  it('HOLD-2: a recorded write carries the operated node + parent fingerprint', () => {
    armEnterEchoWriteTrace('S', 1000, 0)
    const write = document.createElement('div')
    write.id = 'write'
    const layer = document.createElement('div')
    layer.className = 'inkchapter-locate-document-layer'
    layer.setAttribute('data-inkchapter-locate-layer', 'true')
    write.appendChild(layer)
    const probe = document.createElement('div')
    probe.setAttribute('data-inkchapter-acceptance-dryrun', 'container')
    layer.appendChild(probe)

    noteEnterEchoWrite('struct:appendChild', probe, 5, 'plugin', 'st')
    const rec = drainEnterEchoWriteTrace().records[0]
    expect(rec.kind).toBe('struct:appendChild')
    expect(rec.targetFingerprint).toContain('tag=DIV')
    expect(rec.targetFingerprint).toContain('data-inkchapter-acceptance-dryrun=container')
    // the parent proves the write landed inside the paint layer of the content doc
    expect(rec.targetFingerprint).toContain('parent=DIV.inkchapter-locate-document-layer')
  })

  it('HOLD-3: production dry-run is gated BEFORE its first content-document write', () => {
    const hostSrc = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const fnStart = hostSrc.indexOf('private runBlankRowPaintLayerAcceptanceDryRun')
    expect(fnStart).toBeGreaterThan(-1)
    const disable = hostSrc.indexOf('blankRowAcceptanceDryRunEnabled', fnStart)
    const guard = hostSrc.indexOf('isContentDocumentWriteHoldActive()', fnStart)
    const firstContentWrite = hostSrc.indexOf('this.ensureLocateDocumentLayer()', fnStart)
    expect(disable).toBeGreaterThan(fnStart)
    expect(guard).toBeGreaterThan(disable)
    expect(firstContentWrite).toBeGreaterThan(guard) // every gate precedes every content write
    // production default is OFF (the DOM-mutating probe never runs while editing)
    expect(hostSrc).toContain('private blankRowAcceptanceDryRunEnabled: boolean = false')
    // both gates are real, audited early-returns (never silent skips)
    expect(hostSrc).toContain('DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-DISABLED')
    expect(hostSrc).toContain('DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-HELD')
  })
})

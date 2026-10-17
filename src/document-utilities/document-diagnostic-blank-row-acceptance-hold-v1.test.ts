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
  getEnterEchoWriteHoldRemainingMs,
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

  it('HOLD-4: remaining-ms accessor mirrors the armed window (0 when unarmed)', () => {
    armEnterEchoWriteTrace('S', 250, 1000)
    expect(getEnterEchoWriteHoldRemainingMs(1000)).toBe(250)
    expect(getEnterEchoWriteHoldRemainingMs(1200)).toBe(50)
    expect(getEnterEchoWriteHoldRemainingMs(1250)).toBe(0)
    expect(getEnterEchoWriteHoldRemainingMs(9999)).toBe(0)
    armEnterEchoWriteTrace('S', 0, 0)
    expect(getEnterEchoWriteHoldRemainingMs(10)).toBe(0)
  })

  it('HOLD-5 (EN-11): reconcile presentation paints into #write are DEFERRED during the echo window', () => {
    const hostSrc = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const helperStart = hostSrc.indexOf('private runContentDocumentPaint(')
    expect(helperStart).toBeGreaterThan(-1)
    // the helper is a real deferral: it checks the hold, audits, and re-runs AFTER the window
    expect(hostSrc).toContain('DOCUMENT-DIAGNOSTIC-ECHO-WINDOW-PAINT-HELD')
    // R3 — the deferral is owned by the SINGLE coordinator (no per-site setTimeout)
    expect(hostSrc).toContain('new PresentationPaintCoordinator(')
    expect(hostSrc).toContain('this.getPaintCoordinator().request(')
    expect(hostSrc).not.toContain('setTimeout(() => { try { paint() }')
    // the three reconcile-driven #write paints MUST be routed through the helper
    for (const call of [
      'this.runContentDocumentPaint(\'HEADING_MARKERS\', () => this.renderHeadingDiagnosticMarkers())',
      'this.runContentDocumentPaint(\'ACTIVE_HEADING_EMPHASIS\', () => this.renderActiveHeadingEmphasisForCommittedVisual())',
      'this.runContentDocumentPaint(\'ACTIVE_BLOCK_GAP_RECOMMIT\', () => this.recommitActiveBlockGapVisual())',
    ]) {
      expect(hostSrc).toContain(call)
    }
    // and the raw (unguarded) calls must be GONE: every bare render call must sit
    // on a runContentDocumentPaint(...) line — count parity proves it (falsifiable).
    const countOf = (needle: string): number => hostSrc.split(needle).length - 1
    expect(countOf('this.renderHeadingDiagnosticMarkers()')).toBe(
      countOf("runContentDocumentPaint('HEADING_MARKERS'")
      + countOf("runContentDocumentPaint('REFLOOR_MARKERS'")
      + countOf("runContentDocumentPaint('HEADING_TEXT_CHANGED_MARKERS'"),
    )
    expect(countOf('this.renderActiveHeadingEmphasisForCommittedVisual()')).toBe(
      countOf("runContentDocumentPaint('ACTIVE_HEADING_EMPHASIS'")
      + countOf("runContentDocumentPaint('REFLOOR_ACTIVE_EMPHASIS'")
      + countOf("runContentDocumentPaint('PASSIVE_ACTIVE_EMPHASIS'")
      + countOf("runContentDocumentPaint('HEADING_TEXT_CHANGED_ACTIVE_EMPHASIS'"),
    )
    expect(countOf('this.recommitActiveBlockGapVisual()')).toBe(1)
    expect(countOf("runContentDocumentPaint('ACTIVE_BLOCK_GAP_RECOMMIT'")).toBe(1)
  })
})

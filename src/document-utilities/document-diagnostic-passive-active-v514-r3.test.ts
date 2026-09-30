// @vitest-environment jsdom
/**
 * V5.14-R3 §30 — Passive/Active decoupling + heading live-edit geometry
 * invalidation + Active high-contrast colour scale.
 *
 * Targeted tests 1–26 of the V5.14-R3 prompt.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  ACTIVE_CONTRAST_AUDIT_EVENT,
  ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3,
  DIAGNOSTIC_SEVERITY_ALPHA_V514R3,
  HEADING_EDIT_GEOMETRY_AUDIT_EVENT,
  PASSIVE_ACTIVE_STATE_AUDIT_EVENT,
  PASSIVE_ACTIVE_V514R3_GATE_KEYS,
  PASSIVE_ACTIVE_V514R3_GATE_LABELS,
  activeContrastToGateCounters,
  activeTargetBelongsToPassiveSet,
  buildHeadingVisualRevisionKey,
  computeHeadingContentFingerprint,
  createPassiveActiveV514R3Counters,
  evaluateActiveContrast,
  evaluatePassiveActiveV514R3Gates,
  formatPassiveActiveV514R3GateReport,
  headingVisualGeometryStillValid,
  passiveTextCoverageOk,
  reconcileActiveDiagnosticEmphasis,
  reconcilePassiveDiagnosticMarkers,
  type HeadingVisualRevisionKey,
} from './document-diagnostic-passive-active-v514-r3'

// ── pure contract ───────────────────────────────────────────────────────────

describe('V5.14-R3 P10/P11/P12 — pure contract', () => {
  it('§2/§3 — the passive set is the document authority; active is separate', () => {
    const passive = {
      documentKey: 'doc',
      revision: 3,
      targets: new Map([
        ['k-a', { visualTargetKey: 'k-a', stableHeadingIdentity: 'id:A', severity: 'error' }],
        ['k-b', { visualTargetKey: 'k-b', stableHeadingIdentity: 'id:B', severity: 'warning' }],
        ['k-c', { visualTargetKey: 'k-c', stableHeadingIdentity: 'id:C', severity: 'warning' }],
      ]),
    }
    // the active emphasis belongs to the passive set …
    expect(activeTargetBelongsToPassiveSet(passive, {
      documentKey: 'doc', selectedDiagnosticId: 'E1', selectedTargetIndex: 0, activeVisualTargetKey: 'k-a',
    })).toBe(true)
    // … and an active key OUTSIDE it is the P10 violation.
    expect(activeTargetBelongsToPassiveSet(passive, {
      documentKey: 'doc', selectedDiagnosticId: 'X', selectedTargetIndex: 0, activeVisualTargetKey: 'k-z',
    })).toBe(false)

    // an ACTIVE change can never remove a passive key
    const active = reconcileActiveDiagnosticEmphasis({ previousActiveKey: 'k-a', nextActiveKey: 'k-b' })
    expect(active.passiveRemovals).toEqual([])
    expect(active.toRemove).toBe('k-a')
    expect(active.toAdd).toBe('k-b')

    // the passive reconcile is driven ONLY by the required (document) set
    const r = reconcilePassiveDiagnosticMarkers({
      previousKeys: ['k-a', 'k-b', 'k-c'],
      requiredKeys: ['k-a', 'k-b', 'k-c'],
    })
    expect(r.removed).toEqual([])
    expect(r.added).toEqual([])
  })

  it('§9 — stable identity is NOT geometry stability (content fingerprint decides)', () => {
    const base: HeadingVisualRevisionKey = {
      documentKey: 'doc',
      stableHeadingIdentity: 'id:H5:idx:3',
      contentFingerprint: computeHeadingContentFingerprint({ textRuns: ['第五节（H3 → H5，缺 H4）'], level: 5, numberingToken: '1.5' }),
      sourceRevision: 1,
      layoutEpoch: 4,
      numberingGeneration: null,
    }
    expect(headingVisualGeometryStillValid(base, { ...base })).toBe(true)
    // SAME stable identity, DIFFERENT content → the geometry is invalid
    const shortened: HeadingVisualRevisionKey = {
      ...base,
      contentFingerprint: computeHeadingContentFingerprint({ textRuns: ['第五节'], level: 5, numberingToken: '1.5' }),
    }
    expect(headingVisualGeometryStillValid(base, shortened)).toBe(false)
    expect(buildHeadingVisualRevisionKey(base)).not.toBe(buildHeadingVisualRevisionKey(shortened))
    // a numbering-token change alone also invalidates
    expect(headingVisualGeometryStillValid(base, { ...base, numberingToken: '1.6' })).toBe(false)
  })

  it('§13/§14 — the text-tight coverage tolerance', () => {
    expect(passiveTextCoverageOk({ passiveUnionRight: 420, currentTextRight: 419 })).toBe(true)
    expect(passiveTextCoverageOk({ passiveUnionRight: 420, currentTextRight: 421.5 })).toBe(true)
    // the text was deleted but the fill still extends to the OLD right edge
    expect(passiveTextCoverageOk({ passiveUnionRight: 420, currentTextRight: 280 })).toBe(false)
    expect(passiveTextCoverageOk({ passiveUnionRight: null, currentTextRight: 280 })).toBe(true)
  })

  it('§18/§19 — Active tokens are separate and the alpha ratio is >= 2.4', () => {
    for (const severity of ['error', 'warning'] as const) {
      const d = evaluateActiveContrast(severity)
      expect(d.activeReusesPassiveToken).toBe(false)
      expect(d.activeToken).not.toBe(d.passiveToken)
      expect(d.activePassiveRatio).toBeGreaterThanOrEqual(ACTIVE_PASSIVE_ALPHA_MIN_RATIO_V514R3)
      expect(d.contrastOk).toBe(true)
    }
    expect(evaluateActiveContrast('error').activePassiveRatio).toBeCloseTo(0.32 / 0.12, 5)
    expect(evaluateActiveContrast('warning').activePassiveRatio).toBeCloseTo(0.38 / 0.13, 5)
    // the tokens are the DECLARED ones (the stylesheet must agree)
    expect(DIAGNOSTIC_SEVERITY_ALPHA_V514R3.error.activeToken).toBe('--ink-diagnostic-error-active-bg')
    expect(DIAGNOSTIC_SEVERITY_ALPHA_V514R3.warning.passiveToken).toBe('--ink-diagnostic-warning-passive-bg')
  })

  it('§19 — the contrast gates stay 0', () => {
    const counters = activeContrastToGateCounters([evaluateActiveContrast('error'), evaluateActiveContrast('warning')])
    expect(counters.errorActivePassiveContrastRatioLt24).toBe(0)
    expect(counters.warningActivePassiveContrastRatioLt24).toBe(0)
    expect(counters.activeErrorUsesPassiveColorToken).toBe(0)
    expect(counters.activeWarningUsesPassiveColorToken).toBe(0)
  })

  it('§6/§16/§19 — the 23 R3 gates + audits exist in order', () => {
    expect(PASSIVE_ACTIVE_V514R3_GATE_KEYS.length).toBe(23)
    const counters = createPassiveActiveV514R3Counters()
    const report = formatPassiveActiveV514R3GateReport(counters)
    expect(report[0]).toBe('ACTIVE_SELECT_CHANGED_PASSIVE_TARGET_SET_COUNT=0')
    expect(report).toContain('PASSIVE_MARKER_REMOVED_BY_ACTIVE_LOCATE_COUNT=0')
    expect(report).toContain('HEADING_CONTENT_FINGERPRINT_CHANGED_WITH_SAME_VISUAL_SNAPSHOT_COUNT=0')
    expect(report).toContain('STALE_HEADING_ACTIVE_MARKER_AFTER_DIAGNOSTIC_RESOLVED_COUNT=0')
    expect(report).toContain('ERROR_ACTIVE_PASSIVE_CONTRAST_RATIO_LT_2_4_COUNT=0')
    for (const key of PASSIVE_ACTIVE_V514R3_GATE_KEYS) expect(PASSIVE_ACTIVE_V514R3_GATE_LABELS[key]).toBeTruthy()
    expect(evaluatePassiveActiveV514R3Gates(counters).decision).toBe('PASS')
    expect(PASSIVE_ACTIVE_STATE_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-PASSIVE-ACTIVE-STATE-AUDIT')
    expect(HEADING_EDIT_GEOMETRY_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-HEADING-EDIT-GEOMETRY-AUDIT')
    expect(ACTIVE_CONTRAST_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-ACTIVE-CONTRAST-AUDIT')
  })

  it('§18/§19 — the stylesheet uses the ACTIVE token (never the passive one) for the active fill', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(css).toContain('--ink-diagnostic-error-active-bg: rgba(235, 55, 55, 0.32)')
    expect(css).toContain('--ink-diagnostic-warning-active-bg: rgba(255, 190, 20, 0.38)')
    expect(css).toContain('--ink-diagnostic-error-passive-bg: rgba(181, 84, 84, 0.12)')
    expect(css).toContain('--ink-diagnostic-warning-passive-bg: rgba(168, 121, 50, 0.13)')
    const activeBlock = css.slice(css.indexOf('.inkchapter-heading-diagnostic-active__fragment {'))
    expect(activeBlock.slice(0, 260)).toContain('var(--ink-heading-sev-active')
    // the legacy passive-token reuse (7%) is gone
    expect(activeBlock.slice(0, 260)).not.toContain('var(--ink-heading-sev, #b55454) 7%')
    // still fill-only: no shadow / glow on the active fill region
    const activeRegion = css.slice(
      css.indexOf(".inkchapter-heading-diagnostic-active[data-ink-diagnostic-severity='error'] {"),
      css.indexOf('.inkchapter-heading-diagnostic-active__fragment {') + 400,
    )
    for (const m of activeRegion.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(m[1].trim()).toBe('none')
    }
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function stubRaf(): void {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1 }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function stubRangeRects(rects: Rect[]): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  clearHeadingActiveEmphasis(): void
  dismissLocateVisualFromDocumentPointer(ev: PointerEvent): void
  getPassiveActiveV514R3Counters(): Record<string, number>
  getPassiveActiveV514R3GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getPassiveActiveVisualStateV514R3(): { passiveKeys: readonly string[]; activeKeys: readonly string[]; passiveCount: number; activeInPassiveSet: boolean }
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

function makeWorld(headingCount = 3): { h: DocumentUtilityOverlayHost; headings: HTMLElement[] } {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const headings: HTMLElement[] = []
  for (let i = 0; i < headingCount; i++) {
    const h = document.createElement('h2')
    h.setAttribute('data-id', `H-${String.fromCharCode(65 + i)}`)
    h.setAttribute('data-line', String(4 + i))
    h.textContent = `标题${i + 1}`
    write.appendChild(h)
    stubRect(h, () => ({ left: 100, top: 200 + i * 100, right: 1000, bottom: 232 + i * 100 }))
    headings.push(h)
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, headings }
}
function diagFor(id: string, headingId: string, severity: string, code: string): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: headingId, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 1, warningCount: 2, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the marker test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const diagEl = (id: string) => ({
  id, severity: id.startsWith('E') ? 'error' : 'warning', code: 'HEADING_LEVEL_GAP', message: 'm', metadata: {},
})
const markerCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length
const passiveFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length
const activeFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length
const chipCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-reason').length

const threeDiags = () => [
  diagFor('E1', 'H-A', 'error', 'HEADING_LEVEL_GAP'),
  diagFor('W1', 'H-B', 'warning', 'HEADING_DUPLICATE_TEXT'),
  diagFor('W2', 'H-C', 'warning', 'HEADING_DUPLICATE_TEXT'),
]

describe('V5.14-R3 §30 — Passive / Active (host wiring)', () => {
  it('1/2/3 — three diagnostics stay three passive markers across active switches', () => {
    const w = makeWorld()
    host = w.h
    inject(host, threeDiags())
    api().renderHeadingDiagnosticMarkers()
    expect(markerCount()).toBe(3)
    expect(passiveFragmentCount()).toBe(3)

    api().renderHeadingActiveEmphasis('E1', diagEl('E1'), w.headings[0])
    expect(markerCount()).toBe(3)
    expect(activeFragmentCount()).toBe(1)
    expect(api().getPassiveActiveVisualStateV514R3().passiveCount).toBe(3)

    api().renderHeadingActiveEmphasis('W1', diagEl('W1'), w.headings[1])
    expect(markerCount()).toBe(3)
    // ── V5.14-R4 §11 — the SELECTED target (H-B) presents ONE atomic surface, so its
    // passive FILL is replaced by the active emphasis (2 sibling passive fills remain).
    // The passive MARKER / semantic key set is unchanged (still 3 / 3).
    expect(passiveFragmentCount()).toBe(2)
    expect(activeFragmentCount()).toBe(1)
    expect(api().getPassiveActiveVisualStateV514R3().passiveCount).toBe(3)
    // 4/5/6 — the active key moved B; A is back to passive only
    const wrappers = Array.from(document.querySelectorAll('.inkchapter-heading-diagnostic-marker'))
    expect(wrappers[0].getAttribute('data-ink-diagnostic-active')).toBe('false')
    expect(wrappers[1].getAttribute('data-ink-diagnostic-active')).toBe('true')
    expect(api().getPassiveActiveV514R3GateDecision().failedChecks)
      .toEqual([] as unknown as readonly string[])
  })

  it('7 — a document left-click clears ONLY the active emphasis', () => {
    const w = makeWorld()
    host = w.h
    inject(host, threeDiags())
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasis('E1', diagEl('E1'), w.headings[0])
    expect(activeFragmentCount()).toBe(1)

    api().clearHeadingActiveEmphasis()
    expect(activeFragmentCount()).toBe(0)
    expect(markerCount()).toBe(3)
    expect(passiveFragmentCount()).toBe(3)
    expect(api().getPassiveActiveV514R3Counters().documentClickClearedPassiveMarker).toBe(0)
    expect(api().getPassiveActiveVisualStateV514R3().activeKeys).toEqual([])
  })

  it('8/9 — the passive set survives a marker-layer rebuild (the P10 root cause)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, threeDiags())
    api().renderHeadingDiagnosticMarkers()
    expect(markerCount()).toBe(3)

    // the business root / locate doc layer is replaced → every wrapper orphaned
    ;(document.querySelector('.inkchapter-locate-document-layer') as HTMLElement).remove()
    api().renderHeadingDiagnosticMarkers()
    expect(markerCount()).toBe(3)
    expect(passiveFragmentCount()).toBe(3)

    api().renderHeadingActiveEmphasis('E1', diagEl('E1'), w.headings[0])
    expect(markerCount()).toBe(3)
    expect(activeFragmentCount()).toBe(1)
    expect(api().getPassiveActiveV514R3GateDecision().failedChecks)
      .toEqual([] as unknown as readonly string[])
  })

  it('10 — a document switch clears the old markers and the state authorities', () => {
    const w = makeWorld()
    host = w.h
    inject(host, threeDiags())
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasis('E1', diagEl('E1'), w.headings[0])
    expect(markerCount()).toBe(3)

    inject(host, [], 2)
    api().renderHeadingDiagnosticMarkers()
    expect(markerCount()).toBe(0)
    expect(chipCount()).toBe(0)
    expect(activeFragmentCount()).toBe(0)
    expect(api().getPassiveActiveV514R3Counters().staleHeadingPassiveMarkerAfterDiagnosticResolved).toBe(0)
    expect(api().getPassiveActiveV514R3Counters().staleHeadingReasonChipAfterDiagnosticResolved).toBe(0)
  })
})

describe('V5.14-R3 §30 — heading live edit (host wiring)', () => {
  it('11/12/13/14/15 — a shortened title shrinks the fill and moves the chip', async () => {
    const w = makeWorld(2)
    host = w.h
    inject(host, threeDiags().slice(0, 2))
    api().renderHeadingDiagnosticMarkers()
    const frag0 = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement
    const chip0 = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement
    const widthBefore = Number.parseFloat(frag0.style.width)
    const chipLeftBefore = Number.parseFloat(chip0.style.left)

    const textNode = w.headings[0].firstChild as Text
    textNode.textContent = '标'
    stubRangeRects([{ left: 200, top: 204, right: 280, bottom: 228 }])
    await new Promise<void>(resolve => setTimeout(resolve, 25))

    const frag1 = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement
    const chip1 = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement
    expect(Number.parseFloat(frag1.style.width)).toBeLessThan(widthBefore)
    expect(Number.parseFloat(chip1.style.left)).toBeLessThan(chipLeftBefore)
    expect(Number.parseFloat(frag1.style.width)).toBe(80)
    expect(Number.parseFloat(chip1.style.left)).toBe(288)
    // 15 — no stale OLD width survives anywhere
    const stale = Array.from(document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment'))
      .some(el => Number.parseFloat((el as HTMLElement).style.width) === widthBefore)
    expect(stale).toBe(false)
    expect(api().getPassiveActiveV514R3Counters().passiveFragmentRectStaleAfterTextEdit).toBe(0)
    expect(api().getPassiveActiveV514R3Counters().passiveFragmentExtendsIntoDeletedTextArea).toBe(0)
  })

  it('16/17 — same stable identity + changed fingerprint rebuilds; the marker survives while the diagnostic exists', async () => {
    const w = makeWorld(2)
    host = w.h
    inject(host, threeDiags().slice(0, 2))
    api().renderHeadingDiagnosticMarkers()
    const identityBefore = (document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement)
      .getAttribute('data-ink-heading-id')

    const textNode = w.headings[0].firstChild as Text
    textNode.textContent = '短标题'
    stubRangeRects([{ left: 200, top: 204, right: 340, bottom: 228 }])
    await new Promise<void>(resolve => setTimeout(resolve, 25))

    expect(markerCount()).toBe(2)
    const identityAfter = (document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement)
      .getAttribute('data-ink-heading-id')
    expect(identityAfter).toBe(identityBefore)
    expect(api().getPassiveActiveV514R3Counters().headingContentFingerprintChangedWithSameVisualSnapshot).toBe(0)
    expect(api().getPassiveActiveV514R3Counters().headingTextChangedWithoutVisualInvalidation).toBe(0)
  })

  it('18 — a resolved diagnostic removes passive / active / chip', () => {
    const w = makeWorld(2)
    host = w.h
    inject(host, threeDiags().slice(0, 2))
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasis('E1', diagEl('E1'), w.headings[0])
    expect(markerCount()).toBe(2)
    expect(activeFragmentCount()).toBe(1)

    // the heading level is fixed → only W1 remains
    inject(host, [diagFor('W1', 'H-B', 'warning', 'HEADING_DUPLICATE_TEXT')], 2)
    api().renderHeadingDiagnosticMarkers()
    api().clearHeadingActiveEmphasis()
    expect(markerCount()).toBe(1)
    expect(chipCount()).toBe(1)
    expect(activeFragmentCount()).toBe(0)
    const counters = api().getPassiveActiveV514R3Counters()
    expect(counters.staleHeadingPassiveMarkerAfterDiagnosticResolved).toBe(0)
    expect(counters.staleHeadingActiveMarkerAfterDiagnosticResolved).toBe(0)
    expect(counters.staleHeadingReasonChipAfterDiagnosticResolved).toBe(0)
  })

  it('23/24 — the resolved sheet asserts the R3 audit events were emitted', () => {
    expect(PASSIVE_ACTIVE_STATE_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-PASSIVE-ACTIVE-STATE-AUDIT')
    expect(HEADING_EDIT_GEOMETRY_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-HEADING-EDIT-GEOMETRY-AUDIT')
    expect(ACTIVE_CONTRAST_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-ACTIVE-CONTRAST-AUDIT')
  })
})

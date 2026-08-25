// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.3.1 — Runtime Audit Closure focused tests:
 *  - RO-AUDIT-1..4: feedback confirmed requires a PROVEN write1→callback→write2
 *    causal token; write→callback→noop is UTILITY_RESIZE_ECHO (never confirmed);
 *    external resize overlap is never confirmed.
 *  - NAV-HIDDEN-AUDIT-1..5: legally-hidden navigator must be NOT_EVALUATED in
 *    NAV-PLACEMENT and EXPECTED_HIDDEN/GEOMETRY_VALID_NAV_EXPECTED_HIDDEN in BCR
 *    (never POSITION_DRIFT / GEOMETRY_PENDING); visible navigator keeps PASS/DRIFT.
 *  - DRAWER-AUDIT-1..4: drawer re-render triggers a READ-ONLY content layout audit
 *    with the LATEST itemCount and geometryWriteDelta=0; duplicate states suppressed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  computeBcrVerdict,
  DocumentUtilityOverlayHost,
  evaluateNavigatorPlacement,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
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
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

const VIEWPORT = 1920

let roCallback: ResizeObserverCallback | null = null
let rafQueue: Array<() => void> = []
const auditLines: string[] = []
let clock = 0

function makeShell() {
  const rect = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }
  const shell = document.createElement('div')
  shell.style.cssText = 'overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value: 2000 })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, writable: true, value: 800 })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return { shell, rect }
}

/** HTMLElement.scrollHeight is readonly in the TS DOM lib; re-define it mutable. */
function setScrollHeight(shell: HTMLElement, value: number): void {
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value })
}

function auditEvents(lines: string[]): Array<{ event: string; payload: Record<string, string> }> {
  const out: Array<{ event: string; payload: Record<string, string> }> = []
  for (const line of lines) {
    const m = line.match(/\[InkChapter\] ([A-Z-]+):(.*)$/)
    if (!m) continue
    const event = m[1]
    const payload: Record<string, string> = {}
    // key=value pairs (values are simple tokens or JSON; naive split is fine here).
    const body = m[2] ?? ''
    const re = /([A-Za-z][A-Za-z0-9]*)=([^\s]+(?:\s+\{.*\})?)/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(body)) !== null) payload[mm[1]] = mm[2]
    out.push({ event, payload })
  }
  return out
}

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return h
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 })
  roCallback = null
  rafQueue = []
  auditLines.length = 0
  clock = 0
  // Controlled monotonic clock: keeps the write→callback delta inside the
  // 100ms attribution window deterministically (jsdom wall time can drift).
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { roCallback = cb }
    observe(): void {} unobserve(): void {} disconnect(): void {}
  })
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    auditLines.push(String(args[0] ?? ''))
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ── RO-AUDIT: ResizeObserver causal classification ────────────────────

describe('RO-AUDIT-1/2/3/4 feedback causal classification', () => {
  function capturedRaf(): void {
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0))
      return rafQueue.length
    }) as typeof requestAnimationFrame)
  }

  it('RO-AUDIT-1: write → one RO callback → geometry noop → UTILITY_RESIZE_ECHO, confirmed unchanged', () => {
    capturedRaf()
    const { shell } = makeShell()
    const h = mountHost()
    rafQueue.shift()?.() // flush mount geometry → write1
    expect(h.getGeometryCounters().writeCount).toBe(1)
    // The shell transiently changes (whatever source) and the RO observes it
    // right after a utility write with no external resize.
    const rect = shell.getBoundingClientRect() as unknown as { width: number; right: number }
    rect.width = 1250
    rect.right = 1500
    roCallback!([], undefined as never)
    // The shell settles back to the value write1 already encoded → geometry noop.
    rect.width = 1150
    rect.right = 1400
    rafQueue.shift()?.() // flush → NOOP → echo terminates the causal token
    const g = h.getGeometryCounters()
    expect(g.feedbackLoopSuspectCount).toBe(1)
    expect(g.utilityResizeEchoCount).toBe(1)
    expect(g.feedbackLoopConfirmedCount).toBe(0)
    // An unrelated later write must NOT confirm (echo already settled).
    rect.width = 1350
    rect.right = 1550
    window.dispatchEvent(new Event('resize')) // schedules a real geometry write
    rafQueue.shift()?.()
    expect(h.getGeometryCounters().feedbackLoopConfirmedCount).toBe(0)
    h.dispose()
  })

  it('RO-AUDIT-2: write1 → RO callback → write2 (proven causal token) → confirmed++', () => {
    capturedRaf()
    const { shell } = makeShell()
    const h = mountHost()
    rafQueue.shift()?.() // write1
    const rect = shell.getBoundingClientRect() as unknown as { width: number; right: number }
    rect.width = 1250
    rect.right = 1500
    roCallback!([], undefined as never) // observes the change after write1
    rafQueue.shift()?.() // write2 (geometry changed) completes the loop token
    const g = h.getGeometryCounters()
    expect(g.writeCount).toBe(2)
    expect(g.feedbackLoopConfirmedCount).toBe(1)
    h.dispose()
  })

  it('RO-AUDIT-3: window resize + utility write overlap with external epoch → NOT CONFIRMED', () => {
    capturedRaf()
    const { shell } = makeShell()
    const h = mountHost()
    rafQueue.shift()?.() // write1
    window.dispatchEvent(new Event('resize')) // externalResizeEpoch++ + schedule
    const rect = shell.getBoundingClientRect() as unknown as { width: number; right: number }
    rect.width = 1250
    rect.right = 1500
    rafQueue.shift()?.() // flush resize-scheduled geometry → write2
    roCallback!([], undefined as never) // externalRecent=true → never sets the flag
    rafQueue.shift()?.() // flush callback-scheduled geometry
    const g = h.getGeometryCounters()
    expect(g.feedbackLoopConfirmedCount).toBe(0)
    expect(g.mixedCorrelationCount).toBeGreaterThanOrEqual(1)
    h.dispose()
  })

  it('RO-AUDIT-4: only the proven write→callback→write chain changes confirmed', () => {
    capturedRaf()
    const { shell } = makeShell()
    // Echo sequence → confirmed stays 0.
    const echoHost = mountHost()
    rafQueue.shift()?.() // write1
    const rect = shell.getBoundingClientRect() as unknown as { width: number; right: number }
    rect.width = 1250
    rect.right = 1500
    roCallback!([], undefined as never)
    rect.width = 1150
    rect.right = 1400
    rafQueue.shift()?.() // noop → echo terminates
    expect(echoHost.getGeometryCounters().feedbackLoopConfirmedCount).toBe(0)
    expect(echoHost.getGeometryCounters().utilityResizeEchoCount).toBe(1)
    echoHost.dispose()

    // Loop sequence on a FRESH host → confirmed becomes 1 via the proven token.
    document.body.innerHTML = ''
    rafQueue = []
    roCallback = null
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 })
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { roCallback = cb }
      observe(): void {} unobserve(): void {} disconnect(): void {}
    })
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0))
      return rafQueue.length
    }) as typeof requestAnimationFrame)
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      auditLines.push(String(args[0] ?? ''))
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeShell()
    const loopHost = mountHost()
    rafQueue.shift()?.() // write1
    const shellEl = document.querySelector('#write')!.parentElement as HTMLElement
    Object.defineProperty(shellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 250, top: 100, right: 1500, bottom: 900, width: 1300, height: 800 }),
    })
    roCallback!([], undefined as never) // observes the shell changed after write1
    rafQueue.shift()?.() // write2 completes the causal token → confirmed++
    expect(loopHost.getGeometryCounters().feedbackLoopConfirmedCount).toBe(1)
    loopHost.dispose()
  })
})

// ── NAV-HIDDEN-AUDIT: legally-hidden navigator audits ─────────────────

describe('NAV-HIDDEN-AUDIT-1..5 hidden navigator audit closure', () => {
  function immediateRaf(): void {
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  }
  function shortShell(): HTMLElement {
    const s = makeShell().shell
    setScrollHeight(s, 700) // maxScrollTop = 0 → navigator expected hidden
    return s
  }
  function openDrawer(): void {
    ;(document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement).click()
  }

  it('NAV-HIDDEN-AUDIT-1: short doc drawer open → NAV-PLACEMENT NOT_EVALUATED/NAVIGATOR_EXPECTED_HIDDEN', () => {
    immediateRaf()
    shortShell()
    const h = mountHost()
    openDrawer()
    const lines = auditEvents(auditLines).filter(e => e.event === 'DOCUMENT-UTILITY-NAV-PLACEMENT')
    const last = lines[lines.length - 1]
    expect(last).toBeTruthy()
    expect(last.payload.decision).toBe('NOT_EVALUATED')
    expect(last.payload.decisionReason).toBe('NAVIGATOR_EXPECTED_HIDDEN')
    h.dispose()
  })

  it('NAV-HIDDEN-AUDIT-2: short doc → BCR EXPECTED_HIDDEN (never GEOMETRY_PENDING for the navigator) + AUDIT-INVARIANT PASS', () => {
    immediateRaf()
    shortShell()
    const h = mountHost()
    const pure = computeBcrVerdict({
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: false, navigatorExpectedVisible: false,
      toolbarFullscreen: false, navigatorFullscreen: false, drawerFullscreen: false,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(pure).toBe('GEOMETRY_VALID_NAV_EXPECTED_HIDDEN')
    openDrawer()
    const invariants = auditEvents(auditLines).filter(e => e.event === 'DOCUMENT-UTILITY-NAVIGATOR-AUDIT-INVARIANT')
    expect(invariants.length).toBeGreaterThanOrEqual(1)
    expect(invariants[invariants.length - 1].payload.decision).toBe('PASS')
    expect(invariants[invariants.length - 1].payload.expectedVisible).toBe('false')
    h.dispose()
  })

  it('NAV-HIDDEN-AUDIT-3: expected-visible + 0×0 navigator → GEOMETRY_PENDING (real missing)', () => {
    const v = computeBcrVerdict({
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: false, navigatorExpectedVisible: true,
      toolbarFullscreen: false, navigatorFullscreen: false, drawerFullscreen: false,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(v).toBe('GEOMETRY_PENDING')
  })

  it('NAV-HIDDEN-AUDIT-4: expected-visible + delta<=1 → PASS', () => {
    const viewport = { width: VIEWPORT, height: 1080 }
    const shell = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }
    const r = evaluateNavigatorPlacement({
      drawerOpen: false, navigatorExpectedVisible: true,
      navigatorRect: { left: 1372 - 38, top: 800, right: 1372, bottom: 866, width: 38, height: 66 },
      shellRect: shell, viewport, tolerancePx: 3,
    })
    expect(r.decision).toBe('PASS')
  })

  it('NAV-HIDDEN-AUDIT-5: expected-visible + delta>1 → POSITION_DRIFT', () => {
    const viewport = { width: VIEWPORT, height: 1080 }
    const shell = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }
    const r = evaluateNavigatorPlacement({
      drawerOpen: false, navigatorExpectedVisible: true,
      navigatorRect: { left: 1012 - 38, top: 800, right: 1012, bottom: 866, width: 38, height: 66 },
      shellRect: shell, viewport, tolerancePx: 3,
    })
    expect(r.decision).toBe('NAVIGATOR_POSITION_DRIFT')
  })

  it('NAV-HIDDEN-AUDIT-6: hidden navigator produces NO false POSITION_DRIFT anywhere', () => {
    immediateRaf()
    shortShell()
    const h = mountHost()
    openDrawer()
    const placements = auditEvents(auditLines).filter(e => e.event === 'DOCUMENT-UTILITY-NAV-PLACEMENT')
    for (const p of placements) {
      expect(p.payload.decision).not.toBe('NAVIGATOR_POSITION_DRIFT')
    }
    h.dispose()
  })
})

// ── DRAWER-AUDIT: read-only drawer content layout audit ───────────────

describe('DRAWER-AUDIT-1..4 drawer re-render read-only audit', () => {
  function immediateRaf(): void {
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  }
  function setItems(h: DocumentUtilityOverlayHost, count: number): void {
    const items: Array<{ code: string; severity: 'warning'; message: string; detail: string | null }> = []
    for (let i = 0; i < count; i++) items.push({ code: `W${i}`, severity: 'warning', message: `警告项 ${i}`, detail: null })
    h['snapshot'] = {
      documentKey: 'doc:key', revision: 3, sourceRevision: 3, generatedAt: 0,
      diagnostics: items as never,
      errorCount: 0, warningCount: count, infoCount: 0,
    }
    h['renderDrawer']()
  }
  function drawerAudits(lines: string[]): Array<{ event: string; payload: Record<string, string> }> {
    return auditEvents(lines).filter(e => e.event === 'DOCUMENT-UTILITY-DRAWER-CONTENT-LAYOUT')
  }
  function openDrawer(): void {
    ;(document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement).click()
  }

  it('DRAWER-AUDIT-1: 2 → 1 item → latest itemCount=1, geometryWriteDelta=0', () => {
    immediateRaf()
    makeShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 2)
    setItems(h, 1)
    const audits = drawerAudits(auditLines)
    expect(audits.length).toBeGreaterThanOrEqual(2)
    expect(audits[audits.length - 1].payload.itemCount).toBe('1')
    expect(audits[audits.length - 1].payload.geometryWriteDelta).toBe('0')
    h.dispose()
  })

  it('DRAWER-AUDIT-2: 1 → 0 item → latest itemCount=0, geometryWriteDelta=0', () => {
    immediateRaf()
    makeShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 1)
    setItems(h, 0)
    const audits = drawerAudits(auditLines)
    expect(audits[audits.length - 1].payload.itemCount).toBe('0')
    expect(audits[audits.length - 1].payload.geometryWriteDelta).toBe('0')
    h.dispose()
  })

  it('DRAWER-AUDIT-3: 9 → 12 item → latest itemCount=12, bodyScrollable=true, geometryWriteDelta=0', () => {
    immediateRaf()
    makeShell()
    const h = mountHost()
    openDrawer()
    // Simulate layout: drawer capped at its geometry maxHeight with an
    // internally scrolling list (jsdom has no layout engine, so stub metrics).
    const drawerEl = h['drawerEl'] as HTMLElement
    const maxH = Number.parseInt(drawerEl.style.maxHeight) || 784
    const list = h['drawerListEl'] as HTMLElement
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: maxH })
    Object.defineProperty(drawerEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 250, top: 100, right: 610, bottom: 100 + maxH, width: 360, height: maxH, toJSON: () => ({}) }),
    })
    setItems(h, 9)
    setItems(h, 12)
    const audits = drawerAudits(auditLines)
    const last = audits[audits.length - 1]
    expect(last.payload.itemCount).toBe('12')
    expect(last.payload.drawerBodyScrollable).toBe('true')
    expect(last.payload.geometryWriteDelta).toBe('0')
    h.dispose()
  })

  it('DRAWER-AUDIT-4: identical state → duplicate audit suppressed', () => {
    immediateRaf()
    makeShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 2)
    setItems(h, 2) // identical state → suppressed
    const audits = drawerAudits(auditLines)
    const item2 = audits.filter(a => a.payload.itemCount === '2')
    expect(item2.length).toBe(1)
    h.dispose()
  })
})

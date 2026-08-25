// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8-B — STRICT-SINGLE-H1 popup dedup + event-driven Scroll
 * Operation authority.
 *
 * SINGLE-H1-6..9  popup transitions / dedup / re-arm
 * DIAG-AUTH-*     diagnostics authority (content dedup, locate action, locked)
 * SCROLL-OP-1..12 finite operation: settle, live target, recovery, cancel,
 *                  geometry change, no-scroll-event, supersede, cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsAuthority, DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'

// ── Shared harness ────────────────────────────────────────────────────

/** Canonical H1 fact in the REAL production-like shape (physicalLevel on the fact). */
interface TestCanonicalH1Fact {
  stableIdentity: string
  element: HTMLElement | null
  physicalLevel: number
}

function waitH1Result(): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'WAIT', reason: 'FRAME_NOT_READY', documentKey: null, framePresent: false,
    frameDocumentKey: null, semanticRevision: 0, frameGeneration: 0, canonicalEntryCount: 0,
    mappedEntryCount: 0, invalidEntryCount: 0, physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

function readyH1Result(facts: readonly TestCanonicalH1Fact[], documentKey: string): DiagnosticCanonicalHeadingAuthorityResult {
  const withText = facts.map(f => ({ stableIdentity: f.stableIdentity, element: f.element, physicalLevel: f.physicalLevel, text: '' }))
  const h1Facts = withText.filter(f => f.physicalLevel === 1)
  return {
    state: 'READY', reason: 'READY', documentKey, framePresent: true, frameDocumentKey: documentKey,
    semanticRevision: 1, frameGeneration: 1, canonicalEntryCount: facts.length,
    mappedEntryCount: facts.length, invalidEntryCount: 0,
    physicalLevels: facts.map(f => f.physicalLevel),
    headingFacts: withText,
    h1Facts,
    h1Count: h1Facts.length, h1StableIdentities: h1Facts.map(f => f.stableIdentity),
  }
}

function fakeProviders(overrides: Partial<DocumentDiagnosticsProviders> = {}): DocumentDiagnosticsProviders {
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
    getCanonicalH1Facts: () => waitH1Result(),
    ...overrides,
  }
}

interface MutableDocState {
  documentKey: string
  markdown: string
  strict: boolean
  /** null = frame not ready (WAIT); array = READY canonical facts. */
  h1Facts: readonly TestCanonicalH1Fact[] | null
}

function makeMutableState(init: Partial<MutableDocState> = {}): MutableDocState {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n\n',
    strict: true,
    h1Facts: [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }],
    ...init,
  }
}

function makeHost(state: MutableDocState): DocumentUtilityOverlayHost {
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => state.documentKey,
      getMarkdown: () => state.markdown,
      isStrictMode: () => state.strict,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  const providers = fakeProviders({
    getCanonicalH1Facts: () => (state.h1Facts == null ? waitH1Result() : readyH1Result(state.h1Facts, state.documentKey)),
  })
  return new DocumentUtilityOverlayHost({ ctx, providers, onBindDocument: () => {} })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── SINGLE-H1 popup dedup ─────────────────────────────────────────────
describe('SINGLE-H1 popup dedup (overlay host)', () => {
  it('SINGLE-H1-6: strict 1→2 H1 → popup once', () => {
    const state = makeMutableState()
    const h = makeHost(state)
    h.mount()
    expect(h.getStrictSingleH1PopupCount()).toBe(0)
    state.markdown = '# H1\n\n# H2\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(1)
    h.dispose()
  })

  it('SINGLE-H1-7: editing the second H1 text does NOT re-popup', () => {
    const state = makeMutableState()
    const h = makeHost(state)
    h.mount()
    state.markdown = '# H1\n\n# H2\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(1)
    // Type 10+ chars in the second H1 (identity unchanged → fingerprint unchanged).
    state.markdown = '# H1\n\n# H2 修改了标题文字内容\n\n'
    h.diagnostics.recompute()
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(1)
    h.dispose()
  })

  it('SINGLE-H1-8: 2→1 H1 clears the violation token (no new popup)', () => {
    const state = makeMutableState()
    const h = makeHost(state)
    h.mount()
    state.markdown = '# H1\n\n# H2\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(1)
    state.markdown = '# H1\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(1) // cleared, no re-popup
    h.dispose()
  })

  it('SINGLE-H1-9: 1→2 again after clear → popup allowed once more', () => {
    const state = makeMutableState()
    const h = makeHost(state)
    h.mount()
    state.markdown = '# H1\n\n# H2\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    state.markdown = '# H1\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    state.markdown = '# H1\n\n# H2b\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2b', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    expect(h.getStrictSingleH1PopupCount()).toBe(2)
    h.dispose()
  })

  it('SINGLE-H1-12/DIAG-AUTH-2: document switch A(error)→B(pass) never shows A error', () => {
    const state = makeMutableState({ documentKey: 'doc:a' })
    const h = makeHost(state)
    h.mount()
    state.markdown = '# A1\n\n# A2\n\n'
    state.h1Facts = [{ stableIdentity: 'a1', element: null, physicalLevel: 1 }, { stableIdentity: 'a2', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    // Switch to B (clean doc) — recompute produces a B snapshot with no error.
    state.documentKey = 'doc:b'
    state.markdown = '# B1\n\n'
    state.h1Facts = [{ stableIdentity: 'b1', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    const snap = h.diagnostics.getSnapshot()
    expect(snap?.documentKey).toBe('doc:b')
    expect(snap?.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(false)
    h.dispose()
  })

  it('DIAG-AUTH-1: identical-state recompute does NOT re-publish (no churn)', () => {
    const state = makeMutableState()
    const h = makeHost(state)
    h.mount()
    const snap0 = h.diagnostics.getSnapshot()
    h.diagnostics.recompute()
    h.diagnostics.recompute()
    expect(h.diagnostics.getSnapshot()).toBe(snap0) // same object → no re-publish
    h.dispose()
  })

  it('DIAG-AUTH-6: STRICT-SINGLE-H1 locate targets the SECOND H1 element', () => {
    const second = document.createElement('div')
    second.id = 'h1-second'
    const state = makeMutableState({ h1Facts: [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: second, physicalLevel: 1 }] })
    const h = makeHost(state)
    h.mount()
    state.markdown = '# H1\n\n# H2\n\n'
    state.h1Facts = [{ stableIdentity: 'h1-1', element: null, physicalLevel: 1 }, { stableIdentity: 'h1-2', element: second, physicalLevel: 1 }]
    h.diagnostics.recompute()
    const snap = h.diagnostics.getSnapshot()
    const item = snap?.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')
    expect(item?.locator?.targetElement).toBe(second)
    h.dispose()
  })
})

// ── Scroll Operation ──────────────────────────────────────────────────
function makeScrollContainer(scrollHeight: number, clientHeight: number, scrollTop = 0): { container: HTMLElement; setTop: (v: number) => void; getTop: () => number } {
  const parent = document.createElement('div')
  parent.id = 'scroll-parent'
  const write = document.createElement('div')
  write.id = 'write'
  parent.appendChild(write)
  document.body.appendChild(parent)
  let top = scrollTop
  Object.defineProperty(parent, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(parent, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(parent, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = v },
  })
  return {
    container: parent,
    setTop: (v: number) => { top = v },
    getTop: () => top,
  }
}

function scrollToCalls(container: HTMLElement): Array<{ top: number; behavior: string }> {
  const calls: Array<{ top: number; behavior: string }> = []
  ;(container as unknown as { scrollTo: unknown }).scrollTo = (opts: { top: number; behavior: ScrollBehavior }) => {
    calls.push({ top: opts.top, behavior: opts.behavior })
  }
  return calls
}

function operationLogs(infoSpy: { mock: { calls: Array<Array<unknown>> } }): string[] {
  return infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes('DOCUMENT-UTILITY-SCROLL-OPERATION'))
}

function makeOperationHost(): DocumentUtilityOverlayHost {
  const state = makeMutableState()
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => state.documentKey,
      getMarkdown: () => state.markdown,
      isStrictMode: () => state.strict,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  return new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {} })
}

describe('SCROLL-OP finite operation authority', () => {
  it('SCROLL-OP-1: already at top + GO_TOP → PASS (no operation)', () => {
    vi.useFakeTimers()
    const { container } = makeScrollContainer(2000, 500, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_TOP'): void }).handleScrollAction('GO_TOP')
    const logs = operationLogs(info)
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('decision=PASS')
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    expect(h.getScrollOperationCounters().operationEmitCount).toBe(1)
    vi.useRealTimers()
  })

  it('SCROLL-OP-2: already at bottom + GO_BOTTOM → PASS', () => {
    vi.useFakeTimers()
    const { container } = makeScrollContainer(2000, 500, 1500)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    const logs = operationLogs(info)
    expect(logs[0]).toContain('decision=PASS')
    vi.useRealTimers()
  })

  it('SCROLL-OP-3: smooth scroll >250ms but eventually target → PASS (250ms is NOT authority)', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2400, 500, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    // Progressive smooth scroll: intermediate positions approach 1900 (max).
    vi.advanceTimersByTime(100)
    setTop(600)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(100) // t=200
    setTop(1200)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(100) // t=300 — legacy 250ms sample fired at t=250 with 1200
    setTop(1899)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(100) // t=400
    setTop(1900) // reaches live target
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150) // quiescence → settle
    const logs = operationLogs(info)
    const final = logs[logs.length - 1]
    expect(final).toContain('decision=PASS')
    expect(final).toContain('legacySampleOnly=true')
    expect(final).toContain('legacyWouldPass=false') // 250ms sample was premature
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-4: subpixel tolerance (324.8/325) → PASS', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(325, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(324.8)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=PASS')
    vi.useRealTimers()
  })

  it('SCROLL-OP-5: first settle short (1700/2356) → ONE corrective auto scroll → PASS_RECOVERED', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const calls = scrollToCalls(container)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(1700)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150) // settle → not reached → recovery
    expect(calls.length).toBe(1)
    expect(calls[0].top).toBe(2356)
    expect(calls[0].behavior).toBe('auto')
    setTop(2356)
    vi.advanceTimersByTime(150) // post-recovery settle
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=PASS_RECOVERED')
    expect(logs[logs.length - 1]).toContain('recoveryAttemptCount=1')
    vi.useRealTimers()
  })

  it('SCROLL-OP-6: recovery still short → FAIL_SETTLED_BEFORE_TARGET (truthful)', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const calls = scrollToCalls(container)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(1700)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150) // recovery triggered
    expect(calls.length).toBe(1)
    // corrective scroll still does not reach (stays 1700)
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=FAIL_SETTLED_BEFORE_TARGET')
    expect(logs[logs.length - 1]).toContain('targetReached=false')
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-7: document switch while scrolling → old operation CANCELLED_DOCUMENT_SWITCH', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(500)
    container.dispatchEvent(new Event('scroll'))
    h.bindDocument() // document switch
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=CANCELLED_DOCUMENT_SWITCH')
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    expect(h.getScrollOperationCounters().activeScrollListenerCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-8: container disconnected → FAIL_CONTAINER_DISCONNECTED + cleanup', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(500)
    container.dispatchEvent(new Event('scroll'))
    container.remove()
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=FAIL_CONTAINER_DISCONNECTED')
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-9: target geometry changes during operation → final target recomputed live', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2200, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    // geometry expands: scrollHeight 2200 → 2400 mid-animation
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 2400 })
    setTop(2400)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    const final = logs[logs.length - 1]
    expect(final).toContain('decision=PASS')
    expect(final).toContain('maxScrollTopFinal=2400')
    expect(final).toContain('finalTarget=2400')
    vi.useRealTimers()
  })

  it('SCROLL-OP-10: no scroll events but final target reached → PASS_TARGET_REACHED_AT_DEADLINE', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(2356) // target reached, but NO scroll event fired
    vi.advanceTimersByTime(2000) // safety deadline
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=PASS_TARGET_REACHED_AT_DEADLINE')
    vi.useRealTimers()
  })

  it('SCROLL-OP-11: no scroll events and target not reached → TIMEOUT_BEFORE_SETTLE', () => {
    vi.useFakeTimers()
    const { container } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    // stays at 0, no scroll events
    vi.advanceTimersByTime(2000)
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=TIMEOUT_BEFORE_SETTLE')
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-12: two rapid clicks → previous SUPERSEDED, newest owns authority', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const act = (a: 'GO_TOP' | 'GO_BOTTOM'): void => (h as unknown as { handleScrollAction(x: 'GO_TOP' | 'GO_BOTTOM'): void }).handleScrollAction(a)
    act('GO_BOTTOM')
    setTop(400)
    container.dispatchEvent(new Event('scroll'))
    act('GO_TOP') // supersedes GO_BOTTOM
    const supersededLogs = operationLogs(info)
    expect(supersededLogs.some(l => l.includes('decision=SUPERSEDED'))).toBe(true)
    setTop(0)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    expect(logs[logs.length - 1]).toContain('decision=PASS') // GO_TOP final
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    vi.useRealTimers()
  })

  it('SCROLL-OP-13: dispose releases all listeners/timers', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(500)
    container.dispatchEvent(new Event('scroll'))
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(1)
    h.dispose()
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    expect(h.getScrollOperationCounters().activeScrollListenerCount).toBe(0)
    expect(h.getScrollOperationCounters().activeSafetyDeadlineCount).toBe(0)
    vi.useRealTimers()
  })
})

// ── Phase 7R.3.11.8B.2 — SCROLL-LOCK locked navigation ──────────────────
describe('SCROLL-LOCK locked scroll permitted', () => {
  it('SCROLL-LOCK-1: locked GO_TOP permitted → PASS with locked=true', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 2000)
    const h = makeOperationHost()
    ;(h as unknown as { editGuard: { lock(): void } }).editGuard.lock()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_TOP'): void }).handleScrollAction('GO_TOP')
    setTop(0)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    const final = logs[logs.length - 1]
    expect(final).toContain('source=BUTTON')
    expect(final).toContain('locked=true')
    expect(final).toContain('action=GO_TOP')
    expect(final).toContain('decision=PASS')
    vi.useRealTimers()
  })

  it('SCROLL-LOCK-2: locked GO_BOTTOM permitted → PASS with locked=true', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    ;(h as unknown as { editGuard: { lock(): void } }).editGuard.lock()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(2356)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    const logs = operationLogs(info)
    const final = logs[logs.length - 1]
    expect(final).toContain('source=BUTTON')
    expect(final).toContain('locked=true')
    expect(final).toContain('action=GO_BOTTOM')
    expect(final).toContain('decision=PASS')
    vi.useRealTimers()
  })

  it('SCROLL-LOCK-3: operation cleanup after settle → active=0', () => {
    vi.useFakeTimers()
    const { container, setTop } = makeScrollContainer(2356, 0, 0)
    const h = makeOperationHost()
    ;(h as unknown as { editGuard: { lock(): void } }).editGuard.lock()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ;(h as unknown as { handleScrollAction(a: 'GO_BOTTOM'): void }).handleScrollAction('GO_BOTTOM')
    setTop(2356)
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(150)
    expect(h.getScrollOperationCounters().activeOperationCount).toBe(0)
    expect(h.getScrollOperationCounters().activeScrollListenerCount).toBe(0)
    expect(h.getScrollOperationCounters().activeSafetyDeadlineCount).toBe(0)
    vi.useRealTimers()
  })
})

// ── Phase 7R.3.11.8B.2 — EOF live mutation closure ──────────────────────
function hasTrailingWarning(snap: ReturnType<DocumentDiagnosticsAuthority['getSnapshot']>): boolean {
  return snap?.diagnostics.some(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINE') ?? false
}

describe('EOF live mutation (authority recompute)', () => {
  it('EOF-1: valid trailing blank line → warning 0', () => {
    const state = makeMutableState({ markdown: '# H1\n\n' })
    const h = makeHost(state)
    h.mount()
    expect(hasTrailingWarning(h.diagnostics.getSnapshot())).toBe(false)
    h.dispose()
  })

  it('EOF-2: remove blank line → DOCUMENT_TRAILING_BLANK_LINE warning appears', () => {
    const state = makeMutableState({ markdown: '# H1\n\n' })
    const h = makeHost(state)
    h.mount()
    expect(hasTrailingWarning(h.diagnostics.getSnapshot())).toBe(false)
    state.markdown = '# H1\n' // delete the trailing blank line
    h.diagnostics.recompute()
    const snap = h.diagnostics.getSnapshot()
    expect(hasTrailingWarning(snap)).toBe(true)
    const item = snap?.diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINE')
    expect(item?.metadata?.reason).toBe('MISSING_TRAILING_BLANK_LINE')
    h.dispose()
  })

  it('EOF-3: restore blank line → warning cleared', () => {
    const state = makeMutableState({ markdown: '# H1\n' })
    const h = makeHost(state)
    h.mount()
    expect(hasTrailingWarning(h.diagnostics.getSnapshot())).toBe(true)
    state.markdown = '# H1\n\n'
    h.diagnostics.recompute()
    expect(hasTrailingWarning(h.diagnostics.getSnapshot())).toBe(false)
    h.dispose()
  })

  it('EOF-4: document switch A(missing blank)→B(valid) → B shows no stale warning', () => {
    const state = makeMutableState({ documentKey: 'doc:A', markdown: '# A\n' })
    const h = makeHost(state)
    h.mount()
    expect(hasTrailingWarning(h.diagnostics.getSnapshot())).toBe(true)
    state.documentKey = 'doc:B'
    state.markdown = '# B\n\n'
    state.h1Facts = [{ stableIdentity: 'b1', element: null, physicalLevel: 1 }]
    h.diagnostics.recompute()
    const snap = h.diagnostics.getSnapshot()
    expect(snap?.documentKey).toBe('doc:B')
    expect(hasTrailingWarning(snap)).toBe(false) // A's warning must not leak to B
    h.dispose()
  })
})

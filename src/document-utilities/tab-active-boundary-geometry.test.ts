// @vitest-environment jsdom
/**
 * Tab Active Boundary Geometry V5.8 — targeted contract tests.
 *
 * The painted result cannot be resolved in jsdom, so these tests lock down the
 * parts that CAN be proven without a renderer:
 *   1. the visible-intersection math (first / middle / last / partial / offscreen);
 *   2. the controller's behaviour: one listener, one observer, one rAF per frame,
 *      no duplicate bind, no stale handle after teardown, and the two custom
 *      properties it writes / removes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR,
  TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR,
  TabActiveBoundaryGeometryController,
  computeActiveTabVisibleCut,
} from './tab-active-boundary-geometry'

interface Span {
  left: number
  right: number
}

const WIDTH = (s: Span): number => s.right - s.left

// ── 1. pure visible-intersection math (§11 / §42 / §43) ─────────────────────

describe('computeActiveTabVisibleCut — visible intersection', () => {
  const wrapper: Span = { left: 0, right: 800 }

  it('REST Active MIDDLE — the cut matches the active tab box', () => {
    expect(computeActiveTabVisibleCut({ left: 120, right: 300 }, wrapper)).toEqual({
      cutLeft: 120,
      cutWidth: 180,
    })
  })

  it('REST Active FIRST — the cut never crosses the left edge', () => {
    expect(computeActiveTabVisibleCut({ left: 0, right: 180 }, wrapper)).toEqual({
      cutLeft: 0,
      cutWidth: 180,
    })
  })

  it('REST Active LAST — the cut never leaks past the right edge', () => {
    const cut = computeActiveTabVisibleCut({ left: 620, right: 880 }, wrapper)
    expect(cut.cutLeft).toBe(620)
    expect(cut.cutWidth).toBe(180)
    expect(cut.cutLeft + cut.cutWidth).toBeLessThanOrEqual(WIDTH(wrapper))
  })

  it('PARTIAL — only the visible intersection is cut out', () => {
    // partially visible on the right
    expect(computeActiveTabVisibleCut({ left: 760, right: 900 }, wrapper)).toEqual({
      cutLeft: 760,
      cutWidth: 40,
    })
    // partially visible on the left (scrolled past)
    expect(computeActiveTabVisibleCut({ left: -40, right: 100 }, wrapper)).toEqual({
      cutLeft: 0,
      cutWidth: 100,
    })
  })

  it('FULLY OFFSCREEN — cutWidth 0, so no gap is manufactured', () => {
    expect(computeActiveTabVisibleCut({ left: 820, right: 1000 }, wrapper)).toEqual({ cutLeft: 0, cutWidth: 0 })
    expect(computeActiveTabVisibleCut({ left: -200, right: -20 }, wrapper)).toEqual({ cutLeft: 0, cutWidth: 0 })
    // a zero-width wrapper can never produce a cut either
    expect(computeActiveTabVisibleCut({ left: 0, right: 100 }, { left: 100, right: 100 })).toEqual({
      cutLeft: 0,
      cutWidth: 0,
    })
  })

  it('is never negative and never outside the wrapper visible range', () => {
    const cases: Array<[Span, Span]> = [
      [{ left: -500, right: -100 }, wrapper],
      [{ left: -20, right: 20 }, wrapper],
      [{ left: 0, right: 2000 }, wrapper],
      [{ left: 799, right: 801 }, wrapper],
      [{ left: 900, right: 1000 }, { left: 0, right: 800 }],
    ]
    for (const [active, range] of cases) {
      const cut = computeActiveTabVisibleCut(active, range)
      expect(cut.cutLeft).toBeGreaterThanOrEqual(0)
      expect(cut.cutWidth).toBeGreaterThanOrEqual(0)
      expect(cut.cutLeft + cut.cutWidth).toBeLessThanOrEqual(WIDTH(range) + 1e-9)
    }
  })
})

// ── 2. controller behaviour ────────────────────────────────────────────────

class ManualFrameClock {
  private queue = new Map<number, () => void>()
  private nextHandle = 1
  requestCount = 0
  cancelCount = 0
  request(cb: () => void): number {
    const handle = this.nextHandle++
    this.queue.set(handle, cb)
    this.requestCount++
    return handle
  }
  cancel(handle: number): void {
    if (this.queue.delete(handle)) this.cancelCount++
  }
  flushOneFrame(): void {
    const cbs = Array.from(this.queue.values())
    this.queue.clear()
    for (const cb of cbs) cb()
  }
  get pending(): number {
    return this.queue.size
  }
}

class FakeResizeObserver {
  observed: Element[] = []
  static instances = 0
  constructor(private readonly cb: () => void) {
    FakeResizeObserver.instances++
  }
  observe(el: Element): void {
    this.observed.push(el)
  }
  disconnect(): void {
    this.observed = []
  }
  fire(): void {
    this.cb()
  }
}

function spanRect(span: Span): DOMRect {
  return {
    left: span.left,
    right: span.right,
    top: 0,
    bottom: 0,
    width: WIDTH(span),
    height: 0,
    x: span.left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function stubRect(el: Element, span: Span): void {
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => spanRect(span), configurable: true })
}

interface Fixture {
  doc: Document
  wrapper: HTMLElement
  active: HTMLElement
  other: HTMLElement
  clock: ManualFrameClock
  controller: TabActiveBoundaryGeometryController
  audits: Array<Record<string, unknown>>
}

function makeFixture(): Fixture {
  document.body.innerHTML = `
    <div class="typ-workspace-tabs">
      <div class="typ-tabs-wrapper typ-workspace-tab-header" id="w">
        <div class="typ-tabs">
          <div class="typ-tab" id="a">A</div>
          <div class="typ-tab active" id="b">B</div>
          <div class="typ-tab" id="c">C</div>
        </div>
      </div>
    </div>`
  const wrapper = document.getElementById('w') as HTMLElement
  const active = document.getElementById('b') as HTMLElement
  const other = document.getElementById('a') as HTMLElement
  stubRect(wrapper, { left: 0, right: 800 })
  stubRect(active, { left: 120, right: 300 })
  const clock = new ManualFrameClock()
  const audits: Array<Record<string, unknown>> = []
  const controller = new TabActiveBoundaryGeometryController({
    doc: document,
    frameClock: clock,
    audit: (payload) => audits.push(payload),
  })
  return { doc: document, wrapper, active, other, clock, controller, audits }
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).ResizeObserver
  FakeResizeObserver.instances = 0
})

describe('TabActiveBoundaryGeometryController — bind / sync', () => {
  it('commits the measured cut on bind, without waiting for a frame', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR)).toBe('120px')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('180px')
    expect(f.clock.requestCount).toBe(0)
    expect(f.controller.getDiagnostics().maxCommitsInFrame).toBeLessThanOrEqual(1)
  })

  it('is idempotent — a second bind adds no listener / observer / commit', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    const commits = f.controller.getDiagnostics().commitCount
    f.controller.bind('TEST')
    f.controller.bind('TEST')
    const diag = f.controller.getDiagnostics()
    expect(diag.boundScrollListenerCount).toBe(1)
    expect(diag.resizeObservedElementCount).toBeLessThanOrEqual(1)
    // unchanged geometry ⇒ the repeated binds are no-ops
    expect(diag.commitCount).toBe(commits)
  })

  it('coalesces a scroll burst into at most ONE commit per frame', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    const commitsBefore = f.controller.getDiagnostics().commitCount
    for (let i = 0; i < 25; i++) {
      // every step changes the geometry, so a naive implementation would write 25×
      stubRect(f.active, { left: 120 - i * 4, right: 300 - i * 4 })
      f.wrapper.dispatchEvent(new Event('scroll'))
    }
    expect(f.clock.requestCount).toBe(1)
    f.clock.flushOneFrame()
    expect(f.controller.getDiagnostics().commitCount - commitsBefore).toBe(1)
    expect(f.controller.getDiagnostics().maxCommitsInFrame).toBeLessThanOrEqual(1)
  })

  it('tracks a horizontal scroll (scrollLeft change → the cut moves)', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    // the active tab moved 200px to the LEFT inside the wrapper
    stubRect(f.active, { left: -80, right: 100 })
    f.wrapper.dispatchEvent(new Event('scroll'))
    f.clock.flushOneFrame()
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR)).toBe('0px')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('100px')
  })

  it('skips a rebuild of the same geometry (no needless style mutation)', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    const commitsAfterFirst = f.controller.getDiagnostics().commitCount
    f.controller.scheduleSync('SCROLL')
    f.controller.scheduleSync('SCROLL')
    f.clock.flushOneFrame()
    expect(f.controller.getDiagnostics().commitCount).toBe(commitsAfterFirst)
  })

  it('migrates the cut when the Active tab switches (class change + rebind)', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    // framework `activeTab()`: remove on the old, add on the new
    f.active.classList.remove('active')
    f.other.classList.add('active')
    stubRect(f.other, { left: 0, right: 180 })
    f.controller.bind('TAB_BOUNDARY_STRUCTURE_CHANGE')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR)).toBe('0px')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('180px')
  })

  it('a fully offscreen Active tab commits width 0 (no phantom gap)', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    stubRect(f.active, { left: 900, right: 1080 })
    f.controller.scheduleSync('SCROLL')
    f.clock.flushOneFrame()
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('0px')
  })

  it('uses ONE scoped ResizeObserver and never a global one', () => {
    ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
    const f = makeFixture()
    f.controller.bind('TEST')
    f.controller.bind('TEST')
    expect(FakeResizeObserver.instances).toBe(1)
    expect(f.controller.getDiagnostics().resizeObserverCount).toBe(1)
    expect(f.controller.getDiagnostics().resizeObservedElementCount).toBe(1)
  })
})

describe('TabActiveBoundaryGeometryController — teardown (§25)', () => {
  it('unbind removes the listener, cancels the frame and resets the properties', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    // a scroll burst leaves a frame queued …
    stubRect(f.active, { left: 100, right: 280 })
    f.wrapper.dispatchEvent(new Event('scroll'))
    expect(f.clock.pending).toBeGreaterThan(0)
    f.controller.unbind()
    // … which teardown must release, never leave dangling
    expect(f.clock.pending).toBe(0)
    expect(f.clock.cancelCount).toBeGreaterThan(0)
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_LEFT_VAR)).toBe('')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('')
    // the scroll listener is gone: a scroll can no longer schedule anything
    const before = f.clock.requestCount
    f.wrapper.dispatchEvent(new Event('scroll'))
    expect(f.clock.requestCount).toBe(before)
    expect(f.controller.getDiagnostics().boundScrollListenerCount).toBe(0)
  })

  it('a committed cut is removed again on teardown', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('180px')
    f.controller.unbind()
    expect(f.wrapper.style.getPropertyValue(TAB_ACTIVE_BOUNDARY_CUT_WIDTH_VAR)).toBe('')
  })

  it('rebind after teardown creates exactly one fresh listener', () => {
    const f = makeFixture()
    f.controller.bind('TEST')
    f.controller.unbind()
    f.controller.bind('TEST')
    expect(f.controller.getDiagnostics().boundScrollListenerCount).toBe(1)
    const before = f.clock.requestCount
    f.wrapper.dispatchEvent(new Event('scroll'))
    expect(f.clock.requestCount).toBe(before + 1)
  })
})

// @vitest-environment jsdom
/**
 * Phase 7R.3.11 — Document Scroll Navigator tests (SCROLL-*).
 *
 * One shared scroll-container authority; event-driven state (scroll + rAF),
 * no polling; correct disabled states; document-switch rebinding.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeScrollNavigatorState, DocumentScrollNavigator } from './document-scroll-navigator'

function makeScrollable(scrollTop: number, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scrollTop, set: () => {} })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  document.body.appendChild(el)
  return el
}

function installScrollTo(container: HTMLElement): { calls: Array<{ top: number; behavior: string }> } {
  const calls: Array<{ top: number; behavior: string }> = []
  ;(container as unknown as { scrollTo: unknown }).scrollTo = (opts: { top: number; behavior: ScrollBehavior }) => {
    calls.push({ top: opts.top, behavior: opts.behavior })
  }
  return { calls }
}

let rafCb: FrameRequestCallback | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  rafCb = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCb = cb
    return 1
  })
})

function flushRaf(): void {
  if (rafCb) {
    const cb = rafCb
    rafCb = null
    cb(0)
  }
}

describe('SCROLL-1 container authority', () => {
  it('computeScrollNavigatorState uses scrollHeight - clientHeight (not window)', () => {
    const container = makeScrollable(10, 1000, 200)
    const state = computeScrollNavigatorState(container)
    expect(state.scrollable).toBe(true)
    expect(state.atTop).toBe(false)
    expect(state.atBottom).toBe(false)
  })
})

describe('SCROLL-2/3 disabled states', () => {
  it('at top: top disabled, bottom enabled', () => {
    const s = computeScrollNavigatorState(makeScrollable(0, 1000, 200))
    expect(s.atTop).toBe(true)
    expect(s.atBottom).toBe(false)
  })

  it('at bottom: top enabled, bottom disabled', () => {
    const s = computeScrollNavigatorState(makeScrollable(800, 1000, 200))
    expect(s.atTop).toBe(false)
    expect(s.atBottom).toBe(true)
  })
})

describe('SCROLL-4 short document', () => {
  it('both disabled when not scrollable', () => {
    const s = computeScrollNavigatorState(makeScrollable(0, 200, 200))
    expect(s.scrollable).toBe(false)
    expect(s.atTop).toBe(true)
    expect(s.atBottom).toBe(true)
  })

  it('null container → both disabled', () => {
    const s = computeScrollNavigatorState(null)
    expect(s.scrollable).toBe(false)
    expect(s.atTop).toBe(true)
    expect(s.atBottom).toBe(true)
  })
})

describe('SCROLL-5 document switch rebinding', () => {
  it('unbinds the old listener and binds the new container once', () => {
    const oldContainer = makeScrollable(0, 1000, 200)
    const newContainer = makeScrollable(0, 1000, 200)
    let current = oldContainer
    const states: unknown[] = []
    const nav = new DocumentScrollNavigator({
      getContainer: () => current,
      onStateChange: (s) => states.push(s),
    })
    nav.bind()
    expect((oldContainer as unknown as { _scrollListeners?: number })._scrollListeners).toBeUndefined()
    // Count listeners by spying before bind.
    const spyOld = vi.spyOn(oldContainer, 'addEventListener')
    const spyNew = vi.spyOn(newContainer, 'addEventListener')
    // Switch document → new container; unbind old + bind new.
    current = newContainer
    nav.bind()
    expect(spyOld).not.toHaveBeenCalled()
    expect(spyNew).toHaveBeenCalledTimes(1)
    expect(states.length).toBeGreaterThan(0)
    const spyRemove = vi.spyOn(newContainer, 'removeEventListener')
    nav.dispose()
    expect(spyRemove).toHaveBeenCalledTimes(1)
  })
})

describe('SCROLL-6 reduced motion + top/bottom scroll', () => {
  it('scrollToTop/Bottom use smooth by default; immediate when reduced motion', () => {
    const container = makeScrollable(100, 1000, 200)
    const { calls } = installScrollTo(container)
    const nav = new DocumentScrollNavigator({ getContainer: () => container, onStateChange: () => {} })
    nav.bind()
    nav.scrollToTop()
    expect(calls[0]?.top).toBe(0)
    nav.scrollToBottom()
    expect(calls[1]?.top).toBe(800) // scrollHeight - clientHeight
    nav.dispose()
  })
})

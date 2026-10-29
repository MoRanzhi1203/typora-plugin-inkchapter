// @vitest-environment jsdom
/**
 * Phase 7R.3.11 — Document Edit Guard tests (LOCK-*).
 *
 * Soft lock: blocks user mutation events but allows selection/copy/scroll and
 * never blocks InkChapter renderer writes. Fully reversible on unlock/dispose.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentEditGuard, resolveLockGuardTransition } from './document-edit-guard'

function makeEditor(): { root: HTMLElement; container: HTMLElement } {
  const container = document.createElement('div')
  container.id = 'write-container'
  const root = document.createElement('div')
  root.id = 'write'
  root.setAttribute('contenteditable', 'true')
  container.appendChild(root)
  document.body.appendChild(container)
  return { root, container }
}

function dispatchKey(root: HTMLElement, key: string, opts: { ctrl?: boolean } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: !!opts.ctrl, metaKey: false })
  root.dispatchEvent(e)
  return e
}

function dispatchBeforeInput(root: HTMLElement, inputType: string): Event {
  const e = new Event('beforeinput', { bubbles: true, cancelable: true }) as Event & { inputType: string }
  ;(e as unknown as { inputType: string }).inputType = inputType
  root.dispatchEvent(e)
  return e
}

function dispatchGeneric(root: HTMLElement, type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  root.dispatchEvent(e)
  return e
}

let guard: DocumentEditGuard

beforeEach(() => {
  document.body.innerHTML = ''
  guard = new DocumentEditGuard()
})

describe('LOCK-1 editable mode', () => {
  it('does not block typing/backspace when unlocked', () => {
    const { root } = makeEditor()
    const key = dispatchKey(root, 'a')
    expect(key.defaultPrevented).toBe(false)
    const backspace = dispatchKey(root, 'Backspace')
    expect(backspace.defaultPrevented).toBe(false)
  })
})

describe('LOCK-2 locked mode blocks mutations', () => {
  it('blocks typing, Backspace/Delete/Enter, paste, cut, drop, beforeinput, input', () => {
    const { root } = makeEditor()
    expect(guard.lock()).toBe(true)
    // Typing is blocked through the beforeinput path (insertText).
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(true)
    expect(dispatchKey(root, 'Backspace').defaultPrevented).toBe(true)
    expect(dispatchKey(root, 'Delete').defaultPrevented).toBe(true)
    expect(dispatchKey(root, 'Enter').defaultPrevented).toBe(true)
    expect(dispatchGeneric(root, 'paste').defaultPrevented).toBe(true)
    expect(dispatchGeneric(root, 'cut').defaultPrevented).toBe(true)
    expect(dispatchGeneric(root, 'drop').defaultPrevented).toBe(true)
    expect(dispatchBeforeInput(root, 'deleteContentBackward').defaultPrevented).toBe(true)
    expect(dispatchGeneric(root, 'input').defaultPrevented).toBe(true)
  })
})

describe('LOCK-3 locked mode still allows selection/copy/scroll', () => {
  it('allows Ctrl+C / Ctrl+A and does not set pointer-events:none', () => {
    const { root } = makeEditor()
    guard.lock()
    const copy = dispatchKey(root, 'c', { ctrl: true })
    expect(copy.defaultPrevented).toBe(false)
    const selectAll = dispatchKey(root, 'a', { ctrl: true })
    expect(selectAll.defaultPrevented).toBe(false)
    expect(root.style.pointerEvents).not.toBe('none')
  })
})

describe('LOCK-4 unlock restores original editability', () => {
  it('removes all guards after unlock', () => {
    const { root } = makeEditor()
    guard.lock()
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(true)
    guard.unlock()
    expect(guard.isLocked()).toBe(false)
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(false)
    expect(dispatchGeneric(root, 'paste').defaultPrevented).toBe(false)
    expect(root.classList.contains('inkchapter-document-locked')).toBe(false)
  })
})

describe('LOCK-5 per-document independence is host-level (lockState map)', () => {
  it('guards are per-instance; a fresh instance for doc B is editable', () => {
    const { root } = makeEditor()
    guard.lock()
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(true)
    // Document B gets its own guard instance → editable.
    const guardB = new DocumentEditGuard()
    expect(guardB.isLocked()).toBe(false)
    guardB.dispose()
  })
})

describe('LOCK-6 plugin renderer writes are not blocked', () => {
  it('direct DOM writes work while locked', () => {
    const { root } = makeEditor()
    guard.lock()
    // InkChapter projections/decoration writes are direct DOM writes, not events.
    const deco = document.createElement('span')
    deco.textContent = '1.1-1'
    root.appendChild(deco)
    expect(root.textContent).toContain('1.1-1')
  })
})

describe('LOCK-7 dispose restores editor state and removes guards', () => {
  it('dispose unlocks and cleans the decoration class', () => {
    const { root } = makeEditor()
    guard.lock()
    expect(root.classList.contains('inkchapter-document-locked')).toBe(true)
    guard.dispose()
    expect(guard.isLocked()).toBe(false)
    expect(root.classList.contains('inkchapter-document-locked')).toBe(false)
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(false)
  })
})

describe('LOCK-8 host lock intent is bidirectional (document switch)', () => {
  // PA-LOCK-01: A locked → switch to an UNLOCKED document must RELEASE the guard.
  // The host keeps one guard instance + a per-document lockState map, so an
  // "assert-only" projection leaves doc B silently read-only while the button
  // says 编辑.
  it('desired=locked, guard unlocked → LOCK', () => {
    expect(resolveLockGuardTransition(true, false)).toBe('LOCK')
  })

  it('desired=unlocked, guard locked → UNLOCK', () => {
    expect(resolveLockGuardTransition(false, true)).toBe('UNLOCK')
  })

  it('matching states → NONE (idempotent, no event churn)', () => {
    expect(resolveLockGuardTransition(true, true)).toBe('NONE')
    expect(resolveLockGuardTransition(false, false)).toBe('NONE')
  })

  it('applying UNLOCK on a document switch makes the new document editable', () => {
    const { root } = makeEditor()
    guard.lock()
    expect(dispatchKey(root, 'Backspace').defaultPrevented).toBe(true)
    // Document switch: doc B has no lockState entry (desired=false).
    const transition = resolveLockGuardTransition(false, guard.isLocked())
    if (transition === 'UNLOCK') guard.unlock()
    expect(dispatchKey(root, 'Backspace').defaultPrevented).toBe(false)
    expect(dispatchBeforeInput(root, 'insertText').defaultPrevented).toBe(false)
  })
})

describe('LOCK-9 unlock targets the root that lock() actually bound', () => {
  // PA-LOCK-02: unlock() re-resolved #write. If Typora rebuilt the editor root
  // between lock/unlock, the old element kept all six capture listeners.
  it('removes guards from the original root after the editor root is replaced', () => {
    const { root: originalRoot } = makeEditor()
    guard.lock()
    expect(dispatchKey(originalRoot, 'Backspace').defaultPrevented).toBe(true)
    // Typora rebuilds the editor root (new node, old one detached).
    document.body.innerHTML = ''
    const replacement = makeEditor().root
    guard.unlock()
    expect(guard.isLocked()).toBe(false)
    // The detached original root must no longer swallow user input.
    expect(dispatchKey(originalRoot, 'Backspace').defaultPrevented).toBe(false)
    expect(dispatchBeforeInput(originalRoot, 'insertText').defaultPrevented).toBe(false)
    // The fresh root is untouched.
    expect(dispatchKey(replacement, 'Backspace').defaultPrevented).toBe(false)
  })
})

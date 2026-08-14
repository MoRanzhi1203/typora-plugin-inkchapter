// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decideFocusAuthority,
  captureEditorInputFocusProbe,
  captureFocusProbeSafetySnapshot,
  compareFocusProbeSafety,
  type FocusProbeContext,
} from './editor-input-focus-probe'

function makeContext(overrides: Partial<FocusProbeContext> = {}): FocusProbeContext {
  return {
    editorRoot: null,
    editorInstanceId: 'editor-1',
    peekRuntimeId: () => null,
    ...overrides,
  }
}

function setupDom(): { editorRoot: HTMLElement; para1: HTMLElement; para2: HTMLElement } {
  document.body.innerHTML = ''
  const editorRoot = document.createElement('div')
  editorRoot.id = 'write'
  const para1 = document.createElement('p')
  para1.id = 'para1'
  para1.textContent = '文本'
  const para2 = document.createElement('p')
  para2.id = 'para2'
  para2.textContent = ''
  editorRoot.appendChild(para1)
  editorRoot.appendChild(para2)
  document.body.appendChild(editorRoot)
  return { editorRoot, para1, para2 }
}

function setupSelection(para: HTMLElement): void {
  const sel = window.getSelection()!
  sel.removeAllRanges()
  const text = para.firstChild as Text | null
  const node: Node = text ?? para
  const range = document.createRange()
  range.setStart(node, 0)
  range.collapse(true)
  sel.addRange(range)
}

describe('editor-input-focus-probe', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  // ── RFOCUS-1..5: pure decision ────────────────────────────────────

  it('RFOCUS-1: activeElement outside editor → EDITOR_INPUT_NOT_FOCUSED', () => {
    const d = decideFocusAuthority({
      editorRootConnected: true,
      activeElementInsideEditorRoot: false,
      selectionAvailable: true,
      selectionRangeCount: 1,
      selectionAnchorInsideEditor: true,
      selectionFocusInsideEditor: true,
      currentParagraphRuntimeId: 'P1',
      logicalOffset: 2,
    })
    expect(d).toBe('EDITOR_INPUT_NOT_FOCUSED')
  })

  it('RFOCUS-2: activeElement inside editor + no selection → EDITOR_SELECTION_NOT_OWNED', () => {
    const d = decideFocusAuthority({
      editorRootConnected: true,
      activeElementInsideEditorRoot: true,
      selectionAvailable: true,
      selectionRangeCount: 0,
      selectionAnchorInsideEditor: null,
      selectionFocusInsideEditor: null,
      currentParagraphRuntimeId: 'P1',
      logicalOffset: 2,
    })
    expect(d).toBe('EDITOR_SELECTION_NOT_OWNED')
  })

  it('RFOCUS-3: anchor outside editor → EDITOR_SELECTION_NOT_OWNED', () => {
    const d = decideFocusAuthority({
      editorRootConnected: true,
      activeElementInsideEditorRoot: true,
      selectionAvailable: true,
      selectionRangeCount: 1,
      selectionAnchorInsideEditor: false,
      selectionFocusInsideEditor: true,
      currentParagraphRuntimeId: 'P1',
      logicalOffset: 2,
    })
    expect(d).toBe('EDITOR_SELECTION_NOT_OWNED')
  })

  it('RFOCUS-4: paragraph identity missing → EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED', () => {
    const d = decideFocusAuthority({
      editorRootConnected: true,
      activeElementInsideEditorRoot: true,
      selectionAvailable: true,
      selectionRangeCount: 1,
      selectionAnchorInsideEditor: true,
      selectionFocusInsideEditor: true,
      currentParagraphRuntimeId: null,
      logicalOffset: 2,
    })
    expect(d).toBe('EDITOR_PARAGRAPH_IDENTITY_NOT_RESOLVED')
  })

  it('RFOCUS-5: full authority → EDITOR_FOCUS_AUTHORITY_PASS', () => {
    const d = decideFocusAuthority({
      editorRootConnected: true,
      activeElementInsideEditorRoot: true,
      selectionAvailable: true,
      selectionRangeCount: 1,
      selectionAnchorInsideEditor: true,
      selectionFocusInsideEditor: true,
      currentParagraphRuntimeId: 'P1',
      logicalOffset: 2,
    })
    expect(d).toBe('EDITOR_FOCUS_AUTHORITY_PASS')
  })

  // ── RFOCUS-6..9: read-only / no side effect ────────────────────────

  it('RFOCUS-6: probe does not call focus()', () => {
    const { editorRoot, para1 } = setupDom()
    setupSelection(para1)
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    captureEditorInputFocusProbe('ON_DEMAND', makeContext({ editorRoot }))
    expect(focusSpy).not.toHaveBeenCalled()
    focusSpy.mockRestore()
  })

  it('RFOCUS-7: probe does not mutate Selection', () => {
    const { editorRoot, para1 } = setupDom()
    setupSelection(para1)
    const removeSpy = vi.spyOn(Selection.prototype, 'removeAllRanges')
    const addSpy = vi.spyOn(Selection.prototype, 'addRange')
    const collapseSpy = vi.spyOn(Selection.prototype, 'collapse')
    captureEditorInputFocusProbe('ON_DEMAND', makeContext({ editorRoot }))
    expect(removeSpy).not.toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled()
    expect(collapseSpy).not.toHaveBeenCalled()
    removeSpy.mockRestore()
    addSpy.mockRestore()
    collapseSpy.mockRestore()
  })

  it('RFOCUS-8: probe does not mutate DOM (markdown length unchanged)', () => {
    const { editorRoot, para1 } = setupDom()
    setupSelection(para1)
    const before = captureFocusProbeSafetySnapshot(editorRoot)
    captureEditorInputFocusProbe('ON_DEMAND', makeContext({ editorRoot }))
    const after = captureFocusProbeSafetySnapshot(editorRoot)
    const safety = compareFocusProbeSafety(before, after)
    expect(safety.unchanged).toBe(true)
  })

  it('RFOCUS-9: probe does not create runtimeId (peek is read-only)', () => {
    const { editorRoot, para1 } = setupDom()
    setupSelection(para1)
    const peek = vi.fn(() => null)
    const payload = captureEditorInputFocusProbe('ON_DEMAND', makeContext({ editorRoot, peekRuntimeId: peek }))
    // The read-only peek returns null; the probe must not fabricate an id.
    expect(payload.currentParagraphRuntimeId).toBeNull()
    expect(payload.selectionRuntimeId).toBeNull()
  })

  // ── RFOCUS-10: payload includes editorInstanceId ───────────────────

  it('RFOCUS-10: audit payload includes current editorInstanceId', () => {
    const { editorRoot, para1 } = setupDom()
    setupSelection(para1)
    const payload = captureEditorInputFocusProbe('BEFORE_INPUT', makeContext({ editorRoot, editorInstanceId: 'editor-42' }))
    expect(payload.editorInstanceId).toBe('editor-42')
    expect(payload.phase).toBe('BEFORE_INPUT')
    expect(typeof payload.decision).toBe('string')
    expect(typeof payload.overall).toBe('boolean')
  })
})

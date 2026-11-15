// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invokeEditorRedo,
  invokeEditorUndo,
  mountPendingFencesSynchronously,
  readEditorUndoStackLength,
} from './typora-adapter'

afterEach(() => {
  document.body.innerHTML = ''
})

function fakeEditor(addCodeBlock: (cid: string) => void) {
  return {
    writingArea: document.getElementById('write'),
    fences: { addCodeBlock },
  }
}

describe('mountPendingFencesSynchronously', () => {
  it('mounts a `mock-cm` fence in the SAME microtask it is inserted (no empty frame)', async () => {
    document.body.innerHTML = '<div id="write"></div>'
    const addCodeBlock = vi.fn((_cid: string) => {
      // Typora 的 addCodeBlock 会就地创建 CodeMirror；这里模拟同样的结果。
      const fence = document.querySelector('pre.md-fences.mock-cm')
      if (!fence) return
      fence.classList.remove('mock-cm')
      const cm = document.createElement('div')
      cm.className = 'CodeMirror'
      fence.appendChild(cm)
    })
    const stop = mountPendingFencesSynchronously(fakeEditor(addCodeBlock))

    const fence = document.createElement('pre')
    fence.className = 'md-fences mock-cm'
    fence.setAttribute('cid', 'n75')
    document.getElementById('write')!.appendChild(fence)

    // MutationObserver 回调是微任务：flush 后挂载必须已完成（同一帧，早于绘制）。
    for (let i = 0; i < 3; i++) await Promise.resolve()
    expect(addCodeBlock).toHaveBeenCalledWith('n75')
    expect(fence.querySelector('.CodeMirror')).toBeTruthy()
    stop()
  })

  it('never double-mounts a fence that already owns a CodeMirror', () => {
    document.body.innerHTML =
      '<div id="write"><pre class="md-fences mock-cm" cid="n1"><div class="CodeMirror"></div></pre></div>'
    const addCodeBlock = vi.fn()
    mountPendingFencesSynchronously(fakeEditor(addCodeBlock))()
    expect(addCodeBlock).not.toHaveBeenCalled()
  })

  it('falls back to Typora when the mount API is unavailable', () => {
    document.body.innerHTML = '<div id="write"><pre class="md-fences mock-cm" cid="n1"></pre></div>'
    const stop = mountPendingFencesSynchronously({ writingArea: document.getElementById('write') })
    expect(() => stop()).not.toThrow()
  })
})

describe('Typora undo/redo bridge', () => {
  it('calls the same undo/redo entries the editor menu uses', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const api = { undo: { undo, redo } }
    expect(invokeEditorUndo(api)).toEqual({ ok: true })
    expect(invokeEditorRedo(api)).toEqual({ ok: true })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('reports an unavailable API instead of throwing', () => {
    expect(invokeEditorUndo(null)).toEqual({ ok: false, reason: 'UNDO_API_UNAVAILABLE' })
    expect(invokeEditorRedo({})).toEqual({ ok: false, reason: 'UNDO_API_UNAVAILABLE' })
  })

  it('captures a throwing API as a failure', () => {
    const api = { undo: { undo: () => { throw new Error('BOOM') } } }
    expect(invokeEditorUndo(api)).toEqual({ ok: false, reason: 'BOOM' })
  })

  it('reads the stack length from the instance, the nested manager or the snapshot', () => {
    expect(readEditorUndoStackLength({ undo: { commandStack: [1, 2, 3] } })).toBe(3)
    expect(readEditorUndoStackLength({ undo: { UndoManager: { commandStack: [1] } } })).toBe(1)
    expect(readEditorUndoStackLength({
      undo: { storeToJson: () => ({ commandStackJson: '[{"tag":"reload"},{}]' }) },
    })).toBe(2)
    expect(readEditorUndoStackLength({ undo: {} })).toBeNull()
    expect(readEditorUndoStackLength(null)).toBeNull()
  })
})

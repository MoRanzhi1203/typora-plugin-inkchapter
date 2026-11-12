// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPendingFencesSynchronously } from './typora-adapter'

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

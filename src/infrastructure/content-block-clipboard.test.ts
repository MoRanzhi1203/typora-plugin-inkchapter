// @vitest-environment jsdom
/**
 * 内容块工具栏 — 剪贴板适配器测试。
 * 覆盖：CodeMirror 源文本读取、文本写入/回读校验、图片像素复制通道。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  copyImageToClipboard,
  documentDirectoryOf,
  readCodeSourceFromCodeMirror,
  writePlainText,
  type ContentBlockClipboardDeps,
  type ElectronLike,
} from './content-block-clipboard'

function baseDeps(overrides: Partial<ContentBlockClipboardDeps> = {}): ContentBlockClipboardDeps {
  return {
    getEditor: () => null,
    getElectron: () => null,
    getDocumentDirectory: () => 'D:\\vault\\docs',
    getNavigatorClipboard: () => null,
    ...overrides,
  }
}

function nativeImage(isEmpty = false) {
  return {
    isEmpty: () => isEmpty,
    getSize: () => ({ width: 120, height: 80 }),
  }
}

function fakeElectron(options: {
  pathEmpty?: boolean
  readbackMissing?: boolean
  readText?: string
} = {}): { electron: ElectronLike; written: unknown[] } {
  const written: unknown[] = []
  const electron: ElectronLike = {
    clipboard: {
      writeImage: (image) => { written.push(image) },
      readImage: () => nativeImage(options.readbackMissing === true),
      readText: () => options.readText ?? '',
    },
    nativeImage: {
      createFromPath: () => nativeImage(options.pathEmpty === true),
      createFromBuffer: () => nativeImage(false),
      createFromDataURL: () => nativeImage(false),
    },
  }
  return { electron, written }
}

describe('CONTENT-TOOLBAR-CLIPBOARD code source', () => {
  it('reads the CodeMirror queue value for the fence cid', () => {
    const fence = document.createElement('pre')
    fence.setAttribute('cid', 'c1')
    fence.textContent = 'rendered text with line numbers'
    const editor = { fences: { queue: { c1: { getValue: () => 'line1\n  line2' } } } }
    expect(readCodeSourceFromCodeMirror(fence, editor)).toBe('line1\n  line2')
  })

  it('never falls back to rendered DOM text', () => {
    const fence = document.createElement('pre')
    fence.setAttribute('cid', 'c1')
    fence.textContent = '1 | code'
    expect(readCodeSourceFromCodeMirror(fence, { fences: { queue: {} } })).toBeNull()
    expect(readCodeSourceFromCodeMirror(fence, null)).toBeNull()
  })

  it('returns null when the fence has no cid', () => {
    const fence = document.createElement('pre')
    const editor = { fences: { queue: { '': { getValue: () => 'x' } } } }
    expect(readCodeSourceFromCodeMirror(fence, editor)).toBeNull()
  })
})

describe('CONTENT-TOOLBAR-CLIPBOARD plain text', () => {
  it('writes through Typora and verifies with the Electron read-back', async () => {
    const setClipboard = vi.fn()
    const { electron } = fakeElectron({ readText: 'a\r\nb\r\n' })
    const result = await writePlainText('a\nb', baseDeps({
      getEditor: () => ({ UserOp: { setClipboard } }),
      getElectron: () => electron,
    }))
    expect(setClipboard).toHaveBeenCalledTimes(1)
    expect(setClipboard.mock.calls[0][2]).toBe('a\nb')
    expect(result).toEqual({ ok: true, verified: true, reason: null })
  })

  it('reports a verification failure when the read-back differs', async () => {
    const { electron } = fakeElectron({ readText: 'something else' })
    const result = await writePlainText('a\nb', baseDeps({
      getEditor: () => ({ UserOp: { setClipboard: () => {} } }),
      getElectron: () => electron,
    }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('CLIPBOARD_VERIFY_FAILED')
  })

  it('retries the read-back once when the clipboard write is not immediately visible', async () => {
    let calls = 0
    const { electron } = fakeElectron()
    electron.clipboard!.readText = () => (++calls === 1 ? 'stale-previous-content' : 'a\nb')
    const result = await writePlainText('a\nb', baseDeps({
      getEditor: () => ({ UserOp: { setClipboard: () => {} } }),
      getElectron: () => electron,
    }))
    expect(result).toEqual({ ok: true, verified: true, reason: null })
    expect(calls).toBe(2)
  })

  it('falls back to the navigator clipboard when Typora throws', async () => {
    const writeText = vi.fn(async () => {})
    const result = await writePlainText('x', baseDeps({
      getEditor: () => ({ UserOp: { setClipboard: () => { throw new Error('nope') } } }),
      getNavigatorClipboard: () => ({ writeText }),
    }))
    expect(writeText).toHaveBeenCalledWith('x')
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(false)
  })

  it('reports a real failure when no clipboard channel works', async () => {
    const result = await writePlainText('x', baseDeps())
    expect(result).toEqual({ ok: false, verified: false, reason: 'CLIPBOARD_UNAVAILABLE' })
  })

  it('reports CLIPBOARD_WRITE_FAILED when the navigator write rejects', async () => {
    const result = await writePlainText('x', baseDeps({
      getNavigatorClipboard: () => ({ writeText: async () => { throw new Error('denied') } }),
    }))
    expect(result.reason).toBe('CLIPBOARD_WRITE_FAILED')
  })
})

describe('CONTENT-TOOLBAR-CLIPBOARD image copy', () => {
  function imageEl(src: string, dataSrc?: string): HTMLImageElement {
    const p = document.createElement('p')
    const span = document.createElement('span')
    span.className = 'md-image'
    if (dataSrc) span.setAttribute('data-src', dataSrc)
    const img = document.createElement('img')
    img.setAttribute('src', src)
    Object.defineProperty(img, 'naturalWidth', { value: 120 })
    Object.defineProperty(img, 'naturalHeight', { value: 80 })
    span.appendChild(img)
    p.appendChild(span)
    document.body.appendChild(p)
    return img
  }

  it('requires a real image element', async () => {
    const result = await copyImageToClipboard(null, baseDeps())
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('IMAGE_ELEMENT_MISSING')
  })

  it('copies a local file through nativeImage and verifies the clipboard', async () => {
    const img = imageEl('file:///D:/vault/docs/a.png?lastModify=1', './a.png')
    const { electron, written } = fakeElectron()
    const result = await copyImageToClipboard(img, baseDeps({ getElectron: () => electron }))
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.strategy).toBe('native-path')
    expect(written).toHaveLength(1)
  })

  it('does not claim success when the clipboard read-back is empty', async () => {
    const img = imageEl('file:///D:/vault/docs/a.png')
    const { electron } = fakeElectron({ readbackMissing: true })
    const result = await copyImageToClipboard(img, baseDeps({ getElectron: () => electron }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('CLIPBOARD_VERIFY_FAILED')
  })

  it('falls back to canvas rasterization when native decoding fails', async () => {
    const img = imageEl('file:///D:/vault/docs/a.png')
    const { electron, written } = fakeElectron({ pathEmpty: true })
    const rasterize = vi.fn(async () => 'data:image/png;base64,AAAA')
    const result = await copyImageToClipboard(img, baseDeps({
      getElectron: () => electron,
      rasterize,
    }))
    expect(rasterize).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(written).toHaveLength(1)
  })

  it('reports a tainted canvas instead of pretending success', async () => {
    const img = imageEl('https://example.test/a.png')
    const rasterize = vi.fn(async () => { throw new Error('SecurityError: tainted') })
    const result = await copyImageToClipboard(img, baseDeps({ rasterize }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('CANVAS_TAINTED')
  })

  it('uses the Web Clipboard image channel when Electron is absent', async () => {
    const img = imageEl('file:///D:/vault/docs/a.png')
    const write = vi.fn(async () => {})
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const result = await copyImageToClipboard(img, baseDeps({
      getNavigatorClipboard: () => ({ write }),
      rasterize: async () => 'data:image/png;base64,AAAA',
    }))
    vi.unstubAllGlobals()
    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('clipboard-item')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('reports GIF copies as first-frame PNG', async () => {
    const img = imageEl('file:///D:/vault/docs/anim.gif')
    const { electron } = fakeElectron()
    const result = await copyImageToClipboard(img, baseDeps({ getElectron: () => electron }))
    expect(result.note).toContain('GIF')
  })
})

describe('CONTENT-TOOLBAR-CLIPBOARD document directory', () => {
  it('resolves the active document directory', () => {
    expect(documentDirectoryOf('D:\\vault\\docs\\a.md')).toBe('D:\\vault\\docs')
    expect(documentDirectoryOf(null)).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * 内容块工具栏 — 规范目标解析测试（只读）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CODE_BLOCK_SELECTOR,
  contentBlockKey,
  countCodeLines,
  foldSummary,
  resolveContentBlockTarget,
  resolveContentBlockTargetFromElement,
} from './content-block-toolbar-target'

function setupWrite(html: string): HTMLElement {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  write.innerHTML = html
  document.body.appendChild(write)
  return write
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('CONTENT-TOOLBAR-TARGET code block', () => {
  it('resolves the canonical PRE.md-fences from a nested CodeMirror line', () => {
    const write = setupWrite(
      '<pre class="md-fences" cid="c1"><div class="CodeMirror"><pre class="CodeMirror-line"><span>x</span></pre></div></pre>',
    )
    const line = write.querySelector('.CodeMirror-line span')!
    const target = resolveContentBlockTarget(line, write)
    expect(target?.kind).toBe('code')
    expect(target?.element).toBe(write.querySelector(CODE_BLOCK_SELECTOR))
    expect(target?.cid).toBe('c1')
    expect(target?.key).toBe('code:cid:c1')
  })

  it('rejects a fence nested in a math block', () => {
    const write = setupWrite('<div class="md-math-block"><pre class="md-fences"></pre></div>')
    const fence = write.querySelector(CODE_BLOCK_SELECTOR)!
    expect(resolveContentBlockTarget(fence, write)).toBeNull()
  })

  it('rejects nodes outside the editor root', () => {
    const write = setupWrite('<pre class="md-fences" cid="c1"></pre>')
    const outside = document.createElement('pre')
    outside.className = 'md-fences'
    document.body.appendChild(outside)
    expect(resolveContentBlockTarget(outside, write)).toBeNull()
  })

  it('ignores the plugin overlay itself', () => {
    const write = setupWrite('<pre class="md-fences" cid="c1"></pre>')
    const overlay = document.createElement('div')
    overlay.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    overlay.innerHTML = '<pre class="md-fences"></pre>'
    document.body.appendChild(overlay)
    expect(resolveContentBlockTarget(overlay.querySelector(CODE_BLOCK_SELECTOR)!, write)).toBeNull()
  })
})

describe('CONTENT-TOOLBAR-TARGET image', () => {
  it('resolves an image inside a paragraph to its business block', () => {
    const write = setupWrite(
      '<p cid="p1"><span class="md-image" data-src="./a.png"><img src="file:///D:/a.png"></span></p>',
    )
    const img = write.querySelector('img')!
    const target = resolveContentBlockTarget(img, write)
    expect(target?.kind).toBe('image')
    expect(target?.element).toBe(img)
    expect(target?.block).toBe(write.querySelector('p'))
    expect(target?.key).toBe('image:cid:p1')
  })

  it('rejects images inside code blocks and tables', () => {
    const write = setupWrite(
      '<pre class="md-fences"><img src="file:///D:/a.png"></pre><table><tbody><tr><td><img src="file:///D:/b.png"></td></tr></tbody></table>',
    )
    for (const img of Array.from(write.querySelectorAll('img'))) {
      expect(resolveContentBlockTarget(img, write)).toBeNull()
    }
  })
})

describe('CONTENT-TOOLBAR-TARGET identity ladder', () => {
  it('prefers cid, then data-line, then ordinal+signature', () => {
    const write = setupWrite(
      '<pre class="md-fences" cid="c9"></pre>' +
        '<pre class="md-fences" data-line="7"></pre>' +
        '<pre class="md-fences">plain</pre>',
    )
    const [withCid, withLine, plain] = Array.from(write.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))
    expect(contentBlockKey('code', withCid, write)).toBe('code:cid:c9')
    expect(contentBlockKey('code', withLine, write)).toBe('code:line:7')
    expect(contentBlockKey('code', plain, write)).toMatch(/^code:ord:2:sig:[0-9a-f]+$/)
    expect(resolveContentBlockTargetFromElement(plain, write)?.kind).toBe('code')
  })

  it('keeps the ordinal signature stable for identical content', () => {
    const write = setupWrite('<pre class="md-fences">same</pre>')
    const fence = write.querySelector<HTMLElement>(CODE_BLOCK_SELECTOR)!
    expect(contentBlockKey('code', fence, write)).toBe(contentBlockKey('code', fence, write))
  })
})

describe('CONTENT-TOOLBAR-TARGET code summary', () => {
  it('counts CodeMirror-equivalent lines', () => {
    expect(countCodeLines('')).toBe(0)
    expect(countCodeLines('a')).toBe(1)
    expect(countCodeLines('a\nb')).toBe(2)
    expect(countCodeLines('a\n')).toBe(2)
  })

  it('formats the folded placeholder', () => {
    expect(foldSummary(12)).toBe('已折叠 · 12 行')
  })
})

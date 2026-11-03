import { describe, it, expect } from 'vitest'
import { buildImageActions, buildMarkdownImageReference } from './content-block-toolbar-image-actions'

describe('buildImageActions', () => {
  it('resolves a relative data-src into a local absolute path', () => {
    const actions = buildImageActions({
      src: 'file:///D:/vault/a.png?lastModify=1',
      dataSrc: './a.png',
      alt: '图一',
      baseDir: 'D:\\vault',
    })
    expect(actions.localPath).toBe('D:\\vault\\a.png')
    expect(actions.remoteUrl).toBeNull()
    expect(actions.markdown).toBe('![图一](./a.png)')
  })

  it('exposes a remote URL and prefers the original data-src for Markdown', () => {
    const actions = buildImageActions({
      src: 'https://cdn.example.test/a.png',
      dataSrc: 'https://cdn.example.test/a.png?raw=1',
      alt: 'remote',
      baseDir: null,
    })
    expect(actions.localPath).toBeNull()
    expect(actions.remoteUrl).toBe('https://cdn.example.test/a.png?raw=1')
    expect(actions.markdown).toBe('![remote](https://cdn.example.test/a.png?raw=1)')
  })

  it('keeps only Markdown for data URLs', () => {
    const actions = buildImageActions({
      src: 'data:image/png;base64,AAAA',
      dataSrc: null,
      alt: '',
      baseDir: null,
    })
    expect(actions.localPath).toBeNull()
    expect(actions.remoteUrl).toBeNull()
    expect(actions.markdown).toBe('![](data:image/png;base64,AAAA)')
  })

  it('returns nulls when nothing is resolvable', () => {
    expect(buildImageActions({ src: null, dataSrc: null, alt: null, baseDir: null })).toEqual({
      localPath: null,
      remoteUrl: null,
      markdown: null,
    })
  })

  it('sanitizes brackets in alt text', () => {
    expect(buildMarkdownImageReference('a[b]c', './a.png')).toBe('![abc](./a.png)')
    expect(buildMarkdownImageReference('x', '  ')).toBeNull()
  })
})

/**
 * 内容块工具栏 — 图片资源解析与复制策略测试。
 */
import { describe, it, expect } from 'vitest'
import {
  imageFileExtension,
  isAnimatedGif,
  planImageCopy,
  resolveImageResource,
} from './content-block-toolbar-image-resource'

const BASE = 'D:\\vault\\docs'

describe('CONTENT-TOOLBAR-IMAGE-RESOURCE resolve', () => {
  it('resolves a relative markdown destination against the document directory', () => {
    const resource = resolveImageResource({ src: 'file:///D:/vault/docs/a.png?lastModify=1', dataSrc: './a.png', baseDir: BASE })
    expect(resource?.kind).toBe('local-path')
    expect(resource?.source).toBe('data-src')
    expect(resource?.absolutePath).toBe('D:\\vault\\docs\\a.png')
  })

  it('decodes percent-encoded file URLs and strips lastModify', () => {
    const resource = resolveImageResource({
      src: 'file:///D:/vault/docs/%E4%B8%AD%E6%96%87%20img.png?lastModify=1699999999',
      dataSrc: null,
      baseDir: BASE,
    })
    expect(resource?.kind).toBe('local-path')
    expect(resource?.absolutePath).toBe('D:\\vault\\docs\\中文 img.png')
  })

  it('resolves an absolute windows path', () => {
    const resource = resolveImageResource({ src: null, dataSrc: 'D:\\assets\\b.jpg', baseDir: BASE })
    expect(resource?.kind).toBe('local-path')
    expect(resource?.absolutePath).toBe('D:\\assets\\b.jpg')
  })

  it('classifies http, data and blob sources', () => {
    expect(resolveImageResource({ src: 'https://x.test/a.png', dataSrc: null, baseDir: BASE })?.kind).toBe('http')
    expect(resolveImageResource({ src: 'data:image/png;base64,AAA', dataSrc: null, baseDir: BASE })?.kind).toBe('data')
    expect(resolveImageResource({ src: 'blob:file:///abc', dataSrc: null, baseDir: BASE })?.kind).toBe('blob')
  })

  it('resolves typora typemark pseudo URLs through the data-src relative path', () => {
    const resource = resolveImageResource({
      src: 'typora://app/typemark/./img/c.png',
      dataSrc: null,
      baseDir: BASE,
    })
    expect(resource?.kind).toBe('local-path')
    expect(resource?.absolutePath).toBe('D:\\vault\\docs\\img\\c.png')
  })

  it('returns unsupported when nothing can be resolved', () => {
    const resource = resolveImageResource({ src: 'relative/a.png', dataSrc: null, baseDir: null })
    expect(resource?.kind).toBe('unsupported')
  })

  it('returns null with no source at all', () => {
    expect(resolveImageResource({ src: null, dataSrc: null, baseDir: BASE })).toBeNull()
  })
})

describe('CONTENT-TOOLBAR-IMAGE-RESOURCE strategy matrix', () => {
  const local = resolveImageResource({ src: null, dataSrc: './a.png', baseDir: BASE })
  const remote = resolveImageResource({ src: 'https://x.test/a.png', dataSrc: null, baseDir: BASE })
  const data = resolveImageResource({ src: 'data:image/png;base64,AAA', dataSrc: null, baseDir: BASE })
  const blob = resolveImageResource({ src: 'blob:file:///abc', dataSrc: null, baseDir: BASE })
  const unsupported = resolveImageResource({ src: 'relative/a.png', dataSrc: null, baseDir: null })

  it('uses the native path channel only when Electron exists', () => {
    expect(planImageCopy(local, true)).toEqual({ strategy: 'native-path', reason: 'LOCAL_FILE_PATH' })
    expect(planImageCopy(local, false).strategy).toBe('dom-raster')
  })

  it('fetches remote/blob content into a native buffer', () => {
    expect(planImageCopy(remote, true).strategy).toBe('native-buffer')
    expect(planImageCopy(blob, true).strategy).toBe('native-buffer')
  })

  it('decodes data URLs natively', () => {
    expect(planImageCopy(data, true).strategy).toBe('native-data-url')
  })

  it('falls back to DOM rasterization for unsupported schemes', () => {
    expect(planImageCopy(unsupported, true).strategy).toBe('dom-raster')
    expect(planImageCopy(null, true).strategy).toBe('dom-raster')
  })

  it('reports GIF semantics as first-frame copy', () => {
    const gif = resolveImageResource({ src: null, dataSrc: './anim.gif', baseDir: BASE })
    expect(imageFileExtension('D:\\a\\b.GIF')).toBe('gif')
    expect(isAnimatedGif(gif)).toBe(true)
    expect(isAnimatedGif(local)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  classifyImagePath,
  decodeImagePathForDisplay,
  imagePathInfo,
  normalizeLocalImageMarkdownDestination,
  buildImageDestination,
  safeDecodePathOnce,
} from './image-path-codec'

describe('classifyImagePath', () => {
  it('classifies data URL', () => {
    expect(classifyImagePath('data:image/png;base64,AAAA')).toBe('DATA_URL')
  })
  it('classifies http and https', () => {
    expect(classifyImagePath('http://a.com/x.png')).toBe('HTTP_URL')
    expect(classifyImagePath('https://a.com/x.png')).toBe('HTTPS_URL')
  })
  it('classifies file URL', () => {
    expect(classifyImagePath('file:///D:/a.png')).toBe('FILE_URL')
  })
  it('classifies windows absolute path', () => {
    expect(classifyImagePath('C:\\Users\\Name\\a.png')).toBe('LOCAL_ABSOLUTE_WINDOWS_PATH')
  })
  it('classifies relative path', () => {
    expect(classifyImagePath('../../Downloads/a.png')).toBe('LOCAL_RELATIVE_PATH')
    expect(classifyImagePath('a.png')).toBe('LOCAL_RELATIVE_PATH')
  })
  it('classifies empty as UNKNOWN', () => {
    expect(classifyImagePath('')).toBe('UNKNOWN')
  })
})

describe('decodeImagePathForDisplay', () => {
  it('decodes %20 to space', () => {
    expect(decodeImagePathForDisplay('../../a%20b.png')).toBe('../../a b.png')
  })
  it('decodes UTF-8 percent encoding to Chinese', () => {
    expect(decodeImagePathForDisplay('../../%E5%9B%BE%E7%89%87.png')).toBe('../../图片.png')
  })
  it('falls back to raw on invalid percent', () => {
    expect(decodeImagePathForDisplay('../../a%ZZ.png')).toBe('../../a%ZZ.png')
  })
  it('decodes %2520 only one level', () => {
    expect(decodeImagePathForDisplay('../../a%2520b.png')).toBe('../../a%20b.png')
  })
  it('never decodes data URLs', () => {
    expect(decodeImagePathForDisplay('data:image/png;base64,%20AA')).toBe('data:image/png;base64,%20AA')
  })
})

describe('imagePathInfo', () => {
  it('keeps storage canonical and decodes display', () => {
    const info = imagePathInfo('../../Downloads/ChatGPT%20Image%202026%E5%B9%B4.png')
    expect(info.kind).toBe('LOCAL_RELATIVE_PATH')
    expect(info.storage).toBe('../../Downloads/ChatGPT%20Image%202026%E5%B9%B4.png')
    expect(info.display).toBe('../../Downloads/ChatGPT Image 2026年.png')
    expect(info.decodeSucceeded).toBe(true)
  })
})

describe('safeDecodePathOnce', () => {
  it('decodes one level and fails-safe on invalid percent', () => {
    expect(safeDecodePathOnce('a%20b.png')).toEqual({ decoded: 'a b.png', ok: true })
    expect(safeDecodePathOnce('a%2X.png')).toEqual({ decoded: 'a%2X.png', ok: false })
  })
  it('%2520 only decodes to %20 (single level)', () => {
    expect(safeDecodePathOnce('a%2520b.png').decoded).toBe('a%20b.png')
  })
})

describe('buildImageDestination', () => {
  it('wraps spaces/special chars in angle brackets', () => {
    expect(buildImageDestination('ChatGPT Image 2026年.png')).toBe('<ChatGPT Image 2026年.png>')
    expect(buildImageDestination('a(b).png')).toBe('<a(b).png>')
    expect(buildImageDestination('a b.png')).toBe('<a b.png>')
  })
  it('keeps simple paths plain', () => {
    expect(buildImageDestination('a.png')).toBe('a.png')
  })
})

describe('normalizeLocalImageMarkdownDestination', () => {
  it('decodes %20 and UTF-8 Chinese into a readable angle-bracket destination', () => {
    const r = normalizeLocalImageMarkdownDestination('../../Downloads/ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5.png')
    expect(r.kind).toBe('LOCAL_RELATIVE_PATH')
    expect(r.safe).toBe(true)
    expect(r.changed).toBe(true)
    expect(r.decoded).toBe('../../Downloads/ChatGPT Image 2026年8月14日.png')
    expect(r.markdownDestination).toBe('<../../Downloads/ChatGPT Image 2026年8月14日.png>')
  })
  it('%2520 decodes only one level to %20', () => {
    const r = normalizeLocalImageMarkdownDestination('a%2520b.png')
    expect(r.decoded).toBe('a%20b.png')
    expect(r.markdownDestination).toBe('a%20b.png')
  })
  it('invalid percent blocks safely', () => {
    const r = normalizeLocalImageMarkdownDestination('a%2X.png')
    expect(r.safe).toBe(false)
    expect(r.changed).toBe(false)
    expect(r.reason).toBe('INVALID_PERCENT_ENCODING')
  })
  it('remote URLs are never normalized', () => {
    expect(normalizeLocalImageMarkdownDestination('https://example.com/a%20b.png').safe).toBe(false)
    expect(normalizeLocalImageMarkdownDestination('http://example.com/a%20b.png').safe).toBe(false)
    expect(normalizeLocalImageMarkdownDestination('data:image/png;base64,AAAA').safe).toBe(false)
  })
  it('local relative and windows absolute classify + normalize', () => {
    expect(normalizeLocalImageMarkdownDestination('a%20b.png').kind).toBe('LOCAL_RELATIVE_PATH')
    expect(normalizeLocalImageMarkdownDestination('C:\\a%20b.png').kind).toBe('LOCAL_ABSOLUTE_WINDOWS_PATH')
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildUploadFileName,
  joinRemotePath,
  safeImageExtension,
  sanitizeOriginalBaseName,
} from './image-upload-naming'

const SHA = '0123456789abcdef'.repeat(4)
const NOW = new Date(Date.UTC(2026, 10, 4, 1, 2, 3))

describe('buildUploadFileName', () => {
  it('uses a timestamp + content hash name and never leaks unsafe characters', () => {
    for (const original of ['中文 空格.png', 'percent%hash#.png', 'a b #c%.PNG']) {
      const name = buildUploadFileName({ sha256: SHA, originalFilename: original, now: NOW })
      expect(name).toBe('20261104-010203-0123456789.png')
      expect(name).not.toMatch(/[#%\s\\/]/)
    }
  })

  it('keeps a sanitized original name with a short hash suffix when requested', () => {
    const name = buildUploadFileName({
      sha256: SHA,
      originalFilename: 'My Chart (final)#1.png',
      strategy: 'original-name',
      now: NOW,
    })
    expect(name).toBe('My-Chart-final-1-01234567.png')
  })

  it('falls back to a safe extension and rejects invalid hashes', () => {
    expect(buildUploadFileName({ sha256: SHA, originalFilename: 'noext', now: NOW }).endsWith('.img')).toBe(true)
    expect(() => buildUploadFileName({ sha256: 'not-a-hash', originalFilename: 'a.png' })).toThrow()
  })

  it('extracts only safe extensions', () => {
    expect(safeImageExtension('a.PNG')).toBe('png')
    expect(safeImageExtension('a.photohash')).toBeNull()
    expect(safeImageExtension('no-extension')).toBeNull()
  })

  it('sanitizes original base names without empty results', () => {
    expect(sanitizeOriginalBaseName('中文图片.png')).toBe('image')
    expect(sanitizeOriginalBaseName('.hidden.png')).toBe('hidden')
  })
})

describe('joinRemotePath', () => {
  it('joins a normal directory', () => {
    expect(joinRemotePath('images/2026', 'a.png')).toBe('images/2026/a.png')
    expect(joinRemotePath('', 'a.png')).toBe('a.png')
  })

  it('rejects traversal, absolute paths and unsafe file names', () => {
    expect(joinRemotePath('../x', 'a.png')).toBeNull()
    expect(joinRemotePath('/abs', 'a.png')).toBeNull()
    expect(joinRemotePath('images', 'a#b.png')).toBeNull()
    expect(joinRemotePath('images', 'a b.png')).toBeNull()
  })
})

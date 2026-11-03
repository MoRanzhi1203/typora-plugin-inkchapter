import { describe, it, expect } from 'vitest'
import {
  buildCacheObjectName,
  buildOfflineAssetName,
  extensionForContentType,
  extensionFromUrl,
  validateRemoteImageUrl,
} from './image-remote-url'

describe('validateRemoteImageUrl', () => {
  it('accepts public http and https URLs', () => {
    expect(validateRemoteImageUrl('https://example.test/a.png').ok).toBe(true)
    expect(validateRemoteImageUrl('http://example.test/a.png').ok).toBe(true)
  })

  it('rejects unsupported protocols and credentials', () => {
    expect(validateRemoteImageUrl('ftp://example.test/a.png').reason).toBe('UNSUPPORTED_PROTOCOL')
    expect(validateRemoteImageUrl('https://user:pass@example.test/a.png').reason).toBe('CREDENTIALS_NOT_ALLOWED')
    expect(validateRemoteImageUrl('not a url').reason).toBe('INVALID_URL')
  })

  it('blocks loopback, private, link-local and local hostnames', () => {
    for (const url of [
      'http://localhost/a.png',
      'http://app.localhost/a.png',
      'http://printer.local/a.png',
      'http://127.0.0.1/a.png',
      'http://10.0.0.2/a.png',
      'http://192.168.1.2/a.png',
      'http://172.16.0.1/a.png',
      'http://169.254.1.1/a.png',
      'http://0.0.0.0/a.png',
      'http://[::1]/a.png',
      'http://[fe80::1]/a.png',
    ]) {
      expect(validateRemoteImageUrl(url).reason).toBe('BLOCKED_HOST')
    }
  })
})

describe('image naming', () => {
  it('derives extensions from MIME and URL', () => {
    expect(extensionForContentType('image/png; charset=binary')).toBe('png')
    expect(extensionForContentType('image/jpeg')).toBe('jpg')
    expect(extensionForContentType('text/html')).toBeNull()
    expect(extensionFromUrl('https://example.test/a.PNG?x=1')).toBe('png')
    expect(extensionFromUrl('https://example.test/a.bin')).toBeNull()
  })

  it('builds safe content-addressed names without user filenames', () => {
    const sha = 'a'.repeat(64)
    expect(buildCacheObjectName(sha, 'png')).toBe(`${sha}.png`)
    expect(buildCacheObjectName(sha, null)).toBe(`${sha}.img`)
    expect(buildOfflineAssetName(sha, 'png', 3)).toBe(`img-${'a'.repeat(10)}-3.png`)
    expect(() => buildCacheObjectName('not-a-hash', 'png')).toThrow()
  })
})

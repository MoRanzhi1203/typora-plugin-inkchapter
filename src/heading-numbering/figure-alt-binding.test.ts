import { describe, it, expect } from 'vitest'
import {
  setImageAlt,
  readImageAlt,
  setImageDestination,
  readImageDestination,
  normalizeImageDestinationsInMarkdown,
  escapeMarkdownAlt,
  unescapeMarkdownAlt,
} from './figure-alt-binding'

describe('escapeMarkdownAlt', () => {
  it('escapes backslash, brackets', () => {
    expect(escapeMarkdownAlt('a]b')).toBe('a\\]b')
    expect(escapeMarkdownAlt('a[b')).toBe('a\\[b')
    expect(escapeMarkdownAlt('a\\b')).toBe('a\\\\b')
  })
  it('round-trips through unescape', () => {
    for (const s of ['中文', '中文 空格', 'A&B', 'A(B)', 'A[B]', 'A "B"', "A'B", 'a]b']) {
      expect(unescapeMarkdownAlt(escapeMarkdownAlt(s))).toBe(s)
    }
  })
})

describe('setImageAlt / readImageAlt', () => {
  it('writes alt into an empty image', () => {
    const r = setImageAlt('![](a.png)', 'a.png', 'name')
    expect(r.changed).toBe(true)
    expect(r.markdown).toBe('![name](a.png)')
  })
  it('clears alt', () => {
    const r = setImageAlt('![name](a.png)', 'a.png', '')
    expect(r.changed).toBe(true)
    expect(r.markdown).toBe('![](a.png)')
  })
  it('edits an existing alt in place (name → edited name)', () => {
    const r = setImageAlt('![旧名称](a.png)', 'a.png', '新名称')
    expect(r.changed).toBe(true)
    expect(r.markdown).toBe('![新名称](a.png)')
  })
  it('reads alt back (unescaped)', () => {
    expect(readImageAlt('![a\\]b](a.png)', 'a.png')).toBe('a]b')
    expect(readImageAlt('![](a.png)', 'a.png')).toBe('')
  })
  it('writes alt with special characters (escaped)', () => {
    const r = setImageAlt('![](a.png)', 'a.png', 'a]b')
    expect(r.markdown).toBe('![a\\]b](a.png)')
    expect(readImageAlt(r.markdown, 'a.png')).toBe('a]b')
  })
  it('handles angle-bracket paths', () => {
    const r = setImageAlt('![](<a b.png>)', 'a b.png', 'name')
    expect(r.markdown).toBe('![name](<a b.png>)')
  })
  it('matches encoded vs decoded path', () => {
    const r = setImageAlt('![](a%20b.png)', 'a b.png', 'name')
    expect(r.changed).toBe(true)
    expect(r.markdown).toBe('![name](a%20b.png)')
  })
  it('disambiguates duplicate paths by occurrence', () => {
    const md = '![](same.png)\n\n![](same.png)'
    const r = setImageAlt(md, 'same.png', 'second', 2)
    expect(r.markdown).toBe('![](same.png)\n\n![second](same.png)')
    expect(readImageAlt(r.markdown, 'same.png', 1)).toBe('')
    expect(readImageAlt(r.markdown, 'same.png', 2)).toBe('second')
  })
  it('leaves markdown unchanged when no image matches', () => {
    const r = setImageAlt('![](a.png)', 'missing.png', 'name')
    expect(r.changed).toBe(false)
    expect(r.markdown).toBe('![](a.png)')
  })
})

describe('setImageDestination / readImageDestination', () => {
  it('reads the raw destination (angle brackets stripped)', () => {
    expect(readImageDestination('![x](<a b.png>)', 'a b.png')).toBe('a b.png')
    expect(readImageDestination('![x](a.png)', 'a.png')).toBe('a.png')
  })
  it('patches only the destination, preserving alt', () => {
    const r = setImageDestination('![tst](a%20b.png)', 'a%20b.png', '<a b.png>')
    expect(r.changed).toBe(true)
    expect(r.markdown).toBe('![tst](<a b.png>)')
  })
  it('patches the correct occurrence for duplicate paths', () => {
    const md = '![](same.png)\n\n![](same.png)'
    const r = setImageDestination(md, 'same.png', '<same file.png>', 2)
    expect(r.markdown).toBe('![](same.png)\n\n![](<same file.png>)')
  })
})

describe('normalizeImageDestinationsInMarkdown', () => {
  it('normalizes local encoded destinations, leaves remote and data untouched', () => {
    const md = [
      '![tst](../../Downloads/ChatGPT%20Image%202026%E5%B9%B4.png)',
      '![HTTP](https://example.com/a%20b.png)',
      '![data](data:image/png;base64,AAAA)',
    ].join('\n\n')
    const r = normalizeImageDestinationsInMarkdown(md)
    expect(r.normalized).toBe(1)
    expect(r.blocked).toBe(0)
    expect(r.markdown).toContain('![tst](<../../Downloads/ChatGPT Image 2026年.png>)')
    expect(r.markdown).toContain('![HTTP](https://example.com/a%20b.png)')
    expect(r.markdown).toContain('![data](data:image/png;base64,AAAA)')
  })
  it('normalizes both duplicate local tokens independently', () => {
    const md = '![](same%20a.png)\n\n![](same%20a.png)'
    const r = normalizeImageDestinationsInMarkdown(md)
    expect(r.normalized).toBe(2)
    expect(r.markdown).toBe('![](<same a.png>)\n\n![](<same a.png>)')
  })
})

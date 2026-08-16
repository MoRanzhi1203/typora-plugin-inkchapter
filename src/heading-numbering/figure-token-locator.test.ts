import { describe, it, expect } from 'vitest'
import {
  parseMarkdownImageTokens,
  canonicalizeRuntimeImageSrc,
  canonicalizeMarkdownDestination,
  normalizeWindowsPath,
  locateMarkdownImageToken,
  patchAltRange,
  patchDestinationRange,
} from './figure-token-locator'

describe('parseMarkdownImageTokens', () => {
  it('parses a standalone image', () => {
    const tokens = parseMarkdownImageTokens('![alt](a.png)')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].altRaw).toBe('alt')
    expect(tokens[0].destinationRaw).toBe('a.png')
  })

  it('parses an embedded image without a standalone-line assumption', () => {
    const tokens = parseMarkdownImageTokens('。![](a.png)')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].destinationRaw).toBe('a.png')
  })

  it('parses an inline image', () => {
    const tokens = parseMarkdownImageTokens('正文 ![x](a.png) 后续')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].altRaw).toBe('x')
  })

  it('parses an angle-bracket destination with precise range', () => {
    const md = '![x](<a b.png>)'
    const tokens = parseMarkdownImageTokens(md)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].destinationRaw).toBe('a b.png')
    expect(md.slice(tokens[0].destinationStart, tokens[0].destinationEnd)).toBe('<a b.png>')
  })

  it('assigns occurrence among duplicate same-destination tokens', () => {
    const tokens = parseMarkdownImageTokens('![](same.png)\n\n![](same.png)')
    expect(tokens).toHaveLength(2)
    expect(tokens[0].occurrence).toBe(1)
    expect(tokens[1].occurrence).toBe(2)
  })
})

describe('canonicalizeRuntimeImageSrc', () => {
  it('strips file:// + query and decodes', () => {
    expect(canonicalizeRuntimeImageSrc('file://D:/MSIPC/Downloads/a%20b.png?lastModify=123'))
      .toBe('d:\\msipc\\downloads\\a b.png')
  })
  it('handles file:/// + query', () => {
    expect(canonicalizeRuntimeImageSrc('file:///D:/a.png?lastModify=1')).toBe('d:\\a.png')
  })
  it('handles windows absolute path', () => {
    expect(canonicalizeRuntimeImageSrc('D:\\Downloads\\a%20b.png')).toBe('d:\\downloads\\a b.png')
  })
  it('resolves relative path against document directory', () => {
    expect(canonicalizeRuntimeImageSrc('a.png', 'D:\\vault')).toBe('d:\\vault\\a.png')
  })
  it('returns null for remote/data URLs', () => {
    expect(canonicalizeRuntimeImageSrc('https://example.com/a.png')).toBeNull()
    expect(canonicalizeRuntimeImageSrc('data:image/png;base64,AAAA')).toBeNull()
  })
})

describe('canonicalizeMarkdownDestination', () => {
  it('decodes and resolves a relative local destination', () => {
    expect(canonicalizeMarkdownDestination('a%20b.png', 'D:\\vault')).toBe('d:\\vault\\a b.png')
  })
  it('%2520 decodes one level only', () => {
    expect(canonicalizeMarkdownDestination('a%2520b.png', 'D:\\vault')).toBe('d:\\vault\\a%20b.png')
  })
  it('returns null for remote/data URLs', () => {
    expect(canonicalizeMarkdownDestination('https://example.com/a.png', 'D:\\vault')).toBeNull()
    expect(canonicalizeMarkdownDestination('data:image/png;base64,AAAA', 'D:\\vault')).toBeNull()
  })
})

describe('normalizeWindowsPath', () => {
  it('normalizes slashes and lowercases', () => {
    expect(normalizeWindowsPath('D:/MSIPC/Downloads/A.png')).toBe('d:\\msipc\\downloads\\a.png')
  })
})

describe('locateMarkdownImageToken', () => {
  it('matches runtime file URL against relative markdown destination', () => {
    const documentDirectory = 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault'
    const markdown = '![x](../../../../MSIPC/Downloads/a%20b.png)'
    const runtimeSrc = 'file://D:/MSIPC/Downloads/a%20b.png?lastModify=123'
    const r = locateMarkdownImageToken(markdown, runtimeSrc, documentDirectory, 1)
    expect(r.decision).toBe('MATCH')
    expect(r.token).not.toBeNull()
    expect(r.pathMatch).toBe(true)
    expect(r.occurrenceMatch).toBe(true)
  })

  it('ignores query for identity', () => {
    const r = locateMarkdownImageToken('![](a.png)', 'file:///D:/vault/a.png?lastModify=1', 'D:\\vault', 1)
    expect(r.decision).toBe('MATCH')
  })

  it('disambiguates duplicate same-path images by occurrence', () => {
    const md = '![](same.png)\n\n![](same.png)'
    const r = locateMarkdownImageToken(md, 'file:///D:/vault/same.png', 'D:\\vault', 2)
    expect(r.decision).toBe('MATCH')
    expect(r.token!.altRaw).toBe('')
    expect(r.candidateIndex).toBe(1)
  })

  it('returns NO_LOCAL_PATH_MATCH when nothing matches', () => {
    const r = locateMarkdownImageToken('![](a.png)', 'file:///D:/vault/missing.png', 'D:\\vault', 1)
    expect(r.decision).toBe('NO_LOCAL_PATH_MATCH')
  })

  it('returns INVALID_FILE_URL for remote src', () => {
    const r = locateMarkdownImageToken('![](a.png)', 'https://example.com/a.png', 'D:\\vault', 1)
    expect(r.decision).toBe('INVALID_FILE_URL')
  })
})

describe('range patching', () => {
  it('patches only the alt range', () => {
    const md = '![old](a.png)'
    const [t] = parseMarkdownImageTokens(md)
    expect(patchAltRange(md, t, 'new')).toBe('![new](a.png)')
  })
  it('patches only the destination range', () => {
    const md = '![x](a%20b.png)'
    const [t] = parseMarkdownImageTokens(md)
    expect(patchDestinationRange(md, t, '<a b.png>')).toBe('![x](<a b.png>)')
  })
})

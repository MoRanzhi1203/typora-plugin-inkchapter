import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  buildAssetLocationKey,
  buildLocationId,
  decodeTyporaPath,
  deriveStorageState,
  isPathInside,
  normalizeLocalPathForKey,
  normalizeRemotePathForKey,
  parseMarkdownImageReferences,
  parseProjectImageManifest,
  pickReusableLocalLocation,
  resolveImageDestination,
  type AssetLocationRecord,
} from './image-asset-model'

function location(overrides: Partial<AssetLocationRecord>): AssetLocationRecord {
  return {
    locationId: buildLocationId(Math.random().toString(36)),
    assetId: 'img_test',
    type: 'project',
    bindingId: null,
    locator: 'C:/docs/assets/a.png',
    relativePath: 'assets/a.png',
    sha256: 'a'.repeat(64),
    availability: 'available',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    remoteProfileId: null,
    remoteBranch: null,
    remotePath: null,
    remoteVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('asset location keys', () => {
  it('treats Windows local paths case-insensitively and ignores separator style', () => {
    expect(normalizeLocalPathForKey('C:\\Docs\\Assets\\A.PNG')).toBe('c:/docs/assets/a.png')
    expect(normalizeLocalPathForKey('c:/docs//assets/a.png/')).toBe('c:/docs/assets/a.png')
    expect(
      buildAssetLocationKey({ type: 'project', locator: 'C:\\Docs\\A.PNG', bindingId: 'p1' }),
    ).toBe(buildAssetLocationKey({ type: 'project', locator: 'c:/docs/a.png', bindingId: 'p1' }))
  })

  it('dedupes remote locations by profile, branch and repository path, not by URL', () => {
    const a = buildAssetLocationKey({
      type: 'github',
      locator: 'https://raw.example/1.png',
      remoteProfileId: 'p1',
      remoteBranch: 'main',
      remotePath: 'images/a.png',
    })
    const b = buildAssetLocationKey({
      type: 'github',
      locator: 'https://raw.example/2.png',
      remoteProfileId: 'p1',
      remoteBranch: 'main',
      remotePath: '/images/a.png/',
    })
    expect(a).toBe(b)
    expect(normalizeRemotePathForKey('/images//a.png/')).toBe('images//a.png')
  })
})

describe('storage state', () => {
  it('counts a verified project/library copy plus GitHub as dual storage', () => {
    expect(deriveStorageState([
      location({ type: 'library' }),
      location({ type: 'github', locator: 'https://example.test/a.png' }),
    ])).toBe('DUAL_AVAILABLE')
  })

  it('never treats cache as permanent dual storage', () => {
    expect(deriveStorageState([
      location({ type: 'cache' }),
      location({ type: 'github', locator: 'https://example.test/a.png' }),
    ])).toBe('REMOTE_ONLY')
    expect(deriveStorageState([location({ type: 'cache' })])).toBe('LOCAL_ONLY')
  })

  it('ignores missing local copies', () => {
    expect(deriveStorageState([
      location({ type: 'project', availability: 'missing' }),
      location({ type: 'github', locator: 'https://example.test/a.png' }),
    ])).toBe('REMOTE_ONLY')
  })

  it('prefers library, then project, then offline, then cache', () => {
    const project = location({ type: 'project', locator: 'p' })
    const library = location({ type: 'library', locator: 'l' })
    const cache = location({ type: 'cache', locator: 'c' })
    expect(pickReusableLocalLocation([cache, project, library])?.locator).toBe('l')
    expect(pickReusableLocalLocation([cache, project])?.locator).toBe('p')
    expect(pickReusableLocalLocation([cache])?.locator).toBe('c')
    expect(pickReusableLocalLocation([location({ type: 'project', availability: 'missing' })])).toBeNull()
  })
})

describe('decodeTyporaPath', () => {
  it('decodes standard percent encoding exactly one level', () => {
    expect(decodeTyporaPath('%E4%B8%AD%E6%96%87%20a%23b.png')).toBe('中文 a#b.png')
    expect(decodeTyporaPath('a%2520b.png')).toBe('a%20b.png')
  })

  it('decodes legacy %uXXXX sequences', () => {
    expect(decodeTyporaPath('%u4E2D%u6587.png')).toBe('中文.png')
  })

  it('keeps the raw value when a percent sequence is invalid', () => {
    expect(decodeTyporaPath('bad%E4name.png')).toBe('bad%E4name.png')
  })
})

describe('resolveImageDestination', () => {
  const documentDir = path.join('C:', 'docs', 'project')

  it('resolves relative paths against the document directory', () => {
    const resolved = resolveImageDestination('assets/图%201.png', documentDir)
    expect(resolved.kind).toBe('local-relative')
    expect(resolved.fsPath).toBe(path.resolve(documentDir, 'assets/图 1.png'))
  })

  it('unwraps angle brackets and keeps absolute Windows paths', () => {
    const resolved = resolveImageDestination('<C:\\images\\a b.png>', documentDir)
    expect(resolved.kind).toBe('local-absolute')
    expect(resolved.fsPath).toBe(path.normalize('C:\\images\\a b.png'))
  })

  it('resolves file:// URLs as local absolute paths', () => {
    const resolved = resolveImageDestination('file:///C:/images/a%20b.png', documentDir)
    expect(resolved.kind).toBe('local-absolute')
    expect(resolved.fsPath).toBe(path.normalize('C:/images/a b.png'))
  })

  it('keeps remote URLs and data URLs out of the filesystem', () => {
    expect(resolveImageDestination('https://example.test/a.png', documentDir).kind).toBe('remote')
    expect(resolveImageDestination('http://example.test/a.png', documentDir).remoteUrl)
      .toBe('http://example.test/a.png')
    expect(resolveImageDestination('data:image/png;base64,AAAA', documentDir).kind).toBe('data')
  })

  it('reports unsupported destinations without guessing a path', () => {
    const resolved = resolveImageDestination('#anchor', documentDir)
    expect(resolved.kind).toBe('unsupported')
    expect(resolved.fsPath).toBeNull()
  })
})

describe('isPathInside', () => {
  it('accepts descendants and rejects traversal', () => {
    expect(isPathInside('C:/project', 'C:/project/assets/a.png')).toBe(true)
    expect(isPathInside('C:/project', 'C:/project-other/a.png')).toBe(false)
    expect(isPathInside('C:/project', 'C:/project/../secret.png')).toBe(false)
  })
})

describe('parseMarkdownImageReferences', () => {
  const documentPath = path.join('C:', 'docs', 'note.md')

  it('extracts inline markdown images with stable ids and line positions', () => {
    const markdown = '# T\n\n![图](assets/%E4%B8%AD%E6%96%87.png)\n'
    const refs = parseMarkdownImageReferences(markdown, documentPath)
    expect(refs).toHaveLength(1)
    expect(refs[0].syntax).toBe('markdown-inline')
    expect(refs[0].altText).toBe('图')
    expect(refs[0].startLine).toBe(3)
    expect(refs[0].resolved.decoded).toBe('assets/中文.png')
    expect(refs[0].referenceId).toMatch(/^ref_[0-9a-f]{20}$/)
    expect(parseMarkdownImageReferences(markdown, documentPath)[0].referenceId).toBe(refs[0].referenceId)
  })

  it('ignores images inside fenced code blocks', () => {
    const markdown = [
      '```md',
      '![code](assets/code.png)',
      '<img src="assets/code.png">',
      '![ref][x]',
      '[x]: assets/def.png',
      '```',
      '![real](assets/real.png)',
    ].join('\n')
    const refs = parseMarkdownImageReferences(markdown, documentPath)
    expect(refs).toHaveLength(1)
    expect(refs[0].rawDestination).toBe('assets/real.png')
  })

  it('resolves reference-style images through their definition', () => {
    const markdown = '![alt][logo]\n\n[logo]: https://example.test/logo.png\n'
    const refs = parseMarkdownImageReferences(markdown, documentPath)
    expect(refs).toHaveLength(1)
    expect(refs[0].syntax).toBe('markdown-reference')
    expect(refs[0].resolved.remoteUrl).toBe('https://example.test/logo.png')
  })

  it('extracts html img sources and decodes entities', () => {
    const markdown = '<img alt="图 1" src="assets/a&amp;b.png">'
    const refs = parseMarkdownImageReferences(markdown, documentPath)
    expect(refs).toHaveLength(1)
    expect(refs[0].syntax).toBe('html-img')
    expect(refs[0].altText).toBe('图 1')
    // 原文偏移必须对应编码后的文本；解析结果使用解码后的路径。
    expect(refs[0].rawDestination).toBe('assets/a&amp;b.png')
    expect(refs[0].resolved.decoded).toBe('assets/a&b.png')
  })

  it('returns references in source order', () => {
    const markdown = '<img src="b.png">\n\n![a](a.png)\n'
    const refs = parseMarkdownImageReferences(markdown, documentPath)
    expect(refs.map(ref => ref.rawDestination)).toEqual(['b.png', 'a.png'])
  })
})

describe('parseProjectImageManifest', () => {
  it('accepts portable entries with relative paths', () => {
    const result = parseProjectImageManifest({
      schemaVersion: 1,
      assets: [{
        assetId: 'img_1',
        sha256: 'a'.repeat(64),
        originalFilename: '原图 1.png',
        projectRelativePath: 'assets/images/原图 1.png',
        remoteUrl: 'https://example.test/a.png',
      }],
    })
    expect(result.ok).toBe(true)
    expect(result.manifest?.assets).toHaveLength(1)
  })

  it('rejects absolute paths, traversal, bad hashes and non-http locators', () => {
    const result = parseProjectImageManifest({
      schemaVersion: 1,
      assets: [{
        assetId: 'img_1',
        sha256: 'not-a-hash',
        originalFilename: 'a.png',
        projectRelativePath: '../secret/a.png',
        remoteUrl: 'file:///C:/a.png',
      }],
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(expect.arrayContaining([
      'ASSET_0_SHA_INVALID',
      'ASSET_0_PATH_INVALID',
      'ASSET_0_REMOTE_URL_INVALID',
    ]))
  })

  it('rejects a manifest without a supported schema', () => {
    expect(parseProjectImageManifest({ schemaVersion: 9, assets: [] }).ok).toBe(false)
  })
})

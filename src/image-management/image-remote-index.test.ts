import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildRemoteImageUrl,
  findRemoteContentBySha256,
  isRemoteUrlForProfile,
  listRemoteImageEntries,
  type RemoteImageEntry,
} from './image-remote-index'
import type { GitHubJsonRequester } from './github-connection-test'
import type { ImageRemoteProfile } from './image-settings'

const PROFILE: ImageRemoteProfile = {
  remoteProfileId: 'github-default',
  provider: 'github',
  owner: 'octocat',
  repository: 'image-bed',
  branch: 'main',
  remoteDirectory: 'images',
  urlStrategy: 'raw',
  customUrlBase: '',
  credentialReferenceId: 'image.github.default',
  enabled: true,
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function requester(handler: (path: string) => { status: number; json: unknown }): GitHubJsonRequester {
  return async ({ path }) => handler(path)
}

function entry(overrides: Partial<RemoteImageEntry> & Pick<RemoteImageEntry, 'path' | 'name'>): RemoteImageEntry {
  return {
    sha: `git-${overrides.name}`,
    size: PNG.byteLength,
    ...overrides,
  }
}

describe('listRemoteImageEntries', () => {
  it('keeps only image files and reports a complete directory', async () => {
    const request = requester(() => ({
      status: 200,
      json: [
        { type: 'file', name: 'a.png', path: 'images/a.png', sha: 'git-a', size: 7 },
        { type: 'file', name: 'notes.txt', path: 'images/notes.txt', sha: 'git-n', size: 7 },
        { type: 'dir', name: 'nested', path: 'images/nested', sha: 'git-d', size: 0 },
      ],
    }))
    const index = await listRemoteImageEntries({ request, token: 't', profile: PROFILE, branch: 'main', directory: 'images' })

    expect(index.ok).toBe(true)
    expect(index.complete).toBe(true)
    expect(index.entries).toEqual([{ path: 'images/a.png', name: 'a.png', sha: 'git-a', size: 7 }])
  })

  it('treats a missing directory as empty only within that scope', async () => {
    const request = requester(() => ({ status: 404, json: null }))
    const index = await listRemoteImageEntries({ request, token: 't', profile: PROFILE, branch: 'main', directory: 'images' })

    expect(index).toEqual({ ok: true, entries: [], complete: true, errorCode: null })
  })

  it('marks the index incomplete at the GitHub 1000-entry directory limit', async () => {
    const request = requester(() => ({
      status: 200,
      json: Array.from({ length: 1000 }, (_, i) => ({
        type: 'file', name: `${i}.png`, path: `images/${i}.png`, sha: `git-${i}`, size: PNG.byteLength,
      })),
    }))
    const index = await listRemoteImageEntries({ request, token: 't', profile: PROFILE, branch: 'main', directory: 'images' })

    expect(index.ok).toBe(true)
    expect(index.complete).toBe(false)
    expect(index.entries).toHaveLength(1000)
  })

  it('reports permission problems as unverified instead of empty', async () => {
    const request = requester(() => ({ status: 403, json: null }))
    const index = await listRemoteImageEntries({ request, token: 't', profile: PROFILE, branch: 'main', directory: 'images' })

    expect(index).toEqual({ ok: false, entries: [], complete: false, errorCode: 'REMOTE_INDEX_FORBIDDEN' })
  })
})

describe('findRemoteContentBySha256', () => {
  const entries = [
    entry({ path: 'images/same-name.png', name: 'same-name.png', sha: 'git-old', size: PNG.byteLength }),
    entry({ path: 'images/other-name.png', name: 'other-name.png', sha: 'git-same', size: PNG.byteLength }),
  ]

  it('matches content regardless of filename', async () => {
    const request = requester(path => {
      if (path.includes('same-name.png')) {
        return { status: 200, json: { encoding: 'base64', content: base64(Uint8Array.from([9, 9, 9])), sha: 'git-old' } }
      }
      return { status: 200, json: { encoding: 'base64', content: base64(PNG), sha: 'git-same' } }
    })
    const match = await findRemoteContentBySha256({
      request,
      token: 't',
      profile: PROFILE,
      branch: 'main',
      entries,
      sha256: sha256(PNG),
      sizeBytes: PNG.byteLength,
    })

    expect(match).toEqual({
      path: 'images/other-name.png',
      gitSha: 'git-same',
      size: PNG.byteLength,
      sha256: sha256(PNG),
    })
  })

  it('never matches a same-name file whose bytes differ', async () => {
    const request = requester(() => ({
      status: 200,
      json: { encoding: 'base64', content: base64(Uint8Array.from([9, 9, 9])), sha: 'git-x' },
    }))
    const match = await findRemoteContentBySha256({
      request,
      token: 't',
      profile: PROFILE,
      branch: 'main',
      entries: [entries[0]],
      sha256: sha256(PNG),
      sizeBytes: PNG.byteLength,
    })

    expect(match).toBeNull()
  })

  it('does not claim a match for files above the inline content limit', async () => {
    let requested = 0
    const request = requester(() => {
      requested++
      return { status: 200, json: { encoding: 'none', content: '', sha: 'git-big' } }
    })
    const match = await findRemoteContentBySha256({
      request,
      token: 't',
      profile: PROFILE,
      branch: 'main',
      entries: [entry({ path: 'images/big.png', name: 'big.png', size: 2 * 1024 * 1024 })],
      sha256: sha256(PNG),
      sizeBytes: 2 * 1024 * 1024,
    })

    expect(match).toBeNull()
    expect(requested).toBe(0)
  })
})

describe('buildRemoteImageUrl', () => {
  it('builds stable raw URLs with encoded path segments', () => {
    expect(buildRemoteImageUrl({ profile: PROFILE, branch: 'main', path: 'images/中文 1.png' }))
      .toBe('https://raw.githubusercontent.com/octocat/image-bed/main/images/%E4%B8%AD%E6%96%87%201.png')
  })

  it('honors blob and custom URL strategies', () => {
    expect(buildRemoteImageUrl({
      profile: { ...PROFILE, urlStrategy: 'blob' },
      branch: 'main',
      path: 'images/a.png',
    })).toBe('https://github.com/octocat/image-bed/blob/main/images/a.png')

    expect(buildRemoteImageUrl({
      profile: { ...PROFILE, urlStrategy: 'custom', customUrlBase: 'https://cdn.example.test/' },
      branch: 'main',
      path: 'images/a.png',
    })).toBe('https://cdn.example.test/images/a.png')
  })
})

describe('isRemoteUrlForProfile', () => {
  it('rejects URLs that point at a different repository', () => {
    expect(isRemoteUrlForProfile(
      'https://raw.githubusercontent.com/octocat/image-bed/main/images/a.png',
      PROFILE,
    )).toBe(true)
    expect(isRemoteUrlForProfile(
      'https://raw.githubusercontent.com/other-user/image-bed/main/images/a.png',
      PROFILE,
    )).toBe(false)
    expect(isRemoteUrlForProfile(
      'https://raw.githubusercontent.com/octocat/other-repo/main/images/a.png',
      PROFILE,
    )).toBe(false)
    expect(isRemoteUrlForProfile('not-a-url', PROFILE)).toBe(false)
  })

  it('keeps custom CDN URLs for caller-side directory scope checks', () => {
    expect(isRemoteUrlForProfile('https://cdn.example.test/images/a.png', PROFILE)).toBe(true)
  })
})

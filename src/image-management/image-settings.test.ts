import { describe, it, expect } from 'vitest'
import {
  DEFAULT_IMAGE_SETTINGS,
  normalizeDocumentResourceDirectory,
  normalizeRemoteDirectory,
  resolveImageSettings,
  validateImageLibraryPath,
  validateRemoteProfile,
  type ImageRemoteProfile,
} from './image-settings'

const VALID_PROFILE: ImageRemoteProfile = {
  remoteProfileId: 'github:example/example-images',
  provider: 'github',
  owner: 'example',
  repository: 'example-images',
  branch: 'main',
  remoteDirectory: 'blog/2026',
  urlStrategy: 'raw',
  customUrlBase: '',
  credentialReferenceId: 'image.github.default',
  enabled: true,
}

describe('image settings defaults', () => {
  it('contains no personal path, account or repository', () => {
    const serialized = JSON.stringify(DEFAULT_IMAGE_SETTINGS)
    expect(serialized).not.toContain('E:\\\\TyporaImageLibrary')
    expect(serialized).not.toContain('MoRanzhi1203')
    expect(serialized).not.toContain('Picture_Bed')
    expect(serialized).not.toContain('token')
  })

  it('is disabled and uninitialized by default', () => {
    expect(DEFAULT_IMAGE_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_IMAGE_SETTINGS.initialized).toBe(false)
    expect(DEFAULT_IMAGE_SETTINGS.localLibraryPath).toBe('')
    expect(DEFAULT_IMAGE_SETTINGS.remoteProfiles).toEqual([])
  })
})

describe('validateImageLibraryPath', () => {
  it('accepts drive and UNC absolute paths', () => {
    expect(validateImageLibraryPath('E:\\TyporaImageLibrary')).toEqual({
      ok: true,
      normalized: 'E:\\TyporaImageLibrary',
    })
    expect(validateImageLibraryPath('D:/图库 目录/')).toEqual({
      ok: true,
      normalized: 'D:/图库 目录',
    })
    expect(validateImageLibraryPath('\\\\nas\\images')).toEqual({
      ok: true,
      normalized: '\\\\nas\\images',
    })
  })

  it('rejects relative, empty, traversal and control-character paths', () => {
    expect(validateImageLibraryPath('').code).toBe('EMPTY')
    expect(validateImageLibraryPath('images/library').code).toBe('NOT_ABSOLUTE')
    expect(validateImageLibraryPath('E:\\library\\..\\other').code).toBe('PARENT_TRAVERSAL')
    expect(validateImageLibraryPath('E:\\library\0x').code).toBe('INVALID_CHARACTER')
    expect(validateImageLibraryPath(undefined).ok).toBe(false)
  })
})

describe('normalizeDocumentResourceDirectory', () => {
  it('normalizes relative directories', () => {
    expect(normalizeDocumentResourceDirectory('assets\\images')).toBe('assets/images')
    expect(normalizeDocumentResourceDirectory('./assets//images/')).toBe('assets/images')
  })

  it('rejects absolute paths, traversal and empty values', () => {
    expect(normalizeDocumentResourceDirectory('E:\\assets')).toBeNull()
    expect(normalizeDocumentResourceDirectory('/assets')).toBeNull()
    expect(normalizeDocumentResourceDirectory('../assets')).toBeNull()
    expect(normalizeDocumentResourceDirectory('')).toBeNull()
  })
})

describe('normalizeRemoteDirectory', () => {
  it('accepts repository root and nested directories', () => {
    expect(normalizeRemoteDirectory('')).toBe('')
    expect(normalizeRemoteDirectory('/')).toBe('')
    expect(normalizeRemoteDirectory('blog\\2026//')).toBe('blog/2026')
  })

  it('rejects absolute and traversal paths', () => {
    expect(normalizeRemoteDirectory('/blog')).toBeNull()
    expect(normalizeRemoteDirectory('blog/../secret')).toBeNull()
  })
})

describe('validateRemoteProfile', () => {
  it('accepts a complete profile and normalizes the directory', () => {
    const result = validateRemoteProfile({ ...VALID_PROFILE, remoteDirectory: 'blog\\2026' })
    expect(result.ok).toBe(true)
    expect(result.normalized?.remoteDirectory).toBe('blog/2026')
    expect(result.normalized?.provider).toBe('github')
  })

  it('requires an owner and repository', () => {
    expect(validateRemoteProfile({ ...VALID_PROFILE, owner: '' }).problems).toContain('OWNER_INVALID')
    expect(validateRemoteProfile({ ...VALID_PROFILE, repository: '' }).problems).toContain('REPOSITORY_INVALID')
    expect(validateRemoteProfile({ ...VALID_PROFILE, remoteProfileId: '' }).problems)
      .toContain('REMOTE_PROFILE_ID_REQUIRED')
  })

  it('rejects invalid branch names and custom URL bases', () => {
    expect(validateRemoteProfile({ ...VALID_PROFILE, branch: 'feat..x' }).problems).toContain('BRANCH_INVALID')
    expect(validateRemoteProfile({ ...VALID_PROFILE, branch: 'bad branch' }).problems).toContain('BRANCH_INVALID')
    expect(validateRemoteProfile({ ...VALID_PROFILE, urlStrategy: 'custom', customUrlBase: 'ftp://x' }).problems)
      .toContain('CUSTOM_URL_BASE_INVALID')
  })

  it('allows an empty branch for "read the real default branch later"', () => {
    expect(validateRemoteProfile({ ...VALID_PROFILE, branch: '' }).ok).toBe(true)
  })
})

describe('resolveImageSettings', () => {
  it('fills a missing configuration with defaults', () => {
    const resolved = resolveImageSettings(null)
    expect(resolved.storageMode).toBe('dual-storage')
    expect(resolved.referenceMode).toBe('local-relative')
    expect(resolved.limits.maxConcurrentUploads).toBe(2)
    expect(resolved.limits.maxConcurrentDownloads).toBe(3)
    expect(resolved.limits.maxTransientRetries).toBe(3)
  })

  it('drops invalid and duplicate remote profiles', () => {
    const resolved = resolveImageSettings({
      remoteProfiles: [VALID_PROFILE, { ...VALID_PROFILE, owner: '' }, { ...VALID_PROFILE }],
    })
    expect(resolved.remoteProfiles).toHaveLength(1)
    expect(resolved.remoteProfiles[0].remoteProfileId).toBe(VALID_PROFILE.remoteProfileId)
  })

  it('clears a default profile that does not exist', () => {
    const resolved = resolveImageSettings({
      remoteProfiles: [VALID_PROFILE],
      defaultRemoteProfileId: 'missing',
    })
    expect(resolved.defaultRemoteProfileId).toBeNull()
  })

  it('keeps a default profile that exists', () => {
    const resolved = resolveImageSettings({
      remoteProfiles: [VALID_PROFILE],
      defaultRemoteProfileId: VALID_PROFILE.remoteProfileId,
    })
    expect(resolved.defaultRemoteProfileId).toBe(VALID_PROFILE.remoteProfileId)
  })

  it('clamps concurrency and retry limits', () => {
    const resolved = resolveImageSettings({
      limits: {
        maxConcurrentUploads: 99,
        maxConcurrentDownloads: 0,
        maxTransientRetries: -3,
        downloadMaxBytes: 1,
      },
    })
    expect(resolved.limits.maxConcurrentUploads).toBe(8)
    expect(resolved.limits.maxConcurrentDownloads).toBe(1)
    expect(resolved.limits.maxTransientRetries).toBe(0)
    expect(resolved.limits.downloadMaxBytes).toBe(1024 * 1024)
  })

  it('falls back to defaults for unknown enum values', () => {
    const resolved = resolveImageSettings({
      storageMode: 'unknown' as never,
      referenceMode: 'unknown' as never,
      namingStrategy: 'unknown' as never,
      compressionMode: 'unknown' as never,
    })
    expect(resolved.storageMode).toBe('dual-storage')
    expect(resolved.referenceMode).toBe('local-relative')
    expect(resolved.namingStrategy).toBe('timestamp-hash')
    expect(resolved.compressionMode).toBe('keep')
  })

  it('does not mutate the shared default object', () => {
    const resolved = resolveImageSettings(null)
    resolved.remoteProfiles.push(VALID_PROFILE)
    expect(DEFAULT_IMAGE_SETTINGS.remoteProfiles).toEqual([])
  })
})

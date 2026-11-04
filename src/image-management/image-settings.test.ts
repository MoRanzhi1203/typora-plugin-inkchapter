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
    expect(serialized).not.toMatch(/"owner"\s*:\s*"[^"]+"/)
    expect(serialized).not.toMatch(/"repository"\s*:\s*"[^"]+"/)
    expect(serialized).not.toMatch(/"token"\s*:/)
    expect(serialized).not.toContain('ghp_')
    expect(serialized).not.toContain('github_pat_')
  })

  it('is disabled and uninitialized by default', () => {
    expect(DEFAULT_IMAGE_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_IMAGE_SETTINGS.initialized).toBe(false)
    expect(DEFAULT_IMAGE_SETTINGS.globalLibrary).toEqual({ mode: 'off', root: '' })
    expect(DEFAULT_IMAGE_SETTINGS.remoteProfiles).toEqual([])
  })

  it('keeps every configurable path empty by default', () => {
    expect(DEFAULT_IMAGE_SETTINGS.cache.root).toBe('')
    expect(DEFAULT_IMAGE_SETTINGS.offline.root).toBe('')
    expect(DEFAULT_IMAGE_SETTINGS.uploadStaging.root).toBe('')
    expect(DEFAULT_IMAGE_SETTINGS.database.root).toBe('')
    expect(DEFAULT_IMAGE_SETTINGS.cache.maxSizeMB).toBe(512)
  })
})

describe('path settings', () => {
  it('migrates the legacy single library path into archive mode', () => {
    const resolved = resolveImageSettings({ localLibraryPath: 'D:\\ImageLibrary' })
    expect(resolved.globalLibrary).toEqual({ mode: 'archive', root: 'D:\\ImageLibrary' })
  })

  it('does not let the legacy field override explicit new settings', () => {
    const resolved = resolveImageSettings({
      localLibraryPath: 'D:\\Old',
      globalLibrary: { mode: 'index', root: 'D:\\New' },
    })
    expect(resolved.globalLibrary).toEqual({ mode: 'index', root: 'D:\\New' })
  })

  it('downgrades archive without a root instead of creating a directory', () => {
    const resolved = resolveImageSettings({ globalLibrary: { mode: 'archive', root: '' } })
    expect(resolved.globalLibrary.mode).toBe('off')
  })

  it('rejects relative and traversal paths for every configurable root', () => {
    const resolved = resolveImageSettings({
      globalLibrary: { mode: 'archive', root: 'relative/library' },
      cache: { mode: 'smart', root: '..\\cache', maxSizeMB: 512 },
      offline: { root: 'C:relative' },
      uploadStaging: { root: 'staging' },
      database: { root: '\\\\server\\share' },
    })
    expect(resolved.globalLibrary).toEqual({ mode: 'off', root: '' })
    expect(resolved.cache.root).toBe('')
    expect(resolved.offline.root).toBe('')
    expect(resolved.uploadStaging.root).toBe('')
    expect(resolved.database.root).toBe('\\\\server\\share')
  })

  it('bounds the cache quota', () => {
    expect(resolveImageSettings({ cache: { mode: 'smart', root: '', maxSizeMB: 1 } }).cache.maxSizeMB).toBe(64)
    expect(resolveImageSettings({ cache: { mode: 'smart', root: '', maxSizeMB: 1e9 } }).cache.maxSizeMB)
      .toBe(100 * 1024)
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

describe('uploadService', () => {
  it('defaults to none so a clean install never uploads', () => {
    expect(DEFAULT_IMAGE_SETTINGS.uploadService).toBe('none')
    expect(resolveImageSettings({}).uploadService).toBe('none')
    expect(resolveImageSettings(null).uploadService).toBe('none')
  })

  it('refuses github when no enabled remote profile exists', () => {
    expect(resolveImageSettings({ uploadService: 'github' }).uploadService).toBe('none')
    expect(resolveImageSettings({ uploadService: 'github', remoteProfiles: [] }).uploadService).toBe('none')
    expect(
      resolveImageSettings({
        uploadService: 'github',
        remoteProfiles: [{ ...VALID_PROFILE, enabled: false }],
      }).uploadService,
    ).toBe('none')
  })

  it('keeps github only with an enabled remote profile', () => {
    expect(
      resolveImageSettings({ uploadService: 'github', remoteProfiles: [VALID_PROFILE] }).uploadService,
    ).toBe('github')
  })

  it('falls back to none for unknown service names', () => {
    expect(
      resolveImageSettings({
        uploadService: 'smms' as never,
        remoteProfiles: [VALID_PROFILE],
      }).uploadService,
    ).toBe('none')
  })
})

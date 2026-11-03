import { describe, it, expect } from 'vitest'
import {
  parseProjectImageOptions,
  resolveEffectiveImageConfig,
} from './image-config-layers'
import {
  DEFAULT_IMAGE_SETTINGS,
  resolveImageSettings,
  type ImageRemoteProfile,
} from './image-settings'

const PROFILE: ImageRemoteProfile = {
  remoteProfileId: 'github:example/example-images',
  provider: 'github',
  owner: 'example',
  repository: 'example-images',
  branch: 'main',
  remoteDirectory: 'images',
  urlStrategy: 'raw',
  customUrlBase: '',
  credentialReferenceId: 'image.github.default',
  enabled: true,
}

describe('resolveEffectiveImageConfig', () => {
  it('marks untouched values as public defaults', () => {
    const base = resolveImageSettings(null)
    const effective = resolveEffectiveImageConfig(base)
    expect(effective.origins).toEqual({
      uploadService: 'public-default',
      referenceMode: 'public-default',
      autoUpload: 'public-default',
      cacheMode: 'public-default',
    })
  })

  it('marks user overrides and keeps operation overrides temporary', () => {
    const base = resolveImageSettings({
      referenceMode: 'remote-url',
      cache: { mode: 'manual', root: 'D:\\Cache', maxSizeMB: 256 },
    })
    const effective = resolveEffectiveImageConfig(base, {
      referenceMode: 'local-relative',
      cacheMode: 'smart',
    })
    expect(effective.settings.referenceMode).toBe('local-relative')
    expect(effective.settings.cache.mode).toBe('smart')
    expect(effective.origins.referenceMode).toBe('operation')
    expect(effective.origins.cacheMode).toBe('operation')
    expect(effective.origins.autoUpload).toBe('public-default')
    // 原配置不被修改。
    expect(base.referenceMode).toBe('remote-url')
    expect(base.cache.mode).toBe('manual')
  })

  it('refuses a github operation override without an enabled profile', () => {
    const base = resolveImageSettings(null)
    const effective = resolveEffectiveImageConfig(base, { uploadService: 'github' })
    expect(effective.settings.uploadService).toBe('none')
    expect(effective.origins.uploadService).toBe('public-default')
  })

  it('accepts a github override when a profile exists', () => {
    const base = resolveImageSettings({ remoteProfiles: [PROFILE], defaultRemoteProfileId: PROFILE.remoteProfileId })
    const effective = resolveEffectiveImageConfig(base, { uploadService: 'github' })
    expect(effective.settings.uploadService).toBe('github')
    expect(effective.origins.uploadService).toBe('operation')
  })

  it('never mutates the public default object', () => {
    resolveEffectiveImageConfig(DEFAULT_IMAGE_SETTINGS, { cacheMode: 'off', autoUpload: true })
    expect(DEFAULT_IMAGE_SETTINGS.cache.mode).toBe('smart')
    expect(DEFAULT_IMAGE_SETTINGS.autoUpload).toBe(false)
  })
})

describe('parseProjectImageOptions', () => {
  it('accepts only privacy-free project options', () => {
    const result = parseProjectImageOptions({
      schemaVersion: 1,
      referenceMode: 'local-relative',
      cacheMode: 'smart',
    })
    expect(result.ok).toBe(true)
    expect(result.options).toEqual({
      schemaVersion: 1,
      referenceMode: 'local-relative',
      cacheMode: 'smart',
    })
  })

  it('rejects tokens, paths, accounts and unknown keys', () => {
    const result = parseProjectImageOptions({
      schemaVersion: 1,
      uploadService: 'github',
      token: 'secret',
      libraryRoot: 'D:\\Images',
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(expect.arrayContaining([
      'KEY_NOT_ALLOWED:uploadService',
      'KEY_NOT_ALLOWED:token',
      'KEY_NOT_ALLOWED:libraryRoot',
    ]))
  })

  it('validates enum values and schema version', () => {
    expect(parseProjectImageOptions({ schemaVersion: 2 }).ok).toBe(false)
    expect(parseProjectImageOptions({ schemaVersion: 1, cacheMode: 'always' }).ok).toBe(false)
    expect(parseProjectImageOptions(null).ok).toBe(false)
  })
})

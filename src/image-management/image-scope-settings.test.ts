import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings, type ImageSettings } from './image-settings'
import {
  IMAGE_SCOPE_OVERRIDABLE_KEYS,
  emptyImageScopeStore,
  findFolderScope,
  isPathInsideFolder,
  normalizeScopePath,
  resolveImageSettingsForDocument,
  sanitizeImageScopeOverrides,
  scopeOriginOf,
  type ImageScopeEntry,
} from './image-scope-settings'

const DOC = 'D:/vault/notes/chapter/doc.md'
const FOLDER = 'D:/vault/notes'

function entry(
  kind: 'folder' | 'document',
  path: string,
  overrides: ImageScopeEntry['overrides'],
): ImageScopeEntry {
  return { kind, path, overrides, updatedAt: '2026-11-06T00:00:00.000Z' }
}

function base(overrides: Partial<ImageSettings> = {}): ImageSettings {
  return resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...overrides } as never)
}

describe('scope path normalization + folder matching', () => {
  it('normalizes separators, trailing slashes and drive-letter case', () => {
    expect(normalizeScopePath('D:\\Vault\\Notes\\')).toBe('d:/Vault/Notes')
    expect(normalizeScopePath('d:/vault//notes/')).toBe('d:/vault/notes')
    expect(normalizeScopePath('  ')).toBe('')
  })

  it('matches a document inside a folder including the folder itself', () => {
    expect(isPathInsideFolder(DOC, FOLDER)).toBe(true)
    expect(isPathInsideFolder(DOC, 'D:/vault/notes/chapter')).toBe(true)
    expect(isPathInsideFolder(DOC, 'D:/other')).toBe(false)
    // 前缀相同但并非目录边界
    expect(isPathInsideFolder('D:/vault/notes2/a.md', 'D:/vault/notes')).toBe(false)
  })

  it('picks the closest ancestor folder scope', () => {
    const entries = [
      entry('folder', 'D:/vault', { autoUpload: true }),
      entry('folder', 'D:/vault/notes', { autoUpload: false }),
    ]
    const found = findFolderScope(entries, DOC)
    expect(found?.path).toBe('d:/vault/notes')
  })
})

describe('resolveImageSettingsForDocument — three-level inheritance', () => {
  it('falls back to global when no scope exists', () => {
    const resolved = resolveImageSettingsForDocument({
      globalSettings: base({ autoUpload: true, documentResourceDirectory: 'assets/global' }),
      documentPath: DOC,
      entries: [],
    })
    expect(resolved.settings.autoUpload).toBe(true)
    expect(resolved.settings.documentResourceDirectory).toBe('assets/global')
    expect(resolved.appliedFolderPath).toBeNull()
    expect(resolved.appliedDocumentPath).toBeNull()
    expect(scopeOriginOf(resolved, 'autoUpload')).toBe('global')
  })

  it('folder overrides global and document overrides folder per field', () => {
    const resolved = resolveImageSettingsForDocument({
      globalSettings: base({ autoUpload: true, documentResourceDirectory: 'assets/global', namingStrategy: 'timestamp-hash' }),
      documentPath: DOC,
      entries: [
        entry('folder', FOLDER, { autoUpload: false, documentResourceDirectory: 'assets/folder' }),
        entry('document', DOC, { documentResourceDirectory: 'assets/doc' }),
      ],
    })
    // document > folder > global
    expect(resolved.settings.documentResourceDirectory).toBe('assets/doc')
    // folder > global
    expect(resolved.settings.autoUpload).toBe(false)
    // global 未被覆盖
    expect(resolved.settings.namingStrategy).toBe('timestamp-hash')
    expect(scopeOriginOf(resolved, 'documentResourceDirectory')).toBe('document')
    expect(scopeOriginOf(resolved, 'autoUpload')).toBe('folder')
    expect(scopeOriginOf(resolved, 'namingStrategy')).toBe('global')
    expect(resolved.appliedFolderPath).toBe('d:/vault/notes')
    expect(resolved.appliedDocumentPath).toBe('d:/vault/notes/chapter/doc.md')
  })

  it('records the inherited value for every overridden field', () => {
    const resolved = resolveImageSettingsForDocument({
      globalSettings: base({ autoUpload: true }),
      documentPath: DOC,
      entries: [entry('document', DOC, { autoUpload: false })],
    })
    const autoUpload = resolved.origins.find(item => item.key === 'autoUpload')
    expect(autoUpload).toEqual({
      key: 'autoUpload',
      origin: 'document',
      value: false,
      inheritedValue: true,
    })
  })

  it('supports documents opened outside a project (arbitrary absolute paths)', () => {
    const outside = 'E:/standalone/notes/solo.md'
    const resolved = resolveImageSettingsForDocument({
      globalSettings: base({ autoUpload: false }),
      documentPath: outside,
      entries: [entry('document', outside, { autoUpload: true, autoLocalizeOnInsert: true })],
    })
    expect(resolved.settings.autoUpload).toBe(true)
    expect(resolved.settings.autoLocalizeOnInsert).toBe(true)
    // scope 不能绕过“上传服务必须显式可用”的约束。
    expect(resolved.settings.uploadService).toBe('none')
    expect(resolved.appliedDocumentPath).toBe('e:/standalone/notes/solo.md')
  })

  it('exposes every overridable key and only those keys', () => {
    expect(IMAGE_SCOPE_OVERRIDABLE_KEYS).toContain('documentResourceDirectory')
    expect(IMAGE_SCOPE_OVERRIDABLE_KEYS).toContain('autoLocalizeOnInsert')
    expect(IMAGE_SCOPE_OVERRIDABLE_KEYS).not.toContain('remoteProfiles')
    expect(IMAGE_SCOPE_OVERRIDABLE_KEYS).not.toContain('database')
    expect(IMAGE_SCOPE_OVERRIDABLE_KEYS).not.toContain('cache')
  })
})

describe('sanitizeImageScopeOverrides — no paths / credentials allowed', () => {
  it('accepts the allowed field set', () => {
    const result = sanitizeImageScopeOverrides({
      documentResourceDirectory: 'assets/images',
      storageMode: 'local-first',
      referenceMode: 'remote-url',
      uploadService: 'github',
      autoUpload: true,
      autoLocalizeOnInsert: true,
      namingStrategy: 'original-name',
      compressionMode: 'smart',
      convertToWebp: true,
      defaultRemoteProfileId: 'github-default',
    })
    expect(result.problems).toEqual([])
    expect(result.overrides.autoLocalizeOnInsert).toBe(true)
    expect(result.overrides.documentResourceDirectory).toBe('assets/images')
  })

  it('rejects unknown keys and credential-bearing fields', () => {
    const result = sanitizeImageScopeOverrides({
      remoteProfiles: [{ owner: 'x' }],
      database: { root: 'C:/secret' },
      token: 'abc',
      documentResourceDirectory: 'assets',
    })
    expect(result.problems).toEqual(expect.arrayContaining([
      'KEY_NOT_ALLOWED:remoteProfiles',
      'KEY_NOT_ALLOWED:database',
      'KEY_NOT_ALLOWED:token',
    ]))
    expect(result.overrides).toEqual({ documentResourceDirectory: 'assets' })
  })

  it('rejects absolute and traversal document resource directories', () => {
    expect(sanitizeImageScopeOverrides({ documentResourceDirectory: 'C:/abs' }).problems)
      .toContain('DOCUMENT_RESOURCE_DIRECTORY_INVALID')
    expect(sanitizeImageScopeOverrides({ documentResourceDirectory: '../escape' }).problems)
      .toContain('DOCUMENT_RESOURCE_DIRECTORY_INVALID')
  })

  it('rejects invalid enums and non-boolean flags', () => {
    const result = sanitizeImageScopeOverrides({
      storageMode: 'cloud',
      referenceMode: 'ftp',
      uploadService: 'imgur',
      autoUpload: 'yes',
      autoLocalizeOnInsert: 1,
      namingStrategy: 'hash',
      compressionMode: 'max',
      convertToWebp: 'true',
    })
    expect(result.problems).toEqual(expect.arrayContaining([
      'STORAGE_MODE_INVALID',
      'REFERENCE_MODE_INVALID',
      'UPLOAD_SERVICE_INVALID',
      'AUTO_UPLOAD_INVALID',
      'AUTO_LOCALIZE_INVALID',
      'NAMING_STRATEGY_INVALID',
      'COMPRESSION_MODE_INVALID',
      'CONVERT_TO_WEBP_INVALID',
    ]))
    expect(result.overrides).toEqual({})
  })

  it('creates an empty store', () => {
    expect(emptyImageScopeStore()).toEqual({ schemaVersion: 1, entries: [] })
  })
})

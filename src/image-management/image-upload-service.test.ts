import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { resolveImageSettings, type ImageSettings } from './image-settings'
import { ImageAssetService } from './image-asset-service'
import { ImageTransferTaskStore } from './image-transfer-task-store'
import { ImageUploadService, toPicGoImportSpecifier, type PicGoConstructorLike } from './image-upload-service'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-upload-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

const PROFILE = {
  remoteProfileId: 'github-default',
  provider: 'github' as const,
  owner: 'octocat',
  repository: 'image-bed',
  branch: 'main',
  remoteDirectory: 'images',
  urlStrategy: 'raw' as const,
  customUrlBase: '',
  credentialReferenceId: 'image.github.default',
  enabled: true,
}

function makeSettings(overrides: Record<string, unknown> = {}): ImageSettings {
  return resolveImageSettings({
    enabled: true,
    initialized: true,
    uploadService: 'github',
    remoteProfiles: [PROFILE],
    defaultRemoteProfileId: PROFILE.remoteProfileId,
    ...overrides,
  })
}

function fakeLoader(result: unknown, onUpload?: (files: string[]) => void): {
  loader: () => Promise<PicGoConstructorLike>
  uploaded: string[][]
} {
  const uploaded: string[][] = []
  class FakePicGo {
    constructor(public configPath?: string) {}
    async upload(files?: string[]): Promise<unknown> {
      const list = files ?? []
      uploaded.push(list)
      onUpload?.(list)
      return result
    }
  }
  return { loader: async () => FakePicGo, uploaded }
}

async function setup(options: {
  settings?: ImageSettings
  result?: unknown
  withConfig?: boolean
} = {}) {
  const root = await makeRoot()
  const settings = options.settings ?? makeSettings()
  const paths = resolveImageDataPaths(root, {
    settings,
    env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
  })
  if (options.withConfig !== false) {
    await fs.mkdir(path.dirname(path.join(paths.dataRoot, 'picgo', 'config.json')), { recursive: true })
    await fs.writeFile(
      path.join(paths.dataRoot, 'picgo', 'config.json'),
      JSON.stringify({ picBed: { current: 'github' } }),
      'utf8',
    )
  }
  await fs.mkdir(root, { recursive: true })
  const sourcePath = path.join(root, '中文 空格#1.png')
  await fs.writeFile(sourcePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))

  const assets = new ImageAssetService(paths)
  const tasks = new ImageTransferTaskStore(path.join(paths.dataRoot, 'transfer-tasks.json'))
  const { loader, uploaded } = fakeLoader(options.result ?? [{ imgUrl: 'https://example.test/images/ok.png' }])
  const service = new ImageUploadService({
    paths,
    assets,
    tasks,
    readSettings: () => settings,
    loadPicGo: loader,
    now: () => new Date(Date.UTC(2026, 10, 4, 1, 2, 3)),
  })
  return { root, paths, settings, sourcePath, assets, tasks, service, uploaded }
}

describe('ImageUploadService', () => {
  it('uploads a safe staged copy, records the remote location and keeps the source file', async () => {
    const { paths, sourcePath, service, assets, tasks, uploaded } = await setup()
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.url).toBe('https://example.test/images/ok.png')
    expect(result.remotePath).toMatch(/^images\/20261104-010203-[0-9a-f]{10}\.png$/)

    await expect(fs.access(sourcePath)).resolves.toBeUndefined()

    const stagedName = path.basename(uploaded[0][0])
    expect(stagedName).toMatch(/^20261104-010203-[0-9a-f]{10}\.png$/)
    await expect(fs.readdir(paths.stagingRoot)).resolves.toEqual([])

    const stored = await assets.list()
    expect(stored).toHaveLength(1)
    expect(stored[0].remoteLocations).toEqual([
      expect.objectContaining({ remoteUrl: 'https://example.test/images/ok.png' }),
    ])

    const taskList = await tasks.list()
    expect(taskList).toHaveLength(1)
    expect(taskList[0].status).toBe('succeeded')
    expect(taskList[0].locationId).toBeTruthy()
  })

  it('treats an empty PicGo result as failure and keeps source + task failed', async () => {
    const { sourcePath, service, tasks } = await setup({ result: [] })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'PICGO_EMPTY_RESULT' }))
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
    const taskList = await tasks.list()
    expect(taskList[0].status).toBe('failed')
    expect(taskList[0].errorCode).toBe('PICGO_EMPTY_RESULT')
    expect(taskList[0].attempt).toBe(1)
  })

  it('refuses to upload when the service is none without touching the file', async () => {
    const { sourcePath, service, uploaded } = await setup({
      settings: makeSettings({ uploadService: 'none' }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'UPLOAD_SERVICE_NONE' }))
    expect(uploaded).toHaveLength(0)
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
  })

  it('reports a missing private PicGo config instead of falling back to the global one', async () => {
    const { sourcePath, service, tasks } = await setup({ withConfig: false })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'PICGO_CONFIG_MISSING' }))
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
    expect((await tasks.list())[0].status).toBe('failed')
  })

  it('does not silently fall back to another profile when the default is disabled', async () => {
    const { sourcePath, service, uploaded } = await setup({
      settings: makeSettings({
        remoteProfiles: [
          { ...PROFILE, remoteProfileId: 'default-disabled', enabled: false },
          { ...PROFILE, remoteProfileId: 'other-enabled', enabled: true },
        ],
        defaultRemoteProfileId: 'default-disabled',
      }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'REMOTE_PROFILE_MISSING' }))
    expect(uploaded).toHaveLength(0)
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
  })

  it('reports an invalid remote directory without uploading', async () => {
    const { sourcePath, service, uploaded } = await setup({
      settings: makeSettings({
        remoteProfiles: [{ ...PROFILE, remoteDirectory: 'bad#dir' }],
        defaultRemoteProfileId: PROFILE.remoteProfileId,
      }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'REMOTE_PATH_INVALID' }))
    expect(uploaded).toHaveLength(0)
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
  })

  it('reports index write failure after a successful upload without deleting the source', async () => {
    const { sourcePath, service, assets, tasks } = await setup()
    assets.recordRemoteLocation = async () => { throw new Error('EACCES: denied') }

    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'INDEX_WRITE_FAILED' }))
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
    expect((await tasks.list())[0].status).toBe('failed')
    expect((await tasks.list())[0].errorCode).toBe('INDEX_WRITE_FAILED')
  })

  it('leaves the Typora profile path empty when APPDATA is unavailable', async () => {
    const { paths, assets } = await setup()
    const saved = process.env.APPDATA
    delete process.env.APPDATA
    try {
      const service = new ImageUploadService({
        paths,
        assets,
        readSettings: () => makeSettings(),
        loadPicGo: fakeLoader([]).loader,
      })
      expect(service.getTyporaProfilePath()).toBe('')
      await expect(service.readTyporaImagePreferences()).resolves.toEqual({
        insertMode: 'unknown',
        uploader: null,
      })
    } finally {
      if (saved === undefined) delete process.env.APPDATA
      else process.env.APPDATA = saved
    }
  })

  it('exposes the Typora upload-mode conflict without modifying any preference', async () => {
    const { root, service } = await setup({ settings: makeSettings({ uploadService: 'none' }) })
    const profilePath = path.join(root, 'profile.data')
    await fs.writeFile(
      profilePath,
      Buffer.from(JSON.stringify({ image_save_location: 'ipic', image_uploader: 'picgo-cli' }), 'utf8').toString('hex'),
      'utf8',
    )
    const conflict = await new ImageUploadService({
      paths: resolveImageDataPaths(root, { settings: makeSettings({ uploadService: 'none' }) }),
      assets: new ImageAssetService(resolveImageDataPaths(root, { settings: makeSettings({ uploadService: 'none' }) })),
      readSettings: () => makeSettings({ uploadService: 'none' }),
      loadPicGo: fakeLoader([]).loader,
      typoraProfilePath: profilePath,
    }).inspectInsertModeConflict()

    expect(conflict.hasConflict).toBe(true)
    expect(conflict.message).toContain('上传图片')
    expect(service.getTyporaProfilePath()).not.toBe(profilePath)
  })
})

describe('toPicGoImportSpecifier', () => {
  it('keeps bare package names and already-qualified specifiers', () => {
    expect(toPicGoImportSpecifier('')).toBe('picgo')
    expect(toPicGoImportSpecifier('picgo')).toBe('picgo')
    expect(toPicGoImportSpecifier('file:///opt/picgo/index.js')).toBe('file:///opt/picgo/index.js')
  })

  it('converts absolute and relative paths to file URLs', () => {
    expect(toPicGoImportSpecifier(path.resolve('node_modules', 'picgo')).startsWith('file://')).toBe(true)
    expect(toPicGoImportSpecifier('./local-picgo.js').startsWith('file://')).toBe(true)
  })
})

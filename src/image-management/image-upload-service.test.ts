import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { resolveImageSettings, type ImageSettings } from './image-settings'
import { ImageAssetService } from './image-asset-service'
import { ImageTransferTaskStore } from './image-transfer-task-store'
import { ImageUploadService, buildPicGoPackageDirs, parseNpmPrefix, toPicGoImportSpecifier, type PicGoConstructorLike } from './image-upload-service'
import type { ImageCredentialStore } from './image-credential-store'

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

function fakeLoader(result: unknown, onUpload?: (files: string[]) => void, persistToken = false): {
  loader: () => Promise<PicGoConstructorLike>
  uploaded: string[][]
  instances: Array<{ configPath?: string; tokenAtUpload: string | null; tokenAfterUpload: string | null }>
} {
  const uploaded: string[][] = []
  const instances: Array<{ configPath?: string; tokenAtUpload: string | null; tokenAfterUpload: string | null }> = []
  class FakePicGo {
    private config: Record<string, unknown> = {}
    constructor(public configPath?: string) {}
    setConfig(values: Record<string, unknown>): void {
      for (const [key, value] of Object.entries(values)) this.config[key] = value
    }
    unsetConfig(): void {
      delete this.config['picBed.github.token']
    }
    async upload(files?: string[]): Promise<unknown> {
      const list = files ?? []
      uploaded.push(list)
      onUpload?.(list)
      const record = {
        configPath: this.configPath,
        tokenAtUpload: (this.config['picBed.github.token'] as string | undefined) ?? null,
        tokenAfterUpload: null as string | null,
      }
      instances.push(record)
      record.tokenAfterUpload = (this.config['picBed.github.token'] as string | undefined) ?? null
      if (persistToken && this.configPath) {
        // 模拟第三方上传器错误地调用 saveConfig，把 Token 写回 JSON。
        await fs.writeFile(this.configPath, JSON.stringify({
          picBed: { current: 'github', github: { token: this.config['picBed.github.token'] } },
        }), 'utf8')
      }
      return result
    }
  }
  return { loader: async () => FakePicGo, uploaded, instances }
}

const SECRET = 'ghp_test_token_1234567890'

function fakeCredentials(overrides: Partial<ImageCredentialStore> = {}): ImageCredentialStore {
  return {
    backend: 'windows-dpapi',
    async status() { return { configured: true, backend: 'windows-dpapi', updatedAt: 1 } },
    async read() { return { ok: true, secret: SECRET } },
    async write() { return { ok: true } },
    async delete() { return { ok: true } },
    ...overrides,
  }
}

async function setup(options: {
  settings?: ImageSettings
  result?: unknown
  withConfig?: boolean
  credentials?: ImageCredentialStore
  githubRequest?: import('./github-connection-test').GitHubJsonRequester
  loadPicGo?: () => Promise<PicGoConstructorLike>
  persistToken?: boolean
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
  const { loader, uploaded, instances } = fakeLoader(
    options.result ?? [{ imgUrl: 'https://example.test/images/ok.png' }],
    undefined,
    options.persistToken === true,
  )
  const service = new ImageUploadService({
    paths,
    assets,
    tasks,
    credentials: options.credentials ?? fakeCredentials(),
    githubRequest: options.githubRequest,
    readSettings: () => settings,
    loadPicGo: options.loadPicGo ?? loader,
    now: () => new Date(Date.UTC(2026, 10, 4, 1, 2, 3)),
  })
  return { root, paths, settings, sourcePath, assets, tasks, service, uploaded, instances }
}

describe('ImageUploadService', () => {
  it('uploads a safe staged copy, records the remote location and keeps the source file', async () => {
    const { paths, sourcePath, service, assets, tasks, uploaded, instances } = await setup()
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result.ok).toBe(true)
    expect(instances[0].tokenAtUpload).toBe(SECRET)
    const configRaw = await fs.readFile(path.join(paths.dataRoot, 'picgo', 'config.json'), 'utf8')
    expect(configRaw).not.toContain(SECRET)
    const config = JSON.parse(configRaw) as { picBed: { github: Record<string, unknown> } }
    expect(config.picBed.github).toEqual(expect.objectContaining({
      repo: 'octocat/image-bed',
      branch: 'main',
      path: 'images/',
    }))
    expect(config.picBed.github.token).toBeUndefined()
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

  it('scrubs a token persisted by a third-party uploader after the upload', async () => {
    const { paths, sourcePath, service } = await setup({ persistToken: true })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result.ok).toBe(true)
    const raw = await fs.readFile(path.join(paths.dataRoot, 'picgo', 'config.json'), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('"token"')
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

  it('creates a token-free private PicGo config when none exists', async () => {
    const { paths, sourcePath, service } = await setup({ withConfig: false })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result.ok).toBe(true)
    const configRaw = await fs.readFile(path.join(paths.dataRoot, 'picgo', 'config.json'), 'utf8')
    expect(configRaw).not.toContain(SECRET)
    expect(configRaw).not.toContain('"token"')
    expect((JSON.parse(configRaw) as { picBed: { current: string } }).picBed.current).toBe('github')
  })

  it('refuses to upload when no credential is stored', async () => {
    const { sourcePath, service, uploaded, tasks } = await setup({
      credentials: fakeCredentials({
        async read() { return { ok: false, code: 'CREDENTIAL_NOT_FOUND' } },
      }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'CREDENTIAL_MISSING' }))
    expect(uploaded).toHaveLength(0)
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
    expect(await tasks.list()).toHaveLength(0)
  })

  it('blocks upload when the OS credential backend is unavailable', async () => {
    const { sourcePath, service, uploaded } = await setup({
      credentials: fakeCredentials({ backend: 'unavailable' }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'CREDENTIAL_UNAVAILABLE' }))
    expect(uploaded).toHaveLength(0)
  })

  it('reports a credential read failure without falling back to plaintext', async () => {
    const { sourcePath, service, uploaded } = await setup({
      credentials: fakeCredentials({
        async read() { return { ok: false, code: 'CREDENTIAL_READ_FAILED' } },
      }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'CREDENTIAL_READ_FAILED' }))
    expect(uploaded).toHaveLength(0)
  })

  it('resolves the repository default branch when the profile branch is empty', async () => {
    const { sourcePath, service, paths } = await setup({
      settings: makeSettings({
        remoteProfiles: [{ ...PROFILE, branch: '' }],
        defaultRemoteProfileId: PROFILE.remoteProfileId,
      }),
      githubRequest: async () => ({ status: 200, json: { default_branch: 'trunk' } }),
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result.ok).toBe(true)
    const configRaw = await fs.readFile(path.join(paths.dataRoot, 'picgo', 'config.json'), 'utf8')
    expect((JSON.parse(configRaw) as { picBed: { github: { branch: string } } }).picBed.github.branch)
      .toBe('trunk')
  })

  it('refuses to upload when PicGo cannot accept an in-memory token', async () => {
    const { sourcePath, service, uploaded } = await setup({
      loadPicGo: async () => class {
        async upload(): Promise<unknown> { return [] }
      },
    })
    const result = await service.uploadLocalFile({ filePath: sourcePath })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'PICGO_TOKEN_INJECTION_UNSUPPORTED',
    }))
    expect(uploaded).toHaveLength(0)
    await expect(fs.access(sourcePath)).resolves.toBeUndefined()
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

  it('never sends a remote HTTPS URL into the local-file/PicGo pipeline', async () => {
    const { service, uploaded } = await setup()
    const result = await service.uploadLocalFile({
      filePath: 'https://raw.githubusercontent.com/example/a.png',
    })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'REMOTE_URL_NOT_LOCAL_FILE',
    }))
    expect(uploaded).toHaveLength(0)
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

describe('global PicGo discovery', () => {
  it('parses npm prefix from .npmrc', () => {
    expect(parseNpmPrefix('registry=https://registry.npmjs.org/\nprefix=E:\\NodeJS\n')).toBe('E:\\NodeJS')
    expect(parseNpmPrefix('prefix = "D:/node"')).toBe('D:/node')
    expect(parseNpmPrefix('registry=https://example.test')).toBeNull()
    expect(parseNpmPrefix(null)).toBeNull()
  })

  it('prefers NPM_CONFIG_PREFIX over .npmrc and lists standard global roots', () => {
    const prefix = path.resolve('fake-npm-prefix')
    const appData = path.resolve('fake-appdata')
    const programFiles = path.resolve('fake-program-files')
    const dirs = buildPicGoPackageDirs({
      env: { NPM_CONFIG_PREFIX: prefix, APPDATA: appData, ProgramFiles: programFiles },
      homeDir: path.resolve('fake-home'),
      npmrc: `prefix=${path.resolve('ignored-prefix')}`,
    })
    expect(dirs).toEqual([
      path.join(prefix, 'node_modules', 'picgo'),
      path.join(appData, 'npm', 'node_modules', 'picgo'),
      path.join(programFiles, 'nodejs', 'node_modules', 'picgo'),
    ])
  })

  it('falls back to the .npmrc prefix when no env prefix exists', () => {
    const prefix = path.resolve('custom-node')
    const dirs = buildPicGoPackageDirs({
      env: { APPDATA: path.resolve('fake-appdata') },
      homeDir: path.resolve('fake-home'),
      npmrc: `prefix=${prefix}`,
    })
    expect(dirs[0]).toBe(path.join(prefix, 'node_modules', 'picgo'))
  })

  it('discovers node_modules next to PATH entries', () => {
    const nodeDir = path.resolve('fake-node-install')
    const dirs = buildPicGoPackageDirs({
      env: { PATH: [path.resolve('other-bin'), nodeDir].join(path.delimiter) },
      homeDir: path.resolve('fake-home'),
      npmrc: null,
    })
    expect(dirs).toContain(path.join(nodeDir, 'node_modules', 'picgo'))
  })
})

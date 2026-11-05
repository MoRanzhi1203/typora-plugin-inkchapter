import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings } from './image-settings'
import { ImageInsertionController } from './image-insertion-controller'

const REMOTE = 'https://cdn.example.test/a.png'
const LOCAL_ABS = 'C:\\Users\\me\\Pictures\\a.png'

const PROFILE = {
  remoteProfileId: 'p1', provider: 'github' as const, owner: 'o', repository: 'r', branch: 'main',
  remoteDirectory: '', urlStrategy: 'raw' as const, customUrlBase: '', credentialReferenceId: 'c', enabled: true,
}

function settings(overrides: Record<string, unknown> = {}) {
  return resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...overrides } as never)
}

function makeController(options: {
  settings: ReturnType<typeof settings>
  markdown: () => string | null
  uploadOk?: boolean
  localizeOk?: boolean
  rewriteOk?: boolean
}) {
  const state = {
    upload: vi.fn(async () => options.uploadOk === false
      ? { ok: false, message: 'UPLOAD_FAILED' }
      : { ok: true, url: 'https://cdn.example.test/uploaded.png' }),
    localize: vi.fn(async () => options.localizeOk === false
      ? { ok: false, message: 'DOWNLOAD_FAILED' }
      : { ok: true, destination: 'assets/images/local.png' }),
    rewrite: vi.fn(() => options.rewriteOk !== false),
    notify: vi.fn(),
  }
  const controller = new ImageInsertionController({
    getSettings: () => options.settings,
    getMarkdown: options.markdown,
    getDocumentPath: () => 'D:/vault/notes/doc.md',
    upload: state.upload,
    localize: state.localize,
    rewrite: state.rewrite,
    notify: state.notify,
    debounceMs: 0,
  })
  return { controller, state }
}

describe('ImageInsertionController — native result preserved by default', () => {
  it('does nothing when autoLocalizeOnInsert is off', async () => {
    let markdown = `![a](${REMOTE})\n`
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoLocalizeOnInsert: false }),
      markdown: () => markdown,
    })
    markdown = `![a](${REMOTE})\n\n![](${REMOTE})\n`
    const result = await controller.flush()
    expect(result.attempted).toBe(0)
    expect(state.localize).not.toHaveBeenCalled()
    expect(state.rewrite).not.toHaveBeenCalled()
  })

  it('does nothing when image management is disabled', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: false, autoLocalizeOnInsert: true }),
      markdown: () => markdown,
    })
    markdown = `![](${REMOTE})\n`
    const result = await controller.flush()
    expect(result.attempted).toBe(0)
    expect(state.localize).not.toHaveBeenCalled()
  })
})

describe('ImageInsertionController — document policy execution', () => {
  it('localizes a newly inserted remote image and rewrites the reference', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      markdown: () => markdown,
    })
    markdown = `![](${REMOTE})\n`
    const result = await controller.flush()
    expect(result.localized).toBe(1)
    expect(result.rewritten).toBe(1)
    expect(state.localize).toHaveBeenCalledWith(REMOTE)
    expect(state.rewrite).toHaveBeenCalledWith(REMOTE, 'assets/images/local.png')
  })

  it('uploads a newly inserted absolute local image and rewrites the reference', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoUpload: true, uploadService: 'github', remoteProfiles: [PROFILE] }),
      markdown: () => markdown,
    })
    markdown = `![a](${LOCAL_ABS})\n`
    const result = await controller.flush()
    expect(result.uploaded).toBe(1)
    expect(result.rewritten).toBe(1)
    expect(state.upload).toHaveBeenCalledWith(LOCAL_ABS)
  })

  it('processes the same insertion only once (no upload loop)', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      markdown: () => markdown,
    })
    markdown = `![](${REMOTE})\n`
    await controller.flush()
    const second = await controller.flush()
    // 第二次没有新增引用：不会重复处理。
    expect(second.attempted).toBe(0)
    expect(state.localize).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed insertion automatically', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      markdown: () => markdown,
      localizeOk: false,
    })
    markdown = `![](${REMOTE})\n`
    await controller.flush()
    const second = await controller.flush()
    // 失败项不会在下次 edit 时自动重试（用户仍保留 Typora 原生引用）。
    expect(second.attempted).toBe(0)
    expect(state.localize).toHaveBeenCalledTimes(1)
  })

  it('keeps the native reference when localization fails', async () => {
    let markdown = ''
    const { controller, state } = makeController({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      markdown: () => markdown,
      localizeOk: false,
    })
    markdown = `![](${REMOTE})\n`
    const result = await controller.flush()
    expect(result.failed).toBe(1)
    expect(state.rewrite).not.toHaveBeenCalled()
    expect(state.notify).toHaveBeenCalled()
  })

  it('never round-trips its own uploaded URL back into a download when both policies are on', async () => {
    let markdown = ''
    const state = {
      upload: vi.fn(async () => ({ ok: true, url: 'https://cdn.example.test/uploaded.png' })),
      localize: vi.fn(async () => ({ ok: true, destination: 'assets/local.png' })),
      rewrite: vi.fn((_from: string, to: string) => {
        markdown = `![a](${to})\n`
        return true
      }),
      notify: vi.fn(),
    }
    const controller = new ImageInsertionController({
      getSettings: () => settings({
        enabled: true,
        autoUpload: true,
        autoLocalizeOnInsert: true,
        referenceMode: 'local-relative',
        uploadService: 'github',
        remoteProfiles: [PROFILE],
      }),
      getMarkdown: () => markdown,
      getDocumentPath: () => 'D:/vault/notes/doc.md',
      upload: state.upload,
      localize: state.localize,
      rewrite: state.rewrite,
      debounceMs: 0,
    })
    markdown = `![a](${LOCAL_ABS})\n`
    await controller.flush()
    expect(state.upload).toHaveBeenCalledTimes(1)
    // 上传后 Markdown 变成远程 URL：这是墨章自己的产物，不能再被“本地化”抓回去。
    await controller.flush()
    expect(state.localize).not.toHaveBeenCalled()
  })

  it('resets the baseline on document switch instead of processing old content', async () => {
    let markdown = `![](${REMOTE})\n`
    let documentPath = 'D:/vault/notes/doc.md'
    const upload = vi.fn(async () => ({ ok: true, url: 'https://cdn.example.test/x.png' }))
    const localize = vi.fn(async () => ({ ok: true, destination: 'assets/x.png' }))
    const rewrite = vi.fn(() => true)
    const controller = new ImageInsertionController({
      getSettings: () => settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      getMarkdown: () => markdown,
      getDocumentPath: () => documentPath,
      upload,
      localize,
      rewrite,
      debounceMs: 0,
    })
    // 切换到另一个已包含同内容的文档：不应被当作“新插入”。
    markdown = `![](${REMOTE})\n\n![](${REMOTE})\n`
    documentPath = 'D:/vault/other/doc.md'
    controller.notifyEdit()
    const result = await controller.flush()
    expect(result.attempted).toBe(0)
    expect(localize).not.toHaveBeenCalled()
  })
})

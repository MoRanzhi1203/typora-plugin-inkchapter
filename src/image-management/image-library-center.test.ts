import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildImageLibraryCenter, IMAGE_LIBRARY_VIEWS } from './image-library-center'
import type { AssetLocationRecord, TransferTask } from './image-asset-model'
import type { ImageAssetRecord } from './image-asset-index'
import { resolveImageDataPaths } from './image-data-paths'
import { resolveImageSettings } from './image-settings'
import type { TyporaImagePreferences } from './image-upload-policy'

const roots: string[] = []

async function makePaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-center-'))
  roots.push(root)
  const settings = resolveImageSettings({ enabled: true, initialized: true })
  const paths = resolveImageDataPaths(root, {
    settings,
    env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
  })
  return { root, settings, paths }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

function makeLocation(overrides: Partial<AssetLocationRecord>): AssetLocationRecord {
  return {
    locationId: 'loc_1',
    assetId: 'img_a',
    type: 'project',
    bindingId: null,
    locator: 'assets/a.png',
    relativePath: 'assets/a.png',
    sha256: 'a'.repeat(64),
    availability: 'available',
    lastCheckedAt: null,
    remoteProfileId: null,
    remoteBranch: null,
    remotePath: null,
    remoteVersion: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  }
}

function makeAsset(locations: AssetLocationRecord[]): ImageAssetRecord {
  return {
    assetId: 'img_a',
    sha256: 'a'.repeat(64),
    filename: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 3,
    width: null,
    height: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    contentVersion: 1,
    locations,
    localPath: null,
    remoteLocations: [],
  }
}

function makeTask(overrides: Partial<TransferTask>): TransferTask {
  return {
    taskId: 'task_1',
    kind: 'upload',
    status: 'queued',
    assetId: 'img_a',
    locationId: null,
    attempt: 0,
    maxAttempts: 3,
    errorCode: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  }
}

const UPLOAD_PREFS: TyporaImagePreferences = { insertMode: 'upload', uploader: 'picgo-cli' }
const LOCAL_PREFS: TyporaImagePreferences = { insertMode: 'local', uploader: null }

describe('buildImageLibraryCenter', () => {
  it('returns the four read-only views in a stable order', async () => {
    const { settings, paths } = await makePaths()
    const views = buildImageLibraryCenter({
      documentPath: null,
      markdown: null,
      assets: [],
      tasks: [],
      settings,
      paths,
      typoraPreferences: LOCAL_PREFS,
    })
    expect(views.map(view => view.id)).toEqual(IMAGE_LIBRARY_VIEWS.map(view => view.id))
    expect(views[0].emptyMessage).toContain('打开')
  })

  it('lists document references as unindexed instead of claiming availability', async () => {
    const { settings, paths } = await makePaths()
    const views = buildImageLibraryCenter({
      documentPath: path.join(paths.dataRoot, 'doc.md'),
      markdown: '![图一](assets/a.png)\n![remote](https://cdn.example.test/b.png)\n',
      assets: [],
      tasks: [],
      settings,
      paths,
      typoraPreferences: LOCAL_PREFS,
    })
    const documentView = views[0]
    expect(documentView.rows).toHaveLength(2)
    expect(documentView.rows.every(row => row.status === 'unknown')).toBe(true)
    expect(documentView.rows[0].secondary).toContain('未索引')
  })

  it('separates local and cloud locations and reflects availability', async () => {
    const { settings, paths } = await makePaths()
    const asset = makeAsset([
      makeLocation({ locationId: 'loc_project', type: 'project' }),
      makeLocation({ locationId: 'loc_offline', type: 'offline', availability: 'missing' }),
      makeLocation({
        locationId: 'loc_github',
        type: 'github',
        locator: 'https://cdn.example.test/a.png',
        remoteProfileId: 'github-default',
        remoteBranch: 'main',
        remotePath: 'images/a.png',
      }),
    ])
    const views = buildImageLibraryCenter({
      documentPath: null,
      markdown: null,
      assets: [asset],
      tasks: [],
      settings,
      paths,
      typoraPreferences: LOCAL_PREFS,
    })
    expect(views[1].rows).toHaveLength(2)
    expect(views[1].rows.map(row => row.status)).toEqual(['available', 'missing'])
    expect(views[2].rows).toHaveLength(1)
    expect(views[2].rows[0]).toMatchObject({ primary: 'a.png', status: 'available' })
  })

  it('surfaces the upload-mode conflict and task counts in diagnostics', async () => {
    const { settings, paths } = await makePaths()
    const views = buildImageLibraryCenter({
      documentPath: null,
      markdown: null,
      assets: [],
      tasks: [
        makeTask({ taskId: 'task_1', status: 'running' }),
        makeTask({ taskId: 'task_2', status: 'failed', errorCode: 'PICGO_EMPTY_RESULT' }),
      ],
      settings,
      paths,
      typoraPreferences: UPLOAD_PREFS,
      cacheUsage: { fileCount: 2, totalBytes: 2048 },
    })
    const diagnostics = views[3]
    expect(diagnostics.summary).toContain('1 个进行中')
    expect(diagnostics.summary).toContain('1 个失败')
    expect(diagnostics.rows.some(row => row.status === 'failed' && row.primary.includes('上传图片'))).toBe(true)
    expect(diagnostics.rows.some(row => row.secondary?.includes('2 个文件'))).toBe(true)
  })

  it('does not show a conflict when the insert mode is local', async () => {
    const { settings, paths } = await makePaths()
    const views = buildImageLibraryCenter({
      documentPath: null,
      markdown: null,
      assets: [],
      tasks: [],
      settings,
      paths,
      typoraPreferences: LOCAL_PREFS,
    })
    expect(views[3].rows.some(row => row.primary.includes('冲突'))).toBe(false)
  })
})

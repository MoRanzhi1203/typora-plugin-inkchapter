import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  TYPORA_CUSTOM_UPLOADER,
  applyTyporaUploaderRuntime,
  buildInkChapterUploaderCommand,
  decodeTyporaProfileData,
  encodeTyporaProfileData,
  findNodeExecutable,
  restoreTyporaUploaderFromLatestBackup,
  switchTyporaUploaderToInkChapter,
} from './typora-uploader-switch'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-typora-profile-'))
  roots.push(root)
  const profilePath = path.join(root, 'profile.data')
  const cliPath = path.join(root, 'upload-cli.cjs')
  const settingsFile = path.join(root, 'ranzhi.inkchapter.json')
  await fs.writeFile(cliPath, '// cli', 'utf8')
  await fs.writeFile(settingsFile, '{}', 'utf8')
  await fs.writeFile(profilePath, encodeTyporaProfileData({
    version: '1.6.7',
    image_save_location: 'ipic',
    image_uploader: 'picgo-cli',
    custom_image_uploader: '',
    other: 'keep-me',
  }), 'utf8')
  const nodeExecutable = path.join(root, 'node.exe')
  await fs.writeFile(nodeExecutable, '', 'utf8')
  return { root, profilePath, cliPath, settingsFile, nodeExecutable }
}

describe('Typora profile codec', () => {
  it('round-trips hex UTF-8 JSON and keeps unrelated fields', () => {
    const profile = { version: '1.6.7', image_uploader: 'picgo-cli', other: 1 }
    const decoded = decodeTyporaProfileData(encodeTyporaProfileData(profile))
    expect(decoded).toEqual(profile)
  })

  it('builds a quoted Windows custom command', () => {
    expect(buildInkChapterUploaderCommand({
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      cliPath: 'D:\\plugins\\dist\\upload-cli.cjs',
      settingsFile: 'C:\\Users\\me\\.typora\\ranzhi.inkchapter.json',
      platform: 'win32',
    })).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "D:\\plugins\\dist\\upload-cli.cjs" '
      + '--settings "C:\\Users\\me\\.typora\\ranzhi.inkchapter.json"',
    )
  })

  it('finds node from PATH and common locations', () => {
    expect(findNodeExecutable({
      platform: 'win32',
      env: { PATH: 'C:\\bin;D:\\node', NVM_SYMLINK: 'E:\\nvm\\node' },
      exists: file => file === 'D:\\node\\node.exe',
    })).toBe('D:\\node\\node.exe')
    expect(findNodeExecutable({
      platform: 'win32',
      env: { PATH: '', NVM_SYMLINK: 'E:\\nvm\\node' },
      exists: file => file === 'E:\\nvm\\node\\node.exe',
    })).toBe('E:\\nvm\\node\\node.exe')
    expect(findNodeExecutable({
      platform: 'win32',
      env: { PATH: 'C:\\empty' },
      exists: () => false,
    })).toBeNull()
  })
})

describe('applyTyporaUploaderRuntime', () => {
  it('writes the File.option fields Typora reads for the upload button', () => {
    const option: Record<string, unknown> = { imageUploader: 'picgo-cli', customImageUploader: '' }
    expect(applyTyporaUploaderRuntime({
      uploader: TYPORA_CUSTOM_UPLOADER,
      command: '"node.exe" "upload-cli.cjs"',
      runtime: { option },
    })).toBe(true)
    expect(option).toEqual({
      imageUploader: 'custom',
      customImageUploader: '"node.exe" "upload-cli.cjs"',
    })
  })

  it('reports false when Typora runtime options are unavailable', () => {
    expect(applyTyporaUploaderRuntime({
      uploader: TYPORA_CUSTOM_UPLOADER,
      command: 'cmd',
      runtime: null,
    })).toBe(false)
  })
})

describe('switchTyporaUploaderToInkChapter', () => {
  it('backs up, switches to custom command and verifies the result', async () => {
    const h = await setup()
    const result = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: h.nodeExecutable,
      cliPath: h.cliPath,
      settingsFile: h.settingsFile,
      now: new Date('2026-11-04T00:00:00.000Z'),
    })

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeTruthy()
    await expect(fs.access(result.backupPath!)).resolves.toBeUndefined()

    const profile = decodeTyporaProfileData(await fs.readFile(h.profilePath, 'utf8'))!
    expect(profile.image_save_location).toBe('ipic')
    expect(profile.image_uploader).toBe('custom')
    expect(profile.custom_image_uploader).toContain('upload-cli.cjs')
    expect(profile.custom_image_uploader).toContain('ranzhi.inkchapter.json')
    expect(profile).not.toHaveProperty('image_uploader_command')
    expect(profile.other).toBe('keep-me')
  })

  it('is idempotent when the command is already active', async () => {
    const h = await setup()
    const first = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: h.nodeExecutable,
      cliPath: h.cliPath,
      settingsFile: h.settingsFile,
    })
    const second = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: h.nodeExecutable,
      cliPath: h.cliPath,
      settingsFile: h.settingsFile,
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.changed).toBe(false)
  })

  it('refuses when the CLI or Node executable is missing', async () => {
    const h = await setup()
    const noCli = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: h.nodeExecutable,
      cliPath: path.join(h.root, 'missing.cjs'),
      settingsFile: h.settingsFile,
    })
    expect(noCli).toEqual(expect.objectContaining({ ok: false, code: 'CLI_NOT_FOUND' }))

    const noNode = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: path.join(h.root, 'missing-node.exe'),
      cliPath: h.cliPath,
      settingsFile: h.settingsFile,
    })
    expect(noNode).toEqual(expect.objectContaining({ ok: false, code: 'NODE_NOT_FOUND' }))
  })

  it('restores the latest backup', async () => {
    const h = await setup()
    const original = await fs.readFile(h.profilePath, 'utf8')
    const switched = await switchTyporaUploaderToInkChapter({
      profilePath: h.profilePath,
      nodeExecutable: h.nodeExecutable,
      cliPath: h.cliPath,
      settingsFile: h.settingsFile,
      now: new Date('2026-11-04T00:00:00.000Z'),
    })
    expect(switched.ok).toBe(true)

    const restored = await restoreTyporaUploaderFromLatestBackup({ profilePath: h.profilePath })
    expect(restored.ok).toBe(true)
    expect(restored.state).toEqual({
      imageUploader: 'picgo-cli',
      customImageUploader: '',
      imageSaveLocation: 'ipic',
    })
    expect(await fs.readFile(h.profilePath, 'utf8')).toBe(original)
  })
})

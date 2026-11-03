import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { exportSharePackage } from './image-share-package'
import { importSharePackage, sanitizeShareFilename } from './image-share-import'
import type { FetchLike } from './image-remote-fetch'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-share-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function makeProject(): Promise<{ root: string; project: string; assets: string }> {
  const root = await makeRoot()
  const project = path.join(root, 'project')
  const assets = path.join(project, 'assets')
  await fs.mkdir(path.join(assets, 'images'), { recursive: true })
  await fs.mkdir(path.join(project, 'docs'), { recursive: true })
  await fs.writeFile(path.join(assets, 'images', 'x.png'), 'X-IMAGE')
  await fs.writeFile(path.join(project, 'docs', 'note.md'), [
    '# Share',
    '',
    '![x](../assets/images/x.png)',
    '![remote](https://example.test/r.png)',
  ].join('\n'))
  return { root, project, assets }
}

async function exportPackage(project: string, assets: string, outDir: string, zip = false) {
  return exportSharePackage({
    documentPath: path.join(project, 'docs', 'note.md'),
    projectRoot: project,
    assetRoot: assets,
    outDir,
    zip,
  })
}

describe('exportSharePackage', () => {
  it('copies assets, rewrites only the package copy and writes a portable manifest', async () => {
    const { root, project, assets } = await makeProject()
    const outDir = path.join(root, 'package')
    const result = await exportPackage(project, assets, outDir)
    expect(result.ok).toBe(true)
    expect(result.assetsCopied).toBe(1)
    expect(result.referencesRewritten).toBe(1)

    const output = await fs.readFile(path.join(outDir, 'note.md'), 'utf8')
    expect(output).toContain('![x](assets/images/x.png)')
    expect(output).toContain('![remote](https://example.test/r.png)')
    expect(await fs.readFile(path.join(project, 'docs', 'note.md'), 'utf8'))
      .toContain('![x](../assets/images/x.png)')

    const manifestText = await fs.readFile(path.join(outDir, 'inkchapter-images.json'), 'utf8')
    const manifest = JSON.parse(manifestText)
    expect(manifest.assetRoot).toBe('assets')
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.assets[0].projectRelativePath).toBe('assets/images/x.png')
    expect(manifestText).not.toContain(project)
    expect(manifestText).not.toContain(root)
  })

  it('creates a valid zip archive with document, manifest and assets', async () => {
    const { root, project, assets } = await makeProject()
    const outDir = path.join(root, 'package-zip')
    const result = await exportPackage(project, assets, outDir, true)
    expect(result.ok).toBe(true)
    expect(result.zipPath).toBeTruthy()

    const buffer = await fs.readFile(result.zipPath as string)
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50)
    const eocdOffset = buffer.length - 22
    expect(buffer.readUInt32LE(eocdOffset)).toBe(0x06054b50)
    expect(buffer.readUInt16LE(eocdOffset + 10)).toBe(3)
  })

  it('warns when local references are kept non-localized', async () => {
    const { root, project, assets } = await makeProject()
    const result = await exportSharePackage({
      documentPath: path.join(project, 'docs', 'note.md'),
      projectRoot: project,
      assetRoot: assets,
      outDir: path.join(root, 'package-raw'),
      localizeReferences: false,
    })
    expect(result.ok).toBe(true)
    expect(result.referencesRewritten).toBe(0)
    expect(result.warnings).toContain('LOCAL_REFERENCES_NOT_PORTABLE')
    expect(await fs.readFile(result.documentPath as string, 'utf8'))
      .toContain('../assets/images/x.png')
  })
})

describe('importSharePackage', () => {
  it('restores original relative directories and keeps remote URLs', async () => {
    const { root, project, assets } = await makeProject()
    const outDir = path.join(root, 'package')
    await exportPackage(project, assets, outDir)

    const targetProject = path.join(root, 'receiver')
    const targetAssets = path.join(targetProject, 'assets')
    const result = await importSharePackage({
      packageDir: outDir,
      targetProjectRoot: targetProject,
      targetAssetRoot: targetAssets,
    })
    expect(result.ok).toBe(true)
    expect(result.manifestUsed).toBe(true)
    expect(result.copied).toBe(1)
    expect(result.remoteKept).toBe(1)
    expect(result.documentPath).toBe(path.join(targetProject, 'note.md'))

    const output = await fs.readFile(result.documentPath as string, 'utf8')
    expect(output).toContain('![x](assets/images/x.png)')
    expect(output).toContain('![remote](https://example.test/r.png)')
    expect(await fs.readFile(path.join(targetAssets, 'images', 'x.png'), 'utf8')).toBe('X-IMAGE')
    const localAsset = result.assets.find(asset => asset.sha256)
    expect(localAsset?.originalFilename).toBe('x.png')
    const remoteAsset = result.assets.find(asset => asset.sha256 === null)
    expect(remoteAsset?.originalFilename).toBeNull()
    expect(remoteAsset?.locations[0].ownership).toBe('sender')
    expect(remoteAsset?.locations[0].deletable).toBe(false)
  })

  it('downloads remote images and uses only the real uploaded URL', async () => {
    const root = await makeRoot()
    const packageDir = path.join(root, 'package')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.writeFile(path.join(packageDir, 'note.md'), '![r](https://example.test/r.png)\n')

    const fetchImpl: FetchLike = async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    const targetProject = path.join(root, 'receiver')
    const result = await importSharePackage({
      packageDir,
      targetProjectRoot: targetProject,
      targetAssetRoot: path.join(targetProject, 'assets'),
      downloadRemote: true,
      fetchImpl,
      uploadImpl: async () => 'https://cdn.example.test/real-new-url.png',
    })
    expect(result.ok).toBe(true)
    expect(result.downloaded).toBe(1)
    expect(result.uploaded).toBe(1)
    expect(result.manifestUsed).toBe(false)

    const output = await fs.readFile(result.documentPath as string, 'utf8')
    expect(output).toContain('![r](https://cdn.example.test/real-new-url.png)')
    const asset = result.assets[0]
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(asset.locations.map(location => location.type).sort()).toEqual(['github', 'github', 'local'])
    expect(asset.locations.find(location => location.type === 'github' && location.ownership === 'sender')?.deletable)
      .toBe(false)
    expect(asset.locations.find(location => location.type === 'github' && location.ownership === 'receiver')?.url)
      .toBe('https://cdn.example.test/real-new-url.png')
  })

  it('keeps a local reference and reports pending upload when no uploader is configured', async () => {
    const root = await makeRoot()
    const packageDir = path.join(root, 'package')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.writeFile(path.join(packageDir, 'note.md'), '![r](https://example.test/r.png)\n')

    const result = await importSharePackage({
      packageDir,
      targetProjectRoot: path.join(root, 'receiver'),
      targetAssetRoot: path.join(root, 'receiver', 'assets'),
      downloadRemote: true,
      fetchImpl: async () => new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.pendingUpload).toBe(1)
    expect(await fs.readFile(result.documentPath as string, 'utf8')).toContain('![r](assets/r.png)')
  })

  it('refuses to overwrite an existing target document by default', async () => {
    const root = await makeRoot()
    const packageDir = path.join(root, 'package')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.writeFile(path.join(packageDir, 'note.md'), '# shared\n')
    const targetProject = path.join(root, 'receiver')
    await fs.mkdir(targetProject, { recursive: true })
    await fs.writeFile(path.join(targetProject, 'note.md'), '# existing\n')

    const result = await importSharePackage({
      packageDir,
      targetProjectRoot: targetProject,
      targetAssetRoot: path.join(targetProject, 'assets'),
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('TARGET_DOCUMENT_EXISTS')
    expect(await fs.readFile(path.join(targetProject, 'note.md'), 'utf8')).toBe('# existing\n')
  })
})

describe('sanitizeShareFilename', () => {
  it('strips traversal, forbidden characters and Windows reserved names', () => {
    expect(sanitizeShareFilename('../../CON.png')).toBe('_CON.png')
    expect(sanitizeShareFilename('a<b>:c?.png')).toBe('a_b__c_.png')
    expect(sanitizeShareFilename('name. ')).toBe('name')
    expect(sanitizeShareFilename('', 'image')).toBe('image')
  })

  it('limits very long names while keeping the extension', () => {
    const name = sanitizeShareFilename(`${'a'.repeat(200)}.png`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.png')).toBe(true)
  })
})

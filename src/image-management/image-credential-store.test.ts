import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WindowsDpapiCredentialStore,
  isValidCredentialReferenceId,
  migrateLegacyPicGoToken,
  resolveCredentialReferenceId,
  type DpapiRunner,
} from './image-credential-store'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-cred-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

/** 纯内存假 DPAPI：密文前缀 enc: + base64，确保落盘内容不含明文。 */
function fakeRunner(overrides: Partial<DpapiRunner> = {}): DpapiRunner {
  return {
    async protect(secret: string) { return `enc:${Buffer.from(secret, 'utf8').toString('base64')}` },
    async unprotect(cipher: string) {
      if (!cipher.startsWith('enc:')) throw new Error('bad cipher')
      return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
    },
    ...overrides,
  }
}

describe('credential reference ids', () => {
  it('accepts only safe identifiers', () => {
    expect(isValidCredentialReferenceId('image.github.default')).toBe(true)
    expect(isValidCredentialReferenceId('../escape')).toBe(false)
    expect(isValidCredentialReferenceId('a/b')).toBe(false)
    expect(isValidCredentialReferenceId('')).toBe(false)
  })

  it('keeps an existing safe id and derives one when empty or unsafe', () => {
    expect(resolveCredentialReferenceId({
      remoteProfileId: 'github-default',
      credentialReferenceId: 'image.github.default',
    })).toBe('image.github.default')

    expect(resolveCredentialReferenceId({
      remoteProfileId: 'github:work/team',
      credentialReferenceId: '',
    })).toBe('inkchapter.github.github-work-team')

    expect(resolveCredentialReferenceId({
      remoteProfileId: '',
      credentialReferenceId: '../bad',
    })).toBe('inkchapter.github.default')
  })
})

describe('WindowsDpapiCredentialStore', () => {
  it('stores ciphertext only and reads the secret back', async () => {
    const root = await makeRoot()
    const store = new WindowsDpapiCredentialStore({ rootDir: root, runner: fakeRunner(), platform: 'win32' })

    await expect(store.write('image.github.default', 'ghp_secret_value')).resolves.toEqual({ ok: true })
    const files = await fs.readdir(root)
    expect(files).toEqual(['image.github.default.dpapi'])
    const raw = await fs.readFile(path.join(root, files[0]), 'utf8')
    expect(raw.startsWith('enc:')).toBe(true)
    expect(raw).not.toContain('ghp_secret_value')

    await expect(store.read('image.github.default')).resolves.toEqual({
      ok: true,
      secret: 'ghp_secret_value',
    })
    const status = await store.status('image.github.default')
    expect(status.configured).toBe(true)
    expect(status.backend).toBe('windows-dpapi')
    expect(status.updatedAt).toBeGreaterThan(0)
  })

  it('reports missing and failed reads with stable codes', async () => {
    const root = await makeRoot()
    const store = new WindowsDpapiCredentialStore({ rootDir: root, runner: fakeRunner(), platform: 'win32' })
    await expect(store.read('image.github.default')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_NOT_FOUND',
    })

    await store.write('image.github.default', 'value')
    const broken = new WindowsDpapiCredentialStore({
      rootDir: root,
      runner: fakeRunner({ async unprotect() { throw new Error('DPAPI_FAILED') } }),
      platform: 'win32',
    })
    await expect(broken.read('image.github.default')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_READ_FAILED',
    })
  })

  it('rejects invalid references, empty secrets and unavailable backends', async () => {
    const root = await makeRoot()
    const store = new WindowsDpapiCredentialStore({ rootDir: root, runner: fakeRunner(), platform: 'win32' })
    await expect(store.write('../escape', 'x')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_REFERENCE_INVALID',
    })
    await expect(store.write('image.github.default', '   ')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_EMPTY',
    })

    const unavailable = new WindowsDpapiCredentialStore({
      rootDir: root,
      runner: fakeRunner(),
      platform: 'linux',
    })
    await expect(unavailable.read('image.github.default')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_BACKEND_UNAVAILABLE',
    })
    await expect(unavailable.write('image.github.default', 'x')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_BACKEND_UNAVAILABLE',
    })
  })

  it('maps protector failures to a write error without echoing the secret', async () => {
    const root = await makeRoot()
    const store = new WindowsDpapiCredentialStore({
      rootDir: root,
      runner: fakeRunner({ async protect() { throw new Error('DPAPI_PROTECT_FAILED') } }),
      platform: 'win32',
    })
    const result = await store.write('image.github.default', 'super-secret-token')
    expect(result).toEqual({ ok: false, code: 'CREDENTIAL_WRITE_FAILED' })
    expect(JSON.stringify(result)).not.toContain('super-secret-token')
    await expect(fs.readdir(root)).resolves.toEqual([])
  })

  it('deletes the stored ciphertext', async () => {
    const root = await makeRoot()
    const store = new WindowsDpapiCredentialStore({ rootDir: root, runner: fakeRunner(), platform: 'win32' })
    await store.write('image.github.default', 'value')
    await expect(store.delete('image.github.default')).resolves.toEqual({ ok: true })
    await expect(store.read('image.github.default')).resolves.toEqual({
      ok: false,
      code: 'CREDENTIAL_NOT_FOUND',
    })
  })
})

describe('legacy PicGo token migration', () => {
  it('moves a plaintext token into the store and removes it from JSON', async () => {
    const root = await makeRoot()
    const configPath = path.join(root, 'picgo', 'config.json')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify({
      picBed: {
        current: 'github',
        github: { repo: 'octocat/images', branch: 'main', token: 'ghp_legacy_secret', path: 'images/' },
      },
      picgoPlugins: {},
    }), 'utf8')

    const store = new WindowsDpapiCredentialStore({ rootDir: path.join(root, 'secrets'), runner: fakeRunner(), platform: 'win32' })
    const result = await migrateLegacyPicGoToken({
      configPath,
      store,
      referenceId: 'image.github.default',
    })

    expect(result).toBe('migrated')
    await expect(store.read('image.github.default')).resolves.toEqual({
      ok: true,
      secret: 'ghp_legacy_secret',
    })
    const raw = await fs.readFile(configPath, 'utf8')
    expect(raw).not.toContain('ghp_legacy_secret')
    expect(raw).not.toContain('"token"')
  })

  it('removes plaintext even when the secure store cannot write', async () => {
    const root = await makeRoot()
    const configPath = path.join(root, 'picgo', 'config.json')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify({
      picBed: { github: { token: 'ghp_legacy_secret' } },
    }), 'utf8')

    const store = new WindowsDpapiCredentialStore({
      rootDir: path.join(root, 'secrets'),
      runner: fakeRunner({ async protect() { throw new Error('DPAPI_FAILED') } }),
      platform: 'win32',
    })
    const result = await migrateLegacyPicGoToken({
      configPath,
      store,
      referenceId: 'image.github.default',
    })

    expect(result).toBe('removed-without-store')
    const raw = await fs.readFile(configPath, 'utf8')
    expect(raw).not.toContain('ghp_legacy_secret')
  })

  it('does nothing when the config has no plaintext token', async () => {
    const root = await makeRoot()
    const configPath = path.join(root, 'picgo', 'config.json')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify({ picBed: { github: { repo: 'a/b' } } }), 'utf8')
    const store = new WindowsDpapiCredentialStore({ rootDir: path.join(root, 'secrets'), runner: fakeRunner(), platform: 'win32' })

    await expect(migrateLegacyPicGoToken({
      configPath,
      store,
      referenceId: 'image.github.default',
    })).resolves.toBe('none')
  })
})

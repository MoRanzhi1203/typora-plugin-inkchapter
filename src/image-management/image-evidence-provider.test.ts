import { describe, expect, it, vi } from 'vitest'
import {
  createImageEvidenceProvider,
  type ImageEvidenceProviderDeps,
} from './image-evidence-provider'

function deps(overrides: Partial<ImageEvidenceProviderDeps> = {}): ImageEvidenceProviderDeps {
  return {
    sha256File: vi.fn(async () => ({ sha256: 'a'.repeat(64), sizeBytes: 123 })),
    readHeader: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    sniff: vi.fn((bytes: Uint8Array) => bytes[0] === 0x89 ? 'png' : null),
    now: () => 1000,
    ...overrides,
  }
}

describe('image evidence provider — async cache / sync snapshot', () => {
  it('returns UNKNOWN before warm and never performs IO in getSync', async () => {
    const d = deps()
    const p = createImageEvidenceProvider(d)
    expect(p.getSync('C:\\vault\\a.png')).toBeNull()
    expect(d.sha256File).not.toHaveBeenCalled()

    await p.warm('C:\\vault\\a.png')
    expect(p.getSync('C:\\vault\\a.png')).toEqual({
      path: 'C:\\vault\\a.png',
      format: 'png',
      sha256: 'a'.repeat(64),
      sizeBytes: 123,
    })
    const calls = (d.sha256File as ReturnType<typeof vi.fn>).mock.calls.length
    p.getSync('C:\\vault\\a.png')
    expect((d.sha256File as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('reuses a warm entry without hashing again', async () => {
    const d = deps()
    const p = createImageEvidenceProvider(d)
    await p.warm('C:\\vault\\a.png')
    await p.warm('C:\\vault\\a.png')
    expect(d.sha256File).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates concurrent warm calls', async () => {
    const d = deps()
    const p = createImageEvidenceProvider(d)
    const [a, b] = await Promise.all([p.warm('C:\\vault\\a.png'), p.warm('C:\\vault\\a.png')])
    expect(a).toBe(b)
    expect(d.sha256File).toHaveBeenCalledTimes(1)
  })

  it('force re-hashes and updates the sync snapshot', async () => {
    const sha = vi.fn()
      .mockResolvedValueOnce({ sha256: 'a'.repeat(64), sizeBytes: 1 })
      .mockResolvedValueOnce({ sha256: 'b'.repeat(64), sizeBytes: 2 })
    const p = createImageEvidenceProvider(deps({ sha256File: sha }))
    await p.warm('C:\\vault\\a.png')
    expect(p.getSync('C:\\vault\\a.png')?.sha256).toBe('a'.repeat(64))
    await p.warm('C:\\vault\\a.png', { force: true })
    expect(p.getSync('C:\\vault\\a.png')?.sha256).toBe('b'.repeat(64))
  })

  it('a failed read is ERROR, exposes no sync evidence, and is not retried in a burst', async () => {
    const d = deps({ sha256File: vi.fn(async () => { throw new Error('EACCES') }) })
    const p = createImageEvidenceProvider(d)
    const first = await p.warm('C:\\vault\\locked.png')
    expect(first.state).toBe('ERROR')
    expect(p.getSync('C:\\vault\\locked.png')).toBeNull()
    await p.warm('C:\\vault\\locked.png')
    expect(d.sha256File).toHaveBeenCalledTimes(1)
  })

  it('unknown byte format is READY with format=null, not a guessed extension', async () => {
    const p = createImageEvidenceProvider(deps({
      readHeader: async () => new Uint8Array([0x00]),
      sniff: () => null,
    }))
    await p.warm('C:\\vault\\x.bin')
    expect(p.getSync('C:\\vault\\x.bin')?.format).toBeNull()
  })

  it('invalidate drops one path or the whole cache', async () => {
    const p = createImageEvidenceProvider(deps())
    await p.warm('C:\\vault\\a.png')
    await p.warm('C:\\vault\\b.png')
    p.invalidate('C:\\vault\\a.png')
    expect(p.getSync('C:\\vault\\a.png')).toBeNull()
    expect(p.getSync('C:\\vault\\b.png')).not.toBeNull()
    p.invalidate()
    expect(p.getSync('C:\\vault\\b.png')).toBeNull()
  })
})

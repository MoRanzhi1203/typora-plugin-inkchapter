import { describe, expect, it, vi } from 'vitest'
import { createImageEvidenceRuntime } from './image-evidence-runtime'
import type { ImageEvidence, ImageEvidenceProvider } from './image-evidence-provider'

function fakeProvider(): ImageEvidenceProvider & { invalidate: ReturnType<typeof vi.fn> } {
  const ready = (path: string): ImageEvidence => ({
    path, state: 'READY', format: 'png', sha256: 'a'.repeat(64), sizeBytes: 1, error: null, loadedAt: 1,
  })
  const cache = new Map<string, ImageEvidence>()
  const provider = {
    async warm(path: string) {
      if (!cache.has(path)) cache.set(path, ready(path))
      return cache.get(path)!
    },
    getSync(path: string) {
      const e = cache.get(path)
      return e && e.state === 'READY' ? { path, format: e.format, sha256: e.sha256!, sizeBytes: e.sizeBytes! } : null
    },
    invalidate: vi.fn((path?: string) => { if (path) cache.delete(path); else cache.clear() }),
    list: () => [...cache.values()],
  }
  return provider
}

describe('image evidence runtime — document isolation', () => {
  it('does not expose another document’s warmed path', async () => {
    const provider = fakeProvider()
    const runtime = createImageEvidenceRuntime(provider)
    runtime.setDocument('doc-a')
    expect(await runtime.warm(['C:\\vault\\a.png'])).toBe(true)
    expect(runtime.get('C:\\vault\\a.png')?.format).toBe('png')

    runtime.setDocument('doc-b')
    expect(runtime.get('C:\\vault\\a.png')).toBeNull()
    expect(await runtime.warm(['C:\\vault\\a.png'])).toBe(true)
    expect(runtime.get('C:\\vault\\a.png')?.format).toBe('png')

    runtime.setDocument('doc-a')
    expect(runtime.get('C:\\vault\\a.png')?.format).toBe('png')
  })

  it('returns false when the path was already warmed for the current doc', async () => {
    const runtime = createImageEvidenceRuntime(fakeProvider())
    runtime.setDocument('doc-a')
    expect(await runtime.warm(['C:\\vault\\a.png'])).toBe(true)
    expect(await runtime.warm(['C:\\vault\\a.png'])).toBe(false)
  })

  it('invalidates one path across scopes', async () => {
    const provider = fakeProvider()
    const runtime = createImageEvidenceRuntime(provider)
    runtime.setDocument('doc-a')
    await runtime.warm(['C:\\vault\\a.png'])
    runtime.setDocument('doc-b')
    await runtime.warm(['C:\\vault\\a.png'])
    runtime.invalidatePath('C:\\vault\\a.png')
    expect(runtime.get('C:\\vault\\a.png')).toBeNull()
    runtime.setDocument('doc-a')
    expect(runtime.get('C:\\vault\\a.png')).toBeNull()
    expect(provider.invalidate).toHaveBeenCalledWith('C:\\vault\\a.png')
  })

  it('invalidates only the active document scope', async () => {
    const runtime = createImageEvidenceRuntime(fakeProvider())
    runtime.setDocument('doc-a')
    await runtime.warm(['C:\\vault\\a.png'])
    runtime.setDocument('doc-b')
    await runtime.warm(['C:\\vault\\b.png'])
    runtime.invalidateDocument()
    expect(runtime.get('C:\\vault\\b.png')).toBeNull()
    runtime.setDocument('doc-a')
    expect(runtime.get('C:\\vault\\a.png')?.format).toBe('png')
  })

  it('is a no-op without an active document', async () => {
    const runtime = createImageEvidenceRuntime(fakeProvider())
    expect(await runtime.warm(['C:\\vault\\a.png'])).toBe(false)
    expect(runtime.get('C:\\vault\\a.png')).toBeNull()
    expect(runtime.activeDocumentKey()).toBeNull()
  })
})

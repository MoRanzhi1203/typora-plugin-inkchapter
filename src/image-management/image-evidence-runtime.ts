/**
 * Document-scoped image-evidence runtime.
 *
 * The async provider caches byte evidence globally by absolute path; this
 * coordinator is the ONLY layer that decides which evidence belongs to the
 * active document. A path warmed for document A is never exposed to document B,
 * even though the underlying provider may already hold its digest.
 *
 * No upload/download; no synchronous IO.
 */
import type { ImageEvidenceProvider, ImageEvidenceSnapshotEntry } from './image-evidence-provider'

export interface ImageEvidenceRuntime {
  /** Switch the active document scope. Does not discard other docs' paths. */
  setDocument(documentKey: string | null): void
  /** Warm absolute paths for the CURRENT document. Returns true if new READY evidence appeared. */
  warm(paths: readonly string[]): Promise<boolean>
  /** Sync, document-isolated snapshot for diagnostics. */
  get(path: string): ImageEvidenceSnapshotEntry | null
  /** Invalidate one path (image rewritten) or the whole current document. */
  invalidatePath(path: string): void
  invalidateDocument(): void
  /** Test/audit only. */
  activeDocumentKey(): string | null
}

export function createImageEvidenceRuntime(provider: ImageEvidenceProvider): ImageEvidenceRuntime {
  const pathsByDocument = new Map<string, Set<string>>()
  let documentKey: string | null = null
  let generation = 0

  function currentSet(): Set<string> | null {
    if (documentKey == null || documentKey === '') return null
    let set = pathsByDocument.get(documentKey)
    if (!set) {
      set = new Set()
      pathsByDocument.set(documentKey, set)
    }
    return set
  }

  return {
    setDocument(next) {
      documentKey = next
      generation++
    },

    async warm(paths) {
      const scope = currentSet()
      if (scope == null) return false
      const myGeneration = generation
      let appeared = false
      await Promise.all(paths.map(async pathValue => {
        const isNew = !scope.has(pathValue)
        scope.add(pathValue)
        const evidence = await provider.warm(pathValue)
        if (myGeneration !== generation) return
        if (isNew && evidence.state === 'READY') appeared = true
      }))
      return appeared
    },

    get(pathValue) {
      const scope = currentSet()
      if (scope == null || !scope.has(pathValue)) return null
      return provider.getSync(pathValue)
    },

    invalidatePath(pathValue) {
      provider.invalidate(pathValue)
      for (const scope of pathsByDocument.values()) scope.delete(pathValue)
    },

    invalidateDocument() {
      const scope = currentSet()
      if (scope == null) return
      for (const pathValue of scope) provider.invalidate(pathValue)
      scope.clear()
    },

    activeDocumentKey() {
      return documentKey
    },
  }
}

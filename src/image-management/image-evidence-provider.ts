/**
 * Async image evidence provider — the ONE async/sync boundary for image facts.
 *
 * Architecture:
 *   async warm(path) ──► evidence cache (sha256 + size + format)
 *   diagnostics compute (sync) ──► getSync(path) (NO file IO, NO hashing)
 *
 * This module NEVER uploads or downloads. It reuses the existing
 * `sha256File` implementation and the existing `sniffImageFormat` byte sniffer.
 * A cache miss is `null` (UNKNOWN for diagnostics), never a fabricated fact.
 */
import { promises as fsp } from 'node:fs'
import { sha256File } from './image-asset-index'
import { sniffImageFormat } from './image-download-service'

export type ImageEvidenceState = 'READY' | 'ERROR'

export interface ImageEvidence {
  /** Absolute local path. */
  path: string
  state: ImageEvidenceState
  /** Lowercase image format from byte sniffing; null when unrecognised. */
  format: string | null
  sha256: string | null
  sizeBytes: number | null
  /** Stable error code when state = ERROR. */
  error: string | null
  loadedAt: number
}

/** The only shape diagnostics may read synchronously. */
export interface ImageEvidenceSnapshotEntry {
  path: string
  format: string | null
  sha256: string
  sizeBytes: number
}

export interface ImageEvidenceProviderDeps {
  sha256File(path: string): Promise<{ sha256: string; sizeBytes: number }>
  readHeader(path: string, bytes: number): Promise<Uint8Array | null>
  sniff(bytes: Uint8Array): string | null
  now?(): number
}

export interface ImageEvidenceProvider {
  /** Load or reuse the evidence for this path. Concurrent calls are de-duped. */
  warm(path: string, options?: { force?: boolean }): Promise<ImageEvidence>
  /** Synchronous, IO-free snapshot. null = UNKNOWN / not warmed / failed. */
  getSync(path: string): ImageEvidenceSnapshotEntry | null
  /** Drop one path (e.g. after a write) or all paths. */
  invalidate(path?: string): void
  /** Debug/audit only — never used by diagnostics. */
  list(): readonly ImageEvidence[]
}

const HEADER_BYTES = 512

function toAbsoluteKey(pathValue: string): string {
  // Paths reaching this provider are already resolved by the caller. Keeping
  // the string untouched avoids a second path authority and keeps cache keys
  // stable on Windows (case/sep preserved).
  return pathValue
}

export function createImageEvidenceProvider(deps: ImageEvidenceProviderDeps): ImageEvidenceProvider {
  const cache = new Map<string, ImageEvidence>()
  const inFlight = new Map<string, Promise<ImageEvidence>>()
  const now = deps.now ?? (() => Date.now())

  async function load(pathValue: string, force: boolean): Promise<ImageEvidence> {
    const key = toAbsoluteKey(pathValue)
    if (!force) {
      const cached = cache.get(key)
      if (cached && cached.state === 'READY') return cached
    }
    try {
      const digest = await deps.sha256File(key)
      const header = await deps.readHeader(key, HEADER_BYTES)
      const format = header == null ? null : deps.sniff(header)
      const evidence: ImageEvidence = {
        path: key,
        state: 'READY',
        format,
        sha256: digest.sha256,
        sizeBytes: digest.sizeBytes,
        error: null,
        loadedAt: now(),
      }
      cache.set(key, evidence)
      return evidence
    } catch (error) {
      const evidence: ImageEvidence = {
        path: key,
        state: 'ERROR',
        format: null,
        sha256: null,
        sizeBytes: null,
        error: error instanceof Error ? error.message : String(error),
        loadedAt: now(),
      }
      // Failed evidence is cached so a diagnostics burst does not retry IO.
      cache.set(key, evidence)
      return evidence
    }
  }

  return {
    async warm(pathValue, options) {
      const key = toAbsoluteKey(pathValue)
      const force = options?.force === true
      if (!force) {
        const cached = cache.get(key)
        if (cached) return cached
        const pending = inFlight.get(key)
        if (pending) return pending
      }
      const promise = load(key, force).finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      })
      inFlight.set(key, promise)
      return promise
    },

    getSync(pathValue) {
      const evidence = cache.get(toAbsoluteKey(pathValue))
      if (!evidence || evidence.state !== 'READY' || evidence.sha256 == null) return null
      return {
        path: evidence.path,
        format: evidence.format,
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes ?? 0,
      }
    },

    invalidate(pathValue) {
      if (pathValue == null) {
        cache.clear()
        return
      }
      cache.delete(toAbsoluteKey(pathValue))
    },

    list() {
      return [...cache.values()]
    },
  }
}

/** Production adapter — reuses the existing image-management primitives only. */
export function createNodeImageEvidenceProvider(): ImageEvidenceProvider {
  return createImageEvidenceProvider({
    sha256File,
    async readHeader(pathValue, bytes) {
      const handle = await fsp.open(pathValue, 'r')
      try {
        const buffer = Buffer.alloc(bytes)
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      } finally {
        await handle.close()
      }
    },
    sniff: sniffImageFormat,
  })
}

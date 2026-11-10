/**
 * Cross-file anchor resolution — the ONE three-state contract.
 *
 * The product rule is: a link anchor may only be reported MISSING when a
 * canonical anchor authority has POSITIVELY enumerated the target document's
 * anchors and the requested anchor is absent. When the target file cannot be
 * read, the target file is missing, or no canonical slug authority exists, the
 * verdict MUST be UNKNOWN. UNKNOWN is never coerced to MISSING.
 *
 * This module is deliberately pure: file IO and the canonical anchor provider
 * are injected, so tests and the runtime can share the exact same decision
 * table without importing Node fs into the renderer core.
 */
import * as path from 'node:path'

export type CrossFileAnchorVerdict = 'EXISTS' | 'MISSING' | 'UNKNOWN'

export type CrossFileAnchorReason =
  | 'ANCHOR_FOUND'
  | 'ANCHOR_NOT_FOUND'
  | 'NO_CANONICAL_ANCHOR_AUTHORITY'
  | 'TARGET_FILE_MISSING'
  | 'TARGET_FILE_UNREADABLE'
  | 'NOT_A_CROSS_FILE_ANCHOR'
  | 'INVALID_ANCHOR'

export interface CrossFileAnchorTarget {
  file: string
  anchor: string
}

export interface CrossFileAnchorResult {
  verdict: CrossFileAnchorVerdict
  reason: CrossFileAnchorReason
  target: CrossFileAnchorTarget | null
  resolvedPath: string | null
}

/** True for relative local destinations; absolute / URL / protocol paths are out of scope. */
export function isRelativeLocalDestination(destination: string): boolean {
  const d = destination.trim()
  if (d === '') return false
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/|\\)/.test(d)) return false
  if (/^[a-zA-Z]:[\\/]/.test(d)) return false
  return true
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/**
 * Parse `path/to/file.md#anchor` (or `./file.md#anchor`). Same-file `#anchor`
 * links and URLs are not cross-file anchors → null.
 */
export function parseCrossFileAnchor(destination: string | null | undefined): CrossFileAnchorTarget | null {
  const raw = String(destination ?? '').trim()
  if (raw === '' || !isRelativeLocalDestination(raw)) return null
  const hash = raw.indexOf('#')
  if (hash <= 0 || hash === raw.length - 1) return null
  const fileRaw = raw.slice(0, hash)
  const anchorRaw = raw.slice(hash + 1)
  const file = safeDecode(fileRaw)
  const anchor = safeDecode(anchorRaw).trim()
  if (file === '' || anchor === '') return null
  return { file, anchor }
}

export interface CrossFileAnchorResolverInput {
  /** Directory that relative destinations resolve against (active document dir). */
  baseDir: string | null
  destination: string
  /** Injected local existence check (must NOT throw for text reasons). */
  fileExists: (absolutePath: string) => boolean
  /** Injected text reader; null = unreadable. */
  readFile: (absolutePath: string) => string | null
  /**
   * The canonical anchor authority. MUST return null when the product does not
   * have a canonical slug/id authority for this target. Returning [] is a
   * POSITIVE claim that the document has no anchors, so it may yield MISSING.
   */
  canonicalAnchors?: (absolutePath: string, content: string) => readonly string[] | null
}

export function resolveCrossFileAnchor(input: CrossFileAnchorResolverInput): CrossFileAnchorResult {
  const target = parseCrossFileAnchor(input.destination)
  if (!target) {
    return { verdict: 'UNKNOWN', reason: 'NOT_A_CROSS_FILE_ANCHOR', target: null, resolvedPath: null }
  }
  if (!input.baseDir) {
    return { verdict: 'UNKNOWN', reason: 'TARGET_FILE_UNREADABLE', target, resolvedPath: null }
  }
  let resolvedPath: string
  try {
    resolvedPath = path.resolve(input.baseDir, target.file)
  } catch {
    return { verdict: 'UNKNOWN', reason: 'TARGET_FILE_UNREADABLE', target, resolvedPath: null }
  }
  // A missing target file is owned by the file-existence rule. The anchor rule
  // must stay UNKNOWN here, otherwise a missing file becomes a duplicate anchor
  // diagnostic and loses its file-level root cause.
  if (!input.fileExists(resolvedPath)) {
    return { verdict: 'UNKNOWN', reason: 'TARGET_FILE_MISSING', target, resolvedPath }
  }
  const content = input.readFile(resolvedPath)
  if (content == null) {
    return { verdict: 'UNKNOWN', reason: 'TARGET_FILE_UNREADABLE', target, resolvedPath }
  }
  const anchors = input.canonicalAnchors?.(resolvedPath, content)
  if (anchors == null) {
    return { verdict: 'UNKNOWN', reason: 'NO_CANONICAL_ANCHOR_AUTHORITY', target, resolvedPath }
  }
  const wanted = target.anchor
  const has = anchors.some(a => a === wanted || safeDecode(a) === wanted)
  return has
    ? { verdict: 'EXISTS', reason: 'ANCHOR_FOUND', target, resolvedPath }
    : { verdict: 'MISSING', reason: 'ANCHOR_NOT_FOUND', target, resolvedPath }
}

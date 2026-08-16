/**
 * Image Path Codec — classify image source paths and decode them for display.
 *
 * Purpose: Typora stores local image paths as percent-encoded URIs (e.g.
 * `ChatGPT%20Image%20%E5%B9%B4...`). The plugin must show a human-readable
 * path in its own UI/probe WITHOUT rewriting storage, WITHOUT double-encoding,
 * and WITHOUT touching data URLs / http(s) storage.
 *
 * Invariants:
 * - `storage` stays the canonical raw URI (no rewrite by default).
 * - `display` is a best-effort human-readable decode, safe-falling back to raw.
 * - data URLs are never decoded.
 */

export type ImagePathKind =
  | 'HTTP_URL'
  | 'HTTPS_URL'
  | 'DATA_URL'
  | 'FILE_URL'
  | 'LOCAL_RELATIVE_PATH'
  | 'LOCAL_ABSOLUTE_WINDOWS_PATH'
  | 'UNKNOWN'

export interface ImagePathInfo {
  kind: ImagePathKind
  raw: string
  display: string
  storage: string
  decodeSucceeded: boolean
}

/** Classify an image source into its path kind. */
export function classifyImagePath(raw: string): ImagePathKind {
  const s = (raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  const lower = s.toLowerCase()
  if (lower.startsWith('data:')) return 'DATA_URL'
  if (lower.startsWith('https://')) return 'HTTPS_URL'
  if (lower.startsWith('http://')) return 'HTTP_URL'
  if (lower.startsWith('file://')) return 'FILE_URL'
  if (/^[a-zA-Z]:[\\/]/.test(s)) return 'LOCAL_ABSOLUTE_WINDOWS_PATH'
  return 'LOCAL_RELATIVE_PATH'
}

/**
 * Decode a path for DISPLAY only. Data URLs are returned untouched; all other
 * kinds are decoded one level with safe fallback on invalid percent sequences.
 */
export function decodeImagePathForDisplay(raw: string): string {
  const kind = classifyImagePath(raw)
  if (kind === 'DATA_URL') return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Full codec info for a raw image source (diagnostics + probe). */
export function imagePathInfo(raw: string): ImagePathInfo {
  const kind = classifyImagePath(raw)
  const decoded = decodeImagePathForDisplay(raw)
  return {
    kind,
    raw,
    display: decoded,
    storage: raw,
    decodeSucceeded: decoded !== raw,
  }
}

/** Result of normalizing a local image markdown destination. */
export interface LocalPathNormalizeResult {
  kind: ImagePathKind
  raw: string
  decoded: string
  /** The destination text to write back into `![alt](<destination>)`. */
  markdownDestination: string
  changed: boolean
  safe: boolean
  reason: string
}

/** Decode percent-encoding exactly ONE level, fail-safe on invalid sequences. */
export function safeDecodePathOnce(raw: string): { decoded: string; ok: boolean } {
  try {
    return { decoded: decodeURIComponent(raw), ok: true }
  } catch {
    return { decoded: raw, ok: false }
  }
}

/**
 * Build a CommonMark-safe image destination for a decoded LOCAL path.
 * Paths containing whitespace or `( ) < >` are wrapped in `<...>`; the rest are
 * emitted plain. (The plain-vs-angle-bracket storage strategy must still be
 * confirmed against the real Typora serializer at runtime.)
 */
export function buildImageDestination(decodedPath: string): string {
  if (/[\s()<>]/.test(decodedPath)) return `<${decodedPath}>`
  return decodedPath
}

/**
 * Normalize a LOCAL image markdown destination: classify → decode once → build
 * the readable destination. Remote URLs and data URLs are NEVER normalized.
 * FILE_URL is blocked by default (conservative); LOCAL_RELATIVE_PATH and
 * LOCAL_ABSOLUTE_WINDOWS_PATH are the auto-normalization targets.
 */
export function normalizeLocalImageMarkdownDestination(raw: string): LocalPathNormalizeResult {
  const kind = classifyImagePath(raw)
  const nonLocal = kind !== 'LOCAL_RELATIVE_PATH' && kind !== 'LOCAL_ABSOLUTE_WINDOWS_PATH'
  if (nonLocal) {
    return { kind, raw, decoded: raw, markdownDestination: raw, changed: false, safe: false, reason: `NON_LOCAL_KIND_${kind}` }
  }
  const one = safeDecodePathOnce(raw)
  if (!one.ok) {
    return { kind, raw, decoded: one.decoded, markdownDestination: raw, changed: false, safe: false, reason: 'INVALID_PERCENT_ENCODING' }
  }
  const markdownDestination = buildImageDestination(one.decoded)
  return {
    kind,
    raw,
    decoded: one.decoded,
    markdownDestination,
    changed: markdownDestination !== raw,
    safe: true,
    reason: markdownDestination !== raw ? 'NORMALIZED' : 'ALREADY_READABLE',
  }
}

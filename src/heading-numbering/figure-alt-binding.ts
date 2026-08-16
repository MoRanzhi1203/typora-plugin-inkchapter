/**
 * Figure Alt Binding — pure Markdown image alt rewrite helpers.
 *
 * The Markdown image alt (`![alt](path)`) is the canonical source of truth for
 * a figure's name. These helpers rewrite that alt in the Markdown SOURCE string
 * (never by mutating img DOM attributes). Escaping follows CommonMark `[...]`
 * rules: `\`, `[`, `]` are backslash-escaped.
 */

export interface FigureAltRewriteResult {
  markdown: string
  changed: boolean
}

import { normalizeLocalImageMarkdownDestination } from './image-path-codec'

export interface MarkdownPathNormalizeResult {
  markdown: string
  normalized: number
  blocked: number
}

/** Escape a figure name for use inside Markdown `![...](...)`. */
export function escapeMarkdownAlt(alt: string): string {
  return alt
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]')
    .replace(/\[/g, '\\[')
}

/** Unescape a Markdown image alt read from source. */
export function unescapeMarkdownAlt(alt: string): string {
  return alt.replace(/\\([\\[\]])/g, '$1')
}

/** Normalize a path for matching (strip angle brackets, trim). */
function stripAngleBrackets(path: string): string {
  let p = path.trim()
  if (p.startsWith('<') && p.endsWith('>')) p = p.slice(1, -1)
  return p
}

/** Candidate forms of a path used for matching against the target src. */
function pathCandidates(path: string): Set<string> {
  const base = stripAngleBrackets(path)
  const out = new Set<string>([base])
  try { out.add(decodeURIComponent(base)) } catch { /* ignore */ }
  try { out.add(encodeURI(base)) } catch { /* ignore */ }
  return out
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

// Alt may contain escaped `\]`/`\[`/`\\`; path may be angle-bracketed.
const IMAGE_REF_RE = /!\[((?:\\.|[^\]])*)\]\((<[^>]*>|[^)]*)\)/g

/**
 * Replace the alt of the occurrence-th inline image whose path matches `src`
 * (1-based occurrence among images sharing the same path).
 */
export function setImageAlt(markdown: string, src: string, newAlt: string, occurrence = 1): FigureAltRewriteResult {
  const escaped = escapeMarkdownAlt(newAlt)
  const srcCandidates = pathCandidates(src)
  let seen = 0
  let changed = false
  const result = markdown.replace(IMAGE_REF_RE, (full, oldAlt, path) => {
    const matches = pathCandidates(path).has(src) || intersects(srcCandidates, pathCandidates(path))
    if (!matches) return full
    seen++
    if (seen === occurrence) {
      changed = true
      return `![${escaped}](${path})`
    }
    return full
  })
  return { markdown: result, changed }
}

/** Read the (unescaped) alt of the occurrence-th inline image matching src. */
export function readImageAlt(markdown: string, src: string, occurrence = 1): string | null {
  const srcCandidates = pathCandidates(src)
  IMAGE_REF_RE.lastIndex = 0
  let seen = 0
  let m: RegExpExecArray | null
  while ((m = IMAGE_REF_RE.exec(markdown)) !== null) {
    const alt = m[1]
    const path = m[2]
    if (pathCandidates(path).has(src) || intersects(srcCandidates, pathCandidates(path))) {
      seen++
      if (seen === occurrence) return unescapeMarkdownAlt(alt)
    }
  }
  return null
}

/** Read the raw destination (angle brackets stripped) of the matching image. */
export function readImageDestination(markdown: string, src: string, occurrence = 1): string | null {
  const srcCandidates = pathCandidates(src)
  IMAGE_REF_RE.lastIndex = 0
  let seen = 0
  let m: RegExpExecArray | null
  while ((m = IMAGE_REF_RE.exec(markdown)) !== null) {
    const path = m[2]
    if (pathCandidates(path).has(src) || intersects(srcCandidates, pathCandidates(path))) {
      seen++
      if (seen === occurrence) return stripAngleBrackets(path)
    }
  }
  return null
}

/**
 * Replace ONLY the destination of the occurrence-th image whose path matches
 * `src`. The alt is preserved byte-for-byte; the destination is swapped for
 * `newDestination` (which must already be the final Markdown destination text).
 */
export function setImageDestination(markdown: string, src: string, newDestination: string, occurrence = 1): FigureAltRewriteResult {
  const srcCandidates = pathCandidates(src)
  let seen = 0
  let changed = false
  const result = markdown.replace(IMAGE_REF_RE, (full, alt, path) => {
    if (!(pathCandidates(path).has(src) || intersects(srcCandidates, pathCandidates(path)))) return full
    seen++
    if (seen === occurrence) {
      changed = true
      return `![${alt}](${newDestination})`
    }
    return full
  })
  return { markdown: result, changed }
}

/**
 * Normalize every LOCAL image destination in the Markdown source in one pass.
 * Each token's own destination is decoded exactly one level; remote URLs and
 * data URLs are left untouched. This avoids the re-matching fragility of
 * patching duplicate-src images one-by-one.
 */
export function normalizeImageDestinationsInMarkdown(markdown: string): MarkdownPathNormalizeResult {
  let normalized = 0
  let blocked = 0
  const result = markdown.replace(IMAGE_REF_RE, (full, alt, path) => {
    const destRaw = stripAngleBrackets(path)
    const res = normalizeLocalImageMarkdownDestination(destRaw)
    if (!res.safe) {
      if (res.reason === 'INVALID_PERCENT_ENCODING') blocked++
      return full
    }
    if (!res.changed) return full
    normalized++
    return `![${alt}](${res.markdownDestination})`
  })
  return { markdown: result, normalized, blocked }
}

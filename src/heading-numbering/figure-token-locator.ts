/**
 * Figure Markdown Token Locator — precise Markdown image token parsing +
 * canonical filesystem identity matching + range-based patching.
 *
 * Why: the runtime `<img>.src` is often an absolute `file://...?lastModify=...`
 * URL while the Markdown destination is a percent-encoded relative path. String
 * equality fails. This module canonicalizes BOTH sides to the same Windows
 * filesystem identity and matches by canonical path + occurrence.
 */

import * as path from 'path'
import { classifyImagePath, safeDecodePathOnce } from './image-path-codec'

export interface MarkdownImageToken {
  altRaw: string
  /** destination WITHOUT angle brackets. */
  destinationRaw: string
  titleRaw?: string
  start: number
  end: number
  altStart: number
  altEnd: number
  /** Inclusive of `<...>` when the destination is angle-bracketed. */
  destinationStart: number
  destinationEnd: number
  /** 1-based occurrence among tokens sharing the same destinationRaw. */
  occurrence: number
}

/** Scan the WHOLE markdown source for image tokens (no line-start assumption). */
export function parseMarkdownImageTokens(markdown: string): MarkdownImageToken[] {
  const tokens: MarkdownImageToken[] = []
  const n = markdown.length
  let i = 0
  while (i < n) {
    const bang = markdown.indexOf('![', i)
    if (bang === -1) break

    // Skip escaped `!` (e.g. `\![not-an-image]`).
    if (bang > 0 && markdown[bang - 1] === '\\') {
      i = bang + 2
      continue
    }

    const altStart = bang + 2
    let j = altStart
    let altEnd = -1
    while (j < n) {
      const ch = markdown[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === ']') { altEnd = j; break }
      if (ch === '\n') break
      j++
    }
    if (altEnd === -1) { i = bang + 2; continue }
    if (markdown[altEnd + 1] !== '(') { i = bang + 2; continue }

    // Parse destination inside `(...)`.
    let k = altEnd + 2
    while (k < n && /\s/.test(markdown[k])) k++

    let destinationRaw = ''
    let destinationStart = k
    let destinationEnd = k

    if (k < n && markdown[k] === '<') {
      const close = markdown.indexOf('>', k)
      if (close === -1) { i = bang + 2; continue }
      destinationRaw = markdown.slice(k + 1, close)
      destinationStart = k
      destinationEnd = close + 1
      k = close + 1
    } else {
      let m2 = k
      while (m2 < n && !/[\s)]/.test(markdown[m2])) m2++
      destinationRaw = markdown.slice(k, m2)
      destinationStart = k
      destinationEnd = m2
      k = m2
    }

    // Optional title (quoted or parenthesized).
    let titleRaw: string | undefined
    while (k < n && /\s/.test(markdown[k])) k++
    if (k < n && (markdown[k] === '"' || markdown[k] === "'" || markdown[k] === '(')) {
      const open = markdown[k]
      const closeCh = open === '"' ? '"' : open === "'" ? "'" : ')'
      const titleStart = k
      let m3 = k + 1
      while (m3 < n && markdown[m3] !== closeCh) {
        if (markdown[m3] === '\\') m3 += 2
        else m3++
      }
      titleRaw = markdown.slice(titleStart, m3 + 1)
      k = m3 + 1
    }

    while (k < n && /\s/.test(markdown[k])) k++
    if (k >= n || markdown[k] !== ')') { i = bang + 2; continue }
    const tokenEnd = k + 1

    tokens.push({
      altRaw: markdown.slice(altStart, altEnd),
      destinationRaw,
      titleRaw,
      start: bang,
      end: tokenEnd,
      altStart,
      altEnd,
      destinationStart,
      destinationEnd,
      occurrence: 0,
    })
    i = tokenEnd
  }

  // 1-based occurrence among tokens sharing the same destinationRaw.
  const counts = new Map<string, number>()
  for (const t of tokens) {
    const c = (counts.get(t.destinationRaw) ?? 0) + 1
    counts.set(t.destinationRaw, c)
    t.occurrence = c
  }
  return tokens
}

/** Normalize a Windows filesystem path for identity comparison. */
export function normalizeWindowsPath(p: string): string {
  const backslashes = p.replace(/\//g, '\\')
  return path.win32.normalize(backslashes).toLowerCase()
}

/**
 * Canonicalize a runtime `<img>.src` to a Windows filesystem identity.
 * Handles `file://...`, `file:///...`, absolute `X:\...` and relative paths
 * (resolved against documentDirectory). Strips query/hash. Returns null for
 * remote/data URLs.
 */
export function canonicalizeRuntimeImageSrc(src: string, documentDirectory?: string | null): string | null {
  const s = (src ?? '').trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower.startsWith('file:')) {
    let rest = s.slice(5).replace(/^\/{2,3}/, '')
    rest = rest.split(/[?#]/, 1)[0]
    return normalizeWindowsPath(safeDecodePathOnce(rest).decoded)
  }
  if (lower.startsWith('http:') || lower.startsWith('https:') || lower.startsWith('data:')) {
    return null
  }
  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    const noQuery = s.split(/[?#]/, 1)[0]
    return normalizeWindowsPath(safeDecodePathOnce(noQuery).decoded)
  }
  // Relative local path.
  if (documentDirectory) {
    return normalizeWindowsPath(path.win32.resolve(documentDirectory, safeDecodePathOnce(s.split(/[?#]/, 1)[0]).decoded))
  }
  return null
}

/**
 * Canonicalize a Markdown image destination to a Windows filesystem identity.
 * Only LOCAL_RELATIVE_PATH / LOCAL_ABSOLUTE_WINDOWS_PATH are resolved; remote
 * and data URLs return null.
 */
export function canonicalizeMarkdownDestination(destination: string, documentDirectory: string): string | null {
  const d = (destination ?? '').trim()
  if (!d) return null
  const kind = classifyImagePath(d)
  if (kind !== 'LOCAL_RELATIVE_PATH' && kind !== 'LOCAL_ABSOLUTE_WINDOWS_PATH') return null
  const decoded = safeDecodePathOnce(d).decoded
  return normalizeWindowsPath(path.win32.resolve(documentDirectory, decoded))
}

export interface LocateMarkdownImageTokenResult {
  token: MarkdownImageToken | null
  index: number
  runtimeSrcRaw: string
  runtimePathCanonical: string | null
  documentDirectory: string | null
  candidateCount: number
  candidateIndex: number
  candidateAlt: string | null
  candidateDestinationRaw: string | null
  candidatePathCanonical: string | null
  pathMatch: boolean
  occurrenceMatch: boolean
  decision: string
  reason: string
}

/**
 * Locate the Markdown image token corresponding to a runtime figure by
 * canonical filesystem identity + occurrence (1-based among same-path tokens).
 */
export function locateMarkdownImageToken(
  markdown: string,
  runtimeSrc: string,
  documentDirectory: string | null,
  occurrence: number,
): LocateMarkdownImageTokenResult {
  const runtimePathCanonical = canonicalizeRuntimeImageSrc(runtimeSrc, documentDirectory)
  const base: LocateMarkdownImageTokenResult = {
    token: null,
    index: -1,
    runtimeSrcRaw: runtimeSrc,
    runtimePathCanonical,
    documentDirectory,
    candidateCount: 0,
    candidateIndex: -1,
    candidateAlt: null,
    candidateDestinationRaw: null,
    candidatePathCanonical: null,
    pathMatch: false,
    occurrenceMatch: false,
    decision: '',
    reason: '',
  }

  if (runtimePathCanonical === null) {
    return { ...base, decision: 'INVALID_FILE_URL', reason: 'runtime src is not a local file path' }
  }
  if (!documentDirectory) {
    return { ...base, decision: 'DOCUMENT_DIRECTORY_UNKNOWN', reason: 'cannot resolve relative destination' }
  }

  const tokens = parseMarkdownImageTokens(markdown)
  if (tokens.length === 0) {
    return { ...base, candidateCount: 0, decision: 'NO_IMAGE_TOKENS', reason: 'no image tokens in markdown' }
  }

  let matchCount = 0
  let selected: MarkdownImageToken | null = null
  let selectedIndex = -1
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    const c = canonicalizeMarkdownDestination(t.destinationRaw, documentDirectory)
    if (c !== null && c === runtimePathCanonical) {
      matchCount++
      if (matchCount === occurrence) {
        selected = t
        selectedIndex = idx
      }
    }
  }

  if (!selected) {
    if (matchCount === 0) {
      return { ...base, candidateCount: tokens.length, decision: 'NO_LOCAL_PATH_MATCH', reason: 'no canonical path match' }
    }
    return {
      ...base,
      candidateCount: tokens.length,
      decision: 'AMBIGUOUS_DUPLICATE',
      reason: `occurrence ${occurrence} exceeds ${matchCount} canonical matches`,
    }
  }

  return {
    token: selected,
    index: selectedIndex,
    runtimeSrcRaw: runtimeSrc,
    runtimePathCanonical,
    documentDirectory,
    candidateCount: tokens.length,
    candidateIndex: selectedIndex,
    candidateAlt: selected.altRaw,
    candidateDestinationRaw: selected.destinationRaw,
    candidatePathCanonical: canonicalizeMarkdownDestination(selected.destinationRaw, documentDirectory),
    pathMatch: true,
    occurrenceMatch: true,
    decision: 'MATCH',
    reason: 'canonical path + occurrence matched',
  }
}

/** Patch ONLY the alt range of a token (escaped alt must be pre-built). */
export function patchAltRange(markdown: string, token: MarkdownImageToken, escapedAlt: string): string {
  return markdown.slice(0, token.altStart) + escapedAlt + markdown.slice(token.altEnd)
}

/** Patch ONLY the destination range of a token (destination must be pre-built). */
export function patchDestinationRange(markdown: string, token: MarkdownImageToken, newDestination: string): string {
  return markdown.slice(0, token.destinationStart) + newDestination + markdown.slice(token.destinationEnd)
}

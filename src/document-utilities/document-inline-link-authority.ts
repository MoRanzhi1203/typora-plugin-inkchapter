/**
 * TRAE V3 §7.3 — `DocumentInlineLinkAuthority`.
 *
 * THE ONE bounded Markdown INLINE link / image structure parser:
 *
 *   [text](target "title")     inline link
 *   ![alt](target "title")     inline image
 *   [](target)  /  [text]()    empty text / empty target
 *
 * It handles escaped delimiters, nested brackets, and skips anything inside a
 * PROTECTED range (code fence / formula / front matter / inline code) — so a
 * `[x]()` inside a code span is TEXT, never a link. Images are modelled too (so
 * `![](image.png)` can be EXCLUDED from `LINK_TEXT_EMPTY`), but it is NOT the
 * resource-resolution parser — it never checks file existence.
 *
 * GUARANTEE: for ONE `documentKey` + `sourceRevision` the parse runs AT MOST
 * ONCE (`getDocumentInlineLinkAuthority`).
 *
 * Pure: no DOM, no host state, no filesystem.
 */
import {
  buildSourceLineSpans,
  lineIndexOfOffset,
  type SourceSyntaxSnapshot,
} from './document-source-syntax-authority'

export interface InlineLinkOccurrence {
  /** True for `![alt](target)`, false for `[text](target)`. */
  isImage: boolean
  /** Bracket text (raw, may contain inline markup). */
  text: string
  /** Raw destination token (empty string when the target is empty). */
  target: string
  /** Optional `"title"` / `'title'` (raw, including quotes) or null. */
  rawTitle: string | null
  /** Absolute [start,end) of the WHOLE token (including a leading `!`). */
  tokenStart: number
  tokenEnd: number
  /** Absolute [start,end) of the bracket text (inside `[` `]`). */
  textStart: number
  textEnd: number
  /** Absolute [start,end) of the destination token (equal when empty). */
  targetStart: number
  targetEnd: number
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  rawText: string
  /** `link:<tokenStart>` / `image:<tokenStart>` — canonical occurrence identity. */
  identity: string
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

/** §7.3 — parse every inline link/image occurrence (uncached). */
export function parseDocumentInlineLinks(
  markdown: string,
  sourceRevision: string = '',
  snapshot: SourceSyntaxSnapshot | null = null,
): InlineLinkOccurrence[] {
  void sourceRevision
  const out: InlineLinkOccurrence[] = []
  if (!markdown) return out
  const ranges = snapshot?.protectedRanges ?? []
  const lines = buildSourceLineSpans(markdown)
  const len = markdown.length
  let ri = 0
  let i = 0
  while (i < len) {
    while (ri < ranges.length && ranges[ri].end <= i) ri++
    if (ri < ranges.length && i >= ranges[ri].start && i < ranges[ri].end) {
      i = ranges[ri].end
      continue
    }
    if (markdown[i] !== '[' || isEscapedAt(markdown, i)) { i++; continue }
    // find matching `]` with bracket depth + escape awareness
    let depth = 1
    let j = i + 1
    while (j < len && depth > 0) {
      const c = markdown[j]
      if (c === '\\') { j += 2; continue }
      if (c === '[') depth++
      else if (c === ']') depth--
      if (depth === 0) break
      j++
    }
    if (depth !== 0) { i++; continue }
    const textStart = i + 1
    const textEnd = j
    const after = j + 1
    if (after >= len || markdown[after] !== '(') { i = after; continue }
    // find matching `)` with paren depth + escape awareness
    let pdepth = 1
    let k = after + 1
    while (k < len && pdepth > 0) {
      const c = markdown[k]
      if (c === '\\') { k += 2; continue }
      if (c === '(') pdepth++
      else if (c === ')') pdepth--
      if (pdepth === 0) break
      k++
    }
    if (pdepth !== 0) { i = after; continue }
    const inside = markdown.slice(after + 1, k)
    const isImage = i > 0 && markdown[i - 1] === '!' && !isEscapedAt(markdown, i - 1)
    const tokenStart = isImage ? i - 1 : i
    const tokenEnd = k + 1

    // destination + optional title
    let ws = 0
    while (ws < inside.length && /\s/.test(inside[ws])) ws++
    const destStartRel = after + 1 + ws
    let target = ''
    let rawTitle: string | null = null
    const rest = inside.slice(ws)
    if (rest.startsWith('<')) {
      const close = rest.indexOf('>')
      if (close >= 0) {
        target = rest.slice(1, close)
        const tail = rest.slice(close + 1).trim()
        rawTitle = tail === '' ? null : tail
      } else {
        target = rest
      }
    } else {
      const m = /^(\S*)(?:\s+([\s\S]*))?$/.exec(rest)
      target = m?.[1] ?? ''
      const tail = (m?.[2] ?? '').trim()
      rawTitle = tail === '' ? null : tail
    }
    const targetStart = destStartRel
    const targetEnd = destStartRel + target.length
    const startLine = lineIndexOfOffset(lines, tokenStart)
    const endLine = lineIndexOfOffset(lines, Math.max(tokenStart, tokenEnd - 1))
    const lineStart = lines[startLine].start
    out.push({
      isImage,
      text: markdown.slice(textStart, textEnd),
      target,
      rawTitle,
      tokenStart,
      tokenEnd,
      textStart,
      textEnd,
      targetStart,
      targetEnd,
      startLine,
      endLine,
      startColumn: Math.max(0, tokenStart - lineStart),
      endColumn: Math.max(0, tokenEnd - lines[endLine].start),
      rawText: lines[startLine].text,
      identity: `${isImage ? 'image' : 'link'}:${tokenStart}`,
    })
    i = k + 1
  }
  return out
}

// ── §14 — parse-once (memoised per documentKey + sourceRevision) ────────────

interface InlineCacheEntry {
  key: string
  markdown: string
  links: InlineLinkOccurrence[]
}

const INLINE_CACHE_LIMIT = 8
const inlineCache: InlineCacheEntry[] = []
let inlineLinkParseCount = 0

/**
 * §14 — the ONE entry point every rule consumes. For a given
 * `documentKey` + `sourceRevision` the inline structure is parsed AT MOST ONCE.
 */
export function getDocumentInlineLinkAuthority(
  documentKey: string | null,
  markdown: string,
  sourceRevision: number | null | undefined,
  snapshot: SourceSyntaxSnapshot | null,
): InlineLinkOccurrence[] {
  const key = `${documentKey ?? ''}\u0000${sourceRevision ?? ''}`
  const hit = inlineCache.find(e => e.key === key && e.markdown === markdown)
  if (hit) return hit.links
  const links = parseDocumentInlineLinks(markdown, String(sourceRevision ?? ''), snapshot)
  inlineLinkParseCount++
  inlineCache.unshift({ key, markdown, links })
  while (inlineCache.length > INLINE_CACHE_LIMIT) inlineCache.pop()
  return links
}

/** §14 — how many real inline parses ran (test / audit hook). */
export function getDocumentInlineLinkParseCount(): number {
  return inlineLinkParseCount
}

/** Test / audit hook — clear the memo cache and the parse counter. */
export function resetDocumentInlineLinkAuthority(): void {
  inlineCache.length = 0
  inlineLinkParseCount = 0
}

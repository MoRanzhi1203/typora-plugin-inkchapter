/**
 * Phase 7R.3.11.8B.4.1 — Latent ATX Heading Marker detection (Source Syntax
 * Diagnostics).
 *
 * STRICTLY read-only source-syntax layer, fully isolated from the Canonical
 * Heading Authority:
 *
 *   "Is this line a heading NOW?"      → CanonicalHeadingFrame (never here)
 *   "Does this source line LOOK like a potential ATX heading that Typora has
 *    NOT turned into a heading yet?"   → this module (raw Markdown only)
 *
 * The detector NEVER writes back to canonicalHeadingCount / h1Count / gap /
 * boundary / outline / caption scope / formula scope.
 *
 * Typora-alignment: candidate lines must match the CommonMark ATX shape that
 * Typora itself uses (line-start 1..6 '#' followed by EOL or whitespace+content,
 * optional ≤3 leading spaces, optional trailing closing '#'). Explicitly
 * escaped markers (`\#`, `\##`, `\####`) are NOT candidates. Fenced code
 * content is skipped. The Canonical exclusion is decided by the caller via
 * `canonicalHeadingLines` (Typora `data-line` of canonical heading elements).
 */
export interface LatentAtxMarkerFact {
  /** 0-based source line index (matches markdown.split('\n')). */
  line: number
  /** Column of the first '#' (0..3 for leading-space cases). */
  column: number
  /** 1..6 — number of '#' in the opening sequence. */
  markerLevel: number
  /** The literal opening marker text, e.g. "##". */
  markerText: string
  /** True for explicitly escaped markers (`\#` etc.) — always IGNORED. */
  escaped: boolean
  /** True when the line is already covered by a canonical heading. */
  canonicalMatch: boolean
  /** Heading content after the opening marker (closing '#' stripped, trimmed). */
  text: string
}

export interface LatentAtxScanResult {
  /** Potential ATX heading lines that are NOT canonical headings. */
  latent: LatentAtxMarkerFact[]
  /** Escaped marker facts (`\#`, `\##`, ...) — IGNORE, counted for the audit. */
  escaped: LatentAtxMarkerFact[]
  /** Source lines occupied by canonical headings (passed back for the audit). */
  canonicalLines: number[]
}

/**
 * True when `line` is inside a fenced code block, using a 0-based line index
 * scan. `openFence` tracks the current fence character+length state across
 * calls (caller keeps one state object per document scan).
 */
export interface FenceScanState {
  inFence: boolean
  fenceChar: string
}

export function createFenceScanState(): FenceScanState {
  return { inFence: false, fenceChar: '' }
}

/** 1..6 '#' at line start (after ≤3 spaces), then EOL or whitespace+content. */
const ATX_CANDIDATE_RE = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*?)[ \t]*$|$)/
/** Explicit escape: a leading backslash before the hash run. */
const ESCAPED_MARKER_RE = /^\\{1}(#{1,6})(?:[ \t]+([\s\S]*?)[ \t]*$|$)/
/** Fence opener/closer at line start (≤3 spaces). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** Strip a CommonMark closing-hash sequence ("text ##" → "text"). */
function stripClosingHashes(content: string): string {
  return content.replace(/[ \t]?#{1,6}[ \t]*$/, '').trim()
}

/** Normalize a heading content for canonical-text cross-checking. */
function normalizeHeadingText(text: string): string {
  return stripClosingHashes(text).replace(/\s+/g, ' ').trim()
}

/**
 * Detect latent ATX heading markers in raw Markdown.
 *
 * @param markdown  Raw editor Markdown (may be null → empty result).
 * @param canonicalHeadingLines  Source lines already occupied by canonical
 *   heading nodes (Typora `data-line`). A candidate whose line is in this set
 *   is canonical-covered and therefore NOT latent.
 * @param canonicalHeadingTexts  Secondary safety net: "level:normalizedText"
 *   keys of canonical headings (used when `data-line` is unavailable).
 */
export function detectLatentAtxMarkers(
  markdown: string | null | undefined,
  canonicalHeadingLines: ReadonlySet<number> = new Set(),
  canonicalHeadingTexts: ReadonlySet<string> = new Set(),
): LatentAtxScanResult {
  if (markdown == null) return { latent: [], escaped: [], canonicalLines: [] }
  const lines = markdown.split('\n')
  const latent: LatentAtxMarkerFact[] = []
  const escaped: LatentAtxMarkerFact[] = []
  const canonicalLines: number[] = [...canonicalHeadingLines].sort((a, b) => a - b)
  const fence = createFenceScanState()

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    // Fenced code blocks: opening/closing markers and all inner content are
    // never heading candidates.
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      const char = fenceMatch[1][0]
      if (!fence.inFence) {
        fence.inFence = true
        fence.fenceChar = char
      } else if (fence.fenceChar === char) {
        fence.inFence = false
      }
      continue
    }
    if (fence.inFence) continue

    // Explicitly escaped marker (`\#`, `\##`, `\####`) → IGNORE, but count it.
    const escapedMatch = ESCAPED_MARKER_RE.exec(line)
    if (escapedMatch) {
      escaped.push({
        line: i,
        column: line.indexOf('#'),
        markerLevel: escapedMatch[1].length,
        markerText: escapedMatch[1],
        escaped: true,
        canonicalMatch: canonicalHeadingLines.has(i),
        text: normalizeHeadingText(escapedMatch[2] ?? ''),
      })
      continue
    }

    // Unescaped line-start ATX candidate (CommonMark shape Typora follows).
    const m = ATX_CANDIDATE_RE.exec(line)
    if (!m) continue // #text (no space), 7+ '#', 4+ leading spaces, inline '#', ...
    const markerLevel = m[1].length
    const text = normalizeHeadingText(m[2] ?? '')
    const column = line.indexOf('#')

    // Canonical exclusion: the line is already a real heading node.
    const canonicalMatch =
      canonicalHeadingLines.has(i) ||
      canonicalHeadingTexts.has(`${markerLevel}:${normalizeHeadingText(text)}`)

    if (canonicalMatch) continue

    latent.push({
      line: i,
      column,
      markerLevel,
      markerText: m[1],
      escaped: false,
      canonicalMatch: false,
      text,
    })
  }

  return { latent, escaped, canonicalLines }
}

/** Source-line keys of canonical headings from Typora `data-line` attributes. */
export function collectCanonicalHeadingSourceLines(
  headingElements: ReadonlyArray<HTMLElement | null | undefined>,
): Set<number> {
  const lines = new Set<number>()
  for (const el of headingElements) {
    const dl = el?.getAttribute?.('data-line')
    if (dl == null) continue
    const n = Number.parseInt(dl, 10)
    if (Number.isInteger(n) && n >= 0) lines.add(n)
  }
  return lines
}

/** "level:normalizedText" keys of canonical headings (secondary fallback). */
export function collectCanonicalHeadingTextKeys(
  facts: ReadonlyArray<{ physicalLevel: number; text: string }>,
): Set<string> {
  const keys = new Set<string>()
  for (const f of facts) {
    keys.add(`${f.physicalLevel}:${normalizeHeadingText(f.text)}`)
  }
  return keys
}

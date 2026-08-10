/**
 * Paragraph Layout Sidecar Store
 *
 * Persistent Source of Truth for paragraph indent overrides.
 * Replaces the deprecated <!-- inkchapter:paragraph-indent=2 --> HTML comment
 * marker approach (R34: HTML COMMENT PERSISTENCE = NOT VIABLE).
 *
 * Sidecar files are stored in: <vault>/.typora/inkchapter/paragraph-layout/
 * One file per document, keyed by normalized relative path.
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Schema ─────────────────────────────────────────────────────────────

export type ParagraphIndentMode = 'force-indent' | 'force-flush' | 'auto'

export interface ParagraphAnchor {
  /** Last known 0-based ordinal among content paragraphs. */
  lastKnownOrdinal: number
  /** SHA256-like hash of normalized paragraph text (empty for new/empty targets). */
  textHash?: string
  /** Occurrence index when multiple paragraphs have the same textHash. */
  occurrence?: number
  /** Hash of previous content paragraph text (for disambiguation). */
  beforeHash?: string
  /** Hash of next content paragraph text (for disambiguation). */
  afterHash?: string
}

export interface ParagraphIndentOverrideRecord {
  id: string
  mode: ParagraphIndentMode
  anchor: ParagraphAnchor
  /** Whether this anchor is temporary (empty target) and needs promotion. */
  temporary?: boolean
}

export interface ParagraphLayoutDocument {
  schemaVersion: number
  documentPath: string
  updatedAt: number
  paragraphOverrides: ParagraphIndentOverrideRecord[]
}

const CURRENT_SCHEMA_VERSION = 1

// ── Helpers ────────────────────────────────────────────────────────────

/** Simple text hash for paragraph identity. */
export function hashText(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i)
    h |= 0
  }
  return 'h' + (h >>> 0).toString(36)
}

/** Normalize paragraph text for comparison. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ── Vault path resolution ──────────────────────────────────────────────

function resolveVaultRoot(): string | null {
  // Try to derive from the active document path
  // This is set by the service during initialization
  return (globalThis as any).__inkchapter_vault_root__ ?? null
}

let vaultRootOverride: string | null = null
/** Set vault root for testing. Overrides all other sources. */
export function setVaultRootForTesting(root: string): void {
  vaultRootOverride = root
}

let productionVaultRoot: string | null = null
let productionVaultRootSet = false
/** Inject vault root for production use. Called by HeadingNumberingService on init. */
export function injectProductionVaultRoot(root: string): void {
  productionVaultRoot = root
  productionVaultRootSet = true
  // Also set globalThis for other modules (trace, forensic)
  ;(globalThis as any).__inkchapter_vault_root__ = root
}

function getVaultRoot(): string | null {
  if (vaultRootOverride) return vaultRootOverride
  if (productionVaultRoot) return productionVaultRoot
  return resolveVaultRoot()
}

/** Whether a production vault root has been explicitly injected. */
function isProductionVaultKnown(): boolean {
  return productionVaultRootSet || !!vaultRootOverride
}

function getSidecarDir(): string | null {
  const vault = getVaultRoot()
  if (vault) return path.join(vault, '.typora', 'inkchapter', 'paragraph-layout')
  // Production with unknown vault: HARD diagnostic, disable sidecar
  if (!isProductionVaultKnown()) {
    console.warn('[InkChapter] SIDECAR-DISABLED: vaultRoot unknown — cannot resolve sidecar storage. TEMP fallback blocked in production.')
    return null
  }
  // Test mode: only allow TEMP fallback when vaultRootOverride is explicitly set
  return path.join(require('os').tmpdir(), 'inkchapter-paragraph-layout-test')
}

function getSidecarPath(documentKey: string): string | null {
  const dir = getSidecarDir()
  if (!dir) return null
  const safeKey = documentKey.replace(/[/\\:*?"<>|]/g, '_')
  return path.join(dir, `${safeKey}.json`)
}

// ── Load / Save ────────────────────────────────────────────────────────

export function loadParagraphLayout(documentKey: string): ParagraphLayoutDocument | null {
  try {
    const filePath = getSidecarPath(documentKey)
    if (!filePath) {
      // ── SIDECAR-ACTUAL-LOAD (P0-1: vaultRoot unknown, sidecar disabled) ──
      console.warn(`[InkChapter] SIDECAR-ACTUAL-LOAD: documentKey=${documentKey} vaultRoot=${getVaultRoot() ?? 'unknown'} storageRoot=null source=disabled (vaultRoot unknown, TEMP fallback blocked)`)
      return null
    }
    const dir = getSidecarDir()
    const vault = getVaultRoot()

    if (!fs.existsSync(filePath)) {
      console.info(`[InkChapter] SIDECAR-ACTUAL-LOAD: documentKey=${documentKey} vaultRoot=${vault ?? 'unknown'} storageRoot=${dir} absolutePath=${filePath} exists=false recordCount=0 source=filesystem`)
      return null
    }
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw) as ParagraphLayoutDocument
    if (!data.schemaVersion || !Array.isArray(data.paragraphOverrides)) {
      console.info(`[InkChapter] SIDECAR-ACTUAL-LOAD: documentKey=${documentKey} vaultRoot=${vault ?? 'unknown'} absolutePath=${filePath} exists=true recordCount=0 source=filesystem (invalid schema)`)
      return null
    }
    console.info(`[InkChapter] SIDECAR-ACTUAL-LOAD: documentKey=${documentKey} vaultRoot=${vault ?? 'unknown'} storageRoot=${dir} absolutePath=${filePath} exists=true recordCount=${data.paragraphOverrides.length} source=filesystem`)
    return data
  } catch (e) {
    console.info(`[InkChapter] SIDECAR-ACTUAL-LOAD: documentKey=${documentKey} error=${e}`)
    return null
  }
}

export function saveParagraphLayout(
  documentKey: string,
  documentPath: string,
  overrides: ParagraphIndentOverrideRecord[],
): void {
  const dir = getSidecarDir()
  if (!dir) {
    // ── SIDECAR-ACTUAL-WRITE (P0-1: vaultRoot unknown, sidecar disabled) ──
    console.warn(`[InkChapter] SIDECAR-ACTUAL-WRITE: documentKey=${documentKey} vaultRoot=${getVaultRoot() ?? 'unknown'} source=disabled (vaultRoot unknown, write blocked)`)
    return
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const filePath = getSidecarPath(documentKey)
  if (!filePath) return
  const vault = getVaultRoot()

  // ── SIDECAR-ACTUAL-WRITE (P0-B diagnostic) ──
  const prevCount = (() => {
    try { if (fs.existsSync(filePath)) { const raw = fs.readFileSync(filePath, 'utf8'); const data = JSON.parse(raw); return data.paragraphOverrides?.length ?? 0 } } catch {}
    return -1
  })()
  console.info(`[InkChapter] SIDECAR-ACTUAL-WRITE: documentKey=${documentKey} vaultRoot=${vault ?? 'unknown'} absolutePath=${filePath} recordCountBefore=${prevCount} recordCountAfter=${overrides.length} source=filesystem`)

  const doc: ParagraphLayoutDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentPath,
    updatedAt: Date.now(),
    paragraphOverrides: overrides,
  }
  // Atomic write: temp file → rename
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

// ── Anchor Creation ────────────────────────────────────────────────────

/** Collect all content paragraphs from editor root (excl. headings, code, etc.). */
export function collectContentParagraphs(editorRoot: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = []
  const all = editorRoot.querySelectorAll<HTMLElement>('p')
  for (let i = 0; i < all.length; i++) {
    const p = all[i]
    // Exclude paragraphs inside excluded contexts
    if (p.closest('pre, code, .md-codeblock, li, blockquote, table, .md-math-block, mjx-container')) continue
    result.push(p)
  }
  return result
}

/**
 * Create a stable paragraph anchor from the paragraph's context
 * within a list of all content paragraphs.
 */
export function createParagraphAnchor(
  paragraphIndex: number,
  allParagraphs: HTMLElement[],
): ParagraphAnchor {
  const p = allParagraphs[paragraphIndex]
  const text = p?.textContent ?? ''
  const normalized = normalizeText(text)
  const textHash = normalized ? hashText(normalized) : undefined

  // Count occurrence of this textHash among all paragraphs
  let occurrence = 1
  if (textHash) {
    for (let i = 0; i < paragraphIndex; i++) {
      const prevText = normalizeText(allParagraphs[i]?.textContent ?? '')
      if (hashText(prevText) === textHash) occurrence++
    }
  }

  // Neighbor hashes
  const beforePara = paragraphIndex > 0 ? allParagraphs[paragraphIndex - 1] : null
  const afterPara = paragraphIndex < allParagraphs.length - 1 ? allParagraphs[paragraphIndex + 1] : null
  const beforeText = beforePara ? normalizeText(beforePara.textContent ?? '') : ''
  const afterText = afterPara ? normalizeText(afterPara.textContent ?? '') : ''

  return {
    lastKnownOrdinal: paragraphIndex,
    textHash,
    occurrence: textHash ? occurrence : undefined,
    beforeHash: beforeText ? hashText(beforeText) : undefined,
    afterHash: afterText ? hashText(afterText) : undefined,
  }
}

// ── Anchor Resolution ──────────────────────────────────────────────────

export interface AnchorResolveResult {
  index: number
  confidence: 'exact' | 'high' | 'medium' | 'fallback'
}

/**
 * Resolve a paragraph anchor to a paragraph index in the current document.
 * Returns null if ambiguous or not found.
 *
 * Resolution priority:
 * 1. textHash + occurrence unique match
 * 2. textHash + neighbor hashes
 * 3. neighbor hashes + ordinal proximity
 * 4. lastKnownOrdinal fallback
 */
export function resolveParagraphAnchor(
  anchor: ParagraphAnchor,
  allParagraphs: HTMLElement[],
): AnchorResolveResult | null {
  if (allParagraphs.length === 0) return null

  // Level 1: exact textHash + occurrence
  if (anchor.textHash) {
    let matchOccurrence = 0
    let matchIndex = -1
    for (let i = 0; i < allParagraphs.length; i++) {
      const text = normalizeText(allParagraphs[i]?.textContent ?? '')
      if (hashText(text) === anchor.textHash) {
        matchOccurrence++
        if (matchOccurrence === (anchor.occurrence ?? 1)) {
          matchIndex = i
        }
      }
    }
    if (matchIndex >= 0) {
      return { index: matchIndex, confidence: 'exact' }
    }
    // textHash exists but 0 matches — paragraph was edited or deleted.
    // Don't fall back to ordinal; text content changed too much.
    // But do try neighbor hashes if available.
    if (!anchor.beforeHash && !anchor.afterHash) {
      return null
    }
  }

  // Level 2/3: neighbor hashes + ordinal proximity
  if (anchor.beforeHash || anchor.afterHash) {
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < allParagraphs.length; i++) {
      const beforePara = i > 0 ? allParagraphs[i - 1] : null
      const afterPara = i < allParagraphs.length - 1 ? allParagraphs[i + 1] : null
      let score = 0
      if (anchor.beforeHash && beforePara) {
        if (hashText(normalizeText(beforePara.textContent ?? '')) === anchor.beforeHash) score += 2
      }
      if (anchor.afterHash && afterPara) {
        if (hashText(normalizeText(afterPara.textContent ?? '')) === anchor.afterHash) score += 2
      }
      // bonus for ordinal proximity
      if (Math.abs(i - anchor.lastKnownOrdinal) <= 2) score += 1
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    if (bestIdx >= 0 && bestScore >= 2) {
      return { index: bestIdx, confidence: bestScore >= 5 ? 'high' : 'medium' }
    }
  }

  // Level 4: lastKnownOrdinal fallback — ONLY when textHash was never provided
  if (!anchor.textHash) {
    const ordinal = anchor.lastKnownOrdinal
    if (ordinal >= 0 && ordinal < allParagraphs.length) {
      return { index: ordinal, confidence: 'fallback' }
    }
  }

  return null
}

// ── Candidate Resolution ──────────────────────────────────────────────
// Returns ALL candidate paragraphs with scores, NOT just the best.
// Caller must detect ties and ambiguity.

export interface ParagraphAnchorCandidate {
  index: number
  score: number
  confidence: 'exact' | 'high' | 'medium' | 'fallback'
  textHashMatch: boolean
  neighborScore: number
  ordinalProximityBonus: number
}

/**
 * Resolve ALL candidate paragraphs for an anchor, ranked by score.
 * Does NOT pick a winner — the caller must detect equal-score ties and
 * treat them as ambiguous.
 *
 * Scoring:
 *   textHash + occurrence match → score=100 (exact)
 *   beforeHash match → +2
 *   afterHash match → +2
 *   ordinal proximity ≤2 → +1
 *   ordinal-only fallback → score=1 (fallback)
 */
export function resolveParagraphAnchorCandidates(
  anchor: ParagraphAnchor,
  allParagraphs: HTMLElement[],
): ParagraphAnchorCandidate[] {
  if (allParagraphs.length === 0) return []

  const candidates: ParagraphAnchorCandidate[] = []

  // Level 1: textHash + occurrence match
  if (anchor.textHash) {
    let matchOccurrence = 0
    for (let i = 0; i < allParagraphs.length; i++) {
      const text = normalizeText(allParagraphs[i]?.textContent ?? '')
      if (hashText(text) === anchor.textHash) {
        matchOccurrence++
        if (matchOccurrence === (anchor.occurrence ?? 1)) {
          candidates.push({
            index: i,
            score: 100,
            confidence: 'exact',
            textHashMatch: true,
            neighborScore: 0,
            ordinalProximityBonus: 0,
          })
        }
      }
    }
    // If textHash exists and found a match (or at least one textHash match existed),
    // we have our best candidate. Don't fall back to neighbors unless textHash
    // has ZERO matches and neighbors exist.
    if (candidates.length > 0) return candidates
    // textHash exists but 0 matches — fall through to neighbor scoring
    if (!anchor.beforeHash && !anchor.afterHash) return []
  }

  // Level 2/3: neighbor hashes + ordinal proximity — score ALL paragraphs
  for (let i = 0; i < allParagraphs.length; i++) {
    const beforePara = i > 0 ? allParagraphs[i - 1] : null
    const afterPara = i < allParagraphs.length - 1 ? allParagraphs[i + 1] : null
    let neighborScore = 0
    if (anchor.beforeHash && beforePara) {
      if (hashText(normalizeText(beforePara.textContent ?? '')) === anchor.beforeHash)
        neighborScore += 2
    }
    if (anchor.afterHash && afterPara) {
      if (hashText(normalizeText(afterPara.textContent ?? '')) === anchor.afterHash)
        neighborScore += 2
    }
    const ordinalBonus = Math.abs(i - anchor.lastKnownOrdinal) <= 2 ? 1 : 0
    const totalScore = neighborScore + ordinalBonus

    if (totalScore >= 2) {
      candidates.push({
        index: i,
        score: totalScore,
        confidence: totalScore >= 5 ? 'high' : 'medium',
        textHashMatch: false,
        neighborScore,
        ordinalProximityBonus: ordinalBonus,
      })
    }
  }

  // Level 4: lastKnownOrdinal fallback — ONLY when textHash was never provided
  if (!anchor.textHash && candidates.length === 0) {
    const ordinal = anchor.lastKnownOrdinal
    if (ordinal >= 0 && ordinal < allParagraphs.length) {
      candidates.push({
        index: ordinal,
        score: 1,
        confidence: 'fallback',
        textHashMatch: false,
        neighborScore: 0,
        ordinalProximityBonus: 0,
      })
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score)

  return candidates
}

/**
 * Update anchor with current paragraph context (for auto-repair after resolve).
 */
export function updateParagraphAnchor(
  anchor: ParagraphAnchor,
  paragraphIndex: number,
  allParagraphs: HTMLElement[],
): ParagraphAnchor {
  return createParagraphAnchor(paragraphIndex, allParagraphs)
}

// ── Legacy Marker Migration ────────────────────────────────────────────

const INDENT_MARKER_PATTERN = /<!--\s*inkchapter:paragraph-indent=2\s*-->/g

/**
 * Migrate legacy <!-- inkchapter:paragraph-indent=2 --> markers
 * from Markdown source to sidecar overrides. Returns the cleaned Markdown
 * and the generated override records.
 */
export function migrateLegacyIndentMarkers(markdown: string): {
  cleanMarkdown: string
  overrides: ParagraphIndentOverrideRecord[]
  migrated: boolean
} {
  if (!markdown || !INDENT_MARKER_PATTERN.test(markdown)) {
    return { cleanMarkdown: markdown, overrides: [], migrated: false }
  }

  const lines = markdown.split('\n')
  const cleanLines: string[] = []
  const overrides: ParagraphIndentOverrideRecord[] = []
  let paraOrdinal = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check for marker patterns
    const markerMatch = trimmed.match(INDENT_MARKER_PATTERN)

    if (markerMatch && trimmed === markerMatch[0]) {
      // Case A: Standalone canonical marker
      i++ // skip marker line
      // Skip blank lines after marker
      while (i < lines.length && lines[i].trim() === '') i++
      // Next non-blank line is the target paragraph
      if (i < lines.length) {
        const targetLine = lines[i]
        // Create override for this paragraph
        const textHash = hashText(normalizeText(targetLine.trim()))
        overrides.push({
          id: `legacy-${overrides.length}`,
          mode: 'force-indent',
          anchor: { lastKnownOrdinal: paraOrdinal, textHash, occurrence: 1 },
        })
        // Keep the target paragraph text
        cleanLines.push(targetLine)
        paraOrdinal++
        i++
      }
      // If no target (orphan), marker is simply removed
      continue
    }

    if (markerMatch && trimmed !== markerMatch[0]) {
      // Case C: Same-line marker: "<!-- marker -->target text"
      const afterMarker = trimmed.slice(trimmed.indexOf('-->') + 3).trim()
      if (afterMarker) {
        const textHash = hashText(normalizeText(afterMarker))
        overrides.push({
          id: `legacy-${overrides.length}`,
          mode: 'force-indent',
          anchor: { lastKnownOrdinal: paraOrdinal, textHash, occurrence: 1 },
        })
        cleanLines.push(afterMarker)
        paraOrdinal++
      }
      i++
      continue
    }

    // Skip blank lines
    if (trimmed === '') {
      cleanLines.push(line)
      i++
      continue
    }

    // Skip structural lines (headings, code, lists)
    if (/^#{1,6}\s/.test(trimmed) || /^```/.test(trimmed) || /^[\s]*[-*+>|]/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      cleanLines.push(line)
      i++
      continue
    }

    // Regular paragraph
    cleanLines.push(line)
    paraOrdinal++
    i++
  }

  const migrated = overrides.length > 0 || cleanLines.join('\n') !== markdown
  return { cleanMarkdown: cleanLines.join('\n'), overrides, migrated }
}

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
export function setVaultRootForTesting(root: string): void {
  vaultRootOverride = root
}

function getVaultRoot(): string | null {
  if (vaultRootOverride) return vaultRootOverride
  return resolveVaultRoot()
}

function getSidecarDir(): string {
  const vault = getVaultRoot()
  if (vault) return path.join(vault, '.typora', 'inkchapter', 'paragraph-layout')
  // Fallback: use temp directory for testing
  return path.join(require('os').tmpdir(), 'inkchapter-paragraph-layout-test')
}

function getSidecarPath(documentKey: string): string {
  const dir = getSidecarDir()
  const safeKey = documentKey.replace(/[/\\:*?"<>|]/g, '_')
  return path.join(dir, `${safeKey}.json`)
}

// ── Load / Save ────────────────────────────────────────────────────────

export function loadParagraphLayout(documentKey: string): ParagraphLayoutDocument | null {
  try {
    const filePath = getSidecarPath(documentKey)
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw) as ParagraphLayoutDocument
    // Basic validation
    if (!data.schemaVersion || !Array.isArray(data.paragraphOverrides)) return null
    return data
  } catch {
    return null
  }
}

export function saveParagraphLayout(
  documentKey: string,
  documentPath: string,
  overrides: ParagraphIndentOverrideRecord[],
): void {
  const dir = getSidecarDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const filePath = getSidecarPath(documentKey)
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

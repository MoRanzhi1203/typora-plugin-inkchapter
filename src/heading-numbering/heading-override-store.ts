/**
 * Heading Override Store — manages per-heading numbering overrides.
 *
 * Responsibilities:
 * - Generate stable structural fingerprints for headings
 * - Persist per-document overrides in plugin settings
 * - Resolve effective numbering mode for each heading
 * - Support batch and subtree operations
 * - Handle heading movement re-matching via fingerprint tolerance
 */

import type {
  HeadingLevel,
  HeadingNumberingOverride,
  HeadingNumberingOverrideMode,
  DocumentHeadingNumberingOverrides,
  UnnumberedCounterPolicy,
} from './heading-types'
import { generateHeadingFingerprint } from './heading-types'

/** Result of mode resolution including source info. */
export interface ResolvedMode {
  mode: HeadingNumberingOverrideMode
  source: 'manual' | 'batch' | 'name-rule' | 'default'
}

/** Lightweight heading node for override operations. */
export interface HeadingNodeInfo {
  level: HeadingLevel
  text: string
  /** DOM data-line attribute for matching. */
  dataLine: string | null
  /** Index among siblings of same level. */
  siblingIndex: number
}

/** Context for computing parent structure. */
export interface ParentStructure {
  /** Parent heading's data-line (null if top-level). */
  parentLine: string | null
  /** Stack of ancestor levels. */
  ancestorLevels: HeadingLevel[]
}

/**
 * Document-level override store managed per document path.
 */
export class HeadingOverrideStore {
  private docKey: string
  private overrides: Record<string, HeadingNumberingOverride>

  constructor(docKey: string, overrides?: Record<string, HeadingNumberingOverride>) {
    this.docKey = docKey
    this.overrides = overrides ?? {}
  }

  /** Get all overrides for serialization. */
  getAllOverrides(): Record<string, HeadingNumberingOverride> {
    return { ...this.overrides }
  }

  /** Get the serializable document overrides object. */
  toDocumentOverrides(): DocumentHeadingNumberingOverrides {
    return {
      documentKey: this.docKey,
      overrides: { ...this.overrides },
    }
  }

  /** Generate fingerprint for a heading using structural info. */
  static fingerprint(
    docKey: string,
    level: HeadingLevel,
    parent: ParentStructure,
    normalizedText: string,
  ): string {
    const parentKey = parent.parentLine ?? 'root'
    const ancestorPath = parent.ancestorLevels.join('.') || '0'
    return generateHeadingFingerprint(docKey, level, `${parentKey}:${ancestorPath}`, normalizedText)
  }

  /** Try to find an override by matching fingerprint or text similarity. */
  findOverride(
    level: HeadingLevel,
    fingerprint: string,
    text: string,
  ): HeadingNumberingOverride | undefined {
    // Direct match by fingerprint
    if (this.overrides[fingerprint]) return this.overrides[fingerprint]

    // Fallback: try text-based match (for headings that moved)
    const normalized = normalizeHeadingText(text)
    for (const [key, ov] of Object.entries(this.overrides)) {
      if (ov.headingKey.includes(`|${normalized}`)) {
        // Re-map: update override with new fingerprint
        const updated = { ...ov, headingKey: fingerprint, updatedAt: Date.now() }
        delete this.overrides[key]
        this.overrides[fingerprint] = updated
        return updated
      }
    }

    return undefined
  }

  /** Check if any ancestor in the tree has a subtree unnumbered override. */
  isUnderUnnumberedSubtree(
    level: HeadingLevel,
    fingerprint: string,
    parentFingerprints: string[],
  ): boolean {
    for (const pf of parentFingerprints) {
      const ov = this.overrides[pf]
      if (ov?.scope === 'subtree' && ov.mode === 'unnumbered') return true
    }
    return false
  }

  /** Resolve the effective mode for a heading. */
  resolveMode(
    level: HeadingLevel,
    fingerprint: string,
    parentFingerprints: string[],
    text: string,
    nameRules: Array<{ text: string; enabled: boolean }>,
    matchMode: 'exact' | 'trim' | 'loose',
    showLevelOneNumber: boolean,
  ): ResolvedMode {
    // 1. Check explicit self override
    const ov = this.findOverride(level, fingerprint, text)
    if (ov && ov.scope === 'self') {
      if (ov.mode !== 'inherit') return { mode: ov.mode, source: ov.source }
    }

    // 2. Check subtree override from parent
    if (this.isUnderUnnumberedSubtree(level, fingerprint, parentFingerprints)) {
      return { mode: 'unnumbered', source: 'manual' }
    }

    // 3. Check batch/name-rule overrides (those with scope='self' and non-inherit)
    if (ov && ov.mode !== 'inherit') {
      return { mode: ov.mode, source: ov.source }
    }

    // 4. H1 global switch: if H1 numbering is off, H1 is always unnumbered
    if (level === 1 && !showLevelOneNumber && ov?.mode !== 'numbered') {
      return { mode: 'unnumbered', source: 'default' }
    }

    // 5. Check name rules
    if (matchNameRule(text, nameRules, matchMode)) {
      return { mode: 'unnumbered', source: 'name-rule' }
    }

    // 6. Default: inherit
    return { mode: 'inherit', source: 'default' }
  }

  /** Set a single heading override. */
  setOverride(
    fingerprint: string,
    mode: HeadingNumberingOverrideMode,
    scope: 'self' | 'subtree',
    source: 'manual' | 'batch' | 'name-rule',
  ): void {
    this.overrides[fingerprint] = {
      headingKey: fingerprint,
      mode,
      scope,
      source,
      updatedAt: Date.now(),
    }
  }

  /** Remove an override for a heading. */
  removeOverride(fingerprint: string): void {
    delete this.overrides[fingerprint]
  }

  /** Batch set overrides for multiple fingerprints. */
  batchSetOverrides(
    fingerprints: string[],
    mode: HeadingNumberingOverrideMode,
    scope: 'self' | 'subtree',
    source: 'manual' | 'batch' | 'name-rule',
  ): void {
    const ts = Date.now()
    for (const fp of fingerprints) {
      this.overrides[fp] = {
        headingKey: fp,
        mode,
        scope,
        source,
        updatedAt: ts,
      }
    }
  }

  /** Clear all overrides for this document. */
  clearAll(): void {
    this.overrides = {}
  }

  /** Get count of overrides. */
  getOverrideCount(): number {
    return Object.keys(this.overrides).length
  }
}

// ── Utility ──────────────────────────────────────────────

/** Normalize heading text for matching. */
function normalizeHeadingText(text: string): string {
  return text
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）【】《》]/g, '')
    .toLowerCase()
    .slice(0, 60)
}

/** Check if heading text matches any name rule. */
export function matchNameRule(
  text: string,
  rules: Array<{ text: string; enabled: boolean }>,
  mode: 'exact' | 'trim' | 'loose',
): boolean {
  const clean = text.trim()
  for (const rule of rules) {
    if (!rule.enabled) continue
    const ruleText = rule.text

    switch (mode) {
      case 'exact':
        if (clean === ruleText) return true
        break
      case 'trim':
        if (clean.trim() === ruleText.trim()) return true
        break
      case 'loose':
        if (normalizeHeadingText(clean) === normalizeHeadingText(ruleText)) return true
        break
    }
  }
  return false
}

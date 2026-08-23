/**
 * Numbering Fast-Path Fingerprints (Phase 7R.3.4-C)
 *
 * Two lightweight fingerprints gate the full caption/formula pipeline:
 *
 *   1. headingSemanticFingerprint — ONLY canonical semantic fields that affect
 *      object numbering. snapshot `revision` is intentionally EXCLUDED.
 *   2. objectStructureFingerprint — canonical Figure/Table/Code/Formula
 *      business host identity + ordinal + type (document order). Rendered
 *      MathJax/SVG output nodes are NEVER part of this fingerprint.
 */

import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import type { FormulaTarget } from './formula-numbering-adapter'
import type { CaptionTarget } from './caption-dom-adapter'
import type { CaptionTargetType } from './caption-system'

/** Deterministic bounded string hash. */
export function fastHash(input: string): string {
  let h = 5381
  const s = input ?? ''
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `f${(h >>> 0).toString(36)}`
}

/**
 * Semantic fingerprint of the canonical heading snapshot. Includes ONLY fields
 * that change object numbering:
 *   stableIdentity, physicalLevel, effectiveDepth, semanticRole,
 *   chapterOrdinal, sectionOrdinal, structuralParent/Chapter/Section identity,
 *   counted.
 * Excludes: sourceRevision, debug path strings, transient DOM state.
 */
export function computeHeadingSemanticFingerprint(snapshot: HeadingNumberingSnapshot | null): string {
  if (!snapshot) return ''
  const parts: string[] = []
  for (const s of snapshot.semantic) {
    parts.push(
      `${s.stableIdentity}|${s.physicalLevel}|${s.effectiveDepth}|${s.semanticRole}|` +
      `${s.chapterOrdinal ?? '-'}|${s.sectionOrdinal ?? '-'}|` +
      `${s.structuralParentIdentity ?? '-'}|${s.structuralChapterIdentity ?? '-'}|` +
      `${s.structuralSectionIdentity ?? '-'}|${s.strictBoundaryIdentity ?? '-'}|` +
      `${s.counted ? 1 : 0}`,
    )
  }
  return fastHash(`${snapshot.documentKey}|${snapshot.structureMode}|${parts.join(';')}`)
}

export interface ObjectStructureFingerprintEntry {
  type: CaptionTargetType | 'formula'
  ordinal: number
  root: HTMLElement
}

export type ObjectStructureFingerprint = ObjectStructureFingerprintEntry[]

/** Build the canonical object-structure fingerprint (business hosts only). */
export function buildObjectStructureFingerprint(
  targets: CaptionTarget[],
  formulaTargets: FormulaTarget[],
): ObjectStructureFingerprint {
  const fp: ObjectStructureFingerprintEntry[] = []
  for (const t of targets) fp.push({ type: t.type, ordinal: t.ordinal, root: t.root })
  for (const t of formulaTargets) fp.push({ type: 'formula', ordinal: t.ordinal, root: t.root })
  return fp
}

/**
 * Structural equality: same entry count, same type/ordinal sequence, and the
 * SAME canonical host element references in the same order. Renderer output
 * nodes are not included, so renderer-only mutations cannot change this.
 */
export function objectStructureFingerprintEqual(
  a: ObjectStructureFingerprint,
  b: ObjectStructureFingerprint,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].ordinal !== b[i].ordinal || a[i].root !== b[i].root) return false
  }
  return true
}

/** Bounded diagnostic hash (element references are not hashable — for logging only). */
export function objectStructureFingerprintLabel(fp: ObjectStructureFingerprint): string {
  const parts = fp.map(e => `${e.type}@${e.ordinal}`)
  return parts.length <= 24 ? parts.join(',') : `${parts.slice(0, 24).join(',')}...`
}

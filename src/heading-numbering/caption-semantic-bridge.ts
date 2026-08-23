/**
 * Caption Semantic Bridge (Phase 6A) — the production authority that computes
 * Figure/Table/Code desired numbers from the canonical HeadingNumberingSnapshot
 * (semantic ordinals) plus the current semantic preset config.
 *
 * This is the replacement for the legacy production path that parsed rendered
 * heading numbers (`data-inkchapter-heading-number`, chapterFromHeadingNumber /
 * sectionFromHeadingNumber). Chapter/Section values now come ONLY from
 * `HeadingNumberingSnapshot.semantic`.
 *
 * Formula projection remains FROZEN (Phase 7); the shared type accepts `formula`
 * but Phase 6 production must not rewrite Formula DOM.
 */

import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import { resolveCaptionScope } from './caption-scope-resolver'
import { formatObjectNumber, presetToScopeStyle, type NumberingPreset, type ObjectNumberingPreset } from './numbering-preset-formatter'
import { buildObjectNumberingLabel, renderNumberTemplate, type ObjectNumberingConfig } from './object-numbering-engine'
import { buildObjectSemanticScopeIdentity, objectScopeKey, type ObjectSemanticScopeIdentity } from './object-semantic-scope'
import type { CaptionScope } from './semantic-heading-types'
import { chapterScopeIdentityOf, sectionScopeIdentityOf } from './semantic-heading-types'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type ProductionObjectKind = 'figure' | 'table' | 'code'

export interface CaptionObjectEntry {
  stableIdentity: string
  objectKind: ProductionObjectKind
  /** Canonical stable identity of the nearest preceding heading (NOT a raw index). */
  precedingHeadingStableIdentity: string | null
  name?: string
  // ── Phase 7R.3.7 boundary provenance (optional; falls back to the semantic
  //    snapshot lookup by precedingHeadingStableIdentity) ────────────────
  structureMode?: 'strict' | 'loose'
  strictBoundaryIdentity?: string | null
  structuralChapterIdentity?: string | null
  structuralSectionIdentity?: string | null
  chapterOrdinal?: number | null
  sectionOrdinal?: number | null
}

export interface ProductionDesiredCaptionState {
  documentKey: string
  revision: number
  stableIdentity: string
  objectKind: ProductionObjectKind
  requestedScope: CaptionScope
  effectiveScope: CaptionScope
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  scopeKey: string
  ordinal: number
  rawNumber: string
  renderedLabel: string
  resolutionStatus: 'exact' | 'degraded'
  // ── Phase 7R.3.7 boundary provenance ──────────────────────────────────
  strictBoundaryIdentity: string | null
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
}

export type ProductionObjectConfigs = Record<ProductionObjectKind, ObjectNumberingConfig>

function requestedScopeForPreset(preset: ObjectNumberingPreset, legacyTemplate?: string): CaptionScope {
  if (preset === 'legacy-custom') {
    const t = legacyTemplate ?? ''
    if (t.includes('{section}')) return 'section'
    if (t.includes('{chapter}')) return 'chapter'
    return 'global'
  }
  return presetToScopeStyle(preset as NumberingPreset).requestedScope
}

/**
 * Full-logical recompute of production Figure/Table/Code desired states from
 * the current heading snapshot + ordered object snapshot + preset configs.
 *
 * Ordinals are derived from current document order (independent per object kind
 * and effective semantic scope). Formatting uses the EFFECTIVE scope (after
 * SECTION→CHAPTER→GLOBAL degradation), never the requested preset scope, so a
 * degraded SECTION never renders a fabricated zero section level.
 *
 * Phase 7R.3.7: counter grouping uses the shared boundary-aware scope identity
 * (strict mode: boundary + structural identities), so the same visible raw
 * number across two H1 boundaries belongs to two different scope keys.
 */
export function computeProductionDesiredCaptionStates(
  snapshot: HeadingNumberingSnapshot,
  objects: readonly CaptionObjectEntry[],
  configs: ProductionObjectConfigs,
): ProductionDesiredCaptionState[] {
  const semantic = snapshot.semantic
  const semanticByIdentity = new Map(semantic.map(s => [s.stableIdentity, s]))
  const counters = new Map<string, number>()
  const results: ProductionDesiredCaptionState[] = []

  for (const obj of objects) {
    const config = configs[obj.objectKind]
    if (!config || !config.enabled) continue

    const preset: ObjectNumberingPreset = config.preset ?? 'global'
    const precedingHeading = obj.precedingHeadingStableIdentity
      ? semanticByIdentity.get(obj.precedingHeadingStableIdentity)
      : undefined
    // Phase 7R.3.7: explicit boundary provenance wins; otherwise fall back to
    // the canonical semantic snapshot lookup (backward-compatible shape).
    const chapterOrdinal = obj.chapterOrdinal !== undefined ? obj.chapterOrdinal : (precedingHeading?.chapterOrdinal ?? null)
    const sectionOrdinal = obj.sectionOrdinal !== undefined ? obj.sectionOrdinal : (precedingHeading?.sectionOrdinal ?? null)
    const strictBoundaryIdentity = obj.strictBoundaryIdentity !== undefined
      ? obj.strictBoundaryIdentity
      : (precedingHeading?.strictBoundaryIdentity ?? null)
    // Phase 7R.3.7: fallback uses self-or-ancestor scope identities so objects
    // under the first H2 of a boundary group by that H2 (not "no-chapter").
    const structuralChapterIdentity = obj.structuralChapterIdentity !== undefined
      ? obj.structuralChapterIdentity
      : (precedingHeading ? chapterScopeIdentityOf(precedingHeading) : null)
    const structuralSectionIdentity = obj.structuralSectionIdentity !== undefined
      ? obj.structuralSectionIdentity
      : (precedingHeading ? sectionScopeIdentityOf(precedingHeading) : null)
    const structureMode = obj.structureMode ?? snapshot.structureMode

    const requestedScope = requestedScopeForPreset(preset, config.template)
    const scope = resolveCaptionScope(requestedScope, chapterOrdinal, sectionOrdinal)

    const scopeIdentity = buildObjectSemanticScopeIdentity({
      mode: structureMode,
      strictBoundaryIdentity,
      effectiveScope: scope.effectiveScope,
      structuralChapterIdentity,
      structuralSectionIdentity,
      chapterOrdinal: scope.chapter,
      sectionOrdinal: scope.section,
    })
    const scopeKey = objectScopeKey(obj.objectKind, scopeIdentity)
    const ordinal = (counters.get(scopeKey) ?? 0) + 1
    counters.set(scopeKey, ordinal)

    const effectiveOrdinal = (config.startAt ?? 1) + ordinal - 1
    let rawNumber: string
    if (preset === 'legacy-custom') {
      rawNumber = renderNumberTemplate(config.template ?? '{n}', {
        n: String(effectiveOrdinal).padStart(Math.max(1, config.minDigits ?? 1), '0'),
        chapter: String(scope.chapter ?? 0),
        section: String(scope.section ?? 0),
      })
    } else {
      const { style } = presetToScopeStyle(preset as NumberingPreset)
      rawNumber = formatObjectNumber(scope.effectiveScope, style, scope.chapter, scope.section, effectiveOrdinal, config.minDigits ?? 1)
    }

    const renderedLabel = buildObjectNumberingLabel(config.prefix, rawNumber, obj.name ?? '')

    emitRuntimeAudit('RUNTIME-CODEPATH', {
      site: 'CAPTION_SEMANTIC_BRIDGE',
      targetType: obj.objectKind,
      documentKey: snapshot.documentKey,
      revision: snapshot.revision,
      preset,
      requestedScope,
      effectiveScope: scope.effectiveScope,
      chapterOrdinal: scope.chapter ?? null,
      sectionOrdinal: scope.section ?? null,
      strictBoundaryIdentity,
      structuralChapterIdentity,
      structuralSectionIdentity,
      scopeKey,
      ordinal,
      rawNumber,
    })

    emitRuntimeAudit('OBJECT-SEMANTIC-SCOPE-IDENTITY', {
      objectKind: obj.objectKind,
      runtimeKey: obj.stableIdentity,
      strictBoundaryIdentity,
      effectiveScope: scope.effectiveScope,
      structuralChapterIdentity,
      structuralSectionIdentity,
      chapterOrdinal: scope.chapter,
      sectionOrdinal: scope.section,
      scopeKey,
    })

    results.push({
      documentKey: snapshot.documentKey,
      revision: snapshot.revision,
      stableIdentity: obj.stableIdentity,
      objectKind: obj.objectKind,
      requestedScope,
      effectiveScope: scope.effectiveScope,
      chapterOrdinal: scope.chapter,
      sectionOrdinal: scope.section,
      scopeKey,
      ordinal,
      rawNumber,
      renderedLabel,
      resolutionStatus: scope.degraded ? 'degraded' : 'exact',
      strictBoundaryIdentity,
      structuralChapterIdentity,
      structuralSectionIdentity,
    })
  }

  return results
}

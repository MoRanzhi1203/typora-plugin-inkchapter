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
import type { CaptionScope } from './semantic-heading-types'

export type ProductionObjectKind = 'figure' | 'table' | 'code'

export interface CaptionObjectEntry {
  stableIdentity: string
  objectKind: ProductionObjectKind
  /** Number of headings (in snapshot order) that precede this object in document order. */
  precedingHeadingCount: number
  name?: string
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
}

export type ProductionObjectConfigs = Record<ProductionObjectKind, ObjectNumberingConfig>

function buildScopeKey(
  kind: ProductionObjectKind,
  scope: CaptionScope,
  chapter: number | null,
  section: number | null,
): string {
  if (scope === 'global') return `${kind}:global`
  if (scope === 'chapter') return `${kind}:chapter:${chapter ?? 0}`
  return `${kind}:section:${chapter ?? 0}.${section ?? 0}`
}

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
 */
export function computeProductionDesiredCaptionStates(
  snapshot: HeadingNumberingSnapshot,
  objects: readonly CaptionObjectEntry[],
  configs: ProductionObjectConfigs,
): ProductionDesiredCaptionState[] {
  const semantic = snapshot.semantic
  const counters = new Map<string, number>()
  const results: ProductionDesiredCaptionState[] = []

  for (const obj of objects) {
    const config = configs[obj.objectKind]
    if (!config || !config.enabled) continue

    const preset: ObjectNumberingPreset = config.preset ?? 'global'
    const precedingHeading = obj.precedingHeadingCount > 0
      ? semantic[obj.precedingHeadingCount - 1]
      : undefined
    const chapterOrdinal = precedingHeading?.chapterOrdinal ?? null
    const sectionOrdinal = precedingHeading?.sectionOrdinal ?? null

    const requestedScope = requestedScopeForPreset(preset, config.template)
    const scope = resolveCaptionScope(requestedScope, chapterOrdinal, sectionOrdinal)

    const scopeKey = buildScopeKey(obj.objectKind, scope.effectiveScope, scope.chapter, scope.section)
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
    })
  }

  return results
}

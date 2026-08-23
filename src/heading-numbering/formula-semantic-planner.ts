/**
 * Formula Semantic Planner (Phase 7) — PURE computation of Formula semantic
 * scope / ordinal / raw number / display number from canonical semantic heading
 * states (chapterOrdinal / sectionOrdinal) plus the canonical object-number
 * preset config.
 *
 * This is the ONLY place that maps semantic state → Formula number. It reuses
 * the shared scope resolver and the shared standard preset formatter — it does
 * NOT parse DOM heading numbers, visible labels, or physical H levels.
 *
 * Formula ordinal counter is independent from Figure/Table/Code (scopeKey
 * carries the `formula:` kind prefix).
 */

import { resolveCaptionScope } from './caption-scope-resolver'
import { formatObjectNumber, presetToScopeStyle, type NumberingPreset, type ObjectNumberingPreset } from './numbering-preset-formatter'
import { renderNumberTemplate, formatSequenceNumber, type ObjectNumberingConfig } from './object-numbering-engine'
import { buildObjectSemanticScopeIdentity, objectScopeKey } from './object-semantic-scope'
import type { CaptionScope } from './semantic-heading-types'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

/** Canonical semantic heading state consumed by a single Formula (document order). */
export interface FormulaSemanticContext {
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  // ── Phase 7R.3.7 boundary provenance (optional; loose default) ────────
  mode?: 'strict' | 'loose'
  strictBoundaryIdentity?: string | null
  structuralChapterIdentity?: string | null
  structuralSectionIdentity?: string | null
}

export interface FormulaSemanticPlanEntry {
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  requestedScope: CaptionScope
  effectiveScope: CaptionScope
  ordinal: number
  rawNumber: string
  renderedNumber: string
  // ── Phase 7R.3.7 boundary provenance (consumed by projection signature) ─
  strictBoundaryIdentity: string | null
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
}

/** Requested Formula scope from the canonical preset (shared contract). */
export function requestedScopeForFormulaPreset(preset: ObjectNumberingPreset, legacyTemplate?: string): CaptionScope {
  if (preset === 'legacy-custom') {
    const t = legacyTemplate ?? ''
    if (t.includes('{section}')) return 'section'
    if (t.includes('{chapter}')) return 'chapter'
    return 'global'
  }
  return presetToScopeStyle(preset as NumberingPreset).requestedScope
}

/**
 * Plan Formula numbers for every formula in current document order.
 * `startAt` applies to Formula `{n}` inside each effective scope;
 * `minDigits` pads only the Formula `{n}`.
 */
export function planFormulaSemanticNumbers(
  formulas: readonly FormulaSemanticContext[],
  config: ObjectNumberingConfig,
): FormulaSemanticPlanEntry[] {
  const preset: ObjectNumberingPreset = config.preset ?? 'global'
  const counters = new Map<string, number>()

  return formulas.map((f, fi) => {
    const requestedScope = requestedScopeForFormulaPreset(preset, config.template)
    const scope = resolveCaptionScope(requestedScope, f.chapterOrdinal, f.sectionOrdinal)
    const mode = f.mode ?? 'loose'
    const strictBoundaryIdentity = f.strictBoundaryIdentity ?? null
    const structuralChapterIdentity = f.structuralChapterIdentity ?? null
    const structuralSectionIdentity = f.structuralSectionIdentity ?? null
    // Phase 7R.3.7: shared boundary-aware scope identity — two H1 boundaries
    // with the same visible ordinal produce DIFFERENT scope keys in strict mode.
    const scopeIdentity = buildObjectSemanticScopeIdentity({
      mode,
      strictBoundaryIdentity,
      effectiveScope: scope.effectiveScope,
      structuralChapterIdentity,
      structuralSectionIdentity,
      chapterOrdinal: scope.chapter,
      sectionOrdinal: scope.section,
    })
    const scopeKey = objectScopeKey('formula', scopeIdentity)
    const ordinal = (counters.get(scopeKey) ?? 0) + 1
    counters.set(scopeKey, ordinal)
    const effectiveOrdinal = (config.startAt ?? 1) + ordinal - 1

    let rawNumber: string
    if (preset === 'legacy-custom') {
      rawNumber = renderNumberTemplate(config.template ?? '({n})', {
        n: formatSequenceNumber(effectiveOrdinal, config.numberStyle, config.minDigits),
        chapter: String(scope.chapter ?? 0),
        section: String(scope.section ?? 0),
      })
    } else {
      const { style } = presetToScopeStyle(preset as NumberingPreset)
      rawNumber = formatObjectNumber(scope.effectiveScope, style, scope.chapter, scope.section, effectiveOrdinal, config.minDigits ?? 1)
    }

    emitRuntimeAudit('OBJECT-SEMANTIC-SCOPE-IDENTITY', {
      objectKind: 'formula',
      runtimeKey: `formula:${fi + 1}`,
      strictBoundaryIdentity,
      effectiveScope: scope.effectiveScope,
      structuralChapterIdentity,
      structuralSectionIdentity,
      chapterOrdinal: scope.chapter,
      sectionOrdinal: scope.section,
      scopeKey,
    })

    return {
      chapterOrdinal: scope.chapter ?? null,
      sectionOrdinal: scope.section ?? null,
      requestedScope,
      effectiveScope: scope.effectiveScope,
      ordinal,
      rawNumber,
      // Standard presets: wrapper owns parentheses. legacy-custom: the template
      // already contains the wrapper (e.g. ({chapter}.{section}.{n})) — no extra.
      renderedNumber: preset === 'legacy-custom' ? rawNumber : `(${rawNumber})`,
      strictBoundaryIdentity,
      structuralChapterIdentity,
      structuralSectionIdentity,
    }
  })
}

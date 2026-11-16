/**
 * Unified Ordinal Engine — shared, pure computation of Desired Number State for
 * all four object kinds (figure/table/formula/code).
 *
 * This is a FULL_RECOMPUTE_REFERENCE_ENGINE: it deterministically derives the
 * desired numbering state from the current document state. It is NOT yet an
 * incremental-vs-full oracle closure (that requires the future runtime
 * coordinator).
 *
 * Authority chain (no DOM, no rendered-number reads):
 *
 *   ordered blocks → canonical semantic heading states (heading-numbering
 *                    authority, effective-depth ordinals)
 *                  → per-object chapter/section context
 *                  → requested scope → effective scope (with degrade)
 *                  → effectiveScopeKey (kind + scope + chapter/section)
 *                  → ordinal = 1 + count(previous same effectiveScopeKey)
 *                  → formatted number (five presets)
 */

import type {
  CaptionObjectKind,
  CaptionScope,
  HeadingLevel,
  NumberingStyle,
  SemanticHeadingNumberState,
} from './semantic-heading-types'
import { resolveCaptionScope } from './caption-scope-resolver'
import { formatObjectNumber, presetToScopeStyle, type NumberingPreset } from './numbering-preset-formatter'
import {
  displayPrefixForPreset,
  formatObjectNumberFromComponents,
  formatObjectScopeNumber,
  resolveDisplayPrefixScope,
  resolveObjectNumberScope,
  type ObjectNumberingScopeConfig,
} from './object-scope-config'

export interface ObjectNumberingRule {
  enabled: boolean
  prefix: string
  preset: NumberingPreset
  /** R12: explicit reset/prefix scope. Absent = legacy preset degradation. */
  scope?: ObjectNumberingScopeConfig
}

export type ObjectNumberingRules = Record<CaptionObjectKind, ObjectNumberingRule>

export interface HeadingBlock {
  kind: 'heading'
  key: string
  level: HeadingLevel
  text: string
}

export interface ObjectBlock {
  kind: 'object'
  stableIdentity: string
  objectKind: CaptionObjectKind
}

export type NumberingBlock = HeadingBlock | ObjectBlock

export interface DesiredCaptionNumberState {
  stableIdentity: string
  objectKind: CaptionObjectKind
  requestedScope: CaptionScope
  effectiveScope: CaptionScope
  chapter: number | null
  section: number | null
  scopeKey: string
  ordinal: number
  numberingStyle: NumberingStyle
  formattedNumber: string
  resolutionStatus: 'exact' | 'degraded'
  revision: number
}

function buildScopeKey(
  kind: CaptionObjectKind,
  scope: CaptionScope,
  chapter: number | null,
  section: number | null,
): string {
  if (scope === 'global') return `${kind}:global`
  if (scope === 'chapter') return `${kind}:chapter:${chapter ?? 0}`
  return `${kind}:section:${chapter ?? 0}.${section ?? 0}`
}

/**
 * Compute the full Desired Number State for a document represented as an
 * ordered block sequence.
 *
 * @param semanticStates Canonical semantic heading number states from the
 *   heading-numbering authority (via `computeSemanticHeadingNumbers`), keyed by
 *   `stableIdentity` (heading `key`). This is the ONLY heading number source
 *   consumed here — never physical counters, DOM text, or sidebar text.
 *
 * Only enabled object kinds produce entries and participate in their ordinal
 * sequence.
 */
export function computeDesiredNumberState(
  blocks: readonly NumberingBlock[],
  rules: ObjectNumberingRules,
  revision: number,
  semanticStates: readonly SemanticHeadingNumberState[],
): DesiredCaptionNumberState[] {
  const nodeByKey = new Map(semanticStates.map(n => [n.stableIdentity, n]))

  let currentChapter: number | null = null
  let currentSection: number | null = null
  let currentHeadingState: SemanticHeadingNumberState | null = null
  const counters = new Map<string, number>()
  const results: DesiredCaptionNumberState[] = []

  for (const block of blocks) {
    if (block.kind === 'heading') {
      const node = nodeByKey.get(block.key)
      if (!node) continue
      currentChapter = node.chapterOrdinal
      currentSection = node.sectionOrdinal
      currentHeadingState = node
      continue
    }

    const rule = rules[block.objectKind]
    if (!rule || !rule.enabled) continue

    // R12: explicit physical reset/prefix scope, never degraded by a missing H3.
    const explicitRuleScope = rule.scope
      ? resolveObjectNumberScope(block.objectKind, rule, currentHeadingState, nodeByKey)
      : null
    if (explicitRuleScope) {
      const ordinal = (counters.get(explicitRuleScope.scopeKey) ?? 0) + 1
      counters.set(explicitRuleScope.scopeKey, ordinal)
      const componentCount = explicitRuleScope.prefixComponents.length
      results.push({
        stableIdentity: block.stableIdentity,
        objectKind: block.objectKind,
        requestedScope: componentCount === 0 ? 'global' : componentCount === 1 ? 'chapter' : 'section',
        effectiveScope: componentCount === 0 ? 'global' : componentCount === 1 ? 'chapter' : 'section',
        chapter: explicitRuleScope.prefixComponents[0] ?? null,
        section: componentCount > 1 ? explicitRuleScope.prefixComponents[componentCount - 1] : null,
        scopeKey: explicitRuleScope.scopeKey,
        ordinal,
        numberingStyle: explicitRuleScope.style,
        formattedNumber: formatObjectScopeNumber(explicitRuleScope, ordinal),
        resolutionStatus: explicitRuleScope.missingRequestedLevel ? 'degraded' : 'exact',
        revision,
      })
      continue
    }

    const { requestedScope, style } = presetToScopeStyle(rule.preset)

    // R12 — standard presets follow the heading's VISIBLE number path.
    const presetSpec = displayPrefixForPreset(rule.preset)
    const displayScope = presetSpec
      ? resolveDisplayPrefixScope(block.objectKind, presetSpec.componentCount, presetSpec.style, currentHeadingState, nodeByKey)
      : null
    if (displayScope) {
      const ordinal = (counters.get(displayScope.scopeKey) ?? 0) + 1
      counters.set(displayScope.scopeKey, ordinal)
      const componentCount = displayScope.components.length
      results.push({
        stableIdentity: block.stableIdentity,
        objectKind: block.objectKind,
        requestedScope,
        effectiveScope: componentCount === 0 ? 'global' : componentCount === 1 ? 'chapter' : 'section',
        chapter: displayScope.components[0] ?? null,
        section: componentCount > 1 ? displayScope.components[1] : null,
        scopeKey: displayScope.scopeKey,
        ordinal,
        numberingStyle: displayScope.style,
        formattedNumber: formatObjectNumberFromComponents(displayScope.components, displayScope.style, ordinal),
        resolutionStatus: displayScope.degraded ? 'degraded' : 'exact',
        revision,
      })
      continue
    }

    const scope = resolveCaptionScope(requestedScope, currentChapter, currentSection)

    const scopeKey = buildScopeKey(block.objectKind, scope.effectiveScope, scope.chapter, scope.section)
    const ordinal = (counters.get(scopeKey) ?? 0) + 1
    counters.set(scopeKey, ordinal)

    results.push({
      stableIdentity: block.stableIdentity,
      objectKind: block.objectKind,
      requestedScope,
      effectiveScope: scope.effectiveScope,
      chapter: scope.chapter,
      section: scope.section,
      scopeKey,
      ordinal,
      numberingStyle: style,
      formattedNumber: formatObjectNumber(
        scope.effectiveScope,
        style,
        scope.chapter,
        scope.section,
        ordinal,
      ),
      resolutionStatus: scope.degraded ? 'degraded' : 'exact',
      revision,
    })
  }

  return results
}

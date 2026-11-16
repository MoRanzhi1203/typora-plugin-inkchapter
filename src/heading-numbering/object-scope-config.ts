/**
 * R12 — Unified object numbering scope (figure / table / code / formula).
 *
 * Three INDEPENDENT concepts are kept separate:
 *
 *   1. resetLevel  — when the object ordinal restarts (document / H1–H6);
 *   2. prefixLevel — which physical heading number is displayed as prefix
 *                    (`none` = no prefix / document-continuous);
 *   3. missingLevelPolicy — what to do when NO heading at the requested level
 *                    exists on the object's ancestor chain.
 *
 * This module NEVER decides chapter/section from DOM text. It consumes the
 * canonical semantic heading states (`physicalPathByLevel` + structural parent
 * links) produced by the heading-numbering authority.
 *
 * Backward compatibility: `scope` is OPTIONAL on `ObjectNumberingConfig`.
 * A config that never touched the new controls keeps the legacy preset path
 * (`resolveCaptionScope` with its SECTION→CHAPTER→GLOBAL degradation), so a
 * saved document's numbering result is never silently changed.
 */

import type { ObjectNumberingPreset } from './numbering-preset-formatter'
import type {
  CaptionObjectKind,
  HeadingLevel,
  NumberingStyle,
  SemanticHeadingNumberState,
} from './semantic-heading-types'
import {
  ancestorAtPhysicalLevel,
  headingAncestorChain,
  nearestNumberedAncestorBelowLevel,
} from './semantic-heading-types'

export type ObjectScopeResetLevel = 'document' | 1 | 2 | 3 | 4 | 5 | 6
export type ObjectScopePrefixLevel = 'none' | 1 | 2 | 3 | 4 | 5 | 6
export type ObjectMissingLevelPolicy = 'nearest-ancestor' | 'document' | 'diagnostic'

export interface ObjectNumberingScopeConfig {
  /** Counter reset boundary. */
  resetLevel: ObjectScopeResetLevel
  /** Heading number prefix level. `none` = document-continuous number only. */
  prefixLevel: ObjectScopePrefixLevel
  /** Separator style for the prefix / ordinal join. */
  style: NumberingStyle
  /** Behaviour when the requested level is absent on the ancestor chain. */
  missingLevelPolicy: ObjectMissingLevelPolicy
}

export const OBJECT_SCOPE_MISSING_LEVEL_CODE = 'OBJECT_NUMBER_SCOPE_MISSING_LEVEL'

function isScopeLevel(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6
}

export function normalizeObjectNumberingScope(value: unknown): ObjectNumberingScopeConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const resetLevel = raw.resetLevel === 'document' || isScopeLevel(raw.resetLevel)
    ? (raw.resetLevel as ObjectScopeResetLevel)
    : 'document'
  const prefixLevel = raw.prefixLevel === 'none' || isScopeLevel(raw.prefixLevel)
    ? (raw.prefixLevel as ObjectScopePrefixLevel)
    : 'none'
  const style: NumberingStyle = raw.style === 'dash' ? 'dash' : 'dot'
  const missingLevelPolicy: ObjectMissingLevelPolicy =
    raw.missingLevelPolicy === 'document' || raw.missingLevelPolicy === 'diagnostic'
      ? raw.missingLevelPolicy
      : 'nearest-ancestor'
  return { resetLevel, prefixLevel, style, missingLevelPolicy }
}

/** Minimal config shape consumed here (structural — never the full engine type). */
export interface ObjectScopeConfigCarrier {
  scope?: ObjectNumberingScopeConfig
}

/** The explicit scope of a config, or `undefined` when the legacy preset path is active. */
export function objectScopeConfigOf(config: ObjectScopeConfigCarrier | null | undefined): ObjectNumberingScopeConfig | undefined {
  return normalizeObjectNumberingScope(config?.scope)
}

/** UI helper — equivalent explicit scope for a legacy preset (display only). */
export function scopeConfigFromPreset(preset: ObjectNumberingPreset): ObjectNumberingScopeConfig {
  switch (preset) {
    case 'global': return { resetLevel: 'document', prefixLevel: 'none', style: 'dot', missingLevelPolicy: 'nearest-ancestor' }
    case 'chapter-dot': return { resetLevel: 1, prefixLevel: 1, style: 'dot', missingLevelPolicy: 'nearest-ancestor' }
    case 'section-dot': return { resetLevel: 2, prefixLevel: 2, style: 'dot', missingLevelPolicy: 'nearest-ancestor' }
    case 'chapter-dash': return { resetLevel: 1, prefixLevel: 1, style: 'dash', missingLevelPolicy: 'nearest-ancestor' }
    case 'section-dash': return { resetLevel: 2, prefixLevel: 2, style: 'dash', missingLevelPolicy: 'nearest-ancestor' }
    case 'legacy-custom': return { resetLevel: 'document', prefixLevel: 'none', style: 'dot', missingLevelPolicy: 'nearest-ancestor' }
  }
}

export interface ObjectScopeResolution {
  /** Canonical counter grouping key (per object kind + reset identity). */
  scopeKey: string
  /** Dense prefix ordinals (H1…prefixLevel, null slots removed). */
  prefixComponents: readonly number[]
  /** Prefix level actually used (null = no prefix). */
  prefixLevel: HeadingLevel | null
  /** Prefix level requested by the config (null = none). */
  requestedPrefixLevel: HeadingLevel | null
  /** Whether the requested prefix/reset level was absent on the ancestor chain. */
  missingRequestedLevel: boolean
  fallback: 'none' | 'nearest-ancestor' | 'document'
  style: NumberingStyle
  /** Diagnostic payload when `missingLevelPolicy === 'diagnostic'`. */
  diagnostic: { code: string; level: HeadingLevel; message: string } | null
}

/**
 * R12 — display-aligned prefix scope for the standard legacy presets.
 *
 * A preset asks for "chapter" (1 component) or "section" (2 components). The
 * components come from the bound heading's canonical PHYSICAL display path, so
 * the object prefix always follows the heading number that is actually shown
 * (skipped levels, unnumbered ancestors, custom start/restart rules included).
 */
export interface ObjectDisplayScope {
  scopeKey: string
  components: readonly number[]
  style: NumberingStyle
  componentCount: number
  degraded: boolean
}

function valuePathOf(node: SemanticHeadingNumberState): readonly (number | null)[] | null {
  return node.physicalPathByLevel ?? null
}

/** Canonical path only — required for display-aligned prefix scopes. */
function canonicalPathOf(node: SemanticHeadingNumberState): readonly (number | null)[] | null {
  return node.physicalPathCanonical === true ? node.physicalPathByLevel ?? null : null
}

function hasVisibleNumberAtLevel(node: SemanticHeadingNumberState, level: HeadingLevel): boolean {
  const path = valuePathOf(node)
  if (path) return (path[level - 1] ?? null) != null
  return node.logicalOrdinal != null
}

/**
 * Standard preset → prefix component count + separator style.
 * `null` means the legacy template path (never display-aligned).
 */
export function displayPrefixForPreset(
  preset: ObjectNumberingPreset,
): { componentCount: number; style: NumberingStyle } | null {
  switch (preset) {
    case 'global': return { componentCount: 0, style: 'dot' }
    case 'chapter-dot': return { componentCount: 1, style: 'dot' }
    case 'section-dot': return { componentCount: 2, style: 'dot' }
    case 'chapter-dash': return { componentCount: 1, style: 'dash' }
    case 'section-dash': return { componentCount: 2, style: 'dash' }
    case 'legacy-custom': return null
  }
}

/**
 * Resolve the standard-preset prefix from the heading display path.
 * Returns `null` when the state has no canonical path (legacy fixtures).
 */
export function resolveDisplayPrefixScope(
  kind: CaptionObjectKind,
  componentCount: number,
  style: NumberingStyle,
  state: SemanticHeadingNumberState | null,
  byIdentity: ReadonlyMap<string, SemanticHeadingNumberState>,
): ObjectDisplayScope | null {
  if (!state) {
    return {
      scopeKey: `${kind}:display:document`,
      components: [],
      style,
      componentCount,
      degraded: componentCount > 0,
    }
  }
  const path = canonicalPathOf(state)
  if (!path) return null
  const dense: Array<{ level: number; value: number }> = []
  for (let level = 1; level <= 6; level++) {
    const value = path[level - 1]
    if (typeof value === 'number' && value > 0) dense.push({ level, value })
  }
  const selected = dense.slice(0, Math.max(0, componentCount))
  const components = selected.map(entry => entry.value)

  // Counter grouping identity = the heading that supplied the LAST component.
  let identity = 'document'
  const last = selected[selected.length - 1]
  if (last) {
    const chain = headingAncestorChain(state, byIdentity)
    const owner = chain.find(node => node.physicalLevel === last.level && hasVisibleNumberAtLevel(node, last.level as HeadingLevel))
    identity = owner?.stableIdentity ?? 'document'
  }

  return {
    scopeKey: `${kind}:display:${state?.strictBoundaryIdentity ?? 'no-boundary'}:${identity}`,
    components,
    style,
    componentCount,
    degraded: components.length < componentCount,
  }
}

function pathOf(node: SemanticHeadingNumberState, level: number): number[] {
  const path = valuePathOf(node)
  if (path) {
    return path.slice(0, level).filter((v): v is number => typeof v === 'number' && v > 0)
  }
  return node.logicalOrdinal != null ? [node.logicalOrdinal] : []
}

function resetIdentityOf(
  chain: readonly SemanticHeadingNumberState[],
  level: HeadingLevel,
  policy: ObjectMissingLevelPolicy,
): string {
  const exact = ancestorAtPhysicalLevel(chain, level)
  if (exact && hasVisibleNumberAtLevel(exact, level)) return exact.stableIdentity
  if (policy === 'document') return 'document'
  const nearest = nearestNumberedAncestorBelowLevel(chain, level)
  return nearest?.stableIdentity ?? 'document'
}

/**
 * Resolve the explicit scope of an object. Returns `null` when the config has
 * no explicit scope (legacy preset path must be used by the caller).
 */
export function resolveObjectNumberScope(
  kind: CaptionObjectKind,
  config: ObjectScopeConfigCarrier | null | undefined,
  state: SemanticHeadingNumberState | null,
  byIdentity: ReadonlyMap<string, SemanticHeadingNumberState>,
): ObjectScopeResolution | null {
  const scope = objectScopeConfigOf(config)
  if (!scope) return null

  if (!state) {
    // No bound heading (genuinely before the first heading / no headings):
    // a single document-wide sequence with no prefix. This is a stable state,
    // never a fabricated chapter.
    return {
      scopeKey: `${kind}:scope:document`,
      prefixComponents: [],
      prefixLevel: null,
      requestedPrefixLevel: scope.prefixLevel === 'none' ? null : scope.prefixLevel,
      missingRequestedLevel: scope.prefixLevel !== 'none',
      fallback: 'document',
      style: scope.style,
      diagnostic: null,
    }
  }

  const chain = headingAncestorChain(state, byIdentity)

  // ── Reset boundary ───────────────────────────────────────────────
  const resetKey = scope.resetLevel === 'document'
    ? 'document'
    : resetIdentityOf(chain, scope.resetLevel, scope.missingLevelPolicy)
  const scopeKey = `${kind}:scope:${resetKey}`

  // ── Prefix path ──────────────────────────────────────────────────
  const requested = scope.prefixLevel === 'none' ? null : scope.prefixLevel
  let prefixComponents: number[] = []
  let prefixLevel: HeadingLevel | null = null
  let missing = false
  let fallback: ObjectScopeResolution['fallback'] = 'none'

  if (requested != null) {
    const exact = ancestorAtPhysicalLevel(chain, requested)
    if (exact && hasVisibleNumberAtLevel(exact, requested)) {
      prefixComponents = pathOf(exact, requested)
      prefixLevel = requested
    } else {
      missing = true
      if (scope.missingLevelPolicy === 'document') {
        fallback = 'document'
      } else {
        const nearest = nearestNumberedAncestorBelowLevel(chain, requested)
        if (nearest) {
          prefixComponents = pathOf(nearest, nearest.physicalLevel)
          prefixLevel = nearest.physicalLevel as HeadingLevel
          fallback = 'nearest-ancestor'
        } else {
          // No shallower numbered ancestor: keep the bound heading's own visible
          // components (e.g. a document that starts at H3). Never drops to an
          // empty prefix while the heading itself is visibly numbered.
          prefixComponents = pathOf(state, state.physicalLevel)
          prefixLevel = state.physicalLevel
          fallback = prefixComponents.length > 0 ? 'nearest-ancestor' : 'document'
        }
      }
    }
  }

  const diagnostic = missing && scope.missingLevelPolicy === 'diagnostic' && requested != null
    ? {
        code: OBJECT_SCOPE_MISSING_LEVEL_CODE,
        level: requested,
        message: `对象所在标题路径缺少 H${requested} 层级，编号作用域无法完整解析。`,
      }
    : null

  return {
    scopeKey,
    prefixComponents,
    prefixLevel,
    requestedPrefixLevel: requested,
    missingRequestedLevel: missing,
    fallback,
    style: scope.style,
    diagnostic,
  }
}

/**
 * Format the raw object number for an explicit scope resolution.
 * `prefix.dot.ordinal` for dot style; `prefix-k` for dash style.
 */
export function formatObjectScopeNumber(
  resolution: ObjectScopeResolution,
  ordinal: number,
  minDigits = 1,
): string {
  return formatObjectNumberFromComponents(resolution.prefixComponents, resolution.style, ordinal, minDigits)
}

/** R12 — format a raw number from ordered prefix components (dense). */
export function formatObjectNumberFromComponents(
  components: readonly number[],
  style: NumberingStyle,
  ordinal: number,
  minDigits = 1,
): string {
  const n = String(Math.max(0, Math.floor(ordinal))).padStart(Math.max(1, minDigits), '0')
  if (components.length === 0) return n
  const prefix = components.join('.')
  return style === 'dash' ? `${prefix}-${n}` : `${prefix}.${n}`
}

/** Build the canonical identity map for resolution lookups. */
export function semanticStateMap(
  states: readonly SemanticHeadingNumberState[],
): Map<string, SemanticHeadingNumberState> {
  return new Map(states.map(s => [s.stableIdentity, s]))
}

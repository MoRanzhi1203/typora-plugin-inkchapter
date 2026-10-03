/**
 * Heading Auto-Number Conflict Diagnostics V1 §2/§4 — the ONE
 * `isAutoNumberingEffectiveForHeading` authority.
 *
 * §4 — the rule must ask "is auto numbering EFFECTIVE FOR THIS HEADING?", never
 * "is the global heading numbering switch ON?". The effective verdict depends on
 * the FULL existing numbering authority (global enable · strict/loose H1 policy ·
 * per-level `enabled` · `maxDepth` · zero-fill prohibition · per-heading
 * overrides), so this module does NOT restate any of those rules: it consumes the
 * EXISTING numbering engine (`computeHeadingNumbering`) and reads the label the
 * engine itself would paint. An empty label means "no automatic number here".
 *
 * Pure — no DOM, no host state, no timers.
 */
import type { HeadingDescriptor, HeadingLevelStyle, HeadingNumberingSettings } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { resolveHeadingStructure } from './heading-structure'

export interface HeadingAutoNumberEffectivenessFacts {
  /** Global heading-numbering master switch (audit field). */
  enabled: boolean
  /** H1 numbering (strict = OFF, loose = ON) — the existing structure authority. */
  h1NumberingEnabled: boolean
  /**
   * Heading Auto-Number Conflict V1.2 §13 — the STYLE identity of the effective
   * numbering configuration (preset + per-level NUMBER FORMAT). It is the ONLY
   * field the transition classifier uses to detect a NUMBER_STYLE_CHANGED.
   */
  styleKey: string
  /** key → the label the numbering engine would paint (`''` = unnumbered). */
  labelByKey: ReadonlyMap<string, string>
}

/**
 * §13 — the STYLE key of the effective numbering configuration: the preset plus
 * the per-level NUMBER FORMAT (`tokenStyle` / parents / prefix / suffix /
 * separator / start / restart).
 *
 * It deliberately EXCLUDES `enabled`, `headingStructureMode`/`showLevelOneNumber`
 * and every per-level `enabled` flag: those are the global / H1 CONFIG
 * transitions (classifier priority 1/2). Excluding them is what stops an Auto
 * ON→OFF toggle from being misread as a style switch.
 *
 * Pure — no DOM, no host state.
 */
export function computeHeadingNumberingStyleKey(
  settings: HeadingNumberingSettings | null | undefined,
): string {
  if (!settings) return ''
  const parts: string[] = [
    `preset=${settings.preset ?? 'custom'}`,
    `maxDepth=${settings.maxDepth ?? 6}`,
  ]
  const levels = (settings.levels ?? {}) as Record<number, HeadingLevelStyle | undefined>
  for (let level = 1; level <= 6; level++) {
    const l = levels[level]
    if (!l) {
      parts.push(`L${level}=none`)
      continue
    }
    parts.push(
      `L${level}:tok=${l.tokenStyle ?? ''}`
      + `,inc=${l.includeParents ? 1 : 0}`
      + `,pre=${JSON.stringify(l.prefix ?? '')}`
      + `,suf=${JSON.stringify(l.suffix ?? '')}`
      + `,sep=${JSON.stringify(l.separator ?? '')}`
      + `,start=${l.startAt ?? 1}`
      + `,restart=${l.restartAfterLevel ?? ''}`,
    )
  }
  return parts.join('|')
}

/**
 * §4 — build the effectiveness facts ONCE per compute from the numbering
 * authority's own effective settings + the canonical heading sequence.
 */
export function buildHeadingAutoNumberEffectivenessFacts(input: {
  settings: HeadingNumberingSettings
  headings: readonly HeadingDescriptor[]
}): HeadingAutoNumberEffectivenessFacts {
  const settings = input.settings
  const enabled = settings?.enabled === true
  const h1NumberingEnabled = settings ? resolveHeadingStructure(settings).showLevelOneNumber === true : false
  const styleKey = computeHeadingNumberingStyleKey(settings)
  const labelByKey = new Map<string, string>()
  if (enabled && input.headings.length > 0) {
    for (const numbered of computeHeadingNumbering(input.headings, settings)) {
      labelByKey.set(numbered.key, numbered.label)
    }
  }
  return { enabled, h1NumberingEnabled, styleKey, labelByKey }
}

/**
 * §2/§4/§15 — the ONE per-heading effective predicate. `false` whenever the
 * global switch is OFF or the engine paints no label for this heading (strict
 * H1 · disabled level · beyond maxDepth · unnumbered override · suppressed
 * zero-fill child).
 */
export function isAutoNumberingEffectiveForHeading(
  facts: HeadingAutoNumberEffectivenessFacts,
  key: string | null | undefined,
): boolean {
  if (!facts.enabled) return false
  if (key == null || key === '') return false
  const label = facts.labelByKey.get(key)
  return label != null && label !== ''
}

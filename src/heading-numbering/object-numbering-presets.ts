/**
 * Object Numbering Presets v2 — stable UI scheme IDs mapped to internal
 * scope + format. Ordinary users select a preset (Chinese label) instead of
 * typing template variables; the preset ID is the ONLY configuration authority.
 */

import {
  OBJECT_NUMBERING_PRESET_UI_V2_MARKER,
  type ObjectNumberingPreset,
  type ObjectNumberingScope,
} from './object-numbering-engine'

export { OBJECT_NUMBERING_PRESET_UI_V2_MARKER }

export interface ObjectNumberingPresetDefinition {
  id: ObjectNumberingPreset
  /** Chinese UI label (display only — never used as configuration authority). */
  label: string
  scope: ObjectNumberingScope
  format: string
  /** Example using chapter=2 section=3 n=1 (formula wraps in parentheses). */
  example: string
}

export const OBJECT_NUMBERING_PRESETS: Record<ObjectNumberingPreset, ObjectNumberingPresetDefinition> = {
  continuous: { id: 'continuous', label: '全文连续：1, 2, 3', scope: 'document', format: '{n}', example: '1' },
  'chapter-dot': { id: 'chapter-dot', label: '按章·点号：2.1, 2.2, 2.3', scope: 'chapter', format: '{chapter}.{n}', example: '2.1' },
  'chapter-dash': { id: 'chapter-dash', label: '按章·短横线：2-1, 2-2, 2-3', scope: 'chapter', format: '{chapter}-{n}', example: '2-1' },
  'section-dot': { id: 'section-dot', label: '按节·点号：2.3.1, 2.3.2', scope: 'section', format: '{chapter}.{section}.{n}', example: '2.3.1' },
  'section-dash': { id: 'section-dash', label: '按节·短横线：2-3-1, 2-3-2', scope: 'section', format: '{chapter}-{section}-{n}', example: '2-3-1' },
}

export const OBJECT_NUMBERING_PRESET_IDS: readonly ObjectNumberingPreset[] = [
  'continuous', 'chapter-dot', 'chapter-dash', 'section-dot', 'section-dash',
]

export function isValidObjectNumberingPreset(id: unknown): id is ObjectNumberingPreset {
  return typeof id === 'string' && (OBJECT_NUMBERING_PRESET_IDS as readonly string[]).includes(id)
}

export type PresetResolutionDecision = 'PRESET' | 'MAPPED' | 'LEGACY_CUSTOM' | 'FALLBACK'

export interface PresetResolution {
  preset: ObjectNumberingPreset | null
  scope: ObjectNumberingScope
  format: string
  decision: PresetResolutionDecision
}

function defaultFormatFor(scope: ObjectNumberingScope): string {
  switch (scope) {
    case 'chapter': return '{chapter}.{n}'
    case 'section': return '{chapter}.{section}.{n}'
    case 'subsection': return '{chapter}.{section}.{subsection}.{n}'
    default: return '{n}'
  }
}

/**
 * Resolve a config into a concrete scope + internal format.
 *
 * - valid `preset` → PRESET (registry authority).
 * - no preset + (scope, format) matches a preset → MAPPED (legacy migration).
 * - no preset + (scope, format) unmappable → LEGACY_CUSTOM (kept as-is).
 * - invalid preset value → FALLBACK to continuous.
 */
export function resolvePresetConfig(input: {
  preset?: unknown
  scope?: ObjectNumberingScope
  format?: string
}): PresetResolution {
  if (isValidObjectNumberingPreset(input.preset)) {
    const def = OBJECT_NUMBERING_PRESETS[input.preset]
    return { preset: input.preset, scope: def.scope, format: def.format, decision: 'PRESET' }
  }
  if (input.preset !== undefined && input.preset !== null) {
    console.info(`[InkChapter Numbering] OBJECT-NUMBERING-PRESET-FALLBACK preset=${String(input.preset)} decision=FALLBACK reason=UNKNOWN_PRESET`)
    const def = OBJECT_NUMBERING_PRESETS.continuous
    return { preset: 'continuous', scope: def.scope, format: def.format, decision: 'FALLBACK' }
  }
  const scope: ObjectNumberingScope = input.scope ?? 'document'
  const format = (input.format ?? '').trim() || defaultFormatFor(scope)
  for (const id of OBJECT_NUMBERING_PRESET_IDS) {
    const def = OBJECT_NUMBERING_PRESETS[id]
    if (def.scope === scope && def.format === format) {
      return { preset: id, scope, format, decision: 'MAPPED' }
    }
  }
  return { preset: null, scope, format, decision: 'LEGACY_CUSTOM' }
}

/** Resolve a preset id, falling back to `continuous` for unknown values (with log). */
export function resolvePresetId(preset: unknown): ObjectNumberingPreset {
  if (isValidObjectNumberingPreset(preset)) return preset
  console.info(`[InkChapter Numbering] OBJECT-NUMBERING-PRESET-FALLBACK preset=${String(preset)} decision=FALLBACK reason=UNKNOWN_PRESET`)
  return 'continuous'
}

/** Standard numbering start / digits for every preset (start at 1, no padding). */
export const STANDARD_PRESET_START_AT = 1
export const STANDARD_PRESET_MIN_DIGITS = 1

/**
 * Config patch for a user actively selecting a standard preset.
 * Always normalizes `startAt` / `minDigits` to standard values (1 / 1).
 * Legacy numeric customization is only preserved until the user re-selects.
 */
export function presetSelectionPatch(preset: ObjectNumberingPreset): {
  preset: ObjectNumberingPreset
  scope: ObjectNumberingScope
  template: string
  startAt: number
  minDigits: number
  legacyCustomFormat: undefined
} {
  const def = OBJECT_NUMBERING_PRESETS[preset]
  return {
    preset,
    scope: def.scope,
    template: def.format,
    startAt: STANDARD_PRESET_START_AT,
    minDigits: STANDARD_PRESET_MIN_DIGITS,
    legacyCustomFormat: undefined,
  }
}

/** Formula display name (parentheses applied by the internal formatter). */
export function presetFormulaLabel(preset: ObjectNumberingPreset): string {
  const def = OBJECT_NUMBERING_PRESETS[preset]
  return `(${def.example})`
}

/**
 * Dropdown option label. For formula, the example series is wrapped in
 * parentheses (the formatter applies them, the user never types a template).
 */
export function presetOptionLabel(preset: ObjectNumberingPreset, formula: boolean): string {
  const def = OBJECT_NUMBERING_PRESETS[preset]
  if (!formula) return def.label
  const [name, examples] = splitLabel(def.label)
  if (!examples) return def.label
  const wrapped = examples.split(',').map(s => `(${s.trim()})`).join(', ')
  return `${name}：${wrapped}`
}

function splitLabel(label: string): [string, string | null] {
  const idx = label.indexOf('：')
  if (idx < 0) return [label, null]
  return [label.slice(0, idx), label.slice(idx + 1)]
}

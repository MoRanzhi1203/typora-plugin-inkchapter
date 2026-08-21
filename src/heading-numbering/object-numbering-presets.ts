/**
 * Object Numbering Presets (Phase 5) — the shared public preset model, legacy
 * migration, start-number / min-digits formatting, and preview building for
 * Figure / Table / Formula / Code.
 *
 * This is the CONFIGURATION + PREVIEW layer only. It does NOT touch the runtime
 * numbering engine (Phase 6) or Formula/MathJax (Phase 7).
 *
 * The five public presets use SEMANTIC scopes (GLOBAL / CHAPTER / SECTION), not
 * physical H-level reset modes. Strict/Loose heading structure is inherited from
 * the Heading Authority.
 */

import type { CaptionScope, NumberingStyle } from './semantic-heading-types'

export type ObjectNumberingPreset =
  | 'global'
  | 'chapter-dot'
  | 'section-dot'
  | 'chapter-dash'
  | 'section-dash'
  | 'legacy-custom'

export interface ObjectNumberingPresetDescriptor {
  id: ObjectNumberingPreset
  label: string
  scope: CaptionScope
  style: NumberingStyle
  template: string
  preview: readonly string[]
}

/** Single source of truth for the five public presets. */
export const PUBLIC_PRESET_DESCRIPTORS: readonly ObjectNumberingPresetDescriptor[] = [
  { id: 'global', label: '全文连续', scope: 'global', style: 'dot', template: '{n}', preview: ['1', '2', '3'] },
  { id: 'chapter-dot', label: '按章·点号', scope: 'chapter', style: 'dot', template: '{chapter}.{n}', preview: ['1.1', '1.2', '2.1'] },
  { id: 'section-dot', label: '按节·点号', scope: 'section', style: 'dot', template: '{chapter}.{section}.{n}', preview: ['1.1.1', '1.1.2', '1.2.1'] },
  { id: 'chapter-dash', label: '按章·短横线', scope: 'chapter', style: 'dash', template: '{chapter}-{n}', preview: ['1-1', '1-2', '2-1'] },
  { id: 'section-dash', label: '按节·短横线', scope: 'section', style: 'dash', template: '{chapter}.{section}-{n}', preview: ['1.1-1', '1.1-2', '1.2-1'] },
]

const EXACT_TEMPLATE_TO_PRESET: Record<string, ObjectNumberingPreset> = {
  '{n}': 'global',
  '{chapter}.{n}': 'chapter-dot',
  '{chapter}.{section}.{n}': 'section-dot',
  '{chapter}-{n}': 'chapter-dash',
  '{chapter}.{section}-{n}': 'section-dash',
}

/**
 * Map a legacy template string to a public preset, EXACTLY. Anything that is
 * not an exact match is preserved as `legacy-custom` (never silently rewritten).
 */
export function migrateLegacyTemplateToPreset(template: string | undefined): ObjectNumberingPreset {
  const t = (template ?? '').trim()
  return EXACT_TEMPLATE_TO_PRESET[t] ?? 'legacy-custom'
}

export interface NormalizedObjectNumberingConfig {
  enabled: boolean
  preset: ObjectNumberingPreset
  /** Start value applied to the object ordinal `{n}` inside each scope. */
  startNumber: number
  /** Minimum digits applied to the object ordinal `{n}` only. */
  minDigits: number
  /** Original template preserved for legacy-custom (non-destructive). */
  legacyCustomTemplate?: string
  /** Full original config payload preserved for legacy-custom (non-destructive). */
  legacyPayload?: unknown
}

export interface LegacyObjectNumberingConfigLike {
  enabled?: boolean
  preset?: unknown
  template?: string
  numberingMode?: string
  startAt?: number
  startNumber?: number
  minDigits?: number
  [key: string]: unknown
}

function normalizeStartNumber(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1
  return Math.max(1, n)
}

function normalizeMinDigits(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1
  return Math.min(6, Math.max(1, n))
}

/**
 * Normalize a legacy or already-normalized object-numbering config into the
 * Phase 5 shape. Idempotent: normalizing twice yields an equal result.
 *
 * Non-numbering fields (enabled, prefix, position, name, formulaMode) are the
 * caller's responsibility and are NOT destroyed by this function.
 */
export function normalizeObjectNumberingConfig(raw: unknown): NormalizedObjectNumberingConfig {
  const r = (raw ?? {}) as LegacyObjectNumberingConfigLike
  const enabled = r.enabled !== false
  const startNumber = normalizeStartNumber(r.startAt ?? r.startNumber ?? 1)
  const minDigits = normalizeMinDigits(r.minDigits ?? 1)

  if (typeof r.preset === 'string') {
    const preset = r.preset as ObjectNumberingPreset
    if (preset !== 'legacy-custom') {
      return { enabled, preset, startNumber, minDigits }
    }
    const payload = (r.legacyPayload ?? r) as Record<string, unknown>
    return {
      enabled,
      preset,
      startNumber,
      minDigits,
      legacyCustomTemplate: typeof payload.template === 'string' ? payload.template : undefined,
      legacyPayload: payload,
    }
  }

  const template = typeof r.template === 'string' ? r.template : undefined
  const preset = migrateLegacyTemplateToPreset(template)
  if (preset === 'legacy-custom') {
    return {
      enabled,
      preset,
      startNumber,
      minDigits,
      legacyCustomTemplate: template,
      legacyPayload: r,
    }
  }
  return { enabled, preset, startNumber, minDigits }
}

/**
 * Format the raw object number for a preset from canonical semantic ordinals.
 * `startNumber` offsets the object ordinal `{n}`; `minDigits` pads only `{n}`.
 * Chapter / Section ordinals are never padded or offset.
 */
export function formatPresetNumber(
  preset: ObjectNumberingPreset,
  chapter: number | null,
  section: number | null,
  ordinal: number,
  startNumber = 1,
  minDigits = 1,
): string {
  const n = startNumber + Math.max(0, Math.floor(ordinal) - 1)
  const padded = String(n).padStart(Math.max(1, minDigits), '0')

  switch (preset) {
    case 'global': return padded
    case 'chapter-dot': return `${chapter ?? 0}.${padded}`
    case 'section-dot': return `${chapter ?? 0}.${section ?? 0}.${padded}`
    case 'chapter-dash': return `${chapter ?? 0}-${padded}`
    case 'section-dash': return `${chapter ?? 0}.${section ?? 0}-${padded}`
    case 'legacy-custom': return padded
  }
}

export type CaptionObjectKind = 'figure' | 'table' | 'formula' | 'code'

export interface PresetPreviewSample {
  chapter?: number
  section?: number
  ordinal?: number
  name?: string
}

/** Wrap a raw number into its object-kind display label (prefix / wrapper separated). */
export function buildPresetPreview(
  preset: ObjectNumberingPreset,
  kind: CaptionObjectKind,
  sample: PresetPreviewSample = {},
  startNumber = 1,
  minDigits = 1,
): string {
  const chapter = sample.chapter ?? 2
  const section = sample.section ?? 1
  const ordinal = sample.ordinal ?? 3
  const raw = formatPresetNumber(preset, chapter, section, ordinal, startNumber, minDigits)
  const name = (sample.name ?? '').trim()

  switch (kind) {
    case 'figure': return name ? `图 ${raw} ${name}` : `图 ${raw}`
    case 'table': return name ? `表 ${raw} ${name}` : `表 ${raw}`
    case 'code': return name ? `代码 ${raw} ${name}` : `代码 ${raw}`
    case 'formula': return `(${raw})`
  }
}

/** Read-only structure-mode description for ordinary object-numbering UI. */
export function structureModeDescription(mode: 'strict' | 'loose'): string {
  return mode === 'strict'
    ? 'H1 文档题目 → H2 章 → H3 节'
    : '按当前有效标题路径解析章/节'
}

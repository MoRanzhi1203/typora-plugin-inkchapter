export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface HeadingDescriptor {
  key: string
  level: HeadingLevel
  text: string
}

export interface NumberedHeading extends HeadingDescriptor {
  counters: readonly number[]
  label: string
}

// ── Numbering style types ────────────────────────────────

export type NumberTokenStyle =
  | 'arabic'
  | 'fullwidth-arabic'
  | 'chinese'
  | 'chinese-financial'
  | 'roman-upper'
  | 'roman-lower'
  | 'alpha-upper'
  | 'alpha-lower'
  | 'upper-greek'
  | 'lower-greek'
  | 'heavenly-stems'
  | 'earthly-branches'
  | 'circled'

export type HeadingNumberingPreset =
  | 'decimal-hierarchical'
  | 'chinese-chapter'
  | 'chinese-outline'
  | 'roman-hierarchical'
  | 'custom'

export type NumberFormatSegment =
  | { type: 'literal'; value: string }
  | { type: 'level-reference'; level: HeadingLevel }

/** Dual format storage: with H1 visible, and with H1 hidden. (schemaVersion >= 5) */
export interface HeadingFormatVariants {
  withLevelOne: NumberFormatSegment[]
  withoutLevelOne: NumberFormatSegment[]
}

// ── Two-layer data model (schemaVersion >= 7) ────────────

/**
 * Layer 1: Per-level number template.
 * Defines what a single level's number looks like: prefix + token + suffix.
 * Example: H1 = { tokenStyle: 'chinese', prefix: '第', suffix: '章' } → "第一章"
 */
export interface HeadingLevelNumberTemplate {
  tokenStyle: NumberTokenStyle
  prefix: string
  suffix: string
}

/**
 * Layer 2: Multilevel composition segment.
 * References a complete level template (prefix+token+suffix), not just the number.
 * level-template-reference = the entire rendered template for that level.
 * @deprecated Use ContextualFormatSegment (schemaVersion >= 8).
 */
export type MultilevelFormatSegment =
  | { type: 'level-template-reference'; level: HeadingLevel }
  | { type: 'literal'; value: string }

/** Dual format storage using multilevel composition segments. (schemaVersion >= 7)
 * @deprecated Use ContextualFormatVariants (schemaVersion >= 8). */
export interface MultilevelFormatVariants {
  withLevelOne: MultilevelFormatSegment[]
  withoutLevelOne: MultilevelFormatSegment[]
}

// ── Contextual model (schemaVersion >= 8) ─────────────────

/**
 * The appearance of a single level reference within a contextual format.
 * Each level-reference segment carries its own tokenStyle/prefix/suffix,
 * independent of the referenced level's global template.
 */
export interface LevelReferenceAppearance {
  tokenStyle: NumberTokenStyle
  prefix: string
  suffix: string
}

/**
 * A segment in a contextual multilevel format array.
 * Each segment has a stable `id` and its own independent appearance.
 *
 * - level-reference: a reference to a specific heading level,
 *   with its own tokenStyle/prefix/suffix.
 * - literal: a plain text string inserted into the label.
 */
export type ContextualFormatSegment =
  | {
      id: string
      type: 'level-reference'
      level: HeadingLevel
      appearance: LevelReferenceAppearance
    }
  | {
      id: string
      type: 'literal'
      value: string
    }

/** Dual format storage using contextual format segments. (schemaVersion >= 8) */
export interface ContextualFormatVariants {
  withLevelOne: ContextualFormatSegment[]
  withoutLevelOne: ContextualFormatSegment[]
}

/** Create a default level reference appearance. */
export function createDefaultReferenceAppearance(
  tokenStyle: NumberTokenStyle = 'arabic',
): LevelReferenceAppearance {
  return { tokenStyle, prefix: '', suffix: '' }
}

/** Create a default level template for a given token style. */
export function createDefaultLevelTemplate(tokenStyle: NumberTokenStyle = 'arabic'): HeadingLevelNumberTemplate {
  return { tokenStyle, prefix: '', suffix: '' }
}

export interface HeadingLevelStyle {
  /** Whether this level shows a number. false = empty token. */
  enabled: boolean
  /** The number token type. (Legacy: prefer levelTemplate.tokenStyle when available) */
  tokenStyle: NumberTokenStyle
  /** Include parent-level numbers in this level's label. (Deprecated: use multilevelFormatVariants) */
  includeParents: boolean
  /** Text prepended before the number. (Deprecated: use levelTemplate.prefix) */
  prefix: string
  /** Text appended after the number. (Deprecated: use levelTemplate.suffix) */
  suffix: string
  /** Separator between this level and the previous level when includeParents is true. (Deprecated) */
  separator: string
  /** Starting number for this level (1-999). Counter initial = startAt - 1. */
  startAt: number
  /** Which parent level restarts this level's counter. null = continuous across document. */
  restartAfterLevel: HeadingLevel | null
  /** Dual-format variants for H1 on/off. (schemaVersion >= 5, deprecated in v7) */
  formatVariants: HeadingFormatVariants
  /** Legacy single format (schemaVersion < 5). Only used during migration, not at runtime. */
  format?: NumberFormatSegment[]

  // ── Two-layer data model (schemaVersion >= 7) ──────────

  /** Layer 1: Per-level number template (prefix + tokenStyle + suffix). */
  levelTemplate: HeadingLevelNumberTemplate
  /** Layer 2: Multilevel composition using level-template-references. (Deprecated: use contextualFormatVariants) */
  multilevelFormatVariants: MultilevelFormatVariants
  /** Layer 2 (schemaVersion >= 8): Contextual composition with per-reference appearance. */
  contextualFormatVariants: ContextualFormatVariants
}

// ── Settings ─────────────────────────────────────────────

export interface HeadingNumberingSettings {
  enabled: boolean
  showLevelOneNumber: boolean
  preset: HeadingNumberingPreset
  maxDepth: HeadingLevel
  /** Legacy fields kept for migration; not used in current format. */
  separator?: string
  suffix?: string
  showTrailingSeparator?: boolean
  /** Per-level style configuration (active, used when preset = 'custom'). */
  levels: Record<HeadingLevel, HeadingLevelStyle>
  /** Persisted custom draft (schemaVersion >= 2). Preserved when switching between presets. */
  customDefinition?: Record<HeadingLevel, HeadingLevelStyle>
}

// ── Runtime types ────────────────────────────────────────

export type RefreshReason =
  | 'initial-load'
  | 'editor-input'
  | 'composition-end'
  | 'framework-edit'
  | 'file-open'
  | 'active-leaf-change'
  | 'manual'
  | 'toggle'
  | 'tail-refresh'
  | 'editor-mutation'
  | 'focus-in'
  | 'editor-click'
  | 'editor-keyup'
  | 'decoration-repair'

export interface HeadingSnapshot {
  key: string
  level: HeadingLevel
}

export interface RenderedHeadingState {
  element: HTMLElement
  key: string
  level: HeadingLevel
  label: string
}

export interface DiffResult {
  scanned: number
  repaired: number
  updated: number
  removed: number
}

export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

/** Generate a stable pseudo-random id for format segments. */
let _idCounter = 0
export function generateStableId(): string {
  _idCounter++
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  const ts = Date.now().toString(36)
  return `${ts}-${rand}-${_idCounter}`
}

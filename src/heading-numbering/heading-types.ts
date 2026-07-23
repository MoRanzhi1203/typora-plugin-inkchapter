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
  | 'chinese'
  | 'chinese-financial'
  | 'roman-upper'
  | 'roman-lower'
  | 'alpha-upper'
  | 'alpha-lower'
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
 */
export type MultilevelFormatSegment =
  | { type: 'level-template-reference'; level: HeadingLevel }
  | { type: 'literal'; value: string }

/** Dual format storage using multilevel composition segments. (schemaVersion >= 7) */
export interface MultilevelFormatVariants {
  withLevelOne: MultilevelFormatSegment[]
  withoutLevelOne: MultilevelFormatSegment[]
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
  /** Layer 2: Multilevel composition using level-template-references. */
  multilevelFormatVariants: MultilevelFormatVariants
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

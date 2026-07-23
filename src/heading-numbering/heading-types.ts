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

export interface HeadingLevelStyle {
  /** Whether this level shows a number. false = empty token. */
  enabled: boolean
  /** The number token type. */
  tokenStyle: NumberTokenStyle
  /** Include parent-level numbers in this level's label. */
  includeParents: boolean
  /** Text prepended before the number. */
  prefix: string
  /** Text appended after the number. */
  suffix: string
  /** Separator between this level and the previous level when includeParents is true. */
  separator: string
  /** Starting number for this level (1-999). Counter initial = startAt - 1. */
  startAt: number
  /** Which parent level restarts this level's counter. null = continuous across document. */
  restartAfterLevel: HeadingLevel | null
  /** Convert parent-level number tokens to arabic (current level keeps its own style). */
  legalStyle: boolean
  /** Dual-format variants for H1 on/off. (schemaVersion >= 5) */
  formatVariants: HeadingFormatVariants
  /** Legacy single format (schemaVersion < 5). Only used during migration, not at runtime. */
  format?: NumberFormatSegment[]
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

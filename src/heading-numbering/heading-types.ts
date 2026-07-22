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
  /** Format template: ordered segments defining the label structure (schemaVersion >= 4). */
  format: readonly NumberFormatSegment[]
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

/** Backup for custom H2-H6 formats when H1 numbering is hidden. */
export interface HiddenLevelOneFormatBackup {
  /** The format each level had before H1 was turned off. */
  formats: Partial<Record<HeadingLevel, readonly NumberFormatSegment[]>>
  /** Levels that were edited while H1 was hidden (should keep current format on restore). */
  editedWhileHidden: Partial<Record<HeadingLevel, boolean>>
}

export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

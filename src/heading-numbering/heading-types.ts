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

// ── NumberFormatSegment: Word-style token model ──────────

/** Word "输入编号的格式" segment: literal text or a level-reference token. */
export type NumberFormatSegment =
  | { type: 'literal'; value: string }
  | { type: 'level-reference'; level: HeadingLevel }

// ── Position types ───────────────────────────────────────

export type NumberAlignment = 'left' | 'center' | 'right'

export type FollowNumberWith = 'tab' | 'space' | 'nothing'

export interface HeadingLevelPosition {
  alignment: NumberAlignment
  alignedAtEm: number
  textIndentAtEm: number
  followWith: FollowNumberWith
  tabStopAtEm: number | null
}

// ── HeadingLevelDefinition: per-level config (new model) ─

export interface HeadingLevelDefinition {
  /** Whether this level shows a number label. */
  enabled: boolean
  /** Number style for the current-level token only. */
  numberStyle: NumberTokenStyle
  /** Word-style format segments (literal + level-reference tokens). */
  format: readonly NumberFormatSegment[]
  /** Starting counter value (1-9999). */
  startAt: number
  /** Parent level after which numbering restarts, or null for "never restart". */
  restartAfterLevel: HeadingLevel | null
  /** Legal-style: parent refs forced to Arabic numerals. */
  legalStyle: boolean
  /** Position / indentation settings. */
  position: HeadingLevelPosition
}

// ── CustomMultilevelListSettings ─────────────────────────

export interface CustomMultilevelListSettings {
  levels: Record<HeadingLevel, HeadingLevelDefinition>
}

// ── Old HeadingLevelStyle (kept for migration compatibility) ─

/** Legacy per-level style. Only used during config migration; converted to HeadingLevelDefinition. */
export interface HeadingLevelStyle {
  enabled: boolean
  tokenStyle: NumberTokenStyle
  includeParents: boolean
  prefix: string
  suffix: string
  separator: string
  startAt: number
}

// ── Settings ─────────────────────────────────────────────

export interface HeadingNumberingSettings {
  enabled: boolean
  showLevelOneNumber: boolean
  preset: HeadingNumberingPreset
  maxDepth: HeadingLevel
  /** Legacy fields kept for migration */
  separator?: string
  suffix?: string
  showTrailingSeparator?: boolean
  /** Legacy per-level styles (migrated to customDefinition). */
  levels?: Record<HeadingLevel, HeadingLevelStyle>
  /** New multilevel definition (segment-based). */
  customDefinition: CustomMultilevelListSettings
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

// ── Default position ─────────────────────────────────────

export const DEFAULT_POSITION: HeadingLevelPosition = {
  alignment: 'left',
  alignedAtEm: 0,
  textIndentAtEm: 2,
  followWith: 'space',
  tabStopAtEm: null,
}

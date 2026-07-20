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
  /** Per-level style configuration (used when preset = 'custom'). */
  levels: Record<HeadingLevel, HeadingLevelStyle>
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

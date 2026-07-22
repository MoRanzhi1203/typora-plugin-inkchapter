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

export type NumberAlignment = 'left' | 'center' | 'right'

export interface HeadingLevelPosition {
  numberAlignment: NumberAlignment
  numberBoxWidthEm: number
  numberTextGapEm: number
  alignWrappedLines: boolean
}

export interface HeadingLevelStyle {
  enabled: boolean
  tokenStyle: NumberTokenStyle
  includeParents: boolean
  prefix: string
  suffix: string
  separator: string
  startAt: number
  restartAfterLevel: HeadingLevel | null
  legalStyle: boolean
  position: HeadingLevelPosition
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

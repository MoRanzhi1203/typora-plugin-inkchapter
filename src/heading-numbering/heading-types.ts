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

export interface HeadingNumberingSettings {
  enabled: boolean
  maxDepth: HeadingLevel
  separator: string
  suffix: string
  showTrailingSeparator: boolean
}

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

/** Lightweight snapshot of a heading element for dirty checking. */
export interface HeadingSnapshot {
  /** Stable identity: element reference or generated key. */
  key: string
  level: HeadingLevel
}

export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

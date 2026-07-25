import type { HeadingNumberingSettings, HeadingLevelRangeSettings, SpecialHeadingNumberingSettings } from '../heading-numbering/heading-types'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 9 */
  schemaVersion: number
  debug: boolean
  headingNumbering: HeadingNumberingSettings
  levelRange: HeadingLevelRangeSettings
  specialNumbering: SpecialHeadingNumberingSettings
}

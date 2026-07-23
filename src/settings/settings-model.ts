import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 7 */
  schemaVersion: number
  debug: boolean
  headingNumbering: HeadingNumberingSettings
}

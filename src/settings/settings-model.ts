import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 2 */
  schemaVersion: number
  debug: boolean
  headingNumbering: HeadingNumberingSettings
}

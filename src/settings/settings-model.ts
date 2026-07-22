import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 1 */
  schemaVersion: number
  debug: boolean
  headingNumbering: HeadingNumberingSettings
}

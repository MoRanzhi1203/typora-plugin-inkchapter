import type { HeadingNumberingSettings, HeadingLevelRangeSettings, SpecialHeadingNumberingSettings, HeadingNumberingScopeStore, FormatLibrary } from '../heading-numbering/heading-types'
import type { CaptionSettings } from '../heading-numbering/caption-system'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 11 */
  schemaVersion: number
  debug: boolean
  /** @deprecated Migrated to headingNumberingScopes.globalDefault. Kept for migration compatibility. */
  headingNumbering?: HeadingNumberingSettings
  /** New scope-aware heading numbering store (schema version >= 10). */
  headingNumberingScopes?: HeadingNumberingScopeStore
  /** User-managed custom format library (schema version >= 11). */
  formatLibrary?: FormatLibrary
  levelRange: HeadingLevelRangeSettings
  specialNumbering: SpecialHeadingNumberingSettings
  /** Caption System V1 settings (schema version >= 12, optional field). */
  caption?: CaptionSettings
}

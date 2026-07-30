import type { HeadingNumberingSettings, HeadingLevelRangeSettings, SpecialHeadingNumberingSettings, HeadingNumberingScopeStore } from '../heading-numbering/heading-types'

export type { HeadingNumberingSettings }

export interface InkChapterSettings {
  /** Schema version for migration. Current: 10 */
  schemaVersion: number
  debug: boolean
  /** @deprecated Migrated to headingNumberingScopes.globalDefault. Kept for migration compatibility. */
  headingNumbering?: HeadingNumberingSettings
  /** New scope-aware heading numbering store (schema version >= 10). */
  headingNumberingScopes?: HeadingNumberingScopeStore
  levelRange: HeadingLevelRangeSettings
  specialNumbering: SpecialHeadingNumberingSettings
}

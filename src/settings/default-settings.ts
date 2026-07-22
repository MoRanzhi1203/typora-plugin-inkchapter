import type { InkChapterSettings } from './settings-model'
import type { HeadingLevel } from '../heading-numbering/heading-types'

const decimalLevels = {} as Record<HeadingLevel, import('../heading-numbering/heading-types').HeadingLevelStyle>
for (const lv of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
  decimalLevels[lv] = {
    enabled: true,
    tokenStyle: 'arabic',
    includeParents: true,
    prefix: '',
    suffix: '',
    separator: '.',
  }
}

export const DEFAULT_SETTINGS: InkChapterSettings = {
  schemaVersion: 1,
  debug: false,
  headingNumbering: {
    enabled: true,
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: decimalLevels,
  },
}

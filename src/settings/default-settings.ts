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
    startAt: 1,
    restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
    legalStyle: false,
    position: { numberAlignment: 'right', numberBoxWidthEm: 3, numberTextGapEm: 0.6, alignWrappedLines: true },
  }
}

export const DEFAULT_SETTINGS: InkChapterSettings = {
  schemaVersion: 4,
  debug: false,
  headingNumbering: {
    enabled: true,
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: decimalLevels,
    customDefinition: { ...decimalLevels },
  },
}

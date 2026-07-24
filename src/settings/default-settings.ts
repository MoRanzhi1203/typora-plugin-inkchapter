import type { InkChapterSettings } from './settings-model'
import type { HeadingLevel, HeadingLevelNumberTemplate } from '../heading-numbering/heading-types'

const decimalLevels = {} as Record<HeadingLevel, import('../heading-numbering/heading-types').HeadingLevelStyle>
const defaultTemplate: HeadingLevelNumberTemplate = { tokenStyle: 'arabic', prefix: '', suffix: '' }

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
    formatVariants: { withLevelOne: [], withoutLevelOne: [] },
    levelTemplate: { ...defaultTemplate },
    multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
  }
}

export const DEFAULT_SETTINGS: InkChapterSettings = {
  schemaVersion: 8,
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

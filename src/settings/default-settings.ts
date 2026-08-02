import type { InkChapterSettings } from './settings-model'
import type { HeadingLevel, HeadingLevelNumberTemplate } from '../heading-numbering/heading-types'
import { DEFAULT_NAME_CANDIDATES } from '../heading-numbering/heading-types'
import { deepCloneSettings } from '../heading-numbering/heading-numbering-scope-store'

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
  schemaVersion: 10,
  debug: false,
  headingNumberingScopes: {
    schemaVersion: 1,
    globalDefault: {
      enabled: true,
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels: decimalLevels,
      customDefinition: deepCloneSettings({
        enabled: true,
        showLevelOneNumber: false,
        preset: 'decimal-hierarchical',
        maxDepth: 6,
        levels: decimalLevels,
      } as any).levels,
    },
    documentOverrides: {},
  },
  levelRange: {
    defaultMaxLevel: 6,
    documentOverrides: {},
  },
  specialNumbering: {
    unnumberedCounterPolicy: 'skip',
    nameSettings: {
      enabled: true,
      candidates: DEFAULT_NAME_CANDIDATES.map(text => ({ text, enabled: true })),
      matchMode: 'trim',
      matchAction: 'prompt',
    },
  },
}

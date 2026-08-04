import type { InkChapterSettings } from './settings-model'
import type { HeadingLevel, HeadingLevelNumberTemplate, FormatLibrary } from '../heading-numbering/heading-types'
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

const DEFAULT_LAYOUT_CONFIG: import('../heading-numbering/heading-types').HeadingLayoutConfig = {
  textAlign: 'left',
  firstLineIndentEm: 0,
}

const DEFAULT_LAYOUTS: import('../heading-numbering/heading-types').HeadingLayoutSettings = {
  h1: { ...DEFAULT_LAYOUT_CONFIG },
  h2: { ...DEFAULT_LAYOUT_CONFIG },
  h3: { ...DEFAULT_LAYOUT_CONFIG },
  h4: { ...DEFAULT_LAYOUT_CONFIG },
  h5: { ...DEFAULT_LAYOUT_CONFIG },
  h6: { ...DEFAULT_LAYOUT_CONFIG },
}

const DEFAULT_FORMAT_LIBRARY: FormatLibrary = {
  version: 1,
  formats: [],
  preferences: {
    hiddenBuiltInPresetIds: [],
    customFormatOrder: [],
  },
}

export const DEFAULT_SETTINGS: InkChapterSettings = {
  schemaVersion: 11,
  debug: false,
  headingNumberingScopes: {
    schemaVersion: 1,
    globalDefault: {
      enabled: true,
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels: decimalLevels,
      headingLayouts: DEFAULT_LAYOUTS,
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
  formatLibrary: DEFAULT_FORMAT_LIBRARY,
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

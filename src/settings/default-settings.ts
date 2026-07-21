import type { InkChapterSettings } from './settings-model'
import { buildCustomDefault } from '../heading-numbering/presets'

export const DEFAULT_SETTINGS: InkChapterSettings = {
  debug: false,
  headingNumbering: {
    enabled: true,
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    customDefinition: {
      levels: buildCustomDefault(),
    },
  },
}

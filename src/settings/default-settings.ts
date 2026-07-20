import type { InkChapterSettings } from './settings-model'

export const DEFAULT_SETTINGS: InkChapterSettings = {
  debug: false,
  headingNumbering: {
    enabled: true,
    showLevelOneNumber: false,
    maxDepth: 6,
    separator: '.',
    suffix: '',
    showTrailingSeparator: false,
  },
}

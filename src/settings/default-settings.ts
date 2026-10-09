import type { InkChapterSettings, InkChapterUiSettings } from './settings-model'
import type { HeadingLevel, HeadingLevelNumberTemplate, FormatLibrary, ParagraphLayoutSettings } from '../heading-numbering/heading-types'
import { DEFAULT_NAME_CANDIDATES, DEFAULT_PARAGRAPH_LAYOUT } from '../heading-numbering/heading-types'
import { deepCloneSettings } from '../heading-numbering/heading-numbering-scope-store'
import { DEFAULT_CAPTION_SETTINGS } from '../heading-numbering/caption-system'

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

/**
 * 界面 / 文件夹树 默认值。
 *
 * `ribbon: false` = **保持 Typora 原生侧栏**：框架的 Ribbon 模式会隐藏 Typora 原生
 * 「文件 / 搜索 / 大纲」切页栏并改写侧栏布局；墨章只加自己的 `body` 类，由墨章
 * 命名空间的 CSS 恢复原生外观 —— **不写框架类、不改框架配置、不注册长期观察器**。
 * 用户可在设置页打开框架 Ribbon。
 */
export const DEFAULT_UI_SETTINGS: InkChapterUiSettings = {
  fileTreeLocateFlash: true,
  emptyWorkspaceCreate: true,
  docViewMenu: {
    closeAll: true,
    copyAbsolute: true,
    copyRelative: true,
    revealTree: true,
    revealExplorer: true,
  },
  ribbon: false,
}

/** 把可能不完整的 `ui` 配置按默认值补齐（纯函数，读取侧唯一权威）。 */
export function resolveUiSettings(
  raw: Partial<InkChapterUiSettings> | null | undefined,
): InkChapterUiSettings {
  const menu = raw?.docViewMenu
  return {
    fileTreeLocateFlash:
      typeof raw?.fileTreeLocateFlash === 'boolean' ? raw.fileTreeLocateFlash : DEFAULT_UI_SETTINGS.fileTreeLocateFlash,
    emptyWorkspaceCreate:
      typeof raw?.emptyWorkspaceCreate === 'boolean' ? raw.emptyWorkspaceCreate : DEFAULT_UI_SETTINGS.emptyWorkspaceCreate,
    docViewMenu: {
      closeAll: typeof menu?.closeAll === 'boolean' ? menu.closeAll : DEFAULT_UI_SETTINGS.docViewMenu.closeAll,
      copyAbsolute: typeof menu?.copyAbsolute === 'boolean' ? menu.copyAbsolute : DEFAULT_UI_SETTINGS.docViewMenu.copyAbsolute,
      copyRelative: typeof menu?.copyRelative === 'boolean' ? menu.copyRelative : DEFAULT_UI_SETTINGS.docViewMenu.copyRelative,
      revealTree: typeof menu?.revealTree === 'boolean' ? menu.revealTree : DEFAULT_UI_SETTINGS.docViewMenu.revealTree,
      revealExplorer: typeof menu?.revealExplorer === 'boolean' ? menu.revealExplorer : DEFAULT_UI_SETTINGS.docViewMenu.revealExplorer,
    },
    ribbon: typeof raw?.ribbon === 'boolean' ? raw.ribbon : DEFAULT_UI_SETTINGS.ribbon,
  }
}

export const DEFAULT_SETTINGS: InkChapterSettings = {
  schemaVersion: 11,
  debug: false,
  headingNumberingScopes: {
    schemaVersion: 1,
    globalDefault: {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels: decimalLevels,
      headingLayouts: DEFAULT_LAYOUTS,
      headingLayoutsByMode: {
        loose: { h1: { ...DEFAULT_LAYOUT_CONFIG }, h2: { ...DEFAULT_LAYOUT_CONFIG }, h3: { ...DEFAULT_LAYOUT_CONFIG }, h4: { ...DEFAULT_LAYOUT_CONFIG }, h5: { ...DEFAULT_LAYOUT_CONFIG }, h6: { ...DEFAULT_LAYOUT_CONFIG } },
        strict: { h1: { ...DEFAULT_LAYOUT_CONFIG }, h2: { ...DEFAULT_LAYOUT_CONFIG }, h3: { ...DEFAULT_LAYOUT_CONFIG }, h4: { ...DEFAULT_LAYOUT_CONFIG }, h5: { ...DEFAULT_LAYOUT_CONFIG }, h6: { ...DEFAULT_LAYOUT_CONFIG } },
      },
      customDefinition: deepCloneSettings({
        enabled: true,
        headingStructureMode: 'strict',
        showLevelOneNumber: false,
        preset: 'decimal-hierarchical',
        maxDepth: 6,
        levels: decimalLevels,
      } as any).levels,
    },
    documentOverrides: {},
    globalParagraphLayout: { ...DEFAULT_PARAGRAPH_LAYOUT },
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
  caption: DEFAULT_CAPTION_SETTINGS,
  ui: DEFAULT_UI_SETTINGS,
}

import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset } from './heading-types'
import { HEADING_LEVELS } from './heading-types'

// ── Preset metadata ──────────────────────────────────────

export interface PresetMeta {
  key: HeadingNumberingPreset
  name: string
  description: string
  /** Example preview labels for H1-H6. */
  preview: Record<HeadingLevel, string>
  levels: Record<HeadingLevel, HeadingLevelStyle>
}

export const PRESETS: Record<Exclude<HeadingNumberingPreset, 'custom'>, PresetMeta> = {
  'decimal-hierarchical': {
    key: 'decimal-hierarchical',
    name: '十进制层级',
    description: '阿拉伯数字层级编号，如 1、1.1、1.1.1',
    preview: { 1: '1', 2: '1.1', 3: '1.1.1', 4: '1.1.1.1', 5: '1.1.1.1.1', 6: '1.1.1.1.1.1' },
    levels: buildDecimal(),
  },
  'chinese-chapter': {
    key: 'chinese-chapter',
    name: '中文章节式',
    description: '中文章节标题格式：第一章、第一节、一、',
    preview: { 1: '第一章', 2: '第一节', 3: '一、', 4: '（一）', 5: '1.', 6: '（1）' },
    levels: buildChineseChapter(),
  },
  'chinese-outline': {
    key: 'chinese-outline',
    name: '中文大纲式',
    description: '中文大纲格式：一、、（一）、1.、①',
    preview: { 1: '一、', 2: '（一）', 3: '1.', 4: '（1）', 5: '①', 6: 'A.' },
    levels: buildChineseOutline(),
  },
  'roman-hierarchical': {
    key: 'roman-hierarchical',
    name: '罗马数字式',
    description: '大写罗马数字层级编号：I、I.1、I.1.1',
    preview: { 1: 'I', 2: 'I.1', 3: 'I.1.1', 4: 'I.1.1.1', 5: 'I.1.1.1.1', 6: 'I.1.1.1.1.1' },
    levels: buildRoman(),
  },
}

// ── Preset builders ──────────────────────────────────────

function buildDecimal(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = {
      enabled: true,
      tokenStyle: 'arabic',
      includeParents: true,
      prefix: '',
      suffix: '',
      separator: '.',
    }
  }
  return levels
}

function buildChineseChapter(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '第', suffix: '章', separator: '' },
    2: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '第', suffix: '节', separator: '' },
    3: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '', suffix: '、', separator: '' },
    4: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '（', suffix: '）', separator: '' },
    5: { enabled: true, tokenStyle: 'arabic', includeParents: false, prefix: '', suffix: '.', separator: '' },
    6: { enabled: true, tokenStyle: 'arabic', includeParents: false, prefix: '（', suffix: '）', separator: '' },
  }
}

function buildChineseOutline(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '', suffix: '、', separator: '' },
    2: { enabled: true, tokenStyle: 'chinese', includeParents: false, prefix: '（', suffix: '）', separator: '' },
    3: { enabled: true, tokenStyle: 'arabic', includeParents: false, prefix: '', suffix: '.', separator: '' },
    4: { enabled: true, tokenStyle: 'arabic', includeParents: false, prefix: '（', suffix: '）', separator: '' },
    5: { enabled: true, tokenStyle: 'circled', includeParents: false, prefix: '', suffix: '', separator: '' },
    6: { enabled: true, tokenStyle: 'alpha-upper', includeParents: false, prefix: '', suffix: '.', separator: '' },
  }
}

function buildRoman(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = {
      enabled: true,
      tokenStyle: lv === 1 ? 'roman-upper' : 'arabic',
      includeParents: true,
      prefix: '',
      suffix: '',
      separator: '.',
    }
  }
  return levels
}

// ── Helpers ──────────────────────────────────────────────

/** Get the effective level styles for a given preset. */
export function getPresetLevels(preset: HeadingNumberingPreset): Record<HeadingLevel, HeadingLevelStyle> {
  if (preset === 'custom') {
    // Return a default decimal copy; caller should replace with custom config
    return { ...buildDecimal() }
  }
  return { ...PRESETS[preset].levels }
}

/** Get the preview for a preset. */
export function getPresetPreview(preset: HeadingNumberingPreset): Record<HeadingLevel, string> {
  if (preset === 'custom') return PRESETS['decimal-hierarchical'].preview
  return { ...PRESETS[preset].preview }
}

export const PRESET_LIST: PresetMeta[] = Object.values(PRESETS)

import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  NumberFormatSegment,
  MultilevelFormatSegment,
  HeadingLevelNumberTemplate,
} from './heading-types'
import { HEADING_LEVELS, createDefaultLevelTemplate } from './heading-types'

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

// ── Base helpers ─────────────────────────────────────────

function defaultLevelStyle(lv: HeadingLevel, overrides: Partial<HeadingLevelStyle>): HeadingLevelStyle {
  return {
    enabled: true,
    tokenStyle: 'arabic',
    includeParents: true,
    prefix: '',
    suffix: '',
    separator: '.',
    startAt: 1,
    restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
    formatVariants: { withLevelOne: [], withoutLevelOne: [] },
    levelTemplate: createDefaultLevelTemplate('arabic'),
    multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    ...overrides,
  }
}

/** Build hierarchical composition [H1].[H2]...[Hlevel] with given separator literal. */
function buildHierarchicalComposition(level: HeadingLevel, sep: string): MultilevelFormatSegment[] {
  const fmt: MultilevelFormatSegment[] = []
  for (let i = 1; i <= level; i++) {
    if (i > 1) fmt.push({ type: 'literal', value: sep })
    fmt.push({ type: 'level-template-reference', level: i as HeadingLevel })
  }
  return fmt
}

/** Strip all H1 template references and orphaned separator literals. */
function stripLevelOne(format: MultilevelFormatSegment[]): MultilevelFormatSegment[] {
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: MultilevelFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-template-reference' && seg.level === 1) {
      // Remove adjacent separator
      if (result.length > 0 && result[result.length - 1].type === 'literal') {
        const last = result[result.length - 1] as { type: 'literal'; value: string }
        if (isSep(last.value)) result.pop()
      }
      while (i + 1 < format.length && format[i + 1].type === 'literal') {
        const nextLit = format[i + 1] as { type: 'literal'; value: string }
        if (!isSep(nextLit.value)) break
        i++
      }
      continue
    }
    result.push({ ...seg })
  }

  // Clean leading/trailing separators
  while (result.length > 0 && result[0].type === 'literal') {
    const first = result[0] as { type: 'literal'; value: string }
    if (!isSep(first.value)) break
    result.shift()
  }
  while (result.length > 0 && result[result.length - 1].type === 'literal') {
    const last = result[result.length - 1] as { type: 'literal'; value: string }
    if (!isSep(last.value)) break
    result.pop()
  }

  // Merge adjacent literals
  const merged: MultilevelFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      const last = merged[merged.length - 1] as { type: 'literal'; value: string }
      last.value += seg.value
    } else {
      merged.push({ ...seg })
    }
  }

  // Ensure current level ref exists (level is the last remaining level)
  const levels = merged.filter(s => s.type === 'level-template-reference').map(s => (s as any).level as number)
  const maxLevel = levels.length > 0 ? Math.max(...levels) : 1
  if (!merged.some(s => s.type === 'level-template-reference' && s.level === maxLevel as HeadingLevel)) {
    merged.push({ type: 'level-template-reference', level: maxLevel as HeadingLevel })
  }

  return merged.length > 0 ? merged : [{ type: 'level-template-reference', level: 2 as HeadingLevel }]
}

/** Build a level style with both format variants using the two-layer model. */
function buildVariants(
  lv: HeadingLevel,
  templateOverride: Partial<HeadingLevelNumberTemplate>,
  withLevelOne: MultilevelFormatSegment[],
  overrides: Partial<HeadingLevelStyle> = {},
): HeadingLevelStyle {
  const st = defaultLevelStyle(lv, {
    ...overrides,
    levelTemplate: {
      tokenStyle: templateOverride.tokenStyle ?? (overrides.tokenStyle ?? 'arabic'),
      prefix: templateOverride.prefix ?? '',
      suffix: templateOverride.suffix ?? '',
    },
    multilevelFormatVariants: {
      withLevelOne,
      withoutLevelOne: stripLevelOne([...withLevelOne]),
    },
  })
  // Sync legacy tokenStyle for backward compat
  st.tokenStyle = st.levelTemplate.tokenStyle
  return st
}

// ── Preset builders ──────────────────────────────────────

function buildDecimal(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = buildVariants(lv, { tokenStyle: 'arabic' }, buildHierarchicalComposition(lv, '.'), { includeParents: false })
  }
  return levels
}

function buildChineseChapter(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, { tokenStyle: 'chinese', prefix: '第', suffix: '章' },
      [{ type: 'level-template-reference', level: 1 }], { includeParents: false }),
    2: buildVariants(2, { tokenStyle: 'chinese', prefix: '第', suffix: '节' },
      [{ type: 'level-template-reference', level: 2 }], { includeParents: false }),
    3: buildVariants(3, { tokenStyle: 'chinese', prefix: '', suffix: '、' },
      [{ type: 'level-template-reference', level: 3 }], { includeParents: false }),
    4: buildVariants(4, { tokenStyle: 'chinese', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 4 }], { includeParents: false }),
    5: buildVariants(5, { tokenStyle: 'arabic', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 5 }], { includeParents: false }),
    6: buildVariants(6, { tokenStyle: 'arabic', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 6 }], { includeParents: false }),
  }
}

function buildChineseOutline(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, { tokenStyle: 'chinese', prefix: '', suffix: '、' },
      [{ type: 'level-template-reference', level: 1 }], { includeParents: false }),
    2: buildVariants(2, { tokenStyle: 'chinese', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 2 }], { includeParents: false }),
    3: buildVariants(3, { tokenStyle: 'arabic', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 3 }], { includeParents: false }),
    4: buildVariants(4, { tokenStyle: 'arabic', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 4 }], { includeParents: false }),
    5: buildVariants(5, { tokenStyle: 'circled', prefix: '', suffix: '' },
      [{ type: 'level-template-reference', level: 5 }], { includeParents: false }),
    6: buildVariants(6, { tokenStyle: 'alpha-upper', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 6 }], { includeParents: false }),
  }
}

function buildRoman(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = buildVariants(lv, {
      tokenStyle: lv === 1 ? 'roman-upper' : 'arabic',
    }, buildHierarchicalComposition(lv, '.'), { includeParents: false })
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

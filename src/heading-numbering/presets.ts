import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset, NumberFormatSegment, NumberTokenStyle, HeadingFormatVariants } from './heading-types'
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

// ── Variant helpers ─────────────────────────────────────

/** Generate "withoutLevelOne" by stripping all [L1] refs and orphaned separators. */
function stripLevelOne(format: NumberFormatSegment[]): NumberFormatSegment[] {
  const hidden = new Set<HeadingLevel>([1 as HeadingLevel])
  return stripHiddenLevelReferences(format, hidden, format.length > 0 ? (format[format.length - 1] as any)?.level ?? 1 : 1)
}

function stripHiddenLevelReferences(
  format: NumberFormatSegment[],
  hiddenLevels: Set<HeadingLevel>,
  currentLevel: HeadingLevel,
): NumberFormatSegment[] {
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: NumberFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-reference' && hiddenLevels.has(seg.level)) {
      if (result.length > 0 && result[result.length - 1].type === 'literal') {
        const lastLiteral = result[result.length - 1] as { type: 'literal'; value: string }
        if (isSep(lastLiteral.value)) result.pop()
      }
      while (i + 1 < format.length && format[i + 1].type === 'literal') {
        const nextLiteral = format[i + 1] as { type: 'literal'; value: string }
        if (!isSep(nextLiteral.value)) break
        i++
      }
      continue
    }
    result.push({ ...seg })
  }

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

  const merged: NumberFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      const last = merged[merged.length - 1] as { type: 'literal'; value: string }
      last.value += (seg as { type: 'literal'; value: string }).value
    } else {
      merged.push({ ...seg })
    }
  }

  if (!merged.some(s => s.type === 'level-reference' && s.level === currentLevel)) {
    merged.push({ type: 'level-reference', level: currentLevel })
  }

  return merged.length > 0 ? merged : [{ type: 'level-reference', level: currentLevel }]
}

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
    ...overrides,
  }
}

/** Build hierarchical format [L1].[L2]...[Llevel] with given separator */
function buildHierarchical(level: HeadingLevel, sep: string): NumberFormatSegment[] {
  const fmt: NumberFormatSegment[] = []
  for (let i = 1; i <= level; i++) {
    if (i > 1) fmt.push({ type: 'literal', value: sep })
    fmt.push({ type: 'level-reference', level: i as HeadingLevel })
  }
  return fmt
}

/** Build a level style with both format variants */
function buildVariants(
  lv: HeadingLevel,
  withLevelOne: NumberFormatSegment[],
  overrides: Partial<HeadingLevelStyle> = {},
): HeadingLevelStyle {
  return defaultLevelStyle(lv, {
    ...overrides,
    formatVariants: {
      withLevelOne,
      withoutLevelOne: stripLevelOne([...withLevelOne]),
    },
  })
}

// ── Preset builders ──────────────────────────────────────

function buildDecimal(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = buildVariants(lv, buildHierarchical(lv, '.'), { tokenStyle: 'arabic' })
  }
  return levels
}

function buildChineseChapter(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, [{ type: 'literal', value: '第' }, { type: 'level-reference', level: 1 }, { type: 'literal', value: '章' }], { includeParents: false }),
    2: buildVariants(2, [{ type: 'literal', value: '第' }, { type: 'level-reference', level: 2 }, { type: 'literal', value: '节' }], { includeParents: false }),
    3: buildVariants(3, [{ type: 'level-reference', level: 3 }, { type: 'literal', value: '、' }], { includeParents: false }),
    4: buildVariants(4, [{ type: 'literal', value: '（' }, { type: 'level-reference', level: 4 }, { type: 'literal', value: '）' }], { includeParents: false }),
    5: buildVariants(5, [{ type: 'level-reference', level: 5 }, { type: 'literal', value: '.' }], { includeParents: false }),
    6: buildVariants(6, [{ type: 'literal', value: '（' }, { type: 'level-reference', level: 6 }, { type: 'literal', value: '）' }], { includeParents: false }),
  }
}

function buildChineseOutline(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, [{ type: 'level-reference', level: 1 }, { type: 'literal', value: '、' }], { includeParents: false, tokenStyle: 'chinese' }),
    2: buildVariants(2, [{ type: 'literal', value: '（' }, { type: 'level-reference', level: 2 }, { type: 'literal', value: '）' }], { includeParents: false, tokenStyle: 'chinese' }),
    3: buildVariants(3, [{ type: 'level-reference', level: 3 }, { type: 'literal', value: '.' }], { includeParents: false, tokenStyle: 'arabic' }),
    4: buildVariants(4, [{ type: 'literal', value: '（' }, { type: 'level-reference', level: 4 }, { type: 'literal', value: '）' }], { includeParents: false, tokenStyle: 'arabic' }),
    5: buildVariants(5, [{ type: 'level-reference', level: 5 }], { includeParents: false, tokenStyle: 'circled' }),
    6: buildVariants(6, [{ type: 'level-reference', level: 6 }, { type: 'literal', value: '.' }], { includeParents: false, tokenStyle: 'alpha-upper' }),
  }
}

function buildRoman(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    levels[lv] = buildVariants(lv, buildHierarchical(lv, '.'), {
      tokenStyle: lv === 1 ? 'roman-upper' : 'arabic',
    })
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

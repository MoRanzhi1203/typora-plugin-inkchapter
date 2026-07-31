import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  NumberFormatSegment,
  MultilevelFormatSegment,
  HeadingLevelNumberTemplate,
  ContextualFormatSegment,
} from './heading-types'
import { HEADING_LEVELS, createDefaultLevelTemplate, createDefaultReferenceAppearance, generateStableId } from './heading-types'

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
    description: '大写罗马数字层级编号：I、II、III',
    preview: { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' },
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
    contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    ...overrides,
  }
}

/** Build contextual hierarchical composition [H1(arabic)][.][H2(arabic)]...[.][Hlevel(arabic)]. */
function buildContextualHierarchicalComposition(level: HeadingLevel, sep: string): ContextualFormatSegment[] {
  const fmt: ContextualFormatSegment[] = []
  for (let i = 1; i <= level; i++) {
    if (i > 1) fmt.push({ id: generateStableId(), type: 'literal', value: sep })
    fmt.push({
      id: generateStableId(),
      type: 'level-reference',
      level: i as HeadingLevel,
      appearance: createDefaultReferenceAppearance('arabic'),
    })
  }
  return fmt
}

/** Strip level-one references from contextual format. */
function stripContextualLevelOne(format: ContextualFormatSegment[]): ContextualFormatSegment[] {
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: ContextualFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-reference' && seg.level === 1) {
      if (result.length > 0 && result[result.length - 1].type === 'literal') {
        const last = result[result.length - 1]
        if (isSep((last as { type: 'literal'; value: string }).value)) result.pop()
      }
      while (i + 1 < format.length && format[i + 1].type === 'literal') {
        if (!isSep((format[i + 1] as { type: 'literal'; value: string }).value)) break
        i++
      }
      continue
    }
    result.push({ ...seg })
  }

  while (result.length > 0 && result[0].type === 'literal') {
    if (!isSep((result[0] as { type: 'literal'; value: string }).value)) break
    result.shift()
  }
  while (result.length > 0 && result[result.length - 1].type === 'literal') {
    if (!isSep((result[result.length - 1] as { type: 'literal'; value: string }).value)) break
    result.pop()
  }

  // Merge adjacent literals
  const merged: ContextualFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      (merged[merged.length - 1] as { type: 'literal'; value: string }).value += (seg as { type: 'literal'; value: string }).value
    } else {
      merged.push({ ...seg })
    }
  }

  const levels = merged.filter(s => s.type === 'level-reference').map(s => (s as any).level as number)
  const maxLevel = levels.length > 0 ? Math.max(...levels) : 1
  if (!merged.some(s => s.type === 'level-reference' && s.level === maxLevel as HeadingLevel)) {
    merged.push({
      id: generateStableId(),
      type: 'level-reference',
      level: maxLevel as HeadingLevel,
      appearance: createDefaultReferenceAppearance('arabic'),
    })
  }

  return merged.length > 0 ? merged : [{
    id: generateStableId(),
    type: 'level-reference',
    level: 2 as HeadingLevel,
    appearance: createDefaultReferenceAppearance('arabic'),
  }]
}

/** Build a contextual variant pair for the two-layer model. */
function buildContextualVariants(
  lv: HeadingLevel,
  templateOverride: Partial<HeadingLevelNumberTemplate>,
  withLevelOne: ContextualFormatSegment[],
  overrides: Partial<HeadingLevelStyle> = {},
): { withLevelOne: ContextualFormatSegment[]; withoutLevelOne: ContextualFormatSegment[] } {
  return {
    withLevelOne: [...withLevelOne],
    withoutLevelOne: stripContextualLevelOne([...withLevelOne]),
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
  /** Contextual format segments (with correct appearance). If omitted, builds hierarchical decimal. */
  contextualWithLevelOne?: ContextualFormatSegment[],
): HeadingLevelStyle {
  const ctxFormat = contextualWithLevelOne ?? buildContextualHierarchicalComposition(lv, '.')
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
    contextualFormatVariants: {
      withLevelOne: ctxFormat,
      withoutLevelOne: stripContextualLevelOne(ctxFormat),
    },
  })
  // Sync legacy tokenStyle for backward compat
  st.tokenStyle = st.levelTemplate.tokenStyle
  return st
}

/** Build a single contextual level-reference segment for a level with given appearance. */
function makeContextualRef(
  lv: HeadingLevel,
  tokenStyle: import('./heading-types').NumberTokenStyle,
  prefix: string,
  suffix: string,
): ContextualFormatSegment {
  return {
    id: generateStableId(),
    type: 'level-reference',
    level: lv,
    appearance: { tokenStyle, prefix, suffix },
  }
}

// ── Preset builders ──────────────────────────────────────

function buildDecimal(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const ctxFmt = buildContextualHierarchicalComposition(lv, '.')
    levels[lv] = buildVariants(lv, { tokenStyle: 'arabic' }, buildHierarchicalComposition(lv, '.'), { includeParents: false }, ctxFmt)
  }
  return levels
}

function buildChineseChapter(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, { tokenStyle: 'chinese', prefix: '第', suffix: '章' },
      [{ type: 'level-template-reference', level: 1 }], { includeParents: false },
      [makeContextualRef(1, 'chinese', '第', '章')]),
    2: buildVariants(2, { tokenStyle: 'chinese', prefix: '第', suffix: '节' },
      [{ type: 'level-template-reference', level: 2 }], { includeParents: false },
      [makeContextualRef(2, 'chinese', '第', '节')]),
    3: buildVariants(3, { tokenStyle: 'chinese', prefix: '', suffix: '、' },
      [{ type: 'level-template-reference', level: 3 }], { includeParents: false },
      [makeContextualRef(3, 'chinese', '', '、')]),
    4: buildVariants(4, { tokenStyle: 'chinese', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 4 }], { includeParents: false },
      [makeContextualRef(4, 'chinese', '（', '）')]),
    5: buildVariants(5, { tokenStyle: 'arabic', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 5 }], { includeParents: false },
      [makeContextualRef(5, 'arabic', '', '.')]),
    6: buildVariants(6, { tokenStyle: 'arabic', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 6 }], { includeParents: false },
      [makeContextualRef(6, 'arabic', '（', '）')]),
  }
}

function buildChineseOutline(): Record<HeadingLevel, HeadingLevelStyle> {
  return {
    1: buildVariants(1, { tokenStyle: 'chinese', prefix: '', suffix: '、' },
      [{ type: 'level-template-reference', level: 1 }], { includeParents: false },
      [makeContextualRef(1, 'chinese', '', '、')]),
    2: buildVariants(2, { tokenStyle: 'chinese', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 2 }], { includeParents: false },
      [makeContextualRef(2, 'chinese', '（', '）')]),
    3: buildVariants(3, { tokenStyle: 'arabic', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 3 }], { includeParents: false },
      [makeContextualRef(3, 'arabic', '', '.')]),
    4: buildVariants(4, { tokenStyle: 'arabic', prefix: '（', suffix: '）' },
      [{ type: 'level-template-reference', level: 4 }], { includeParents: false },
      [makeContextualRef(4, 'arabic', '（', '）')]),
    5: buildVariants(5, { tokenStyle: 'circled', prefix: '', suffix: '' },
      [{ type: 'level-template-reference', level: 5 }], { includeParents: false },
      [makeContextualRef(5, 'circled', '', '')]),
    6: buildVariants(6, { tokenStyle: 'alpha-upper', prefix: '', suffix: '.' },
      [{ type: 'level-template-reference', level: 6 }], { includeParents: false },
      [makeContextualRef(6, 'alpha-upper', '', '.')]),
  }
}

function buildRoman(): Record<HeadingLevel, HeadingLevelStyle> {
  // Spec: H2 is the primary Roman level.
  //   H1 (if shown): I    (roman-upper)
  //   H2:              I    (roman-upper)
  //   H3:              I.1  (H2 roman-upper + . + H3 arabic)
  //   H4:              I.1.1
  // Only H1-H2 use roman-upper; H3-H6 use arabic.
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const tokenStyle: import('./heading-types').NumberTokenStyle =
      lv <= 2 ? 'roman-upper' : 'arabic'

    // Contextual format: each level-ref uses its own tokenStyle
    const ctxFmtWith: ContextualFormatSegment[] = []
    for (let i = 1; i <= lv; i++) {
      if (i > 1) ctxFmtWith.push({ id: generateStableId(), type: 'literal', value: '.' })
      const refStyle: import('./heading-types').NumberTokenStyle =
        i <= 2 ? 'roman-upper' : 'arabic'
      ctxFmtWith.push(makeContextualRef(i as HeadingLevel, refStyle, '', ''))
    }

    // withoutLevelOne: skip H1
    const ctxFmtWithout: ContextualFormatSegment[] = []
    for (let i = 2; i <= lv; i++) {
      if (i > 2) ctxFmtWithout.push({ id: generateStableId(), type: 'literal', value: '.' })
      const refStyle: import('./heading-types').NumberTokenStyle =
        i <= 2 ? 'roman-upper' : 'arabic'
      ctxFmtWithout.push(makeContextualRef(i as HeadingLevel, refStyle, '', ''))
    }

    // Multilevel format: level-template-refs inherit their level's tokenStyle
    const withL1 = buildHierarchicalComposition(lv, '.')

    levels[lv] = {
      ...defaultLevelStyle(lv, {
        tokenStyle,
        includeParents: false,
        levelTemplate: createDefaultLevelTemplate(tokenStyle),
        multilevelFormatVariants: {
          withLevelOne: withL1,
          withoutLevelOne: stripLevelOne(withL1),
        },
        contextualFormatVariants: {
          withLevelOne: ctxFmtWith,
          withoutLevelOne: ctxFmtWithout,
        },
      }),
    }
  }
  return levels
}

// ── Helpers ──────────────────────────────────────────────

/** Get the effective level styles for a given preset. Returns a fresh copy each time. */
export function getPresetLevels(preset: HeadingNumberingPreset): Record<HeadingLevel, HeadingLevelStyle> {
  if (preset === 'custom') {
    return deepClonePresetLevels(buildDecimal())
  }
  return deepClonePresetLevels(PRESETS[preset].levels)
}

/** Type-safe deep clone for preset levels — no JSON round-trip, no shared references. */
function deepClonePresetLevels(
  levels: Record<HeadingLevel, HeadingLevelStyle>,
): Record<HeadingLevel, HeadingLevelStyle> {
  const cloned = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lvStr of Object.keys(levels)) {
    const lv = Number(lvStr) as HeadingLevel
    const s = levels[lv]
    cloned[lv] = {
      enabled: s.enabled,
      tokenStyle: s.tokenStyle,
      includeParents: s.includeParents,
      prefix: s.prefix,
      suffix: s.suffix,
      separator: s.separator,
      startAt: s.startAt,
      restartAfterLevel: s.restartAfterLevel,
      formatVariants: {
        withLevelOne: s.formatVariants.withLevelOne.map(seg => ({ ...seg })),
        withoutLevelOne: s.formatVariants.withoutLevelOne.map(seg => ({ ...seg })),
      },
      levelTemplate: { ...s.levelTemplate },
      multilevelFormatVariants: {
        withLevelOne: s.multilevelFormatVariants.withLevelOne.map(seg => ({ ...seg })),
        withoutLevelOne: s.multilevelFormatVariants.withoutLevelOne.map(seg => ({ ...seg })),
      },
      contextualFormatVariants: {
        withLevelOne: s.contextualFormatVariants.withLevelOne.map(seg => ({
          ...seg,
          appearance: seg.type === 'level-reference'
            ? { ...(seg as any).appearance }
            : undefined,
        })),
        withoutLevelOne: s.contextualFormatVariants.withoutLevelOne.map(seg => ({
          ...seg,
          appearance: seg.type === 'level-reference'
            ? { ...(seg as any).appearance }
            : undefined,
        })),
      },
    }
  }
  return cloned
}

/** Get the preview for a preset. */
export function getPresetPreview(preset: HeadingNumberingPreset): Record<HeadingLevel, string> {
  if (preset === 'custom') return PRESETS['decimal-hierarchical'].preview
  return { ...PRESETS[preset].preview }
}

export const PRESET_LIST: PresetMeta[] = Object.values(PRESETS)

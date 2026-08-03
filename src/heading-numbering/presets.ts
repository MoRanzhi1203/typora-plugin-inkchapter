import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  MultilevelFormatSegment,
  HeadingLevelNumberTemplate,
  ContextualFormatSegment,
  NumberTokenStyle,
  LevelReferenceAppearance,
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
    description: '通用阿拉伯数字多级编号',
    preview: { 1: '1', 2: '1.1', 3: '1.1.1', 4: '1.1.1.1', 5: '1.1.1.1.1', 6: '1.1.1.1.1.1' },
    levels: buildDecimalHierarchical(),
  },
  'chinese-chapter': {
    key: 'chinese-chapter',
    name: '中文章节',
    description: '章、节与中文条目结构',
    preview: { 1: '第一章', 2: '第一节', 3: '一、', 4: '（一）', 5: '1.', 6: '（1）' },
    levels: buildChineseChapter(),
  },
  'chinese-outline': {
    key: 'chinese-outline',
    name: '党政公文（四级）',
    description: '党政机关公文常用四级结构',
    preview: { 1: '一、', 2: '（一）', 3: '1.', 4: '（1）', 5: '—', 6: '—' },
    levels: buildChineseOutline(),
  },
  'academic-paper': {
    key: 'academic-paper',
    name: '学术论文',
    description: '章标题与十进制层级结合',
    preview: { 1: '第1章', 2: '第1章.1', 3: '第1章.1.1', 4: '第1章.1.1.1', 5: '第1章.1.1.1.1', 6: '第1章.1.1.1.1.1' },
    levels: buildAcademicPaper(),
  },
  'chapter-section-clause': {
    key: 'chapter-section-clause',
    name: '章—节—条款',
    description: '章节、节次与条款结构',
    preview: { 1: '第一章', 2: '第一节', 3: '第一条', 4: '一、', 5: '（一）', 6: '1.' },
    levels: buildChapterSectionClause(),
  },
  'appendix-hierarchical': {
    key: 'appendix-hierarchical',
    name: '附录层级',
    description: '附录及补充材料编号',
    preview: { 1: '附录A', 2: '附录A.1', 3: '附录A.1.1', 4: '附录A.1.1.1', 5: '附录A.1.1.1.1', 6: '附录A.1.1.1.1.1' },
    levels: buildAppendixHierarchical(),
  },
  'roman-hierarchical': {
    key: 'roman-hierarchical',
    name: '全罗马层级',
    description: '所有层级均使用大写罗马数字',
    preview: { 1: 'I', 2: 'I.I', 3: 'I.I.I', 4: 'I.I.I.I', 5: 'I.I.I.I.I', 6: 'I.I.I.I.I.I' },
    levels: buildRomanHierarchical(),
  },
  'roman-mixed': {
    key: 'roman-mixed',
    name: '罗马混合层级',
    description: '首级罗马、后级阿拉伯',
    preview: { 1: 'I', 2: 'I.1', 3: 'I.1.1', 4: 'I.1.1.1', 5: 'I.1.1.1.1', 6: 'I.1.1.1.1.1' },
    levels: buildRomanMixed(),
  },
  'letter-mixed': {
    key: 'letter-mixed',
    name: '字母混合层级',
    description: '字母、数字与小写罗马混合',
    preview: { 1: 'A', 2: 'A.1', 3: 'A.1.a', 4: 'A.1.a.i', 5: 'A.1.a.i.1', 6: 'A.1.a.i.1.a' },
    levels: buildLetterMixed(),
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

/** Create a literal segment. */
function lit(value: string): ContextualFormatSegment {
  return { id: generateStableId(), type: 'literal', value }
}

/** Create a level-reference segment with given appearance. */
function ref(
  lv: HeadingLevel,
  tokenStyle: NumberTokenStyle,
  prefix = '',
  suffix = '',
): ContextualFormatSegment {
  return {
    id: generateStableId(),
    type: 'level-reference',
    level: lv,
    appearance: { tokenStyle, prefix, suffix },
  }
}

/** Build the legacy levelTemplate from tokenStyle/prefix/suffix. */
function tpl(tokenStyle: NumberTokenStyle, prefix = '', suffix = ''): HeadingLevelNumberTemplate {
  return { tokenStyle, prefix, suffix }
}

/**
 * Build a hierarchical contextual format: [H1(style1)] [sep] [H2(style2)] [sep] ... [H{lvl}(style_lvl)]
 * @param lv  target level
 * @param sep  separator literal
 * @param styles  array of [tokenStyle, prefix, suffix] tuples for levels 1..lv
 */
function ctxHierarchical(
  lv: HeadingLevel,
  sep: string,
  styles: [NumberTokenStyle, string, string][],
): ContextualFormatSegment[] {
  const result: ContextualFormatSegment[] = []
  for (let i = 1; i <= lv; i++) {
    if (i > 1) result.push(lit(sep))
    const s = styles[i - 1]
    result.push(ref(i as HeadingLevel, s[0], s[1], s[2]))
  }
  return result
}

/**
 * Build a hierarchical contextual format that starts from `startLv` instead of H1.
 * Used for withoutLevelOne variants where the first visible level may need different appearance.
 * @param startLv  first level to include (e.g. 2 for H1-removed)
 * @param lv       target level
 * @param sep      separator
 * @param styles   array of [tokenStyle, prefix, suffix] tuples for levels startLv..lv
 */
function ctxHierarchicalFrom(
  startLv: HeadingLevel,
  lv: HeadingLevel,
  sep: string,
  styles: [NumberTokenStyle, string, string][],
): ContextualFormatSegment[] {
  const result: ContextualFormatSegment[] = []
  for (let i = startLv; i <= lv; i++) {
    if (i > startLv) result.push(lit(sep))
    const idx = i - startLv
    const s = styles[idx]
    result.push(ref(i as HeadingLevel, s[0], s[1], s[2]))
  }
  return result
}

/**
 * Strip H1 level-references from a contextual format.
 * Only removes H1 refs — does NOT shift formats.
 * Appropriate for hierarchical presets where all levels share the same tokenStyle.
 */
function stripContextualLevelOne(format: ContextualFormatSegment[]): ContextualFormatSegment[] {
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: ContextualFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-reference' && seg.level === 1) {
      // Remove preceding literal if it's a separator
      if (result.length > 0 && result[result.length - 1].type === 'literal') {
        const last = result[result.length - 1]
        if (isSep((last as { type: 'literal'; value: string }).value)) result.pop()
      }
      // Skip following separator literals
      while (i + 1 < format.length && format[i + 1].type === 'literal') {
        if (!isSep((format[i + 1] as { type: 'literal'; value: string }).value)) break
        i++
      }
      continue
    }
    result.push({ ...seg })
  }

  // Clean leading/trailing separators
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

  // Ensure current (max) level ref exists
  const levels = merged.filter(s => s.type === 'level-reference').map(s => (s as any).level as number)
  const maxLvl = levels.length > 0 ? Math.max(...levels) : 1
  if (merged.length === 0 || !merged.some(s => s.type === 'level-reference' && s.level === maxLvl as HeadingLevel)) {
    merged.push({
      id: generateStableId(),
      type: 'level-reference',
      level: maxLvl as HeadingLevel,
      appearance: createDefaultReferenceAppearance('arabic'),
    })
  }

  return merged
}

/** Build hierarchical multilevel composition [H1].[H2]...[Hlevel]. */
function mfHierarchical(lv: HeadingLevel, sep: string): MultilevelFormatSegment[] {
  const fmt: MultilevelFormatSegment[] = []
  for (let i = 1; i <= lv; i++) {
    if (i > 1) fmt.push({ type: 'literal', value: sep })
    fmt.push({ type: 'level-template-reference', level: i as HeadingLevel })
  }
  return fmt
}

/** Strip H1 references from multilevel format. */
function stripMfLevelOne(format: MultilevelFormatSegment[]): MultilevelFormatSegment[] {
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: MultilevelFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-template-reference' && seg.level === 1) {
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

  const merged: MultilevelFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      const last = merged[merged.length - 1] as { type: 'literal'; value: string }
      last.value += seg.value
    } else {
      merged.push({ ...seg })
    }
  }

  const levels = merged.filter(s => s.type === 'level-template-reference').map(s => (s as any).level as number)
  const maxLvl = levels.length > 0 ? Math.max(...levels) : 1
  if (merged.length === 0 || !merged.some(s => s.type === 'level-template-reference' && s.level === maxLvl as HeadingLevel)) {
    merged.push({ type: 'level-template-reference', level: maxLvl as HeadingLevel })
  }

  return merged
}

/**
 * Build a level style with both format variants.
 * Used for simple hierarchical presets where withoutLevelOne = strip H1.
 */
function makeStyle(
  lv: HeadingLevel,
  tokenStyle: NumberTokenStyle,
  levelTpl: HeadingLevelNumberTemplate,
  ctxWithLevelOne: ContextualFormatSegment[],
  overrides: Partial<HeadingLevelStyle> = {},
): HeadingLevelStyle {
  const mfWith = mfHierarchical(lv, '.')
  return {
    ...defaultLevelStyle(lv, {
      tokenStyle,
      levelTemplate: { ...levelTpl },
      multilevelFormatVariants: {
        withLevelOne: mfWith,
        withoutLevelOne: stripMfLevelOne(mfWith),
      },
      contextualFormatVariants: {
        withLevelOne: ctxWithLevelOne,
        withoutLevelOne: stripContextualLevelOne(ctxWithLevelOne),
      },
      ...overrides,
    }),
  }
}

/**
 * Build a standalone level style (only references itself, not parents).
 * Both withLevelOne and withoutLevelOne contain a single self-reference
 * with the given appearance.
 */
function makeStandaloneStyle(
  lv: HeadingLevel,
  tokenStyle: NumberTokenStyle,
  prefix: string,
  suffix: string,
): HeadingLevelStyle {
  const selfRef = ref(lv, tokenStyle, prefix, suffix)
  return {
    ...defaultLevelStyle(lv, {
      tokenStyle,
      includeParents: false,
      levelTemplate: tpl(tokenStyle, prefix, suffix),
      multilevelFormatVariants: {
        withLevelOne: [{ type: 'level-template-reference', level: lv }],
        withoutLevelOne: [{ type: 'level-template-reference', level: lv }],
      },
      contextualFormatVariants: {
        withLevelOne: [selfRef],
        withoutLevelOne: [selfRef],
      },
    }),
  }
}

/**
 * Build a level style for a "shifting" standalone preset.
 * withLevelOne: standalone self-ref with own appearance.
 * withoutLevelOne: standalone self-ref with shifted appearance (from the format one level above).
 */
function makeShiftingLevel(
  lv: HeadingLevel,
  ownTokenStyle: NumberTokenStyle,
  ownPrefix: string,
  ownSuffix: string,
  shiftedTokenStyle: NumberTokenStyle,
  shiftedPrefix: string,
  shiftedSuffix: string,
): HeadingLevelStyle {
  const selfRefWith = ref(lv, ownTokenStyle, ownPrefix, ownSuffix)
  const selfRefWithout = ref(lv, shiftedTokenStyle, shiftedPrefix, shiftedSuffix)
  return {
    ...defaultLevelStyle(lv, {
      tokenStyle: ownTokenStyle,
      includeParents: false,
      levelTemplate: tpl(ownTokenStyle, ownPrefix, ownSuffix),
      multilevelFormatVariants: {
        withLevelOne: [{ type: 'level-template-reference', level: lv }],
        withoutLevelOne: [{ type: 'level-template-reference', level: lv }],
      },
      contextualFormatVariants: {
        withLevelOne: [selfRefWith],
        withoutLevelOne: [selfRefWithout],
      },
    }),
  }
}

/**
 * Build a level style where withLevelOne is hierarchical (includes parents)
 * and withoutLevelOne is hierarchical starting from H2 with shifted format.
 * Used for withoutLevelOne in academic-paper and appendix-hierarchical
 * where the first visible level takes a special appearance.
 */
function makeHierarchicalShifted(
  lv: HeadingLevel,
  ownTokenStyle: NumberTokenStyle,
  ownLevelTpl: HeadingLevelNumberTemplate,
  ctxWithLevelOne: ContextualFormatSegment[],
  ctxWithoutLevelOne: ContextualFormatSegment[],
): HeadingLevelStyle {
  const mfWith = mfHierarchical(lv, '.')
  return {
    ...defaultLevelStyle(lv, {
      tokenStyle: ownTokenStyle,
      levelTemplate: { ...ownLevelTpl },
      multilevelFormatVariants: {
        withLevelOne: mfWith,
        withoutLevelOne: stripMfLevelOne(mfWith),
      },
      contextualFormatVariants: {
        withLevelOne: ctxWithLevelOne,
        withoutLevelOne: ctxWithoutLevelOne,
      },
    }),
  }
}

// ── Preset builders ──────────────────────────────────────

/**
 * 1. decimal-hierarchical — 十进制层级
 * All levels use arabic, separator '.'
 */
function buildDecimalHierarchical(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  const uniformStyles: [NumberTokenStyle, string, string][] = [
    ['arabic', '', ''], ['arabic', '', ''], ['arabic', '', ''],
    ['arabic', '', ''], ['arabic', '', ''], ['arabic', '', ''],
  ]
  for (const lv of HEADING_LEVELS) {
    const ctxWith = ctxHierarchical(lv, '.', uniformStyles)
    levels[lv] = makeStyle(lv, 'arabic', tpl('arabic'), ctxWith)
  }
  return levels
}

/**
 * 2. chinese-chapter — 中文章节
 * Format sequence: 第一章, 第一节, 一、, （一）, 1., （1）
 * Each level standalone. withoutLevelOne shifts format up.
 */
function buildChineseChapter(): Record<HeadingLevel, HeadingLevelStyle> {
  // Format definitions by position (position 0 = what H1 uses, position 1 = what H2 uses, etc.)
  const fmtSeq: [NumberTokenStyle, string, string][] = [
    ['chinese', '第', '章'],   // H1 in withLevelOne, H2 in withoutLevelOne
    ['chinese', '第', '节'],   // H2 in withLevelOne, H3 in withoutLevelOne
    ['chinese', '', '、'],     // H3 in withLevelOne, H4 in withoutLevelOne
    ['chinese', '（', '）'],   // H4 in withLevelOne, H5 in withoutLevelOne
    ['arabic',  '', '.'],      // H5 in withLevelOne, H6 in withoutLevelOne
    ['arabic',  '（', '）'],   // H6 in withLevelOne
  ]

  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const ownIdx = lv - 1
    const shiftedIdx = ownIdx - 1 // when H1 removed, each level takes the format above it
    const own = fmtSeq[ownIdx]
    const shifted = shiftedIdx >= 0 ? fmtSeq[shiftedIdx] : own
    levels[lv] = makeShiftingLevel(
      lv,
      own[0], own[1], own[2],
      shifted[0], shifted[1], shifted[2],
    )
  }
  return levels
}

/**
 * 3. chinese-outline — 党政公文（四级）
 * Format sequence: 一、, （一）, 1., （1）
 * Only H1-H4 enabled. H5-H6 disabled.
 * withoutLevelOne shifts format up.
 */
function buildChineseOutline(): Record<HeadingLevel, HeadingLevelStyle> {
  const fmtSeq: [NumberTokenStyle, string, string][] = [
    ['chinese', '', '、'],     // position 0: 一、
    ['chinese', '（', '）'],  // position 1: （一）
    ['arabic',  '', '.'],      // position 2: 1.
    ['arabic',  '（', '）'],  // position 3: （1）
    ['arabic',  '', ''],       // position 4 (H5) — disabled in withLevelOne
    ['arabic',  '', ''],       // position 5 (H6) — disabled
  ]

  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const ownIdx = lv - 1
    const shiftedIdx = ownIdx - 1
    const own = fmtSeq[ownIdx]
    const shifted = shiftedIdx >= 0 ? fmtSeq[shiftedIdx] : own

    // H5-H6: disabled in withLevelOne
    const isDisabledInWith = lv >= 5
    // H6: always disabled
    const isDisabled = lv >= 6

    if (isDisabledInWith) {
      // Levels 5-6: disabled when H1 is shown, but may be enabled in withoutLevelOne
      if (isDisabled) {
        // H6: fully disabled
        levels[lv] = {
          ...defaultLevelStyle(lv, {
            enabled: false,
            tokenStyle: 'arabic',
            levelTemplate: tpl('arabic'),
            contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
            multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
          }),
        }
      } else {
        // H5: disabled in withLevelOne, enabled in withoutLevelOne with shifted format
        const selfRefWithout = ref(lv, shifted[0], shifted[1], shifted[2])
        levels[lv] = {
          ...defaultLevelStyle(lv, {
            enabled: false,
            tokenStyle: own[0],
            levelTemplate: tpl(own[0], own[1], own[2]),
            contextualFormatVariants: {
              withLevelOne: [],
              withoutLevelOne: [selfRefWithout],
            },
            multilevelFormatVariants: {
              withLevelOne: [],
              withoutLevelOne: [{ type: 'level-template-reference', level: lv }],
            },
          }),
        }
      }
    } else {
      // H1-H4: enabled, standalone, shifts on withoutLevelOne
      levels[lv] = makeShiftingLevel(
        lv,
        own[0], own[1], own[2],
        shifted[0], shifted[1], shifted[2],
      )
    }
  }
  return levels
}

/**
 * 4. academic-paper — 学术论文
 * H1: standalone '第n章'
 * H2-H6: hierarchical [H1(第,章)].[H2].[H3]...
 * withoutLevelOne: H2 becomes standalone '第n章', H3+ hierarchical from H2
 */
function buildAcademicPaper(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>

  // H1: standalone 第n章
  levels[1] = makeStandaloneStyle(1, 'arabic', '第', '章')

  // H2-H6: hierarchical
  for (let i = 2; i <= 6; i++) {
    const lv = i as HeadingLevel

    // withLevelOne: [H1(第,章)].[H2(arabic)]...[Hlv(arabic)]
    const ctxWith: ContextualFormatSegment[] = [ref(1, 'arabic', '第', '章')]
    for (let j = 2; j <= lv; j++) {
      ctxWith.push(lit('.'))
      ctxWith.push(ref(j as HeadingLevel, 'arabic', '', ''))
    }

    // withoutLevelOne: H2 gets standalone 第n章; H3+ hierarchical from H2(第,章)
    const ctxWithout: ContextualFormatSegment[] = [ref(2, 'arabic', '第', '章')]
    for (let j = 3; j <= lv; j++) {
      ctxWithout.push(lit('.'))
      ctxWithout.push(ref(j as HeadingLevel, 'arabic', '', ''))
    }

    const mfWith: MultilevelFormatSegment[] = [{ type: 'level-template-reference', level: 1 }]
    for (let j = 2; j <= lv; j++) {
      mfWith.push({ type: 'literal', value: '.' })
      mfWith.push({ type: 'level-template-reference', level: j as HeadingLevel })
    }

    levels[lv] = {
      ...defaultLevelStyle(lv, {
        tokenStyle: 'arabic',
        levelTemplate: tpl('arabic'),
        multilevelFormatVariants: {
          withLevelOne: mfWith,
          withoutLevelOne: stripMfLevelOne(mfWith),
        },
        contextualFormatVariants: {
          withLevelOne: ctxWith,
          withoutLevelOne: ctxWithout,
        },
      }),
    }
  }

  return levels
}

/**
 * 5. chapter-section-clause — 章—节—条款
 * All levels standalone. withoutLevelOne shifts format up.
 *   H1: 第n章, H2: 第n节, H3: 第n条, H4: 一、, H5: （一）, H6: 1.
 */
function buildChapterSectionClause(): Record<HeadingLevel, HeadingLevelStyle> {
  const fmtSeq: [NumberTokenStyle, string, string][] = [
    ['arabic',  '第', '章'],   // H1 with, H2 without
    ['arabic',  '第', '节'],   // H2 with, H3 without
    ['arabic',  '第', '条'],   // H3 with, H4 without
    ['chinese', '',  '、'],    // H4 with, H5 without
    ['chinese', '（', '）'],  // H5 with, H6 without
    ['arabic',  '',  '.'],     // H6 with
  ]

  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const ownIdx = lv - 1
    const shiftedIdx = ownIdx - 1
    const own = fmtSeq[ownIdx]
    const shifted = shiftedIdx >= 0 ? fmtSeq[shiftedIdx] : own
    levels[lv] = makeShiftingLevel(
      lv,
      own[0], own[1], own[2],
      shifted[0], shifted[1], shifted[2],
    )
  }
  return levels
}

/**
 * 6. appendix-hierarchical — 附录层级
 * H1: standalone '附录A' (alpha-upper)
 * H2-H6: hierarchical [H1(附录, alpha-upper)].[H2(arabic)]...[Hlv(arabic)]
 * withoutLevelOne: H2 becomes standalone '附录A', H3+ hierarchical from H2(附录, alpha-upper)
 */
function buildAppendixHierarchical(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>

  // H1: standalone 附录A
  levels[1] = makeStandaloneStyle(1, 'alpha-upper', '附录', '')

  // H2-H6: hierarchical
  for (let i = 2; i <= 6; i++) {
    const lv = i as HeadingLevel

    // withLevelOne: [H1(附录, alpha-upper)].[H2(arabic)]...[Hlv(arabic)]
    const ctxWith: ContextualFormatSegment[] = [ref(1, 'alpha-upper', '附录', '')]
    for (let j = 2; j <= lv; j++) {
      ctxWith.push(lit('.'))
      ctxWith.push(ref(j as HeadingLevel, 'arabic', '', ''))
    }

    // withoutLevelOne: H2 standalone 附录A; H3+ hierarchical from H2(附录, alpha-upper)
    const ctxWithout: ContextualFormatSegment[] = [ref(2, 'alpha-upper', '附录', '')]
    for (let j = 3; j <= lv; j++) {
      ctxWithout.push(lit('.'))
      ctxWithout.push(ref(j as HeadingLevel, 'arabic', '', ''))
    }

    const mfWith: MultilevelFormatSegment[] = [{ type: 'level-template-reference', level: 1 }]
    for (let j = 2; j <= lv; j++) {
      mfWith.push({ type: 'literal', value: '.' })
      mfWith.push({ type: 'level-template-reference', level: j as HeadingLevel })
    }

    levels[lv] = {
      ...defaultLevelStyle(lv, {
        tokenStyle: 'arabic',
        levelTemplate: tpl('arabic'),
        multilevelFormatVariants: {
          withLevelOne: mfWith,
          withoutLevelOne: stripMfLevelOne(mfWith),
        },
        contextualFormatVariants: {
          withLevelOne: ctxWith,
          withoutLevelOne: ctxWithout,
        },
      }),
    }
  }

  return levels
}

/**
 * 7. roman-hierarchical — 全罗马层级
 * All levels use roman-upper, separator '.'
 */
function buildRomanHierarchical(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  const uniformStyles: [NumberTokenStyle, string, string][] = [
    ['roman-upper', '', ''], ['roman-upper', '', ''], ['roman-upper', '', ''],
    ['roman-upper', '', ''], ['roman-upper', '', ''], ['roman-upper', '', ''],
  ]
  for (const lv of HEADING_LEVELS) {
    const ctxWith = ctxHierarchical(lv, '.', uniformStyles)
    levels[lv] = makeStyle(lv, 'roman-upper', tpl('roman-upper'), ctxWith)
  }
  return levels
}

/**
 * 8. roman-mixed — 罗马混合层级
 * H1 (first visible): roman-upper; H2-H6: arabic
 * Separator: '.'
 * withoutLevelOne: H2 becomes roman-upper standalone, H3+ arabic under H2(roman-upper)
 */
function buildRomanMixed(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  const stylesWith: [NumberTokenStyle, string, string][] = [
    ['roman-upper', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
  ]
  const stylesWithout: [NumberTokenStyle, string, string][] = [
    ['roman-upper', '', ''],  // H2 gets roman-upper
    ['arabic', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
    ['arabic', '', ''],
  ]

  for (const lv of HEADING_LEVELS) {
    if (lv === 1) {
      // H1: standalone roman-upper
      const ctxWith = [ref(1, 'roman-upper', '', '')]
      levels[1] = makeStyle(1, 'roman-upper', tpl('roman-upper'), ctxWith)
    } else {
      const ctxWith = ctxHierarchical(lv, '.', stylesWith)
      const ctxWithout = ctxHierarchicalFrom(2, lv, '.', stylesWithout)
      // Adjust: H2 in withoutLevelOne should reference itself, not parent
      // For lv=2: ctxWithout = [ref(2, roman-upper)] — correct (standalone)
      // For lv=3: ctxWithout = [ref(2, roman-upper), lit('.'), ref(3, arabic)] — correct

      const mfWith = mfHierarchical(lv, '.')
      levels[lv] = {
        ...defaultLevelStyle(lv, {
          tokenStyle: 'arabic',
          levelTemplate: tpl('arabic'),
          multilevelFormatVariants: {
            withLevelOne: mfWith,
            withoutLevelOne: stripMfLevelOne(mfWith),
          },
          contextualFormatVariants: {
            withLevelOne: ctxWith,
            withoutLevelOne: ctxWithout,
          },
        }),
      }
    }
  }
  return levels
}

/**
 * 9. letter-mixed — 字母混合层级
 * Token styles: alpha-upper → arabic → alpha-lower → roman-lower → arabic → alpha-lower
 * Separator: '.'
 * withoutLevelOne: shifts sequence (H2 gets alpha-upper, H3 gets arabic, ...)
 */
function buildLetterMixed(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  // Sequence for withLevelOne (positions 0-5 = H1-H6 styles)
  const stylesWith: [NumberTokenStyle, string, string][] = [
    ['alpha-upper', '', ''],  // H1
    ['arabic',      '', ''],  // H2
    ['alpha-lower', '', ''],  // H3
    ['roman-lower', '', ''],  // H4
    ['arabic',      '', ''],  // H5
    ['alpha-lower', '', ''],  // H6
  ]
  // Sequence for withoutLevelOne (H2 gets position 0, H3 gets position 1, ...)
  // This is the same as stylesWith but starting from H2
  const stylesWithout: [NumberTokenStyle, string, string][] = [
    ['alpha-upper', '', ''],  // H2
    ['arabic',      '', ''],  // H3
    ['alpha-lower', '', ''],  // H4
    ['roman-lower', '', ''],  // H5
    ['arabic',      '', ''],  // H6
  ]

  for (const lv of HEADING_LEVELS) {
    const ctxWith = ctxHierarchical(lv, '.', stylesWith)
    const ctxWithout = lv === 1
      ? []
      : ctxHierarchicalFrom(2, lv, '.', stylesWithout)

    const ownTokenStyle = stylesWith[lv - 1][0]

    const mfWith = mfHierarchical(lv, '.')
    levels[lv] = {
      ...defaultLevelStyle(lv, {
        tokenStyle: ownTokenStyle,
        levelTemplate: tpl(ownTokenStyle),
        multilevelFormatVariants: {
          withLevelOne: mfWith,
          withoutLevelOne: stripMfLevelOne(mfWith),
        },
        contextualFormatVariants: {
          withLevelOne: ctxWith,
          withoutLevelOne: ctxWithout,
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
    return deepClonePresetLevels(buildDecimalHierarchical())
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
  if (preset === 'custom') return { ...PRESETS['decimal-hierarchical'].preview }
  return { ...PRESETS[preset].preview }
}

export const PRESET_LIST: PresetMeta[] = Object.values(PRESETS)

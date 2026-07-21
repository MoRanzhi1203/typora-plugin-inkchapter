import type { HeadingLevel, HeadingLevelDefinition, HeadingNumberingPreset, NumberFormatSegment } from './heading-types'
import { HEADING_LEVELS, DEFAULT_POSITION } from './heading-types'

// ── Helpers ──────────────────────────────────────────────

function ref(level: HeadingLevel): NumberFormatSegment {
  return { type: 'level-reference', level }
}

function lit(value: string): NumberFormatSegment {
  return { type: 'literal', value }
}

function def(
  numberStyle: HeadingLevelDefinition['numberStyle'],
  format: NumberFormatSegment[],
  overrides: Partial<Pick<HeadingLevelDefinition, 'startAt' | 'restartAfterLevel' | 'legalStyle'>> = {},
): HeadingLevelDefinition {
  return {
    enabled: true,
    numberStyle,
    format,
    startAt: overrides.startAt ?? 1,
    restartAfterLevel: overrides.restartAfterLevel ?? null,
    legalStyle: overrides.legalStyle ?? false,
    position: { ...DEFAULT_POSITION },
  }
}

// ── Preset builders ──────────────────────────────────────

function buildDecimal(): Record<HeadingLevel, HeadingLevelDefinition> {
  const levels = {} as Record<HeadingLevel, HeadingLevelDefinition>
  levels[1] = def('arabic', [ref(1)])
  levels[2] = def('arabic', [ref(1), lit('.'), ref(2)], { restartAfterLevel: 1 })
  levels[3] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3)], { restartAfterLevel: 2 })
  levels[4] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4)], { restartAfterLevel: 3 })
  levels[5] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4), lit('.'), ref(5)], { restartAfterLevel: 4 })
  levels[6] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4), lit('.'), ref(5), lit('.'), ref(6)], { restartAfterLevel: 5 })
  return levels
}

function buildChineseChapter(): Record<HeadingLevel, HeadingLevelDefinition> {
  return {
    1: def('chinese', [lit('第'), ref(1), lit('章')]),
    2: def('chinese', [lit('第'), ref(2), lit('节')], { restartAfterLevel: 1 }),
    3: def('chinese', [ref(3), lit('、')], { restartAfterLevel: 2 }),
    4: def('chinese', [lit('（'), ref(4), lit('）')], { restartAfterLevel: 3 }),
    5: def('arabic', [ref(5), lit('.')], { restartAfterLevel: 4 }),
    6: def('arabic', [lit('（'), ref(6), lit('）')], { restartAfterLevel: 5 }),
  }
}

function buildChineseOutline(): Record<HeadingLevel, HeadingLevelDefinition> {
  return {
    1: def('chinese', [ref(1), lit('、')]),
    2: def('chinese', [lit('（'), ref(2), lit('）')], { restartAfterLevel: 1 }),
    3: def('arabic', [ref(3), lit('.')], { restartAfterLevel: 2 }),
    4: def('arabic', [lit('（'), ref(4), lit('）')], { restartAfterLevel: 3 }),
    5: def('circled', [ref(5)], { restartAfterLevel: 4 }),
    6: def('alpha-upper', [ref(6), lit('.')], { restartAfterLevel: 5 }),
  }
}

function buildRoman(): Record<HeadingLevel, HeadingLevelDefinition> {
  const levels = {} as Record<HeadingLevel, HeadingLevelDefinition>
  levels[1] = def('roman-upper', [ref(1)])
  levels[2] = def('arabic', [ref(1), lit('.'), ref(2)], { restartAfterLevel: 1 })
  levels[3] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3)], { restartAfterLevel: 2 })
  levels[4] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4)], { restartAfterLevel: 3 })
  levels[5] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4), lit('.'), ref(5)], { restartAfterLevel: 4 })
  levels[6] = def('arabic', [ref(1), lit('.'), ref(2), lit('.'), ref(3), lit('.'), ref(4), lit('.'), ref(5), lit('.'), ref(6)], { restartAfterLevel: 5 })
  return levels
}

// ── Generate preview labels from definitions ─────────────

function previewFromDefs(defs: Record<HeadingLevel, HeadingLevelDefinition>): Record<HeadingLevel, string> {
  const preview = {} as Record<HeadingLevel, string>
  // Simulate counters [1,1,1,1,1,1]
  const counters = [1, 1, 1, 1, 1, 1]
  for (const lv of HEADING_LEVELS) {
    const d = defs[lv]
    if (!d || !d.enabled) { preview[lv] = ''; continue }
    preview[lv] = d.format.map(seg => {
      if (seg.type === 'literal') return seg.value
      // For preview, just format as arabic (placeholder)
      const refDef = defs[seg.level]
      const style = d.legalStyle && seg.level < lv ? 'arabic' : (refDef?.numberStyle ?? 'arabic')
      return formatTokenLabel(counters[seg.level - 1], style)
    }).join('')
  }
  return preview
}

// Quick inline formatter for preview generation only
const PREVIEW_FORMATTERS: Record<string, (n: number) => string> = {
  arabic: (n) => String(n),
  chinese: (n) => toChineseQuick(n),
  'chinese-financial': (n) => toChineseFinancialQuick(n),
  'roman-upper': (n) => toRomanQuick(n, true),
  'roman-lower': (n) => toRomanQuick(n, false),
  'alpha-upper': (n) => toAlphaQuick(n, true),
  'alpha-lower': (n) => toAlphaQuick(n, false),
  circled: (n) => toCircledQuick(n),
}

function formatTokenLabel(n: number, style: string): string {
  const fn = PREVIEW_FORMATTERS[style]
  return fn ? fn(n) : String(n)
}

// Quick inline implementations for preview (duplicated from token-formatter to avoid circular deps)
function toChineseQuick(n: number): string {
  if (n < 1) return '零'
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const units = ['', '十', '百', '千']
  if (n <= 9999) {
    const parts: string[] = []
    let unitIdx = 0; let temp = n; let hasZero = false
    while (temp > 0) {
      const digit = temp % 10
      if (digit === 0) { if (parts.length > 0) hasZero = true }
      else { if (hasZero && parts.length > 0) { parts.unshift('零'); hasZero = false }; parts.unshift(units[unitIdx]); parts.unshift(digits[digit]); hasZero = false }
      unitIdx++; temp = Math.floor(temp / 10)
    }
    let r = parts.join('')
    if (r.startsWith('一十')) r = r.slice(1)
    return r
  }
  return String(n) // fallback for large numbers
}

function toChineseFinancialQuick(n: number): string {
  if (n < 1) return '零'
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const units = ['', '拾', '佰', '仟']
  if (n <= 9999) {
    const parts: string[] = []
    let unitIdx = 0; let temp = n; let hasZero = false
    while (temp > 0) {
      const digit = temp % 10
      if (digit === 0) { if (parts.length > 0) hasZero = true }
      else { if (hasZero && parts.length > 0) { parts.unshift('零'); hasZero = false }; parts.unshift(units[unitIdx]); parts.unshift(digits[digit]); hasZero = false }
      unitIdx++; temp = Math.floor(temp / 10)
    }
    return parts.join('')
  }
  return String(n)
}

function toRomanQuick(n: number, upper: boolean): string {
  if (n < 1 || n > 3999) return String(n)
  const vals: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let r = ''; let rem = n
  for (const [v, s] of vals) { while (rem >= v) { r += s; rem -= v } }
  return upper ? r : r.toLowerCase()
}

function toAlphaQuick(n: number, upper: boolean): string {
  if (n < 1) return '0'
  const base = upper ? 65 : 97
  let r = ''; let rem = n
  while (rem > 0) { rem--; r = String.fromCharCode(base + (rem % 26)) + r; rem = Math.floor(rem / 26) }
  return r
}

function toCircledQuick(n: number): string {
  if (n < 1) return '0'
  if (n <= 20) return String.fromCharCode(0x2460 + n - 1)
  if (n <= 35) return String.fromCharCode(0x3251 + n - 21)
  if (n <= 50) return String.fromCharCode(0x32B1 + n - 36)
  return String(n)
}

// ── Preset metadata ──────────────────────────────────────

export interface PresetMeta {
  key: HeadingNumberingPreset
  name: string
  description: string
  /** Example preview labels for H1-H6. */
  preview: Record<HeadingLevel, string>
  /** Per-level definitions (new model). */
  levels: Record<HeadingLevel, HeadingLevelDefinition>
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
    preview: previewFromDefs(buildChineseChapter()),
    levels: buildChineseChapter(),
  },
  'chinese-outline': {
    key: 'chinese-outline',
    name: '中文大纲式',
    description: '中文大纲格式：一、、（一）、1.、①',
    preview: previewFromDefs(buildChineseOutline()),
    levels: buildChineseOutline(),
  },
  'roman-hierarchical': {
    key: 'roman-hierarchical',
    name: '罗马数字式',
    description: '大写罗马数字层级编号：I、I.1、I.1.1',
    preview: previewFromDefs(buildRoman()),
    levels: buildRoman(),
  },
}

// ── Helpers ──────────────────────────────────────────────

/** Get the effective level definitions for a given preset. */
export function getPresetLevels(preset: HeadingNumberingPreset): Record<HeadingLevel, HeadingLevelDefinition> {
  if (preset === 'custom') {
    return { ...buildDecimal() }
  }
  return deepCloneLevels(PRESETS[preset].levels)
}

/** Deep clone level definitions (breaks readonly references). */
export function deepCloneLevels(src: Record<HeadingLevel, HeadingLevelDefinition>): Record<HeadingLevel, HeadingLevelDefinition> {
  const out = {} as Record<HeadingLevel, HeadingLevelDefinition>
  for (const lv of HEADING_LEVELS) {
    const s = src[lv]
    out[lv] = {
      ...s,
      format: s.format.map(seg => ({ ...seg } as NumberFormatSegment)),
      position: { ...s.position },
    }
  }
  return out
}

/** Get the preview for a preset. */
export function getPresetPreview(preset: HeadingNumberingPreset): Record<HeadingLevel, string> {
  if (preset === 'custom') return PRESETS['decimal-hierarchical'].preview
  return { ...PRESETS[preset].preview }
}

/** Generate a format display string from segments (e.g. "[级别1].[级别2]"). */
export function formatSegmentsToString(segments: readonly NumberFormatSegment[]): string {
  return segments.map(seg => {
    if (seg.type === 'literal') return seg.value
    return `[级别${seg.level}]`
  }).join('')
}

export const PRESET_LIST: PresetMeta[] = Object.values(PRESETS)

// ── Custom default ───────────────────────────────────────

export function buildCustomDefault(): Record<HeadingLevel, HeadingLevelDefinition> {
  return buildDecimal()
}

/**
 * Create default format segments for a given level, respecting visible levels.
 * When H1 is hidden, the default starts from level 2.
 */
export function createDefaultFormatForLevel(
  level: HeadingLevel,
  showLevelOneNumber: boolean,
): NumberFormatSegment[] {
  const startLevel: HeadingLevel = showLevelOneNumber ? 1 : 2
  if (level < startLevel) {
    return [ref(level)]
  }
  const segments: NumberFormatSegment[] = []
  for (let lv = startLevel; lv <= level; lv++) {
    if (lv > startLevel) {
      segments.push(lit('.'))
    }
    segments.push(ref(lv as HeadingLevel))
  }
  return segments
}

/**
 * Generate default level definitions respecting showLevelOneNumber.
 */
export function buildDefaultLevels(showLevelOneNumber: boolean): Record<HeadingLevel, HeadingLevelDefinition> {
  const levels = {} as Record<HeadingLevel, HeadingLevelDefinition>
  for (const lv of HEADING_LEVELS) {
    const restartAfter = lv === 1 ? null : ((lv - 1) as HeadingLevel)
    levels[lv] = def('arabic', createDefaultFormatForLevel(lv, showLevelOneNumber), {
      restartAfterLevel: restartAfter,
    })
  }
  return levels
}

// ── Format normalization ─────────────────────────────────

/** Characters that only serve as separators (no semantic meaning like 第/章). */
const SEPARATOR_ONLY_RE = /^[.\-_\/、，:\：·\s]+$/

/**
 * Check if a format is "canonical hierarchical": only level-refs and
 * separator-only literals, no user-facing packaging text like "第", "章", "（", "）".
 */
export function isCanonicalHierarchicalFormat(segments: readonly NumberFormatSegment[]): boolean {
  for (const seg of segments) {
    if (seg.type === 'literal' && !SEPARATOR_ONLY_RE.test(seg.value)) {
      return false // has user text like 第/章/（/）
    }
  }
  return true
}

/**
 * Normalize format segments for a given level.
 *
 * Rules applied in order:
 * 1. Remove refs to hidden/disabled levels
 * 2. Remove refs to future levels (> currentLevel)
 * 3. Remove duplicate refs (keep first occurrence)
 * 4. Ensure current-level ref exists exactly once
 * 5. Clean orphan separator-only literals
 * 6. Merge adjacent literals
 * 7. Remove empty literals
 * 8. For canonical hierarchical formats: sort refs ascending
 *    (For user-custom formats with packaging text: keep custom order)
 *
 * Returns a new array (never mutates input).
 */
export function normalizeFormatSegments(
  segments: readonly NumberFormatSegment[],
  currentLevel: HeadingLevel,
  hiddenLevels: Set<HeadingLevel>,
): NumberFormatSegment[] {
  // Step 1-3: filter invalid refs
  const seenLevels = new Set<HeadingLevel>()
  let filtered = segments.filter(seg => {
    if (seg.type === 'level-reference') {
      // Remove hidden levels
      if (hiddenLevels.has(seg.level)) return false
      // Remove future levels
      if (seg.level > currentLevel) return false
      // Remove duplicates (keep first)
      if (seenLevels.has(seg.level)) return false
      seenLevels.add(seg.level)
      return true
    }
    return true
  })

  // Step 4: ensure current-level ref exists once
  const hasSelfRef = filtered.some(
    s => s.type === 'level-reference' && s.level === currentLevel,
  )
  if (!hasSelfRef) {
    // Append current-level ref at end (correct position for hierarchical format)
    filtered = [...filtered, ref(currentLevel)]
  }

  // Step 5: clean orphan separators
  filtered = cleanupOrphanSeparators(filtered)

  // Step 6-7: merge adjacent literals, remove empties
  filtered = mergeAdjacentLiterals(filtered)

  // Step 8: for canonical hierarchical formats, sort refs ascending
  if (isCanonicalHierarchicalFormat(filtered)) {
    filtered = sortCanonicalFormat(filtered, currentLevel)
  }

  return filtered
}

/**
 * Remove orphan separator-only literals (leading, trailing, duplicate-between).
 */
function cleanupOrphanSeparators(segments: NumberFormatSegment[]): NumberFormatSegment[] {
  let result = segments.slice()
  // Remove leading
  while (result.length > 0 && result[0].type === 'literal' && SEPARATOR_ONLY_RE.test((result[0] as { type: 'literal'; value: string }).value)) {
    result = result.slice(1)
  }
  // Remove trailing
  while (result.length > 0 && result[result.length - 1].type === 'literal' && SEPARATOR_ONLY_RE.test((result[result.length - 1] as { type: 'literal'; value: string }).value)) {
    result = result.slice(0, -1)
  }
  // Remove separator-only literals sitting between two other literals (redundant)
  let i = 1
  while (i < result.length - 1) {
    if (
      result[i].type === 'literal' && SEPARATOR_ONLY_RE.test((result[i] as { type: 'literal'; value: string }).value) &&
      result[i - 1].type === 'literal' && result[i + 1].type === 'literal'
    ) {
      result = [...result.slice(0, i), ...result.slice(i + 1)]
    } else {
      i++
    }
  }
  return result
}

/**
 * Merge adjacent literal segments and remove empty ones.
 */
function mergeAdjacentLiterals(segments: NumberFormatSegment[]): NumberFormatSegment[] {
  const result: NumberFormatSegment[] = []
  for (const seg of segments) {
    if (seg.type === 'literal' && seg.value.length === 0) continue
    if (
      seg.type === 'literal' &&
      result.length > 0 &&
      result[result.length - 1].type === 'literal'
    ) {
      result[result.length - 1] = {
        type: 'literal',
        value: (result[result.length - 1] as { type: 'literal'; value: string }).value + seg.value,
      }
    } else {
      result.push({ ...seg })
    }
  }
  return result
}

/**
 * Sort a canonical hierarchical format so level refs are ascending,
 * with the current-level ref always last.
 */
function sortCanonicalFormat(segments: NumberFormatSegment[], currentLevel: HeadingLevel): NumberFormatSegment[] {
  // Collect all level refs (excluding current-level)
  const parentRefs: NumberFormatSegment[] = []
  const otherParts: NumberFormatSegment[] = []
  let selfRef: NumberFormatSegment | null = null

  for (const seg of segments) {
    if (seg.type === 'level-reference') {
      if (seg.level === currentLevel) {
        selfRef = seg
      } else {
        parentRefs.push(seg)
      }
    }
  }

  // Sort parent refs ascending by level
  parentRefs.sort((a, b) => {
    const la = (a as { type: 'level-reference'; level: HeadingLevel }).level
    const lb = (b as { type: 'level-reference'; level: HeadingLevel }).level
    return la - lb
  })

  // Rebuild: parent refs with '.' between, then current-level ref
  const result: NumberFormatSegment[] = []
  for (let i = 0; i < parentRefs.length; i++) {
    if (i > 0) result.push(lit('.'))
    result.push(parentRefs[i])
  }
  if (parentRefs.length > 0 && selfRef) {
    result.push(lit('.'))
  }
  if (selfRef) {
    result.push(selfRef)
  }

  return result
}

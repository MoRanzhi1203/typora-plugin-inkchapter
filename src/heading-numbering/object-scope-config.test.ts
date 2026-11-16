/**
 * R12 — unified object numbering scope tests.
 *
 * Proves the three independent notions stay separate:
 *   - reset level (when the ordinal restarts),
 *   - prefix level (which physical heading number is displayed),
 *   - missing-level policy (what happens when that level does not exist).
 */

import { describe, expect, it } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import { defaultObjectNumberingSettings } from './object-numbering-settings'
import { planObjectNumberPersistence, type ObjectNumberingConfigs } from './object-number-persistence'
import { planFormulaSemanticNumbers } from './formula-semantic-planner'
import type { PhysicalHeading } from './semantic-heading-types'
import { computeSemanticHeadingNumbers } from './semantic-heading-numbering'
import {
  OBJECT_SCOPE_MISSING_LEVEL_CODE,
  formatObjectScopeNumber,
  normalizeObjectNumberingScope,
  resolveObjectNumberScope,
  scopeConfigFromPreset,
  type ObjectNumberingScopeConfig,
} from './object-scope-config'

function headings(list: Array<[1 | 2 | 3 | 4 | 5 | 6, string]>): PhysicalHeading[] {
  return list.map(([level, text], index) => ({ key: `h${index + 1}`, level, text }))
}

function states(
  list: Array<[1 | 2 | 3 | 4 | 5 | 6, string]>,
  mode: 'strict' | 'loose',
  physicalStartAt: number[] = [1, 1, 1, 1, 1, 1],
) {
  return computeSemanticHeadingNumbers(headings(list), mode, {
    startAt: [1, 1, 1, 1, 1, 1],
    physicalStartAt,
    sourceRevision: 1,
  })
}

const byId = (list: ReturnType<typeof states>) => new Map(list.map(s => [s.stableIdentity, s]))

function scope(overrides: Partial<ObjectNumberingScopeConfig> = {}): ObjectNumberingScopeConfig {
  return { resetLevel: 'document', prefixLevel: 'none', style: 'dash', missingLevelPolicy: 'nearest-ancestor', ...overrides }
}

describe('R12 physical heading path', () => {
  it('loose mode exposes H1/H2/H3 physical ordinals', () => {
    const s = states([[1, '第5章'], [2, '5.3 模型'], [3, '5.3.2 参数']], 'loose')
    expect(s[0].physicalPathByLevel).toEqual([1, null, null, null, null, null])
    expect(s[1].physicalPathByLevel).toEqual([1, 1, null, null, null, null])
    expect(s[2].physicalPathByLevel).toEqual([1, 1, 1, null, null, null])
  })

  it('strict mode keeps the H1 document title out of the path and opens a new boundary', () => {
    const s = states([[1, '论文题目'], [2, '第一章'], [3, '1.1 节'], [1, '第二篇'], [2, '第二章']], 'strict')
    expect(s[0].physicalPathByLevel).toEqual([null, null, null, null, null, null])
    expect(s[1].physicalPathByLevel).toEqual([null, 1, null, null, null, null])
    expect(s[2].physicalPathByLevel).toEqual([null, 1, 1, null, null, null])
    expect(s[4].physicalPathByLevel).toEqual([null, 1, null, null, null, null])
  })
})

describe('R12 explicit scope resolution', () => {
  // H1 starts at 5, H2 at 3 → headings behave like 第5章 / 5.3 / 5.4 / 5.4.1.
  const list = states([[1, '第5章'], [2, '5.3 模型'], [2, '5.4 评估'], [3, '5.4.1 参数']], 'loose', [5, 3, 1, 1, 1, 1])
  const map = byId(list)

  it('returns null for a legacy config without explicit scope', () => {
    expect(resolveObjectNumberScope('figure', {}, list[3], map)).toBeNull()
  })

  it('H2 prefix produces chapter.section-k without needing an H3', () => {
    const res = resolveObjectNumberScope('formula', { scope: scope({ resetLevel: 2, prefixLevel: 2 }) }, list[1], map)
    expect(res).not.toBeNull()
    expect(formatObjectScopeNumber(res!, 1)).toBe('5.3-1')
  })

  it('H3 prefix uses the full three-level path when H3 exists', () => {
    const res = resolveObjectNumberScope('formula', { scope: scope({ resetLevel: 3, prefixLevel: 3 }) }, list[3], map)
    expect(formatObjectScopeNumber(res!, 1)).toBe('5.4.1-1')
  })

  it('nearest-ancestor policy falls back to the H2 path when H3 is absent', () => {
    const res = resolveObjectNumberScope('figure', { scope: scope({ prefixLevel: 3, missingLevelPolicy: 'nearest-ancestor' }) }, list[1], map)
    expect(res!.missingRequestedLevel).toBe(true)
    expect(res!.fallback).toBe('nearest-ancestor')
    expect(res!.prefixLevel).toBe(2)
    expect(formatObjectScopeNumber(res!, 1)).toBe('5.3-1')
  })

  it('document policy drops the prefix entirely when the level is absent', () => {
    const res = resolveObjectNumberScope('figure', { scope: scope({ prefixLevel: 3, missingLevelPolicy: 'document' }) }, list[1], map)
    expect(res!.fallback).toBe('document')
    expect(formatObjectScopeNumber(res!, 7)).toBe('7')
  })

  it('diagnostic policy keeps a usable fallback AND reports the missing level', () => {
    const res = resolveObjectNumberScope('figure', { scope: scope({ prefixLevel: 3, missingLevelPolicy: 'diagnostic' }) }, list[1], map)
    expect(res!.diagnostic?.code).toBe(OBJECT_SCOPE_MISSING_LEVEL_CODE)
    expect(res!.diagnostic?.level).toBe(3)
    expect(formatObjectScopeNumber(res!, 1)).toBe('5.3-1')
  })

  it('reset level groups counters by the canonical heading identity', () => {
    const a = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 2 }) }, list[1], map)!
    const b = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 2 }) }, list[1], map)!
    const c = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 2 }) }, list[2], map)!
    expect(a.scopeKey).toBe(b.scopeKey)
    expect(a.scopeKey).not.toBe(c.scopeKey)
  })

  it('document reset ignores heading changes (continuous sequence)', () => {
    const a = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 'document' }) }, list[1], map)!
    const b = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 'document' }) }, list[2], map)!
    expect(a.scopeKey).toBe(b.scopeKey)
  })

  it('each object kind owns an independent counter key', () => {
    const figure = resolveObjectNumberScope('figure', { scope: scope({ resetLevel: 2 }) }, list[1], map)!
    const formula = resolveObjectNumberScope('formula', { scope: scope({ resetLevel: 2 }) }, list[1], map)!
    const code = resolveObjectNumberScope('code', { scope: scope({ resetLevel: 2 }) }, list[1], map)!
    expect(new Set([figure.scopeKey, formula.scopeKey, code.scopeKey]).size).toBe(3)
  })

  it('dot style joins the prefix with dots', () => {
    const res = resolveObjectNumberScope('table', { scope: scope({ prefixLevel: 2, style: 'dot' }) }, list[1], map)!
    expect(formatObjectScopeNumber(res, 3, 2)).toBe('5.3.03')
  })
})

describe('R12 reset level and prefix level are INDEPENDENT', () => {
  function looseSettings(): HeadingNumberingSettings {
    return {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
    }
  }

  function configs(scopeConfig: ObjectNumberingScopeConfig): ObjectNumberingConfigs {
    const base = defaultObjectNumberingSettings().types
    return {
      figure: { ...base.figure, preset: 'chapter-dash', scope: scopeConfig },
      table: { ...base.table, preset: 'chapter-dash', scope: scopeConfig },
      code: { ...base.code, preset: 'chapter-dash', scope: scopeConfig },
      formula: { ...base.formula, enabled: true, preset: 'chapter-dash', scope: scopeConfig },
    }
  }

  const markdown = [
    '# 章一',
    '',
    '## 节一',
    '',
    '![](a.png)',
    '',
    '![](b.png)',
    '',
    '## 节二',
    '',
    '![](c.png)',
  ].join('\n')

  it('resets at H2 while showing only the H1 prefix (legacy presets cannot express this)', () => {
    const plan = planObjectNumberPersistence(markdown, {
      mode: 'render',
      policy: 'detect-only',
      configs: configs(scope({ resetLevel: 2, prefixLevel: 1, style: 'dash' })),
      headingSettings: looseSettings(),
    })
    expect(plan.objects.map(o => o.expected?.numberText)).toEqual(['1-1', '1-2', '1-1'])
  })

  it('document reset + H2 prefix produces one continuous sequence', () => {
    const plan = planObjectNumberPersistence(markdown, {
      mode: 'render',
      policy: 'detect-only',
      configs: configs(scope({ resetLevel: 'document', prefixLevel: 2, style: 'dot' })),
      headingSettings: looseSettings(),
    })
    expect(plan.objects.map(o => o.expected?.numberText)).toEqual(['1.1.1', '1.1.2', '1.2.3'])
  })

  it('a config without scope keeps the legacy preset result', () => {
    const base = defaultObjectNumberingSettings().types
    const legacy: ObjectNumberingConfigs = {
      figure: { ...base.figure, preset: 'chapter-dash' },
      table: { ...base.table, preset: 'chapter-dash' },
      code: { ...base.code, preset: 'chapter-dash' },
      formula: { ...base.formula, enabled: true, preset: 'chapter-dash' },
    }
    const plan = planObjectNumberPersistence(markdown, {
      mode: 'render',
      policy: 'detect-only',
      configs: legacy,
      headingSettings: looseSettings(),
    })
    expect(plan.objects.map(o => o.expected?.numberText)).toEqual(['1-1', '1-2', '1-3'])
    expect(plan.objects[0].expected?.missingScopeLevel).toBeUndefined()
  })
})

describe('R12 formula planner consumes the explicit scope', () => {
  it('uses the resolved scope key and prefix instead of degrading SECTION', () => {
    const list = states([[1, '章'], [2, '节']], 'loose')
    const map = byId(list)
    const resolved = resolveObjectNumberScope('formula', { scope: scope({ resetLevel: 2, prefixLevel: 2 }) }, list[1], map)!
    const entries = planFormulaSemanticNumbers([
      { chapterOrdinal: 1, sectionOrdinal: null, resolvedScope: resolved },
      { chapterOrdinal: 1, sectionOrdinal: null, resolvedScope: resolved },
    ], { enabled: true, prefix: '', position: 'right', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '({n})', preset: 'section-dash' })
    expect(entries.map(e => e.renderedNumber)).toEqual(['(1.1-1)', '(1.1-2)'])
    expect(entries[0].effectiveScope).toBe('section')
  })
})

describe('R12 scope config normalization', () => {
  it('rejects invalid levels and falls back deterministically', () => {
    expect(normalizeObjectNumberingScope({ resetLevel: 9, prefixLevel: 'x', missingLevelPolicy: 'nope' })).toEqual({
      resetLevel: 'document',
      prefixLevel: 'none',
      style: 'dot',
      missingLevelPolicy: 'nearest-ancestor',
    })
  })

  it('keeps valid explicit values', () => {
    expect(normalizeObjectNumberingScope({ resetLevel: 4, prefixLevel: 3, style: 'dash', missingLevelPolicy: 'diagnostic' })).toEqual({
      resetLevel: 4,
      prefixLevel: 3,
      style: 'dash',
      missingLevelPolicy: 'diagnostic',
    })
  })

  it('maps legacy presets to their equivalent explicit scope for UI display', () => {
    expect(scopeConfigFromPreset('section-dash')).toEqual({
      resetLevel: 2,
      prefixLevel: 2,
      style: 'dash',
      missingLevelPolicy: 'nearest-ancestor',
    })
    expect(scopeConfigFromPreset('global')).toEqual({
      resetLevel: 'document',
      prefixLevel: 'none',
      style: 'dot',
      missingLevelPolicy: 'nearest-ancestor',
    })
  })
})

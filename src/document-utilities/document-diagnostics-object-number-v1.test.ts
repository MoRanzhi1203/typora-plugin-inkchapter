import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'
import { getPresetLevels } from '../heading-numbering/presets'
import { defaultObjectNumberingSettings } from '../heading-numbering/object-numbering-settings'
import type { ObjectNumberingConfigs } from '../heading-numbering/object-number-persistence'
import {
  computeObjectNumberDiagnosticFacts,
  OBJECT_DUPLICATE_CAPTION_CODE,
  OBJECT_NUMBER_CHAPTER_MISMATCH_CODE,
  FIGURE_CAPTION_UNMANAGED_CODE,
} from './document-diagnostics-object-number-v1'
import { OBJECT_NUMBER_FIXERS } from './document-diagnostic-object-number-fix-v2'
import type { FixContext } from './document-diagnostic-fix-v1'

function headingSettings(): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
  }
}

function configs(): ObjectNumberingConfigs {
  const base = defaultObjectNumberingSettings().types
  return {
    figure: { ...base.figure, preset: 'chapter-dash' },
    table: { ...base.table, preset: 'chapter-dash' },
    code: { ...base.code, preset: 'chapter-dash' },
    formula: { ...base.formula, enabled: true, preset: 'chapter-dash' },
  }
}

function facts(storageMode: 'render' | 'source' = 'render') {
  return {
    enabled: true,
    storageMode,
    policy: 'adopt' as const,
    dedupeProjectedNumbers: true,
    headingSettings: headingSettings(),
    overrideEntries: [],
    counterPolicy: 'skip' as const,
    configs: configs(),
    ownership: {},
  }
}

function fixContext(markdown: string): FixContext {
  return { markdown, documentKey: 'doc.md', snapshot: null, locked: false }
}

describe('R10 object number diagnostics', () => {
  it('reports a chapter mismatch with the exact caption line and the fix target', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '## 第二章',
      '',
      '![图片](a.png)',
      '',
      '图 1-1 用户题注',
    ].join('\n')
    const out = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts() })
    const hit = out.find(d => d.code === OBJECT_NUMBER_CHAPTER_MISMATCH_CODE)
    expect(hit).toBeDefined()
    expect(hit?.location).toEqual({ kind: 'source-range', startLine: 6, startColumn: 0, rawText: '图 1-1 用户题注' })
    expect(hit?.metadata?.['objectNumberingBefore']).toBe('图 1-1 用户题注')
    expect(hit?.metadata?.['objectNumberingAfter']).toBe('图 2-1 用户题注')
    expect(hit?.severity).toBe('error')
  })

  it('reports an unmanaged source caption exactly once per object', () => {
    const md = ['# 文档', '## 第一章', '', '![图片](a.png)', '', '图 1-9 用户题注'].join('\n')
    const out = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts('source') })
    expect(out.filter(d => d.code === FIGURE_CAPTION_UNMANAGED_CODE)).toHaveLength(1)
  })

  it('reports duplicate caption paragraphs', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![图片](a.png)',
      '',
      '图 1-1 用户题注',
      '',
      '图 1-1 用户题注',
    ].join('\n')
    const out = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts() })
    const hit = out.find(d => d.code === OBJECT_DUPLICATE_CAPTION_CODE)
    expect(hit).toBeDefined()
    expect(hit?.metadata?.['duplicateCaptionLines']).toEqual([8])
  })

  it('fix replaces only the caption line', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '## 第二章',
      '',
      '![图片](a.png)',
      '',
      '图 1-1 用户题注',
    ].join('\n')
    const [diagnostic] = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts() })
      .filter(d => d.code === OBJECT_NUMBER_CHAPTER_MISMATCH_CODE)
    const fixer = OBJECT_NUMBER_FIXERS[OBJECT_NUMBER_CHAPTER_MISMATCH_CODE]
    const plan = fixer.build(diagnostic, fixContext(md))
    expect(plan.blockers).toBeUndefined()
    expect(plan.patches).toHaveLength(1)
    expect(plan.patches?.[0].after).toBe('图 2-1 用户题注')
    expect(plan.patches?.[0].before).toBe('图 1-1 用户题注')
  })

  it('refuses a stale caption (STALE_SOURCE)', () => {
    const md = ['# 文档', '## 第一章', '', '![图片](a.png)', '', '图 1-9 用户题注'].join('\n')
    const [diagnostic] = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts('source') })
      .filter(d => d.code === FIGURE_CAPTION_UNMANAGED_CODE)
    const fixer = OBJECT_NUMBER_FIXERS[FIGURE_CAPTION_UNMANAGED_CODE]
    const plan = fixer.build(diagnostic, fixContext(md.replace('用户题注', '改名题注')))
    expect(plan.blockers?.[0].code).toBe('STALE_SOURCE')
  })

  it('fix deletes duplicate caption lines', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![图片](a.png)',
      '',
      '图 1-1 用户题注',
      '',
      '图 1-1 用户题注',
    ].join('\n')
    const [diagnostic] = computeObjectNumberDiagnosticFacts({ markdown: md, documentKey: 'doc.md', facts: facts() })
      .filter(d => d.code === OBJECT_DUPLICATE_CAPTION_CODE)
    const fixer = OBJECT_NUMBER_FIXERS[OBJECT_DUPLICATE_CAPTION_CODE]
    const plan = fixer.build(diagnostic, fixContext(md))
    expect(plan.patches).toHaveLength(1)
    expect(plan.patches?.[0].kind).toBe('delete-lines')
    expect(plan.patches?.[0].lineStart).toBe(7)
  })
})

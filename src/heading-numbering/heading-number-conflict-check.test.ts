import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  planHeadingNumberPersistence,
  type HeadingNumberPlanOptions,
} from './heading-number-persistence'
import {
  NUMBERING_CONFLICT_CODES,
  checkNumberingConflicts,
  formatNumberingConflictSummary,
} from './heading-number-conflict-check'

function settings(overrides: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
    ...overrides,
  }
}

function report(
  markdown: string,
  options: Partial<HeadingNumberPlanOptions> = {},
  conflictOptions: Parameters<typeof checkNumberingConflicts>[1] = {
    numberingEnabled: true,
    storageMode: 'render',
    policy: 'detect-only',
  },
  s = settings(),
) {
  const plan = planHeadingNumberPersistence(markdown, s, {
    mode: 'render',
    policy: 'detect-only',
    now: 1,
    ...options,
  })
  return checkNumberingConflicts(plan, conflictOptions)
}

describe('R08 — numbering conflict detection', () => {
  it('reports HEADING_AUTO_NUMBER_CONFLICT in render mode', () => {
    const result = report(['# 文档', '## 1.5 研究背景'].join('\n'))
    const codes = result.issues.map(i => i.code)
    expect(codes).toContain(NUMBERING_CONFLICT_CODES.autoNumberConflict)
    expect(codes).toContain(NUMBERING_CONFLICT_CODES.numberMismatch)
    expect(result.errorCount).toBeGreaterThan(0)
  })

  it('reports HEADING_MANUAL_NUMBER_PREFIX when numbering is off', () => {
    const result = report(
      ['# 文档', '## 1 研究背景'].join('\n'),
      {},
      { numberingEnabled: false, storageMode: 'render', policy: 'detect-only' },
    )
    expect(result.issues.map(i => i.code)).toContain(NUMBERING_CONFLICT_CODES.manualNumberPrefix)
  })

  it('reports HEADING_NUMBER_MISSING in source mode', () => {
    const result = report(
      ['# 文档', '## 研究背景'].join('\n'),
      {},
      { numberingEnabled: true, storageMode: 'source', policy: 'adopt' },
    )
    const issue = result.issues.find(i => i.code === NUMBERING_CONFLICT_CODES.numberMissing)
    expect(issue?.line).toBe(2)
    expect(issue?.fix).toBe('write')
  })

  it('reports double numbering with a remove-duplicate fix', () => {
    const result = report(['# 文档', '## 1 1 研究背景'].join('\n'))
    const issue = result.issues.find(i => i.code === NUMBERING_CONFLICT_CODES.doubleNumberPrefix)
    expect(issue?.fix).toBe('remove-duplicate')
    expect(issue?.line).toBe(2)
  })

  it('reports order anomalies for a repeated number', () => {
    const result = report(['# 文档', '## 1 A', '## 1 B'].join('\n'))
    expect(result.issues.map(i => i.code)).toContain(NUMBERING_CONFLICT_CODES.numberOrderAnomaly)
  })

  it('reports inconsistent formats', () => {
    const result = report(['# 文档', '## 1 A', '## 第一章 B'].join('\n'))
    expect(result.issues.map(i => i.code)).toContain(NUMBERING_CONFLICT_CODES.numberFormatInconsistent)
  })

  it('reports ownership conflicts against the ledger', () => {
    const markdown = ['# 文档', '## 研究背景'].join('\n')
    const first = planHeadingNumberPersistence(markdown, settings(), {
      mode: 'source',
      policy: 'adopt',
      now: 1,
    })
    const record = Object.values(first.ownership).find(r => r.numberText === '1')
    expect(record).toBeTruthy()
    const plan = planHeadingNumberPersistence(markdown, settings(), {
      mode: 'source',
      policy: 'adopt',
      ownership: record ? { [record.identity]: record } : {},
      now: 1,
    })
    const conflicts = checkNumberingConflicts(plan, {
      numberingEnabled: true,
      storageMode: 'source',
      policy: 'adopt',
    })
    expect(conflicts.issues.map(i => i.code)).toContain(NUMBERING_CONFLICT_CODES.numberOwnershipConflict)
  })

  it('every issue carries a 1-based line', () => {
    const result = report(['# 文档', '', '## 1.5 研究背景'].join('\n'))
    expect(result.issues.every(i => i.line >= 1)).toBe(true)
    expect(result.issues.some(i => i.line === 3)).toBe(true)
  })

  it('formats a human-readable summary', () => {
    expect(formatNumberingConflictSummary({ issues: [], errorCount: 0, warningCount: 0, hasConflict: false, formatLine: l => `L${l}` }))
      .toBe('未发现编号冲突')
    const result = report(['# 文档', '## 1.5 研究背景'].join('\n'))
    expect(formatNumberingConflictSummary(result)).toContain('L2')
  })
})

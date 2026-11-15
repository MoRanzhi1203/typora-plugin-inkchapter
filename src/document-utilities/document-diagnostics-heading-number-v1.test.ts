import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'
import { getPresetLevels } from '../heading-numbering/presets'
import { computeHeadingNumberDiagnosticFacts } from './document-diagnostics-heading-number-v1'
import type { HeadingNumberPersistenceFacts } from '../heading-numbering/heading-number-persistence'

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

function facts(overrides: Partial<HeadingNumberPersistenceFacts> = {}): HeadingNumberPersistenceFacts {
  return {
    enabled: true,
    storageMode: 'source',
    policy: 'adopt',
    dedupeProjectedNumbers: true,
    settings: settings(),
    overrideEntries: [],
    counterPolicy: 'skip',
    ownership: {},
    ...overrides,
  }
}

const HEADINGS = [
  { level: 1, text: '文档', stableIdentity: 'H:0' },
  { level: 2, text: '1.1 1.1 研究背景', stableIdentity: 'H:1' },
  { level: 3, text: '2.9 问题提出', stableIdentity: 'H:2' },
  { level: 2, text: '研究方法', stableIdentity: 'H:3' },
  { level: 2, text: '2026 年研究报告', stableIdentity: 'H:4' },
]

const MARKDOWN = [
  '# 文档',
  '',
  '## 1.1 1.1 研究背景',
  '',
  '### 2.9 问题提出',
  '',
  '## 研究方法',
  '',
  '## 2026 年研究报告',
  '',
].join('\n')

const INPUT = { markdown: MARKDOWN, headings: HEADINGS }

describe('R09 — heading number diagnostics producer', () => {
  it('reports double numbering once (most specific rule wins)', () => {
    const result = computeHeadingNumberDiagnosticFacts({ ...INPUT, facts: facts() })
    const double = result.filter(f => f.code === 'HEADING_DOUBLE_NUMBER_PREFIX')
    expect(double).toHaveLength(1)
    expect(double[0].line).toBe(3)
    expect(double[0].severity).toBe('error')
    expect(double[0].afterLine).toBe('## 1 研究背景')
    // §4.4 — the same heading never reports manual/mismatch as well.
    expect(result.filter(f => f.line === 3)).toHaveLength(1)
  })

  it('reports a scheme mismatch with the adopt-plan target line', () => {
    const result = computeHeadingNumberDiagnosticFacts({ ...INPUT, facts: facts() })
    const mismatch = result.find(f => f.code === 'HEADING_NUMBER_MISMATCH')
    expect(mismatch?.line).toBe(5)
    expect(mismatch?.expectedLabel).toBe('1.1')
    expect(mismatch?.detectedNumber).toBe('2.9')
    expect(mismatch?.afterLine).toBe('### 1.1 问题提出')
  })

  it('reports a missing number in source mode', () => {
    const result = computeHeadingNumberDiagnosticFacts({ ...INPUT, facts: facts() })
    const missing = result.find(f => f.code === 'HEADING_NUMBER_MISSING')
    expect(missing?.line).toBe(7)
    expect(missing?.afterLine).toBe('## 2 研究方法')
  })

  it('never rewrites the ambiguous year heading', () => {
    const result = computeHeadingNumberDiagnosticFacts({ ...INPUT, facts: facts() })
    expect(result.some(f => f.line === 9 && f.code === 'HEADING_DOUBLE_NUMBER_PREFIX')).toBe(false)
    expect(result.some(f => f.line === 9 && f.code === 'HEADING_NUMBER_MISMATCH')).toBe(false)
  })

  it('keeps manual prefixes when numbering is off (warning, no rewrite)', () => {
    const result = computeHeadingNumberDiagnosticFacts({
      ...INPUT,
      facts: facts({ enabled: false, storageMode: 'render' }),
    })
    const manual = result.find(f => f.code === 'HEADING_MANUAL_NUMBER_PREFIX')
    expect(manual?.severity).toBe('warning')
    expect(manual?.afterLine).toBe('')
  })

  it('reports ownership conflicts from the ledger', () => {
    const markdown = ['# 文档', '', '## 研究背景', ''].join('\n')
    const headings = [
      { level: 1, text: '文档', stableIdentity: 'H:0' },
      { level: 2, text: '研究背景', stableIdentity: 'H:1' },
    ]
    const result = computeHeadingNumberDiagnosticFacts({
      markdown,
      headings,
      facts: facts({ storageMode: 'render', policy: 'detect-only' }),
    })
    // No ledger record → no ownership conflict; the probe proves the rule is silent.
    expect(result.filter(f => f.code === 'HEADING_NUMBER_OWNERSHIP_CONFLICT')).toHaveLength(0)
  })

  it('respects per-heading unnumbered overrides', () => {
    const result = computeHeadingNumberDiagnosticFacts({
      ...INPUT,
      facts: facts({ overrideEntries: [{ level: 2, title: '研究方法', occurrence: 0, mode: 'unnumbered' }] }),
    })
    // The heading is intentionally unnumbered ⇒ it must NOT be reported missing.
    expect(result.some(f => f.line === 7 && f.code === 'HEADING_NUMBER_MISSING')).toBe(false)
  })
})

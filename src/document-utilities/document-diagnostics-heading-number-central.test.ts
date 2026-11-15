// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import type { HeadingNumberPersistenceFacts } from './document-diagnostics-heading-number-v1'
import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'
import { getPresetLevels } from '../heading-numbering/presets'

function settings(): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
  }
}

function persistenceFacts(): HeadingNumberPersistenceFacts {
  return {
    enabled: true,
    storageMode: 'source',
    policy: 'adopt',
    dedupeProjectedNumbers: true,
    settings: settings(),
    overrideEntries: [],
    counterPolicy: 'skip',
    ownership: {},
  }
}

const SPECS: Array<{ level: number; text: string; line: number }> = [
  { level: 1, text: '文档', line: 0 },
  { level: 2, text: '1.1 1.1 研究背景', line: 2 },
  { level: 3, text: '2.9 问题提出', line: 4 },
  { level: 2, text: '研究方法', line: 6 },
  { level: 2, text: '2026 年研究报告', line: 8 },
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

function inputOf(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  const headings = SPECS.map((spec, index) => {
    const el = document.createElement(`h${spec.level}`)
    el.setAttribute('data-line', String(spec.line))
    el.textContent = spec.text
    return {
      level: spec.level,
      text: spec.text,
      stableIdentity: `H:${index}`,
      element: el,
      autoNumberingEffective: spec.level > 1,
    }
  })
  return {
    documentKey: 'doc:r09',
    markdown: MARKDOWN,
    strictMode: true,
    vaultRoot: '/vault',
    headings,
    h1Facts: headings.filter(h => h.level === 1).map(h => ({
      stableIdentity: h.stableIdentity,
      element: h.element,
      text: h.text,
    })),
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    numberingEnabled: { heading: true },
    headingAutoNumbering: { enabled: true, h1NumberingEnabled: false },
    headingNumberPersistence: persistenceFacts(),
    ...overrides,
  }
}

function numberingDiagnostics(overrides: Partial<DocumentDiagnosticsInput> = {}) {
  return computeDocumentDiagnostics(inputOf(overrides)).diagnostics
    .filter(d => [
      'HEADING_DOUBLE_NUMBER_PREFIX',
      'HEADING_NUMBER_MISMATCH',
      'HEADING_NUMBER_MISSING',
      'HEADING_NUMBER_ORDER_ANOMALY',
      'HEADING_NUMBER_FORMAT_INCONSISTENT',
      'HEADING_NUMBER_OWNERSHIP_CONFLICT',
      'HEADING_MANUAL_NUMBER_PREFIX',
      'HEADING_AUTO_NUMBER_CONFLICT',
    ].includes(d.code))
}

describe('R09 — numbering diagnostics in the central panel', () => {
  it('publishes the three independent numbering problems with exact Lxx lines', () => {
    const diagnostics = numberingDiagnostics()
    const byCode = new Map(diagnostics.map(d => [d.code, d]))

    expect(byCode.get('HEADING_DOUBLE_NUMBER_PREFIX')?.metadata?.['numberingLine']).toBe(3)
    expect(byCode.get('HEADING_NUMBER_MISMATCH')?.metadata?.['numberingLine']).toBe(5)
    expect(byCode.get('HEADING_NUMBER_MISSING')?.metadata?.['numberingLine']).toBe(7)
    expect(diagnostics.every(d => d.location != null)).toBe(true)
    expect(diagnostics.every(d => String(d.location?.kind) === 'canonical-node')).toBe(true)
  })

  it('never reports the legacy auto conflict once the R09 authority is present', () => {
    const diagnostics = numberingDiagnostics()
    expect(diagnostics.some(d => d.code === 'HEADING_AUTO_NUMBER_CONFLICT')).toBe(false)
  })

  it('publishes one diagnostic per heading (no duplicate root cause)', () => {
    const diagnostics = numberingDiagnostics()
    const lines = diagnostics.map(d => d.metadata?.['numberingLine'])
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('keeps the fix target on each diagnostic', () => {
    const diagnostics = numberingDiagnostics()
    for (const d of diagnostics) {
      expect(typeof d.metadata?.['numberingBefore']).toBe('string')
      expect(d.metadata?.['numberingBefore']).not.toBe('')
    }
    const double = diagnostics.find(d => d.code === 'HEADING_DOUBLE_NUMBER_PREFIX')
    expect(double?.metadata?.['numberingAfter']).toBe('## 1 研究背景')
  })

  it('does not flag the ambiguous year heading', () => {
    const diagnostics = numberingDiagnostics()
    expect(diagnostics.some(d => d.metadata?.['numberingLine'] === 9)).toBe(false)
  })

  it('falls back to the legacy rules when the persistence facts are absent', () => {
    const diagnostics = numberingDiagnostics({ headingNumberPersistence: undefined })
    expect(diagnostics.some(d => d.code === 'HEADING_AUTO_NUMBER_CONFLICT')).toBe(true)
  })
})

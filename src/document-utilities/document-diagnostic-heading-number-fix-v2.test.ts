// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  describeFixCapability,
  planAllAutoFixesV2,
  planDiagnosticFixV2,
  planFixesForRuleV2,
} from './document-diagnostic-fix-v2'
import { applyPatchesToMarkdown } from './document-diagnostic-fix-v1'
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

const PERSISTENCE: HeadingNumberPersistenceFacts = {
  enabled: true,
  storageMode: 'source',
  policy: 'adopt',
  dedupeProjectedNumbers: true,
  settings: settings(),
  overrideEntries: [],
  counterPolicy: 'skip',
  ownership: {},
}

const MARKDOWN = [
  '# 文档',
  '',
  '## 1.1 1.1 研究背景',
  '',
  '### 2.9 问题提出',
  '',
  '## 研究方法',
  '',
].join('\n')

const SPECS = [
  { level: 1, text: '文档', line: 0 },
  { level: 2, text: '1.1 1.1 研究背景', line: 2 },
  { level: 3, text: '2.9 问题提出', line: 4 },
  { level: 2, text: '研究方法', line: 6 },
]

function buildInput(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
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
    documentKey: 'doc:r09-fix',
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
    headingNumberPersistence: PERSISTENCE,
    ...overrides,
  }
}

function diagnostics(): DocumentDiagnostic[] {
  return computeDocumentDiagnostics(buildInput()).diagnostics
}

function snapshotOf(items: readonly DocumentDiagnostic[]): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:r09-fix',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: items,
    errorCount: items.filter(d => d.severity === 'error').length,
    warningCount: items.filter(d => d.severity === 'warning').length,
    infoCount: items.filter(d => d.severity === 'info').length,
  }
}

function ctxFor(items: readonly DocumentDiagnostic[], markdown = MARKDOWN) {
  return {
    markdown,
    snapshotMarkdown: MARKDOWN,
    documentKey: 'doc:r09-fix',
    snapshot: snapshotOf(items),
    locked: false,
  }
}

describe('R09 — heading number repairs', () => {
  it('repairs double numbering through the central fix planner', () => {
    const items = diagnostics()
    const target = items.find(d => d.code === 'HEADING_DOUBLE_NUMBER_PREFIX')!
    const plan = planDiagnosticFixV2(target, ctxFor(items))
    expect(plan.ok).toBe(true)
    const next = applyPatchesToMarkdown(MARKDOWN, plan.patches)
    expect(next).toContain('## 1 研究背景')
    expect(next).not.toContain('1.1 1.1')
  })

  it('repairs a mismatch / missing heading with the same pipeline', () => {
    const items = diagnostics()
    for (const code of ['HEADING_NUMBER_MISMATCH', 'HEADING_NUMBER_MISSING']) {
      const target = items.find(d => d.code === code)!
      const plan = planDiagnosticFixV2(target, ctxFor(items))
      expect(plan.ok, code).toBe(true)
      const next = applyPatchesToMarkdown(MARKDOWN, plan.patches)
      expect(next, code).not.toBe(MARKDOWN)
    }
  })

  it('exposes double / order as AUTO_SAFE and the rest as explicit', () => {
    expect(describeFixCapability('HEADING_DOUBLE_NUMBER_PREFIX').capability).toBe('AUTO_SAFE')
    expect(describeFixCapability('HEADING_NUMBER_ORDER_ANOMALY').capability).toBe('AUTO_SAFE')
    expect(describeFixCapability('HEADING_NUMBER_MISMATCH').capability).toBe('EXPLICIT_ONLY')
    expect(describeFixCapability('HEADING_NUMBER_MISSING').capability).toBe('EXPLICIT_ONLY')
  })

  it('supports same-rule repair', () => {
    const items = diagnostics()
    const plans = planFixesForRuleV2('HEADING_NUMBER_MISSING', ctxFor(items))
    expect(plans).toHaveLength(1)
    expect(plans[0].ok).toBe(true)
  })

  it('includes safe heading repairs in the one-click pass', () => {
    const items = diagnostics()
    const plans = planAllAutoFixesV2(ctxFor(items))
    expect(plans.some(p => p.code === 'HEADING_DOUBLE_NUMBER_PREFIX')).toBe(true)
  })

  it('refuses a stale heading line', () => {
    const items = diagnostics()
    const target = items.find(d => d.code === 'HEADING_DOUBLE_NUMBER_PREFIX')!
    const changed = MARKDOWN.replace('## 1.1 1.1 研究背景', '## 1.1 1.1 研究背景（已修改）')
    const plan = planDiagnosticFixV2(target, ctxFor(items, changed))
    expect(plan.ok).toBe(false)
    expect(plan.blockers.some(b => b.code === 'STALE_SOURCE')).toBe(true)
  })
})

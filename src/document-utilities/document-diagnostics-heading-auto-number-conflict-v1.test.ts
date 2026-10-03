// @vitest-environment jsdom
/**
 * Heading Auto-Number Conflict Diagnostics V1 — targeted contract tests
 * (§7/§8/§9/§10/§14/§17/§18/§19/§46/§47/§52).
 *
 * The product contract this round adds:
 *
 *   `## 1.1 研究背景` + auto numbering EFFECTIVE for that heading
 *     → HEADING_AUTO_NUMBER_CONFLICT (error / document / heading-numbering)
 *
 *   `## 小节` + auto numbering (the plugin paints `一、小节`)
 *     → NO conflict (the generated number is never the evidence)
 *
 *   `## 2026 年工作总结` / `3D` / `5G` / `Python 3.12` / `ISO 9001` / `R2` /
 *   `H2O` / `100 个…` / `Version 2` / bare integers
 *     → NO conflict
 */
import { describe, expect, it } from 'vitest'
import {
  HEADING_AUTO_NUMBER_CONFLICT_CODE,
  HEADING_MANUAL_NUMBER_PREFIX_CODE,
  computeDocumentDiagnostics,
  resolveDocumentDiagnosticSeverity,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import {
  detectLegacyManualNumberPrefix,
  resolveHeadingManualNumberPrefix,
} from './document-diagnostics-heading-manual-number-prefix-v1'
import {
  HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS,
  HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS,
  HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_MINIMUMS,
  HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS,
  HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS,
  applyHeadingAutoNumberConflictFailure,
  classifyHeadingAutoNumberConflictTransition,
  createHeadingAutoNumberConflictCounters,
  createHeadingAutoNumberConflictCoverage,
  evaluateHeadingAutoNumberConflictCoverage,
  evaluateHeadingAutoNumberConflictDualPass,
  evaluateHeadingAutoNumberConflictTransition,
  coverageKeyForTransitionReason,
  headingAutoNumberConflictTransactionKey,
  noteHeadingAutoNumberConflictCoverageForReason,
  type HeadingAutoNumberConflictEvidenceState,
  evaluateHeadingAutoNumberConflictFacts,
  evaluateHeadingAutoNumberConflictGates,
  formatHeadingAutoNumberConflictCoverageReport,
  formatHeadingAutoNumberConflictGateReport,
  noteHeadingAutoNumberConflictCoverage,
} from './document-diagnostics-heading-auto-number-conflict-v1'
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY } from './document-diagnostic-location'
import { isExplicitlyMappedHeadingDiagnosticCode } from './document-diagnostic-heading-coverage-v514-r6'
import { resolveInlineHint } from './document-diagnostic-inline-presentation-v514-r5'
import { computeHeadingNumberingStyleKey } from '../heading-numbering/heading-auto-number-effective'
import { getPresetLevels } from '../heading-numbering/presets'
import type { HeadingNumberingSettings } from '../heading-numbering/heading-types'

// ── fixtures ────────────────────────────────────────────────────────────────

interface HeadingSpec {
  level: number
  text: string
  identity?: string | null
  effective?: boolean
  /** the plugin's OWN generated decoration (presentation only) */
  generatedNumber?: string | null
}

function makeElement(tag: string, line: number, text: string, generatedNumber?: string | null): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('data-line', String(line))
  el.textContent = text
  if (generatedNumber != null && generatedNumber !== '') {
    el.setAttribute('data-inkchapter-heading-number', generatedNumber)
  }
  return el
}

function inputOf(
  headings: readonly HeadingSpec[],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => ({
    level: h.level,
    text: h.text,
    stableIdentity: h.identity === null ? undefined : (h.identity ?? `H:${i}`),
    element: makeElement(`h${h.level}`, i * 2, h.text, h.generatedNumber),
    autoNumberingEffective: h.effective === true,
  }))
  const markdown = headings.map(h => `${'#'.repeat(h.level)} ${h.text}`).join('\n\n') + '\n'
  return {
    documentKey: 'doc:conflict',
    markdown,
    strictMode: true,
    vaultRoot: '/vault',
    headings: facts,
    h1Facts: facts.filter(f => f.level === 1).map(f => ({ stableIdentity: f.stableIdentity, element: f.element, text: f.text })),
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
    ...overrides,
  }
}

const conflictsOf = (
  headings: readonly HeadingSpec[],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): ReturnType<typeof computeDocumentDiagnostics>['diagnostics'] =>
  computeDocumentDiagnostics(inputOf(headings, overrides)).diagnostics
    .filter(d => d.code === HEADING_AUTO_NUMBER_CONFLICT_CODE)

/** §3 — the canonical per-heading evidence state used by the classifier tests. */
function evidence(overrides: Partial<HeadingAutoNumberConflictEvidenceState> = {}): HeadingAutoNumberConflictEvidenceState {
  return {
    documentKey: 'doc:conflict',
    headingStableIdentity: 'H2:idx:4',
    headingLevel: 2,
    sourceText: '1.1 背景',
    manualPrefixStatus: 'confirmed',
    manualPrefixKind: 'decimal-hierarchical',
    manualPrefixRaw: '1.1',
    globalAutoNumberingEnabled: true,
    autoNumberingEffectiveForHeading: true,
    h1NumberingEnabled: false,
    numberingStyleKey: '八、',
    generatedVisiblePrefix: '八、',
    conflict: true,
    diagnosticId: 'heading:HEADING_AUTO_NUMBER_CONFLICT:auto-number-conflict:H2:idx:4',
    ...overrides,
  }
}

// ── §7/§8 confirmed manual-number prefix matrix ─────────────────────────────

describe('V1 §7/§8 — the confirmed manual-number prefix matrix', () => {
  it('confirms every documented pattern with its kind', () => {
    const cases: Array<[string, string]> = [
      ['1. 绪论', 'decimal'],
      ['2、方法', 'decimal'],
      ['3) 结果', 'decimal'],
      ['1) 讨论', 'decimal'],
      ['1.1 研究背景', 'decimal-hierarchical'],
      ['1.1.2 参数估计', 'decimal-hierarchical'],
      ['2.3.4.1 算法流程', 'decimal-hierarchical'],
      ['(1) 数据', 'arabic-parenthesized'],
      ['（1）数据', 'arabic-parenthesized'],
      ['一、绪论', 'chinese'],
      ['二、模型建立', 'chinese'],
      ['（一）数据', 'chinese-parenthesized'],
      ['（二）方法', 'chinese-parenthesized'],
      ['I. Introduction', 'roman'],
      ['II. Method', 'roman'],
      ['III. Result', 'roman'],
      ['第1章 绪论', 'chapter-style'],
      ['第2节 方法', 'chapter-style'],
      ['第一章 绪论', 'chapter-style'],
      ['第二节 方法', 'chapter-style'],
    ]
    for (const [text, kind] of cases) {
      const match = resolveHeadingManualNumberPrefix(text)
      expect(match.status, text).toBe('confirmed')
      expect(match.kind, text).toBe(kind)
      expect(match.normalizedPrefix, text).not.toBeNull()
      expect(match.sourceEnd, text).toBeGreaterThan(match.sourceStart)
    }
  })

  it('§9 — the false-positive list stays ambiguous / none (never confirmed)', () => {
    for (const text of [
      '2026 年工作总结', '3D 建模方法', '5G 网络分析', 'Python 3.12 环境',
      'ISO 9001 质量体系', 'R2 指标', 'H2O 模型', '100 个实验样本', 'Version 2 说明',
    ]) {
      expect(resolveHeadingManualNumberPrefix(text).status, text).not.toBe('confirmed')
    }
  })

  it('§10 — bare integer + whitespace is AMBIGUOUS, never confirmed', () => {
    for (const text of ['1 绪论', '2 方法', '2026 工作总结']) {
      const match = resolveHeadingManualNumberPrefix(text)
      expect(match.status, text).toBe('ambiguous')
      expect(match.kind, text).toBeNull()
    }
  })

  it('roman requires an explicit separator and an uppercase run', () => {
    expect(resolveHeadingManualNumberPrefix('Introduction').status).toBe('none')
    expect(resolveHeadingManualNumberPrefix('Method').status).toBe('none')
    expect(resolveHeadingManualNumberPrefix('I. Introduction').status).toBe('confirmed')
  })

  it('SOURCE offsets point at the prefix inside the source text', () => {
    const match = resolveHeadingManualNumberPrefix('1.1 研究背景')
    expect('1.1 研究背景'.slice(match.sourceStart, match.sourceEnd)).toBe('1.1')
  })
})

describe('V1 §7/§14 — the legacy manual-prefix view stays the ONE parser', () => {
  it('keeps its historical narrow scope (no roman / chapter-style)', () => {
    expect(detectLegacyManualNumberPrefix('1. 概述')?.family).toBe('arabic')
    expect(detectLegacyManualNumberPrefix('1.1 概述')?.family).toBe('arabic')
    expect(detectLegacyManualNumberPrefix('一、概述')?.family).toBe('cjk-enum')
    expect(detectLegacyManualNumberPrefix('（一）概述')?.family).toBe('cjk-paren')
    // never widens: these are CONFIRMED for the conflict rule but NOT here
    expect(detectLegacyManualNumberPrefix('I. Introduction')).toBeNull()
    expect(detectLegacyManualNumberPrefix('第一章 概述')).toBeNull()
  })

  it('never matches the §24 negative list', () => {
    for (const text of ['2026 年计划', '5G 网络', '3D 模型', 'R2 版本', 'ISO 9001 认证', '一对一', '三分之一', '2026.10 发布']) {
      expect(detectLegacyManualNumberPrefix(text), text).toBeNull()
    }
  })
})

// ── §2/§3/§5/§13/§15 — the conflict producer ────────────────────────────────

describe('V1 §1/§2/§13 — the conflict producer', () => {
  it('§13 emits ONE error for a numbered heading with a confirmed source prefix', () => {
    const hits = conflictsOf([{ level: 2, text: '1.1 研究背景', effective: true, generatedNumber: '一、' }])
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('error')
    expect(hits[0].domain).toBe('document')
    expect(hits[0].category).toBe('heading')
    expect(hits[0].message).toBe('标题编号冲突')
    expect(hits[0].metadata?.scope).toBe('heading')
    expect(hits[0].metadata?.ruleCategory).toBe('heading-numbering')
    expect(hits[0].metadata?.manualPrefixKind).toBe('decimal-hierarchical')
    expect(hits[0].metadata?.manualPrefixRaw).toBe('1.1')
    // §25 — the scroll anchor is the canonical heading BLOCK
    expect(hits[0].location?.kind).toBe('canonical-node')
    // §19 — document + code + heading stable identity
    expect(hits[0].id).toBe('heading:HEADING_AUTO_NUMBER_CONFLICT:auto-number-conflict:H:0')
    expect(hits[0].stableIdentity).toBe('H:0')
  })

  it('§15 — NO conflict while the heading is not effectively auto-numbered', () => {
    expect(conflictsOf([{ level: 2, text: '1.1 研究背景', effective: false }])).toHaveLength(0)
  })

  it('§15 — NO conflict while the global master switch is OFF', () => {
    expect(conflictsOf(
      [{ level: 2, text: '1.1 研究背景', effective: true }],
      { headingAutoNumbering: { enabled: false, h1NumberingEnabled: false } },
    )).toHaveLength(0)
  })

  it('§3 case A — global ON + H1 numbering OFF + H1 manual prefix → NO conflict', () => {
    expect(conflictsOf([{ level: 1, text: '1. 绪论', effective: false }])).toHaveLength(0)
  })

  it('§3 case B — global ON + H1 numbering ON + H1 manual prefix → conflict', () => {
    const hits = conflictsOf(
      [{ level: 1, text: '1. 绪论', effective: true }],
      { headingAutoNumbering: { enabled: true, h1NumberingEnabled: true } },
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('error')
  })

  it('§5/§35 — the plugin generated number is NEVER the evidence', () => {
    // source `小节`, the plugin paints `一、小节` — no manual prefix exists
    expect(conflictsOf([{ level: 2, text: '小节', effective: true, generatedNumber: '一、' }])).toHaveLength(0)
  })

  it('§9/§33 — the false-positive matrix produces NO conflict', () => {
    const specs: HeadingSpec[] = [
      '2026 年工作总结', '3D 建模方法', '5G 网络分析', 'Python 3.12 环境',
      'ISO 9001 质量体系', 'R2 指标', 'H2O 模型', '100 个实验样本', 'Version 2 说明',
    ].map(text => ({ level: 2, text, effective: true, generatedNumber: '一、' }))
    expect(conflictsOf(specs)).toHaveLength(0)
  })

  it('§34 — bare integers stay ambiguous (no conflict)', () => {
    const specs: HeadingSpec[] = ['1 绪论', '2 方法', '2026 工作总结']
      .map(text => ({ level: 2, text, effective: true }))
    expect(conflictsOf(specs)).toHaveLength(0)
  })

  it('§17/§18 — ONE conflict per heading, every conflicting heading independent', () => {
    const hits = conflictsOf([
      { level: 2, text: '1.1 背景', effective: true, identity: 'A' },
      { level: 2, text: '1.2 方法', effective: true, identity: 'B' },
      { level: 2, text: '结果', effective: true, identity: 'C' },
    ])
    expect(hits).toHaveLength(2)
    expect(hits.map(d => d.stableIdentity).sort()).toEqual(['A', 'B'])
  })

  it('§11/§12 — a cross-style source prefix still conflicts', () => {
    // auto style = decimal (`1.1`), source = chinese
    const hits = conflictsOf([{ level: 2, text: '一、研究背景', effective: true, generatedNumber: '1.1' }])
    expect(hits).toHaveLength(1)
    expect(hits[0].metadata?.manualPrefixKind).toBe('chinese')
  })

  it('§14 — the generic manual-prefix warning is suppressed on the SAME heading only', () => {
    const diags = computeDocumentDiagnostics(inputOf([
      { level: 2, text: '1.1 研究背景', effective: true, identity: 'CONFLICT' },
      { level: 2, text: '2.2 方法', effective: false, identity: 'WARN_ONLY' },
    ])).diagnostics
    const conflicts = diags.filter(d => d.code === HEADING_AUTO_NUMBER_CONFLICT_CODE)
    const warnings = diags.filter(d => d.code === HEADING_MANUAL_NUMBER_PREFIX_CODE)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].stableIdentity).toBe('CONFLICT')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].stableIdentity).toBe('WARN_ONLY')
  })

  it('§19 — the identity never contains the generated number or the style', () => {
    const chinese = conflictsOf([{ level: 2, text: '1.1 研究背景', effective: true, generatedNumber: '一、' }])[0]
    const decimal = conflictsOf([{ level: 2, text: '1.1 研究背景', effective: true, generatedNumber: '1.1' }])[0]
    expect(chinese.id).toBe(decimal.id)
    expect(chinese.id).not.toContain('一、')
    expect(chinese.id).not.toContain('1.1')
  })
})

// ── §1/§31/§46/§48 — registry + severity + presentation ─────────────────────

describe('V1 §1/§13/§27/§31/§48 — registry, severity and presentation', () => {
  it('§13 — the severity policy fixes the rule at ERROR in both modes', () => {
    expect(resolveDocumentDiagnosticSeverity(HEADING_AUTO_NUMBER_CONFLICT_CODE, true)).toBe('error')
    expect(resolveDocumentDiagnosticSeverity(HEADING_AUTO_NUMBER_CONFLICT_CODE, false)).toBe('error')
  })

  it('§1/§48 — the rule registry declares the canonical-node + heading scope', () => {
    const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[HEADING_AUTO_NUMBER_CONFLICT_CODE]
    expect(meta).toBeDefined()
    expect(meta.category).toBe('heading')
    expect(meta.domain).toBe('document')
    expect(meta.area).toBe('caption-numbering')
    expect(meta.scope).toBe('heading')
    expect(meta.locationStrategy).toBe('canonical-node')
    expect(meta.presentation.reasonChip).toBe(true)
    expect(meta.presentation.activeVisualMode).toBe('text-tight-single-target')
    // §31 — the filter is driven by the SEVERITY axis: error ⇒ 全部 / 错误 only.
    expect(meta.presentation.drawerProjectionMode).toBe('single-row')
  })

  it('§27 — the reason chip reuses the existing heading-Error presentation', () => {
    expect(resolveInlineHint({ code: HEADING_AUTO_NUMBER_CONFLICT_CODE, category: 'heading' }))
      .toEqual({ hint: '编号冲突', source: 'MAPPED' })
  })

  it('§26 — the rule is explicitly mapped in the heading coverage authority', () => {
    expect(isExplicitlyMappedHeadingDiagnosticCode(HEADING_AUTO_NUMBER_CONFLICT_CODE)).toBe(true)
  })
})

// ── §44/§45/§46/§47 — the audit + gate + coverage authorities ───────────────

describe('V1 §44/§45 — the conflict decision functions', () => {
  const facts = {
    documentKey: 'doc',
    diagnosticId: 'heading:HEADING_AUTO_NUMBER_CONFLICT:auto-number-conflict:H:0',
    headingStableIdentity: 'H:0',
    headingLevel: '2',
    autoNumberingGlobalEnabled: true,
    autoNumberingEffectiveForHeading: true,
    h1NumberingEnabled: false,
    canonicalSourceText: '1.1 研究背景',
    manualPrefixStatus: 'confirmed' as const,
    manualPrefixKind: 'decimal-hierarchical',
    manualPrefixRaw: '1.1',
    generatedVisiblePrefix: '一、',
    sourceEvidenceUsesGeneratedPrefix: false,
    severity: 'error',
  }

  it('PASSes the canonical conflict', () => {
    const verdict = evaluateHeadingAutoNumberConflictFacts(facts)
    expect(verdict.decision).toBe('PASS')
    expect(verdict.reason).toBe('AUTO_NUMBER_CONFLICT_COVERAGE_CLOSED')
  })

  it('FAILs a wrong severity', () => {
    expect(evaluateHeadingAutoNumberConflictFacts({ ...facts, severity: 'warning' }).failedChecks)
      .toContain('WRONG_SEVERITY')
  })

  it('FAILs a conflict without an effective auto number', () => {
    expect(evaluateHeadingAutoNumberConflictFacts({ ...facts, autoNumberingEffectiveForHeading: false }).failedChecks)
      .toContain('CONFLICT_WITHOUT_EFFECTIVE_AUTO_NUMBER')
  })

  it('FAILs when the evidence would be the generated prefix', () => {
    expect(evaluateHeadingAutoNumberConflictFacts({
      ...facts, generatedVisiblePrefix: '1.1', sourceEvidenceUsesGeneratedPrefix: true,
    }).failedChecks).toContain('SOURCE_EVIDENCE_USES_GENERATED_PREFIX')
  })

  it('FAILs a manual prefix that is not in the source text', () => {
    expect(evaluateHeadingAutoNumberConflictFacts({ ...facts, canonicalSourceText: '研究背景' }).failedChecks)
      .toContain('MANUAL_PREFIX_NOT_IN_SOURCE_TEXT')
  })

  it('§39 T1 — Auto ON→OFF is AUTO_NUMBER_DISABLED, never a source transition', () => {
    const before = evidence({ conflict: true, diagnosticId: 'id' })
    const after = evidence({
      globalAutoNumberingEnabled: false,
      autoNumberingEffectiveForHeading: false,
      conflict: false,
      diagnosticId: null,
    })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('AUTO_NUMBER_DISABLED')
    expect(v.coverageKey).toBe('dynamicConfig')
    expect(v.decision).toBe('PASS')
  })

  it('§39 T2 — Auto OFF→ON is AUTO_NUMBER_ENABLED', () => {
    const before = evidence({
      globalAutoNumberingEnabled: false, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null,
    })
    const after = evidence({ conflict: true, diagnosticId: 'id' })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('AUTO_NUMBER_ENABLED')
    expect(v.coverageKey).toBe('dynamicConfig')
  })

  it('§39 T3 — H1 strict→loose is H1_NUMBERING_ENABLED', () => {
    const before = evidence({ headingLevel: 1, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null })
    const after = evidence({ headingLevel: 1, autoNumberingEffectiveForHeading: true, conflict: true, diagnosticId: 'id' })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('H1_NUMBERING_ENABLED')
    expect(v.coverageKey).toBe('h1Toggle')
  })

  it('§39 T4 — H1 loose→strict is H1_NUMBERING_DISABLED', () => {
    const before = evidence({ headingLevel: 1, conflict: true, diagnosticId: 'id' })
    const after = evidence({ headingLevel: 1, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('H1_NUMBERING_DISABLED')
    expect(v.coverageKey).toBe('h1Toggle')
  })

  it('§11/§17 T4b — a level≠1 effectiveness change is NEVER named H1_* (it would pollute h1Toggle)', () => {
    // A level-2 heading whose effectiveness moved but nothing else changed is not
    // an H1 toggle: it must fall through to NO_CHANGE, never bump h1Toggle.
    const before = evidence({ headingLevel: 2, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null })
    const after = evidence({ headingLevel: 2, autoNumberingEffectiveForHeading: true, conflict: false, diagnosticId: null })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('NO_CHANGE')
    expect(v.coverageKey).toBeNull()
  })

  it('§12 T4c — a level≠1 effectiveness move must NOT mask a REAL source transition', () => {
    // `## 1.1 研究背景` → `## 研究背景` during a re-render can also move the
    // engine's effectiveness verdict; the source authority is still the truth.
    const before = evidence({ headingLevel: 2, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null })
    const after = evidence({
      headingLevel: 2,
      autoNumberingEffectiveForHeading: true,
      sourceText: '研究背景',
      manualPrefixStatus: 'none',
      manualPrefixKind: null,
      manualPrefixRaw: null,
      conflict: false,
      diagnosticId: null,
    })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('SOURCE_PREFIX_REMOVED')
    expect(v.coverageKey).toBe('dynamicSource')
  })

  it('§14 T4d — a level≠1 effectiveness move EXPLAINS a conflict change (never INCOHERENT)', () => {
    const before = evidence({ headingLevel: 2, autoNumberingEffectiveForHeading: true, conflict: true, diagnosticId: 'id' })
    const after = evidence({ headingLevel: 2, autoNumberingEffectiveForHeading: false, conflict: false, diagnosticId: null })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('NO_CHANGE')
    expect(v.failedChecks).not.toContain('CONFLICT_STATE_INCOHERENT')
  })

  it('§39 T5/T6 — the source prefix lifecycle', () => {
    const confirmed = evidence({ sourceText: '1.1 背景', conflict: true, diagnosticId: 'id' })
    const bare = evidence({ sourceText: '背景', manualPrefixStatus: 'none', manualPrefixRaw: null, conflict: false, diagnosticId: null })
    expect(evaluateHeadingAutoNumberConflictTransition({ before: confirmed, after: bare }).transitionReason).toBe('SOURCE_PREFIX_REMOVED')
    expect(evaluateHeadingAutoNumberConflictTransition({ before: bare, after: confirmed }).transitionReason).toBe('SOURCE_PREFIX_ADDED')
  })

  it('§39 T7 — confirmed prefix A→B is SOURCE_PREFIX_CHANGED', () => {
    const a = evidence({ sourceText: '1.1 背景', manualPrefixRaw: '1.1', conflict: true, diagnosticId: 'id' })
    const b = evidence({ sourceText: '1.2 背景', manualPrefixRaw: '1.2', conflict: true, diagnosticId: 'id' })
    const v = evaluateHeadingAutoNumberConflictTransition({ before: a, after: b })
    expect(v.transitionReason).toBe('SOURCE_PREFIX_CHANGED')
    expect(v.coverageKey).toBe('dynamicSource')
  })

  it('§39 T8 — a style switch keeps the conflict and the identity', () => {
    const before = evidence({ numberingStyleKey: '八、', generatedVisiblePrefix: '八、', conflict: true, diagnosticId: 'id' })
    const after = evidence({ numberingStyleKey: '8', generatedVisiblePrefix: '8', conflict: true, diagnosticId: 'id' })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('NUMBER_STYLE_CHANGED')
    expect(v.coverageKey).toBe('styleSwitch')
    expect(v.decision).toBe('PASS')
    expect(v.failedChecks).not.toContain('STYLE_SWITCH_LOST_CONFLICT')
  })

  it('§39 T9 — a TRUE incoherent state is the ONLY CONFLICT_STATE_INCOHERENT source', () => {
    const before = evidence({ conflict: true, diagnosticId: 'id' })
    const after = evidence({ conflict: false, diagnosticId: null })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('CONFLICT_STATE_INCOHERENT')
    expect(v.failedChecks).toContain('CONFLICT_STATE_INCOHERENT')
    expect(v.decision).toBe('FAIL')
  })

  it('§39 T9b — a style switch that LOSES the conflict raises the split gate only', () => {
    const before = evidence({ numberingStyleKey: '八、', conflict: true, diagnosticId: 'id' })
    const after = evidence({ numberingStyleKey: '8', conflict: false, diagnosticId: null })
    const v = evaluateHeadingAutoNumberConflictTransition({ before, after })
    expect(v.transitionReason).toBe('NUMBER_STYLE_CHANGED')
    expect(v.failedChecks).toContain('STYLE_SWITCH_LOST_CONFLICT')
    expect(v.failedChecks).not.toContain('CONFLICT_STATE_INCOHERENT')
  })

  it('§39 T10 — the initial baseline is never a transition', () => {
    // an empty `before` is not diffable: the authority skips it entirely
    expect(classifyHeadingAutoNumberConflictTransition(evidence({}), evidence({}))).toBe('NO_CHANGE')
  })

  it('§39 T11 — a removed heading is HEADING_REMOVED, not a config/source change', () => {
    expect(evaluateHeadingAutoNumberConflictTransition({ before: evidence({ conflict: true, diagnosticId: 'id' }), after: null })
      .transitionReason).toBe('HEADING_REMOVED')
  })
})

describe('V1 §46 — the hard gates', () => {
  it('declares every gate with its label and starts at 0', () => {
    const counters = createHeadingAutoNumberConflictCounters()
    expect(HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS).toHaveLength(50)
    expect(formatHeadingAutoNumberConflictGateReport(counters)).toHaveLength(50)
    expect(evaluateHeadingAutoNumberConflictGates(counters).decision).toBe('PASS')
    expect(HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS.headingAutoNumberConflictWrongSeverity)
      .toBe('HEADING_AUTO_NUMBER_CONFLICT_WRONG_SEVERITY_COUNT')
    expect(HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS.autoGeneratedHeadingNumberReportedAsManual)
      .toBe('AUTO_GENERATED_HEADING_NUMBER_REPORTED_AS_MANUAL_COUNT')
  })

  it('folds a failed decision into the right gate counters', () => {
    const counters = createHeadingAutoNumberConflictCounters()
    applyHeadingAutoNumberConflictFailure(counters, [
      'WRONG_SEVERITY', 'SOURCE_EVIDENCE_USES_GENERATED_PREFIX', 'NOT_A_GATE',
    ])
    expect(counters.headingAutoNumberConflictWrongSeverity).toBe(1)
    expect(counters.autoGeneratedHeadingNumberReportedAsManual).toBe(1)
    expect(evaluateHeadingAutoNumberConflictGates(counters).decision).toBe('FAIL')
  })
})

describe('V1 §47 — the positive coverage', () => {
  it('declares every coverage key with its label, minimum and starts empty', () => {
    const coverage = createHeadingAutoNumberConflictCoverage()
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS).toHaveLength(14)
    expect(formatHeadingAutoNumberConflictCoverageReport(coverage)).toHaveLength(14)
    expect(evaluateHeadingAutoNumberConflictCoverage(coverage).decision).toBe('FAIL')
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS.crossStyle)
      .toBe('HEADING_AUTO_NUMBER_CONFLICT_CROSS_STYLE_RUNTIME_COUNT')
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_MINIMUMS.crossStyle).toBe(2)
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS.drawerViewportStable)
      .toBe('HEADING_AUTO_NUMBER_CONFLICT_DRAWER_VIEWPORT_STABLE_RUNTIME_COUNT')
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS.suppressionSameHeading)
      .toBe('SUPPRESSION_SAME_HEADING_RUNTIME_COUNT')
    expect(HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS.nonConflictManualWarning)
      .toBe('NON_CONFLICT_MANUAL_WARNING_RUNTIME_COUNT')
  })

  it('§4 — the DUAL pass condition requires BOTH gates and coverage', () => {
    const counters = createHeadingAutoNumberConflictCounters()
    const coverage = createHeadingAutoNumberConflictCoverage()
    // gates OK but coverage empty → FAIL (a zero counter alone is NOT a pass)
    const dualEmpty = evaluateHeadingAutoNumberConflictDualPass(counters, coverage)
    expect(dualEmpty.decision).toBe('FAIL')
    expect(dualEmpty.gatesOk).toBe(true)
    expect(dualEmpty.coverageOk).toBe(false)
    expect(dualEmpty.failedChecks.join(',')).toContain('MISSING_POSITIVE_COVERAGE:')
    // gate failure → FAIL even with full coverage
    const failing = createHeadingAutoNumberConflictCounters()
    failing.headingAutoNumberConflictWrongSeverity = 1
    expect(evaluateHeadingAutoNumberConflictDualPass(failing, coverage).decision).toBe('FAIL')
  })

  it('notes a conflict per manual-number kind and counts cross-style', () => {
    const coverage = createHeadingAutoNumberConflictCoverage()
    noteHeadingAutoNumberConflictCoverage(coverage, { manualPrefixKind: 'decimal', crossStyle: false })
    noteHeadingAutoNumberConflictCoverage(coverage, { manualPrefixKind: 'decimal-hierarchical', crossStyle: false })
    noteHeadingAutoNumberConflictCoverage(coverage, { manualPrefixKind: 'chinese', crossStyle: true })
    noteHeadingAutoNumberConflictCoverage(coverage, { manualPrefixKind: 'roman', crossStyle: true })
    noteHeadingAutoNumberConflictCoverage(coverage, { manualPrefixKind: 'chapter-style', crossStyle: false })
    expect(coverage.decimal).toBe(1)
    expect(coverage.hierarchical).toBe(1)
    expect(coverage.chinese).toBe(1)
    expect(coverage.roman).toBe(1)
    expect(coverage.chapterStyle).toBe(1)
    expect(coverage.crossStyle).toBe(2)
  })
})

// ── §18/§19/§41 — the coverage mapping is a PURE function of the reason ─────

describe('V1.2 §17/§18/§19 — coverage consumes the transition reason only', () => {
  it('§41 — the fixed reason→coverage mapping', () => {
    expect(coverageKeyForTransitionReason('AUTO_NUMBER_DISABLED')).toBe('dynamicConfig')
    expect(coverageKeyForTransitionReason('AUTO_NUMBER_ENABLED')).toBe('dynamicConfig')
    expect(coverageKeyForTransitionReason('H1_NUMBERING_DISABLED')).toBe('h1Toggle')
    expect(coverageKeyForTransitionReason('H1_NUMBERING_ENABLED')).toBe('h1Toggle')
    expect(coverageKeyForTransitionReason('SOURCE_PREFIX_REMOVED')).toBe('dynamicSource')
    expect(coverageKeyForTransitionReason('SOURCE_PREFIX_ADDED')).toBe('dynamicSource')
    expect(coverageKeyForTransitionReason('SOURCE_PREFIX_CHANGED')).toBe('dynamicSource')
    expect(coverageKeyForTransitionReason('NUMBER_STYLE_CHANGED')).toBe('styleSwitch')
    expect(coverageKeyForTransitionReason('HEADING_REMOVED')).toBeNull()
    expect(coverageKeyForTransitionReason('CONFLICT_STATE_INCOHERENT')).toBeNull()
    expect(coverageKeyForTransitionReason('NO_CHANGE')).toBeNull()
  })

  it('§18 — AUTO_NUMBER_DISABLED bumps dynamicConfig and NEVER dynamicSource', () => {
    const coverage = createHeadingAutoNumberConflictCoverage()
    expect(noteHeadingAutoNumberConflictCoverageForReason(coverage, 'AUTO_NUMBER_DISABLED')).toBe(true)
    expect(coverage.dynamicConfig).toBe(1)
    expect(coverage.dynamicSource).toBe(0)
    expect(coverage.h1Toggle).toBe(0)
  })

  it('§18 — H1_NUMBERING_DISABLED bumps h1Toggle and NEVER dynamicSource', () => {
    const coverage = createHeadingAutoNumberConflictCoverage()
    noteHeadingAutoNumberConflictCoverageForReason(coverage, 'H1_NUMBERING_DISABLED')
    expect(coverage.h1Toggle).toBe(1)
    expect(coverage.dynamicSource).toBe(0)
  })

  it('§19 — the transaction key dedups one config change across all its headings', () => {
    const key = headingAutoNumberConflictTransactionKey({
      runtimeSessionId: 's1', diagnosticsRevision: 4, transitionReason: 'AUTO_NUMBER_DISABLED',
      settingsRevision: 0, sourceRevision: 9,
    })
    const sameTransaction = headingAutoNumberConflictTransactionKey({
      runtimeSessionId: 's1', diagnosticsRevision: 4, transitionReason: 'AUTO_NUMBER_DISABLED',
      settingsRevision: 0, sourceRevision: 9,
    })
    expect(sameTransaction).toBe(key)
    // a DIFFERENT revision is a DIFFERENT transaction
    expect(headingAutoNumberConflictTransactionKey({
      runtimeSessionId: 's1', diagnosticsRevision: 5, transitionReason: 'AUTO_NUMBER_DISABLED',
      settingsRevision: 0, sourceRevision: 9,
    })).not.toBe(key)
    // a DIFFERENT runtime session is never merged with the previous one
    expect(headingAutoNumberConflictTransactionKey({
      runtimeSessionId: 's2', diagnosticsRevision: 4, transitionReason: 'AUTO_NUMBER_DISABLED',
      settingsRevision: 0, sourceRevision: 9,
    })).not.toBe(key)
  })

  it('§39 T12 — the evidence state is keyed by heading identity, not by conflict', () => {
    // a heading whose conflict disappeared KEEPS its identity + source evidence
    const before = evidence({ conflict: true })
    const after = evidence({ conflict: false, diagnosticId: null })
    expect(after.headingStableIdentity).toBe(before.headingStableIdentity)
    expect(after.sourceText).toBe(before.sourceText)
    expect(after.manualPrefixStatus).toBe('confirmed')
    expect(classifyHeadingAutoNumberConflictTransition(before, after)).toBe('CONFLICT_STATE_INCOHERENT')
  })
})

/**
 * §13 — the STYLE key is the effective numbering CONFIGURATION (preset +
 * per-level format), never the rendered auto number. A global ON/OFF toggle or a
 * strict/loose switch must NOT move it, otherwise a config transition would be
 * misclassified as NUMBER_STYLE_CHANGED.
 */
describe('Heading Auto-Number Conflict V1.2 §13 — numbering style key', () => {
  function settings(overrides: Record<string, unknown> = {}): HeadingNumberingSettings {
    return {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
      ...overrides,
    } as HeadingNumberingSettings
  }

  it('§13 — the global enable toggle and the strict/loose switch NEVER move the style key', () => {
    const base = computeHeadingNumberingStyleKey(settings())
    expect(computeHeadingNumberingStyleKey(settings({ enabled: false }))).toBe(base)
    expect(computeHeadingNumberingStyleKey(settings({ showLevelOneNumber: true }))).toBe(base)
    expect(computeHeadingNumberingStyleKey(settings({ headingStructureMode: 'loose', showLevelOneNumber: true }))).toBe(base)
  })

  it('§13 — a REAL preset change moves the style key', () => {
    const decimal = computeHeadingNumberingStyleKey(settings({ preset: 'decimal-hierarchical' }))
    const chinese = computeHeadingNumberingStyleKey(settings({ preset: 'chinese-outline', levels: getPresetLevels('chinese-outline') }))
    const roman = computeHeadingNumberingStyleKey(settings({ preset: 'roman-hierarchical', levels: getPresetLevels('roman-hierarchical') }))
    expect(new Set([decimal, chinese, roman]).size).toBe(3)
  })

  it('§13 — an off→on toggle keeps the style key unchanged, so the transition is never a style switch', () => {
    const off = settings({ enabled: false })
    const on = settings({ enabled: true })
    const evidenceAt = (enabled: boolean, conflict: boolean) => evidence({
      globalAutoNumberingEnabled: enabled,
      autoNumberingEffectiveForHeading: enabled,
      numberingStyleKey: computeHeadingNumberingStyleKey(enabled ? on : off),
      generatedVisiblePrefix: enabled ? '一、' : null,
      conflict,
      diagnosticId: conflict ? 'id' : null,
    })
    const verdict = evaluateHeadingAutoNumberConflictTransition({
      before: evidenceAt(false, false),
      after: evidenceAt(true, true),
    })
    expect(verdict.transitionReason).toBe('AUTO_NUMBER_ENABLED')
    expect(verdict.coverageKey).toBe('dynamicConfig')
  })
})

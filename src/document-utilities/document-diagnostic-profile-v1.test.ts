import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_PROFILE_DEFAULTS,
  isDiagnosticFamilyEnabledForProfile,
  resolveDiagnosticProfile,
} from './document-diagnostic-profile-v1'
import {
  ACADEMIC_WIDTH_BOUNDS,
  resolveAcademicWidthModel,
} from './document-diagnostic-academic-width-v1'

describe('B3 §B3-01 — diagnostic profile inheritance', () => {
  it('general has no parent and no overrides', () => {
    const p = resolveDiagnosticProfile('general')
    expect(p.chain).toEqual(['general'])
    expect(p.enabledRuleFamilies).toEqual([])
    expect(p.disabledRuleFamilies).toEqual([])
    expect(p.issues).toEqual([])
  })

  it('academic inherits general and supplies opt-in formula limits + width', () => {
    const p = resolveDiagnosticProfile('academic')
    expect(p.chain).toEqual(['general', 'academic'])
    expect(p.formulaSourceRules).toEqual({ lengthLimit: 300, lineLimit: 120 })
    expect(p.contentWidthPx).toBe(820)
  })

  it('lab-report inherits academic and overrides the length limit', () => {
    const p = resolveDiagnosticProfile('lab-report')
    expect(p.chain).toEqual(['general', 'academic', 'lab-report'])
    expect(p.formulaSourceRules).toEqual({ lengthLimit: 260, lineLimit: 120 })
    expect(p.contentWidthPx).toBe(900)
  })

  it('custom inherits general and applies explicit enable/disable without dropping the parent', () => {
    const p = resolveDiagnosticProfile('custom', {
      inherits: 'general',
      enabledRuleFamilies: ['TABLE_COLUMN_COUNT_MISMATCH', 'NOT_A_RULE'],
      disabledRuleFamilies: ['FIGURE_MISSING_NAME'],
    })
    expect(p.chain).toEqual(['general', 'custom'])
    expect(p.enabledRuleFamilies).toEqual(['TABLE_COLUMN_COUNT_MISMATCH'])
    expect(p.disabledRuleFamilies).toEqual(['FIGURE_MISSING_NAME'])
    expect(p.issues).toContain('unknown-rule:NOT_A_RULE')
  })

  it('a cycle is reported and never recurses forever', () => {
    const p = resolveDiagnosticProfile('custom', { inherits: 'custom' })
    expect(p.issues).toContain('profile-cycle:custom')
  })

  it('defaultEnabled is the baseline and explicit profile flags win', () => {
    const p = resolveDiagnosticProfile('custom', {
      inherits: 'general',
      enabledRuleFamilies: ['CB008'],
      disabledRuleFamilies: ['FIGURE_MISSING_NAME'],
    })
    expect(isDiagnosticFamilyEnabledForProfile(p, 'CB008')).toBe(true)
    expect(isDiagnosticFamilyEnabledForProfile(p, 'FIGURE_MISSING_NAME')).toBe(false)
    expect(isDiagnosticFamilyEnabledForProfile(resolveDiagnosticProfile('general'), 'CB008')).toBe(false)
    expect(isDiagnosticFamilyEnabledForProfile(resolveDiagnosticProfile('general'), 'FIGURE_MISSING_NAME')).toBe(true)
  })

  it('built-in profile ids stay complete', () => {
    expect(Object.keys(DIAGNOSTIC_PROFILE_DEFAULTS).sort()).toEqual(['academic', 'custom', 'general', 'lab-report'])
  })
})

describe('B3 §B3-03 — academic width model', () => {
  it('resolves named presets', () => {
    expect(resolveAcademicWidthModel({ preset: 'narrow' }).contentWidthPx).toBe(720)
    expect(resolveAcademicWidthModel({ preset: 'standard' }).contentWidthPx).toBe(820)
    expect(resolveAcademicWidthModel({ preset: 'wide' }).contentWidthPx).toBe(960)
    expect(resolveAcademicWidthModel({ preset: 'lab-report' }).contentWidthPx).toBe(900)
  })

  it('clamps a custom width into the bounded range and flags it', () => {
    const tooWide = resolveAcademicWidthModel({ customPx: 5000 })
    expect(tooWide.contentWidthPx).toBe(ACADEMIC_WIDTH_BOUNDS.maxPx)
    expect(tooWide.clamped).toBe(true)
    const tooNarrow = resolveAcademicWidthModel({ customPx: 100 })
    expect(tooNarrow.contentWidthPx).toBe(ACADEMIC_WIDTH_BOUNDS.minPx)
    expect(tooNarrow.clamped).toBe(true)
  })

  it('keeps a legal custom width unclamped', () => {
    const model = resolveAcademicWidthModel({ customPx: 860 })
    expect(model.contentWidthPx).toBe(860)
    expect(model.clamped).toBe(false)
  })
})

// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.10 — Heading Policy Activation Authority (pure resolver).
 *
 * Locks the invariant that cost the previous round its acceptance:
 *   storedMode === 'strict'  DOES NOT imply  strictPolicyActive === true.
 *
 * The critical regression is STORED_STRICT_BUT_INACTIVE_ZERO_H1: settings
 * store 'strict' (default/legacy seed), no feature/global/document activation
 * → effectivePolicyActive=false, effectiveMode=null, strict diagnostics SKIP.
 */
import { describe, it, expect } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from '../document-utilities/document-diagnostics'
import {
  resolveHeadingPolicyActivation,
  type EffectiveHeadingPolicy,
} from './heading-policy-activation'
import type { HeadingNumberingSettings } from './heading-types'

function settingsOf(overrides: Partial<HeadingNumberingSettings>): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: {} as HeadingNumberingSettings['levels'],
    ...overrides,
  }
}

function policyInput(cfg: {
  strictPolicyActive?: boolean
  strictMode?: boolean
  h1Count?: number
  markdown?: string
}): DocumentDiagnosticsInput {
  const h1Count = cfg.h1Count ?? 0
  const h1Facts = Array.from({ length: h1Count }, (_, i) => ({ stableIdentity: `h1-${i}`, element: null }))
  return {
    documentKey: 'doc:key',
    markdown: cfg.markdown ?? (h1Count === 0 ? '纯正文。\n' : h1Count === 1 ? '# A\n' : '# A\n\n# B\n'),
    strictMode: cfg.strictMode ?? true,
    strictPolicyActive: cfg.strictPolicyActive,
    headingPolicyEnabled: cfg.strictPolicyActive === undefined ? undefined : true,
    headingPolicyConfigured: cfg.strictPolicyActive === undefined ? undefined : cfg.strictPolicyActive,
    vaultRoot: '/vault',
    headings: [],
    h1Facts,
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function hasStrictCode(r: { diagnostics: Array<{ code: string }> }): boolean {
  return r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_') || d.code.startsWith('STRICT_FIRST_H1_') || d.code === 'STRICT_H1_MISSING')
}

describe('Heading Policy Activation Authority — stored ≠ active', () => {
  it('STORED_STRICT_BUT_INACTIVE_ZERO_H1: storedMode=strict + no activation → inactive, null mode', () => {
    const p: EffectiveHeadingPolicy = resolveHeadingPolicyActivation(settingsOf({}), null)
    expect(p.storedMode).toBe('strict')
    expect(p.storedStrictRequire).toBe(true)
    expect(p.featureEnabled).toBe(true)
    expect(p.globalScopeEnabled).toBe(false)
    expect(p.documentScopeEnabled).toBe(false)
    expect(p.activationSource).toBe('none')
    expect(p.effectivePolicyActive).toBe(false)
    expect(p.effectiveMode).toBeNull()
    expect(p.effectiveStrictRequire).toBe(false)
  })

  it('STORED_STRICT_BUT_INACTIVE_ZERO_H1 diagnostics: NO strict diagnostic when policy inactive', () => {
    const r = computeDocumentDiagnostics(policyInput({
      strictMode: true, // legacy effective still strict
      strictPolicyActive: false,
    }))
    expect(hasStrictCode(r)).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })

  it('global explicit strict → active strict; effectiveMode=strict', () => {
    const p = resolveHeadingPolicyActivation(settingsOf({ headingStructureConfigured: true }), null)
    expect(p.effectivePolicyActive).toBe(true)
    expect(p.activationSource).toBe('global-explicit')
    expect(p.effectiveMode).toBe('strict')
    expect(p.effectiveStrictRequire).toBe(true)
  })

  it('document override strict → document-explicit even when global inactive', () => {
    const p = resolveHeadingPolicyActivation(settingsOf({ headingStructureConfigured: false }), 'strict')
    expect(p.documentScopeEnabled).toBe(true)
    expect(p.effectivePolicyActive).toBe(true)
    expect(p.activationSource).toBe('document-explicit')
    expect(p.effectiveMode).toBe('strict')
  })

  it('feature disabled kills activation even with explicit global strict', () => {
    const p = resolveHeadingPolicyActivation(settingsOf({ enabled: false, headingStructureConfigured: true }), null)
    expect(p.featureEnabled).toBe(false)
    expect(p.effectivePolicyActive).toBe(false)
    expect(p.effectiveMode).toBeNull()
  })

  it('stored loose + inactive → stays inactive/null; explicit loose → active loose, never strict', () => {
    const inactive = resolveHeadingPolicyActivation(settingsOf({ headingStructureMode: 'loose' }), null)
    expect(inactive.effectiveMode).toBeNull()
    const active = resolveHeadingPolicyActivation(settingsOf({ headingStructureMode: 'loose', headingStructureConfigured: true }), null)
    expect(active.effectivePolicyActive).toBe(true)
    expect(active.effectiveMode).toBe('loose')
    expect(active.effectiveStrictRequire).toBe(false)
  })

  it('legacy stored default strict (no explicit mode field) is NOT activation', () => {
    const s = settingsOf({ headingStructureMode: undefined, showLevelOneNumber: false })
    const p = resolveHeadingPolicyActivation(s, null)
    expect(p.storedMode).toBe('strict') // legacy fallback value is stored-only
    expect(p.effectivePolicyActive).toBe(false)
  })
})

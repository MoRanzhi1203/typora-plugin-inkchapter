// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.9 — Conditional Strict H1 Policy activation.
 *
 * Runtime-proven problem: DISABLED/UNCONFIGURED installs were still forced to
 * satisfy "must have exactly one H1 / must start with H1 / no pre-H1 body",
 * because diagnostics gated strict rules on the legacy effective mode alone
 * (whose default resolved to 'strict'). Locked here:
 *   strict-policy rules run ONLY when strictPolicyActive === true
 *   (feature enabled && explicitly configured && effective mode strict).
 * Generic heading STRUCTURE diagnostics (gap / empty / duplicate) stay active
 * regardless of the strict-policy gate.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'

// ── Pure matrix helpers ─────────────────────────────────

interface Policy {
  enabled: boolean
  configured: boolean
  strictPolicyActive: boolean
}

interface PureCase {
  strictMode?: boolean
  policy?: Policy
  markdown?: string
  h1Count?: number
  headings?: DocumentDiagnosticsInput['headings']
}

function el(tag: string): HTMLElement {
  return document.createElement(tag)
}

function compute(cfg: PureCase = {}) {
  const h1Count = cfg.h1Count ?? 0
  const markdown = cfg.markdown ?? (h1Count === 0 ? '纯正文。\n' : h1Count === 1 ? '# A\n' : '# A\n\n# B\n')
  const h1Facts = Array.from({ length: h1Count }, (_, i) => ({ stableIdentity: `h1-${i}`, element: null }))
  const input: DocumentDiagnosticsInput = {
    documentKey: 'doc:key',
    markdown,
    strictMode: cfg.strictMode ?? true,
    headingPolicyEnabled: cfg.policy?.enabled,
    headingPolicyConfigured: cfg.policy?.configured,
    strictPolicyActive: cfg.policy?.strictPolicyActive,
    vaultRoot: '/vault',
    headings: cfg.headings ?? [],
    h1Facts,
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
  return computeDocumentDiagnostics(input)
}

function hasStrictCode(r: { diagnostics: Array<{ code: string }> }): boolean {
  return r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_') || d.code.startsWith('STRICT_FIRST_H1_'))
}

// ── Matrix ──────────────────────────────────────────────

describe('CONDITIONAL strict H1 policy — pure matrix', () => {
  it('UNCONFIGURED_ZERO_H1_NO_STRICT_ERROR: feature on, NOT configured, 0 H1 → no strict error', () => {
    const r = compute({ policy: { enabled: true, configured: false, strictPolicyActive: false } })
    expect(hasStrictCode(r)).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })

  it('DISABLED_ZERO_H1_NO_STRICT_ERROR: feature OFF + legacy mode strict + 0 H1 → no strict error', () => {
    // strictMode stays true (legacy effective strict), the real gate is closed.
    const r = compute({
      strictMode: true,
      policy: { enabled: false, configured: false, strictPolicyActive: false },
    })
    expect(hasStrictCode(r)).toBe(false)
  })

  it('DISABLED_MULTI_H1_NO_SINGLE_H1_ERROR: feature OFF, 3 H1 → no exactly-one-H1 error', () => {
    const r = compute({
      policy: { enabled: false, configured: false, strictPolicyActive: false },
      h1Count: 3,
      markdown: '# A\n\n# B\n\n# C\n',
    })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(false)
    expect(hasStrictCode(r)).toBe(false)
  })

  it('STRICT_ZERO_H1_ERROR: explicitly configured strict + 0 H1 → STRICT_SINGLE_H1_NO_H1 present', () => {
    const r = compute({ policy: { enabled: true, configured: true, strictPolicyActive: true } })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })

  it('STRICT_SINGLE_H1_PASS: explicitly configured strict + 1 H1 → no strict error', () => {
    const r = compute({
      policy: { enabled: true, configured: true, strictPolicyActive: true },
      h1Count: 1,
      markdown: '# A\n',
    })
    expect(hasStrictCode(r)).toBe(false)
  })

  it('STRICT_MULTI_H1_ERROR: explicitly configured strict + 3 H1 → STRICT_SINGLE_H1_MULTIPLE_H1 present (multi-target)', () => {
    const r = compute({
      policy: { enabled: true, configured: true, strictPolicyActive: true },
      h1Count: 3,
      markdown: '# A\n\n# B\n\n# C\n',
    })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(true)
    const item = r.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')
    expect(item?.location?.kind).toBe('multi-target')
  })

  it('LOOSE_ZERO_H1 + LOOSE_MULTI_H1: loose NEVER emits strict errors', () => {
    const zero = compute({
      strictMode: false,
      policy: { enabled: true, configured: true, strictPolicyActive: false },
    })
    const multi = compute({
      strictMode: false,
      policy: { enabled: true, configured: true, strictPolicyActive: false },
      h1Count: 3,
      markdown: '# A\n\n# B\n\n# C\n',
    })
    expect(hasStrictCode(zero)).toBe(false)
    expect(hasStrictCode(multi)).toBe(false)
  })

  it('CUSTOM_POLICY_ISOLATION: non-strict effective mode NEVER falls back to strict', () => {
    const r = compute({
      strictMode: false,
      policy: { enabled: true, configured: true, strictPolicyActive: false },
      h1Count: 0,
    })
    expect(hasStrictCode(r)).toBe(false)
  })

  it('GENERIC_HEADING_SKIP_STILL_ACTIVE: H1→H3 gap stays while strict policy is OFF', () => {
    const r = compute({
      policy: { enabled: false, configured: false, strictPolicyActive: false },
      markdown: '# A\n\n### C\n',
      headings: [
        { level: 1, text: 'A', stableIdentity: 'h1-0', element: el('h1') },
        { level: 3, text: 'C', stableIdentity: 'h3-0', element: el('h3') },
      ],
      h1Count: 1,
    })
    expect(hasStrictCode(r)).toBe(false)
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap).toBeTruthy()
    expect(gap?.message).toContain('H1')
  })

  it('absent policy fields keep the legacy strictMode semantics (pure/legacy callers)', () => {
    const strict = compute({ strictMode: true, h1Count: 0 })
    const loose = compute({ strictMode: false, h1Count: 0 })
    expect(strict.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
    expect(loose.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })
})

// ── Authority live gate toggle (OFF ⇄ strict) ───────────

interface State {
  docKey: string
  markdown: string
  enabled: boolean
  configured: boolean
  mode: 'strict' | 'loose'
}

function makeCtx(state: State): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => `/vault/${state.docKey}.md`,
      getDocumentKey: () => state.docKey,
      getMarkdown: () => state.markdown,
      isStrictMode: () => state.mode === 'strict',
      getHeadingPolicyState: () => ({
        enabled: state.enabled,
        configured: state.configured,
        effectiveMode: state.mode,
        strictPolicyActive: state.enabled && state.configured && state.mode === 'strict',
      }),
      getEffectiveHeadingModeRevision: () => (state.mode === 'strict' ? 2 : 1),
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

function emptyH1Authority(state: State): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY', reason: 'READY', documentKey: state.docKey, framePresent: true,
    frameDocumentKey: state.docKey, semanticRevision: 1, frameGeneration: 1,
    canonicalEntryCount: 0, mappedEntryCount: 0, invalidEntryCount: 0,
    physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

function makeProviders(state: State): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
    getCanonicalH1Facts: () => emptyH1Authority(state),
  }
}

function strictCodes(snap: DocumentDiagnosticsSnapshot): string[] {
  return snap.diagnostics
    .filter(d => d.code.startsWith('STRICT_SINGLE_H1_') || d.code.startsWith('STRICT_FIRST_H1_'))
    .map(d => d.code)
}

describe('AUTHORITY settings live toggle (OFF ⇄ strict)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
  })

  it('OFF(unconfigured)→strict→OFF: strict diagnostics auto ADD then REMOVE across recomputes', () => {
    const state: State = {
      docKey: 'doc:plain',
      markdown: '纯正文。\n',
      enabled: true,
      configured: false,
      mode: 'strict', // legacy effective mode stays strict even when unconfigured
    }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders(state))
    authority.recompute()
    expect(strictCodes(authority.getSnapshot()!)).toEqual([]) // OFF → absent

    state.configured = true // user explicitly configures strict
    authority.recompute()
    expect(strictCodes(authority.getSnapshot()!)).toContain('STRICT_SINGLE_H1_NO_H1') // auto-add

    state.configured = false // policy OFF again
    authority.recompute()
    expect(strictCodes(authority.getSnapshot()!)).toEqual([]) // auto-remove
  })

  it('feature master OFF keeps strict rules absent even when configured + effective strict', () => {
    const state: State = {
      docKey: 'doc:plain',
      markdown: '纯正文。\n',
      enabled: false,
      configured: true,
      mode: 'strict',
    }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders(state))
    authority.recompute()
    expect(strictCodes(authority.getSnapshot()!)).toEqual([])
  })
})

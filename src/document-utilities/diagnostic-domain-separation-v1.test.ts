// @vitest-environment jsdom
/**
 * TRAE — Unified Diagnostics Domain Architecture V1 (§24–§28 / §32).
 *
 * ONE diagnostics infrastructure, TWO responsibility domains:
 *   domain=document → user Markdown problems (the ONLY thing the user Drawer shows)
 *   domain=runtime  → InkChapter plugin code/state/deployment problems
 *
 * These tests lock down the domain authority: rule mapping, the single document
 * / runtime selectors, Drawer filtering + count isolation, the empty state under
 * a runtime FAIL, and the two refresh-isolation contracts.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  __resetRuntimeIntegrityForTests,
  countDocumentSeverities,
  evaluateRuntimeIntegrityV1,
  isRuntimeDomain,
  recheckDocumentDomain,
  refreshRuntimeIntegrity,
  refreshRuntimeDomain,
  runtimeIntegrityFindingsFromIdentity,
  selectDocumentDiagnostics,
  selectRuntimeDiagnostics,
  toRuntimeDiagnostic,
  type DiagnosticsDomainStores,
  type RuntimeDiagnostic,
} from './diagnostic-domain-v1'
import {
  DOCUMENT_DIAGNOSTIC_RULE_DOMAINS,
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  resolveDiagnosticDomain,
} from './document-diagnostic-location'
import {
  computeDocumentDiagnostics,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'

const OVERLAY_HOST = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'),
  'utf8',
)

// ── fixture helpers ─────────────────────────────────────────────────────────

interface HeadingSpec { level: number; text?: string; line?: number | null; identity?: string | null }

function inputOf(markdown: string, headings: readonly HeadingSpec[] = []): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => {
    const text = h.text ?? `H${h.level}`
    const el = document.createElement(`h${h.level}`)
    const line = h.line === undefined ? i * 2 : h.line
    if (line != null) el.setAttribute('data-line', String(line))
    el.textContent = text
    return {
      level: h.level,
      text,
      stableIdentity: h.identity === null ? undefined : (h.identity ?? `H:${i}`),
      element: el,
    }
  })
  return {
    documentKey: 'doc:domain-v1',
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
  }
}

/** A minimal DOCUMENT-domain diagnostic (the domain filter is what is under test). */
function docDiag(severity: 'error' | 'warning' | 'info', code: string): DocumentDiagnostic {
  return {
    id: `heading:${code}:${severity}`,
    documentKey: 'doc:domain-v1',
    domain: 'document',
    severity,
    category: 'heading',
    code,
    message: code,
  }
}

function runtimeFail(code = 'RUNTIME_ACTIVE_WITH_ZERO_FILL'): RuntimeDiagnostic {
  return toRuntimeDiagnostic({ code, status: 'FAIL', message: 'active 但 fillCount=0', source: 'test' }, 1)
}

beforeEach(() => {
  __resetRuntimeIntegrityForTests()
})

// ── §24 — every existing document rule is domain=document ───────────────────

describe('V1 §24 — existing document rules carry domain=document', () => {
  it('resolves document for EVERY registered rule code (DOCUMENT_RULE_WITHOUT_DOMAIN_COUNT=0)', () => {
    const codes = Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
    expect(codes.length).toBeGreaterThan(20)
    const withoutDomain = codes.filter(code => resolveDiagnosticDomain(code) == null)
    expect(withoutDomain).toEqual([])
    for (const code of codes) expect(resolveDiagnosticDomain(code)).toBe('document')
    // the explicit code → domain map covers the registry 1:1
    expect(Object.keys(DOCUMENT_DIAGNOSTIC_RULE_DOMAINS).sort()).toEqual(codes.slice().sort())
    for (const code of codes) expect(DOCUMENT_DIAGNOSTIC_RULE_DOMAINS[code]).toBe('document')
  })

  it('resolves the prefix-derived rules too (latent ATX / strict first-H1)', () => {
    expect(resolveDiagnosticDomain('LATENT_ATX_HEADING_MARKER_LEVEL_2')).toBe('document')
    expect(resolveDiagnosticDomain('STRICT_FIRST_H1_POSITION')).toBe('document')
    // an UNREGISTERED code has NO domain (a new rule must register one)
    expect(resolveDiagnosticDomain('SECTION_EMPTY')).toBeNull()
  })

  it('the real producer stamps domain=document on every emitted diagnostic', () => {
    const out = computeDocumentDiagnostics(inputOf('# A\n\n## H2\n\n# B\n', [
      { level: 1, line: 0 }, { level: 2, line: 2 }, { level: 1, line: 4 },
    ]))
    expect(out.diagnostics.length).toBeGreaterThan(0)
    for (const d of out.diagnostics) expect(d.domain).toBe('document')
    expect(selectRuntimeDiagnostics(out.diagnostics)).toEqual([])
  })
})

// ── §25 — Drawer filter (document only) ────────────────────────────────────

describe('V1 §25/§26 — Drawer filter + count isolation', () => {
  it('a mixed domain set renders/counts ONLY the document domain', () => {
    const error = [docDiag('error', 'DOC_ERR_1')]
    const warning = [docDiag('warning', 'DOC_WARN_1')]
    const hint = [docDiag('info', 'DOC_HINT_1')]

    const mixed: Array<DocumentDiagnostic | RuntimeDiagnostic> = [
      ...error, ...warning, ...hint, runtimeFail(),
    ]
    const document = selectDocumentDiagnostics(mixed) as DocumentDiagnostic[]
    const runtime = selectRuntimeDiagnostics(mixed)

    expect(document.length).toBe(error.length + warning.length + hint.length)
    expect(runtime.length).toBe(1)
    // "全部" = document only; the runtime FAIL never appears
    expect(document.some(d => isRuntimeDomain(d))).toBe(false)

    const counts = countDocumentSeverities(document)
    expect(counts.error).toBe(error.length)
    expect(counts.warning).toBe(warning.length)
    expect(counts.info).toBe(hint.length)
    expect(counts.total).toBe(document.length)
  })

  it('§26 — 100 runtime FAILs do not change the document counts', () => {
    const document = [
      docDiag('error', 'DOC_ERR_1'), docDiag('warning', 'DOC_WARN_1'), docDiag('info', 'DOC_HINT_1'),
    ]
    const base = countDocumentSeverities(selectDocumentDiagnostics(document))
    const manyRuntime: RuntimeDiagnostic[] = []
    for (let i = 0; i < 100; i++) manyRuntime.push(runtimeFail(`RUNTIME_FAIL_${i}`))
    const mixed = [...document, ...manyRuntime]
    const after = countDocumentSeverities(selectDocumentDiagnostics(mixed) as DocumentDiagnostic[])
    expect(after).toEqual(base)
    expect(selectRuntimeDiagnostics(mixed).length).toBe(100)
  })
})

// ── §27 — empty state isolation ────────────────────────────────────────────

describe('V1 §27 / §16 — document empty state is independent of a runtime FAIL', () => {
  it('document=[] + runtime=[FAIL] ⇒ Drawer empty state true AND runtime report FAIL', () => {
    const stores: DiagnosticsDomainStores<DocumentDiagnostic> = { document: [], runtime: [] }
    const next = refreshRuntimeDomain(stores, [{ code: 'RUNTIME_DOM_MISMATCH', status: 'FAIL', message: 'DOM/Store mismatch' }], 1)

    // the Drawer's data source (document selection) is still EMPTY ⇒ 未发现问题
    expect(selectDocumentDiagnostics(next.document)).toEqual([])
    expect(countDocumentSeverities(selectDocumentDiagnostics(next.document)).total).toBe(0)

    const report = evaluateRuntimeIntegrityV1()
    expect(report.decision).toBe('FAIL')
    expect(report.failCount).toBe(1)
  })
})

// ── §28 / §17 / §18 — refresh isolation ────────────────────────────────────

describe('V1 §28/§17/§18 — document recheck and runtime refresh are isolated', () => {
  it('§17 recheckDocumentDomain recomputes document and keeps runtime UNCHANGED', () => {
    const stores: DiagnosticsDomainStores<DocumentDiagnostic> = {
      document: [docDiag('error', 'DOC_ERR_1')],
      runtime: [runtimeFail()],
    }
    const runtimeBefore = stores.runtime
    const next = recheckDocumentDomain(stores, [docDiag('info', 'DOC_HINT_1')])

    expect(next.document.map(d => d.code)).toEqual(['DOC_HINT_1'])
    // DOCUMENT_REFRESH_CLEARS_RUNTIME_COUNT = 0
    expect(next.runtime).toBe(runtimeBefore)
    expect(next.runtime.length).toBe(1)
  })

  it('§18 refreshRuntimeDomain recomputes runtime and keeps document UNCHANGED', () => {
    const document = [docDiag('warning', 'DOC_WARN_1')]
    const stores: DiagnosticsDomainStores<DocumentDiagnostic> = { document, runtime: [] }
    const next = refreshRuntimeDomain(stores, [{ code: 'RUNTIME_SHA_MISMATCH', status: 'FAIL', message: 'sha mismatch' }], 2)

    // RUNTIME_REFRESH_CLEARS_DOCUMENT_COUNT = 0
    expect(next.document).toBe(document)
    expect(selectDocumentDiagnostics(next.document).length).toBe(document.length)
    expect(next.runtime.length).toBe(1)
    expect(evaluateRuntimeIntegrityV1().decision).toBe('FAIL')
  })

  it('a document-only refresh never mutates the runtime registry', () => {
    refreshRuntimeIntegrity([{ code: 'RUNTIME_X', status: 'DEGRADED', message: 'x' }], 3)
    const before = evaluateRuntimeIntegrityV1()
    // simulate a manual document recheck: it only recomputes the document side
    const stores: DiagnosticsDomainStores<DocumentDiagnostic> = { document: [], runtime: before.diagnostics }
    recheckDocumentDomain(stores, [docDiag('info', 'DOC_HINT_1')])
    const after = evaluateRuntimeIntegrityV1()
    expect(after).toEqual(before)
  })
})

// ── §6/§37 — the runtime-identity adapter ─────────────────────────────────

describe('V1 §6/§37 — runtime identity is a runtime-domain concern', () => {
  it('a SHA mismatch / missing artifact becomes a runtime FAIL (never a document problem)', () => {
    const findings = runtimeIntegrityFindingsFromIdentity({
      pluginMainExists: true,
      pluginMainSha256: 'AAA',
      projectMainExists: true,
      projectMainSha256: 'BBB',
      shaMatch: false,
      buildId: 'b1',
      initializationCount: 1,
    })
    expect(findings.map(f => f.code)).toContain('RUNTIME_IDENTITY_SHA_MISMATCH')
    for (const f of findings) {
      const diag = toRuntimeDiagnostic(f, 1)
      expect(diag.domain).toBe('runtime')
      expect(diag.status).toBe('FAIL')
      // a runtime diagnostic has NO document presentation surface
      expect((diag as unknown as { location?: unknown }).location).toBeUndefined()
      expect((diag as unknown as { severity?: unknown }).severity).toBeUndefined()
    }
  })

  it('a healthy identity produces NO runtime findings (report PASS)', () => {
    const findings = runtimeIntegrityFindingsFromIdentity({
      pluginMainExists: true, shaMatch: true, projectMainExists: true,
    })
    expect(findings).toEqual([])
    const report = refreshRuntimeIntegrity(findings, 1)
    expect(report.decision).toBe('PASS')
    expect(report.total).toBe(0)
  })

  it('a missing deployed artifact is a runtime FAIL', () => {
    const findings = runtimeIntegrityFindingsFromIdentity({ pluginMainExists: false, shaMatch: null })
    expect(findings.map(f => f.code)).toContain('RUNTIME_PLUGIN_ARTIFACT_MISSING')
  })
})

// ── §19/§20/§9 — no duplicate domain implementation ────────────────────────

describe('V1 §9/§19/§20 — single selector authority, no duplicate filter', () => {
  it('the Drawer reads the document selection through ONE authority', () => {
    expect(OVERLAY_HOST).toContain('private documentDiagnostics(')
    expect(OVERLAY_HOST).toContain('selectDocumentDiagnostics(this.snapshot?.diagnostics ?? [])')
    expect(OVERLAY_HOST).toContain('countDocumentSeverities(this.documentDiagnostics())')
    expect(OVERLAY_HOST).toContain('flattenDiagnosticsToProjections(diagnostics, this.buildDocumentPositionContext())')
  })

  it('no component hand-writes a runtime black/white list (§9)', () => {
    expect(OVERLAY_HOST).not.toMatch(/domain\s*===?\s*['"]runtime['"]/)
    expect(OVERLAY_HOST).not.toMatch(/domain\s*!==?\s*['"]document['"]/)
  })

  it('§19 — a runtime diagnostic carries no body active-state surface', () => {
    const diag = runtimeFail()
    for (const key of ['location', 'locator', 'severity', 'category', 'validityFingerprint', 'nonLocatableNotice']) {
      expect((diag as unknown as Record<string, unknown>)[key]).toBeUndefined()
    }
  })
})

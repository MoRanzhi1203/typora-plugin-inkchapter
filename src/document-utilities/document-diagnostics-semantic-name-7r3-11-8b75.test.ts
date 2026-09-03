// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.5 — Semantic Name Authority Closure.
 *
 * "type + number" (图/表/代码 1.1-1) is NEVER a semantic name — only the text
 * AFTER the number counts (figure → Markdown alt; table/code → caption
 * registry title). Locks the §5 matrix at the pure-compute level and the
 * provider→authority contract with DYNAMIC add/remove refresh.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'

function baseInput(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:key',
    markdown: '# 标题\n\n正文\n\n',
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    h1Facts: [],
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...overrides,
  }
}

function h1Authority(): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY', reason: 'READY', documentKey: 'doc:key', framePresent: true,
    frameDocumentKey: 'doc:key', semanticRevision: 1, frameGeneration: 1,
    canonicalEntryCount: 0, mappedEntryCount: 0, invalidEntryCount: 0,
    physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

const el = (): HTMLElement => document.createElement('div')

function hasCode(diags: readonly { code: string }[], code: string): boolean {
  return diags.some(d => d.code === code)
}

describe('MATRIX — pure compute: hasSemanticName decides the missing-name diagnostic', () => {
  it('FIGURE_WITH_NAME_NO_WARNING: 图 1.1-1 boundary b figure → name present → NO FIGURE_MISSING_NAME', () => {
    const r = computeDocumentDiagnostics(baseInput({
      figures: [{ name: 'boundary b figure', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'FIGURE_MISSING_NAME')).toBe(false)
  })

  it('FIGURE_NUMBER_ONLY_WARNING: 图 1.1-2 (type+number only) → name empty → warning', () => {
    const r = computeDocumentDiagnostics(baseInput({
      figures: [{ name: '', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'FIGURE_MISSING_NAME')).toBe(true)
  })

  it('TABLE_WITH_NAME_NO_WARNING: 表 1.1-1 实验结果 → NO TABLE_MISSING_NAME', () => {
    const r = computeDocumentDiagnostics(baseInput({
      tables: [{ name: '实验结果', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'TABLE_MISSING_NAME')).toBe(false)
  })

  it('TABLE_NUMBER_ONLY_WARNING: 表 1.1-2 → empty → warning', () => {
    const r = computeDocumentDiagnostics(baseInput({
      tables: [{ name: '', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'TABLE_MISSING_NAME')).toBe(true)
  })

  it('CODE_WITH_NAME_NO_WARNING: 代码 1.1-1 边界测试 → NO CODE_MISSING_NAME', () => {
    const r = computeDocumentDiagnostics(baseInput({
      codes: [{ name: '边界测试', language: 'python', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'CODE_MISSING_NAME')).toBe(false)
  })

  it('CODE_NUMBER_ONLY_WARNING: 代码 1.1-2 → empty → warning', () => {
    const r = computeDocumentDiagnostics(baseInput({
      codes: [{ name: '', language: 'python', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'CODE_MISSING_NAME')).toBe(true)
  })

  it('TYPE_NUMBER_NOT_NAME: number-only (alt/title empty) ⇒ hasSemanticName=false ⇒ warning (authority contract)', () => {
    // A number-only caption (`图 1.1-1` with empty alt / registry title)
    // resolves to an EMPTY semantic name → the missing-name warning stands.
    // The production name feed (CaptionService.getSemanticNameForElement)
    // never emits the "type + number" prefix — it returns ONLY alt/title text.
    const r = computeDocumentDiagnostics(baseInput({
      figures: [{ name: '', element: el() }],
      tables: [{ name: '', element: el() }],
      codes: [{ name: '', language: 'python', element: el() }],
    }))
    expect(hasCode(r.diagnostics, 'FIGURE_MISSING_NAME')).toBe(true)
    expect(hasCode(r.diagnostics, 'TABLE_MISSING_NAME')).toBe(true)
    expect(hasCode(r.diagnostics, 'CODE_MISSING_NAME')).toBe(true)
  })
})

// ── Authority contract: providers feed the unified semantic-name authority ──
describe('AUTHORITY — provider(name) drives the diagnostic; dynamic add/remove refresh', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  function mountDom(): { img: HTMLElement; table: HTMLElement; fence: HTMLElement } {
    const write = document.createElement('div')
    write.id = 'write'
    const img = document.createElement('img')
    img.setAttribute('alt', '')
    const table = document.createElement('table')
    const fence = document.createElement('pre')
    fence.className = 'md-fences'
    write.append(img, table, fence)
    document.body.appendChild(write)
    return { img, table, fence }
  }

  function makeCtx(): DocumentUtilitiesContext {
    return {
      authority: {
        getActiveFilePath: () => '/vault/doc.md',
        getDocumentKey: () => 'doc:key',
        getMarkdown: () => '# 标题\n\n正文\n\n',
        isStrictMode: () => true,
        vaultRoot: '/vault',
        getCanonicalDuplicateIdentities: () => [],
        getCaptionDuplicateNames: () => [],
      },
      hasActiveDocument: () => true,
    }
  }

  function makeProviders(names: { figure: string | null; table: string | null; code: string | null }): DocumentDiagnosticsProviders {
    return {
      getFormulaVisibleTagTokens: () => [],
      getFigureName: () => names.figure,
      getTableName: () => names.table,
      getCodeName: () => names.code,
      getCodeLanguage: () => 'python',
      resolveImageLocalPath: () => ({ localPath: null }),
      isLinkTargetMissing: () => false,
      getHeadingIdentity: () => null,
      parseLocalLinkTargets: () => [],
      getCanonicalH1Facts: () => h1Authority(),
    }
  }

  function publishOnce(names: { figure: string | null; table: string | null; code: string | null }): string {
    mountDom()
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), makeProviders(names))
    let lastCodes = ''
    const dispose = authority.subscribe(s => { lastCodes = codes(s) })
    authority.recompute('TEST')
    dispose()
    return lastCodes
  }

  function codes(s: { diagnostics: readonly { code: string }[] } | null): string {
    if (!s) return ''
    return s.diagnostics.map(d => d.code).filter(c => c.includes('MISSING_NAME')).sort().join(',')
  }

  it('DYNAMIC_ADD_NAME_REFRESH: 表/代码/图 missing → name added → recompute → warnings removed', () => {
    mountDom()
    const providers = makeProviders({ figure: '', table: '', code: '' })
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), providers)
    const published: string[] = []
    const dispose = authority.subscribe(s => { published.push(codes(s)) })
    authority.recompute('TEST')
    expect(published[published.length - 1]).toContain('FIGURE_MISSING_NAME')
    expect(published[published.length - 1]).toContain('TABLE_MISSING_NAME')
    expect(published[published.length - 1]).toContain('CODE_MISSING_NAME')
    // Caption authority now reports names (figure alt / registry title set).
    providers.getFigureName = () => 'boundary b figure'
    providers.getTableName = () => '实验结果'
    providers.getCodeName = () => '边界测试'
    authority.recompute('OBJECT_SEMANTIC_NAME_CHANGED')
    const last = published[published.length - 1]
    expect(last).not.toContain('FIGURE_MISSING_NAME')
    expect(last).not.toContain('TABLE_MISSING_NAME')
    expect(last).not.toContain('CODE_MISSING_NAME')
    dispose()
  })

  it('DYNAMIC_REMOVE_NAME_REFRESH: named figure → name removed (number-only caption) → recompute → warning appears', () => {
    mountDom()
    const providers = makeProviders({ figure: 'boundary b figure', table: '', code: '' })
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), providers)
    const published: string[] = []
    const dispose = authority.subscribe(s => { published.push(codes(s)) })
    authority.recompute('TEST')
    expect(published[published.length - 1]).not.toContain('FIGURE_MISSING_NAME')
    providers.getFigureName = () => '' // 图 1.1-1 number-only now
    authority.recompute('OBJECT_SEMANTIC_NAME_CHANGED')
    expect(published[published.length - 1]).toContain('FIGURE_MISSING_NAME')
    dispose()
  })

  it('AUTHORITY identity alignment: identical semantic state re-compute does NOT re-publish (no stale churn)', () => {
    mountDom()
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), makeProviders({ figure: 'boundary b figure', table: '', code: '' }))
    let count = 0
    const dispose = authority.subscribe(() => { count++ })
    authority.recompute('TEST') // initial publish (subscribe already fires once)
    const afterInitial = count
    authority.recompute('NOOP') // identical → fingerprint gate blocks
    authority.recompute('NOOP')
    expect(count).toBe(afterInitial)
    dispose()
  })
})

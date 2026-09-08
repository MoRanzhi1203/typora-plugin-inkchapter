// @vitest-environment jsdom
/**
 * V4 — Problems Projection / Presentation Restore targeted tests.
 *  PROJECTION-*            single projection derivation (strict severity mapping)
 *  PRESENTATION-RESTORE-*  EMPTY→ACTIVE replays projection (no new event)
 *  TOOLBAR-RENDER / FIRST-OPEN-PROJECTION / RESPONSIVE-PROJECTION
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { deriveDocumentProblemsProjection } from './document-problems-projection'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

function stubSnapshot(diagnostics: Array<{ severity: string; code: string }>): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'README.md',
    revision: 1,
    sourceRevision: 1,
    diagnostics,
    errorCount: 0,
    warningCount: 0,
    hintCount: 0,
    infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
}

interface Model { file: string | null; key: string | null; leafKnown: boolean; leafPath: string | null }

function makeCtx(model: Model): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: model.leafKnown, leafPath: model.leafPath }),
      getActiveFilePath: () => model.file,
      getDocumentKey: () => model.key,
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => false,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => model.file != null && model.key != null,
  }
}

function fakeProviders(): DocumentDiagnosticsProviders {
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
  }
}

const hosts: DocumentUtilityOverlayHost[] = []

afterEach(() => {
  for (const h of hosts) h.dispose()
  hosts.length = 0
  vi.restoreAllMocks()
})

function mount(model: Partial<Model> = {}): { h: DocumentUtilityOverlayHost; model: Model } {
  const m: Model = { file: 'README.md', key: 'README.md', leafKnown: true, leafPath: 'README.md', ...model }
  let transition: ((r: 'ACTIVE_LEAF_CHANGE' | 'TAB_TOGGLE') => void) | null = null
  const h = new DocumentUtilityOverlayHost({
    ctx: makeCtx(m),
    providers: fakeProviders(),
    onBindDocument: (bind) => void bind,
    onActiveLeafLifecycle: (cb) => { transition = cb; return () => { transition = null } },
    onDiagnosticsTrigger: () => () => undefined,
  })
  h.mount()
  hosts.push(h)
  return { h, model: m }
}

function problemsControl(): HTMLElement | null {
  return document.querySelector('.inkchapter-problems-control')
}

describe('PROJECTION — single derivation, strict severity mapping', () => {
  it('PROJECTION-1 error/warning/hint map strictly to counts', () => {
    const p = deriveDocumentProblemsProjection(stubSnapshot([
      { severity: 'error', code: 'e1' },
      { severity: 'error', code: 'e2' },
      { severity: 'warning', code: 'w1' },
      { severity: 'hint', code: 'h1' },
      { severity: 'info', code: 'i1' },
    ]))
    expect(p.errorCount).toBe(2)
    expect(p.warningCount).toBe(1)
    expect(p.hintCount).toBe(2)
    expect(p.totalCount).toBe(5)
  })

  it('PROJECTION-2 unknown severity is skipped, never defaulted to error', () => {
    const p = deriveDocumentProblemsProjection(stubSnapshot([
      { severity: 'error', code: 'e1' },
      { severity: 'banana', code: 'x1' },
      { severity: 'banana', code: 'x2' },
    ]))
    expect(p.errorCount).toBe(1)
    expect(p.warningCount).toBe(0)
    expect(p.totalCount).toBe(1)
  })

  it('PROJECTION-3/4 null snapshot → empty projection, not healthy', () => {
    const p = deriveDocumentProblemsProjection(null)
    expect(p.hasProjection).toBe(false)
    expect(p.totalCount).toBe(0)
    expect(p.documentKey).toBeNull()
  })

  it('PROJECTION-5 identity/revision carried', () => {
    const p = deriveDocumentProblemsProjection(stubSnapshot([{ severity: 'warning', code: 'w' }]))
    expect(p.documentKey).toBe('README.md')
    expect(p.revision).toBe(1)
  })
})

describe('PRESENTATION-RESTORE / FIRST-OPEN-PROJECTION — EMPTY→ACTIVE replay', () => {
  it('FIRST-OPEN-PROJECTION mount ACTIVE → projection store == snapshot, control rendered', () => {
    const { h } = mount()
    const snap = h.getSnapshot()
    expect(snap).not.toBeNull()
    const proj = h.getCurrentProblemsProjection()
    expect(proj.hasProjection).toBe(true)
    expect(proj.documentKey).toBe('README.md')
    // '# 标题\n\n正文' → 1 warning (missing terminal newline), 0 errors.
    expect(proj.errorCount).toBe(0)
    expect(proj.warningCount).toBeGreaterThan(0)
    expect(proj.warningCount).toBe(h.getSnapshot()!.warningCount)
    const seg = problemsControl()!.querySelector('.inkchapter-toolbar-segment--warning')
    expect(seg).toBeTruthy()
    expect(seg!.getAttribute('aria-label')).toContain(`警告 ${proj.warningCount}`)
  })

  it('PRESENTATION-RESTORE ACTIVE→EMPTY keeps projection store (not cleared)', () => {
    const { h, model } = mount()
    expect(h.getCurrentProblemsProjection().warningCount).toBeGreaterThan(0)
    model.leafPath = ''
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED') // → EMPTY suppress
    expect(h.getCurrentProblemsProjection().hasProjection).toBe(true)
    expect(h.getCurrentProblemsProjection().warningCount).toBeGreaterThan(0)
    expect(problemsControl()!.childElementCount).toBe(0)
  })

  it('PRESENTATION-RESTORE EMPTY→ACTIVE auto replays counts without a new diagnostics event', () => {
    const { h, model } = mount()
    const warnBefore = h.getCurrentProblemsProjection().warningCount
    model.leafPath = ''
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED') // EMPTY
    expect(problemsControl()!.childElementCount).toBe(0)
    model.leafPath = 'README.md'
    // re-activate; reconcile republishes (same snapshot NOOP) so presentation
    // restore itself must replay the projection from the store.
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const toolbar = document.querySelector('.inkchapter-doc-toolbar') as HTMLElement
    expect(toolbar.hidden).toBe(false)
    const seg = problemsControl()!.querySelector('.inkchapter-toolbar-segment--warning')
    expect(seg).toBeTruthy()
    expect(seg!.getAttribute('aria-label')).toContain(`警告 ${warnBefore}`)
    expect(h.getCurrentProblemsProjection().warningCount).toBe(warnBefore)
  })

  it('TOOLBAR-RENDER Problems Control + Edit/Lock refresh together on replay', () => {
    const { h, model } = mount()
    model.leafPath = ''
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    model.leafPath = 'README.md'
    h.reconcileActiveDocument('ACTIVE_TAB_CHANGED')
    const lock = document.querySelector('.inkchapter-editlock') as HTMLElement
    expect(lock).toBeTruthy()
    const seg = problemsControl()!.querySelector('.inkchapter-toolbar-segment--warning')
    expect(seg).toBeTruthy()
  })
})

describe('RESPONSIVE-PROJECTION — suppressed→full/compact replay hook', () => {
  it('suppressed→full transitions replay while projection store is preserved', () => {
    const { h, model } = mount()
    const proj = h.getCurrentProblemsProjection()
    model.leafPath = ''
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED') // suppressed
    expect(problemsControl()!.childElementCount).toBe(0)
    model.leafPath = 'README.md'
    h.reconcileActiveDocument('INITIAL_ACTIVE_DOCUMENT') // → full (headless width null → full)
    const toolbar = document.querySelector('.inkchapter-doc-toolbar') as HTMLElement
    expect(toolbar.dataset.presentation).toBe('full')
    expect(problemsControl()!.childElementCount).toBeGreaterThan(0)
    expect(h.getCurrentProblemsProjection().warningCount).toBe(proj.warningCount)
  })
})

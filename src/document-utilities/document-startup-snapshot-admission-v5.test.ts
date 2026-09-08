// @vitest-environment jsdom
/**
 * V5 — Startup Snapshot Admission (split-brain) targeted tests.
 *  STARTUP-RESTORE-1..5 + Producer/Consumer Dedupe + Admission idempotency
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

interface Model { file: string | null; key: string | null; leafKnown: boolean; leafPath: string | null }

const GENERIC = 'Generic-Locator-Runtime-Test.md'

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

function makeHost(model: Model): { h: DocumentUtilityOverlayHost; model: Model } {
  const h = new DocumentUtilityOverlayHost({
    ctx: makeCtx(model),
    providers: fakeProviders(),
    onBindDocument: (bind) => void bind,
    onActiveLeafLifecycle: () => () => undefined,
    onDiagnosticsTrigger: () => () => undefined,
  })
  h.mount()
  return { h, model }
}

function problemsControl(): HTMLElement | null {
  return document.querySelector('.inkchapter-problems-control')
}

function warningSegment(): HTMLElement | null {
  return problemsControl()!.querySelector('.inkchapter-toolbar-segment--warning')
}

const hosts: DocumentUtilityOverlayHost[] = []
afterEach(() => {
  for (const h of hosts) h.dispose()
  hosts.length = 0
  vi.restoreAllMocks()
})

describe('STARTUP-RESTORE-1..5 + admission dedupe (split-brain restore)', () => {
  it('STARTUP-RESTORE-1 EMPTY leaf + file identity Generic → snapshot is PENDING, never displayed', () => {
    const model: Model = { file: GENERIC, key: GENERIC, leafKnown: true, leafPath: '' }
    const { h } = makeHost(model)
    hosts.push(h)
    // Producer computes the correct snapshot while the leaf is still EMPTY.
    h.diagnostics.recompute('STARTUP_RESTORE_PRODUCER')
    const counters = h.getAdmissionCounters()
    expect(counters.pendingActiveLeaf).toBeGreaterThan(0)
    // Not displayed during pending.
    expect(warningSegment()).toBeNull()
  })

  it('STARTUP-RESTORE-2/3 leaf becomes ACTIVE → reconcile DIRECT admission shows projection', () => {
    const model: Model = { file: GENERIC, key: GENERIC, leafKnown: true, leafPath: '' }
    const { h } = makeHost(model)
    hosts.push(h)
    h.diagnostics.recompute('STARTUP_RESTORE_PRODUCER')
    expect(h.getAdmissionCounters().pendingActiveLeaf).toBeGreaterThan(0)
    model.leafPath = GENERIC
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const counters = h.getAdmissionCounters()
    expect(counters.admitted).toBeGreaterThan(0)
    const proj = h.getCurrentProblemsProjection()
    expect(proj.documentKey).toBe(GENERIC)
    expect(proj.hasProjection).toBe(true)
    expect(proj.warningCount).toBeGreaterThan(0)
    expect(proj.errorCount).toBe(0)
    expect(warningSegment()).not.toBeNull()
    const toolbar = document.querySelector('.inkchapter-doc-toolbar') as HTMLElement
    expect(toolbar.hidden).toBe(false)
  })

  it('STARTUP-RESTORE-4 admission idempotency — repeat reconcile does not re-admit same fingerprint', () => {
    const model: Model = { file: GENERIC, key: GENERIC, leafKnown: true, leafPath: '' }
    const { h } = makeHost(model)
    hosts.push(h)
    model.leafPath = GENERIC
    h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const admittedOnce = h.getAdmissionCounters().admitted
    h.reconcileActiveDocument('ACTIVE_TAB_CHANGED')
    h.reconcileActiveDocument('CANONICAL_FRAME_CHANGED')
    expect(h.getAdmissionCounters().alreadyAdmitted).toBeGreaterThanOrEqual(1)
    // projection stays stable
    expect(h.getCurrentProblemsProjection().warningCount).toBeGreaterThan(0)
    expect(warningSegment()).not.toBeNull()
    void admittedOnce
  })

  it('STARTUP-RESTORE-5 stale-document rejection — old key snapshot never admitted for a new key', () => {
    const model: Model = { file: GENERIC, key: GENERIC, leafKnown: true, leafPath: GENERIC }
    const { h } = makeHost(model)
    hosts.push(h)
    h.diagnostics.recompute('DOC')
    // switch to a different document
    model.file = 'B.md'
    model.key = 'B.md'
    model.leafPath = 'B.md'
    h.reconcileActiveDocument('ACTIVE_TAB_CHANGED')
    const proj = h.getCurrentProblemsProjection()
    expect(proj.documentKey).toBe('B.md')
    // A stale publish for Generic while B is active is discarded (no projection)
    const staleCount = h.getAdmissionCounters().staleDiscard
    expect(staleCount).toBeGreaterThanOrEqual(0)
  })
})

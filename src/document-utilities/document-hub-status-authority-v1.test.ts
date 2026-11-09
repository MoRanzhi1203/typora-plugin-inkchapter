// @vitest-environment jsdom
/**
 * V5.2 STATUS-AUTHORITY — the square color and the visible diagnostic list must
 * derive from ONE admitted snapshot / ONE document-domain projection.
 *
 * Regression: `01-中文学术论文模板.md` showed "1 项警告：表格缺少表名" while the
 * square stayed GRAY because an unverified (incremental-mirror) snapshot was
 * allowed to win the GRAY branch over a KNOWN warning. The matrix below freezes
 * the corrected priority and the document-identity guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

let activeKey = 'doc:a'
let activePath = '/vault/a.md'

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => activePath,
      getDocumentKey: () => activeKey,
      getMarkdown: () => '# A\n\nbody',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
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

type Severity = 'error' | 'warning' | 'info'

function diagnostic(id: string, severity: Severity): DocumentDiagnosticsSnapshot['diagnostics'][number] {
  return {
    id,
    severity,
    code: 'TABLE_MISSING_NAME',
    message: severity === 'warning' ? '表格缺少表名' : `问题 ${id}`,
    category: 'document',
    domain: 'document',
    stableIdentity: id,
    targetIdentity: id,
    metadata: {},
    location: null,
  } as unknown as DocumentDiagnosticsSnapshot['diagnostics'][number]
}

function snapshotFor(
  key: string,
  severity: Severity,
  count: number,
  structuralVerified = true,
): DocumentDiagnosticsSnapshot {
  const diagnostics = Array.from({ length: count }, (_, index) => diagnostic(`${key}:${severity}:${index}`, severity))
  return {
    documentKey: key,
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics,
    errorCount: severity === 'error' ? count : 0,
    warningCount: severity === 'warning' ? count : 0,
    infoCount: severity === 'info' ? count : 0,
    structuralVerified,
  } as unknown as DocumentDiagnosticsSnapshot
}

function mountHost(): DocumentUtilityOverlayHost {
  const host = new DocumentUtilityOverlayHost({
    ctx: fakeContext(),
    providers: fakeProviders(),
    onBindDocument: () => {},
  })
  host.mount()
  return host
}

function inject(host: DocumentUtilityOverlayHost, snapshot: DocumentDiagnosticsSnapshot): void {
  ;(host as unknown as { snapshot: DocumentDiagnosticsSnapshot | null }).snapshot = snapshot
  ;(host as unknown as { refreshDocumentHub: () => void }).refreshDocumentHub()
}

function statusEl(): HTMLElement {
  return document.querySelector('.inkchapter-doc-status') as HTMLElement
}

function square(): HTMLElement {
  return document.querySelector('.inkchapter-doc-status__square') as HTMLElement
}

function openHub(host: DocumentUtilityOverlayHost): void {
  ;(host as unknown as { documentHub: { open: () => void } }).documentHub.open()
}

beforeEach(() => {
  document.body.innerHTML = ''
  activeKey = 'doc:a'
  activePath = '/vault/a.md'
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

describe('V5.2 hub status authority', () => {
  it('unverified snapshot with one warning paints YELLOW and the list shows the same count', () => {
    const host = mountHost()
    inject(host, snapshotFor('doc:a', 'warning', 1, false))
    expect(statusEl().dataset['status']).toBe('YELLOW')
    expect(statusEl().dataset['warningCount']).toBe('1')
    expect(square().style.backgroundColor).toBe('rgb(212, 147, 32)')
    openHub(host)
    const rows = document.querySelectorAll('.inkchapter-doc-expand__diag')
    expect(rows).toHaveLength(1)
    expect(document.querySelector('.inkchapter-doc-expand__summary')?.textContent).toContain('1 项警告')
  })

  it('freezes the severity matrix: error > warning > hint > green, unknown gray', () => {
    const host = mountHost()
    inject(host, snapshotFor('doc:a', 'error', 2, false))
    expect(statusEl().dataset['status']).toBe('RED')
    expect(square().style.backgroundColor).toBe('rgb(213, 80, 80)')

    inject(host, snapshotFor('doc:a', 'warning', 2, false))
    expect(statusEl().dataset['status']).toBe('YELLOW')
    expect(statusEl().dataset['warningCount']).toBe('2')
    expect(square().style.backgroundColor).toBe('rgb(212, 147, 32)')

    inject(host, snapshotFor('doc:a', 'info', 3, false))
    expect(statusEl().dataset['status']).toBe('HINT')
    expect(square().style.backgroundColor).toBe('rgb(99, 127, 150)')

    inject(host, snapshotFor('doc:a', 'warning', 0, true))
    expect(statusEl().dataset['status']).toBe('GREEN')
    expect(square().style.backgroundColor).toBe('rgb(46, 152, 105)')

    inject(host, snapshotFor('doc:a', 'warning', 0, false))
    expect(statusEl().dataset['status']).toBe('GRAY')
    expect(square().style.backgroundColor).toBe('rgb(137, 145, 155)')
  })

  it('keeps the lock outline independent from the severity color', () => {
    const host = mountHost()
    inject(host, snapshotFor('doc:a', 'warning', 1, false))
    const lockState = (host as unknown as { lockState: Map<string, boolean> }).lockState
    lockState.set('doc:a', true)
    ;(host as unknown as { refreshDocumentHub: () => void }).refreshDocumentHub()
    expect(statusEl().dataset['status']).toBe('YELLOW')
    expect(statusEl().dataset['locked']).toBe('1')
    expect(square().style.backgroundColor).toBe('rgb(212, 147, 32)')
    const frame = document.querySelector('.inkchapter-doc-status__lock-frame') as HTMLElement
    expect(frame.style.borderColor.toLowerCase()).toBe('currentcolor')
  })

  it('rapid A -> B -> A switches never reuse the previous document color or list', () => {
    const host = mountHost()
    inject(host, snapshotFor('doc:a', 'warning', 2, true))
    expect(statusEl().dataset['status']).toBe('YELLOW')
    openHub(host)
    expect(document.querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(2)

    activeKey = 'doc:b'
    activePath = '/vault/b.md'
    inject(host, snapshotFor('doc:b', 'error', 1, true))
    expect(statusEl().dataset['status']).toBe('RED')
    expect(statusEl().dataset['errorCount']).toBe('1')
    ;(host as unknown as { documentHub: { renderPanel: () => void } }).documentHub.renderPanel()
    expect(document.querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(1)

    // A stale snapshot from A while B is active must never paint B.
    inject(host, snapshotFor('doc:a', 'warning', 2, true))
    expect(statusEl().dataset['status']).toBe('GRAY')
    expect(statusEl().dataset['warningCount']).toBe('0')
    ;(host as unknown as { documentHub: { renderPanel: () => void } }).documentHub.renderPanel()
    expect(document.querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(0)

    activeKey = 'doc:a'
    activePath = '/vault/a.md'
    inject(host, snapshotFor('doc:a', 'warning', 2, true))
    expect(statusEl().dataset['status']).toBe('YELLOW')
    expect(statusEl().dataset['warningCount']).toBe('2')
    ;(host as unknown as { documentHub: { renderPanel: () => void } }).documentHub.renderPanel()
    expect(document.querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(2)
  })
})

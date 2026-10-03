// @vitest-environment jsdom
/**
 * VNext Presentation Closure V1.1 §16–§26/§35–§39 — the Toolbar document
 * diagnostics summary must support Error / Warning / Hint independently.
 *
 * Hard invariants under test:
 *   - every non-zero severity shows its OWN badge (never only Error/Warning);
 *   - `✓ 文档检测` is shown ONLY at 0/0/0 (§19);
 *   - Toolbar counts come from the FULL DOCUMENT snapshot — NEVER the Drawer
 *     filter / visible rows (§20) and NEVER runtime diagnostics (§22);
 *   - Toolbar and Drawer share the ONE `countDocumentSeverities` authority (§21).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { deriveDocumentProblemsProjection } from './document-problems-projection'
import { countDocumentSeverities, selectDocumentDiagnostics } from './diagnostic-domain-v1'

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type Internals = { renderDiagnosticsButton(): void; renderDrawer(): void }
type HostApi = {
  getCurrentProblemsProjection(): { errorCount: number; warningCount: number; hintCount: number; totalCount: number }
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

function mountWorld(): DocumentUtilityOverlayHost {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return h
}

function diag(severity: 'error' | 'warning' | 'info', i: number, domain: 'document' | 'runtime' = 'document'): Record<string, unknown> {
  return {
    domain, id: `${domain}:${severity}:${i}`, documentKey: 'doc:key', severity,
    category: 'document', code: 'DOCUMENT_EMPTY', message: 'm', detail: '', metadata: {},
  }
}

function setSnapshot(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags,
    errorCount: diags.filter(d => d.severity === 'error').length,
    warningCount: diags.filter(d => d.severity === 'warning').length,
    infoCount: diags.filter(d => d.severity === 'info').length,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
  ;(h as unknown as Internals).renderDiagnosticsButton()
}

const control = (): HTMLElement | null => document.querySelector('.inkchapter-problems-control')
const segments = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-toolbar-segment'))
const entry = (): HTMLElement | null => document.querySelector('.inkchapter-toolbar-entry')
const severityOfSegment = (el: HTMLElement): string | null => el.getAttribute('data-severity')
const countOfSegment = (el: HTMLElement): string => el.querySelector('.inkchapter-toolbar-segment__count')?.textContent ?? ''

// ── §35 — the 8 combinations ────────────────────────────────────────────────

describe('VNext §17/§18/§35 — Toolbar severity summary state matrix', () => {
  const cases: Array<[number, number, number, string]> = [
    [0, 0, 0, '000'], [0, 0, 1, '001'], [0, 1, 0, '010'], [1, 0, 0, '100'],
    [1, 1, 0, '110'], [1, 0, 1, '101'], [0, 1, 1, '011'], [1, 1, 1, '111'],
  ]
  for (const [e, w, hint, label] of cases) {
    it(`${label} (E${e} W${w} H${hint})`, () => {
      host = mountWorld()
      const diags: Array<Record<string, unknown>> = []
      for (let i = 0; i < e; i++) diags.push(diag('error', i))
      for (let i = 0; i < w; i++) diags.push(diag('warning', i))
      for (let i = 0; i < hint; i++) diags.push(diag('info', i))
      setSnapshot(host, diags)
      expect(control()).not.toBeNull()
      const segs = segments()
      const bySeverity = new Map(segs.map(s => [severityOfSegment(s), countOfSegment(s)]))
      const expectedSegments = (e > 0 ? 1 : 0) + (w > 0 ? 1 : 0) + (hint > 0 ? 1 : 0)
      expect(segs.length, label).toBe(expectedSegments)
      if (e > 0) expect(bySeverity.get('error')).toBe(String(e))
      if (w > 0) expect(bySeverity.get('warning')).toBe(String(w))
      if (hint > 0) expect(bySeverity.get('info')).toBe(String(hint))
      if (e === 0 && w === 0 && hint === 0) {
        // §19 — ONLY the truly empty state shows the success check.
        expect(entry()?.classList.contains('is-healthy')).toBe(true)
        expect(segs.length).toBe(0)
      } else {
        // §19 — ANY problem (including a Hint-only document) hides the check.
        expect(document.querySelector('.inkchapter-toolbar-entry.is-healthy')).toBeNull()
        expect(segs.length).toBeGreaterThan(0)
      }
    })
  }

  it('§19 — Hint-only (0/0/1) shows the Hint badge and NEVER the success check', () => {
    host = mountWorld()
    setSnapshot(host, [diag('info', 0)])
    const segs = segments()
    expect(segs).toHaveLength(1)
    expect(severityOfSegment(segs[0])).toBe('info')
    expect(countOfSegment(segs[0])).toBe('1')
    // no `is-healthy` check entry at all
    const healthy = document.querySelector('.inkchapter-toolbar-entry.is-healthy')
    expect(healthy).toBeNull()
  })

  it('§18 — E1 W1 H1 shows all three badges', () => {
    host = mountWorld()
    setSnapshot(host, [diag('error', 0), diag('warning', 0), diag('info', 0)])
    const bySeverity = new Map(segments().map(s => [severityOfSegment(s), countOfSegment(s)]))
    expect([...bySeverity.keys()].sort()).toEqual(['error', 'info', 'warning'])
    expect(bySeverity.get('error')).toBe('1')
    expect(bySeverity.get('warning')).toBe('1')
    expect(bySeverity.get('info')).toBe('1')
  })

  it('§21 — Toolbar counts equal the Drawer authority (countDocumentSeverities)', () => {
    host = mountWorld()
    const diags = [diag('error', 0), diag('warning', 0), diag('warning', 1), diag('info', 0)]
    setSnapshot(host, diags)
    const snapshot = (host as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot
    const drawerCounts = countDocumentSeverities(selectDocumentDiagnostics(snapshot.diagnostics))
    const toolbar = (host as unknown as HostApi).getCurrentProblemsProjection()
    expect(toolbar.errorCount).toBe(drawerCounts.error)
    expect(toolbar.warningCount).toBe(drawerCounts.warning)
    expect(toolbar.hintCount).toBe(drawerCounts.info)
  })
})

// ── §36 — Drawer filter isolation ───────────────────────────────────────────

describe('VNext §20/§36 — the Drawer filter NEVER changes the Toolbar summary', () => {
  it('filter=info keeps Error/Warning/Hint badges intact', () => {
    host = mountWorld()
    setSnapshot(host, [diag('error', 0), diag('warning', 0), diag('info', 0)])
    const before = segments().map(s => `${severityOfSegment(s)}:${countOfSegment(s)}`).sort()
    // switch the Drawer filter to 提示 and re-render the Drawer.
    ;(host as unknown as { drawerFilter: string }).drawerFilter = 'info'
    ;(host as unknown as Internals).renderDrawer()
    const after = segments().map(s => `${severityOfSegment(s)}:${countOfSegment(s)}`).sort()
    expect(after).toEqual(before)
    expect(after).toEqual(['error:1', 'info:1', 'warning:1'])
  })
})

// ── §22/§37 — domain isolation ──────────────────────────────────────────────

describe('VNext §22/§37 — runtime diagnostics never reach the Toolbar summary', () => {
  it('document Hint=1 + 5 runtime FAIL items → Toolbar shows Hint 1 only', () => {
    host = mountWorld()
    const runtime = Array.from({ length: 5 }, (_, i) => ({
      domain: 'runtime', code: `RUNTIME_FAIL_${i}`, status: 'FAIL', message: 'x', source: 's', observedAt: 0,
    }))
    setSnapshot(host, [diag('info', 0), ...runtime])
    const projection = (host as unknown as HostApi).getCurrentProblemsProjection()
    expect(projection.hintCount).toBe(1)
    expect(projection.errorCount).toBe(0)
    expect(projection.warningCount).toBe(0)
    const segs = segments()
    expect(segs).toHaveLength(1)
    expect(severityOfSegment(segs[0])).toBe('info')
  })
})

// ── pure projection ──────────────────────────────────────────────────────────

describe('VNext §21 — deriveDocumentProblemsProjection stays a thin single-authority wrapper', () => {
  it('maps info → hintCount and matches countDocumentSeverities', () => {
    const snapshot = {
      documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: [diag('error', 0), diag('warning', 0), diag('info', 0), diag('info', 1)],
      errorCount: 1, warningCount: 1, infoCount: 2,
    } as unknown as DocumentDiagnosticsSnapshot
    const p = deriveDocumentProblemsProjection(snapshot)
    expect([p.errorCount, p.warningCount, p.hintCount, p.totalCount]).toEqual([1, 1, 2, 4])
    expect(p.healthy).toBe(false)
  })
})

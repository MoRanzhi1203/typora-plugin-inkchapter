// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.6 — Document Workspace Minimum Width Guard.
 *
 * State model: NORMAL / COMPACT / MIN_WIDTH_GUARD. The min-width authority is a
 * single declarative token applied to the RESOLVED workspace flex item — never
 * a fixed `#write` width, never a broad selector. Drawer / Navigator / Toolbar
 * are overlays (width effect = 0 by construction).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
  resolveWorkspaceWidthState,
  computeGuardedWorkspaceWidth,
  resolveWorkspaceHost,
  WORKSPACE_HOST_CLASS,
  WORKSPACE_WIDTH_STATE_ATTR,
} from './document-workspace-width-guard'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

vi.mock('../runtime/forensic-log-sink', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../runtime/forensic-log-sink')>()
  return { ...mod, emitRuntimeAudit: vi.fn(mod.emitRuntimeAudit) }
})

/** Build the real Typora-like shell chain: sidebar + workspace + scroll container + #write. */
function mountShell(): { shell: HTMLElement; workspace: HTMLElement; writeParent: HTMLElement; write: HTMLElement } {
  document.body.innerHTML = ''
  const shell = document.createElement('div')
  shell.id = 'shell'
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  sidebar.style.width = '316px'
  const workspace = document.createElement('div')
  workspace.id = 'workspace'
  const writeParent = document.createElement('div')
  writeParent.id = 'write-parent'
  const write = document.createElement('div')
  write.id = 'write'
  write.innerHTML = '<h1>标题</h1><p>正文</p>'
  writeParent.appendChild(write)
  workspace.appendChild(writeParent)
  shell.appendChild(sidebar)
  shell.appendChild(workspace)
  document.body.appendChild(shell)
  return { shell, workspace, writeParent, write }
}

function fakeCtx(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
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

describe('resolveWorkspaceWidthState — pure state model', () => {
  it('BASIC_MIN: requested=300, min=520 → MIN_WIDTH_GUARD, effective >= 520', () => {
    expect(resolveWorkspaceWidthState(300)).toBe('min-width-guard')
    expect(computeGuardedWorkspaceWidth(300)).toBe(DOCUMENT_WORKSPACE_MIN_WIDTH_PX)
    expect(computeGuardedWorkspaceWidth(300)).toBeGreaterThanOrEqual(520)
  })

  it('NORMAL: requested=900 → NORMAL, no forced 520 clamp', () => {
    expect(resolveWorkspaceWidthState(900)).toBe('normal')
    expect(computeGuardedWorkspaceWidth(900)).toBe(900) // NOT clamped to 520
  })

  it('COMPACT: requested=600, min=520, threshold=700 → COMPACT', () => {
    expect(resolveWorkspaceWidthState(600, 520, 700)).toBe('compact')
  })

  it('THRESHOLD_CROSSING: 800→650→500→650→800 → NORMAL→COMPACT→MIN_WIDTH_GUARD→COMPACT→NORMAL', () => {
    const seq = [800, 650, 500, 650, 800].map(w => resolveWorkspaceWidthState(w, 520, 700))
    expect(seq).toEqual(['normal', 'compact', 'min-width-guard', 'compact', 'normal'])
  })

  it('boundary: exactly at min → compact (NOT guard); just below → guard', () => {
    expect(resolveWorkspaceWidthState(520, 520, 700)).toBe('compact')
    expect(resolveWorkspaceWidthState(519.5, 520, 700)).toBe('min-width-guard')
  })
})

describe('workspace host resolution', () => {
  beforeEach(() => mountShell())

  it('resolves the workspace flex item (sibling of the sidebar)', () => {
    const host = resolveWorkspaceHost()
    expect(host).toBeTruthy()
    expect(host!.id).toBe('workspace')
  })

  it('returns null when no sidebar exists (never guesses an ancestor)', () => {
    document.querySelector('#typora-sidebar')?.remove()
    const host = resolveWorkspaceHost()
    // Walk-up finds no shell row → null (STOP, not a random min-width patch).
    expect(host).toBeNull()
  })
})

describe('overlay host width guard integration', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number)
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('applies the host class + state attribute; dispose removes both (CLEANUP)', () => {
    mountShell()
    const host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
    host.bindDocument()
    vi.advanceTimersByTime(50)

    const workspace = document.getElementById('workspace') as HTMLElement
    const overlayRoot = document.querySelector('[data-inkchapter-utility-root="true"]') as HTMLElement
    expect(workspace.classList.contains(WORKSPACE_HOST_CLASS)).toBe(true)
    expect(overlayRoot.hasAttribute(WORKSPACE_WIDTH_STATE_ATTR)).toBe(true)

    host.dispose()
    expect(workspace.classList.contains(WORKSPACE_HOST_CLASS)).toBe(false)
    expect(overlayRoot.hasAttribute(WORKSPACE_WIDTH_STATE_ATTR)).toBe(false)
  })

  it('DRAWER_INVARIANCE: opening the drawer never changes workspace width (invariant payload drawerAffectsWorkspaceWidth=false)', () => {
    mountShell()
    const auditMock = vi.mocked(emitRuntimeAudit)
    auditMock.mockClear()
    const host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
    host.bindDocument()
    vi.advanceTimersByTime(50)

    const before = (document.getElementById('workspace') as HTMLElement).getBoundingClientRect().width
    const diagBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')!
    diagBtn.click()
    vi.advanceTimersByTime(50)
    const after = (document.getElementById('workspace') as HTMLElement).getBoundingClientRect().width
    expect(after).toBe(before) // delta ≈ 0 (overlay drawer never pushes the workspace)

    // The width invariant audit always reports drawerAffectsWorkspaceWidth=false.
    const invariantCalls = auditMock.mock.calls.filter(([ev]) => ev === 'DOCUMENT-UTILITY-WORKSPACE-WIDTH-INVARIANT')
    expect(invariantCalls.length).toBeGreaterThan(0)
    for (const [, payload] of invariantCalls) {
      expect((payload as { drawerAffectsWorkspaceWidth?: boolean }).drawerAffectsWorkspaceWidth).toBe(false)
      expect((payload as { navigatorAffectsWorkspaceWidth?: boolean }).navigatorAffectsWorkspaceWidth).toBe(false)
    }
    host.dispose()
  })

  it('STATE_DEDUP: repeated geometry passes at the same width → at most one attr mutation', () => {
    mountShell()
    const host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
    host.bindDocument()
    vi.advanceTimersByTime(50)

    const overlayRoot = document.querySelector('[data-inkchapter-utility-root="true"]') as HTMLElement
    let mutations = 0
    const mo = new MutationObserver(() => { mutations++ })
    mo.observe(overlayRoot, { attributes: true, attributeFilter: [WORKSPACE_WIDTH_STATE_ATTR] })

    // Ten geometry passes at the SAME window size → state token writes must
    // stay deduped (no per-pixel re-write → no ResizeObserver feedback loop).
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(40)
    }
    expect(mutations).toBeLessThanOrEqual(1)
    mo.disconnect()
    host.dispose()
  })

  it('WRITE_THEME_WIDTH: #write keeps its theme max-width; the guard never touches the paper', () => {
    mountShell()
    const style = document.createElement('style')
    style.textContent = '#write { max-width: 900px; }'
    document.head.appendChild(style)
    const host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
    host.bindDocument()
    vi.advanceTimersByTime(50)

    const write = document.getElementById('write') as HTMLElement
    const cs = getComputedStyle(write)
    expect(cs.maxWidth).toBe('900px') // theme max-width preserved
    expect(write.style.width).toBe('') // no inline width
    expect(write.style.minWidth).toBe('') // no inline min-width
    // The host (workspace), not #write, carries the scoped min-width class.
    const workspace = document.getElementById('workspace') as HTMLElement
    expect(workspace.classList.contains(WORKSPACE_HOST_CLASS)).toBe(true)
    expect(write.classList.contains(WORKSPACE_HOST_CLASS)).toBe(false)
    host.dispose()
  })

  it('VERTICAL_SCROLL: the guard never replaces the canonical vertical scroll container', () => {
    mountShell()
    const host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
    host.bindDocument()
    vi.advanceTimersByTime(50)
    // The scroll container authority stays #write.parentElement (unchanged by
    // the width guard — no second scroll container is ever introduced).
    expect((document.getElementById('write') as HTMLElement).parentElement?.id).toBe('write-parent')
    host.dispose()
  })
})

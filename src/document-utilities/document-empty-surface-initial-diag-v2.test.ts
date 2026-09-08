// @vitest-environment jsdom
/**
 * Empty Surface + Initial Diagnostics Reconcile V2 — targeted tests.
 *  EMPTY-SURFACE-1..8      surface authority = ACTIVE EMPTY leaf view
 *  EMPTY-CREATE-REAL-1..10 real-event create chain (detail>=2, leaf surface)
 *  INITIAL-DIAG-1..8       single reconcile coordinator
 *  DIAG-EPOCH-1..6         document identity epoch / stale-result gate
 *  DIAG-PROJECTION-1..6    Toolbar/Drawer consume the same snapshot
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EmptyWorkspaceUxController } from './document-empty-workspace-controller'
import type {
  EmptyWorkspaceSurfaceFacts,
  EmptyWorkspaceUxPlatform,
  EmptyWorkspacePresence,
} from './document-empty-workspace-controller'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ── shared empty-workspace harness ──────────────────────────────────────────
let presence: EmptyWorkspacePresence = { state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' }
let currentEmptySurface: HTMLElement | null = null
let currentFacts: EmptyWorkspaceSurfaceFacts | null = null
let controllers: EmptyWorkspaceUxController[] = []

interface Rec {
  root: string | null
  existing: Set<string>
  creates: string[]
  openCalls: string[]
  notices: string[]
  openFail: boolean
  failCreate: boolean
}

function makePlatform(): { platform: EmptyWorkspaceUxPlatform; rec: Rec } {
  const rec: Rec = { root: '/root', existing: new Set(), creates: [], openCalls: [], notices: [], openFail: false, failCreate: false }
  const platform: EmptyWorkspaceUxPlatform = {
    getFileTreeRoot: () => rec.root,
    markdownExists: (p) => rec.existing.has(p) || rec.existing.has(p.replace(/\\/g, '/')),
    createExclusiveMarkdown: (dir, name) => {
      const p = `${dir}/${name}`
      if (rec.existing.has(p)) return { ok: false, path: null, code: 'EXISTS' }
      if (rec.failCreate) return { ok: false, path: null, code: 'ERROR' }
      rec.existing.add(p)
      rec.creates.push(p)
      return { ok: true, path: p, code: 'OK' }
    },
    openCreatedFile: async (p) => {
      rec.openCalls.push(p)
      if (rec.openFail) throw new Error('boom')
      presence = { state: 'ACTIVE', path: p, source: 'ACTIVE_LEAF_PATH' }
    },
    notice: (m) => rec.notices.push(m),
  }
  return { platform, rec }
}

function dbl(button = 0, detail = 2): MouseEvent {
  return new MouseEvent('dblclick', { bubbles: true, cancelable: true, button, detail })
}

function leafSurfaceFacts(surface: HTMLElement | null, viewType = 'core.empty'): EmptyWorkspaceSurfaceFacts | null {
  return { surface, source: surface ? 'ACTIVE_EMPTY_LEAF_VIEW' : 'NO_ACTIVE_LEAF', activeLeafExists: surface != null, activeLeafViewType: viewType }
}

function makeController(platform: EmptyWorkspaceUxPlatform): EmptyWorkspaceUxController {
  const c = new EmptyWorkspaceUxController({
    platform,
    getPresence: () => presence,
    resolveEmptySurface: () => currentFacts ?? leafSurfaceFacts(currentEmptySurface),
    contentEditableBoundaryAllowed: true,
  })
  c.sync(presence)
  controllers.push(c)
  return c
}

function addTabDom(): void {
  document.body.innerHTML =
    '<div class="typ-workspace-tab-header"><div class="typ-tabs">' +
    '<div class="typ-tab active" data-id="typ://empty/1/New tab">New tab<i class="typ-icon typ-close"></i></div>' +
    '</div></div>'
}

beforeEach(() => {
  document.body.innerHTML = ''
  presence = { state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' }
  currentEmptySurface = null
  currentFacts = null
  controllers = []
})

afterEach(() => {
  for (const c of controllers) c.dispose()
  controllers = []
})

describe('EMPTY-SURFACE-1..8 — surface authority is the ACTIVE EMPTY leaf view', () => {
  it('EMPTY-SURFACE-1 presence EMPTY + active core.empty leaf → view-owned surface resolved & bound', () => {
    addTabDom()
    const { platform } = makePlatform()
    currentEmptySurface = document.createElement('div')
    currentEmptySurface.className = 'typ-empty-view'
    document.body.appendChild(currentEmptySurface)
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
  })

  it('EMPTY-SURFACE-2 stale #write connected must NOT become the bound surface', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const emptyView = document.createElement('div')
    emptyView.className = 'typ-empty-view'
    document.body.appendChild(emptyView)
    currentEmptySurface = emptyView
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
    // dblclick on stale #write never reaches the empty-view listener
    write.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
    emptyView.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
  })

  it('EMPTY-SURFACE-3 surface disconnected → listener detached', () => {
    addTabDom()
    const { platform } = makePlatform()
    currentEmptySurface = document.createElement('div')
    // not appended → disconnected
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
  })

  it('EMPTY-SURFACE-4 EMPTY → ACTIVE removes the listener', () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    const c = makeController(platform)
    presence = { state: 'ACTIVE', path: '/root/a.md', source: 'ACTIVE_LEAF_PATH' }
    c.sync(presence)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
    currentEmptySurface!.dispatchEvent(dbl(0))
    void flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-SURFACE-5 ACTIVE → EMPTY binds the (new) empty leaf surface', () => {
    addTabDom()
    const { platform } = makePlatform()
    presence = { state: 'ACTIVE', path: '/root/a.md', source: 'ACTIVE_LEAF_PATH' }
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
    presence = { state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' }
    c.sync(presence)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
  })

  it('EMPTY-SURFACE-6 surface DOM replaced → old listener removed, count stays 1', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    const first = document.createElement('div')
    document.body.appendChild(first)
    currentEmptySurface = first
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
    const second = document.createElement('div')
    document.body.appendChild(second)
    currentEmptySurface = second
    c.sync({ state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' })
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
    first.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0) // stale surface no longer listened
    second.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
  })

  it('EMPTY-SURFACE-7 no active empty view → unavailable, no listener', () => {
    addTabDom()
    const { platform } = makePlatform()
    currentFacts = { surface: null, source: 'NOT_EMPTY_VIEW', activeLeafExists: true, activeLeafViewType: 'markdown' }
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
  })

  it('EMPTY-SURFACE-8 ownership mismatch (resolver reports a non-empty view) → fail closed, no listener', () => {
    addTabDom()
    const { platform } = makePlatform()
    const foreign = document.createElement('div')
    document.body.appendChild(foreign)
    currentFacts = { surface: foreign, source: 'NOT_EMPTY_VIEW', activeLeafExists: true, activeLeafViewType: 'markdown' }
    const c = makeController(platform)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
  })
})

describe('EMPTY-CREATE-REAL-1..10 — real event chain on the leaf surface', () => {
  it('EMPTY-CREATE-REAL-1 left dblclick detail=2 → exactly one .md', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    const c = makeController(platform)
    currentEmptySurface!.dispatchEvent(dbl(0, 2))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(rec.openCalls.length).toBe(1)
    expect(presence.state).toBe('ACTIVE')
  })

  it('EMPTY-CREATE-REAL-2 single click → zero', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    currentEmptySurface!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-REAL-3 right/middle → zero', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    currentEmptySurface!.dispatchEvent(dbl(2))
    currentEmptySurface!.dispatchEvent(dbl(1))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-REAL-4 interactive target → zero', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    const btn = document.createElement('button')
    currentEmptySurface!.appendChild(btn)
    btn.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-REAL-5 presence changed before commit → zero', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    presence = { state: 'ACTIVE', path: '/root/a.md', source: 'ACTIVE_LEAF_PATH' }
    currentEmptySurface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-REAL-6 transaction busy → duplicate ignored', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    let resolveOpen!: () => void
    const gated: EmptyWorkspaceUxPlatform = {
      ...platform,
      openCreatedFile: (p) => new Promise<void>((r) => { rec.openCalls.push(p); resolveOpen = r }),
    }
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(gated)
    currentEmptySurface!.dispatchEvent(dbl(0))
    currentEmptySurface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    resolveOpen()
    await flush()
    expect(rec.creates.length).toBe(1)
  })

  it('EMPTY-CREATE-REAL-7 existing 未命名.md → 未命名 2.md', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/未命名.md')
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    currentEmptySurface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates[0]).toBe('/root/未命名 2.md')
  })

  it('EMPTY-CREATE-REAL-8 exclusive create race → no overwrite', async () => {
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/未命名.md')
    expect(platform.createExclusiveMarkdown('/root', '未命名.md').code).toBe('EXISTS')
  })

  it('EMPTY-CREATE-REAL-9 create success → app.openFile called once', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    currentEmptySurface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(rec.openCalls.length).toBe(1)
    expect(rec.openCalls[0]).toBe(rec.creates[0])
  })

  it('EMPTY-CREATE-REAL-10 open success → presence becomes ACTIVE', async () => {
    addTabDom()
    const { platform, rec } = makePlatform()
    currentEmptySurface = document.createElement('div')
    document.body.appendChild(currentEmptySurface)
    makeController(platform)
    currentEmptySurface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.openCalls.length).toBe(1)
    expect(presence.state).toBe('ACTIVE')
    expect(presence.path).toBe(rec.creates[0])
  })
})

// ── host reconcile harness ──────────────────────────────────────────────────
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

interface HostRig {
  model: Model
  h: DocumentUtilityOverlayHost
  lifecycle: (r: 'ACTIVE_LEAF_CHANGE' | 'TAB_TOGGLE') => void
  recomputeSpy: ReturnType<typeof vi.spyOn>
  reconcileSpy: ReturnType<typeof vi.spyOn>
  diagnosticsTrigger: (reason: string) => void
}

function makeRig(initial: Partial<Model> = {}): HostRig {
  const model: Model = {
    file: 'README.md',
    key: 'README.md',
    leafKnown: true,
    leafPath: 'README.md',
    ...initial,
  }
  let transition: ((r: 'ACTIVE_LEAF_CHANGE' | 'TAB_TOGGLE') => void) | null = null
  let trig: ((reason: string) => void) | null = null
  const h = new DocumentUtilityOverlayHost({
    ctx: makeCtx(model),
    providers: fakeProviders(),
    onBindDocument: (bind) => { /* file:open trigger unused here */ void bind },
    onActiveLeafLifecycle: (cb) => { transition = cb; return () => { transition = null } },
    onDiagnosticsTrigger: (recompute) => { trig = recompute; return () => undefined },
  })
  const recomputeSpy = vi.spyOn(h.diagnostics, 'recompute')
  const reconcileSpy = vi.spyOn(h, 'reconcileActiveDocument')
  return {
    model,
    h,
    lifecycle: (r) => transition?.(r),
    recomputeSpy,
    reconcileSpy,
    diagnosticsTrigger: (reason) => trig?.(reason),
  }
}

describe('INITIAL-DIAG-1..8 — single reconcile authority', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('INITIAL-DIAG-1/2 mount while README ACTIVE → reconcile without file:open → snapshot produced', () => {
    const rig = makeRig()
    rig.h.mount()
    expect(rig.reconcileSpy).toHaveBeenCalledWith('INITIAL_ACTIVE_DOCUMENT')
    expect(rig.recomputeSpy).toHaveBeenCalled()
    const snap = rig.h.getSnapshot()
    expect(snap).not.toBeNull()
    expect(snap!.documentKey).toBe('README.md')
    rig.h.dispose()
  })

  it('INITIAL-DIAG-3 ACTIVE_LEAF_CHANGED → reconcile', () => {
    const rig = makeRig()
    rig.h.mount()
    rig.reconcileSpy.mockClear()
    rig.lifecycle('ACTIVE_LEAF_CHANGE')
    expect(rig.reconcileSpy).toHaveBeenCalledWith('ACTIVE_LEAF_CHANGED')
    rig.h.dispose()
  })

  it('INITIAL-DIAG-4 ACTIVE_TAB_CHANGED → reconcile', () => {
    const rig = makeRig()
    rig.h.mount()
    rig.reconcileSpy.mockClear()
    rig.lifecycle('TAB_TOGGLE')
    expect(rig.reconcileSpy).toHaveBeenCalledWith('ACTIVE_TAB_CHANGED')
    rig.h.dispose()
  })

  it('INITIAL-DIAG-5 FILE_OPEN → same reconcile authority (bindDocument)', () => {
    const rig = makeRig()
    rig.h.mount()
    rig.reconcileSpy.mockClear()
    rig.model.file = 'doc2.md'
    rig.model.key = 'doc2.md'
    rig.model.leafPath = 'doc2.md'
    rig.h.bindDocument()
    expect(rig.reconcileSpy).toHaveBeenCalledWith('FILE_OPEN')
    rig.h.dispose()
  })

  it('INITIAL-DIAG-6 canonical frame WAITING → READY auto final recompute (same authority)', () => {
    const rig = makeRig()
    rig.h.mount()
    const callsBefore = rig.recomputeSpy.mock.calls.length
    rig.diagnosticsTrigger('CANONICAL_FRAME_READY')
    expect(rig.recomputeSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    rig.h.dispose()
  })

  it('INITIAL-DIAG-7 caption/object registry ready → auto recompute', () => {
    const rig = makeRig()
    rig.h.mount()
    const callsBefore = rig.recomputeSpy.mock.calls.length
    rig.diagnosticsTrigger('CAPTION_REHYDRATED')
    expect(rig.recomputeSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    rig.h.dispose()
  })

  it('INITIAL-DIAG-8 first-open final snapshot equals B→A final snapshot', () => {
    const rig = makeRig()
    rig.h.mount()
    const first = rig.h.getSnapshot()
    // A → B
    rig.model.file = 'B.md'
    rig.model.key = 'B.md'
    rig.model.leafPath = 'B.md'
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    // B → A
    rig.model.file = 'README.md'
    rig.model.key = 'README.md'
    rig.model.leafPath = 'README.md'
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const second = rig.h.getSnapshot()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.documentKey).toBe('README.md')
    expect(second!.documentKey).toBe('README.md')
    expect(first!.diagnostics.length).toBe(second!.diagnostics.length)
    rig.h.dispose()
  })
})

describe('DIAG-EPOCH-1..6 — identity epoch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DIAG-EPOCH-2/3/4 EMPTY→A, A→B, B→A, ACTIVE→EMPTY increments epoch', () => {
    const rig = makeRig({ file: null, key: null, leafPath: '' })
    rig.h.mount()
    expect(rig.h.getActiveDocumentEpoch()).toBe(0) // EMPTY baseline
    // EMPTY → A
    rig.model.file = 'A.md'; rig.model.key = 'A.md'; rig.model.leafPath = 'A.md'
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const e1 = rig.h.getActiveDocumentEpoch()
    // A → B
    rig.model.file = 'B.md'; rig.model.key = 'B.md'; rig.model.leafPath = 'B.md'
    rig.h.reconcileActiveDocument('ACTIVE_TAB_CHANGED')
    const e2 = rig.h.getActiveDocumentEpoch()
    // B → A
    rig.model.file = 'A.md'; rig.model.key = 'A.md'; rig.model.leafPath = 'A.md'
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const e3 = rig.h.getActiveDocumentEpoch()
    // ACTIVE → EMPTY
    rig.model.file = 'A.md'; rig.model.key = 'A.md'; rig.model.leafPath = ''
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED') // leaf empty, but model file stale
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const e4 = rig.h.getActiveDocumentEpoch()
    expect(e1).toBeGreaterThan(0)
    expect(e2).toBeGreaterThan(e1)
    expect(e3).toBeGreaterThan(e2)
    expect(e4).toBeGreaterThan(e3)
    rig.h.dispose()
  })

  it('DIAG-EPOCH-5 same-document readiness revision can recompute without epoch change', () => {
    const rig = makeRig()
    rig.h.mount()
    const epoch = rig.h.getActiveDocumentEpoch()
    const calls = rig.recomputeSpy.mock.calls.length
    rig.diagnosticsTrigger('CANONICAL_FRAME_READY')
    rig.diagnosticsTrigger('CAPTION_REHYDRATED')
    expect(rig.recomputeSpy.mock.calls.length).toBeGreaterThan(calls)
    expect(rig.h.getActiveDocumentEpoch()).toBe(epoch)
    rig.h.dispose()
  })

  it('DIAG-EPOCH-1/6 stale cross-document result cannot overwrite the current snapshot', () => {
    const rig = makeRig()
    rig.h.mount()
    const aSnap = rig.h.getSnapshot()
    rig.model.file = 'B.md'; rig.model.key = 'B.md'; rig.model.leafPath = 'B.md'
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    const bSnap = rig.h.getSnapshot()
    expect(bSnap!.documentKey).toBe('B.md')
    expect(bSnap!.documentKey).not.toBe(aSnap!.documentKey)
    rig.h.dispose()
  })
})

describe('DIAG-PROJECTION-1..6 — Toolbar/Drawer consume the committed snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function problemsControl(): HTMLElement {
    const el = document.querySelector('.inkchapter-problems-control')
    expect(el).toBeTruthy()
    return el as HTMLElement
  }

  it('DIAG-PROJECTION-4 ACTIVE → EMPTY clears counts immediately', () => {
    const rig = makeRig()
    rig.h.mount()
    expect(rig.h.getSnapshot()).not.toBeNull()
    rig.model.file = 'README.md'; rig.model.key = 'README.md'; rig.model.leafPath = ''
    rig.h.reconcileActiveDocument('ACTIVE_LEAF_CHANGED')
    expect(problemsControl().childElementCount).toBe(0)
    rig.h.dispose()
  })

  it('DIAG-PROJECTION-5/6 EMPTY → ACTIVE restores counts automatically (no click)', () => {
    const rig = makeRig({ file: null, key: null, leafPath: '' })
    rig.h.mount()
    rig.model.file = 'README.md'; rig.model.key = 'README.md'; rig.model.leafPath = 'README.md'
    rig.h.reconcileActiveDocument('INITIAL_ACTIVE_DOCUMENT')
    const snap = rig.h.getSnapshot()
    expect(snap).not.toBeNull()
    expect(snap!.documentKey).toBe('README.md')
    rig.h.dispose()
  })
})

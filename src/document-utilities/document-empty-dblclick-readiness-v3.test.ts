// @vitest-environment jsdom
/**
 * V3 — Real DblClick + Readiness Barrier targeted tests.
 *   DBLCLICK-CAPTURE  capture-phase scoped listener + contenteditable container allowed
 *   READINESS/DIAG-RACE barrier states + FINAL commit gate (pure)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EmptyWorkspaceUxController } from './document-empty-workspace-controller'
import type {
  EmptyWorkspaceSurfaceFacts,
  EmptyWorkspaceUxPlatform,
  EmptyWorkspacePresence,
} from './document-empty-workspace-controller'
import {
  computeActiveDocumentReadiness,
  evaluateDiagnosticsCommitGate,
} from './document-active-document-readiness'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let presence: EmptyWorkspacePresence = { state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' }
let surface: HTMLElement | null = null
let facts: EmptyWorkspaceSurfaceFacts | null = null
let controllers: EmptyWorkspaceUxController[] = []

interface Rec { creates: string[]; existing: Set<string>; openCalls: string[] }
const rec: Rec = { creates: [], existing: new Set(), openCalls: [] }

function makePlatform(): EmptyWorkspaceUxPlatform {
  rec.creates.length = 0
  rec.openCalls.length = 0
  rec.existing.clear()
  return {
    getFileTreeRoot: () => '/root',
    markdownExists: (p) => rec.existing.has(p) || rec.existing.has(p.replace(/\\/g, '/')),
    createExclusiveMarkdown: (dir, name) => {
      const p = `${dir}/${name}`
      if (rec.existing.has(p)) return { ok: false, path: null, code: 'EXISTS' }
      rec.existing.add(p)
      rec.creates.push(p)
      return { ok: true, path: p, code: 'OK' }
    },
    openCreatedFile: async (p) => {
      rec.openCalls.push(p)
      presence = { state: 'ACTIVE', path: p, source: 'ACTIVE_LEAF_PATH' }
    },
  }
}

function dbl(button = 0, detail = 2): MouseEvent {
  return new MouseEvent('dblclick', { bubbles: true, cancelable: true, button, detail })
}

function makeController(platform: EmptyWorkspaceUxPlatform): EmptyWorkspaceUxController {
  const c = new EmptyWorkspaceUxController({
    platform,
    getPresence: () => presence,
    resolveEmptySurface: () => facts ?? { surface, source: surface ? 'ACTIVE_EMPTY_LEAF_VIEW' : 'NO_ACTIVE_LEAF', activeLeafExists: !!surface, activeLeafViewType: 'core.markdown' },
    contentEditableBoundaryAllowed: true,
  })
  c.sync(presence)
  controllers.push(c)
  return c
}

beforeEach(() => {
  document.body.innerHTML =
    '<div class="typ-workspace-tab-header"><div class="typ-tabs">' +
    '<div class="typ-tab active" data-id="typ://empty/1/New tab">New tab<i class="typ-icon typ-close"></i></div>' +
    '</div></div>'
  presence = { state: 'EMPTY', path: '', source: 'ACTIVE_LEAF_EMPTY' }
  surface = null
  facts = null
  controllers = []
})

afterEach(() => {
  for (const c of controllers) c.dispose()
  controllers = []
})

describe('DBLCLICK-CAPTURE — capture-phase real-event pipeline', () => {
  it('capture listener bound to the EMPTY leaf surface (third arg true) and still creates once', async () => {
    surface = document.createElement('div')
    document.body.appendChild(surface)
    const addSpy = vi.spyOn(surface, 'addEventListener')
    const platform = makePlatform()
    makeController(platform)
    const call = addSpy.mock.calls.find(([ev]) => ev === 'dblclick')
    expect(call).toBeTruthy()
    expect((call as unknown[])[2]).toBe(true)
    surface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(rec.openCalls.length).toBe(1)
    addSpy.mockRestore()
  })

  it('contenteditable container ancestor does NOT veto the blank double-click', async () => {
    surface = document.createElement('div')
    surface.setAttribute('contenteditable', 'true')
    document.body.appendChild(surface)
    const platform = makePlatform()
    makeController(platform)
    surface!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
  })

  it('real interactive control inside the surface still rejects (no create)', async () => {
    surface = document.createElement('div')
    document.body.appendChild(surface)
    const btn = document.createElement('button')
    surface!.appendChild(btn)
    const platform = makePlatform()
    makeController(platform)
    btn.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })
})

describe('READINESS / DIAG-RACE — Active Document Readiness Barrier (pure)', () => {
  it('READY path: INACTIVE→WAITING_*→READY', () => {
    expect(computeActiveDocumentReadiness({ presenceActive: false, identityMatch: false, editorRootConnected: false, sourceAvailable: false, canonicalReady: false, stale: false })).toBe('INACTIVE')
    expect(computeActiveDocumentReadiness({ presenceActive: true, identityMatch: false, editorRootConnected: false, sourceAvailable: false, canonicalReady: false, stale: false })).toBe('WAITING_IDENTITY')
    expect(computeActiveDocumentReadiness({ presenceActive: true, identityMatch: true, editorRootConnected: false, sourceAvailable: false, canonicalReady: false, stale: false })).toBe('WAITING_EDITOR')
    expect(computeActiveDocumentReadiness({ presenceActive: true, identityMatch: true, editorRootConnected: true, sourceAvailable: false, canonicalReady: false, stale: false })).toBe('WAITING_SOURCE')
    expect(computeActiveDocumentReadiness({ presenceActive: true, identityMatch: true, editorRootConnected: true, sourceAvailable: true, canonicalReady: false, stale: false })).toBe('WAITING_CANONICAL')
    expect(computeActiveDocumentReadiness({ presenceActive: true, identityMatch: true, editorRootConnected: true, sourceAvailable: true, canonicalReady: true, stale: false })).toBe('READY')
  })

  it('FINAL commit at READY → COMMIT', () => {
    const gate = evaluateDiagnosticsCommitGate({
      snapshotDocumentKey: 'A.md', currentDocumentKey: 'A.md',
      snapshotEpoch: 2, currentEpoch: 2, presenceActive: true, readiness: 'READY', finalRequired: true,
    })
    expect(gate.commit).toBe(true)
    expect(gate.decision).toBe('COMMIT')
  })

  it('pre-READY FINAL commit → DISCARD_PRE_READY_FINAL_COMMIT', () => {
    const gate = evaluateDiagnosticsCommitGate({
      snapshotDocumentKey: 'A.md', currentDocumentKey: 'A.md',
      snapshotEpoch: 2, currentEpoch: 2, presenceActive: true, readiness: 'WAITING_CANONICAL', finalRequired: true,
    })
    expect(gate.commit).toBe(false)
    expect(gate.decision).toBe('DISCARD_PRE_READY_FINAL_COMMIT')
  })

  it('stale identity/epoch result → DISCARD_STALE_DIAGNOSTICS_RESULT', () => {
    expect(evaluateDiagnosticsCommitGate({ snapshotDocumentKey: 'A.md', currentDocumentKey: 'B.md', snapshotEpoch: 1, currentEpoch: 2, presenceActive: true, readiness: 'READY', finalRequired: true }).decision).toBe('DISCARD_STALE_DIAGNOSTICS_RESULT')
    expect(evaluateDiagnosticsCommitGate({ snapshotDocumentKey: 'A.md', currentDocumentKey: 'A.md', snapshotEpoch: 1, currentEpoch: 2, presenceActive: true, readiness: 'READY', finalRequired: true }).decision).toBe('DISCARD_STALE_DIAGNOSTICS_RESULT')
  })

  it('inactive presence → DISCARD_PRESENCE_INACTIVE', () => {
    expect(evaluateDiagnosticsCommitGate({ snapshotDocumentKey: 'A.md', currentDocumentKey: 'A.md', snapshotEpoch: 1, currentEpoch: 1, presenceActive: false, readiness: 'INACTIVE', finalRequired: false }).decision).toBe('DISCARD_PRESENCE_INACTIVE')
  })
})

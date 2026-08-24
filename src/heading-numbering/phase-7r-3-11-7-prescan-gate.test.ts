// @vitest-environment jsdom
/**
 * Phase 7R.3.11.7 — Document-switch PRE-SCAN document-context gate.
 *
 * PRE-SCAN-1  active=B / caption=A / coordinator=A → PARK_TRANSITIONAL_MISMATCH,
 *             zero scans (code scan / full scan / plan build all 0)
 * PRE-SCAN-2  active=caption=coordinator=B + frame/snapshot none →
 *             WAIT_HEADING_AUTHORITY (NOT a mismatch; the 7R.3.9R authority gate
 *             performs the actual block)
 * PRE-SCAN-3  context ready + frame B → release EXACTLY ONE reconcile; parked
 *             stale requests are never replayed
 * PRE-SCAN-4  multiple stale mutations on the same transition token → no
 *             repeated full scan
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  CaptionService,
  decideCaptionPreScanGate,
  type CaptionPreScanGateVerdict,
  type CaptionServiceContext,
} from './caption-service'
import { setCaptionVaultRootForTesting, clearCaptionVaultRootForTesting } from './caption-store'
import { DEFAULT_SETTINGS } from '../settings/default-settings'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'

const TEST_VAULT = (() => {
  const dir = path.join(os.tmpdir(), `inkchapter-prescan-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
})()

function cleanStore(): void {
  const dir = path.join(TEST_VAULT, '.typora', 'inkchapter', 'captions')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  }
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
  return root
}

function addTable(root: HTMLElement): HTMLElement {
  const t = document.createElement('table')
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.textContent = 'cell'
  tr.appendChild(td)
  t.appendChild(tr)
  root.appendChild(t)
  return t
}

function testFrame(docKey: string): import('./canonical-heading-frame').CanonicalHeadingFrame {
  return {
    documentKey: docKey,
    semanticRevision: 1,
    editorStructureEpoch: 1,
    frameGeneration: 1,
    semanticFingerprint: 'test-semantic',
    frameFingerprint: 'test-frame',
    entries: [],
    entryByIdentity: new Map(),
  }
}

function flushScheduler(svc: CaptionService): void {
  ;(svc as unknown as { reconcileScheduler: { flushNow(): boolean } }).reconcileScheduler.flushNow()
}

/** Service whose ctx document identity can be mutated AFTER start (simulates
 *  the editor/active doc switching ahead of caption's committed context). */
function createMutableService(initialDocKey: string): {
  svc: CaptionService
  setDocKey: (k: string) => void
  setFrameEnabled: (enabled: boolean) => void
} {
  let docKey = initialDocKey
  let frameEnabled = true
  const root = makeRoot()
  const ctx: CaptionServiceContext = {
    vaultRoot: TEST_VAULT,
    getActiveFilePath: () => `/vault/${docKey}.md`,
    getDocumentKey: () => docKey,
    getEditorRoot: () => root,
    getHeadingNumberingSnapshot: () =>
      buildHeadingNumberingSnapshotForRevision([], DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault, undefined, undefined, 1, docKey),
    getCanonicalHeadingFrame: () => (frameEnabled ? testFrame(docKey) : null),
    getMarkdown: () => '',
  }
  const svc = new CaptionService(ctx)
  svc.start()
  flushScheduler(svc)
  return {
    svc,
    setDocKey: (k: string) => { docKey = k },
    setFrameEnabled: (enabled: boolean) => { frameEnabled = enabled },
  }
}

let services: CaptionService[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  cleanStore()
  setCaptionVaultRootForTesting(TEST_VAULT)
  services = []
})

afterEach(() => {
  for (const s of services) s.dispose()
  services = []
  clearCaptionVaultRootForTesting()
})

describe('PRE-SCAN — decideCaptionPreScanGate (pure)', () => {
  it('PRE-SCAN-1: active=B caption/coordinator=A → PARK_TRANSITIONAL_MISMATCH', () => {
    const v: CaptionPreScanGateVerdict = decideCaptionPreScanGate({
      activeDocumentKey: 'B',
      coordinatorDocumentKey: 'A',
      framePresent: true,
      frameDocumentKey: 'B',
      snapshotDocumentKey: null,
    })
    expect(v).toBe('PARK_TRANSITIONAL_MISMATCH')
  })

  it('PRE-SCAN-2: active=caption=coordinator=B + frame/snapshot none → WAIT_HEADING_AUTHORITY (not mismatch)', () => {
    const v: CaptionPreScanGateVerdict = decideCaptionPreScanGate({
      activeDocumentKey: 'B',
      coordinatorDocumentKey: 'B',
      framePresent: false,
      frameDocumentKey: null,
      snapshotDocumentKey: null,
    })
    expect(v).toBe('WAIT_HEADING_AUTHORITY')
  })

  it('READY: consistent context + matching frame', () => {
    const v: CaptionPreScanGateVerdict = decideCaptionPreScanGate({
      activeDocumentKey: 'B',
      coordinatorDocumentKey: 'B',
      framePresent: true,
      frameDocumentKey: 'B',
      snapshotDocumentKey: 'B',
    })
    expect(v).toBe('READY')
  })
})

describe('PRE-SCAN — CaptionService integration gate', () => {
  it('PRE-SCAN-1: transitional mismatch parks with zero scans (code/full/plan all 0)', () => {
    const { svc, setDocKey } = createMutableService('A')
    services.push(svc)
    const root = svc['currentEditorRoot'] as HTMLElement
    addTable(root)
    // Capture the post-start scan marker; a parked refresh must NOT change it.
    const scanBefore = (svc as unknown as { lastScanAt: number | null }).lastScanAt
    expect(scanBefore).not.toBeNull()

    // Active doc changes to B while caption/coordinator are still on A.
    setDocKey('B')
    svc.refresh('mutation:HEADING_SEMANTICS_CHANGED')

    const c = svc.getCaptionPreScanGateCounters()
    expect(c.checkCount).toBeGreaterThanOrEqual(1)
    expect(c.transitionalParkCount).toBe(1)
    expect(c.waitHeadingCount).toBe(0)
    // No scan / no target discovery / no plan build happened.
    expect((svc as unknown as { lastScanAt: number | null }).lastScanAt).toBe(scanBefore)
    expect(root.querySelectorAll('[data-inkchapter-caption]').length).toBe(0)
    expect(root.querySelectorAll('.inkchapter-caption').length).toBe(0)
  })

  it('PRE-SCAN-2: consistent context + no frame → WAIT_HEADING_AUTHORITY, authority gate blocks scan', () => {
    const { svc, setFrameEnabled } = createMutableService('B')
    services.push(svc)
    const root = svc['currentEditorRoot'] as HTMLElement
    addTable(root)
    const scanBefore = (svc as unknown as { lastScanAt: number | null }).lastScanAt

    // Active == coordinator == B, but the committed heading frame is gone.
    setFrameEnabled(false)
    svc.refresh('manual')

    const c = svc.getCaptionPreScanGateCounters()
    expect(c.transitionalParkCount).toBe(0) // NOT a transitional mismatch
    expect(c.waitHeadingCount).toBeGreaterThanOrEqual(1)
    // The 7R.3.9R authority gate performed the actual WAIT block → zero scans.
    expect((svc as unknown as { lastScanAt: number | null }).lastScanAt).toBe(scanBefore)
    expect(root.querySelectorAll('.inkchapter-caption').length).toBe(0)
  })

  it('PRE-SCAN-3: context ready + frame B → release EXACTLY ONE reconcile; parked stale requests not replayed', () => {
    const { svc, setDocKey } = createMutableService('A')
    services.push(svc)
    const root = svc['currentEditorRoot'] as HTMLElement
    addTable(root)

    // Two stale mutations while active=B / coordinator=A → both parked.
    setDocKey('B')
    svc.refresh('mutation:stale-1')
    svc.refresh('mutation:stale-2')
    expect(svc.getCaptionPreScanGateCounters().transitionalParkCount).toBe(2)

    // Real release: document switch completes (caption context now on B).
    const scanBeforeRelease = (svc as unknown as { lastScanAt: number | null }).lastScanAt
    ;(svc as unknown as { onDocumentChanged(): void }).onDocumentChanged()
    flushScheduler(svc)

    const c = svc.getCaptionPreScanGateCounters()
    expect(c.transitionalParkCount).toBe(2) // no new park during release
    expect((svc as unknown as { lastScanAt: number | null }).lastScanAt).not.toBe(scanBeforeRelease) // exactly one scan
    expect(root.querySelectorAll('.inkchapter-caption').length).toBe(1) // one table captioned once
  })

  it('PRE-SCAN-4: many stale mutations on the same transition token → no repeated full scan', () => {
    const { svc, setDocKey } = createMutableService('A')
    services.push(svc)
    const root = svc['currentEditorRoot'] as HTMLElement
    // Baseline BEFORE the stale-mutation storm: the start document-open reconcile
    // already consumed one gate check; assert DELTAS so the assertion is robust.
    const c0 = svc.getCaptionPreScanGateCounters()
    const scanBefore = (svc as unknown as { lastScanAt: number | null }).lastScanAt
    expect(c0.transitionalParkCount).toBe(0)

    setDocKey('B')
    for (let i = 0; i < 8; i++) {
      svc.refresh(`mutation:${i}`)
    }

    const c = svc.getCaptionPreScanGateCounters()
    expect(c.checkCount - c0.checkCount).toBe(8)
    expect(c.transitionalParkCount - c0.transitionalParkCount).toBe(8)
    expect((svc as unknown as { lastScanAt: number | null }).lastScanAt).toBe(scanBefore)
    expect(root.querySelectorAll('.inkchapter-caption').length).toBe(0)
  })
})

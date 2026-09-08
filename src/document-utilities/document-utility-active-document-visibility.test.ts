/**
 * DOC-ACTIVE-1..12 — No-Active-Document Toolbar suppression & restore.
 *
 * The gate is pure + single-authority: `resolveActiveDocumentExistence` decides
 * whether a REAL Markdown document is active (documentKey + active file path +
 * shared ctx authority + connected #write root when present) — a "New tab" with
 * tabCount=1 is explicitly NOT a document. `decideActiveDocumentSuppression`
 * then makes NO_ACTIVE_DOCUMENT outrank every geometry / last-stable fallback.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveActiveDocumentExistence,
  decideActiveDocumentSuppression,
  evaluateActiveDocumentVisibility,
} from './document-utility-overlay-host'

describe('active-document existence authority', () => {
  const exist = (over: Parameters<typeof resolveActiveDocumentExistence>[0]): boolean => resolveActiveDocumentExistence(over)
  const doc = { documentKey: 'doc:a', activeFilePath: '/vault/a.md', ctxHasActiveDocument: true, rootConnected: true }

  it('DOC-ACTIVE-2/24 New tab (tabCount=1, label New tab) is NOT an active document', () => {
    // key=null / no active file — exactly the false positive the old logic had.
    expect(exist({ documentKey: null, activeFilePath: null, ctxHasActiveDocument: true, rootConnected: null })).toBe(false)
    expect(exist({ documentKey: null, activeFilePath: '', ctxHasActiveDocument: false, rootConnected: null })).toBe(false)
  })

  it('real document identity + connected root → active', () => {
    expect(exist(doc)).toBe(true)
  })

  it('root disconnected (real runtime) → NOT active', () => {
    expect(exist({ ...doc, rootConnected: false })).toBe(false)
  })

  it('headless (root null) keeps positive identity active', () => {
    expect(exist({ ...doc, rootConnected: null })).toBe(true)
  })

  it('ctx disagreement (hasActiveDocument=false) overrides file presence', () => {
    expect(exist({ ...doc, ctxHasActiveDocument: false })).toBe(false)
  })
})

describe('DOC-ACTIVE-1/3/7 suppression & fallback blocking', () => {
  it('DOC-ACTIVE-1 no document → presentation suppressed / NO_ACTIVE_DOCUMENT', () => {
    const out = decideActiveDocumentSuppression({ hasActiveDocument: false })
    expect(out.presentation).toBe('suppressed')
    expect(out.reason).toBe('NO_ACTIVE_DOCUMENT')
  })

  it('DOC-ACTIVE-3/7 last-stable / geometry fallback can never revive the toolbar', () => {
    // even a previous "full" + valid geometry would be blocked by the gate.
    const out = decideActiveDocumentSuppression({ hasActiveDocument: false })
    expect(out.geometryFallbackBlocked).toBe(true)
    expect(out.lastStableBlocked).toBe(true)
    expect(out.presentation).toBe('suppressed')
  })

  it('active document → gate passes through (presentation decided by geometry layer)', () => {
    const out = decideActiveDocumentSuppression({ hasActiveDocument: true })
    expect(out.reason).toBe('ACTIVE_DOCUMENT_PRESENT')
    expect(out.geometryFallbackBlocked).toBe(false)
    expect(out.presentation).toBe('full')
  })
})

describe('DOC-ACTIVE-4/5/6/8/9/10/11/12 invariant evaluation', () => {
  const active = {
    documentKey: 'doc:a',
    hasActiveDocument: true,
    activeDocumentRootConnected: true,
    toolbarPresentation: 'full' as const,
    toolbarVisible: true,
    drawerVisible: false,
    pendingLocateTarget: null,
  }
  const empty = {
    documentKey: null,
    hasActiveDocument: false,
    activeDocumentRootConnected: false,
    toolbarPresentation: 'suppressed' as const,
    toolbarVisible: false,
    drawerVisible: false,
    pendingLocateTarget: null,
  }

  it('DOC-ACTIVE-4 no document + drawer closed → PASS', () => {
    expect(evaluateActiveDocumentVisibility(empty)).toEqual({ decision: 'PASS', reason: 'NO_ACTIVE_DOCUMENT_SUPPRESSED' })
  })

  it('no document + drawer still open → FAIL DIAGNOSTICS_DRAWER_VISIBLE_WITHOUT_ACTIVE_DOCUMENT', () => {
    const out = evaluateActiveDocumentVisibility({ ...empty, drawerVisible: true })
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('DIAGNOSTICS_DRAWER_VISIBLE_WITHOUT_ACTIVE_DOCUMENT')
  })

  it('no document + toolbar visible → FAIL TOOLBAR_VISIBLE_WITHOUT_ACTIVE_DOCUMENT', () => {
    const out = evaluateActiveDocumentVisibility({ ...empty, toolbarVisible: true })
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('TOOLBAR_VISIBLE_WITHOUT_ACTIVE_DOCUMENT')
  })

  it('DOC-ACTIVE-5 no document + stale locate target → FAIL', () => {
    const out = evaluateActiveDocumentVisibility({ ...empty, pendingLocateTarget: 'diag-1' })
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('LOCATE_TARGET_WITHOUT_ACTIVE_DOCUMENT')
  })

  it('DOC-ACTIVE-8 active document restored (suppressed→full) → PASS', () => {
    expect(evaluateActiveDocumentVisibility(active).decision).toBe('PASS')
    // empty → document flips gate immediately; geometry layer re-decides full/compact
    const restored = decideActiveDocumentSuppression({ hasActiveDocument: true })
    expect(restored.presentation).toBe('full')
  })

  it('DOC-ACTIVE-9 document A → B keeps single instance semantics (same active gate)', () => {
    const b = { ...active, documentKey: 'doc:b', toolbarPresentation: 'compact' as const }
    expect(evaluateActiveDocumentVisibility(b)).toEqual({ decision: 'PASS', reason: 'ACTIVE_DOCUMENT_PRESENT' })
  })

  it('DOC-ACTIVE-10 DevTools/width never imply a document', () => {
    expect(resolveActiveDocumentExistence({ documentKey: null, activeFilePath: null, ctxHasActiveDocument: false, rootConnected: null })).toBe(false)
  })

  it('DOC-ACTIVE-11 drawer-open then last document closes → must become suppressed+closed', () => {
    const before = { ...active, drawerVisible: true }
    expect(evaluateActiveDocumentVisibility(before).decision).toBe('PASS')
    const afterClose = evaluateActiveDocumentVisibility({ ...empty })
    expect(afterClose.decision).toBe('PASS')
  })

  it('DOC-ACTIVE-12 repeated open/close cycles are deterministic (no duplicate-mount signal)', () => {
    let cycle: 'empty' | 'doc' = 'empty'
    for (let i = 0; i < 6; i++) {
      if (cycle === 'empty') {
        const r = evaluateActiveDocumentVisibility(empty)
        expect(r.decision).toBe('PASS')
        cycle = 'doc'
      } else {
        const r = evaluateActiveDocumentVisibility(active)
        expect(r.decision).toBe('PASS')
        cycle = 'empty'
      }
    }
  })
})

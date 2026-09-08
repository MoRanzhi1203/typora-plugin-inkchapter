/**
 * LAST-TAB-1..12 — Close-Last-Tab Active-Leaf Presence (pure decision).
 *
 * ROOT_CAUSE=EXPLICIT_EMPTY_ACTIVE_LEAF_IS_OVERRIDDEN_BY_STALE_ACTIVE_FILE_OR_DOCUMENT_KEY
 *
 * The active workspace leaf (`activeLeaf.state.path`) is the ACTIVE DOCUMENT
 * PRESENCE AUTHORITY. An EXPLICIT EMPTY leaf hard-vetoes stale
 * workspace.activeFile/documentKey; ONLY an unreadable leaf (UNKNOWN) may use
 * the legacy fallback (logged, never silent). Pure — no DOM dependency.
 */
import { describe, it, expect } from 'vitest'
import { resolveActiveDocumentPresence } from './document-active-leaf-presence'
import type { ActiveDocumentPresenceDecision, ActiveDocumentPresenceInput } from './document-active-leaf-presence'

function decide(over: Partial<ActiveDocumentPresenceInput> = {}): ActiveDocumentPresenceDecision {
  return resolveActiveDocumentPresence({
    leafStateKnown: over.leafStateKnown ?? false,
    leafPath: over.leafPath ?? null,
    workspaceActiveFilePath: over.workspaceActiveFilePath ?? null,
    documentKey: over.documentKey ?? null,
  })
}

const staleReadme = { workspaceActiveFilePath: 'README.md', documentKey: 'README.md' }

describe('LAST-TAB-1..12 — active-leaf three-state presence', () => {
  it('LAST-TAB-1 leaf="" + activeFile=README + documentKey=README → EMPTY', () => {
    const d = decide({ leafStateKnown: true, leafPath: '', ...staleReadme })
    expect(d.state).toBe('EMPTY')
    expect(d.source).toBe('ACTIVE_LEAF_EMPTY')
    expect(d.path).toBeNull()
    expect(d.hasActiveDocument).toBe(false)
    expect(d.legacyFallbackUsed).toBe(false)
  })

  it('LAST-TAB-2 leaf="" + activeFile=null + documentKey=null → EMPTY', () => {
    const d = decide({ leafStateKnown: true, leafPath: '', workspaceActiveFilePath: null, documentKey: null })
    expect(d.state).toBe('EMPTY')
    expect(d.identityConflict).toBe(false)
    expect(d.hasActiveDocument).toBe(false)
  })

  it('LAST-TAB-3 leaf="README.md" → ACTIVE', () => {
    const d = decide({ leafStateKnown: true, leafPath: 'README.md', ...staleReadme })
    expect(d.state).toBe('ACTIVE')
    expect(d.source).toBe('ACTIVE_LEAF_PATH')
    expect(d.path).toBe('README.md')
    expect(d.identityConflict).toBe(false)
    expect(d.hasActiveDocument).toBe(true)
    expect(d.legacyFallbackUsed).toBe(false)
  })

  it('LAST-TAB-4 leaf unavailable + activeFile=README + documentKey=README → UNKNOWN → legacy ACTIVE', () => {
    const d = decide({ leafStateKnown: false, leafPath: null, ...staleReadme })
    expect(d.state).toBe('UNKNOWN')
    expect(d.source).toBe('ACTIVE_LEAF_UNAVAILABLE')
    expect(d.legacyFallbackUsed).toBe(true)
    expect(d.legacyFallbackSource).toBe('ACTIVE_FILE')
    expect(d.hasActiveDocument).toBe(true)
  })

  it('LAST-TAB-5 leaf unavailable + no fallback → UNKNOWN → NO ACTIVE', () => {
    const d = decide({ leafStateKnown: false, leafPath: null, workspaceActiveFilePath: null, documentKey: null })
    expect(d.state).toBe('UNKNOWN')
    expect(d.legacyFallbackUsed).toBe(true)
    expect(d.legacyFallbackSource).toBe('NONE')
    expect(d.hasActiveDocument).toBe(false)
  })

  it('LAST-TAB-6 ACTIVE → tab:toggle(path="") → immediate suppressed (no fallback)', () => {
    // Same stale identity remains present; the empty leaf still wins instantly.
    const d = decide({ leafStateKnown: true, leafPath: '', ...staleReadme })
    expect(d.state).toBe('EMPTY')
    expect(d.hasActiveDocument).toBe(false)
    expect(d.legacyFallbackUsed).toBe(false)
  })

  it('LAST-TAB-7 EMPTY → tab:toggle(path="README.md") → automatic restore', () => {
    const d = decide({ leafStateKnown: true, leafPath: 'README.md', ...staleReadme })
    expect(d.state).toBe('ACTIVE')
    expect(d.hasActiveDocument).toBe(true)
  })

  it('LAST-TAB-8 leaf="" + last-stable full → suppressed (EMPTY wins over any stable presentation)', () => {
    // "last stable full" is represented by the stale file/key still present.
    const d = decide({ leafStateKnown: true, leafPath: '', ...staleReadme })
    expect(d.state).toBe('EMPTY')
    expect(d.hasActiveDocument).toBe(false)
  })

  it('LAST-TAB-10 leaf="" + stale README identity → identityConflict=true but presence stays EMPTY', () => {
    const d = decide({ leafStateKnown: true, leafPath: '', ...staleReadme })
    expect(d.identityConflict).toBe(true)
    expect(d.state).toBe('EMPTY')
    expect(d.hasActiveDocument).toBe(false)
  })

  it('LAST-TAB-11 explicit empty NEVER uses legacy fallback', () => {
    for (const combos of [
      { workspaceActiveFilePath: 'README.md', documentKey: 'README.md' },
      { workspaceActiveFilePath: null, documentKey: 'README.md' },
      { workspaceActiveFilePath: 'README.md', documentKey: null },
      { workspaceActiveFilePath: null, documentKey: null },
    ]) {
      const d = decide({ leafStateKnown: true, leafPath: '', ...combos })
      expect(d.state).toBe('EMPTY')
      expect(d.legacyFallbackUsed).toBe(false)
      expect(d.legacyFallbackSource).toBe('NONE')
      expect(d.hasActiveDocument).toBe(false)
    }
  })
})

describe('LAST-TAB §24 — false-positive regression (THE most important case)', () => {
  it('leafStateKnown=true leafPath="" workspaceActiveFilePath=README.md documentKey=README.md', () => {
    const d = decide({ leafStateKnown: true, leafPath: '', workspaceActiveFilePath: 'README.md', documentKey: 'README.md' })
    expect(d.state).toBe('EMPTY')
    expect(d.source).toBe('ACTIVE_LEAF_EMPTY')
    expect(d.identityConflict).toBe(true)
    expect(d.legacyFallbackUsed).toBe(false)
    expect(d.hasActiveDocument).toBe(false)
  })
})

describe('LAST-TAB-9/12 companion pure invariants', () => {
  it('known empty leaf has zero positive document signal anywhere in the decision', () => {
    const d = decide({ leafStateKnown: true, leafPath: '', ...staleReadme })
    expect(d.hasActiveDocument).toBe(false)
    expect(d.identityConflict).toBe(true) // conflict recorded — never decides
    expect(d.source).toBe('ACTIVE_LEAF_EMPTY')
  })

  it('repeated ACTIVE↔EMPTY pure toggles are deterministic', () => {
    const states: string[] = []
    let empty = false
    for (let i = 0; i < 6; i++) {
      empty = !empty
      const d = decide(
        empty
          ? { leafStateKnown: true, leafPath: '', ...staleReadme }
          : { leafStateKnown: true, leafPath: 'README.md', ...staleReadme },
      )
      states.push(d.state)
    }
    expect(states).toEqual(['EMPTY', 'ACTIVE', 'EMPTY', 'ACTIVE', 'EMPTY', 'ACTIVE'])
  })
})

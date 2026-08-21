import { describe, it, expect } from 'vitest'
import { resolveDocumentRuntimeContext } from './document-runtime-context'

// R58.7 PERSISTED→PERSISTED Document-Switch Scope Authority — DS-1..DS-4

const VAULT = 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault'
const PATH_A = `${VAULT}\\regression\\r58\\r58-docswitch-scope-a.md`
const PATH_B = `${VAULT}\\regression\\r58\\r58-docswitch-scope-b.md`
const KEY_A = 'regression/r58/r58-docswitch-scope-a.md'
const KEY_B = 'regression/r58/r58-docswitch-scope-b.md'
const SESSION = 'session-ds'
const EDITOR = 'editor-1'

describe('resolveDocumentRuntimeContext — scope authority (DS)', () => {
  it('DS-1: PERSISTED A → PERSISTED B switches scopeId A→B (no stale preserve)', () => {
    const before = resolveDocumentRuntimeContext(VAULT, PATH_A, KEY_A, SESSION, true, EDITOR, KEY_A)
    expect(before.mode).toBe('PERSISTED')
    expect(before.scopeId).toBe(KEY_A)
    expect(before.persistenceKey).toBe(KEY_A)

    // Switch to B while the caller still passes the old scope A as existingScopeId.
    const after = resolveDocumentRuntimeContext(VAULT, PATH_B, KEY_B, SESSION, true, EDITOR, KEY_A)
    expect(after.mode).toBe('PERSISTED')
    expect(after.scopeId).toBe(KEY_B)
    expect(after.persistenceKey).toBe(KEY_B)
    expect(after.scopeId).not.toBe(KEY_A)
  })

  it('DS-2: PERSISTED A → PERSISTED A keeps scope unchanged (refresh)', () => {
    const after = resolveDocumentRuntimeContext(VAULT, PATH_A, KEY_A, SESSION, true, EDITOR, KEY_A)
    expect(after.mode).toBe('PERSISTED')
    expect(after.scopeId).toBe(KEY_A)
    expect(after.persistenceKey).toBe(KEY_A)
  })

  it('DS-3: EPHEMERAL → PERSISTED (Save As) moves scope to the new documentKey', () => {
    const ephemeral = resolveDocumentRuntimeContext(VAULT, null, null, SESSION, true, EDITOR, null)
    expect(ephemeral.mode).toBe('EPHEMERAL')
    expect(ephemeral.scopeId).toMatch(/^untitled:/)

    const promoted = resolveDocumentRuntimeContext(VAULT, PATH_B, KEY_B, SESSION, true, EDITOR, ephemeral.scopeId)
    expect(promoted.mode).toBe('PERSISTED')
    expect(promoted.scopeId).toBe(KEY_B)
    expect(promoted.persistenceKey).toBe(KEY_B)
  })

  it('DS-4: resolver is pure — input not mutated, output is a fresh deterministic object', () => {
    const existing = KEY_A
    const r1 = resolveDocumentRuntimeContext(VAULT, PATH_B, KEY_B, SESSION, true, EDITOR, existing)
    const r2 = resolveDocumentRuntimeContext(VAULT, PATH_B, KEY_B, SESSION, true, EDITOR, existing)

    expect(existing).toBe(KEY_A)
    expect(r1.scopeId).toBe(KEY_B)
    expect(r1.scopeId).toBe(r2.scopeId)
    expect(r1.persistenceKey).toBe(r2.persistenceKey)
    expect(r1).not.toBe(r2)
  })
})

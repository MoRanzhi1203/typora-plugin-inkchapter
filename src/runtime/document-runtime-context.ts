// ── R58.7 Phase A.1: Ephemeral Document Runtime Context ──
// Splits READY into businessReady + persistenceReady.
// Supports EPHEMERAL (Untitled) mode where live business runs without persistence.

// ── R58.7 Phase A.1.3.1: Immutable Runtime Scope Reference ──

export interface RuntimeScopeRef {
  readonly scopeId: string
  readonly persistenceKey: string | null
  readonly mode: 'EPHEMERAL' | 'PERSISTED'
  readonly sessionId: string
  readonly editorInstanceId: string
}

export type DocumentRuntimeMode =
  | 'NO_EDITOR'
  | 'EPHEMERAL'
  | 'PERSISTED'

export type DocumentBusinessReason =
  | 'READY'
  | 'NO_EDITOR'
  | 'EDITOR_SCOPE_MISSING'

export type DocumentPersistenceReason =
  | 'READY'
  | 'ACTIVE_FILE_MISSING'
  | 'PERSISTENCE_KEY_MISSING'
  | 'VAULT_MISSING'
  | 'FILE_OUTSIDE_VAULT'

export interface DocumentRuntimeContext {
  mode: DocumentRuntimeMode
  scopeId: string | null
  sessionId: string
  editorInstanceId: string | null
  vaultRoot: string | null
  activeFilePath: string | null
  persistenceKey: string | null
  businessReady: boolean
  persistenceReady: boolean
  businessReason: DocumentBusinessReason
  persistenceReason: DocumentPersistenceReason
}

export interface EphemeralScopeParams {
  sessionId: string
  editorInstanceId: string | null
  vaultRoot: string | null
  /** Whether an editor root element exists in the DOM. Distinguishes EPHEMERAL from NO_EDITOR. */
  editorRootExists: boolean
}

/**
 * Resolve document runtime context for any editor state.
 *
 * Three modes:
 * - NO_EDITOR: no editor root exists — nothing is ready
 * - EPHEMERAL: editor root exists but no file path (Untitled) — business ready, persistence blocked
 * - PERSISTED: editor root + file path — everything ready
 */
export function resolveDocumentRuntimeContext(
  vaultRoot: string | null,
  activeFilePath: string | null,
  documentKey: string | null,
  sessionId: string,
  editorRootExists: boolean,
  editorInstanceId: string | null,
  existingScopeId: string | null,
): DocumentRuntimeContext {
  // ── Determine mode ──
  let mode: DocumentRuntimeMode
  if (!editorRootExists) {
    mode = 'NO_EDITOR'
  } else if (!activeFilePath || activeFilePath.trim() === '') {
    mode = 'EPHEMERAL'
  } else {
    mode = 'PERSISTED'
  }

  // ── Determine scopeId ──
  let scopeId: string | null
  if (mode === 'NO_EDITOR') {
    scopeId = null
  } else if (mode === 'EPHEMERAL') {
    // Preserve existing scopeId across refreshes if same editor instance
    if (existingScopeId && existingScopeId.startsWith('untitled:')) {
      scopeId = existingScopeId
    } else {
      scopeId = `untitled:${sessionId}:${editorInstanceId ?? 'unknown'}`
    }
  } else {
    // PERSISTED: scopeId must always follow the current documentKey.
    // Never preserve a stale non-untitled scope across a document switch.
    scopeId = documentKey ?? `persisted:${sessionId}:${editorInstanceId ?? 'unknown'}`
  }

  // ── Determine persistenceKey ──
  let persistenceKey: string | null = null
  if (mode === 'PERSISTED') {
    persistenceKey = documentKey
  }

  // ── Resolve business readiness ──
  let businessReady: boolean
  let businessReason: DocumentBusinessReason
  if (mode === 'NO_EDITOR') {
    businessReady = false
    businessReason = 'NO_EDITOR'
  } else if (!scopeId) {
    businessReady = false
    businessReason = 'EDITOR_SCOPE_MISSING'
  } else {
    businessReady = true
    businessReason = 'READY'
  }

  // ── Resolve persistence readiness ──
  let persistenceReady: boolean
  let persistenceReason: DocumentPersistenceReason
  if (mode !== 'PERSISTED') {
    persistenceReady = false
    persistenceReason = 'ACTIVE_FILE_MISSING'
  } else if (!vaultRoot || vaultRoot.trim() === '') {
    persistenceReady = false
    persistenceReason = 'VAULT_MISSING'
  } else if (!persistenceKey || persistenceKey.trim() === '') {
    persistenceReady = false
    persistenceReason = 'PERSISTENCE_KEY_MISSING'
  } else {
    const normalizedVault = vaultRoot.replace(/\\/g, '/').toLowerCase()
    const normalizedFile = (activeFilePath ?? '').replace(/\\/g, '/').toLowerCase()
    if (!normalizedFile.startsWith(normalizedVault)) {
      persistenceReady = false
      persistenceReason = 'FILE_OUTSIDE_VAULT'
    } else {
      persistenceReady = true
      persistenceReason = 'READY'
    }
  }

  return {
    mode,
    scopeId,
    sessionId,
    editorInstanceId,
    vaultRoot,
    activeFilePath,
    persistenceKey,
    businessReady,
    persistenceReady,
    businessReason,
    persistenceReason,
  }
}

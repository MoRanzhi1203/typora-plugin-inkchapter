/**
 * V3 — Close-Last-Tab Active Leaf Presence (pure decision authority).
 *
 * ROOT_CAUSE=EXPLICIT_EMPTY_ACTIVE_LEAF_IS_OVERRIDDEN_BY_STALE_ACTIVE_FILE_OR_DOCUMENT_KEY
 *
 * The ACTIVE workspace leaf (`activeLeaf.state.path`) is the highest-priority
 * ACTIVE DOCUMENT PRESENCE AUTHORITY. A truly empty leaf — after the last real
 * tab is closed — must HARD-VETO every stale `workspace.activeFile` /
 * `documentKey` fallback, because Typora may still keep the previous file in
 * `File.filePath` while the editor already sits on a New tab / no file.
 *
 * Three-state decision model:
 *
 *   leaf state known + path != ""            → ACTIVE  (ACTIVE_LEAF_PATH)
 *   leaf state known + path == "" / null     → EMPTY   (ACTIVE_LEAF_EMPTY)
 *   leaf state unreadable                    → UNKNOWN (ACTIVE_LEAF_UNAVAILABLE)
 *
 * ONLY UNKNOWN may use the legacy workspace.activeFile / documentKey /
 * activeFilePath fallback, and that fallback is explicitly logged
 * (legacyFallbackUsed=true). EMPTY never falls back.
 *
 * This module is PURE — no DOM, no `window`, no framework import — so the
 * identity logic is unit-testable (LAST-TAB-1..12) without any environment.
 */

export type ActiveDocumentPresenceState = 'ACTIVE' | 'EMPTY' | 'UNKNOWN'

export type ActiveDocumentPresenceSource =
  | 'ACTIVE_LEAF_PATH'
  | 'ACTIVE_LEAF_EMPTY'
  | 'ACTIVE_LEAF_UNAVAILABLE'

export type ActiveDocumentLegacyFallbackSource = 'ACTIVE_FILE' | 'DOCUMENT_KEY' | 'NONE'

/** Normalized facts read from the REAL active workspace leaf. */
export interface ActiveLeafDocumentFacts {
  /** Whether the active leaf state could be read at all. */
  leafStateKnown: boolean
  /**
   * Normalized path: '' means the active leaf is known to hold NO real
   * Markdown document (New tab / empty view / untitled). null accompanies
   * leafStateKnown=false (leaf unreadable). A real file path otherwise.
   */
  leafPath: string | null
}

export interface ActiveDocumentPresenceInput {
  leafStateKnown: boolean
  leafPath: string | null
  workspaceActiveFilePath: string | null
  documentKey: string | null
}

export interface ActiveDocumentPresenceDecision {
  state: ActiveDocumentPresenceState
  source: ActiveDocumentPresenceSource
  path: string | null
  /**
   * Explicit-empty leaf AND a stale file/document-key identity still present.
   * The identity conflict is RECORDED, but the final presence stays EMPTY.
   */
  identityConflict: boolean
  hasActiveDocument: boolean
  /** true ONLY in the UNKNOWN branch — never for a known empty leaf. */
  legacyFallbackUsed: boolean
  legacyFallbackSource: ActiveDocumentLegacyFallbackSource
}

/**
 * Normalize a raw leaf `state.path` value into the pure decision input.
 *
 * - null / '' / `typ://…` (framework New-tab / empty view)  → ''
 *   (a real file path never starts with `typ://`)
 * - anything else                                          → that path string
 *
 * Returns `''` for a KNOWN empty leaf so the caller can keep
 * leafStateKnown=true with an explicit empty path.
 */
export function normalizeActiveLeafDocumentPath(raw: unknown): string | null {
  if (raw === undefined || raw === null) return ''
  const s = String(raw)
  if (s === '') return ''
  if (s.startsWith('typ://')) return ''
  return s
}

/** Is this path a real (non-empty) Markdown document path? */
export function isRealActiveLeafDocumentPath(path: string | null): path is string {
  return path != null && path !== ''
}

/**
 * THE three-state pure decision.
 *
 * Hard rules:
 *  1. leafStateKnown + empty path           → EMPTY  (never falls back).
 *  2. leafStateKnown + real path            → ACTIVE (leaf is authoritative).
 *  3. leafStateKnown=false                  → UNKNOWN (legacy fallback only here).
 *
 * identityConflict is recorded (never decides) — the leaf wins either way.
 */
export function resolveActiveDocumentPresence(
  input: ActiveDocumentPresenceInput,
): ActiveDocumentPresenceDecision {
  const path = input.leafPath == null ? null : String(input.leafPath)

  if (input.leafStateKnown) {
    if (!isRealActiveLeafDocumentPath(path)) {
      const conflict =
        (input.workspaceActiveFilePath != null && input.workspaceActiveFilePath !== '') ||
        (input.documentKey != null && input.documentKey !== '')
      return {
        state: 'EMPTY',
        source: 'ACTIVE_LEAF_EMPTY',
        path: null,
        identityConflict: conflict,
        hasActiveDocument: false,
        legacyFallbackUsed: false,
        legacyFallbackSource: 'NONE',
      }
    }
    return {
      state: 'ACTIVE',
      source: 'ACTIVE_LEAF_PATH',
      path,
      identityConflict: false,
      hasActiveDocument: true,
      legacyFallbackUsed: false,
      legacyFallbackSource: 'NONE',
    }
  }

  // ONLY UNKNOWN: legacy fallback participates — and is explicitly logged.
  const filePresent = input.workspaceActiveFilePath != null && input.workspaceActiveFilePath !== ''
  const keyPresent = input.documentKey != null && input.documentKey !== ''
  return {
    state: 'UNKNOWN',
    source: 'ACTIVE_LEAF_UNAVAILABLE',
    path: null,
    identityConflict: false,
    hasActiveDocument: filePresent || keyPresent,
    legacyFallbackUsed: true,
    legacyFallbackSource: filePresent ? 'ACTIVE_FILE' : keyPresent ? 'DOCUMENT_KEY' : 'NONE',
  }
}

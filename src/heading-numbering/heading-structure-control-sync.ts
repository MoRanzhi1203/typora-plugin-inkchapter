/**
 * Phase 7R.3.11.8B.7 — Heading Structure Control Surface Synchronization.
 *
 * ROOT_CAUSE_FAMILY = HEADING_STRUCTURE_CONTROL_SURFACE_STATE_SPLIT.
 *
 * Every control surface (Outline `...` menu, Settings Current Document,
 * Settings Global Default, renderer, outline renderer, diagnostics, caption,
 * formula) must observe the SAME effective mode. This module is the PURE
 * authority: one saved-scope model, one effective resolver, one draft
 * lifecycle. All UI is a read-only projection; all writes go through
 * `setHeadingStructureMode`.
 *
 * Layer separation:
 *   1. SAVED_GLOBAL            (globalDefault.headingStructureMode)
 *   2. SAVED_DOCUMENT_OVERRIDE (documentOverrides[docKey].headingStructureMode)
 *   3. EFFECTIVE / RESOLVED    (override ?? global)
 *   4. SETTINGS_DRAFT          (CLEAN / DIRTY / CONFLICTED lifecycle)
 */
import type { HeadingStructureMode } from './heading-structure'

// ── Scope model ────────────────────────────────────────

export type HeadingStructureWriteScope = 'global' | 'document'
export type DocumentHeadingScopeState = 'inherit' | 'strict' | 'loose'
export type HeadingStructureWriteSource =
  | 'OUTLINE_MENU'
  | 'SETTINGS_CURRENT_DOCUMENT'
  | 'SETTINGS_GLOBAL_DEFAULT'
  | 'COMMAND'
  | 'MIGRATION'
  | 'RUNTIME_TEST'

export type HeadingDraftState = 'CLEAN' | 'DIRTY' | 'CONFLICTED'

/**
 * Single effective-mode rule: document override wins, otherwise global.
 * All runtime consumers (renderer / outline / diagnostics / caption / formula
 * / outline menu) MUST read this — never global, draft, or legacy flags.
 */
export function resolveEffectiveHeadingMode(
  savedGlobalMode: HeadingStructureMode,
  documentOverrideMode: HeadingStructureMode | null | undefined,
): HeadingStructureMode {
  return documentOverrideMode ?? savedGlobalMode
}

/** Current-document scope state: override present → strict/loose; absent → inherit. */
export function resolveDocumentScopeState(
  documentOverrideMode: HeadingStructureMode | null | undefined,
): DocumentHeadingScopeState {
  return documentOverrideMode ?? 'inherit'
}

/**
 * Legacy mirror: headingStructureMode is the SINGLE authority.
 * strict → showLevelOneNumber=false, loose → true. Never a second authority.
 */
export function deriveLegacyShowLevelOneNumber(mode: HeadingStructureMode): boolean {
  return mode === 'loose'
}

// ── Draft lifecycle ────────────────────────────────────

export interface HeadingDraftModel {
  /** Which saved scope this draft is editing (global vs current document). */
  scope: HeadingStructureWriteScope
  documentKey: string | null
  /** Saved scope mode at draft init (the baseline the user started from). */
  baseSavedModeAtInit: HeadingStructureMode | null
  /** The current saved mode (may have changed externally after init). */
  currentSavedMode: HeadingStructureMode | null
  /** The user's unsaved draft mode (null = draft carries no mode edit). */
  draftMode: HeadingStructureMode | null
}

/**
 * Draft lifecycle (pure):
 *   - draft == current saved                → CLEAN (incl. "external made the
 *     same change while DIRTY" → auto-clean)
 *   - draft != current saved AND base unchanged (no external change since
 *     init) → DIRTY
 *   - draft != current saved AND base CHANGED externally → CONFLICTED
 * CONFLICTED NEVER silently overwrites the draft.
 */
export function computeHeadingDraftState(model: HeadingDraftModel): HeadingDraftState {
  const { baseSavedModeAtInit, currentSavedMode, draftMode } = model
  if (draftMode == null || currentSavedMode == null) return 'CLEAN'
  if (draftMode === currentSavedMode) return 'CLEAN'
  if (baseSavedModeAtInit === currentSavedMode) return 'DIRTY'
  return 'CONFLICTED'
}

/** Clean draft: rebase onto the newest saved state (automatic, no user action). */
export function rebaseCleanDraft(
  scope: HeadingStructureWriteScope,
  documentKey: string | null,
  newSavedMode: HeadingStructureMode,
): HeadingDraftModel {
  return {
    scope,
    documentKey,
    baseSavedModeAtInit: newSavedMode,
    currentSavedMode: newSavedMode,
    draftMode: newSavedMode,
  }
}

// ── Write transaction (pure snapshot for the MODE-WRITE audit) ──

export interface ModeWriteSnapshot {
  scope: HeadingStructureWriteScope
  documentKey: string | null
  source: HeadingStructureWriteSource
  beforeGlobal: HeadingStructureMode
  afterGlobal: HeadingStructureMode
  beforeDocumentOverride: HeadingStructureMode | null
  afterDocumentOverride: HeadingStructureMode | null
  beforeEffective: HeadingStructureMode
  afterEffective: HeadingStructureMode
  legacyBefore: boolean
  legacyAfter: boolean
}

/**
 * Compute the before/after state of a single mode write WITHOUT mutating
 * anything (the service performs the actual persist + refresh transaction).
 * Returns null when the write is a NO_OP (idempotent — no transition).
 */
export function planHeadingStructureModeWrite(
  savedGlobalMode: HeadingStructureMode,
  documentOverrideMode: HeadingStructureMode | null | undefined,
  scope: HeadingStructureWriteScope,
  mode: HeadingStructureMode,
  source: HeadingStructureWriteSource,
  documentKey: string | null,
): ModeWriteSnapshot | null {
  const beforeGlobal = savedGlobalMode
  const beforeOverride = documentOverrideMode ?? null
  const beforeEffective = resolveEffectiveHeadingMode(beforeGlobal, beforeOverride)
  const afterGlobal = scope === 'global' ? mode : beforeGlobal
  const afterOverride = scope === 'document' ? mode : beforeOverride
  const afterEffective = resolveEffectiveHeadingMode(afterGlobal, afterOverride)
  const snapshot: ModeWriteSnapshot = {
    scope,
    documentKey,
    source,
    beforeGlobal,
    afterGlobal,
    beforeDocumentOverride: beforeOverride,
    afterDocumentOverride: afterOverride,
    beforeEffective,
    afterEffective,
    legacyBefore: deriveLegacyShowLevelOneNumber(beforeEffective),
    legacyAfter: deriveLegacyShowLevelOneNumber(afterEffective),
  }
  if (beforeEffective === afterEffective && beforeOverride === afterOverride && beforeGlobal === afterGlobal) {
    return null // idempotent NO_OP
  }
  return snapshot
}

/** Write request used by every control surface (single write authority). */
export interface HeadingStructureModeWriteRequest {
  scope: HeadingStructureWriteScope
  documentKey: string | null
  mode: HeadingStructureMode
  source: HeadingStructureWriteSource
}

/** Clear a document override (back to inherit). */
export interface HeadingStructureOverrideClearRequest {
  documentKey: string | null
  source: HeadingStructureWriteSource
}

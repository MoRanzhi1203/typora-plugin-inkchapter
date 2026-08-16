/**
 * Document Format Binding — the authoritative inherit/override state model for
 * "which numbering format does this document use".
 *
 * This is a PURE module (no DOM, no settings I/O). It is the single source of
 * truth for resolving the four distinct concepts:
 *
 *   globalDefaultFormatId  — the system/global default format
 *   documentFormatMode     — inherit | override
 *   documentOverrideFormatId — valid only in override mode
 *   effectiveFormatId      — computed, never a second persisted truth
 *
 * Design invariant:
 *   inherit  = the document has NO format binding of its own; effective follows
 *              the global default dynamically.
 *   override = the document is explicitly bound to a format; it does NOT follow
 *              the global default.
 */

import type { HeadingNumberingScopeStore, NumberingFormatSource } from './heading-types'

export type DocumentFormatMode = 'inherit' | 'override'

export interface DocumentFormatBinding {
  mode: DocumentFormatMode
  overrideFormatId: string | null
}

export interface ResolvedDocumentFormat {
  mode: DocumentFormatMode
  globalDefaultFormatId: string
  overrideFormatId: string | null
  effectiveFormatId: string
  source: 'global-default' | 'document-override'
}

/** The three independent card badges (only real states are shown). */
export interface FormatBadges {
  /** mode=override && overrideFormatId === thisFormatId */
  currentDocument: boolean
  /** globalDefaultFormatId === thisFormatId */
  globalDefault: boolean
  /** effectiveFormatId === thisFormatId (inherit OR override) */
  effective: boolean
}

// ── Format reference keys ───────────────────────────────────────────

/** A built-in preset is referenced by its stable presetId. */
export function builtInFormatRef(presetId: string): string {
  return `preset:${presetId}`
}

/** A custom library format is referenced by its stable format id (never name). */
export function customFormatRef(formatId: string): string {
  return `format:${formatId}`
}

/**
 * Convert a persisted NumberingFormatSource into a stable format reference key.
 * `snapshot` (document independent settings, no library reference) returns null.
 */
export function formatRefKey(source: NumberingFormatSource | null | undefined): string | null {
  if (!source) return null
  if (source.type === 'built-in') return builtInFormatRef(source.presetId)
  if (source.type === 'custom') return customFormatRef(source.formatId)
  return null
}

/** Repair fallback when global default format cannot be resolved. */
export const DEFAULT_BUILT_IN_FORMAT_REF = builtInFormatRef('decimal-hierarchical')

// ── Resolvers ────────────────────────────────────────────────────────

/**
 * Resolve the global default format reference. Prefers the persisted
 * `formatSource`, then falls back to the `preset` field (for built-in presets),
 * and finally to the built-in default (repair path).
 */
export function resolveGlobalDefaultFormatRef(
  store: HeadingNumberingScopeStore | null | undefined,
): string {
  const gd = (store?.globalDefault ?? {}) as {
    formatSource?: NumberingFormatSource
    preset?: string
  }
  const fromSource = formatRefKey(gd.formatSource)
  if (fromSource) return fromSource
  if (typeof gd.preset === 'string' && gd.preset !== '' && gd.preset !== 'custom') {
    return builtInFormatRef(gd.preset)
  }
  return DEFAULT_BUILT_IN_FORMAT_REF
}

/**
 * Resolve the document's format binding from the scope store.
 * A document override only counts as an override when it carries a real
 * format reference; otherwise (layout-only / paragraph-only / missing ref)
 * the document inherits the global default at the FORMAT level.
 */
export function resolveDocumentFormatBinding(
  store: HeadingNumberingScopeStore | null | undefined,
  documentKey: string | null,
): DocumentFormatBinding {
  if (!store || !documentKey) return { mode: 'inherit', overrideFormatId: null }
  const override = store.documentOverrides[documentKey]
  if (!override) return { mode: 'inherit', overrideFormatId: null }

  const ref = formatRefKey(override.formatSource)
  if (ref) return { mode: 'override', overrideFormatId: ref }

  // Fallback: a built-in preset snapshot without an explicit formatSource.
  const preset = override.settings?.preset
  if (preset && preset !== 'custom') {
    return { mode: 'override', overrideFormatId: builtInFormatRef(preset) }
  }

  return { mode: 'inherit', overrideFormatId: null }
}

/** Unified effective resolver — the ONLY place effectiveFormatId is computed. */
export function resolveEffectiveFormatId(
  binding: DocumentFormatBinding,
  globalDefaultFormatId: string,
): string {
  if (binding.mode === 'override' && binding.overrideFormatId) return binding.overrideFormatId
  return globalDefaultFormatId
}

/** Unified resolved state for UI / renderer / persistence consumers. */
export function resolveDocumentFormatState(
  binding: DocumentFormatBinding,
  globalDefaultFormatId: string,
): ResolvedDocumentFormat {
  const mode = binding.mode
  const overrideFormatId = mode === 'override' ? binding.overrideFormatId : null
  const effectiveFormatId = resolveEffectiveFormatId(binding, globalDefaultFormatId)
  return {
    mode,
    globalDefaultFormatId,
    overrideFormatId,
    effectiveFormatId,
    source: mode === 'override' ? 'document-override' : 'global-default',
  }
}

/** Resolve the three card badges for a given format reference. */
export function resolveFormatBadges(
  resolved: ResolvedDocumentFormat,
  formatRef: string,
): FormatBadges {
  return {
    currentDocument: resolved.mode === 'override' && resolved.overrideFormatId === formatRef,
    globalDefault: resolved.globalDefaultFormatId === formatRef,
    effective: resolved.effectiveFormatId === formatRef,
  }
}

/** References to a format across the store (for delete protection). */
export interface FormatReferences {
  isGlobalDefault: boolean
  overrideDocumentKeys: string[]
}

/**
 * Find every reference to a format (global default + document overrides).
 * Pure + testable; used to BLOCK deletion of in-use formats.
 */
export function findFormatReferences(
  store: HeadingNumberingScopeStore | null | undefined,
  formatRef: string,
): FormatReferences {
  const isGlobalDefault = resolveGlobalDefaultFormatRef(store) === formatRef
  const overrideDocumentKeys: string[] = []
  for (const [docKey, override] of Object.entries(store?.documentOverrides ?? {})) {
    const ref = formatRefKey(override.formatSource)
    if (ref === formatRef) {
      overrideDocumentKeys.push(docKey)
      continue
    }
    // Fallback: built-in preset snapshot without an explicit formatSource.
    const preset = override.settings?.preset
    if (preset && preset !== 'custom' && builtInFormatRef(preset) === formatRef) {
      overrideDocumentKeys.push(docKey)
    }
  }
  return { isGlobalDefault, overrideDocumentKeys }
}

// ── Normalization / migration ───────────────────────────────────────

/**
 * Normalize an arbitrary binding into a legal two-state model.
 * Illegal `inherit + overrideFormatId` is normalized to `overrideFormatId=null`.
 * Idempotent.
 */
export function normalizeDocumentFormatBinding(raw: unknown): DocumentFormatBinding {
  const r = (raw ?? {}) as { mode?: unknown; overrideFormatId?: unknown }
  const mode: DocumentFormatMode = r.mode === 'override' ? 'override' : 'inherit'
  if (mode === 'inherit') return { mode: 'inherit', overrideFormatId: null }
  const id = typeof r.overrideFormatId === 'string' && r.overrideFormatId !== ''
    ? r.overrideFormatId
    : null
  if (!id) return { mode: 'inherit', overrideFormatId: null }
  return { mode: 'override', overrideFormatId: id }
}

/**
 * Migrate legacy document format binding shapes into the two-state model.
 * Handles (defensively):
 *   { inherit: true, formatId: 'style1' }   → inherit (ignore stale id)
 *   { scope: 'current'|'document', format } → override
 *   { documentFormatId: 'style2' }          → override
 */
export function migrateLegacyDocumentFormatBinding(raw: unknown): DocumentFormatBinding {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.inherit === true) return { mode: 'inherit', overrideFormatId: null }
  if ((r.scope === 'current' || r.scope === 'document') && typeof r.format === 'string') {
    return normalizeDocumentFormatBinding({ mode: 'override', overrideFormatId: r.format })
  }
  if (typeof r.documentFormatId === 'string' && r.documentFormatId !== '') {
    return { mode: 'override', overrideFormatId: r.documentFormatId }
  }
  return normalizeDocumentFormatBinding(r)
}

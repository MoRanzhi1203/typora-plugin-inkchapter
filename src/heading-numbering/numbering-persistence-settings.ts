/**
 * R08 — Numbering persistence settings (global default + per-document override)
 * and the ownership ledger, stored inside the existing plugin settings document.
 *
 * Ownership is keyed by a STABLE structural identity, never by the rendered
 * number text and never by an invisible HTML comment inside the Markdown. A
 * document that left the workspace loses its ledger but is still recoverable
 * from the source itself (the scanner + adoption preview).
 */

import type {
  HeadingNumberOwnershipRecord,
  NumberingPersistenceSettings,
} from './heading-number-persistence'

export interface NumberingPersistenceConfig {
  schemaVersion: 1
  global: NumberingPersistenceSettings
  /** Per-document partial overrides (keyed by document key). */
  documentOverrides: Record<string, Partial<NumberingPersistenceSettings>>
  /** Ownership ledger: document key → identity → record. */
  ownership: Record<string, Record<string, HeadingNumberOwnershipRecord>>
}

export const DEFAULT_NUMBERING_PERSISTENCE_SETTINGS: NumberingPersistenceSettings = {
  // Existing behaviour: numbers are rendered only, the source is never touched.
  storageMode: 'render',
  // Non-destructive default — conflicts are reported, never auto-rewritten.
  existingNumberPolicy: 'detect-only',
  syncTiming: 'manual',
  // Mode A still must not stack a projection on top of a manual number.
  dedupeProjectedNumbers: true,
}

const STORAGE_MODES = new Set(['render', 'source', 'export'])
const POLICIES = new Set(['adopt', 'replace', 'preserve', 'detect-only'])
const TIMINGS = new Set(['manual', 'edit', 'save'])
const OWNERSHIPS = new Set(['inkchapter', 'adopted', 'user-preserved', 'unresolved', 'none'])

export function createDefaultNumberingPersistenceConfig(): NumberingPersistenceConfig {
  return {
    schemaVersion: 1,
    global: { ...DEFAULT_NUMBERING_PERSISTENCE_SETTINGS },
    documentOverrides: {},
    ownership: {},
  }
}

/** Normalise anything read from disk into a fully populated config. */
export function normalizeNumberingPersistenceConfig(raw: unknown): NumberingPersistenceConfig {
  const value = (raw ?? {}) as Partial<NumberingPersistenceConfig>
  const global = normalizeSettings(value.global)
  const documentOverrides: Record<string, Partial<NumberingPersistenceSettings>> = {}
  for (const [key, override] of Object.entries(value.documentOverrides ?? {})) {
    if (!key || override == null || typeof override !== 'object') continue
    documentOverrides[key] = normalizePartialSettings(override)
  }
  const ownership: Record<string, Record<string, HeadingNumberOwnershipRecord>> = {}
  for (const [docKey, records] of Object.entries(value.ownership ?? {})) {
    if (!docKey || records == null || typeof records !== 'object') continue
    const normalized: Record<string, HeadingNumberOwnershipRecord> = {}
    for (const [identity, record] of Object.entries(records)) {
      if (!identity || record == null) continue
      const ownershipValue = OWNERSHIPS.has(record.ownership) ? record.ownership : 'unresolved'
      normalized[identity] = {
        identity,
        ownership: ownershipValue as HeadingNumberOwnershipRecord['ownership'],
        numberText: typeof record.numberText === 'string' ? record.numberText : '',
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
      }
    }
    ownership[docKey] = normalized
  }
  return { schemaVersion: 1, global, documentOverrides, ownership }
}

function normalizeSettings(raw: unknown): NumberingPersistenceSettings {
  const value = (raw ?? {}) as Partial<NumberingPersistenceSettings>
  return {
    storageMode: STORAGE_MODES.has(value.storageMode ?? '')
      ? value.storageMode as NumberingPersistenceSettings['storageMode']
      : DEFAULT_NUMBERING_PERSISTENCE_SETTINGS.storageMode,
    existingNumberPolicy: POLICIES.has(value.existingNumberPolicy ?? '')
      ? value.existingNumberPolicy as NumberingPersistenceSettings['existingNumberPolicy']
      : DEFAULT_NUMBERING_PERSISTENCE_SETTINGS.existingNumberPolicy,
    syncTiming: TIMINGS.has(value.syncTiming ?? '')
      ? value.syncTiming as NumberingPersistenceSettings['syncTiming']
      : DEFAULT_NUMBERING_PERSISTENCE_SETTINGS.syncTiming,
    dedupeProjectedNumbers: typeof value.dedupeProjectedNumbers === 'boolean'
      ? value.dedupeProjectedNumbers
      : DEFAULT_NUMBERING_PERSISTENCE_SETTINGS.dedupeProjectedNumbers,
  }
}

function normalizePartialSettings(raw: unknown): Partial<NumberingPersistenceSettings> {
  const value = (raw ?? {}) as Partial<NumberingPersistenceSettings>
  const out: Partial<NumberingPersistenceSettings> = {}
  if (STORAGE_MODES.has(value.storageMode ?? '')) out.storageMode = value.storageMode
  if (POLICIES.has(value.existingNumberPolicy ?? '')) out.existingNumberPolicy = value.existingNumberPolicy
  if (TIMINGS.has(value.syncTiming ?? '')) out.syncTiming = value.syncTiming
  if (typeof value.dedupeProjectedNumbers === 'boolean') out.dedupeProjectedNumbers = value.dedupeProjectedNumbers
  return out
}

/** Resolve the settings for one document (document override wins field by field). */
export function resolveNumberingPersistenceSettings(
  config: NumberingPersistenceConfig,
  documentKey: string | null | undefined,
): NumberingPersistenceSettings {
  const normalized = normalizeNumberingPersistenceConfig(config)
  const override = documentKey ? normalized.documentOverrides[documentKey] : undefined
  return { ...normalized.global, ...(override ?? {}) }
}

export function getDocumentOwnership(
  config: NumberingPersistenceConfig,
  documentKey: string | null | undefined,
): Record<string, HeadingNumberOwnershipRecord> {
  if (!documentKey) return {}
  return { ...(config.ownership?.[documentKey] ?? {}) }
}

/** Immutable write of the ledger for one document. */
export function withDocumentOwnership(
  config: NumberingPersistenceConfig,
  documentKey: string | null | undefined,
  records: Record<string, HeadingNumberOwnershipRecord>,
): NumberingPersistenceConfig {
  if (!documentKey) return config
  return {
    ...config,
    ownership: {
      ...config.ownership,
      [documentKey]: records,
    },
  }
}

/**
 * Immutable patch of the settings. `scope: 'document'` writes a partial
 * override; `scope: 'global'` updates the global default and re-syncs the
 * document override when one exists.
 */
export function withNumberingPersistenceSettings(
  config: NumberingPersistenceConfig,
  patch: Partial<NumberingPersistenceSettings>,
  scope: 'global' | 'document',
  documentKey: string | null | undefined,
): NumberingPersistenceConfig {
  const normalized = normalizeNumberingPersistenceConfig(config)
  if (scope === 'document' && documentKey) {
    return {
      ...normalized,
      documentOverrides: {
        ...normalized.documentOverrides,
        [documentKey]: { ...(normalized.documentOverrides[documentKey] ?? {}), ...patch },
      },
    }
  }
  return {
    ...normalized,
    global: { ...normalized.global, ...patch },
  }
}

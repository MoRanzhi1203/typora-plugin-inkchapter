/**
 * R10 — Object caption/number persistence settings + ownership ledger.
 *
 * Same durable shape as the R08 heading ledger: a global default, per-document
 * partial overrides and a per-document ownership map keyed by a stable object
 * identity (never by the rendered number, never by an HTML comment).
 */

import type {
  ObjectCaptionPolicy,
  ObjectNumberOwnershipRecord,
  ObjectNumberPersistenceSettings,
  ObjectNumberStorageMode,
  ObjectNumberSyncTiming,
} from './object-number-persistence'

export interface ObjectNumberPersistenceConfig {
  schemaVersion: 1
  global: ObjectNumberPersistenceSettings
  documentOverrides: Record<string, Partial<ObjectNumberPersistenceSettings>>
  ownership: Record<string, Record<string, ObjectNumberOwnershipRecord>>
}

export const DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS: ObjectNumberPersistenceSettings = {
  // Non-destructive default: captions are rendered by the caption service only.
  storageMode: 'render',
  existingCaptionPolicy: 'detect-only',
  syncTiming: 'manual',
  dedupeProjectedNumbers: true,
}

const STORAGE_MODES = new Set<string>(['render', 'source', 'export'])
const POLICIES = new Set<string>(['adopt', 'replace', 'preserve', 'detect-only'])
const TIMINGS = new Set<string>(['manual', 'edit', 'save'])
const OWNERSHIPS = new Set<string>(['inkchapter', 'adopted', 'user-preserved', 'unresolved', 'none'])
const KINDS = new Set<string>(['figure', 'table', 'code', 'formula'])

export function createDefaultObjectNumberPersistenceConfig(): ObjectNumberPersistenceConfig {
  return {
    schemaVersion: 1,
    global: { ...DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS },
    documentOverrides: {},
    ownership: {},
  }
}

export function normalizeObjectNumberPersistenceConfig(raw: unknown): ObjectNumberPersistenceConfig {
  const value = (raw ?? {}) as Partial<ObjectNumberPersistenceConfig>
  const documentOverrides: Record<string, Partial<ObjectNumberPersistenceSettings>> = {}
  for (const [key, override] of Object.entries(value.documentOverrides ?? {})) {
    if (!key || override == null || typeof override !== 'object') continue
    documentOverrides[key] = normalizePartialSettings(override)
  }
  const ownership: Record<string, Record<string, ObjectNumberOwnershipRecord>> = {}
  for (const [docKey, records] of Object.entries(value.ownership ?? {})) {
    if (!docKey || records == null || typeof records !== 'object') continue
    const normalized: Record<string, ObjectNumberOwnershipRecord> = {}
    for (const [identity, record] of Object.entries(records)) {
      if (!identity || record == null || typeof record !== 'object') continue
      const candidate = record as Partial<ObjectNumberOwnershipRecord>
      const kind = typeof candidate.kind === 'string' && KINDS.has(candidate.kind)
        ? candidate.kind as ObjectNumberOwnershipRecord['kind']
        : 'figure'
      normalized[identity] = {
        identity,
        kind,
        ownership: OWNERSHIPS.has(candidate.ownership ?? '')
          ? candidate.ownership as ObjectNumberOwnershipRecord['ownership']
          : 'unresolved',
        numberText: typeof candidate.numberText === 'string' ? candidate.numberText : '',
        title: typeof candidate.title === 'string' ? candidate.title : '',
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
      }
    }
    ownership[docKey] = normalized
  }
  return { schemaVersion: 1, global: normalizeSettings(value.global), documentOverrides, ownership }
}

function normalizeSettings(raw: unknown): ObjectNumberPersistenceSettings {
  const value = (raw ?? {}) as Partial<ObjectNumberPersistenceSettings>
  return {
    storageMode: STORAGE_MODES.has(value.storageMode ?? '')
      ? value.storageMode as ObjectNumberStorageMode
      : DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS.storageMode,
    existingCaptionPolicy: POLICIES.has(value.existingCaptionPolicy ?? '')
      ? value.existingCaptionPolicy as ObjectCaptionPolicy
      : DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS.existingCaptionPolicy,
    syncTiming: TIMINGS.has(value.syncTiming ?? '')
      ? value.syncTiming as ObjectNumberSyncTiming
      : DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS.syncTiming,
    dedupeProjectedNumbers: typeof value.dedupeProjectedNumbers === 'boolean'
      ? value.dedupeProjectedNumbers
      : DEFAULT_OBJECT_NUMBER_PERSISTENCE_SETTINGS.dedupeProjectedNumbers,
  }
}

function normalizePartialSettings(raw: unknown): Partial<ObjectNumberPersistenceSettings> {
  const value = (raw ?? {}) as Partial<ObjectNumberPersistenceSettings>
  const out: Partial<ObjectNumberPersistenceSettings> = {}
  if (STORAGE_MODES.has(value.storageMode ?? '')) out.storageMode = value.storageMode
  if (POLICIES.has(value.existingCaptionPolicy ?? '')) out.existingCaptionPolicy = value.existingCaptionPolicy
  if (TIMINGS.has(value.syncTiming ?? '')) out.syncTiming = value.syncTiming
  if (typeof value.dedupeProjectedNumbers === 'boolean') out.dedupeProjectedNumbers = value.dedupeProjectedNumbers
  return out
}

export function resolveObjectNumberPersistenceSettings(
  config: ObjectNumberPersistenceConfig,
  documentKey: string | null | undefined,
): ObjectNumberPersistenceSettings {
  const normalized = normalizeObjectNumberPersistenceConfig(config)
  const override = documentKey ? normalized.documentOverrides[documentKey] : undefined
  return { ...normalized.global, ...(override ?? {}) }
}

export function getObjectDocumentOwnership(
  config: ObjectNumberPersistenceConfig,
  documentKey: string | null | undefined,
): Record<string, ObjectNumberOwnershipRecord> {
  if (!documentKey) return {}
  return { ...(config.ownership?.[documentKey] ?? {}) }
}

export function withObjectDocumentOwnership(
  config: ObjectNumberPersistenceConfig,
  documentKey: string | null | undefined,
  records: Record<string, ObjectNumberOwnershipRecord>,
): ObjectNumberPersistenceConfig {
  if (!documentKey) return config
  return {
    ...config,
    ownership: {
      ...config.ownership,
      [documentKey]: records,
    },
  }
}

export function withObjectNumberPersistenceSettings(
  config: ObjectNumberPersistenceConfig,
  patch: Partial<ObjectNumberPersistenceSettings>,
  scope: 'global' | 'document',
  documentKey: string | null | undefined,
): ObjectNumberPersistenceConfig {
  const normalized = normalizeObjectNumberPersistenceConfig(config)
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

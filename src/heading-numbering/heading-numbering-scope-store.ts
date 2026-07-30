/**
 * Heading Numbering Scope Store — manages global default + per-document overrides.
 *
 * Responsibilities:
 * 1. Migrate old flat headingNumbering → headingNumberingScopes
 * 2. Resolve effective settings for any documentKey
 * 3. Save with explicit scope (global or document)
 * 4. Deep merge settings (no shared mutable objects)
 */

import type {
  HeadingNumberingSettings,
  HeadingNumberingScopeStore,
  HeadingNumberingDocumentOverride,
  HeadingSettingsScope,
  SaveHeadingSettingsRequest,
  DocumentNumberingContext,
  HeadingLevel,
  HeadingLevelStyle,
} from './heading-types'

// ── Document key generation ───────────────────────

/** Generate a stable vault-relative document key from an absolute file path. */
export function generateDocumentKey(
  absolutePath: string,
  vaultRoot: string,
): string {
  // Normalize paths: remove trailing slashes, normalize separators
  const normVault = vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const normPath = absolutePath.replace(/\\/g, '/')

  // If the file is inside the vault, extract relative path
  if (normPath.toLowerCase().startsWith(normVault.toLowerCase() + '/')) {
    let relative = normPath.slice(normVault.length + 1)
    // Collapse '.' and '..'
    const parts = relative.split('/')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') { resolved.pop(); continue }
      resolved.push(part)
    }
    return resolved.join('/')
  }

  // Not inside vault — use full path as fallback (unlikely in test setup)
  return normPath
}

/** Extract just the filename from a document key (for display). */
export function getFileNameFromKey(key: string): string {
  return key.split('/').pop() ?? key
}

// ── Deep clone ─────────────────────────────────────

/** Deep clone a HeadingNumberingSettings object (no shared references). */
export function deepCloneSettings(s: HeadingNumberingSettings): HeadingNumberingSettings {
  return {
    enabled: s.enabled,
    showLevelOneNumber: s.showLevelOneNumber,
    preset: s.preset,
    maxDepth: s.maxDepth,
    levels: deepCloneLevels(s.levels),
    customDefinition: s.customDefinition ? deepCloneLevels(s.customDefinition) : undefined,
    separator: s.separator,
    suffix: s.suffix,
    showTrailingSeparator: s.showTrailingSeparator,
  }
}

function deepCloneLevels(
  levels: Record<HeadingLevel, HeadingLevelStyle>,
): Record<HeadingLevel, HeadingLevelStyle> {
  const cloned = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lvStr of Object.keys(levels)) {
    const lv = Number(lvStr) as HeadingLevel
    cloned[lv] = deepCloneLevelStyle(levels[lv])
  }
  return cloned
}

function deepCloneLevelStyle(s: HeadingLevelStyle): HeadingLevelStyle {
  return {
    enabled: s.enabled,
    tokenStyle: s.tokenStyle,
    includeParents: s.includeParents,
    prefix: s.prefix,
    suffix: s.suffix,
    separator: s.separator,
    startAt: s.startAt,
    restartAfterLevel: s.restartAfterLevel,
    formatVariants: {
      withLevelOne: s.formatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
      withoutLevelOne: s.formatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
    },
    levelTemplate: { ...s.levelTemplate },
    multilevelFormatVariants: {
      withLevelOne: s.multilevelFormatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
      withoutLevelOne: s.multilevelFormatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
    },
    contextualFormatVariants: {
      withLevelOne: s.contextualFormatVariants.withLevelOne.map(seg => ({
        ...seg,
        appearance: seg.type === 'level-reference'
          ? { ...(seg as any).appearance }
          : undefined,
      })) as any,
      withoutLevelOne: s.contextualFormatVariants.withoutLevelOne.map(seg => ({
        ...seg,
        appearance: seg.type === 'level-reference'
          ? { ...(seg as any).appearance }
          : undefined,
      })) as any,
    },
  }
}

// ── Deep merge ─────────────────────────────────────

/** Deep merge document override into global default. Document fields take precedence. */
export function deepMergeSettings(
  base: HeadingNumberingSettings,
  override: HeadingNumberingSettings,
): HeadingNumberingSettings {
  const result = deepCloneSettings(base)

  // Shallow-merge top-level fields (document override wins)
  if (override.enabled !== undefined) result.enabled = override.enabled
  if (override.showLevelOneNumber !== undefined) result.showLevelOneNumber = override.showLevelOneNumber
  if (override.preset !== undefined) result.preset = override.preset
  if (override.maxDepth !== undefined) result.maxDepth = override.maxDepth

  // Deep-merge levels
  for (const lvStr of Object.keys(override.levels)) {
    const lv = Number(lvStr) as HeadingLevel
    if (override.levels[lv]) {
      result.levels[lv] = {
        ...result.levels[lv],
        ...override.levels[lv],
        // Deep merge sub-objects
        formatVariants: {
          withLevelOne: override.levels[lv].formatVariants.withLevelOne.length > 0
            ? override.levels[lv].formatVariants.withLevelOne.map(seg => ({ ...seg })) as any
            : result.levels[lv].formatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
          withoutLevelOne: override.levels[lv].formatVariants.withoutLevelOne.length > 0
            ? override.levels[lv].formatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any
            : result.levels[lv].formatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
        },
        levelTemplate: { ...result.levels[lv].levelTemplate, ...override.levels[lv].levelTemplate },
        multilevelFormatVariants: {
          withLevelOne: override.levels[lv].multilevelFormatVariants.withLevelOne.length > 0
            ? override.levels[lv].multilevelFormatVariants.withLevelOne.map(seg => ({ ...seg })) as any
            : result.levels[lv].multilevelFormatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
          withoutLevelOne: override.levels[lv].multilevelFormatVariants.withoutLevelOne.length > 0
            ? override.levels[lv].multilevelFormatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any
            : result.levels[lv].multilevelFormatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
        },
        contextualFormatVariants: {
          withLevelOne: override.levels[lv].contextualFormatVariants.withLevelOne.length > 0
            ? override.levels[lv].contextualFormatVariants.withLevelOne.map(seg => ({
                ...seg,
                appearance: seg.type === 'level-reference' ? { ...(seg as any).appearance } : undefined,
              })) as any
            : result.levels[lv].contextualFormatVariants.withLevelOne.map(seg => ({
                ...seg,
                appearance: seg.type === 'level-reference' ? { ...(seg as any).appearance } : undefined,
              })) as any,
          withoutLevelOne: override.levels[lv].contextualFormatVariants.withoutLevelOne.length > 0
            ? override.levels[lv].contextualFormatVariants.withoutLevelOne.map(seg => ({
                ...seg,
                appearance: seg.type === 'level-reference' ? { ...(seg as any).appearance } : undefined,
              })) as any
            : result.levels[lv].contextualFormatVariants.withoutLevelOne.map(seg => ({
                ...seg,
                appearance: seg.type === 'level-reference' ? { ...(seg as any).appearance } : undefined,
              })) as any,
        },
      }
    }
  }

  return result
}

// ── Resolve effective settings ─────────────────────

/**
 * Resolve the effective heading numbering settings for a document.
 * Returns deep-cloned copy — no shared mutable objects.
 */
export function resolveEffectiveSettings(
  store: HeadingNumberingScopeStore,
  documentKey: string | null,
): DocumentNumberingContext {
  if (!documentKey) {
    return {
      documentKey: null,
      settingsRevision: 0,
      effectiveSettings: deepCloneSettings(store.globalDefault),
      source: 'global',
    }
  }

  const override = store.documentOverrides[documentKey]
  if (!override) {
    return {
      documentKey,
      settingsRevision: 0,
      effectiveSettings: deepCloneSettings(store.globalDefault),
      source: 'global',
    }
  }

  return {
    documentKey,
    settingsRevision: override.updatedAt,
    effectiveSettings: deepMergeSettings(store.globalDefault, override.settings),
    source: 'document',
  }
}

// ── Save ───────────────────────────────────────────

/** Save heading numbering settings with explicit scope. */
export function saveHeadingSettings(
  store: HeadingNumberingScopeStore,
  request: SaveHeadingSettingsRequest,
): HeadingNumberingScopeStore {
  if (request.scope === 'global') {
    return {
      ...store,
      globalDefault: deepCloneSettings(request.settings),
    }
  }

  // Document scope
  if (!request.documentKey) {
    throw new Error('Document-scoped heading settings require a documentKey.')
  }

  return {
    ...store,
    documentOverrides: {
      ...store.documentOverrides,
      [request.documentKey]: {
        updatedAt: Date.now(),
        settings: deepCloneSettings(request.settings),
      },
    },
  }
}

/** Remove document override (restore inherit global). */
export function removeDocumentOverride(
  store: HeadingNumberingScopeStore,
  documentKey: string,
): HeadingNumberingScopeStore {
  if (!store.documentOverrides[documentKey]) return store

  const newOverrides = { ...store.documentOverrides }
  delete newOverrides[documentKey]
  return {
    ...store,
    documentOverrides: newOverrides,
  }
}

/** Check if a document has a custom override. */
export function hasDocumentOverride(
  store: HeadingNumberingScopeStore | null | undefined,
  documentKey: string | null,
): boolean {
  if (!store || !documentKey) return false
  return documentKey in store.documentOverrides
}

// ── Migration ──────────────────────────────────────

/**
 * Migrate old flat headingNumbering to new scope store.
 * Idempotent — does nothing if already migrated.
 */
export function migrateHeadingNumberingToScopeStore(
  data: Record<string, unknown>,
): {
  migrated: boolean
  store: HeadingNumberingScopeStore
} {
  // Already migrated?
  const scopes = data['headingNumberingScopes'] as HeadingNumberingScopeStore | undefined
  if (scopes?.schemaVersion && scopes.globalDefault) {
    return { migrated: false, store: scopes }
  }

  const scopesNew = data['heading_numbering_scopes'] as HeadingNumberingScopeStore | undefined
  if (scopesNew?.schemaVersion && scopesNew.globalDefault) {
    return { migrated: false, store: scopesNew }
  }

  // Try to get old headingNumbering
  const old = data['headingNumbering'] as HeadingNumberingSettings | undefined

  if (old) {
    console.info('[InkChapter] Migrating headingNumbering to headingNumberingScopes')
    const store: HeadingNumberingScopeStore = {
      schemaVersion: 1,
      globalDefault: deepCloneSettings(old),
      documentOverrides: {},
    }
    return { migrated: true, store }
  }

  // No old data — return empty store
  // (This shouldn't happen; defaults are set by PluginSettings)
  console.warn('[InkChapter] No headingNumbering or headingNumberingScopes found, using empty store')
  return {
    migrated: true,
    store: {
      schemaVersion: 1,
      globalDefault: getDefaultHeadingNumberingSettings(),
      documentOverrides: {},
    },
  }
}

/** Get a fresh default heading numbering settings object. */
export function getDefaultHeadingNumberingSettings(): HeadingNumberingSettings {
  return {
    enabled: true,
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: {} as Record<HeadingLevel, HeadingLevelStyle>,
    customDefinition: undefined,
  }
}

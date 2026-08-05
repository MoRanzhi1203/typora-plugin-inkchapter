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
import { getPresetLevels } from './presets'

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
  const cloned: HeadingNumberingSettings = {
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
  if (s.headingLayouts) {
    cloned.headingLayouts = deepCloneLayouts(s.headingLayouts)
  }
  return cloned
}

function deepCloneLayouts(l: import('./heading-types').HeadingLayoutSettings): import('./heading-types').HeadingLayoutSettings {
  return {
    h1: { ...l.h1 },
    h2: { ...l.h2 },
    h3: { ...l.h3 },
    h4: { ...l.h4 },
    h5: { ...l.h5 },
    h6: { ...l.h6 },
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
    numberTitleSpacing: s.numberTitleSpacing ?? 'space',
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

  // Merge headingLayouts (document override wins per-level)
  if (override.headingLayouts) {
    if (!result.headingLayouts) {
      result.headingLayouts = deepCloneLayouts(override.headingLayouts)
    } else {
      if (override.headingLayouts.h1) result.headingLayouts.h1 = { ...override.headingLayouts.h1 }
      if (override.headingLayouts.h2) result.headingLayouts.h2 = { ...override.headingLayouts.h2 }
      if (override.headingLayouts.h3) result.headingLayouts.h3 = { ...override.headingLayouts.h3 }
      if (override.headingLayouts.h4) result.headingLayouts.h4 = { ...override.headingLayouts.h4 }
      if (override.headingLayouts.h5) result.headingLayouts.h5 = { ...override.headingLayouts.h5 }
      if (override.headingLayouts.h6) result.headingLayouts.h6 = { ...override.headingLayouts.h6 }
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
  const base = documentKey && store.documentOverrides[documentKey]
    ? deepMergeSettings(store.globalDefault, store.documentOverrides[documentKey].settings)
    : deepCloneSettings(store.globalDefault)

  // For non-custom presets, always regenerate levels from the latest
  // preset definition. This ensures preset fixes (like Roman token styles)
  // are picked up without requiring user to re-save settings.
  if (base.preset !== 'custom') {
    base.levels = getPresetLevels(base.preset)
  }

  if (!documentKey) {
    return {
      documentKey: null,
      settingsRevision: 0,
      effectiveSettings: base,
      source: 'global',
    }
  }

  const override = store.documentOverrides[documentKey]
  return {
    documentKey,
    settingsRevision: override?.updatedAt ?? 0,
    effectiveSettings: base,
    source: override ? 'document' : 'global',
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
        formatSource: request.formatSource,
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
    levels: getDefaultLevels(),
    customDefinition: undefined,
  }
}

/** Get default H1-H6 levels (decimal hierarchical). */
function getDefaultLevels(): Record<HeadingLevel, HeadingLevelStyle> {
  const defaultTemplate = { tokenStyle: 'arabic' as const, prefix: '', suffix: '' }
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  const allLevels: HeadingLevel[] = [1, 2, 3, 4, 5, 6]
  for (const lv of allLevels) {
    levels[lv] = {
      enabled: true,
      tokenStyle: 'arabic',
      includeParents: true,
      prefix: '',
      suffix: '',
      separator: '.',
      startAt: 1,
      restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
      formatVariants: { withLevelOne: [], withoutLevelOne: [] },
      levelTemplate: { ...defaultTemplate },
      multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
      contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    }
  }
  return levels
}

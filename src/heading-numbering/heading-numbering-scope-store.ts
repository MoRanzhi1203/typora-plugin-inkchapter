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
  ParagraphLayoutSettings,
  NumberingFormatSource,
  FormatLibrary,
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
    headingStructureMode: s.headingStructureMode,
    showLevelOneNumber: s.showLevelOneNumber,
    preset: s.preset,
    maxDepth: s.maxDepth,
    levels: deepCloneLevels(s.levels),
    customDefinition: s.customDefinition ? deepCloneLevels(s.customDefinition) : undefined,
    separator: s.separator,
    suffix: s.suffix,
    showTrailingSeparator: s.showTrailingSeparator,
    s6Configured: s.s6Configured,
    headingStructureConfigured: s.headingStructureConfigured,
  }
  if (s.headingLayouts) {
    cloned.headingLayouts = deepCloneLayouts(s.headingLayouts)
  }
  if (s.headingLayoutsByMode) {
    cloned.headingLayoutsByMode = deepCloneLayoutsByMode(s.headingLayoutsByMode)
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

/** Deep clone a per-structure-mode layout map (loose/strict independent). */
function deepCloneLayoutsByMode(
  l: import('./heading-types').HeadingLayoutsByMode,
): import('./heading-types').HeadingLayoutsByMode {
  const out = {} as import('./heading-types').HeadingLayoutsByMode
  for (const mode of ['loose', 'strict'] as const) {
    if (l[mode]) out[mode] = deepCloneLayouts(l[mode])
  }
  return out
}

/** Factory default heading layout (left-aligned, no indent) for all H1-H6. */
export const DEFAULT_HEADING_LAYOUTS: import('./heading-types').HeadingLayoutSettings = {
  h1: { textAlign: 'left', firstLineIndentEm: 0 },
  h2: { textAlign: 'left', firstLineIndentEm: 0 },
  h3: { textAlign: 'left', firstLineIndentEm: 0 },
  h4: { textAlign: 'left', firstLineIndentEm: 0 },
  h5: { textAlign: 'left', firstLineIndentEm: 0 },
  h6: { textAlign: 'left', firstLineIndentEm: 0 },
}

/**
 * Resolve the effective heading layout for a structure mode, indexed by real
 * physical H1-H6 (NO level shift). Priority:
 *   1. `headingLayoutsByMode[mode]` (authoritative per-mode)
 *   2. legacy shared `headingLayouts`
 *   3. factory default
 */
export function resolveHeadingLayoutsForMode(
  settings: import('./heading-types').HeadingNumberingSettings,
  mode: 'loose' | 'strict',
): import('./heading-types').HeadingLayoutSettings {
  const byMode = settings.headingLayoutsByMode?.[mode]
  if (byMode) return byMode
  if (settings.headingLayouts) return settings.headingLayouts
  return deepCloneLayouts(DEFAULT_HEADING_LAYOUTS)
}

/**
 * Resolve effective paragraph layout settings for a document.
 * Priority: document override → global default → hard defaults.
 * Always returns a complete object (indentShortcutEnabled never undefined).
 */
export function resolveParagraphLayoutSettings(
  store: HeadingNumberingScopeStore,
  documentKey: string | null,
): import('./heading-types').ParagraphLayoutSettings {
  const defaults: import('./heading-types').ParagraphLayoutSettings = {
    defaultIndent: 'flush',
    flushAfterDisplayMath: true,
    indentShortcutEnabled: true,
  }
  if (documentKey) {
    const override = store.documentOverrides[documentKey]
    if (override?.paragraphLayout) {
      return { ...defaults, ...override.paragraphLayout }
    }
  }
  return { ...defaults, ...store.globalParagraphLayout }
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
  if (override.headingStructureMode !== undefined) result.headingStructureMode = override.headingStructureMode
  if (override.preset !== undefined) result.preset = override.preset
  if (override.maxDepth !== undefined) result.maxDepth = override.maxDepth
  if (override.s6Configured !== undefined) result.s6Configured = override.s6Configured

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

  // Merge headingLayoutsByMode (document override wins per-mode, per-level)
  if (override.headingLayoutsByMode) {
    if (!result.headingLayoutsByMode) {
      result.headingLayoutsByMode = deepCloneLayoutsByMode(override.headingLayoutsByMode)
    } else {
      for (const mode of ['loose', 'strict'] as const) {
        const ovMode = override.headingLayoutsByMode[mode]
        if (!ovMode) continue
        if (!result.headingLayoutsByMode[mode]) {
          result.headingLayoutsByMode[mode] = deepCloneLayouts(ovMode as import('./heading-types').HeadingLayoutSettings)
        } else {
          for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
            if (ovMode[key]) result.headingLayoutsByMode[mode][key] = { ...ovMode[key]! }
          }
        }
      }
    }
  }

  return result
}

// ── Resolve effective settings ─────────────────────

/**
 * Resolve the effective heading numbering settings for a document.
 * Returns deep-cloned copy — no shared mutable objects.
 *
 * Live Reference: when a `formatLibrary` is provided and the effective format
 * source is a custom format that still exists in the library, the LATEST
 * library definition is resolved (never the stale applied snapshot). This is
 * the single place where a linked custom format's latest content is resolved.
 * A missing format reference falls back to the persisted snapshot (repair path).
 */
export function resolveEffectiveSettings(
  store: HeadingNumberingScopeStore,
  documentKey: string | null,
  formatLibrary?: FormatLibrary,
): DocumentNumberingContext {
  const docOverride = documentKey ? store.documentOverrides[documentKey] : undefined
  const base = docOverride
    ? deepMergeSettings(store.globalDefault, docOverride.settings)
    : deepCloneSettings(store.globalDefault)

  // For non-custom presets, always regenerate levels from the latest
  // preset definition. This ensures preset fixes (like Roman token styles)
  // are picked up without requiring user to re-save settings.
  if (base.preset !== 'custom') {
    base.levels = getPresetLevels(base.preset)
  } else if (formatLibrary) {
    // Live Reference: resolve the latest custom format definition.
    const source = docOverride?.formatSource ?? (store.globalDefault as any).formatSource as NumberingFormatSource | undefined
    if (source?.type === 'custom') {
      const latest = formatLibrary.formats.find(f => f.id === source.formatId)
      if (latest) {
        base.levels = deepCloneLevels(latest.settings.levels)
        base.enabled = latest.settings.enabled
        base.maxDepth = latest.settings.maxDepth
        base.customDefinition = deepCloneLevels(latest.settings.levels)
      }
    }
  }

  // Apply document-level layout overrides on top of the merged settings.
  // Layout overrides are independent of format source identity — changing
  // H1 alignment does not affect which format is "applied".
  if (documentKey && docOverride?.layoutOverrides) {
    applyLayoutOverridesToSettings(base, docOverride.layoutOverrides)
  }

  if (!documentKey) {
    return {
      documentKey: null,
      settingsRevision: 0,
      effectiveSettings: base,
      source: 'global',
    }
  }

  return {
    documentKey,
    settingsRevision: docOverride?.updatedAt ?? 0,
    effectiveSettings: base,
    source: docOverride ? 'document' : 'global',
  }
}

/**
 * Apply document-level layout overrides to the effective settings in-place.
 * Does NOT modify any other field — only headingLayouts and numberTitleSpacing.
 */
function applyLayoutOverridesToSettings(
  settings: HeadingNumberingSettings,
  overrides: import('./heading-types').DocumentLayoutOverrides,
): void {
  // Merge headingLayouts
  if (overrides.headingLayouts) {
    if (!settings.headingLayouts) {
      settings.headingLayouts = {
        h1: { textAlign: 'left', firstLineIndentEm: 0 },
        h2: { textAlign: 'left', firstLineIndentEm: 0 },
        h3: { textAlign: 'left', firstLineIndentEm: 0 },
        h4: { textAlign: 'left', firstLineIndentEm: 0 },
        h5: { textAlign: 'left', firstLineIndentEm: 0 },
        h6: { textAlign: 'left', firstLineIndentEm: 0 },
      }
    }
    for (const [key, config] of Object.entries(overrides.headingLayouts)) {
      if (config && (key === 'h1' || key === 'h2' || key === 'h3' || key === 'h4' || key === 'h5' || key === 'h6')) {
        (settings.headingLayouts as any)[key] = { ...config }
      }
    }
  }

  // Merge per-mode heading layouts (physical H1-H6, NO level shift).
  if (overrides.headingLayoutsByMode) {
    if (!settings.headingLayoutsByMode) {
      settings.headingLayoutsByMode = {
        loose: deepCloneLayouts(DEFAULT_HEADING_LAYOUTS),
        strict: deepCloneLayouts(DEFAULT_HEADING_LAYOUTS),
      }
    }
    for (const mode of ['loose', 'strict'] as const) {
      const ovMode = overrides.headingLayoutsByMode[mode]
      if (!ovMode) continue
      if (!settings.headingLayoutsByMode[mode]) {
        settings.headingLayoutsByMode[mode] = deepCloneLayouts(DEFAULT_HEADING_LAYOUTS)
      }
      for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
        const cfg = ovMode[key]
        if (cfg) settings.headingLayoutsByMode[mode]![key] = { ...cfg }
      }
    }
  }

  // Merge numberTitleSpacing — Physical → StyleSlot mapping required.
  // DocumentLayoutOverrides use Physical H1-H6 keys, but settings.levels[]
  // uses StyleSlot S1-S6 indices. In strict mode, Physical H2→S1, H3→S2, etc.
  // Without slot resolution, physical override would write to wrong slot level.
  if (overrides.numberTitleSpacing) {
    const mode = (settings.headingStructureMode || 'strict') as 'strict' | 'loose'
    for (const [lvStr, spacing] of Object.entries(overrides.numberTitleSpacing)) {
      const physical = Number(lvStr) as HeadingLevel
      if (physical < 1 || physical > 6) continue
      // Resolve which StyleSlot this physical heading maps to.
      // strict: H1→null (document title, no slot), H2→S1, H3→S2, ..., H6→S5
      // loose:  H1→S1, H2→S2, ..., H6→S6
      const slot = (mode === 'strict' && physical === 1) ? null
        : mode === 'strict' ? (physical - 1) as HeadingLevel
        : physical // loose: identity mapping
      if (slot !== null && settings.levels[slot]) {
        settings.levels[slot] = {
          ...settings.levels[slot],
          numberTitleSpacing: spacing,
        }
      }
    }
  }
}

// ── Save ───────────────────────────────────────────

/** Save heading numbering settings with explicit scope. */
export function saveHeadingSettings(
  store: HeadingNumberingScopeStore,
  request: SaveHeadingSettingsRequest,
): HeadingNumberingScopeStore {
  if (request.scope === 'global') {
    const gd: any = deepCloneSettings(request.settings)
    if (request.formatSource) {
      gd.formatSource = { ...request.formatSource }
    }
    return {
      ...store,
      globalDefault: gd,
    }
  }

  // Document scope
  if (!request.documentKey) {
    throw new Error('Document-scoped heading settings require a documentKey.')
  }

  // Preserve existing formatSource unless explicitly provided.
  // This prevents layout-only changes (saveAndApply, setHeadingLayout, etc.)
  // from wiping the format identity and causing "已应用" to disappear.
  const existingOverride = store.documentOverrides[request.documentKey]
  const formatSource = request.formatSource ?? existingOverride?.formatSource

  return {
    ...store,
    documentOverrides: {
      ...store.documentOverrides,
      [request.documentKey]: {
        updatedAt: Date.now(),
        settings: deepCloneSettings(request.settings),
        formatSource,
        // Preserve existing layoutOverrides when not explicitly provided
        layoutOverrides: existingOverride?.layoutOverrides,
      },
    },
  }
}

/**
 * Save only layout overrides for a document, preserving formatSource identity.
 * Used by setHeadingLayout, resetAllHeadingLayouts, and "restore default layout".
 * Never touches formatSource or the numbering settings blob.
 */
export function saveLayoutOverrides(
  store: HeadingNumberingScopeStore,
  documentKey: string,
  layoutOverrides: import('./heading-types').DocumentLayoutOverrides | undefined,
): HeadingNumberingScopeStore {
  const existingOverride = store.documentOverrides[documentKey]
  return {
    ...store,
    documentOverrides: {
      ...store.documentOverrides,
      [documentKey]: {
        updatedAt: Date.now(),
        settings: existingOverride?.settings ?? store.globalDefault,
        formatSource: existingOverride?.formatSource,
        layoutOverrides,
      },
    },
  }
}

/**
 * Check whether a document override has any non-default layout overrides.
 */
export function hasLayoutOverrides(
  store: HeadingNumberingScopeStore,
  documentKey: string | null,
): boolean {
  if (!documentKey) return false
  const override = store.documentOverrides[documentKey]
  if (!override?.layoutOverrides) return false
  const lo = override.layoutOverrides
  const hasHeadingLayouts = lo.headingLayouts && Object.keys(lo.headingLayouts).length > 0
  const hasGap = lo.numberTitleSpacing && Object.keys(lo.numberTitleSpacing).length > 0
  return !!(hasHeadingLayouts || hasGap)
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
 * Normalize legacy shared `headingLayouts` into independent per-mode layouts.
 * Idempotent: if `headingLayoutsByMode` already exists, leaves it untouched.
 * Deep-clones the legacy shared layout into BOTH loose and strict (no shared ref).
 */
export function normalizeHeadingLayoutsByMode(
  store: HeadingNumberingScopeStore,
): HeadingNumberingScopeStore {
  let changed = false

  const globalDefault = normalizeSettingsLayoutsByMode(store.globalDefault)
  if (globalDefault !== store.globalDefault) changed = true

  const documentOverrides: Record<string, HeadingNumberingDocumentOverride> = {}
  for (const [key, ov] of Object.entries(store.documentOverrides)) {
    let next = ov
    const settings = normalizeSettingsLayoutsByMode(ov.settings)
    if (settings !== ov.settings) { next = { ...next, settings }; changed = true }
    if (ov.layoutOverrides) {
      const lo = normalizeLayoutOverridesByMode(ov.layoutOverrides)
      if (lo !== ov.layoutOverrides) { next = { ...next, layoutOverrides: lo }; changed = true }
    }
    documentOverrides[key] = next
  }

  if (!changed) return store
  return { ...store, globalDefault, documentOverrides }
}

function normalizeSettingsLayoutsByMode(
  s: HeadingNumberingSettings,
): HeadingNumberingSettings {
  if (s.headingLayoutsByMode) return s
  if (!s.headingLayouts) return s
  return {
    ...s,
    headingLayoutsByMode: {
      loose: deepCloneLayouts(s.headingLayouts),
      strict: deepCloneLayouts(s.headingLayouts),
    },
  }
}

function normalizeLayoutOverridesByMode(
  lo: import('./heading-types').DocumentLayoutOverrides,
): import('./heading-types').DocumentLayoutOverrides {
  if (lo.headingLayoutsByMode) return lo
  if (!lo.headingLayouts) return lo
  return {
    ...lo,
    headingLayoutsByMode: {
      loose: { ...lo.headingLayouts },
      strict: { ...lo.headingLayouts },
    },
  }
}

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
    // Ensure globalParagraphLayout exists (added in a later version)
    if (!scopes.globalParagraphLayout) {
      scopes.globalParagraphLayout = { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true }
    }
    return { migrated: false, store: normalizeHeadingLayoutsByMode(scopes) }
  }

  const scopesNew = data['heading_numbering_scopes'] as HeadingNumberingScopeStore | undefined
  if (scopesNew?.schemaVersion && scopesNew.globalDefault) {
    if (!scopesNew.globalParagraphLayout) {
      scopesNew.globalParagraphLayout = { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true }
    }
    return { migrated: false, store: normalizeHeadingLayoutsByMode(scopesNew) }
  }

  // Try to get old headingNumbering
  const old = data['headingNumbering'] as HeadingNumberingSettings | undefined

  if (old) {
    console.info('[InkChapter] Migrating headingNumbering to headingNumberingScopes')
    const store: HeadingNumberingScopeStore = {
      schemaVersion: 1,
      globalDefault: deepCloneSettings(old),
      documentOverrides: {},
      globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    }
    return { migrated: true, store: normalizeHeadingLayoutsByMode(store) }
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
      globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    },
  }
}

/** Get a fresh default heading numbering settings object. */
export function getDefaultHeadingNumberingSettings(): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getDefaultLevels(),
    customDefinition: undefined,
    s6Configured: false,
    headingLayoutsByMode: {
      loose: deepCloneLayouts(DEFAULT_HEADING_LAYOUTS),
      strict: deepCloneLayouts(DEFAULT_HEADING_LAYOUTS),
    },
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

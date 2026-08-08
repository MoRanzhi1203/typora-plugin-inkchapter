export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface HeadingDescriptor {
  key: string
  level: HeadingLevel
  text: string
}

export interface NumberedHeading extends HeadingDescriptor {
  counters: readonly number[]
  /** Semantic number label (without gap). Example: "一、", "1.1", "第一章" */
  label: string
  /** Title gap character: " " (space) or "" (none). Applied at rendering boundary only. */
  labelGap: string
}

// ── Numbering style types ────────────────────────────────

export type NumberTokenStyle =
  | 'arabic'
  | 'fullwidth-arabic'
  | 'chinese'
  | 'chinese-financial'
  | 'roman-upper'
  | 'roman-lower'
  | 'alpha-upper'
  | 'alpha-lower'
  | 'upper-greek'
  | 'lower-greek'
  | 'heavenly-stems'
  | 'earthly-branches'
  | 'circled'

export type HeadingNumberingPreset =
  | 'decimal-hierarchical'
  | 'chinese-chapter'
  | 'chinese-outline'
  | 'roman-hierarchical'
  | 'academic-paper'
  | 'chapter-section-clause'
  | 'appendix-hierarchical'
  | 'roman-mixed'
  | 'letter-mixed'
  | 'custom'

export type NumberFormatSegment =
  | { type: 'literal'; value: string }
  | { type: 'level-reference'; level: HeadingLevel }

/** Dual format storage: with H1 visible, and with H1 hidden. (schemaVersion >= 5) */
export interface HeadingFormatVariants {
  withLevelOne: NumberFormatSegment[]
  withoutLevelOne: NumberFormatSegment[]
}

// ── Two-layer data model (schemaVersion >= 7) ────────────

/**
 * Layer 1: Per-level number template.
 * Defines what a single level's number looks like: prefix + token + suffix.
 * Example: H1 = { tokenStyle: 'chinese', prefix: '第', suffix: '章' } → "第一章"
 */
export interface HeadingLevelNumberTemplate {
  tokenStyle: NumberTokenStyle
  prefix: string
  suffix: string
}

/**
 * Layer 2: Multilevel composition segment.
 * References a complete level template (prefix+token+suffix), not just the number.
 * level-template-reference = the entire rendered template for that level.
 * @deprecated Use ContextualFormatSegment (schemaVersion >= 8).
 */
export type MultilevelFormatSegment =
  | { type: 'level-template-reference'; level: HeadingLevel }
  | { type: 'literal'; value: string }

/** Dual format storage using multilevel composition segments. (schemaVersion >= 7)
 * @deprecated Use ContextualFormatVariants (schemaVersion >= 8). */
export interface MultilevelFormatVariants {
  withLevelOne: MultilevelFormatSegment[]
  withoutLevelOne: MultilevelFormatSegment[]
}

// ── Contextual model (schemaVersion >= 8) ─────────────────

/**
 * The appearance of a single level reference within a contextual format.
 * Each level-reference segment carries its own tokenStyle/prefix/suffix,
 * independent of the referenced level's global template.
 */
export interface LevelReferenceAppearance {
  tokenStyle: NumberTokenStyle
  prefix: string
  suffix: string
}

/**
 * A segment in a contextual multilevel format array.
 * Each segment has a stable `id` and its own independent appearance.
 *
 * - level-reference: a reference to a specific heading level,
 *   with its own tokenStyle/prefix/suffix.
 * - literal: a plain text string inserted into the label.
 */
export type ContextualFormatSegment =
  | {
      id: string
      type: 'level-reference'
      level: HeadingLevel
      appearance: LevelReferenceAppearance
    }
  | {
      id: string
      type: 'literal'
      value: string
    }

/** Dual format storage using contextual format segments. (schemaVersion >= 8) */
export interface ContextualFormatVariants {
  withLevelOne: ContextualFormatSegment[]
  withoutLevelOne: ContextualFormatSegment[]
}

/** Create a default level reference appearance. */
export function createDefaultReferenceAppearance(
  tokenStyle: NumberTokenStyle = 'arabic',
): LevelReferenceAppearance {
  return { tokenStyle, prefix: '', suffix: '' }
}

/** Create a default level template for a given token style. */
export function createDefaultLevelTemplate(tokenStyle: NumberTokenStyle = 'arabic'): HeadingLevelNumberTemplate {
  return { tokenStyle, prefix: '', suffix: '' }
}

export interface HeadingLevelStyle {
  /** Whether this level shows a number. false = empty token. */
  enabled: boolean
  /** The number token type. (Legacy: prefer levelTemplate.tokenStyle when available) */
  tokenStyle: NumberTokenStyle
  /** Include parent-level numbers in this level's label. (Deprecated: use multilevelFormatVariants) */
  includeParents: boolean
  /** Text prepended before the number. (Deprecated: use levelTemplate.prefix) */
  prefix: string
  /** Text appended after the number. (Deprecated: use levelTemplate.suffix) */
  suffix: string
  /** Separator between this level and the previous level when includeParents is true. (Deprecated) */
  separator: string
  /** Starting number for this level (1-999). Counter initial = startAt - 1. */
  startAt: number
  /** Which parent level restarts this level's counter. null = continuous across document. */
  restartAfterLevel: HeadingLevel | null
  /** Dual-format variants for H1 on/off. (schemaVersion >= 5, deprecated in v7) */
  formatVariants: HeadingFormatVariants
  /** Legacy single format (schemaVersion < 5). Only used during migration, not at runtime. */
  format?: NumberFormatSegment[]

  // ── Two-layer data model (schemaVersion >= 7) ──────────

  /** Layer 1: Per-level number template (prefix + tokenStyle + suffix). */
  levelTemplate: HeadingLevelNumberTemplate
  /** Layer 2: Multilevel composition using level-template-references. (Deprecated: use contextualFormatVariants) */
  multilevelFormatVariants: MultilevelFormatVariants
  /** Layer 2 (schemaVersion >= 8): Contextual composition with per-reference appearance. */
  contextualFormatVariants: ContextualFormatVariants

  // ── Number-to-title spacing ──────
  numberTitleSpacing?: NumberTitleSpacing
}

// ── Heading layout ───────────────────────────────────────

export type HeadingTextAlign = 'left' | 'center' | 'right'

export type NumberTitleSpacing = 'none' | 'space'

export interface HeadingLayoutConfig {
  textAlign: HeadingTextAlign
  firstLineIndentEm: number
}

export interface HeadingLayoutSettings {
  h1: HeadingLayoutConfig
  h2: HeadingLayoutConfig
  h3: HeadingLayoutConfig
  h4: HeadingLayoutConfig
  h5: HeadingLayoutConfig
  h6: HeadingLayoutConfig
}

// ── Settings ─────────────────────────────────────────────

export interface HeadingNumberingSettings {
  enabled: boolean
  /**
   * Authoritative heading structure mode.
   * strict: H1 as unique document title, not numbered; numbering starts at H2.
   * loose:  H1 as normal heading, participates in numbering; unlimited H1 count.
   */
  headingStructureMode?: import('./heading-structure').HeadingStructureMode
  /**
   * @deprecated Legacy compatibility only.
   * Runtime structure behavior is resolved from `headingStructureMode`.
   * This field is preserved for backward compat with old configs and custom formats.
   */
  showLevelOneNumber: boolean
  preset: HeadingNumberingPreset
  maxDepth: HeadingLevel
  /** Legacy fields kept for migration; not used in current format. */
  separator?: string
  suffix?: string
  showTrailingSeparator?: boolean
  /** Per-level style configuration (active, used when preset = 'custom'). */
  levels: Record<HeadingLevel, HeadingLevelStyle>
  /** Persisted custom draft (schemaVersion >= 2). Preserved when switching between presets. */
  customDefinition?: Record<HeadingLevel, HeadingLevelStyle>
  /** Per-level heading layout (alignment + indent). Independent of numbering enabled state. */
  headingLayouts?: HeadingLayoutSettings
  /**
   * Whether the loose-mode H6 extension slot (S6) has been explicitly configured.
   * When false, loose H6 keeps native/original formatting.
   * When true, loose H6 uses S6 settings (stored in levels[6]).
   * Always ignored in strict mode.
   */
  s6Configured?: boolean
}

// ── Runtime types ────────────────────────────────────────

export type RefreshReason =
  | 'initial-load'
  | 'editor-input'
  | 'composition-end'
  | 'framework-edit'
  | 'file-open'
  | 'active-leaf-change'
  | 'manual'
  | 'toggle'
  | 'tail-refresh'
  | 'editor-mutation'
  | 'focus-in'
  | 'editor-click'
  | 'editor-keyup'
  | 'decoration-repair'

export interface HeadingSnapshot {
  key: string
  level: HeadingLevel
}

export interface RenderedHeadingState {
  element: HTMLElement
  key: string
  level: HeadingLevel
  label: string
}

export interface DiffResult {
  scanned: number
  repaired: number
  updated: number
  removed: number
}

export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

// ── Heading level range ──────────────────────────────────

/** Maximum effective heading level. 2=H1-H2, 6=H1-H6. */
export type MaxHeadingLevel = 2 | 3 | 4 | 5 | 6

/** Range: H1-H2, H1-H3, ..., H1-H6. Never H1-H1. */
export const ALLOWED_MAX_LEVELS: readonly MaxHeadingLevel[] = [2, 3, 4, 5, 6]

/** Per-document heading level override. */
export interface DocumentHeadingLevelOverride {
  mode: 'inherit' | 'custom'
  maxLevel?: MaxHeadingLevel
}

/** Global + per-document heading level range settings. */
export interface HeadingLevelRangeSettings {
  defaultMaxLevel: MaxHeadingLevel
  documentOverrides: Record<string, DocumentHeadingLevelOverride>
}

/** Compute the effective max heading level for a given document. */
export function resolveEffectiveMaxLevel(
  rangeSettings: HeadingLevelRangeSettings,
  docPath: string | null,
): HeadingLevel {
  if (docPath) {
    const override = rangeSettings.documentOverrides[docPath]
    if (override?.mode === 'custom' && override.maxLevel != null) {
      return override.maxLevel
    }
  }
  return rangeSettings.defaultMaxLevel
}

/** Validate/normalize a maxLevel value. */
export function clampMaxLevel(value: unknown): MaxHeadingLevel {
  const n = typeof value === 'number' ? Math.round(value) : 6
  if (n >= 2 && n <= 6) return n as MaxHeadingLevel
  return 6
}

/** Generate a stable pseudo-random id for format segments. */
let _idCounter = 0
export function generateStableId(): string {
  _idCounter++
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  const ts = Date.now().toString(36)
  return `${ts}-${rand}-${_idCounter}`
}

// ── Heading numbering override ──────────────────────────

/** Per-heading numbering control mode. */
export type HeadingNumberingOverrideMode = 'inherit' | 'numbered' | 'unnumbered'

/** Per-heading numbering override stored per document. */
export interface HeadingNumberingOverride {
  /** Stable heading fingerprint (not data-line based). */
  headingKey: string
  mode: HeadingNumberingOverrideMode
  /** Scope of the override: self only or entire subtree. */
  scope: 'self' | 'subtree'
  /** Origin of the override for UI display. */
  source: 'manual' | 'batch' | 'name-rule'
  updatedAt?: number
}

/** Per-document heading numbering overrides. */
export interface DocumentHeadingNumberingOverrides {
  documentKey: string
  overrides: Record<string, HeadingNumberingOverride>
}

/** Counter policy for unnumbered headings. */
export type UnnumberedCounterPolicy = 'skip' | 'consume'

/** Matching mode for special heading name detection. */
export type NameMatchMode = 'exact' | 'trim' | 'loose'

/** Behavior after name match. */
export type NameMatchAction = 'prompt' | 'auto-unnumbered' | 'prompt-on-create'

/** A single name rule for special heading detection. */
export interface SpecialHeadingNameRule {
  /** The candidate text. */
  text: string
  /** Whether this rule is enabled. */
  enabled: boolean
  /** Whether user has chosen "don't show again" for this rule. */
  dismissed?: boolean
}

/** Settings for special heading name recognition. */
export interface SpecialHeadingNameSettings {
  enabled: boolean
  candidates: SpecialHeadingNameRule[]
  matchMode: NameMatchMode
  matchAction: NameMatchAction
}

/** Settings for special heading numbering behavior. */
export interface SpecialHeadingNumberingSettings {
  unnumberedCounterPolicy: UnnumberedCounterPolicy
  nameSettings: SpecialHeadingNameSettings
}

/** Default name candidates. */
export const DEFAULT_NAME_CANDIDATES: string[] = [
  '摘要', 'Abstract', '关键词', 'Keywords',
  '引言', '前言', '结语', '总结',
  '参考文献', 'References', '致谢', '附录',
  '作者简介',
]

/** Generate a stable structural fingerprint for a heading. */
export function generateHeadingFingerprint(
  docKey: string,
  level: HeadingLevel,
  parentStructure: string,
  normalizedText: string,
): string {
  const hash = simpleHash(`${docKey}|${level}|${parentStructure}|${normalizedText}`)
  return `hfp-${level}-${hash}`
}

/** Simple string hash for fingerprint generation. */
function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

// ── Format library (user-managed custom formats) ──────────

/** Describes what a custom format was based on. */
export type FormatBasedOn =
  | { type: 'built-in'; presetId: string }
  | { type: 'custom'; formatId: string }
  | { type: 'blank' }

/** Identifies the source of a numbering format for a scope. */
export type NumberingFormatSource =
  | { type: 'built-in'; presetId: string }
  | { type: 'custom'; formatId: string; version?: number }
  | { type: 'snapshot' }

/** A user-managed custom numbering format. */
export interface CustomNumberingFormat {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  /** Monotonically increasing version. Incremented each time the format is saved. Used to detect outdated snapshots. */
  version: number
  basedOn: FormatBasedOn
  settings: {
    levels: Record<HeadingLevel, HeadingLevelStyle>
    /** @deprecated Legacy format metadata — not authoritative for scope structure mode. */
    showLevelOneNumber: boolean
    enabled: boolean
    maxDepth: HeadingLevel
  }
}

/** Persistent format library stored in plugin settings. */
export interface FormatLibrary {
  version: number
  formats: CustomNumberingFormat[]
  preferences: FormatLibraryPreferences
}

/** Built-in preset IDs (excluding 'custom'). Ordered as they appear in the UI. */
export type BuiltInPresetId =
  | 'decimal-hierarchical'
  | 'chinese-chapter'
  | 'chinese-outline'
  | 'academic-paper'
  | 'chapter-section-clause'
  | 'appendix-hierarchical'
  | 'roman-hierarchical'
  | 'roman-mixed'
  | 'letter-mixed'

export const BUILT_IN_PRESET_IDS: readonly BuiltInPresetId[] = [
  'decimal-hierarchical',
  'chinese-chapter',
  'chinese-outline',          // 党政公文（四级）
  'academic-paper',
  'chapter-section-clause',
  'appendix-hierarchical',
  'roman-hierarchical',       // 全罗马层级
  'roman-mixed',
  'letter-mixed',
]

/** User preferences for the format library UI. */
export interface FormatLibraryPreferences {
  /** IDs of built-in presets that the user has chosen to hide. */
  hiddenBuiltInPresetIds: BuiltInPresetId[]
  /** Stable ordering of user custom formats (format IDs). */
  customFormatOrder: string[]
}

// ── Paragraph layout ─────────────────────────────────────

/** Body paragraph indent mode. */
export type ParagraphIndentMode = 'flush' | 'indent-2'

/** Paragraph indent override: 'auto' = follow rules, 'force-indent-2' = always 2em. */
export type ParagraphIndentOverride = 'auto' | 'force-indent-2'

/** Per-paragraph context for indent resolution. */
export interface ParagraphLayoutContext {
  isContinuationAfterDisplayMath: boolean
}

/** User-facing paragraph layout settings. */
export interface ParagraphLayoutSettings {
  defaultIndent: ParagraphIndentMode
  flushAfterDisplayMath: boolean
  indentShortcutEnabled: boolean
}

/** Semantic marker key used in HTML comments. */
export const PARAGRAPH_INDENT_MARKER = 'inkchapter:paragraph-indent=2'

export const DEFAULT_PARAGRAPH_LAYOUT: ParagraphLayoutSettings = {
  defaultIndent: 'flush',
  flushAfterDisplayMath: true,
  indentShortcutEnabled: true,
}

/**
 * Resolve the effective paragraph indent mode.
 *
 * Priority:
 * 1. force-indent-2 → always indent-2
 * 2. formula continuation (flushAfterDisplayMath enabled) → flush
 * 3. document default
 */
export function resolveParagraphIndent(
  override: ParagraphIndentOverride,
  context: ParagraphLayoutContext,
  documentDefault: ParagraphIndentMode,
): ParagraphIndentMode {
  if (override === 'force-indent-2') return 'indent-2'
  if (context.isContinuationAfterDisplayMath && documentDefault === 'indent-2') return 'flush'
  return documentDefault
}

// ── Heading numbering scope store (schema refactor) ──────

/** Scope for heading numbering settings. */
export type HeadingSettingsScope = 'global' | 'document'

/** Per-document heading numbering override. */
export interface HeadingNumberingDocumentOverride {
  updatedAt: number
  settings: HeadingNumberingSettings
  /** Which format was applied to create this snapshot (informational).
   *  Must remain stable when only layout overrides change. */
  formatSource?: NumberingFormatSource
  /** Document-level heading layout overrides (alignment, indent, gap).
   *  Independent of format source identity. Cleared on "restore default layout".
   *  Preserved across format re-application and template updates. */
  layoutOverrides?: DocumentLayoutOverrides
  /** Document-level paragraph layout settings. Undefined = inherit global. */
  paragraphLayout?: ParagraphLayoutSettings
}

/** Document-level layout overrides that don't affect format identity. */
export interface DocumentLayoutOverrides {
  /** Per-level alignment and indent. Key: "h1"–"h6". */
  headingLayouts?: Partial<Record<string, HeadingLayoutConfig>>
  /** Per-level number-to-title spacing overrides. */
  numberTitleSpacing?: Partial<Record<HeadingLevel, NumberTitleSpacing>>
}

/** Persistent store: global default + per-document overrides. */
export interface HeadingNumberingScopeStore {
  schemaVersion: number
  globalDefault: HeadingNumberingSettings
  documentOverrides: Record<string, HeadingNumberingDocumentOverride>
  /** Global default paragraph layout settings. */
  globalParagraphLayout: ParagraphLayoutSettings
}

/** Request payload for saving heading numbering settings. */
export interface SaveHeadingSettingsRequest {
  scope: HeadingSettingsScope
  documentKey: string | null
  settings: HeadingNumberingSettings
  /** Which format was applied to create this snapshot (informational). */
  formatSource?: NumberingFormatSource
}

/** Runtime context: resolved effective settings for the current document. */
export interface DocumentNumberingContext {
  documentKey: string | null
  settingsRevision: number
  effectiveSettings: HeadingNumberingSettings
  source: 'global' | 'document'
}

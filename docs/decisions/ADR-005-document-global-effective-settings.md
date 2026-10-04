# ADR-005: Document/Global Effective Settings Model

## Status

Accepted (2026-08)

## Context

InkChapter needs per-document heading numbering settings that override global defaults. Users must be able to configure document A with one format and document B with another, without cross-contamination. Early implementations used a single flat settings object, causing document-level changes to accidentally mutate shared references.

## Decision

**Three-layer settings model with explicit scope separation:**

### Layer 1: Global Default
- `HeadingNumberingScopeStore.globalDefault` — the baseline for all documents
- Single source of truth for "no document override" behavior

### Layer 2: Document Override
- `HeadingNumberingScopeStore.documentOverrides[documentKey]` — per-document overrides
- Stores only the delta from global default
- Keyed by vault-relative path (`generateDocumentKey()`)
- Includes `formatSource` reference and `layoutOverrides`

### Layer 3: Effective Settings (computed, not stored)
- `resolveEffectiveSettings(store, documentKey)` — merges Layer 1 + Layer 2
- Returns deep-cloned copy — no shared mutable references
- Sets `source: 'global' | 'document'` for UI display
- Non-custom presets always regenerate from `getPresetLevels()`

## Consequences

- `deepMergeSettings()` and `deepCloneSettings()` are critical — must not share object references
- Document key is path-based; file rename breaks the override link
- Layout overrides (`headingLayouts`, `numberTitleSpacing`) are independent of format identity
- Scope bar UI displays `source` from `DocumentNumberingContext`

## Invariants

1. **`deepMergeSettings` must return a deep clone with no shared nested objects.** Shallow spread of `levels` or `headingLayouts` causes cross-document mutation.
2. **`resolveEffectiveSettings` must regenerate preset levels for non-custom presets.** Cached preset snapshots would not pick up code fixes.
3. **`s6Configured` must be propagated through `deepMergeSettings`.** Missing propagation caused S6 configured state loss on document-level merge.
4. **Document override removal (`removeDocumentOverride`) must fully clean the key, including formatSource.** Stale data in the override map causes ghost format states.
5. **Format application must carry formatSource at the correct scope level.** Applying to "document" scope must set formatSource on the document override, not global.

## Rejected Alternatives

- **Flat settings with runtime scope filtering**: No clear separation; document changes leak to global.
- **Full copy per document**: Storage bloat; no way to know what's an override vs default.
- **Scope as a tagged union on every field**: Over-engineered; the merge model is simpler and sufficient.

## Related

- `src/heading-numbering/heading-numbering-scope-store.ts` — `resolveEffectiveSettings()`, `deepMergeSettings()`, `deepCloneSettings()`, `generateDocumentKey()`
- `src/heading-numbering/heading-types.ts` — `HeadingNumberingScopeStore`, `DocumentNumberingContext`, `HeadingNumberingDocumentOverride`
- `src/settings/heading-numbering-setting-tab.ts` — `renderScopeBar()`, `headingScope`, `headingDraft`
- `docs/modules/document-scoped-settings.md`
- `docs/decisions/ADR-004-format-source-applied-snapshot-version.md`

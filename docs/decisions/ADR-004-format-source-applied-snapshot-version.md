# ADR-004: Format Source, Applied Snapshot, and Version Separation

## Status

Accepted (2026-08)

## Context

The format library allows users to create, edit, and apply custom numbering formats. Early implementations conflated "which format is selected," "what the format definition currently is," and "what was actually applied to the document." This caused bugs where:
- Editing a custom format silently changed documents that had "applied" it
- The "update" button appeared incorrectly (false dirty state)
- Format application state leaked between documents that shared the same format

## Decision

**Three distinct concepts with separate storage:**

### 1. Format Definition (in FormatLibrary)
- The canonical source of a format's current definition
- Stored in `settings.formatLibrary.formats[]`
- Owned by the user's format library
- Has a `version` counter incremented on each save

### 2. Applied Snapshot (in scope store)
- A snapshot of the format definition at the time of application
- Stored in `globalDefault` or `documentOverrides[docKey].settings`
- Lives with the scope, not the format
- Has a `formatSource` reference: `{ formatId, versionAtApply }`

### 3. Effective Settings (resolved at runtime)
- Computed by `resolveEffectiveSettings()` for each document
- Merges global default + document override
- Non-custom presets always regenerate from `getPresetLevels()` to pick up fixes

## Consequences

- Editing a format does NOT change documents that applied it (they keep their snapshot)
- The "update" button compares `versionAtApply < format.version` to determine staleness
- `formatSource` must be cleaned when switching to "inherit" or different format
- Format application is scoped (global or per-document) and tracked independently

## Invariants

1. **Format definition and applied snapshot are separate copies.** Editing one does not mutate the other.
2. **`formatSource.versionAtApply` is the authoritative staleness signal.** Do not derive "has update" from any other field.
3. **Scope switch (global ↔ document) must preserve the correct formatSource.** Stale formatSource from previous scope causes false update notifications.
4. **`resolveEffectiveSettings()` regenerates presets from code, not persisted snapshot.** This ensures preset fixes propagate without user re-save.

## Rejected Alternatives

- **Live-linked format application**: Any format edit instantly changes all applied documents — surprising and destructive.
- **Snapshot without version tracking**: No way to detect "update available" state.
- **Format definition stored per-document**: Format library loses its purpose; no reuse.

## Related

- `src/heading-numbering/format-library.ts` — `hasFormatUpdate()`, `getFormatVersion()`, `AppliedFormatInfo`
- `src/heading-numbering/heading-numbering-scope-store.ts` — `resolveEffectiveSettings()`, `deepMergeSettings()`
- `src/heading-numbering/heading-types.ts` — `FormatLibrary`, `NumberingFormatSource`, `FormatBasedOn`
- `docs/analysis/apply-update-still-outdated-diagnosis/20260805-0030/08-root-cause-report.md`

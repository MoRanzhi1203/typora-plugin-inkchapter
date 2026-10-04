# ADR-002: Loose H6 Optional S6 Configured Semantics

## Status

Accepted (2026-08)

## Context

Loose mode has 6 physical headings (H1-H6) but only 5 shared slots (S1-S5). H6 in loose mode needed a design decision: should it auto-inherit S5 behavior, or should it remain native/unmanaged by default?

The previous design auto-numbered loose H6 using the same system as H5, which gave users no choice to exclude H6 from InkChapter styling while keeping the loose mode benefits for H1-H5.

## Decision

**S6 is an optional extension slot, loose-only.** Loose H6 defaults to `configured=false` — InkChapter does not manage it. The native Typora/theme H6 styling is preserved.

Three explicit states replace the old boolean on/off:

| State | configured | numberingEnabled | Behavior |
|-------|-----------|-----------------|----------|
| Unconfigured | false | — | Native H6, no InkChapter involvement |
| Configured + Numbered | true | true | S6 numbering + S6 layout |
| Configured + Layout Only | true | false | S6 layout only (alignment/indent), no number |

## Consequences

- `configured` and `numberingEnabled` are separate concerns — never conflate them
- Strict mode always ignores S6 (no S6 binding exists for strict)
- Mode switch never creates or deletes S6 — it only changes the binding map
- "Restore native H6" sets `configured=false`; historical S6 style data is preserved but inactive

## Invariants

1. **`configured=false` means native/unmanaged.** Do not infer `configured=true` from the existence of `levels[6]`, non-empty suffix, or composition data.
2. **Runtime must use `configured` as the sole authority for whether to manage H6.** Never derive from derived data.
3. **`numberingEnabled=false` ≠ `configured=false`.**
4. **Strict mode must never read or write S6.** S6 is loose-only.
5. **`deepMergeSettings` must propagate `s6Configured`.** Missing propagation caused the runtime chain bug where override lost configured state.

## Rejected Alternatives

- **Auto-inherit S5 for loose H6**: Removes user choice; forces all H6 to be numbered.
- **Single boolean on/off for S6**: Cannot distinguish "never configured" from "configured but numbering off."
- **S6 as shared core slot**: Breaks strict mode semantics (strict has no 6th numbered level).

## Related

- `src/heading-numbering/numbering-engine.ts` L231-236 — S6 configured check
- `src/heading-numbering/heading-types.ts` — `s6Configured` field
- `src/heading-numbering/heading-numbering-scope-store.ts` — `deepMergeSettings` s6Configured propagation
- `src/settings/heading-numbering-setting-tab.ts` — S6 enable/restore UI buttons
- `docs/modules/strict-loose-heading-structure.md`
- `docs/decisions/ADR-001-shared-style-slot-architecture.md`

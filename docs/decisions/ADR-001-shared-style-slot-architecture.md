# ADR-001: Strict/Loose Shared Style Slot Architecture

## Status

Accepted (2026-08)

## Context

InkChapter supports two heading structure modes: strict (H1 = document title, unnumbered) and loose (H1 = numbered). Initially these modes stored independent per-level styles, causing data duplication and mode-switch drift. The system needed a way to express that "the style for the first numbered heading level should be the same regardless of mode."

## Decision

**Define 5 shared style slots S1-S5** that both strict and loose reference:

| Slot | Strict Physical | Loose Physical |
|------|----------------|----------------|
| S1   | H2             | H1             |
| S2   | H3             | H2             |
| S3   | H4             | H3             |
| S4   | H5             | H4             |
| S5   | H6             | H5             |

Each slot stores the complete heading-level style: numbering format, composition, prefix/suffix, start/restart, references, number-title gap, alignment, first-line indent.

**Mode switching only changes the physical→slot binding mapping.** It never copies S1-S5 data or creates new slot versions.

## Consequences

- Single source of truth for per-level styles across both modes
- Mode switch is O(1) — no data migration needed
- Strict mode has no S6; S6 is loose-only

## Invariants

1. **Do NOT use physical heading level as style slot index.** Always resolve through `resolveStyleSlot(mode, physicalLevel)`.
2. **Do NOT copy S1-S5 to implement mode switching.** The binding map is the only thing that changes.
3. **Do NOT modify stored references (+1/-1) when switching mode.** References are stored as slot indices, not physical levels.
4. **Format application (apply preset/format) must not change `headingStructureMode`.** Mode is independent of format selection.

## Rejected Alternatives

- **Per-mode independent level storage**: Duplicated data, mode-switch drift on every edit.
- **Mode-as-format-variant**: Mixed concerns — format selection should not change heading semantics.
- **Single unified L1-L6 model**: Would require full schema migration and break backward compatibility.

## Related

- `src/heading-numbering/heading-structure.ts` — `resolveStyleSlot()`, `resolvePhysicalHeadingForStyleSlot()`
- `docs/modules/strict-loose-heading-structure.md`
- `docs/decisions/ADR-002-loose-h6-optional-s6.md`
- `docs/decisions/ADR-003-psr-coordinate-model.md`

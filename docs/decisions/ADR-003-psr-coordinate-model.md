# ADR-003: P/S/R Coordinate Model and Reference-Slot Storage

## Status

Accepted (2026-08)

## Context

The shared style slot architecture introduced three overlapping coordinate spaces that caused persistent bugs: physical heading levels, style slot indices, and reference roles. Early implementations mixed these freely — the same `number` type variable could represent a physical level in one function and a slot index in another. This caused the "H2→H3 double shift" bug where `draft.levels[lv]` used physical lv=2 instead of slotLv=1 to read S1 data.

## Decision

**Three named coordinate spaces with explicit conversion functions:**

- **P (Physical)**: H1-H6 — what the user sees and clicks in the UI
- **S (Style Slot)**: S1-S6 — what is stored in `levels[key]` and `segment.level`
- **R (Reference Role)**: SELF, PARENT_1, PARENT_2, ... — what references point to

Core conversion functions:
- `resolveStyleSlot(mode, physicalLevel)` → slot index (P→S)
- `resolvePhysicalHeadingForStyleSlot(mode, slot)` → physical level (S→P)

**Storage rule**: All persisted data (levels keys, segment.level, reference values) use S (slot indices). UI display converts S→P for labels only.

## Consequences

- UI shows physical levels ("H2", "H3") but stores slot indices (1, 2, ...)
- Reference selector displays physical labels via S→P conversion; never modifies stored slot values
- `segment.level` is always a slot index, never a physical level
- `ensureAllLevelsHaveCurrentSegment` must use slotLv (not physical lv) for `seg.level` matching

## Invariants

1. **Do NOT use physical heading level as a key into `levels` or `draft.levels`.** Always resolve through slot mapping first.
2. **Do NOT modify stored reference values (+1/-1) for UI display.** UI conversion is read-only.
3. **`segment.level` = Style Slot, always.** Never store physical level in segment.level.
4. **Reference internal storage uses S indices.** ReferenceOption.value = slot index.
5. **UI display conversion S→P must not mutate stored data.** It only transforms labels.

## Rejected Alternatives

- **Store physical levels everywhere**: Breaks shared slots — the same S1 data would need different physical levels in strict vs loose.
- **Runtime-only slot mapping with physical storage**: Causes double-shift bugs when mapping is applied twice (physical→slot→"physical"→slot).
- **Separate S and P fields everywhere**: Over-engineered for the problem; a single disciplined rule (store S, display P) suffices.

## Related

- `src/heading-numbering/heading-structure.ts` — slot mapping functions
- `src/settings/heading-numbering-setting-tab.ts` — UI physical label display (`getLevelLabel`)
- `src/heading-numbering/numbering-engine.ts` — `ensureAllLevelsHaveCurrentSegment` slotLv fix
- 原始根因证据已随提示词整合迁入 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)（shared-slot editor reference / live-preview 根因审计）
- `docs/modules/strict-loose-heading-structure.md` § P/S/R
- `docs/decisions/ADR-001-shared-style-slot-architecture.md`

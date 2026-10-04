# Document Diagnostics — Caption Integrity Runtime Fixture (Phase G)

> Runtime smoke fixture for `FIGURE/TABLE/CODE` `_ORPHAN_CAPTION` /
> `_MULTIPLE_CAPTIONS` / `_CAPTION_FORMAT_INVALID`.
>
> Open this file inside the REAL vault window (InkChapter loaded) with the
> caption system enabled. Captions are DOM projections written by the caption
> service (the ONLY writer); the diagnostics are produced by
> `computeCaptionIntegrityDiagnostics` and merged into the SAME document
> diagnostics snapshot as the source-only rules.

## C1 — Figure normal (expected: orphan=0, multiple=0, format=0)

![墨章示例图](assets/caption-fixture-a.png)

## C5 — Table normal (expected: orphan=0, multiple=0, format=0)

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

## C6 — Code normal (expected: orphan=0, multiple=0, format=0)

```ts
const inkChapter = 'caption-integrity'
```

## C7 — Duplicate destination figure isolation

Two figures reference the SAME image destination. Their canonical object owners
are DISTINCT (identity is positional, never content-based), so each keeps its own
caption and NO caption-integrity diagnostic may cross owner.

![重复目标一](assets/caption-fixture-a.png)

![重复目标二](assets/caption-fixture-a.png)

## Non-runtime cases (cannot be produced by Markdown through the canonical writer)

The caption service ALWAYS writes exactly one canonical (formatter-conformant)
caption per owned object. Therefore the following cases CANNOT be manufactured
by editing this Markdown; they are exercised by the unit/DOM fixture tests
(`document-diagnostics-caption-integrity-v1.test.ts`):

- C2 ORPHAN — a projection whose canonical owner is gone/disconnected.
- C3 MULTIPLE — one canonical owner with >1 projection.
- C4 FORMAT — a projection whose label is not the canonical formatter output.

### Runtime checklist

1. Open the left file tree inside the real vault window.
2. Confirm the section/table/code all render exactly ONE caption each.
3. Confirm the Drawer shows NO caption-integrity hint for this fixture.
4. Confirm the duplicate-destination figures each show their OWN caption
   (never swapped, never a shared owner).

# Document Diagnostics — Anchor Integrity Runtime Fixture (Phase I)

> Runtime smoke fixture for the Phase I anchor-integrity families (§10).
>
> Open this file inside the REAL vault window (InkChapter loaded).
>
> Canonical heading anchor authority = Typora's OWN rendered heading id
> (`el.id`) — the SAME identity the outline adapter matches `href="#id"` against
> (`outline-numbering-adapter.matchHeadingsToOutline`). The rule NEVER writes a
> slugifier and NEVER parses a rendered number.

## A1 — valid local anchor (expected: PASS)

Jump to [标题一](#a1-标题一).

## A1 标题一

This heading's Typora anchor resolves the link above.

## A2 — missing local anchor (expected: LINK_LOCAL_ANCHOR_MISSING)

Jump to [不存在的锚点](#这个锚点不存在).

Expected: exactly ONE `LINK_LOCAL_ANCHOR_MISSING` Warning, located at the link
source range. When NO heading carries an id (anchor authority unavailable) the
rule stays SILENT (never a false positive).

## A3 — heading anchor collision (expected: HEADING_ANCHOR_COLLISION)

One collision group → ONE business diagnostic (a target-group), never N.

Duplicate ATX headings normally get DEDUPLICATED ids from Typora, so this case
is defensively checked: if Typora emits two headings with the SAME id, exactly
ONE `HEADING_ANCHOR_COLLISION` (target-group of both headings) is shown. The
mechanism is proven by the unit fixture
(`document-diagnostics-numbering-anchor-integrity-v1.test.ts`).

## A3 重复锚点

## A3 重复锚点

## A4 / A5 — local FILE + anchor (DEFERRED_BY_SPEC)

`[x](other.md#target)` — file existence is already covered by
`LINK_LOCAL_TARGET_MISSING`; validating the anchor INSIDE another Markdown file
requires reading that file's heading anchor index, which is not safe in the
source-only producer. `LINK_LOCAL_FILE_ANCHOR_MISSING` therefore stays
`DEFERRED_BY_SPEC` (never faked, never guessed).

## Runtime checklist

1. Open the left file tree inside the real vault window.
2. A1 link resolves (no diagnostic); A2 shows ONE Warning.
3. A3 shows NO false positive when anchors are distinct.
4. A4/A5 produce NO diagnostic (family DEFERRED_BY_SPEC).

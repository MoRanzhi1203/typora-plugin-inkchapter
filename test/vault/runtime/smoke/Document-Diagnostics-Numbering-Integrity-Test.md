# Document Diagnostics — Numbering Integrity Runtime Fixture (Phase H / Numbering V2)

> Runtime smoke fixture for the numbering-integrity families (§9 / §21).
>
> Open this file inside the REAL vault window (InkChapter loaded) with the
> object / heading auto-numbering settings configured as noted per section.
>
> Canonical authorities (NO rendered-text number regex is ever used):
> `computeObjectNumbers` / `buildObjectNumberingLabel` (object numbering engine),
> `planFormulaSemanticNumbers` (formula semantic planner), `detectManualNumberPrefix`
> (the ONE manual-prefix parser). The numbering integrity rules consume ONLY the
> caption service's published "effective number" snapshot
> (`getObjectEffectiveNumberElementFacts`), joined to the diagnostics' OWN
> `block:<kind>:<ordinal>` source identity. When that snapshot is absent / empty
> every number rule stays SILENT. Diagnostic identities derive from the object's
> SOURCE identity (block ordinal), never from a generated number — switching the
> number STYLE (Chinese / Decimal / Roman) must NOT change any diagnostic id.

## N1–N3 — duplicate numbers

Two canonical objects of the same type resolving to the SAME effective number.

Expected: `FIGURE_NUMBER_DUPLICATE` / `TABLE_NUMBER_DUPLICATE` /
`CODE_NUMBER_DUPLICATE` (Warning) — ONE target-group diagnostic per duplicated
number, targeting the offending objects by block ordinal identity.

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

```ts
const duplicate = 'N1-N3'
```

## N4–N6 — out-of-order numbers

Effective numbers not strictly increasing in document order.

Expected: `FIGURE_NUMBER_ORDER_INVALID` / `TABLE_NUMBER_ORDER_INVALID` /
`CODE_NUMBER_ORDER_INVALID` (Warning) — ONE diagnostic on each offending object.
Requires a COMPLETE provider snapshot for the type (a partial snapshot stays
silent — never a false positive).

## N7–N8 — formula order / section mismatch

`FORMULA_NUMBER_ORDER_INVALID` (Warning) and `FORMULA_NUMBER_SECTION_MISMATCH`
(Warning; fires ONLY when the formula number is section-scoped — a non-section
mode never invents a section number).

$$
a^2 + b^2 = c^2
$$

## N9 — Table manual prefix under auto numbering

Table auto-numbering is ON and the table NAME carries a manual number prefix.

Expected: `TABLE_MANUAL_NUMBER_PREFIX` (Warning) — ONE diagnostic whose target is
the WHOLE table block (block ordinal identity), NOT the generated number.

Steps (name lives in the caption sidecar, not in this Markdown):

1. Enable table auto-numbering.
2. Set this table's name to `1. 数据表`.
3. Confirm exactly ONE `TABLE_MANUAL_NUMBER_PREFIX` warning.

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

## N10 — Code manual prefix under auto numbering

Code auto-numbering is ON and the code NAME carries a manual number prefix.

Expected: `CODE_MANUAL_NUMBER_PREFIX` (Warning), target = the code block.

Steps:

1. Enable code auto-numbering.
2. Set this code block's name to `1.1 示例`.
3. Confirm exactly ONE `CODE_MANUAL_NUMBER_PREFIX` warning.

```ts
const manual = 'N10'
```

## Style-switch stability check

1. Switch the table / code number style between **Chinese / Decimal / Roman**.
2. Confirm the number-integrity / manual-prefix diagnostic id / Drawer row is
   UNCHANGED (`NUMBER_STYLE_SWITCH_DIAGNOSTIC_ID_CHURN_COUNT=0`).

## Runtime checklist

1. Open the left file tree inside the real vault window.
2. N1–N8 produce a number-integrity diagnostic ONLY when the canonical effective
   numbers genuinely duplicate / decrease (never from rendered text, never when
   the provider snapshot is absent).
3. N9 / N10 each produce exactly ONE Warning after the name is set while the
   matching auto-numbering is ON; both disappear when auto-numbering is OFF.

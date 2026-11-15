/**
 * R08 — Projection dedupe for source-persisted numbers.
 *
 * The body heading DOM already CONTAINS the persisted number as real text
 * (`## 1.2 研究背景` renders the `1.2`). Projecting the same number again would
 * display `1.2 1.2 研究背景` in the body and `1.2 1.2 …` in the outline.
 *
 * This module is the single dedupe decision for BOTH surfaces: the caller passes
 * the same projection list to the body reconcile and the outline, so the two
 * surfaces can never disagree.
 *
 * Pure contract: no DOM, no host state.
 */

import type { HeadingDecorationProjection } from './heading-decoration-projection-v514-r4'
import { isRewritableHeadingNumber, scanHeadingNumber } from './heading-number-source-scanner'

export interface ProjectionSuppressionInput {
  key: string
  text: string
}

export interface ProjectionSuppressionResult {
  projections: HeadingDecorationProjection[]
  /** Identities whose projected number was suppressed because the source has one. */
  suppressed: string[]
}

/**
 * Empty every projection whose heading text already starts with a CONFIRMED
 * number prefix. Ambiguous prefixes (`2026 年研究报告`) keep their projection.
 */
export function suppressProjectionsForSourceNumbers(
  headings: readonly ProjectionSuppressionInput[],
  projections: readonly HeadingDecorationProjection[],
): ProjectionSuppressionResult {
  const suppressed: string[] = []
  const next = projections.map((projection, index) => {
    const heading = headings[index]
    if (!heading || projection.label === '') return projection
    const detected = scanHeadingNumber(heading.text).first
    if (!isRewritableHeadingNumber(detected)) return projection
    suppressed.push(heading.key)
    return { ...projection, label: '', gap: 'none' as const }
  })
  return { projections: next, suppressed }
}

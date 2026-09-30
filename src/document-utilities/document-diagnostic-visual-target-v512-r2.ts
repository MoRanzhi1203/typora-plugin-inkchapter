/**
 * V5.12-R2 — Generic DiagnosticVisualTargetResolver (pure contract).
 *
 * ROOT_R2_4 = ACTIVE_HEADING_STATE_REPLACES_PASSIVE_MARKER_STATE
 * ROOT_R2_5 = PASSIVE_HEADING_MARKER_ADMISSION_DEPENDS_ON_RULE/CATEGORY/LOCATION_SPECIAL_CASES
 *
 * There must be EXACTLY ONE way a diagnostic becomes a visual target:
 *
 *   diagnostic.location  →  ResolvedDiagnosticVisualTarget[]
 *
 * No ruleId special case (no `HEADING_LEVEL_GAP`, no
 * `STRICT_SINGLE_H1_MULTIPLE_H1`, no `HEADING_DUPLICATE_TEXT`, …). A rule whose
 * `location.kind === 'multi-target'` yields one resolved target per location
 * target, in the FROZEN declared order — so a multi-target heading diagnostic
 * automatically reaches the same passive heading marker renderer as a
 * single-target heading diagnostic.
 *
 * The resolver never queries the document itself: the caller injects the three
 * stable-identity resolvers the locator already owns.
 */

import type { DiagnosticLocation, DocumentDiagnosticSeverity } from './diagnostics-types'

export type DiagnosticVisualTargetKind =
  | 'heading'
  | 'inline-source'
  | 'block'
  | 'caption-slot'
  | 'document'

export interface ResolvedDiagnosticSourceRange {
  startLine: number
  startColumn: number
  endLine: number | null
  endColumn: number | null
}

export interface ResolvedDiagnosticVisualTarget {
  kind: DiagnosticVisualTargetKind
  diagnosticId: string
  severity: DocumentDiagnosticSeverity
  /** Stable identity used for dedupe / reconcile (§ identity authority). */
  targetIdentity: string
  /** Live element for element-carried targets; null for document targets. */
  element: HTMLElement | null
  /** Exact source range for inline targets (null otherwise). */
  sourceRange: ResolvedDiagnosticSourceRange | null
  /** FROZEN position inside a multi-target location (0-based); null otherwise. */
  targetIndex: number | null
  /** Resource occurrence ordinal from metadata (never re-derived here). */
  occurrenceIndex: number | null
  /** The declared multi-target count this target belongs to (1 = single). */
  targetCount: number
  targetKindLabel: string
}

export interface DiagnosticVisualTargetDeps {
  /** Canonical heading identity → live heading element. */
  resolveHeadingElement(stableIdentity: string, line: number | null): HTMLElement | null
  /** Source-range location → the owning block element (never a re-query). */
  resolveSourceRangeElement(location: {
    startLine: number
    startColumn: number
    endLine?: number
    endColumn?: number
    rawText?: string
  }): HTMLElement | null
  /** Block-node location → the canonical block element. */
  resolveBlockElement(
    blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link',
    stableIdentity: string,
  ): HTMLElement | null
}

/** Structural input — the resolver only consumes these three fields. */
export interface DiagnosticVisualTargetInput {
  id: string
  severity: DocumentDiagnosticSeverity
  stableIdentity?: string
  metadata?: Record<string, unknown> | null
  location?: DiagnosticLocation | null
}

function occurrenceIndexOf(input: DiagnosticVisualTargetInput): number | null {
  const meta = (input.metadata ?? {}) as Record<string, unknown>
  return typeof meta.occurrenceIndex === 'number' ? meta.occurrenceIndex : null
}

function lineOf(location: DiagnosticLocation): number | null {
  const rec = location as unknown as { startLine?: unknown }
  return typeof rec.startLine === 'number' ? rec.startLine : null
}

/**
 * §8 — the ONLY visual target authority. Pure; no DOM query, no rule switch.
 */
export function resolveDiagnosticVisualTargets(
  input: DiagnosticVisualTargetInput,
  deps: DiagnosticVisualTargetDeps,
): ResolvedDiagnosticVisualTarget[] {
  const location = input.location ?? null
  if (!location) return []
  const occurrenceIndex = occurrenceIndexOf(input)
  const out: ResolvedDiagnosticVisualTarget[] = []
  collect(location, null, 1, (t) => out.push(t))
  return out

  function makeBase(identity: string, targetIndex: number | null, targetCount: number, targetKindLabel: string): Omit<ResolvedDiagnosticVisualTarget, 'kind' | 'element' | 'sourceRange'> {
    return {
      diagnosticId: input.id,
      severity: input.severity,
      targetIdentity: identity,
      targetIndex,
      occurrenceIndex,
      targetCount,
      targetKindLabel,
    }
  }

  function collect(
    loc: DiagnosticLocation,
    targetIndex: number | null,
    targetCount: number,
    push: (t: ResolvedDiagnosticVisualTarget) => void,
  ): void {
    if (loc.kind === 'multi-target') {
      const targets = loc.targets
      for (let i = 0; i < targets.length; i++) {
        // §9 — the declared order IS the occurrence order (frozen).
        collect(targets[i], i, targets.length, push)
      }
      return
    }
    if (loc.kind === 'canonical-node' && loc.nodeKind === 'heading') {
      const identity = `heading:${loc.stableIdentity}`
      const el = deps.resolveHeadingElement(loc.stableIdentity, null)
      push({
        kind: 'heading',
        ...makeBase(identity, targetIndex, targetCount, 'canonical-heading'),
        element: el,
        sourceRange: null,
      })
      return
    }
    if (loc.kind === 'source-range') {
      const identity = `source:${loc.startLine}:${loc.startColumn}`
      const el = deps.resolveSourceRangeElement(loc)
      push({
        kind: 'inline-source',
        ...makeBase(identity, targetIndex, targetCount, 'source-range'),
        element: el,
        sourceRange: {
          startLine: loc.startLine,
          startColumn: loc.startColumn,
          endLine: typeof loc.endLine === 'number' ? loc.endLine : null,
          endColumn: typeof loc.endColumn === 'number' ? loc.endColumn : null,
        },
      })
      return
    }
    if (loc.kind === 'source-block' || loc.kind === 'figure-occurrence') {
      // V1 — the block / occurrence locators render through the SAME inline
      // source carrier the classic source-range used (the owning block element),
      // so the passive/active visual pipeline is unchanged.
      const isOccurrence = loc.kind === 'figure-occurrence'
      const startColumn = isOccurrence ? loc.startColumn : 0
      const identity = loc.kind === 'source-block'
        ? `block:${loc.sourceBlockIdentity}`
        : (loc.sourceRangeIdentity ?? `figure-occurrence:${loc.occurrenceIdentity.sourceBlockIdentity}:${loc.occurrenceIdentity.tokenStart ?? 'n'}`)
      const el = deps.resolveSourceRangeElement({
        startLine: loc.startLine,
        startColumn,
        endLine: loc.endLine,
        endColumn: isOccurrence ? loc.endColumn : undefined,
        rawText: isOccurrence ? loc.rawText : undefined,
      })
      push({
        kind: 'inline-source',
        ...makeBase(identity, targetIndex, targetCount, loc.kind),
        element: el,
        sourceRange: {
          startLine: loc.startLine,
          startColumn,
          endLine: loc.endLine ?? null,
          endColumn: (isOccurrence ? loc.endColumn : null) ?? null,
        },
      })
      return
    }
    if (loc.kind === 'block-node') {
      const identity = `${loc.blockKind}:${loc.stableIdentity}`
      const el = deps.resolveBlockElement(loc.blockKind, loc.stableIdentity)
      push({
        kind: 'block',
        ...makeBase(identity, targetIndex, targetCount, `block-${loc.blockKind}`),
        element: el,
        sourceRange: null,
      })
      return
    }
    // document-start / document-end — a document-level target carries no element.
    const line = lineOf(loc)
    push({
      kind: 'document',
      ...makeBase(`document:${loc.kind}:${line ?? ''}`, targetIndex, targetCount, loc.kind),
      element: null,
      sourceRange: null,
    })
  }
}

/** §8 — heading targets of ANY diagnostic (single- or multi-target). */
export function headingVisualTargets(
  targets: readonly ResolvedDiagnosticVisualTarget[],
): ResolvedDiagnosticVisualTarget[] {
  return targets.filter(t => t.kind === 'heading')
}

/** §8 — inline-source targets (exact source-range geometry authority). */
export function inlineVisualTargets(
  targets: readonly ResolvedDiagnosticVisualTarget[],
): ResolvedDiagnosticVisualTarget[] {
  return targets.filter(t => t.kind === 'inline-source')
}

/**
 * §8 Hard Gate — a multi-target H1 rule must reach the passive marker renderer.
 * `admitted` counts the heading targets that produced a live element.
 */
export function evaluateMultiTargetHeadingAdmission(input: {
  multiTargetHeadingTargets: number
  admittedHeadingElements: number
}): { missing: number } {
  const declared = input.multiTargetHeadingTargets
  const admitted = input.admittedHeadingElements
  return { missing: Math.max(0, declared - admitted) }
}

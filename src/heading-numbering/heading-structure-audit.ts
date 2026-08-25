/**
 * Phase 7R.3.11.8B.4.2 — Heading Structure Effective Authority runtime audits.
 *
 * PURE OBSERVABILITY ONLY. These emitters NEVER mutate settings, scope store,
 * effective settings, DOM, labels, or outline state. They read the authority
 * chain (persisted file / scope store / effective / resolved) and the projected
 * DOM, then emit state-deduped audits. Identical-state repeats are suppressed;
 * mode/scope/document transitions, invariant FAIL and persisted/runtime
 * divergence always re-emit.
 */
import * as fs from 'fs'
import * as path from 'path'
import { emitRuntimeAudit, emitRuntimeAuditStateDedup } from '../runtime/forensic-log-sink'
import type { HeadingStructureMode } from './heading-structure'
import { resolveStyleSlot } from './heading-structure'
import type { HeadingLevel } from './heading-types'

/** Plugin settings file name (framework persists under `.typora/data`). */
export const SETTINGS_FILE_NAME = 'ranzhi.inkchapter.json'

export interface PersistedModeSnapshot {
  mode: HeadingStructureMode | null
  legacyH1: boolean | null
}

/** Read the persisted `headingStructureMode` from the settings JSON file. */
export function readPersistedSettingsMode(vaultRoot: string | null): PersistedModeSnapshot {
  try {
    if (!vaultRoot) return { mode: null, legacyH1: null }
    const p = path.join(vaultRoot, '.typora', 'data', SETTINGS_FILE_NAME)
    if (!fs.existsSync(p)) return { mode: null, legacyH1: null }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      settings?: { headingNumberingScopes?: { globalDefault?: { headingStructureMode?: HeadingStructureMode; showLevelOneNumber?: boolean } } }
    }
    const gd = raw.settings?.headingNumberingScopes?.globalDefault
    return {
      mode: gd?.headingStructureMode ?? null,
      legacyH1: typeof gd?.showLevelOneNumber === 'boolean' ? gd.showLevelOneNumber : null,
    }
  } catch {
    return { mode: null, legacyH1: null }
  }
}

export interface EffectiveAuthorityInput {
  documentKey: string | null
  persistedGlobalMode: HeadingStructureMode | null
  persistedGlobalLegacyH1: boolean | null
  runtimeGlobalMode: HeadingStructureMode
  runtimeGlobalLegacyH1: boolean
  documentOverridePresent: boolean
  documentOverrideMode: HeadingStructureMode | null
  documentOverrideLegacyH1: boolean | null
  effectiveMode: HeadingStructureMode
  effectiveLegacyH1: boolean
  resolvedMode: HeadingStructureMode
  resolvedShowLevelOneNumber: boolean
  numberingRootPhysicalLevel: HeadingLevel
}

/**
 * §31 — HEADING-STRUCTURE-EFFECTIVE-AUTHORITY. State-deduped. Also drives
 * §9 SETTINGS-RUNTIME-PERSISTENCE-PARITY on the same signature.
 */
export function emitHeadingStructureEffectiveAuthority(input: EffectiveAuthorityInput): void {
  const persistedRuntimeDiverged =
    input.persistedGlobalMode != null && input.persistedGlobalMode !== input.runtimeGlobalMode
  const resolverDiverged = input.effectiveMode !== input.resolvedMode
  const decision = persistedRuntimeDiverged
    ? 'PERSISTED_RUNTIME_DIVERGED'
    : (resolverDiverged ? 'EFFECTIVE_RESOLVER_DIVERGED' : 'COHERENT')
  const signature = `${input.documentKey ?? ''}|${input.persistedGlobalMode ?? ''}|${input.runtimeGlobalMode}|${input.documentOverrideMode ?? ''}|${input.effectiveMode}|${input.resolvedMode}|${decision}`

  emitRuntimeAuditStateDedup('HEADING-STRUCTURE-EFFECTIVE-AUTHORITY', signature, {
    documentKey: input.documentKey,
    scopeView: 'effective',
    persistedGlobalMode: input.persistedGlobalMode,
    persistedGlobalLegacyH1: input.persistedGlobalLegacyH1,
    runtimeGlobalMode: input.runtimeGlobalMode,
    runtimeGlobalLegacyH1: input.runtimeGlobalLegacyH1,
    documentOverridePresent: input.documentOverridePresent,
    documentOverrideMode: input.documentOverrideMode,
    documentOverrideLegacyH1: input.documentOverrideLegacyH1,
    effectiveMode: input.effectiveMode,
    effectiveLegacyH1: input.effectiveLegacyH1,
    resolvedMode: input.resolvedMode,
    resolvedShowLevelOneNumber: input.resolvedShowLevelOneNumber,
    numberingRootPhysicalLevel: input.numberingRootPhysicalLevel,
    decision,
  })

  emitRuntimeAuditStateDedup('SETTINGS-RUNTIME-PERSISTENCE-PARITY', signature, {
    documentKey: input.documentKey,
    persistedGlobalMode: input.persistedGlobalMode,
    runtimeGlobalMode: input.runtimeGlobalMode,
    documentOverrideMode: input.documentOverrideMode,
    effectiveMode: input.effectiveMode,
    resolvedMode: input.resolvedMode,
    decision: persistedRuntimeDiverged ? 'PERSISTED_RUNTIME_DIVERGED' : 'MATCH',
  })
}

export interface MappingInvariantInput {
  documentKey: string | null
  mode: HeadingStructureMode
  /** Physical H1..H6 elements currently in the editor root. */
  headingElements: ReadonlyArray<{ level: HeadingLevel; numberAttr: string | null }>
}

/** Physical→style-slot mapping for every level in the given mode. */
export function computePhysicalSlotMapping(mode: HeadingStructureMode): Record<string, number | null> {
  return {
    physicalH1Slot: resolveStyleSlot(mode, 1),
    physicalH2Slot: resolveStyleSlot(mode, 2),
    physicalH3Slot: resolveStyleSlot(mode, 3),
    physicalH4Slot: resolveStyleSlot(mode, 4),
    physicalH5Slot: resolveStyleSlot(mode, 5),
    physicalH6Slot: resolveStyleSlot(mode, 6),
  }
}

/**
 * §32 — HEADING-NUMBERING-MAPPING-INVARIANT. Reads the projected DOM (the
 * `data-inkchapter-heading-number` attribute on physical heading elements) and
 * the mode's slot mapping. State-deduped.
 */
export function emitHeadingNumberingMappingInvariant(input: MappingInvariantInput): void {
  const h1Count = input.headingElements.filter(e => e.level === 1).length
  const visibleH1NumberCount = input.headingElements.filter(e => e.level === 1 && (e.numberAttr ?? '').trim() !== '').length
  const slots = computePhysicalSlotMapping(input.mode)

  let decision: 'PASS' | 'STRICT_H1_NUMBER_VISIBLE' | 'STRICT_SLOT_SHIFT_WRONG' | 'LOOSE_SLOT_SHIFT_WRONG'
  if (input.mode === 'strict') {
    if (slots.physicalH1Slot !== null) decision = 'STRICT_SLOT_SHIFT_WRONG'
    else if (visibleH1NumberCount > 0) decision = 'STRICT_H1_NUMBER_VISIBLE'
    else decision = 'PASS'
  } else {
    if (slots.physicalH1Slot !== 1) decision = 'LOOSE_SLOT_SHIFT_WRONG'
    else decision = 'PASS'
  }

  const signature = `${input.documentKey ?? ''}|${input.mode}|${Object.values(slots).join(',')}|${visibleH1NumberCount}|${h1Count}|${decision}`
  emitRuntimeAuditStateDedup('HEADING-NUMBERING-MAPPING-INVARIANT', signature, {
    documentKey: input.documentKey,
    mode: input.mode,
    ...slots,
    visibleH1NumberCount,
    h1Count,
    decision,
  })
}

// ── Mode transition cleanup (§33) ───────────────────
const lastMappingByDocument = new Map<string, { mode: HeadingStructureMode; visibleH1NumberCount: number }>()

/**
 * §33 — HEADING-MODE-TRANSITION-CLEANUP. Tracks the previous projected mode per
 * document; when a strict↔loose transition occurs, reports the stale count that
 * must have been removed and the mapping after the refresh. State-deduped.
 */
export function emitHeadingModeTransitionCleanup(
  documentKey: string | null,
  currentMode: HeadingStructureMode,
  headingElements: MappingInvariantInput['headingElements'],
): void {
  const key = documentKey ?? ''
  const prev = lastMappingByDocument.get(key)
  const visibleH1NumberCount = headingElements.filter(e => e.level === 1 && (e.numberAttr ?? '').trim() !== '').length

  if (!prev) {
    lastMappingByDocument.set(key, { mode: currentMode, visibleH1NumberCount })
    return
  }
  if (prev.mode === currentMode) {
    lastMappingByDocument.set(key, { mode: currentMode, visibleH1NumberCount })
    return
  }

  const signature = `${key}|${prev.mode}|${currentMode}|${prev.visibleH1NumberCount}|${visibleH1NumberCount}`
  emitRuntimeAuditStateDedup('HEADING-MODE-TRANSITION-CLEANUP', signature, {
    documentKey: documentKey ?? null,
    fromMode: prev.mode,
    toMode: currentMode,
    headingCount: headingElements.length,
    removedStaleNumberCount: currentMode === 'strict' ? prev.visibleH1NumberCount : 0,
    recomputedLabelCount: headingElements.length,
    visibleH1NumberCountAfter: visibleH1NumberCount,
    mappingAfter: computePhysicalSlotMapping(currentMode),
    decision: currentMode === 'strict' && visibleH1NumberCount === 0 ? 'CLEAN' : (currentMode === 'strict' ? 'STALE_H1_REMAINS' : 'LOOSE_PROJECTED'),
  })
  lastMappingByDocument.set(key, { mode: currentMode, visibleH1NumberCount })
}

/** Collect physical heading level + number-attribute facts from the editor root. */
export function collectHeadingProjectionFacts(
  root: HTMLElement | null,
): Array<{ level: HeadingLevel; numberAttr: string | null }> {
  if (!root) return []
  const out: Array<{ level: HeadingLevel; numberAttr: string | null }> = []
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
    const level = Number.parseInt(el.tagName.charAt(1), 10) as HeadingLevel
    if (level < 1 || level > 6) continue
    out.push({ level, numberAttr: el.getAttribute('data-inkchapter-heading-number') })
  }
  return out
}

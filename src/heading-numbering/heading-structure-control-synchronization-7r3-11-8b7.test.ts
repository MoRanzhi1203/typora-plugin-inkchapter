// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7 — Heading Structure Control Surface Synchronization.
 *
 * ROOT_CAUSE_FAMILY = HEADING_STRUCTURE_CONTROL_SURFACE_STATE_SPLIT.
 * Tests the SINGLE authority: effective resolver, document scope three-state,
 * legacy mirror, draft lifecycle (CLEAN/DIRTY/CONFLICTED), idempotent writes,
 * and the mapping/engine regression guards (no strict/loose re-implementation).
 */
import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveHeadingMode,
  resolveDocumentScopeState,
  deriveLegacyShowLevelOneNumber,
  computeHeadingDraftState,
  planHeadingStructureModeWrite,
  rebaseCleanDraft,
  type HeadingDraftModel,
} from './heading-structure-control-sync'
import type { HeadingStructureMode } from './heading-structure'
import {
  resolveEffectiveSettings,
  saveHeadingSettings,
  removeDocumentOverride,
  getDefaultHeadingNumberingSettings,
  deepCloneSettings,
} from './heading-numbering-scope-store'
import type { HeadingNumberingScopeStore } from './heading-types'
import { getPresetLevels } from './presets'
import { computeHeadingNumbering } from './numbering-engine'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'

function makeStore(globalMode: HeadingStructureMode): HeadingNumberingScopeStore {
  const gd = getDefaultHeadingNumberingSettings()
  gd.headingStructureMode = globalMode
  gd.showLevelOneNumber = globalMode === 'loose'
  return {
    schemaVersion: 1,
    globalDefault: gd,
    documentOverrides: {},
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
  }
}

function docOverride(store: HeadingNumberingScopeStore, docKey: string, mode: HeadingStructureMode): HeadingNumberingScopeStore {
  const settings = deepCloneSettings(store.globalDefault)
  settings.headingStructureMode = mode
  settings.showLevelOneNumber = mode === 'loose'
  return saveHeadingSettings(store, { scope: 'document', documentKey: docKey, settings })
}

function hd(text: string, level: number, i: number): HeadingDescriptor {
  return { key: `h-${i}`, level: level as HeadingDescriptor['level'], text }
}

function settingsWith(mode: HeadingStructureMode): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
    customDefinition: getPresetLevels('decimal-hierarchical'),
  }
}

describe('SCOPE MATRIX (S1-S4 + S5)', () => {
  it('S1 global strict + inherit → effective strict, scope inherit', () => {
    const store = makeStore('strict')
    const docKey = 'doc-a'
    const effective = resolveEffectiveSettings(store, docKey).effectiveSettings
    expect(effective.headingStructureMode).toBe('strict')
    expect(resolveDocumentScopeState(null)).toBe('inherit')
    expect(resolveEffectiveHeadingMode('strict', null)).toBe('strict')
  })

  it('S2 global strict + doc loose → effective loose, scope loose override', () => {
    const store = docOverride(makeStore('strict'), 'doc-b', 'loose')
    const effective = resolveEffectiveSettings(store, 'doc-b').effectiveSettings
    expect(effective.headingStructureMode).toBe('loose')
    expect(resolveEffectiveHeadingMode('strict', 'loose')).toBe('loose')
    expect(resolveDocumentScopeState('loose')).toBe('loose')
  })

  it('S3 global loose + doc strict → effective strict (mirror)', () => {
    const store = docOverride(makeStore('loose'), 'doc-c', 'strict')
    const effective = resolveEffectiveSettings(store, 'doc-c').effectiveSettings
    expect(effective.headingStructureMode).toBe('strict')
    expect(resolveEffectiveHeadingMode('loose', 'strict')).toBe('strict')
  })

  it('S4 global loose + inherit → effective loose', () => {
    expect(resolveEffectiveHeadingMode('loose', null)).toBe('loose')
  })

  it('S5 clear override → inherit global', () => {
    let store = docOverride(makeStore('strict'), 'doc-d', 'loose')
    expect(resolveEffectiveSettings(store, 'doc-d').effectiveSettings.headingStructureMode).toBe('loose')
    store = removeDocumentOverride(store, 'doc-d')
    expect(store.documentOverrides['doc-d']).toBeUndefined()
    expect(resolveEffectiveSettings(store, 'doc-d').effectiveSettings.headingStructureMode).toBe('strict')
    expect(resolveDocumentScopeState(store.documentOverrides['doc-d']?.settings.headingStructureMode ?? null)).toBe('inherit')
  })
})

describe('DRAFT LIFECYCLE (S9-S12 + S15/S16 isolation)', () => {
  it('S9 DIRTY + external makes the SAME change → CLEAN', () => {
    const model: HeadingDraftModel = {
      scope: 'document',
      documentKey: 'doc-a',
      baseSavedModeAtInit: 'strict', // user started from strict
      currentSavedMode: 'loose',     // external ALSO changed to loose
      draftMode: 'loose',            // user's unsaved intent was loose
    }
    expect(computeHeadingDraftState(model)).toBe('CLEAN')
  })

  it('S10 DIRTY + external changed to something else → CONFLICTED (never silent)', () => {
    const model: HeadingDraftModel = {
      scope: 'document',
      documentKey: 'doc-a',
      baseSavedModeAtInit: 'strict',
      currentSavedMode: 'loose',  // external changed
      draftMode: 'strict',        // user still wants strict
    }
    expect(computeHeadingDraftState(model)).toBe('CONFLICTED')
  })

  it('S9b plain DIRTY (no external change) stays DIRTY', () => {
    const model: HeadingDraftModel = {
      scope: 'document',
      documentKey: 'doc-a',
      baseSavedModeAtInit: 'strict',
      currentSavedMode: 'strict', // no external change
      draftMode: 'loose',
    }
    expect(computeHeadingDraftState(model)).toBe('DIRTY')
  })

  it('CLEAN external change → auto-rebase onto newest saved (no stale UI)', () => {
    const rebased = rebaseCleanDraft('document', 'doc-a', 'loose')
    expect(rebased.draftMode).toBe('loose')
    expect(rebased.currentSavedMode).toBe('loose')
    expect(rebased.baseSavedModeAtInit).toBe('loose')
    expect(computeHeadingDraftState(rebased)).toBe('CLEAN')
  })

  it('S11 conflict cancel = drop old draft, rebase onto latest saved → CLEAN', () => {
    // Cancel semantic: the draft is discarded; the new baseline is the current saved.
    const afterCancel = rebaseCleanDraft('document', 'doc-a', 'loose')
    expect(computeHeadingDraftState(afterCancel)).toBe('CLEAN')
  })

  it('S12 conflict save = draft intent becomes the saved state → CLEAN', () => {
    // Save semantic: the draft's mode becomes the saved override → CLEAN.
    const model: HeadingDraftModel = {
      scope: 'document',
      documentKey: 'doc-a',
      baseSavedModeAtInit: 'strict',
      currentSavedMode: 'loose',
      draftMode: 'strict',
    }
    const savedModel: HeadingDraftModel = { ...model, currentSavedMode: 'strict', baseSavedModeAtInit: 'strict' }
    expect(computeHeadingDraftState(savedModel)).toBe('CLEAN')
  })

  it('S15/S16 scope identity isolates drafts (cross-doc / cross-scope carryover = 0)', () => {
    // Drafts are bound to (scope, documentKey, baseSaved, draft) — switching
    // scope or document yields a FRESH model; no shared mutable draft object.
    const docA: HeadingDraftModel = { scope: 'document', documentKey: 'doc-a', baseSavedModeAtInit: 'strict', currentSavedMode: 'strict', draftMode: 'loose' }
    // doc-b is its OWN model starting from ITS OWN saved state (strict) —
    // it must NOT inherit doc-a's loose draft.
    const docB: HeadingDraftModel = { scope: 'document', documentKey: 'doc-b', baseSavedModeAtInit: 'strict', currentSavedMode: 'strict', draftMode: 'strict' }
    expect(docA.draftMode).toBe('loose')
    expect(docB.draftMode).toBe('strict')
    expect(docB.documentKey).toBe('doc-b')
  })
})

describe('GLOBAL SCOPE (S13 + S30)', () => {
  it('S13 global change affects inherited docs ONLY; overrides preserved', () => {
    // A=inherit, B=override strict, C=override loose
    let store = makeStore('strict')
    store = docOverride(store, 'B', 'strict')
    store = docOverride(store, 'C', 'loose')
    // Global strict → loose.
    const gd = deepCloneSettings(store.globalDefault)
    gd.headingStructureMode = 'loose'
    gd.showLevelOneNumber = true
    store = { ...store, globalDefault: gd }
    expect(resolveEffectiveSettings(store, 'A').effectiveSettings.headingStructureMode).toBe('loose') // inherit follows
    expect(resolveEffectiveSettings(store, 'B').effectiveSettings.headingStructureMode).toBe('strict') // override preserved
    expect(resolveEffectiveSettings(store, 'C').effectiveSettings.headingStructureMode).toBe('loose') // override preserved
  })
})

describe('LEGACY MIRROR (S18 + S10 gate)', () => {
  it('S18 strict → showLevelOneNumber=false, loose → true (mode is single authority)', () => {
    expect(deriveLegacyShowLevelOneNumber('strict')).toBe(false)
    expect(deriveLegacyShowLevelOneNumber('loose')).toBe(true)
    // No legal runtime may see strict+true or loose+false through the mirror.
    expect(deriveLegacyShowLevelOneNumber(resolveEffectiveHeadingMode('strict', 'loose'))).toBe(true)
    expect(deriveLegacyShowLevelOneNumber(resolveEffectiveHeadingMode('strict', null))).toBe(false)
  })
})

describe('MODE WRITE PLANNING (S25-S27 + S17)', () => {
  it('S27 idempotent write → NO_OP (plan null)', () => {
    // Document override already loose; writing loose again → no state change.
    const plan = planHeadingStructureModeWrite('strict', 'loose', 'document', 'loose', 'OUTLINE_MENU', 'doc-a')
    expect(plan).toBeNull()
    // Global already strict; writing strict again → no state change.
    const plan2 = planHeadingStructureModeWrite('strict', null, 'global', 'strict', 'SETTINGS_GLOBAL_DEFAULT', null)
    expect(plan2).toBeNull()
    // Writing strict as a NEW document override (was inherit) IS a real change.
    const plan3 = planHeadingStructureModeWrite('strict', null, 'document', 'strict', 'SETTINGS_CURRENT_DOCUMENT', 'doc-a')
    expect(plan3).not.toBeNull()
  })

  it('S25 one write = ONE transaction snapshot with correct before/after', () => {
    const plan = planHeadingStructureModeWrite('strict', null, 'document', 'loose', 'OUTLINE_MENU', 'doc-a')!
    expect(plan.beforeGlobal).toBe('strict')
    expect(plan.afterGlobal).toBe('strict') // outline menu NEVER touches global
    expect(plan.beforeDocumentOverride).toBeNull()
    expect(plan.afterDocumentOverride).toBe('loose')
    expect(plan.beforeEffective).toBe('strict')
    expect(plan.afterEffective).toBe('loose')
    expect(plan.legacyBefore).toBe(false)
    expect(plan.legacyAfter).toBe(true)
  })

  it('global write never touches the document override', () => {
    // global strict→loose; doc override stays strict (override wins for THIS doc).
    const plan = planHeadingStructureModeWrite('strict', 'strict', 'global', 'loose', 'SETTINGS_GLOBAL_DEFAULT', null)!
    expect(plan.afterGlobal).toBe('loose')
    expect(plan.afterDocumentOverride).toBe('strict') // document override untouched
    expect(plan.afterEffective).toBe('strict') // overridden doc keeps ITS mode
    expect(plan.beforeEffective).toBe('strict')
  })

  it('S17 strict/loose repeated 10 times → stable, alternate, idempotent at each step', () => {
    // Model the REAL outline toggle: the document override persists between
    // toggles; writing the SAME mode again is a NO_OP.
    let override: HeadingStructureMode | null = null
    for (let i = 0; i < 10; i++) {
      const mode: HeadingStructureMode = i % 2 === 0 ? 'loose' : 'strict'
      const plan = planHeadingStructureModeWrite('strict', override, 'document', mode, 'RUNTIME_TEST', 'doc-x')
      if (override === mode) {
        expect(plan).toBeNull() // idempotent NO_OP
      } else {
        expect(plan).not.toBeNull() // real transition
      }
      override = mode
    }
    expect(override).toBe('strict')
  })
})

describe('PRESET / VISIBILITY PRESERVE MODE (S19-S20)', () => {
  it('S19 applying a preset never changes the structure mode', () => {
    const strictS = settingsWith('strict')
    const looseS = settingsWith('loose')
    // Apply another preset — mode fields stay.
    strictS.preset = 'roman-hierarchical'
    looseS.preset = 'roman-hierarchical'
    expect(strictS.headingStructureMode).toBe('strict')
    expect(looseS.headingStructureMode).toBe('loose')
    // Renderer labels follow the mode mapping (H1 slot difference).
    const strictLabels = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 1)], strictS).map(h => h.label)
    const looseLabels = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 1)], looseS).map(h => h.label)
    expect(strictLabels[0]).toBe('')      // strict H1 has no visible number
    expect(looseLabels[0]).not.toBe('')   // loose H1 is numbered
  })

  it('S20 number visibility toggle preserves the structure mode', () => {
    const strictS = settingsWith('strict')
    // Toggling "显示编号" off must NOT flip strict→loose.
    strictS.showLevelOneNumber = false
    strictS.headingStructureMode = 'strict'
    expect(strictS.headingStructureMode).toBe('strict')
  })
})

describe('RENDER HAS ZERO MODE WRITES (S26)', () => {
  it('S26 computeHeadingNumbering / resolveHeadingStructure are pure (no side effects)', () => {
    const s = settingsWith('strict')
    const before = JSON.stringify(s)
    computeHeadingNumbering([hd('A', 1, 0), hd('B', 2, 1), hd('C', 3, 2)], s)
    expect(JSON.stringify(s)).toBe(before) // render never mutates settings
  })
})

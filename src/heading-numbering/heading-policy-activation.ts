/**
 * Phase 7R.3.11.8B.10 — Heading Policy Activation Authority (pure resolver).
 *
 * The ONE place that answers "is the strict heading policy REALLY active for
 * this document?". It separates three states that legacy code conflated:
 *
 *   storedMode            — what the settings object holds (a default/legacy
 *                           'strict' seed here is JUST a stored value);
 *   featureEnabled        — the global heading-numbering feature master;
 *   explicit activation   — the user actually CHOSE a policy (global write
 *                           authority bit) OR gave THIS document an explicit
 *                           override.
 *
 * Core invariant:
 *   storedMode === 'strict'   DOES NOT imply   strictPolicyActive === true.
 *
 * A document whose policy is not active resolves:
 *   effectivePolicyActive=false
 *   activationSource='none'
 *   effectiveMode=null
 *   effectiveStrictRequire=false
 */
import type { HeadingStructureMode } from './heading-structure'
import type { HeadingNumberingSettings } from './heading-types'

export type HeadingPolicyActivationSource =
  | 'none'
  | 'global-explicit'
  | 'document-explicit'
  | 'inherited'

export interface EffectiveHeadingPolicy {
  /** Stored structure mode (may be the legacy default seed — NEVER activation). */
  storedMode: HeadingStructureMode | null
  /** storedMode === 'strict' (stored requirement, still NOT activation). */
  storedStrictRequire: boolean
  /** Global heading-numbering feature master switch. */
  featureEnabled: boolean
  /** Global heading policy was EXPLICITLY chosen by the user (write authority). */
  globalScopeEnabled: boolean
  /** The CURRENT document carries an explicit override. */
  documentScopeEnabled: boolean
  /** Explicit per-document override mode (null when none). */
  documentOverride: HeadingStructureMode | null
  activationSource: HeadingPolicyActivationSource
  /** Feature on AND an explicit activation exists (global or document). */
  effectivePolicyActive: boolean
  /** null while inactive — never a legacy fallback. */
  effectiveMode: HeadingStructureMode | null
  effectiveStrictRequire: boolean
}

/** Resolve the global stored mode (explicit value or legacy default seed). */
export function resolveStoredHeadingStructureMode(s: HeadingNumberingSettings): HeadingStructureMode {
  if (s.headingStructureMode === 'strict' || s.headingStructureMode === 'loose') {
    return s.headingStructureMode
  }
  return s.showLevelOneNumber ? 'loose' : 'strict'
}

/**
 * Resolve the effective heading policy for the current document.
 *
 * `forceInactive` is a safety hatch for consumers that must never see an
 * active policy (e.g. before the settings authority is ready).
 */
export function resolveHeadingPolicyActivation(
  globalDefault: HeadingNumberingSettings,
  documentOverride: HeadingStructureMode | null,
  opts: { forceInactive?: boolean } = {},
): EffectiveHeadingPolicy {
  const storedMode = resolveStoredHeadingStructureMode(globalDefault)
  const storedStrictRequire = storedMode === 'strict'
  const featureEnabled = globalDefault.enabled === true && opts.forceInactive !== true
  // Explicit activation only — the config bit is written by the single write
  // authority when the user picks a structure mode; a document override is an
  // explicit document-scope choice. Object existence / stored mode presence
  // NEVER counts as activation (default seeds would always pass).
  const globalScopeEnabled = globalDefault.headingStructureConfigured === true
  const documentScopeEnabled = documentOverride != null
  const explicit = globalScopeEnabled || documentScopeEnabled
  const effectivePolicyActive = featureEnabled && explicit

  let activationSource: HeadingPolicyActivationSource = 'none'
  let effectiveMode: HeadingStructureMode | null = null
  if (effectivePolicyActive) {
    if (documentScopeEnabled) {
      activationSource = 'document-explicit'
      effectiveMode = documentOverride ?? storedMode
    } else {
      activationSource = 'global-explicit'
      effectiveMode = storedMode
    }
  }

  return {
    storedMode,
    storedStrictRequire,
    featureEnabled,
    globalScopeEnabled,
    documentScopeEnabled,
    documentOverride,
    activationSource,
    effectivePolicyActive,
    effectiveMode,
    effectiveStrictRequire: effectivePolicyActive && effectiveMode === 'strict',
  }
}

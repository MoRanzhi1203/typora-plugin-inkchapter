/**
 * B3 §B3-01 — diagnostic PROFILE model (pure).
 *
 * A profile is a NAMED, INHERITING configuration layer on top of the rule
 * registry. It NEVER mutates the registry, never changes a rule's severity and
 * never invents a rule id. Unknown ids are reported as validation issues and
 * ignored, so a corrupt/older profile file cannot crash diagnostics.
 */
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY } from './document-diagnostic-location'

export type DiagnosticProfileId = 'general' | 'academic' | 'lab-report' | 'custom'

export interface DiagnosticProfileSettings {
  /** Parent profile; `null` = no inheritance. */
  inherits: DiagnosticProfileId | null
  /** Rule families explicitly enabled on top of the parent/default. */
  enabledRuleFamilies?: readonly string[]
  /** Rule families explicitly disabled on top of the parent/default. */
  disabledRuleFamilies?: readonly string[]
  /** Formula source-length limits, when the profile turns those rules on. */
  formulaSourceRules?: {
    lengthLimit?: number
    lineLimit?: number
  }
  /** Optional content width (CSS px) for the academic width model (B3-03). */
  contentWidthPx?: number
}

export interface ResolvedDiagnosticProfile {
  id: DiagnosticProfileId
  /** Profile chain root → leaf (cycle-free). */
  chain: readonly DiagnosticProfileId[]
  enabledRuleFamilies: readonly string[]
  disabledRuleFamilies: readonly string[]
  formulaSourceRules?: {
    lengthLimit?: number
    lineLimit?: number
  }
  contentWidthPx?: number
  issues: readonly string[]
}

export const DIAGNOSTIC_PROFILE_IDS: readonly DiagnosticProfileId[] = Object.freeze([
  'general',
  'academic',
  'lab-report',
  'custom',
])

/** Built-in profiles. `custom` is intentionally empty and inherits general. */
export const DIAGNOSTIC_PROFILE_DEFAULTS: Readonly<Record<DiagnosticProfileId, DiagnosticProfileSettings>> = Object.freeze({
  general: { inherits: null },
  academic: {
    inherits: 'general',
    // Academic writing opts into the opt-in formula source rules by supplying
    // explicit limits; the rules themselves stay registry-level opt-in.
    formulaSourceRules: { lengthLimit: 300, lineLimit: 120 },
    contentWidthPx: 820,
  },
  'lab-report': {
    inherits: 'academic',
    formulaSourceRules: { lengthLimit: 260, lineLimit: 120 },
    contentWidthPx: 900,
  },
  custom: { inherits: 'general' },
})

function isKnownRuleFamily(id: string): boolean {
  return Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY).some(meta => meta.familyId === id)
}

/**
 * Resolve a profile with inheritance. Deterministic; a cycle reports one issue
 * and stops at the repeated node (never infinite recursion).
 */
export function resolveDiagnosticProfile(
  id: DiagnosticProfileId,
  custom?: DiagnosticProfileSettings,
  defaults: Readonly<Record<DiagnosticProfileId, DiagnosticProfileSettings>> = DIAGNOSTIC_PROFILE_DEFAULTS,
): ResolvedDiagnosticProfile {
  const chain: DiagnosticProfileId[] = []
  const issues: string[] = []
  const enabled = new Set<string>()
  const disabled = new Set<string>()
  let formulaSourceRules: { lengthLimit?: number; lineLimit?: number } | undefined
  let contentWidthPx: number | undefined

  const settingsOf = (profileId: DiagnosticProfileId): DiagnosticProfileSettings | null => {
    if (profileId === 'custom' && custom != null) return custom
    return defaults[profileId] ?? null
  }

  const visit = (profileId: DiagnosticProfileId): void => {
    if (chain.includes(profileId)) {
      issues.push(`profile-cycle:${profileId}`)
      return
    }
    chain.push(profileId)
    const settings = settingsOf(profileId)
    if (settings == null) {
      issues.push(`profile-missing:${profileId}`)
      return
    }
    if (settings.inherits != null) visit(settings.inherits)
    for (const family of settings.enabledRuleFamilies ?? []) {
      if (!isKnownRuleFamily(family)) { issues.push(`unknown-rule:${family}`); continue }
      enabled.add(family)
      disabled.delete(family)
    }
    for (const family of settings.disabledRuleFamilies ?? []) {
      if (!isKnownRuleFamily(family)) { issues.push(`unknown-rule:${family}`); continue }
      disabled.add(family)
      enabled.delete(family)
    }
    if (settings.formulaSourceRules != null) {
      formulaSourceRules = {
        lengthLimit: settings.formulaSourceRules.lengthLimit ?? formulaSourceRules?.lengthLimit,
        lineLimit: settings.formulaSourceRules.lineLimit ?? formulaSourceRules?.lineLimit,
      }
    }
    if (settings.contentWidthPx != null) contentWidthPx = settings.contentWidthPx
  }

  visit(id)
  return {
    id,
    chain: [...chain].reverse(),
    enabledRuleFamilies: [...enabled].sort(),
    disabledRuleFamilies: [...disabled].sort(),
    formulaSourceRules,
    contentWidthPx,
    issues,
  }
}

/**
 * Whether a family participates for this profile. Explicit profile enable /
 * disable wins; otherwise the registry's `defaultEnabled` is the baseline.
 */
export function isDiagnosticFamilyEnabledForProfile(
  profile: ResolvedDiagnosticProfile,
  familyId: string,
): boolean {
  if (profile.disabledRuleFamilies.includes(familyId)) return false
  if (profile.enabledRuleFamilies.includes(familyId)) return true
  const meta = Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY).find(m => m.familyId === familyId)
  return meta?.defaultEnabled ?? false
}

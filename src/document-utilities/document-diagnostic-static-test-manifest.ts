/**
 * Capability Matrix V2 §6 — the AUTOMATIC Static Test Manifest.
 *
 * This module is a PURE, deterministic derivation (no filesystem access): it
 * takes the already-read `*.test.ts` sources and reports, per IMPLEMENTED
 * family, whether the family's runtime codes (or its PREFIX, for a PREFIX
 * policy) are referenced by a test file. There is NO hand-maintained list — the
 * targeted/integration test flags the Runtime Closure Authority consumes are
 * re-derived from the repo on every generation.
 *
 * The generator (`scripts/document-diagnostics/generate-capability-matrix.mjs`)
 * and the vitest suite both read the files with `node:fs` and hand them here, so
 * one authority (this function) feeds both.
 */
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  type DocumentDiagnosticRuleMeta,
} from './document-diagnostic-location'

/** One already-read `*.test.ts` source (repo-relative POSIX path). */
export interface DocumentDiagnosticStaticTestSource {
  path: string
  content: string
}

export interface DocumentDiagnosticStaticTestManifest {
  /** Families with at least one referencing test file. */
  targetedTestFamilyIds: ReadonlySet<string>
  /** Families referenced by a test file whose name marks it an integration test. */
  integrationTestFamilyIds: ReadonlySet<string>
  /** familyId → sorted list of matched test file paths (deterministic). */
  matchedFilesByFamily: ReadonlyMap<string, readonly string[]>
}

/**
 * §6 — the searchable TOKENS of a family: its resolved runtime codes for an
 * EXACT / PATTERN policy, or its raw prefix for a PREFIX policy. A PREFIX family
 * therefore matches every `LEVEL_n` reference without a second code list.
 */
export function searchTokensOf(meta: DocumentDiagnosticRuleMeta): string[] {
  const policy = meta.runtimeCodePolicy
  if (policy.kind === 'EXACT') return [policy.code]
  if (policy.kind === 'PATTERN') return [...policy.codes]
  return [policy.prefix]
}

/** A test file name marking an integration (cross-authority) test. */
function isIntegrationTestPath(path: string): boolean {
  return path.toLowerCase().includes('integration')
}

/**
 * §6 — build the Static Test Manifest. `files` must be the `*.test.ts` sources;
 * the result is deterministic (sorted by path, then familyId).
 */
export function buildDocumentDiagnosticStaticTestManifest(
  files: readonly DocumentDiagnosticStaticTestSource[],
): DocumentDiagnosticStaticTestManifest {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const targeted = new Set<string>()
  const integration = new Set<string>()
  const matched = new Map<string, string[]>()
  for (const meta of Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)) {
    if (meta.implementationStatus !== 'IMPLEMENTED') continue
    const tokens = searchTokensOf(meta)
    const hits: string[] = []
    let isIntegration = false
    for (const file of sorted) {
      if (!tokens.some(token => file.content.includes(token))) continue
      hits.push(file.path)
      if (isIntegrationTestPath(file.path)) isIntegration = true
    }
    if (hits.length === 0) continue
    targeted.add(meta.familyId)
    matched.set(meta.familyId, hits.sort())
    if (isIntegration) integration.add(meta.familyId)
  }
  return {
    targetedTestFamilyIds: targeted,
    integrationTestFamilyIds: integration,
    matchedFilesByFamily: matched,
  }
}

/** §6 — an EMPTY manifest (never a fabricated PASS). */
export const EMPTY_DOCUMENT_DIAGNOSTIC_STATIC_TEST_MANIFEST: DocumentDiagnosticStaticTestManifest = {
  targetedTestFamilyIds: new Set<string>(),
  integrationTestFamilyIds: new Set<string>(),
  matchedFilesByFamily: new Map<string, readonly string[]>(),
}

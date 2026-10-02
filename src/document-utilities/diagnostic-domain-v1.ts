/**
 * TRAE — Unified Diagnostics Domain Architecture V1 (§3/§9/§10/§11/§12/§13).
 *
 * ONE diagnostics infrastructure, TWO responsibility domains:
 *
 *   domain=document → 用户通过修改 Markdown / 文档内容可以解决的问题
 *   domain=runtime  → 需要修改 InkChapter 代码、运行状态或部署环境才能解决的问题
 *
 * This module is the SINGLE authority for:
 *   - the `DiagnosticDomain` type (the only domain enum in the codebase)
 *   - `selectDocumentDiagnostics()` / `selectRuntimeDiagnostics()` (§9: no UI or
 *     service may hand-write its own black/white list)
 *   - the runtime-integrity adapter + registry + report (§6/§12/§13/§14)
 *
 * Runtime integrity NEVER reaches the user-facing Document Drawer, the document
 * severity counts, the body locator, the active fill or a reason chip
 * (§2/§8/§19/§20). It is consumed only by developer logs and the runtime report.
 */
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type DiagnosticDomain = 'document' | 'runtime'

/**
 * Runtime integrity outcomes. Deliberately a SEPARATE axis from the document
 * severities (`error | warning | info`): a runtime FAIL must never be mapped
 * onto a user-facing severity (§8).
 */
export type RuntimeDiagnosticStatus = 'FAIL' | 'DEGRADED' | 'PENDING'

/** §11 — any item that enters the unified aggregation must declare its domain. */
export interface DiagnosticDomainCarrier {
  domain: DiagnosticDomain
}

/** §3 — minimal envelope; the payload shapes stay independent. */
export interface DiagnosticEnvelope<T = unknown> {
  domain: DiagnosticDomain
  payload: T
}

export interface RuntimeDiagnostic {
  domain: 'runtime'
  /** Stable machine code, e.g. `RUNTIME_IDENTITY_SHA_MISMATCH`. */
  code: string
  status: RuntimeDiagnosticStatus
  message: string
  detail?: string
  /** Which runtime authority produced the finding (developer-facing). */
  source: string
  observedAt: number
  facts?: Record<string, unknown>
}

/** Input shape for the runtime-integrity adapter. */
export interface RuntimeIntegrityFinding {
  code: string
  status: RuntimeDiagnosticStatus
  message: string
  detail?: string
  source?: string
  observedAt?: number
  facts?: Record<string, unknown>
}

export interface RuntimeIntegrityReport {
  decision: 'PASS' | 'FAIL'
  total: number
  failCount: number
  degradedCount: number
  pendingCount: number
  diagnostics: readonly RuntimeDiagnostic[]
}

export const RUNTIME_INTEGRITY_SOURCE = 'inkchapter-runtime-integrity'

// ── §9 — the ONE domain selector authority ─────────────────────────────────

/**
 * §9/§11 — the SINGLE domain predicate. A missing `domain` can only occur on a
 * `DocumentDiagnostic` produced before this round, so it resolves to the
 * document domain; a runtime item must carry `domain: 'runtime'` by type.
 */
export function isRuntimeDomain(item: { domain?: DiagnosticDomain } | null | undefined): boolean {
  return item != null && item.domain === 'runtime'
}

/** §9/§10 — Document Drawer / document consumers read ONLY this. */
export function selectDocumentDiagnostics<T extends { domain?: DiagnosticDomain }>(
  all: readonly T[],
): T[] {
  return all.filter(item => !isRuntimeDomain(item))
}

/** §9/§10 — Runtime Gate / report / developer console read ONLY this. */
export function selectRuntimeDiagnostics<T extends { domain?: DiagnosticDomain }>(
  all: readonly T[],
): T[] {
  return all.filter(isRuntimeDomain)
}

// ── §8 — document severity counts are document-only by construction ────────

export interface DocumentSeverityCounts {
  total: number
  error: number
  warning: number
  info: number
}

/**
 * §8 — the ONLY severity counter. It takes the already-selected DOCUMENT set,
 * so a runtime item can never be counted (the selector removes it upstream).
 */
export function countDocumentSeverities(
  diagnostics: readonly { severity: 'error' | 'warning' | 'info' }[],
): DocumentSeverityCounts {
  let error = 0
  let warning = 0
  let info = 0
  for (const d of diagnostics) {
    if (d.severity === 'error') error++
    else if (d.severity === 'warning') warning++
    else info++
  }
  return { total: diagnostics.length, error, warning, info }
}

// ── §17/§18 — the pure refresh-isolation contract ─────────────────────────

/**
 * The two domain stores of the unified infrastructure. They are INDEPENDENT:
 * neither refresh may clear, overwrite or recompute the other domain.
 */
export interface DiagnosticsDomainStores<D = unknown> {
  document: readonly D[]
  runtime: readonly RuntimeDiagnostic[]
}

/**
 * §17 — "重新检查文档" recomputes ONLY the document store; the runtime
 * collection is carried over UNCHANGED (never cleared, never recomputed).
 */
export function recheckDocumentDomain<D>(
  stores: DiagnosticsDomainStores<D>,
  nextDocumentDiagnostics: readonly D[],
): DiagnosticsDomainStores<D> {
  return { document: nextDocumentDiagnostics, runtime: stores.runtime }
}

/**
 * §18 — a runtime refresh recomputes ONLY the runtime store; the document
 * collection is carried over UNCHANGED (never cleared, never recomputed).
 */
export function refreshRuntimeDomain<D>(
  stores: DiagnosticsDomainStores<D>,
  findings: readonly RuntimeIntegrityFinding[],
  now: number = Date.now(),
): DiagnosticsDomainStores<D> {
  refreshRuntimeIntegrity(findings, now)
  return { document: stores.document, runtime: getRuntimeDiagnostics() }
}

// ── §6 — the runtime-integrity adapter ────────────────────────────────────

export function toRuntimeDiagnostic(
  finding: RuntimeIntegrityFinding,
  now: number = Date.now(),
): RuntimeDiagnostic {
  return {
    domain: 'runtime',
    code: finding.code,
    status: finding.status,
    message: finding.message,
    detail: finding.detail,
    source: finding.source ?? RUNTIME_INTEGRITY_SOURCE,
    observedAt: finding.observedAt ?? now,
    facts: finding.facts,
  }
}

/**
 * §6/§37 — adapt the EXISTING plugin runtime-identity result (the same facts
 * `RUNTIME-IDENTITY-FINAL` already reports) into runtime findings. A deployed
 * artifact that does not match the project build, or a missing plugin main, is
 * a runtime integrity failure — never a user document error.
 */
export function runtimeIntegrityFindingsFromIdentity(input: {
  pluginMainExists: boolean
  pluginMainSha256?: string | null
  projectMainExists?: boolean
  projectMainSha256?: string | null
  shaMatch?: boolean | null
  /**
   * §6 (line "deployed artifact != dist artifact") — the SHA of the ACTUAL
   * deployed artifact. The legacy `pluginMainSha256` deliberately prefers the
   * project build, so it cannot detect a stale deployment; this field carries
   * the real deployed-vs-build comparison.
   */
  deployedMainSha256?: string | null
  deployedMainExists?: boolean | null
  buildId?: string | null
  initializationCount?: number | null
}): RuntimeIntegrityFinding[] {
  const out: RuntimeIntegrityFinding[] = []
  const deployedExists = input.deployedMainExists ?? input.pluginMainExists
  const projectExists = input.projectMainExists ?? true
  const deployedSha = input.deployedMainSha256 ?? input.pluginMainSha256 ?? null
  const projectSha = input.projectMainSha256 ?? null
  const readable = (sha: string | null | undefined): sha is string =>
    typeof sha === 'string' && sha !== '' && sha.toUpperCase() !== 'UNKNOWN'

  if (!deployedExists) {
    out.push({
      code: 'RUNTIME_PLUGIN_ARTIFACT_MISSING',
      status: 'FAIL',
      message: '插件部署产物缺失',
      detail: '已部署的 main.js 不存在，插件可能未正确部署。',
      facts: { buildId: input.buildId ?? null },
    })
  }
  const deployedIsStale = deployedExists
    && projectExists
    && readable(deployedSha)
    && readable(projectSha)
    && deployedSha !== projectSha
  if (deployedIsStale || (input.shaMatch === false && !deployedIsStale)) {
    out.push({
      code: 'RUNTIME_IDENTITY_SHA_MISMATCH',
      status: 'FAIL',
      message: '部署产物与构建产物不一致',
      detail: '部署的 main.js 与 dist/main.js 的 SHA256 不一致（部署已过期）。',
      facts: {
        deployedMainSha256: deployedSha ?? null,
        projectMainSha256: projectSha ?? null,
        buildId: input.buildId ?? null,
      },
    })
  }
  return out
}

// ── §17/§18 — the runtime integrity registry (document refresh never touches it)

const runtimeRegistry = new Map<string, RuntimeDiagnostic>()
let lastReportSignature: string | null = null

/**
 * §18 — a RUNTIME refresh. Replaces ONLY the runtime collection; it can never
 * clear, overwrite or recompute the document diagnostics (those live in the
 * document authority). Emits a low-frequency audit on state change only (§21).
 */
export function refreshRuntimeIntegrity(findings: readonly RuntimeIntegrityFinding[], now = Date.now()): RuntimeIntegrityReport {
  runtimeRegistry.clear()
  for (const f of findings) {
    const diag = toRuntimeDiagnostic(f, now)
    runtimeRegistry.set(diag.code, diag)
  }
  const report = evaluateRuntimeIntegrityV1()
  const signature = `${report.decision}|${report.diagnostics.map(d => `${d.code}:${d.status}`).join(',')}`
  if (signature !== lastReportSignature) {
    lastReportSignature = signature
    emitRuntimeAudit('DIAGNOSTIC-DOMAIN-RUNTIME-REPORT', {
      decision: report.decision,
      total: report.total,
      failCount: report.failCount,
      degradedCount: report.degradedCount,
      pendingCount: report.pendingCount,
      codes: report.diagnostics.map(d => d.code),
      source: RUNTIME_INTEGRITY_SOURCE,
    })
  }
  return report
}

/** The runtime collection, passed through the ONE runtime selector (§9). */
export function getRuntimeDiagnostics(): readonly RuntimeDiagnostic[] {
  return selectRuntimeDiagnostics([...runtimeRegistry.values()])
}

/**
 * §16 — the runtime report. `decision = FAIL` whenever any runtime FAIL exists,
 * independent of the document diagnostics (a runtime failure never prevents the
 * Document Drawer's empty state).
 */
export function evaluateRuntimeIntegrityV1(): RuntimeIntegrityReport {
  const diagnostics = getRuntimeDiagnostics()
  let failCount = 0
  let degradedCount = 0
  let pendingCount = 0
  for (const d of diagnostics) {
    if (d.status === 'FAIL') failCount++
    else if (d.status === 'DEGRADED') degradedCount++
    else pendingCount++
  }
  return {
    decision: failCount > 0 ? 'FAIL' : 'PASS',
    total: diagnostics.length,
    failCount,
    degradedCount,
    pendingCount,
    diagnostics,
  }
}

/**
 * Explicit, developer-only teardown. NEVER called by a document refresh (§17);
 * exported so a full host dispose can reset the runtime domain deliberately.
 */
export function clearRuntimeIntegrityFindings(): void {
  runtimeRegistry.clear()
  lastReportSignature = null
}

/** Test-only reset preserving the explicit-teardown contract. */
export function __resetRuntimeIntegrityForTests(): void {
  clearRuntimeIntegrityFindings()
}

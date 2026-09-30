// @vitest-environment jsdom
/**
 * V1-FIXTURE — Figure Diagnostic Fixture Resource Closure (targeted suite).
 *
 * THE DEFECT: the V1 runtime fixture referenced `a.png` / `b.png` / `same.png`,
 * none of which exist — so every "rendered image" Case had degraded into a
 * broken-image / source-block-fallback case.
 *
 * Covered here:
 *   FIXTURE-SOURCE-*   the fixture + dedicated assets on disk (§43/§44)
 *   FIXTURE-PREFLIGHT-* the preflight decision (§18/§23)
 *   FIXTURE-RENDERED-* the rendered-occurrence decision (§38)
 *   FIXTURE-HOST-*     the REAL host runtime matrix (§28/§30/§33/§34/§35)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH,
  FIGURE_LOCATOR_V1_ASSET_DIR,
  FIGURE_LOCATOR_V1_VISIBLE_ASSETS,
  EXPECTED_MISSING_FIGURE_RESOURCES,
  createFixtureResourceV1Counters,
  createFixtureResourceV1CoverageCounters,
  evaluateFixtureResourcePreflight,
  evaluateFixtureResourceV1Coverage,
  evaluateFixtureResourceV1Gates,
  evaluateRenderedOccurrenceLocate,
  expectedStateForFixtureDestination,
  extractFixtureImageReferences,
  formatFixtureResourceV1CoverageReport,
  formatFixtureResourceV1GateReport,
  isLegacyNonexistentFixturePath,
  observationProvesRenderedImage,
  type FixtureImageReference,
  type FixtureResourceObservation,
} from './document-diagnostic-fixture-resource-preflight-v1'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences, parseLocalLinkTargets } from './document-resource-scanner'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const VAULT_ROOT = resolve(process.cwd(), 'test/vault')
const FIXTURE_ABS = join(VAULT_ROOT, FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH)
const ASSET_DIR_ABS = join(VAULT_ROOT, FIGURE_LOCATOR_V1_ASSET_DIR)
const FIXTURE_MARKDOWN = readFileSync(FIXTURE_ABS, 'utf8')
const FIXTURE_REFERENCES = extractFixtureImageReferences(FIXTURE_MARKDOWN)
const FIXTURE_DIR_RELATIVE = FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH.replace(/[^/]*$/, '')

function absOf(relativeDestination: string): string {
  return join(VAULT_ROOT, FIXTURE_DIR_RELATIVE, relativeDestination)
}
function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file).toString('base64')).digest('hex')
}

// ── §43/§44 — the fixture + asset source contract ──────────────────────────

describe('FIXTURE-SOURCE — the fixture references only real, self-contained assets', () => {
  it('the dedicated V1 asset directory exists with the 3 non-empty PNGs', () => {
    expect(existsSync(ASSET_DIR_ABS)).toBe(true)
    for (const name of FIGURE_LOCATOR_V1_VISIBLE_ASSETS) {
      const file = join(ASSET_DIR_ABS, name)
      expect(existsSync(file)).toBe(true)
      expect(statSync(file).size).toBeGreaterThan(0)
      // real PNG signature
      expect(readFileSync(file).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
  })

  it('the copies are byte-stable against the verified Phase7 source assets', () => {
    const sourceA = join(VAULT_ROOT, 'runtime/smoke/assets/phase7-strict-h1-boundary/boundary-a-figure.png')
    const sourceB = join(VAULT_ROOT, 'runtime/smoke/assets/phase7-strict-h1-boundary/boundary-b-figure.png')
    expect(existsSync(sourceA)).toBe(true)
    expect(existsSync(sourceB)).toBe(true)
    expect(sha256(join(ASSET_DIR_ABS, 'a-visible.png'))).toBe(sha256(sourceA))
    expect(sha256(join(ASSET_DIR_ABS, 'repeated-visible.png'))).toBe(sha256(sourceA))
    expect(sha256(join(ASSET_DIR_ABS, 'b-visible.png'))).toBe(sha256(sourceB))
  })

  it('every EXPECTED_VISIBLE reference exists on disk, and the allowlist matches', () => {
    expect(FIXTURE_REFERENCES.length).toBeGreaterThanOrEqual(10)
    const visible = FIXTURE_REFERENCES.filter(r => r.expectedState === 'VISIBLE')
    const missing = FIXTURE_REFERENCES.filter(r => r.expectedState === 'MISSING')
    expect(visible.length).toBeGreaterThanOrEqual(9)
    expect(missing).toHaveLength(1)
    expect(missing[0].relativeDestination).toBe('missing-local-image.png')
    expect(EXPECTED_MISSING_FIGURE_RESOURCES.has('missing-local-image.png')).toBe(true)
    for (const ref of visible) {
      expect(existsSync(absOf(ref.relativeDestination))).toBe(true)
      expect(statSync(absOf(ref.relativeDestination)).size).toBeGreaterThan(0)
    }
    // the ONE expected-missing reference must really be absent
    expect(existsSync(absOf(missing[0].relativeDestination))).toBe(false)
  })

  it('§43 — no legacy bare a.png / b.png / same.png reference remains', () => {
    const legacy = FIXTURE_REFERENCES.filter(r => isLegacyNonexistentFixturePath(r.rawDestination))
    expect(legacy).toEqual([])
    expect(FIXTURE_MARKDOWN).not.toMatch(/\]\(a\.png\)/)
    expect(FIXTURE_MARKDOWN).not.toMatch(/\]\(b\.png\)/)
    expect(FIXTURE_MARKDOWN).not.toMatch(/\]\(same\.png\)/)
  })

  it('§17 — every reference resolves to an explicit policy (no UNKNOWN)', () => {
    for (const ref of FIXTURE_REFERENCES) {
      expect(expectedStateForFixtureDestination(ref.rawDestination)).not.toBeNull()
    }
  })

  it('§11/§12 — W1 is two separate blocks with the SAME destination and EMPTY alt', () => {
    const w1 = FIXTURE_REFERENCES.filter(r => r.caseId === 'W1')
    expect(w1).toHaveLength(2)
    expect(w1[0].relativeDestination).toBe(w1[1].relativeDestination)
    expect(w1[0].relativeDestination).toBe('assets/figure-diagnostic-locator-v1/repeated-visible.png')
    expect(w1.every(r => r.altText === '')).toBe(true)
    // two separate Markdown lines (two blocks)
    const lines = FIXTURE_MARKDOWN.split('\n')
      .map((l, i) => ({ l, i }))
      .filter(x => x.l.includes('repeated-visible.png'))
    expect(lines).toHaveLength(2)
    expect(lines[1].i - lines[0].i).toBeGreaterThan(1)
  })

  it('§13/§14 — W2 is a real image with EMPTY alt; W3 is absent with NON-EMPTY alt', () => {
    const w2 = FIXTURE_REFERENCES.filter(r => r.caseId === 'W2')
    expect(w2).toHaveLength(1)
    expect(w2[0].altText).toBe('')
    expect(existsSync(absOf(w2[0].relativeDestination))).toBe(true)

    const w3 = FIXTURE_REFERENCES.filter(r => r.caseId === 'W3')
    expect(w3).toHaveLength(1)
    expect(w3[0].altText.trim()).not.toBe('')
    expect(w3[0].expectedState).toBe('MISSING')
    expect(existsSync(absOf(w3[0].relativeDestination))).toBe(false)
  })

  it('§7-§10 — S1..S4 reference only existing assets', () => {
    for (const caseId of ['S1', 'S2', 'S3', 'S4']) {
      const refs = FIXTURE_REFERENCES.filter(r => r.caseId === caseId)
      expect(refs.length).toBeGreaterThanOrEqual(1)
      expect(refs.every(r => r.expectedState === 'VISIBLE')).toBe(true)
      for (const ref of refs) expect(existsSync(absOf(ref.relativeDestination))).toBe(true)
    }
    expect(FIXTURE_REFERENCES.filter(r => r.caseId === 'S3')).toHaveLength(2)
    expect(FIXTURE_REFERENCES.filter(r => r.caseId === 'S4')).toHaveLength(2)
  })
})

// ── §18/§23 — the preflight decision ──────────────────────────────────────

function observationOf(ref: FixtureImageReference, over: Partial<FixtureResourceObservation> = {}): FixtureResourceObservation {
  const exists = ref.expectedState === 'VISIBLE'
  return {
    caseId: ref.caseId,
    rawDestination: ref.rawDestination,
    relativeDestination: ref.relativeDestination,
    expectedState: ref.expectedState,
    resolvedAbsolutePath: absOf(ref.relativeDestination),
    fsExists: exists,
    domImgPresent: exists,
    imgComplete: exists,
    naturalWidth: exists ? 24 : 0,
    naturalHeight: exists ? 24 : 0,
    resourceDiagnostic: exists ? 'NONE' : 'FIGURE_LOCAL_IMAGE_MISSING',
    ...over,
  }
}

describe('FIXTURE-PREFLIGHT — the resource preflight decision', () => {
  it('the real fixture manifest PASSes when every observation matches', () => {
    const observations = FIXTURE_REFERENCES.map(r => observationOf(r))
    const preflight = evaluateFixtureResourcePreflight({ documentKey: 'fixture', references: FIXTURE_REFERENCES, observations })
    expect(preflight.decision).toBe('PASS')
    expect(preflight.reason).toBe('FIXTURE_RESOURCES_OK')
    expect(preflight.totalImageReferenceCount).toBe(FIXTURE_REFERENCES.length)
    expect(preflight.unexpectedMissingReferences).toEqual([])
    expect(preflight.unexpectedExistingExpectedMissingReferences).toEqual([])
    expect(preflight.expectedVisibleRenderedImgCount).toBe(preflight.expectedVisibleReferenceCount)
    expect(preflight.expectedVisibleDecodedImgCount).toBe(preflight.expectedVisibleReferenceCount)
  })

  it('FAILs when a VISIBLE image is missing from the filesystem', () => {
    const observations = FIXTURE_REFERENCES.map(r => observationOf(r))
    const firstVisible = FIXTURE_REFERENCES.find(r => r.expectedState === 'VISIBLE')!
    const idx = observations.findIndex(o => o.relativeDestination === firstVisible.relativeDestination)
    observations[idx] = { ...observations[idx], fsExists: false, domImgPresent: false, imgComplete: false, naturalWidth: 0, naturalHeight: 0, resourceDiagnostic: 'FIGURE_LOCAL_IMAGE_MISSING' }
    const preflight = evaluateFixtureResourcePreflight({ references: FIXTURE_REFERENCES, observations })
    expect(preflight.decision).toBe('FAIL')
    expect(preflight.reason).toContain('UNEXPECTED_MISSING_VISIBLE_IMAGE')
  })

  it('FAILs when a VISIBLE image renders but fails to decode', () => {
    const observations = FIXTURE_REFERENCES.map(r => observationOf(r))
    const firstVisible = FIXTURE_REFERENCES.find(r => r.expectedState === 'VISIBLE')!
    const idx = observations.findIndex(o => o.relativeDestination === firstVisible.relativeDestination)
    observations[idx] = { ...observations[idx], naturalWidth: 0, naturalHeight: 0, imgComplete: false }
    const preflight = evaluateFixtureResourcePreflight({ references: FIXTURE_REFERENCES, observations })
    expect(preflight.decision).toBe('FAIL')
    expect(preflight.reason).toContain('VISIBLE_IMAGE_DECODE_FAIL')
    expect(observationProvesRenderedImage(observations[idx])).toBe(false)
  })

  it('FAILs when the EXPECTED_MISSING image actually exists', () => {
    const observations = FIXTURE_REFERENCES.map(r => observationOf(r))
    const idx = observations.findIndex(o => o.expectedState === 'MISSING')
    observations[idx] = { ...observations[idx], fsExists: true, domImgPresent: true, imgComplete: true, naturalWidth: 24, naturalHeight: 24 }
    const preflight = evaluateFixtureResourcePreflight({ references: FIXTURE_REFERENCES, observations })
    expect(preflight.decision).toBe('FAIL')
    expect(preflight.reason).toContain('EXPECTED_MISSING_IMAGE_EXISTS')
  })

  it('FAILs when a reference has no observation (UNKNOWN policy)', () => {
    const unique: FixtureImageReference = {
      caseId: 'X1',
      kind: 'image',
      altText: '',
      rawDestination: 'unique-x.png',
      relativeDestination: 'unique-x.png',
      expectedState: 'VISIBLE',
    }
    const preflight = evaluateFixtureResourcePreflight({ references: [unique], observations: [] })
    expect(preflight.decision).toBe('FAIL')
    expect(preflight.unknownPolicyReferences).toHaveLength(1)
    expect(preflight.reason).toContain('UNKNOWN_RESOURCE_POLICY')
  })

  it('the gate report covers every forbidden counter and the coverage minimums', () => {
    const gates = createFixtureResourceV1Counters()
    expect(formatFixtureResourceV1GateReport(gates)).toHaveLength(18)
    expect(evaluateFixtureResourceV1Gates(gates).decision).toBe('PASS')
    gates.renderedFigureOccurrenceNonImgTarget = 1
    expect(evaluateFixtureResourceV1Gates(gates).decision).toBe('FAIL')

    const coverage = createFixtureResourceV1CoverageCounters()
    expect(evaluateFixtureResourceV1Coverage(coverage).decision).toBe('FAIL')
    coverage.visibleFixtureImageReferenceCount = 11
    coverage.visibleFixtureRenderedImageDomCount = 11
    coverage.expectedMissingImageCaseCount = 1
    coverage.expectedMissingImageDiagnosticCount = 1
    coverage.renderedFigureOccurrenceLocateRuntimeCount = 3
    coverage.duplicateDestinationVisibleOccurrenceCount = 2
    coverage.duplicateDestinationDistinctSourceBlockIdentityCount = 2
    coverage.duplicateDestinationDistinctOccurrenceIdentityCount = 2
    coverage.duplicateDestinationDistinctResolvedDomElementCount = 2
    coverage.missingImageSourceBlockFallbackRuntimeCount = 1
    expect(formatFixtureResourceV1CoverageReport(coverage)).toHaveLength(10)
    expect(evaluateFixtureResourceV1Coverage(coverage).decision).toBe('PASS')
  })
})

// ── §38 — the rendered occurrence decision ────────────────────────────────

describe('FIXTURE-RENDERED — a resolved locate alone is never acceptance', () => {
  const ok = {
    resourceExists: true,
    resolvedNodeTag: 'img',
    usedSourceBlockFallback: false,
    imgComplete: true,
    naturalWidth: 24,
    naturalHeight: 24,
    resolveDecision: 'RESOLVED',
    correctOccurrence: true,
  }
  it('PASSes only with a real decoded <img> and no fallback', () => {
    expect(evaluateRenderedOccurrenceLocate(ok).decision).toBe('PASS')
  })
  it('FAILs on each missing precondition', () => {
    expect(evaluateRenderedOccurrenceLocate({ ...ok, resolveDecision: 'UNRESOLVED' }).failedChecks).toContain('RUNTIME_UNRESOLVED')
    expect(evaluateRenderedOccurrenceLocate({ ...ok, usedSourceBlockFallback: true }).failedChecks).toContain('FALLBACK_USED')
    expect(evaluateRenderedOccurrenceLocate({ ...ok, resolvedNodeTag: 'p' }).failedChecks).toContain('NON_IMG_TARGET')
    expect(evaluateRenderedOccurrenceLocate({ ...ok, naturalWidth: 0 }).failedChecks).toContain('DECODE_FAIL')
    expect(evaluateRenderedOccurrenceLocate({ ...ok, resourceExists: false }).failedChecks).toContain('RESOURCE_NOT_VISIBLE')
    expect(evaluateRenderedOccurrenceLocate({ ...ok, correctOccurrence: false }).failedChecks).toContain('WRONG_TARGET')
  })
})

// ── the REAL host runtime matrix (§28/§30/§33/§34/§35) ────────────────────

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1

function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number): void => { rafTasks.delete(id) }
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
function stubRect(el: Element, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}
/** jsdom never decodes images — stub the REAL decode facts explicitly. */
function stubDecodedImg(el: HTMLImageElement, w = 24, h = 24): void {
  Object.defineProperty(el, 'complete', { configurable: true, value: true })
  Object.defineProperty(el, 'naturalWidth', { configurable: true, value: w })
  Object.defineProperty(el, 'naturalHeight', { configurable: true, value: h })
}
function stubRangeRectsByOffset(fn: (el: Element | null, offset: number) => Array<{ left: number; top: number; right: number; bottom: number }>): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    selectNodeContents(): void { /* noop */ },
    getClientRects: () => fn(null, -1).map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

const MISSING_ONLY = new Set(['missing-local-image.png'])

function linkFacts(markdown: string, missing: Set<string>): DiagnosticLinkFact[] {
  const isMissing = (t: string): boolean => missing.has(t.split('/').pop() ?? t)
  const out: DiagnosticLinkFact[] = []
  const raw = parseLocalLinkTargets(markdown)
  for (let i = 0; i < raw.length; i++) {
    const o = typeof raw[i] === 'string' ? { target: raw[i] as string } : raw[i] as Exclude<typeof raw[number], string>
    // ONLY missing local references become resource diagnostics (the producer
    // has no existence check of its own).
    if (!isMissing(o.target)) continue
    const occurrenceIndex = raw.slice(0, i).filter(p => {
      const q = typeof p === 'string' ? { target: p } : p
      return (q.resourceKind ?? 'link') === (o.resourceKind ?? 'link') && q.target === o.target
    }).length
    out.push({
      // `index` MUST be the position inside `input.links` (the producer uses it
      // as the occurrence-group fact index).
      target: o.target, element: null, index: out.length,
      resourceKind: o.resourceKind, semanticDestination: o.target,
      sourceStart: o.sourceStart, sourceEnd: o.sourceEnd,
      startLine: o.startLine, endLine: o.endLine, startColumn: o.startColumn, endColumn: o.endColumn,
      rawText: o.rawText, destinationStart: o.destinationStart, destinationEnd: o.destinationEnd,
      rawToken: o.rawToken, altText: o.altText, resourceClass: o.resourceClass,
      targetIdentity: `local:${o.target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
    })
  }
  return out
}

function inputOf(markdown: string, missing: Set<string>): DocumentDiagnosticsInput {
  const isMissing = (t: string): boolean => missing.has(t.split('/').pop() ?? t)
  return {
    documentKey: FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH,
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [], figures: [],
    figureSourceOccurrences: buildFigureSourceOccurrences({
      scanned: parseImageSourceOccurrences(markdown),
      documentKey: FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH,
      resolveCanonicalDestination: d => d,
      isLocalFileMissing: isMissing,
    }),
    tables: [], codes: [], formulas: [],
    links: linkFacts(markdown, missing),
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

function makeHost(markdown: string, missing: Set<string>): {
  h: DocumentUtilityOverlayHost
  write: HTMLElement
  snapshot: DocumentDiagnosticsSnapshot
} {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 800, bottom: 600 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const root = document.createElement('div')
  root.className = 'inkchapter-doc-overlay-root'
  stubRect(root, () => ({ left: 0, top: 0, right: 1536, bottom: 782 }))
  document.body.appendChild(root)

  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => '/vault/runtime/smoke/Figure-Diagnostic-Locator-V1-Test.md',
      getDocumentKey: () => FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH,
      getMarkdown: () => markdown,
      isStrictMode: () => false,
      vaultRoot: 'D:/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  const providers: DocumentDiagnosticsProviders = {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: (t) => missing.has(t.split('/').pop() ?? t),
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
  }
  const h = new DocumentUtilityOverlayHost({ ctx, providers })
  h.mount()

  const computed = computeDocumentDiagnostics(inputOf(markdown, missing))
  const snapshot = {
    documentKey: FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH,
    revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: computed.diagnostics,
    errorCount: computed.errorCount, warningCount: computed.warningCount, infoCount: computed.infoCount,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as {
    diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void }
  }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the transaction test */ }
  return { h, write, snapshot }
}

/** Build the REAL DOM mirror of the fixture (one block per Markdown block). */
function buildFixtureDom(write: HTMLElement, missing: Set<string>): void {
  const lines = FIXTURE_MARKDOWN.split('\n')
  const blocks: string[] = []
  lines.forEach((line, idx) => {
    if (!/!\[[^\]]*\]\([^)]+\)/.test(line)) return
    blocks.push(`<p data-line="${idx}">${line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      (_m, alt: string, dest: string) => (missing.has(dest.split('/').pop() ?? dest) ? '' : `<img src="D:/vault/${FIXTURE_DIR_RELATIVE}${dest}" alt="${alt}">`))}</p>`)
  })
  write.innerHTML = blocks.join('')
  for (const img of Array.from(write.querySelectorAll('img'))) {
    stubRect(img, () => ({ left: 300, top: 100, right: 324, bottom: 124 }))
    stubDecodedImg(img as HTMLImageElement, 24, 24)
  }
  for (const p of Array.from(write.querySelectorAll('p'))) {
    stubRect(p, () => ({ left: 300, top: 100, right: 700, bottom: 124 }))
  }
}

async function locate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

function runPreflight(h: DocumentUtilityOverlayHost, snapshot: DocumentDiagnosticsSnapshot): void {
  ;(h as unknown as { runFixtureResourcePreflight(s: DocumentDiagnosticsSnapshot): void })
    .runFixtureResourcePreflight(snapshot)
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

describe('FIXTURE-HOST — the REAL runtime resource + locator matrix', () => {
  it('FIXTURE-PREFLIGHT-HOST: the real fixture PASSes the runtime preflight with rendered <img>', () => {
    const { h, write, snapshot } = makeHost(FIXTURE_MARKDOWN, MISSING_ONLY)
    host = h
    buildFixtureDom(write, MISSING_ONLY)
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 324, bottom: 124 }])

    runPreflight(h, snapshot)

    const preflight = h.getFixtureResourcePreflight()
    expect(preflight).not.toBeNull()
    expect(preflight!.decision).toBe('PASS')
    expect(preflight!.expectedVisibleReferenceCount).toBeGreaterThanOrEqual(9)
    expect(preflight!.expectedVisibleRenderedImgCount).toBe(preflight!.expectedVisibleReferenceCount)
    expect(preflight!.expectedVisibleDecodedImgCount).toBe(preflight!.expectedVisibleReferenceCount)
    expect(preflight!.expectedMissingReferenceCount).toBe(1)

    const gates = h.getFixtureResourceV1GateReport()
    expect(gates).toContain('UNEXPECTED_MISSING_IMAGE_IN_VISIBLE_FIXTURE_COUNT=0')
    expect(gates).toContain('VISIBLE_FIXTURE_IMAGE_DOM_MISSING_COUNT=0')
    expect(gates).toContain('VISIBLE_FIXTURE_IMAGE_DECODE_FAIL_COUNT=0')
    expect(gates).toContain('VISIBLE_FIXTURE_LOCAL_IMAGE_MISSING_DIAGNOSTIC_COUNT=0')
    expect(gates).toContain('FIXTURE_RESOURCE_UNKNOWN_POLICY_COUNT=0')
    expect(gates).toContain('LEGACY_NONEXISTENT_FIXTURE_PATH_REFERENCE_COUNT=0')
    expect(gates).toContain('UNEXPECTED_FIGURE_LOCAL_IMAGE_MISSING_COUNT=0')
    expect(h.getFixtureResourceV1GateDecision().failedChecks).toEqual([])

    const coverage = h.getFixtureResourceV1CoverageReport()
    expect(coverage).toContain('EXPECTED_MISSING_IMAGE_CASE_COUNT=1')
    expect(coverage).toContain('EXPECTED_MISSING_IMAGE_DIAGNOSTIC_COUNT=1')

    // the per-reference audit is emitted for every reference; the LAST complete
    // run is the authoritative one (the preflight is snapshot-scoped).
    const resLines = infoSpy!.mock.calls.map(c => String(c[0]))
      .filter(l => l.includes('FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-AUDIT'))
    const runCount = Math.max(1, Math.round(resLines.length / FIXTURE_REFERENCES.length))
    expect(runCount).toBeGreaterThanOrEqual(1)
    const audit = readAudit(
      infoSpy!,
      'FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-AUDIT',
      (runCount - 1) * FIXTURE_REFERENCES.length,
    )
    expect(audit).not.toBeNull()
    expect(audit!.expectedState).toBe('VISIBLE')
    expect(audit!.fsExists).toBe('true')
    expect(audit!.domImgPresent).toBe('true')
    expect(audit!.imgComplete).toBe('true')
    expect(audit!.decision).toBe('PASS')
  })

  it('FIXTURE-PREFLIGHT-HOST: a regressed legacy path FAILs the preflight', () => {
    const badMarkdown = FIXTURE_MARKDOWN.replace('assets/figure-diagnostic-locator-v1/a-visible.png', 'a.png')
    const missing = new Set(['a.png', 'missing-local-image.png'])
    const { h, write, snapshot } = makeHost(badMarkdown, missing)
    host = h
    buildFixtureDom(write, new Set())
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 324, bottom: 124 }])
    // preflight parses the CURRENT markdown, so mirror the regressed markdown
    const regressedSnapshot = { ...snapshot } as DocumentDiagnosticsSnapshot
    ;(h as unknown as { opts: { ctx: { authority: { getMarkdown: () => string } } } }).opts.ctx.authority.getMarkdown = () => badMarkdown

    runPreflight(h, regressedSnapshot)

    expect(h.getFixtureResourcePreflight()!.decision).toBe('FAIL')
    const gates = h.getFixtureResourceV1GateReport()
    expect(gates).toContain('LEGACY_NONEXISTENT_FIXTURE_PATH_REFERENCE_COUNT=1')
    expect(gates).toContain('UNEXPECTED_MISSING_IMAGE_IN_VISIBLE_FIXTURE_COUNT=1')
  })

  it('FIXTURE-RENDERED-HOST: W1 #1 / #2 / W2 resolve to REAL <img> with distinct DOM targets', async () => {
    const { h, write, snapshot } = makeHost(FIXTURE_MARKDOWN, MISSING_ONLY)
    host = h
    buildFixtureDom(write, MISSING_ONLY)
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 324, bottom: 124 }])
    runPreflight(h, snapshot)

    const diags = snapshot.diagnostics
    const w1 = diags.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '').includes('repeated-visible.png'))
    const w2 = diags.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '').includes('b-visible.png'))
    expect(w1).toHaveLength(2)
    expect(w2).toHaveLength(1)

    await locate(h, w1[0].id)
    await locate(h, w1[1].id)
    await locate(h, w2[0].id)

    const a0 = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', 0)!
    const a1 = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', 1)!
    const a2 = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', 2)!
    for (const a of [a0, a1, a2]) {
      expect(a.locatorKind).toBe('figure-occurrence')
      expect(a.resolveDecision).toBe('RESOLVED')
      expect(a.resolvedNodeKind).toBe('img')
      expect(a.finalDecision).toBe('PASS')
    }
    // §12/§34 — two occurrences of the SAME destination → two DIFFERENT DOM images.
    expect(a0.resolvedBlockIdentity).not.toBe(a1.resolvedBlockIdentity)

    const gates = h.getFixtureResourceV1GateReport()
    expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_RUNTIME_UNRESOLVED_COUNT=0')
    expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_NON_IMG_TARGET_COUNT=0')
    expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_FALLBACK_USED_COUNT=0')
    expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_DECODE_FAIL_COUNT=0')
    expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_WRONG_TARGET_COUNT=0')
    expect(gates).toContain('DUPLICATE_DESTINATION_WRONG_FIRST_MATCH_COUNT=0')
    expect(gates).toContain('DUPLICATE_DESTINATION_AMBIGUITY_COUNT=0')
    expect(h.getFixtureResourceV1GateDecision().failedChecks).toEqual([])

    const coverage = h.getFixtureResourceV1CoverageReport()
    const val = (key: string): number => Number(coverage.find(l => l.startsWith(`${key}=`))?.split('=')[1] ?? '0')
    expect(val('RENDERED_FIGURE_OCCURRENCE_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(3)
    expect(val('DUPLICATE_DESTINATION_VISIBLE_OCCURRENCE_COUNT')).toBeGreaterThanOrEqual(2)
    expect(val('DUPLICATE_DESTINATION_DISTINCT_SOURCE_BLOCK_IDENTITY_COUNT')).toBeGreaterThanOrEqual(2)
    expect(val('DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_IDENTITY_COUNT')).toBeGreaterThanOrEqual(2)
    expect(val('DUPLICATE_DESTINATION_DISTINCT_RESOLVED_DOM_ELEMENT_COUNT')).toBeGreaterThanOrEqual(2)
  })

  it('FIXTURE-MISSING-HOST: W3 uses the source-block fallback and is NEVER a rendered occurrence', async () => {
    const { h, write, snapshot } = makeHost(FIXTURE_MARKDOWN, MISSING_ONLY)
    host = h
    buildFixtureDom(write, MISSING_ONLY)
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 700, bottom: 124 }])
    runPreflight(h, snapshot)

    const w3 = snapshot.diagnostics.filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')
    expect(w3).toHaveLength(1)

    await locate(h, w3[0].id)

    const a = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', 0)!
    expect(a.locatorKind).toBe('figure-occurrence')
    expect(a.resolveDecision).toBe('RESOLVED')
    expect(a.usedFallback).toBe('true')
    expect(a.resolvedNodeKind).not.toBe('img')

    const gates = h.getFixtureResourceV1GateReport()
    expect(gates).toContain('MISSING_IMAGE_FALLBACK_UNRESOLVED_COUNT=0')
    expect(gates).toContain('MISSING_IMAGE_FALLBACK_WRONG_BLOCK_COUNT=0')
    expect(gates).toContain('BROKEN_IMAGE_FALLBACK_COUNTED_AS_RENDERED_OCCURRENCE_COUNT=0')
    expect(h.getFixtureResourceV1CoverageReport())
      .toContain('MISSING_IMAGE_SOURCE_BLOCK_FALLBACK_RUNTIME_COUNT=1')
  })

  it('FIXTURE-STRUCTURE-HOST: S1-S4/S5 source-block locates keep the whole owning block', async () => {
    const { h, write, snapshot } = makeHost(FIXTURE_MARKDOWN, MISSING_ONLY)
    host = h
    buildFixtureDom(write, MISSING_ONLY)
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 700, bottom: 124 }])
    runPreflight(h, snapshot)

    const structure = snapshot.diagnostics.filter(d => d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(structure).toHaveLength(6)
    for (let i = 0; i < structure.length; i++) {
      await locate(h, structure[i].id)
      const audit = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', i)
      expect(audit).not.toBeNull()
      expect(audit!.locatorKind).toBe('source-block')
      expect(audit!.resolveDecision).toBe('RESOLVED')
      expect(audit!.resolveReason).not.toBe('AMBIGUOUS_DUPLICATE_INLINE_RANGE')
    }
    const gateReport = h.getFigureLocatorV1GateReport()
    expect(gateReport).toContain('FIGURE_STRUCTURE_RUNTIME_UNRESOLVED_COUNT=0')
    expect(gateReport).toContain('FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT=0')
    expect(gateReport).toContain('FIGURE_STRUCTURE_BLOCK_BINDING_MISSING_COUNT=0')
  })
})

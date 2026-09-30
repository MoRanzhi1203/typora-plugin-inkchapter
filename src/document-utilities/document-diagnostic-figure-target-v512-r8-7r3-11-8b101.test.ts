// @vitest-environment jsdom
/**
 * V5.12-R8 — Code Caption Spacing + Figure Diagnostic Target / Existence Closures.
 *
 * Covers the prompt's required automation matrix:
 *   R8-CODE-01 / R8-CODE-02
 *   R8-FIGURE-01 … R8-FIGURE-10
 * plus the R8 hard gates (per-click + snapshot-scoped).
 *
 * The tests consume the SAME scanner/authority the production path uses:
 * `parseLocalLinkTargets` / `parseImageSourceOccurrences` (ONE scanner) and
 * `buildFigureSourceOccurrences` (the unified Figure Source Occurrence).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences, parseLocalLinkTargets, findReferenceSpans } from './document-resource-scanner'
import { measureTextFragmentRects } from './document-locate-visual-geometry-v4'
import {
  FIGURE_MISSING_NAME_RANGE_ROLE,
  FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE,
  evaluateFigureTargetAuthority,
  evaluateFigureTargetSnapshotGates,
  evaluateFigureTargetV512R8Gates,
  createFigureTargetV512R8Counters,
  formatFigureTargetV512R8GateReport,
  type FigureSnapshotDiagnosticView,
} from './document-diagnostic-figure-target-v512-r8'
import {
  CAPTION_CODE_GAP_GATE_MAX_PX,
  CAPTION_CODE_GAP_GATE_MIN_PX,
  CAPTION_CODE_GAP_TARGET_MAX_PX,
  CAPTION_CODE_GAP_TARGET_MIN_PX,
  evaluateCaptionCodeSpacingGap,
} from './document-caption-code-spacing-v512-r8'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function inputOf(
  markdown: string,
  opts: { missing?: (target: string) => boolean } = {},
): DocumentDiagnosticsInput {
  const missing = opts.missing ?? (() => true)
  const links: DiagnosticLinkFact[] = []
  const raw = parseLocalLinkTargets(markdown)
  for (let i = 0; i < raw.length; i++) {
    const o = typeof raw[i] === 'string' ? { target: raw[i] as string } : raw[i] as Exclude<typeof raw[number], string>
    if (!missing(o.target)) continue
    const occurrenceIndex = raw
      .slice(0, i)
      .filter(p => {
        const q = typeof p === 'string' ? { target: p } : p
        return (q.resourceKind ?? 'link') === (o.resourceKind ?? 'link') && q.target === o.target
      }).length
    links.push({
      target: o.target,
      element: null,
      index: i,
      resourceKind: o.resourceKind,
      semanticDestination: o.target,
      sourceStart: o.sourceStart,
      sourceEnd: o.sourceEnd,
      startLine: o.startLine,
      endLine: o.endLine,
      startColumn: o.startColumn,
      endColumn: o.endColumn,
      rawText: o.rawText,
      destinationStart: o.destinationStart,
      destinationEnd: o.destinationEnd,
      rawToken: o.rawToken,
      altText: o.altText,
      resourceClass: o.resourceClass,
      targetIdentity: `local:${o.target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
    })
  }
  const figureSourceOccurrences = buildFigureSourceOccurrences({
    scanned: parseImageSourceOccurrences(markdown),
    documentKey: 'doc:r8',
    resolveCanonicalDestination: d => d,
    isLocalFileMissing: d => missing(d),
  })
  return {
    documentKey: 'doc:r8',
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [],
    figures: [],
    figureSourceOccurrences,
    tables: [],
    codes: [],
    formulas: [],
    links,
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function byCode(input: DocumentDiagnosticsInput, code: string) {
  return computeDocumentDiagnostics(input).diagnostics.filter(d => d.code === code)
}

// ── R8-CODE — Code Caption → Code Body scoped spacing ──────────────────────

describe('R8-CODE — code caption → code body spacing', () => {
  it('R8-CODE-01: the gap decision obeys the 1..6px hard gate and the 2..4px target', () => {
    expect(CAPTION_CODE_GAP_GATE_MIN_PX).toBe(1)
    expect(CAPTION_CODE_GAP_GATE_MAX_PX).toBe(6)
    expect(CAPTION_CODE_GAP_TARGET_MIN_PX).toBe(2)
    expect(CAPTION_CODE_GAP_TARGET_MAX_PX).toBe(4)
    for (const gap of [2, 3, 4]) {
      expect(evaluateCaptionCodeSpacingGap(gap).decision).toBe('PASS')
    }
    expect(evaluateCaptionCodeSpacingGap(0.5).reason).toBe('CODE_CAPTION_BODY_GAP_LT_1PX')
    expect(evaluateCaptionCodeSpacingGap(15).reason).toBe('CODE_CAPTION_BODY_GAP_GT_6PX')
    expect(evaluateCaptionCodeSpacingGap(null).decision).toBe('NOT_APPLICABLE')
  })

  it('R8-CODE-01: the scoped rule zeroes the caption bottom margin and clamps the code margin', () => {
    const cleaned = stripComments(scss)
    // The caption's own bottom margin/padding is removed for CODE captions.
    expect(cleaned).toMatch(/#write\s+\.inkchapter-caption-code\s*\{[^}]*margin-bottom:\s*0/)
    // The code body immediately after a code caption gets the tightened margin.
    expect(cleaned).toMatch(/#write\s+\.inkchapter-caption-code\s*\+\s*pre\.md-fences\s*\{[^}]*margin-top:\s*3px/)
  })

  it('R8-CODE-02: no global pre/code/.md-fences margin, line-height or code-padding mutation', () => {
    const cleaned = stripComments(scss)
    // The ONLY `.md-fences` rule in the stylesheet is the scoped sibling rule.
    const mdFencesRules: string[] = cleaned.match(/\}[^]*?\.md-fences[^{]*\{/g) ?? []
    expect(mdFencesRules.every(r => r.includes('.inkchapter-caption-code + pre.md-fences'))).toBe(true)
    // No bare global `pre {`, `code {` margin rules were introduced.
    expect(cleaned).not.toMatch(/(^|\})\s*pre\s*\{[^}]*margin/)
    expect(cleaned).not.toMatch(/(^|\})\s*code\s*\{[^}]*margin/)
    // Code line-height is never authored by the caption rules.
    const codeCaptionRules = cleaned.match(/#write\s+\.inkchapter-caption-code[^{]*\{[^}]*\}/g) ?? []
    expect(codeCaptionRules.length).toBeGreaterThan(0)
    for (const rule of codeCaptionRules) expect(rule).not.toMatch(/line-height/)
    // The code block's INTERNAL padding is never touched.
    for (const rule of codeCaptionRules) expect(rule).not.toMatch(/padding-(top|left|right)\s*:/)
    // Other object captions keep their spacing (base caption rule unchanged).
    expect(cleaned).toMatch(/#write\s+\.inkchapter-caption\s*\{[^}]*margin:\s*6px 0/)
    expect(cleaned).not.toMatch(/\.inkchapter-caption-(table|figure)\s*\{[^}]*margin/)
  })
})

// ── R8-FIGURE — the unified Figure Source Occurrence ───────────────────────

describe('R8-FIGURE — Figure Source Occurrence carries BOTH ranges', () => {
  it('R8-FIGURE-00: the single scanner yields exact full-token + destination spans', () => {
    const spans = findReferenceSpans('![](a.png)')
    expect(spans).toEqual([{
      tokenStart: 0,
      tokenEnd: 10,
      // `![](` occupies 0..3, so the destination path starts at index 4.
      destinationStart: 4,
      destinationEnd: 9,
      rawToken: '![](a.png)',
      rawDestination: 'a.png',
      altText: '',
      resourceKind: 'image',
      resourceClass: 'local',
    }])
    const withTitle = findReferenceSpans('![alt](a.png "title")')[0]
    expect(withTitle.rawToken).toBe('![alt](a.png "title")')
    expect('![alt](a.png "title")'.slice(withTitle.destinationStart, withTitle.destinationEnd)).toBe('a.png')
    const chinese = findReferenceSpans('![中文 alt](../../../Downloads/a.png)')[0]
    expect('![中文 alt](../../../Downloads/a.png)'.slice(chinese.destinationStart, chinese.destinationEnd))
      .toBe('../../../Downloads/a.png')
    const encoded = findReferenceSpans('![alt](a%20b.png)')[0]
    expect(encoded.rawDestination).toBe('a%20b.png')
  })

  it('R8-FIGURE-04: one occurrence keeps full token, destination, occurrenceIndex and identity', () => {
    const md = '![](missing.png)\n'
    const occs = buildFigureSourceOccurrences({
      scanned: parseImageSourceOccurrences(md),
      documentKey: 'doc:r8',
      resolveCanonicalDestination: d => d,
      isLocalFileMissing: () => true,
    })
    expect(occs).toHaveLength(1)
    const o = occs[0]
    expect(o.rawToken).toBe('![](missing.png)')
    expect(md.slice(o.tokenStart, o.tokenEnd)).toBe('![](missing.png)')
    expect(md.slice(o.destinationStart, o.destinationEnd)).toBe('missing.png')
    expect(o.occurrenceIndex).toBe(0)
    expect(o.sourceRangeIdentity).toContain('o0')
    expect(o.tokenStart).not.toBe(o.destinationStart)
  })

  it('R8-FIGURE-08/09: remote and data URLs are classified, never "local"', () => {
    const occs = buildFigureSourceOccurrences({
      scanned: parseImageSourceOccurrences('![r](https://x/y.png)\n\n![d](data:image/png;base64,AAAA)'),
      documentKey: 'doc:r8',
      resolveCanonicalDestination: d => d,
      isLocalFileMissing: () => true,
    })
    expect(occs.map(o => o.resourceClass)).toEqual(['remote', 'data'])
    expect(occs.every(o => !o.isLocal)).toBe(true)
    expect(occs.every(o => o.localFileExists == null)).toBe(true)
  })
})

// ── R8-FIGURE-01/02/05 — FIGURE_MISSING_NAME targets the FULL TOKEN ────────

describe('R8-FIGURE — FIGURE_MISSING_NAME → FIGURE_FULL_TOKEN', () => {
  it('R8-FIGURE-01: `![](a.png)` → one locatable full-token warning', () => {
    const md = '![](a.png)\n'
    const diags = byCode(inputOf(md), 'FIGURE_MISSING_NAME')
    expect(diags).toHaveLength(1)
    const d = diags[0]
    expect(d.severity).toBe('warning')
    // V1 — FIGURE_MISSING_NAME now carries the explicit figure-occurrence locator.
    expect(d.location?.kind).toBe('figure-occurrence')
    if (d.location?.kind !== 'figure-occurrence') throw new Error('not figure-occurrence')
    expect(d.location.rangeRole).toBe(FIGURE_MISSING_NAME_RANGE_ROLE)
    expect(md.slice(d.location.sourceStart ?? 0, d.location.sourceEnd ?? 0)).toBe('![](a.png)')
    expect(d.metadata?.rawToken).toBe('![](a.png)')
    expect(d.metadata?.altText).toBe('')
  })

  it('R8-FIGURE-02: a NON-EMPTY alt never yields FIGURE_MISSING_NAME', () => {
    const md = '![系统架构](a.png)\n'
    expect(byCode(inputOf(md), 'FIGURE_MISSING_NAME')).toHaveLength(0)
    expect(byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(1)
  })

  it('R8-FIGURE-05: the fixed semantics are rangeRole=FIGURE_FULL_TOKEN + fixed rule mapping', () => {
    const md = '![](a.png)\n'
    const d = byCode(inputOf(md), 'FIGURE_MISSING_NAME')[0]
    expect(d.metadata?.rangeRole).toBe(FIGURE_MISSING_NAME_RANGE_ROLE)
    const view = d.location as { rangeRole?: string; sourceStart?: number | null }
    expect(view.rangeRole).toBe('figure-full-token')
    expect(typeof view.sourceStart).toBe('number')
  })

  it('R8-FIGURE-03: a whole image token is one DOM Range across text nodes', () => {
    document.body.innerHTML = '<p id="p"><span>![](</span>a.png<span>)</span></p>'
    const p = document.getElementById('p') as HTMLElement
    const captured: Array<{ node: Node; offset: number }> = []
    const fake = {
      setStart(n: Node, o: number): void { captured.push({ node: n, offset: o }) },
      setEnd(n: Node, o: number): void { captured.push({ node: n, offset: o }) },
      selectNodeContents(): void { captured.length = 0 },
      getClientRects: () => [],
    }
    const original = document.createRange
    ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
    try {
      const res = measureTextFragmentRects(p, '![](a.png)', 0)
      expect(res.foundToken).toBe(true)
      // The range starts in the FIRST text node and ends in the LAST one — the
      // token is NOT contained in a single text node.
      expect(captured).toHaveLength(2)
      expect(captured[0].node.nodeValue).toBe('![](')
      expect(captured[0].offset).toBe(0)
      expect(captured[1].node.nodeValue).toBe(')')
      expect(captured[1].offset).toBe(1)
    } finally {
      ;(document as unknown as { createRange: () => unknown }).createRange = original
    }
  })
})

// ── R8-FIGURE-06/07/08/09 — FIGURE_LOCAL_IMAGE_MISSING → DESTINATION ───────

describe('R8-FIGURE — FIGURE_LOCAL_IMAGE_MISSING → FIGURE_DESTINATION', () => {
  it('R8-FIGURE-06: warning severity + destination-only range', () => {
    const md = '![](a.png)\n'
    const d = byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')[0]
    expect(d.severity).toBe('warning')
    // V1 — FIGURE_LOCAL_IMAGE_MISSING now carries the explicit figure-occurrence locator.
    if (d.location?.kind !== 'figure-occurrence') throw new Error('not figure-occurrence')
    expect(d.location.rangeRole).toBe(FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE)
    expect(md.slice(d.location.sourceStart ?? 0, d.location.sourceEnd ?? 0)).toBe('a.png')
    // The whole token is still carried on the SAME occurrence.
    expect(d.metadata?.rawToken).toBe('![](a.png)')
    expect(d.metadata?.tokenStart).toBe(0)
    expect(d.metadata?.tokenEnd).toBe(10)
  })

  it('R8-FIGURE-07: duplicate same.png occurrence 0/1 stay independent for BOTH rules', () => {
    const md = '![](same.png)\n\n![](same.png)\n'
    const go = byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')
    expect(go).toHaveLength(2)
    expect(go.map(d => d.metadata?.occurrenceIndex)).toEqual([0, 1])
    const starts = go.map(d => (d.location as { sourceStart: number }).sourceStart)
    expect(new Set(starts).size).toBe(2)
    const ids = go.map(d => (d.location as { sourceRangeIdentity: string }).sourceRangeIdentity)
    expect(new Set(ids).size).toBe(2)
    // The full-token targets differ too (different source lines).
    const mn = byCode(inputOf(md), 'FIGURE_MISSING_NAME')
    expect(mn).toHaveLength(2)
    const mnStarts = mn.map(d => (d.location as { sourceStart: number }).sourceStart)
    expect(new Set(mnStarts).size).toBe(2)
  })

  it('R8-FIGURE-08: a remote URL never produces a local-missing warning', () => {
    const md = '![远程](https://example.com/a.png)\n'
    expect(byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
    expect(byCode(inputOf(md), 'FIGURE_MISSING_NAME')).toHaveLength(0)
  })

  it('R8-FIGURE-09: a data URL never produces a local-missing warning', () => {
    const md = '![d](data:image/png;base64,AAAA)\n'
    expect(byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
  })

  it('R8-FIGURE-08: an EXISTING local image produces no local-missing warning', () => {
    const md = '![](exists.png)\n'
    const out = computeDocumentDiagnostics(inputOf(md, { missing: () => false }))
    expect(out.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(false)
  })
})

// ── R8-FIGURE-10 — the two rules coexist (never deduped) ───────────────────

describe('R8-FIGURE — two independent Warnings on the SAME figure', () => {
  it('R8-FIGURE-10: `![](missing.png)` keeps BOTH warnings with distinct identities', () => {
    const md = '![](missing.png)\n'
    const out = computeDocumentDiagnostics(inputOf(md))
    const codes = out.diagnostics.map(d => d.code)
    expect(codes.filter(c => c === 'FIGURE_MISSING_NAME')).toHaveLength(1)
    expect(codes.filter(c => c === 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(1)
    const a = out.diagnostics.find(d => d.code === 'FIGURE_MISSING_NAME')!
    const b = out.diagnostics.find(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')!
    expect(a.id).not.toBe(b.id)
    expect(a.targetIdentity).not.toBe(b.targetIdentity)
    expect((a.location as { rangeRole?: string }).rangeRole).toBe('figure-full-token')
    expect((b.location as { rangeRole?: string }).rangeRole).toBe('figure-destination')
    // The token range and the destination range are DIFFERENT ranges.
    const aLoc = a.location as { sourceStart: number; sourceEnd: number }
    const bLoc = b.location as { sourceStart: number; sourceEnd: number }
    expect(aLoc.sourceStart).not.toBe(bLoc.sourceStart)
    expect(aLoc.sourceEnd).not.toBe(bLoc.sourceEnd)
    expect(out.errorCount).toBe(0)
    expect(out.warningCount).toBeGreaterThanOrEqual(2)
  })
})

// ── R8 hard gates ─────────────────────────────────────────────────────────

describe('R8-GATE — figure target / existence hard gates', () => {
  it('GATE-1: the per-click authority requires the fixed role, the range and a real visual', () => {
    const base = {
      ruleCode: 'FIGURE_MISSING_NAME',
      occurrenceIndex: 0,
      sourceRangeIdentity: 'id',
      rawToken: '![](a.png)',
      rawDestination: 'a.png',
      canonicalDestination: 'a.png',
      expectedRangeRole: FIGURE_MISSING_NAME_RANGE_ROLE,
      resolvedRangeRole: FIGURE_MISSING_NAME_RANGE_ROLE,
      expectedSourceStart: 0,
      expectedSourceEnd: 10,
      resolvedSourceStart: 0,
      resolvedSourceEnd: 10,
      rangeClientRectCount: 1,
      visualFragmentCount: 1,
      documentLocalRectCount: 1,
      severity: 'warning',
      localFileExists: false,
      resourceClass: 'local',
      exactTokenAvailable: true,
      exactTokenUsed: true,
      usedBlockFallback: false,
      decision: 'PASS' as const,
      reason: '',
    }
    expect(evaluateFigureTargetAuthority(base).decision).toBe('PASS')
    expect(evaluateFigureTargetAuthority({ ...base, resolvedRangeRole: FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE }).reason)
      .toBe('RESOLVED_RANGE_ROLE_MISMATCH')
    expect(evaluateFigureTargetAuthority({ ...base, visualFragmentCount: 0 }).reason).toBe('CLICK_WITHOUT_VISUAL')
    expect(evaluateFigureTargetAuthority({ ...base, exactTokenUsed: false }).reason)
      .toBe('EXACT_TOKEN_AVAILABLE_BUT_NOT_USED')
    expect(evaluateFigureTargetAuthority({ ...base, exactTokenUsed: false, usedBlockFallback: true }).decision)
      .toBe('FAIL')
    expect(evaluateFigureTargetAuthority({ ...base, resolvedSourceStart: 5 }).reason)
      .toBe('SOURCE_RANGE_START_MISMATCH')
  })

  it('GATE-2: snapshot gates are 0 for a healthy snapshot and catch collapsed rules', () => {
    const good: FigureSnapshotDiagnosticView[] = [
      {
        code: 'FIGURE_MISSING_NAME', severity: 'warning', resourceKind: 'image', resourceClass: 'local',
        altText: '', canonicalDestination: 'a.png', occurrenceIndex: 0, localFileExists: false,
        rangeRole: 'figure-full-token', locatableSourceRange: true, sourceStart: 0, sourceEnd: 10,
        destinationStart: 2, destinationEnd: 8,
      },
      {
        code: 'FIGURE_LOCAL_IMAGE_MISSING', severity: 'warning', resourceKind: 'image', resourceClass: 'local',
        altText: '', canonicalDestination: 'a.png', occurrenceIndex: 0, localFileExists: false,
        rangeRole: 'figure-destination', locatableSourceRange: true, sourceStart: 2, sourceEnd: 8,
        destinationStart: 2, destinationEnd: 8,
      },
    ]
    expect(evaluateFigureTargetSnapshotGates(good)).toEqual({})
    // Dropping the local-missing warning = the two rules were collapsed.
    const collapsed = evaluateFigureTargetSnapshotGates([good[0]])
    expect(collapsed.distinctRulesCollapsedByDedupe).toBe(1)
    expect(collapsed.localImageMissingExpectedButAbsent).toBe(1)
    // A non-warning local-missing / a remote false positive are caught.
    const bad = evaluateFigureTargetSnapshotGates([
      { ...good[1], severity: 'error', resourceClass: 'remote', destinationStart: null, destinationEnd: null },
    ])
    expect(bad.localImageMissingNonWarningSeverity).toBe(1)
    expect(bad.remoteImageFalseLocalMissing).toBe(1)
    expect(bad.localImageMissingDestinationRangeNull).toBe(1)
  })

  it('GATE-3: the gate report exposes every R8 key and defaults to PASS', () => {
    const report = formatFigureTargetV512R8GateReport(createFigureTargetV512R8Counters())
    for (const label of [
      'FIGURE_MISSING_NAME_WITHOUT_LOCATE_TARGET_COUNT',
      'FIGURE_MISSING_NAME_FULL_TOKEN_RANGE_NULL_COUNT',
      'FIGURE_MISSING_NAME_EXACT_TOKEN_AVAILABLE_BUT_NOT_USED_COUNT',
      'FIGURE_MISSING_NAME_PARTIAL_DESTINATION_ONLY_MARK_COUNT',
      'FIGURE_MISSING_NAME_CLICK_WITHOUT_VISUAL_COUNT',
      'LOCAL_IMAGE_MISSING_EXPECTED_BUT_ABSENT_COUNT',
      'LOCAL_IMAGE_MISSING_NON_WARNING_SEVERITY_COUNT',
      'LOCAL_IMAGE_MISSING_DESTINATION_RANGE_NULL_COUNT',
      'LOCAL_IMAGE_MISSING_CLICK_WITHOUT_VISUAL_COUNT',
      'LOCAL_IMAGE_MISSING_FULL_TOKEN_MARK_INSTEAD_OF_PATH_COUNT',
      'REMOTE_IMAGE_FALSE_LOCAL_MISSING_COUNT',
      'DATA_URL_FALSE_LOCAL_MISSING_COUNT',
      'FIGURE_DISTINCT_RULES_COLLAPSED_BY_DEDUPE_COUNT',
    ]) {
      expect(report.some(line => line === `${label}=0`)).toBe(true)
    }
    expect(evaluateFigureTargetV512R8Gates(createFigureTargetV512R8Counters()).decision).toBe('PASS')
  })
})

beforeEach(() => {
  document.body.innerHTML = ''
})

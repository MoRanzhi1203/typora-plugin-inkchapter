// @vitest-environment jsdom
/**
 * TRAE — Figure Diagnostic Locator V2 (§39) — targeted contract tests.
 *
 * The round removes three real defects proved by the runtime log:
 *   1. `identityMatch=false` + `targetVisible=true` used to PASS;
 *   2. a `source-block` used the inline occurrence audit and claimed
 *      `SOURCE_OCCURRENCE_IDENTITY_OK` while every field was null;
 *   3. a clean atomic teardown (cleanup PASS) masked a semantic locate FAIL.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FIGURE_DIAGNOSTIC_LOCATOR_V2_COVERAGE_KEYS,
  FIGURE_DIAGNOSTIC_LOCATOR_V2_GATE_KEYS,
  FIGURE_DIAGNOSTIC_LOCATOR_V2_GATE_LABELS,
  SOURCE_BLOCK_IDENTITY_AUDIT,
  buildSourceBlockIdentity,
  classifySourceBlockContainer,
  computeFeatureLocateDecision,
  computeInteractionFinalDecision,
  createFigureDiagnosticLocatorV2Counters,
  createFigureDiagnosticLocatorV2CoverageCounters,
  evaluateFigureDiagnosticLocatorV2Gates,
  formatFigureDiagnosticLocatorV2CoverageReport,
  formatFigureDiagnosticLocatorV2GateReport,
  verifySourceBlockIdentity,
} from './document-diagnostic-locator-authority-v1'
import { normalizeSourceAnchorText, stripBlockLevelMarkers, stripInlineResourceSyntax } from './document-diagnostic-location'

const OVERLAY_HOST = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'),
  'utf8',
)

// ── §6 — the canonical owning-block container ───────────────────────────────

describe('V2 §6 — canonical owning-block container', () => {
  it('classifies paragraph / list-item / blockquote (never by tag alone)', () => {
    expect(classifySourceBlockContainer('p')).toBe('paragraph')
    // a <p> INSIDE a <li> / <blockquote> is NOT the owning block
    expect(classifySourceBlockContainer('p', true, false)).toBe('list-item')
    expect(classifySourceBlockContainer('p', false, true)).toBe('blockquote')
    expect(classifySourceBlockContainer('li')).toBe('list-item')
    expect(classifySourceBlockContainer('blockquote')).toBe('blockquote')
    expect(classifySourceBlockContainer('table')).toBe('other')
  })

  it('§7/§10 — an image contributes NO visible text, a link keeps its label', () => {
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('![图](x.png)'))).toBe('')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('[文字](y.md)'))).toBe('文字')
    // the exact V2.2 §36 table
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('before ![B](x.png)'))).toBe('before')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('![C](x.png) after'))).toBe('after')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('before ![D](x.png) after'))).toBe('before after')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('![E1](x.png) ![E2](x.png)'))).toBe('')
  })

  it('§7/§10 — the ALT TEXT is never used as a block-visible signature', () => {
    // `before ![B](x)` must not project to `before B`
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('before ![B](x.png)'))).not.toContain('B')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax('![合法独立图片](x.png)'))).toBe('')
  })

  it('§9 — one normalizer: NBSP and zero-width chars collapse on BOTH sides', () => {
    expect(normalizeSourceAnchorText('before\u00A0after')).toBe('before after')
    expect(normalizeSourceAnchorText('before\u200B after')).toBe('before after')
    expect(normalizeSourceAnchorText('  a\r\nb  ')).toBe('a b')
  })

  it('§6 — block-level markers are stripped so a container block can be signed', () => {
    // Without marker stripping the needle is a bare `>` / `-` and binds nothing.
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers('> ![J](a.png)')))).toBe('')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers('- ![I](a.png)')))).toBe('')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers('* ![I](a.png)')))).toBe('')
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers('1. ![I](a.png)')))).toBe('')
    // a mixed container block keeps its visible text
    expect(normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers('> before ![J](a.png)')))).toBe('before')
    // and the raw (unstripped) form is what used to be the only needle
    expect(normalizeSourceAnchorText(stripBlockLevelMarkers('> ![J](a.png)'))).toBe('![J](a.png)')
  })
})

// ── §11/§27 — the case classes resolve to the right binding tier ────────────

describe('V2.2 §11/§27 — case classification (text vs image-only)', () => {
  const FIXTURE = readFileSync(
    resolve(process.cwd(), 'test/vault/runtime/smoke/Figure-Standalone-Block-Invariant-Test.md'),
    'utf8',
  )
  const FIXTURE_LINES = FIXTURE.split(/\r?\n/)
  const needleOf = (lineNo: number): string =>
    normalizeSourceAnchorText(stripInlineResourceSyntax(stripBlockLevelMarkers(FIXTURE_LINES[lineNo - 1])))

  it('B/C/D/F keep a real visible text needle and never duplicate each other', () => {
    expect(needleOf(11)).toBe('before')        // Case B
    expect(needleOf(15)).toBe('after')         // Case C
    expect(needleOf(19)).toBe('before after')  // Case D
    expect(needleOf(27)).toBe('before middle') // Case F
    const needles = [11, 15, 19, 27].map(needleOf)
    expect(needles.every(n => n !== '')).toBe(true)
    expect(new Set(needles).size).toBe(4)
  })

  it('§27 — E (image-only paragraph) has an EMPTY needle, not MISSING', () => {
    expect(needleOf(23)).toBe('') // Case E: `![E1](...) ![E2](...)`
  })

  it('§28/§29 — I (list item) and J (blockquote) also have EMPTY needles', () => {
    expect(needleOf(37)).toBe('') // Case I: `- ![I](...)`
    expect(needleOf(41)).toBe('') // Case J: `> ![J](...)`
  })

  it('the empty-needle class is resolved by the ordinal tier, not by a first-block fallback', () => {
    expect(OVERLAY_HOST).toContain('countPrecedingImageOnlyBlocks(')
    expect(OVERLAY_HOST).toContain("if (candidates.length === 0 && visibleNeedle === '')")
    expect(OVERLAY_HOST).toContain('stripBlockLevelMarkers')
  })
})

// ── §9/§10/§38 — the source-block semantic verifier ─────────────────────────

describe('V2 §9/§10/§38 — source-block semantic verification', () => {
  const exact = {
    expectedSourceBlockIdentity: 'src-block:10',
    expectedSourceStart: 218,
    expectedSourceEnd: 285,
    resolvedSourceBlockIdentity: 'src-block:10',
    resolvedSourceStart: 218,
    resolvedSourceEnd: 285,
    candidateCount: 1,
    targetVisible: true,
  }

  it('an exact binding PASSes', () => {
    const r = verifySourceBlockIdentity(exact)
    expect(r.semanticDecision).toBe('PASS')
    expect(r.identityMatch).toBe(true)
    expect(r.sourceSpanMatch).toBe(true)
    expect(r.reason).toBe('SOURCE_BLOCK_IDENTITY_OK')
  })

  it('zero candidate ⇒ FAIL (MISSING)', () => {
    const r = verifySourceBlockIdentity({ ...exact, candidateCount: 0, resolvedSourceBlockIdentity: null })
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.reason).toBe('SOURCE_BLOCK_BINDING_MISSING')
  })

  it('more than one candidate ⇒ FAIL (AMBIGUOUS) — never a first pick', () => {
    const r = verifySourceBlockIdentity({ ...exact, candidateCount: 2 })
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.reason).toBe('SOURCE_BLOCK_BINDING_AMBIGUOUS')
  })

  it('identity mismatch ⇒ FAIL', () => {
    const r = verifySourceBlockIdentity({ ...exact, resolvedSourceBlockIdentity: 'src-block:36' })
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.reason).toBe('SOURCE_BLOCK_IDENTITY_MISMATCH')
    expect(r.identityMatch).toBe(false)
  })

  it('§10 — a VISIBLE but WRONG block can never PASS', () => {
    const r = verifySourceBlockIdentity({
      ...exact,
      resolvedSourceBlockIdentity: 'src-block:99',
      targetVisible: true,
    })
    expect(r.visibilityDecision).toBe('PASS')
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.reason).toBe('SOURCE_BLOCK_IDENTITY_MISMATCH')
  })

  it('§38 — a fully-null resolved span can never PASS', () => {
    const r = verifySourceBlockIdentity({
      ...exact,
      resolvedSourceStart: null,
      resolvedSourceEnd: null,
    })
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.sourceSpanNullPass).toBe(false)
  })

  it('a resolved span that differs from the expected span ⇒ FAIL', () => {
    const r = verifySourceBlockIdentity({ ...exact, resolvedSourceStart: 900, resolvedSourceEnd: 999 })
    expect(r.semanticDecision).toBe('FAIL')
    expect(r.reason).toBe('SOURCE_BLOCK_SPAN_MISMATCH')
  })

  it('buildSourceBlockIdentity is the single `src-block:<line>` authority', () => {
    expect(buildSourceBlockIdentity(10)).toBe('src-block:10')
    expect(buildSourceBlockIdentity(-3)).toBe('src-block:0')
  })
})

// ── §17/§18 — locate vs cleanup vs final decision ───────────────────────────

describe('V2 §17/§18 — a clean cleanup never masks a locate failure', () => {
  it('locate FAIL + cleanup PASS ⇒ final FAIL', () => {
    const d = computeInteractionFinalDecision({ interactionClosureDecision: 'PASS', featureLocateDecision: 'FAIL' })
    expect(d.decision).toBe('FAIL')
    expect(d.reason).toBe('SEMANTIC_LOCATE_FAIL')
  })

  it('both PASS ⇒ final PASS', () => {
    expect(computeInteractionFinalDecision({ interactionClosureDecision: 'PASS', featureLocateDecision: 'PASS' }).decision).toBe('PASS')
  })

  it('interaction closure FAIL ⇒ final FAIL', () => {
    const d = computeInteractionFinalDecision({ interactionClosureDecision: 'FAIL', featureLocateDecision: 'PASS' })
    expect(d.decision).toBe('FAIL')
    expect(d.reason).toBe('INTERACTION_CLOSURE_FAIL')
  })

  it('the V1 feature decision already fails on a locate FAIL', () => {
    expect(computeFeatureLocateDecision('FAIL', 'PASS')).toBe('FAIL')
    expect(computeFeatureLocateDecision('PASS', 'FAIL')).toBe('FAIL')
    expect(computeFeatureLocateDecision('PASS', 'PASS')).toBe('PASS')
  })
})

// ── §19/§20/§34 — acceptance gate scope + reset ─────────────────────────────

describe('V2 §19/§20/§34 — acceptance counters are a resettable, separate scope', () => {
  it('the V2 gate table exposes every forbidden count (all 0 on a fresh scope)', () => {
    const counters = createFigureDiagnosticLocatorV2Counters()
    const report = formatFigureDiagnosticLocatorV2GateReport(counters)
    for (const key of FIGURE_DIAGNOSTIC_LOCATOR_V2_GATE_KEYS) {
      expect(report).toContain(`${FIGURE_DIAGNOSTIC_LOCATOR_V2_GATE_LABELS[key]}=0`)
    }
    expect(evaluateFigureDiagnosticLocatorV2Gates(counters).decision).toBe('PASS')
  })

  it('ANY non-zero counter fails the gate (a historical failure must be visible, not hidden)', () => {
    const counters = createFigureDiagnosticLocatorV2Counters()
    counters.structureVisibleOnlyFalsePass = 1
    const v = evaluateFigureDiagnosticLocatorV2Gates(counters)
    expect(v.decision).toBe('FAIL')
    expect(v.failedChecks).toContain('structureVisibleOnlyFalsePass')
  })

  it('a reset scope drops the previous failure (it is a SEPARATE scope, not hidden)', () => {
    const counters = createFigureDiagnosticLocatorV2Counters()
    counters.structureIdentityMismatchFalsePass = 3
    expect(evaluateFigureDiagnosticLocatorV2Gates(counters).decision).toBe('FAIL')
    const afterReset = createFigureDiagnosticLocatorV2Counters()
    expect(evaluateFigureDiagnosticLocatorV2Gates(afterReset).decision).toBe('PASS')
  })

  it('the per-container coverage table is separate and starts at 0', () => {
    const cov = createFigureDiagnosticLocatorV2CoverageCounters()
    const report = formatFigureDiagnosticLocatorV2CoverageReport(cov)
    expect(FIGURE_DIAGNOSTIC_LOCATOR_V2_COVERAGE_KEYS.length).toBe(3)
    for (const key of FIGURE_DIAGNOSTIC_LOCATOR_V2_COVERAGE_KEYS) expect(cov[key]).toBe(0)
    expect(report.join('|')).toContain('FIGURE_STRUCTURE_PARAGRAPH_BINDING_RUNTIME_COUNT=0')
    expect(report.join('|')).toContain('FIGURE_STRUCTURE_LIST_ITEM_BINDING_RUNTIME_COUNT=0')
    expect(report.join('|')).toContain('FIGURE_STRUCTURE_BLOCKQUOTE_BINDING_RUNTIME_COUNT=0')
  })
})

// ── §11/§36 — the host wiring contract ──────────────────────────────────────

describe('V2 §11/§36/§46 — single authority, no visible-only PASS in the host', () => {
  it('the host runs the ONE source-block semantic verifier and its own audit', () => {
    expect(OVERLAY_HOST).toContain('verifySourceBlockIdentity(')
    expect(OVERLAY_HOST).toContain('SOURCE_BLOCK_IDENTITY_AUDIT')
    expect(OVERLAY_HOST).toContain('semanticDecisionV2')
    expect(OVERLAY_HOST).toContain('sourceOccurrenceDecision: isSourceBlockV2 ? \'N/A\'')
  })

  it('the host merges the semantic locate outcome into the final decision', () => {
    expect(OVERLAY_HOST).toContain('computeInteractionFinalDecision(')
    expect(OVERLAY_HOST).toContain('interactionClosureDecisionV2')
    expect(OVERLAY_HOST).toContain('semanticLocateDecisionV2')
  })

  it('the host exposes an EXPLICIT acceptance-counter reset (§20)', () => {
    expect(OVERLAY_HOST).toContain('resetFigureDiagnosticLocatorAcceptanceCounters()')
  })

  it('a source-block semantic failure returns FAIL before any visual commit', () => {
    // V2.3 — the terminal guard now also fires when the binding provenance is
    // incomplete (`semanticDecision === 'FAIL' || !provenanceOk`).
    const idx = OVERLAY_HOST.indexOf("sourceBlockVerify.semanticDecision === 'FAIL' || !provenanceOk)")
    const commitIdx = OVERLAY_HOST.indexOf('const visualCommitted =')
    expect(idx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(idx)
  })

  it('V2.3 §36 — BOUND is coupled to a complete provenance record', () => {
    expect(OVERLAY_HOST).toContain("decision: candidateCount === 1 && provenanceComplete")
    expect(OVERLAY_HOST).toContain('const provenanceComplete = src.sourceBlockIdentity !== \'\'')
    expect(OVERLAY_HOST).toContain('if (isSourceBlockV2 && (sourceBlockVerify.semanticDecision === \'FAIL\' || !provenanceOk))')
  })

  it('V2.3.2 §1.3 — the factory enforces the CANONICAL owning DOM block', () => {
    expect(OVERLAY_HOST).toContain('CANONICAL OWNING DOM BLOCK AUTHORITY')
    expect(OVERLAY_HOST).toContain("sourceContainerKind === 'list-item'")
    expect(OVERLAY_HOST).toContain("el.closest('li') ?? el")
    expect(OVERLAY_HOST).toContain("el.closest('blockquote') ?? el")
    // the DOM-side identity/kind/tag must all be derived from the OWNER, never the inner <p>
    expect(OVERLAY_HOST).toContain('tag: ownerEl.tagName')
    expect(OVERLAY_HOST).toContain('domTag: ownerEl.tagName.toLowerCase()')
    expect(OVERLAY_HOST).toContain('this.sourceBlockContainerKindOf(ownerEl)')
  })

  it('V2.3.2 §1.3 — the image-only class is restricted to the expected container kind (fail-open otherwise)', () => {
    expect(OVERLAY_HOST).toContain("const restrictedKind = expectedKind === 'list-item' || expectedKind === 'blockquote' ? expectedKind : null")
    expect(OVERLAY_HOST).toContain('if (restrictedKind != null && ownedKind !== restrictedKind) continue')
    expect(OVERLAY_HOST).toContain("this.countPrecedingImageOnlyBlocks(input.startLine, restrictedKind ?? 'paragraph')")
  })

  it('V2.3.2 §1.3 — an empty image-only candidate set is never a silent MISSING', () => {
    expect(OVERLAY_HOST).toContain('imageOnlyDiagnostics')
    expect(OVERLAY_HOST).toContain('rawLineText,')
    expect(OVERLAY_HOST).toContain('candidateTags: imageOnly.map((el) => el.tagName.toLowerCase())')
  })

  it('V2.3.2 §1.3 — the DOM-side image-only test uses the SAME visible-semantic projection as the source side', () => {
    expect(OVERLAY_HOST).toContain('const domVisibleText = normalizeSourceAnchorText(stripInlineResourceSyntax(text))')
    expect(OVERLAY_HOST).toContain("if (domVisibleText !== '') continue")
  })

  it('V2.3.2 §19/§20 — the V2 acceptance surface is emitted with the closure audit', () => {
    expect(OVERLAY_HOST).toContain('figureLocatorV2GateReport: this.getFigureDiagnosticLocatorV2GateReport()')
    expect(OVERLAY_HOST).toContain('figureLocatorV2CoverageReport: this.getFigureDiagnosticLocatorV2CoverageReport()')
    expect(OVERLAY_HOST).toContain('figureLocatorV2GateDecision: this.getFigureDiagnosticLocatorV2GateDecision().decision')
  })

  it('the STRUCTURE_LOCATOR audit event name is stable', () => {
    expect(SOURCE_BLOCK_IDENTITY_AUDIT).toBe('SOURCE-BLOCK-IDENTITY-AUDIT')
  })
})

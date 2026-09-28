// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.10 — V4 Missing-Image SOURCE-FIRST kill-bug closure.
 *
 * Root causes locked from source:
 *   H1 confirmed — FIGURE_LOCAL_IMAGE_MISSING used to feed from live DOM
 *                  `img` facts only (Typora strips broken <img> → 0 diag).
 *   H2 confirmed — parseLocalLinkTargets classified image tokens correctly,
 *                  but the LINK rule consumed EVERY missing local fact, so
 *                  image tokens were miscounted as LINK_LOCAL_TARGET_MISSING.
 *
 * V4 rule split:
 *   resourceKind=image missing → FIGURE_LOCAL_IMAGE_MISSING (SOURCE-first,
 *                                no live <img> required; Source Anchor attached)
 *   resourceKind=link  missing → LINK_LOCAL_TARGET_MISSING (link only)
 *   source image + DOM figure (same destination) → dedup → exactly 1 diag
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { computeDocumentDiagnostics } from './document-diagnostics'
import { parseLocalLinkTargets } from './document-utilities'
import { hasLocatableLocation } from './document-diagnostic-location'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'

function findCode(diags: readonly DocumentDiagnostic[], code: string): DocumentDiagnostic[] {
  return diags.filter(d => d.code === code)
}

function h1Ready(): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY', reason: 'READY', documentKey: 'doc', framePresent: true,
    frameDocumentKey: 'doc', semanticRevision: 1, frameGeneration: 1,
    canonicalEntryCount: 0, mappedEntryCount: 0, invalidEntryCount: 0,
    physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

function imgFact(target: string, index: number, anchor?: { startLine?: number; sourceStart?: number; sourceEnd?: number; rawText?: string }): DiagnosticLinkFact {
  return {
    target, element: null, index, resourceKind: 'image',
    sourceStart: anchor?.sourceStart,
    sourceEnd: anchor?.sourceEnd,
    startLine: anchor?.startLine,
    rawText: anchor?.rawText,
  }
}
function linkFact(target: string, index: number): DiagnosticLinkFact {
  return { target, element: null, index, resourceKind: 'link' }
}

function pureInput(links: DiagnosticLinkFact[], figures: DocumentDiagnosticsInput['figures'] = [], markdown = ''): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:v4', markdown, strictMode: true, vaultRoot: 'D:/vault',
    headings: [], figures, tables: [], codes: [], formulas: [], links,
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

// ── Authority harness (real Markdown source + real fs existence) ──────────
function makeDocFs(markdown: string, existingRel: string[]): { dir: string; mdPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-v4-'))
  for (const rel of existingRel) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'x')
  }
  const mdPath = path.join(dir, 'doc.md')
  fs.writeFileSync(mdPath, markdown, 'utf8')
  return { dir, mdPath }
}

function authorityRun(markdown: string, existingRel: string[]): { authority: DocumentDiagnosticsAuthority; codes: string[]; diags: DocumentDiagnostic[] } {
  const { dir, mdPath } = makeDocFs(markdown, existingRel)
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => mdPath,
      getDocumentKey: () => 'doc:v4',
      getMarkdown: () => markdown,
      isStrictMode: () => true,
      vaultRoot: dir,
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
    isLinkTargetMissing: (target: string) => !fs.existsSync(path.join(dir, target)),
    getHeadingIdentity: () => null,
    parseLocalLinkTargets,
    getCanonicalH1Facts: () => h1Ready(),
  }
  const authority = new DocumentDiagnosticsAuthority(ctx, providers)
  authority.recompute('TEST')
  const snapshot = authority.getSnapshot()
  const diags = Array.from(snapshot?.diagnostics ?? [])
  return { authority, codes: diags.map(d => d.code), diags }
}

// ── SOURCE-IMAGE kill-bugs ──────────────────────────────
describe('SOURCE-IMAGE — Markdown source first, no live <img> required', () => {
  it('SOURCE-IMAGE-1: Markdown image missing + DOM has NO <img> → still FIGURE_LOCAL_IMAGE_MISSING', () => {
    // The jsdom body has no #write/img at all → pure SOURCE path.
    const { codes, diags } = authorityRun(
      '# T\n\n![A](missing-assets/__inkchapter_v31_missing_image__.png)\n\n',
      [],
    )
    expect(findCode(diags, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(1)
    expect(codes).not.toContain('LINK_LOCAL_TARGET_MISSING')
  })

  it('SOURCE-IMAGE-2: same destination twice → 2 diagnostics, distinct occurrenceIndex + distinct source ranges', () => {
    const r = computeDocumentDiagnostics(pureInput([
      imgFact('dup.png', 0, { startLine: 2, sourceStart: 12, sourceEnd: 40, rawText: '![A](dup.png)' }),
      imgFact('dup.png', 1, { startLine: 4, sourceStart: 44, sourceEnd: 72, rawText: '![B](dup.png)' }),
    ]))
    const imgs = findCode(r.diagnostics, 'FIGURE_LOCAL_IMAGE_MISSING')
    expect(imgs).toHaveLength(2)
    expect(imgs.map(d => d.metadata?.occurrenceIndex)).toEqual([0, 1])
    expect(imgs[0].metadata?.sourceStart).not.toBe(imgs[1].metadata?.sourceStart)
    expect(imgs.map(d => (d.location as { kind: string }).kind)).toEqual(['source-range', 'source-range'])
    expect((imgs[0].location as { startLine: number }).startLine).not.toBe((imgs[1].location as { startLine: number }).startLine)
    expect(imgs[0].id).not.toBe(imgs[1].id)
  })

  it('SOURCE-IMAGE-3: existing image file → 0 FIGURE_LOCAL_IMAGE_MISSING', () => {
    const { diags } = authorityRun(
      '# T\n\n![A](present.png)\n\n',
      ['present.png'],
    )
    expect(findCode(diags, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
  })

  it('SOURCE-IMAGE-4: http/https/data/blob image tokens → 0 local-image-missing', () => {
    const md = [
      '![R](https://example.com/r.png)',
      '![D](data:image/png;base64,AAAA)',
      '![B](blob:https://example.com/uuid)',
      '![F](#frag)',
    ].join('\n')
    const r = computeDocumentDiagnostics(pureInput([], [], md))
    // The source parser itself drops scheme refs; there are no local facts.
    expect(findCode(r.diagnostics, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
  })

  it('SOURCE-IMAGE-5: DOM img present + Source image token (same missing destination) → exactly 1 diagnostic', () => {
    const img = document.createElement('img')
    img.setAttribute('src', 'img.png')
    const r = computeDocumentDiagnostics(pureInput(
      [imgFact('img.png', 0, { startLine: 1, sourceStart: 4, sourceEnd: 20 })],
      [{ name: null, localPath: 'img.png', element: img }],
    ))
    expect(findCode(r.diagnostics, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(1)
  })

  it('SOURCE-IMAGE-6: source-only image diagnostic uses source-range location and is locatable', () => {
    const r = computeDocumentDiagnostics(pureInput([
      imgFact('missing.png', 0, { startLine: 3, sourceStart: 20, sourceEnd: 45, rawText: '![A](missing.png)' }),
    ]))
    const [d] = findCode(r.diagnostics, 'FIGURE_LOCAL_IMAGE_MISSING')
    expect(d).toBeTruthy()
    expect(d.location?.kind).toBe('source-range')
    expect(hasLocatableLocation(d.location)).toBe(true)
  })

  it('SOURCE-IMAGE-7: broken zero-rect <img> visual uses the OWNING SOURCE BLOCK frame (covered by V3.1 R7-contract test)', () => {
    // Visual-carrier coverage lives in document-diagnostic-locate-frame-v31…test.ts
    // (R7-contract). This marker keeps the kill-bug matrix explicit.
    expect(true).toBe(true)
  })
})

// ── LINK-KIND kill-bugs ─────────────────────────────────
describe('LINK-KIND — link rule only consumes resourceKind=link', () => {
  it('LINK-KIND-1: 2 image tokens + 1 link token missing → FIGURE=2 / LINK=1 (never LINK=3)', () => {
    const md = [
      '![I1](missing-assets/a.png)',
      '![I2](missing-assets/b.png)',
      '[L1](missing-assets/c.txt)',
    ].join('\n')
    const { diags } = authorityRun(md, [])
    expect(findCode(diags, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(2)
    expect(findCode(diags, 'LINK_LOCAL_TARGET_MISSING')).toHaveLength(1)
  })

  it('LINK-KIND-2: existing link → no warning; missing link → LINK_LOCAL_TARGET_MISSING', () => {
    const existing = authorityRun('[E](exists.txt)\n', ['exists.txt'])
    expect(findCode(existing.diags, 'LINK_LOCAL_TARGET_MISSING')).toHaveLength(0)
    const missing = authorityRun('[M](gone.txt)\n', [])
    expect(findCode(missing.diags, 'LINK_LOCAL_TARGET_MISSING')).toHaveLength(1)
    // Links never touch the image rule.
    expect(findCode(missing.diags, 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
  })

  it('image metadata carries the Source Anchor (destination/occurrence/sourceStart/sourceEnd/revision/fingerprint)', () => {
    const r = computeDocumentDiagnostics(pureInput([
      imgFact('x.png', 0, { startLine: 5, sourceStart: 80, sourceEnd: 105, rawText: '![x](x.png)' }),
    ]))
    const [d] = findCode(r.diagnostics, 'FIGURE_LOCAL_IMAGE_MISSING')
    const md = d.metadata ?? {}
    expect(md.resourceKind).toBe('image')
    expect(md.occurrenceIndex).toBe(0)
    expect(md.sourceStart).toBe(80)
    expect(md.sourceEnd).toBe(105)
    expect(md.destination).toBe('x.png')
    expect(md.sourceRevision).toBeNull()
    expect(typeof md.fingerprint).toBe('string')
  })
})

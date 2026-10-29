// @vitest-environment jsdom
/**
 * TRAE V5 §3/§4/§5/§16/§20 — Source-Syntax SOURCE-RANGE PROJECTION targeted tests.
 *
 *   L1–L3 producer emits `source-syntax-opener` with real offsets
 *   L4    the identity is the canonical openerIdentity (never the line)
 *   L5    canonical source-block index resolves the opener offset
 *   L6    a data-line MISS is never terminal (fast path returns verified:false)
 *   L7    stale source revision does not commit
 *   L8    an ambiguous data-line is an explicit miss (never a guess)
 *   L9    opener text compatibility (prefix, CRLF, wrong opener)
 *   L10   Drawer position metadata carries the REAL source position
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeDocumentDiagnostics,
  CODE_FENCE_UNCLOSED_CODE,
  FORMULA_BLOCK_UNCLOSED_CODE,
  FRONTMATTER_UNCLOSED_CODE,
} from './document-diagnostics'
import type { DocumentDiagnosticsInput, DocumentDiagnosticsComputed } from './document-diagnostics'
import { resetDocumentSourceSyntaxAuthority } from './document-source-syntax-authority'
import { resetDocumentDefinitionReferenceIndex } from './document-definition-reference-index'
import { resetDocumentInlineLinkAuthority } from './document-inline-link-authority'
import {
  tryDataLineFastPath,
  SOURCE_SYNTAX_LOCATE_AUDIT_EVENT,
  type SourceSyntaxLocateRequest,
  type SourceSyntaxLocateResult,
} from './document-diagnostic-source-syntax-location-authority'
import {
  computeCanonicalSourceBlocks,
  findCanonicalSourceBlockForOffset,
  openerTextCompatible,
  SOURCE_SYNTAX_PROJECTION_AUDIT_EVENT,
} from './document-diagnostic-source-range-projection-authority'
import {
  resolveDiagnosticLocation,
  getRuleMeta,
  type DiagnosticLocationResolveContext,
} from './document-diagnostic-location'
import {
  flattenDiagnosticsToProjections,
  documentPositionOf,
  DOCUMENT_POSITION_KEY_UNKNOWN,
} from './document-diagnostic-drawer-order-v514-r1'
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:ss',
    markdown: '',
    strictMode: false,
    vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    ...partial,
  }
}
const run = (markdown: string): DocumentDiagnosticsComputed => computeDocumentDiagnostics(input({ markdown }))
const findDiag = (r: DocumentDiagnosticsComputed, code: string): DocumentDiagnostic | undefined =>
  r.diagnostics.find(d => d.code === code)

beforeEach(() => {
  resetDocumentSourceSyntaxAuthority()
  resetDocumentDefinitionReferenceIndex()
  resetDocumentInlineLinkAuthority()
  document.body.innerHTML = ''
})

// ── L1–L3 producer ───────────────────────────────────────────

describe('TRAE V5 L1–L3 — producer source-syntax-opener location', () => {
  it('L1: CODE_FENCE_UNCLOSED carries real offsets + opener identity', () => {
    const loc = findDiag(run('正文\n\n```python\nprint("x")\n'), CODE_FENCE_UNCLOSED_CODE)!.location
    expect(loc!.kind).toBe('source-syntax-opener')
    if (loc!.kind !== 'source-syntax-opener') return
    expect(loc.syntaxKind).toBe('code-fence')
    expect(loc.sourceLine).toBe(2)
    expect(loc.openerText).toBe('```python')
    expect(loc.sourceStartOffset).toBe(4)
    expect(loc.sourceEndOffset).toBeGreaterThan(loc.sourceStartOffset)
    expect(loc.openerIdentity).toContain('fence:')
    expect(loc.presentationRange).toEqual({ start: loc.sourceStartOffset, end: loc.sourceEndOffset })
    expect(loc.protectedRange.end).toBeGreaterThan(loc.sourceEndOffset)
  })

  it('L2: FORMULA_BLOCK_UNCLOSED carries the `$$` token range', () => {
    const loc = findDiag(run('正文\n\n$$\nE=mc^2\n'), FORMULA_BLOCK_UNCLOSED_CODE)!.location
    if (loc!.kind !== 'source-syntax-opener') throw new Error('expected opener')
    expect(loc.syntaxKind).toBe('formula-block')
    expect(loc.openerText).toBe('$$')
    expect(loc.sourceEndOffset - loc.sourceStartOffset).toBe(2)
  })

  it('L3: FRONTMATTER_UNCLOSED carries the `---` token range', () => {
    const loc = findDiag(run('---\ntitle: x\n\n# body\n'), FRONTMATTER_UNCLOSED_CODE)!.location
    if (loc!.kind !== 'source-syntax-opener') throw new Error('expected opener')
    expect(loc.syntaxKind).toBe('frontmatter')
    expect(loc.sourceLine).toBe(0)
    expect(loc.openerText).toBe('---')
    expect(loc.sourceStartOffset).toBe(0)
    expect(loc.sourceEndOffset).toBe(3)
  })

  it('L4: the identity is the canonical opener identity, never a bare line', () => {
    const d = findDiag(run('正文\n\n```python\nprint("x")\n'), CODE_FENCE_UNCLOSED_CODE)!
    const loc = d.location
    if (loc!.kind !== 'source-syntax-opener') throw new Error('expected opener')
    expect(d.stableIdentity).toContain(loc.openerIdentity)
    expect(d.stableIdentity).not.toMatch(/:line:/)
    expect(loc.openerIdentity).not.toContain('line')
  })
})

// ── L5–L6 canonical projection ───────────────────────────────

describe('TRAE V5 L5–L6 — canonical source-range projection', () => {
  it('L5: the canonical source block containing the opener offset is found', () => {
    const md = '# T\n\n正文\n\n```python\nprint("x")\n'
    const blocks = computeCanonicalSourceBlocks(md)
    const offset = md.indexOf('```python')
    const block = findCanonicalSourceBlockForOffset(blocks, offset)
    expect(block).toBeTruthy()
    expect(block!.startOffset).toBeLessThanOrEqual(offset)
    expect(block!.endOffset).toBeGreaterThanOrEqual(offset)
    expect(block!.identity).toMatch(/^src-block:\d+$/)
    expect(md.slice(block!.startOffset, block!.endOffset)).toContain('```python')
  })

  it('L6: a data-line MISS is never terminal — the fast path reports verified:false', () => {
    const request: SourceSyntaxLocateRequest = {
      documentKey: 'doc:ss', sourceRevision: 1, syntaxKind: 'code-fence', sourceLine: 16,
      openerIdentity: 'doc.md:fence:`:221', openerText: '```', sourceStartOffset: 221, sourceEndOffset: 224,
    }
    // No element claims line 16 → the fast path is a MISS (verified:false).
    const root = document.createElement('div'); document.body.appendChild(root)
    const fast = tryDataLineFastPath(request, {
      documentKey: 'doc:ss',
      resolveSourceLine: (line) => root.querySelector(`[data-line="${line}"]`),
      countSourceLineMatches: () => 0,
    })
    expect(fast.verified).toBe(false)
    expect(fast.strategy).toBe('data-line-miss')
    expect(fast.element).toBeNull()
    // The canonical projection still resolves the block from the SAME offsets.
    const md = '# x\n\n（一段前置内容，让 opener 落在一个真实 block 中）\n\n```\n\n'
    const blocks = computeCanonicalSourceBlocks(md)
    const off = md.indexOf('```')
    expect(findCanonicalSourceBlockForOffset(blocks, off)).toBeTruthy()
  })

  it('L9: opener text compatibility is a prefix check (CRLF tolerant)', () => {
    expect(openerTextCompatible('```python\r\nx', 0, 9, '```')).toBe(true)
    expect(openerTextCompatible('$$', 0, 2, '$$')).toBe(true)
    expect(openerTextCompatible('---', 0, 3, '---')).toBe(true)
    expect(openerTextCompatible('plain text', 0, 10, '```')).toBe(false)
  })

  it('L-AUDIT: projection + locate audit event names are the formal ones', () => {
    expect(SOURCE_SYNTAX_PROJECTION_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-PROJECTION-AUDIT')
    expect(SOURCE_SYNTAX_LOCATE_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-LOCATE-AUDIT')
  })
})

// ── L7–L8 resolver branch ────────────────────────────────────

function openerLocation(sourceLine: number, sourceRevision: number | null = null): DiagnosticLocation {
  return {
    kind: 'source-syntax-opener',
    syntaxKind: 'code-fence',
    sourceLine,
    sourceStartOffset: 10,
    sourceEndOffset: 13,
    openerText: '```',
    openerIdentity: 'doc:ss:fence:`:10',
    sourceRevision,
    protectedRange: { start: 10, end: 40 },
    presentationRange: { start: 10, end: 13 },
  }
}

function makeDiag(location: DiagnosticLocation): DocumentDiagnostic {
  return {
    id: 'd1', documentKey: 'doc:ss', severity: 'error', category: 'code',
    code: CODE_FENCE_UNCLOSED_CODE, message: 'x', location,
  } as unknown as DocumentDiagnostic
}

function makeCtx(hook: (r: SourceSyntaxLocateRequest) => SourceSyntaxLocateResult | null): DiagnosticLocationResolveContext {
  return {
    documentKey: 'doc:ss',
    getRoot: () => document.body,
    resolveHeadingIdentity: () => null,
    resolveSourceLine: () => null,
    resolveBlockIdentity: () => null,
    resolveSourceSyntaxOpener: hook,
  }
}

describe('TRAE V5 L7–L8 — resolver branch decisions', () => {
  it('L7: a stale source revision becomes TARGET_CHANGED (never a commit)', () => {
    const ctx = makeCtx(() => ({
      decision: 'SOURCE_REVISION_STALE', targetKind: null, primaryElement: null,
      strategy: 'source-revision-stale', candidateCount: 0, sourceBlockIdentity: null,
      openerOnlyBlock: false, presentationOpenerText: null,
    }))
    const res = resolveDiagnosticLocation(makeDiag(openerLocation(16, 1)), openerLocation(16, 1), ctx, 0)
    expect(res.decision).toBe('TARGET_CHANGED')
    expect(res.element).toBeNull()
  })

  it('L8: an ambiguous projection is UNRESOLVED (never a guess)', () => {
    const ctx = makeCtx(() => ({
      decision: 'AMBIGUOUS', targetKind: null, primaryElement: null,
      strategy: 'dom-binding-ambiguous', candidateCount: 2, sourceBlockIdentity: null,
      openerOnlyBlock: false, presentationOpenerText: null,
    }))
    const res = resolveDiagnosticLocation(makeDiag(openerLocation(16)), openerLocation(16), ctx, 0)
    expect(res.decision).toBe('UNRESOLVED')
    expect(res.element).toBeNull()
  })

  it('L-RESOLVED: a canonical projection resolves to the bound element', () => {
    const el = document.createElement('p')
    el.className = 'md-p'
    el.textContent = '```'
    document.body.appendChild(el)
    const ctx = makeCtx(() => ({
      decision: 'RESOLVED', targetKind: 'source-syntax-opener', primaryElement: el,
      strategy: 'CANONICAL_SOURCE_BLOCK_BINDING', candidateCount: 1,
      sourceBlockIdentity: 'src-block:16', openerOnlyBlock: true, presentationOpenerText: '```',
    }))
    const res = resolveDiagnosticLocation(makeDiag(openerLocation(16)), openerLocation(16), ctx, 0)
    expect(res.decision).toBe('RESOLVED')
    expect(res.element).toBe(el)
    expect(res.primaryAnchor).toBe('source-syntax-opener')
  })
})

// ── L10 Drawer position / registry ───────────────────────────

describe('TRAE V5 L10 + §11 — Drawer position metadata + registry', () => {
  it('L10: the source-syntax projection carries real offsets + opener identity (no 1e10)', () => {
    const r = run('正文\n\n```python\nprint("x")\n')
    const projections = flattenDiagnosticsToProjections(r.diagnostics)
    const p = projections.find(x => x.ruleId === CODE_FENCE_UNCLOSED_CODE)
    expect(p).toBeTruthy()
    expect(p!.sourceStartOffset).not.toBeNull()
    expect(p!.stableIdentity).not.toBe('')
    expect(p!.stableIdentity).toContain('fence:')
    expect(p!.sourceLine).not.toBeNull()
    expect(documentPositionOf(p!).key).not.toBe(DOCUMENT_POSITION_KEY_UNKNOWN)
  })

  it('§11: all three register source-syntax opener metadata', () => {
    for (const code of [CODE_FENCE_UNCLOSED_CODE, FORMULA_BLOCK_UNCLOSED_CODE, FRONTMATTER_UNCLOSED_CODE]) {
      const meta = getRuleMeta(code)
      expect(meta, code).toBeTruthy()
      expect(meta!.locationStrategy, code).toBe('source-syntax-opener')
      expect(meta!.presentationKind, code).toBe('source-syntax-error')
      expect(meta!.interactionMode, code).toBe('SINGLE_TARGET')
      expect(meta!.internalSeverity, code).toBe('error')
    }
  })
})

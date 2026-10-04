// @vitest-environment jsdom
/**
 * TRAE V4 §27/§28/§29 — Source-Syntax PRESENTATION / INTERACTION / DYNAMIC
 * REFRESH targeted tests.
 *
 *   P1–P5 visual contract / ranges
 *   P6–P8 visual failure → NO_COMMIT
 *   I1–I4 visual-commit-driven active (no fake active, no second click)
 *   D1–D5 dynamic close/open refresh (event-driven recompute)
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
  SOURCE_SYNTAX_PRESENTATION_KIND,
  SOURCE_SYNTAX_SEVERITY_TOKEN,
  SOURCE_SYNTAX_VISUAL_AUDIT_EVENT,
  evaluateSourceSyntaxVisualCommit,
  buildSourceSyntaxVisualAudit,
  type SourceSyntaxVisualFacts,
} from './document-diagnostic-source-syntax-presentation-authority'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:ss2',
    markdown: '',
    strictMode: false,
    vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    ...partial,
  }
}
const run = (markdown: string): DocumentDiagnosticsComputed => computeDocumentDiagnostics(input({ markdown }))
const codes = (r: DocumentDiagnosticsComputed): string[] => r.diagnostics.map(d => d.code)

beforeEach(() => {
  resetDocumentSourceSyntaxAuthority()
  resetDocumentDefinitionReferenceIndex()
  resetDocumentInlineLinkAuthority()
})

function committedFacts(over: Partial<SourceSyntaxVisualFacts> = {}): SourceSyntaxVisualFacts {
  return {
    syntaxKind: 'code-fence',
    ruleId: 'CODE_FENCE_UNCLOSED',
    severity: 'error',
    anchorResolved: true,
    sourceRevisionCurrent: true,
    carrierConnected: true,
    visualFragmentCount: 1,
    paintedPrimaryRect: true,
    accentPresent: true,
    fillVisible: true,
    ...over,
  }
}

describe('TRAE V4 P1–P5 — source-syntax visual contract', () => {
  it('P1: a fully resolved opener commits with >=1 visual fragment', () => {
    const v = evaluateSourceSyntaxVisualCommit(committedFacts())
    expect(v.commitDecision).toBe('COMMIT')
    expect(v.terminalState).toBe('COMMITTED')
    expect(v.reasons).toEqual([])
  })

  it('P2/P3/P4: painted rect + connected carrier + EXISTING error token', () => {
    expect(SOURCE_SYNTAX_PRESENTATION_KIND).toBe('source-syntax-error')
    expect(SOURCE_SYNTAX_SEVERITY_TOKEN).toBe('error')
    const audit = buildSourceSyntaxVisualAudit(committedFacts(), evaluateSourceSyntaxVisualCommit(committedFacts()), CODE_FENCE_UNCLOSED_CODE)
    expect(audit.presentationKind).toBe('source-syntax-error')
    expect(audit.severity).toBe('error')
    expect(audit.paintedPrimaryRect).toBe(true)
    expect(audit.carrierConnected).toBe(true)
    expect(SOURCE_SYNTAX_VISUAL_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-VISUAL-AUDIT')
  })

  it('P5: the presentation range never extends behind the opener token (opener→EOF is forbidden)', () => {
    const r = run('正文\n\n```python\nprint("x")\nprint("y")\n')
    const loc = r.diagnostics.find(d => d.code === CODE_FENCE_UNCLOSED_CODE)!.location
    if (loc!.kind !== 'source-syntax-opener') throw new Error('expected opener')
    expect(loc.presentationRange.end).toBeLessThan(loc.protectedRange.end)
    expect(loc.presentationRange.end).toBe(loc.sourceEndOffset)
  })
})

describe('TRAE V4 P6–P8 — visual failure is an explicit NO_COMMIT', () => {
  it('P6: unresolved anchor → NO_COMMIT', () => {
    const v = evaluateSourceSyntaxVisualCommit(committedFacts({ anchorResolved: false }))
    expect(v.commitDecision).toBe('NO_COMMIT')
    expect(v.terminalState).toBe('FAILED')
  })

  it('P7: zero painted fragment / rect → NO_COMMIT', () => {
    expect(evaluateSourceSyntaxVisualCommit(committedFacts({ visualFragmentCount: 0 })).commitDecision).toBe('NO_COMMIT')
    expect(evaluateSourceSyntaxVisualCommit(committedFacts({ paintedPrimaryRect: false })).commitDecision).toBe('NO_COMMIT')
  })

  it('P8: a disconnected carrier → NO_COMMIT', () => {
    const v = evaluateSourceSyntaxVisualCommit(committedFacts({ carrierConnected: false }))
    expect(v.commitDecision).toBe('NO_COMMIT')
    expect(v.reasons).toContain('CARRIER_DISCONNECTED')
  })
})

describe('TRAE V4 I1–I4 — visual-commit-driven active', () => {
  it('I1/I2: a committed verdict is COMMITTED in ONE pass (no second-click state)', () => {
    const v = evaluateSourceSyntaxVisualCommit(committedFacts())
    expect(v.terminalState).toBe('COMMITTED')
    expect(v.commitDecision).toBe('COMMIT')
  })

  it('I3/I4: any missing visual proof forces FAILED (the Drawer must stay non-active)', () => {
    const failures: Array<Partial<SourceSyntaxVisualFacts>> = [
      { anchorResolved: false },
      { sourceRevisionCurrent: false },
      { carrierConnected: false },
      { visualFragmentCount: 0 },
      { paintedPrimaryRect: false },
      { accentPresent: false },
      { fillVisible: false },
    ]
    for (const f of failures) {
      const v = evaluateSourceSyntaxVisualCommit(committedFacts(f))
      expect(v.commitDecision, JSON.stringify(f)).toBe('NO_COMMIT')
      expect(v.terminalState, JSON.stringify(f)).toBe('FAILED')
    }
  })
})

describe('TRAE V4 D1–D5 — dynamic close/open refresh is event-driven', () => {
  it('D1/D2: closing the code fence removes the diagnostic; removing the close brings it back', () => {
    const open = run('正文\n\n```js\nconst a = 1\n')
    expect(codes(open)).toContain(CODE_FENCE_UNCLOSED_CODE)
    const closed = run('正文\n\n```js\nconst a = 1\n```\n')
    expect(codes(closed)).not.toContain(CODE_FENCE_UNCLOSED_CODE)
    const reopened = run('正文\n\n```js\nconst a = 1\n')
    expect(codes(reopened)).toContain(CODE_FENCE_UNCLOSED_CODE)
  })

  it('D3/D4: closing the formula removes the diagnostic; removing the close brings it back', () => {
    expect(codes(run('正文\n\n$$\nE=mc^2\n'))).toContain(FORMULA_BLOCK_UNCLOSED_CODE)
    expect(codes(run('正文\n\n$$\nE=mc^2\n$$\n'))).not.toContain(FORMULA_BLOCK_UNCLOSED_CODE)
    expect(codes(run('正文\n\n$$\nE=mc^2\n'))).toContain(FORMULA_BLOCK_UNCLOSED_CODE)
  })

  it('D5: closing the front matter removes FRONTMATTER_UNCLOSED', () => {
    expect(codes(run('---\ntitle: x\n\n# body\n'))).toContain(FRONTMATTER_UNCLOSED_CODE)
    expect(codes(run('---\ntitle: x\n---\n\n# body\n'))).not.toContain(FRONTMATTER_UNCLOSED_CODE)
  })
})

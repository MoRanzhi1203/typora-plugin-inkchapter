// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { analyzeInternalBlankLineGaps } from './document-diagnostic-internal-blank-lines-v1'
import {
  applyPatchesToMarkdown,
  CODE_LANGUAGE_FIX,
  CODE_NAME_FIX,
  createDefaultDiagnosticFixRegistry,
  FIGURE_NAME_FIX,
  planAllAutoFixes,
  planDiagnosticFix,
  planManyFixes,
  TABLE_NAME_FIX,
  TRAILING_BLANK_LINES_FIX,
  createUnavailableFixTransactionAdapter,
  verifyFixOutcome,
  type FixContext,
} from './document-diagnostic-fix-v1'

const registry = createDefaultDiagnosticFixRegistry()

function diag(
  code: string,
  metadata: Record<string, unknown> = {},
  location?: DocumentDiagnostic['location'],
  id = `${code}:1`,
): DocumentDiagnostic {
  return {
    id,
    documentKey: 'doc:fix',
    severity: 'warning',
    category: 'document',
    code,
    message: code,
    detail: '',
    metadata,
    ...(location ? { location } : {}),
  }
}

function snapshot(diagnostics: readonly DocumentDiagnostic[]): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:fix',
    revision: 7,
    sourceRevision: 1,
    generatedAt: 1,
    diagnostics,
    errorCount: 0,
    warningCount: diagnostics.length,
    infoCount: 0,
    structuralVerified: true,
  }
}

function ctx(markdown: string, diagnostics: readonly DocumentDiagnostic[], overrides: Partial<FixContext> = {}): FixContext {
  return {
    markdown,
    snapshotMarkdown: markdown,
    documentKey: 'doc:fix',
    snapshot: snapshot(diagnostics),
    locked: false,
    ...overrides,
  }
}

const internalLocation = (startLine: number) => ({
  kind: 'source-range' as const,
  startLine,
  startColumn: 0,
  sourceFingerprint: 'internal',
  rawText: '',
})

describe('fix planner V1 — internal blank lines', () => {
  it('compresses 4 blank lines to the policy allowance (1) and removes the diagnostic', () => {
    const markdown = '# H1\n\n\n\n\nBody\n'
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 1, lastBlankLine: 4, actualBlankLines: 4, passMaxBlankLines: 1,
    }, internalLocation(3))
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(plan.support).toBe('AUTO')
    expect(plan.blockers).toEqual([])
    const fixed = applyPatchesToMarkdown(markdown, plan.patches)
    expect(fixed).toBe('# H1\n\nBody\n')
    expect(analyzeInternalBlankLineGaps(fixed)).toHaveLength(0)
  })

  it('preserves CRLF and one blank line', () => {
    const markdown = '# H1\r\n\r\n\r\n\r\n\r\nBody\r\n'
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 1, lastBlankLine: 4, actualBlankLines: 4, passMaxBlankLines: 1,
    }, internalLocation(3))
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# H1\r\n\r\nBody\r\n')
  })

  it('refuses blank lines inside a fenced block (defense in depth)', () => {
    const markdown = '```\n\n\n\ntext\n```\n'
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 1, lastBlankLine: 3, actualBlankLines: 3, passMaxBlankLines: 1,
    }, internalLocation(2))
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map(b => b.code)).toContain('INVALID_FACT')
  })

  it('does not treat leading/trailing gaps as internal', () => {
    const markdown = '\n\n\nBody\n'
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 0, lastBlankLine: 2, actualBlankLines: 3, passMaxBlankLines: 1,
    }, internalLocation(0))
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(false)
  })
})

describe('fix planner V1 — trailing blank lines', () => {
  it('keeps exactly one terminal newline', () => {
    const markdown = '# H1\n\n\n'
    const d = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 2 })
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# H1\n')
  })

  it('preserves CRLF and refuses a normal single newline', () => {
    const crlf = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 2 })
    const plan = planDiagnosticFix(registry, crlf.id, ctx('# H1\r\n\r\n\r\n', [crlf]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown('# H1\r\n\r\n\r\n', plan.patches)).toBe('# H1\r\n')

    const normal = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 1 })
    const p2 = planDiagnosticFix(registry, normal.id, ctx('# H1\n', [normal]))
    expect(p2.ok).toBe(false)
    expect(p2.blockers.map(b => b.code)).toContain('NOT_APPLICABLE')
  })
})

describe('fix planner V1 — code language / figure name', () => {
  it('inserts a requested language into the correct fence ordinal', () => {
    const markdown = '```\na\n```\n\n```js\nb\n```\n'
    const d = diag('CODE_MISSING_LANGUAGE', {}, {
      kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0',
    })
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d], { input: { language: 'ts' } }))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toContain('```ts\na\n```')
  })

  it('requires a legal language and rejects an already-labelled fence', () => {
    const markdown = '```js\nb\n```\n'
    const d = diag('CODE_MISSING_LANGUAGE', {}, {
      kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0',
    })
    const missing = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(missing.blockers.map(b => b.code)).toContain('REQUIRES_INPUT')
    const invalid = planDiagnosticFix(registry, d.id, ctx(markdown, [d], { input: { language: 'bad lang' } }))
    expect(invalid.ok).toBe(false)
    const labelled = planDiagnosticFix(registry, d.id, ctx(markdown, [d], { input: { language: 'ts' } }))
    expect(labelled.blockers.map(b => b.code)).toContain('NOT_APPLICABLE')
  })

  it('inserts a user-provided figure alt text only after explicit input', () => {
    const markdown = '![](a.png)\n'
    const d = diag('FIGURE_MISSING_NAME', { tokenStart: 0, rawToken: '![](a.png)', startLine: 0, endLine: 0 })
    const missing = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(missing.blockers.map(b => b.code)).toContain('REQUIRES_INPUT')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d], { input: { name: '架构图' } }))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('![架构图](a.png)\n')
  })

  it('does not invent code/table caption names', () => {
    for (const fixer of [CODE_NAME_FIX, TABLE_NAME_FIX]) {
      expect(fixer.support).toBe('MANUAL')
      const d = diag(fixer.code)
      const plan = planDiagnosticFix(registry, d.id, ctx('x\n', [d], { input: { name: 'x' } }))
      expect(plan.ok).toBe(false)
      expect(plan.blockers.map(b => b.code)).toContain('CAPTION_NAME_SERVICE_REQUIRED')
    }
  })
})

describe('fix planner V1 — stale / lock / conflicts', () => {
  const markdown = '# H1\n\n\n\nBody\n'
  const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
    firstBlankLine: 1, lastBlankLine: 3, actualBlankLines: 3, passMaxBlankLines: 1,
  }, internalLocation(3))

  it('blocks locked documents', () => {
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d], { locked: true }))
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map(b => b.code)).toContain('DOCUMENT_LOCKED')
  })

  it('blocks stale source, document and revision', () => {
    expect(planDiagnosticFix(registry, d.id, ctx(markdown, [d], { snapshotMarkdown: 'changed' })).blockers.map(b => b.code))
      .toContain('STALE_SOURCE')
    expect(planDiagnosticFix(registry, d.id, ctx(markdown, [d], { documentKey: 'other' })).blockers.map(b => b.code))
      .toContain('STALE_DOCUMENT')
    expect(planDiagnosticFix(registry, d.id, ctx(markdown, [d], { expectedRevision: 6 })).blockers.map(b => b.code))
      .toContain('STALE_SOURCE')
  })

  it('blocks a diagnostic that is no longer in the snapshot', () => {
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, []))
    expect(plan.blockers.map(b => b.code)).toContain('STALE_DIAGNOSTIC')
  })

  it('detects overlapping patches in a batch', () => {
    const d2 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 1, lastBlankLine: 3, actualBlankLines: 3, passMaxBlankLines: 1,
    }, internalLocation(3), 'EXCESSIVE_INTERNAL_BLANK_LINES:2')
    const plans = planManyFixes(registry, [d.id, d2.id], ctx(markdown, [d, d2]))
    expect(plans[0].ok).toBe(true)
    expect(plans[1].ok).toBe(false)
    expect(plans[1].blockers.map(b => b.code)).toContain('PATCH_CONFLICT')
  })

  it('plans all AUTO fixes but never applies without a transaction', () => {
    const trailing = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 2 }, undefined, 'trailing')
    const md = '# H1\n\n\n\nBody\n\n\n'
    const plans = planAllAutoFixes(registry, ctx(md, [d, trailing]))
    expect(plans).toHaveLength(2)
    expect(plans.every(p => p.ok)).toBe(true)
    expect(plans.every(p => p.applySupported === false)).toBe(true)
    expect(plans.every(p => p.applyBlockedReason === 'TRANSACTION_AUTHORITY_UNVERIFIED')).toBe(true)
  })

  it('verifies the NEW snapshot, not the patch alone, and reports introduced diagnostics', () => {
    const before = snapshot([d])
    const after = snapshot([
      diag('HEADING_LEVEL_GAP', {}, undefined, 'HEADING_LEVEL_GAP:new'),
    ])
    const result = verifyFixOutcome(d.id, before, after)
    expect(result.cleared).toBe(true)
    expect(result.introducedIds).toEqual(['HEADING_LEVEL_GAP:new'])
    expect(result.remainingCount).toBe(1)
  })

  it('the production transaction adapter is hard-blocked', async () => {
    const adapter = createUnavailableFixTransactionAdapter()
    expect(adapter.available).toBe(false)
    await expect(adapter.apply({ markdown: '', patches: [], expectedMarkdownHash: 'x' }))
      .resolves.toEqual({ ok: false, reason: 'TRANSACTION_AUTHORITY_UNVERIFIED' })
  })
})

describe('fix planner V1 — document-start / terminal-newline blank rules', () => {
  it('leading blank lines are removed to zero and keep the first content line', () => {
    const markdown = '\n\n\n# 标题\n\n正文\n'
    const d = diag('DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE', { leadingBlankLineCount: 3 }, undefined, 'leading')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(plan.support).toBe('AUTO')
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# 标题\n\n正文\n')
  })

  it('preserves CRLF when deleting the leading run', () => {
    const markdown = '\r\n\r\n# 标题\r\n'
    const d = diag('DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE', { leadingBlankLineCount: 2 }, undefined, 'leading-crlf')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# 标题\r\n')
  })

  it('never deletes a content line even when the fact is stale', () => {
    const markdown = '正文\n\n\n尾\n'
    const d = diag('DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE', { leadingBlankLineCount: 2 }, undefined, 'leading-stale')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map(b => b.code)).toContain('INVALID_FACT')
  })

  it('appends exactly ONE terminal newline', () => {
    const markdown = '# H1\n\nBody'
    const d = diag('DOCUMENT_TERMINAL_NEWLINE_MISSING', {}, undefined, 'eof-missing')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(plan.support).toBe('AUTO')
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# H1\n\nBody\n')
  })

  it('is a no-op when the terminal newline already exists', () => {
    const markdown = '# H1\n'
    const d = diag('DOCUMENT_TERMINAL_NEWLINE_MISSING', {}, undefined, 'eof-present')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map(b => b.code)).toContain('NOT_APPLICABLE')
  })

  it('a trailing excess run still keeps exactly one terminal newline', () => {
    const markdown = '正文\n\n\n\n'
    const d = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 3 }, undefined, 'trailing-excess')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('正文\n')
  })
})

describe('fix planner V1 — invisible-only leading blanks', () => {
  it('removes leading lines holding only U+200B / U+00A0 (shared whitespace contract)', () => {
    const markdown = '\u200B\n\u00A0\n# 标题\n'
    const d = diag('DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE', { leadingBlankLineCount: 2 }, undefined, 'leading-invisible')
    const plan = planDiagnosticFix(registry, d.id, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# 标题\n')
  })
})

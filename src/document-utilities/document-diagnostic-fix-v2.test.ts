import { describe, expect, it } from 'vitest'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  buildFixedMarkdown,
  classifyFixOutcome,
  createEditorFixTransactionAdapter,
  describeFixCapability,
  formatFixOutcome,
  planAllAutoFixesV2,
  planDiagnosticFixV2,
  planFixesForRuleV2,
  selectNonConflictingPlans,
  type MarkdownEditPort,
} from './document-diagnostic-fix-v2'
import type { FixContext } from './document-diagnostic-fix-v1'
import { applyPatchesToMarkdown } from './document-diagnostic-fix-v1'

function diag(
  code: string,
  metadata: Record<string, unknown> = {},
  location?: DocumentDiagnostic['location'],
  id = `${code}:1`,
  targetIdentity?: string,
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
    ...(targetIdentity ? { targetIdentity } : {}),
    ...(location ? { location } : {}),
  }
}

function snapshot(diagnostics: readonly DocumentDiagnostic[], documentKey = 'doc:fix'): DocumentDiagnosticsSnapshot {
  return {
    documentKey,
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

const blankMeta = { firstBlankLine: 1, lastBlankLine: 4, actualBlankLines: 4, passMaxBlankLines: 1 }
const blankLocation = { kind: 'source-range' as const, startLine: 3, startColumn: 0 }

describe('fix capability matrix V2', () => {
  it('marks ONLY the two blank-line rules AUTO_SAFE', () => {
    expect(describeFixCapability('EXCESSIVE_INTERNAL_BLANK_LINES').capability).toBe('AUTO_SAFE')
    expect(describeFixCapability('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE').capability).toBe('AUTO_SAFE')
    for (const code of ['CODE_MISSING_LANGUAGE', 'FIGURE_MISSING_NAME', 'CODE_MISSING_NAME', 'TABLE_MISSING_NAME']) {
      expect(describeFixCapability(code).capability).toBe('USER_INPUT_REQUIRED')
    }
    expect(describeFixCapability('HEADING_LEVEL_GAP').capability).toBe('UNAVAILABLE')
  })

  it('downgrades caption rules to UNAVAILABLE when the caption service is absent', () => {
    expect(describeFixCapability('CODE_MISSING_NAME', false).capability).toBe('UNAVAILABLE')
    expect(describeFixCapability('TABLE_MISSING_NAME', false).capability).toBe('UNAVAILABLE')
    // Patch-based rules stay available (they need no caption service).
    expect(describeFixCapability('CODE_MISSING_LANGUAGE', false).capability).toBe('USER_INPUT_REQUIRED')
  })

  it('never invents an action for an unknown rule', () => {
    expect(describeFixCapability('SOMETHING_ELSE').actionKind).toBeNull()
  })
})

describe('planner V2 — auto-safe patches', () => {
  it('plans and applies the internal blank gap on the EXACT source range', () => {
    const markdown = '# H1\n\n\n\n\nBody\n'
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const plan = planDiagnosticFixV2(d, ctx(markdown, [d]))
    expect(plan.ok).toBe(true)
    expect(plan.capability).toBe('AUTO_SAFE')
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('# H1\n\nBody\n')
    expect(plan.preview?.hunks.length).toBeGreaterThan(0)
  })

  it('plans the trailing blank fix and rejects a single newline', () => {
    const d = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 2 })
    const plan = planDiagnosticFixV2(d, ctx('# H1\n\n\n', [d]))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown('# H1\n\n\n', plan.patches)).toBe('# H1\n')

    const normal = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 1 })
    const rejected = planDiagnosticFixV2(normal, ctx('# H1\n', [normal]))
    expect(rejected.ok).toBe(false)
  })

  it('refuses stale source / wrong document / locked documents', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const md = '# H1\n\n\n\n\nBody\n'
    expect(planDiagnosticFixV2(d, ctx(md, [d], { snapshotMarkdown: 'other' })).blockers.map(b => b.code))
      .toContain('STALE_SOURCE')
    expect(planDiagnosticFixV2(d, ctx(md, [d], { documentKey: 'other' })).blockers.map(b => b.code))
      .toContain('STALE_DOCUMENT')
    expect(planDiagnosticFixV2(d, ctx(md, [d], { locked: true })).blockers.map(b => b.code))
      .toContain('DOCUMENT_LOCKED')
  })

  it('only AUTO rules are planned by planAllAutoFixesV2', () => {
    const blank = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation, 'b1')
    const lang = diag('CODE_MISSING_LANGUAGE', {}, { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }, 'l1')
    const plans = planAllAutoFixesV2(ctx('# H1\n\n\n\n\n```\na\n```\n', [blank, lang]))
    expect(plans).toHaveLength(1)
    expect(plans[0].code).toBe('EXCESSIVE_INTERNAL_BLANK_LINES')
  })
})

describe('planner V2 — user-input fixes', () => {
  it('requires an explicit language and then patches ONLY the fence info', () => {
    const markdown = '```\na\n```\n'
    const d = diag('CODE_MISSING_LANGUAGE', {}, { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
    const missing = planDiagnosticFixV2(d, ctx(markdown, [d]))
    expect(missing.ok).toBe(false)
    expect(missing.blockers.map(b => b.code)).toContain('REQUIRES_INPUT')

    const plan = planDiagnosticFixV2(d, ctx(markdown, [d], { input: { language: 'ts' } }))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('```ts\na\n```\n')
  })

  it('requires an explicit figure name and patches only the alt text', () => {
    const markdown = 'before\n\n![](a.png)\n'
    const d = diag('FIGURE_MISSING_NAME', { tokenStart: 8, rawToken: '![](a.png)', startLine: 2, endLine: 2 })
    const plan = planDiagnosticFixV2(d, ctx(markdown, [d], { input: { name: '架构图' } }))
    expect(plan.ok).toBe(true)
    expect(applyPatchesToMarkdown(markdown, plan.patches)).toBe('before\n\n![架构图](a.png)\n')
  })

  it('routes code / table names to the caption service with a canonical identity', () => {
    const code = diag('CODE_MISSING_NAME', {}, undefined, 'c1', 'block:code:2')
    const codePlan = planDiagnosticFixV2(code, ctx('x\n', [code], { input: { name: '初始化流程' } }))
    expect(codePlan.ok).toBe(true)
    expect(codePlan.captionName).toEqual({ targetKind: 'code', targetIdentity: 'block:code:2' })
    expect(codePlan.patches).toHaveLength(0)

    const table = diag('TABLE_MISSING_NAME', {}, undefined, 't1', 'block:table:0')
    const tablePlan = planDiagnosticFixV2(table, ctx('x\n', [table], { input: { name: '接口表' } }))
    expect(tablePlan.captionName).toEqual({ targetKind: 'table', targetIdentity: 'block:table:0' })

    const invalid = diag('TABLE_MISSING_NAME', {}, undefined, 't2', 'local:not-a-block')
    const invalidPlan = planDiagnosticFixV2(invalid, ctx('x\n', [invalid], { input: { name: 'x' } }))
    expect(invalidPlan.ok).toBe(false)
    expect(invalidPlan.blockers.map(b => b.code)).toContain('INVALID_FACT')
  })

  it('plans every instance of ONE rule (同类修复)', () => {
    const md = '# A\n\n\n\n\nB\n\n\n\nC\n'
    const d1 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation, 'b1')
    const d2 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 6, lastBlankLine: 8, actualBlankLines: 3, passMaxBlankLines: 1,
    }, { kind: 'source-range', startLine: 8, startColumn: 0 }, 'b2')
    const other = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 1 }, undefined, 'x')
    const plans = planFixesForRuleV2('EXCESSIVE_INTERNAL_BLANK_LINES', ctx(md, [d1, d2, other]))
    expect(plans.map(p => p.diagnosticId)).toEqual(['b1', 'b2'])
    expect(plans.every(p => p.ok)).toBe(true)
    const { accepted } = selectNonConflictingPlans(plans)
    expect(accepted).toHaveLength(2)
    const { next } = buildFixedMarkdown(md, accepted)
    expect(next).toBe('# A\n\nB\n\nC\n')
  })

  it('drops an overlapping plan instead of applying two patches to the same bytes', () => {
    const md = '# A\n\n\n\n\nB\n'
    const d1 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation, 'b1')
    const d2 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation, 'b2')
    const plans = planFixesForRuleV2('EXCESSIVE_INTERNAL_BLANK_LINES', ctx(md, [d1, d2]))
    const { accepted, rejected } = selectNonConflictingPlans(plans)
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].blockers.map(b => b.code)).toContain('PATCH_CONFLICT')
  })
})

describe('production transaction adapter', () => {
  function port(initial: string, key = 'doc:fix'): MarkdownEditPort & { writes: string[] } {
    const state = { markdown: initial, key }
    const writes: string[] = []
    return {
      writes,
      readMarkdown: () => state.markdown,
      getDocumentKey: () => state.key,
      applyMarkdown: (next) => {
        writes.push(next)
        state.markdown = next
        return { ok: true }
      },
    }
  }

  it('applies ONE verified write and reads the buffer back', () => {
    const p = port('# A\n\n\n\n\nB\n')
    const adapter = createEditorFixTransactionAdapter(p)
    const result = adapter.apply({
      documentKey: 'doc:fix',
      beforeMarkdown: '# A\n\n\n\n\nB\n',
      afterMarkdown: '# A\n\nB\n',
    })
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('APPLIED_AND_VERIFIED')
    expect(p.writes).toEqual(['# A\n\nB\n'])
  })

  it('refuses a stale base, a doc switch, a rejected write, a mismatch and a no-op', () => {
    const p = port('# A\n')
    const adapter = createEditorFixTransactionAdapter(p)
    expect(adapter.apply({ documentKey: 'doc:fix', beforeMarkdown: 'other', afterMarkdown: 'x' }).reason)
      .toBe('STALE_SOURCE')
    expect(adapter.apply({ documentKey: 'doc:other', beforeMarkdown: '# A\n', afterMarkdown: 'x' }).reason)
      .toBe('STALE_DOCUMENT')
    expect(adapter.apply({ documentKey: 'doc:fix', beforeMarkdown: '# A\n', afterMarkdown: '# A\n' }).reason)
      .toBe('NO_CHANGE')

    const rejecting = createEditorFixTransactionAdapter({
      readMarkdown: () => '# A\n',
      getDocumentKey: () => 'doc:fix',
      applyMarkdown: () => ({ ok: false, reason: 'NOPE' }),
    })
    expect(rejecting.apply({ documentKey: 'doc:fix', beforeMarkdown: '# A\n', afterMarkdown: '# B\n' }).reason)
      .toBe('WRITE_REJECTED')

    const mismatch = createEditorFixTransactionAdapter({
      readMarkdown: () => '# A\n',
      getDocumentKey: () => 'doc:fix',
      applyMarkdown: () => ({ ok: true }),
    })
    expect(mismatch.apply({ documentKey: 'doc:fix', beforeMarkdown: '# A\n', afterMarkdown: '# B\n' }).reason)
      .toBe('READBACK_MISMATCH')
  })
})

describe('post-fix re-diagnosis', () => {
  const requested = ['b1', 'b2']

  it('only a NEW snapshot can prove a fix', () => {
    const before = snapshot([diag('A', {}, undefined, 'b1'), diag('A', {}, undefined, 'b2')])
    const after = snapshot([])
    const outcome = classifyFixOutcome({ requestedIds: requested, before, after })
    expect(outcome.status).toBe('VERIFIED_FIXED')
    expect(outcome.fixedIds).toEqual(['b1', 'b2'])
    expect(formatFixOutcome(outcome)).toBe('已修复 2 项')
  })

  it('reports a persisting diagnostic honestly', () => {
    const before = snapshot([diag('A', {}, undefined, 'b1'), diag('A', {}, undefined, 'b2')])
    const after = snapshot([diag('A', {}, undefined, 'b2')])
    const outcome = classifyFixOutcome({ requestedIds: requested, before, after })
    expect(outcome.status).toBe('CHANGED_BUT_PERSISTS')
    expect(outcome.remainingIds).toEqual(['b2'])
  })

  it('detects a document switch, a missing snapshot and introduced diagnostics', () => {
    const before = snapshot([diag('A', {}, undefined, 'b1')])
    expect(classifyFixOutcome({
      requestedIds: ['b1'], before, after: snapshot([], 'doc:other'),
    }).status).toBe('STALE')
    expect(classifyFixOutcome({ requestedIds: ['b1'], before, after: null }).status).toBe('FAILED')
    const after = snapshot([diag('NEW', {}, undefined, 'n1')])
    expect(classifyFixOutcome({ requestedIds: ['b1'], before, after }).introducedIds).toEqual(['n1'])
  })
})

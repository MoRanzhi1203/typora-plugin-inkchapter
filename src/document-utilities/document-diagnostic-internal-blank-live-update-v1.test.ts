// @vitest-environment jsdom
/**
 * P0 — EXCESSIVE_INTERNAL_BLANK_LINES LIVE UPDATE (authority level).
 *
 * FIRST_FAIL_SITE (pre-fix): the diagnostics content fingerprint was built from
 * `{severity:code:targetIdentity}` only. The internal-blank rule's identity is
 * the STABLE gap pair (`blank-gap:<prev>>><next>`), which does NOT change when
 * the blank COUNT changes, so an edit 3→5 blanks produced the SAME fingerprint →
 * `recompute()` RETURNED EARLY (NOOP) → the Drawer count / the body count label /
 * the Active visual never updated. The fix folds the count-bearing metadata into
 * the fingerprint.
 *
 * This suite drives a REAL source revision (mutable Markdown) and asserts the
 * published snapshot follows every edit — never a timer / full-document poll.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
const TRAILING = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'

let markdown = ''

function makeCtx(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:blank',
      getMarkdown: () => markdown,
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
}

function makeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

/** One paragraph gap with exactly `n` SOURCE blank lines between two blocks. */
function gapDoc(n: number): string {
  return `# H\n\n正文一。\n${'\n'.repeat(n)}正文二。\n`
}

let authority: DocumentDiagnosticsAuthority
let publishes: number

beforeEach(() => {
  markdown = gapDoc(3)
  authority = new DocumentDiagnosticsAuthority(makeCtx(), makeProviders())
  publishes = 0
  authority.subscribe(() => { publishes++ })
})

const snap = (): DocumentDiagnosticsSnapshot => authority.getSnapshot()!
const blanks = (s: DocumentDiagnosticsSnapshot = snap()) => s.diagnostics.filter(d => d.code === CODE)
const gapDiag = () => blanks()[0]

describe('P0 内部空行 — 源码变更实时重算（真实 source revision）', () => {
  it('首次 recompute 发布，含 1 条 3 空行 warning', () => {
    const before = publishes
    authority.recompute('TEST_INITIAL')
    expect(publishes).toBeGreaterThan(before)
    const d = gapDiag()
    expect(d).toBeTruthy()
    expect(d.severity).toBe('warning')
    expect(d.metadata?.['actualBlankLines']).toBe(3)
  })

  it('3 → 5 空行：身份不变、数量与源码范围更新、且必须重新发布（禁止 NOOP）', () => {
    authority.recompute('TEST_INITIAL')
    const before = gapDiag()
    const revisionBefore = snap().revision
    const publishesBefore = publishes

    markdown = gapDoc(5)             // the ONLY change: extra blank lines
    authority.recompute('DOCUMENT_MUTATION')

    expect(publishes).toBeGreaterThan(publishesBefore)       // ← the regression
    expect(snap().revision).toBeGreaterThan(revisionBefore)
    const after = gapDiag()
    expect(after.metadata?.['actualBlankLines']).toBe(5)
    // §4 — stable identity is preserved across a count change
    expect(after.targetIdentity).toBe(before.targetIdentity)
    expect(after.id).toBe(before.id)
    // §4 — the source range follows the NEW run: the next block now starts on
    // line 8 (`正文二。`), whereas the 3-blank document put it on line 6.
    expect(after.location?.kind).toBe('source-range')
    expect((after.location as { startLine: number }).startLine)
      .toBe(markdown.split('\n').findIndex(l => l === '正文二。'))
  })

  it('2 → 1 → 0：诊断按真实源码数量出现/消失', () => {
    markdown = gapDoc(2)
    authority.recompute('E2')
    expect(gapDiag()?.metadata?.['actualBlankLines']).toBe(2)

    markdown = gapDoc(1)             // 1 blank line = compliant → NO diagnostic
    authority.recompute('E1')
    expect(blanks()).toHaveLength(0)

    markdown = gapDoc(0)             // adjacent lines → one paragraph, no gap
    authority.recompute('E0')
    expect(blanks()).toHaveLength(0)
  })

  it('覆盖状态序列 0→1→2→3→2→1→0', () => {
    const expectCount = (n: number): number => {
      markdown = gapDoc(n)
      authority.recompute(`SEQ_${n}`)
      const ds = blanks()
      if (n <= 1) { expect(ds).toHaveLength(0); return 0 }
      expect(ds).toHaveLength(1)
      expect(ds[0].metadata?.['actualBlankLines']).toBe(n)
      return n
    }
    for (const n of [0, 1, 2, 3, 2, 1, 0]) expectCount(n)
  })

  it('在空行区域输入文字 → 区间被拆分，重新计算身份（禁止复用旧锚点）', () => {
    markdown = gapDoc(3)
    authority.recompute('E3')
    const old = gapDiag()
    expect(old).toBeTruthy()

    // typing splits the single 3-blank run into TWO 3-blank runs around a new block
    markdown = '# H\n\n正文一。\n\n\n\n中间文字\n\n\n\n正文二。\n'
    authority.recompute('DOCUMENT_MUTATION')
    const now = blanks()
    expect(now).toHaveLength(2)
    for (const d of now) {
      expect(d.targetIdentity).not.toBe(old.targetIdentity)   // no stale anchor reuse
      expect(d.metadata?.['actualBlankLines']).toBe(3)
    }
    expect(new Set(now.map(d => d.targetIdentity)).size).toBe(2)  // two distinct gaps
  })

  it('诊断消失 → 后续快照不再包含该规则（Drawer/计数/Active 的输入随之清空）', () => {
    markdown = gapDoc(4)
    authority.recompute('E4')
    expect(blanks()).toHaveLength(1)
    markdown = gapDoc(1)
    authority.recompute('DOCUMENT_MUTATION')
    expect(snap().diagnostics.some(d => d.code === CODE)).toBe(false)
  })

  it('文末空行规则同样按真实数量实时发布（含 0 ↔ 多）', () => {
    markdown = '# H\n\n正文。\n'          // exactly one trailing newline = compliant
    authority.recompute('T0')
    expect(snap().diagnostics.some(d => d.code === TRAILING)).toBe(false)

    markdown = '# H\n\n正文。\n\n\n\n'    // several trailing blank lines
    authority.recompute('DOCUMENT_MUTATION')
    const t1 = snap().diagnostics.find(d => d.code === TRAILING)
    expect(t1).toBeTruthy()
    const extra1 = t1!.metadata?.['extraTrailingBlankLineCount']

    markdown = '# H\n\n正文。\n\n\n\n\n\n' // MORE trailing blanks → must republish
    authority.recompute('DOCUMENT_MUTATION')
    const t2 = snap().diagnostics.find(d => d.code === TRAILING)
    expect(t2).toBeTruthy()
    expect(t2!.metadata?.['extraTrailingBlankLineCount']).not.toBe(extra1)
  })

  it('内容未变时 recompute 仍是 NOOP（幂等，不产生伪更新）', () => {
    authority.recompute('E3')
    const revisionAfterFirst = snap().revision
    const publishesAfterFirst = publishes
    authority.recompute('DOCUMENT_MUTATION')       // same markdown, no edit
    expect(snap().revision).toBe(revisionAfterFirst)
    expect(publishes).toBe(publishesAfterFirst)
  })
})

// ── 同一规则多实例：按完整 diagnosticId/targetIdentity 区分，互不串位 ────────────

/** Two gaps: `A`⟷`B` with `n1` blanks and `B`⟷`C` with `n2` blanks. */
function twoGapDoc(n1: number, n2: number): string {
  return `A。\n${'\n'.repeat(n1)}B。\n${'\n'.repeat(n2)}C。\n`
}

describe('P0 同一规则多实例 — 独立身份与数量隔离', () => {
  it('两个空行区间 → 两条诊断，id/targetIdentity 互不相同', () => {
    markdown = twoGapDoc(3, 4)
    authority.recompute('TWO_GAPS')
    const ds = blanks()
    expect(ds).toHaveLength(2)
    expect(new Set(ds.map(d => d.id)).size).toBe(2)
    expect(new Set(ds.map(d => d.targetIdentity)).size).toBe(2)
    // each gap reports its OWN source count
    const counts = ds.map(d => d.metadata?.['actualBlankLines']).sort()
    expect(counts).toEqual([3, 4])
  })

  it('只编辑其中一个区间：另一条诊断不串位、不复用旧数量、不误消失', () => {
    markdown = twoGapDoc(3, 4)
    authority.recompute('TWO_GAPS')
    const before = blanks()
    const byGap = (list: typeof before, kind: 'first' | 'second') =>
      kind === 'first'
        ? list.find(d => d.targetIdentity!.includes('A。') && d.targetIdentity!.includes('B。'))!
        : list.find(d => d.targetIdentity!.includes('B。') && d.targetIdentity!.includes('C。'))!
    const firstBefore = byGap(before, 'first')
    const secondBefore = byGap(before, 'second')
    expect(firstBefore.metadata?.['actualBlankLines']).toBe(3)
    expect(secondBefore.metadata?.['actualBlankLines']).toBe(4)

    // edit ONLY the FIRST gap (3 → 6)
    markdown = twoGapDoc(6, 4)
    authority.recompute('DOCUMENT_MUTATION')
    const after = blanks()
    expect(after).toHaveLength(2)
    const firstAfter = byGap(after, 'first')
    const secondAfter = byGap(after, 'second')
    // the edited gap: same id, new count
    expect(firstAfter.id).toBe(firstBefore.id)
    expect(firstAfter.metadata?.['actualBlankLines']).toBe(6)
    // the untouched gap: SAME id, SAME count (no cross-talk / stale reuse)
    expect(secondAfter.id).toBe(secondBefore.id)
    expect(secondAfter.metadata?.['actualBlankLines']).toBe(4)
    // the Drawer detail of the untouched gap still states ITS OWN count
    expect(String(secondAfter.detail ?? '')).toContain('4 个连续空行')
    expect(String(firstAfter.detail ?? '')).toContain('6 个连续空行')
  })

  it('一个内部空行（合规）绝不触发 EXCESSIVE_INTERNAL_BLANK_LINES', () => {
    // A⟷B 1 blank, B⟷C 1 blank → both compliant
    markdown = twoGapDoc(1, 1)
    authority.recompute('ONE_ONE')
    expect(blanks()).toHaveLength(0)
    // even with a heading/code boundary on one side
    markdown = 'A。\n\n## 标题\n\n正文。\n'
    authority.recompute('ONE_ONE_BLOCKS')
    expect(blanks()).toHaveLength(0)
  })

  it('1 → 2 的边界：正好 2 个空行才出现（阈值 = 2）', () => {
    markdown = twoGapDoc(1, 2)
    authority.recompute('ONE_TWO')
    const ds = blanks()
    expect(ds).toHaveLength(1)
    expect(ds[0].metadata?.['actualBlankLines']).toBe(2)
  })
})

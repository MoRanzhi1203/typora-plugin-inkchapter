// @vitest-environment jsdom
/**
 * R10 Closure §2.2 — STRUCTURAL MARKDOWN SNAPSHOT CONTRACT.
 *
 * The failing behavior this suite locks down (pre-fix facts):
 *   · `collectDiagnosticsInput` threw away `structural:false`, so a DEGRADED
 *     read (serializer threw / empty / disconnected root) was handed to the
 *     rule engine as if it were a verified structure, and a stale incremental
 *     mirror could produce a “no problems found” snapshot.
 *   · Nothing on the published snapshot recorded WHERE the markdown came from,
 *     so the toolbar rendered `✓ 未发现问题` for an unverified transaction.
 *
 * Every test drives the REAL transaction builder / authority — no copy of the
 * production logic lives here.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import {
  collectDiagnosticsInput,
  type DocumentUtilitiesContext,
  type StructuralMarkdownSnapshot,
} from './document-utilities-context'
import {
  analyzeInternalBlankLineGaps,
  internalBlankGapIdentity,
  INTERNAL_BLANK_LINE_POLICY,
} from './document-diagnostic-internal-blank-lines-v1'
import { decideInternalBlankPublication } from './document-diagnostic-internal-blank-decision-v1'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'

function emptyStructural(): Parameters<typeof collectDiagnosticsInput>[1] {
  return {
    headings: [],
    h1Facts: [],
    headingAuthority: undefined,
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
  }
}

function makeCtx(overrides: Partial<DocumentUtilitiesContext['authority']>): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:r10',
      getMarkdown: () => '',
      isStrictMode: () => false,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
      ...overrides,
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

/** Two paragraphs separated by exactly `n` SOURCE blank lines. */
function gapDoc(n: number): string {
  return `# H\n\n前段\n${'\n'.repeat(n)}后段\n`
}

// ── 1. ONE structural read per transaction, structural input wins ───────────

describe('R10-C — 每个诊断事务恰好一次结构化读取', () => {
  it('C01 结构化快照优先于旧增量镜像，且只读取一次', () => {
    let structuralReads = 0
    let mirrorReads = 0
    const structuralDoc = gapDoc(4)
    const ctx = makeCtx({
      getStructuralMarkdown: (): StructuralMarkdownSnapshot => {
        structuralReads++
        return { markdown: structuralDoc, structural: true }
      },
      getMarkdown: () => { mirrorReads++; return gapDoc(1) },
    })

    const input = collectDiagnosticsInput(ctx, emptyStructural())

    expect(structuralReads).toBe(1)
    // The stale mirror is never consulted when the structural read succeeded.
    expect(mirrorReads).toBe(0)
    expect(input.markdown).toBe(structuralDoc)
    expect(input.structuralVerified).toBe(true)
  })

  it('C02 下一次事务重新读取（无跨事务缓存）', () => {
    let reads = 0
    let doc = gapDoc(4)
    const ctx = makeCtx({
      getStructuralMarkdown: () => { reads++; return { markdown: doc, structural: true } },
    })

    collectDiagnosticsInput(ctx, emptyStructural())
    doc = gapDoc(2)
    const second = collectDiagnosticsInput(ctx, emptyStructural())

    expect(reads).toBe(2)
    expect(second.markdown).toBe(gapDoc(2))
    expect(analyzeInternalBlankLineGaps(second.markdown).map(g => g.actualBlankLines)).toEqual([2])
  })
})

// ── 2. Structure changes that keep the top-level block count ───────────────

describe('R10-C — 顶层块数不变但段内结构变化仍需新快照', () => {
  it('C03 同样的 3 个顶层块，空行 13 → 11 → 9 均进入新事务', () => {
    let doc = gapDoc(13)
    const ctx = makeCtx({
      getStructuralMarkdown: () => ({ markdown: doc, structural: true }),
    })

    const series = [13, 11, 9]
    for (const blanks of series) {
      doc = gapDoc(blanks)
      const input = collectDiagnosticsInput(ctx, emptyStructural())
      // The top-level block count never changes here — only the NESTED blank run.
      expect(input.markdown!.split('\n').filter(l => l.trim() !== '').length).toBe(3)
      expect(analyzeInternalBlankLineGaps(input.markdown).map(g => g.actualBlankLines)).toEqual([blanks])
    }
  })

  it('C04 结构化输入 17→13→11→9：源码区间跟随，发布仍以可见空行为准', () => {
    const observed: number[] = []
    let doc = gapDoc(17)
    const ctx = makeCtx({ getStructuralMarkdown: () => ({ markdown: doc, structural: true }) })

    for (const blanks of [17, 13, 11, 9]) {
      doc = gapDoc(blanks)
      const gaps = analyzeInternalBlankLineGaps(collectDiagnosticsInput(ctx, emptyStructural()).markdown)
      expect(gaps).toHaveLength(1)
      observed.push(gaps[0].actualBlankLines)
      // Publication is decided by the VISIBLE count, never the source count:
      // the legacy “source=3 → must warn” misreading stays dead.
      const visibleOne = decideInternalBlankPublication({
        mode: 'wysiwyg',
        measuredVisibleBlankLineCount: 1,
        sourceBlankLineCount: blanks,
      })
      expect(visibleOne.publish).toBe(false)
      const visibleMore = decideInternalBlankPublication({
        mode: 'wysiwyg',
        measuredVisibleBlankLineCount: INTERNAL_BLANK_LINE_POLICY.warningThreshold,
        sourceBlankLineCount: blanks,
      })
      expect(visibleMore.publish).toBe(true)
    }
    expect(observed).toEqual([17, 13, 11, 9])
  })
})

// ── 3. Degraded propagation (the pre-fix hole) ─────────────────────────────

describe('R10-C — 降级状态全链路保留', () => {
  const degradedCases: Array<{ name: string; reason: string }> = [
    { name: 'API_THREW', reason: 'API_THREW' },
    { name: 'EMPTY_RESULT', reason: 'EMPTY_RESULT' },
    { name: 'ROOT_DISCONNECTED', reason: 'ROOT_DISCONNECTED' },
    { name: 'API_UNAVAILABLE', reason: 'API_UNAVAILABLE' },
  ]

  for (const c of degradedCases) {
    it(`C05-${c.name} 结构读取降级 → structuralVerified=false + 回退镜像`, () => {
      const ctx = makeCtx({
        getStructuralMarkdown: () => ({
          markdown: gapDoc(1),
          structural: false,
          reason: c.reason as StructuralMarkdownSnapshot['reason'],
        }),
        getMarkdown: () => gapDoc(4),
      })
      const input = collectDiagnosticsInput(ctx, emptyStructural())
      expect(input.structuralVerified).toBe(false)
      expect(input.structuralDegradedReason).toBe(c.reason)
      // Fallback keeps the existing behavior (rules still run) but the fact is
      // DEGRADED — it must never be read as verified structure.
      expect(input.markdown).toBe(gapDoc(4))
    })
  }

  it('C05-throw 读取抛错 → structuralVerified=false（API_THREW）', () => {
    const ctx = makeCtx({
      getStructuralMarkdown: () => { throw new Error('serializer unavailable') },
      getMarkdown: () => gapDoc(3),
    })
    const input = collectDiagnosticsInput(ctx, emptyStructural())
    expect(input.structuralVerified).toBe(false)
    expect(input.structuralDegradedReason).toBe('API_THREW')
    expect(input.markdown).toBe(gapDoc(3))
  })

  it('C06 未提供结构化权威（纯/legacy 调用方）→ 不伪造验证标志', () => {
    const ctx = makeCtx({ getMarkdown: () => gapDoc(3) })
    const input = collectDiagnosticsInput(ctx, emptyStructural())
    expect(input.structuralVerified).toBeUndefined()
    expect(input.markdown).toBe(gapDoc(3))
  })
})

// ── 4. Authority: snapshot provenance + no fake compliance ───────────────────

describe('R10-C — 快照携带结构来源，降级不得伪装成“未发现问题”', () => {
  let doc = ''
  let structuralMode: 'verified' | 'degraded' = 'verified'
  let authority: DocumentDiagnosticsAuthority
  let snapshot: DocumentDiagnosticsSnapshot | null = null

  beforeEach(() => {
    doc = gapDoc(3)
    structuralMode = 'verified'
    const ctx = makeCtx({
      getStructuralMarkdown: () => (structuralMode === 'verified'
        ? { markdown: doc, structural: true }
        : { markdown: doc, structural: false, reason: 'ROOT_DISCONNECTED' }),
    })
    authority = new DocumentDiagnosticsAuthority(ctx, makeProviders())
    snapshot = null
    authority.subscribe(s => { snapshot = s })
  })

  const blankWarnings = (): number =>
    (snapshot?.diagnostics ?? []).filter(d => d.code === CODE).length

  it('C07 已验结构：快照 structuralVerified=true，3 空行产生 warning', () => {
    authority.recompute('TEST_VERIFIED')
    expect(snapshot?.structuralVerified).toBe(true)
    expect(blankWarnings()).toBe(1)
    expect(snapshot?.warningCount).toBeGreaterThan(0)
  })

  it('C08 降级：即便镜像算出 0 警告，快照也必须是 DEGRADED 而非“健康”', () => {
    authority.recompute('TEST_VERIFIED')
    expect(snapshot?.structuralVerified).toBe(true)

    // Mirror says “compliant”; the real structure is unknown.
    structuralMode = 'degraded'
    doc = gapDoc(1)
    authority.recompute('TEST_DEGRADED')

    expect(snapshot?.structuralVerified).toBe(false)
    expect(blankWarnings()).toBe(0)
    // The provenance itself prevents the toolbar from rendering `✓ 未发现问题`.
    expect(snapshot?.structuralVerified === false).toBe(true)
  })

  it('C09 降级恢复为已验结构必须重新发布（指纹包含来源）', () => {
    structuralMode = 'degraded'
    doc = gapDoc(3)
    authority.recompute('TEST_DEGRADED')
    const degradedRevision = snapshot?.revision ?? -1
    expect(snapshot?.structuralVerified).toBe(false)

    structuralMode = 'verified'
    authority.recompute('TEST_RECOVERED')
    expect(snapshot?.structuralVerified).toBe(true)
    expect(snapshot?.revision ?? -1).toBeGreaterThan(degradedRevision)
    expect(blankWarnings()).toBe(1)
  })
})

// ── 5. Cross-document isolation with identical block counts ─────────────────

describe('R10-C — 相同块数的跨文档切换不得串快照', () => {
  it('C10 两个 3 块文档内容不同：身份/来源各自独立', () => {
    const docs: Record<string, string> = {
      'doc:A': '# H\n\n甲段\n\n\n\n甲尾\n',
      'doc:B': '# H\n\n乙段\n\n\n\n乙尾\n',
    }
    let docKey = 'doc:A'
    const ctx = makeCtx({
      getDocumentKey: () => docKey,
      getStructuralMarkdown: () => ({ markdown: docs[docKey], structural: true }),
    })
    const authority = new DocumentDiagnosticsAuthority(ctx, makeProviders())
    const view: { snap: DocumentDiagnosticsSnapshot | null } = { snap: null }
    authority.subscribe(s => { view.snap = s })

    authority.recompute('DOC_A')
    const aIds = (view.snap?.diagnostics ?? []).filter(d => d.code === CODE).map(d => d.targetIdentity)
    expect(aIds.length).toBe(1)
    expect(String(aIds[0])).toContain('甲段')

    docKey = 'doc:B'
    authority.recompute('DOC_B')
    const bIds = (view.snap?.diagnostics ?? []).filter(d => d.code === CODE).map(d => d.targetIdentity)
    expect(bIds.length).toBe(1)
    expect(String(bIds[0])).toContain('乙段')
    expect(String(bIds[0])).not.toContain('甲段')
    expect(view.snap?.documentKey).toBe('doc:B')
  })
})

// ── 6. Same-text paragraph identity (two 啊) ────────────────────────────────

describe('R10-C — 同名段落身份独立', () => {
  it('C11 两个“啊”段落 → #0 / #1 两个独立身份，绝不按文本序号混淆', () => {
    const md = '# H\n\n啊\n\n\n\n啊\n'
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].previousBlockIdentity).toBe('paragraph:啊#0')
    expect(gaps[0].nextBlockIdentity).toBe('paragraph:啊#1')
    expect(internalBlankGapIdentity(gaps[0])).toBe('blank-gap:paragraph:啊#0>>paragraph:啊#1')
  })
})

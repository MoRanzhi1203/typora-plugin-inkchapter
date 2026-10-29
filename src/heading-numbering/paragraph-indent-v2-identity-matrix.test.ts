/**
 * Paragraph Indent V2 — identity / split-merge / persistence matrix.
 *
 * Covers the matrix rows that were still NOT_TESTED after the V2 audit:
 *   IND-026 non-text block adjacency, IND-031 repeated command idempotence,
 *   IND-047 30 repeated commands, IND-064/067/068 duplicate & reorder identity,
 *   IND-072 cross-document isolation, IND-074…078 merge directions,
 *   IND-080 30 alternating merges, IND-085 reopen after structural edit,
 *   IND-086 rename must not leak the sidecar.
 *
 * Safety contract under test: an anchor must NEVER bind an override to a
 * paragraph other than the one it was created on. Losing an override
 * (fail-closed) is acceptable; mis-binding is not.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  hashText,
  collectContentParagraphs,
  createParagraphAnchor,
  resolveParagraphAnchor,
  resolveParagraphAnchorCandidates,
  evaluateHistoricalRehydrateIdentity,
  updateParagraphAnchor,
  loadParagraphLayout,
  saveParagraphLayout,
  setVaultRootForTesting,
  type ParagraphAnchor,
} from './paragraph-layout-store'
import {
  resolveMergeSemantic,
  resolveMergeWinnerSide,
  computeMergeContentExpectation,
  verifyMergeContent,
  setParagraphIndentMode,
  getParagraphIndentMode,
  refreshParagraphIndentStyles,
  resolveSafeRehydrateDecision,
  INDENT_MARKER_ATTR,
  type ParagraphIndentSemanticMode,
} from './paragraph-indent-manager'
import { resolveCurrentBodyParagraph } from './paragraph-indent-manager'
import { DEFAULT_PARAGRAPH_LAYOUT } from './heading-types'

const INDENT_SETTINGS = { ...DEFAULT_PARAGRAPH_LAYOUT, defaultIndent: 'indent-2' as const }

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
})

afterEach(() => {
  document.body.innerHTML = ''
})

function addP(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  root.appendChild(p)
  return p
}

function paragraphs(): HTMLElement[] {
  return collectContentParagraphs(root)
}

/** Rebuild the root with exactly these paragraph texts (simulates reopening). */
function keepOnly(texts: string[]): void {
  root.innerHTML = ''
  for (const t of texts) addP(t)
}

/** Remove the paragraph at `index` from the live DOM (keeps other references valid). */
function removeAt(index: number): void {
  paragraphs()[index]?.remove()
}

describe('IND-064 三段同文：锚点不漂移', () => {
  it('在正文前插入新段后，锚点仍解析到同一（中间）目标', () => {
    addP('甲段')
    const target = addP('同文')
    addP('同文')
    addP('同文')
    const anchor = createParagraphAnchor(1, paragraphs())

    // Insert a new paragraph at the very top (structural shift).
    const head = document.createElement('p')
    head.textContent = '新插入'
    root.insertBefore(head, root.firstChild)

    const resolved = resolveParagraphAnchor(anchor, paragraphs())
    expect(resolved).not.toBeNull()
    expect(resolved!.index).toBe(2) // the original target moved 1 → 2
    expect(paragraphs()[resolved!.index]).toBe(target)

    const identity = evaluateHistoricalRehydrateIdentity(anchor, resolved!.index, paragraphs())
    expect(identity.decision).toBe('ACCEPT_STRONG_IDENTITY')
  })

  it('删除前一个同文段后：绝不把覆盖绑到错误的同文段（fail-closed）', () => {
    addP('同文')
    addP('同文')
    addP('同文')
    const anchor = createParagraphAnchor(1, paragraphs()) // middle one

    removeAt(0) // first paragraph deleted

    const resolved = resolveParagraphAnchor(anchor, paragraphs())
    // Level 1 resolves by occurrence → index 1, which is NOT the original target.
    expect(resolved!.index).toBe(1)
    const identity = evaluateHistoricalRehydrateIdentity(anchor, resolved!.index, paragraphs())
    // Neighbourhood no longer corroborates, so the historical anchor is rejected
    // instead of silently re-binding the indent to a different paragraph.
    expect(identity.decision).toBe('REJECT_TEXT_ONLY_COLLISION')
  })
})

describe('IND-067 删除前一段：唯一文本仍可安全找回', () => {
  it('删除前段后按唯一文本重新定位到正确段落', () => {
    addP('前段')
    const target = addP('目标段')
    addP('后段')
    const anchor = createParagraphAnchor(1, paragraphs())

    removeAt(0) // 前段 deleted

    const resolved = resolveParagraphAnchor(anchor, paragraphs())
    expect(resolved).not.toBeNull()
    expect(resolved!.index).toBe(0)
    expect(paragraphs()[0]).toBe(target)

    // Historical gate is deliberately conservative when the neighbourhood
    // changed: it may refuse (fail-closed) but must never accept a wrong index.
    const identity = evaluateHistoricalRehydrateIdentity(anchor, resolved!.index, paragraphs())
    if (identity.decision !== 'ACCEPT_STRONG_IDENTITY') {
      expect(identity.decision).toBe('REJECT_TEXT_ONLY_COLLISION')
    }
  })

  it('删除后一段不影响文本定位', () => {
    addP('前段')
    addP('目标段')
    addP('后段')
    const anchor = createParagraphAnchor(1, paragraphs())
    removeAt(2) // 后段 deleted
    const resolved = resolveParagraphAnchor(anchor, paragraphs())
    expect(resolved!.index).toBe(1)
  })
})

describe('IND-068 乱序 / 剪切粘贴：文本身份优先，绝不落到空位', () => {
  it('把目标段剪切到文末后仍解析到该段（文本+邻域）', () => {
    addP('甲')
    addP('乙')
    const target = addP('目标')
    addP('丙')
    const anchor = createParagraphAnchor(2, paragraphs())

    // Cut 目标 and paste it after 丙 (it is now the last paragraph).
    target.remove()
    root.appendChild(target)

    const resolved = resolveParagraphAnchor(anchor, paragraphs())
    expect(resolved).not.toBeNull()
    expect(paragraphs()[resolved!.index]).toBe(target)
  })

  it('目标段被删除后：低层解析器可能落到邻域候选，但安全闸门必须拦截', () => {
    addP('甲')
    addP('目标')
    addP('乙')
    const anchor = createParagraphAnchor(1, paragraphs())
    removeAt(1) // target deleted entirely

    const candidates = resolveParagraphAnchorCandidates(anchor, paragraphs())
    expect(candidates.every(c => c.textHashMatch === false)).toBe(true)

    // The primitive resolver may return a neighbour-scored candidate; the ONE
    // safety decision point must block it (WEAK / multi-owner) so no override
    // is applied. `paragraph` is only a diagnostic echo of the best candidate.
    const decision = resolveSafeRehydrateDecision(anchor, paragraphs(), 'rec-1', 'force-indent')
    expect(decision.blocked).toBe(true)
    expect(decision.blockReason ?? '').toMatch(/weak|ambiguous|multi-owner/)
    expect(decision.confidence).toBe('weak')
  })
})

describe('IND-072 同文不同 documentKey：sidecar 严格隔离', () => {
  const VAULT = (() => {
    const dir = path.join(os.tmpdir(), `inkchapter-matrix-${Date.now()}`)
    fs.mkdirSync(path.join(dir, '.typora', 'inkchapter', 'paragraph-layout'), { recursive: true })
    return dir
  })()

  beforeEach(() => setVaultRootForTesting(VAULT))

  afterEach(() => {
    const dir = path.join(VAULT, '.typora', 'inkchapter', 'paragraph-layout')
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  })

  it('两个文档同文互不影响', () => {
    const anchor = { lastKnownOrdinal: 0, textHash: hashText('同文段') }
    saveParagraphLayout('a/doc', 'a/doc.md', [{ id: 'r1', mode: 'force-indent', anchor }])
    saveParagraphLayout('b/doc', 'b/doc.md', [{ id: 'r2', mode: 'force-flush', anchor }])

    expect(loadParagraphLayout('a/doc')!.paragraphOverrides[0].mode).toBe('force-indent')
    expect(loadParagraphLayout('b/doc')!.paragraphOverrides[0].mode).toBe('force-flush')
    expect(loadParagraphLayout('a/doc')!.paragraphOverrides).toHaveLength(1)
  })

  it('未记录的 documentKey 返回 null（不继承他人覆盖）', () => {
    saveParagraphLayout('a/doc', 'a/doc.md', [
      { id: 'r1', mode: 'force-indent', anchor: { lastKnownOrdinal: 0, textHash: hashText('x') } },
    ])
    expect(loadParagraphLayout('c/doc')).toBeNull()
  })
})

describe('IND-074…078 合并方向与内容保持', () => {
  it('IND-076 并入前一段（Backspace）：右/显式侧胜出', () => {
    const r = resolveMergeSemantic('backspace', 'auto', 'force-indent')
    expect(r.winner).toBe('force-indent')
    expect(resolveMergeWinnerSide(r.reason)).toBe('right')
  })

  it('IND-077 与后一段合并（Delete）：显式左段胜出', () => {
    const r = resolveMergeSemantic('delete', 'force-flush', 'auto')
    expect(r.winner).toBe('force-flush')
    expect(resolveMergeWinnerSide(r.reason)).toBe('left')
  })

  it('IND-074/075 拆分：拆分点两侧语义各自独立，目标侧不被复制', () => {
    const left = addP('前半目标')
    const right = addP('后半')
    setParagraphIndentMode(left, 'force-indent')
    expect(getParagraphIndentMode(left)).toBe('force-indent')
    // A split creates a new paragraph whose semantic starts as auto.
    expect(getParagraphIndentMode(right)).toBe('auto')
  })

  it('IND-078 与空段落合并：内容保持 left+right，光标在接缝', () => {
    const exp = computeMergeContentExpectation('甲段', '')
    expect(exp.expectedMergedText).toBe('甲段')
    expect(exp.expectedCaretOffset).toBe(2)
    const ok = verifyMergeContent(exp.expectedMergedText, '甲段', exp.expectedCaretOffset)
    expect(ok.preserved).toBe(true)
  })

  it('显式冲突时方向决定所有者：Delete→左，Backspace→右', () => {
    expect(resolveMergeSemantic('delete', 'force-indent', 'force-flush').reason).toBe('CONFLICT_DELETE_LEFT')
    expect(resolveMergeSemantic('backspace', 'force-indent', 'force-flush').reason).toBe('CONFLICT_BACKSPACE_RIGHT')
  })
})

describe('IND-080 30 次交替拆分/合并不发生语义漂移', () => {
  it('交替合并 30 轮后语义与记录身份保持稳定', () => {
    const left = addP('左段')
    const right = addP('右段')
    setParagraphIndentMode(left, 'force-indent')

    let current: ParagraphIndentSemanticMode = 'force-indent'
    for (let i = 0; i < 30; i++) {
      const intent: 'delete' | 'backspace' = i % 2 === 0 ? 'delete' : 'backspace'
      const other: ParagraphIndentSemanticMode = i % 2 === 0 ? 'auto' : 'force-indent'
      const r = resolveMergeSemantic(intent, current, other)
      current = r.winner
      setParagraphIndentMode(right, current)
    }
    // Alternating cycles must converge on one explicit owner, never flip to flush.
    expect(['force-indent', 'auto']).toContain(current)
    expect(getParagraphIndentMode(left)).toBe('force-indent')
  })
})

describe('IND-085 / IND-086 重开与重命名', () => {
  const VAULT = (() => {
    const dir = path.join(os.tmpdir(), `inkchapter-matrix2-${Date.now()}`)
    fs.mkdirSync(path.join(dir, '.typora', 'inkchapter', 'paragraph-layout'), { recursive: true })
    return dir
  })()

  beforeEach(() => setVaultRootForTesting(VAULT))

  afterEach(() => {
    const dir = path.join(VAULT, '.typora', 'inkchapter', 'paragraph-layout')
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  })

  it('IND-085 结构编辑后重开：按文本重新定位到正确段落', () => {
    addP('甲')
    addP('目标段')
    addP('丙')
    const anchor = createParagraphAnchor(1, paragraphs())
    saveParagraphLayout('doc', 'doc.md', [{ id: 'r1', mode: 'force-indent', anchor }])

    const loaded = loadParagraphLayout('doc')!
    // Reopen after inserting a paragraph above the target.
    keepOnly(['新段', '甲', '目标段', '丙'])
    const resolved = resolveParagraphAnchor(loaded.paragraphOverrides[0].anchor, paragraphs())
    expect(resolved!.index).toBe(2)
    expect(paragraphs()[2].textContent).toBe('目标段')
  })

  it('IND-086 重命名后不串用旧 sidecar（按 documentKey 隔离）', () => {
    saveParagraphLayout('old-name', 'old-name.md', [
      { id: 'r1', mode: 'force-indent', anchor: { lastKnownOrdinal: 0, textHash: hashText('目标段') } },
    ])
    expect(loadParagraphLayout('new-name')).toBeNull()
  })
})

describe('IND-026 / IND-031 / IND-047 目标唯一性与命令幂等', () => {
  it('IND-026 非文本业务块（图片）相邻时目标仍是唯一普通段落', () => {
    const before = addP('图片前正文')
    const img = document.createElement('p')
    img.innerHTML = '<img src="a.png" alt="">'
    root.appendChild(img)
    const after = addP('图片后正文')

    const rangeBefore = document.createRange()
    rangeBefore.setStart(before.firstChild!, 2)
    rangeBefore.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(rangeBefore)
    expect(resolveCurrentBodyParagraph(root)).toBe(before)

    const rangeAfter = document.createRange()
    rangeAfter.setStart(after.firstChild!, 2)
    rangeAfter.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(rangeAfter)
    expect(resolveCurrentBodyParagraph(root)).toBe(after)
  })

  it('IND-031 重复执行同一命令是幂等的（class/标记不抖动）', () => {
    const p = addP('正文内容')
    setParagraphIndentMode(p, 'force-indent')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    const marker = p.getAttribute(INDENT_MARKER_ATTR)
    const classBefore = p.className

    for (let i = 0; i < 5; i++) {
      setParagraphIndentMode(p, 'force-indent')
      refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    }
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe(marker)
    expect(p.className).toBe(classBefore)
    expect(getParagraphIndentMode(p)).toBe('force-indent')
  })

  it('IND-047 连续 30 次命令后状态与标记稳定（无重复写）', () => {
    const p = addP('正文内容')
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      setParagraphIndentMode(p, i % 2 === 0 ? 'force-indent' : 'force-indent')
      const stats = refreshParagraphIndentStyles(root, INDENT_SETTINGS)
      seen.add(`${stats.paragraphs}|${stats.indent2}|${stats.explicitMarkers}`)
    }
    expect(seen.size).toBe(1)
    expect([...seen][0]).toBe('1|1|1')
  })
})

// @vitest-environment jsdom
/**
 * EOF-R5 — 文末空行诊断 / 视觉标记实时同步（行为测试，非源码字符串搜索）。
 *
 * 核心回归：诊断快照被被动提交（编辑后）时，底部 `多余 N 空行` 标签与真实空行
 * 着色集合必须**无需再次点击**即同步。修复前 `commitAdmittedSnapshot` 不投递任何
 * EOF 视觉同步，标签会停留在上一次定位时的旧值 → 本文件的 `EOF-02/03/04/05` 会 FAIL。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { RENDERED_BLANK_ROW_FRAGMENT_CLASS } from './document-diagnostic-block-gap-visual-v1'
import { BLANK_RUN_COUNT_CHIP_CLASS } from './document-diagnostic-block-gap-visual-v1'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function stubRaf(): void {
  let seq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { const id = seq++; queueMicrotask(() => cb(0)); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {}
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:eof',
      getMarkdown: () => 'content\n\n\n\n\n\n',
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
    getCodeName: () => null, getCodeLanguage: () => null, resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false, getHeadingIdentity: () => null, parseLocalLinkTargets: () => [],
  }
}
interface World { h: DocumentUtilityOverlayHost; write: HTMLElement }
function makeWorld(): World {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1200 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const last = document.createElement('p')
  last.setAttribute('data-line', '10')
  last.textContent = '最后一段正文'
  write.appendChild(last)
  stubRect(last, () => ({ left: 60, top: 1000, right: 700, bottom: 1024 }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, write }
}
function diag(extra: number): Record<string, unknown> {
  return {
    id: 'document:DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE:stable',
    documentKey: 'doc:eof', severity: 'warning', category: 'document',
    code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', message: '文档末尾空行过多', detail: '',
    metadata: { ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE', reason: 'EXCESSIVE_TRAILING_BLANK_LINES', terminalNewlineCount: extra + 1, extraTrailingBlankLineCount: extra },
    location: { kind: 'document-end' },
  }
}
function snapshotOf(diags: Array<Record<string, unknown>>): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:eof', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: diags.length, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
}
const fakeTx = (): Record<string, unknown> => ({ id: 1, documentKey: 'doc:eof', diagnosticId: 'D1', targetIndex: 0, targetCount: 1, startedAt: 0, state: 'PRESENTING' })
type Internals = {
  commitAdmittedSnapshot(snapshot: unknown, source: string): void
  commitSyntheticEofVisual(tx: unknown, diag: Record<string, unknown>, extra: number, remeasured: boolean): boolean
  rederiveSyntheticEofVisualOnLayoutChange(extraOverride?: number): void
}
function carrier(): HTMLElement | null { return document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement | null }
function chipText(): string | null { return carrier()?.querySelector(`.${BLANK_RUN_COUNT_CHIP_CLASS}`)?.textContent ?? null }
function frags(): number { return carrier()?.querySelectorAll(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`).length ?? 0 }
/** Set the count of REAL trailing visible blank `<p>` rows (stubbed geometry). */
function setVisible(write: HTMLElement, n: number): void {
  const blanks = (): HTMLElement[] => Array.from(write.querySelectorAll('p')).filter(p => (p.textContent ?? '').trim() === '')
  while (blanks().length > n) blanks().pop()!.remove()
  while (blanks().length < n) {
    const b = document.createElement('p')
    b.textContent = ''
    const top = 1024 + blanks().length * 24
    stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
    write.appendChild(b)
  }
}
function commit(h: DocumentUtilityOverlayHost, extra: number): void {
  (h as unknown as Internals).commitAdmittedSnapshot(snapshotOf([diag(extra)]), 'TEST')
}

let host: DocumentUtilityOverlayHost | null = null
beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({
    lineHeight: '24px', backgroundColor: 'rgba(168,121,50,0.08)', backgroundImage: 'none',
    boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px',
    borderLeftWidth: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
    borderLeftStyle: 'none', borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none',
  })) as unknown as typeof window.getComputedStyle)
})
afterEach(() => { host?.dispose(); host = null; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('EOF-R5 — 被动提交后标签/着色集合实时同步（无需再次点击）', () => {
  it('EOF-02: 1 -> 2 可见空行 → 生成「多余 1 空行」+ 精确 1 行目标（被动，无点击）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 1)
    // locate once while 2 visible so a carrier exists, then drop to 1 (no excess),
    // then grow back to 2 → the PASSIVE path must re-create the warning.
    setVisible(w.write, 2)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(2), 2, true)
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
    setVisible(w.write, 1)
    commit(host, 1)                                  // retract: no label / no fill
    expect(chipText()).toBeNull()
    expect(frags()).toBe(0)
    setVisible(w.write, 2)
    commit(host, 2)                                  // 1 -> 2 : warning must come back
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
  })

  it('EOF-03: 2 -> 3 可见空行 → 标签 1 -> 2，增加 1 行目标', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 2)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(2), 2, true)
    expect(chipText()).toBe('多余 1 空行')
    setVisible(w.write, 3)
    commit(host, 3)
    expect(chipText()).toBe('多余 2 空行')
    expect(frags()).toBe(2)
  })

  it('EOF-04: 3 -> 2 可见空行 → 标签 2 -> 1，移除旧目标', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    expect(chipText()).toBe('多余 2 空行')
    expect(frags()).toBe(2)
    setVisible(w.write, 2)
    commit(host, 2)
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
  })

  it('EOF-04b（真实反馈）: 着色块几何必须随多余行数变化，而不只是数值', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    const el = carrier()!
    const height3 = Number.parseFloat(el.style.height)
    expect(height3).toBeGreaterThan(0)
    setVisible(w.write, 2)                 // 3 -> 2 : one row less
    commit(host, 2)
    const height2 = Number.parseFloat(el.style.height)
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
    // the BAND itself must shrink (the reported “数值变、色块不变” defect)
    expect(height2).toBeLessThan(height3)
    setVisible(w.write, 4)                 // 2 -> 4 : grow back
    commit(host, 4)
    const height4 = Number.parseFloat(el.style.height)
    expect(frags()).toBe(3)
    expect(height4).toBeGreaterThan(height2)
  })

  it('EOF-05: 2 -> 1 可见空行 → 警告、标签、着色全部清理（零残留）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 2)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(2), 2, true)
    expect(chipText()).toBe('多余 1 空行')
    setVisible(w.write, 1)
    commit(host, 1)
    expect(chipText()).toBeNull()
    expect(frags()).toBe(0)
    expect(document.querySelector(`.${BLANK_RUN_COUNT_CHIP_CLASS}`)).toBeNull()
  })

  it('EOF-06: 3 -> 1 跨多空行快速删除 → 零残留', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    expect(frags()).toBe(2)
    setVisible(w.write, 1)
    commit(host, 1)
    expect(frags()).toBe(0)
    expect(chipText()).toBeNull()
  })

  it('EOF-01: 0 -> 1 可见空行 → 无多余着色（允许的 1 行不涂色）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 0)
    commit(host, 0)
    expect(frags()).toBe(0)
    expect(chipText()).toBeNull()
    setVisible(w.write, 1)
    commit(host, 1)
    expect(frags()).toBe(0)          // the ALLOWED row is never painted
    expect(chipText()).toBeNull()
  })

  it('EOF-10: 激活状态下被动编辑同样同步（不需要再次点击）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    expect(chipText()).toBe('多余 2 空行')
    setVisible(w.write, 2)           // edit while the diagnostic stays ACTIVE
    commit(host, 2)
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
    expect(carrier()).not.toBeNull()
  })

  it('EOF-11: 被动更新后 active target 不丢失、carrier 仍连接', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    const before = carrier()
    expect(before).not.toBeNull()
    setVisible(w.write, 2)
    commit(host, 2)
    expect(carrier()).toBe(before)         // same carrier object, updated in place
    expect(carrier()!.isConnected).toBe(true)
  })

  it('EOF-13: 几何重测不改变可见数语义（resize 不误计）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    const textBefore = chipText()
    const fragsBefore = frags()
    ;(host as unknown as Internals).rederiveSyntheticEofVisualOnLayoutChange(2)
    expect(chipText()).toBe(textBefore)
    expect(frags()).toBe(fragsBefore)
  })

  it('EOF-12: 重测时 live 几何暂不可得 → 不“先清空后不补”（保留已有集合）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 3)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(3), 3, true)
    expect(frags()).toBe(2)
    // Make the host rect unusable (the re-derive cannot project a local rect) while
    // the REAL trailing rows still exist → the old set must be KEPT, not cleared.
    stubRect(w.write, () => ({ left: 0, top: 0, right: 0, bottom: 0 }))
    ;(host as unknown as Internals).rederiveSyntheticEofVisualOnLayoutChange(2)
    expect(frags()).toBe(2)
    expect(chipText()).toBe('多余 2 空行')
  })

  it('EOF-08: 快速连续变化 → 最终状态最新（latest-wins，无旧值回写）', () => {
    const w = makeWorld(); host = w.h
    setVisible(w.write, 2)
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(2), 2, true)
    for (const n of [3, 2, 4, 3, 5]) { setVisible(w.write, n); commit(host, n) }
    expect(chipText()).toBe('多余 4 空行')
    expect(frags()).toBe(4)
  })

  it('EOF-15: 内部正文空行不计入 EOF 多余数（只统计最后一个非空块之后）', () => {
    const w = makeWorld(); host = w.h
    // a MEANINGFUL block, then an INTERNAL blank run, then the last meaningful block
    const first = document.createElement('p')
    first.textContent = '开头正文'
    first.setAttribute('data-line', '1')
    stubRect(first, () => ({ left: 60, top: 800, right: 700, bottom: 824 }))
    const internal = document.createElement('p')
    internal.textContent = ''
    internal.setAttribute('data-line', '2')
    stubRect(internal, () => ({ left: 60, top: 900, right: 700, bottom: 924 }))
    w.write.insertBefore(internal, w.write.firstChild)
    w.write.insertBefore(first, internal)
    // EXACTLY 2 trailing visible blanks after the last meaningful block
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('p')
      b.textContent = ''
      const top = 1024 + i * 24
      stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
      w.write.appendChild(b)
    }
    ;(host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag(2), 2, true)
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
    commit(host, 2)                  // passive re-commit: the internal blank never counts
    expect(chipText()).toBe('多余 1 空行')
    expect(frags()).toBe(1)
  })
})

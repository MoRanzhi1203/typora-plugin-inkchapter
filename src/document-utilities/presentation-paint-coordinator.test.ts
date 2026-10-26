// @vitest-environment jsdom
/**
 * EN-11 R3 — PRESENTATION PAINT COORDINATOR · 可运行的状态机行为测试。
 *
 * 这些断言在实现被移除/改坏时会 FAIL（不是“源码含某字符串”的脆弱搜索）：
 *   - 无 hold 时**同步**绘制（非 Enter 路径行为不变）；
 *   - hold 期间**只保留一个** pending intent（同文档同域 latest-wins 合并）；
 *   - 释放后按帧驱动重检并绘制；预算耗尽 fail-open 绘制；
 *   - 文档切换 / 根替换 → DROP_STALE（绝不跨文档绘制）；
 *   - 绘制闭包抛错被吞（fail-open，不抛出）；
 *   - dispose 后请求被丢弃。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  PresentationPaintCoordinator,
  createPresentationPaintCounters,
} from './presentation-paint-coordinator'

function mk(held: () => boolean, id: () => { documentKey: string | null; editorRootId: string | null }) {
  return new PresentationPaintCoordinator(held, id)
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('PresentationPaintCoordinator — state machine', () => {
  it('T1: hold INACTIVE → 同步绘制（非 Enter 路径零行为变化）', () => {
    const c = mk(() => false, () => ({ documentKey: 'A', editorRootId: 'R' }))
    let painted = 0
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    expect(painted).toBe(1)
    expect(c.getPendingCount()).toBe(0)
    expect(c.getCounters().PAINTED).toBe(1)
    expect(c.getCounters().REQUESTS).toBe(1)
  })

  it('T2: hold ACTIVE → 只挂起（不绘制），释放后绘制一次', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    let held = true
    const c = mk(() => held, () => ({ documentKey: 'A', editorRootId: 'R' }))
    let painted = 0
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    expect(painted).toBe(0)                    // never written during the hold
    expect(c.getPendingCount()).toBe(1)
    vi.advanceTimersByTime(48)
    expect(painted).toBe(0)                    // still held
    expect(c.getCounters().DEFERRED_BY_ECHO_WINDOW).toBeGreaterThan(0)
    held = false
    vi.advanceTimersByTime(48)
    expect(painted).toBe(1)
    expect(c.getPendingCount()).toBe(0)
  })

  it('T3: 同文档同域连续请求 → 合并为一个 pending（latest-wins，只跑最新闭包）', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: 'R' }))
    const ran: string[] = []
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => ran.push('old'))
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 2, layoutEpoch: 2 }, () => ran.push('new'))
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 3, layoutEpoch: 3 }, () => ran.push('newest'))
    expect(c.getPendingCount()).toBe(1)
    expect(c.getCounters().REQUESTS).toBe(1)
    expect(c.getCounters().MERGED).toBe(2)
    c.flushNow()
    expect(ran).toEqual(['newest'])
  })

  it('T4: 不同展示域各自保留一个 pending', () => {
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: 'R' }))
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => {})
    c.request('ACTIVE_HEADING_EMPHASIS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => {})
    expect(c.getPendingCount()).toBe(2)
  })

  it('T5: 文档切换（painting 前 identity 变化）→ DROP_STALE，绝不跨文档绘制', () => {
    let doc = 'A'
    const c = mk(() => true, () => ({ documentKey: doc, editorRootId: 'R' }))
    let painted = 0
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    doc = 'B'                                   // user switched document
    c.flushNow()
    expect(painted).toBe(0)
    expect(c.getCounters().DROPPED_STALE).toBe(1)
  })

  it('T6: 编辑器根替换 → DROP_STALE（ROOT_CHANGED_BEFORE_PAINT）', () => {
    let root = 'R1'
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: root }))
    let painted = 0
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R1', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    root = 'R2'
    c.flushNow()
    expect(painted).toBe(0)
    expect(c.getCounters().DROPPED_STALE).toBe(1)
  })

  it('T7: 请求时文档已不匹配 → 立即丢弃（DOC_MISMATCH_ON_REQUEST）', () => {
    const c = mk(() => false, () => ({ documentKey: 'B', editorRootId: 'R' }))
    let painted = 0
    c.request('HEADING_MARKERS', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    expect(painted).toBe(0)
    expect(c.getCounters().DROPPED_STALE).toBe(1)
  })

  it('T8: 绘制闭包抛错 → fail-open（吞掉，不抛出，计数）', () => {
    const c = mk(() => false, () => ({ documentKey: 'A', editorRootId: 'R' }))
    expect(() => c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { throw new Error('boom') })).not.toThrow()
    expect(c.getCounters().PAINT_ERRORS).toBe(1)
    expect(c.getCounters().PAINTED).toBe(0)
  })

  it('T9: cancelAll / dispose 丢弃 pending；dispose 后请求不再排队', () => {
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: 'R' }))
    c.request('D1', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => {})
    c.request('D2', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => {})
    expect(c.cancelAll('DOCUMENT_SWITCH')).toBe(2)
    expect(c.getPendingCount()).toBe(0)
    expect(c.getCounters().DROPPED_STALE).toBe(2)

    c.dispose()
    let painted = 0
    c.request('D3', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    expect(painted).toBe(0)
    expect(c.getPendingCount()).toBe(0)
  })

  it('T10 (R4 B1): hold 长期不释放 → 预算耗尽必须 BLOCK（绝不写入 #write），标记保留待恢复', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: 'R' }))
    let painted = 0
    c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    expect(painted).toBe(0)
    vi.advanceTimersByTime(16 * 200)
    expect(painted).toBe(0)                                    // never forced through the hold
    expect(c.getCounters().PAINT_BLOCKED_UNSTABLE).toBeGreaterThan(0)
    expect(c.isBlocked()).toBe(true)
    expect(c.getPendingCount()).toBe(1)                        // dirty intent retained (not lost)
    expect(c.getState()).toBe('BLOCKED')
  })

  it('T12 (R4 B1): BLOCKED 后收到稳定信号 → 恢复并绘制一次', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    let held = true
    const c = mk(() => held, () => ({ documentKey: 'A', editorRootId: 'R' }))
    let painted = 0
    c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    vi.advanceTimersByTime(16 * 200)
    expect(painted).toBe(0)
    expect(c.isBlocked()).toBe(true)
    held = false
    c.resumeOnStable('EDITOR_LAYOUT_INVALIDATION')              // event-driven resume, no new timer window
    vi.advanceTimersByTime(48)
    expect(painted).toBe(1)
    expect(c.getCounters().RESUMED_ON_STABLE).toBeGreaterThan(0)
  })

  it('T13 (R4 B2): root 对象替换（即使仍叫 DIV#write）→ DROP_STALE', () => {
    let rootId: string | null = 'editorRoot#1'
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: rootId }))
    let painted = 0
    c.request('D', { documentKey: 'A', editorRootId: 'editorRoot#1', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    rootId = 'editorRoot#2'                                     // same DOM id `write`, different OBJECT
    c.flushNow()
    expect(painted).toBe(0)
    expect(c.getCounters().DROPPED_STALE).toBe(1)
  })

  it('T14 (R4 B2): 提交前校验 revision —— 前进则记 REDERIVED（仍按 live 绘制），缺失记 UNKNOWN', () => {
    let srcRev: number | null = 2
    const c = new PresentationPaintCoordinator(
      () => true,
      () => ({ documentKey: 'A', editorRootId: 'R' }),
      undefined,
      () => ({ sourceRevision: srcRev, layoutEpoch: null }),
    )
    let painted = 0
    c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: null }, () => { painted++ })
    c.flushNow()                                                // live rev 2 != intent rev 1
    expect(painted).toBe(1)                                     // painted FROM LIVE (closure re-derives)
    expect(c.getCounters().REVISION_ADVANCED_BEFORE_PAINT).toBe(1)

    srcRev = null
    const c2 = new PresentationPaintCoordinator(
      () => true, () => ({ documentKey: 'A', editorRootId: 'R' }), undefined,
      () => ({ sourceRevision: null, layoutEpoch: null }),
    )
    c2.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: null, layoutEpoch: null }, () => {})
    c2.flushNow()
    expect(c2.getCounters().REVISION_UNKNOWN_AT_PAINT).toBe(1)  // never hard-matched
  })

  it('T15 (R4 B3): 文档不可见 → PARKED_INACTIVE（不烧帧、不绘制），可见后恢复', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    let vis: DocumentVisibilityState = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => vis)
    const c = mk(() => true, () => ({ documentKey: 'A', editorRootId: 'R' }))
    let painted = 0
    c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: 1, layoutEpoch: 1 }, () => { painted++ })
    vi.advanceTimersByTime(16 * 20)
    expect(painted).toBe(0)
    expect(c.getCounters().PARKED_INACTIVE).toBeGreaterThan(0)
    expect(c.getCounters().DEFERRED_BY_ECHO_WINDOW).toBe(0)     // frames NOT burned while hidden
    vis = 'visible'
    c.resumeOnStable('VISIBLE')
    vi.advanceTimersByTime(16 * 200)
    expect(painted).toBe(0)                                    // hold still active → still safe
    vi.restoreAllMocks()
  })

  it('T16: 计数器/状态接口稳定（供验收脚本读）', () => {
    const zero = createPresentationPaintCounters()
    for (const k of [
      'REQUESTS', 'MERGED', 'PAINTED', 'DROPPED_STALE', 'DEFERRED_BY_ECHO_WINDOW',
      'PAINT_BLOCKED_UNSTABLE', 'PARKED_INACTIVE', 'RESUMED_ON_STABLE',
      'REVISION_ADVANCED_BEFORE_PAINT', 'REVISION_UNKNOWN_AT_PAINT', 'PAINT_ERRORS',
    ] as const) {
      expect(zero[k]).toBe(0)
    }
    const c = mk(() => false, () => ({ documentKey: 'A', editorRootId: 'R' }))
    expect(c.getState()).toBe('IDLE')
    c.request('D', { documentKey: 'A', editorRootId: 'R', sourceRevision: null, layoutEpoch: null }, () => {})
    expect(c.getState()).toBe('COMMITTED')
  })
})

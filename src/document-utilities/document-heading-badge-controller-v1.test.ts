// @vitest-environment jsdom
/**
 * R14-02 — 正文诊断徽章展示 + 交互控制器测试。
 *
 * 覆盖：
 *  - 展示：具体短文案 / 优先级 / `2 +N` 聚合 / tooltip 行号 / 文档级过滤；
 *  - 交互：完整左键手势、拖拽抑制、右键不激活、键盘激活、`+N` 分组聚焦、
 *    Escape 结束聚焦、keep-open 窗口、dispose 释放监听器。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildHeadingBadgePresentation,
  HeadingBadgeInteractionController,
  type HeadingBadgeDiagnosticSource,
  type HeadingBadgeInteractionPorts,
} from './document-heading-badge-controller-v1'

function diag(
  id: string,
  code: string,
  severity: string,
  extra: Partial<HeadingBadgeDiagnosticSource> = {},
): HeadingBadgeDiagnosticSource {
  return { id, code, severity, ...extra }
}

// ── 展示 ────────────────────────────────────────────────

describe('buildHeadingBadgePresentation', () => {
  it('使用具体短文案（层级跳级 / 缺失 / 手工编号），禁止泛化分类', () => {
    const result = buildHeadingBadgePresentation({
      headingText: '实验',
      line: 9,
      diagnostics: [
        diag('d-gap', 'HEADING_LEVEL_GAP', 'error', {
          metadata: { previousLevel: 3, currentLevel: 5 },
        }),
        diag('d-missing', 'HEADING_NUMBER_MISSING', 'warning'),
        diag('d-manual', 'HEADING_MANUAL_NUMBER_PREFIX', 'warning'),
        diag('d-dup', 'HEADING_DUPLICATE_TEXT', 'warning'),
      ],
    })

    expect(result.reasonItems).toHaveLength(3)
    expect(result.reasonItems[0]).toMatchObject({ text: '层级跳级 H3→H5', kind: 'diagnostic' })
    expect(result.reasonItems[1]).toMatchObject({ text: '缺少编号', kind: 'diagnostic' })
    expect(result.reasonText).toBe('层级跳级 H3→H5')
    // P2 手工编号 + P3 重复标题被聚合进 `+2`，真实 id 仍在 summary scope 内。
    expect(result.reasonItems[2]).toMatchObject({ text: '+2', kind: 'summary', rank: -1 })
    expect(result.reasonItems[2].headingDiagnosticIds).toEqual([
      'd-gap', 'd-missing', 'd-manual', 'd-dup',
    ])
    for (const item of result.reasonItems) {
      expect(['标题问题', '文档问题', '编号问题', '格式问题']).not.toContain(item.text)
    }
  })

  it('按稳定优先级排序（P0 层级跳级 → P1 缺失），只保留两个具体徽章', () => {
    const result = buildHeadingBadgePresentation({
      headingText: '第一章',
      line: 13,
      diagnostics: [
        diag('d-manual', 'HEADING_MANUAL_NUMBER_PREFIX', 'warning'),
        diag('d-missing', 'HEADING_NUMBER_MISSING', 'warning'),
        diag('d-gap', 'HEADING_LEVEL_GAP', 'error', {
          metadata: { previousLevel: 2, currentLevel: 4 },
        }),
        diag('d-format', 'HEADING_NUMBER_FORMAT_INCONSISTENT', 'warning'),
        diag('d-dup', 'HEADING_DUPLICATE_TEXT', 'warning'),
      ],
    })

    expect(result.reasonItems.map(i => i.kind)).toEqual(['diagnostic', 'diagnostic', 'summary'])
    expect(result.reasonItems[0].text).toBe('层级跳级 H2→H4')
    expect(result.reasonItems[1].text).toBe('缺少编号')
    expect(result.reasonItems[2].text).toBe('+3')
  })

  it('tooltip 携带完整规则名 + 真实源码行号 Lxx', () => {
    const result = buildHeadingBadgePresentation({
      headingText: '实验',
      line: 9,
      diagnostics: [diag('d-gap', 'HEADING_LEVEL_GAP', 'error', {
        metadata: { previousLevel: 3, currentLevel: 5 },
      })],
    })
    expect(result.reasonItems[0].tooltip).toContain('L9')
    expect(result.reasonItems[0].tooltip).toContain('层级')
  })

  it('文档级诊断不进入正文徽章，也不计入 +N 范围', () => {
    const result = buildHeadingBadgePresentation({
      headingText: '引言',
      line: 3,
      diagnostics: [
        diag('d-doc', 'DOCUMENT_HEADINGS_ONLY_NO_BODY', 'warning', {
          metadata: { scope: 'document' },
        }),
        diag('d-missing', 'HEADING_NUMBER_MISSING', 'warning'),
      ],
    })
    expect(result.reasonItems).toHaveLength(1)
    expect(result.reasonItems[0].diagnosticId).toBe('d-missing')
    expect(result.reasonItems[0].headingDiagnosticIds).toEqual(['d-missing'])
  })

  it('语义等价规则按共享文案合并，不重复占位', () => {
    const result = buildHeadingBadgePresentation({
      headingText: '第二章',
      line: 21,
      diagnostics: [
        diag('d-seq', 'HEADING_NUMBER_SEQUENCE_INVALID', 'warning'),
        diag('d-order', 'HEADING_NUMBER_ORDER_ANOMALY', 'warning'),
      ],
    })
    expect(result.reasonItems).toHaveLength(1)
    expect(result.reasonItems[0].text).toBe('编号错序')
  })

  it('没有诊断时返回空集合与 null 主文案', () => {
    const result = buildHeadingBadgePresentation({ headingText: '空', line: null, diagnostics: [] })
    expect(result.reasonItems).toEqual([])
    expect(result.reasonText).toBeNull()
  })
})

// ── 交互 ────────────────────────────────────────────────

const ITEM = 'inkchapter-heading-diagnostic-reason__item'

interface Harness {
  controller: HeadingBadgeInteractionController
  layer: HTMLElement
  item: HTMLElement
  summary: HTMLElement
  locate: ReturnType<typeof vi.fn>
  locateFirst: ReturnType<typeof vi.fn>
  paint: ReturnType<typeof vi.fn>
  clearPaint: ReturnType<typeof vi.fn>
}

function setupHarness(): Harness {
  document.body.innerHTML = `
    <div id="layer">
      <div class="inkchapter-heading-diagnostic-marker"
           data-ink-stable-identity="id:H2:idx:0"
           data-ink-diagnostic-ids='["a","b","c"]'>
        <div class="inkchapter-heading-diagnostic-reason" data-ink-diagnostic-ids='["a","b","c"]'>
          <span class="${ITEM}" data-ink-badge-kind="diagnostic" data-ink-diagnostic-id="a" tabindex="0">层级跳级 H3→H5</span>
          <span class="${ITEM}" data-ink-badge-kind="summary" data-ink-diagnostic-id="" tabindex="0">+2</span>
        </div>
      </div>
    </div>
  `
  const layer = document.getElementById('layer') as HTMLElement
  const item = layer.querySelector<HTMLElement>(`[data-ink-badge-kind="diagnostic"]`)!
  const summary = layer.querySelector<HTMLElement>(`[data-ink-badge-kind="summary"]`)!
  const locate = vi.fn()
  const locateFirst = vi.fn()
  const paint = vi.fn()
  const clearPaint = vi.fn()
  const ports: HeadingBadgeInteractionPorts = {
    openAndLocate: locate,
    openAndLocateFirst: locateFirst,
    paintGroupFocus: paint,
    clearGroupFocusPaint: clearPaint,
    isDisposed: () => false,
  }
  const controller = new HeadingBadgeInteractionController(ports)
  controller.bind(layer)
  return { controller, layer, item, summary, locate, locateFirst, paint, clearPaint }
}

function mouse(target: Element, type: string, init: MouseEventInit = {}): Event {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    ...init,
  })
  target.dispatchEvent(ev)
  return ev
}

function key(target: Element, value: string): Event {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value })
  target.dispatchEvent(ev)
  return ev
}

describe('HeadingBadgeInteractionController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('完整左键手势（pointerdown → pointerup）激活且只激活一次', () => {
    const h = setupHarness()
    mouse(h.item, 'pointerdown')
    mouse(h.item, 'pointerup')
    expect(h.locate).toHaveBeenCalledTimes(1)
    expect(h.locate).toHaveBeenCalledWith('a')
    // 浏览器随后派发的合成 click 被 450ms 激活去重拦住。
    mouse(h.item, 'click')
    expect(h.locate).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('拖拽（位移 >6px）不激活，并抑制随后合成的 click', () => {
    const h = setupHarness()
    mouse(h.item, 'pointerdown', { clientX: 10, clientY: 10 })
    mouse(h.item, 'pointerup', { clientX: 40, clientY: 10 })
    expect(h.locate).not.toHaveBeenCalled()
    mouse(h.item, 'click')
    expect(h.locate).not.toHaveBeenCalled()
    // 抑制窗口结束后，正常点击仍可激活。
    vi.advanceTimersByTime(600)
    mouse(h.item, 'click')
    expect(h.locate).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('右键（button=2）永不激活', () => {
    const h = setupHarness()
    mouse(h.item, 'pointerdown', { button: 2 })
    mouse(h.item, 'pointerup', { button: 2 })
    mouse(h.item, 'click', { button: 2 })
    expect(h.locate).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('键盘 Enter / Space 等价点击', () => {
    const h = setupHarness()
    key(h.item, 'Enter')
    expect(h.locate).toHaveBeenCalledWith('a')
    vi.advanceTimersByTime(500)
    key(h.item, ' ')
    expect(h.locate).toHaveBeenCalledTimes(2)
    h.controller.dispose()
  })

  it('+N 汇总：打开面板并临时聚焦该标题全部诊断，6 秒后自动结束', () => {
    const h = setupHarness()
    mouse(h.summary, 'click')
    expect(h.locateFirst).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(h.paint).toHaveBeenCalledTimes(1)
    expect([...h.paint.mock.calls[0][0]]).toEqual(['a', 'b', 'c'])
    expect(h.controller.isGroupFocusActive()).toBe(true)
    vi.advanceTimersByTime(6000)
    expect(h.controller.isGroupFocusActive()).toBe(false)
    expect(h.clearPaint).toHaveBeenCalled()
    h.controller.dispose()
  })

  it('Escape 结束分组聚焦', () => {
    const h = setupHarness()
    mouse(h.summary, 'click')
    expect(h.controller.isGroupFocusActive()).toBe(true)
    key(h.item, 'Escape')
    expect(h.controller.isGroupFocusActive()).toBe(false)
    expect(h.clearPaint).toHaveBeenCalled()
    h.controller.dispose()
  })

  it('徽章激活会开启 keep-open 窗口，reset 后立即失效', () => {
    const h = setupHarness()
    expect(h.controller.shouldKeepDrawerOpen()).toBe(false)
    mouse(h.item, 'pointerdown')
    mouse(h.item, 'pointerup')
    expect(h.controller.shouldKeepDrawerOpen()).toBe(true)
    h.controller.resetKeepDrawerOpen()
    expect(h.controller.shouldKeepDrawerOpen()).toBe(false)
    h.controller.dispose()
  })

  it('dispose 后不再响应手势，并清除分组聚焦定时器', () => {
    const h = setupHarness()
    mouse(h.summary, 'click')
    expect(h.controller.isGroupFocusActive()).toBe(true)
    h.controller.dispose()
    expect(h.controller.isGroupFocusActive()).toBe(false)
    mouse(h.item, 'pointerup')
    expect(h.locate).not.toHaveBeenCalled()
  })
})

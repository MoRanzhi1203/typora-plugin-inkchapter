// @vitest-environment jsdom
/**
 * P0 — 诊断备注侵入正文光标导航：结构修复 + 门禁 的可判错测试。
 *
 * 这些断言会**在修复被移除时失败**：
 *  - 未标记的插件文字位于 `#write` 可编辑树内时，`scanDiagnosticTextInEditableTree` 必须 > 0；
 *  - 标记 `stampCaretInertPresentation()` 之后必须为 0；
 *  - 生产代码必须在 `appendChild(layer)` **之前**完成标记。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

vi.mock('../runtime/forensic-log-sink', () => ({ emitRuntimeAudit: vi.fn() }))

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import {
  PRESENTATION_ATTR,
  createCaretIsolationCounters,
  evaluateCaretIsolationGates,
  formatCaretIsolationGateReport,
  findContenteditableAncestor,
  getCaretIsolationCounters,
  isCaretInertPresentation,
  isPluginPresentationNode,
  refreshCaretIsolationDomCounters,
  resetCaretIsolationCounters,
  scanDiagnosticTextInEditableTree,
  scheduleNavigationPostDefaultAudit,
  stampCaretInertPresentation,
  summarizeCaretSite,
} from './document-diagnostic-caret-isolation-v1'

function world(): { write: HTMLElement; layer: HTMLElement; label: HTMLElement } {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  document.body.appendChild(write)
  const layer = document.createElement('div')
  layer.className = 'inkchapter-locate-document-layer'
  write.appendChild(layer)
  const label = document.createElement('div')
  label.className = 'inkchapter-heading-diagnostic-reason'
  label.textContent = '空行过多'
  layer.appendChild(label)
  return { write, layer, label }
}

describe('P0 caret isolation — 诊断文字必须脱离可编辑树', () => {
  it('stamp:contenteditable=false + tabindex=-1 + user-select:none；装饰再禁 pointer-events', () => {
    const el = document.createElement('div')
    stampCaretInertPresentation(el, false)
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect(el.getAttribute(PRESENTATION_ATTR)).toBe('decorative')
    expect(el.style.userSelect).toBe('none')
    expect(el.style.pointerEvents).toBe('none')
    expect(isCaretInertPresentation(el)).toBe(true)

    const interactive = document.createElement('div')
    stampCaretInertPresentation(interactive, true)
    expect(interactive.getAttribute(PRESENTATION_ATTR)).toBe('interactive')
    expect(interactive.style.pointerEvents).toBe('') // 可交互节点不被禁用点击
    expect(isCaretInertPresentation(interactive)).toBe(true)
  })

  it('REGRESSION: 未标记的插件文字在 #write 内被计为 1，标记后归零', () => {
    const { write, layer, label } = world()
    expect(isPluginPresentationNode(label)).toBe(true)
    expect(findContenteditableAncestor(label)).toBe(write)

    let scan = scanDiagnosticTextInEditableTree(write)
    expect(scan.count).toBeGreaterThanOrEqual(1) // 修复前 = 光标可进入的真实缺陷
    expect(scan.samples.join('|')).toContain('空行过多')

    stampCaretInertPresentation(layer, false)
    scan = scanDiagnosticTextInEditableTree(write)
    expect(scan.count).toBe(0) // 修复后 = 光标惰性孤岛
    expect(isCaretInertPresentation(label)).toBe(true)
  })

  it('summarizeCaretSite 报告 展示归属 + 是否光标惰性', () => {
    const { write, layer, label } = world()
    const before = summarizeCaretSite(label.firstChild, write)
    expect(before.insideWrite).toBe(true)
    expect(before.insidePluginPresentation).toBe(true)
    expect(before.caretInert).toBe(false)
    expect(before.contenteditableAncestorIsWrite).toBe(true)

    stampCaretInertPresentation(layer, false)
    const after = summarizeCaretSite(label.firstChild, write)
    expect(after.caretInert).toBe(true)
  })

  it('GATE: 全 0 PASS；任一非 0 FAIL 并列出失败项', () => {
    const zero = createCaretIsolationCounters()
    expect(evaluateCaretIsolationGates(zero).decision).toBe('PASS')
    const bad = { ...zero, DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT: 2 }
    const r = evaluateCaretIsolationGates(bad)
    expect(r.decision).toBe('FAIL')
    expect(r.failing).toEqual(['DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT'])
    expect(formatCaretIsolationGateReport(bad).join('\n')).toContain('CARET_ISOLATION_GATE=FAIL')
  })

  it('CONTRACT: 生产层在 appendChild 之前完成标记', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const fn = src.indexOf('private ensureLocateDocumentLayer')
    expect(fn).toBeGreaterThan(-1)
    const stamp = src.indexOf('stampCaretInertPresentation(layer', fn)
    const append = src.indexOf('host.appendChild(layer)', fn)
    expect(stamp).toBeGreaterThan(fn)
    expect(append).toBeGreaterThan(stamp) // 标记必须先于挂载
    const marker = src.indexOf('private ensureHeadingMarkerLayer')
    expect(src.indexOf('stampCaretInertPresentation(layer', marker)).toBeGreaterThan(marker)
  })

  it('GATE-SCOPE: 插件自身 UI（#write 之外）不计入序列化指标；树内未标记文字计入', () => {
    resetCaretIsolationCounters()
    const { write, label } = world() // layer 未标记
    // 插件自身 UI 挂在 document.body（不是文档内容）
    const chrome = document.createElement('div')
    chrome.className = 'inkchapter-toolbar'
    chrome.textContent = 'Problems 9'
    document.body.appendChild(chrome)

    refreshCaretIsolationDomCounters(write)
    // 只有 #write 内未标记的 label 计入；toolbar 不计入
    expect(getCaretIsolationCounters().NON_MARKDOWN_TEXT_SERIALIZED_COUNT).toBe(1)

    // 容器标记后 → 0
    stampCaretInertPresentation(label.parentElement as HTMLElement, false)
    refreshCaretIsolationDomCounters(write)
    expect(getCaretIsolationCounters().NON_MARKDOWN_TEXT_SERIALIZED_COUNT).toBe(0)
    expect(getCaretIsolationCounters().DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT).toBe(0)
  })

  it('AUDIT: ArrowDown 默认行为后发出真实 Selection 审计；非导航键不触发', () => {
    vi.useFakeTimers()
    try {
      resetCaretIsolationCounters()
      const { write, layer } = world()
      stampCaretInertPresentation(layer, false)
      // 插入点位于真实段落
      const real = document.createElement('p')
      real.className = 'md-p'
      real.textContent = 'last real paragraph'
      write.appendChild(real)
      const range = document.createRange()
      range.setStart(real.firstChild!, 0)
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)

      const spy = emitRuntimeAudit as unknown as { mockClear: () => void; mock: { calls: unknown[][] } }
      spy.mockClear()
      scheduleNavigationPostDefaultAudit('ArrowDown', true, false, {
        documentKey: 'doc.md', buildShaOrMarker: 'marker', editorRoot: write,
        editorRootIdentity: 'DIV#write', sourceRevision: 7,
      })
      vi.runOnlyPendingTimers()
      const call = spy.mock.calls.find(c => String(c[0]).includes('DOCUMENT-DIAGNOSTIC-NAV-POST-DEFAULT-SELECTION'))
      expect(call).toBeTruthy()
      const payload = call![1] as Record<string, unknown>
      expect(payload.key).toBe('ArrowDown')
      expect(payload.isTrusted).toBe(true)
      expect(payload.sourceRevision).toBe(7)
      expect(payload.anchorInsidePluginPresentation).toBe(false)

      // 非导航键 → 不产生新审计
      const n = spy.mock.calls.length
      scheduleNavigationPostDefaultAudit('Enter', true, false, {
        documentKey: 'doc.md', buildShaOrMarker: 'marker', editorRoot: write,
        editorRootIdentity: 'DIV#write', sourceRevision: 7,
      })
      vi.runOnlyPendingTimers()
      expect(spy.mock.calls.length).toBe(n)

      // 插入点进入**未隔离**的插件展示文字 → 真实 DOM 判定为违规并计数 +1
      const { write: write2, label: label2 } = world() // 未 stamp 的对照世界
      const onLabel = document.createRange()
      onLabel.setStart(label2.firstChild!, 0)
      onLabel.collapse(true)
      sel.removeAllRanges()
      sel.addRange(onLabel)
      scheduleNavigationPostDefaultAudit('ArrowDown', true, false, {
        documentKey: 'doc.md', buildShaOrMarker: 'marker', editorRoot: write2,
        editorRootIdentity: 'DIV#write', sourceRevision: 8,
      })
      vi.runOnlyPendingTimers()
      const last = spy.mock.calls.at(-1)!
      expect(String(last[0])).toContain('DOCUMENT-DIAGNOSTIC-NAV-POST-DEFAULT-SELECTION')
      expect((last[1] as Record<string, unknown>).anchorInsidePluginPresentation).toBe(true)
      expect(getCaretIsolationCounters().SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  beforeEach(() => { resetCaretIsolationCounters() })
})

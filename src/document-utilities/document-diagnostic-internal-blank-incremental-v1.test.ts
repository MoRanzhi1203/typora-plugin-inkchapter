// @vitest-environment jsdom
/**
 * 空行规则编辑期增量重算 — 脏区间纯函数测试。
 *
 * 契约：
 *   - 可定位的普通块编辑 → 输出 ±padding 的行区间；
 *   - 结构敏感容器（代码围栏/公式/表格/HTML/front-matter/列表/引用）→ 全量兜底；
 *   - 无法定位源码行 → 全量兜底（绝不猜测）。
 */
import { describe, it, expect } from 'vitest'
import {
  BLANK_STRUCTURE_SENSITIVE_SELECTOR,
  dirtyLineCount,
  exceedsDirtyRatio,
  mergeDirtyLineRanges,
  scanBlankDirtyRanges,
} from './document-diagnostic-internal-blank-incremental-v1'

function recordOf(target: Node, nextSibling: Node | null = null): MutationRecord {
  return { target, nextSibling } as unknown as MutationRecord
}

/** 与 host 相同的行解析规则：最近的 `[data-line]` 祖先。 */
function lineOfNode(node: Node): number | null {
  const el: Element | null = node.nodeType === 1 ? node as Element : node.parentElement
  const host = el?.closest('[data-line]') ?? null
  const raw = host?.getAttribute('data-line') ?? null
  if (raw == null || raw === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function mount(tag: string, line: number | null, className?: string): { host: HTMLElement; text: Text } {
  const host = document.createElement(tag)
  if (line != null) host.setAttribute('data-line', String(line))
  if (className != null) host.className = className
  const text = document.createTextNode('内容')
  host.appendChild(text)
  document.body.appendChild(host)
  return { host, text }
}

describe('mergeDirtyLineRanges — 合并与扩张', () => {
  it('重叠/相邻区间合并，并按 padding 向外扩张', () => {
    expect(mergeDirtyLineRanges([{ start: 10, end: 12 }, { start: 13, end: 14 }], 0))
      .toEqual([{ start: 10, end: 14 }])
    expect(mergeDirtyLineRanges([{ start: 10, end: 10 }], 2))
      .toEqual([{ start: 8, end: 12 }])
  })

  it('乱序输入会排序；空输入返回空', () => {
    expect(mergeDirtyLineRanges([{ start: 20, end: 20 }, { start: 5, end: 5 }], 0))
      .toEqual([{ start: 5, end: 5 }, { start: 20, end: 20 }])
    expect(mergeDirtyLineRanges([], 2)).toEqual([])
  })

  it('负行号被夹到 0', () => {
    expect(mergeDirtyLineRanges([{ start: 0, end: 0 }], 3)).toEqual([{ start: 0, end: 3 }])
  })
})

describe('dirtyLineCount / exceedsDirtyRatio', () => {
  it('统计总行数', () => {
    expect(dirtyLineCount([{ start: 0, end: 4 }, { start: 10, end: 11 }])).toBe(7)
  })

  it('超过 20% 判定为过宽', () => {
    expect(exceedsDirtyRatio([{ start: 0, end: 30 }], 100)).toBe(true)
    expect(exceedsDirtyRatio([{ start: 0, end: 5 }], 100)).toBe(false)
    expect(exceedsDirtyRatio([{ start: 0, end: 5 }], 0)).toBe(true)
  })
})

describe('scanBlankDirtyRanges — 普通块', () => {
  it('可定位的段落编辑 → 行区间（含 padding）', () => {
    const { text } = mount('p', 5)
    const scan = scanBlankDirtyRanges([recordOf(text)], lineOfNode)
    expect(scan.requiresFullScan).toBe(false)
    expect(scan.ranges).toEqual([{ start: 3, end: 7 }])
  })

  it('多批记录合并为一个区间', () => {
    const a = mount('p', 5)
    const b = mount('p', 8)
    const scan = scanBlankDirtyRanges([recordOf(a.text), recordOf(b.text)], lineOfNode)
    expect(scan.ranges).toEqual([{ start: 3, end: 10 }])
  })
})

describe('scanBlankDirtyRanges — 全量兜底', () => {
  it('代码围栏内编辑 → STRUCTURE_CONTAINER', () => {
    const { text } = mount('pre', 3, 'md-fences')
    const scan = scanBlankDirtyRanges([recordOf(text)], lineOfNode)
    expect(scan.requiresFullScan).toBe(true)
    expect(scan.fullScanReason).toBe('STRUCTURE_CONTAINER')
  })

  it('列表 / 表格 / 公式 / HTML / front-matter 均属结构敏感', () => {
    for (const [tag, cls] of [
      ['ul', ''],
      ['table', ''],
      ['div', 'md-math-block'],
      ['div', 'md-htmlblock'],
      ['div', 'md-frontmatter'],
      ['blockquote', ''],
    ] as const) {
      const { text } = mount(tag, 2, cls)
      const scan = scanBlankDirtyRanges([recordOf(text)], lineOfNode)
      expect(scan.requiresFullScan, `${tag}.${cls}`).toBe(true)
    }
  })

  it('无法定位源码行 → UNMAPPED_TARGET', () => {
    const { text } = mount('p', null)
    const scan = scanBlankDirtyRanges([recordOf(text)], lineOfNode)
    expect(scan.requiresFullScan).toBe(true)
    expect(scan.fullScanReason).toBe('UNMAPPED_TARGET')
  })

  it('结构敏感选择器是公开契约的一部分', () => {
    expect(BLANK_STRUCTURE_SENSITIVE_SELECTOR).toContain('pre.md-fences')
    expect(BLANK_STRUCTURE_SENSITIVE_SELECTOR).toContain('ul')
  })
})

/**
 * Paragraph Indent V2 — Empty paragraph LINE BOX (RED → GREEN).
 *
 * Real-GUI fact (2026-10-30, build 671800FF, EMPTY-SPECIAL-EMPTY-VISUAL-PROJECTION):
 *
 *   childNodeCount=0, innerHTML="", indentMarkerAttr="explicit-2",
 *   afterContent="\u200B", afterPosition="absolute", afterWidth/Height=11.51px,
 *   rectHeight=0, lineHeight=25.6px
 *
 * A native empty paragraph has NO children; Typora gives it its line box with
 *     #write .md-p:empty:after { content: '\200B' }        (base-control.css)
 * The plugin's marker rule targets the SAME ::after pseudo element and makes it
 * `position: absolute` with a 0.72em box, so the only in-flow content of the
 * empty paragraph disappears and `getBoundingClientRect().height` becomes 0.
 * That is the root cause of D-06 (no real indent line), D-07 (the next line
 * overlaps) and D-08 (one Enter appears to act twice — the zero-height row is
 * re-laid-out on the next keystroke).
 *
 * The fix must keep Typora's ::after line box on `:empty` paragraphs and still
 * draw BOTH dashed boxes, out of flow, without adding text / zero-width chars /
 * extra nodes and without a fixed paragraph height.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyIndentMarkerProjection,
  INDENT_MARKER_ATTR,
} from './paragraph-indent-manager'

const scss = readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')
const blockStart = scss.indexOf('/* ── Two-character first-line indent marker')
const blockEnd = scss.indexOf('/* ── Settings page: live preview', blockStart)
const markerBlock = blockStart >= 0 && blockEnd > blockStart ? scss.slice(blockStart, blockEnd) : ''

/** Marker rules only — comments name the forbidden properties by design. */
const rules = markerBlock.replace(/\/\*[\s\S]*?\*\//g, '')

interface CssRule {
  selector: string
  body: string
}

const parsedRules: CssRule[] = []
for (const match of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  parsedRules.push({ selector: match[1].trim(), body: match[2] })
}

/** `:empty` that is NOT the `:not(:empty)` guard. */
const isPlainEmptySelector = (selector: string): boolean =>
  /:empty/.test(selector) && !selector.includes(':not(:empty)')

describe('LINE-BOX-1 标记方框不得占用 Typora 的空段落 ::after 行盒', () => {
  it('定位标记 ::after 的规则必须排除 :empty', () => {
    const positioning = parsedRules.filter(
      r => r.selector.includes('::after') && r.body.includes('position: absolute'),
    )
    expect(positioning.length).toBeGreaterThan(0)
    const offenders = positioning.filter(r => !r.selector.includes(':not(:empty)'))
    expect(offenders.map(r => r.selector)).toEqual([])
  })

  it('空段落标记规则不得声明 ::after（行盒宿主必须留给 Typora）', () => {
    const emptyAfterRules = parsedRules.filter(
      r => isPlainEmptySelector(r.selector) && r.selector.includes('::after'),
    )
    expect(emptyAfterRules.map(r => r.selector)).toEqual([])
  })
})

describe('LINE-BOX-2 空段落仍然显示两个方框（不占位、不加内容）', () => {
  const emptyRules = parsedRules.filter(r => isPlainEmptySelector(r.selector))

  it('存在 :empty 专用标记规则，且只使用 ::before', () => {
    expect(emptyRules.length).toBeGreaterThan(0)
    for (const rule of emptyRules) {
      expect(rule.selector).toContain('data-inkchapter-indent-marker')
    }
    expect(emptyRules.some(r => r.selector.includes('::before'))).toBe(true)
  })

  it('两个方框由一个遮罩模板绘制（两个 <rect>）', () => {
    const stencil = emptyRules.map(r => r.body).join('\n')
    expect(stencil).toContain('mask')
    // The stencil is a data: URI, so `<rect` may be percent-encoded; it is
    // declared for both the prefixed and the unprefixed mask property.
    const rects = stencil.match(/<rect|%3Crect/gi) ?? []
    expect(rects.length).toBeGreaterThanOrEqual(2)
  })
})

describe('LINE-BOX-3 不得用固定高度 / 新内容掩盖根因', () => {
  it('标记区块不设置 min-height，段落本身不设置 height', () => {
    expect(rules).not.toContain('min-height')
    const paragraphHeightRules = parsedRules.filter(
      r => !r.selector.includes('::') && /\bheight\s*:/.test(r.body),
    )
    expect(paragraphHeightRules.map(r => r.selector)).toEqual([])
  })

  it('标记投影绝不向空段落写入文本节点 / 零宽字符', () => {
    document.body.innerHTML = '<p id="p"></p>'
    const p = document.getElementById('p') as HTMLElement
    applyIndentMarkerProjection(p, 'force-indent')

    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')
    expect(p.childNodes.length).toBe(0)
    expect(p.textContent).toBe('')
    expect(p.innerHTML).toBe('')
  })
})

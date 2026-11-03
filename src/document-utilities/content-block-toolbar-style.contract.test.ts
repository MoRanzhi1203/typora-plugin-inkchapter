/**
 * 内容块工具栏 — 样式契约（读 src/style.scss 文本断言，不编译 SCSS）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

function ruleBody(selector: string): string {
  const start = scss.indexOf(selector)
  if (start < 0) return ''
  const open = scss.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < scss.length; i++) {
    if (scss[i] === '{') depth++
    else if (scss[i] === '}') {
      depth--
      if (depth === 0) return scss.slice(open + 1, i)
    }
  }
  return ''
}

describe('CONTENT-TOOLBAR-STYLE image actions', () => {
  it('binds the image bar to a relative image container and keeps it hidden by default', () => {
    expect(ruleBody('.inkchapter-image-actions-anchor {')).toContain('position: relative')
    const bar = ruleBody('.inkchapter-content-toolbar--image {')
    expect(bar).toContain('top: 6px')
    expect(bar).toContain('right: 6px')
    expect(bar).toContain('opacity: 0')
    expect(bar).toContain('visibility: hidden')
    expect(bar).toContain('pointer-events: none')
  })

  it('paints 28px rounded image buttons and theme tokens', () => {
    const btn = ruleBody(
      '.inkchapter-content-toolbar--image .inkchapter-content-toolbar__btn {',
    )
    expect(btn).toContain('width: 28px')
    expect(btn).toContain('height: 28px')
    expect(btn).toContain('border-radius: 6px')
    expect(btn).toContain('var(--ink-ui-bg-surface')
  })

  it('renders the more-actions menu above the image and keeps it non-layout', () => {
    const menu = ruleBody('.inkchapter-content-toolbar__menu {')
    expect(menu).toContain('position: absolute')
    expect(menu).toContain('top: calc(100% + 4px)')
    expect(menu).toContain('pointer-events: auto')
  })
})

describe('CONTENT-TOOLBAR-STYLE shell', () => {
  it('declares a non-interactive wrapper and interactive buttons', () => {
    const wrapper = ruleBody('.inkchapter-content-toolbar {')
    expect(wrapper).toContain('pointer-events: none')
    expect(wrapper).toContain('position: absolute')
    const button = ruleBody('.inkchapter-content-toolbar__btn {')
    expect(button).toContain('pointer-events: auto')
    expect(button).toContain('26px')
  })

  it('does not introduce a new z-index layer (reuses the 900 overlay context)', () => {
    expect(ruleBody('.inkchapter-content-toolbar {')).not.toContain('z-index')
  })

  it('uses plugin-scoped theme tokens instead of hard-coded colors', () => {
    const wrapper = ruleBody('.inkchapter-content-toolbar {')
    expect(wrapper).toContain('var(--ink-ui-bg-surface')
    expect(wrapper).toContain('var(--ink-ui-border')
  })

  it('respects prefers-reduced-motion', () => {
    expect(scss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(scss).toContain('.inkchapter-content-toolbar__btn')
    expect(scss).toContain('animation: none')
  })

  it('never animates the always-on language bar', () => {
    const bar = ruleBody('.inkchapter-content-toolbar--langbar {')
    expect(bar).toContain('transition: none')
  })
})

describe('CONTENT-TOOLBAR-STYLE V3 language bar', () => {
  it('pins the bar inside the fence so it shares the native scroll coordinate system', () => {
    const bar = ruleBody('.inkchapter-content-toolbar--langbar {')
    expect(bar).toContain('position: absolute')
    expect(bar).toContain('top: 0')
    expect(bar).toContain('left: 0')
    expect(bar).toContain('width: 100%')
    expect(bar).not.toContain('transition: opacity')
  })

  it('reserves in-block space for the language bar without touching Markdown', () => {
    const fence = ruleBody("#write pre[data-inkchapter-langbar='true'] {")
    expect(fence).toContain('position: relative')
    expect(fence).toContain('padding-top: 34px')
  })

  it('renders badge / language / line count and 28px copy + fold hit areas', () => {
    expect(ruleBody('.inkchapter-content-toolbar__badge {')).toContain('font-family: var(--font-monospace')
    expect(ruleBody('.inkchapter-content-toolbar__lang {')).toContain('font-size: 12px')
    expect(ruleBody('.inkchapter-content-toolbar__lines {')).toContain('font-size: 11px')
    expect(ruleBody('.inkchapter-content-toolbar__btn--copy {')).toContain('margin-left: auto')
    expect(ruleBody('.inkchapter-content-toolbar__btn--fold {')).toContain('margin-left: 2px')
    const sized = ruleBody(
      '.inkchapter-content-toolbar--langbar .inkchapter-content-toolbar__btn {',
    )
    expect(sized).toContain('width: 28px')
    expect(sized).toContain('height: 28px')
  })
})

describe('CONTENT-TOOLBAR-STYLE bottom fold arrow', () => {
  const BOTTOM =
    "#write pre[data-inkchapter-langbar='true'] .inkchapter-content-toolbar__btn--fold-bottom {"

  it('pins a 28x28 hit area on the bottom border without taking layout space', () => {
    const rule = ruleBody(BOTTOM)
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('left: 50%')
    expect(rule).toContain('bottom: -14px')
    expect(rule).toContain('width: 28px')
    expect(rule).toContain('height: 28px')
    expect(rule).not.toContain('padding-bottom')
    expect(rule).not.toContain('box-shadow: 0')
  })

  it('blends into the code container and keeps a 16px chevron', () => {
    const rule = ruleBody(BOTTOM)
    expect(rule).toContain('background: transparent')
    expect(rule).toContain('border-radius')
    expect(rule).toContain('width: 16px')
    expect(rule).toContain('height: 16px')
  })

  it('uses theme tokens so both light and dark themes stay legible', () => {
    expect(ruleBody(BOTTOM)).toContain('var(--text-color')
  })

  it('never reserves a bottom fold band', () => {
    expect(scss).not.toContain('--ink-fold-bottom-band')
    expect(scss).not.toContain('padding-bottom: 36px')
  })

  it('shifts a below-caption only when the bottom control exists', () => {
    const rule = ruleBody(
      "#write pre.md-fences[data-inkchapter-caption='true'][data-inkchapter-fold-control='true'][data-inkchapter-caption-position='below']::before {",
    )
    expect(rule).toContain('top: calc(100% + 10px)')
  })
})

describe('CONTENT-TOOLBAR-STYLE V3 folded preview', () => {
  it('clips only the CodeMirror height and keeps the PRE (and its caption) unclipped', () => {
    const cm = ruleBody("#write pre[data-inkchapter-code-folded='true'] > .CodeMirror {")
    expect(cm).toContain('max-height: var(--ink-fold-preview-height')
    expect(cm).toContain('overflow: hidden')
    // PRE 自身不得出现 overflow/固定高度规则（题注与选中态不被裁切）。
    expect(scss).not.toMatch(/#write pre\[data-inkchapter-code-folded='true'\]\s*\{[^}]*overflow/)
  })

  it('paints a 20px soft fade and never reserves a bottom fold band', () => {
    const fade = ruleBody("#write pre[data-inkchapter-code-folded='true']::after {")
    expect(fade).toContain('linear-gradient')
    expect(fade).toContain('pointer-events: none')
    expect(fade).toContain('height: 20px')
    expect(fade).toContain('bottom: 0')
    expect(scss).not.toContain('--ink-fold-band')
    expect(scss).not.toContain('data-inkchapter-code-foldable')
    expect(scss).not.toContain('.inkchapter-code-foldbar')
  })

  it('keeps the bottom padding untouched so expanded code has its natural height', () => {
    expect(scss).not.toContain('padding-bottom: 36px')
  })

  it('supports code captions above and below the fence', () => {
    const below = ruleBody(
      "#write pre.md-fences[data-inkchapter-caption='true'][data-inkchapter-caption-position='below']::before {",
    )
    expect(below).toContain('top: 100%')
    expect(below).toContain('bottom: auto')
    expect(scss).toContain("#write pre.md-fences[data-inkchapter-caption='true']::before")
  })

  it('never authors a global .md-fences rule (code typography stays untouched)', () => {
    expect(scss).not.toContain('.md-fences.inkchapter-code-folded')
  })
})

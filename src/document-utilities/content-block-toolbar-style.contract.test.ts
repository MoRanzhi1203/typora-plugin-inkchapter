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
    expect(scss).toContain('.inkchapter-code-foldbar__btn')
    expect(scss).toContain('animation: none')
  })

  it('never animates the always-on language bar', () => {
    const bar = ruleBody('.inkchapter-content-toolbar--langbar {')
    expect(bar).toContain('transition: none')
  })
})

describe('CONTENT-TOOLBAR-STYLE V3 language bar', () => {
  it('reserves in-block space for the language bar without touching Markdown', () => {
    const fence = ruleBody("#write pre[data-inkchapter-langbar='true'] {")
    expect(fence).toContain('position: relative')
    expect(fence).toContain('padding-top: 34px')
  })

  it('renders badge / language / line count and keeps only the copy button interactive', () => {
    expect(ruleBody('.inkchapter-content-toolbar__badge {')).toContain('font-family: var(--font-monospace')
    expect(ruleBody('.inkchapter-content-toolbar__lang {')).toContain('font-size: 12px')
    expect(ruleBody('.inkchapter-content-toolbar__lines {')).toContain('font-size: 11px')
    expect(ruleBody('.inkchapter-content-toolbar__btn--copy {')).toContain('margin-left: auto')
    expect(ruleBody('.inkchapter-code-foldbar__btn {')).toContain('pointer-events: auto')
  })
})

describe('CONTENT-TOOLBAR-STYLE V3 folded preview', () => {
  it('clips only the CodeMirror height and keeps the PRE (and its caption) unclipped', () => {
    const pre = ruleBody("#write pre[data-inkchapter-code-folded='true'] {")
    expect(pre).toContain('position: relative')
    expect(pre).not.toContain('overflow: hidden')
    expect(pre).not.toContain('height: 44px')
    const cm = ruleBody("#write pre[data-inkchapter-code-folded='true'] > .CodeMirror {")
    expect(cm).toContain('max-height: var(--ink-fold-preview-height')
    expect(cm).toContain('overflow: hidden')
  })

  it('paints a soft fade instead of removing the code body', () => {
    const fade = ruleBody("#write pre[data-inkchapter-code-folded='true']::after {")
    expect(fade).toContain('linear-gradient')
    expect(fade).toContain('pointer-events: none')
    expect(fade).not.toContain('attr(data-inkchapter-fold-summary)')
    expect(fade).toContain('bottom: var(--ink-fold-band')
  })

  it('reserves an in-block fold band so the fold control never covers code or caption', () => {
    const band = ruleBody("#write pre[data-inkchapter-code-foldable='true'] {")
    expect(band).toContain('padding-bottom: 36px')
    expect(band).toContain('--ink-fold-band: 36px')
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

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
    const start = scss.lastIndexOf('@media (prefers-reduced-motion: reduce)')
    expect(start).toBeGreaterThan(-1)
    const block = scss.slice(start, start + 400)
    expect(block).toContain('.inkchapter-content-toolbar')
    expect(block).toContain('animation: none')
  })
})

describe('CONTENT-TOOLBAR-STYLE folded fence projection', () => {
  it('hides only the code body, keeping the fence (and its caption) intact', () => {
    const collapsed = ruleBody("#write pre[data-inkchapter-code-folded='true'] {")
    expect(collapsed).toContain('position: relative')
    expect(collapsed).toContain('height: 44px')
    expect(scss).toContain("#write pre[data-inkchapter-code-folded='true'] > .CodeMirror")
    expect(scss).toContain('display: none !important')
  })

  it('paints the folded placeholder from a data attribute', () => {
    const placeholder = ruleBody("#write pre[data-inkchapter-code-folded='true']::after {")
    expect(placeholder).toContain('attr(data-inkchapter-fold-summary)')
    expect(placeholder).toContain('pointer-events: none')
  })

  it('never authors a global .md-fences rule (code typography stays untouched)', () => {
    expect(scss).not.toContain('.md-fences.inkchapter-code-folded')
  })

  it('never targets the Markdown caption pseudo element', () => {
    // 折叠占位必须用 ::after；题注仍是 ::before。
    expect(scss).toContain("#write pre.md-fences[data-inkchapter-caption='true']::before")
  })
})

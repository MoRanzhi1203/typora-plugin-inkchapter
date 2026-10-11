// Document Diagnostics Drawer UI V2 — presentation contract.
//
// jsdom cannot compile SCSS, so (like the existing style contract tests) this
// asserts against the SCSS SOURCE plus the pure layout authority. It proves the
// 精修 requirements:
//   - the sort/type/group controls are ONE wrapping row (stacked when narrow);
//   - the problem-type + sort controls are compact dropdowns, not button rows;
//   - the card keeps ONE description by default and a COLLAPSIBLE advice;
//   - ordinary advice uses a SECONDARY text colour, never the link blue;
//   - card padding / spacing / dividers are reduced.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const css = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * Extract the declaration body of a LINE-ANCHORED selector rule. When a
 * selector is declared more than once (legacy + current), the LAST declaration
 * is the live one.
 */
function bodyOf(selectorPattern: string): string {
  const re = new RegExp(`^${selectorPattern}\\s*\\{([^}]*)\\}`, 'gm')
  const matches = [...css.matchAll(re)]
  expect(matches.length, `rule "${selectorPattern}" must exist`).toBeGreaterThan(0)
  return matches[matches.length - 1][1]
}

describe('Drawer UI V2 — control strip is ONE responsive row', () => {
  it('the view-order strip is a flex row that wraps', () => {
    const body = bodyOf("\\.inkchapter-doc-drawer__vieworder")
    expect(body).toContain('display: flex')
    expect(body).toContain('flex-wrap: wrap')
  })

  it('a very narrow Drawer switches to a stacked layout', () => {
    const body = bodyOf("\\.inkchapter-doc-drawer__vieworder\\[data-layout='stacked'\\]")
    expect(body).toContain('flex-direction: column')
  })

  it('sort / type are compact <select> controls that can shrink', () => {
    const body = bodyOf('\\.inkchapter-doc-drawer__select')
    expect(body).toContain('min-width: 0')
    expect(body).toContain('max-width: 100%')
  })

  it('the group toggle has an explicit selected state', () => {
    const active = bodyOf('\\.inkchapter-doc-drawer__group-toggle\\.is-active')
    expect(active).toContain('--ink-ui-primary')
    expect(active).toContain('font-weight: 600')
    expect(bodyOf('\\.inkchapter-doc-drawer__group-toggle-mark')).toContain('width: 1em')
  })

  it('the legacy button-row controls are gone', () => {
    expect(css).not.toContain('.inkchapter-doc-drawer__sort-tab')
    expect(css).not.toContain('.inkchapter-doc-drawer__typefilter-tab')
  })
})

describe('Drawer UI V2 — unified card', () => {
  it('the default card is compact (reduced padding / gap)', () => {
    const body = bodyOf('\\.inkchapter-doc-drawer__item')
    expect(body).toContain('padding: 6px 9px')
    expect(body).toContain('gap: 6px')
  })

  it('ordinary advice uses a SECONDARY colour, never the link blue', () => {
    const body = bodyOf('\\.inkchapter-doc-drawer__item-suggestion')
    expect(body).toContain('--ink-ui-text-muted')
    expect(body).not.toContain('--ink-ui-primary')
  })

  it('the advice can be collapsed (hidden rule exists) and is toggled by a compact control', () => {
    expect(bodyOf('\\.inkchapter-doc-drawer__item-suggestion\\[hidden\\]')).toContain('display: none')
    expect(bodyOf('\\.inkchapter-doc-drawer__item-more')).toContain('cursor: pointer')
  })

  it('the active row keeps a low-saturation wash (no hard fill)', () => {
    expect(css).toMatch(/--ink-drawer-active-wash:\s*9%/)
    expect(css).toMatch(/--ink-drawer-active-wash:\s*7%/)
  })
})

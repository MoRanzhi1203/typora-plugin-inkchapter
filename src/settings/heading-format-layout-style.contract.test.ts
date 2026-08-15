// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Style contract for the format editor layout. Reads the SCSS source directly
// (jsdom does not apply media queries), asserting the required breakpoints and
// shrink rules are present so narrow viewports never force a two-column editor
// or clip form controls.
const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('HF3 style contract: format editor layout', () => {
  it('wide: dual-column editor uses minmax(0,1fr) + 300px preview', () => {
    expect(scss).toMatch(/\.inkchapter-editor-dual-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/s)
  })

  it('narrow: breakpoint at 1100px collapses editor to a single column', () => {
    const cleaned = stripComments(scss)
    const block = cleaned.match(/@media\s*\(max-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
    expect(block).toBeTruthy()
    expect(block![1]).toMatch(/\.inkchapter-editor-dual-col\s*\{[^}]*grid-template-columns:\s*1fr/s)
  })

  it('narrow: preview moves below and takes full width', () => {
    const cleaned = stripComments(scss)
    const block = cleaned.match(/@media\s*\(max-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
    expect(block).toBeTruthy()
    expect(block![1]).toMatch(/\.inkchapter-editor-preview-col\s*\{[^}]*position:\s*static[^}]*width:\s*100%/s)
  })

  it('narrow: label/behavior side-by-side is disabled', () => {
    const cleaned = stripComments(scss)
    const block = cleaned.match(/@media\s*\(max-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
    expect(block).toBeTruthy()
    expect(block![1]).toMatch(/\.inkchapter-config-dual-row\s*\{[^}]*grid-template-columns:\s*1fr/s)
  })

  it('form controls allow shrink (no fixed-width clipping)', () => {
    expect(scss).toMatch(/\.inkchapter-editor-main\s*\{[^}]*select[^}]*min-width:\s*0[^}]*box-sizing:\s*border-box/s)
  })

  it('④ heading layout uses a compact wrapping grid', () => {
    expect(scss).toMatch(/\.inkchapter-layout-config-grid\s*\{[^}]*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\)/s)
    expect(scss).toMatch(/\.inkchapter-layout-config-controls\s*\{[^}]*flex-wrap:\s*wrap/s)
  })

  it('H1-H6 tabs wrap and do not force content width', () => {
    expect(scss).toMatch(/\.inkchapter-level-tabs\s*\{[^}]*flex-wrap:\s*wrap/s)
  })
})

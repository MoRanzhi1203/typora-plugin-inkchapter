// Phase 7R.3.10 — Shared Object Caption Typography Authority contract.
//
// Presentation-layer contract ONLY. It proves that:
//   - Figure/Table/Code captions consume ONE shared typography token set
//   - the legacy Table-only bold (`font-weight: 600`) is removed
//   - no hardcoded font family / light-only caption color is introduced
//   - the Formula tag override is narrow (InkChapter-owned `mjx-tag` under a
//     block math container), typography-only, and never leaks into formula
//     body glyphs or global MathJax styling
//   - numbering semantics stay presentation-free (NUMBERING-NOCHANGE-1)
//
// jsdom cannot compile SCSS, so like the existing style contract test we
// assert against the SCSS source text plus pure TS behavior.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildObjectNumberingLabel } from '../heading-numbering/object-numbering-engine'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** Extract the body of the first `#write { ... }` token block. */
function writeTokenBlock(): string {
  const m = scss.match(/#write\s*\{([\s\S]*?)\}/)
  expect(m, '#write token block must exist').toBeTruthy()
  return m![1]
}

/** Extract the declaration body of the first `#write .inkchapter-caption { ... }` block. */
function captionBaseBody(): string {
  const m = scss.match(/#write\s+\.inkchapter-caption\s*\{([\s\S]*?)\}/)
  expect(m, '#write .inkchapter-caption base rule must exist').toBeTruthy()
  return m![1]
}

/** Extract the declaration body of `#write .inkchapter-caption-<type> { ... }`. */
function captionTypeBody(type: 'table' | 'figure' | 'code'): string {
  const m = scss.match(new RegExp(`#write\\s+\\.inkchapter-caption-${type}\\s*\\{([\\s\\S]*?)\\}`))
  expect(m, `.inkchapter-caption-${type} rule must exist`).toBeTruthy()
  return m![1]
}

describe('Phase 7R.3.10 shared object-caption typography authority', () => {
  it('defines the full shared token set on #write', () => {
    const block = writeTokenBlock()
    for (const token of [
      '--inkchapter-object-caption-font-family: inherit',
      '--inkchapter-object-caption-font-size: 0.95em',
      '--inkchapter-object-caption-font-weight: 400',
      '--inkchapter-object-caption-font-style: normal',
      '--inkchapter-object-caption-line-height: 1.5',
      '--inkchapter-object-caption-color: inherit',
      '--inkchapter-object-caption-letter-spacing: normal',
      '--inkchapter-object-caption-inline-gap: 0.35em',
    ]) {
      expect(block).toContain(token)
    }
  })

  it('caption base consumes every shared typography token', () => {
    const body = captionBaseBody()
    for (const prop of [
      'font-family: var(--inkchapter-object-caption-font-family)',
      'font-size: var(--inkchapter-object-caption-font-size)',
      'font-weight: var(--inkchapter-object-caption-font-weight)',
      'font-style: var(--inkchapter-object-caption-font-style)',
      'line-height: var(--inkchapter-object-caption-line-height)',
      'color: var(--inkchapter-object-caption-color)',
      'letter-spacing: var(--inkchapter-object-caption-letter-spacing)',
    ]) {
      expect(body).toContain(prop)
    }
  })

  it('TABLE-TYPO-1: table caption no longer forces bold/600', () => {
    const body = captionTypeBody('table')
    expect(body).not.toMatch(/font-weight\s*:\s*(600|bold)/i)
    expect(body).not.toContain('font-weight')
  })

  it('FIGURE-TYPO-1: figure caption keeps only layout (center), no object typography override', () => {
    const body = captionTypeBody('figure')
    expect(body).toMatch(/text-align\s*:\s*center/)
    expect(body).not.toMatch(/font-(family|size|weight|style)/)
    expect(body).not.toMatch(/color\s*:/)
  })

  it('CODE-TYPO-1: code caption keeps only layout (left), no object typography override', () => {
    const body = captionTypeBody('code')
    expect(body).toMatch(/text-align\s*:\s*left/)
    expect(body).not.toMatch(/font-(family|size|weight|style)/)
    expect(body).not.toMatch(/color\s*:/)
  })

  it('CODE-TYPO-1: code block source font is untouched (no caption rule restyles .md-fences)', () => {
    const cleaned = stripComments(scss)
    expect(cleaned).not.toMatch(/\.inkchapter-caption[^{]*\{[^}]*\.md-fences/s)
    expect(cleaned).not.toMatch(/\.md-fences[^{]*\{[^}]*\.inkchapter-caption/s)
  })

  it('CAPTION-NAME-1: named and unnamed captions use the same base style (no fallback typography)', () => {
    const cleaned = stripComments(scss)
    // No unnamed/name-empty-specific caption typography selector exists.
    expect(cleaned).not.toMatch(/\.inkchapter-caption[^{]*(unnamed|no-name|name-empty|anonymous)[^{]*\{/i)
    // buildObjectNumberingLabel returns identical prefix+number shape with or
    // without a name — same typography target, only the trailing name differs.
    expect(buildObjectNumberingLabel('表', '1.2-1', '表名')).toBe('表 1.2-1 表名')
    expect(buildObjectNumberingLabel('表', '1.2-1', '')).toBe('表 1.2-1')
    expect(buildObjectNumberingLabel('图', '1.2-1', '')).toBe('图 1.2-1')
    expect(buildObjectNumberingLabel('代码', '1.2-1', '')).toBe('代码 1.2-1')
  })

  it('CAPTION-SPACING-1: kind/number/name are joined by exactly one space (no drift, no double space)', () => {
    expect(buildObjectNumberingLabel('表', '1.1-1', '表名')).toBe('表 1.1-1 表名')
    expect(buildObjectNumberingLabel('图', '1.1-1', 'phase6 test')).toBe('图 1.1-1 phase6 test')
    expect(buildObjectNumberingLabel('代码', '1.1-1', '示例代码')).toBe('代码 1.1-1 示例代码')
    // No double spaces, no missing spaces.
    expect(buildObjectNumberingLabel('表', '1.1-1', '表名')).not.toContain('  ')
    expect(buildObjectNumberingLabel('代码', '1.1-1', '')).toBe('代码 1.1-1')
  })

  it('FORMULA-TYPO-1: mjx-tag override is narrow and typography-only', () => {
    const cleaned = stripComments(scss)
    // The scoped rule exists with the full InkChapter block-math path.
    expect(cleaned).toMatch(/#write\s+\.md-math-block\s+\.md-math-container\s+mjx-container\s+mjx-tag\s*\{/)
    // The block sets ONLY typography-safe properties (no position/float/right).
    const block = cleaned.match(/#write\s+\.md-math-block\s+\.md-math-container\s+mjx-container\s+mjx-tag\s*\{([\s\S]*?)\}/)
    expect(block).toBeTruthy()
    for (const prop of ['font-size', 'font-weight', 'font-style', 'color']) {
      expect(block![1]).toContain(prop)
    }
    for (const prop of ['position', 'float', 'right:', 'top:', 'transform', 'display']) {
      expect(block![1]).not.toContain(prop)
    }
  })

  it('FORMULA-TYPO-1: no bare global mjx-tag or mjx-container * override', () => {
    const cleaned = stripComments(scss)
    // The ONLY `mjx-tag {` rule in the stylesheet must be the scoped one above.
    expect(cleaned.match(/mjx-tag\s*\{/g) ?? []).toHaveLength(1)
    // No bare `mjx-container {` rule and no `mjx-container *` fan-out.
    expect(cleaned).not.toMatch(/mjx-container\s*\{/)
    expect(cleaned).not.toMatch(/mjx-container\s*\*/)
    // No mjx-container-level rule sets any font property.
    expect(cleaned).not.toMatch(/mjx-container\s*(?:\*)?\s*\{\s*[^}]*font-/)
  })

  it('FORMULA-BODY guard: no rule targets mjx-math or formula body glyphs', () => {
    const cleaned = stripComments(scss)
    expect(cleaned).not.toMatch(/mjx-math\s*\{/)
    expect(cleaned).not.toMatch(/mjx-mtext\s*\{/)
    expect(cleaned).not.toMatch(/mjx-mo\s*\{/)
  })

  it('HARD-CODE gate: no hardcoded font family / light-only color in caption rules', () => {
    const cleaned = stripComments(scss)
    const captionRules = cleaned.match(/#write\s+\.inkchapter-caption[^{]*\{[\s\S]*?\n\}/g) ?? []
    for (const rule of captionRules) {
      expect(rule).not.toMatch(/font-family\s*:\s*(Microsoft YaHei|SimSun|Times New Roman|Arial)/i)
    }
    expect(cleaned).not.toMatch(/#write\s+\.inkchapter-caption[^{]*\{[^}]*color\s*:\s*#[0-9a-f]{3,6}/i)
  })

  it('NUMBERING-NOCHANGE-1: numbering/business sources stay presentation-free', () => {
    const numberingSrc = readFileSync(resolve(process.cwd(), 'src/heading-numbering/object-numbering-engine.ts'), 'utf8')
    const bridgeSrc = readFileSync(resolve(process.cwd(), 'src/heading-numbering/caption-semantic-bridge.ts'), 'utf8')
    for (const src of [numberingSrc, bridgeSrc]) {
      expect(src).not.toMatch(/font-family|font-size|font-weight|font-style|letter-spacing|--inkchapter-object-caption/)
    }
  })
})

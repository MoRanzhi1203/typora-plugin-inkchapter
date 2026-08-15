// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  isEmptyEquivalentParagraph,
  computeCanonicalTransferComputedIndent,
} from './empty-special-command'

function mockStyle(paddingLeft: string, textIndent: string): Pick<CSSStyleDeclaration, 'paddingLeft' | 'textIndent'> {
  return { paddingLeft, textIndent }
}

describe('CT-EV: Canonical Transfer empty-equivalent visual-verify fix', () => {
  it('CT-EV-1: true empty paragraph → empty-equivalent → read padding-left', () => {
    const p = document.createElement('p')
    expect(isEmptyEquivalentParagraph(p)).toBe(true)
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('32px', '0px'))).toBe(32)
  })

  it('CT-EV-2: zero-length Text → empty-equivalent → read padding-left', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(''))
    expect(p.childNodes.length).toBe(1)
    expect(isEmptyEquivalentParagraph(p)).toBe(true)
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('32px', '0px'))).toBe(32)
  })

  it('CT-EV-3: normal non-empty paragraph → read text-indent', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode('a'))
    expect(isEmptyEquivalentParagraph(p)).toBe(false)
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('0px', '32px'))).toBe(32)
  })

  it('CT-EV-4: whitespace-only → NOT empty → read text-indent', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(' '))
    expect(isEmptyEquivalentParagraph(p)).toBe(false)
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('0px', '32px'))).toBe(32)
  })

  it('CT-EV-5: NBSP → NOT empty → read text-indent', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode('\u00A0'))
    expect(isEmptyEquivalentParagraph(p)).toBe(false)
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('0px', '32px'))).toBe(32)
  })

  it('CT-EV-6: A1 failure-shape regression guard (empty: padding=32, text-indent=0 → reads 32 not 0)', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(''))
    // The old logic read text-indent=0 → visualTransfer=false → AWAITING_TRANSFER leak.
    expect(computeCanonicalTransferComputedIndent(p, mockStyle('32px', '0px'))).toBe(32)
  })
})

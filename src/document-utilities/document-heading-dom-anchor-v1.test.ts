// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isSameDocumentPath, readDomHeadingAnchors } from './document-heading-dom-anchor-v1'

function root(inner: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = inner
  document.body.appendChild(el)
  return el
}

describe('Typora DOM heading anchor authority', () => {
  it('reads the REAL id attributes in DOM order', () => {
    const r = root('<h1 id="intro">Intro</h1><h2 id="sec-1">S1</h2><h3 id="sec-1-1">S11</h3>')
    expect(readDomHeadingAnchors(r)).toMatchObject({
      state: 'READY',
      anchors: ['intro', 'sec-1', 'sec-1-1'],
      reason: 'READY',
    })
  })

  it('ignores headings without id and non-heading ids', () => {
    const r = root('<h2>No id</h2><p id="paragraph">p</p><h2 id="a">A</h2>')
    expect(readDomHeadingAnchors(r).anchors).toEqual(['a'])
  })

  it('is UNKNOWN when a duplicate id makes the authority ambiguous', () => {
    const r = root('<h1 id="same">A</h1><h2 id="same">B</h2><h2 id="ok">C</h2>')
    expect(readDomHeadingAnchors(r)).toEqual({
      state: 'UNKNOWN', anchors: [], duplicateAnchors: ['same'], reason: 'DUPLICATE_ID',
    })
  })

  it('is UNKNOWN for missing or detached roots', () => {
    expect(readDomHeadingAnchors(null).state).toBe('UNKNOWN')
    const detached = document.createElement('div')
    detached.innerHTML = '<h1 id="x">X</h1>'
    expect(readDomHeadingAnchors(detached).state).toBe('UNKNOWN')
  })

  it('a connected root with zero headings is READY with an empty list', () => {
    const r = root('<p>body</p>')
    expect(readDomHeadingAnchors(r)).toMatchObject({ state: 'READY', anchors: [], reason: 'READY' })
  })

  it('compares Windows paths case/separator-insensitively', () => {
    expect(isSameDocumentPath('C:\\Vault\\A.md', 'c:/vault/a.md')).toBe(true)
    expect(isSameDocumentPath('C:\\Vault\\A.md', 'C:\\Vault\\B.md')).toBe(false)
    expect(isSameDocumentPath(null, 'C:\\Vault\\A.md')).toBe(false)
  })
})

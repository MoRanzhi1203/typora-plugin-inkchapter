// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyObserverEmptyEquivalent } from './empty-special-command'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('EMPTYEQ — safe empty-equivalent classifier', () => {
  it('EMPTYEQ-1: <p></p> → safe=true / NATIVE_EMPTY', () => {
    document.body.innerHTML = `<p id="p"></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.strictNativeEmpty).toBe(true)
    expect(r.safeEmptyEquivalent).toBe(true)
    expect(r.reason).toBe('NATIVE_EMPTY')
  })

  it('EMPTYEQ-2: empty md-plain span → safe=true / EMPTY_MD_PLAIN_SHELL', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.strictNativeEmpty).toBe(false)
    expect(r.safeEmptyEquivalent).toBe(true)
    expect(r.reason).toBe('EMPTY_MD_PLAIN_SHELL')
  })

  it('EMPTYEQ-3: empty md-plain span + empty text node → safe=true', () => {
    const p = document.createElement('p')
    const span = document.createElement('span')
    span.setAttribute('md-inline', 'plain')
    span.className = 'md-plain md-expand'
    p.appendChild(span)
    p.appendChild(document.createTextNode(''))
    document.body.appendChild(p)

    const r = classifyObserverEmptyEquivalent(p)
    expect(r.safeEmptyEquivalent).toBe(true)
  })

  it('EMPTYEQ-4: known BR-only Typora empty shape → safe=true / EMPTY_BR_SHELL', () => {
    document.body.innerHTML = `<p id="p"><br></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.strictNativeEmpty).toBe(false)
    expect(r.safeEmptyEquivalent).toBe(true)
    expect(r.reason).toBe('EMPTY_BR_SHELL')
  })

  it('EMPTYEQ-5: visible text "啊" → safe=false', () => {
    document.body.innerHTML = `<p id="p">啊</p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
    expect(r.reason).toBe('VISIBLE_TEXT_NONEMPTY')
  })

  it('EMPTYEQ-6: zero-width text → safe=false / INVISIBLE_TEXT_CONTENT', () => {
    document.body.innerHTML = `<p id="p">\u200B</p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
    expect(r.reason).toBe('INVISIBLE_TEXT_CONTENT')
  })

  it('EMPTYEQ-7: NBSP → safe=false / INVISIBLE_TEXT_CONTENT', () => {
    document.body.innerHTML = `<p id="p">\u00A0</p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
    expect(r.reason).toBe('INVISIBLE_TEXT_CONTENT')
  })

  it('EMPTYEQ-8: unknown empty span → safe=false / UNKNOWN_ELEMENT_CONTENT', () => {
    document.body.innerHTML = `<p id="p"><span data-unknown="x"></span></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
    expect(r.reason).toBe('UNKNOWN_ELEMENT_CONTENT')
  })

  it('EMPTYEQ-9: nested element → safe=false', () => {
    document.body.innerHTML = `<p id="p"><span><em></em></span></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
  })

  it('EMPTYEQ-10: img-only → safe=false', () => {
    document.body.innerHTML = `<p id="p"><img src="x"></p>`
    const r = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(r.safeEmptyEquivalent).toBe(false)
    expect(r.reason).toBe('UNKNOWN_ELEMENT_CONTENT')
  })

  it('EMPTYEQ-11: classifier does not mutate DOM', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p')!
    const beforeHtml = p.innerHTML
    const beforeText = p.textContent
    const beforeChildCount = p.childNodes.length

    classifyObserverEmptyEquivalent(p)

    expect(p.innerHTML).toBe(beforeHtml)
    expect(p.textContent).toBe(beforeText)
    expect(p.childNodes.length).toBe(beforeChildCount)
  })

  it('EMPTYEQ-12: classifier does not access Selection', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p')!

    const selSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => {
      throw new Error('Selection accessed')
    })

    const r = classifyObserverEmptyEquivalent(p)
    expect(r.safeEmptyEquivalent).toBe(true)

    selSpy.mockRestore()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isInkChapterUiEvent } from './plugin-ui-event-guard'

function dispatch(target: Element, type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

describe('isInkChapterUiEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('detects an event inside a caption dialog', () => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-inkchapter-ui', 'true')
    overlay.setAttribute('data-inkchapter-caption-dialog', 'true')
    const input = document.createElement('input')
    input.setAttribute('data-inkchapter-ui-input', 'true')
    overlay.appendChild(input)
    document.body.appendChild(overlay)

    expect(isInkChapterUiEvent(dispatch(input, 'keydown'))).toBe(true)
    expect(isInkChapterUiEvent(dispatch(overlay, 'click'))).toBe(true)
  })

  it('detects an event inside a caption menu', () => {
    const menu = document.createElement('div')
    menu.setAttribute('data-inkchapter-caption-menu', 'true')
    menu.setAttribute('data-inkchapter-ui', 'true')
    const item = document.createElement('div')
    item.setAttribute('data-inkchapter-ui', 'true')
    menu.appendChild(item)
    document.body.appendChild(menu)

    expect(isInkChapterUiEvent(dispatch(item, 'pointerdown'))).toBe(true)
    expect(isInkChapterUiEvent(dispatch(item, 'click'))).toBe(true)
  })

  it('returns false for a plain editor paragraph event', () => {
    const p = document.createElement('p')
    p.textContent = 'business text'
    document.body.appendChild(p)

    expect(isInkChapterUiEvent(dispatch(p, 'keydown'))).toBe(false)
    expect(isInkChapterUiEvent(dispatch(p, 'input'))).toBe(false)
  })
})

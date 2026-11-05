// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureSettingsScroll,
  findSettingsScrollContainer,
  preserveSettingsScroll,
  restoreSettingsScroll,
} from './settings-scroll'

function makeScrollable(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 })
  parent.appendChild(el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('settings scroll preservation', () => {
  it('finds the nearest scrollable ancestor', () => {
    const scroller = makeScrollable(document.body)
    const container = document.createElement('div')
    scroller.appendChild(container)
    expect(findSettingsScrollContainer(container)).toBe(scroller)
  })

  it('falls back to the container itself when nothing is scrollable', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    expect(findSettingsScrollContainer(container)).toBe(container)
  })

  it('captures and restores scrollTop across a rebuild', () => {
    const scroller = makeScrollable(document.body)
    const container = document.createElement('div')
    scroller.appendChild(container)
    scroller.scrollTop = 480

    const snapshot = captureSettingsScroll(container)
    expect(snapshot.top).toBe(480)

    // 模拟整页重建：清空内容。
    container.innerHTML = ''
    restoreSettingsScroll(snapshot)
    expect(scroller.scrollTop).toBe(480)
  })

  it('preserveSettingsScroll wraps a rebuild and restores the position', () => {
    const scroller = makeScrollable(document.body)
    const container = document.createElement('div')
    scroller.appendChild(container)
    scroller.scrollTop = 320
    const rebuild = vi.fn(() => {
      container.innerHTML = '<div>rebuilt</div>'
      scroller.scrollTop = 0
      return 'done'
    })
    const result = preserveSettingsScroll(container, rebuild)
    expect(result).toBe('done')
    expect(scroller.scrollTop).toBe(320)
  })
})

import { describe, it, expect } from 'vitest'
import {
  clipEditorRect,
  computeImageToolbarPlacement,
  type RectLike,
} from './content-block-toolbar-image-placement'

const rect = (left: number, top: number, width: number, height: number): RectLike => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

const base = {
  barWidth: 64,
  barHeight: 32,
  gap: 7,
  inset: 6,
}

describe('computeImageToolbarPlacement', () => {
  it('places the bar just outside the image right edge, aligned to its top', () => {
    const placement = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(100, 600, 800, 300),
      imageRect: rect(200, 650, 400, 150),
      editorRect: rect(0, 0, 1000, 800),
    })
    expect(placement.mode).toBe('right')
    expect(placement.gap).toBe(7)
    // 相对锚点：图片右边缘 500 + 7。
    expect(placement.left).toBe(507)
    expect(placement.top).toBe(50)
  })

  it('falls back to the left side when the right side is clipped', () => {
    const placement = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(100, 600, 900, 300),
      imageRect: rect(700, 650, 280, 150),
      editorRect: rect(0, 0, 1000, 800),
    })
    expect(placement.mode).toBe('left')
    // 图片左边相对 600 - 7 - 64。
    expect(placement.left).toBe(529)
    expect(placement.left + 64).toBeLessThan(600)
  })

  it('insets inside the image when neither side fits', () => {
    const placement = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(100, 600, 120, 120),
      imageRect: rect(100, 600, 120, 120),
      editorRect: rect(0, 0, 220, 800),
    })
    expect(placement.mode).toBe('inside')
    expect(placement.gap).toBe(6)
    expect(placement.left).toBeGreaterThanOrEqual(0)
    expect(placement.left + 64).toBeLessThanOrEqual(120)
    expect(placement.top).toBe(6)
  })

  it('keeps the bar inside the anchor when the image touches the top edge', () => {
    const placement = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(100, 600, 800, 300),
      imageRect: rect(200, 590, 400, 150),
      editorRect: rect(0, 0, 1000, 800),
    })
    expect(placement.top).toBe(0)
  })

  it('supports tiny images and long images without changing their geometry', () => {
    const tiny = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(0, 0, 800, 800),
      imageRect: rect(380, 100, 20, 20),
      editorRect: rect(0, 0, 800, 800),
    })
    expect(tiny.mode).toBe('right')
    expect(tiny.left).toBe(407)

    const long = computeImageToolbarPlacement({
      ...base,
      anchorRect: rect(0, 0, 800, 2000),
      imageRect: rect(100, 100, 300, 1600),
      editorRect: rect(0, 0, 800, 900),
    })
    expect(long.mode).toBe('right')
    expect(long.top).toBe(100)
  })
})

describe('clipEditorRect', () => {
  it('clips the editor rect to the viewport', () => {
    expect(clipEditorRect(rect(-50, -20, 1200, 900), 1000, 800)).toEqual({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
    })
  })
})

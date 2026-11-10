import { describe, expect, it } from 'vitest'
import {
  buildObjectReferenceFragment,
  isObjectReferenceDestination,
  parseObjectReference,
} from './document-object-reference-v1'

describe('object reference V1 — parser', () => {
  it('parses same-file and cross-file figure/table/formula references', () => {
    expect(parseObjectReference('#inkchapter-ref:figure:cap_ab12')).toEqual({
      ok: true,
      reference: { kind: 'figure', captionId: 'cap_ab12', fragment: 'inkchapter-ref:figure:cap_ab12' },
    })
    expect(parseObjectReference('other.md#inkchapter-ref:table:cap_cd34')).toMatchObject({
      ok: true,
      reference: { kind: 'table', captionId: 'cap_cd34' },
    })
    expect(parseObjectReference('./dir/a%20b.md#inkchapter-ref:formula:cap_ef56')).toMatchObject({
      ok: true,
      reference: { kind: 'formula', captionId: 'cap_ef56' },
    })
  })

  it('rejects a display number as identity', () => {
    expect(parseObjectReference('#inkchapter-ref:figure:1')).toEqual({
      ok: false, reason: 'DISPLAY_NUMBER_NOT_IDENTITY',
    })
    expect(parseObjectReference('#inkchapter-ref:table:2-3')).toEqual({
      ok: false, reason: 'INVALID_ID',
    })
  })

  it('rejects unknown kinds and malformed ids', () => {
    expect(parseObjectReference('#inkchapter-ref:image:cap_ab12')).toEqual({ ok: false, reason: 'INVALID_KIND' })
    expect(parseObjectReference('#inkchapter-ref:figure:')).toEqual({ ok: false, reason: 'INVALID_ID' })
    expect(parseObjectReference('#inkchapter-ref:figure:cap_ab12:extra')).toEqual({ ok: false, reason: 'INVALID_ID' })
    expect(parseObjectReference('#inkchapter-ref:figure:cap ab12')).toEqual({ ok: false, reason: 'INVALID_ID' })
  })

  it('does not claim ordinary heading links or empty fragments', () => {
    for (const d of ['#section', 'other.md#section', 'other.md', '#', 'inkchapter-ref:figure:cap_ab12']) {
      expect(parseObjectReference(d), d).toEqual({ ok: false, reason: 'NOT_OBJECT_REFERENCE' })
    }
  })

  it('builds only valid fragments and recognizes the reserved prefix', () => {
    expect(buildObjectReferenceFragment('figure', 'cap_ab12')).toBe('inkchapter-ref:figure:cap_ab12')
    expect(buildObjectReferenceFragment('figure', '1')).toBeNull()
    expect(buildObjectReferenceFragment('image' as never, 'cap_ab12')).toBeNull()
    expect(isObjectReferenceDestination('other.md#inkchapter-ref:figure:cap_ab12')).toBe(true)
    expect(isObjectReferenceDestination('other.md#section')).toBe(false)
  })
})

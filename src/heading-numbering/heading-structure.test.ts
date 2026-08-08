import { describe, it, expect } from 'vitest'
import {
  resolveHeadingStructure,
  validateHeadingStructure,
  isStrictHeadingStructure,
  resolveHeadingStructureMode,
} from './heading-structure'
import type {
  HeadingStructureMode,
  ResolvedHeadingStructure,
} from './heading-structure'
import type { HeadingDescriptor } from './heading-types'

// ── Helpers ─────────────────────────────────────────

function makeSettings(
  headingStructureMode?: HeadingStructureMode,
  showLevelOneNumber?: boolean,
) {
  return { headingStructureMode, showLevelOneNumber } as any
}

function makeHeadings(levels: number[]): HeadingDescriptor[] {
  return levels.map((level, i) => ({
    key: `h-${i}`,
    level: level as any,
    text: `Heading ${level}`,
  }))
}

// ── Resolver ────────────────────────────────────────

describe('resolveHeadingStructure', () => {
  it('strict → showLevelOneNumber=false, root=2, requiresSingleH1=true', () => {
    const r = resolveHeadingStructure(makeSettings('strict'))
    expect(r.mode).toBe('strict')
    expect(r.showLevelOneNumber).toBe(false)
    expect(r.numberingRootPhysicalLevel).toBe(2)
    expect(r.requiresSingleH1).toBe(true)
  })

  it('loose → showLevelOneNumber=true, root=1, requiresSingleH1=false', () => {
    const r = resolveHeadingStructure(makeSettings('loose'))
    expect(r.mode).toBe('loose')
    expect(r.showLevelOneNumber).toBe(true)
    expect(r.numberingRootPhysicalLevel).toBe(1)
    expect(r.requiresSingleH1).toBe(false)
  })

  it('strict → defaultEditablePhysicalLevel=2', () => {
    const r = resolveHeadingStructure(makeSettings('strict'))
    expect(r.defaultEditablePhysicalLevel).toBe(2)
  })

  it('loose → defaultEditablePhysicalLevel=1', () => {
    const r = resolveHeadingStructure(makeSettings('loose'))
    expect(r.defaultEditablePhysicalLevel).toBe(1)
  })

  // ── Legacy compatibility ─────────────────────────

  it('mode missing + legacy false → strict', () => {
    const r = resolveHeadingStructure(makeSettings(undefined, false))
    expect(r.mode).toBe('strict')
    expect(r.showLevelOneNumber).toBe(false)
  })

  it('mode missing + legacy true → loose', () => {
    const r = resolveHeadingStructure(makeSettings(undefined, true))
    expect(r.mode).toBe('loose')
    expect(r.showLevelOneNumber).toBe(true)
  })

  it('mode missing + legacy undefined → strict (default)', () => {
    const r = resolveHeadingStructure(makeSettings(undefined, undefined))
    expect(r.mode).toBe('strict')
    expect(r.showLevelOneNumber).toBe(false)
  })

  it('existing strict wins over legacy true', () => {
    const r = resolveHeadingStructure(makeSettings('strict', true))
    expect(r.mode).toBe('strict')
    expect(r.showLevelOneNumber).toBe(false)
  })

  it('existing loose wins over legacy false', () => {
    const r = resolveHeadingStructure(makeSettings('loose', false))
    expect(r.mode).toBe('loose')
    expect(r.showLevelOneNumber).toBe(true)
  })

  it('both missing → strict', () => {
    const r = resolveHeadingStructure({} as any)
    expect(r.mode).toBe('strict')
  })
})

// ── Resolver helpers ────────────────────────────────

describe('resolveHeadingStructureMode', () => {
  it('returns strict', () => {
    expect(resolveHeadingStructureMode(makeSettings('strict'))).toBe('strict')
  })

  it('returns loose', () => {
    expect(resolveHeadingStructureMode(makeSettings('loose'))).toBe('loose')
  })

  it('legacy false → strict', () => {
    expect(resolveHeadingStructureMode(makeSettings(undefined, false))).toBe('strict')
  })

  it('legacy true → loose', () => {
    expect(resolveHeadingStructureMode(makeSettings(undefined, true))).toBe('loose')
  })
})

describe('isStrictHeadingStructure', () => {
  it('strict → true', () => {
    expect(isStrictHeadingStructure(makeSettings('strict'))).toBe(true)
  })

  it('loose → false', () => {
    expect(isStrictHeadingStructure(makeSettings('loose'))).toBe(false)
  })
})

// ── Validator ───────────────────────────────────────

describe('validateHeadingStructure', () => {
  it('strict + 0 H1 → missing-title', () => {
    const v = validateHeadingStructure(makeHeadings([2, 2, 3]), 'strict')
    expect(v.state).toBe('missing-title')
    expect(v.h1Count).toBe(0)
  })

  it('strict + 1 H1 → valid', () => {
    const v = validateHeadingStructure(makeHeadings([1, 2, 2, 3]), 'strict')
    expect(v.state).toBe('valid')
    expect(v.h1Count).toBe(1)
  })

  it('strict + 2 H1 → multiple-h1', () => {
    const v = validateHeadingStructure(makeHeadings([1, 2, 1, 3]), 'strict')
    expect(v.state).toBe('multiple-h1')
    expect(v.h1Count).toBe(2)
  })

  it('strict + 5 H1 → multiple-h1', () => {
    const v = validateHeadingStructure(makeHeadings([1, 1, 1, 1, 1, 2]), 'strict')
    expect(v.state).toBe('multiple-h1')
    expect(v.h1Count).toBe(5)
  })

  it('loose + 0 H1 → valid', () => {
    const v = validateHeadingStructure(makeHeadings([2, 3]), 'loose')
    expect(v.state).toBe('valid')
  })

  it('loose + 1 H1 → valid', () => {
    const v = validateHeadingStructure(makeHeadings([1, 2]), 'loose')
    expect(v.state).toBe('valid')
  })

  it('loose + 5 H1 → valid', () => {
    const v = validateHeadingStructure(makeHeadings([1, 1, 1, 1, 1, 2]), 'loose')
    expect(v.state).toBe('valid')
  })

  it('validation includes h1Count', () => {
    const v = validateHeadingStructure(makeHeadings([1, 1, 2, 3]), 'strict')
    expect(v.h1Count).toBe(2)
  })

  it('validation includes mode', () => {
    const v = validateHeadingStructure(makeHeadings([1, 2]), 'strict')
    expect(v.mode).toBe('strict')
  })
})

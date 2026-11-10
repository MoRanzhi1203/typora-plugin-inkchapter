import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  parseCrossFileAnchor,
  resolveCrossFileAnchor,
  type CrossFileAnchorResolverInput,
} from './document-cross-file-anchor-v1'

const BASE = 'C:\\vault\\docs'
const TARGET = path.resolve(BASE, 'other.md')

function input(overrides: Partial<CrossFileAnchorResolverInput> = {}): CrossFileAnchorResolverInput {
  return {
    baseDir: BASE,
    destination: 'other.md#section',
    fileExists: p => p === TARGET,
    readFile: p => p === TARGET ? '# Section\n' : null,
    canonicalAnchors: () => ['section', 'other'],
    ...overrides,
  }
}

describe('cross-file anchor V1 — parsing', () => {
  it('parses relative file + anchor and decodes percent encoding', () => {
    expect(parseCrossFileAnchor('other.md#Section%20One')).toEqual({ file: 'other.md', anchor: 'Section One' })
    expect(parseCrossFileAnchor('./dir/a%20b.md#x')).toEqual({ file: './dir/a b.md', anchor: 'x' })
  })

  it('rejects same-file anchors, URLs, absolute paths and empty anchors', () => {
    for (const d of ['#section', 'https://x/a.md#s', 'file:///C:/a.md#s', '/abs/a.md#s', 'C:\\a.md#s', 'a.md#', 'a.md']) {
      expect(parseCrossFileAnchor(d), d).toBeNull()
    }
  })
})

describe('cross-file anchor V1 — three-state contract', () => {
  it('EXISTS only on a canonical positive match', () => {
    const r = resolveCrossFileAnchor(input())
    expect(r.verdict).toBe('EXISTS')
    expect(r.reason).toBe('ANCHOR_FOUND')
    expect(r.resolvedPath).toBe(TARGET)
  })

  it('MISSING only when the canonical authority positively enumerated anchors', () => {
    const r = resolveCrossFileAnchor(input({ destination: 'other.md#missing', canonicalAnchors: () => ['section'] }))
    expect(r.verdict).toBe('MISSING')
    expect(r.reason).toBe('ANCHOR_NOT_FOUND')
  })

  it('UNKNOWN when no canonical anchor authority exists', () => {
    const r = resolveCrossFileAnchor(input({ canonicalAnchors: undefined }))
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toBe('NO_CANONICAL_ANCHOR_AUTHORITY')
  })

  it('UNKNOWN when the target file is missing (never duplicate MISSING)', () => {
    const r = resolveCrossFileAnchor(input({ fileExists: () => false }))
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toBe('TARGET_FILE_MISSING')
  })

  it('UNKNOWN when the target file cannot be read', () => {
    const r = resolveCrossFileAnchor(input({ readFile: () => null }))
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toBe('TARGET_FILE_UNREADABLE')
  })

  it('UNKNOWN without a base directory', () => {
    const r = resolveCrossFileAnchor(input({ baseDir: null }))
    expect(r.verdict).toBe('UNKNOWN')
  })

  it('UNKNOWN for non-cross-file destinations', () => {
    const r = resolveCrossFileAnchor(input({ destination: '#same-file' }))
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toBe('NOT_A_CROSS_FILE_ANCHOR')
  })

  it('a positive empty anchor enumeration can produce MISSING', () => {
    const r = resolveCrossFileAnchor(input({ canonicalAnchors: () => [] }))
    expect(r.verdict).toBe('MISSING')
  })
})

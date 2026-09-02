// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.3 — Generic Diagnostic Locator Closure.
 *
 * VALIDITY ≠ DOM RESOLUTION. Covers the two reproduced misclassified-STALE
 * classes WITHOUT per-rule patches:
 *
 *   VALIDITY-1..4  source validity fingerprint gate (source-text + resource)
 *   RESOURCE-1..4  LOCAL_LINK_TARGET_NOT_FOUND resource semantic resolution
 *                  (image occurrence, file:// DOM src, ./, windows sep, no heading DOM)
 *   PATH-NORM-1..6 single path normalization authority
 *   DOM-ONLY       DOM-only mutation never turns a diagnostic stale
 *   REAL-STALE     real source mutation → TARGET_CHANGED
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveDiagnosticLocation,
  normalizeResourcePath,
} from './document-diagnostic-location'
import type { DiagnosticLocationResolveContext } from './document-diagnostic-location'
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'

function makeDiag(location: DiagnosticLocation, extra: Partial<DocumentDiagnostic> = {}): DocumentDiagnostic {
  return {
    id: 'd1',
    documentKey: 'doc:key',
    severity: 'warning',
    category: 'heading',
    code: 'X',
    message: 'x',
    location,
    ...extra,
  }
}

function baseCtx(overrides: Partial<DiagnosticLocationResolveContext> = {}): DiagnosticLocationResolveContext {
  return {
    documentKey: 'doc:key',
    getRoot: () => document.body,
    resolveHeadingIdentity: () => null,
    resolveSourceLine: () => null,
    resolveBlockIdentity: () => null,
    normalizeResourcePath,
    ...overrides,
  }
}

describe('VALIDITY — source-text fingerprint gate', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('VALIDITY-1: unchanged source line → STILL_VALID path proceeds to resolution', () => {
    const p = document.createElement('p')
    p.setAttribute('data-line', '46')
    p.textContent = '##'
    document.body.appendChild(p)
    const diag = makeDiag(
      { kind: 'source-range', startLine: 46, startColumn: 2, rawText: '  ##' },
      { validityFingerprint: { kind: 'source-text', line: 46, text: '  ##' } },
    )
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveSourceLine: (line) => (line === 46 ? p : null),
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(p)
  })

  it('VALIDITY-2: real source mutation → TARGET_CHANGED before any DOM attempt', () => {
    const diag = makeDiag(
      { kind: 'source-range', startLine: 46, startColumn: 2, rawText: '  ##' },
      { validityFingerprint: { kind: 'source-text', line: 46, text: '  ##' } },
    )
    // resolveSourceLine returns an element but the VALIDITY gate fires first —
    // the source line text changed, so the diagnostic is provably stale.
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveSourceLine: () => document.createElement('p'),
      getSourceLineText: (line) => (line === 46 ? '现在是普通正文' : null),
    }))
    expect(r.decision).toBe('TARGET_CHANGED')
    expect(r.reason).toBe('VALIDITY_SOURCE_CHANGED')
  })

  it('VALIDITY-3: DOM-only mutation (no line present in DOM) → UNRESOLVED, never STALE', () => {
    const diag = makeDiag(
      { kind: 'source-range', startLine: 46, startColumn: 2, rawText: '  ##' },
      { validityFingerprint: { kind: 'source-text', line: 46, text: '  ##' } },
    )
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveSourceLine: () => null, // DOM reshaped: no data-line element
      getSourceLineText: (line) => (line === 46 ? '  ##' : null), // source intact
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('UNRESOLVED')
    expect(r.reason).toBe('SOURCE_ANCHOR_NOT_MAPPED_TO_DOM')
  })

  it('VALIDITY-4: line deleted from source → TARGET_CHANGED', () => {
    const diag = makeDiag(
      { kind: 'source-range', startLine: 46, startColumn: 2, rawText: '  ##' },
      { validityFingerprint: { kind: 'source-text', line: 46, text: '  ##' } },
    )
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveSourceLine: () => null,
      getSourceLineText: () => null, // out of range
    }))
    expect(r.decision).toBe('TARGET_CHANGED')
  })
})

describe('RESOURCE — LOCAL_LINK_TARGET_NOT_FOUND semantic resolution', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const IMG = { kind: 'block-node', blockKind: 'figure', stableIdentity: 'local:phase6-test.png' } as DiagnosticLocation

  function imgDiag(location: DiagnosticLocation = IMG, metadata: Record<string, unknown> = {}): DocumentDiagnostic {
    return makeDiag(location, {
      category: 'figure',
      code: 'LINK_LOCAL_TARGET_NOT_FOUND',
      targetIdentity: 'local:phase6-test.png',
      metadata: { destination: 'phase6-test.png', resourceKind: 'image', occurrenceIndex: 0, ...metadata },
      validityFingerprint: { kind: 'resource', path: 'phase6-test.png', occurrence: 0 },
    })
  }

  it('RESOURCE-1: figure ordinal gone → resource semantic anchor resolves the img block', () => {
    // The <img> exists in the DOM (broken image keeps its block) but it is not
    // the N-th figure anymore (ordinal identity drifted).
    const img = document.createElement('img')
    img.setAttribute('src', 'file:///D:/vault/phase6-test.png')
    document.body.appendChild(img)
    const r = resolveDiagnosticLocation(imgDiag(), imgDiag().location, baseCtx({
      resolveBlockIdentity: () => null, // ordinal identity missed
      resolveResource: (kind, norm, occurrence) => {
        expect(kind).toBe('image')
        expect(norm).toBe('phase6-test.png')
        expect(occurrence).toBe(0)
        return img
      },
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(img)
    expect(r.primaryAnchor).toBe('resource-semantic')
    expect(r.fallbackAnchor).toBe('block-identity')
  })

  it('RESOURCE-2: second occurrence of the same destination resolves its OWN img', () => {
    const img1 = document.createElement('img')
    img1.setAttribute('src', 'file:///D:/vault/phase6-test.png')
    const img2 = document.createElement('img')
    img2.setAttribute('src', 'file:///D:/vault/phase6-test.png')
    document.body.append(img1, img2)
    const second = makeDiag(IMG, {
      category: 'figure',
      code: 'LINK_LOCAL_TARGET_NOT_FOUND',
      targetIdentity: 'local:phase6-test.png:2',
      metadata: { destination: 'phase6-test.png', resourceKind: 'image', occurrenceIndex: 1 },
      validityFingerprint: { kind: 'resource', path: 'phase6-test.png', occurrence: 1 },
    })
    const r = resolveDiagnosticLocation(second, second.location, baseCtx({
      resolveBlockIdentity: () => null,
      resolveResource: (_kind, _norm, occurrence) => (occurrence === 0 ? img1 : occurrence === 1 ? img2 : null),
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(img2)
  })

  it('RESOURCE-3: source unchanged + no DOM img → UNRESOLVED (not STALE)', () => {
    const diag = imgDiag()
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveBlockIdentity: () => null,
      resolveResource: () => null,
      resourceDestinationPresent: () => true, // Markdown still references it
    }))
    expect(r.decision).toBe('UNRESOLVED')
  })

  it('RESOURCE-4: resource removed from Markdown → TARGET_CHANGED (real stale)', () => {
    const diag = imgDiag()
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveBlockIdentity: () => null,
      resolveResource: () => null,
      resourceDestinationPresent: () => false, // destination gone from source
    }))
    expect(r.decision).toBe('TARGET_CHANGED')
    expect(r.reason).toBe('VALIDITY_RESOURCE_REMOVED')
  })
})

describe('PATH-NORM — single resource path normalization authority', () => {
  it('PATH-NORM-1: plain relative stays itself', () => {
    expect(normalizeResourcePath('phase6-test.png')).toBe('phase6-test.png')
  })
  it('PATH-NORM-2: leading ./ stripped', () => {
    expect(normalizeResourcePath('./phase6-test.png')).toBe('phase6-test.png')
    expect(normalizeResourcePath('./assets/foo.png')).toBe('assets/foo.png')
  })
  it('PATH-NORM-3: windows backslash → posix slash', () => {
    expect(normalizeResourcePath('assets\\foo.png')).toBe('assets/foo.png')
    expect(normalizeResourcePath('D:\\vault\\phase6-test.png')).toBe('D:/vault/phase6-test.png')
  })
  it('PATH-NORM-4: file:// URI → bare relative/absolute', () => {
    expect(normalizeResourcePath('file:///D:/vault/phase6-test.png')).toBe('D:/vault/phase6-test.png')
    expect(normalizeResourcePath('file://D:/vault/phase6-test.png')).toBe('D:/vault/phase6-test.png')
  })
  it('PATH-NORM-5: URL-encoded paths decoded', () => {
    expect(normalizeResourcePath('assets/my%20image.png')).toBe('assets/my image.png')
    expect(normalizeResourcePath('file:///D:/vault/my%20image.png')).toBe('D:/vault/my image.png')
  })
  it('PATH-NORM-6: ../ segments collapse without crossing the root', () => {
    expect(normalizeResourcePath('assets/../phase6-test.png')).toBe('phase6-test.png')
    expect(normalizeResourcePath('../phase6-test.png')).toBe('../phase6-test.png')
  })
})

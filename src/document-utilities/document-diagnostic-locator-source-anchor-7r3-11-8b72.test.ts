// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.2 — Source-only diagnostic locator anchor tests.
 *
 * LATENT_ATX_HEADING_MARKER and other source-range diagnostics must locate the
 * containing plain paragraph/block WITHOUT any Heading DOM:
 *   SRC-1 source-line primary anchor
 *   SRC-2 source-line offset fallback (1-based data-line tolerance)
 *   SRC-3 source-text-context fallback (no data-line at all)
 *   SRC-4 real source mutation → TARGET_CHANGED (never a silent wrong target)
 *   SRC-5 DOM-only mapping failure with unchanged source → UNRESOLVED (never STALE)
 *   SRC-6 legacy callers without content authority keep STALE / SOURCE_LINE_NOT_FOUND
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveDiagnosticLocation } from './document-diagnostic-location'
import type { DiagnosticLocationResolveContext } from './document-diagnostic-location'
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'

function makeDiag(location: DiagnosticLocation): DocumentDiagnostic {
  return {
    id: 'd1',
    documentKey: 'doc:key',
    severity: 'warning',
    category: 'heading',
    code: 'LATENT_ATX_HEADING_MARKER_LEVEL_2',
    message: '检测到未转义的潜在标题标记「##」',
    location,
  }
}

function baseCtx(overrides: Partial<DiagnosticLocationResolveContext> = {}): DiagnosticLocationResolveContext {
  return {
    documentKey: 'doc:key',
    getRoot: () => document.body,
    resolveHeadingIdentity: () => null,
    resolveSourceLine: () => null,
    resolveBlockIdentity: () => null,
    ...overrides,
  }
}

/** A plain paragraph block carrying the marker text (never a Heading Node). */
function paragraph(dataLine: string | null, text: string): HTMLElement {
  const p = document.createElement('p')
  if (dataLine != null) p.setAttribute('data-line', dataLine)
  p.textContent = text
  document.body.appendChild(p)
  return p
}

const LOCATION: DiagnosticLocation = {
  kind: 'source-range',
  startLine: 46,
  startColumn: 2,
  sourceFingerprint: 'latent:46:##',
  rawText: '  ##',
}

describe('SRC — source-only diagnostic anchors (LATENT_ATX without Heading DOM)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('SRC-1: primary source line anchor resolves the plain paragraph', () => {
    const p = paragraph('46', '##')
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: (line) => line === 46 ? p : null,
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(p)
    expect(r.primaryAnchor).toBe('source-line')
    expect(r.fallbackAnchor).toBeNull()
    expect(r.resolvedNodeKind).toBe('p')
    expect(r.resolvedBlockIdentity).toBe('46')
  })

  it('SRC-2: 1-based data-line tolerance resolves via source-line-offset fallback', () => {
    // Typora build exposes data-line="47" for the 0-based line 46 block.
    const p = paragraph('47', '##')
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: (line) => line === 47 ? p : null,
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(p)
    expect(r.primaryAnchor).toBe('source-line')
    expect(r.fallbackAnchor).toBe('source-line-offset')
  })

  it('SRC-3: text-context re-anchor resolves when no data-line exists at all', () => {
    const p = paragraph(null, '##')
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: () => null,
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
      findBlockByText: (raw) => (raw.trim() === '##' ? p : null),
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(p)
    expect(r.fallbackAnchor).toBe('source-text-context')
    expect(r.resolvedNodeKind).toBe('p')
  })

  it('SRC-4: real source mutation → TARGET_CHANGED (never a silent wrong target)', () => {
    // The block at line 46 now holds DIFFERENT content (user edited the line).
    const p = paragraph('46', '现在是普通正文')
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: (line) => line === 46 ? p : null,
      getSourceLineText: (line) => (line === 46 ? '现在是普通正文' : null),
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('TARGET_CHANGED')
    expect(r.element).toBeNull()
    expect(r.reason).toBe('SOURCE_LINE_CONTENT_CHANGED')
  })

  it('SRC-4b: deleted source line → TARGET_CHANGED', () => {
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: () => null,
      getSourceLineText: () => null, // line out of range
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('TARGET_CHANGED')
  })

  it('SRC-5: unchanged source but DOM mapping failure → UNRESOLVED, never STALE', () => {
    // Outline/numbering/class mutations must not be reported as "target changed".
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: () => null,
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
      findBlockByText: () => null,
    }))
    expect(r.decision).toBe('UNRESOLVED')
    expect(r.reason).toBe('SOURCE_ANCHOR_NOT_MAPPED_TO_DOM')
  })

  it('SRC-6: legacy callers without content authority keep STALE behavior', () => {
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: () => null,
    }))
    expect(r.decision).toBe('STALE')
    expect(r.reason).toBe('SOURCE_LINE_NOT_FOUND')
  })

  it('SRC-7: same-line element with matching text but different normalized form still resolves', () => {
    // Browser textContent collapses whitespace; anchor comparison is normalized.
    const p = paragraph('46', ' ## ')
    const r = resolveDiagnosticLocation(makeDiag(LOCATION), LOCATION, baseCtx({
      resolveSourceLine: (line) => line === 46 ? p : null,
      getSourceLineText: (line) => (line === 46 ? '  ##' : null),
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(p)
  })

  it('SRC-8: canonical-node heading locate still works (no regression)', () => {
    const liveEl = document.createElement('h2')
    const diag = makeDiag({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'the-h2' })
    const r = resolveDiagnosticLocation(diag, diag.location, baseCtx({
      resolveHeadingIdentity: (id) => (id === 'the-h2' ? liveEl : null),
    }))
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(liveEl)
    expect(r.primaryAnchor).toBe('heading-identity')
  })
})

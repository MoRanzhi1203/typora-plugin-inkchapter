// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.4 — Resource Semantic Identity Closure.
 *
 * Three-layer separation:
 *   Source Token Identity   (raw Markdown token — validity)
 *   Semantic Resource Identity (vault-relative canonical — DOM resolution)
 *   DOM Resource Identity   (live src/href — resolution only)
 *
 * Coverage (§13 matrix): plain / percent-encoded / Unicode percent path,
 * file:// + Windows forms, normalizer idempotence, dup occurrence 0/1,
 * no fake `dup.png#2` path, HTTP/HTTPS exclusion, real stale, DOM-only guard.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics } from './document-diagnostics'
import { resolveResourceSemanticPath } from './document-diagnostics'
import { resolveDiagnosticLocation, normalizeResourcePath } from './document-diagnostic-location'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic, DiagnosticLocation } from './diagnostics-types'

const VAULT_ROOT = 'D:/vault'

function input(links: DocumentDiagnosticsInput['links']): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n\n![a](a.png)\n![a b](a%20b.png)\n![d1](dup.png)\n![d2](dup.png)\n![r](https://example.com/remote%20image.png)\n\n',
    strictMode: true,
    vaultRoot: VAULT_ROOT,
    headings: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links,
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function findCode(diags: readonly DocumentDiagnostic[], code: string): DocumentDiagnostic[] {
  return diags.filter(d => d.code === code)
}

describe('NORMALIZER — bounded decode + idempotence + representation', () => {
  it('NORMALIZER_IDEMPOTENT: normalize(normalize(x)) === normalize(x) for every form', () => {
    const forms = [
      'a.png',
      'a%20b.png',
      'assets/my%20image.png',
      'D:\\vault\\a%20b.png',
      'file:///D:/vault/a%20b.png',
      'file://D:/vault/中文 图.png',
      '../../../Downloads/ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5.png',
      './a.png',
      'assets/../dup.png',
      'https://example.com/remote%20image.png',
    ]
    for (const f of forms) {
      const once = normalizeResourcePath(f)
      expect(normalizeResourcePath(once)).toBe(once)
    }
  })

  it('PERCENT: a%20b.png and a b.png collapse to the same canonical', () => {
    expect(normalizeResourcePath('a%20b.png')).toBe('a b.png')
    expect(normalizeResourcePath('a%20b.png')).toBe(normalizeResourcePath('a b.png'))
  })

  it('UNICODE_PERCENT: percent-encoded Chinese decodes to the Unicode path', () => {
    expect(normalizeResourcePath('ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5.png'))
      .toBe('ChatGPT Image 2026年8月14日.png')
  })

  it('file:// + Windows forms converge onto one identity', () => {
    const a = normalizeResourcePath('file:///D:/vault/fixtures/figure/a%20b.png')
    const b = normalizeResourcePath('D:\\vault\\fixtures\\figure\\a b.png')
    expect(a).toBe('D:/vault/fixtures/figure/a b.png')
    expect(a).toBe(b)
  })

  it('NO_FAKE_DUP_PATH_SUFFIX: #/suffix is never part of a canonical path', () => {
    expect(normalizeResourcePath('dup.png#2')).toBe('dup.png')
    expect(normalizeResourcePath('dup.png')).toBe('dup.png')
  })

  it('HTTP_LOCAL_EXCLUSION: http/https URLs never normalize as local paths', () => {
    expect(normalizeResourcePath('https://example.com/remote%20image.png'))
      .toBe('https://example.com/remote%20image.png')
    expect(normalizeResourcePath('http://example.com/x.png')).toBe('http://example.com/x.png')
  })
})

describe('SEMANTIC — token → semantic resource identity (document base)', () => {
  const DOC = 'D:/vault/fixtures/figure/x.md'

  it('relative token resolves against the document directory (vault-relative)', () => {
    expect(resolveResourceSemanticPath('a%20b.png', DOC, VAULT_ROOT)).toBe('fixtures/figure/a b.png')
    expect(resolveResourceSemanticPath('a.png', DOC, VAULT_ROOT)).toBe('fixtures/figure/a.png')
  })

  it('../ tokens that escape the vault stay ABSOLUTE (single identity space)', () => {
    // fixtures/figure/../../../Downloads/x.png physically lands OUTSIDE the
    // vault → the absolute canonical form IS the semantic identity.
    expect(resolveResourceSemanticPath('../../../Downloads/x.png', DOC, VAULT_ROOT))
      .toBe('D:/Downloads/x.png')
    expect(resolveResourceSemanticPath('../sibling.png', DOC, VAULT_ROOT))
      .toBe('fixtures/sibling.png')
  })

  it('no active document path → token-canonical fallback', () => {
    expect(resolveResourceSemanticPath('a%20b.png', null, VAULT_ROOT)).toBe('a b.png')
  })
})

describe('PRODUCER — three-layer separation on LINK_LOCAL diagnostics', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const fact = (target: string, i: number): { target: string; element: null; index: number; resourceKind: 'image' } => ({
    target, element: null, index: i, resourceKind: 'image',
  })

  it('rawDestination stays the exact token; destination is the semantic canonical', () => {
    const r = computeDocumentDiagnostics(input([
      fact('a%20b.png', 0),
      fact('dup.png', 1),
      fact('dup.png', 2),
    ]))
    const linkDiags = findCode(r.diagnostics, 'LINK_LOCAL_TARGET_MISSING')
    expect(linkDiags).toHaveLength(3)
    const pct = linkDiags.find(d => (d.metadata?.rawDestination as string) === 'a%20b.png')!
    expect(pct.metadata?.destination).toBe('a b.png') // no base here → token canonical
    // occurrence is an ORDINAL field — never merged into the destination.
    const dup1 = linkDiags.find(d => (d.metadata?.rawDestination as string) === 'dup.png' && d.metadata?.occurrenceIndex === 0)!
    const dup2 = linkDiags.find(d => (d.metadata?.rawDestination as string) === 'dup.png' && d.metadata?.occurrenceIndex === 1)!
    expect(dup1.metadata?.destination).toBe('dup.png')
    expect(dup2.metadata?.destination).toBe('dup.png')
    expect(String(dup1.metadata?.destination)).not.toContain('#2')
    expect(String(dup1.metadata?.destination)).not.toContain(':2')
  })

  it('occurrence-aware identities differ (dup.png occurrence 0 vs 1)', () => {
    const r = computeDocumentDiagnostics(input([fact('dup.png', 0), fact('dup.png', 1)]))
    const dup = findCode(r.diagnostics, 'LINK_LOCAL_TARGET_MISSING')
    expect(dup).toHaveLength(2)
    expect(dup[0].id).not.toBe(dup[1].id)
    expect(dup.map(d => d.metadata?.occurrenceIndex)).toEqual([0, 1])
  })

  it('HTTP image never produces LINK_LOCAL_TARGET_MISSING', () => {
    const r = computeDocumentDiagnostics(input([fact('https://example.com/remote%20image.png', 0)]))
    expect(findCode(r.diagnostics, 'LINK_LOCAL_TARGET_MISSING')).toHaveLength(0)
  })
})

describe('RESOLVE — occurrence-aware semantic resolution', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const diagWith = (destination: string, raw: string, occurrenceIndex: number, loc: DiagnosticLocation): DocumentDiagnostic => ({
    id: `x:${raw}:${occurrenceIndex}`,
    documentKey: 'doc:a',
    severity: 'warning',
    category: 'link',
    code: 'LINK_LOCAL_TARGET_MISSING',
    message: 'x',
    targetIdentity: `local:${raw}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
    metadata: { destination, rawDestination: raw, resourceKind: 'image', occurrenceIndex },
    validityFingerprint: { kind: 'resource', path: raw, occurrence: occurrenceIndex },
    location: loc,
  })

  function img(src: string): HTMLElement {
    const el = document.createElement('img')
    el.setAttribute('src', src)
    document.body.appendChild(el)
    return el
  }

  it('DUPLICATE_OCCURRENCE_0: resolves the FIRST dup.png img', () => {
    const i1 = img('file:///D:/vault/dup.png')
    img('file:///D:/vault/dup.png')
    const d = diagWith('dup.png', 'dup.png', 0, { kind: 'block-node', blockKind: 'figure', stableIdentity: 'local:dup.png' })
    const r = resolveDiagnosticLocation(d, d.location, {
      documentKey: 'doc:a',
      getRoot: () => document.body,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
      normalizeResourcePath,
      resolveResource: (_kind, _dest, occurrence) => {
        const imgs = Array.from(document.querySelectorAll('img'))
        return imgs[occurrence] ?? null
      },
    })
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(i1)
  })

  it('DUPLICATE_OCCURRENCE_1: resolves the SECOND dup.png img', () => {
    img('file:///D:/vault/dup.png')
    const i2 = img('file:///D:/vault/dup.png')
    const d = diagWith('dup.png', 'dup.png', 1, { kind: 'block-node', blockKind: 'figure', stableIdentity: 'local:dup.png:2' })
    const r = resolveDiagnosticLocation(d, d.location, {
      documentKey: 'doc:a',
      getRoot: () => document.body,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
      normalizeResourcePath,
      resolveResource: (_kind, _dest, occurrence) => {
        const imgs = Array.from(document.querySelectorAll('img'))
        return imgs[occurrence] ?? null
      },
    })
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(i2)
  })

  it('REAL_STALE_DETECTION: source token removed → TARGET_CHANGED (validity layer)', () => {
    const d = diagWith('dup.png', 'dup.png', 0, { kind: 'block-node', blockKind: 'figure', stableIdentity: 'local:dup.png' })
    const r = resolveDiagnosticLocation(d, d.location, {
      documentKey: 'doc:a',
      getRoot: () => document.body,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
      normalizeResourcePath,
      resourceDestinationPresent: () => false, // token gone from the Markdown
    })
    expect(r.decision).toBe('TARGET_CHANGED')
    expect(r.reason).toBe('VALIDITY_RESOURCE_REMOVED')
  })

  it('DOM_ONLY_MUTATION_GUARD: token intact but DOM img missing → UNRESOLVED (never STALE)', () => {
    const d = diagWith('dup.png', 'dup.png', 0, { kind: 'block-node', blockKind: 'figure', stableIdentity: 'local:dup.png' })
    const r = resolveDiagnosticLocation(d, d.location, {
      documentKey: 'doc:a',
      getRoot: () => document.body,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
      normalizeResourcePath,
      resourceDestinationPresent: () => true, // Markdown unchanged
      resolveResource: () => null, // DOM reshaped — no img found
    })
    expect(r.decision).toBe('UNRESOLVED')
    expect(r.reason).toBe('DOM_TARGET_UNRESOLVED')
  })
})

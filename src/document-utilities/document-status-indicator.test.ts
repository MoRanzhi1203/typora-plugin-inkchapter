import { describe, expect, it } from 'vitest'
import {
  buildDocumentStatusView,
  buildNoticeKey,
  canRunImageBatch,
  canRunMarkdownWrite,
  markNoticeSeen,
  resolveDocumentStatusCode,
  shouldShowNotice,
  type DocumentStatusFacts,
} from './document-status-indicator'

function facts(overrides: Partial<DocumentStatusFacts> = {}): DocumentStatusFacts {
  return {
    hasDocument: true,
    diagnosticsEnabled: true,
    checking: false,
    structuralVerified: true,
    hasProjection: true,
    errorCount: 0,
    warningCount: 0,
    hintCount: 0,
    ...overrides,
  }
}

describe('resolveDocumentStatusCode', () => {
  it('returns GREEN only for a verified 0/0 document', () => {
    expect(resolveDocumentStatusCode(facts())).toBe('GREEN')
  })

  it('returns RED when at least one error exists', () => {
    expect(resolveDocumentStatusCode(facts({ errorCount: 1 }))).toBe('RED')
    expect(resolveDocumentStatusCode(facts({ errorCount: 1, warningCount: 3 }))).toBe('RED')
  })

  it('returns YELLOW for warnings without errors', () => {
    expect(resolveDocumentStatusCode(facts({ warningCount: 2 }))).toBe('YELLOW')
  })

  it('returns GRAY when no document / diagnostics off / checking / no projection', () => {
    expect(resolveDocumentStatusCode(facts({ hasDocument: false }))).toBe('GRAY')
    expect(resolveDocumentStatusCode(facts({ diagnosticsEnabled: false }))).toBe('GRAY')
    expect(resolveDocumentStatusCode(facts({ checking: true }))).toBe('GRAY')
    expect(resolveDocumentStatusCode(facts({ hasProjection: false }))).toBe('GRAY')
  })

  it('known severities win over an unverified structure; only 0/0/0 unverified is GRAY', () => {
    expect(resolveDocumentStatusCode(facts({ structuralVerified: false, errorCount: 1 }))).toBe('RED')
    expect(resolveDocumentStatusCode(facts({ structuralVerified: false, warningCount: 1 }))).toBe('YELLOW')
    expect(resolveDocumentStatusCode(facts({ structuralVerified: false, hintCount: 2 }))).toBe('HINT')
    expect(resolveDocumentStatusCode(facts({ structuralVerified: false }))).toBe('GRAY')
  })

  it('uses the dedicated hint color when only hints exist', () => {
    expect(resolveDocumentStatusCode(facts({ hintCount: 4 }))).toBe('HINT')
    expect(buildDocumentStatusView(facts({ hintCount: 4 }), false).color).toBe('#637f96')
  })

  it('keeps the lock outline independent from every severity color', () => {
    const locked = buildDocumentStatusView(facts({ warningCount: 1 }), true)
    expect(locked.code).toBe('YELLOW')
    expect(locked.color).toBe('#d49320')
    expect(locked.label).toContain('已锁定')
  })
})

describe('buildDocumentStatusView', () => {
  it('keeps the detection color when locked and adds lock text', () => {
    const view = buildDocumentStatusView(facts({ warningCount: 1 }), true)
    expect(view.code).toBe('YELLOW')
    expect(view.locked).toBe(true)
    expect(view.label).toContain('警告')
    expect(view.label).toContain('已锁定')
  })

  it('exposes the documented colors', () => {
    expect(buildDocumentStatusView(facts(), false).color).toBe('#2e9869')
    expect(buildDocumentStatusView(facts({ warningCount: 1 }), false).color).toBe('#d49320')
    expect(buildDocumentStatusView(facts({ errorCount: 1 }), false).color).toBe('#d55050')
    expect(buildDocumentStatusView(facts({ hasDocument: false }), false).color).toBe('#89919b')
  })
})

describe('write permissions and notices', () => {
  it('blocks markdown rewrite only when locked', () => {
    expect(canRunMarkdownWrite(false)).toBe(true)
    expect(canRunMarkdownWrite(true)).toBe(false)
  })

  it('keeps read/transfer batch actions available while locked', () => {
    expect(canRunImageBatch(true, 'upload')).toBe(true)
    expect(canRunImageBatch(true, 'download')).toBe(true)
    expect(canRunImageBatch(true, 'dual-link')).toBe(true)
    expect(canRunImageBatch(true, 'rewrite-reference')).toBe(false)
  })

  it('deduplicates notices by document + config + reference revision + kind', () => {
    const key = buildNoticeKey({
      documentKey: 'doc', configRevision: 'c1', referenceRevision: 'r1', kind: 'first-enable',
    })
    const state = { seen: new Set<string>() }
    expect(shouldShowNotice(state, key)).toBe(true)
    const next = markNoticeSeen(state, key)
    expect(shouldShowNotice(next, key)).toBe(false)
    expect(shouldShowNotice(state, key)).toBe(true)
    const otherKind = buildNoticeKey({
      documentKey: 'doc', configRevision: 'c1', referenceRevision: 'r1', kind: 'mode-change',
    })
    expect(shouldShowNotice(next, otherKind)).toBe(true)
  })
})

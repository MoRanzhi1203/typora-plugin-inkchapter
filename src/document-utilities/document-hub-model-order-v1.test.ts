import { describe, expect, it } from 'vitest'
import {
  buildDocumentHubModel,
  filterDiagnosticItems,
  sortDiagnosticItems,
  type DocumentHubDiagnosticItem,
} from './document-hub-model'
import { buildDocumentStatusView } from './document-status-indicator'

function item(
  id: string,
  severity: DocumentHubDiagnosticItem['severity'],
  line: number | null,
  ruleId = 'R',
): DocumentHubDiagnosticItem {
  return { id, severity, title: id, line, ruleId }
}

const view = buildDocumentStatusView({
  hasDocument: true,
  diagnosticsEnabled: true,
  checking: false,
  structuralVerified: true,
  hasProjection: true,
  errorCount: 1,
  warningCount: 2,
  hintCount: 1,
}, false)

describe('document hub ordering V1', () => {
  const documentOrder = [
    item('a', 'warning', 3, 'Z_RULE'),
    item('b', 'error', 9, 'A_RULE'),
    item('c', 'hint', 12, 'M_RULE'),
    item('d', 'warning', 12, 'A_RULE'),
  ]

  it('keeps the authoritative document order by default (never re-sorts)', () => {
    expect(sortDiagnosticItems(documentOrder, 'document').map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('severity sort is stable inside the same severity (document order preserved)', () => {
    expect(sortDiagnosticItems(documentOrder, 'severity').map(i => i.id)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('rule sort is stable and deterministic', () => {
    expect(sortDiagnosticItems(documentOrder, 'rule').map(i => i.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('filtering narrows the view without changing order or the authoritative counts', () => {
    expect(filterDiagnosticItems(documentOrder, 'error').map(i => i.id)).toEqual(['b'])
    expect(filterDiagnosticItems(documentOrder, 'warning').map(i => i.id)).toEqual(['a', 'd'])
    expect(filterDiagnosticItems(documentOrder, 'info').map(i => i.id)).toEqual(['c'])
  })

  it('multi-target rows and event counts stay separate in the model', () => {
    const model = buildDocumentHubModel({
      documentPath: 'C:/vault/a.md',
      saved: true,
      status: view,
      locked: false,
      image: null,
      diagnosticsAvailable: true,
      diagnostics: [
        item('m1', 'warning', 3),
        item('m2', 'warning', 3),
      ],
      autoFixableCount: 3,
    })
    expect(model.rowCount).toBe(2)
    expect(model.status.warningCount).toBe(2)
    expect(model.autoFixableCount).toBe(3)
    expect(model.fixBusy).toBe(false)
  })

  it('never invents an auto-fix count', () => {
    const model = buildDocumentHubModel({
      documentPath: 'C:/vault/a.md',
      saved: true,
      status: view,
      locked: false,
      image: null,
      diagnosticsAvailable: true,
      diagnostics: [item('a', 'warning', 3)],
      autoFixableCount: -5,
    })
    expect(model.autoFixableCount).toBe(0)
  })
})

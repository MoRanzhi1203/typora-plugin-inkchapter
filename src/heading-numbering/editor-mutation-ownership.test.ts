// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { classifyEditorMutationBatchV2, isRendererInternalElement } from './caption-service'

function makeRecord(target: Node, added: Node[] = [], removed: Node[] = []): MutationRecord {
  return {
    type: 'childList',
    target,
    addedNodes: added as unknown as NodeList,
    removedNodes: removed as unknown as NodeList,
  } as MutationRecord
}

describe('isRendererInternalElement', () => {
  it('detects MathJax internals', () => {
    expect(isRendererInternalElement(document.createElement('mjx-container'))).toBe(true)
    expect(isRendererInternalElement(document.createElement('svg'))).toBe(true)
  })

  it('detects CodeMirror internals', () => {
    const line = document.createElement('div')
    line.className = 'CodeMirror-line'
    expect(isRendererInternalElement(line)).toBe(true)
  })

  it('does not treat a paragraph as renderer internal', () => {
    expect(isRendererInternalElement(document.createElement('p'))).toBe(false)
  })
})

describe('classifyEditorMutationBatchV2', () => {
  it('InkChapter decoration only → IGNORED', () => {
    const deco = document.createElement('span')
    deco.setAttribute('data-inkchapter-formula-number', 'true')
    const target = document.createElement('div')
    const r = classifyEditorMutationBatchV2([makeRecord(target, [deco])])
    expect(r.classification).toBe('INKCHAPTER_DECORATION_ONLY')
    expect(r.decision).toBe('IGNORED')
    expect(r.formulaRefreshRequested).toBe(false)
  })

  it('MJX internal only → IGNORED_RENDERER_INTERNAL', () => {
    const mjx = document.createElement('mjx-container')
    const target = document.createElement('div')
    const r = classifyEditorMutationBatchV2([makeRecord(target, [mjx])])
    expect(r.classification).toBe('TYPOORA_RENDERER_INTERNAL_ONLY')
    expect(r.decision).toBe('IGNORED_RENDERER_INTERNAL')
    expect(r.captionRefreshRequested).toBe(false)
    expect(r.strictValidationRequested).toBe(false)
  })

  it('CodeMirror-line only → IGNORED_RENDERER_INTERNAL', () => {
    const line = document.createElement('div')
    line.className = 'CodeMirror-line'
    const r = classifyEditorMutationBatchV2([makeRecord(document.createElement('div'), [line])])
    expect(r.classification).toBe('TYPOORA_RENDERER_INTERNAL_ONLY')
    expect(r.decision).toBe('IGNORED_RENDERER_INTERNAL')
  })

  it('real markdown content → BUSINESS_REFRESH', () => {
    const p = document.createElement('p')
    p.textContent = 'new paragraph'
    const r = classifyEditorMutationBatchV2([makeRecord(document.createElement('div'), [p])])
    expect(r.classification).toBe('REAL_DOCUMENT_CONTENT')
    expect(r.decision).toBe('BUSINESS_REFRESH')
    expect(r.formulaRefreshRequested).toBe(true)
  })

  it('mixed real + renderer → MIXED_CONTENT_AND_RENDERER (single refresh)', () => {
    const p = document.createElement('p')
    const mjx = document.createElement('mjx-container')
    const r = classifyEditorMutationBatchV2([
      makeRecord(document.createElement('div'), [p]),
      makeRecord(document.createElement('div'), [mjx]),
    ])
    expect(r.classification).toBe('MIXED_CONTENT_AND_RENDERER')
    expect(r.decision).toBe('BUSINESS_REFRESH')
    expect(r.formulaRefreshRequested).toBe(true)
  })
})

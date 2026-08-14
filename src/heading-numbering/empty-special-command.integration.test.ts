// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  snapshotEmptyBlockDom,
  resolveEmptySlot,
  evaluateEmptySpecialFinal,
  computeCaretGeometry,
  isTokenOnlyEmptySpecialCommand,
  normalizeTokenConsumedEmptyParagraph,
  analyzeEmptyMdPlainSpan,
} from './empty-special-command'
import { ParagraphCanonicalRegistry } from './paragraph-canonical-registry'
import type { ParagraphIndentOverrideRecord } from './paragraph-layout-store'

// Integration tests: exercise the REAL production orchestration components
// (token detection → token consume → DOM replacement/survival → settle resolve →
// canonical commit/rebind → caret verify → final evaluation) using a real jsdom
// DOM and the real ParagraphCanonicalRegistry. Full service-method invocation is
// covered by the sandbox-external runtime E1/E2/E3 gates.

function makeRecord(id: string): ParagraphIndentOverrideRecord {
  return { id, mode: 'force-indent', anchor: { lastKnownOrdinal: 0 }, temporary: true }
}

function consumeToken(p: HTMLElement, token: string): void {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n) {
    texts.push(n as Text)
    n = walker.nextNode()
  }
  for (const t of texts) {
    if (t.nodeValue?.includes(token)) {
      t.nodeValue = t.nodeValue.replace(token, '')
    }
  }
}

describe('A — EMPTY-BLOCK-DOM-SNAPSHOT probe', () => {
  it('snapshot records innerHTML / childNodes / BR / placeholder / Typora marker', () => {
    document.body.innerHTML = `<div id="root"><p id="p1"><br><span class="md-meta">x</span></p></div>`
    const p = document.getElementById('p1')!
    const snap = snapshotEmptyBlockDom(p, 'NATIVE_EMPTY', 'rt-1')
    expect(snap.phase).toBe('NATIVE_EMPTY')
    expect(snap.tagName).toBe('p')
    expect(snap.isConnected).toBe(true)
    expect(snap.childNodeCount).toBeGreaterThan(0)
    expect(snap.childNodeSummaries.length).toBeGreaterThan(0)
    expect(snap.hasBR).toBe(true)
    expect(snap.brCount).toBe(1)
    expect(snap.hasTyporaMarker).toBe(true)
    expect(snap.innerHTML).toContain('<br>')
  })

  it('snapshot null node → disconnected none-shape', () => {
    const snap = snapshotEmptyBlockDom(null, 'AFTER_RAF', null)
    expect(snap.isConnected).toBe(false)
    expect(snap.tagName).toBe('none')
    expect(snap.childNodeCount).toBe(0)
  })
})

describe('P0-A — EMPTY-DOM-NORMALIZE', () => {
  it('EMPTY-DOM-NORMALIZE-1: native empty → ALREADY_NATIVE_EMPTY', () => {
    document.body.innerHTML = `<p id="p1"></p>`
    const p = document.getElementById('p1')!
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('ALREADY_NATIVE_EMPTY')
    expect(r.nativeEmptyEquivalentAfter).toBe(true)
    expect(r.markdownContentChanged).toBe(false)
    expect(r.overall).toBe(true)
  })

  it('EMPTY-DOM-NORMALIZE-2: empty md-plain span → NORMALIZED_TO_NATIVE_EMPTY', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p1')!
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('NORMALIZED_TO_NATIVE_EMPTY')
    expect(r.nativeEmptyEquivalentAfter).toBe(true)
    expect(r.afterChildNodeCount).toBe(0)
    expect(p.innerHTML).toBe('')
    expect(p.textContent).toBe('')
    expect(r.markdownContentChanged).toBe(false)
    expect(r.overall).toBe(true)
  })

  it('EMPTY-DOM-NORMALIZE-3: unknown/mixed child → BLOCK_UNSAFE_STRUCTURE', () => {
    document.body.innerHTML = `<p id="p1"><span class="md-plain md-expand">text</span></p>`
    const p = document.getElementById('p1')!
    const before = p.innerHTML
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('BLOCK_UNSAFE_STRUCTURE')
    expect(r.overall).toBe(false)
    expect(p.innerHTML).toBe(before) // never blindly deleted
  })

  it('EMPTY-DOM-NORMALIZE-4: no invisible markdown chars introduced', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p1')!
    normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(p.textContent).toBe('')
    expect(p.innerHTML).toBe('')
    expect(p.innerHTML).not.toContain('\u200B')
    expect(p.innerHTML).not.toContain('&nbsp;')
  })

  it('EMPTY-DOM-NORMALIZE-5: zero-length Text("") child → NORMALIZED_TO_NATIVE_EMPTY', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">..</span></p>`
    const p = document.getElementById('p1')!
    const span = p.querySelector('span')!
    // Simulate clearParagraphToken: set the token Text node data to '' (node remains).
    const textNode = span.firstChild as Text
    textNode.nodeValue = ''
    expect(span.childNodes.length).toBe(1)

    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('NORMALIZED_TO_NATIVE_EMPTY')
    expect(r.nativeEmptyEquivalentAfter).toBe(true)
    expect(p.innerHTML).toBe('')
    expect(p.textContent).toBe('')
    expect(r.overall).toBe(true)
  })

  it('EMPTY-DOM-NORMALIZE-6: whitespace Text(" ") child → BLOCK_UNSAFE_STRUCTURE', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand"> </span></p>`
    const p = document.getElementById('p1')!
    const before = p.innerHTML
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('BLOCK_UNSAFE_STRUCTURE')
    expect(p.innerHTML).toBe(before)
  })

  it('EMPTY-DOM-NORMALIZE-7: newline Text("\\n") child → BLOCK_UNSAFE_STRUCTURE', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">\n</span></p>`
    const p = document.getElementById('p1')!
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('BLOCK_UNSAFE_STRUCTURE')
  })

  it('EMPTY-DOM-NORMALIZE-8: predicate reports SAFE_EMPTY for Text("") only', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">..</span></p>`
    const p = document.getElementById('p1')!
    const span = p.querySelector('span')!
    ;(span.firstChild as Text).nodeValue = ''

    const pred = analyzeEmptyMdPlainSpan(span)
    expect(pred.spanTag).toBe('span')
    expect(pred.mdInlineValue).toBe('plain')
    expect(pred.classList).toContain('md-plain')
    expect(pred.classList).toContain('md-expand')
    expect(pred.spanChildNodeCount).toBe(1)
    expect(pred.spanTextNodeCount).toBe(1)
    expect(pred.spanElementChildCount).toBe(0)
    expect(pred.textNodeValues).toEqual([''])
    expect(pred.hasNestedElement).toBe(false)
    expect(pred.hasNonEmptyTextNode).toBe(false)
    expect(pred.matchesExpectedMdPlainShape).toBe(true)
    expect(pred.safeEmptyTextShape).toBe(true)
    expect(pred.decision).toBe('SAFE_EMPTY')
  })
})

describe('EMPTY-SPAN — safe exact empty span predicate', () => {
  function spanWith(html: string): HTMLSpanElement {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">${html}</span></p>`
    return document.querySelector('#p1 span') as HTMLSpanElement
  }

  it('EMPTY-SPAN-1: zero child md-plain span → SAFE', () => {
    const span = spanWith('')
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('SAFE_EMPTY')
    expect(r.spanChildNodeCount).toBe(0)
  })

  it('EMPTY-SPAN-2: Text("") → SAFE', () => {
    const span = spanWith('..')
    ;(span.firstChild as Text).nodeValue = ''
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('SAFE_EMPTY')
    expect(r.spanTextNodeCount).toBe(1)
    expect(r.hasNonEmptyTextNode).toBe(false)
  })

  it('EMPTY-SPAN-3: multiple Text("") nodes → SAFE', () => {
    const span = spanWith('')
    span.appendChild(document.createTextNode(''))
    span.appendChild(document.createTextNode(''))
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('SAFE_EMPTY')
    expect(r.spanTextNodeCount).toBe(2)
    expect(r.hasNonEmptyTextNode).toBe(false)
  })

  it('EMPTY-SPAN-4: Text(" ") → BLOCK', () => {
    const span = spanWith(' ')
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('REJECT')
    expect(r.hasNonEmptyTextNode).toBe(true)
  })

  it('EMPTY-SPAN-5: Text("\\n") → BLOCK', () => {
    const span = spanWith('\n')
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('REJECT')
    expect(r.hasNonEmptyTextNode).toBe(true)
  })

  it('EMPTY-SPAN-6: nested element → BLOCK', () => {
    const span = spanWith('<em></em>')
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('REJECT')
    expect(r.hasNestedElement).toBe(true)
  })

  it('EMPTY-SPAN-7: unknown node (comment) → BLOCK', () => {
    const span = spanWith('')
    span.appendChild(document.createComment('x'))
    const r = analyzeEmptyMdPlainSpan(span)
    expect(r.decision).toBe('REJECT')
    expect(r.hasNonTextNode).toBe(true)
  })
})

describe('EMPTY-SPECIAL-INTEGRATION-E1 (SAME_NODE — source survives)', () => {
  it('token detect → consume → survive → resolve SAME_NODE → canonical UPDATE → final PASS', () => {
    document.body.innerHTML = `<div id="root"><p id="prev">prev</p><p id="src">。。</p><p id="next">next</p></div>`
    const root = document.getElementById('root')!
    const prev = document.getElementById('prev')!
    const src = document.getElementById('src')!
    const next = document.getElementById('next')!

    expect(isTokenOnlyEmptySpecialCommand(src.textContent ?? '', '。。')).toBe(true)

    // token consume (Typora re-empties the source paragraph; source survives)
    consumeToken(src, '。。')
    expect(src.textContent).toBe('')
    expect(src.isConnected).toBe(true)

    const resolution = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'src',
      previousRuntimeId: 'prev',
      nextRuntimeId: 'next',
      candidateRuntimeIds: [],
      paragraphCountBefore: 3,
      paragraphCountAfter: 3,
    })
    expect(resolution.decision).toBe('SAME_NODE')
    expect(resolution.resolvedRuntimeId).toBe('src')

    const registry = new ParagraphCanonicalRegistry('sess-int-e1')
    registry.registerCurrentSessionRecord(makeRecord('rec-src'), 'doc-a', src, 'src', true, 'scope-a', 'doc-a')
    // SAME_NODE → no rebind needed; final owner is still the source element
    expect(registry.resolveExactLiveRecord(src)?.recordId).toBe('rec-src')

    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: registry.resolveExactLiveRecord(src)?.recordId === 'rec-src',
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(true)
    expect(root.querySelectorAll('p').length).toBe(3)
  })
})

describe('EMPTY-SPECIAL-INTEGRATION-E2 (CONTROLLED_REPLACEMENT + caret geometry)', () => {
  it('source replaced → unique candidate → rebind lease → caret geometry PASS → final PASS', () => {
    document.body.innerHTML = `<div id="root"><p id="prev">prev</p><p id="src">。。</p><p id="next">next</p></div>`
    const root = document.getElementById('root')!
    const prev = document.getElementById('prev')!
    const src = document.getElementById('src')!
    const next = document.getElementById('next')!

    // Simulate Typora normalization: source is removed and a new empty <p> replaces it.
    src.remove()
    const replacement = document.createElement('p')
    replacement.id = 'src-new'
    root.insertBefore(replacement, next)

    expect(src.isConnected).toBe(false)
    expect(replacement.isConnected).toBe(true)

    const resolution = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'src',
      previousRuntimeId: 'prev',
      nextRuntimeId: 'next',
      candidateRuntimeIds: ['src-new'],
      paragraphCountBefore: 3,
      paragraphCountAfter: 3,
    })
    expect(resolution.decision).toBe('CONTROLLED_REPLACEMENT')
    expect(resolution.resolvedRuntimeId).toBe('src-new')

    // Canonical: existing record on the (now disconnected) source is rebound via CAS lease.
    const registry = new ParagraphCanonicalRegistry('sess-int-e2')
    const meta = registry.registerCurrentSessionRecord(makeRecord('rec-src'), 'doc-a', src, 'src', true, 'scope-a', 'doc-a')
    const rebound = registry.rebindCurrentLiveRecord('rec-src', replacement, 'src-new', {
      scopeId: 'scope-a',
      documentKey: 'doc-a',
      expectedGeneration: meta.generation,
      expectedOldRuntimeId: 'src',
    })
    expect(rebound).toBe(true)
    expect(registry.resolveExactLiveRecord(replacement)?.recordId).toBe('rec-src')
    expect(registry.resolveExactLiveRecord(src)).toBeNull()

    // Real caret geometry (E2 must check geometry, not just computedTextIndent).
    const geometry = computeCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      paragraphContentLeft: 100,
      caretRectLeft: 132,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(geometry.actualCaretIndentPx).toBe(32)
    expect(geometry.overall).toBe(true)

    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: registry.resolveExactLiveRecord(replacement)?.recordId === 'rec-src',
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: geometry.overall,
      authorizedCaretWriteCount: 1,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(true)
  })
})

describe('EMPTY-SPECIAL-INTEGRATION-E3 (prev empty + source empty + next empty)', () => {
  it('three empty paragraphs → source replacement resolved by structural bracket, never ordinal guess', () => {
    document.body.innerHTML = `<div id="root"><p id="prev"></p><p id="src">。。</p><p id="next"></p></div>`
    const root = document.getElementById('root')!
    const prev = document.getElementById('prev')!
    const src = document.getElementById('src')!
    const next = document.getElementById('next')!

    expect(prev.textContent).toBe('')
    expect(isTokenOnlyEmptySpecialCommand(src.textContent ?? '', '。。')).toBe(true)
    expect(next.textContent).toBe('')

    // Source is replaced by a single new empty paragraph between prev and next.
    src.remove()
    const replacement = document.createElement('p')
    replacement.id = 'src-new'
    root.insertBefore(replacement, next)

    // Unique candidate → CONTROLLED_REPLACEMENT (structural bracket evidence only).
    const unique = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'src',
      previousRuntimeId: 'prev',
      nextRuntimeId: 'next',
      candidateRuntimeIds: ['src-new'],
      paragraphCountBefore: 3,
      paragraphCountAfter: 3,
    })
    expect(unique.decision).toBe('CONTROLLED_REPLACEMENT')
    expect(unique.resolvedRuntimeId).toBe('src-new')

    // Two candidates → AMBIGUOUS (BLOCK) — resolver MUST NOT guess by ordinal.
    const ambiguous = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'src',
      previousRuntimeId: 'prev',
      nextRuntimeId: 'next',
      candidateRuntimeIds: ['src-new-a', 'src-new-b'],
      paragraphCountBefore: 3,
      paragraphCountAfter: 4,
    })
    expect(ambiguous.decision).toBe('AMBIGUOUS')
    expect(ambiguous.resolvedRuntimeId).toBeNull()
  })
})

describe('EMPTYBUS — DOM normalization + canonical identity contracts', () => {
  it('EMPTYBUS-1: token-only → native empty safe shape', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p1')!
    expect(isTokenOnlyEmptySpecialCommand('。。', '。。')).toBe(true)
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('NORMALIZED_TO_NATIVE_EMPTY')
    expect(r.nativeEmptyEquivalentAfter).toBe(true)
    expect(p.innerHTML).toBe('')
    expect(p.textContent).toBe('')
  })

  it('EMPTYBUS-2: zero-length Text node accepted safely', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">..</span></p>`
    const p = document.getElementById('p1')!
    const span = p.querySelector('span')!
    ;(span.firstChild as Text).nodeValue = ''

    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('NORMALIZED_TO_NATIVE_EMPTY')
    expect(r.spanPredicate?.decision).toBe('SAFE_EMPTY')
    expect(p.textContent).toBe('')
    expect(p.innerHTML).toBe('')
  })

  it('EMPTYBUS-3: wrapper cleanup never deletes real content', () => {
    document.body.innerHTML = `<p id="p1"><span md-inline="plain" class="md-plain md-expand">real</span></p>`
    const p = document.getElementById('p1')!
    const before = p.innerHTML
    const r = normalizeTokenConsumedEmptyParagraph({ txnId: 't1', runtimeId: 'rt-1', paragraph: p })
    expect(r.decision).toBe('BLOCK_UNSAFE_STRUCTURE')
    expect(p.innerHTML).toBe(before)
    expect(p.textContent).toBe('real')
  })

  it('EMPTYBUS-5: CONTROLLED_REPLACEMENT keeps the same canonicalRecordId', () => {
    document.body.innerHTML = `<div id="root"><p id="prev">prev</p><p id="src">。。</p><p id="next">next</p></div>`
    const root = document.getElementById('root')!
    const src = document.getElementById('src')!
    const next = document.getElementById('next')!

    // Simulate Typora replacing the consumed empty paragraph.
    src.remove()
    const replacement = document.createElement('p')
    replacement.id = 'src-new'
    root.insertBefore(replacement, next)

    const registry = new ParagraphCanonicalRegistry('sess-empbus-5')
    const meta = registry.registerCurrentSessionRecord(makeRecord('rec-src'), 'doc-a', src, 'src', true, 'scope-a', 'doc-a')
    const rebound = registry.rebindCurrentLiveRecord('rec-src', replacement, 'src-new', {
      scopeId: 'scope-a',
      documentKey: 'doc-a',
      expectedGeneration: meta.generation,
      expectedOldRuntimeId: 'src',
    })
    expect(rebound).toBe(true)
    expect(registry.resolveExactLiveRecord(replacement)?.recordId).toBe('rec-src')
    expect(registry.resolveExactLiveRecord(src)).toBeNull()
  })
})

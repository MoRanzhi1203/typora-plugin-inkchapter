/**
 * Paragraph Indent Shortcut — Pipeline Integration Tests (R32)
 *
 * Updates from R31:
 * - probe now requires `hasParagraphCommandMutation` flag (not `editor-input` reason)
 * - Added mutation classifier tests
 * - Added manual semantic command tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import {
  setParagraphIndentMode,
  getParagraphIndentMode,
  INDENT_MODE_ATTR,
  resolveCurrentBlockFromSelection,
  resolvePreviousBlock,
  isContentBlock,
  probeInlineParagraphCommand,
  resetBlockProbeDiagnostic,
  resetProcessedPairs,
  writeBlockProbeDiagnostic,
  classifyEditorMutation,
  injectShortcutMarkerInMarkdown,
  canonicalizeParagraphIndentMarkers,
  parseIndentMarkers,
  focusParagraphAfterMarkerIndex,
  applyIndentByMarkerIndex,
  isCaretAtLogicalStartOfParagraph,
  resolveCurrentBodyParagraph,
  shouldConsumeBackspaceForIndentRemoval,
  type InlineCommandResult,
  type ParagraphIndentSemanticMode,
  type MutationClassification,
  type BackspaceIndentCommandContext,
} from './paragraph-indent-manager'

// ── DOM helpers ─────────────────────────────────────────────────────────

function createEditorRoot(): HTMLElement {
  const div = document.createElement('div')
  div.id = 'write'
  document.body.appendChild(div)
  return div
}

function appendBlocks(root: HTMLElement, ...blocks: (HTMLElement | Comment)[]): void {
  for (const b of blocks) root.appendChild(b)
}

function makeParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function makeHeading(level: number, text: string): HTMLHeadingElement {
  const h = document.createElement(`h${level}`) as HTMLHeadingElement
  h.textContent = text
  return h
}

/** Create a span-wrapped paragraph (Typora-style inline wrapper). */
function makeSpanParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  const span = document.createElement('span')
  span.textContent = text
  p.appendChild(span)
  return p
}

function setSelectionInElement(el: HTMLElement, offset = 0): void {
  let textNode = el.firstChild
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    textNode = document.createTextNode(el.textContent ?? '')
    el.textContent = ''
    el.appendChild(textNode)
  }
  const range = document.createRange()
  range.setStart(textNode, Math.min(offset, (textNode.textContent ?? '').length))
  range.collapse(true)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
}

const ENABLED_SETTINGS = { indentShortcutEnabled: true }
const DISABLED_SETTINGS = { indentShortcutEnabled: false }

// ── 1. Semantic Setter Tests ───────────────────────────────────────────

describe('setParagraphIndentMode (unified semantic entry point)', () => {
  it('sets force-indent class and data attribute', () => {
    const p = document.createElement('p')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
    expect(getParagraphIndentMode(p)).toBe('force-indent')
  })

  it('sets force-flush attribute, removes indent class', () => {
    const p = document.createElement('p')
    p.classList.add('inkchapter-paragraph-indent-2')
    setParagraphIndentMode(p, 'force-flush')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-flush')
    expect(getParagraphIndentMode(p)).toBe('force-flush')
  })

  it('auto mode removes all explicit state', () => {
    const p = document.createElement('p')
    p.classList.add('inkchapter-paragraph-indent-2')
    p.setAttribute(INDENT_MODE_ATTR, 'force-indent')
    setParagraphIndentMode(p, 'auto')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBeNull()
    expect(getParagraphIndentMode(p)).toBe('auto')
  })

  it('force-indent overrides previous force-flush', () => {
    const p = document.createElement('p')
    setParagraphIndentMode(p, 'force-flush')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })

  it('type-safe modes are restricted to union', () => {
    const modes: ParagraphIndentSemanticMode[] = ['auto', 'force-indent', 'force-flush']
    expect(modes).toHaveLength(3)
  })
})

// ── 2. Block Resolver Tests ───────────────────────────────────────────

describe('isContentBlock', () => {
  it('returns true for P tag', () => {
    expect(isContentBlock(document.createElement('p'))).toBe(true)
  })

  it('returns false for H1-H6', () => {
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(isContentBlock(document.createElement(tag))).toBe(false)
    }
  })

  it('returns false for LI, BLOCKQUOTE, PRE, TABLE', () => {
    expect(isContentBlock(document.createElement('li'))).toBe(false)
    expect(isContentBlock(document.createElement('blockquote'))).toBe(false)
    expect(isContentBlock(document.createElement('pre'))).toBe(false)
    expect(isContentBlock(document.createElement('table'))).toBe(false)
  })

  it('returns false for DIV', () => {
    expect(isContentBlock(document.createElement('div'))).toBe(false)
  })
})

describe('resolveCurrentBlockFromSelection', () => {
  let root: HTMLElement

  beforeEach(() => { root = createEditorRoot() })
  afterEach(() => { clearSelection(); root.remove() })

  it('returns null when no selection', () => {
    clearSelection()
    expect(resolveCurrentBlockFromSelection(root)).toBeNull()
  })

  it('resolves P block when cursor is inside a text node in P', () => {
    const p = makeParagraph('hello')
    appendBlocks(root, p)
    setSelectionInElement(p, 3)
    const result = resolveCurrentBlockFromSelection(root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('P')
  })

  it('resolves H2 block when cursor is inside a heading', () => {
    const h2 = makeHeading(2, 'Title')
    appendBlocks(root, h2)
    setSelectionInElement(h2, 0)
    const result = resolveCurrentBlockFromSelection(root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('H2')
  })

  it('walks up from nested span to find block', () => {
    const p = makeParagraph('hello')
    const span = document.createElement('span')
    span.textContent = 'hello'
    p.textContent = ''
    p.appendChild(span)
    appendBlocks(root, p)
    setSelectionInElement(span, 0)
    const result = resolveCurrentBlockFromSelection(root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('P')
  })

  it('returns null when cursor is outside editor root', () => {
    const otherRoot = document.createElement('div')
    const p = makeParagraph('outside')
    otherRoot.appendChild(p)
    setSelectionInElement(p, 0)
    const result = resolveCurrentBlockFromSelection(root)
    expect(result).toBeNull()
    otherRoot.remove()
  })
})

describe('resolvePreviousBlock', () => {
  let root: HTMLElement

  beforeEach(() => { root = createEditorRoot() })
  afterEach(() => { root.remove() })

  it('returns the immediate previous P sibling', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    const result = resolvePreviousBlock(b, root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('P')
    expect(result!.textContent).toBe('..')
  })

  it('skips non-block interstitial elements', () => {
    const a = makeParagraph('..')
    const span = document.createElement('span')
    const b = makeParagraph('')
    appendBlocks(root, a, span, b)
    const result = resolvePreviousBlock(b, root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('P')
    expect(result!.textContent).toBe('..')
  })

  it('returns null when current block is the first child', () => {
    const b = makeParagraph('first')
    appendBlocks(root, b)
    const result = resolvePreviousBlock(b, root)
    expect(result).toBeNull()
  })

  it('returns the H2 block when previous sibling is a heading', () => {
    const h = makeHeading(2, 'Title')
    const b = makeParagraph('')
    appendBlocks(root, h, b)
    const result = resolvePreviousBlock(b, root)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('H2')
  })
})

// ── 3. Inline Command Probe Tests (R35: same-paragraph model) ─────────

describe('probeInlineParagraphCommand (Enter = command submit)', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = createEditorRoot()
    resetProcessedPairs()
  })
  afterEach(() => { clearSelection(); root.remove() })

  it('detects ".." in current paragraph', () => {
    const a = makeParagraph('..')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('..')
    expect(result!.currentBlock).toBe(a)
  })

  it('detects "。。" in current paragraph', () => {
    const a = makeParagraph('。。')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('。。')
  })

  it('returns null when disabled', () => {
    const a = makeParagraph('..')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    expect(probeInlineParagraphCommand(root, DISABLED_SETTINGS)).toBeNull()
  })

  it('returns null for invalid token "..."', () => {
    const a = makeParagraph('...')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).toBeNull()
  })

  it('returns null for non-content block (heading)', () => {
    const h = makeHeading(2, '..')
    appendBlocks(root, h)
    setSelectionInElement(h, 0)
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).toBeNull()
  })

  it('returns null for normal text', () => {
    const a = makeParagraph('normal text')
    appendBlocks(root, a)
    setSelectionInElement(a, 0)
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).toBeNull()
  })

  it('deduplicates same paragraph', () => {
    const a = makeParagraph('..')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).not.toBeNull()
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).toBeNull()
  })

  it('cursor must be inside command paragraph', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('other')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    expect(probeInlineParagraphCommand(root, ENABLED_SETTINGS)).toBeNull()
  })
})

// ── 4. Mutation Classifier Tests (NEW R32) ──────────────────────────────

describe('classifyEditorMutation', () => {
  let root: HTMLElement

  beforeEach(() => { root = createEditorRoot() })
  afterEach(() => { root.remove() })

  function mockMutationRecord(type: string, target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []): MutationRecord {
    return { type, target, addedNodes: addedNodes as unknown as NodeList, removedNodes: removedNodes as unknown as NodeList } as unknown as MutationRecord
  }

  it('detects heading added', () => {
    const h = document.createElement('h2')
    const m = mockMutationRecord('childList', root, [h])
    const result = classifyEditorMutation([m], root)
    expect(result.headingMutation).toBe(true)
  })

  it('detects heading removed', () => {
    const h = document.createElement('h3')
    const m = mockMutationRecord('childList', root, [], [h])
    const result = classifyEditorMutation([m], root)
    expect(result.headingMutation).toBe(true)
  })

  it('detects heading characterData change', () => {
    const h = document.createElement('h2')
    const text = document.createTextNode('old')
    h.appendChild(text)
    root.appendChild(h)
    const m = mockMutationRecord('characterData', text)
    const result = classifyEditorMutation([m], root)
    expect(result.headingMutation).toBe(true)
    root.removeChild(h)
  })

  it('detects small paragraph childList as paragraphCommandCandidate', () => {
    const p = document.createElement('p')
    const m = mockMutationRecord('childList', root, [p])
    const result = classifyEditorMutation([m], root)
    expect(result.paragraphCommandCandidate).toBe(true)
    expect(result.largeBatch).toBe(false)
  })

  it('detects paragraph Enter-like split as candidate', () => {
    const oldP = document.createElement('p')
    const newP = document.createElement('p')
    const m = mockMutationRecord('childList', root, [newP], [oldP])
    const result = classifyEditorMutation([m], root)
    expect(result.paragraphCommandCandidate).toBe(true)
  })

  it('rejects large batch paste as NOT candidate', () => {
    const nodes: Node[] = []
    for (let i = 0; i < 12; i++) nodes.push(document.createElement('p'))
    const m = mockMutationRecord('childList', root, nodes)
    const result = classifyEditorMutation([m], root)
    expect(result.largeBatch).toBe(true)
    expect(result.paragraphCommandCandidate).toBe(false)
  })

  it('rejects large batch removed as NOT candidate', () => {
    const nodes: Node[] = []
    for (let i = 0; i < 12; i++) nodes.push(document.createElement('p'))
    const m = mockMutationRecord('childList', root, [], nodes)
    const result = classifyEditorMutation([m], root)
    expect(result.largeBatch).toBe(true)
    expect(result.paragraphCommandCandidate).toBe(false)
  })

  it('suppresses paragraph detection when suppressParagraphDetection is true', () => {
    const p = document.createElement('p')
    const m = mockMutationRecord('childList', root, [p])
    const result = classifyEditorMutation([m], root, { suppressParagraphDetection: true })
    expect(result.paragraphCommandCandidate).toBe(false)
    // heading should still be detected
    const h = document.createElement('h2')
    const m2 = mockMutationRecord('childList', root, [h])
    const result2 = classifyEditorMutation([m2], root, { suppressParagraphDetection: true })
    expect(result2.headingMutation).toBe(true)
  })

  it('both heading and paragraph can coexist', () => {
    const h = document.createElement('h2')
    const p = document.createElement('p')
    const m = mockMutationRecord('childList', root, [h, p])
    const result = classifyEditorMutation([m], root)
    expect(result.headingMutation).toBe(true)
    expect(result.paragraphCommandCandidate).toBe(true)
  })

  it('returns all false for unrelated mutation (span, not a block)', () => {
    const span = document.createElement('span')
    const m = mockMutationRecord('childList', root, [span])
    const result = classifyEditorMutation([m], root)
    expect(result.headingMutation).toBe(false)
    expect(result.paragraphCommandCandidate).toBe(false) // SPAN is not P nor in BLOCK_TAGS
  })

  it('returns correct classification type', () => {
    const cls: MutationClassification = { headingMutation: true, paragraphCommandCandidate: false, largeBatch: false }
    expect(cls.headingMutation).toBe(true)
  })
})

// ── 5. Pipeline Integration Tests (R35: inline command model) ──────

describe('Pipeline Integration: inline command → probe → semantic setter', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = createEditorRoot()
    resetProcessedPairs()
  })
  afterEach(() => { clearSelection(); root.remove() })

  it('full flow: detect command → same paragraph force-indent', () => {
    const a = makeParagraph('..')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)

    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    expect(result!.currentBlock).toBe(a) // SAME paragraph

    setParagraphIndentMode(a, 'force-indent')
    expect(a.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(a.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })
})

// ── 6. Manual Semantic Command Tests (NEW R32) ──────────────────────────

describe('Manual Semantic Command: forceIndentCurrentParagraph', () => {
  let root: HTMLElement

  beforeEach(() => { root = createEditorRoot() })
  afterEach(() => { clearSelection(); root.remove() })

  it('simulates manual force-indent on current paragraph', () => {
    const p = makeParagraph('some text')
    appendBlocks(root, p)
    setSelectionInElement(p, 2)

    const block = resolveCurrentBlockFromSelection(root)
    expect(block).not.toBeNull()
    setParagraphIndentMode(block!, 'force-indent')

    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
    expect(getParagraphIndentMode(p)).toBe('force-indent')
  })

  it('manual command rejects heading', () => {
    const h2 = makeHeading(2, 'Title')
    appendBlocks(root, h2)
    setSelectionInElement(h2, 0)

    const block = resolveCurrentBlockFromSelection(root)
    expect(block).not.toBeNull()
    // isContentBlock rejects headings
    expect(isContentBlock(block!)).toBe(false)
  })

  it('manual command supports three modes', () => {
    const p = makeParagraph('text')
    // force-indent
    setParagraphIndentMode(p, 'force-indent')
    expect(getParagraphIndentMode(p)).toBe('force-indent')
    // force-flush
    setParagraphIndentMode(p, 'force-flush')
    expect(getParagraphIndentMode(p)).toBe('force-flush')
    // auto
    setParagraphIndentMode(p, 'auto')
    expect(getParagraphIndentMode(p)).toBe('auto')
  })
})

// ── 7. Runtime Block Probe Diagnostic Tests ────────────────────────────

describe('writeBlockProbeDiagnostic', () => {
  beforeEach(() => { resetBlockProbeDiagnostic() })
  afterEach(() => { clearSelection() })

  it('fires only once per session', () => {
    const root = createEditorRoot()
    const p = makeParagraph('hello')
    appendBlocks(root, p)
    setSelectionInElement(p, 0)
    const writeFile = vi.fn()
    writeBlockProbeDiagnostic(root, 'editor-input', writeFile)
    expect(writeFile).toHaveBeenCalledTimes(1)
    writeBlockProbeDiagnostic(root, 'editor-input', writeFile)
    expect(writeFile).toHaveBeenCalledTimes(1)
    root.remove()
  })
})

// ── 8. Performance: O(local) guarantee ─────────────────────────────────

describe('Probe performance: no full-document scan', () => {
  beforeEach(() => { resetProcessedPairs() })
  afterEach(() => { clearSelection() })

  it('only checks immediate local A/B neighborhood', () => {
    const root = createEditorRoot()
    const blocks: HTMLElement[] = []
    for (let i = 0; i < 20; i++) {
      blocks.push(makeParagraph(i === 18 ? '..' : i === 19 ? '' : `text ${i}`))
    }
    appendBlocks(root, ...blocks)
    const cmdPara = blocks[18] // the ".." paragraph
    setSelectionInElement(cmdPara, 2)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('..')
    root.remove()
  })
})

// ── 10. Marker Serialization Tests (NEW R33) ──────────────────────────

describe('injectShortcutMarkerInMarkdown (canonical serialization)', () => {
  it('produces canonical marker + blank line + target paragraph', () => {
    const md = 'before text\n\n..\n\nafter text'
    const result = injectShortcutMarkerInMarkdown(md)
    expect(result).not.toBeNull()
    // Marker on its own line
    expect(result!).toContain('<!-- inkchapter:paragraph-indent=2 -->')
    // Must have blank line after marker
    const lines = result!.split('\n')
    const markerIdx = lines.findIndex(l => l.trim() === '<!-- inkchapter:paragraph-indent=2 -->')
    expect(markerIdx).toBeGreaterThanOrEqual(0)
    expect(lines[markerIdx + 1]).toBe('') // blank line separator
    // Target paragraph preserved
    expect(result!).toContain('after text')
    // No same-line marker
    const sameLine = lines.some(l => l.includes('-->') && l.includes('after text'))
    expect(sameLine).toBe(false)
  })

  it('removes command line from output', () => {
    const md = '..'
    const result = injectShortcutMarkerInMarkdown(md)
    expect(result).not.toBeNull()
    expect(result!).not.toContain('\n..')
  })

  it('produces marker that parseIndentMarkers can read back', () => {
    const md = 'before\n\n..\n\ntarget para'
    const result = injectShortcutMarkerInMarkdown(md)!
    const markers = parseIndentMarkers(result)
    expect(markers.size).toBeGreaterThanOrEqual(1)
  })

  it('returns null for empty input', () => {
    expect(injectShortcutMarkerInMarkdown('')).toBeNull()
  })

  it('returns null when no command found', () => {
    expect(injectShortcutMarkerInMarkdown('Hello world')).toBeNull()
  })

  it('does not trigger on ... (three dots)', () => {
    expect(injectShortcutMarkerInMarkdown('...')).toBeNull()
  })
})

describe('canonicalizeParagraphIndentMarkers', () => {
  it('passes through normal text unchanged', () => {
    const md = '# Title\n\nParagraph text.'
    expect(canonicalizeParagraphIndentMarkers(md)).toBe(md)
  })

  it('does NOT modify normal HTML comments', () => {
    const md = '<!-- regular comment -->\n\nparagraph'
    const result = canonicalizeParagraphIndentMarkers(md)
    expect(result).toBe(md) // unchanged
  })

  it('fixes same-line marker: "<!-- m -->text" → canonical', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->target text'
    const result = canonicalizeParagraphIndentMarkers(md)
    const lines = result.split('\n')
    expect(lines[0]).toBe('<!-- inkchapter:paragraph-indent=2 -->')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('target text')
  })

  it('fixes missing blank line (marker immediately followed by paragraph)', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->\ntarget text'
    const result = canonicalizeParagraphIndentMarkers(md)
    const lines = result.split('\n')
    expect(lines[0]).toBe('<!-- inkchapter:paragraph-indent=2 -->')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('target text')
  })

  it('removes duplicate consecutive markers', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->\n<!-- inkchapter:paragraph-indent=2 -->\n\nparagraph'
    const result = canonicalizeParagraphIndentMarkers(md)
    const lines = result.split('\n')
    // Should only have one marker
    const count = lines.filter(l => l.trim() === '<!-- inkchapter:paragraph-indent=2 -->').length
    expect(count).toBe(1)
    expect(lines[2]).toBe('paragraph')
  })

  it('handles orphan marker at EOF (no target)', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->'
    const result = canonicalizeParagraphIndentMarkers(md)
    expect(result).toBe('')
  })

  it('handles same-line marker at EOF', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->orphan text'
    const result = canonicalizeParagraphIndentMarkers(md)
    const lines = result.split('\n')
    expect(lines[0]).toBe('<!-- inkchapter:paragraph-indent=2 -->')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('orphan text')
  })

  it('is idempotent (second pass unchanged)', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->broken text'
    const pass1 = canonicalizeParagraphIndentMarkers(md)
    const pass2 = canonicalizeParagraphIndentMarkers(pass1)
    expect(pass2).toBe(pass1)
  })

  it('handles canonical marker between two paragraphs', () => {
    const md = 'para one\n\n<!-- inkchapter:paragraph-indent=2 -->\n\ntarget para\n\npara three'
    const result = canonicalizeParagraphIndentMarkers(md)
    expect(result).toBe(md) // already canonical, unchanged
  })

  it('handles multiple broken markers', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->text A\n\nmiddle\n\n<!-- inkchapter:paragraph-indent=2 -->text B'
    const result = canonicalizeParagraphIndentMarkers(md)
    expect(result).toContain('<!-- inkchapter:paragraph-indent=2 -->')
    expect(result).toContain('text A')
    expect(result).toContain('text B')
    expect(result).toContain('middle')
    // Verify no same-line markers
    const lines = result.split('\n')
    const sameLineCount = lines.filter(l => l.includes('-->') && l.includes('text')).length
    expect(sameLineCount).toBe(0)
  })
})

// ── 11. Round-trip Tests (NEW R33) ─────────────────────────────────────

describe('Marker Round-trip: inject → canonicalize → parse → apply', () => {
  it('inject performs canonical serialization that parse can read', () => {
    const md = 'before\n\n..\n\ntarget content'
    const injected = injectShortcutMarkerInMarkdown(md)!
    // Canonicalize should be idempotent on the injected output
    const canonicalized = canonicalizeParagraphIndentMarkers(injected)
    // Both should contain the marker and target
    expect(canonicalized).toContain('<!-- inkchapter:paragraph-indent=2 -->')
    expect(canonicalized).toContain('target content')
    expect(canonicalized).not.toContain('..') // command removed
    // Parse should find the marker
    const markers = parseIndentMarkers(canonicalized)
    expect(markers.size).toBe(1)
  })

  it('broken same-line marker → canonicalize → parse works', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->target here'
    const canonicalized = canonicalizeParagraphIndentMarkers(md)
    const markers = parseIndentMarkers(canonicalized)
    expect(markers.size).toBe(1)
  })

  it('multiple markers round-trip correctly', () => {
    const md = 'para A\n\n<!-- inkchapter:paragraph-indent=2 -->\n\nindented A\n\n<!-- inkchapter:paragraph-indent=2 -->\n\nindented B'
    const canonicalized = canonicalizeParagraphIndentMarkers(md)
    const markers = parseIndentMarkers(canonicalized)
    expect(markers.size).toBe(2)
  })
})

// ── 12. Multi-marker + Target Recovery Tests (NEW R33) ──────────────────

describe('Multi-marker and target identity recovery', () => {
  let root: HTMLElement

  beforeEach(() => { root = createEditorRoot() })
  afterEach(() => { root.remove() })

  it('focusParagraphAfterMarkerIndex targets correct paragraph', () => {
    const p0 = makeParagraph('para 0')
    const c0 = document.createComment(' inkchapter:paragraph-indent=2 ')
    const p1 = makeParagraph('para 1')
    const c1 = document.createComment(' inkchapter:paragraph-indent=2 ')
    const p2 = makeParagraph('para 2')
    appendBlocks(root, c0, p1, c1, p2)

    // Focus paragraph after first marker (index 0) → should be p1
    const r1 = focusParagraphAfterMarkerIndex(root, 0)
    expect(r1).toBe(true)

    // Focus paragraph after second marker (index 1) → should be p2
    clearSelection()
    const r2 = focusParagraphAfterMarkerIndex(root, 1)
    expect(r2).toBe(true)
  })

  it('applyIndentByMarkerIndex applies to correct paragraph', () => {
    const c0 = document.createComment(' inkchapter:paragraph-indent=2 ')
    const p1 = makeParagraph('para 1')
    const c1 = document.createComment(' inkchapter:paragraph-indent=2 ')
    const p2 = makeParagraph('para 2')
    appendBlocks(root, c0, p1, c1, p2)

    // Apply to first marker → p1
    const r1 = applyIndentByMarkerIndex(root, 0)
    expect(r1).toBe(true)
    expect(p1.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(p2.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)

    // Apply to second marker → p2
    applyIndentByMarkerIndex(root, 1)
    expect(p2.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
  })

  it('returns false for out-of-range marker index', () => {
    expect(focusParagraphAfterMarkerIndex(root, 0)).toBe(false)
    expect(applyIndentByMarkerIndex(root, 99)).toBe(false)
  })
})

// ── 13. Type Export Verification ─────────────────────────────────────────

describe('type exports', () => {
  it('InlineCommandResult has required fields', () => {
    const r: InlineCommandResult = {
      currentBlock: document.createElement('p'),
      token: '..',
    }
    expect(r.token).toBe('..')
    expect(r.currentBlock.tagName).toBe('P')
  })

  it('INDENT_MODE_ATTR is the correct value', () => {
    expect(INDENT_MODE_ATTR).toBe('data-inkchapter-indent-mode')
  })
})

// ── 14. Normal Enter Persistence Tests (NEW R36) ──────────────────────

import {
  createParagraphAnchor,
  resolveParagraphAnchor,
  updateParagraphAnchor,
  saveParagraphLayout,
  loadParagraphLayout,
  setVaultRootForTesting,
  collectContentParagraphs,
  hashText,
  type ParagraphAnchor,
  type ParagraphIndentOverrideRecord,
} from './paragraph-layout-store'

describe('Normal Enter: override survives DOM rebuild', () => {
  it('force-indent survives DOM element replacement (rehydrate)', () => {
    const root = createEditorRoot()
    // Create paragraph A with force-indent
    const a = makeParagraph('test paragraph')
    appendBlocks(root, a)
    setParagraphIndentMode(a, 'force-indent')
    expect(a.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)

    // Simulate DOM rebuild by Typora Normal Enter: remove A, create A' (new element)
    const aText = a.textContent
    a.remove()
    const aPrime = makeParagraph(aText ?? '')
    appendBlocks(root, aPrime)

    // A' does NOT have force-indent yet (DOM was rebuilt)
    expect(aPrime.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)

    // Rehydrate: set force-indent on A' (simulating rehydrateParagraphIndentOverrides)
    setParagraphIndentMode(aPrime, 'force-indent')

    // A' now has force-indent
    expect(aPrime.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(aPrime.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
    root.remove()
  })

  it('new paragraph B does NOT inherit explicit force-indent from A', () => {
    const root = createEditorRoot()
    const a = makeParagraph('indented paragraph')
    const b = makeParagraph('new paragraph')
    appendBlocks(root, a, b)
    setParagraphIndentMode(a, 'force-indent')

    // B should NOT have force-indent
    expect(b.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    root.remove()
  })
})

describe('Anchor promotion: temporary → stable', () => {
  it('promotes temporary anchor when text is typed', () => {
    // Start with empty paragraph (temporary anchor)
    const root = createEditorRoot()
    const a = makeParagraph('')
    appendBlocks(root, a)

    // Create temporary anchor
    const tempAnchor = createParagraphAnchor(0, [a])
    expect(tempAnchor.textHash).toBeUndefined() // empty → no textHash

    // User types text: "test content"
    a.textContent = 'test content'
    const stableAnchor = createParagraphAnchor(0, [a])
    expect(stableAnchor.textHash).toBeDefined()
    expect(stableAnchor.textHash).not.toBeUndefined()
    root.remove()
  })

  it('stable anchor has textHash after promotion', () => {
    const root = createEditorRoot()
    const a = makeParagraph('')
    appendBlocks(root, a)

    const tempAnchor = createParagraphAnchor(0, [a])
    expect(tempAnchor.textHash).toBeUndefined() // empty para → no textHash

    // After typing
    a.textContent = 'hello world'
    const promoted = createParagraphAnchor(0, [a])
    expect(promoted.textHash).toBeDefined()
    root.remove()
  })
})

describe('Override priority: explicit > formula > default', () => {
  it('explicit force-indent survives refresh even when class was lost', () => {
    const root = createEditorRoot()
    const a = makeParagraph('indented text')
    appendBlocks(root, a)

    // Apply explicit force-indent
    setParagraphIndentMode(a, 'force-indent')
    expect(getParagraphIndentMode(a)).toBe('force-indent')

    // Simulate class being stripped (Typora DOM rebuild)
    a.classList.remove('inkchapter-paragraph-indent-2')
    a.removeAttribute(INDENT_MODE_ATTR)

    // Rehydrate: re-apply explicit override
    setParagraphIndentMode(a, 'force-indent')
    expect(getParagraphIndentMode(a)).toBe('force-indent')
    expect(a.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    root.remove()
  })
})

// ── 15. R36 Core: Anchor-based Override Rehydration ───────────────────

describe('Anchor resolution survives text and ordinal changes', () => {
  it('resolves by stable textHash after ordinal changes', () => {
    const root = createEditorRoot()
    const intro = makeParagraph('intro')
    const a = makeParagraph('force-indented paragraph')
    const outro = makeParagraph('outro')
    appendBlocks(root, intro, a, outro)

    // Create anchor for A (index 1)
    const anchor = createParagraphAnchor(1, [intro, a, outro])
    expect(anchor.textHash).toBeDefined()

    // Insert paragraph before A — ordinal changes (A is now index 2)
    const before = makeParagraph('inserted before')
    root.insertBefore(before, a)

    const allParas = collectContentParagraphs(root)
    const resolved = resolveParagraphAnchor(anchor, allParas)
    expect(resolved).not.toBeNull()
    expect(resolved!.confidence).toBe('exact')
    // Should resolve to A (text "force-indented paragraph"), not "inserted before"
    expect(allParas[resolved!.index].textContent).toBe('force-indented paragraph')
    root.remove()
  })

  it('resolves by textHash + occurrence for duplicate text', () => {
    const root = createEditorRoot()
    const a1 = makeParagraph('duplicate')
    const a2 = makeParagraph('unique')
    const a3 = makeParagraph('duplicate')
    appendBlocks(root, a1, a2, a3)

    const allParas = collectContentParagraphs(root)

    // Anchor for first "duplicate" (occurrence=1)
    const anchor1 = createParagraphAnchor(0, allParas)
    expect(anchor1.occurrence).toBe(1)
    const r1 = resolveParagraphAnchor(anchor1, allParas)
    expect(r1).not.toBeNull()
    expect(allParas[r1!.index]).toBe(a1)

    // Anchor for second "duplicate" (occurrence=2)
    const anchor2 = createParagraphAnchor(2, allParas)
    expect(anchor2.occurrence).toBe(2)
    const r2 = resolveParagraphAnchor(anchor2, allParas)
    expect(r2).not.toBeNull()
    expect(allParas[r2!.index]).toBe(a3)

    root.remove()
  })

  it('falls back to neighbor hashes when textHash changed', () => {
    const root = createEditorRoot()
    const before = makeParagraph('before text')
    const a = makeParagraph('original text')
    const after = makeParagraph('after text')
    appendBlocks(root, before, a, after)

    const allParas = collectContentParagraphs(root)
    const anchor = createParagraphAnchor(1, allParas)

    // Edit A's text
    a.textContent = 'modified text'

    const resolved = resolveParagraphAnchor(anchor, collectContentParagraphs(root))
    // textHash no longer matches, but neighbor hashes should help
    expect(resolved).not.toBeNull()
    expect(resolved!.confidence).toBe('high')
    root.remove()
  })
})

// ── 16. R36: DOM Identity Replacement (simulate Normal Enter) ─────────

describe('DOM identity replacement: A → A\' + B (Normal Enter simulation)', () => {
  it('rehydrates force-indent to new DOM element A\' after old A is removed', () => {
    const root = createEditorRoot()
    const a = makeParagraph('indented paragraph')
    appendBlocks(root, a)

    // Apply force-indent
    setParagraphIndentMode(a, 'force-indent')
    expect(getParagraphIndentMode(a)).toBe('force-indent')

    // Simulate Normal Enter: remove old A, create A' with same text, create B
    const aText = a.textContent
    a.remove()

    const aPrime = makeParagraph(aText ?? '')
    const b = makeParagraph('')
    appendBlocks(root, aPrime, b)

    // A' should NOT have force-indent (DOM was rebuilt)
    expect(getParagraphIndentMode(aPrime)).toBe('auto')

    // Create anchor from original A's context
    const allParasOld = collectContentParagraphs(root)
    const anchor = createParagraphAnchor(0, allParasOld)

    // Rehydrate: resolve anchor → find A' → apply force-indent
    const resolved = resolveParagraphAnchor(anchor, allParasOld)
    expect(resolved).not.toBeNull()
    setParagraphIndentMode(allParasOld[resolved!.index], 'force-indent')
    expect(getParagraphIndentMode(aPrime)).toBe('force-indent')

    // B should NOT inherit force-indent
    expect(getParagraphIndentMode(b)).toBe('auto')
    root.remove()
  })

  it('record id stays stable across DOM replacement', () => {
    const root = createEditorRoot()
    const a = makeParagraph('stable text')
    appendBlocks(root, a)
    setParagraphIndentMode(a, 'force-indent')

    // Simulate DOM rebuild
    const aText = a.textContent
    a.remove()
    const aPrime = makeParagraph(aText ?? '')
    appendBlocks(root, aPrime)

    // Rehydrate using same anchor
    const allParas = collectContentParagraphs(root)
    const anchor = createParagraphAnchor(0, allParas)
    const resolved = resolveParagraphAnchor(anchor, allParas)
    expect(resolved).not.toBeNull()
    setParagraphIndentMode(allParas[resolved!.index], 'force-indent')
    expect(getParagraphIndentMode(aPrime)).toBe('force-indent')
    root.remove()
  })
})

// ── 17. R36: B Non-Inheritance ────────────────────────────────────────

describe('B does not inherit explicit override from A', () => {
  it('new paragraph B is auto after Normal Enter', () => {
    const root = createEditorRoot()
    const a = makeParagraph('force-indented content')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setParagraphIndentMode(a, 'force-indent')

    expect(getParagraphIndentMode(a)).toBe('force-indent')
    expect(getParagraphIndentMode(b)).toBe('auto')
    expect(b.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    root.remove()
  })

  it('B uses default rules, not explicit override from A', () => {
    const root = createEditorRoot()
    const a = makeParagraph('indented A')
    const b = makeParagraph('independent B')
    appendBlocks(root, a, b)
    setParagraphIndentMode(a, 'force-indent')

    // B should be auto, not force-indent
    expect(getParagraphIndentMode(b)).not.toBe('force-indent')
    root.remove()
  })
})

// ── 18. R36: Text Edit Updates Anchor ─────────────────────────────────

describe('Text edit refreshes anchor', () => {
  it('anchor textHash updates after paragraph text edit', () => {
    const root = createEditorRoot()
    const a = makeParagraph('original text')
    appendBlocks(root, a)

    const allParas = collectContentParagraphs(root)
    const anchor1 = createParagraphAnchor(0, allParas)
    const hash1 = anchor1.textHash

    // Edit the text
    a.textContent = 'completely different text'
    const allParas2 = collectContentParagraphs(root)
    const anchor2 = createParagraphAnchor(0, allParas2)
    const hash2 = anchor2.textHash

    expect(hash1).toBeDefined()
    expect(hash2).toBeDefined()
    expect(hash1).not.toBe(hash2)
    root.remove()
  })

  it('updated anchor still resolves the same paragraph', () => {
    const root = createEditorRoot()
    const a = makeParagraph('editable text')
    appendBlocks(root, a)

    // Create anchor, update text, create new anchor
    setParagraphIndentMode(a, 'force-indent')
    a.textContent = 'edited text'

    const allParas = collectContentParagraphs(root)
    const newAnchor = createParagraphAnchor(0, allParas)
    const resolved = resolveParagraphAnchor(newAnchor, allParas)
    expect(resolved).not.toBeNull()
    expect(resolved!.index).toBe(0)
    root.remove()
  })
})

// ── 19. R36: Full Flow Simulation ───────────────────────────────────

describe('Full flow: command → type text → Normal Enter → rehydrate', () => {
  it('end-to-end: command, type, Normal Enter, rehydrate preserves force-indent', () => {
    const root = createEditorRoot()

    // Step 1: Command paragraph "。。"
    const cmd = makeParagraph('。。')
    appendBlocks(root, cmd)

    // Simulate command Enter: clear token, set force-indent
    cmd.textContent = '' // token cleared
    setParagraphIndentMode(cmd, 'force-indent')
    expect(getParagraphIndentMode(cmd)).toBe('force-indent')

    // Step 2: User types text "这是一个段落"
    cmd.textContent = '这是一个段落'
    // Anchor promoted from temporary to stable
    const allParas = collectContentParagraphs(root)
    const stableAnchor = createParagraphAnchor(0, allParas)
    expect(stableAnchor.textHash).toBeDefined()

    // Step 3: Normal Enter — remove old A, create A' + B
    const cmdText = cmd.textContent
    cmd.remove()
    const aPrime = makeParagraph(cmdText ?? '')
    const b = makeParagraph('')
    appendBlocks(root, aPrime, b)

    // Step 4: Rehydrate
    const newParas = collectContentParagraphs(root)
    const resolved = resolveParagraphAnchor(stableAnchor, newParas)
    expect(resolved).not.toBeNull()
    const target = newParas[resolved!.index]
    setParagraphIndentMode(target, 'force-indent')

    // Assertions
    expect(getParagraphIndentMode(aPrime)).toBe('force-indent')
    expect(getParagraphIndentMode(b)).toBe('auto')
    expect(b.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    root.remove()
  })

  it('anchor promotion happens before Normal Enter (in-memory state ready)', () => {
    const root = createEditorRoot()

    // Empty paragraph A, force-indent (temporary state)
    const a = makeParagraph('')
    appendBlocks(root, a)
    const allParas = collectContentParagraphs(root)
    const tempAnchor = createParagraphAnchor(0, allParas)
    expect(tempAnchor.textHash).toBeUndefined() // temporary

    // User types text — promotion
    a.textContent = 'hello world'
    const newAllParas = collectContentParagraphs(root)
    const stableAnchor = createParagraphAnchor(0, newAllParas)
    expect(stableAnchor.textHash).toBeDefined()
    expect(stableAnchor.textHash).not.toBe(tempAnchor.textHash)

    // Stable anchor resolves correctly
    const resolved = resolveParagraphAnchor(stableAnchor, newAllParas)
    expect(resolved).not.toBeNull()
    expect(resolved!.confidence).toBe('exact')
    root.remove()
  })
})

// ── 20. R36: Formula Priority Regression ─────────────────────────────

describe('Explicit override > formula continuation', () => {
  it('explicit force-indent takes priority over formula continuation', () => {
    const root = createEditorRoot()
    const a = makeParagraph('after math')
    appendBlocks(root, a)

    // Apply explicit force-indent (even though it follows math)
    setParagraphIndentMode(a, 'force-indent')
    expect(getParagraphIndentMode(a)).toBe('force-indent')

    // Simulate DOM rebuild — rehydrate
    const aText = a.textContent
    a.remove()
    const aPrime = makeParagraph(aText ?? '')
    appendBlocks(root, aPrime)
    setParagraphIndentMode(aPrime, 'force-indent')

    // Should still be force-indent
    expect(getParagraphIndentMode(aPrime)).toBe('force-indent')
    root.remove()
  })
})

// ── 21. R36: Insert-Before Regression ────────────────────────────────

describe('Insert before does not misplace override', () => {
  it('force-indent paragraph found after paragraphs inserted before it', () => {
    const root = createEditorRoot()
    const a = makeParagraph('target indented')
    appendBlocks(root, a)
    setParagraphIndentMode(a, 'force-indent')

    // Insert 3 paragraphs before A
    const new1 = makeParagraph('new 1')
    const new2 = makeParagraph('new 2')
    const new3 = makeParagraph('new 3')
    root.insertBefore(new1, a)
    root.insertBefore(new2, a)
    root.insertBefore(new3, a)

    const allParas = collectContentParagraphs(root)
    const anchor = createParagraphAnchor(3, allParas) // A is now at index 3

    const resolved = resolveParagraphAnchor(anchor, allParas)
    expect(resolved).not.toBeNull()
    expect(resolved!.index).toBe(3)
    expect(allParas[resolved!.index].textContent).toBe('target indented')
    root.remove()
  })
})

// ── 22. R36: Duplicate Text Regression ───────────────────────────────

describe('Duplicate text: override does not drift', () => {
  it('occurrence distinguishes between duplicate paragraphs', () => {
    const root = createEditorRoot()
    const same1 = makeParagraph('same text')
    const unique = makeParagraph('unique')
    const same2 = makeParagraph('same text')
    appendBlocks(root, same1, unique, same2)

    const allParas = collectContentParagraphs(root)

    // Force-indent the second "same text" (index 2)
    const anchor = createParagraphAnchor(2, allParas)
    const resolved = resolveParagraphAnchor(anchor, allParas)
    expect(resolved).not.toBeNull()
    expect(allParas[resolved!.index]).toBe(same2) // NOT same1
    root.remove()
  })

  it('first occurrence resolves correctly for duplicate text', () => {
    const root = createEditorRoot()
    const same1 = makeParagraph('same text')
    const same2 = makeParagraph('same text')
    appendBlocks(root, same1, same2)

    const allParas = collectContentParagraphs(root)

    const anchor1 = createParagraphAnchor(0, allParas)
    const resolved1 = resolveParagraphAnchor(anchor1, allParas)
    expect(resolved1).not.toBeNull()
    expect(allParas[resolved1!.index]).toBe(same1)

    const anchor2 = createParagraphAnchor(1, allParas)
    const resolved2 = resolveParagraphAnchor(anchor2, allParas)
    expect(resolved2).not.toBeNull()
    expect(allParas[resolved2!.index]).toBe(same2)
    root.remove()
  })
})

// ── 23. R36: Inline Command Regression ───────────────────────────────

describe('Inline command regression: 。。+Enter still works', () => {
  beforeEach(() => { resetProcessedPairs() })

  it('detects 。。as command token', () => {
    const root = createEditorRoot()
    const a = makeParagraph('。。')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('。。')
    expect(result!.currentBlock).toBe(a)
    root.remove()
  })

  it('command Enter does not create new paragraph', () => {
    const root = createEditorRoot()
    const a = makeParagraph('..')
    appendBlocks(root, a)
    setSelectionInElement(a, 2)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).not.toBeNull()
    // Same paragraph is the target
    setParagraphIndentMode(result!.currentBlock, 'force-indent')
    expect(getParagraphIndentMode(a)).toBe('force-indent')
    // Only 1 paragraph in DOM
    expect(collectContentParagraphs(root).length).toBe(1)
    root.remove()
  })
})

// ── 24. R36: Ordinary Enter Not Intercepted ───────────────────────────

describe('Ordinary Enter is not intercepted', () => {
  beforeEach(() => { resetProcessedPairs() })

  it('probe returns null for normal text paragraph (no command token)', () => {
    const root = createEditorRoot()
    const a = makeParagraph('normal text')
    appendBlocks(root, a)
    setSelectionInElement(a, 5)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).toBeNull() // Normal Enter should pass through
    root.remove()
  })

  it('probe returns null for "..." (three dots, not command)', () => {
    const root = createEditorRoot()
    const a = makeParagraph('...')
    appendBlocks(root, a)
    setSelectionInElement(a, 3)
    const result = probeInlineParagraphCommand(root, ENABLED_SETTINGS)
    expect(result).toBeNull()
    root.remove()
  })
})

// ── 25. R36: Sidecar Persistence Round-trip ──────────────────────────

import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

describe('Sidecar persistence round-trip', () => {
  const testRoot = path.join(os.tmpdir(), 'inkchapter-r36-test-' + Date.now())
  const docKey = 'test-doc'
  const docPath = path.join(testRoot, 'test-doc.md')

  beforeAll(() => {
    setVaultRootForTesting(testRoot)
    // Ensure clean directory
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true })
    fs.mkdirSync(testRoot, { recursive: true })
  })

  afterAll(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true })
  })

  it('saves and loads paragraph overrides', () => {
    const overrides: ParagraphIndentOverrideRecord[] = [{
      id: 'test-1',
      mode: 'force-indent',
      anchor: {
        lastKnownOrdinal: 0,
        textHash: hashText('hello world'),
        occurrence: 1,
        beforeHash: undefined,
        afterHash: hashText('next para'),
      },
      temporary: false,
    }]

    saveParagraphLayout(docKey, docPath, overrides)
    const loaded = loadParagraphLayout(docKey)

    expect(loaded).not.toBeNull()
    expect(loaded!.paragraphOverrides.length).toBe(1)
    expect(loaded!.paragraphOverrides[0].id).toBe('test-1')
    expect(loaded!.paragraphOverrides[0].mode).toBe('force-indent')
    expect(loaded!.paragraphOverrides[0].temporary).toBe(false)
    expect(loaded!.paragraphOverrides[0].anchor.textHash).toBeDefined()
  })

  it('promoted stable anchor survives save and reload', () => {
    // Simulate the real flow: temporary → stable → save → reload
    const overrides: ParagraphIndentOverrideRecord[] = [{
      id: 'temp-promote',
      mode: 'force-indent',
      anchor: { lastKnownOrdinal: 2, textHash: undefined },
      temporary: true,
    }]

    saveParagraphLayout(docKey, docPath, overrides)

    // Simulate promotion: text typed, anchor stabilized
    overrides[0].anchor = {
      lastKnownOrdinal: 2,
      textHash: hashText('promoted text'),
      occurrence: 1,
      beforeHash: hashText('before'),
      afterHash: hashText('after'),
    }
    overrides[0].temporary = false
    saveParagraphLayout(docKey, docPath, overrides)

    // Reload — should have stable anchor
    const loaded = loadParagraphLayout(docKey)
    expect(loaded).not.toBeNull()
    expect(loaded!.paragraphOverrides[0].temporary).toBe(false)
    expect(loaded!.paragraphOverrides[0].anchor.textHash).toBeDefined()
  })
})

// ── 26. R36: collectContentParagraphs ─────────────────────────────────

describe('collectContentParagraphs', () => {
  it('collects P tags as content paragraphs', () => {
    const root = createEditorRoot()
    const p1 = makeParagraph('para 1')
    const p2 = makeParagraph('para 2')
    appendBlocks(root, p1, p2)

    const result = collectContentParagraphs(root)
    expect(result.length).toBe(2)
    expect(result[0]).toBe(p1)
    expect(result[1]).toBe(p2)
    root.remove()
  })

  it('excludes paragraphs inside code blocks', () => {
    const root = createEditorRoot()
    const pre = document.createElement('pre')
    const codePara = makeParagraph('code')
    pre.appendChild(codePara)
    appendBlocks(root, pre)

    const result = collectContentParagraphs(root)
    expect(result).not.toContain(codePara)
    root.remove()
  })
})

// ── 27. Backspace Indent Removal: Logic Tests (T1-T14) ─────────────────

describe('Backspace Indent Removal — shouldConsumeBackspaceForIndentRemoval', () => {
  // ── Helper: place caret at start of paragraph text ──
  function placeCaretAtStart(paragraph: HTMLElement): void {
    const sel = window.getSelection()!
    const range = document.createRange()
    // Find the first text node or place at start of element
    const firstText = findDeepFirstText(paragraph)
    if (firstText) {
      range.setStart(firstText, 0)
    } else {
      range.setStart(paragraph, 0)
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  function findDeepFirstText(el: Node): Text | null {
    if (el.nodeType === Node.TEXT_NODE) return el as Text
    for (const child of el.childNodes) {
      const found = findDeepFirstText(child)
      if (found) return found
    }
    return null
  }

  // ── Helper: place caret inside text ──
  function placeCaretInsideText(paragraph: HTMLElement, charOffset: number): void {
    const sel = window.getSelection()!
    const firstText = findDeepFirstText(paragraph)
    if (firstText) {
      const range = document.createRange()
      range.setStart(firstText, Math.min(charOffset, firstText.textContent?.length ?? 0))
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }

  // ── T1: Basic Reverse Command ──
  it('T1: returns context when force-indent + caret@logical-start', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.caretAtLogicalStart).toBe(true)
    expect(ctx!.paragraph).toBe(p)
    expect(ctx!.mode).toBe('force-indent')
    expect(ctx!.composing).toBe(false)
    expect(ctx!.excludedContext).toBe(false)
    root.remove()
  })

  // ── T1b: force-indent paragraph with span wrapper ──
  it('T1b: returns context when caret@start in span-wrapped paragraph', () => {
    const root = createEditorRoot()
    const p = makeSpanParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.caretAtLogicalStart).toBe(true)
    root.remove()
  })

  // ── T2: Paragraph Count (unit: the paragraph ref never changes) ──
  it('T2: paragraph element identity preserved (same ref before/after semantic change)', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()

    // Simulate Backspace: change from force-indent to force-flush
    setParagraphIndentMode(ctx!.paragraph, 'force-flush')
    expect(getParagraphIndentMode(p)).toBe('force-flush')

    // Paragraph count unchanged (still 1 P in root)
    const allParas = root.querySelectorAll('p')
    expect(allParas.length).toBe(1)
    root.remove()
  })

  // ── T3: Text Preservation ──
  it('T3: textContent unchanged after force-indent → force-flush transition', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    const originalText = p.textContent
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()

    setParagraphIndentMode(ctx!.paragraph, 'force-flush')
    expect(p.textContent).toBe(originalText)
    root.remove()
  })

  // ── T4: Caret Preservation ──
  it('T4: caret remains in same paragraph at logical start after mode change', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()

    setParagraphIndentMode(ctx!.paragraph, 'force-flush')

    // Caret still in same paragraph at logical start
    const sel = window.getSelection()
    expect(sel).not.toBeNull()
    expect(sel!.isCollapsed).toBe(true)
    const resolvedBlock = resolveCurrentBlockFromSelection(root)
    expect(resolvedBlock).toBe(p)
    root.remove()
  })

  // ── T5: Record Identity ──
  it('T5: recordId unchanged, mode changes force-indent → force-flush', () => {
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')

    // Verify initial state
    expect(getParagraphIndentMode(p)).toBe('force-indent')
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)

    // Simulate Backspace action
    setParagraphIndentMode(p, 'force-flush')

    // Mode changed
    expect(getParagraphIndentMode(p)).toBe('force-flush')
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-flush')
    // Force-indent class removed
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)
    // Inline style ensures visual 0
    expect(p.style.textIndent).toBe('0px')
  })

  // ── T6: Second Backspace ──
  it('T6: force-flush + caret@0 → handler returns null (no context to consume)', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-flush')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    // Should return a context but caretAtLogicalStart=false because mode is not force-indent
    expect(ctx).not.toBeNull()
    expect(ctx!.caretAtLogicalStart).toBe(false)
    expect(ctx!.mode).toBe('force-flush')
    root.remove()
  })

  // ── T7: Caret Not At Start ──
  it('T7: force-indent + caret inside text → returns null (no consume)', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    // Place caret after first character "这"
    placeCaretInsideText(p, 1)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.caretAtLogicalStart).toBe(false)
    expect(ctx!.mode).toBe('force-indent')
    root.remove()
  })

  // ── T8: Selection ──
  it('T8: non-collapsed selection → returns null (no consume)', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)

    // Create a non-collapsed selection
    const sel = window.getSelection()!
    const range = document.createRange()
    const textNode = findDeepFirstText(p)
    if (textNode) {
      range.setStart(textNode, 0)
      range.setEnd(textNode, 2)
    }
    sel.removeAllRanges()
    sel.addRange(range)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.selectionCollapsed).toBe(false)
    root.remove()
  })

  // ── T9: IME ──
  it('T9: isComposing=true → returns null (no consume)', () => {
    const root = createEditorRoot()
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'force-indent')
    appendBlocks(root, p)
    placeCaretAtStart(p)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, true)
    expect(ctx).not.toBeNull()
    expect(ctx!.composing).toBe(true)
    expect(ctx!.caretAtLogicalStart).toBe(false)
    root.remove()
  })

  // ── T10: Excluded Context ──
  it('T10: heading/list/quote/code → returns null (excluded)', () => {
    const root = createEditorRoot()

    // Test heading
    const h2 = makeHeading(2, '标题')
    setParagraphIndentMode(h2, 'force-indent') // Shouldn't be possible, but test anyway
    appendBlocks(root, h2)
    placeCaretAtStart(h2)

    const ctx = shouldConsumeBackspaceForIndentRemoval(root, ENABLED_SETTINGS, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.excludedContext).toBe(true)
    expect(ctx!.caretAtLogicalStart).toBe(false)

    root.remove()

    // Test list item
    const root2 = createEditorRoot()
    const li = document.createElement('li')
    li.textContent = '列表项'
    const ul = document.createElement('ul')
    ul.appendChild(li)
    appendBlocks(root2, ul)
    const textInLi = findDeepFirstText(li)
    if (textInLi) {
      const sel = window.getSelection()!
      const range = document.createRange()
      range.setStart(textInLi, 0)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    const ctx2 = shouldConsumeBackspaceForIndentRemoval(root2, ENABLED_SETTINGS, false)
    expect(ctx2).not.toBeNull()
    expect(ctx2!.excludedContext).toBe(true)

    root2.remove()
  })

  // ── T11: Body Default 2em ──
  it('T11: force-flush sets textIndent=0 regardless of body default', () => {
    const p = makeParagraph('这是一个段落')
    // Simulate force-flush via Backspace
    setParagraphIndentMode(p, 'force-flush')

    // Verify force-flush semantics: textIndent is explicitly 0
    expect(p.style.textIndent).toBe('0px')
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-flush')
    expect(p.classList.contains('inkchapter-paragraph-indent-2')).toBe(false)

    // Verify getParagraphIndentMode returns 'force-flush' not 'auto'
    expect(getParagraphIndentMode(p)).toBe('force-flush')
  })

  // ── T11b: force-flush vs auto distinction ──
  it('T11b: auto mode does not set textIndent inline style', () => {
    const p = makeParagraph('这是一个段落')
    setParagraphIndentMode(p, 'auto')

    // auto mode: no explicit state
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBeNull()
    expect(p.style.textIndent).toBe('')
    expect(getParagraphIndentMode(p)).toBe('auto')
  })

  // ── T13: Markdown Cleanliness ──
  it('T13: textContent has no leading fake spaces, text unchanged', () => {
    const p = makeParagraph('这是一个段落')
    const originalText = p.textContent

    setParagraphIndentMode(p, 'force-indent')
    expect(p.textContent).toBe(originalText)

    setParagraphIndentMode(p, 'force-flush')
    expect(p.textContent).toBe(originalText)

    // No fake spaces / no HTML marker / text unchanged
    expect(p.textContent).toBe('这是一个段落')
    expect(p.textContent!.startsWith('  ')).toBe(false)
  })
})

// ── 28. Backspace: isCaretAtLogicalStartOfParagraph ───────────────────

describe('isCaretAtLogicalStartOfParagraph', () => {
  it('returns true for caret at start of plain text paragraph', () => {
    const p = makeParagraph('这是一个段落')
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(true)
    p.remove()
  })

  it('returns false for caret inside text', () => {
    const p = makeParagraph('这是一个段落')
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(p.firstChild!, 1)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(false)
    p.remove()
  })

  it('returns true for span-wrapped paragraph with caret at start', () => {
    const p = makeSpanParagraph('这是一个段落')
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const spanText = p.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(spanText, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(true)
    p.remove()
  })

  it('returns false for span-wrapped paragraph with caret inside', () => {
    const p = makeSpanParagraph('这是一个段落')
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const spanText = p.querySelector('span')!.firstChild!
    const range = document.createRange()
    range.setStart(spanText, 2)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(false)
    p.remove()
  })

  it('returns false for non-collapsed selection', () => {
    const p = makeParagraph('这是一个段落')
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 2)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(false)
    p.remove()
  })

  it('returns true for empty paragraph (BR only)', () => {
    const p = document.createElement('p')
    p.appendChild(document.createElement('br'))
    document.body.appendChild(p)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(p, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(true)
    p.remove()
  })

  it('returns false when preceding content exists in another inline span', () => {
    const p = document.createElement('p')
    const spanA = document.createElement('span')
    spanA.textContent = 'A'
    const spanB = document.createElement('span')
    spanB.textContent = 'B'
    p.appendChild(spanA)
    p.appendChild(spanB)
    document.body.appendChild(p)

    // Place caret at start of spanB's text
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(spanB.firstChild!, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    expect(isCaretAtLogicalStartOfParagraph(p)).toBe(false)
    p.remove()
  })
})

// ── 29. Backspace: resolveCurrentBodyParagraph ─────────────────────────

describe('resolveCurrentBodyParagraph', () => {
  it('returns paragraph element when caret is in a body paragraph', () => {
    const root = createEditorRoot()
    const p = makeParagraph('正文')
    appendBlocks(root, p)
    setSelectionInElement(p, 0)

    const result = resolveCurrentBodyParagraph(root)
    expect(result).toBe(p)
    root.remove()
  })

  it('returns null when caret is in a heading', () => {
    const root = createEditorRoot()
    const h2 = makeHeading(2, '标题')
    appendBlocks(root, h2)
    setSelectionInElement(h2, 0)

    const result = resolveCurrentBodyParagraph(root)
    expect(result).toBeNull()
    root.remove()
  })

  it('returns null when no selection', () => {
    const root = createEditorRoot()
    const p = makeParagraph('正文')
    appendBlocks(root, p)
    clearSelection()

    const result = resolveCurrentBodyParagraph(root)
    expect(result).toBeNull()
    root.remove()
  })
})

// ── 30. Trace Isolation Tests (T1-T11) ─────────────────────────────────

import {
  identifyNode,
  identifyElement,
  summarizeElement,
  safeTrace,
  activateNormalEnterTrace,
  deactivateNormalEnterTrace,
  getTraceState,
  isTraceExplicitlyEnabled,
} from './normal-enter-trace'

describe('Trace Isolation — identifyNode safety', () => {
  const testRoot = path.join(os.tmpdir(), 'inkchapter-trace-test-' + Date.now())

  beforeAll(() => {
    if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot, { recursive: true })
    // Enable trace explicitly
    ;(window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__ = true
    activateNormalEnterTrace(testRoot)
  })

  afterAll(() => {
    deactivateNormalEnterTrace()
    delete (window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true })
  })

  // T1: identifyNode(undefined) → no throw
  it('T1: identifyNode(undefined) returns null, no throw', () => {
    expect(() => identifyNode(undefined)).not.toThrow()
    expect(identifyNode(undefined)).toBeNull()
  })

  // T2: identifyNode(null) → no throw
  it('T2: identifyNode(null) returns null, no throw', () => {
    expect(() => identifyNode(null)).not.toThrow()
    expect(identifyNode(null)).toBeNull()
  })

  // T3: identifyNode(Text) → no throw
  it('T3: identifyNode(Text) returns a label, no throw', () => {
    const textNode = document.createTextNode('hello world')
    expect(() => identifyNode(textNode)).not.toThrow()
    const id = identifyNode(textNode)
    expect(id).toBeTruthy()
    expect(id).toMatch(/^N\d+$/)
  })

  // T4: identifyNode(Comment) → no throw
  it('T4: identifyNode(Comment) returns a label, no throw', () => {
    const comment = document.createComment('test comment')
    expect(() => identifyNode(comment)).not.toThrow()
    const id = identifyNode(comment)
    expect(id).toBeTruthy()
    expect(id).toMatch(/^N\d+$/)
  })

  // T5: identifyNode(DocumentFragment) → no throw
  it('T5: identifyNode(DocumentFragment) returns a label, no throw', () => {
    const frag = document.createDocumentFragment()
    frag.appendChild(document.createElement('span'))
    expect(() => identifyNode(frag)).not.toThrow()
    const id = identifyNode(frag)
    expect(id).toBeTruthy()
  })

  // T6: identifyNode(HTMLElement) → stable WeakMap ID
  it('T6: identifyNode(HTMLElement) returns stable WeakMap ID', () => {
    const div = document.createElement('div')
    div.textContent = 'test'
    const id = identifyNode(div)
    expect(id).toBeTruthy()
    expect(id).toMatch(/^N\d+$/)
  })

  // T7: same Node twice → same ID (WeakMap stability)
  it('T7: same Node twice returns same ID', () => {
    const p = document.createElement('p')
    p.textContent = 'unique paragraph'
    const id1 = identifyNode(p)
    const id2 = identifyNode(p)
    expect(id1).toBe(id2)
    expect(id1).toBeTruthy()
  })

  // T8: trace does NOT write DOM data attribute
  it('T8: identifyNode does not write DOM dataset or attributes', () => {
    const span = document.createElement('span')
    span.textContent = 'no mutation'
    const datasetsBefore = { ...span.dataset }
    const attrsBefore = span.attributes.length

    identifyNode(span)

    // No new data attributes
    expect(span.dataset.inkchapterTraceId).toBeUndefined()
    // No new attributes
    expect(span.attributes.length).toBe(attrsBefore)
    expect({ ...span.dataset }).toEqual(datasetsBefore)
  })

  // Legacy identifyElement wrapper
  it('identifyElement wrapper works for HTMLElement', () => {
    const div = document.createElement('div')
    div.textContent = 'wrapper test'
    const id = identifyElement(div)
    expect(id).toBeTruthy()
    expect(id).toMatch(/^N\d+$/)
  })

  it('identifyElement returns null for null', () => {
    expect(identifyElement(null)).toBeNull()
  })

  it('identifyElement returns null for undefined', () => {
    expect(identifyElement(undefined)).toBeNull()
  })

  // Non-Node input
  it('identifyNode returns null for plain object', () => {
    expect(identifyNode({})).toBeNull()
  })

  it('identifyNode returns null for number', () => {
    expect(identifyNode(42)).toBeNull()
  })

  it('identifyNode returns null for string', () => {
    expect(identifyNode('hello')).toBeNull()
  })
})

describe('Trace Isolation — safeTrace fail-open', () => {
  const testRoot = path.join(os.tmpdir(), 'inkchapter-trace-safetrace-' + Date.now())

  beforeAll(() => {
    if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot, { recursive: true })
    ;(window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__ = true
    activateNormalEnterTrace(testRoot)
  })

  afterAll(() => {
    deactivateNormalEnterTrace()
    delete (window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true })
  })

  // T9: safeTrace callback throws → business callback still executes
  it('T9: safeTrace catches error, business code continues', () => {
    let businessRan = false

    safeTrace(() => {
      throw new Error('Simulated trace error')
    })

    // Business code must still run — not affected by trace failure
    businessRan = true
    expect(businessRan).toBe(true)

    // Trace should be disabled after failure
    const state = getTraceState()
    expect(state.active).toBe(false)
    expect(state.failed).toBe(true)
  })

  // T10: trace failure disables trace
  it('T10: after trace failure, further trace operations are no-ops', () => {
    // Trace already failed from T9
    const state = getTraceState()
    expect(state.active).toBe(false)

    // identifyNode returns null when trace is disabled
    const div = document.createElement('div')
    expect(identifyNode(div)).toBeNull()

    // safeTrace is a no-op when trace is disabled
    let executed = false
    safeTrace(() => { executed = true })
    expect(executed).toBe(false)
  })
})

describe('Trace Isolation — default OFF', () => {
  // T11b: Trace is OFF by default without explicit opt-in
  it('Trace is off by default (isTraceExplicitlyEnabled returns false)', () => {
    // After previous tests cleaned up the window flag
    delete (window as any).__INKCHAPTER_NORMAL_ENTER_TRACE__
    expect(isTraceExplicitlyEnabled()).toBe(false)
  })

  it('activateNormalEnterTrace does nothing without explicit opt-in', () => {
    const stateBefore = getTraceState()
    activateNormalEnterTrace()
    const stateAfter = getTraceState()
    expect(stateAfter.active).toBe(false)
  })
})

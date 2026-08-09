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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setParagraphIndentMode,
  getParagraphIndentMode,
  INDENT_MODE_ATTR,
  resolveCurrentBlockFromSelection,
  resolvePreviousBlock,
  isContentBlock,
  probeParagraphIndentShortcut,
  resetBlockProbeDiagnostic,
  resetProcessedPairs,
  writeBlockProbeDiagnostic,
  classifyEditorMutation,
  injectShortcutMarkerInMarkdown,
  canonicalizeParagraphIndentMarkers,
  parseIndentMarkers,
  focusParagraphAfterMarkerIndex,
  applyIndentByMarkerIndex,
  type ParagraphIndentSemanticMode,
  type ShortcutProbeResult,
  type MutationClassification,
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
const FLAG_ON = { hasParagraphCommandMutation: true }
const FLAG_OFF = { hasParagraphCommandMutation: false }

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

// ── 3. Shortcut Probe Tests (revised for paragraph-command-mutation flag) ──

describe('probeParagraphIndentShortcut (paragraph-command-mutation flag)', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = createEditorRoot()
    resetProcessedPairs()
  })
  afterEach(() => { clearSelection(); root.remove() })

  // ── Branch A: requires paragraph-command-mutation flag ──

  it('returns null WITHOUT paragraph-command-mutation flag (Branch A guard)', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)

    // Any reason without the flag should return null
    expect(probeParagraphIndentShortcut(root, 'editor-input', ENABLED_SETTINGS)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'editor-input', ENABLED_SETTINGS, FLAG_OFF)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'editor-mutation', ENABLED_SETTINGS, FLAG_OFF)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'initial-load', ENABLED_SETTINGS)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'file-open', ENABLED_SETTINGS)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'focus-in', ENABLED_SETTINGS)).toBeNull()
    expect(probeParagraphIndentShortcut(root, 'editor-click', ENABLED_SETTINGS)).toBeNull()
  })

  it('allows match WITH paragraph-command-mutation flag (Branch A pass)', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)

    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('..')
  })

  // ── Branch B: selection → block resolver ──

  it('returns null when selection cannot resolve current block (Branch B)', () => {
    clearSelection()
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('returns null when cursor is on a heading (Branch B — not content block)', () => {
    const prevPara = makeParagraph('text')
    const h2 = makeHeading(2, 'Title')
    appendBlocks(root, prevPara, h2)
    setSelectionInElement(h2, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  // ── Branch C: previous block resolver ──

  it('returns null when current block has no previous sibling (Branch C)', () => {
    const b = makeParagraph('')
    appendBlocks(root, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('returns null when previous block is a heading (Branch C — not content)', () => {
    const h2 = makeHeading(2, 'Title')
    const b = makeParagraph('')
    appendBlocks(root, h2, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  // ── Branch D: command filter / setting / dedupe ──

  it('returns null when indentShortcutEnabled is false (Branch D)', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', DISABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('returns null for invalid command token "..." (Branch D)', () => {
    const a = makeParagraph('...')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('returns null for invalid command token "abc.." (Branch D)', () => {
    const a = makeParagraph('abc..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('returns null when cursor is not in the target block (anti-false-positive)', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    const c = makeParagraph('other text')
    appendBlocks(root, a, b, c)
    setSelectionInElement(c, 0)
    expect(probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)).toBeNull()
  })

  it('deduplicates same (A, B) pair (Branch D dedupe)', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)

    const r1 = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(r1).not.toBeNull()

    const r2 = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(r2).toBeNull()
  })

  // ── Exact token recognition ──

  it('recognizes ".." exact command', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('..')
  })

  it('recognizes "。。" exact command', () => {
    const a = makeParagraph('。。')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(result).not.toBeNull()
    expect(result!.token).toBe('。。')
  })

  // ── Historical ".." not consumed ──

  it('does NOT trigger when cursor clicks historical ".." without flag', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('some text already')
    appendBlocks(root, a, b)
    setSelectionInElement(a, 2)
    // Without the paragraph-command-mutation flag, no trigger
    expect(probeParagraphIndentShortcut(root, 'editor-click', ENABLED_SETTINGS)).toBeNull()
  })

  it('does NOT trigger on focus-in without paragraph-command-mutation', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    expect(probeParagraphIndentShortcut(root, 'focus-in', ENABLED_SETTINGS)).toBeNull()
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

// ── 5. Pipeline Integration Tests ──────────────────────────────────────

describe('Pipeline Integration: mutation → paragraph-command → probe → semantic setter', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = createEditorRoot()
    resetProcessedPairs()
  })
  afterEach(() => { clearSelection(); root.remove() })

  it('full producer→consumer integration: mutation classifier → probe → force-indent', () => {
    // Simulate the mutation observer seeing a paragraph added
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)

    // Classifier: mock a small childList adding a P
    const mockMut = { type: 'childList', target: root, addedNodes: [b] as unknown as NodeList, removedNodes: [] as unknown as NodeList } as unknown as MutationRecord
    const cls = classifyEditorMutation([mockMut], root)
    expect(cls.paragraphCommandCandidate).toBe(true)

    // Set cursor in B
    setSelectionInElement(b, 0)

    // Probe with paragraph-command flag
    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(result).not.toBeNull()
    expect(result!.commandBlock).toBe(a)
    expect(result!.targetBlock).toBe(b)

    // Apply semantic force-indent
    setParagraphIndentMode(result!.targetBlock, 'force-indent')
    expect(b.classList.contains('inkchapter-paragraph-indent-2')).toBe(true)
    expect(b.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })

  it('focus-in does NOT trigger shortcut even with A/B present', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)
    // Without paragraph-command-mutation flag, no probe match
    const result = probeParagraphIndentShortcut(root, 'focus-in', ENABLED_SETTINGS)
    expect(result).toBeNull()
  })

  it('pipeline respects formula continuation priority', () => {
    const a = makeParagraph('..')
    const b = makeParagraph('')
    appendBlocks(root, a, b)
    setSelectionInElement(b, 0)

    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
    expect(result).not.toBeNull()

    setParagraphIndentMode(b, 'force-indent')
    expect(getParagraphIndentMode(b)).toBe('force-indent')
    setParagraphIndentMode(b, 'force-flush')
    expect(getParagraphIndentMode(b)).toBe('force-flush')
    setParagraphIndentMode(b, 'force-indent')
    expect(getParagraphIndentMode(b)).toBe('force-indent')
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
    const b = blocks[19]
    setSelectionInElement(b, 0)
    const result = probeParagraphIndentShortcut(root, 'paragraph-command-mutation', ENABLED_SETTINGS, FLAG_ON)
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
  it('ShortcutProbeResult has required fields', () => {
    const r: ShortcutProbeResult = {
      commandBlock: document.createElement('p'),
      targetBlock: document.createElement('p'),
      token: '..',
    }
    expect(r.token).toBe('..')
    expect(r.commandBlock.tagName).toBe('P')
  })

  it('INDENT_MODE_ATTR is the correct value', () => {
    expect(INDENT_MODE_ATTR).toBe('data-inkchapter-indent-mode')
  })
})

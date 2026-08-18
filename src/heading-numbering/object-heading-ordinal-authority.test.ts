// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  buildStructuredHeadingStates,
  buildNumberingPath,
  buildObjectHeadingIndex,
  resolveObjectHeadingOrdinalContext,
  roleForPhysicalLevel,
  checkObjectContextGenerationGate,
  checkWorkspaceActiveDocumentGate,
  resolveDocumentBlockAnchor,
  projectLiveObjectHeadingContexts,
  resolveTrueQuiescence,
} from './object-heading-ordinal-authority'
import { resolveLogicalHeadingRoleMap } from './heading-context-resolver'
import type { NumberedHeading } from './heading-types'

function numberedStrict(): NumberedHeading[] {
  return [
    { key: 'H1:idx:0', level: 1, text: '标题', counters: [1], label: '', labelGap: 'none' },
    { key: 'H2:idx:1', level: 2, text: '第一章', counters: [1, 1], label: '1', labelGap: 'space' },
    { key: 'H3:idx:2', level: 3, text: '第一节', counters: [1, 1, 1], label: '1.1', labelGap: 'space' },
    { key: 'H3:idx:3', level: 3, text: '第二节', counters: [1, 1, 2], label: '1.2', labelGap: 'space' },
  ]
}

describe('buildNumberingPath', () => {
  const strict = resolveLogicalHeadingRoleMap('strict')
  it('chapter path excludes hidden H1 title', () => {
    expect(buildNumberingPath([1, 1], 2, strict)).toEqual([1])
  })
  it('section path = [chapter, section]', () => {
    expect(buildNumberingPath([1, 1, 2], 3, strict)).toEqual([1, 2])
  })
})

describe('buildStructuredHeadingStates', () => {
  it('strict: maps H2→chapter, H3→section with numeric ordinals', () => {
    const states = buildStructuredHeadingStates(numberedStrict(), resolveLogicalHeadingRoleMap('strict'), 'docA')
    const chapter = states[1]
    const section1 = states[2]
    const section2 = states[3]

    expect(chapter.logicalRole).toBe('chapter')
    expect(chapter.logicalDepth).toBe(1)
    expect(chapter.ordinal).toBe(1)
    expect(chapter.numberingPath).toEqual([1])

    expect(section1.logicalRole).toBe('section')
    expect(section1.ordinal).toBe(1)
    expect(section1.numberingPath).toEqual([1, 1])

    expect(section2.logicalRole).toBe('section')
    expect(section2.ordinal).toBe(2)
    expect(section2.numberingPath).toEqual([1, 2])
  })

  it('strict: H1 title is unnumbered and role null', () => {
    const states = buildStructuredHeadingStates(numberedStrict(), resolveLogicalHeadingRoleMap('strict'), 'docA')
    expect(states[0].logicalRole).toBeNull()
    expect(states[0].numbered).toBe(false)
    expect(states[0].ordinal).toBeNull()
  })

  it('loose: H1 is chapter', () => {
    const loose: NumberedHeading[] = [
      { key: 'H1:idx:0', level: 1, text: '第五章', counters: [5], label: '第五章', labelGap: 'space' },
      { key: 'H2:idx:1', level: 2, text: '第一节', counters: [5, 1], label: '第五章 第一节', labelGap: 'space' },
    ]
    const states = buildStructuredHeadingStates(loose, resolveLogicalHeadingRoleMap('loose'), 'docA')
    expect(states[0].logicalRole).toBe('chapter')
    expect(states[0].ordinal).toBe(5)
    expect(states[0].numberingPath).toEqual([5])
    expect(states[1].logicalRole).toBe('section')
    expect(states[1].ordinal).toBe(1)
    expect(states[1].numberingPath).toEqual([5, 1])
  })
})

describe('resolveObjectHeadingOrdinalContext', () => {
  it('resolves chapter/section by document order (never closest)', () => {
    const root = document.createElement('div')
    const h2 = document.createElement('h2')
    const h3a = document.createElement('h3')
    const target = document.createElement('div')
    target.className = 'md-math-block'
    const h3b = document.createElement('h3')
    root.append(h2, h3a, target, h3b)
    document.body.appendChild(root)

    const nodeByKey = new Map<string, HTMLElement>([
      ['H2:idx:0', h2],
      ['H3:idx:1', h3a],
      ['H3:idx:2', h3b],
    ])
    const numbered: NumberedHeading[] = [
      { key: 'H2:idx:0', level: 2, text: '第一章', counters: [1, 1], label: '1', labelGap: 'space' },
      { key: 'H3:idx:1', level: 3, text: '第一节', counters: [1, 1, 1], label: '1.1', labelGap: 'space' },
      { key: 'H3:idx:2', level: 3, text: '第二节', counters: [1, 1, 2], label: '1.2', labelGap: 'space' },
    ]
    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const states = buildStructuredHeadingStates(numbered, roleMap, 'docA', nodeByKey)
    const index = buildObjectHeadingIndex('docA', states, 1)

    const ctx = resolveObjectHeadingOrdinalContext(target, 'docA', index, roleMap)
    expect(ctx.chapterOrdinal).toBe(1)
    expect(ctx.sectionOrdinal).toBe(1)
    expect(ctx.decision).toBe('RESOLVED')
  })

  it('target after second section resolves section=2', () => {
    const root = document.createElement('div')
    const h2 = document.createElement('h2')
    const h3a = document.createElement('h3')
    const h3b = document.createElement('h3')
    const target = document.createElement('div')
    root.append(h2, h3a, h3b, target)
    document.body.appendChild(root)

    const nodeByKey = new Map<string, HTMLElement>([
      ['H2:idx:0', h2],
      ['H3:idx:1', h3a],
      ['H3:idx:2', h3b],
    ])
    const numbered: NumberedHeading[] = [
      { key: 'H2:idx:0', level: 2, text: '第一章', counters: [1, 1], label: '1', labelGap: 'space' },
      { key: 'H3:idx:1', level: 3, text: '第一节', counters: [1, 1, 1], label: '1.1', labelGap: 'space' },
      { key: 'H3:idx:2', level: 3, text: '第二节', counters: [1, 1, 2], label: '1.2', labelGap: 'space' },
    ]
    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const states = buildStructuredHeadingStates(numbered, roleMap, 'docA', nodeByKey)
    const index = buildObjectHeadingIndex('docA', states, 1)

    const ctx = resolveObjectHeadingOrdinalContext(target, 'docA', index, roleMap)
    expect(ctx.chapterOrdinal).toBe(1)
    expect(ctx.sectionOrdinal).toBe(2)
  })
})

describe('roleForPhysicalLevel', () => {
  const strict = resolveLogicalHeadingRoleMap('strict')
  it('maps physical levels to logical roles', () => {
    expect(roleForPhysicalLevel(2, strict)).toBe('chapter')
    expect(roleForPhysicalLevel(3, strict)).toBe('section')
    expect(roleForPhysicalLevel(4, strict)).toBe('subsection')
    expect(roleForPhysicalLevel(1, strict)).toBeNull()
  })
})

describe('checkObjectContextGenerationGate (v2.5.4)', () => {
  it('Case A: cross document generation → BLOCK', () => {
    const r = checkObjectContextGenerationGate({
      currentDocumentKey: 'B', indexDocumentKey: 'A', targetDocumentKey: 'B',
      currentDocumentGeneration: 2, indexDocumentGeneration: 1,
      currentEditorRootToken: 2, indexEditorRootToken: 1, targetEditorRootToken: 2,
    })
    expect(r.decision).toBe('BLOCK')
    expect(r.reason).toBe('BLOCK_CROSS_DOCUMENT_GENERATION')
  })

  it('Case B: same doc/gen but different root → BLOCK_STALE_EDITOR_ROOT', () => {
    const r = checkObjectContextGenerationGate({
      currentDocumentKey: 'A', indexDocumentKey: 'A', targetDocumentKey: 'A',
      currentDocumentGeneration: 1, indexDocumentGeneration: 1,
      currentEditorRootToken: 2, indexEditorRootToken: 1, targetEditorRootToken: 2,
    })
    expect(r.decision).toBe('BLOCK')
    expect(r.reason).toBe('BLOCK_STALE_EDITOR_ROOT')
  })

  it('Case C: same doc/gen/root → PASS', () => {
    const r = checkObjectContextGenerationGate({
      currentDocumentKey: 'A', indexDocumentKey: 'A', targetDocumentKey: 'A',
      currentDocumentGeneration: 1, indexDocumentGeneration: 1,
      currentEditorRootToken: 1, indexEditorRootToken: 1, targetEditorRootToken: 1,
    })
    expect(r.decision).toBe('PASS')
    expect(r.reason).toBeNull()
  })
})

describe('projectLiveObjectHeadingContexts (v2.5.4)', () => {
  it('live DOM order decides context; structured ordinal supplies numbers', () => {
    const root = document.createElement('div')
    const h2 = document.createElement('h2')
    h2.setAttribute('data-inkchapter-heading-id', 'ch2')
    const h3a = document.createElement('h3')
    h3a.setAttribute('data-inkchapter-heading-id', 'sec1')
    const fA = document.createElement('div')
    fA.className = 'md-math-block'
    const fB = document.createElement('div')
    fB.className = 'md-math-block'
    const h3b = document.createElement('h3')
    h3b.setAttribute('data-inkchapter-heading-id', 'sec2')
    const fC = document.createElement('div')
    fC.className = 'md-math-block'
    root.append(h2, h3a, fA, fB, h3b, fC)
    document.body.appendChild(root)

    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const numbered: NumberedHeading[] = [
      { key: 'ch2', level: 2, text: '第二章', counters: [1, 2], label: '2', labelGap: 'space' },
      { key: 'sec1', level: 3, text: '第一节', counters: [1, 2, 1], label: '2.1', labelGap: 'space' },
      { key: 'sec2', level: 3, text: '第二节', counters: [1, 2, 2], label: '2.2', labelGap: 'space' },
    ]
    // NOTE: structured nodes are intentionally NOT supplied (stale/disconnected).
    const states = buildStructuredHeadingStates(numbered, roleMap, 'docA')
    const index = buildObjectHeadingIndex('docA', states, 1, 1, 1)

    const projection = projectLiveObjectHeadingContexts(
      [
        { element: h2, headingId: 'ch2' },
        { element: h3a, headingId: 'sec1' },
        { element: h3b, headingId: 'sec2' },
      ],
      [
        { element: fA, objectType: 'formula', runtimeKey: 'f0' },
        { element: fB, objectType: 'formula', runtimeKey: 'f1' },
        { element: fC, objectType: 'formula', runtimeKey: 'f2' },
      ],
      index,
      roleMap,
      root,
    )

    expect(projection.matchedHeadingCount).toBe(3)
    expect(projection.unmatchedHeadingCount).toBe(0)
    expect(projection.contexts[0]).toMatchObject({ chapterOrdinal: 2, sectionOrdinal: 1 })
    expect(projection.contexts[1]).toMatchObject({ chapterOrdinal: 2, sectionOrdinal: 1 })
    expect(projection.contexts[2]).toMatchObject({ chapterOrdinal: 2, sectionOrdinal: 2 })
    expect(projection.contexts[0].source).toBe('LIVE_DOM_PLUS_STRUCTURED_HEADING_STATE')
  })

  it('unmatched live heading → NOT_READY (never fallback document)', () => {
    const root = document.createElement('div')
    const h2 = document.createElement('h2')
    h2.setAttribute('data-inkchapter-heading-id', 'missing')
    const fA = document.createElement('div')
    root.append(h2, fA)
    document.body.appendChild(root)

    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const index = buildObjectHeadingIndex('docA', [], 1, 1, 1)
    const projection = projectLiveObjectHeadingContexts(
      [{ element: h2, headingId: 'missing' }],
      [{ element: fA, objectType: 'formula', runtimeKey: 'f0' }],
      index,
      roleMap,
      root,
    )
    expect(projection.matchedHeadingCount).toBe(0)
    expect(projection.contexts[0].decision).toBe('NONE')
    expect(projection.contexts[0].chapterOrdinal).toBeNull()
  })

  it('v2.5.5 regression: interleaved (table/formula) NOT headings-first', () => {
    const root = document.createElement('div')
    const h2a = document.createElement('h2'); h2a.setAttribute('data-inkchapter-heading-id', 'ch5')
    const h3a = document.createElement('h3'); h3a.setAttribute('data-inkchapter-heading-id', 's1')
    const h3b = document.createElement('h3'); h3b.setAttribute('data-inkchapter-heading-id', 's2')
    const table = document.createElement('table')
    const h3c = document.createElement('h3'); h3c.setAttribute('data-inkchapter-heading-id', 's3')
    const formulaA = document.createElement('div'); formulaA.className = 'md-math-block'
    const h2b = document.createElement('h2'); h2b.setAttribute('data-inkchapter-heading-id', 'ch6')
    const h3d = document.createElement('h3'); h3d.setAttribute('data-inkchapter-heading-id', 's1b')
    const formulaB = document.createElement('div'); formulaB.className = 'md-math-block'
    root.append(h2a, h3a, h3b, table, h3c, formulaA, h2b, h3d, formulaB)
    document.body.appendChild(root)

    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const numbered: NumberedHeading[] = [
      { key: 'ch5', level: 2, text: '第五章', counters: [1, 5], label: '5', labelGap: 'space' },
      { key: 's1', level: 3, text: '一', counters: [1, 5, 1], label: '5.1', labelGap: 'space' },
      { key: 's2', level: 3, text: '二', counters: [1, 5, 2], label: '5.2', labelGap: 'space' },
      { key: 's3', level: 3, text: '三', counters: [1, 5, 3], label: '5.3', labelGap: 'space' },
      { key: 'ch6', level: 2, text: '第六章', counters: [1, 6], label: '6', labelGap: 'space' },
      { key: 's1b', level: 3, text: '一', counters: [1, 6, 1], label: '6.1', labelGap: 'space' },
    ]
    const states = buildStructuredHeadingStates(numbered, roleMap, 'docA')
    const index = buildObjectHeadingIndex('docA', states, 1, 1, 1)

    const projection = projectLiveObjectHeadingContexts(
      [
        { element: h2a, headingId: 'ch5' }, { element: h3a, headingId: 's1' },
        { element: h3b, headingId: 's2' }, { element: h3c, headingId: 's3' },
        { element: h2b, headingId: 'ch6' }, { element: h3d, headingId: 's1b' },
      ],
      [
        { element: table, objectType: 'table', runtimeKey: 't0' },
        { element: formulaA, objectType: 'formula', runtimeKey: 'f0' },
        { element: formulaB, objectType: 'formula', runtimeKey: 'f1' },
      ],
      index,
      roleMap,
      root,
    )

    // table → 5.2, formula A → 5.3, formula B → 6.1 (NOT all 6.1).
    expect(projection.contexts[0]).toMatchObject({ chapterOrdinal: 5, sectionOrdinal: 2 })
    expect(projection.contexts[1]).toMatchObject({ chapterOrdinal: 5, sectionOrdinal: 3 })
    expect(projection.contexts[2]).toMatchObject({ chapterOrdinal: 6, sectionOrdinal: 1 })
    // The old bug (all 6.1) must not pass.
    expect(projection.contexts[1].chapterOrdinal).not.toBe(6)
  })
})

describe('resolveTrueQuiescence (v2.5.4)', () => {
  const base = {
    lastBusinessMutationAt: 0,
    lastFormulaRefreshAt: 10000,
    lastFormulaDomWriteAt: 0,
    lastDocumentSwitchAt: 0,
    lastFormulaSettingsChangeAt: 0,
    pendingRefreshCount: 0,
    reentrantRefreshCount: 0,
  }
  it('idle=0ms → NOT_YET_QUIESCENT', () => {
    const r = resolveTrueQuiescence({ ...base, now: 10000 })
    expect(r.idleWindowMs).toBe(0)
    expect(r.decision).toBe('NOT_YET_QUIESCENT')
  })
  it('idle=9999ms → NOT_YET_QUIESCENT', () => {
    const r = resolveTrueQuiescence({ ...base, now: 19999 })
    expect(r.idleWindowMs).toBe(9999)
    expect(r.decision).toBe('NOT_YET_QUIESCENT')
  })
  it('idle>=10000 + pending=0 + reentrant=0 → QUIESCENT', () => {
    const r = resolveTrueQuiescence({ ...base, now: 20000 })
    expect(r.idleWindowMs).toBe(10000)
    expect(r.decision).toBe('QUIESCENT')
  })
  it('idle>=10000 but pending>0 → NOT_YET_QUIESCENT', () => {
    const r = resolveTrueQuiescence({ ...base, now: 20000, pendingRefreshCount: 1 })
    expect(r.decision).toBe('NOT_YET_QUIESCENT')
  })
})

describe('resolveDocumentBlockAnchor (v2.5.6)', () => {
  it('normalizes a nested formula host to its top-level block child', () => {
    const root = document.createElement('div')
    const child4 = document.createElement('div')
    child4.className = 'md-math-block'
    const inner = document.createElement('mjx-container')
    child4.appendChild(inner)
    root.appendChild(child4)
    document.body.appendChild(root)

    const res = resolveDocumentBlockAnchor(inner, root, 'formula', 'f0', 1)
    expect(res.decision).toBe('RESOLVED')
    expect(res.anchor?.anchorNode).toBe(child4)
    expect(res.anchor?.blockOrdinal).toBe(0)
  })

  it('blockOrdinal ordering: 5.3 heading < formula < chapter 6', () => {
    const root = document.createElement('div')
    const h2a = document.createElement('h2'); h2a.setAttribute('data-inkchapter-heading-id', 'ch5')
    const h3a = document.createElement('h3'); h3a.setAttribute('data-inkchapter-heading-id', 's3')
    const formulaA = document.createElement('div'); formulaA.className = 'md-math-block'
    const h2b = document.createElement('h2'); h2b.setAttribute('data-inkchapter-heading-id', 'ch6')
    root.append(h2a, h3a, formulaA, h2b)
    document.body.appendChild(root)

    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const numbered: NumberedHeading[] = [
      { key: 'ch5', level: 2, text: '第五章', counters: [1, 5], label: '5', labelGap: 'space' },
      { key: 's3', level: 3, text: '三', counters: [1, 5, 3], label: '5.3', labelGap: 'space' },
      { key: 'ch6', level: 2, text: '第六章', counters: [1, 6], label: '6', labelGap: 'space' },
    ]
    const index = buildObjectHeadingIndex('docA', buildStructuredHeadingStates(numbered, roleMap, 'docA'), 1, 1, 1)
    const projection = projectLiveObjectHeadingContexts(
      [
        { element: h2a, headingId: 'ch5' },
        { element: h3a, headingId: 's3' },
        { element: h2b, headingId: 'ch6' },
      ],
      [{ element: formulaA, objectType: 'formula', runtimeKey: 'f0' }],
      index,
      roleMap,
      root,
      1,
    )

    expect(projection.contexts[0]).toMatchObject({ chapterOrdinal: 5, sectionOrdinal: 3 })
    const formulaEvent = projection.events.find((e) => e.kind === 'object')
    const h3Event = projection.events.find((e) => e.headingId === 's3')
    const ch6Event = projection.events.find((e) => e.headingId === 'ch6')
    expect(h3Event!.blockOrdinal).toBeLessThan(formulaEvent!.blockOrdinal)
    expect(formulaEvent!.blockOrdinal).toBeLessThan(ch6Event!.blockOrdinal)
    expect(projection.stream.monotonicBlockOrder).toBe(true)
    expect(projection.contextOrderMismatchCount).toBe(0)
  })

  it('snapshot is immutable: later headings never mutate an earlier snapshot', () => {
    const root = document.createElement('div')
    const h2a = document.createElement('h2'); h2a.setAttribute('data-inkchapter-heading-id', 'ch5')
    const h3a = document.createElement('h3'); h3a.setAttribute('data-inkchapter-heading-id', 's3')
    const fA = document.createElement('div'); fA.className = 'md-math-block'
    const h2b = document.createElement('h2'); h2b.setAttribute('data-inkchapter-heading-id', 'ch6')
    root.append(h2a, h3a, fA, h2b)
    document.body.appendChild(root)

    const roleMap = resolveLogicalHeadingRoleMap('strict')
    const numbered: NumberedHeading[] = [
      { key: 'ch5', level: 2, text: '第五章', counters: [1, 5], label: '5', labelGap: 'space' },
      { key: 's3', level: 3, text: '三', counters: [1, 5, 3], label: '5.3', labelGap: 'space' },
      { key: 'ch6', level: 2, text: '第六章', counters: [1, 6], label: '6', labelGap: 'space' },
    ]
    const index = buildObjectHeadingIndex('docA', buildStructuredHeadingStates(numbered, roleMap, 'docA'), 1, 1, 1)
    const projection = projectLiveObjectHeadingContexts(
      [
        { element: h2a, headingId: 'ch5' },
        { element: h3a, headingId: 's3' },
        { element: h2b, headingId: 'ch6' },
      ],
      [{ element: fA, objectType: 'formula', runtimeKey: 'f0' }],
      index,
      roleMap,
      root,
      1,
    )

    // Formula A snapshot stays 5.3 even though a later chapter 6 follows.
    expect(projection.contexts[0].chapterOrdinal).toBe(5)
    expect(projection.contexts[0].sectionOrdinal).toBe(3)
    expect(projection.snapshots[0].blockOrdinal).toBe(2)
    expect(projection.snapshots[0].snapshotId).toMatch(/^snap-/)
  })
})

describe('checkWorkspaceActiveDocumentGate (v2.5.6)', () => {
  it('workspace key != service key → BLOCK PRE_DOCUMENT_CONTEXT_SWITCH', () => {
    const r = checkWorkspaceActiveDocumentGate({
      workspaceActivePath: '/vault/b.md',
      workspaceDocumentKey: 'b',
      serviceDocumentKey: 'a',
      headingIndexDocumentKey: 'a',
      documentGeneration: 1,
      editorRootToken: 1,
      businessReady: true,
    })
    expect(r.decision).toBe('BLOCK')
    expect(r.reason).toBe('PRE_DOCUMENT_CONTEXT_SWITCH')
  })

  it('workspace key == service key → PASS', () => {
    const r = checkWorkspaceActiveDocumentGate({
      workspaceActivePath: '/vault/a.md',
      workspaceDocumentKey: 'a',
      serviceDocumentKey: 'a',
      headingIndexDocumentKey: 'a',
      documentGeneration: 1,
      editorRootToken: 1,
      businessReady: true,
    })
    expect(r.decision).toBe('PASS')
  })
})

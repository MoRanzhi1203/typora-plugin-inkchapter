import { describe, it, expect } from 'vitest'
import {
  armEnterEchoWriteTrace,
  classifyWriteOrigin,
  drainEnterEchoWriteTrace,
  isEnterEchoWriteTraceArmed,
  noteEnterEchoWrite,
} from './enter-echo-write-trace'

describe('ENTER→BLANK ECHO GUARD — DOM-write call-stack tracer', () => {
  it('records plugin writes ONLY inside the armed echo window', () => {
    armEnterEchoWriteTrace('NENTER-1', 250, 1000)
    expect(isEnterEchoWriteTraceArmed(1000)).toBe(true)
    expect(isEnterEchoWriteTraceArmed(1249)).toBe(true)
    expect(isEnterEchoWriteTraceArmed(1250)).toBe(false)

    noteEnterEchoWrite('write:x', 'WRITE', 1010)
    noteEnterEchoWrite('write:y', 'WRITE', 1300) // outside the window → ignored
    const out = drainEnterEchoWriteTrace()
    expect(out.sceneId).toBe('NENTER-1')
    expect(out.records).toHaveLength(1)
    expect(out.records[0].kind).toBe('write:x')
    expect(out.records[0].sinceEnterMs).toBe(10)
    // drain clears the buffer
    expect(drainEnterEchoWriteTrace().records).toHaveLength(0)
  })

  it('is a NO-OP when never armed (normal editing is unaffected)', () => {
    // a fresh arm window that has already expired
    armEnterEchoWriteTrace('S', 0, 0)
    noteEnterEchoWrite('write:z', 'WRITE', 10)
    expect(drainEnterEchoWriteTrace().records).toHaveLength(0)
  })

  it('is BOUNDED — never accumulates unbounded records', () => {
    armEnterEchoWriteTrace('S', 1000, 0)
    for (let i = 0; i < 200; i++) noteEnterEchoWrite('write:n' + i, 'WRITE', i)
    const out = drainEnterEchoWriteTrace()
    expect(out.records.length).toBeLessThanOrEqual(24)
    expect(out.truncated).toBe(true)
  })

  // §B2 — "wrapped in main.js" ≠ "the plugin is the writer". The caller frames are
  // passed in AFTER the tracer-internal frames were dropped (firstFrames(4)).
  it('classifyWriteOrigin uses the FIRST REAL EXTERNAL frame, not the wrapper', () => {
    // tracer frames already dropped; real caller is Typora → typora
    const typora = 'Function.L [as find] (typora://app/typemark/appsrc/window/frame.js) | Editor.pressReturn (typora://…) | HTMLDivElement.<anonymous> (typora://…)'
    expect(classifyWriteOrigin(typora)).toBe('typora')
    // a real plugin business frame (no typora:// frame at all) → plugin
    const plugin = 'applyHeadingLayouts (…/plugins/dist/main.js) | refreshParagraphIndents (…/plugins/dist/main.js)'
    expect(classifyWriteOrigin(plugin)).toBe('plugin')
    expect(classifyWriteOrigin('')).toBe('unknown')
  })

  it('tags structural vs attribute-only writes so attributes can never be structural evidence', () => {
    armEnterEchoWriteTrace('S', 1000, 0)
    noteEnterEchoWrite('attr:setAttribute', 'P.md-end-block', 1, 'typora', 'st')
    noteEnterEchoWrite('struct:appendChild', 'DIV', 2, 'plugin', 'st')
    const out = drainEnterEchoWriteTrace()
    expect(out.records.filter(r => r.kind.startsWith('struct:')).map(r => r.origin)).toEqual(['plugin'])
    expect(out.records.filter(r => r.kind.startsWith('attr:')).map(r => r.origin)).toEqual(['typora'])
    expect(out.truncated).toBe(false)
  })
})

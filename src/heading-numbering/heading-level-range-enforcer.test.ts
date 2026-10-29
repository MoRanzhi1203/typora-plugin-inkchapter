// @vitest-environment jsdom
/**
 * PA-FENCE-01 — HeadingLevelRangeEnforcer must never rewrite heading-looking
 * lines that live inside fenced code blocks.
 *
 * Typora renders ``` ~~~ ``` fenced blocks exactly like ``` ``` ``` blocks, but
 * the enforcer only recognized backtick fences, so a `##### x` line inside a
 * `~~~` block was escaped to `\#\#\#\#\# x` and the user's Markdown was
 * silently corrupted when a max heading level (< 6) was configured.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HeadingLevelRangeEnforcer, preserveBlockedAtxHeadingAsText } from './heading-level-range-enforcer'

function makeWriteWithH5(): HTMLElement {
  const write = document.createElement('div')
  write.id = 'write'
  const h5 = document.createElement('h5')
  h5.textContent = '## placeholder'
  write.appendChild(h5)
  document.body.appendChild(write)
  return write
}

interface Harness {
  enforcer: HeadingLevelRangeEnforcer
  reloaded: string[]
  notices: string[]
}

function makeHarness(markdown: string): Harness {
  const reloaded: string[] = []
  const notices: string[] = []
  const enforcer = new HeadingLevelRangeEnforcer({
    getEffectiveMaxLevel: () => 4,
    getMarkdown: () => markdown,
    reloadContent: (md: string) => { reloaded.push(md) },
    showNotice: (m: string) => { notices.push(m) },
  })
  return { enforcer, reloaded, notices }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PA-FENCE-01 fenced code is never rewritten', () => {
  it('keeps heading-looking lines inside a ~~~ fence intact', () => {
    makeWriteWithH5()
    const md = [
      '# 第一章',
      '',
      '~~~',
      '##### 代码块里的内容',
      '~~~',
      '',
      '正文段落',
    ].join('\n')
    const h = makeHarness(md)
    h.enforcer.enforceAfterMutation()
    vi.advanceTimersByTime(500)
    // Nothing outside a fence needs fixing → the document is never rewritten.
    expect(h.reloaded).toHaveLength(0)
  })

  it('keeps heading-looking lines inside a ``` fence intact', () => {
    makeWriteWithH5()
    const md = ['# 第一章', '```md', '##### 示例标题', '```', ''].join('\n')
    const h = makeHarness(md)
    h.enforcer.enforceAfterMutation()
    vi.advanceTimersByTime(500)
    expect(h.reloaded).toHaveLength(0)
  })

  it('still escapes a REAL out-of-range heading outside the fence', () => {
    makeWriteWithH5()
    const md = ['# 第一章', '', '~~~', '##### 代码里的', '~~~', '', '##### 真标题', ''].join('\n')
    const h = makeHarness(md)
    h.enforcer.enforceAfterMutation()
    vi.advanceTimersByTime(500)
    const out = h.reloaded[0]
    expect(out).toContain('##### 代码里的')
    expect(out).toContain('\\#\\#\\#\\#\\# 真标题')
  })

  it('treats an unclosed fence as protected to the end of the document', () => {
    makeWriteWithH5()
    const md = ['# 第一章', '', '~~~', '##### 未闭合', '##### 后续内容'].join('\n')
    const h = makeHarness(md)
    h.enforcer.enforceAfterMutation()
    vi.advanceTimersByTime(500)
    expect(h.reloaded).toHaveLength(0)
  })
})

describe('PA-FENCE-02 paste path shares the same fence recognition', () => {
  it('does not rewrite ~~~ fenced content after paste', () => {
    makeWriteWithH5()
    const md = ['~~~', '##### 粘贴进来的代码', '~~~', '##### 粘贴进来的标题'].join('\n')
    const h = makeHarness(md)
    h.enforcer.enforceAfterPaste()
    vi.advanceTimersByTime(500)
    const out = h.reloaded[0]
    expect(out).toContain('##### 粘贴进来的代码')
    expect(out).toContain('\\#\\#\\#\\#\\# 粘贴进来的标题')
    expect(h.notices).toHaveLength(1)
  })
})

describe('preserveBlockedAtxHeadingAsText contract', () => {
  it('escapes the exact hash count and preserves the text', () => {
    expect(preserveBlockedAtxHeadingAsText('##### H5 标题', 5)).toBe('\\#\\#\\#\\#\\# H5 标题')
  })

  it('is idempotent for already escaped lines', () => {
    const once = preserveBlockedAtxHeadingAsText('##### H5 标题', 5)
    expect(preserveBlockedAtxHeadingAsText(once, 5)).toBe(once)
  })

  it('leaves non-matching levels alone', () => {
    expect(preserveBlockedAtxHeadingAsText('### H3 标题', 5)).toBe('### H3 标题')
  })
})

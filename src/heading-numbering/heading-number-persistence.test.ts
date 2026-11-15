import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  parseMarkdownHeadings,
  planHeadingNumberPersistence,
  type HeadingNumberPlanOptions,
} from './heading-number-persistence'

function settings(
  mode: 'strict' | 'loose' = 'strict',
  overrides: Partial<HeadingNumberingSettings> = {},
): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
    ...overrides,
  }
}

const SOURCE: HeadingNumberPlanOptions = { mode: 'source', policy: 'adopt' }

function plan(markdown: string, opts: Partial<HeadingNumberPlanOptions> = {}, s = settings()) {
  return planHeadingNumberPersistence(markdown, s, { ...SOURCE, ...opts, now: 1 })
}

describe('R08 — heading number persistence planner', () => {
  it('writes numbers for an unnumbered strict document', () => {
    const result = plan(['# 文档', '', '## 研究背景', '', '### 问题提出'].join('\n'))
    expect(result.nextMarkdown).toBe([
      '# 文档',
      '',
      '## 1 研究背景',
      '',
      '### 1.1 问题提出',
    ].join('\n'))
    expect(result.stats.written).toBe(2)
    expect(result.changed).toBe(true)
  })

  it('is idempotent: a second sync produces zero patches', () => {
    const first = plan(['# 文档', '## 研究背景', '### 问题提出'].join('\n'))
    const second = plan(first.nextMarkdown)
    expect(second.changed).toBe(false)
    expect(second.patches).toHaveLength(0)
    expect(second.nextMarkdown).toBe(first.nextMarkdown)
  })

  it('updates an existing managed number in place (never 1.1 1.1)', () => {
    const markdown = ['# 文档', '## 1.1 研究背景', '### 1.1.1 问题提出'].join('\n')
    const result = plan(markdown)
    expect(result.nextMarkdown).toBe(['# 文档', '## 1 研究背景', '### 1.1 问题提出'].join('\n'))
    expect(result.nextMarkdown).not.toContain('1.1 1.1')
    const again = plan(result.nextMarkdown)
    expect(again.changed).toBe(false)
  })

  it('repairs double numbering in one transaction', () => {
    const result = plan(['# 文档', '## 1 1.1 研究背景'].join('\n'))
    expect(result.nextMarkdown).toBe(['# 文档', '## 1 研究背景'].join('\n'))
    expect(plan(result.nextMarkdown).changed).toBe(false)
  })

  it('does not rewrite 2026 年研究报告 but keeps the title intact', () => {
    const markdown = ['# 文档', '## 2026 年研究报告'].join('\n')
    const result = plan(markdown)
    expect(result.nextMarkdown).toBe(markdown)
    expect(result.headings[1].ownership).toBe('unresolved')
  })

  it('adds a number in front of 3D 建模技术 without deleting it', () => {
    const result = plan(['# 文档', '## 3D 建模技术'].join('\n'))
    expect(result.nextMarkdown).toContain('## 1 3D 建模技术')
  })

  it('detect-only never edits the source', () => {
    const markdown = ['# 文档', '## 研究背景'].join('\n')
    const result = plan(markdown, { policy: 'detect-only' })
    expect(result.nextMarkdown).toBe(markdown)
    expect(result.changed).toBe(false)
    expect(result.writable).toBe(true)
  })

  it('render mode never edits the source', () => {
    const markdown = ['# 文档', '## 研究背景'].join('\n')
    const result = plan(markdown, { mode: 'render' })
    expect(result.nextMarkdown).toBe(markdown)
    expect(result.changed).toBe(false)
    expect(result.writable).toBe(false)
  })

  it('preserve keeps existing manual numbers and adds none on top', () => {
    const markdown = ['# 文档', '## 2.5 研究背景', '## 研究方法'].join('\n')
    const result = plan(markdown, { policy: 'preserve' })
    expect(result.nextMarkdown).toBe(['# 文档', '## 2.5 研究背景', '## 2 研究方法'].join('\n'))
    expect(result.headings[1].ownership).toBe('user-preserved')
  })

  it('disabled numbering never deletes persisted numbers', () => {
    const markdown = ['# 文档', '## 1 研究背景'].join('\n')
    const result = plan(markdown, {}, settings('strict', { enabled: false }))
    expect(result.nextMarkdown).toBe(markdown)
    expect(result.changed).toBe(false)
    expect(result.writable).toBe(false)
  })

  it('removes a plugin-managed number when the heading becomes unnumbered', () => {
    const markdown = ['# 文档', '## 1 研究背景'].join('\n')
    const numbered = plan(markdown)
    const entry = Object.values(numbered.ownership).find(r => r.numberText === '1')
    expect(entry).toBeTruthy()
    const ownership = entry ? { [entry.identity]: entry } : {}
    const result = plan(markdown, {
      overrideEntries: [{ level: 2, title: '研究背景', occurrence: 0, mode: 'unnumbered' }],
      ownership,
    })
    expect(result.nextMarkdown).toBe(['# 文档', '## 研究背景'].join('\n'))
    expect(result.stats.removed).toBe(1)
  })

  it('renumbers after heading insertion and deletion', () => {
    const markdown = ['# 文档', '## A', '## B', '## C'].join('\n')
    const first = plan(markdown)
    expect(first.nextMarkdown).toBe(['# 文档', '## 1 A', '## 2 B', '## 3 C'].join('\n'))
    const inserted = plan(['# 文档', '## 1 A', '## 新标题', '## 2 B', '## 3 C'].join('\n'))
    expect(inserted.nextMarkdown).toBe(['# 文档', '## 1 A', '## 2 新标题', '## 3 B', '## 4 C'].join('\n'))
    const deleted = plan(['# 文档', '## 1 A', '## 2 新标题', '## 4 C'].join('\n'))
    expect(deleted.nextMarkdown).toBe(['# 文档', '## 1 A', '## 2 新标题', '## 3 C'].join('\n'))
  })

  it('loose mode numbers H1 as well', () => {
    const result = plan(['# 第一章', '## 小节'].join('\n'), {}, settings('loose'))
    expect(result.nextMarkdown).toBe(['# 1 第一章', '## 1.1 小节'].join('\n'))
  })

  it('ignores headings inside fenced code blocks and front matter', () => {
    const markdown = [
      '---',
      '## 1 front matter',
      '---',
      '# 文档',
      '```md',
      '## 1 代码里的标题',
      '```',
      '## 研究背景',
    ].join('\n')
    const result = plan(markdown)
    expect(result.nextMarkdown).toContain('## 1 代码里的标题')
    expect(result.nextMarkdown).toContain('## 1 研究背景')
    expect(result.nextMarkdown).toContain('## 1 front matter')
  })

  it('preserves CRLF line endings', () => {
    const markdown = ['# 文档', '## 研究背景'].join('\r\n')
    const result = plan(markdown)
    expect(result.nextMarkdown).toBe(['# 文档', '## 1 研究背景'].join('\r\n'))
  })

  it('removeManagedOnly strips only recorded prefixes', () => {
    const markdown = ['# 文档', '## 1 研究背景', '## 2.5 手工编号'].join('\n')
    const first = plan(markdown)
    const records = first.ownership
    const managedKey = Object.values(records).find(r => r.numberText === '1')?.identity
    expect(managedKey).toBeTruthy()
    const ownership = managedKey ? { [managedKey]: records[managedKey] } : {}
    const removed = plan(markdown, { removeManagedOnly: true, ownership })
    expect(removed.nextMarkdown).toContain('## 研究背景')
    expect(removed.nextMarkdown).toContain('## 2.5 手工编号')
  })

  it('exposes stable identities for ownership', () => {
    const result = plan(['# 文档', '## 研究背景', '## 研究背景'].join('\n'))
    const identities = result.headings.map(h => h.identity)
    expect(new Set(identities).size).toBe(identities.length)
  })

  it('export mode produces a numbered copy without removing existing numbers', () => {
    const markdown = ['# 文档', '## 研究背景'].join('\n')
    const result = plan(markdown, { mode: 'export', policy: 'adopt' })
    expect(result.nextMarkdown).toBe(['# 文档', '## 1 研究背景'].join('\n'))
    expect(result.writable).toBe(false)
  })

  it('parses heading levels and markers', () => {
    const parsed = parseMarkdownHeadings('text\n## 标题\n```\n## 代码\n```\n### 三级')
    expect(parsed.headings.map(h => h.level)).toEqual([2, 3])
    expect(parsed.headings[0].marker).toBe('## ')
  })
})

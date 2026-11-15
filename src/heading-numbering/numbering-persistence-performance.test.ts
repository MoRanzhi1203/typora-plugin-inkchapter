import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  planHeadingNumberPersistence,
  type HeadingNumberPersistencePlan,
} from './heading-number-persistence'

function settings(preset: 'decimal-hierarchical' | 'chinese-chapter' = 'decimal-hierarchical'): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset,
    maxDepth: 6,
    levels: getPresetLevels(preset),
  }
}

/** A realistic document: H1–H6, existing numbers, special titles, body text. */
function buildDocument(count: number): string {
  const lines: string[] = ['# 性能测试文档', '']
  for (let i = 0; i < count; i++) {
    const level = (i % 6) + 1
    let title = `章节标题 ${i}`
    if (i % 5 === 0) title = `已有编号 ${i}`
    if (i % 11 === 0) title = '2026 年研究报告'
    if (i % 13 === 0) title = '3D 建模技术'
    if (i % 17 === 0) title = '第三代人工智能'
    const existing = i % 4 === 0 ? '1.2 ' : ''
    lines.push(`${'#'.repeat(level)} ${existing}${title}`)
    lines.push('')
    lines.push('正文内容，用于模拟真实文档的块结构。')
    lines.push('')
  }
  return lines.join('\n')
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = fn()
  return { value, ms: Math.round((performance.now() - start) * 100) / 100 }
}

const SOURCE = { mode: 'source' as const, policy: 'adopt' as const, now: 1 }

const SIZES = [50, 200, 1000, 3000] as const

describe('R09-06 — long-document numbering performance', () => {
  it('scales linearly and the second sync is a true no-op', () => {
    const report: Array<Record<string, number | string | boolean>> = []
    for (const size of SIZES) {
      const markdown = buildDocument(size)

      const first = timed(() => planHeadingNumberPersistence(markdown, settings(), SOURCE))
      expect(first.value.changed).toBe(true)

      const second = timed(() => planHeadingNumberPersistence(first.value.nextMarkdown, settings(), SOURCE))
      expect(second.value.changed, `size=${size} second sync`).toBe(false)
      expect(second.value.patches, `size=${size} second patches`).toHaveLength(0)

      // Insert one heading near the top.
      const insertedMd = first.value.nextMarkdown.replace('\n\n', '\n\n## 插入标题\n\n')
      const ledger = first.value.ownership
      const inserted = timed(() => planHeadingNumberPersistence(insertedMd, settings(), { ...SOURCE, ownership: ledger }))

      // Delete one H2 heading (explicit line, never a marker-prefix regex).
      const deleteLines = first.value.nextMarkdown.split('\n')
      const deleteIndex = deleteLines.findIndex(line => line.startsWith('## '))
      deleteLines.splice(deleteIndex, 1)
      const deletedMd = deleteLines.join('\n')
      const deleted = timed(() => planHeadingNumberPersistence(deletedMd, settings(), { ...SOURCE, ownership: ledger }))

      // Change one heading level.
      const levelLines = first.value.nextMarkdown.split('\n')
      const levelIndex = levelLines.findIndex(line => line.startsWith('## '))
      levelLines[levelIndex] = `#${levelLines[levelIndex]}`
      const levelMd = levelLines.join('\n')
      const level = timed(() => planHeadingNumberPersistence(levelMd, settings(), { ...SOURCE, ownership: ledger }))

      // Switch the numbering scheme.
      const switched = timed(() => planHeadingNumberPersistence(markdown, settings('chinese-chapter'), SOURCE))

      // Per-heading unnumbered overrides (10%).
      const overrides = (first.value.headings ?? [])
        .filter((_, index) => index % 10 === 0)
        .map(h => ({
          level: h.level,
          title: h.title,
          occurrence: 0,
          mode: 'unnumbered' as const,
        }))
      const withOverrides = timed(() => planHeadingNumberPersistence(markdown, settings(), { ...SOURCE, overrideEntries: overrides }))

      report.push({
        headings: size,
        firstMs: first.ms,
        secondMs: second.ms,
        insertedMs: inserted.ms,
        deletedMs: deleted.ms,
        levelMs: level.ms,
        schemeMs: switched.ms,
        overridesMs: withOverrides.ms,
        headingCount: first.value.headings.length,
        insertPatches: inserted.value.patches.length,
        deletePatches: deleted.value.patches.length,
      })

      expect(first.value.headings.length).toBeGreaterThanOrEqual(size)
      expect(first.ms).toBeLessThan(3000)
      expect(second.ms).toBeLessThan(1500)
      expect(inserted.value.changed, `inserted size=${size}`).toBe(true)
      expect(deleted.value.changed, `deleted size=${size}`).toBe(true)
      expect(level.value.changed, `level size=${size}`).toBe(true)
    }
    // Keep the numbers in the CI log — performance must be evidenced, not claimed.
    console.log('[R09][numbering-perf]', JSON.stringify(report, null, 2))
  })

  it('a no-op plan allocates no patches at 3000 headings', () => {
    const markdown = buildDocument(3000)
    const first = planHeadingNumberPersistence(markdown, settings(), SOURCE)
    const plan: HeadingNumberPersistencePlan = planHeadingNumberPersistence(first.nextMarkdown, settings(), SOURCE)
    expect(plan.patches).toEqual([])
    expect(plan.nextMarkdown).toBe(first.nextMarkdown)
    expect(plan.stats.changedLines).toBe(0)
  })

  it('repeated export planning is idempotent at 1000 headings', () => {
    const markdown = buildDocument(1000)
    const first = planHeadingNumberPersistence(markdown, settings(), { mode: 'export', policy: 'adopt', now: 1 })
    const second = planHeadingNumberPersistence(first.nextMarkdown, settings(), { mode: 'export', policy: 'adopt', now: 1 })
    expect(second.changed).toBe(false)
  })
})

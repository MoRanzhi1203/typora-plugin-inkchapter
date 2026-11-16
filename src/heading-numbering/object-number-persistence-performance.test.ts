import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import { defaultObjectNumberingSettings } from './object-numbering-settings'
import {
  planObjectNumberPersistence,
  type ObjectNumberingConfigs,
} from './object-number-persistence'

function headingSettings(): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
  }
}

function configs(): ObjectNumberingConfigs {
  const base = defaultObjectNumberingSettings().types
  return {
    figure: { ...base.figure, preset: 'chapter-dash' },
    table: { ...base.table, preset: 'chapter-dash' },
    code: { ...base.code, preset: 'chapter-dash' },
    formula: { ...base.formula, enabled: true, preset: 'chapter-dash' },
  }
}

/** Build a mixed document with `count` numbered objects. */
function buildDocument(count: number): string {
  const lines: string[] = ['# 文档']
  let chapter = 0
  let section = 0
  for (let i = 0; i < count; i++) {
    const kind = i % 4
    if (i % 40 === 0) {
      chapter++
      section = 0
      lines.push('', `## 第 ${chapter} 章`)
    } else if (i % 10 === 0) {
      section++
      lines.push('', `### 第 ${section} 节`)
    }
    lines.push('')
    if (kind === 0) {
      lines.push(`![图片 ${i}](assets/img-${i}.png)`)
    } else if (kind === 1) {
      lines.push('| 方法 | 准确率 |', '|---|---|', `| A${i} | 95% |`)
    } else if (kind === 2) {
      lines.push('```python', `value = ${i}`, '```')
    } else {
      lines.push('$$', `x_{${i}} = ${i}`, '$$')
    }
  }
  return lines.join('\n')
}

function timed(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

describe('R10 object numbering performance', () => {
  for (const count of [50, 200, 1000]) {
    it(`${count} mixed objects: first pass, zero-patch resync and structure edits`, () => {
      const markdown = buildDocument(count)
      let plan: ReturnType<typeof planObjectNumberPersistence> | null = null
      const firstMs = timed(() => {
        plan = planObjectNumberPersistence(markdown, {
          mode: 'source',
          policy: 'adopt',
          configs: configs(),
          headingSettings: headingSettings(),
        })
      })
      expect(plan).not.toBeNull()
      expect(plan!.stats.scanned).toBe(count)
      expect(plan!.changed).toBe(true)

      let second: ReturnType<typeof planObjectNumberPersistence> | null = null
      const secondMs = timed(() => {
        second = planObjectNumberPersistence(plan!.nextMarkdown, {
          mode: 'source',
          policy: 'adopt',
          configs: configs(),
          headingSettings: headingSettings(),
          ownership: plan!.ownership,
        })
      })
      expect(second).not.toBeNull()
      expect(second!.changed).toBe(false)
      expect(second!.edits).toHaveLength(0)
      expect(second!.nextMarkdown).toBe(plan!.nextMarkdown)

      const insertMs = timed(() => {
        planObjectNumberPersistence(plan!.nextMarkdown.replace('\n## 第 2 章', '\n## 新章节\n\n![](new.png)\n\n## 第 2 章'), {
          mode: 'source',
          policy: 'adopt',
          configs: configs(),
          headingSettings: headingSettings(),
          ownership: plan!.ownership,
        })
      })

      // Generous ceilings: the benchmark records the real numbers, the gate
      // only fails on an algorithmic regression (never on CI noise).
      console.info(`[R10-PERF] objects=${count} first=${firstMs.toFixed(1)}ms second=${secondMs.toFixed(1)}ms insert=${insertMs.toFixed(1)}ms`)
      expect(firstMs).toBeLessThan(3000)
      expect(secondMs).toBeLessThan(2000)
      expect(insertMs).toBeLessThan(3000)
    })
  }
})

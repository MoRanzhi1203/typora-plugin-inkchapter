import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  defaultObjectNumberingSettings,
} from './object-numbering-settings'
import type { ObjectNumberingConfig } from './object-numbering-engine'
import {
  buildObjectHeadingContext,
  computeObjectStructureSignature,
  parseCaptionLine,
  planObjectNumberPersistence,
  scanMarkdownNumberedObjects,
  type NumberedObjectKind,
  type ObjectNumberingConfigs,
} from './object-number-persistence'

function headingSettings(overrides: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
    ...overrides,
  }
}

function configs(overrides: Partial<Record<NumberedObjectKind, Partial<ObjectNumberingConfig>>> = {}): ObjectNumberingConfigs {
  const base = defaultObjectNumberingSettings().types
  return {
    figure: { ...base.figure, preset: 'chapter-dash', ...overrides.figure },
    table: { ...base.table, preset: 'chapter-dash', ...overrides.table },
    code: { ...base.code, preset: 'chapter-dash', ...overrides.code },
    formula: { ...base.formula, enabled: true, preset: 'chapter-dash', ...overrides.formula },
  }
}

const CHAPTER_ONE = [
  '# 文档',
  '',
  '## 第一章',
  '',
  '![示例图片](assets/example.png)',
].join('\n')

describe('R10 object scanning', () => {
  it('detects figures, tables, code blocks and formulas in document order', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![](a.png)',
      '',
      '表 1-1 结果',
      '',
      '| 方法 | 准确率 |',
      '|---|---|',
      '| A | 95% |',
      '',
      '```python',
      'print(1)',
      '```',
      '',
      '$$',
      'E=mc^2',
      '$$',
    ].join('\n')
    const parsed = scanMarkdownNumberedObjects(md)
    expect(parsed.objects.map(o => o.kind)).toEqual(['figure', 'table', 'code', 'formula'])
    expect(parsed.objects.map(o => o.startLine)).toEqual([4, 8, 12, 16])
  })

  it('does not treat an image inside a paragraph as a figure block', () => {
    const md = ['正文 ![x](a.png) 后续', '', '![](b.png)'].join('\n')
    const parsed = scanMarkdownNumberedObjects(md)
    expect(parsed.objects).toHaveLength(1)
    expect(parsed.objects[0].startLine).toBe(3)
  })

  it('parses compact and spaced caption formats', () => {
    expect(parseCaptionLine('figure', '图 1-1 示例图片')).toEqual({ prefix: '图', numberText: '1-1', title: '示例图片' })
    expect(parseCaptionLine('figure', '图1-1 示例图片')).toEqual({ prefix: '图', numberText: '1-1', title: '示例图片' })
    expect(parseCaptionLine('figure', '图 2.3 实验流程')).toEqual({ prefix: '图', numberText: '2.3', title: '实验流程' })
    expect(parseCaptionLine('table', '表 1-1 结果')?.numberText).toBe('1-1')
    expect(parseCaptionLine('code', '代码 1-1 数据读取')?.numberText).toBe('1-1')
    expect(parseCaptionLine('formula', '（1-1）')).toEqual({ prefix: '', numberText: '1-1', title: '' })
    expect(parseCaptionLine('formula', '(2.3)')).toEqual({ prefix: '', numberText: '2.3', title: '' })
  })
})

describe('R10 figure caption persistence', () => {
  it('writes a figure caption below the image and is idempotent', () => {
    const plan = planObjectNumberPersistence(CHAPTER_ONE, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(true)
    expect(plan.nextMarkdown).toContain('![示例图片](assets/example.png)')
    expect(plan.nextMarkdown).toContain('\n\n图 1-1')

    const second = planObjectNumberPersistence(plan.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: plan.ownership,
    })
    expect(second.changed).toBe(false)
    expect(second.nextMarkdown).toBe(plan.nextMarkdown)
  })

  it('updates only the number field of an existing caption and keeps the name', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 2-5 示例图片',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('图 1-1 示例图片')
    expect(plan.nextMarkdown).not.toContain('图 2-5')
    expect(plan.nextMarkdown).toContain('![示例图片](assets/example.png)')
  })

  it('never rewrites a caption of ordinary prose that ends with a sentence mark', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 9-9 展示了系统架构。',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('图 9-9 展示了系统架构。')
    expect(plan.objects[0].captionLine).toBeNull()
  })

  it('preserve policy keeps an existing caption and does not stack a second one', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 7-7 示例图片',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'preserve',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(false)
    expect(plan.nextMarkdown).toBe(md)
  })

  it('removes duplicate captions and reports them', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 1-1 示例图片',
      '',
      '图 1-1 示例图片',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      removeDuplicateCaptions: true,
    })
    expect(plan.stats.duplicateCaptions).toBe(1)
    const occurrences = plan.nextMarkdown.split('\n').filter(line => line === '图 1-1 示例图片')
    expect(occurrences).toHaveLength(1)
  })

  it('keeps the caption when the figure moves to another chapter', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '## 第二章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 1-1 示例图片',
    ].join('\n')
    const first = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(first.nextMarkdown).toContain('图 2-1 示例图片')
    expect(first.nextMarkdown).toContain('示例图片')

    const second = planObjectNumberPersistence(first.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: first.ownership,
    })
    expect(second.changed).toBe(false)
  })
})

describe('R10 table caption persistence', () => {
  it('writes the table caption above and preserves the table structure', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '| 方法 | 准确率 |',
      '|---|---|',
      '| A | 95% |',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('表 1-1\n\n| 方法 | 准确率 |')
    expect(plan.nextMarkdown).toContain('| A | 95% |')
    expect(plan.nextMarkdown.split('\n').filter(l => l.startsWith('|')).length).toBe(3)

    const second = planObjectNumberPersistence(plan.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: plan.ownership,
    })
    expect(second.changed).toBe(false)
  })

  it('updates an existing table caption and keeps its name', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '表 3-3 实验结果',
      '',
      '| 方法 | 准确率 |',
      '|---|---|',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('表 1-1 实验结果')
    expect(plan.nextMarkdown).toContain('|---|---|')
  })
})

describe('R10 code caption persistence', () => {
  it('writes the code caption outside the fence and keeps it byte-identical', () => {
    const code = '```python\nimport pandas as pd\n\nprint("ok")\n```'
    const md = ['# 文档', '## 第一章', '', code].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain(code)
    expect(plan.nextMarkdown).toContain('代码 1-1\n\n```python')
    const fenceBody = plan.nextMarkdown.split('```python')[1].split('```')[0]
    expect(fenceBody).toBe('\nimport pandas as pd\n\nprint("ok")\n')

    const second = planObjectNumberPersistence(plan.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: plan.ownership,
    })
    expect(second.changed).toBe(false)
  })

  it('never writes a caption inside the fence', () => {
    const md = ['# 文档', '## 第一章', '', '```js', 'const a = 1', '```'].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    const beforeFence = plan.nextMarkdown.split('```js')[0]
    const afterFence = plan.nextMarkdown.split('```js')[1].split('```')[0]
    expect(beforeFence).toContain('代码 1-1')
    expect(afterFence).toBe('\nconst a = 1\n')
  })
})

describe('R10 formula number persistence', () => {
  it('writes a portable standalone number below the formula', () => {
    const md = ['# 文档', '## 第一章', '', '$$', 'E=mc^2', '$$'].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('$$\nE=mc^2\n$$\n\n（1-1）')
    expect(plan.nextMarkdown).not.toContain('E=mc^2（')

    const second = planObjectNumberPersistence(plan.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: plan.ownership,
    })
    expect(second.changed).toBe(false)
  })

  it('adopts and updates an existing \\tag{} without touching the LaTeX body', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '$$',
      '\\begin{aligned}',
      'a &= b \\\\',
      'c &= d',
      '\\end{aligned}',
      '\\tag{9-9}',
      '$$',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('\\tag{1-1}')
    expect(plan.nextMarkdown).toContain('a &= b \\\\')
    expect(plan.nextMarkdown).toContain('\\end{aligned}')
    expect(plan.nextMarkdown.split('（').length).toBe(1)
  })

  it('keeps an existing tag when the policy is preserve', () => {
    const md = ['$$', 'E=mc^2', '\\tag{my-tag}', '$$'].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'preserve',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(false)
    expect(plan.nextMarkdown).toContain('\\tag{my-tag}')
  })

  it('handles cases / matrix / empty formulas without corrupting them', () => {
    for (const body of ['\\begin{cases} a & b \\end{cases}', '\\begin{matrix} 1 & 2 \\end{matrix}', '']) {
      const md = ['# 文档', '## 第一章', '', '$$', body, '$$'].join('\n')
      const plan = planObjectNumberPersistence(md, {
        mode: 'source',
        policy: 'adopt',
        configs: configs(),
        headingSettings: headingSettings(),
      })
      expect(plan.nextMarkdown).toContain(body)
      expect(plan.nextMarkdown).toContain('（1-1）')
    }
  })
})

describe('R10 chapter linkage and modes', () => {
  it('consumes the semantic heading result (strict H1 is the document title)', () => {
    const context = buildObjectHeadingContext(CHAPTER_ONE, headingSettings())
    const states = [...context.stateByLine.values()]
    expect(states.map(s => s.chapterOrdinal)).toEqual([null, 1])
  })

  it('renumbers objects when a chapter is inserted before them', () => {
    const before = [
      '# 文档',
      '## 第一章',
      '',
      '![](a.png)',
      '',
      '## 第二章',
      '',
      '![](b.png)',
    ].join('\n')
    const plan = planObjectNumberPersistence(before, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.nextMarkdown).toContain('图 1-1')
    expect(plan.nextMarkdown).toContain('图 2-1')

    const inserted = plan.nextMarkdown.replace('## 第二章', '## 新章节\n\n![](c.png)\n\n## 第二章')
    const resynced = planObjectNumberPersistence(inserted, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership: plan.ownership,
    })
    expect(resynced.nextMarkdown).toContain('图 3-1')
  })

  it('render mode never writes the source but still computes numbers', () => {
    const plan = planObjectNumberPersistence(CHAPTER_ONE, {
      mode: 'render',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(false)
    expect(plan.objects[0].expected?.numberText).toBe('1-1')
  })

  it('detect-only never writes even in source mode', () => {
    const plan = planObjectNumberPersistence(CHAPTER_ONE, {
      mode: 'source',
      policy: 'detect-only',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(false)
  })

  it('a disabled kind is preserved, never deleted', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![示例图片](assets/example.png)',
      '',
      '图 1-1 示例图片',
    ].join('\n')
    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs({ figure: { enabled: false } }),
      headingSettings: headingSettings(),
    })
    expect(plan.changed).toBe(false)
    expect(plan.nextMarkdown).toContain('图 1-1 示例图片')
  })

  it('removes only plugin-managed captions', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![a](a.png)',
      '',
      '图 1-1',
      '',
      '![b](b.png)',
      '',
      '图 4-4 用户题注',
    ].join('\n')
    const written = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    // Only the caption WITHOUT a user name is recorded as managed; the named
    // user caption stays outside the removal scope.
    const ownership = Object.fromEntries(
      Object.entries(written.ownership).filter(([, record]) => record.title === ''),
    )
    const removed = planObjectNumberPersistence(written.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
      ownership,
      removeManagedOnly: true,
    })
    expect(removed.nextMarkdown).not.toContain('图 1-1\n')
    expect(removed.nextMarkdown).toContain('图 1-2 用户题注')
  })

  it('binds a caption between a figure and a table to exactly ONE object', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![架构图](a.png)',
      '',
      '图 1-1 架构图',
      '',
      '| 模块 | 状态 |',
      '|---|---|',
    ].join('\n')
    const parsed = scanMarkdownNumberedObjects(md)
    const figure = parsed.objects.find(o => o.kind === 'figure')
    const table = parsed.objects.find(o => o.kind === 'table')
    expect(figure?.caption?.title).toBe('架构图')
    expect(table?.caption).toBeNull()

    const plan = planObjectNumberPersistence(md, {
      mode: 'source',
      policy: 'adopt',
      configs: configs(),
      headingSettings: headingSettings(),
    })
    const captions = plan.nextMarkdown.split('\n').filter(line => parseCaptionLine('figure', line) != null)
    expect(captions).toHaveLength(1)
    expect(plan.nextMarkdown).toContain('表 1-1')
  })

  it('structure signature ignores body text', () => {
    const a = ['# 文档', '', '正文一', '', '![](a.png)'].join('\n')
    const b = ['# 文档', '', '正文二', '', '![](a.png)'].join('\n')
    expect(computeObjectStructureSignature(a)).toBe(computeObjectStructureSignature(b))
  })
})

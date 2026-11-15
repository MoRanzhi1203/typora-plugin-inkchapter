import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  NumberingPersistenceService,
  computeHeadingStructureSignature,
  hashMarkdown,
  type NumberingPersistenceDeps,
} from './numbering-persistence-service'
import { createDefaultNumberingPersistenceConfig } from './numbering-persistence-settings'

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

interface Harness {
  service: NumberingPersistenceService
  settings: PluginSettings<InkChapterSettings>
  writes: string[]
  markdown: () => string
  setMarkdown: (value: string) => void
  fireEdit: () => void
  fireSave: () => void
  fireSwitch: () => void
  exported: Array<{ fileName: string; content: string }>
}

function createHarness(initial: string, options: { heading?: Partial<HeadingNumberingSettings> } = {}): Harness {
  const store: Record<string, unknown> = {
    numberingPersistence: createDefaultNumberingPersistenceConfig(),
  }
  const settings = {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value },
    save: () => Promise.resolve(),
  } as unknown as PluginSettings<InkChapterSettings>

  let markdown = initial
  const writes: string[] = []
  const exported: Array<{ fileName: string; content: string }> = []
  const editListeners: Array<() => void> = []
  const saveListeners: Array<() => void> = []
  const switchListeners: Array<() => void> = []

  const deps: NumberingPersistenceDeps = {
    settings,
    getDocumentKey: () => 'docs/doc.md',
    getMarkdown: () => markdown,
    getHeadingSettings: () => headingSettings(options.heading),
    getSourceOverrideEntries: () => ({ entries: [], counterPolicy: 'skip' }),
    getActiveFilePath: () => 'D:/vault/docs/doc.md',
    reloadContentPreservingUndo: (next: string) => {
      writes.push(next)
      markdown = next
      // Typora fires the edit event for our own write — prove the guard holds.
      for (const listener of editListeners) listener()
    },
    writeExportFile: (fileName: string, content: string) => {
      exported.push({ fileName, content })
      return fileName
    },
    onEditorEdit: (listener) => {
      editListeners.push(listener)
      return () => {
        const index = editListeners.indexOf(listener)
        if (index >= 0) editListeners.splice(index, 1)
      }
    },
    onBeforeSave: (listener) => {
      saveListeners.push(listener)
      return () => {
        const index = saveListeners.indexOf(listener)
        if (index >= 0) saveListeners.splice(index, 1)
      }
    },
    onDocumentSwitch: (listener) => {
      switchListeners.push(listener)
      return () => {
        const index = switchListeners.indexOf(listener)
        if (index >= 0) switchListeners.splice(index, 1)
      }
    },
  }

  const service = new NumberingPersistenceService(deps)
  service.start()

  return {
    service,
    settings,
    writes,
    markdown: () => markdown,
    setMarkdown: value => { markdown = value },
    fireEdit: () => { for (const listener of editListeners) listener() },
    fireSave: () => { for (const listener of saveListeners) listener() },
    fireSwitch: () => { for (const listener of switchListeners) listener() },
    exported,
  }
}

describe('R08 — number persistence runtime service', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes numbers once and then reports UNCHANGED (idempotent)', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    const first = harness.service.writeNumbersToSource()
    expect(first.status).toBe('APPLIED')
    expect(harness.markdown()).toBe(['# 文档', '## 1 研究背景'].join('\n'))
    expect(harness.writes).toHaveLength(1)

    const second = harness.service.resynchronizeAll()
    expect(second.status).toBe('UNCHANGED')
    expect(harness.writes).toHaveLength(1)
  })

  it('reports SKIPPED when source mode is not selected', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    const result = harness.service.resynchronizeAll()
    expect(result.status).toBe('SKIPPED')
    expect(result.detail).toContain('NOT_SOURCE_MODE')
    expect(harness.writes).toHaveLength(0)
  })

  it('adopts existing numbers and never stacks two prefixes', () => {
    const harness = createHarness(['# 文档', '## 1.1 研究背景'].join('\n'))
    const result = harness.service.adoptExistingNumbers()
    expect(result.status).toBe('APPLIED')
    expect(harness.markdown()).toBe(['# 文档', '## 1 研究背景'].join('\n'))
    harness.service.adoptExistingNumbers()
    expect(harness.markdown()).not.toMatch(/1\.1\s+1\.1/)
  })

  it('does not write when numbering is disabled', () => {
    const harness = createHarness(['# 文档', '## 1 研究背景'].join('\n'), { heading: { enabled: false } })
    harness.service.setSettings({ storageMode: 'source' })
    const result = harness.service.resynchronizeAll()
    expect(result.status).toBe('SKIPPED')
    expect(result.detail).toContain('NUMBERING_DISABLED')
    expect(harness.writes).toHaveLength(0)
  })

  it('removes only plugin-managed numbers', () => {
    const harness = createHarness(['# 文档', '## 研究背景', '## 2.5 手工编号'].join('\n'))
    harness.service.setSettings({ storageMode: 'source', existingNumberPolicy: 'preserve' })
    harness.service.resynchronizeAll()
    expect(harness.markdown()).toContain('## 1 研究背景')
    expect(harness.markdown()).toContain('## 2.5 手工编号')

    const removed = harness.service.removeManagedNumbers()
    expect(removed.status).toBe('APPLIED')
    expect(harness.markdown()).toContain('## 研究背景')
    expect(harness.markdown()).toContain('## 2.5 手工编号')
  })

  it('reports SKIPPED for remove when there is no ledger', () => {
    const harness = createHarness(['# 文档', '## 1 研究背景'].join('\n'))
    const result = harness.service.removeManagedNumbers()
    expect(result.status).toBe('SKIPPED')
    expect(result.detail).toContain('NO_OWNERSHIP')
  })

  it('exports a numbered copy without touching the original document', () => {
    const original = ['# 文档', '## 研究背景'].join('\n')
    const harness = createHarness(original)
    const result = harness.service.exportNumberedMarkdown()
    expect(result.ok).toBe(true)
    expect(harness.exported).toHaveLength(1)
    expect(harness.exported[0].fileName).toBe('doc.numbered.md')
    expect(harness.exported[0].content).toContain('## 1 研究背景')
    expect(harness.markdown()).toBe(original)
  })

  it('auto-edit sync ignores body-only typing', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.writeNumbersToSource()
    harness.service.setSettings({ syncTiming: 'edit' })
    const before = harness.writes.length

    harness.setMarkdown(harness.markdown() + '\n\n普通正文，不改变标题结构。')
    harness.fireEdit()
    vi.advanceTimersByTime(1000)
    expect(harness.writes).toHaveLength(before)
  })

  it('auto-edit sync writes after a heading structure change', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.writeNumbersToSource()
    harness.service.setSettings({ syncTiming: 'edit' })
    const before = harness.writes.length

    harness.setMarkdown(harness.markdown() + '\n## 新增章节\n')
    harness.fireEdit()
    vi.advanceTimersByTime(1000)
    expect(harness.writes.length).toBe(before + 1)
    expect(harness.markdown()).toContain('## 2 新增章节')
  })

  it('does not recurse when the write fires the edit listener again', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.writeNumbersToSource()
    harness.service.setSettings({ syncTiming: 'edit' })
    const before = harness.writes.length
    harness.setMarkdown(['# 文档', '## 研究背景', '## 第二节'].join('\n'))
    harness.fireEdit()
    vi.advanceTimersByTime(2000)
    expect(harness.writes.length).toBe(before + 1)
  })

  it('save-timing sync runs before save', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.setSettings({ storageMode: 'source', existingNumberPolicy: 'adopt', syncTiming: 'save' })
    const before = harness.writes.length
    harness.fireSave()
    expect(harness.writes.length).toBe(before + 1)
  })

  it('document switch resets guards so the next document syncs', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.writeNumbersToSource()
    harness.fireSwitch()
    harness.setMarkdown(['# 其他文档', '## 研究背景'].join('\n'))
    const result = harness.service.resynchronizeAll()
    expect(result.status).toBe('APPLIED')
    expect(harness.markdown()).toBe(['# 其他文档', '## 1 研究背景'].join('\n'))
  })

  it('checks conflicts and returns Lxx lines', () => {
    const harness = createHarness(['# 文档', '## 1.5 研究背景'].join('\n'))
    harness.service.setSettings({ storageMode: 'render' })
    const report = harness.service.checkConflicts()
    expect(report).not.toBeNull()
    expect(report?.issues.length).toBeGreaterThan(0)
    expect(report?.issues[0].line).toBe(2)
  })

  it('preview exposes current and planned lines', () => {
    const harness = createHarness(['# 文档', '## 研究背景'].join('\n'))
    harness.service.setSettings({ storageMode: 'source', existingNumberPolicy: 'adopt' })
    const preview = harness.service.getPreview()
    expect(preview.before[1].after).toBe('## 1 研究背景')
  })

  it('structure signature ignores body text and hash differs on edit', () => {
    const a = ['# 文档', '## 研究背景'].join('\n')
    const b = a + '\n\n正文'
    expect(computeHeadingStructureSignature(a)).toBe(computeHeadingStructureSignature(b))
    expect(hashMarkdown(a)).not.toBe(hashMarkdown(b))
  })
})

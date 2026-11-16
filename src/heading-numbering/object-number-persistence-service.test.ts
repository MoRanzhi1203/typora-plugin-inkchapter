import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  ObjectNumberPersistenceService,
  type ObjectNumberPersistenceDeps,
} from './object-number-persistence-service'
import { createDefaultObjectNumberPersistenceConfig } from './object-number-persistence-settings'
import { defaultObjectNumberingSettings } from './object-numbering-settings'
import type { ObjectNumberingConfigs } from './object-number-persistence'

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

function objectConfigs(): ObjectNumberingConfigs {
  const base = defaultObjectNumberingSettings().types
  return {
    figure: { ...base.figure, preset: 'chapter-dash' },
    table: { ...base.table, preset: 'chapter-dash' },
    code: { ...base.code, preset: 'chapter-dash' },
    formula: { ...base.formula, enabled: true, preset: 'chapter-dash' },
  }
}

interface Harness {
  service: ObjectNumberPersistenceService
  writes: string[]
  markdown: () => string
  setMarkdown: (value: string) => void
  setDocumentKey: (key: string) => void
  fireEdit: () => void
  fireSave: () => void
  exported: Array<{ fileName: string; content: string }>
}

function createHarness(initial: string): Harness {
  const store: Record<string, unknown> = {
    objectNumberingPersistence: createDefaultObjectNumberPersistenceConfig(),
  }
  const settings = {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value },
    save: () => Promise.resolve(),
  } as unknown as PluginSettings<InkChapterSettings>

  let markdown = initial
  let documentKey = 'docs/doc.md'
  const writes: string[] = []
  const exported: Array<{ fileName: string; content: string }> = []
  const editListeners: Array<() => void> = []
  const saveListeners: Array<() => void> = []

  const deps: ObjectNumberPersistenceDeps = {
    settings,
    getDocumentKey: () => documentKey,
    getMarkdown: () => markdown,
    getHeadingSettings: () => headingSettings(),
    getSourceOverrideEntries: () => ({ entries: [], counterPolicy: 'skip' }),
    getObjectNumberingConfigs: () => objectConfigs(),
    getActiveFilePath: () => 'D:/vault/docs/doc.md',
    reloadContentPreservingUndo: (next: string) => {
      writes.push(next)
      markdown = next
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
  }

  const service = new ObjectNumberPersistenceService(deps)
  service.start()

  return {
    service,
    writes,
    markdown: () => markdown,
    setMarkdown: value => { markdown = value },
    setDocumentKey: value => { documentKey = value },
    fireEdit: () => { for (const listener of editListeners) listener() },
    fireSave: () => { for (const listener of saveListeners) listener() },
    exported,
  }
}

const BASE = ['# 文档', '## 第一章', '', '![示例图片](assets/example.png)'].join('\n')

describe('R10 object number persistence service', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes captions once and then reports UNCHANGED', () => {
    const harness = createHarness(BASE)
    const first = harness.service.writeObjectNumbersToSource()
    expect(first.status).toBe('APPLIED')
    expect(harness.markdown()).toContain('图 1-1')
    expect(harness.writes).toHaveLength(1)

    const second = harness.service.resynchronizeAll()
    expect(second.status).toBe('UNCHANGED')
    expect(second.patchCount).toBe(0)
    expect(harness.writes).toHaveLength(1)
  })

  it('reports SKIPPED outside source mode', () => {
    const harness = createHarness(BASE)
    const result = harness.service.resynchronizeAll()
    expect(result.status).toBe('SKIPPED')
    expect(result.detail).toContain('NOT_SOURCE_MODE')
  })

  it('writes figure + table + code + formula captions in one pass', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![图](a.png)',
      '',
      '| 方法 | 准确率 |',
      '|---|---|',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '$$',
      'E=mc^2',
      '$$',
    ].join('\n')
    const harness = createHarness(md)
    const result = harness.service.writeObjectNumbersToSource()
    expect(result.status).toBe('APPLIED')
    const out = harness.markdown()
    expect(out).toContain('图 1-1')
    expect(out).toContain('表 1-1')
    expect(out).toContain('代码 1-1')
    expect(out).toContain('（1-1）')
  })

  it('auto-syncs on edit only when the object structure changes', () => {
    const harness = createHarness(BASE)
    harness.service.setSettings({ storageMode: 'source', existingCaptionPolicy: 'adopt', syncTiming: 'edit' })
    harness.service.writeObjectNumbersToSource()
    const writesAfterManual = harness.writes.length

    // body typing: no structure change -> no write
    harness.setMarkdown(`${harness.markdown()}\n\n普通正文`)
    harness.fireEdit()
    vi.advanceTimersByTime(500)
    expect(harness.writes).toHaveLength(writesAfterManual)

    // new figure -> one write
    harness.setMarkdown(`${harness.markdown()}\n\n![](b.png)`)
    harness.fireEdit()
    vi.advanceTimersByTime(500)
    expect(harness.writes.length).toBeGreaterThan(writesAfterManual)
  })

  it('removes managed captions only', () => {
    const md = [
      '# 文档',
      '## 第一章',
      '',
      '![](a.png)',
      '',
      '图 1-1',
    ].join('\n')
    const harness = createHarness(md)
    harness.service.writeObjectNumbersToSource()
    expect(harness.markdown()).toContain('图 1-1')
    const removed = harness.service.removeManagedCaptions()
    expect(removed.status).toBe('APPLIED')
    expect(harness.markdown()).not.toContain('图 1-1')
  })

  it('reports SKIPPED for remove when the ledger is empty', () => {
    const harness = createHarness(BASE)
    const removed = harness.service.removeManagedCaptions()
    expect(removed.status).toBe('SKIPPED')
    expect(removed.detail).toContain('NO_OWNERSHIP')
  })

  it('exports a numbered copy including heading numbers without touching the document', () => {
    const harness = createHarness(BASE)
    const result = harness.service.exportNumberedMarkdown()
    expect(result.ok).toBe(true)
    expect(result.fileName).toBe('doc.numbered.md')
    expect(harness.exported).toHaveLength(1)
    const content = harness.exported[0].content
    expect(content).toContain('## 1 第一章')
    expect(content).toContain('图 1-1')
    expect(harness.markdown()).toBe(BASE)
  })

  it('keeps document overrides isolated per document', () => {
    const harness = createHarness(BASE)
    harness.service.setSettings({ storageMode: 'source' }, 'document')
    expect(harness.service.getSettings().storageMode).toBe('source')
    harness.setDocumentKey('docs/other.md')
    expect(harness.service.getSettings().storageMode).toBe('render')
    harness.setDocumentKey('docs/doc.md')
    expect(harness.service.getSettings().storageMode).toBe('source')
  })

  it('summarises status for the settings card', () => {
    const harness = createHarness(BASE)
    harness.service.writeObjectNumbersToSource()
    const summary = harness.service.getStatusSummary()
    expect(summary.storageMode).toBe('source')
    expect(summary.objectsByKind.figure).toBe(1)
    expect(summary.captionedCount).toBe(1)
  })
})

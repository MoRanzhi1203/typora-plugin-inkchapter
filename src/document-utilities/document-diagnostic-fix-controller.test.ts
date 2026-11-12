// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DiagnosticFixController,
  type CaptionNameRequest,
  type DiagnosticFixEnvironment,
  type DiagnosticFixUi,
} from './document-diagnostic-fix-controller'
import type { FixPanelHandlers, FixPanelPreviewState, FixPanelState } from './document-diagnostic-fix-panel'

function diag(
  code: string,
  metadata: Record<string, unknown> = {},
  location?: DocumentDiagnostic['location'],
  id = `${code}:1`,
  targetIdentity?: string,
): DocumentDiagnostic {
  return {
    id,
    documentKey: 'doc:fix',
    severity: 'warning',
    category: 'document',
    code,
    message: code,
    detail: '',
    metadata,
    ...(targetIdentity ? { targetIdentity } : {}),
    ...(location ? { location } : {}),
  }
}

function snapshot(diagnostics: readonly DocumentDiagnostic[], documentKey = 'doc:fix'): DocumentDiagnosticsSnapshot {
  return {
    documentKey,
    revision: 7,
    sourceRevision: 1,
    generatedAt: 1,
    diagnostics,
    errorCount: 0,
    warningCount: diagnostics.length,
    infoCount: 0,
    structuralVerified: true,
  }
}

interface Harness {
  controller: DiagnosticFixController
  ui: DiagnosticFixUi & { state: FixPanelState | null; handlers: FixPanelHandlers | null; closed: number }
  env: DiagnosticFixEnvironment
  state: {
    markdown: string
    snapshot: DocumentDiagnosticsSnapshot
    docKey: string
    locked: boolean
    writes: string[]
    captions: CaptionNameRequest[]
  }
  notify: ReturnType<typeof vi.fn>
}

function createHarness(input: {
  markdown: string
  diagnostics: readonly DocumentDiagnostic[]
  locked?: boolean
  captionAvailable?: boolean
  sourceVerified?: boolean
  onRecheck?: (state: Harness['state']) => void
}): Harness {
  const state = {
    markdown: input.markdown,
    snapshot: snapshot(input.diagnostics),
    docKey: 'doc:fix',
    locked: input.locked === true,
    writes: [] as string[],
    captions: [] as CaptionNameRequest[],
  }
  const notify = vi.fn()
  const ui = {
    state: null as FixPanelState | null,
    handlers: null as FixPanelHandlers | null,
    closed: 0,
    renderFixPanel(next: FixPanelState, handlers: FixPanelHandlers) {
      this.state = next
      this.handlers = handlers
      this.closed = 0
    },
    closeFixPanel() {
      this.state = null
      this.handlers = null
      this.closed++
    },
  }
  const env: DiagnosticFixEnvironment = {
    getMarkdown: () => state.markdown,
    getDocumentKey: () => state.docKey,
    getSnapshot: () => state.snapshot,
    isLocked: () => state.locked,
    applyMarkdown: (next) => {
      state.writes.push(next)
      state.markdown = next
      return { ok: true }
    },
    setCaptionName: (request) => {
      if (input.captionAvailable === false) return { ok: false, reason: 'CAPTION_SERVICE_UNAVAILABLE' }
      state.captions.push(request)
      return { ok: true }
    },
    recheck: () => {
      input.onRecheck?.(state)
    },
    notify,
    getCaptionElement: () => null,
    isSourceVerified: () => input.sourceVerified !== false,
    schedule: (fn) => fn(),
  }
  return {
    controller: new DiagnosticFixController(env, ui),
    ui,
    env,
    state,
    notify,
  }
}

const blankMeta = { firstBlankLine: 1, lastBlankLine: 4, actualBlankLines: 4, passMaxBlankLines: 1 }
const blankLocation = { kind: 'source-range' as const, startLine: 3, startColumn: 0 }

function confirmPreview(harness: Harness): void {
  harness.ui.handlers?.onConfirm('')
}

describe('fix controller — auto-safe one-click flow', () => {
  it('applies immediately without any intermediate panel, then verifies the new snapshot', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const h = createHarness({
      markdown: '# H1\n\n\n\n\nBody\n',
      diagnostics: [d],
      onRecheck: (state) => {
        state.markdown = '# H1\n\nBody\n'
        state.snapshot = snapshot([])
      },
    })
    h.controller.startAllAuto()
    // 直接修复：点击后立即写回，绝不弹出预览中间界面。
    expect(h.ui.state).toBeNull()
    expect(h.state.writes).toEqual(['# H1\n\nBody\n'])
    expect(h.notify).toHaveBeenLastCalledWith('已修复 1 项（Ctrl+Z 可撤销）', 'info')
    expect(h.ui.state).toBeNull()
  })

  it('applies the EOF tail repair directly (no panel) and stops exactly one transaction', () => {
    const d = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 3 })
    const h = createHarness({
      markdown: '# 标题\n\n最后一段。\n\n\n\n',
      diagnostics: [d],
      onRecheck: (state) => {
        state.markdown = '# 标题\n\n最后一段。\n'
        state.snapshot = snapshot([])
      },
    })
    h.controller.startAllAuto()
    expect(h.ui.state).toBeNull()
    expect(h.state.writes).toEqual(['# 标题\n\n最后一段。\n'])
  })

  it('REPRO §doc.md — 删除文末多余空行不得改动前置代码块正文', () => {
    // Real defect: the write base used to be the STRUCTURAL serializer, whose
    // fence body is DOM text (`" 1<code>TXT纯文本1 行"`), so this repair wrote the
    // code-block chrome into the document. The base is now the exact text mirror,
    // and this contract pins it: only the extra newlines may change.
    const fence = '```text\nruntime/smoke/Document-Diagnostics-Block-Gap-Presentation-Extent-Test.md\n```\n'
    const base = `# 墨章 Runtime 根文档\n\n打开：\n\n\n\n\n\n${fence}\n\n\n\n\n`
    const d = diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 4 })
    const h = createHarness({
      markdown: base,
      diagnostics: [d],
      onRecheck: (state) => { state.snapshot = snapshot([]) },
    })
    h.controller.startAllAuto()
    expect(h.state.writes).toHaveLength(1)
    const written = h.state.writes[0]
    expect(written).toBe(`# 墨章 Runtime 根文档\n\n打开：\n\n\n\n\n\n${fence}`)
    expect(written).toContain(fence)
    expect(written).not.toContain('纯文本')
  })

  it('a late cancel after the direct fix performs ZERO extra writes', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const h = createHarness({
      markdown: '# H1\n\n\n\n\nBody\n',
      diagnostics: [d],
      onRecheck: (state) => {
        state.markdown = '# H1\n\nBody\n'
        state.snapshot = snapshot([])
      },
    })
    h.controller.startDiagnostic(d.id)
    expect(h.state.writes).toHaveLength(1)
    h.controller.cancel()
    expect(h.state.writes).toHaveLength(1)
    expect(h.ui.state).toBeNull()
  })

  it('reports a persisting diagnostic honestly instead of claiming success', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const rechecks: number[] = []
    const h = createHarness({
      markdown: '# H1\n\n\n\n\nBody\n',
      diagnostics: [d],
      onRecheck: (state) => {
        rechecks.push(1)
        // The write landed but the same diagnostic is still published.
        state.markdown = '# H1\n\n\n\n\nBody\n'
        state.snapshot = snapshot([d])
      },
    })
    h.controller.startAllAuto()
    confirmPreview(h)
    expect(h.notify).toHaveBeenLastCalledWith('已修改，但仍有 1 项诊断存在', 'error')
    // 1 initial + up to 3 bounded retries
    expect(rechecks.length).toBe(4)
  })

  it('refuses a locked document before opening any plan', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const h = createHarness({ markdown: '# H1\n\n\n\n\nBody\n', diagnostics: [d], locked: true })
    h.controller.startAllAuto()
    expect(h.ui.state).toBeNull()
    expect(h.notify).toHaveBeenCalledWith('文档已锁定：请先解锁再修复正文。', 'error')
    expect(h.state.writes).toEqual([])
  })

  it('refuses a source-patch fix when the structural serializer is degraded', () => {
    const d = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation)
    const h = createHarness({
      markdown: '# H1\n\n\n\n\nBody\n',
      diagnostics: [d],
      sourceVerified: false,
    })
    h.controller.startAllAuto()
    expect(h.ui.state).toBeNull()
    expect(h.state.writes).toEqual([])
    expect(h.notify).toHaveBeenLastCalledWith('当前文档结构读取未验证，已取消自动修复；请稍后重试。', 'error')
  })

  it('rejects the plan when the document switched before the input fix confirmed', () => {
    const d = diag('CODE_MISSING_LANGUAGE', {}, { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
    const h = createHarness({ markdown: '```\na\n```\n', diagnostics: [d] })
    h.controller.startDiagnostic(d.id)
    h.ui.handlers?.onConfirm('ts')
    expect(h.ui.state?.phase).toBe('preview')
    h.state.docKey = 'doc:other'
    confirmPreview(h)
    expect(h.state.writes).toEqual([])
    expect(h.notify).toHaveBeenLastCalledWith('文档已切换，修复已取消。', 'error')
  })
})

describe('fix controller — interactive input fixes', () => {
  it('asks for a language, previews, then patches only the fence info', () => {
    const d = diag('CODE_MISSING_LANGUAGE', {}, { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
    const h = createHarness({
      markdown: '```\na\n```\n',
      diagnostics: [d],
      onRecheck: (state) => {
        state.snapshot = snapshot([])
      },
    })
    h.controller.startDiagnostic(d.id)
    expect(h.ui.state?.phase).toBe('input')
    h.ui.handlers?.onConfirm('ts')
    expect(h.ui.state?.phase).toBe('preview')
    expect(h.state.writes).toEqual([])

    confirmPreview(h)
    expect(h.state.writes).toEqual(['```ts\na\n```\n'])
    expect(h.notify).toHaveBeenLastCalledWith('已修复 1 项（Ctrl+Z 可撤销）', 'info')
  })

  it('writes a code caption name through the caption service, never the Markdown', async () => {
    const d = diag('CODE_MISSING_NAME', {}, undefined, 'c1', 'block:code:0')
    const h = createHarness({
      markdown: '```js\na\n```\n',
      diagnostics: [d],
      onRecheck: (state) => { state.snapshot = snapshot([]) },
    })
    h.controller.startDiagnostic(d.id)
    h.ui.handlers?.onConfirm('初始化流程')
    expect(h.ui.state?.phase).toBe('preview')
    expect(h.state.writes).toEqual([])

    confirmPreview(h)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(h.state.writes).toEqual([])
    expect(h.state.captions).toEqual([{
      kind: 'code',
      targetIdentity: 'block:code:0',
      name: '初始化流程',
      element: null,
    }])
    expect(h.notify).toHaveBeenLastCalledWith('已修复 1 项', 'info')
  })

  it('同类修复 applies every instance of the rule in ONE direct write', () => {
    const d1 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', blankMeta, blankLocation, 'b1')
    const d2 = diag('EXCESSIVE_INTERNAL_BLANK_LINES', {
      firstBlankLine: 6, lastBlankLine: 8, actualBlankLines: 3, passMaxBlankLines: 1,
    }, { kind: 'source-range', startLine: 8, startColumn: 0 }, 'b2')
    const h = createHarness({
      markdown: '# A\n\n\n\n\nB\n\n\n\nC\n',
      diagnostics: [d1, d2],
      onRecheck: (state) => { state.snapshot = snapshot([]) },
    })
    h.controller.startRule('EXCESSIVE_INTERNAL_BLANK_LINES')
    expect(h.ui.state).toBeNull()
    expect(h.state.writes).toEqual(['# A\n\nB\n\nC\n'])
    expect(h.notify).toHaveBeenLastCalledWith('已修复 2 项（Ctrl+Z 可撤销）', 'info')
  })

  it('ignores a double submit while the caption write is in flight', async () => {
    const d = diag('TABLE_MISSING_NAME', {}, undefined, 't1', 'block:table:0')
    const h = createHarness({
      markdown: '| a |\n| - |\n',
      diagnostics: [d],
      onRecheck: (state) => { state.snapshot = snapshot([]) },
    })
    h.controller.startDiagnostic(d.id)
    h.ui.handlers?.onConfirm('接口表')
    confirmPreview(h)
    confirmPreview(h)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(h.state.captions).toHaveLength(1)
  })

  it('keeps the input panel and shows the real blocker when the value is unusable', () => {
    const d = diag('CODE_MISSING_LANGUAGE', {}, { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:3' })
    const h = createHarness({ markdown: '```\na\n```\n', diagnostics: [d] })
    h.controller.startDiagnostic(d.id)
    h.ui.handlers?.onConfirm('ts')
    expect(h.ui.state?.phase).toBe('input')
    expect(h.notify).not.toHaveBeenCalled()
  })
})

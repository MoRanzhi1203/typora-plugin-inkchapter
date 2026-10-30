import { describe, it, expect, vi } from 'vitest'
import {
  shouldApplySingleStepBlankEnter,
  canApplySingleStepBlankEnter,
  applySingleStepBlankEnter,
  type BlankRunEnterGateInput,
} from './blank-run-enter'

function gate(overrides: Partial<BlankRunEnterGateInput> = {}): BlankRunEnterGateInput {
  return {
    mode: 'wysiwyg',
    isComposing: false,
    isCollapsedSelection: true,
    paragraphVisibleText: '',
    paragraphIsTopLevelBlock: true,
    paragraphHasSpecialAncestor: false,
    isLastEmptyParagraphOfRun: true,
    runIsFollowedByContent: true,
    runIsPrecededByContent: true,
    ...overrides,
  }
}

describe('BLANK-RUN-ENTER gate', () => {
  it('命中：WYSIWYG + 折叠光标 + 空段落 + 内部空行块最后一行', () => {
    expect(shouldApplySingleStepBlankEnter(gate())).toBe(true)
  })

  it('源代码模式不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ mode: 'source' }))).toBe(false)
    expect(shouldApplySingleStepBlankEnter(gate({ mode: 'unknown' }))).toBe(false)
  })

  it('IME composition 中不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ isComposing: true }))).toBe(false)
  })

  it('选区非折叠（Range）不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ isCollapsedSelection: false }))).toBe(false)
  })

  it('段落有可见文本（含 token）不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ paragraphVisibleText: '。。' }))).toBe(false)
    expect(shouldApplySingleStepBlankEnter(gate({ paragraphVisibleText: '正文' }))).toBe(false)
  })

  it('非顶层块 / 特殊结构内不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ paragraphIsTopLevelBlock: false }))).toBe(false)
    expect(shouldApplySingleStepBlankEnter(gate({ paragraphHasSpecialAncestor: true }))).toBe(false)
  })

  it('不是空行块的最后一行不接管', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ isLastEmptyParagraphOfRun: false }))).toBe(false)
  })

  it('文末空行块 / 文首空行块不接管（保持原生）', () => {
    expect(shouldApplySingleStepBlankEnter(gate({ runIsFollowedByContent: false }))).toBe(false)
    expect(shouldApplySingleStepBlankEnter(gate({ runIsPrecededByContent: false }))).toBe(false)
  })
})

describe('BLANK-RUN-ENTER editor API adapter', () => {
  function makeApi() {
    const calls: Array<{ text: string; offset: number; focus: unknown }> = []
    const registered: unknown[] = []
    const api = {
      getNode: (cid: string) => (cid === 'n3' ? { id: 'n3' } : null),
      UserOp: {
        insertInlineText: (_editor: unknown, _node: unknown, text: string, offset: number, _command: unknown, focus: boolean) => {
          calls.push({ text, offset, focus })
        },
      },
      selection: { buildUndo: () => ({ type: 'cursor' }) },
      undo: { register: (command: unknown) => registered.push(command) },
    }
    return { api, calls, registered }
  }

  it('缺失任一 API 时不可用', () => {
    expect(canApplySingleStepBlankEnter(undefined)).toBe(false)
    expect(canApplySingleStepBlankEnter({})).toBe(false)
    expect(canApplySingleStepBlankEnter({ getNode: () => null })).toBe(false)
    const { api } = makeApi()
    expect(canApplySingleStepBlankEnter(api)).toBe(true)
  })

  it('执行一次软换行插入并注册 undo 命令', () => {
    const { api, calls, registered } = makeApi()
    expect(applySingleStepBlankEnter(api, 'n3', 0)).toBe(true)
    expect(calls).toEqual([{ text: '\n', offset: 0, focus: true }])
    expect(registered).toHaveLength(1)
    const cmd = registered[0] as { undo: unknown[]; redo: unknown[] }
    expect(cmd.undo).toHaveLength(1)
    expect(cmd.redo).toEqual([])
  })

  it('节点不存在时返回 false 且不插入', () => {
    const { api, calls } = makeApi()
    expect(applySingleStepBlankEnter(api, 'nope', 0)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('cid 为空时返回 false', () => {
    const { api, calls } = makeApi()
    expect(applySingleStepBlankEnter(api, null, 0)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('编辑器 API 抛错时返回 false（调用方停止接管）', () => {
    const api = {
      getNode: () => ({ id: 'n3' }),
      UserOp: { insertInlineText: vi.fn(() => { throw new Error('boom') }) },
      selection: { buildUndo: () => ({}) },
      undo: { register: vi.fn() },
    }
    expect(applySingleStepBlankEnter(api, 'n3', 0)).toBe(false)
  })
})

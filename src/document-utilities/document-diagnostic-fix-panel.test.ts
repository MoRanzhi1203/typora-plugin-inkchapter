// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { buildFixPanel, FIX_PANEL_CLASS } from './document-diagnostic-fix-panel'

function mount(state: Parameters<typeof buildFixPanel>[0], handlers: Parameters<typeof buildFixPanel>[1]) {
  const el = buildFixPanel(state, handlers)
  document.body.appendChild(el)
  return el
}

describe('fix panel — input phase', () => {
  it('renders a labelled field, disables confirm while empty and confirms on Enter', () => {
    const onConfirm = vi.fn()
    const el = mount({
      phase: 'input',
      title: '逐项修复',
      description: '请输入代码语言',
      label: '代码语言',
      placeholder: 'python / ts',
      value: '',
    }, { onConfirm, onCancel: vi.fn() })

    const input = el.querySelector<HTMLInputElement>('input')!
    expect(input).not.toBeNull()
    expect(input.placeholder).toBe('python / ts')
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
    const confirm = buttons.find(b => b.textContent === '预览修复')!
    expect(confirm.disabled).toBe(true)

    input.value = 'ts'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onConfirm).toHaveBeenCalledWith('ts')
  })

  it('shows a validation error with aria-invalid', () => {
    const el = mount({
      phase: 'input',
      title: '逐项修复',
      description: 'x',
      label: '图名',
      value: 'x',
      error: '图名不能为空。',
    }, { onConfirm: vi.fn(), onCancel: vi.fn() })
    expect(el.querySelector('input')!.getAttribute('aria-invalid')).toBe('true')
    expect(el.textContent).toContain('图名不能为空。')
  })

  it('cancels without any write when the close button is pressed', () => {
    const onCancel = vi.fn()
    const el = mount({
      phase: 'input', title: 't', description: 'd', label: 'l', value: '',
    }, { onConfirm: vi.fn(), onCancel })
    el.querySelector<HTMLButtonElement>(`.${FIX_PANEL_CLASS}__icon`)!.click()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('fix panel — preview phase', () => {
  const preview = {
    phase: 'preview' as const,
    title: '同类修复',
    summary: '将修改源码 2 处',
    hunks: [
      { startLine: 3, endLine: 4, before: ['', '', ''], after: [''] },
      { startLine: 9, endLine: 9, before: [''], after: [] },
    ],
    undoHint: '写回后可用 Ctrl+Z 一次撤销本批修改。',
  }

  it('renders the REAL before/after hunks with their source lines', () => {
    const el = mount(preview, { onConfirm: vi.fn(), onCancel: vi.fn() })
    expect(el.textContent).toContain('L3–4')
    expect(el.textContent).toContain('L9')
    expect(el.textContent).toContain('+ （删除）')
    expect(el.textContent).toContain('Ctrl+Z')
    expect(el.querySelectorAll(`.${FIX_PANEL_CLASS}__hunk`)).toHaveLength(2)
  })

  it('does not call confirm until the user presses 确认修复, and Escape cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const el = mount(preview, { onConfirm, onCancel })
    expect(onConfirm).not.toHaveBeenCalled()
    const confirm = Array.from(el.querySelectorAll('button')).find(b => b.textContent === '确认修复')!
    confirm.click()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('offers a same-rule batch entry only when the rule has more than one instance', () => {
    const onSameRule = vi.fn()
    const single = mount(preview, { onConfirm: vi.fn(), onCancel: vi.fn(), onSameRule })
    expect(Array.from(single.querySelectorAll('button'))
      .some(b => (b.textContent ?? '').startsWith('同类修复（'))).toBe(false)
    const many = mount({ ...preview, sameRule: { count: 3 } }, { onConfirm: vi.fn(), onCancel: vi.fn(), onSameRule })
    const button = Array.from(many.querySelectorAll('button')).find(b => b.textContent === '同类修复（3 项）')!
    expect(button).not.toBeUndefined()
    button.click()
    expect(onSameRule).toHaveBeenCalledTimes(1)
  })

  it('disables both actions while the write is in flight and explains metadata-only repairs', () => {
    const el = mount({ ...preview, busy: true, hunks: [] }, { onConfirm: vi.fn(), onCancel: vi.fn() })
    for (const button of Array.from(el.querySelectorAll<HTMLButtonElement>('button'))) {
      expect(button.disabled).toBe(true)
    }
    expect(el.textContent).toContain('正在应用…')
    const meta = mount({ ...preview, metadataOnly: true, hunks: [] }, { onConfirm: vi.fn(), onCancel: vi.fn() })
    expect(meta.textContent).toContain('不修改 Markdown 正文')
  })
})

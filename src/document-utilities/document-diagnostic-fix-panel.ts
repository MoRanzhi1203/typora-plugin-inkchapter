/**
 * Diagnostic fix panel — the compact, in-panel fix interaction (NO second
 * drawer, NO floating layer over `#write`).
 *
 * Two phases, both rendered inside the existing 检测 panel content area:
 *   INPUT   → one labelled text field (code language / code name / figure name)
 *   PREVIEW → the REAL Markdown diff (before / after hunks) + confirm / cancel
 *
 * The component is pure DOM with injected handlers: it never reads the
 * document, never decides a fix and never writes Markdown.
 */

export const FIX_PANEL_CLASS = 'inkchapter-doc-expand__fix'

export interface FixPanelHunk {
  startLine: number
  endLine: number
  before: readonly string[]
  after: readonly string[]
}

export interface FixPanelInputState {
  phase: 'input'
  title: string
  description: string
  label: string
  placeholder?: string
  value: string
  error?: string | null
  /** Hint shown under the field (e.g. "不会修改代码正文"). */
  note?: string | null
}

export interface FixPanelPreviewState {
  phase: 'preview'
  title: string
  summary: string
  hunks: readonly FixPanelHunk[]
  /** Caption-name plans change plugin metadata, not the Markdown source. */
  metadataOnly?: boolean
  /** Undo hint (real undo granularity — never a fake promise). */
  undoHint?: string | null
  busy?: boolean
  error?: string | null
  /** Same-rule batch entry (only when the rule really has >1 instance). */
  sameRule?: { count: number } | null
}

export type FixPanelState = FixPanelInputState | FixPanelPreviewState

export interface FixPanelHandlers {
  onInput?(value: string): void
  onConfirm(value: string): void
  onCancel(): void
  /** Switch the SAME prepared rule to a same-rule batch preview. */
  onSameRule?(): void
}

const MAX_LINES_PER_HUNK = 8
const MAX_HUNKS = 5

export function buildFixPanel(state: FixPanelState, handlers: FixPanelHandlers): HTMLElement {
  const root = document.createElement('div')
  root.className = FIX_PANEL_CLASS
  root.setAttribute('data-fix-phase', state.phase)
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', state.title)

  const head = document.createElement('div')
  head.className = `${FIX_PANEL_CLASS}__head`
  const title = document.createElement('span')
  title.className = `${FIX_PANEL_CLASS}__title`
  title.textContent = state.title
  head.appendChild(title)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = `${FIX_PANEL_CLASS}__icon`
  close.setAttribute('aria-label', '关闭修复面板')
  close.title = '关闭（Esc）'
  close.textContent = '×'
  // While the verified write is in flight the panel cannot be dismissed: a
  // half-cancelled transaction would make the reported outcome unverifiable.
  close.disabled = state.phase === 'preview' && state.busy === true
  close.addEventListener('click', () => {
    if (close.disabled) return
    handlers.onCancel()
  })
  head.appendChild(close)
  root.appendChild(head)

  if (state.phase === 'input') {
    const description = document.createElement('p')
    description.className = `${FIX_PANEL_CLASS}__desc`
    description.textContent = state.description
    root.appendChild(description)

    const field = document.createElement('label')
    field.className = `${FIX_PANEL_CLASS}__field`
    const label = document.createElement('span')
    label.className = `${FIX_PANEL_CLASS}__label`
    label.textContent = state.label
    const input = document.createElement('input')
    input.type = 'text'
    input.className = `${FIX_PANEL_CLASS}__input`
    input.value = state.value
    input.placeholder = state.placeholder ?? ''
    input.setAttribute('aria-label', state.label)
    if (state.error) input.setAttribute('aria-invalid', 'true')
    input.addEventListener('input', () => handlers.onInput?.(input.value))
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      if (input.value.trim() === '') return
      handlers.onConfirm(input.value)
    })
    field.append(label, input)
    root.appendChild(field)

    if (state.error) {
      const error = document.createElement('p')
      error.className = `${FIX_PANEL_CLASS}__error`
      error.setAttribute('role', 'alert')
      error.textContent = state.error
      root.appendChild(error)
    }
    if (state.note) {
      const note = document.createElement('p')
      note.className = `${FIX_PANEL_CLASS}__note`
      note.textContent = state.note
      root.appendChild(note)
    }

    const actions = document.createElement('div')
    actions.className = `${FIX_PANEL_CLASS}__actions`
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'inkchapter-doc-expand__button is-ghost'
    cancel.textContent = '取消'
    cancel.addEventListener('click', () => handlers.onCancel())
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'inkchapter-doc-expand__button is-primary'
    confirm.textContent = '预览修复'
    confirm.disabled = state.value.trim() === ''
    confirm.addEventListener('click', () => handlers.onConfirm(input.value))
    actions.append(cancel, confirm)
    root.appendChild(actions)
    queueMicrotask(() => {
      try { input.focus() } catch { /* detached */ }
    })
    return root
  }

  const summary = document.createElement('p')
  summary.className = `${FIX_PANEL_CLASS}__summary`
  summary.textContent = state.summary
  root.appendChild(summary)

  if (state.metadataOnly) {
    const note = document.createElement('p')
    note.className = `${FIX_PANEL_CLASS}__note`
    note.textContent = '该修复写入墨章题注服务（不修改 Markdown 正文）。'
    root.appendChild(note)
  }

  if (state.hunks.length > 0) {
    const diff = document.createElement('div')
    diff.className = `${FIX_PANEL_CLASS}__diff`
    for (const hunk of state.hunks.slice(0, MAX_HUNKS)) {
      diff.appendChild(buildHunk(hunk))
    }
    if (state.hunks.length > MAX_HUNKS) {
      const more = document.createElement('p')
      more.className = `${FIX_PANEL_CLASS}__note`
      more.textContent = `…另有 ${state.hunks.length - MAX_HUNKS} 处修改`
      diff.appendChild(more)
    }
    root.appendChild(diff)
  }

  if (state.undoHint) {
    const hint = document.createElement('p')
    hint.className = `${FIX_PANEL_CLASS}__note`
    hint.textContent = state.undoHint
    root.appendChild(hint)
  }
  if (state.error) {
    const error = document.createElement('p')
    error.className = `${FIX_PANEL_CLASS}__error`
    error.setAttribute('role', 'alert')
    error.textContent = state.error
    root.appendChild(error)
  }

  const actions = document.createElement('div')
  actions.className = `${FIX_PANEL_CLASS}__actions`
  if (state.sameRule != null && state.sameRule.count > 1 && typeof handlers.onSameRule === 'function') {
    const sameRule = document.createElement('button')
    sameRule.type = 'button'
    sameRule.className = 'inkchapter-doc-expand__button is-link'
    sameRule.textContent = `同类修复（${state.sameRule.count} 项）`
    sameRule.title = `把同一规则的 ${state.sameRule.count} 项一起计划并预览`
    sameRule.disabled = state.busy === true
    sameRule.addEventListener('click', () => {
      if (sameRule.disabled) return
      handlers.onSameRule?.()
    })
    actions.appendChild(sameRule)
    const spacer = document.createElement('span')
    spacer.className = `${FIX_PANEL_CLASS}__spacer`
    actions.appendChild(spacer)
  }
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'inkchapter-doc-expand__button is-ghost'
  cancel.textContent = '取消'
  cancel.disabled = state.busy === true
  cancel.addEventListener('click', () => handlers.onCancel())
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.className = 'inkchapter-doc-expand__button is-primary'
  confirm.textContent = state.busy ? '正在应用…' : '确认修复'
  confirm.disabled = state.busy === true
  confirm.addEventListener('click', () => handlers.onConfirm(''))
  actions.append(cancel, confirm)
  root.appendChild(actions)

  const cancelBtn = cancel
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!cancelBtn.disabled) handlers.onCancel()
  })
  return root
}

function buildHunk(hunk: FixPanelHunk): HTMLElement {
  const box = document.createElement('div')
  box.className = `${FIX_PANEL_CLASS}__hunk`
  const loc = document.createElement('span')
  loc.className = `${FIX_PANEL_CLASS}__hunk-loc`
  loc.textContent = hunk.startLine === hunk.endLine
    ? `L${hunk.startLine}`
    : `L${hunk.startLine}–${hunk.endLine}`
  box.appendChild(loc)

  const before = document.createElement('div')
  before.className = `${FIX_PANEL_CLASS}__hunk-lines is-before`
  for (const line of clip(hunk.before)) {
    const row = document.createElement('code')
    row.textContent = `- ${line}`
    before.appendChild(row)
  }
  box.appendChild(before)

  const after = document.createElement('div')
  after.className = `${FIX_PANEL_CLASS}__hunk-lines is-after`
  for (const line of clip(hunk.after)) {
    const row = document.createElement('code')
    row.textContent = `+ ${line}`
    after.appendChild(row)
  }
  if (hunk.after.length === 0) {
    const row = document.createElement('code')
    row.textContent = '+ （删除）'
    after.appendChild(row)
  }
  box.appendChild(after)
  return box
}

function clip(lines: readonly string[]): string[] {
  if (lines.length <= MAX_LINES_PER_HUNK) return [...lines]
  return [...lines.slice(0, MAX_LINES_PER_HUNK), '…']
}

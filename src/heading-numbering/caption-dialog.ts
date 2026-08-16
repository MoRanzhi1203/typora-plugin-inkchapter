/**
 * Caption Dialog — unified naming input modal for table/figure/code captions.
 *
 * One modal is shared across all three target types. It collects ONLY the name
 * (title); the number/prefix are computed and shown as a read-only hint.
 */

export interface CaptionDialogOptions {
  /** Dialog heading, e.g. "设置表名" / "编辑图名". */
  typeLabel: string
  /** Read-only "当前编号" hint, e.g. "表 1". */
  currentLabel?: string
  initialTitle?: string
  /** Maximum allowed name length (empty/whitespace = clear name). */
  maxLength?: number
}

const OVERLAY_CLASS = 'inkchapter-caption-dialog-overlay'
const DIALOG_CLASS = 'inkchapter-caption-dialog'
const DEFAULT_MAX_LENGTH = 200

export function promptCaptionTitle(options: CaptionDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS
    overlay.setAttribute('data-inkchapter-ui', 'true')
    overlay.setAttribute('data-inkchapter-caption-dialog', 'true')

    const dialog = document.createElement('div')
    dialog.className = DIALOG_CLASS
    dialog.setAttribute('data-inkchapter-ui', 'true')

    const heading = document.createElement('div')
    heading.className = `${DIALOG_CLASS}__heading`
    heading.textContent = options.typeLabel

    dialog.appendChild(heading)

    if (options.currentLabel) {
      const hint = document.createElement('div')
      hint.className = `${DIALOG_CLASS}__hint`
      hint.textContent = `当前编号：${options.currentLabel}`
      dialog.appendChild(hint)
    }

    const input = document.createElement('input')
    input.type = 'text'
    input.className = `${DIALOG_CLASS}__input`
    input.value = options.initialTitle ?? ''
    input.maxLength = maxLength
    input.setAttribute('placeholder', '请输入名称')
    // Mark as plugin-owned UI input so editor Enter/IME/paragraph handlers ignore it.
    input.setAttribute('data-inkchapter-ui', 'true')
    input.setAttribute('data-inkchapter-ui-input', 'true')

    const actions = document.createElement('div')
    actions.className = `${DIALOG_CLASS}__actions`

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = `${DIALOG_CLASS}__cancel`
    cancelBtn.textContent = '取消'
    cancelBtn.setAttribute('data-inkchapter-ui', 'true')
    cancelBtn.setAttribute('data-inkchapter-ui-action', 'true')

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = `${DIALOG_CLASS}__ok`
    okBtn.textContent = '确定'
    okBtn.setAttribute('data-inkchapter-ui', 'true')
    okBtn.setAttribute('data-inkchapter-ui-action', 'true')

    actions.appendChild(cancelBtn)
    actions.appendChild(okBtn)

    dialog.appendChild(input)
    dialog.appendChild(actions)
    overlay.appendChild(dialog)

    let finished = false
    const finish = (value: string | null) => {
      if (finished) return
      finished = true
      if (value === null) {
        console.info('[InkChapter Caption] NAME-DIALOG-CANCEL decision=CANCELLED')
      } else {
        console.info(`[InkChapter Caption] NAME-DIALOG-CONFIRM inputValue=${JSON.stringify(value)} decision=CONFIRMED`)
      }
      overlay.remove()
      resolve(value)
    }

    cancelBtn.addEventListener('click', () => finish(null))
    okBtn.addEventListener('click', () => finish(input.value))
    input.addEventListener('keydown', (e) => {
      // Isolate from the editor: never let Enter/Esc bubble into Typora handlers.
      e.stopPropagation()
      if (e.key === 'Enter') finish(input.value)
      if (e.key === 'Escape') finish(null)
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null)
    })

    document.body.appendChild(overlay)
    input.focus()

    const activeEl = document.activeElement
    console.info(
      `[InkChapter Caption] NAME-DIALOG-OPENED dialogConnected=${overlay.isConnected} ` +
      `inputConnected=${input.isConnected} inputValue=${JSON.stringify(input.value)} ` +
      `activeElementTag=${activeEl ? activeEl.tagName : 'null'} ` +
      `activeElementHasInkchapterUiMarker=${activeEl instanceof Element && !!activeEl.closest('[data-inkchapter-ui]')} ` +
      `decision=OPENED`,
    )
  })
}

export function captionTypeLabel(type: 'table' | 'figure' | 'code'): string {
  if (type === 'table') return '表名'
  if (type === 'figure') return '图名'
  return '代码片段名'
}

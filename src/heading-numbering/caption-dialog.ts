/**
 * Caption Dialog — unified edit modal for table/figure/code captions.
 *
 * One modal is shared across all three target types. It collects ONLY the
 * caption title; the number/prefix are computed (never entered by the user),
 * keeping title and number fully separated.
 */

export interface CaptionDialogOptions {
  /** Type label for the dialog heading (e.g. "表名" / "图名" / "代码片段名"). */
  typeLabel: string
  initialTitle?: string
  /** Compute the live preview label ("图 3  xxx") from the typed title. */
  getPreview: (title: string) => string
}

const OVERLAY_CLASS = 'inkchapter-caption-dialog-overlay'
const DIALOG_CLASS = 'inkchapter-caption-dialog'

export function promptCaptionTitle(options: CaptionDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS

    const dialog = document.createElement('div')
    dialog.className = DIALOG_CLASS

    const heading = document.createElement('div')
    heading.className = `${DIALOG_CLASS}__heading`
    heading.textContent = options.typeLabel

    const input = document.createElement('input')
    input.type = 'text'
    input.className = `${DIALOG_CLASS}__input`
    input.value = options.initialTitle ?? ''
    input.setAttribute('placeholder', '请输入名称')

    const preview = document.createElement('div')
    preview.className = `${DIALOG_CLASS}__preview`
    const renderPreview = () => { preview.textContent = options.getPreview(input.value) }

    const actions = document.createElement('div')
    actions.className = `${DIALOG_CLASS}__actions`

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = `${DIALOG_CLASS}__cancel`
    cancelBtn.textContent = '取消'

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = `${DIALOG_CLASS}__ok`
    okBtn.textContent = '确定'

    actions.appendChild(cancelBtn)
    actions.appendChild(okBtn)

    dialog.appendChild(heading)
    dialog.appendChild(input)
    dialog.appendChild(preview)
    dialog.appendChild(actions)
    overlay.appendChild(dialog)

    const finish = (value: string | null) => {
      overlay.remove()
      resolve(value)
    }

    cancelBtn.addEventListener('click', () => finish(null))
    okBtn.addEventListener('click', () => finish(input.value))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value)
      if (e.key === 'Escape') finish(null)
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null)
    })

    renderPreview()
    document.body.appendChild(overlay)
    input.focus()
  })
}

export function captionTypeLabel(type: 'table' | 'figure' | 'code'): string {
  if (type === 'table') return '表名'
  if (type === 'figure') return '图名'
  return '代码片段名'
}

/**
 * Phase 7R.3.11 — Document Edit Guard (per-document soft lock).
 *
 * A soft read-only editor guard: while locked the user can still scroll,
 * select, copy, navigate links/outline, and use diagnostics — but typing,
 * Backspace/Delete, Enter, paste, cut, drop, and IME text commits are blocked.
 *
 * Forensic note (Typora): frame.js actively re-asserts
 * `writingArea.setAttribute("contenteditable","true")` on focus/busy paths, so
 * flipping `contenteditable` is not a stable reversible read-only mechanism on
 * the real editor. We therefore use scoped capture-phase event guards as the
 * primary mechanism and keep them fully reversible (removed on unlock/dispose).
 * No pointer-events:none, no filesystem read-only, no chmod/ACL changes.
 *
 * InkChapter's own renderer writes are NOT blocked (LOCK_STATE_PLUGIN_RENDERER_WRITE_REGRESSION=0):
 * guards only intercept user-originated mutation events; the plugin's internal
 * projection/decoration writes go through direct DOM writes, not these events.
 */
import { resolveBusinessContentRoot } from './document-utilities-context'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export const LOCKED_EDITOR_CLASS = 'inkchapter-document-locked'

export interface DocumentEditGuardOptions {
  getDocumentKey?: () => string | null
}

const BLOCKED_KEYDOWN_KEYS = new Set(['Backspace', 'Delete', 'Enter'])
const BLOCKED_BEFOREINPUT_INPUT_TYPES = new Set([
  'insertText',
  'insertLineBreak',
  'insertParagraph',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteByCut',
  'insertCompositionText',
  'insertFromPaste',
  'insertFromDrop',
  'historyUndo',
  'historyRedo',
])

type EditGuardAuditAction = 'LOCK' | 'UNLOCK' | 'BLOCK' | 'ALLOW'

export class DocumentEditGuard {
  private locked = false
  private boundKeys = false
  private boundBeforeInput = false
  private boundClipboard = false
  private boundDrop = false
  private boundInput = false

  constructor(private opts: DocumentEditGuardOptions = {}) {}

  private audit(action: EditGuardAuditAction, detail: {
    eventType?: string
    inputType?: string
    key?: string
    trusted?: boolean
    decision?: string
  }): void {
    emitRuntimeAudit('DOCUMENT-UTILITY-EDIT-GUARD', {
      documentKey: this.opts.getDocumentKey?.() ?? null,
      state: this.locked ? 'LOCKED' : 'EDITABLE',
      action,
      eventType: detail.eventType ?? null,
      inputType: detail.inputType ?? null,
      key: detail.key ?? null,
      trusted: detail.trusted ?? null,
      decision: detail.decision ?? (action === 'BLOCK' ? 'BLOCK' : action === 'ALLOW' ? 'ALLOW' : 'PASS'),
    })
  }

  private onKeydownCapture = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    if (e.metaKey || e.ctrlKey || e.altKey) {
      // Allow copy (Ctrl+C), select-all (Ctrl+A), and navigation shortcuts.
      const key = e.key.toLowerCase()
      if (key === 'c') {
        this.audit('ALLOW', { eventType: 'keydown', key: e.key, trusted: e.isTrusted })
      }
      if (key === 'c' || key === 'a' || key === 'v' || key === 'x' || key === 's') return
    }
    if (BLOCKED_KEYDOWN_KEYS.has(e.key)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.audit('BLOCK', { eventType: 'keydown', key: e.key, trusted: e.isTrusted })
    }
  }

  private onBeforeInputCapture = (e: InputEvent): void => {
    if (BLOCKED_BEFOREINPUT_INPUT_TYPES.has(e.inputType)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.audit('BLOCK', { eventType: 'beforeinput', inputType: e.inputType, trusted: e.isTrusted })
    }
  }

  private onPasteCapture = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    this.audit('BLOCK', { eventType: 'paste', trusted: e.isTrusted })
  }

  private onCutCapture = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    this.audit('BLOCK', { eventType: 'cut', trusted: e.isTrusted })
  }

  private onDropCapture = (e: DragEvent): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    this.audit('BLOCK', { eventType: 'drop', trusted: e.isTrusted })
  }

  private onInputCapture = (e: Event): void => {
    // Safety net for engines that bypass beforeinput (e.g. IME commit paths).
    e.preventDefault()
    e.stopImmediatePropagation()
    this.audit('BLOCK', { eventType: 'input', trusted: (e as InputEvent).isTrusted })
  }

  private bindGuards(root: HTMLElement): void {
    if (!this.boundKeys) {
      root.addEventListener('keydown', this.onKeydownCapture, true)
      this.boundKeys = true
    }
    if (!this.boundBeforeInput) {
      root.addEventListener('beforeinput', this.onBeforeInputCapture as EventListener, true)
      this.boundBeforeInput = true
    }
    if (!this.boundClipboard) {
      root.addEventListener('paste', this.onPasteCapture, true)
      root.addEventListener('cut', this.onCutCapture, true)
      this.boundClipboard = true
    }
    if (!this.boundDrop) {
      root.addEventListener('drop', this.onDropCapture, true)
      this.boundDrop = true
    }
    if (!this.boundInput) {
      root.addEventListener('input', this.onInputCapture, true)
      this.boundInput = true
    }
    root.classList.add(LOCKED_EDITOR_CLASS)
  }

  private unbindGuards(root: HTMLElement): void {
    root.removeEventListener('keydown', this.onKeydownCapture, true)
    root.removeEventListener('beforeinput', this.onBeforeInputCapture as EventListener, true)
    root.removeEventListener('paste', this.onPasteCapture, true)
    root.removeEventListener('cut', this.onCutCapture, true)
    root.removeEventListener('drop', this.onDropCapture, true)
    root.removeEventListener('input', this.onInputCapture, true)
    root.classList.remove(LOCKED_EDITOR_CLASS)
    this.boundKeys = false
    this.boundBeforeInput = false
    this.boundClipboard = false
    this.boundDrop = false
    this.boundInput = false
  }

  isLocked(): boolean {
    return this.locked
  }

  /** Lock the active editor (idempotent). Returns false when no editor root. */
  lock(): boolean {
    const root = resolveBusinessContentRoot()
    if (!root) return false
    if (this.locked) return true
    this.bindGuards(root)
    this.locked = true
    this.audit('LOCK', { eventType: 'transition', decision: 'PASS' })
    return true
  }

  /** Unlock and restore the original editor state. */
  unlock(): void {
    if (!this.locked) return
    const root = resolveBusinessContentRoot()
    if (root) this.unbindGuards(root)
    this.locked = false
    this.audit('UNLOCK', { eventType: 'transition', decision: 'PASS' })
  }

  /** Dispose: unlock + remove all guards + remove lock decoration. */
  dispose(): void {
    this.unlock()
    document.querySelectorAll(`.${LOCKED_EDITOR_CLASS}`).forEach(el => el.classList.remove(LOCKED_EDITOR_CLASS))
  }
}

/**
 * Blank-run single-step Enter.
 *
 * Real-GUI defect: with the caret on the LAST empty paragraph of an interior
 * consecutive-blank run, one plain Enter grows the source blank run by TWO lines
 * (3 -> 5), because Typora splits the empty paragraph into a second empty block.
 * The product requirement is one visible blank line per Enter (3 -> 4).
 *
 * The only model-level transaction that adds exactly ONE source line is the
 * soft-line-break insertion Typora itself uses for Shift+Enter:
 * `UserOp.insertInlineText(editor, node, '\n', offset, command, true)` plus
 * `undo.register(command)`. It is a native editing transaction (undo/redo and
 * the source model stay consistent), unlike DOM edits or simulated keys.
 *
 * This module holds the pure gate + the API adapter so both are unit-testable.
 */

/** Editor mode reported by Typora (`sourceView.inSourceMode`). */
export type BlankRunEnterMode = 'wysiwyg' | 'source' | 'unknown'

export interface BlankRunEnterGateInput {
  mode: BlankRunEnterMode
  /** IME composition in progress. */
  isComposing: boolean
  /** Selection is collapsed (no range). */
  isCollapsedSelection: boolean
  /** Visible text of the caret paragraph (must be exactly empty). */
  paragraphVisibleText: string
  /** Caret paragraph is a direct child block of `#write`. */
  paragraphIsTopLevelBlock: boolean
  /** Caret paragraph sits inside list / quote / code / table / figure / def. */
  paragraphHasSpecialAncestor: boolean
  /** No following sibling block is an empty paragraph (this is the LAST empty line). */
  isLastEmptyParagraphOfRun: boolean
  /** A non-empty block follows the run (interior blank run, not document end). */
  runIsFollowedByContent: boolean
  /** A non-empty block precedes the run. */
  runIsPrecededByContent: boolean
}

/**
 * True only for the exact scenario the product asked to change.
 *
 * Deliberately narrow: WYSIWYG, collapsed caret, EMPTY paragraph (a token
 * paragraph is handled by the indent-command transaction instead), top-level
 * and non-special block, LAST empty paragraph of an INTERIOR blank run.
 */
export function shouldApplySingleStepBlankEnter(input: BlankRunEnterGateInput): boolean {
  if (input.mode !== 'wysiwyg') return false
  if (input.isComposing) return false
  if (!input.isCollapsedSelection) return false
  if (input.paragraphVisibleText !== '') return false
  if (!input.paragraphIsTopLevelBlock) return false
  if (input.paragraphHasSpecialAncestor) return false
  if (!input.isLastEmptyParagraphOfRun) return false
  if (!input.runIsFollowedByContent) return false
  if (!input.runIsPrecededByContent) return false
  return true
}

/** The slice of the Typora editor API this module needs (runtime-validated). */
export interface BlankRunEnterEditorApi {
  getNode?: (cid: string) => unknown
  UserOp?: {
    insertInlineText?: (
      editor: unknown,
      node: unknown,
      text: string,
      offset: number,
      command: unknown,
      focus: boolean,
    ) => void
  }
  selection?: { buildUndo?: () => unknown }
  undo?: { register?: (command: unknown) => void }
}

/** True when the editor exposes every API needed for the native transaction. */
export function canApplySingleStepBlankEnter(api: unknown): boolean {
  const a = api as BlankRunEnterEditorApi | null | undefined
  return typeof a?.getNode === 'function'
    && typeof a?.UserOp?.insertInlineText === 'function'
    && typeof a?.selection?.buildUndo === 'function'
    && typeof a?.undo?.register === 'function'
}

/**
 * Insert ONE soft line break through Typora's own transaction, with undo.
 *
 * @returns true when the transaction was issued (the caller must have already
 *          called preventDefault); false when the API is unavailable.
 */
export function applySingleStepBlankEnter(
  api: unknown,
  cid: string | null,
  offset: number,
): boolean {
  const a = api as BlankRunEnterEditorApi | null | undefined
  if (!cid || !canApplySingleStepBlankEnter(a)) return false
  try {
    const node = a!.getNode!(cid)
    if (!node) return false
    const command = { undo: [a!.selection!.buildUndo!()], redo: [] as unknown[] }
    a!.UserOp!.insertInlineText!(a, node, '\n', offset, command, true)
    a!.undo!.register!(command)
    return true
  } catch {
    return false
  }
}

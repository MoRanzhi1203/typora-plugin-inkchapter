/**
 * Plugin UI event guard — detect events originating from InkChapter's own UI
 * (caption context menu, naming dialog, plugin inputs) so the R58 editor
 * pipeline can SKIP them instead of treating them as business document input.
 */

export const INKCHAPTER_UI_SELECTOR = [
  '[data-inkchapter-ui]',
  '[data-inkchapter-ui-input]',
  '[data-inkchapter-ui-action]',
  '[data-inkchapter-caption-menu]',
  '[data-inkchapter-caption-dialog]',
].join(',')

/**
 * Returns true when the event's composed path contains any InkChapter plugin UI
 * node. Uses composedPath() so shadow/detached/nested DOM is handled correctly,
 * with a target-ancestor walk as a fallback for environments with quirks.
 */
export function isInkChapterUiEvent(event: Event): boolean {
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath()
    for (const node of path) {
      if (node instanceof Element && node.matches(INKCHAPTER_UI_SELECTOR)) return true
    }
  }
  // Fallback: walk the target and its ancestors.
  let node: Node | null = event.target instanceof Node ? event.target : null
  while (node) {
    if (node instanceof Element && node.matches(INKCHAPTER_UI_SELECTOR)) return true
    node = node.parentNode
  }
  return false
}

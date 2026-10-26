/**
 * R9 — ONE whitespace-semantics authority for the blank-gap chain.
 *
 * WHY THIS MODULE EXISTS
 *
 * Typora renders an empty paragraph as `<p><br></p>` and, once the user types
 * only SPACES into it, serializes that block back to Markdown as a line that
 * contains a single U+200B ZERO WIDTH SPACE. JavaScript's `String.prototype.trim()`
 * removes U+0020 / Tab / U+00A0 / U+FEFF but NOT U+200B, so the same physical
 * "empty-looking" line was classified two different ways across the chain:
 *
 *   source scanner (`isBlank`)        → NOT blank  → the line became a phantom
 *                                       content block that CUT a 6-blank run into
 *                                       two smaller runs
 *   anchor projection                 → '' (U+200B stripped) → NO_TEXT_ANCHOR
 *   rendered blank row (`\s+`)        → '\u200B' (not matched by \s) → not a row
 *
 * Every consumer must therefore ask THIS module, never a local `trim()`.
 *
 * SCOPE — this is a pure text contract. It never edits the user's Markdown, never
 * moves blank lines and never guesses a rendered count. Markdown structure is
 * preserved because callers still apply their own container / protected-region
 * rules on top (indented code, fences, tables, lists).
 */

/**
 * Invisible / placeholder code points Typora injects into otherwise empty blocks.
 *
 *   U+200B..U+200D  zero width space / non-joiner / joiner
 *   U+180E          Mongolian vowel separator (behaves as a space)
 *   U+2060          word joiner
 *   U+FEFF          zero width no-break space (also covered by trim())
 *
 * U+0020 / Tab / U+00A0 / U+3000 are handled by `trim()` itself.
 */
const INVISIBLE_PLACEHOLDER_CHARS = /[\u180E\u200B-\u200D\u2060\uFEFF]/g

/** Remove invisible placeholder characters so the remaining text is comparable. */
export function stripInvisiblePlaceholderChars(text: string | null | undefined): string {
  return String(text ?? '').replace(INVISIBLE_PLACEHOLDER_CHARS, '')
}

/** True when the string contains an invisible placeholder character. */
export function hasInvisiblePlaceholderChars(text: string | null | undefined): boolean {
  return INVISIBLE_PLACEHOLDER_CHARS.test(String(text ?? ''))
}

/**
 * THE whitespace-only test: no visible content at all.
 *
 * `''`, `'   '`, `'\t'`, `'\u00A0'`, `'\u200B'`, `'\uFEFF'`, `'\u200B   '` are all
 * whitespace-only. Any real character (including Markdown syntax such as `#` or
 * `-`) makes it false, so structural Markdown is never flattened by this test.
 */
export function isWhitespaceOnlyText(text: string | null | undefined): boolean {
  return stripInvisiblePlaceholderChars(text).trim() === ''
}

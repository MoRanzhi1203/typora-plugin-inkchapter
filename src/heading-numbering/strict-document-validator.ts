/**
 * Strict Document Validator — STRICT-FIRST-H1 rule.
 *
 * In strict mode, the first semantic content block of a document MUST be an
 * H1 heading. This is a read-only validation layer — it NEVER mutates the
 * document, never auto-inserts/rewrites headings, and never moves the caret.
 *
 * It reuses the existing DOM block model (Typora `#write` editor root) rather
 * than re-parsing Markdown source.
 */

export type FirstSemanticBlockType =
  | 'heading'
  | 'paragraph'
  | 'quote'
  | 'list'
  | 'code'
  | 'table'
  | 'math'
  | 'image'
  | 'html'
  | 'hr'
  | 'front-matter'

export interface FirstSemanticBlock {
  type: FirstSemanticBlockType
  /** Present when type === 'heading'. */
  headingLevel?: number
  text?: string
  element: HTMLElement | null
}

const BOM_AND_WHITESPACE = /[\s\uFEFF\u200B\u00A0]/g

/** True when text is empty or only whitespace / BOM / zero-width characters. */
function isBlankText(text: string): boolean {
  return text.replace(BOM_AND_WHITESPACE, '') === ''
}

/** Whether an element counts as "empty" (skip it when locating the first block). */
function isVisuallyEmpty(el: HTMLElement): boolean {
  const tag = el.tagName.toUpperCase()
  // Media / structural blocks are never "empty" even with no text content.
  if (tag === 'HR' || tag === 'IMG' || tag === 'TABLE' || tag === 'FIGURE') return false
  if (el.querySelector('img, hr, table, mjx-container, svg')) return false
  return isBlankText(el.textContent ?? '')
}

/** Classify a top-level DOM element into a semantic block type. */
function classifyBlock(el: HTMLElement): FirstSemanticBlock {
  const tag = el.tagName.toUpperCase()
  const text = (el.textContent ?? '').trim()

  if (/^H[1-6]$/.test(tag)) {
    return { type: 'heading', headingLevel: parseInt(tag.charAt(1), 10), text, element: el }
  }

  // Front matter (YAML metadata) — Typora renders it with a metadata block class.
  if (
    el.classList.contains('md-meta-block') ||
    el.classList.contains('md-yaml-block') ||
    el.getAttribute('data-type') === 'yaml' ||
    el.getAttribute('data-fm') === 'true'
  ) {
    return { type: 'front-matter', text, element: el }
  }

  if (tag === 'BLOCKQUOTE') return { type: 'quote', text, element: el }
  if (tag === 'UL' || tag === 'OL' || tag === 'LI') return { type: 'list', text, element: el }

  if (tag === 'PRE' || el.classList.contains('md-codeblock')) {
    return { type: 'code', text, element: el }
  }

  if (tag === 'TABLE' || tag === 'FIGURE') return { type: 'table', text, element: el }
  if (tag === 'HR') return { type: 'hr', text, element: el }

  // Block math — either a dedicated math block container or a paragraph hosting
  // a display math root.
  if (
    el.classList.contains('md-math-block') ||
    (tag === 'P' && !!el.querySelector('mjx-container[display="true"], mjx-container'))
  ) {
    return { type: 'math', text, element: el }
  }

  if (tag === 'IMG' || !!el.querySelector('img')) {
    return { type: 'image', text, element: el }
  }

  if (tag === 'P') return { type: 'paragraph', text, element: el }

  // Any other non-empty block (raw HTML, unknown container) → html.
  return { type: 'html', text, element: el }
}

/**
 * Resolve the first semantic block of a document (Typora editor root).
 *
 * Ignores BOM, pure whitespace, and empty placeholders. Returns null for an
 * empty document.
 */
export function resolveFirstSemanticBlock(root: HTMLElement): FirstSemanticBlock | null {
  if (!root) return null

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i] as HTMLElement
    if (isVisuallyEmpty(child)) continue
    return classifyBlock(child)
  }

  return null
}

// ── Validation result ──────────────────────────────────────────────────

export type StrictFirstH1Decision = 'PASS' | 'FAIL' | 'SKIP'

export interface StrictFirstH1ValidationResult {
  ruleId: 'STRICT-FIRST-H1'
  severity: 'error'
  passed: boolean
  skipped: boolean
  decision: StrictFirstH1Decision
  reason: string
  message: string
  firstBlockType?: FirstSemanticBlockType
  firstHeadingLevel?: number
  firstBlockText?: string
}

/**
 * Validate the STRICT-FIRST-H1 rule.
 *
 * - non-strict mode → SKIP (never reports in loose mode).
 * - empty document → FAIL (DOCUMENT_EMPTY_NO_H1).
 * - first block is H1 → PASS.
 * - anything else first → FAIL (STRICT_FIRST_H1_VIOLATION).
 */
export function validateStrictFirstH1(
  firstBlock: FirstSemanticBlock | null,
  mode: 'strict' | 'loose',
): StrictFirstH1ValidationResult {
  if (mode !== 'strict') {
    return {
      ruleId: 'STRICT-FIRST-H1',
      severity: 'error',
      passed: false,
      skipped: true,
      decision: 'SKIP',
      reason: 'NON_STRICT_MODE',
      message: '',
    }
  }

  if (!firstBlock) {
    return {
      ruleId: 'STRICT-FIRST-H1',
      severity: 'error',
      passed: false,
      skipped: false,
      decision: 'FAIL',
      reason: 'DOCUMENT_EMPTY_NO_H1',
      message: '严格模式结构错误：当前文档没有一级标题。\n文档必须以一级标题（H1）开始。',
    }
  }

  if (firstBlock.type === 'heading' && firstBlock.headingLevel === 1) {
    return {
      ruleId: 'STRICT-FIRST-H1',
      severity: 'error',
      passed: true,
      skipped: false,
      decision: 'PASS',
      reason: 'FIRST_BLOCK_IS_H1',
      message: '',
      firstBlockType: 'heading',
      firstHeadingLevel: 1,
      firstBlockText: firstBlock.text,
    }
  }

  const message =
    firstBlock.type === 'paragraph'
      ? '严格模式结构错误：文档第一个内容块必须是一级标题（H1）。\n当前第一个内容块：正文段落'
      : firstBlock.type === 'heading'
        ? `严格模式结构错误：文档必须从一级标题开始。\n当前第一个标题：H${firstBlock.headingLevel}「${firstBlock.text ?? ''}」`
        : `严格模式结构错误：文档必须从一级标题（H1）开始。\n当前第一个内容块：${firstBlock.type}`

  return {
    ruleId: 'STRICT-FIRST-H1',
    severity: 'error',
    passed: false,
    skipped: false,
    decision: 'FAIL',
    reason: 'STRICT_FIRST_H1_VIOLATION',
    message,
    firstBlockType: firstBlock.type,
    firstHeadingLevel: firstBlock.headingLevel,
    firstBlockText: firstBlock.text,
  }
}

// ── Runtime reactive state ─────────────────────────────────────────────

export interface StrictFirstH1RuntimeState {
  documentKey: string | null
  mode: 'strict' | 'loose' | string
  result: StrictFirstH1ToplineResult | null
  updatedAt: number
  trigger: string
}

/**
 * Structural signature of the first semantic block. Deliberately EXCLUDES text
 * content — the rule only depends on block type + heading level, so editing the
 * H1 title must not trigger a pointless revalidation.
 */
export function computeFirstBlockSignature(block: FirstSemanticBlock | null): string {
  if (!block) return 'EMPTY'
  return `${block.type}|${block.headingLevel ?? ''}`
}

/**
 * Decide whether STRICT-FIRST-H1 must re-run.
 *
 * Re-run when: mode changed, no previous result yet, or the first block's
 * structural signature changed. Otherwise SKIP_REVALIDATION (cheap).
 */
export function shouldRevalidateStrictFirstH1(
  prevMode: 'strict' | 'loose' | string | null,
  prevSignature: string | null,
  prevHasResult: boolean,
  nextMode: 'strict' | 'loose' | string,
  nextSignature: string,
): boolean {
  if (prevMode !== nextMode) return true
  if (!prevHasResult) return true
  if (prevSignature !== nextSignature) return true
  return false
}

// ── Top-line (document-start) validation ──────────────────────────────
//
// STRICT-FIRST-H1 v3: H1 must sit at the document's FIRST PHYSICAL LINE.
// Only a file-level BOM may precede it — no blank line, empty paragraph,
// paragraph, other heading, or any other block.

export type StrictDocumentStartState =
  | 'FIRST_LINE_H1'
  | 'LEADING_EMPTY_LINE'
  | 'LEADING_EMPTY_BLOCK'
  | 'LEADING_PARAGRAPH'
  | 'LEADING_OTHER_HEADING'
  | 'LEADING_OTHER_BLOCK'
  | 'DOCUMENT_EMPTY'
  | 'SOURCE_UNAVAILABLE'

/** Remove only a leading UTF-8 BOM. NEVER trimStart / never skip blank lines. */
export function stripLeadingBom(markdown: string): string {
  let s = markdown
  while (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return s
}

/**
 * Classify the document's first physical position from raw Markdown source.
 *
 * Reads the editor's LIVE buffer (not disk). BOM is ignored; everything else
 * before an H1 counts as a violation.
 */
export function resolveStrictDocumentStartState(
  markdown: string | null | undefined,
): StrictDocumentStartState {
  if (markdown == null) return 'SOURCE_UNAVAILABLE'

  const text = stripLeadingBom(markdown)
  if (text.length === 0) return 'DOCUMENT_EMPTY'

  const firstLine = text.split('\n', 1)[0].replace(/\r$/, '')

  if (firstLine === '') return 'LEADING_EMPTY_LINE'
  if (/^\s+$/.test(firstLine)) return 'LEADING_EMPTY_BLOCK'

  const h1 = firstLine.match(/^#{1}\s+(.+?)\s*$/)
  if (h1 && h1[1].trim().length > 0) return 'FIRST_LINE_H1'

  if (/^#{2,6}\s+/.test(firstLine)) return 'LEADING_OTHER_HEADING'

  // Quote
  if (/^>/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // List
  if (/^[-*+](\s+|$)/.test(firstLine) || /^\d+[.)](\s+|$)/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Fenced code
  if (/^(`{3,}|~{3,})/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Table
  if (/^\|/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Block math ($$ ... $$)
  if (/^\$\$/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Image / media
  if (/^!\[/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // YAML front matter
  if (/^(---|\+\+\+)\s*$/.test(firstLine)) return 'LEADING_OTHER_BLOCK'
  // Raw HTML block
  if (/^</.test(firstLine)) return 'LEADING_OTHER_BLOCK'

  return 'LEADING_PARAGRAPH'
}

/** Structural signature of the document start (for cheap revalidation skip). */
export function computeDocumentStartSignature(markdown: string | null | undefined): string {
  if (markdown == null) return 'SOURCE_UNAVAILABLE'
  return stripLeadingBom(markdown).slice(0, 128)
}

// ── Top-line validation result ─────────────────────────────────────────

export interface StrictFirstH1ToplineResult {
  ruleId: 'STRICT-FIRST-H1'
  severity: 'error'
  passed: boolean
  skipped: boolean
  decision: 'PASS' | 'FAIL' | 'SKIP'
  reason: string
  message: string
  documentStartState: StrictDocumentStartState
  firstLineRaw?: string
  firstBlockType?: FirstSemanticBlockType | 'empty' | 'other'
  firstHeadingLevel?: number
}

function deriveFirstHeadingLevel(
  state: StrictDocumentStartState,
  markdown: string | null | undefined,
): number | undefined {
  if (state === 'FIRST_LINE_H1') return 1
  if (state === 'LEADING_OTHER_HEADING' && markdown != null) {
    const line = stripLeadingBom(markdown).split('\n', 1)[0]
    const m = line.match(/^(#{2,6})/)
    if (m) return m[1].length
  }
  return undefined
}

function deriveFirstBlockType(
  state: StrictDocumentStartState,
): FirstSemanticBlockType | 'empty' | 'other' | undefined {
  switch (state) {
    case 'FIRST_LINE_H1':
    case 'LEADING_OTHER_HEADING':
      return 'heading'
    case 'LEADING_PARAGRAPH':
      return 'paragraph'
    case 'LEADING_EMPTY_LINE':
    case 'LEADING_EMPTY_BLOCK':
      return 'empty'
    case 'LEADING_OTHER_BLOCK':
      return 'other'
    default:
      return undefined
  }
}

function buildToplineMessage(state: StrictDocumentStartState, headingLevel?: number): string {
  switch (state) {
    case 'LEADING_EMPTY_LINE':
    case 'LEADING_EMPTY_BLOCK':
      return '⚠ 严格模式结构错误：一级标题必须位于文档首行\n当前 H1 前存在空行或空段落'
    case 'LEADING_PARAGRAPH':
      return '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容'
    case 'LEADING_OTHER_HEADING':
      return `⚠ 严格模式结构错误：一级标题必须位于文档首行\n当前文档首先出现的是 H${headingLevel ?? ''}`
    case 'LEADING_OTHER_BLOCK':
      return '⚠ 严格模式结构错误：一级标题必须位于文档首行\nH1 前存在其他 Markdown 内容'
    case 'DOCUMENT_EMPTY':
      return '⚠ 严格模式结构错误：当前文档没有一级标题\n文档第一行必须是 H1'
    case 'SOURCE_UNAVAILABLE':
      return '⚠ 严格模式结构错误：无法读取文档源码，无法校验首行 H1'
    default:
      return ''
  }
}

/**
 * Validate STRICT-FIRST-H1 top-line rule from the LIVE editor Markdown buffer.
 * Only FIRST_LINE_H1 → PASS. Anything else → FAIL (strict) or SKIP (non-strict).
 */
export function validateStrictFirstH1Topline(
  markdown: string | null | undefined,
  mode: 'strict' | 'loose',
): StrictFirstH1ToplineResult {
  const state = resolveStrictDocumentStartState(markdown)
  const firstLineRaw = markdown != null
    ? stripLeadingBom(markdown).split('\n', 1)[0].replace(/\r$/, '').slice(0, 80)
    : undefined
  const firstHeadingLevel = deriveFirstHeadingLevel(state, markdown)
  const firstBlockType = deriveFirstBlockType(state)

  if (mode !== 'strict') {
    return {
      ruleId: 'STRICT-FIRST-H1',
      severity: 'error',
      passed: false,
      skipped: true,
      decision: 'SKIP',
      reason: 'NON_STRICT_MODE',
      message: '',
      documentStartState: state,
      firstLineRaw,
      firstBlockType,
      firstHeadingLevel,
    }
  }

  if (state === 'FIRST_LINE_H1') {
    return {
      ruleId: 'STRICT-FIRST-H1',
      severity: 'error',
      passed: true,
      skipped: false,
      decision: 'PASS',
      reason: 'FIRST_LINE_H1',
      message: '',
      documentStartState: state,
      firstLineRaw,
      firstBlockType: 'heading',
      firstHeadingLevel: 1,
    }
  }

  return {
    ruleId: 'STRICT-FIRST-H1',
    severity: 'error',
    passed: false,
    skipped: false,
    decision: 'FAIL',
    reason: state,
    message: buildToplineMessage(state, firstHeadingLevel),
    documentStartState: state,
    firstLineRaw,
    firstBlockType,
    firstHeadingLevel,
  }
}

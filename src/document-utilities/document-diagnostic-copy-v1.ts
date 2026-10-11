/**
 * Document Diagnostics — Presentation COPY authority V1.
 *
 * ONE read-only text authority for every published diagnostic the user sees.
 * It answers, deterministically and without touching business facts:
 *
 *   - `title`       — the canonical, normalized heading of a rule;
 *   - `description` — what the rule means (说明);
 *   - `suggestion`  — the concrete fix advice (修复建议);
 *   - `severityLabel` — 错误 / 警告 / 提示 (the ONE user-visible severity label);
 *   - `rulePriority`  — a STABLE semantic ordinal used as the ordering tie-break.
 *
 * HARD BOUNDARIES (never violated by this module):
 *   - It NEVER changes a diagnostic's severity / category / code / id / location.
 *   - It NEVER merges two rules into one: the table is keyed by the EXACT rule id.
 *   - It NEVER rewrites Markdown or business content.
 *   - It NEVER recomputes a count or a number — dynamic values (a name, a path,
 *     a level, an occurrence) stay exactly as the producer emitted them.
 *
 * The producer (`computeDocumentDiagnostics`) keeps emitting the factual
 * `message` / `detail`; this layer produces the NORMALIZED user-facing copy that
 * the Drawer renders. That separation is what lets wording be unified without
 * mutating rule semantics or identity.
 *
 * Pure contract: no DOM, no host state, no imports from the overlay host.
 */

import { INTERNAL_BLANK_LINE_POLICY } from './document-diagnostic-internal-blank-lines-v1'

// ── §1 — terminology normalization ──────────────────────────────────────────

/**
 * §1 — the canonical object terminology. Every user-facing copy uses these exact
 * words so the same concept never appears under two different names (图名/图片名称,
 * 表名/表格名称, …).
 */
export const DOCUMENT_DIAGNOSTIC_TERM = Object.freeze({
  figure: '图片',
  figureName: '图名',
  table: '表格',
  tableName: '表名',
  code: '代码块',
  codeName: '代码块名称',
  formula: '公式',
  heading: '标题',
  link: '链接',
  footnote: '脚注',
  referenceLink: '引用式链接',
  anchor: '锚点',
  caption: '题注',
  frontMatter: 'Front Matter',
  document: '文档',
})

/** §1 — the severity glyph / classification prefixes that must never lead copy. */
const SEVERITY_PREFIX_RE = /^\s*(?:[⚠❌⛔🔴🟡]\s*)?(?:错误|警告|提示|Error|Warning)[：:]\s*/u

/**
 * §1 — normalize ONE piece of diagnostic text for user display:
 *   - strip an embedded severity prefix (`⚠ 严格模式结构错误：` keeps the sentence
 *     but drops the glyph; `警告：` is removed entirely);
 *   - collapse any newline/indent into a single space (Drawer copy is single-line);
 *   - trim.
 *
 * It deliberately does NOT rewrite the substance of the sentence or any dynamic
 * value inside it.
 */
export function normalizeDiagnosticText(text: string | null | undefined): string {
  let t = String(text ?? '')
  t = t.replace(/^\s*[⚠❌⛔🔴🟡]\s*/u, '')
  t = t.replace(SEVERITY_PREFIX_RE, '')
  t = t.replace(/\s*\r?\n\s*/g, ' ')
  t = t.replace(/\s{2,}/g, ' ')
  return t.trim()
}

// ── §2 — the stable rule PRIORITY (ordering tie-break) ──────────────────────

/**
 * §2 — the STABLE semantic priority of every rule family.
 *
 * It is used ONLY as a tie-break at an identical document position + severity
 * (`compareDiagnosticTargetProjections`). Lower number sorts first. The bands
 * mirror the internal areas (document-state < format < heading < objects <
 * numbering < anchor < cross-reference) so the order is meaningful and STABLE
 * across runs — never derived from object key order or alphabetical codes.
 *
 * Unknown codes get {@link DOCUMENT_DIAGNOSTIC_RULE_PRIORITY_FALLBACK}.
 */
export const DOCUMENT_DIAGNOSTIC_RULE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  // ── document state / boundary ─────────────────────────────────────────────
  DOCUMENT_INACTIVE: 100,
  DOCUMENT_SOURCE_UNAVAILABLE: 110,
  DOCUMENT_EMPTY: 120,
  STRICT_SINGLE_H1_NO_H1: 130,
  STRICT_FIRST_H1_POSITION: 140,
  STRICT_SINGLE_H1_MULTIPLE_H1: 150,
  // ── document format (blank-space policy) ──────────────────────────────────
  DOCUMENT_TERMINAL_NEWLINE_MISSING: 200,
  PROJECT_TERMINAL_NEWLINE_MISSING: 200,
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: 210,
  EXCESSIVE_INTERNAL_BLANK_LINES: 220,
  // ── document completeness ─────────────────────────────────────────────────
  DOCUMENT_HEADING_ONLY_NO_BODY: 250,
  DOCUMENT_HEADINGS_ONLY_NO_BODY: 251,
  SECTION_EMPTY: 260,
  SECTION_ONLY_SUBHEADINGS: 261,
  // ── heading structure ─────────────────────────────────────────────────────
  HEADING_LEVEL_GAP: 300,
  HEADING_EMPTY_TEXT: 310,
  HEADING_DUPLICATE_TEXT: 320,
  HEADING_DUPLICATE_IDENTITY: 330,
  LATENT_ATX_HEADING_MARKER: 340,
  // ── numbering (heading / objects) ─────────────────────────────────────────
  HEADING_MANUAL_NUMBER_PREFIX: 400,
  HEADING_AUTO_NUMBER_CONFLICT: 410,
  FIGURE_MANUAL_NUMBER_PREFIX: 420,
  TABLE_MANUAL_NUMBER_PREFIX: 421,
  CODE_MANUAL_NUMBER_PREFIX: 422,
  FIGURE_NUMBER_DUPLICATE: 430,
  TABLE_NUMBER_DUPLICATE: 431,
  CODE_NUMBER_DUPLICATE: 432,
  FIGURE_NUMBER_ORDER_INVALID: 440,
  TABLE_NUMBER_ORDER_INVALID: 441,
  CODE_NUMBER_ORDER_INVALID: 442,
  FORMULA_NUMBER_ORDER_INVALID: 443,
  FORMULA_NUMBER_SECTION_MISMATCH: 444,
  // ── figure ────────────────────────────────────────────────────────────────
  FIGURE_MISSING_NAME: 500,
  FIGURE_DUPLICATE_NAME: 510,
  FIGURE_LOCAL_IMAGE_MISSING: 520,
  FIGURE_BLOCK_STRUCTURE_INVALID: 530,
  // ── table ─────────────────────────────────────────────────────────────────
  TABLE_MISSING_NAME: 600,
  TABLE_DUPLICATE_NAME: 610,
  TABLE_BLOCK_STRUCTURE_INVALID: 620,
  TABLE_EMPTY_CONTENT: 630,
  TABLE_HEADER_EMPTY: 640,
  TABLE_HEADER_DUPLICATE: 650,
  // ── code ──────────────────────────────────────────────────────────────────
  CODE_MISSING_NAME: 700,
  CODE_MISSING_LANGUAGE: 710,
  CODE_DUPLICATE_NAME: 720,
  CODE_EMPTY_BLOCK: 730,
  CODE_FENCE_UNCLOSED: 740,
  // ── formula ───────────────────────────────────────────────────────────────
  FORMULA_DUPLICATE_VISIBLE_TAG: 800,
  FORMULA_BLOCK_STRUCTURE_INVALID: 810,
  FORMULA_EMPTY_CONTENT: 820,
  FORMULA_BLOCK_UNCLOSED: 830,
  // ── blockquote ────────────────────────────────────────────────────────────
  BLOCKQUOTE_EMPTY: 900,
  // ── link / anchor ─────────────────────────────────────────────────────────
  LINK_TEXT_EMPTY: 1000,
  LINK_TARGET_EMPTY: 1010,
  LINK_LOCAL_TARGET_MISSING: 1020,
  LINK_LOCAL_ANCHOR_MISSING: 1030,
  LINK_LOCAL_FILE_ANCHOR_MISSING: 1040,
  HEADING_ANCHOR_COLLISION: 1050,
  // ── reference / footnote ──────────────────────────────────────────────────
  FOOTNOTE_REFERENCE_TARGET_MISSING: 1100,
  FOOTNOTE_DEFINITION_DUPLICATE: 1110,
  FOOTNOTE_DEFINITION_UNUSED: 1120,
  FOOTNOTE_DEFINITION_EMPTY: 1130,
  LINK_REFERENCE_DEFINITION_MISSING: 1140,
  LINK_REFERENCE_DEFINITION_DUPLICATE: 1150,
  FRONTMATTER_UNCLOSED: 1160,
  FRONTMATTER_MALFORMED: 1170,
  FIGURE_REFERENCE_TARGET_MISSING: 1180,
  TABLE_REFERENCE_TARGET_MISSING: 1181,
  FORMULA_REFERENCE_TARGET_MISSING: 1182,
  // ── captions ──────────────────────────────────────────────────────────────
  FIGURE_ORPHAN_CAPTION: 1200,
  TABLE_ORPHAN_CAPTION: 1201,
  CODE_ORPHAN_CAPTION: 1202,
  FIGURE_MULTIPLE_CAPTIONS: 1210,
  TABLE_MULTIPLE_CAPTIONS: 1211,
  CODE_MULTIPLE_CAPTIONS: 1212,
  FIGURE_CAPTION_FORMAT_INVALID: 1220,
  TABLE_CAPTION_FORMAT_INVALID: 1221,
  CODE_CAPTION_FORMAT_INVALID: 1222,
})

/** §2 — the priority used when a code is not registered (sorts last in its band). */
export const DOCUMENT_DIAGNOSTIC_RULE_PRIORITY_FALLBACK = 1_000_000

/** §2 — resolve the stable priority of a rule code (prefix-aware for families). */
export function resolveRulePriority(code: string): number {
  const c = String(code ?? '')
  if (DOCUMENT_DIAGNOSTIC_RULE_PRIORITY[c] != null) return DOCUMENT_DIAGNOSTIC_RULE_PRIORITY[c]
  if (c.startsWith('LATENT_ATX_HEADING_MARKER')) return DOCUMENT_DIAGNOSTIC_RULE_PRIORITY.LATENT_ATX_HEADING_MARKER
  if (c.startsWith('STRICT_FIRST_H1_')) return DOCUMENT_DIAGNOSTIC_RULE_PRIORITY.STRICT_FIRST_H1_POSITION
  return DOCUMENT_DIAGNOSTIC_RULE_PRIORITY_FALLBACK
}

// ── §3 — the user-visible severity label authority ──────────────────────────

/** §3 — 错误 / 警告 / 提示. The 4th internal `info` level is never shown. */
export function resolveSeverityLabel(severity: string | null | undefined): string {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'error') return '错误'
  if (s === 'warning') return '警告'
  return '提示'
}

// ── §4 — the canonical TITLE / DESCRIPTION / SUGGESTION table ───────────────

export interface DocumentDiagnosticCopy {
  /** Canonical single-line title (or the normalized dynamic message). */
  title: string
  /** What the rule means. */
  description: string
  /** The concrete fix advice. */
  suggestion: string
}

interface DocumentDiagnosticCopySpec {
  /** Static canonical title. Absent ⇒ the normalized dynamic message is the title. */
  title?: string
  description: string
  suggestion: string
}

/**
 * §4 — the canonical copy per rule id. Codes with a DYNAMIC title (a name, a
 * path, a level, a number) intentionally omit `title` and inherit the normalized
 * producer message, so the factual value is never lost or re-derived.
 */
export const DOCUMENT_DIAGNOSTIC_COPY_TABLE: Readonly<Record<string, DocumentDiagnosticCopySpec>> = Object.freeze({
  // ── document state / boundary ─────────────────────────────────────────────
  DOCUMENT_INACTIVE: { title: '没有活动文档', description: '当前没有正在编辑的 Markdown 文档。', suggestion: '打开一个 Markdown 文档后即可进行检测。' },
  DOCUMENT_SOURCE_UNAVAILABLE: { title: '无法读取文档源码', description: '文档源码暂不可用。', suggestion: '稍后重试；部分源码相关的检查会被跳过。' },
  DOCUMENT_EMPTY: { title: '文档为空', description: '文档没有任何内容。', suggestion: '输入正文内容即可开始检测。' },
  STRICT_SINGLE_H1_NO_H1: { title: '缺少一级标题', description: '严格模式要求全文必须且只能包含一个一级标题（H1）。', suggestion: '在文档开头添加一个一级标题（H1）。' },
  STRICT_FIRST_H1_POSITION: { title: '首个内容块必须是一级标题', description: '严格模式要求一级标题（H1）位于文档首行。', suggestion: '将一级标题移动到文档首行，移除其前面的正文内容。' },
  STRICT_SINGLE_H1_MULTIPLE_H1: { title: '存在多余的一级标题', description: '严格模式要求全文只能包含一个一级标题（H1）。', suggestion: '删除或降级多余的 H1，只保留一个一级标题。' },
  // strict first-H1 top-line family (7 runtime codes of the ONE family)
  STRICT_FIRST_H1_LEADING_PARAGRAPH: { title: 'H1 前存在正文', description: '一级标题（H1）前存在正文内容，不符合严格模式。', suggestion: '删除 H1 前的正文内容，使 H1 位于文档首行。' },
  STRICT_FIRST_H1_LEADING_EMPTY_LINE: { title: 'H1 前存在空行', description: '一级标题（H1）前存在空行，不符合严格模式。', suggestion: '删除 H1 前的空行，使 H1 位于文档首行。' },
  STRICT_FIRST_H1_LEADING_EMPTY_BLOCK: { title: 'H1 前存在空段落', description: '一级标题（H1）前存在空段落，不符合严格模式。', suggestion: '删除 H1 前的空段落，使 H1 位于文档首行。' },
  STRICT_FIRST_H1_LEADING_OTHER_HEADING: { title: 'H1 不是文档首项', description: '文档首先出现的是其他级别的标题。', suggestion: '将一级标题（H1）移动到文档最前。' },
  STRICT_FIRST_H1_LEADING_OTHER_BLOCK: { title: 'H1 前存在其他内容', description: '一级标题（H1）前存在其他 Markdown 内容。', suggestion: '删除 H1 前的内容，使 H1 位于文档首行。' },
  STRICT_FIRST_H1_DOCUMENT_EMPTY: { title: '文档缺少 H1', description: '文档没有一级标题（H1）。', suggestion: '在文档开头添加一个一级标题（H1）。' },
  STRICT_FIRST_H1_SOURCE_UNAVAILABLE: { title: '无法校验 H1', description: '无法读取文档源码，无法校验首行 H1。', suggestion: '稍后重试。' },
  // ── document format (blank-space policy) ──────────────────────────────────
  DOCUMENT_TERMINAL_NEWLINE_MISSING: { title: '文档末尾缺少换行符', description: 'Markdown 文档应以一个换行符结束。', suggestion: '在文档末尾补充一个换行符。' },
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: { title: '文档末尾空行过多', description: '文档末尾存在多个连续空行。', suggestion: '删除文档末尾多余的空行，仅保留一个换行符。' },
  EXCESSIVE_INTERNAL_BLANK_LINES: { title: '连续空行过多', description: `两个内容块之间存在 ${INTERNAL_BLANK_LINE_POLICY.warningThreshold} 个及以上连续空行。`, suggestion: '删除多余的连续空行，块之间保留一个空行即可。' },
  // ── document completeness ─────────────────────────────────────────────────
  DOCUMENT_HEADING_ONLY_NO_BODY: { title: '文档仅包含标题', description: '当前文档只有一个标题，尚无正文内容。', suggestion: '补充标题下的正文内容。' },
  DOCUMENT_HEADINGS_ONLY_NO_BODY: { title: '文档仅包含标题结构', description: '当前文档包含多个标题，但尚无正文内容。', suggestion: '为各级标题补充正文内容。' },
  SECTION_EMPTY: { title: '章节没有正文', description: '当前标题到下一个同级或更高级标题之间没有正文内容。', suggestion: '补充该章节的正文内容。' },
  SECTION_ONLY_SUBHEADINGS: { title: '章节仅包含子标题', description: '当前章节下只有子标题，尚未包含正文内容。', suggestion: '补充该章节的正文内容。' },
  // ── heading structure ─────────────────────────────────────────────────────
  HEADING_LEVEL_GAP: { description: '标题层级出现跳级，中间缺少的层级未出现。', suggestion: '补充缺失的中间层级标题，或调整当前标题级别。' },
  HEADING_EMPTY_TEXT: { title: '标题为空', description: '标题没有文字内容。', suggestion: '为标题补充文字，或删除该空标题。' },
  HEADING_DUPLICATE_TEXT: { description: '多个标题使用相同文字，容易混淆。', suggestion: '修改标题文字以互相区分。' },
  HEADING_DUPLICATE_IDENTITY: { title: '标题规范身份重复', description: '规范身份出现多次，可能导致编号与定位不稳定。', suggestion: '修改或删除重复的标题，使每个标题身份唯一。' },
  LATENT_ATX_HEADING_MARKER: { description: '该行尚未被识别为标题，但后续重新解析时可能成为标题。', suggestion: '如需始终作为普通文本，请使用反斜杠转义该标记。' },
  // ── numbering ─────────────────────────────────────────────────────────────
  HEADING_MANUAL_NUMBER_PREFIX: { title: '标题包含手工编号', description: '标题目录已开启自动编号，标题文字中仍带有手工编号。', suggestion: '删除标题中的手工编号，或关闭该层级的自动编号。' },
  HEADING_AUTO_NUMBER_CONFLICT: { title: '标题编号冲突', description: '标题的自动编号已生效，Markdown 源码中仍带有手工编号。', suggestion: '删除标题中的手工编号，或关闭该标题级别的自动编号。' },
  FIGURE_MANUAL_NUMBER_PREFIX: { title: '图名包含手工编号', description: '图片已开启自动编号，图名中仍带有手工编号。', suggestion: '删除图名中的手工编号。' },
  TABLE_MANUAL_NUMBER_PREFIX: { title: '表名包含手工编号', description: '表格已开启自动编号，表名中仍带有手工编号。', suggestion: '删除表名中的手工编号。' },
  CODE_MANUAL_NUMBER_PREFIX: { title: '代码块名称包含手工编号', description: '代码块已开启自动编号，名称中仍带有手工编号。', suggestion: '删除代码块名称中的手工编号。' },
  FIGURE_NUMBER_DUPLICATE: { title: '图片编号重复', description: '多个图片解析出相同的有效编号，编号应当唯一。', suggestion: '调整编号顺序或命名，使图片编号唯一。' },
  TABLE_NUMBER_DUPLICATE: { title: '表格编号重复', description: '多个表格解析出相同的有效编号，编号应当唯一。', suggestion: '调整编号顺序或命名，使表格编号唯一。' },
  CODE_NUMBER_DUPLICATE: { title: '代码块编号重复', description: '多个代码块解析出相同的有效编号，编号应当唯一。', suggestion: '调整编号顺序或命名，使代码块编号唯一。' },
  FIGURE_NUMBER_ORDER_INVALID: { title: '图片编号顺序异常', description: '图片的有效编号在文档顺序中不是严格递增的。', suggestion: '按文档顺序调整图片编号。' },
  TABLE_NUMBER_ORDER_INVALID: { title: '表格编号顺序异常', description: '表格的有效编号在文档顺序中不是严格递增的。', suggestion: '按文档顺序调整表格编号。' },
  CODE_NUMBER_ORDER_INVALID: { title: '代码块编号顺序异常', description: '代码块的有效编号在文档顺序中不是严格递增的。', suggestion: '按文档顺序调整代码块编号。' },
  FORMULA_NUMBER_ORDER_INVALID: { title: '公式编号顺序异常', description: '公式的有效编号在文档顺序中不是严格递增的。', suggestion: '按文档顺序调整公式编号。' },
  FORMULA_NUMBER_SECTION_MISMATCH: { title: '公式编号章节不一致', description: '公式编号所使用的章节号与该公式实际所在章节不一致。', suggestion: '修正公式编号的章节号，或将其移动到对应章节。' },
  // ── figure ────────────────────────────────────────────────────────────────
  FIGURE_MISSING_NAME: { title: '图片缺少图名', description: '图片没有名称。', suggestion: '为图片补充图名。' },
  FIGURE_DUPLICATE_NAME: { description: '多张图片使用了相同的图名。', suggestion: '修改图名以互相区分。' },
  FIGURE_LOCAL_IMAGE_MISSING: { description: '图片引用的本地文件无法解析。', suggestion: '检查图片路径，或将图片重新插入文档。' },
  FIGURE_BLOCK_STRUCTURE_INVALID: { title: '图片必须作为独立块插入', description: '图片不能放在列表项或引用块中。', suggestion: '将图片移动到独立段落。' },
  // ── table ─────────────────────────────────────────────────────────────────
  TABLE_MISSING_NAME: { title: '表格缺少表名', description: '表格没有名称。', suggestion: '为表格补充表名。' },
  TABLE_DUPLICATE_NAME: { description: '多张表格使用了相同的表名。', suggestion: '修改表名以互相区分。' },
  TABLE_BLOCK_STRUCTURE_INVALID: { title: '表格必须作为独立块插入', description: '表格不能放在列表项或引用块中。', suggestion: '将表格移动到独立段落。' },
  TABLE_EMPTY_CONTENT: { title: '表格没有数据行', description: '当前表格只有表头，没有数据行。', suggestion: '为表格补充数据行，或删除空表格。' },
  TABLE_HEADER_EMPTY: { title: '表头单元格为空', description: '表格存在空的表头单元格。', suggestion: '为空的表头单元格补充列名。' },
  TABLE_HEADER_DUPLICATE: { title: '表头重复', description: '同一表头文字在表格中出现多次。', suggestion: '重命名重复的表头以区分列。' },
  // ── code ──────────────────────────────────────────────────────────────────
  CODE_MISSING_NAME: { title: '代码块缺少名称', description: '代码块没有名称。', suggestion: '为代码块补充名称。' },
  CODE_MISSING_LANGUAGE: { title: '代码块缺少语言标识', description: '代码块未指定语言。', suggestion: '为代码围栏补充语言标识（如 python / ts）。' },
  CODE_DUPLICATE_NAME: { description: '多个代码块使用了相同名称。', suggestion: '修改代码块名称以互相区分。' },
  CODE_EMPTY_BLOCK: { title: '代码块为空', description: '代码块没有任何内容。', suggestion: '补充代码内容，或删除空代码块。' },
  CODE_FENCE_UNCLOSED: { title: '代码围栏未闭合', description: '未闭合的代码围栏会把后续所有内容视为代码。', suggestion: '补全代码围栏的结束标记。' },
  // ── formula ───────────────────────────────────────────────────────────────
  FORMULA_DUPLICATE_VISIBLE_TAG: { title: '公式编号重复', description: '同一公式宿主内检测到重复的可见编号标签。', suggestion: '删除重复的公式编号标签。' },
  FORMULA_BLOCK_STRUCTURE_INVALID: { title: '公式必须作为独立块插入', description: '独立公式不能放在列表项或引用块中。', suggestion: '将公式移动到独立段落。' },
  FORMULA_EMPTY_CONTENT: { title: '公式为空', description: '独立公式没有任何内容。', suggestion: '补充公式内容，或删除空公式。' },
  FORMULA_BLOCK_UNCLOSED: { title: '公式块未闭合', description: '未闭合的 $$ 公式块会把后续内容视为公式。', suggestion: '补全 $$ 公式块的结束标记。' },
  // ── blockquote ────────────────────────────────────────────────────────────
  BLOCKQUOTE_EMPTY: { title: '引用块为空', description: '引用块没有任何内容。', suggestion: '补充引用内容，或删除空引用块。' },
  // ── link / anchor ─────────────────────────────────────────────────────────
  LINK_TEXT_EMPTY: { title: '链接文字为空', description: '链接没有可见的文字。', suggestion: '为链接补充可见文字。' },
  LINK_TARGET_EMPTY: { title: '链接目标为空', description: '链接没有目标地址。', suggestion: '为链接补充目标地址，或删除该链接。' },
  LINK_LOCAL_TARGET_MISSING: { description: '链接指向的本地文件无法解析。', suggestion: '检查链接路径是否正确。' },
  LINK_LOCAL_ANCHOR_MISSING: { description: '链接指向的文档内锚点无法解析到任何标题。', suggestion: '检查锚点名称是否与某个标题一致。' },
  LINK_LOCAL_FILE_ANCHOR_MISSING: { description: '链接指向其他文件中的锚点，暂无法校验。', suggestion: '确认目标文件及其中的锚点存在。' },
  HEADING_ANCHOR_COLLISION: { title: '标题锚点重复', description: '多个标题生成了相同的锚点，文档内跳转将无法定位到唯一标题。', suggestion: '修改标题文字，使生成的锚点唯一。' },
  // ── reference / footnote ──────────────────────────────────────────────────
  FOOTNOTE_REFERENCE_TARGET_MISSING: { description: '存在脚注引用，但没有对应的脚注定义。', suggestion: '补充 `[^label]: 内容` 脚注定义。' },
  FOOTNOTE_DEFINITION_DUPLICATE: { description: '同一个脚注标签存在多个定义。', suggestion: '保留唯一一个脚注定义。' },
  FOOTNOTE_DEFINITION_UNUSED: { description: '该脚注定义没有对应的正文引用。', suggestion: '删除未使用的脚注定义，或在正文中引用它。' },
  FOOTNOTE_DEFINITION_EMPTY: { description: '该脚注定义没有任何内容（含续行）。', suggestion: '补充脚注内容，或删除空定义。' },
  LINK_REFERENCE_DEFINITION_MISSING: { description: '存在引用式链接引用，但没有对应的定义。', suggestion: '补充 `[label]: 目标` 链接定义。' },
  LINK_REFERENCE_DEFINITION_DUPLICATE: { description: '同一个引用标签存在多个链接定义。', suggestion: '保留唯一一个链接定义。' },
  FRONTMATTER_UNCLOSED: { title: 'Front Matter 未闭合', description: '文档开头的 `---` 缺少结束分隔符，无法解析 Front Matter。', suggestion: '在 Front Matter 末尾补全 `---` 分隔符。' },
  FRONTMATTER_MALFORMED: { title: 'Front Matter 格式不规范', description: 'Front Matter 内容不符合 YAML 格式。', suggestion: '检查并修正 Front Matter 的键值对格式。' },
  // cross-reference (DEFERRED_BY_SPEC families; reserved copy for when they ship)
  FIGURE_REFERENCE_TARGET_MISSING: { title: '图片引用目标缺失', description: '正文引用的图片编号不存在。', suggestion: '检查引用编号是否与某个图片编号一致。' },
  TABLE_REFERENCE_TARGET_MISSING: { title: '表格引用目标缺失', description: '正文引用的表格编号不存在。', suggestion: '检查引用编号是否与某个表格编号一致。' },
  FORMULA_REFERENCE_TARGET_MISSING: { title: '公式引用目标缺失', description: '正文引用的公式编号不存在。', suggestion: '检查引用编号是否与某个公式编号一致。' },
  // ── captions ──────────────────────────────────────────────────────────────
  FIGURE_ORPHAN_CAPTION: { title: '图片题注没有对应对象', description: '存在一个图片题注，但无法绑定到唯一的图片对象。', suggestion: '将题注紧邻对应图片，或删除孤立题注。' },
  TABLE_ORPHAN_CAPTION: { title: '表格题注没有对应对象', description: '存在一个表格题注，但无法绑定到唯一的表格对象。', suggestion: '将题注紧邻对应表格，或删除孤立题注。' },
  CODE_ORPHAN_CAPTION: { title: '代码块题注没有对应对象', description: '存在一个代码块题注，但无法绑定到唯一的代码块对象。', suggestion: '将题注紧邻对应代码块，或删除孤立题注。' },
  FIGURE_MULTIPLE_CAPTIONS: { title: '图片存在多个题注', description: '同一个图片对象绑定了多个题注。', suggestion: '只保留唯一一个题注。' },
  TABLE_MULTIPLE_CAPTIONS: { title: '表格存在多个题注', description: '同一个表格对象绑定了多个题注。', suggestion: '只保留唯一一个题注。' },
  CODE_MULTIPLE_CAPTIONS: { title: '代码块存在多个题注', description: '同一个代码块对象绑定了多个题注。', suggestion: '只保留唯一一个题注。' },
  FIGURE_CAPTION_FORMAT_INVALID: { title: '图片题注格式不规范', description: '题注文字不符合规范格式「图片 编号 名称」。', suggestion: '按「图片 编号 名称」格式修改题注。' },
  TABLE_CAPTION_FORMAT_INVALID: { title: '表格题注格式不规范', description: '题注文字不符合规范格式「表格 编号 名称」。', suggestion: '按「表格 编号 名称」格式修改题注。' },
  CODE_CAPTION_FORMAT_INVALID: { title: '代码块题注格式不规范', description: '题注文字不符合规范格式「代码块 编号 名称」。', suggestion: '按「代码块 编号 名称」格式修改题注。' },
})

export interface ResolveDiagnosticCopyInput {
  code: string
  message?: string | null
  detail?: string | null
  severity?: string | null
  category?: string | null
}

/**
 * §4 — resolve the canonical user-facing copy of ONE diagnostic.
 *
 * Resolution order for the TITLE:
 *   1. the static canonical title of the rule (or dynamic family);
 *   2. otherwise the NORMALIZED producer message (dynamic facts preserved).
 * The DESCRIPTION falls back to the normalized detail, the SUGGESTION to ''.
 */
export function resolveDiagnosticCopy(input: ResolveDiagnosticCopyInput): DocumentDiagnosticCopy {
  const code = String(input.code ?? '')
  const spec = DOCUMENT_DIAGNOSTIC_COPY_TABLE[code]
  const normalizedMessage = normalizeDiagnosticText(input.message)
  const normalizedDetail = normalizeDiagnosticText(input.detail)
  const title = spec?.title ?? (normalizedMessage !== '' ? normalizedMessage : code)
  return {
    title,
    description: spec?.description ?? normalizedDetail,
    suggestion: spec?.suggestion ?? '',
  }
}

/**
 * §5 — are two user-facing copy strings SEMANTICALLY REDUNDANT? Used by the
 * Drawer so a fix advice that merely restates the description is never shown
 * twice. The check is intentionally conservative (normalized equality or
 * containment) so genuinely different advice is never dropped.
 */
export function isRedundantDiagnosticCopy(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCopyKey(a)
  const nb = normalizeCopyKey(b)
  if (na === '' || nb === '') return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** §5 — strip whitespace / punctuation so two phrasings compare on content. */
function normalizeCopyKey(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[\s，。、；：,.!?！？()（）「」【】\[\]`'"·—…]+/g, '')
    .trim()
}

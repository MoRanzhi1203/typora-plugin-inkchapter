/**
 * Phase 7R.3.11 — Document Diagnostics: pure compute + deduplication.
 *
 * Authority-driven only. Consumes existing canonical facts (strict document
 * validator, canonical heading frame, caption records, formula projection
 * output) and NEVER rebuilds heading numbering / object scope semantics.
 * No timers, no polling — the caller decides WHEN to compute.
 */
import { validateStrictFirstH1Topline } from '../heading-numbering/strict-document-validator'
import type {
  DocumentDiagnostic,
  DocumentDiagnosticCategory,
  DocumentDiagnosticSeverity,
  DocumentDiagnosticsSnapshot,
  DocumentDiagnosticsState,
} from './diagnostics-types'

export interface DiagnosticHeadingFact {
  level: number
  text: string
  stableIdentity?: string
  element: HTMLElement | null
}

export interface DiagnosticObjectFact {
  name: string | null
  /** For figures: resolved local path (null when remote/untracked). */
  localPath?: string | null
  /** For code: fence language. */
  language?: string | null
  element: HTMLElement | null
  targetIdentity?: string
}

export interface DiagnosticFormulaFact {
  /** Visible tag tokens extracted by the existing projection authority (read-only). */
  visibleTagTokens: string[]
  element: HTMLElement | null
  targetIdentity?: string
}

export interface DiagnosticLinkFact {
  target: string
  element: HTMLElement | null
}

export interface DocumentDiagnosticsInput {
  documentKey: string | null
  markdown: string | null
  strictMode: boolean
  vaultRoot: string | null
  headings: readonly DiagnosticHeadingFact[]
  figures: readonly DiagnosticObjectFact[]
  tables: readonly DiagnosticObjectFact[]
  codes: readonly DiagnosticObjectFact[]
  formulas: readonly DiagnosticFormulaFact[]
  links: readonly DiagnosticLinkFact[]
  canonicalDuplicateIdentities: readonly string[]
  captionDuplicateNames: readonly string[]
}

export interface DocumentDiagnosticsComputed {
  diagnostics: DocumentDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
}

const DOCUMENT_EMPTY_CODE = 'DOCUMENT_EMPTY'
const SOURCE_UNAVAILABLE_CODE = 'DOCUMENT_SOURCE_UNAVAILABLE'

/** Normalize a message so the same root cause deduplicates deterministically. */
function normalizeIdentity(value: string | undefined | null): string {
  return (value ?? '').trim()
}

/**
 * Deduplicate diagnostics: one stable item per (category + code + targetIdentity).
 * The first occurrence wins; identical duplicates are dropped.
 */
export function deduplicateDiagnostics(
  diagnostics: readonly DocumentDiagnostic[],
): DocumentDiagnostic[] {
  const seen = new Set<string>()
  const out: DocumentDiagnostic[] = []
  for (const d of diagnostics) {
    const key = `${d.category}\u0000${d.code}\u0000${normalizeIdentity(d.targetIdentity)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

function makeDiagnostic(
  input: DocumentDiagnosticsInput,
  category: DocumentDiagnosticCategory,
  severity: DocumentDiagnosticSeverity,
  code: string,
  message: string,
  opts: {
    detail?: string
    stableIdentity?: string
    targetIdentity?: string
    element?: HTMLElement | null
    kind?: 'heading' | 'object' | 'formula' | 'link' | 'document'
  } = {},
): DocumentDiagnostic {
  const targetIdentity = normalizeIdentity(opts.targetIdentity) || normalizeIdentity(opts.stableIdentity)
  return {
    id: `${category}:${code}:${targetIdentity || Math.random().toString(36).slice(2, 8)}`,
    documentKey: input.documentKey ?? '',
    severity,
    category,
    code,
    message,
    detail: opts.detail,
    stableIdentity: opts.stableIdentity,
    targetIdentity: targetIdentity || undefined,
    locator: opts.element
      ? { kind: opts.kind ?? category === 'heading' ? 'heading' : 'object', targetElement: opts.element }
      : undefined,
  }
}

/** Count duplicate text names (case-insensitive, trimmed, non-empty). */
function duplicateNames(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const raw of names) {
    const name = (raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n === 2) dupes.push(name)
  }
  return dupes
}

/** True when the path is a safe-to-check local relative path (no scheme). */
function isLocalRelativePath(target: string): boolean {
  if (!target) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // scheme (http:, file:, data:, ...)
  if (target.startsWith('#') || target.startsWith('mailto:')) return false
  return true
}

/**
 * Compute the full diagnostics list from existing authority facts.
 *
 * Pure and synchronous — the production authority calls this on relevant
 * document/authority change events (never on a timer).
 */
export function computeDocumentDiagnostics(
  input: DocumentDiagnosticsInput,
): DocumentDiagnosticsComputed {
  const diagnostics: DocumentDiagnostic[] = []
  const errors: DocumentDiagnostic[] = []
  const warnings: DocumentDiagnostic[] = []
  const infos: DocumentDiagnostic[] = []

  const push = (d: DocumentDiagnostic) => {
    diagnostics.push(d)
    if (d.severity === 'error') errors.push(d)
    else if (d.severity === 'warning') warnings.push(d)
    else infos.push(d)
  }

  // ── Document-level ──────────────────────────────────
  if (input.documentKey == null || (input.markdown == null && input.headings.length === 0)) {
    // No active business document: NOT a scary plugin error.
    push(
      makeDiagnostic(input, 'document', 'info', 'DOCUMENT_INACTIVE', '当前没有活动文档', {
        detail: '打开一个 Markdown 文档后即可检查其结构。',
      }),
    )
  } else {
    const topline = validateStrictFirstH1Topline(input.markdown, input.strictMode ? 'strict' : 'loose')
    if (!topline.skipped && !topline.passed && topline.message) {
      push(
        makeDiagnostic(input, 'document', 'error', `STRICT_FIRST_H1_${topline.reason}`, topline.message, {
          detail: topline.documentStartState === 'DOCUMENT_EMPTY' ? '文档为空，无法满足严格模式首行 H1。' : undefined,
          kind: 'document',
        }),
      )
    }
    const isEmpty =
      input.markdown != null && input.markdown.trim() === '' && input.headings.length === 0
    if (isEmpty) {
      push(
        makeDiagnostic(input, 'document', 'info', DOCUMENT_EMPTY_CODE, '文档为空', {
          detail: '当前文档没有内容。',
          kind: 'document',
        }),
      )
    }
    if (input.markdown == null) {
      push(
        makeDiagnostic(input, 'document', 'info', SOURCE_UNAVAILABLE_CODE, '无法读取文档源码', {
          detail: '部分源码相关的检查将跳过。',
          kind: 'document',
        }),
      )
    }
  }

  // ── Heading diagnostics (from canonical frame facts, NOT re-derived numbering) ──
  // Multiple H1 in strict mode is a VALID numbering boundary — never an error here.
  for (const identity of input.canonicalDuplicateIdentities) {
    push(
      makeDiagnostic(input, 'heading', 'error', 'HEADING_DUPLICATE_IDENTITY', '标题存在重复的规范身份', {
        detail: `规范身份 ${identity} 出现多次，可能导致编号与定位不稳定。`,
        stableIdentity: identity,
        targetIdentity: `identity:${identity}`,
      }),
    )
  }

  const headingTexts = input.headings.map(h => h.text)
  for (const name of duplicateNames(headingTexts)) {
    push(
      makeDiagnostic(input, 'heading', 'warning', 'HEADING_DUPLICATE_TEXT', `重复的标题文字「${name}」`, {
        detail: '多个标题使用相同文字，建议区分以避免混淆。',
        targetIdentity: `text:${name.toLowerCase()}`,
      }),
    )
  }

  for (const h of input.headings) {
    if ((h.text ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'heading', 'warning', 'HEADING_EMPTY_TEXT', '存在空标题', {
          detail: '标题没有文字内容。',
          stableIdentity: h.stableIdentity,
          element: h.element,
          targetIdentity: h.stableIdentity ? `identity:${h.stableIdentity}` : undefined,
          kind: 'heading',
        }),
      )
    }
  }

  // Strict parent gap: heading jumps more than one level below an existing
  // previous heading. Phase 7R.3.11.4: this is a Markdown STRUCTURE lint and
  // must use PHYSICAL heading levels regardless of numbering strict mode
  // (HEADING_LEVEL_GAP). Never gated on strictMode.
  if (input.headings.length > 1) {
    let prevLevel: number | null = null
    for (const h of input.headings) {
      if (prevLevel != null && h.level > prevLevel + 1) {
        const missingLevels: number[] = []
        for (let l = prevLevel + 1; l < h.level; l++) missingLevels.push(l)
        push(
          makeDiagnostic(input, 'heading', 'warning', 'HEADING_LEVEL_GAP', `标题层级存在跳级（H${prevLevel} → H${h.level}）`, {
            detail: `当前标题为 H${h.level}，但前一可用层级为 H${prevLevel}，缺少 ${missingLevels.map(l => `H${l}`).join('、')}。`,
            stableIdentity: h.stableIdentity,
            element: h.element,
            targetIdentity: h.stableIdentity ? `identity:${h.stableIdentity}` : `gap:${prevLevel}>${h.level}:${h.text}`,
            kind: 'heading',
          }),
        )
      }
      prevLevel = h.level
    }
  }

  // ── Figure diagnostics ──────────────────────────────
  const figureNames = input.figures.map(f => f.name)
  for (const name of duplicateNames(figureNames)) {
    push(
      makeDiagnostic(input, 'figure', 'warning', 'FIGURE_DUPLICATE_NAME', `重复的图名「${name}」`, {
        detail: '多张图片使用相同图名。',
        targetIdentity: `name:${name.toLowerCase()}`,
      }),
    )
  }
  for (const f of input.figures) {
    const identity = f.targetIdentity ?? undefined
    if ((f.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'figure', 'warning', 'FIGURE_MISSING_NAME', '图片缺少图名', {
          detail: '建议为图片命名。',
          element: f.element,
          targetIdentity: identity,
          kind: 'object',
        }),
      )
    }
    // Local resource check only for resolvable local relative paths.
    if (f.localPath && isLocalRelativePath(f.localPath)) {
      push(
        makeDiagnostic(input, 'figure', 'error', 'FIGURE_LOCAL_IMAGE_MISSING', `本地图片不存在：${f.localPath}`, {
          detail: '相对路径无法解析到现有文件。',
          element: f.element,
          targetIdentity: `local:${f.localPath}`,
          kind: 'object',
        }),
      )
    }
  }

  // ── Table diagnostics ───────────────────────────────
  const tableNames = input.tables.map(t => t.name)
  for (const name of duplicateNames(tableNames)) {
    push(
      makeDiagnostic(input, 'table', 'warning', 'TABLE_DUPLICATE_NAME', `重复的表名「${name}」`, {
        detail: '多张表格使用相同表名。',
        targetIdentity: `name:${name.toLowerCase()}`,
      }),
    )
  }
  for (const t of input.tables) {
    if ((t.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'table', 'warning', 'TABLE_MISSING_NAME', '表格缺少表名', {
          detail: '建议为表格命名。',
          element: t.element,
          targetIdentity: t.targetIdentity ?? undefined,
          kind: 'object',
        }),
      )
    }
  }

  // ── Code diagnostics ────────────────────────────────
  const codeNames = input.codes.map(c => c.name)
  for (const name of duplicateNames(codeNames)) {
    push(
      makeDiagnostic(input, 'code', 'warning', 'CODE_DUPLICATE_NAME', `重复的代码名称「${name}」`, {
        detail: '多个代码块使用相同名称。',
        targetIdentity: `name:${name.toLowerCase()}`,
      }),
    )
  }
  for (const c of input.codes) {
    if ((c.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'code', 'warning', 'CODE_MISSING_NAME', '代码块缺少名称', {
          detail: '建议为代码块命名。',
          element: c.element,
          targetIdentity: c.targetIdentity ?? undefined,
          kind: 'object',
        }),
      )
    }
    if ((c.language ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'code', 'warning', 'CODE_MISSING_LANGUAGE', '代码块缺少语言标识', {
          detail: '未指定代码语言（如 python / ts）。',
          element: c.element,
          targetIdentity: c.targetIdentity ? `${c.targetIdentity}:lang` : undefined,
          kind: 'object',
        }),
      )
    }
  }

  // ── Formula diagnostics (projection invariants only — never business re-derivation) ──
  for (const f of input.formulas) {
    const tokenSet = new Set(f.visibleTagTokens.map(t => t.trim()))
    if (f.visibleTagTokens.length > tokenSet.size) {
      push(
        makeDiagnostic(input, 'formula', 'error', 'FORMULA_DUPLICATE_VISIBLE_TAG', '公式出现重复可见编号', {
          detail: '同一公式宿主内检测到重复的可见编号标签。',
          element: f.element,
          targetIdentity: f.targetIdentity ?? undefined,
          kind: 'formula',
        }),
      )
    }
  }

  // ── Link diagnostics (safe local resolution only; no network) ──
  for (const l of input.links) {
    if (!isLocalRelativePath(l.target)) continue
    push(
      makeDiagnostic(input, 'link', 'warning', 'LINK_LOCAL_TARGET_MISSING', `本地链接目标不存在：${l.target}`, {
        detail: '链接指向的本地文件无法解析。',
        element: l.element,
        targetIdentity: `local:${l.target}`,
        kind: 'link',
      }),
    )
  }

  const deduped = deduplicateDiagnostics(diagnostics)
  return {
    diagnostics: deduped,
    errorCount: deduped.filter(d => d.severity === 'error').length,
    warningCount: deduped.filter(d => d.severity === 'warning').length,
    infoCount: deduped.filter(d => d.severity === 'info').length,
  }
}

/** Build the compact toolbar/UI state from a snapshot. */
export function deriveDiagnosticsState(
  snapshot: DocumentDiagnosticsSnapshot | null,
): DocumentDiagnosticsState {
  if (!snapshot || snapshot.documentKey == null) return { state: 'NO_ACTIVE_DOCUMENT', errorCount: 0, warningCount: 0, infoCount: 0 }
  if (snapshot.errorCount > 0 || snapshot.warningCount > 0) {
    return { state: 'HAS_ISSUES', errorCount: snapshot.errorCount, warningCount: snapshot.warningCount, infoCount: snapshot.infoCount }
  }
  return { state: 'HEALTHY', errorCount: 0, warningCount: 0, infoCount: snapshot.infoCount }
}

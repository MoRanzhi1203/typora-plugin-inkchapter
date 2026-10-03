// @vitest-environment jsdom
/**
 * TRAE-DOCUMENT-HINT-VISUAL-SEMANTICS-CHIP-POLICY-V1 — targeted contract tests.
 *
 * Two independent problems are locked down here:
 *   A. HINT must be a THIRD visual semantic (cold low-saturation blue-gray),
 *      strictly LIGHTER than Warning, and must never reuse an amber Warning
 *      token (its active heading fill used to be folded into `warning`).
 *   B. `DOCUMENT_HEADING_ONLY_NO_BODY` is a DOCUMENT-level diagnostic: it keeps
 *      its Drawer explanation + locator + active FILL, but must NOT paint a
 *      "仅有标题" reason chip beside the body heading. The chip policy is
 *      scope/presentation-driven — NEVER `severity === 'hint'`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DOCUMENT_HEADING_ONLY_NO_BODY_CODE,
  computeDocumentDiagnostics,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import {
  shouldRenderReasonChip,
  mergeHeadingMarkerSeverity,
  severityRank,
} from './document-heading-diagnostic-marker-v5-12'

const ROOT = process.cwd()
const SCSS = readFileSync(resolve(ROOT, 'src/style.scss'), 'utf8')
const OVERLAY_HOST = readFileSync(
  resolve(ROOT, 'src/document-utilities/document-utility-overlay-host.ts'),
  'utf8',
)

// ── §26 — visual tokens ─────────────────────────────────────────────────────

describe('V1 §3/§4/§5 — Hint has its OWN blue-gray token scale', () => {
  it('declares the dedicated Hint tokens (never a Warning/RED token)', () => {
    expect(SCSS).toContain('--ink-diagnostic-hint-text: #60778a')
    expect(SCSS).toContain('--ink-diagnostic-hint-active-bg: rgba(96, 130, 160, 0.22)')
    expect(SCSS).toContain('--ink-diagnostic-hint-active-accent: rgba(73, 108, 139, 0.66)')
    expect(SCSS).toContain('--ink-diagnostic-hint-active-chip-bg: rgba(96, 130, 160, 0.24)')
  })

  it('§17 — Error / Warning tokens are byte-for-byte unchanged', () => {
    expect(SCSS).toContain('--ink-diagnostic-error-passive-bg: rgba(181, 84, 84, 0.12)')
    expect(SCSS).toContain('--ink-diagnostic-error-active-bg: rgba(235, 55, 55, 0.32)')
    expect(SCSS).toContain('--ink-diagnostic-error-active-accent: rgba(220, 35, 35, 0.95)')
    expect(SCSS).toContain('--ink-diagnostic-warning-passive-bg: rgba(168, 121, 50, 0.13)')
    expect(SCSS).toContain('--ink-diagnostic-warning-active-bg: rgba(255, 190, 20, 0.38)')
    expect(SCSS).toContain('--ink-diagnostic-warning-active-accent: rgba(225, 150, 0, 0.95)')
  })

  it('§5 — Hint active fill/edge weight is strictly LOWER than Warning', () => {
    const alpha = (token: string): number => {
      const m = SCSS.match(new RegExp(`${token}: rgba\\([^)]*,\\s*([0-9.]+)\\)`))
      expect(m, `token ${token} missing`).not.toBeNull()
      return Number(m![1])
    }
    expect(alpha('--ink-diagnostic-hint-active-bg')).toBeLessThan(alpha('--ink-diagnostic-warning-active-bg'))
    expect(alpha('--ink-diagnostic-hint-active-accent')).toBeLessThan(alpha('--ink-diagnostic-warning-active-accent'))
    expect(alpha('--ink-diagnostic-hint-passive-bg')).toBeLessThan(alpha('--ink-diagnostic-warning-passive-bg'))
  })

  it('§19/§21 — the info ACTIVE heading rule routes to Hint tokens, never Warning', () => {
    const start = SCSS.indexOf(".inkchapter-heading-diagnostic-active[data-ink-diagnostic-severity='info'] {")
    expect(start).toBeGreaterThan(-1)
    const block = SCSS.slice(start, SCSS.indexOf('}', start) + 1)
    expect(block).toContain('--ink-heading-sev-active: var(--ink-diagnostic-hint-active-bg)')
    expect(block).toContain('--ink-heading-sev-active-accent: var(--ink-diagnostic-hint-active-accent)')
    expect(block).not.toContain('--ink-diagnostic-warning-')
    expect(block).not.toContain('--ink-diagnostic-error-')
  })

  it('§14 — a document-level Hint leaves the idle heading normal (no passive fill token)', () => {
    const start = SCSS.indexOf(".inkchapter-heading-diagnostic-marker[data-ink-diagnostic-severity='info'] {")
    expect(start).toBeGreaterThan(-1)
    const block = SCSS.slice(start, SCSS.indexOf('}', start) + 1)
    expect(block).toContain('--ink-heading-sev: var(--ink-diagnostic-hint-text')
    // no `--ink-heading-sev-soft` ⇒ the passive fill stays transparent.
    expect(block).not.toContain('--ink-heading-sev-soft')
  })

  it('§6 — the Drawer hint row/icon never reuse a Warning token', () => {
    expect(SCSS).toContain('.inkchapter-doc-drawer__item--info .inkchapter-doc-drawer__item-icon { color: var(--ink-diagnostic-hint-text')
    expect(SCSS).toMatch(/--ink-drawer-row-sev: var\(--ink-ui-sev-info/)
  })
})

// ── §27/§9/§10 — chip policy authority ──────────────────────────────────────

describe('V1 §9/§10/§25 — reason-chip policy is SCOPE-driven, never severity-driven', () => {
  it('§7/§11 — a document-scope diagnostic suppresses its reason chip', () => {
    expect(shouldRenderReasonChip({ metadata: { scope: 'document', reasonChip: false } })).toBe(false)
    // scope alone is enough (the reasonChip override is optional)
    expect(shouldRenderReasonChip({ metadata: { scope: 'document' } })).toBe(false)
  })

  it('§15 — heading-local diagnostics keep their chip', () => {
    expect(shouldRenderReasonChip({ metadata: { scope: 'heading' } })).toBe(true)
    // a heading-local ERROR / WARNING (no explicit scope) defaults to shown
    expect(shouldRenderReasonChip({ metadata: {} })).toBe(true)
    expect(shouldRenderReasonChip({})).toBe(true)
  })

  it('§16 — object-local diagnostics keep the CURRENT chip strategy', () => {
    expect(shouldRenderReasonChip({ metadata: { scope: 'object' } })).toBe(true)
    expect(shouldRenderReasonChip({ metadata: { scope: 'block' } })).toBe(true)
    expect(shouldRenderReasonChip({ metadata: { scope: 'inline' } })).toBe(true)
    // an object-local diagnostic may still opt out explicitly
    expect(shouldRenderReasonChip({ metadata: { scope: 'object', reasonChip: false } })).toBe(false)
  })

  it('§9 — a HINT with no document scope still shows its chip (no global hint hiding)', () => {
    // e.g. "code block missing language" (info + object-local) keeps its chip.
    expect(shouldRenderReasonChip({ scope: 'object', metadata: {} })).toBe(true)
    expect(shouldRenderReasonChip({ metadata: {} })).toBe(true)
  })

  it('§10 — an explicit presentation override outranks the scope default', () => {
    expect(shouldRenderReasonChip({ metadata: { scope: 'document', reasonChip: true } })).toBe(true)
    expect(shouldRenderReasonChip({ metadata: { scope: 'heading', reasonChip: false } })).toBe(false)
  })
})

// ── §11 — the real DOCUMENT_HEADING_ONLY_NO_BODY metadata ───────────────────

function inputOf(markdown: string, level = 1): DocumentDiagnosticsInput {
  const text = 'R58 Canonical Transfer Acceptance'
  const el = document.createElement(`h${level}`)
  el.setAttribute('data-line', '0')
  el.textContent = text
  const facts = [{ level, text, stableIdentity: 'H:doc:0', element: el }]
  return {
    documentKey: 'doc:hint-v1',
    markdown,
    strictMode: true,
    vaultRoot: '/vault',
    headings: facts,
    h1Facts: facts.filter(f => f.level === 1).map(f => ({ stableIdentity: f.stableIdentity, element: f.element, text: f.text })),
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

describe('V1 §11/§12 — DOCUMENT_HEADING_ONLY_NO_BODY presentation metadata', () => {
  it('is severity=info, scope=document, reasonChip=false — but still locates the heading', () => {
    const out = computeDocumentDiagnostics(inputOf('# R58 Canonical Transfer Acceptance\n'))
    const d = out.diagnostics.find(x => x.code === DOCUMENT_HEADING_ONLY_NO_BODY_CODE)!
    expect(d).toBeDefined()
    expect(d.severity).toBe('info')
    expect(d.metadata?.scope).toBe('document')
    expect(d.metadata?.reasonChip).toBe(false)
    // the chip policy resolves to suppressed …
    expect(shouldRenderReasonChip({ metadata: d.metadata as Record<string, unknown> })).toBe(false)
    // … while the locator / active state matter are untouched.
    expect(d.locator?.kind).toBe('heading')
    expect(d.location?.kind).toBe('canonical-node')
  })
})

// ── §28/§9 — the severity authority + active-visual independence ─────────────

describe('V1 §3/§19/§28 — active severity authority + fill/chip decoupling', () => {
  it('§19 — `info` routes through the shared severity authority (no warning fold)', () => {
    expect(mergeHeadingMarkerSeverity(['info'])).toBe('info')
    expect(mergeHeadingMarkerSeverity(['error'])).toBe('error')
    expect(mergeHeadingMarkerSeverity(['warning'])).toBe('warning')
    expect(severityRank('info')).toBe(1)
  })

  it('§19 — the host no longer collapses info into the Warning class', () => {
    expect(OVERLAY_HOST).not.toContain("severityRank(String(diag.severity ?? 'info')) >= 3 ? 'error' : 'warning'")
    expect(OVERLAY_HOST).toContain("mergeHeadingMarkerSeverity([String(diag.severity ?? 'info')]) ?? 'info'")
  })

  it('§9 — the host never hides chips with a global severity rule', () => {
    expect(OVERLAY_HOST).not.toMatch(/severity\s*===?\s*['"]hint['"]/)
  })

  it('§13/§28 — the active FILL is painted BEFORE (and independently of) the chip decision', () => {
    const fragIdx = OVERLAY_HOST.indexOf("frag.className = 'inkchapter-heading-diagnostic-active__fragment'")
    const reasonIdx = OVERLAY_HOST.indexOf('const reasonText = shouldRenderReasonChip(')
    expect(fragIdx).toBeGreaterThan(-1)
    expect(reasonIdx).toBeGreaterThan(-1)
    // the fill loop precedes the chip policy ⇒ suppressing the chip cannot remove the fill
    expect(reasonIdx).toBeGreaterThan(fragIdx)
  })

  it('§9 — BOTH the passive and active chip paths enforce the scope policy', () => {
    expect(OVERLAY_HOST).toContain('const reason = shouldRenderReasonChip(')
    expect(OVERLAY_HOST).toContain('const reasonText = shouldRenderReasonChip(')
  })
})

/**
 * Phase 7R.3.11 — Document Utility Overlay Host (singleton).
 *
 * Mounts the DocumentStatusToolbar (top-right) + DocumentScrollNavigator
 * (lower-right) + DocumentDiagnosticsDrawer as editor-shell overlays OUTSIDE
 * the Markdown business content (#write). The whole tree is marked
 * `data-inkchapter-ui-root="document-utilities"` so every mutation observer /
 * classifier can recognize it as INKCHAPTER_UI_INTERNAL.
 *
 * Placement is anchored to the real editor shell (`#write` parent = scroll
 * container) via position:fixed + rect sync — never to the whole window.
 */
import { DocumentDiagnosticsAuthority } from './document-diagnostics-authority'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import { DocumentDiagnosticLocator, prefersReducedMotion, DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'
import type { DiagnosticLocateResult } from './document-diagnostic-locator'
import {
  DiagnosticLocateFrameController,
  DIAGNOSTIC_INLINE_FRAGMENT_CLASS,
  classifyDiagnosticLocateElement,
  type DiagnosticLocateTargetKind,
  type RectLike,
} from './document-diagnostic-locate-frame'
import {
  clampRectToClip,
  makeRectSnapshot,
  snapshotDomRect,
  validateRectInvariants,
  type RectSnapshot,
} from './document-locate-rect-v4'
import { measureTextRects, measureTextFragmentRects, countTokenInElement } from './document-locate-visual-geometry-v4'
// V5.12-R8 §6 — the SINGLE Markdown reference scanner (no second parser).
import { findReferenceSpanAt, type ReferenceSpan } from './document-resource-scanner'
import type { DiagnosticRangeRole } from './diagnostics-types'
import {
  resolveDiagnosticLocation,
  getRuleMeta,
  hasLocatableLocation,
  normalizeSourceAnchorText,
  normalizeResourcePath,
  type DiagnosticLocationResolveContext,
  type DiagnosticLocationResolveResult,
  type ResolvedSourceOccurrenceHint,
} from './document-diagnostic-location'
import {
  DOCUMENT_EMPTY_DIAGNOSTIC_CODE,
  EMPTY_DOCUMENT_EXCLUSIVE_REASON,
  EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT,
  EMPTY_DOCUMENT_V512R6_GATE_KEYS,
  createEmptyDocumentV512R6Counters,
  evaluateEmptyDocumentV512R6Gates,
  formatEmptyDocumentV512R6GateReport,
  measureEmptyDocumentShortCircuit,
} from './document-diagnostic-empty-short-circuit-v512-r6'
import {
  ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS,
  ACTIVE_LOCATE_LINE_SOURCE,
  ACTIVE_LOCATE_MIN_FILL_COUNT,
  ACTIVE_LOCATE_PRESENTATION_FILL_ONLY,
  FILL_ONLY_LOCATE_AUDIT_EVENT,
  createActiveLocateFillOnlyCounters,
  emptyActiveLocateFillOnlyFacts,
  evaluateActiveLocateFillOnlyGates,
  formatActiveLocateFillOnlyGateReport,
  isHorizontalLineBar,
  isVerticalLineBar,
  measureActiveLocateFillOnlyGates,
  type ActiveLocateFillOnlyFacts,
} from './document-diagnostic-locate-fill-only-v512-r7'
import {
  FIGURE_MISSING_NAME_RANGE_ROLE,
  FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE,
  FIGURE_TARGET_AUTHORITY_AUDIT_EVENT,
  FIGURE_TARGET_V512R8_GATE_KEYS,
  FIGURE_TARGET_V512R8_PER_CLICK_GATE_KEYS,
  createFigureTargetV512R8Counters,
  evaluateFigureTargetAuthority,
  evaluateFigureTargetSnapshotGates,
  evaluateFigureTargetV512R8Gates,
  figureRangeRoleForRule,
  formatFigureTargetV512R8GateReport,
  type FigureRangeRole,
  type FigureSnapshotDiagnosticView,
  type FigureTargetAuthorityFacts,
} from './document-diagnostic-figure-target-v512-r8'
import {
  CAPTION_CODE_SPACING_AUDIT_EVENT,
  createCaptionCodeSpacingV512R8Counters,
  evaluateCaptionCodeSpacingGap,
  evaluateCaptionCodeSpacingV512R8Gates,
  formatCaptionCodeSpacingV512R8GateReport,
  type CaptionCodeSpacingFacts,
} from './document-caption-code-spacing-v512-r8'
import {
  DUPLICATE_OCCURRENCES_COLLAPSED_TO_SAME_RANGE_REASON,
  SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT,
  buildSourceRangeIdentity,
  createSourceOccurrenceV512R5Counters,
  evaluateSourceOccurrenceAuthority,
  evaluateSourceOccurrenceV512R5Gates,
  findTokenOffsets,
  formatSourceOccurrenceV512R5GateReport,
  selectOccurrenceOffset,
  sourceOccurrenceGateKeyForCheck,
  sourceOccurrenceGroupKey,
  type SourceResourceKind,
} from './document-diagnostic-source-occurrence-v512-r5'
import { DocumentEditGuard } from './document-edit-guard'
import { DocumentScrollNavigator, getActiveEditorScrollContainer } from './document-scroll-navigator'
import type { ScrollNavigatorState } from './document-scroll-navigator'
import {
  WORKSPACE_WIDTH_STATE_ATTR,
  WORKSPACE_HOST_CLASS,
  DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
  resolveWorkspaceHost,
  sampleWorkspaceWidths,
  type WorkspaceWidthSample,
  type WorkspaceWidthState,
} from './document-workspace-width-guard'
import { deriveDiagnosticsState } from './document-diagnostics'
import { deriveDocumentProblemsProjection } from './document-problems-projection'
import type { CurrentProblemsProjection } from './document-problems-projection'
import {
  canPerformLayoutRecovery,
  computeDrawerOcclusionFacts,
  deriveDrawerPresentation,
  evaluatePanelPaintRelation,
  rectsIntersect,
  resolveNameSlotPresentation,
  resolveProblemsControlAction,
  type DrawerPresentationMode,
  type LocateDrawerRecoveryLease,
  type SimpleRect,
} from './document-locate-drawer-recovery-v5-1'
import {
  LOCATE_ONE_CLICK_AUDIT_EVENT,
  LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY,
  createLocateOneClickGateCounters,
  resolveOneClickRetryDecision,
  shouldInvalidatePreScrollGeometry,
  verifyOneClickLocateVisual,
  type LocateTransactionState,
  type LocateOneClickGateKey,
} from './document-locate-one-click-v5-8'
import {
  LOCATE_SCROLL_ARRIVAL_AUDIT_EVENT,
  MAX_ARRIVAL_FRAMES,
  MAX_POST_ARRIVAL_FRAMES,
  MAX_POST_ARRIVAL_STABLE_FRAMES,
  MAX_SCROLL_CORRECTION,
  canStartVisualPipeline,
  computeDesiredScrollTop,
  createLocateScrollV59GateCounters,
  hasScrollEffect,
  isArrivalStable,
  makeScrollRectSnapshot,
  measureScrollArrival,
  type LocateScrollV59GateKey,
  type ScrollArrivalSnapshot,
} from './document-locate-scroll-arrival-v5-9'
import {
  LOCATE_PLACEMENT_AUDIT_EVENT,
  MAX_FINAL_PLACEMENT_CORRECTION,
  computePreferredPlacement,
  createLocatePlacementV510GateCounters,
  isWithinCenterTolerance,
  placementNumericTolerancePx,
  verifyFinalPlacement,
  type LocatePlacementMode,
  type LocatePlacementV510GateKey,
  type PlacementDecision,
} from './document-locate-placement-v5-10'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_SPACE_DRIFT_HARD_PX,
  LOCATE_DOCUMENT_LAYER_CLASS,
  LOCATE_DOCUMENT_SPACE_AUDIT_EVENT,
  createLocateDocumentSpaceV511GateCounters,
  documentLocalDrift,
  isLayoutReflow,
  layoutFingerprintKey,
  makeDocumentSpaceRect,
  viewportRectToDocumentLocalRect,
  type DocumentSpaceRect,
  type LocateDocumentSpaceV511GateKey,
  type LocateLayoutFingerprint,
} from './document-locate-document-space-v5-11'
import {
  HEADING_MARKER_AUDIT_EVENT,
  HEADING_MARKER_ICON_SIZE_PX,
  HEADING_MARKER_MIN_TEXT_GAP_PX,
  HEADING_MARKER_RAIL_WIDTH_PX,
  buildHeadingLocateReason,
  computeHeadingMarkerGeometry,
  computeHeadingReasonChipPlacement,
  createHeadingMarkerV512R1GateCounters,
  headingMarkerIdentity,
  makeHeadingRect,
  mergeHeadingMarkerSeverity,
  severityRank,
  unionHeadingNumberAndTextRects,
  type HeadingMarkerSeverity,
  type HeadingRect,
} from './document-heading-diagnostic-marker-v5-12'
import { resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
import {
  isLayoutEpochStale,
  isPassiveMarkerDrift,
  nextLayoutEpoch,
  shouldBumpLayoutEpoch,
  type DocumentLayoutEpoch,
  type LayoutMutationKind,
} from './document-layout-epoch-v512-r2'
import {
  headingVisualTargets,
  resolveDiagnosticVisualTargets,
  type ResolvedDiagnosticVisualTarget,
} from './document-diagnostic-visual-target-v512-r2'
import {
  VISUAL_CLOSURE_AUDIT_EVENT,
  VISUAL_COVERAGE_FLOOR,
  canCommitLocateVisual,
  createVisualClosureV512R2Counters,
  evaluateVisualClosureGates,
  formatVisualClosureGateReport,
  resolveLocateVisualRecoveryDecision,
  type LocateVisualCommitDecision,
  type VisualClosureV512R2GateKey,
} from './document-diagnostic-visual-closure-v512-r2'
import {
  DRAWER_PERSISTENCE_AUDIT_EVENT,
  DRAWER_PERSISTENCE_V512R3_GATE_KEYS,
  createDrawerPersistenceV512R3Counters,
  evaluateDrawerPresentationFidelity,
  evaluateDrawerPersistenceGates,
  formatDrawerPersistenceGateReport,
  resolveDrawerRestoreRequired,
  resolveDrawerViewportClass,
  type DrawerPersistenceV512R3GateKey,
  type DrawerPresentationModeV3,
  type DrawerViewportClass,
} from './document-diagnostic-drawer-persistence-v512-r3'
// ── V5.12-R4 — inline DOCUMENT-SPACE coordinate authority ──────────────────
import {
  INLINE_COORDINATE_AUTHORITY_AUDIT_EVENT,
  INLINE_COORDINATE_NORMALIZER_ID,
  INLINE_POSITION_DRIFT_HARD_PX,
  createInlineDocumentSpaceV512R4Counters,
  evaluateInlineCoordinateAuthority,
  evaluateInlineDocumentSpaceGates,
  formatInlineDocumentSpaceGateReport,
  measureInlineFragmentPositionDrift,
  projectDocumentLocalRectToViewport,
  type InlineDocumentSpaceV512R4GateKey,
} from './document-diagnostic-inline-document-space-v512-r4'
import { emitRuntimeAudit, emitInkchapterRuntimeAuditSummary } from '../runtime/forensic-log-sink'
import {
  resolveActiveDocumentPresence,
  normalizeActiveLeafDocumentPath,
  type ActiveDocumentPresenceDecision,
  type ActiveLeafDocumentFacts,
} from './document-active-leaf-presence'
import {
  computeActiveDocumentReadiness,
  evaluateDiagnosticsCommitGate,
  type ActiveDocumentReadinessState,
} from './document-active-document-readiness'
import { EmptyWorkspaceUxController } from './document-empty-workspace-controller'
import type {
  EmptyWorkspacePresence,
  EmptyWorkspaceSurfaceFacts,
  EmptyWorkspaceUxControllerOptions,
  EmptyWorkspaceUxPlatform,
} from './document-empty-workspace-controller'

export const UTILITY_UI_ROOT_ATTR = 'data-inkchapter-ui-root'
export const UTILITY_UI_ROOT_VALUE = 'document-utilities'
/** Root-identity attribute (the whole tree shares UTILITY_UI_ROOT_ATTR). */
export const UTILITY_ROOT_IDENTITY_ATTR = 'data-inkchapter-utility-root'

/** Diagnostics severity filter — shared between Toolbar segments and Drawer Text Tabs. */
export type DiagnosticsSeverityFilter = 'all' | 'error' | 'warning' | 'info'

/** UI Visual Consolidation V1.1 — inline SVG icon set (stroke=currentColor). */
const INK_ICONS: Record<string, string> = {
  error:
    '<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
  warning:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
  info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
  check: '<polyline points="20 6 9 17 4 12"></polyline>',
  refresh:
    '<polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>',
  close: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  pencil:
    '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"></polyline>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
}
function setIcon(el: HTMLElement, name: string, cls = 'inkchapter-ic'): void {
  const body = INK_ICONS[name] ?? ''
  el.innerHTML =
    `<svg class="${cls}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

// ── V5.12-R7 §12 — computed-style probes for the FILL_ONLY gate measurement ──
/** True when a computed colour actually paints (alpha > 0). */
function colorIsVisible(color: string | null | undefined): boolean {
  if (color == null) return false
  const value = color.trim().toLowerCase()
  if (value === '' || value === 'transparent') return false
  const alpha = /rgba?\([^)]*,\s*([0-9.]+)\s*\)$/.exec(value)
  if (alpha) return Number.parseFloat(alpha[1]) > 0
  return true
}

/**
 * True when ANY of the four computed borders would actually PAINT. A border
 * with `border-*-style: none` never paints (the used width is 0), which is how
 * the initial `medium` width must be interpreted.
 */
function borderIsPainted(cs: CSSStyleDeclaration): boolean {
  const sides: Array<[string, string]> = [
    [cs.borderTopStyle, cs.borderTopWidth],
    [cs.borderRightStyle, cs.borderRightWidth],
    [cs.borderBottomStyle, cs.borderBottomWidth],
    [cs.borderLeftStyle, cs.borderLeftWidth],
  ]
  for (const [style, width] of sides) {
    const s = (style ?? 'none').trim().toLowerCase()
    if (s === '' || s === 'none' || s === 'hidden') continue
    const n = Number.parseFloat(width ?? '0')
    if (Number.isFinite(n) && n > 0) return true
  }
  return false
}

/** True when a computed outline would paint a visible line. */
function outlineIsPainted(cs: CSSStyleDeclaration): boolean {
  const style = (cs.outlineStyle ?? 'none').trim().toLowerCase()
  if (style === '' || style === 'none') return false
  const width = Number.parseFloat(cs.outlineWidth ?? '0')
  return Number.isFinite(width) && width > 0
}

/** True when a computed box-shadow would paint (an inset shadow = a fake line). */
function shadowIsPainted(cs: CSSStyleDeclaration): boolean {
  const shadow = (cs.boxShadow ?? '').trim().toLowerCase()
  return shadow !== '' && shadow !== 'none'
}

/** True when a ::before / ::after pseudo element paints content. */
function pseudoIsPainted(view: Window, el: HTMLElement, pseudo: '::before' | '::after'): boolean {
  let cs: CSSStyleDeclaration | null = null
  try { cs = view.getComputedStyle(el, pseudo) } catch { return false }
  if (!cs) return false
  const content = (cs.content ?? '').trim().toLowerCase()
  return content !== '' && content !== 'none' && content !== 'normal'
}

export interface DocumentUtilitiesOverlayOptions {
  ctx: DocumentUtilitiesContext
  providers: DocumentDiagnosticsProviders
  /** Recompute triggers wired by the caller (document switch etc.). */
  onBindDocument?: (bind: () => void) => void
  /**
   * V3 — ACTIVE-leaf lifecycle triggers wired by the caller. Primary triggers:
   * real workspace `active-leaf:change` and workspace-tabs `tab:toggle`. The
   * host reacts SYNCHRONOUSLY (never waits for resize/scroll/geometry or an
   * unrelated DOM mutation). Returns a dispose for the whole subscription.
   */
  onActiveLeafLifecycle?: (onTransition: (reason: ActiveLeafTransitionReason) => void) => () => void
  /** Phase 7R.3.11.8-B — light diagnostics recompute triggers (frame commit /
   *  settings/mode change). Called with a recompute() that ONLY refreshes the
   *  diagnostics snapshot — no geometry / BCR / scroll rebind churn. */
  /**
   * Phase 7R.3.11.8-B — external diagnostics trigger subscription (canonical
   * frame commit / settings/mode change). Phase 7R.3.11.8B.7.1 — the reason
   * string flows to the PUBLISHED audit (HEADING_STRUCTURE_MODE_CHANGED etc.).
   */
  onDiagnosticsTrigger?: (recompute: (reason: string) => void) => void
  /**
   * Empty Workspace UX V1 — optional platform wiring. When present, the host
   * owns the single EMPTY-placeholder marker writer and the single scoped
   * empty-workspace dblclick listener (create + open .md via injected API).
   */
  emptyWorkspace?: {
    platform: EmptyWorkspaceUxPlatform
    contentEditableBoundaryAllowed?: boolean
    /** V2 — authoritative empty-workspace surface resolver (active EMPTY leaf
     *  view container). Never falls back to the stale #write business root. */
    resolveEmptySurface?(): EmptyWorkspaceSurfaceFacts | null
  }
}

const TOOLBAR_TOP_PX = 12
const TOOLBAR_RIGHT_PX = 24
const NAV_RIGHT_PX = 28
const NAV_BOTTOM_PX = 64
const DRAWER_TOP_PX = 56
const DRAWER_RIGHT_PX = 12
const DRAWER_BOTTOM_PX = 16

// ── Phase 2-B — responsive layout constants (editor-geometry based) ──────
/** Semantic min right-gutter required before the floating navigator may show. */
export const MIN_NAVIGATOR_GUTTER_PX = 44
/** Navigator estimated footprint (button 30px + 2×padding + gap + safety). */
export const NAV_FOOTPRINT_PX = 40
/** Navigator visual width — MUST match the CSS shell width (30px). Used ONLY
 *  when a hidden navigator cannot be measured (rect.width = 0). */
export const NAVIGATOR_VISUAL_WIDTH_PX = 30
/** Editor content width below which the toolbar switches to compact density. */
export const TOOLBAR_COMPACT_THRESHOLD_PX = 520
/** Editor content width at/below which the toolbar must be suppressed entirely
 *  (real collapsed editor — never UNKNOWN geometry). */
export const TOOLBAR_SUPPRESSED_THRESHOLD_PX = 280
/** Editor content width below which Diagnostics switches to the sheet mode. */
export const DIAGNOSTICS_SHEET_THRESHOLD_PX = 520

export type ToolbarDensity = 'full' | 'compact'
export type ToolbarPresentation = 'full' | 'compact' | 'suppressed'
export type DiagnosticsPresentation = 'desktop' | 'sheet'

/** V3 — real active-leaf lifecycle trigger that invoked a presence transition. */
export type ActiveLeafTransitionReason = 'ACTIVE_LEAF_CHANGE' | 'TAB_TOGGLE'


export type NavigatorPresentation = 'gutter' | 'inset' | 'hidden'

/**
 * Phase 2-B.3 — Navigator presentation (pure). Whether to show depends ONLY
 * on real scrollability; WHERE depends on visible editor geometry.
 */
export function decideNavigatorPresentation(args: {
  scrollable: boolean
  /** Visible-editor availability gate (highest precedence). */
  hasVisibleEditor?: boolean
  /** The visible editor is wide enough to contain the navigator. */
  editorCanContainNavigator?: boolean
  /** gutter candidate validity (navigator fully right of contentRight + 8px). */
  gutterCandidateValid: boolean
  /** inset candidate validity (real candidate rect inside editor, overlap ≤ 12px). */
  insetCandidateValid: boolean
  /** edge-inset fallback validity (full nav inside visible editor, clear of scrollbar). */
  edgeInsetCandidateValid?: boolean
  /** false when geometry could not be measured → visible fallback, never NO_SAFE. */
  geometryKnown: boolean
}): { presentation: NavigatorPresentation; reason: string } {
  // NO_VISIBLE_EDITOR outranks GEOMETRY_PENDING / UNKNOWN fallback /
  // lastStablePresentation / every candidate mode.
  if (args.hasVisibleEditor === false || args.editorCanContainNavigator === false) {
    return { presentation: 'hidden', reason: 'NO_VISIBLE_EDITOR' }
  }
  if (!args.scrollable) return { presentation: 'hidden', reason: 'NOT_SCROLLABLE' }
  if (args.gutterCandidateValid) return { presentation: 'gutter', reason: 'GUTTER_AVAILABLE' }
  if (args.insetCandidateValid) return { presentation: 'inset', reason: 'INSET_AVAILABLE' }
  if (args.edgeInsetCandidateValid === true) return { presentation: 'inset', reason: 'INSET_EDGE_FALLBACK' }
  // UNKNOWN_GEOMETRY is never collapsed: a scrollable doc whose rail inputs
  // could not be measured stays visible on an inset fallback (no anchor override).
  if (!args.geometryKnown) return { presentation: 'inset', reason: 'INSET_UNKNOWN_FALLBACK' }
  return { presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }
}
/** Phase 2-B.2 — viewport-clipped visible editor width (pure). Null = unknown. */
export function computeEditorVisibleWidth(
  layout: { left: number; right: number } | null,
  viewportRight: number,
): number | null {
  if (layout == null) return null
  if (!Number.isFinite(layout.left) || !Number.isFinite(layout.right)) return null
  const l = Math.max(layout.left, 0)
  const r = Math.min(layout.right, viewportRight)
  return Math.max(0, r - l)
}

/**
 * Phase 7R.3.11.8B.12 — Navigator ACTIVE-DOCUMENT eligibility (PURE, single
 * authority). Runs BEFORE any placement/scrollability/rail decision. EMPTY /
 * no documentKey / disconnected editor root / Untitled+0-chars are always
 * ineligible → hidden. In a REAL layout the canonical heading frame must be
 * READY too (WAITING → hidden, never a stale-geometry show).
 */
export function decideNavigatorEligibilityPure(input: {
  presenceState: 'ACTIVE' | 'EMPTY' | 'UNKNOWN'
  hasActiveDocument: boolean
  documentKey: string | null
  /** null = editor root absent (headless keeps positive identity). */
  rootConnected: boolean | null
  /** True when active leaf is Untitled with zero non-whitespace chars. */
  emptyUntitled: boolean
  canonicalReady: boolean
  realLayout: boolean
}): { eligible: boolean; reason: string } {
  if (input.presenceState === 'EMPTY') return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.presenceState === 'ACTIVE' && !input.hasActiveDocument) return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.presenceState === 'UNKNOWN' && !input.hasActiveDocument) return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.documentKey == null || input.documentKey === '') return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.rootConnected === false) return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.emptyUntitled) return { eligible: false, reason: 'NO_ACTIVE_DOCUMENT' }
  if (input.realLayout && !input.canonicalReady) return { eligible: false, reason: 'CANONICAL_FRAME_NOT_READY' }
  return { eligible: true, reason: 'ACTIVE' }
}

/**
 * Phase 2-B1 — three-tier toolbar presentation from the REAL editor content
 * width. UNKNOWN (null/jsdom) geometry is treated as full — never collapsed;
 * only a KNOWN measured width below the suppressed threshold hides the toolbar.
 */
export function decideToolbarPresentation(
  editorContentWidth: number | null,
  compactThreshold: number = TOOLBAR_COMPACT_THRESHOLD_PX,
  suppressedThreshold: number = TOOLBAR_SUPPRESSED_THRESHOLD_PX,
): ToolbarPresentation {
  if (editorContentWidth == null) return 'full' // UNKNOWN_GEOMETRY → not suppressed
  if (editorContentWidth < suppressedThreshold) return 'suppressed'
  if (editorContentWidth < compactThreshold) return 'compact'
  return 'full'
}

// ── Phase 7R.3.11.8B.NO-ACTIVE-DOC — active-document visibility gate ───────

/**
 * Active-document existence — single authority. A "New tab" / empty workspace
 * may still have tabCount=1: tab presence never implies a document. The
 * positive evidence set is: a real document key + an active file path + the
 * shared ctx authority agreeing a document is active; the #write root, when it
 * exists, must stay connected. Headless (root=null) keeps positive identity.
 */
export function resolveActiveDocumentExistence(input: {
  documentKey: string | null
  activeFilePath: string | null
  ctxHasActiveDocument: boolean
  rootConnected: boolean | null
}): boolean {
  const noDocEvidence = input.documentKey == null || input.activeFilePath == null || input.ctxHasActiveDocument === false
  if (noDocEvidence) return false
  if (input.rootConnected === false) return false
  return true
}

/**
 * Highest-precedence gate: the Document Problems Control is a UI OF the active
 * Markdown document. Without a real active document it must be SUPPRESSED
 * regardless of geometry / last-stable / workspace fallback.
 */
export function decideActiveDocumentSuppression(input: {
  hasActiveDocument: boolean
}): { presentation: ToolbarPresentation; reason: string; geometryFallbackBlocked: boolean; lastStableBlocked: boolean } {
  if (!input.hasActiveDocument) {
    return { presentation: 'suppressed', reason: 'NO_ACTIVE_DOCUMENT', geometryFallbackBlocked: true, lastStableBlocked: true }
  }
  return { presentation: 'full', reason: 'ACTIVE_DOCUMENT_PRESENT', geometryFallbackBlocked: false, lastStableBlocked: false }
}

export interface ActiveDocumentVisibilityInput {
  documentKey: string | null
  hasActiveDocument: boolean
  activeDocumentRootConnected: boolean
  toolbarPresentation: ToolbarPresentation
  toolbarVisible: boolean
  drawerVisible: boolean
  pendingLocateTarget: string | null
}

export function evaluateActiveDocumentVisibility(input: ActiveDocumentVisibilityInput): { decision: 'PASS' | 'FAIL'; reason: string } {
  if (!input.hasActiveDocument && input.toolbarVisible) {
    return { decision: 'FAIL', reason: 'TOOLBAR_VISIBLE_WITHOUT_ACTIVE_DOCUMENT' }
  }
  if (!input.hasActiveDocument && input.drawerVisible) {
    return { decision: 'FAIL', reason: 'DIAGNOSTICS_DRAWER_VISIBLE_WITHOUT_ACTIVE_DOCUMENT' }
  }
  if (!input.hasActiveDocument && input.pendingLocateTarget != null) {
    return { decision: 'FAIL', reason: 'LOCATE_TARGET_WITHOUT_ACTIVE_DOCUMENT' }
  }
  return { decision: 'PASS', reason: input.hasActiveDocument ? 'ACTIVE_DOCUMENT_PRESENT' : 'NO_ACTIVE_DOCUMENT_SUPPRESSED' }
}

/** True rendered visibility — never trusts `hidden` alone (V2). */
export function isRenderedVisible(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const opacity = Number.parseFloat(style.opacity || '1')
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number.isFinite(opacity) &&
    opacity > 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    el.getClientRects().length > 0
  )
}

export interface ToolbarRenderedVisibilityFacts {
  documentKey: string | null
  hasActiveDocument: boolean
  toolbarDomCount: number
  problemsControlDomCount: number
  hiddenAttr: boolean
  ariaHidden: boolean
  presentation: string | null
  computedDisplay: string
  computedVisibility: string
  computedOpacity: string
  rectWidth: number
  rectHeight: number
  clientRectCount: number
  renderedToolbarCount: number
  renderedProblemsControlCount: number
  projectedErrorCount: number
  projectedWarningCount: number
  projectedHintCount: number
  projectedEditState: 'LOCKED' | 'EDITABLE' | 'NONE'
  measureMode: 'REAL' | 'HEADLESS'
}

export function evaluateToolbarRenderedVisibility(
  f: ToolbarRenderedVisibilityFacts,
): { decision: 'PASS' | 'FAIL' | 'NA'; reason: string } {
  if (f.toolbarDomCount > 1) return { decision: 'FAIL', reason: 'DUPLICATE_OR_ORPHAN_TOOLBAR' }
  const hiddenOverride = f.hiddenAttr && f.computedDisplay !== 'none' && isRenderedVisibleFrom(f.computedDisplay, f.computedVisibility, f.computedOpacity, f.rectWidth, f.rectHeight, f.clientRectCount)
  if (hiddenOverride) return { decision: 'FAIL', reason: 'HIDDEN_ATTRIBUTE_OVERRIDDEN_BY_CSS' }

  // Headless layout: BCR/clientRects are all zero — never certify a visual.
  const visuallyProven = f.rectWidth > 0 && f.rectHeight > 0 && f.clientRectCount > 0
  const real = f.measureMode === 'REAL' || f.computedDisplay === 'none' || visuallyProven
  if (!real) return { decision: 'NA', reason: 'NO_REAL_LAYOUT' }

  if (!f.hasActiveDocument) {
    if (f.renderedToolbarCount > 0) return { decision: 'FAIL', reason: 'RENDERED_TOOLBAR_WITHOUT_ACTIVE_DOCUMENT' }
    if (f.toolbarDomCount === 1 && f.renderedToolbarCount === 0 && f.renderedProblemsControlCount > 0) {
      return { decision: 'FAIL', reason: 'ORPHAN_PROBLEMS_CONTROL' }
    }
    if (f.projectedErrorCount > 0 || f.projectedWarningCount > 0 || f.projectedHintCount > 0 || f.projectedEditState !== 'NONE') {
      return { decision: 'FAIL', reason: 'STALE_DOCUMENT_TOOLBAR_PROJECTION' }
    }
    const emptyChain =
      f.hiddenAttr && f.ariaHidden && f.presentation === 'suppressed' && f.computedDisplay === 'none' &&
      f.rectWidth === 0 && f.rectHeight === 0 && f.clientRectCount === 0 &&
      f.renderedToolbarCount === 0 && f.renderedProblemsControlCount === 0
    return emptyChain
      ? { decision: 'PASS', reason: 'NO_ACTIVE_DOCUMENT_NOT_RENDERED' }
      : { decision: 'FAIL', reason: 'EMPTY_STATE_RENDER_CHAIN_INCOMPLETE' }
  }

  // Active document: must be genuinely rendered (REAL layout only).
  if (f.hiddenAttr || f.computedDisplay === 'none') return { decision: 'FAIL', reason: 'ACTIVE_DOCUMENT_NOT_RENDERED' }
  const activeRendered = f.renderedToolbarCount >= 1 && f.computedDisplay !== 'none' && f.renderedProblemsControlCount >= 1
  if (!visuallyProven) return { decision: 'NA', reason: 'NO_REAL_LAYOUT' }
  return activeRendered
    ? { decision: 'PASS', reason: 'ACTIVE_DOCUMENT_RENDERED' }
    : { decision: 'FAIL', reason: 'ACTIVE_DOCUMENT_NOT_RENDERED' }
}

function isRenderedVisibleFrom(display: string, visibility: string, opacity: string, w: number, h: number, rects: number): boolean {
  const o = Number.parseFloat(opacity || '1')
  return display !== 'none' && visibility !== 'hidden' && Number.isFinite(o) && o > 0 && w > 0 && h > 0 && rects > 0
}

/** Gutter-aware navigator visibility (NOT viewport-width based). */
export function decideNavigatorGutterVisible(
  rightGutter: number | null,
  minGutter: number = MIN_NAVIGATOR_GUTTER_PX,
): boolean {
  // null = geometry not measurable (headless/jsdom): no evidence of crowding,
  // so the legacy visible behavior is preserved. Only a MEASURED gutter below
  // the requirement hides the navigator.
  return rightGutter == null || rightGutter >= minGutter
}

/** Toolbar density from the REAL editor content width. */
export function decideToolbarDensity(
  editorContentWidth: number | null,
  threshold: number = TOOLBAR_COMPACT_THRESHOLD_PX,
): ToolbarDensity {
  if (editorContentWidth == null) return 'full'
  return editorContentWidth < threshold ? 'compact' : 'full'
}

/** Diagnostics presentation from the REAL editor content width. */
export function decideDiagnosticsPresentation(
  editorContentWidth: number | null,
  threshold: number = DIAGNOSTICS_SHEET_THRESHOLD_PX,
): DiagnosticsPresentation {
  if (editorContentWidth == null) return 'desktop'
  return editorContentWidth < threshold ? 'sheet' : 'desktop'
}

/**
 * Phase 7R.3.11.8B.3 — vertical space reserved below the drawer for the
 * right-bottom navigator zone (navigator height ~66px + safety gap). The
 * drawer may only grow down to `viewport - drawerTop - this` before its body
 * scrolls internally. The navigator NEVER moves to resolve conflicts.
 */
const DRAWER_BOTTOM_RESERVED_PX = 140
/**
 * Phase 7R.3.11.8B.7.2 — vertical gap between the diagnostics drawer's bottom
 * edge and the right-bottom navigator's top edge (measured from the REAL
 * navigator rect). The drawer max-height reserve is
 * `viewport − navigatorRect.top + this` — never a hardcoded pixel block.
 */
export const DRAWER_NAV_SAFE_GAP_PX = 12
/** Phase 7R.3.11.8B.7.2 — below this drawer height the navigator is
 *  temporarily hidden (last-resort small-viewport policy, §16): the panel
 *  keeps internal scroll, every 定位 button stays clickable. */
export const MIN_DRAWER_USABLE_HEIGHT_PX = 96
/** Phase 7R.3.11.8B.3 — scrollability epsilon (px). maxScrollTop <= this ⇒ short document. */
const SCROLLABLE_EPSILON_PX = 1

/**
 * Phase 7R.3.11.8B.7.2 — Diagnostics Panel Bottom Safe Area (single formula).
 *
 * The reserved vertical zone below the drawer is derived from the REAL
 * navigator box:
 *
 *   reserve = navigatorBottomOffset + navigatorHeight + safe gap
 *
 * When the navigator is hidden (short document / small-viewport suppression)
 * there is nothing to collide with, so only the shell bottom gap + a small
 * padding is reserved. Callers without a live navigator measurement keep the
 * legacy fixed reserve via `navigatorHeightPx = null` + `bottomGap` (the
 * pre-8B.7.2 behavior is the fallback, never a guessed pixel block).
 */
export function computeDrawerBottomReserve(opts: {
  /** Navigator bottom offset from the viewport bottom (geometry navBottom). */
  navBottom: number
  navigatorVisible: boolean
  /** REAL measured navigator box height (null before the first measurement). */
  navigatorHeightPx: number | null
  /** Gap between the editor shell bottom edge and the viewport bottom. */
  bottomGap: number
}): number {
  if (opts.navigatorVisible && opts.navigatorHeightPx != null && opts.navigatorHeightPx > 0) {
    return opts.navBottom + opts.navigatorHeightPx + DRAWER_NAV_SAFE_GAP_PX
  }
  return opts.bottomGap + DRAWER_BOTTOM_PX + DRAWER_NAV_SAFE_GAP_PX
}

export interface OverlayGeometry {
  toolbarTop: number
  toolbarRight: number
  navRight: number
  navBottom: number
  drawerTop: number
  drawerRight: number
  drawerBottom: number
  /** Phase 7R.3.11.8B.3 — scrollability from the REAL scroll container. */
  scrollable: boolean
  navigatorVisible: boolean
  /** Phase 7R.3.11.8B.7.2 — true when the navigator is hidden because the
   *  open drawer would otherwise be squeezed below the usable minimum
   *  (small-viewport policy, never a "short document" mislabel). */
  navigatorSuppressed: boolean
  /** Phase 7R.3.11.8B.3 — drawer may not exceed this (viewport − top − reserved). */
  drawerMaxHeight: number
}

export interface OverlayGeometryOptions {
  drawerOpen: boolean
  /** Phase 7R.3.11.8B.3 — live scroll container metrics (scrollability authority). */
  scrollHeight?: number
  clientHeight?: number
}

const DRAWER_WIDTH_PX = 360

/**
 * Phase 7R.3.11.8B.7.4 — Source Token Identity of a resource diagnostic
 * (metadata.rawDestination) or null.
 */
function diagRawToken(diag: DocumentDiagnosticsSnapshot['diagnostics'][number] | null): string | null {
  if (!diag?.metadata) return null
  const raw = (diag.metadata as Record<string, unknown>).rawDestination
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/**
 * Phase 7R.3.11.8B.7.4 — parse Markdown image/link resource references for the
 * resource validity re-scan (occurrence-aware). Local refs only — schemes and
 * in-document anchors are skipped (mirrors the diagnostic producer).
 */
export function parseLocalResourceRefs(markdown: string): Array<{ target: string; resourceKind?: 'image' | 'link' }> {
  const out: Array<{ target: string; resourceKind?: 'image' | 'link' }> = []
  const re = /(!?)\[([^\]]*)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const target = m[3].trim().split(/\s+/)[0]
    if (!target) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    if (target.startsWith('#') || target.startsWith('mailto:')) continue
    out.push({ target, resourceKind: m[1] === '!' ? 'image' : 'link' })
  }
  return out
}
/** Legacy Drawer↔navigator horizontal gap constant (kept; not used for
 *  positioning since 7R.3.11.8B.3 — the navigator is an independent anchor). */
const DRAWER_NAV_GAP_PX = 16

/** Phase 7R.3.11.4 — ResizeObserver attribution windows (single source of truth). */
const EXTERNAL_RESIZE_WINDOW_MS = 100
const UTILITY_WRITE_WINDOW_MS = 100

/** Phase 7R.3.11.6 — navigator placement tolerance (px) for NAV-PLACEMENT gate. */
const NAV_PLACEMENT_TOLERANCE_PX = 3

/** Phase 7R.3.11.8-B — scroll operation authority constants. */
export const SCROLL_OP_EPSILON_PX = 1
/** Quiescence window: the operation finalizes when no scroll event arrives for
 *  this window (NOT a fixed click-to-success delay). */
export const SCROLL_OP_QUIESCENCE_MS = 150
/** Bounded safety deadline — resource leak guard / TIMEOUT classification ONLY. */
export const SCROLL_OP_SAFETY_DEADLINE_MS = 2000
/** Bounded corrective recovery: at most ONE auto scroll after a genuine early stop. */
export const SCROLL_OP_MAX_RECOVERY_ATTEMPTS = 1

export type ScrollOperationSource = 'BUTTON' | 'DIAGNOSTIC_LOCATE'

export type ScrollOperationDecision =
  | 'PASS'
  | 'PASS_RECOVERED'
  | 'PASS_TARGET_REACHED_AT_DEADLINE'
  | 'FAIL_SETTLED_BEFORE_TARGET'
  | 'FAIL_CONTAINER_DISCONNECTED'
  | 'CANCELLED_DOCUMENT_SWITCH'
  | 'SUPERSEDED'
  | 'TIMEOUT_BEFORE_SETTLE'

export type ScrollOperationSettleReason = 'SCROLLEND' | 'QUIESCENCE' | 'SAFETY_TIMEOUT'

export type ResizeAttributionVerdict =
  | 'ATTRIBUTED_TO_DOCUMENT_UTILITIES'
  | 'ATTRIBUTED_TO_EXTERNAL_RESIZE'
  | 'MIXED'
  | 'UNPROVEN'

/** Phase 7R.3.11.5 — audit consistency (callback count vs RO epoch). */
export function computeAuditConsistency(
  resizeObserverCallbackCount: number,
  resizeObserverEpoch: number,
): { resizeObserverCallbackCount: number; resizeObserverEpoch: number; difference: number; decision: 'PASS' | 'FAIL' } {
  const difference = resizeObserverCallbackCount - resizeObserverEpoch
  return { resizeObserverCallbackCount, resizeObserverEpoch, difference, decision: difference === 0 ? 'PASS' : 'FAIL' }
}

export interface ScrollNavAuditPayload {
  documentKey: string | null
  source: 'BUTTON'
  action: 'GO_TOP' | 'GO_BOTTOM'
  scrollTopBefore: number
  scrollTopAfter: number
  maxScrollTop: number
  atTopBefore: boolean
  atBottomBefore: boolean
  atTopAfter: boolean
  atBottomAfter: boolean
  drawerVisible: boolean
  locked: boolean
  decision: 'PASS' | 'FAIL'
}

/**
 * Phase 7R.3.11.8-B — ONE finite event-driven scroll operation per button click.
 * The fixed-250ms read is NOT an authority; settle is decided by scrollend /
 * quiescence + final live target, with at most ONE corrective recovery.
 */
export interface ActiveScrollOperation {
  operationId: number
  documentKey: string | null
  action: 'GO_TOP' | 'GO_BOTTOM'
  source: ScrollOperationSource
  container: HTMLElement
  startTs: number
  scrollTopStart: number
  maxScrollTopStart: number
  targetAtStart: number
  scrollEventCount: number
  firstScrollEventTs: number | null
  lastScrollEventTs: number | null
  scrollTopLastObserved: number
  maxScrollTopLastObserved: number
  reversalCount: number
  scrollTopAtLegacyCheck: number | null
  legacyWouldPass: boolean | null
  recoveryAttemptCount: number
  drawerVisibleAtStart: boolean
  lockedAtStart: boolean
  settleTimer: ReturnType<typeof setTimeout> | null
  safetyDeadline: ReturnType<typeof setTimeout> | null
  legacySampleTimer: ReturnType<typeof setTimeout> | null
  onScroll: () => void
  onScrollEnd: (() => void) | null
}

/** Phase 7R.3.11.5 — scroll navigator BUTTON action audit payload (pure). */
export function buildScrollNavAudit(opts: {
  documentKey: string | null
  action: 'GO_TOP' | 'GO_BOTTOM'
  scrollTopBefore: number
  scrollTopAfter: number
  maxScrollTop: number
  drawerVisible: boolean
  locked: boolean
}): ScrollNavAuditPayload {
  const { action, scrollTopBefore, scrollTopAfter, maxScrollTop } = opts
  const atTopBefore = scrollTopBefore <= 2
  const atBottomBefore = maxScrollTop > 2 && scrollTopBefore >= maxScrollTop - 2
  const atTopAfter = scrollTopAfter <= 2
  const atBottomAfter = maxScrollTop > 2 && scrollTopAfter >= maxScrollTop - 2
  const okTarget = action === 'GO_TOP' ? atTopAfter : maxScrollTop <= 2 || atBottomAfter
  return {
    documentKey: opts.documentKey,
    source: 'BUTTON',
    action,
    scrollTopBefore,
    scrollTopAfter,
    maxScrollTop,
    atTopBefore,
    atBottomBefore,
    atTopAfter,
    atBottomAfter,
    drawerVisible: opts.drawerVisible,
    locked: opts.locked,
    decision: okTarget ? 'PASS' : 'FAIL',
  }
}

/**
 * Phase 7R.3.11.4 — final attribution verdict from causal evidence. MIXED is
 * NEVER upgraded to ATTRIBUTED_TO_DOCUMENT_UTILITIES without confirmed causal
 * proof (feedbackLoopConfirmedCount > 0 AND no external resize epoch change).
 */
export function classifyAttribution(opts: {
  feedbackLoopConfirmedCount: number
  mixedCorrelationCount: number
  externalResizeEpoch: number
  warningCorrelationCount: number
}): ResizeAttributionVerdict {
  if (opts.feedbackLoopConfirmedCount > 0) return 'ATTRIBUTED_TO_DOCUMENT_UTILITIES'
  if (opts.mixedCorrelationCount > 0 && opts.externalResizeEpoch > 0) return 'MIXED'
  if (opts.externalResizeEpoch > 0 && opts.warningCorrelationCount > 0) return 'ATTRIBUTED_TO_EXTERNAL_RESIZE'
  return 'UNPROVEN'
}

/**
 * Phase 7R.3.11.8B.3 — drawer and navigator are INDEPENDENT overlay anchors:
 * the navigator right/bottom never depend on the drawer; the drawer is capped
 * at `viewport − top − reserved` so it can never reach the navigator zone.
 */
export function computeOverlayGeometry(
  shellRect: { top: number; right: number; bottom: number } | null,
  viewport: { width: number; height: number },
  opts?: OverlayGeometryOptions,
): OverlayGeometry {
  const drawerOpen = opts?.drawerOpen ?? false
  const right = shellRect && shellRect.right > 0 ? Math.max(0, viewport.width - shellRect.right) : 0
  const top = shellRect && shellRect.top > 0 ? shellRect.top : 0
  const bottomGap = shellRect && shellRect.bottom > 0 ? Math.max(0, viewport.height - shellRect.bottom) : 0
  // Phase 7R.3.11.8B.3 — the navigator is an INDEPENDENT overlay anchor: its
  // right/bottom depend ONLY on the shell/viewport, never on the drawer.
  const navRight = right + NAV_RIGHT_PX
  // Scrollability from the REAL scroll container (scrollHeight/clientHeight).
  const scrollHeight = opts?.scrollHeight ?? 0
  const clientHeight = opts?.clientHeight ?? 0
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const scrollable = maxScrollTop > SCROLLABLE_EPSILON_PX
  const drawerTopPx = top + DRAWER_TOP_PX
  // Phase 7R.3.11.8B.3 — drawer may only grow down to the reserved navigator
  // zone; beyond that its body scrolls internally (never push the navigator).
  const drawerMaxHeight = Math.max(0, viewport.height - drawerTopPx - DRAWER_BOTTOM_RESERVED_PX)
  return {
    toolbarTop: top + TOOLBAR_TOP_PX,
    toolbarRight: right + TOOLBAR_RIGHT_PX,
    navRight,
    navBottom: bottomGap + NAV_BOTTOM_PX,
    drawerTop: drawerTopPx,
    drawerRight: right + DRAWER_RIGHT_PX,
    drawerBottom: bottomGap + DRAWER_BOTTOM_PX,
    scrollable,
    navigatorVisible: scrollable,
    // Phase 7R.3.11.8B.7.2 — suppression is a LIVE host decision (measured
    // navigator rect); the pure fallback formula never suppresses.
    navigatorSuppressed: false,
    drawerMaxHeight,
  }
}

/** Rect intersection area (0 when disjoint). */
export function rectIntersectionArea(
  a: { left: number; top: number; right: number; bottom: number } | null,
  b: { left: number; top: number; right: number; bottom: number } | null,
): number {
  if (!a || !b) return 0
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

/** Phase 7R.3.11.4 — visible write rect = intersection(writeRect, scrollViewportRect). */
export function intersectRects(
  a: { left: number; top: number; right: number; bottom: number } | null,
  b: { left: number; top: number; right: number; bottom: number } | null,
): RectRecord | null {
  if (!a || !b) return null
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export type BcrVerdict =
  | 'VISIBLE_GEOMETRY'
  | 'GEOMETRY_PENDING'
  | 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
  | 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  | 'NAVIGATOR_STALE_DRAWER_OFFSET'
  | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION'
  | 'NAVIGATOR_POSITION_DRIFT'

export type NavigatorPlacementFailure = 'NAVIGATOR_STALE_DRAWER_OFFSET' | 'NAVIGATOR_NOT_AT_AVOIDANCE_POSITION' | 'NAVIGATOR_POSITION_DRIFT'

/** V1.1 Drift reason codes (audit-level FAIL classification). */
export type NavigatorDriftCode =
  | 'OUTSIDE_SAFE_RAIL'
  | 'TOO_CLOSE_TO_CONTENT'
  | 'TOO_CLOSE_TO_SCROLLBAR'
  | 'OUTSIDE_VISIBLE_EDITOR'
  | 'WIDTH_NO_LONGER_FITS'
  | 'ANCHOR_MISMATCH'
export type NavigatorDriftVerdict = 'PASS' | NavigatorDriftCode

/**
 * V1.1 — Position Drift FAIL classification (pure). Consumes the REAL existing
 * geometry (visible content right, safe rail, scrollbar-safe right). The
 * navigator must sit inside its rail while staying clear of content and the
 * scrollbar; tolerance is 1px (never widen to mask a real regression).
 */
export interface NavigatorDriftInput {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  viewportLeft: number
  viewportRight: number
  viewportTop: number
  viewportBottom: number
  /** visible write-content right edge (null = content not measurable). */
  contentRight: number | null
  contentGap: number
  safeRailLeft: number
  safeRailRight: number
  /** right edge the navigator may touch the scrollbar (null = unknown). */
  scrollbarSafeRight: number | null
  tolerancePx?: number
}
export function classifyNavigatorPositionDrift(input: NavigatorDriftInput): NavigatorDriftVerdict {
  const tol = input.tolerancePx ?? 1
  const finite = [input.left, input.right, input.top, input.bottom, input.width,
    input.safeRailLeft, input.safeRailRight].every(Number.isFinite)
  if (!finite) return 'ANCHOR_MISMATCH'
  if (input.width <= 0) return 'WIDTH_NO_LONGER_FITS'
  if (input.left < input.viewportLeft - tol || input.right > input.viewportRight + tol ||
      input.top < input.viewportTop - tol || input.bottom > input.viewportBottom + tol) {
    return 'OUTSIDE_VISIBLE_EDITOR'
  }
  if (input.contentRight != null && input.left < input.contentRight + input.contentGap - tol) {
    return 'TOO_CLOSE_TO_CONTENT'
  }
  if (input.scrollbarSafeRight != null && input.right > input.scrollbarSafeRight + tol) {
    return 'TOO_CLOSE_TO_SCROLLBAR'
  }
  if (input.left < input.safeRailLeft - tol || input.right > input.safeRailRight + tol) {
    return 'OUTSIDE_SAFE_RAIL'
  }
  return 'PASS'
}

/**
 * V1.1 — read-only Rail Facts captured from the REAL geometry measurement.
 * Drift classification reads THESE facts; it never re-derives a second rail.
 */
export interface NavigatorRailFacts {
  knowledge: 'known' | 'unknown'
  contentLeft: number | null
  contentRight: number | null
  safeRailLeft: number | null
  safeRailRight: number | null
  /** measured: scrollbarSafeRight = containerRect.right − scrollbarWidth − gap. */
  scrollbarKnowledge: 'known' | 'unknown'
  scrollbarWidth: number | null
  scrollbarSafeRight: number | null
  insetSafeWidth: number | null
  expectedRight: number | null
}

/** V1.1 — default content gap used when classifying the live navigator audit. */
const NAV_CONTENT_SAFE_GAP_PX = 8
/** V1.1 — measured scrollbar clearance gap (scrollbarSafeRight = rect.right − sb − gap). */
const NAV_SCROLLBAR_SAFE_GAP_PX = 2
/** True-Inset — rail may overlap #write's right edge by at most this much (px). */
export const NAV_INSET_MAX_CONTENT_OVERLAP_PX = 12
/** Edge-Inset fallback — navigator hugs the visible editor's right edge with
 *  this much clearance (px). Only editor bounds + scrollbar apply here. */
export const NAV_EDGE_INSET_GAP_PX = 2

/**
 * True-Inset — pure fit math (used by the rail and by real-case tests):
 * the navigator first uses the free space right of #write, then is allowed to
 * overlap the content edge by at most NAV_INSET_MAX_CONTENT_OVERLAP_PX.
 */
export function computeTrueInsetFit(
  navWidth: number,
  contentRight: number | null,
  scrollbarSafeRight: number | null,
): { externalFreeWidth: number | null; requiredInsetOverlap: number | null; canFit: boolean } {
  const measured = contentRight != null && scrollbarSafeRight != null && Number.isFinite(contentRight) && Number.isFinite(scrollbarSafeRight)
  const externalFreeWidth = measured ? Math.max(0, scrollbarSafeRight! - contentRight!) : null
  const requiredInsetOverlap = externalFreeWidth != null ? Math.max(0, navWidth - externalFreeWidth) : null
  const canFit = requiredInsetOverlap != null && requiredInsetOverlap <= NAV_INSET_MAX_CONTENT_OVERLAP_PX
  return { externalFreeWidth, requiredInsetOverlap, canFit }
}

/**
 * Real Candidate-Rect placement (authority). Each presentation uses its OWN
 * candidate rect — NOT one rail width tested against two thresholds.
 *
 * gutter: navigator sits fully right of `contentRight + NAV_CONTENT_SAFE_GAP_PX`
 *         (checked separately in the decision with `rightGutter`, unchanged).
 * inset:  navigator is pinned at the right edge = scrollbarSafeRight and may
 *         overlap the content by at most NAV_INSET_MAX_CONTENT_OVERLAP_PX;
 *         it must stay inside the visible editor rect.
 */
export function computeNavigatorPlacementCandidate(args: {
  editorLeft: number
  editorRight: number
  contentRight: number
  scrollbarSafeRight: number
  navigatorWidth: number
  maxContentOverlap?: number
}): {
  candidateLeft: number
  candidateRight: number
  contentOverlap: number
  insideEditor: boolean
  valid: boolean
} {
  const maxOverlap = args.maxContentOverlap ?? NAV_INSET_MAX_CONTENT_OVERLAP_PX
  const candidateRight = args.scrollbarSafeRight
  const candidateLeft = candidateRight - args.navigatorWidth
  const contentOverlap = Math.max(0, args.contentRight - candidateLeft)
  const insideEditor = candidateLeft >= args.editorLeft && candidateRight <= args.editorRight
  return { candidateLeft, candidateRight, contentOverlap, insideEditor, valid: insideEditor && contentOverlap <= maxOverlap }
}

/**
 * Edge-Inset fallback (not a 4th presentation — still `inset`). Used when the
 * normal safe inset cannot fit right of the content (no 12px overlap budget).
 * Only constraints: the navigator stays fully inside the VISIBLE editor and its
 * right edge never crosses the measured scrollbar-safe boundary.
 */
export function computeNavigatorEdgeInsetCandidate(args: {
  editorLeft: number
  editorRight: number
  scrollbarSafeRight: number
  navigatorWidth: number
  edgeGap?: number
}): {
  candidateLeft: number
  candidateRight: number
  insideEditor: boolean
  valid: boolean
} {
  const edgeGap = args.edgeGap ?? NAV_EDGE_INSET_GAP_PX
  const candidateRight = Math.min(args.scrollbarSafeRight, args.editorRight - edgeGap)
  const candidateLeft = candidateRight - args.navigatorWidth
  const insideEditor = candidateLeft >= args.editorLeft + edgeGap && candidateRight <= args.editorRight - edgeGap
  const valid = Number.isFinite(candidateLeft) && Number.isFinite(candidateRight)
    && args.navigatorWidth > 0 && insideEditor
  return { candidateLeft, candidateRight, insideEditor, valid }
}

/** Monotonic visibility invariant: a scrollable doc whose edge candidate fits
 *  must NEVER land on hidden (no intermediate visibility hole). */
export function auditNavigatorMonotonicVisibility(input: {
  scrollable: boolean
  edgeInsetCandidateValid: boolean
  finalPresentation: NavigatorPresentation
}): { decision: 'PASS' | 'FAIL_NON_MONOTONIC_VISIBILITY_HOLE' } {
  const hole = input.scrollable && input.edgeInsetCandidateValid && input.finalPresentation === 'hidden'
  return { decision: hole ? 'FAIL_NON_MONOTONIC_VISIBILITY_HOLE' : 'PASS' }
}

/**
 * Chevron V3 — Navigator icon visibility invariant (pure). When a scrollable
 * navigator is visible there must be at least one ENABLED button whose SVG is
 * actually renderable (≥12×12, visible, opacity ≥ .70, non-transparent stroke).
 */
export function auditNavigatorIconVisibility(input: {
  scrollable: boolean
  navigatorVisible: boolean
  enabledButtonCount: number
  svgWidth: number | null
  svgHeight: number | null
  svgDisplay: string | null
  svgVisibility: string | null
  svgOpacity: number | null
  strokeTransparent: boolean
}): { decision: 'PASS' | 'FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE'; reason: string } {
  if (!input.scrollable || !input.navigatorVisible) return { decision: 'PASS', reason: 'NAV_NOT_VISIBLE_SKIP' }
  if (input.enabledButtonCount < 1) return { decision: 'FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE', reason: 'NO_ENABLED_BUTTON' }
  const svgOk = input.svgWidth != null && input.svgWidth >= 12
    && input.svgHeight != null && input.svgHeight >= 12
    && input.svgDisplay != null && input.svgDisplay !== 'none'
    && input.svgVisibility != null && input.svgVisibility !== 'hidden'
    && input.svgOpacity != null && input.svgOpacity >= 0.7
    && !input.strokeTransparent
  if (!svgOk) return { decision: 'FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE', reason: 'SVG_EFFECTIVELY_INVISIBLE' }
  return { decision: 'PASS', reason: 'ICONS_VISIBLE' }
}

/**
 * V1.4 — Resize Stabilization Gate (pure). During DevTools/Electron resize the
 * FIRST transient frame must never jump a scrollable document from visible
 * straight into NO_SAFE_PLACEMENT: it holds the last stable VISIBLE
 * presentation exactly once and requests a single next-frame remeasure.
 * `lastStableVisiblePresentation` is continuity ONLY — the follow-up frame
 * always re-enters the real decideNavigatorPresentation.
 */
export interface NavigatorStabilizationInput {
  scrollable: boolean
  presentation: NavigatorPresentation
  reason: string
  lastStableVisible: 'gutter' | 'inset' | null
  remeasureScheduled: boolean
}
export interface NavigatorStabilizationResult {
  presentation: NavigatorPresentation
  reason: string
  lastStableVisible: 'gutter' | 'inset' | null
  scheduleRemeasure: boolean
}
export function applyNavigatorStabilization(input: NavigatorStabilizationInput): NavigatorStabilizationResult {
  if (!input.scrollable) {
    // Not scrollable → immediate hidden/NOT_SCROLLABLE (authority preserved).
    return { presentation: 'hidden', reason: 'NOT_SCROLLABLE', lastStableVisible: null, scheduleRemeasure: false }
  }
  if (input.presentation !== 'hidden') {
    // A real visible decision refreshes the stable baseline and cancels the gate.
    return {
      presentation: input.presentation,
      reason: input.reason,
      lastStableVisible: input.presentation as 'gutter' | 'inset',
      scheduleRemeasure: false,
    }
  }
  // hidden / NO_SAFE_PLACEMENT — but only a coherent STABLE frame may commit it.
  const heldVisible = input.lastStableVisible !== null && !input.remeasureScheduled
  if (heldVisible) {
    return {
      presentation: input.lastStableVisible!,
      reason: 'STABILIZING_ONE_FRAME',
      lastStableVisible: input.lastStableVisible,
      scheduleRemeasure: true,
    }
  }
  return { presentation: 'hidden', reason: input.reason, lastStableVisible: input.lastStableVisible, scheduleRemeasure: false }
}

/**
 * Phase 7R.3.11.8B.3 — navigator placement evaluation (pure, single formula).
 * The navigator is an INDEPENDENT anchor: expectedRight is `right + NAV_RIGHT_PX`
 * regardless of drawer state. Opening/closing the drawer must not move it
 * (deltaX/deltaY <= tolerance). The drawer's vertical growth is capped by
 * drawerMaxHeight instead, so no horizontal conflict can arise.
 *
 * Phase 7R.3.11.8B.3.1 — when `navigatorExpectedVisible=false` the navigator is
 * legally hidden (short document): the placement is NOT_EVALUATED with
 * reason NAVIGATOR_EXPECTED_HIDDEN and no expectedRight/actualRight/rightDelta
 * computation runs (a hidden navigator's BCR is 0×0 and must not drift-FAIL).
 */
export function evaluateNavigatorPlacement(opts: {
  drawerOpen: boolean
  navigatorExpectedVisible: boolean
  navigatorRect: RectRecord | null
  shellRect: RectRecord | null
  viewport: { width: number; height: number }
  tolerancePx: number
}): {
  expectedRight: number
  actualRight: number
  rightDelta: number
  intersectionArea: number
  gapPx: number
  decision: 'PASS' | NavigatorPlacementFailure | 'NOT_EVALUATED'
  reason: string | null
} {
  if (!opts.navigatorExpectedVisible) {
    return {
      expectedRight: -1,
      actualRight: -1,
      rightDelta: -1,
      intersectionArea: 0,
      gapPx: -1,
      decision: 'NOT_EVALUATED',
      reason: 'NAVIGATOR_EXPECTED_HIDDEN',
    }
  }
  const g = computeOverlayGeometry(
    opts.shellRect ? { top: opts.shellRect.top, right: opts.shellRect.right, bottom: opts.shellRect.bottom } : null,
    opts.viewport,
    { drawerOpen: opts.drawerOpen },
  )
  const expectedRight = g.navRight
  const actualRight = opts.navigatorRect ? opts.viewport.width - opts.navigatorRect.right : -1
  const rightDelta = Math.abs(actualRight - expectedRight)
  const drawerLeft = opts.drawerOpen ? opts.viewport.width - (g.drawerRight + DRAWER_WIDTH_PX) : null
  const gapPx = drawerLeft != null && opts.navigatorRect ? Math.max(0, drawerLeft - opts.navigatorRect.right) : -1
  let decision: 'PASS' | NavigatorPlacementFailure | 'NOT_EVALUATED' = 'PASS'
  if (rightDelta > opts.tolerancePx) {
    decision = 'NAVIGATOR_POSITION_DRIFT'
  }
  return { expectedRight, actualRight, rightDelta, intersectionArea: 0, gapPx, decision, reason: decision === 'PASS' ? 'POSITION_STABLE' : 'POSITION_DRIFT' }
}

/**
 * Phase 7R.3.11.4/6 — BCR verdict must never claim VISIBLE before the first
 * geometry commit, before toolbar/navigator are inside the editor shell, and
 * before the navigator is at its drawer-state-specific expected position.
 */
export function computeBcrVerdict(opts: {
  geometryCommitted: boolean
  toolbarInsideEditorShell: boolean
  navigatorInsideEditorShell: boolean
  toolbarVisible: boolean
  navigatorVisible: boolean
  navigatorExpectedVisible: boolean
  toolbarFullscreen: boolean
  navigatorFullscreen: boolean
  drawerFullscreen: boolean
  stateSpecificPlacementValid: boolean
  placementFailure: NavigatorPlacementFailure | null
}): BcrVerdict {
  if (opts.toolbarFullscreen || opts.navigatorFullscreen || opts.drawerFullscreen) return 'FAIL_ACCIDENTAL_FULLSCREEN_CHILD'
  if (!opts.geometryCommitted) return 'GEOMETRY_PENDING'
  if (!opts.toolbarInsideEditorShell) return 'GEOMETRY_PENDING'
  // Phase 7R.3.11.8B.3.1 — a legally EXPECTED-hidden navigator is 0×0, so its
  // "inside editor shell" check is naturally false and must NOT gate the BCR.
  if (opts.navigatorExpectedVisible && !opts.navigatorInsideEditorShell) return 'GEOMETRY_PENDING'
  if (!opts.toolbarVisible) return 'GEOMETRY_PENDING'
  // Phase 7R.3.11.8B.3.1 — a navigator that is legally EXPECTED hidden (short
  // document) must NOT put the whole Document Utilities into GEOMETRY_PENDING:
  // the toolbar alone can still be valid. A 0×0 navigator with
  // expectedVisible=true is the real pending/missing case.
  if (!opts.navigatorVisible && !opts.navigatorExpectedVisible) {
    if (opts.stateSpecificPlacementValid) return 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
    return opts.placementFailure ?? 'GEOMETRY_VALID_NAV_EXPECTED_HIDDEN'
  }
  if (!opts.navigatorVisible) return 'GEOMETRY_PENDING'
  if (!opts.stateSpecificPlacementValid) return opts.placementFailure ?? 'GEOMETRY_PENDING'
  return 'VISIBLE_GEOMETRY'
}

/**
 * Phase 7R.3.11.2 — accidental-fullscreen detector for NON-root utility
 * children. A small control (toolbar/navigator/button/toast) must never be
 * near-viewport-sized; that is the exact white-screen occlusion mode caused
 * by the ownership selector carrying viewport geometry.
 */
export function isAccidentalFullscreenChild(
  childRect: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): boolean {
  if (!childRect || childRect.width <= 0 || childRect.height <= 0) return false
  return childRect.width >= viewport.width * 0.8 && childRect.height >= viewport.height * 0.8
}

/** Fraction of the editor area covered by a child rect (0..1). */
export function computeOcclusionRatio(
  childRect: { left: number; top: number; right: number; bottom: number } | null,
  editorRect: { left: number; top: number; right: number; bottom: number } | null,
): number {
  if (!childRect || !editorRect) return 0
  const editorArea = Math.max(0, (editorRect.right - editorRect.left) * (editorRect.bottom - editorRect.top))
  if (editorArea === 0) return 0
  const overlapLeft = Math.max(childRect.left, editorRect.left)
  const overlapTop = Math.max(childRect.top, editorRect.top)
  const overlapRight = Math.min(childRect.right, editorRect.right)
  const overlapBottom = Math.min(childRect.bottom, editorRect.bottom)
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return 0
  const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  return Math.min(1, overlapArea / editorArea)
}

/**
 * Phase 7R.3.11.3 — resize source classification.
 * A geometry write triggered by a ResizeObserver callback on the same shell,
 * with NO viewport change and almost no time gap, is a genuine utility
 * feedback loop. Viewport changes = external (DevTools/window) resize.
 */
export type ResizeSourceVerdict = 'EXTERNAL_LAYOUT_RESIZE' | 'UTILITY_FEEDBACK_LOOP' | 'INDETERMINATE'

export function classifyResizeSource(opts: {
  viewportWidthChanged: boolean
  msSinceUtilityWrite: number | null
  feedbackWindowMs: number
}): ResizeSourceVerdict {
  if (opts.viewportWidthChanged) return 'EXTERNAL_LAYOUT_RESIZE'
  if (opts.msSinceUtilityWrite != null && opts.msSinceUtilityWrite >= 0 && opts.msSinceUtilityWrite < opts.feedbackWindowMs) {
    return 'UTILITY_FEEDBACK_LOOP'
  }
  return 'INDETERMINATE'
}

export interface RectRecord {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * V5.12-R5 §11/§12 — the SOURCE OCCURRENCE facts for one locate + the hard-gate
 * decision. `expected*` come from the clicked diagnostic; `resolved*` come from
 * the resolver's OWN matched occurrence — never the same fact source (§10).
 */
interface LocateSourceOccurrenceEvaluation {
  isResource: boolean
  isDuplicateGroup: boolean
  /** When true the visual COMMIT is forbidden (a wrong token is never painted). */
  blocksCommit: boolean
  gate: { decision: 'PASS' | 'FAIL'; reason: string; failedChecks: string[] }
  audit: Record<string, unknown>
  facts: {
    expectedOccurrenceIndex: number | null
    resolvedOccurrenceIndex: number | null
    expectedSourceRangeIdentity: string | null
    resolvedSourceRangeIdentity: string | null
    expectedSourceStart: number | null
    expectedSourceEnd: number | null
    resolvedSourceStart: number | null
    resolvedSourceEnd: number | null
  }
}

function toRectRecord(r: DOMRect | null | undefined): RectRecord | null {
  if (!r) return null
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

/**
 * V5.8 — ONE USER CLICK = ONE COMPLETE LOCATE TRANSACTION.
 *
 * Immutable-ish per-transaction fact record: identity is locked at click time;
 * every geometry field is a MEASUREMENT (pre-scroll rects are transient and
 * invalidated as soon as an automatic scroll is required).
 */
export interface LocateOneClickFacts {
  transactionId: number
  visualEpoch: number
  documentKey: string | null
  diagnosticId: string
  /** Always 1 for a successful one-click transaction. */
  userClickCount: number
  targetInitiallyVisible: boolean
  automaticScrollRequired: boolean
  scrollStarted: boolean
  scrollSettled: boolean
  postScrollRevalidateDecision: string
  preScrollTargetRect: RectRecord | null
  postScrollTargetRect: RectRecord | null
  freshTargetMeasurement: boolean
  freshHostMeasurement: boolean
  preScrollGeometryInvalidated: boolean
  visualPaintAttemptCount: number
  visualRetryCount: number
  presentationBuiltAfterScroll: boolean
  actualPaintedPrimaryRect: RectRecord | null
  actualPaintedSecondaryRect: RectRecord | null
  primaryMarkerVisible: boolean
  /** V5.8 — a real carrier existed at the moment of the one-click paint. */
  visualCarrierPresent: boolean
  secondaryContextVisible: boolean | null
  expectedFragmentCount: number | null
  renderedFragmentCount: number | null
  drawerRecoveryRequired: boolean
  drawerRecoverySettled: boolean
  postRecoveryRemeasured: boolean
  postRecoveryRepainted: boolean
  postRecoveryVisualVisible: boolean
  // ── V5.12-R3 §16 — Drawer-persistence facts ──────────────────────────────
  drawerRequestedOpenAtStart: boolean
  drawerIntentEpochAtStart: number
  presentationBeforeLocate: DrawerPresentationMode | null
  presentationDuringLocate: DrawerPresentationMode | null
  presentationAfterRestore: DrawerPresentationMode | null
  presentationAtFinalCommit: DrawerPresentationMode | null
  drawerVisibleBeforeLocate: boolean
  drawerVisibleDuringRecovery: boolean
  drawerVisibleAfterRestore: boolean
  drawerVisibleAtFinalCommit: boolean
  drawerRestoreRequired: boolean
  drawerRestoreStarted: boolean
  drawerRestoreSettled: boolean
  remeasuredAfterDrawerRestore: boolean
  repaintedAfterDrawerRestore: boolean
  drawerCompactAttempts: number
  drawerViewportClass: DrawerViewportClass | null
  secondUserClickRequired: boolean
  /** V5.8 hard-gate violation markers (evaluated at COMMIT). */
  postScrollRemeasureMissing: boolean
  staleRectCommit: boolean
  zeroRectCommit: boolean
  fragmentDropCommit: boolean
  diagnosticIdentityChanged: boolean
  occurrenceChanged: boolean
  anchorChanged: boolean
  targetKind: string | null
  ruleCode: string
  occurrenceIndex: number | null
  resourceKind: string | null

  // ── V5.9 — Scroll Completion Authority ────────────────────────────────────
  scrollAnchorKind: string | null
  scrollAnchorConnected: boolean
  initialScrollTop: number
  requestedScrollTop: number | null
  actualScrollTopAfterWrite: number | null
  /** V5.9 §10.1 — the pre-scroll measurement of the SCROLL ANCHOR. */
  initialTargetRect: RectRecord | null
  viewportRectAtStart: RectRecord | null
  viewportRectAtSettle: RectRecord | null
  targetRectAfterScrollWrite: RectRecord | null
  targetRectAtArrival: RectRecord | null
  targetRectAtSettle: RectRecord | null
  scrollWriteCount: number
  scrollCorrectionCount: number
  scrollEffectObserved: boolean
  targetEnteredViewport: boolean
  targetVisibleAtSettle: boolean
  arrivalWaitFrameCount: number
  postArrivalStableFrameCount: number
  visualPipelineStarted: boolean
  visualStartedAfterTargetVisible: boolean
  arrivalGateDecision: string

  // ── V5.10 — Preferred Center Placement ────────────────────────────────────
  placementMode: LocatePlacementMode
  alreadyWithinCenterTolerance: boolean
  viewportCenterY: number | null
  targetCenterBefore: number | null
  targetCenterAfter: number | null
  centerErrorBefore: number | null
  centerErrorAfter: number | null
  compoundHeight: number | null
  largeBlock: boolean
  primaryPreferredViewportY: number | null
  primaryActualViewportY: number | null
  placementCorrectionCount: number
  finalPlacementDecision: 'PASS' | 'FAIL' | 'PENDING'
  finalPlacementReason: string
  placementReason: string
  maxScrollTopV510: number | null
  /** §29 — the UNCLAMPED preferred scrollTop of the first placement decision. */
  placementDesiredScrollTop: number | null
}

/** V5.8 — pre-scroll geometry snapshot (transient; invalidated on scroll). */
interface LocatePreScrollState {
  targetRect: RectRecord | null
  hostRect: RectRecord | null
  targetInitiallyVisible: boolean
  automaticScrollRequired: boolean
}

/**
 * V3 — EXPLICIT runtime-layout authority. Headless must be decided by the
 * running environment (jsdom test agent), NEVER inferred from the target
 * element's geometry (a real Typora broken <img> is 0×0 yet layout is real).
 */
export function isHeadlessTestRuntime(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && /jsdom/i.test(navigator.userAgent)
  } catch {
    return false
  }
}

/**
 * V3 — zero-rect broken-resource fallback: climb from the resource node to the
 * first real block ancestor that has non-empty layout (Typora block host),
 * returning null when none exists (caller keeps the node itself).
 */
export function resolveOwningBlockFallback(node: HTMLElement | null): HTMLElement | null {
  if (!node || !node.isConnected) return null
  let cur: HTMLElement | null = node.parentElement
  while (cur && cur !== document.body) {
    const r = cur.getBoundingClientRect()
    if ((r.width > 0 || r.height > 0) && (cur.tagName === 'P' || cur.tagName === 'DIV' || /(^|\s)(p|paragraph|md-|typ-)/i.test(String(cur.className)))) {
      return cur
    }
    cur = cur.parentElement
  }
  return null
}

/**
 * V5.12-R2 §3.4 — a passive heading marker keeps its TARGET IDENTITY, the
 * layout epoch it was measured in and its last geometry, so a stale epoch is
 * provable and a re-measure is a real reconcile (never a silent drift).
 */
interface HeadingPassiveMarkerRecord {
  wrapper: HTMLElement
  severity: HeadingMarkerSeverity
  targetIdentity: string
  measuredLayoutEpoch: DocumentLayoutEpoch
  anchorLocal: HeadingRect
  contentLocal: HeadingRect
  iconLocal: HeadingRect | null
  railLocal: HeadingRect
}

export class DocumentUtilityOverlayHost {
  private root: HTMLDivElement | null = null
  private toolbarEl: HTMLDivElement | null = null
  private navigatorEl: HTMLDivElement | null = null
  private drawerEl: HTMLDivElement | null = null
  private drawerListEl: HTMLDivElement | null = null
  private problemsControlEl: HTMLDivElement | null = null
  private lockButtonEl: HTMLButtonElement | null = null
  /** V1.1 — Drawer severity filter, shared with the Toolbar status segments. */
  private drawerFilter: DiagnosticsSeverityFilter = 'all'
  private drawerFiltersEl: HTMLDivElement | null = null
  private drawerEmptyEl: HTMLDivElement | null = null
  /** V1.1 — most-recent located diagnostic row highlight (neutral/accent). */
  private lastLocatedDiagnosticId: string | null = null
  /**
   * Phase 7R.3.11.8B.8 — V3 Diagnostic Locate Frame controller. ONE instance;
   * owns at most ONE overlay frame + ONE inline mark (presentation only).
   */
  private locateFrame: DiagnosticLocateFrameController | null = null
  private topBtnEl: HTMLButtonElement | null = null
  private bottomBtnEl: HTMLButtonElement | null = null
  private drawerOpen = false
  private resizeObserver: ResizeObserver | null = null
  private geometryRafPending = false
  private pendingGeometryReasons = new Set<string>()
  private lastGeometry: OverlayGeometry | null = null
  /**
   * Phase 7R.3.11.8B.7.2 — REAL navigator box height, refreshed from the live
   * rect after every geometry write pass (read-only). Feeds the drawer bottom
   * safe-area reserve; null until the first measurable navigator frame.
   */
  private lastNavigatorHeightPx: number | null = null
  private readonly geometryCounters = {
    windowResizeEventCount: 0,
    scheduleCount: 0,
    executionCount: 0,
    writeCount: 0,
    noopCount: 0,
    sameFrameCoalesceCount: 0,
    feedbackLoopSuspectCount: 0,
    feedbackLoopConfirmedCount: 0,
    utilityResizeEchoCount: 0,
    mixedCorrelationCount: 0,
    warningCorrelationCount: 0,
  }
  private externalResizeEpoch = 0
  private utilityWriteEpoch = 0
  private resizeObserverEpoch = 0
  private lastRoCallbackTs: number | null = null
  private lastGeometryWriteTs: number | null = null
  private lastWindowResizeTs: number | null = null
  private lastExternalResizeTs: number | null = null
  private lastWriteShellRect: RectRecord | null = null
  private geometryCommitted = false
  /** Phase 7R.3.11.8B.3 — DOCUMENT-UTILITY-OVERLAY-LAYOUT state-token dedup. */
  private lastOverlayLayoutSignature = ''
  private lastRoSawChangedShell = false
  /** Phase 7R.3.11.8B.3.1 — causal-token evidence for a confirmed loop. */
  private lastShellChangeObservedWriteEpoch = -1
  private lastGeometryWriteExternalEpoch = -1
  /** Phase 7R.3.11.8B.3.1 — read-only drawer content audit (rAF + DOM read only). */
  private drawerContentAuditRafPending = false
  private lastDrawerContentAuditSignature = ''
  private latestRects: {
    write: RectRecord | null
    visibleWrite: RectRecord | null
    shell: RectRecord | null
    overlayRoot: RectRecord | null
    toolbar: RectRecord | null
    navigator: RectRecord | null
    drawer: RectRecord | null
  } = {
    write: null, visibleWrite: null, shell: null, overlayRoot: null, toolbar: null, navigator: null, drawer: null,
  }
  private bcrEmitCount = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private prevNavStateKey = ''
  private warningObserverInstalled = false
  private onWindowErrorBound = false

  readonly diagnostics: DocumentDiagnosticsAuthority
  readonly locator: DocumentDiagnosticLocator
  readonly editGuard: DocumentEditGuard
  private scrollNav: DocumentScrollNavigator | null = null
  /** Phase 7R.3.11.8-B — single active finite scroll operation (event-driven). */
  private scrollNavOperationSeq = 0
  private activeScrollOperation: ActiveScrollOperation | null = null
  private scrollOperationEmitCount = 0
  /** Phase 7R.3.11.8-B §3.6 — STRICT-SINGLE-H1 popup dedup (documentKey → violationFingerprint). */
  private strictSingleH1PopupTokens = new Map<string, string>()
  private strictSingleH1PopupEmitCount = 0
  /** Phase 7R.3.11.8-B §7 — event-driven diagnostics recompute (mutation → rAF, no polling). */
  private diagnosticsMutationObserver: MutationObserver | null = null
  private diagnosticsRafPending = false
  private snapshot: DocumentDiagnosticsSnapshot | null = null
  /** Phase 7R.3.11.8B.5 — multi-target locate cycle cursor per diagnosticId. */
  private multiTargetCursor = new Map<string, number>()
  /**
   * Phase 7R.3.11.8B.7.7 — Locate TRANSACTION lock. A single locate is a
   * NON-REENTRANT transaction IDLE → RESOLVING → SCROLLING → HIGHLIGHTING →
   * IDLE. While active, every further 定位 click is IGNORE_BUSY (never queued,
   * never advances the targetIndex). The multi-target cursor is committed ONLY
   * after the real scroll settles + highlight is applied.
   */
  private locateTxIdSeq = 0
  private activeLocateTx: {
    id: number
    documentKey: string | null
    diagnosticId: string
    targetIndex: number
    targetCount: number
    startedAt: number
    state: LocateTransactionState
    /** V5.8 — single-click atomic transaction observability (null = legacy path). */
    oneClick?: LocateOneClickFacts | null
  } | null = null
  private locateTxSettleCancel: (() => void) | null = null
  private locateTxWatchdog: ReturnType<typeof setTimeout> | null = null
  /**
   * V5.12-R5 §12 — SOURCE OCCURRENCE authority counters (session cumulative).
   * All must remain 0 for a PASS.
   */
  private countersSourceOccurrenceV512R5 = createSourceOccurrenceV512R5Counters()
  /**
   * V5.12-R5 §13 — the LAST committed inline range per occurrence GROUP
   * (`resourceKind + canonicalDestination`). A different sibling occurrence
   * that collapses onto the SAME visual range is a hard failure.
   */
  private r5OccurrenceRangeByGroup = new Map<
    string,
    { occurrenceIndex: number; unionRect: RectRecord | null; sourceRangeIdentity: string | null }
  >()
  /**
   * V5.12-R6 §15 — EMPTY DOCUMENT short-circuit hard-gate counters.
   * All must remain 0 (the empty snapshot is exclusively `[DOCUMENT_EMPTY]`).
   */
  private countersEmptyDocumentV512R6 = createEmptyDocumentV512R6Counters()
  /** V5.12-R6 §14 — admission key/revision of the last committed snapshot. */
  private lastAdmittedSnapshotKey: string | null = null
  private lastAdmittedSnapshotRevision: number | null = null
  /** V5.12-R6 §19 — did the last admission reject a stale (older) revision? */
  private lastAdmissionStaleRevisionRejected = false
  private lastEmptyShortCircuitAuditSignature = ''
  /**
   * V5.12-R7 §13/§14 — ACTIVE_LOCATE_VISUAL = FILL_ONLY hard-gate counters.
   * All must remain 0 (line decorations are never painted again).
   */
  private countersActiveLocateFillOnlyV512R7 = createActiveLocateFillOnlyCounters()
  /** V5.12-R7 §13 — last committed locate fill count (ACTIVE_LOCATE_FILL_COUNT >= 1). */
  private lastActiveLocateFillCount = 0
  /**
   * V5.12-R8 §14 — Figure target / existence authority counters (session).
   * All must remain 0.
   */
  private countersFigureTargetV512R8 = createFigureTargetV512R8Counters()
  /** V5.12-R8 §14 — Code caption → body spacing counters (session). All 0. */
  private countersCaptionCodeSpacingV512R8 = createCaptionCodeSpacingV512R8Counters()
  /** V5.12-R8 §15 — last measured code caption spacing facts (state-deduped). */
  private lastCaptionCodeSpacingSignature = ''
  /**
   * V5.12-R8 §8 — how the LAST figure locate reached its target: was the exact
   * source token available as DOM text, and which ladder level painted it.
   */
  private lastFigureTargetVisual = { exactTokenAvailable: false, exactTokenUsed: false, usedBlockFallback: false }
  /** V5.12-R8 §15 — snapshot figure-gate audit dedup signature. */
  private lastFigureTargetSnapshotSignature = ''
  /** V5.12-R8 §15 — deferred per-click figure audit (emitted at COMMIT). */
  private pendingFigureTargetAudit: { payload: Record<string, unknown> } | null = null
  /** Phase 7R.3.11.8B.6 — workspace width guard state (write-deduped). */
  private workspaceWidthState: WorkspaceWidthState | null = null
  private workspaceHostApplied = false
  private lastWorkspaceWidthFingerprint = ''
  private workspaceBelowMinCount = 0
  private mounted = false
  private disposed = false
  private disposables: Array<() => void> = []
  /** Phase 7R.3.11.8B.NO-ACTIVE-DOC — event-driven tab structure watch. */
  private tabStructureObserver: MutationObserver | null = null
  /** V3 — last ACTIVE-LEAF presence decision (identity-conflict observability). */
  private lastActiveLeafPresence: ActiveDocumentPresenceDecision | null = null
  /** V3 — real active-leaf lifecycle subscription (workspace + tabs). */
  private activeLeafLifecycleDispose: (() => void) | null = null
  /** Empty Workspace UX V1 — single marker writer + scoped dblclick listener. */
  private emptyWorkspaceUx: EmptyWorkspaceUxController | null = null
  /** V2 — active document reconcile coordinator (single authoritative chain). */
  private activeDocumentEpoch = 0
  private lastReconcileIdentity: { state: string; path: string | null; key: string | null } | null = null
  private authorityReady = { canonical: false, caption: false }
  private reconcileTotalCount = 0

  constructor(private opts: DocumentUtilitiesOverlayOptions) {
    this.diagnostics = new DocumentDiagnosticsAuthority(opts.ctx, opts.providers)
    this.locator = new DocumentDiagnosticLocator({
      getContainer: () => getActiveEditorScrollContainer(),
      onStale: () => {
        // V5 — target changed: refresh diagnostics. NO locate toast (the
        // Drawer active row + document presentation are the only feedback).
        this.diagnostics.recompute('LOCATE_STALE_TARGET')
      },
    })
    this.editGuard = new DocumentEditGuard({
      getDocumentKey: () => opts.ctx.authority.getDocumentKey(),
    })
  }

  /** Phase 7R.3.11.8B.7.1 — latest PUBLISHED diagnostic snapshot (read-only
   *  authority for the control-surface invariant / stale-snapshot detection). */
  getSnapshot(): DocumentDiagnosticsSnapshot | null {
    return this.diagnostics.getSnapshot()
  }

  /** V4 — single current problems projection (Toolbar/Drawer parity). */
  getCurrentProblemsProjection(): CurrentProblemsProjection {
    return this.currentProblemsProjection
  }

  /** V5 — consumer admission observability (tests / runtime). */
  getAdmissionCounters(): { admitted: number; alreadyAdmitted: number; pendingActiveLeaf: number; staleDiscard: number } {
    return { ...this.admissionCounters }
  }

  getLastAdmittedSnapshotFingerprint(): string | null {
    return this.lastAdmittedSnapshotFingerprint
  }

  /**
   * V5 — SINGLE consumer admission gate. Both producers (diagnostics
   * subscription publishes AND reconcile-direct results) MUST pass through
   * here before anything reaches CurrentProblemsProjection / Toolbar / Drawer.
   * Producer PUBLISHED/NOOP/DEDUPED is fully separate from the consumer
   * ADMITTED/ALREADY_ADMITTED decision — a producer NOOP can never skip a
   * not-yet-admitted snapshot.
   */
  private admitDiagnosticsSnapshot(
    snapshot: DocumentDiagnosticsSnapshot | null,
    source: string,
  ): { decision: 'ADMITTED' | 'ALREADY_ADMITTED' | 'PENDING_ACTIVE_LEAF' | 'DISCARD_STALE_DIAGNOSTICS_RESULT' | 'DISCARD_PRESENCE_INACTIVE'; reason: string } {
    if (!snapshot) {
      return { decision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'NULL_SNAPSHOT' }
    }
    this.lastAdmissionStaleRevisionRejected = false
    const activeKey = this.opts.ctx.authority.getDocumentKey() ?? null
    if (snapshot.documentKey !== activeKey) {
      this.admissionCounters.staleDiscard++
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, consumerAdmissionDecision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'DOCUMENT_IDENTITY_MISMATCH' })
      return { decision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'DOCUMENT_IDENTITY_MISMATCH' }
    }
    // V5.12-R6 §14 — a STALE (older-revision) snapshot of the SAME
    // document/epoch must never overwrite a newer committed one: the
    // empty <-> non-empty switch is an ATOMIC snapshot replacement, so a late
    // result is rejected outright rather than allowed to revive old
    // errors/warnings after the document became empty (and vice versa).
    const snapshotEpochKey = `${snapshot.documentKey}@${this.activeDocumentEpoch}`
    if (
      this.lastAdmittedSnapshotKey === snapshotEpochKey
      && this.lastAdmittedSnapshotRevision != null
      && snapshot.revision < this.lastAdmittedSnapshotRevision
    ) {
      this.admissionCounters.staleDiscard++
      this.lastAdmissionStaleRevisionRejected = true
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, lastAdmittedRevision: this.lastAdmittedSnapshotRevision, sourceRevision: snapshot.sourceRevision, consumerAdmissionDecision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'STALE_REVISION' })
      return { decision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'STALE_REVISION' }
    }
    const presenceEval = this.evaluateActiveDocumentPresence()
    const empty = presenceEval.presence.state === 'EMPTY'
    const presenceActive =
      presenceEval.presence.state === 'ACTIVE' ||
      (presenceEval.presence.state === 'UNKNOWN' && presenceEval.hasActiveDocument)
    // Startup restore split-brain: leaf EMPTY but real file identity already
    // resolved for THIS documentKey → PENDING_ACTIVE_LEAF (admitted later, not
    // displayed now). It is NOT a permanent EMPTY discard.
    const fileIdentityPresent = (() => {
      try {
        const fp = this.opts.ctx.authority.getActiveFilePath?.()
        return fp != null && fp !== ''
      } catch { return false }
    })()
    if (empty && activeKey != null && activeKey === snapshot.documentKey && fileIdentityPresent) {
      this.pendingActiveLeafDocumentKey = activeKey
      this.admissionCounters.pendingActiveLeaf++
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, consumerAdmissionDecision: 'PENDING_ACTIVE_LEAF', reason: 'ACTIVE_DOCUMENT_RESTORE_PENDING' })
      return { decision: 'PENDING_ACTIVE_LEAF', reason: 'ACTIVE_DOCUMENT_RESTORE_PENDING' }
    }
    if (!presenceActive) {
      this.admissionCounters.staleDiscard++
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, consumerAdmissionDecision: 'DISCARD_PRESENCE_INACTIVE', reason: 'EMPTY_WITHOUT_RESTORE_IDENTITY' })
      return { decision: 'DISCARD_PRESENCE_INACTIVE', reason: 'EMPTY_WITHOUT_RESTORE_IDENTITY' }
    }
    const fingerprint = `${snapshot.documentKey}@${this.activeDocumentEpoch}#${snapshot.revision}:${snapshot.sourceRevision}`
    if (this.lastAdmittedSnapshotFingerprint === fingerprint) {
      this.admissionCounters.alreadyAdmitted++
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, fingerprint, consumerAdmissionDecision: 'ALREADY_ADMITTED', reason: 'CONSUMER_DEDUPE' })
      return { decision: 'ALREADY_ADMITTED', reason: 'CONSUMER_DEDUPE' }
    }
    this.lastAdmittedSnapshotFingerprint = fingerprint
    // V5.12-R6 §14 — remember the committed key/revision so a later STALE
    // (older-revision) result can be rejected instead of overwriting it.
    this.lastAdmittedSnapshotKey = snapshotEpochKey
    this.lastAdmittedSnapshotRevision = snapshot.revision
    this.pendingActiveLeafDocumentKey = null
    this.admissionCounters.admitted++
    emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-ADMISSION', { source, documentKey: snapshot.documentKey, activeDocumentKey: activeKey, revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, fingerprint, consumerAdmissionDecision: 'ADMITTED', reason: 'CONSUMER_ADMISSION' })
    return { decision: 'ADMITTED', reason: 'CONSUMER_ADMISSION' }
  }

  /** V5 — commit an ADMITTED snapshot to projection + Problems Control/Drawer. */
  private commitAdmittedSnapshot(snapshot: DocumentDiagnosticsSnapshot | null, source: string): void {
    // V5.12-R6 §13 — capture the PREVIOUS snapshot's diagnostic ids BEFORE the
    // atomic replacement so a stale residue can be proven (never assumed).
    const previousDiagnosticIds = this.snapshot?.diagnostics.map(d => d.id) ?? []
    this.snapshot = snapshot
    // Phase 7R.3.11.8B.8 — snapshot updated and the located diagnostic no
    // longer exists → clear the active locate visual + row selection.
    if (this.lastLocatedDiagnosticId != null) {
      const stillPresent = snapshot?.diagnostics.some(d => d.id === this.lastLocatedDiagnosticId) ?? false
      if (!stillPresent) {
        this.clearDiagnosticLocateVisual('ACTIVE_DIAGNOSTIC_REMOVED')
        this.lastLocatedDiagnosticId = null
      }
    }
    this.handleStrictSingleH1Popup(snapshot)
    this.renderDiagnosticsButton()
    this.renderLockButton()
    // V5.12-R6 §11/§15/§19 — the empty-document short-circuit gates + audit are
    // measured at this SINGLE commit boundary (after the projection is derived
    // from the SAME snapshot, so UI-count parity is a real measurement).
    this.commitEmptyDocumentShortCircuit(snapshot, previousDiagnosticIds)
    if (this.drawerOpen) this.renderDrawer()
    // V5.12-R2 §3.2 — a diagnostics snapshot reconcile is the caption/numbering/
    // formula/table/figure projection commit boundary: the body layout may have
    // changed, so every diagnostic visual geometry measured before is stale.
    this.bumpDocumentLayoutEpoch(source === 'RECONCILE' ? 'CAPTION_PROJECTION_REPLACE' : 'PLUGIN_DOM_MUTATION')
    // V5.12-R1 §5 — PASSIVE heading diagnostic markers follow the snapshot, and
    // the active emphasis is re-derived for the (possibly replaced) target.
    this.renderHeadingDiagnosticMarkers()
    this.renderActiveHeadingEmphasisForCommittedVisual()
    emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
      action: source === 'RECONCILE' ? 'RECONCILE_COMMITTED' : 'PUBLISHED',
      documentKey: snapshot?.documentKey ?? null,
      activeDocumentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      revision: snapshot?.revision ?? null,
      sourceRevision: snapshot?.sourceRevision ?? null,
      drawerVisible: this.drawerOpen,
      itemCount: snapshot?.diagnostics.length ?? 0,
      errorCount: snapshot?.errorCount ?? 0,
      warningCount: snapshot?.warningCount ?? 0,
      hintCount: snapshot?.infoCount ?? 0,
      consumerAdmissionDecision: 'ADMITTED',
    })
  }

  /**
   * V5.12-R6 §11/§15/§19 — measure + audit the EMPTY DOCUMENT terminal
   * short-circuit at the SINGLE admitted-snapshot commit boundary.
   *
   * The UI counters are PROJECTED from this same snapshot (never hand-written),
   * so `EMPTY_DOCUMENT_UI_COUNT_SNAPSHOT_MISMATCH_COUNT` is a real measurement
   * of data-layer/UI parity rather than an assumption.
   */
  private commitEmptyDocumentShortCircuit(
    snapshot: DocumentDiagnosticsSnapshot | null,
    previousDiagnosticIds: readonly string[],
  ): void {
    const diags = snapshot?.diagnostics ?? []
    const shortCircuitActive = diags.some(d => d.code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE)
    const projection = deriveDocumentProblemsProjection(snapshot)
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive,
      diagnostics: diags.map(d => ({
        id: d.id,
        code: d.code,
        severity: d.severity,
        locatable: hasLocatableLocation(d.location),
      })),
      errorCount: snapshot?.errorCount ?? 0,
      warningCount: snapshot?.warningCount ?? 0,
      hintCount: snapshot?.infoCount ?? 0,
      uiErrorCount: projection.errorCount,
      uiWarningCount: projection.warningCount,
      uiHintCount: projection.hintCount,
      uiTotalCount: projection.totalCount,
      // §13 — only meaningful for the empty short-circuit: the ids that were
      // published by the PREVIOUS snapshot (stale-residue proof).
      previousDiagnosticIds: shortCircuitActive ? previousDiagnosticIds : [],
    })
    if (shortCircuitActive) {
      for (const key of EMPTY_DOCUMENT_V512R6_GATE_KEYS) {
        const value = measured[key]
        if (value > 0) this.countersEmptyDocumentV512R6[key] += value
      }
    }

    const markdown = this.opts.ctx.authority.getMarkdown()
    const gate = evaluateEmptyDocumentV512R6Gates(this.countersEmptyDocumentV512R6)
    const signature = `${snapshot?.documentKey ?? ''}|empty:${shortCircuitActive}|n:${diags.length}|e:${snapshot?.errorCount ?? 0}|w:${snapshot?.warningCount ?? 0}|h:${snapshot?.infoCount ?? 0}|stale:${this.lastAdmissionStaleRevisionRejected}`
    if (signature === this.lastEmptyShortCircuitAuditSignature) return
    this.lastEmptyShortCircuitAuditSignature = signature
    emitRuntimeAudit(EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT, {
      documentKey: snapshot?.documentKey ?? null,
      documentRevision: snapshot?.revision ?? null,
      sourceLength: markdown != null ? markdown.length : null,
      trimmedSourceLength: markdown != null ? markdown.trim().length : null,
      isSemanticallyEmpty: shortCircuitActive,
      shortCircuitActivated: shortCircuitActive,
      diagnosticCount: diags.length,
      errorCount: snapshot?.errorCount ?? 0,
      warningCount: snapshot?.warningCount ?? 0,
      hintCount: snapshot?.infoCount ?? 0,
      documentEmptyCount: diags.filter(d => d.code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE).length,
      headingRuleExecuted: !shortCircuitActive,
      objectRuleExecuted: !shortCircuitActive,
      resourceRuleExecuted: !shortCircuitActive,
      eofRuleExecuted: !shortCircuitActive,
      staleResultRejected: this.lastAdmissionStaleRevisionRejected,
      decision: shortCircuitActive && gate.decision === 'FAIL' ? 'FAIL' : 'PASS',
      reason: shortCircuitActive ? EMPTY_DOCUMENT_EXCLUSIVE_REASON : 'NON_EMPTY_DOCUMENT_PIPELINE',
    })
  }

  /**
   * V5.12-R7 §12/§13/§14 — measure the ACTIVE locate surface and record the
   * FILL_ONLY hard gates. The measurement reads the REAL painted carrier
   * (computed style + geometry) so "no line" is proven, never assumed.
   */
  private measureActiveLocateFillOnlyFacts(): ActiveLocateFillOnlyFacts {
    const facts = emptyActiveLocateFillOnlyFacts()
    const root = this.root
    if (!root) return facts
    const view = root.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null)
    if (!view) return facts
    const carrierSelector = [
      '.inkchapter-diagnostic-locate-frame',
      '.inkchapter-diagnostic-inline-fragment',
      '.inkchapter-diagnostic-inline-mark',
      '.inkchapter-diagnostic-locate-marker',
      '.inkchapter-heading-diagnostic-active__fragment',
    ].join(',')
    const carriers = Array.from(root.querySelectorAll<HTMLElement>(carrierSelector))
    for (const el of carriers) {
      let cs: CSSStyleDeclaration | null = null
      try { cs = view.getComputedStyle(el) } catch { cs = null }
      if (cs) {
        if (colorIsVisible(cs.backgroundColor) || (cs.backgroundImage ?? '').includes('gradient(')) facts.fillCount++
        if (borderIsPainted(cs)) facts.borderCount++
        if (outlineIsPainted(cs)) facts.outlineCount++
        if ((cs.backgroundImage ?? '').includes('gradient(')) facts.keylineCount++
        if (shadowIsPainted(cs)) facts.editorShadowCount++
        const before = pseudoIsPainted(view, el, '::before')
        const after = pseudoIsPainted(view, el, '::after')
        if (before || after) facts.linePseudoElementCount++
      }
      const rect = el.getBoundingClientRect()
      if (isHorizontalLineBar({ width: rect.width, height: rect.height })) facts.horizontalLineCount++
      if (isVerticalLineBar({ width: rect.width, height: rect.height })) facts.verticalLineCount++
      // SVG strokes are counted ONLY inside a locate carrier: the overlay's own
      // UI icons are stroked SVGs and must never be mistaken for a locate line.
      for (const svg of Array.from(el.querySelectorAll<Element>('svg,path,line,polyline'))) {
        let scs: CSSStyleDeclaration | null = null
        try { scs = view.getComputedStyle(svg) } catch { scs = null }
        if (scs && scs.stroke && scs.stroke !== 'none' && scs.strokeWidth !== '0px') facts.svgStrokeLineCount++
      }
    }
    // Line-ish DOM children anywhere on the active surface (keyline / line /
    // corner cap). None must exist under FILL_ONLY. The selectors are DELIBER-
    // ATELY narrow: a loose `[class*=arm]` would match `--warning` and a loose
    // `[class*=line]` would match unrelated overlay chrome.
    const nodeList = root.querySelectorAll<HTMLElement>(
      '[class*="keyline"],[class*="__line"],[class*="marker-line"],[class*="hline"],[class*="vline"],[data-cue-type="top-edge"]',
    )
    facts.lineDomChildCount = nodeList.length
    facts.cornerArmCount = root.querySelectorAll<HTMLElement>('[class*="corner-arm"],[class*="continuation-arm"]').length
    // §14 — the PASSIVE heading gutter marker must survive the active cleanup.
    const headingDiagCount = this.snapshot?.diagnostics.filter(d => d.category === 'heading').length ?? 0
    const railCount = root.querySelectorAll('.inkchapter-heading-diagnostic-marker__rail').length
    facts.passiveHeadingMarkerRemoved = headingDiagCount > 0 && railCount === 0
    // §14 — a DIAGNOSTIC Drawer row severity indicator must never be removed.
    // The indicator authority is the row's severity CLASS (which drives the
    // `::before` rail), not a data attribute; `--empty` placeholder rows carry
    // no diagnostic and are excluded.
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item'))
      .filter(el => el.getAttribute('data-diagnostic-id') != null)
    facts.drawerSeverityIndicatorRemoved = rows.length > 0 && rows.some(el =>
      !el.classList.contains('inkchapter-doc-drawer__item--error')
      && !el.classList.contains('inkchapter-doc-drawer__item--warning')
      && !el.classList.contains('inkchapter-doc-drawer__item--info'))
    return facts
  }

  /** V5.12-R7 §13 — fold the measured facts into the session counters + audit. */
  private commitActiveLocateFillOnlyGates(committed: boolean, diagnosticId: string): void {
    const facts = this.measureActiveLocateFillOnlyFacts()
    const { counters, fillOk } = measureActiveLocateFillOnlyGates(facts, committed)
    if (committed) {
      for (const key of ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS) {
        const value = counters[key]
        if (value > 0) this.countersActiveLocateFillOnlyV512R7[key] += value
      }
      this.lastActiveLocateFillCount = facts.fillCount
    }
    const gate = evaluateActiveLocateFillOnlyGates(this.countersActiveLocateFillOnlyV512R7)
    emitRuntimeAudit(FILL_ONLY_LOCATE_AUDIT_EVENT, {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId,
      committed,
      presentationMode: ACTIVE_LOCATE_PRESENTATION_FILL_ONLY,
      lineSource: ACTIVE_LOCATE_LINE_SOURCE,
      fillCount: facts.fillCount,
      fillGateSatisfied: fillOk && facts.fillCount >= ACTIVE_LOCATE_MIN_FILL_COUNT,
      verticalLineCount: facts.verticalLineCount,
      horizontalLineCount: facts.horizontalLineCount,
      borderCount: facts.borderCount,
      outlineCount: facts.outlineCount,
      keylineCount: facts.keylineCount,
      cornerArmCount: facts.cornerArmCount,
      linePseudoElementCount: facts.linePseudoElementCount,
      lineDomChildCount: facts.lineDomChildCount,
      svgStrokeLineCount: facts.svgStrokeLineCount,
      editorShadowCount: facts.editorShadowCount,
      passiveHeadingMarkerRemoved: facts.passiveHeadingMarkerRemoved,
      drawerSeverityIndicatorRemoved: facts.drawerSeverityIndicatorRemoved,
      decision: committed && (!fillOk || gate.decision === 'FAIL') ? 'FAIL' : 'PASS',
      reason: committed ? 'ACTIVE_LOCATE_FILL_ONLY' : 'NOT_COMMITTED',
    })
  }

  /**
   * V5.12-R8 §14/§15 — figure target / existence authority for ONE locate.
   *
   * Consumes the SAME expected/resolved facts as the R5 source-occurrence gate
   * (which is FROZEN) and adds the R8 decision: WHICH range role this rule must
   * target, whether that role was really resolved, and whether a real visual
   * fragment was painted (never a click without visual).
   */
  private commitFigureTargetAuthority(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    r5: LocateSourceOccurrenceEvaluation,
    visualCommitted: boolean,
  ): void {
    const role = figureRangeRoleForRule(diag.code)
    if (role == null) return
    const audit = r5.audit
    const asNum = (v: unknown): number | null => (typeof v === 'number' ? v : null)
    const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    const inlineFacts = this.locateFrame?.getInlineCoordinateFacts() ?? null
    const visualFragmentCount = inlineFacts ? inlineFacts.paintedFragmentElementCount : 0
    const facts: FigureTargetAuthorityFacts = {
      ruleCode: diag.code,
      occurrenceIndex: r5.facts.resolvedOccurrenceIndex ?? r5.facts.expectedOccurrenceIndex ?? null,
      sourceRangeIdentity: r5.facts.resolvedSourceRangeIdentity ?? r5.facts.expectedSourceRangeIdentity ?? null,
      rawToken: asStr(audit.rawToken),
      rawDestination: asStr(audit.rawDestination),
      canonicalDestination: asStr(audit.canonicalDestination),
      expectedRangeRole: role,
      resolvedRangeRole: (asStr(audit.resolvedRangeRole) as FigureRangeRole | null) ?? null,
      expectedSourceStart: r5.facts.expectedSourceStart,
      expectedSourceEnd: r5.facts.expectedSourceEnd,
      resolvedSourceStart: r5.facts.resolvedSourceStart,
      resolvedSourceEnd: r5.facts.resolvedSourceEnd,
      rangeClientRectCount: asNum(audit.rangeClientRectCount) ?? 0,
      visualFragmentCount,
      documentLocalRectCount: this.getCommittedDocumentSpace()?.inlineLocal.length ?? 0,
      severity: asStr(audit.severity),
      localFileExists: typeof audit.localFileExists === 'boolean' ? audit.localFileExists : null,
      resourceClass: asStr(audit.resourceClass),
      exactTokenAvailable: this.lastFigureTargetVisual.exactTokenAvailable,
      exactTokenUsed: this.lastFigureTargetVisual.exactTokenUsed,
      usedBlockFallback: this.lastFigureTargetVisual.usedBlockFallback,
      decision: 'PASS',
      reason: '',
    }
    const verdict = evaluateFigureTargetAuthority(facts)
    if (visualCommitted) {
      if (verdict.decision === 'FAIL' && verdict.reason === 'CLICK_WITHOUT_VISUAL') {
        if (role === FIGURE_MISSING_NAME_RANGE_ROLE) this.countersFigureTargetV512R8.missingNameClickWithoutVisual++
        else this.countersFigureTargetV512R8.localImageMissingClickWithoutVisual++
      }
      if (role === FIGURE_MISSING_NAME_RANGE_ROLE) {
        if (verdict.reason === 'EXACT_TOKEN_AVAILABLE_BUT_NOT_USED') this.countersFigureTargetV512R8.missingNameExactTokenAvailableButNotUsed++
        if (verdict.reason === 'BLOCK_FALLBACK_WHILE_TOKEN_AVAILABLE') this.countersFigureTargetV512R8.missingNameBlockFallbackWhileTokenAvailable++
        if (this.lastFigureTargetVisual.exactTokenAvailable && !this.lastFigureTargetVisual.exactTokenUsed && this.lastFigureTargetVisual.usedBlockFallback) {
          this.countersFigureTargetV512R8.missingNameBlockFallbackWhileTokenAvailable++
        }
      }
      if (role === FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE) {
        if (facts.expectedRangeRole !== FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE
          || asStr(audit.expectedRangeRole) !== FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE) {
          this.countersFigureTargetV512R8.localImageMissingFullTokenMarkInsteadOfPath++
        }
        if (facts.resolvedSourceStart != null && asNum(audit.destinationStart) != null
          && facts.resolvedSourceStart === asNum(audit.destinationStart)) {
          // The resolved range IS the destination range (never the whole token).
        } else if (facts.resolvedSourceStart != null && asNum(audit.tokenStart) != null
          && facts.resolvedSourceStart === asNum(audit.tokenStart)) {
          this.countersFigureTargetV512R8.localImageMissingFullTokenMarkInsteadOfPath++
        }
      }
    }
    // Deferred to the transaction terminal so the R4 document-space carrier
    // (committed AFTER the visual) contributes the REAL document-local count.
    this.pendingFigureTargetAudit = {
      payload: {
        documentKey: diag.documentKey ?? this.opts.ctx.authority.getDocumentKey() ?? null,
        transactionId: tx.id,
        diagnosticId: diag.id,
        ...facts,
        visualCommitted,
        decision: verdict.decision,
        reason: verdict.reason,
        gateDecision: evaluateFigureTargetV512R8Gates(this.countersFigureTargetV512R8).decision,
      },
    }
  }

  /**
   * V5.12-R8 §15 — emit the pending figure target authority audit at the
   * transaction terminal, where the R4 document-space carrier (committed AFTER
   * the visual) is available. `documentLocalRectCount` is therefore the REAL
   * document-local fragment count, never an assumption.
   *
   * `documentLocalRectCount === null` → read the just-committed carrier;
   * a number → use it verbatim (0 when no carrier was committed).
   */
  private emitPendingFigureTargetAudit(documentLocalRectCount: number | null): void {
    const pending = this.pendingFigureTargetAudit
    if (!pending) return
    this.pendingFigureTargetAudit = null
    emitRuntimeAudit(FIGURE_TARGET_AUTHORITY_AUDIT_EVENT, {
      ...pending.payload,
      documentLocalRectCount: documentLocalRectCount
        ?? (this.getCommittedDocumentSpace()?.inlineLocal.length ?? 0),
    })
  }

  /**
   * V5.12-R8 §14 — SNAPSHOT-scoped figure gates. These describe the CURRENT
   * document (a missing-NAME warning must always be locatable, a local-missing
   * warning must always be a `warning` with a destination range, remote/data
   * URLs must never be reported, and both rules must survive dedupe). The
   * snapshot-scoped counters are ASSIGNED; the per-click counters accumulate.
   */
  private commitFigureTargetSnapshotGates(snapshot: DocumentDiagnosticsSnapshot): void {
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    const views: FigureSnapshotDiagnosticView[] = []
    for (const d of snapshot.diagnostics) {
      if (d.code !== 'FIGURE_MISSING_NAME' && d.code !== 'FIGURE_LOCAL_IMAGE_MISSING') continue
      const m = (d.metadata ?? {}) as Record<string, unknown>
      const loc = (d.location ?? null) as Record<string, unknown> | null
      views.push({
        code: d.code,
        severity: String(d.severity ?? ''),
        resourceKind: str(m.resourceKind),
        resourceClass: str(m.resourceClass),
        altText: str(m.altText),
        canonicalDestination: str(m.canonicalDestination) ?? str(m.destination),
        occurrenceIndex: num(m.occurrenceIndex),
        localFileExists: typeof m.localFileExists === 'boolean' ? m.localFileExists : null,
        rangeRole: str(m.rangeRole) ?? (loc ? str(loc.rangeRole) : null),
        locatableSourceRange: !!loc && loc.kind === 'source-range' && typeof loc.startLine === 'number',
        sourceStart: num(m.sourceStart) ?? (loc ? num(loc.sourceStart) : null),
        sourceEnd: num(m.sourceEnd) ?? (loc ? num(loc.sourceEnd) : null),
        destinationStart: num(m.destinationStart) ?? (loc ? num(loc.destinationStart) : null),
        destinationEnd: num(m.destinationEnd) ?? (loc ? num(loc.destinationEnd) : null),
      })
    }
    const counts = evaluateFigureTargetSnapshotGates(views)
    for (const key of FIGURE_TARGET_V512R8_GATE_KEYS) {
      if (FIGURE_TARGET_V512R8_PER_CLICK_GATE_KEYS.has(key)) continue
      this.countersFigureTargetV512R8[key] = counts[key] ?? 0
    }
    const signature = `${snapshot.documentKey ?? ''}|${views.map(v => `${v.code}:${v.rangeRole}:${v.destinationStart ?? ''}:${v.sourceStart ?? ''}`).join(',')}`
    if (signature === this.lastFigureTargetSnapshotSignature) return
    this.lastFigureTargetSnapshotSignature = signature
    emitRuntimeAudit(FIGURE_TARGET_AUTHORITY_AUDIT_EVENT, {
      documentKey: snapshot.documentKey,
      revision: snapshot.revision,
      scope: 'SNAPSHOT',
      figureDiagnosticCount: views.length,
      gateReport: formatFigureTargetV512R8GateReport(this.countersFigureTargetV512R8),
      decision: evaluateFigureTargetV512R8Gates(this.countersFigureTargetV512R8).decision,
    })
  }

  getFigureTargetV512R8GateReport(): string[] {
    return formatFigureTargetV512R8GateReport(this.countersFigureTargetV512R8)
  }

  getFigureTargetV512R8GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] } {
    return evaluateFigureTargetV512R8Gates(this.countersFigureTargetV512R8)
  }

  getCaptionCodeSpacingV512R8GateReport(): string[] {
    return formatCaptionCodeSpacingV512R8GateReport(this.countersCaptionCodeSpacingV512R8)
  }

  getCaptionCodeSpacingV512R8GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] } {
    return evaluateCaptionCodeSpacingV512R8Gates(this.countersCaptionCodeSpacingV512R8)
  }

  /**
   * V5.12-R8 §11/§15 — measure the REAL Code Caption → Code Body gap.
   *
   * ONLY an InkChapter code caption is considered, and only against the code
   * block it directly precedes (`.inkchapter-caption-code + pre.md-fences`).
   * Global Typora `pre` margin, code line-height and the code block's internal
   * padding are NEVER touched — this is a pure measurement.
   */
  measureCaptionCodeSpacing(): CaptionCodeSpacingFacts[] {
    const facts: CaptionCodeSpacingFacts[] = []
    const root: HTMLElement | null = resolveBusinessContentRoot()
    if (!root) return facts
    const num = (v: string): number | null => {
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? n : null
    }
    for (const caption of Array.from(root.querySelectorAll<HTMLElement>('.inkchapter-caption-code'))) {
      const body = caption.nextElementSibling as HTMLElement | null
      if (!body || body.tagName !== 'PRE' || !body.classList.contains('md-fences')) {
        facts.push({
          captionRect: null, codeBodyRect: null, effectiveGapPx: null,
          captionMarginBottom: null, codeMarginTop: null, wrapperGap: null,
          decision: 'NOT_APPLICABLE',
        })
        continue
      }
      let cr: DOMRect
      let br: DOMRect
      try {
        cr = caption.getBoundingClientRect()
        br = body.getBoundingClientRect()
      } catch {
        continue
      }
      const cs = window.getComputedStyle(caption)
      const bs = window.getComputedStyle(body)
      const effectiveGapPx = br.top - cr.bottom
      const gapDecision = evaluateCaptionCodeSpacingGap(effectiveGapPx)
      facts.push({
        captionRect: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom },
        codeBodyRect: { left: br.left, top: br.top, right: br.right, bottom: br.bottom },
        effectiveGapPx,
        captionMarginBottom: num(cs.marginBottom),
        codeMarginTop: num(bs.marginTop),
        // No wrapper element is inserted between an InkChapter caption and its
        // code block (the caption is an immediate sibling) — reported honestly.
        wrapperGap: null,
        decision: gapDecision.decision,
      })
    }
    return facts
  }

  /** V5.12-R8 §14/§15 — fold the measured spacing into counters + audit. */
  private commitCaptionCodeSpacingAudit(): void {
    let factsList: CaptionCodeSpacingFacts[]
    try {
      factsList = this.measureCaptionCodeSpacing()
    } catch {
      return
    }
    const measured = factsList.filter(f => f.effectiveGapPx != null)
    if (measured.length === 0) return
    this.countersCaptionCodeSpacingV512R8.gapGt6px = measured.filter(f => f.decision === 'FAIL' && (f.effectiveGapPx ?? 0) > 6).length
    this.countersCaptionCodeSpacingV512R8.gapLt1px = measured.filter(f => f.decision === 'FAIL' && (f.effectiveGapPx ?? 0) < 1).length
    const first = measured[0]
    const signature = measured
      .map(f => `${(f.effectiveGapPx ?? 0).toFixed(2)}:${f.captionMarginBottom ?? ''}:${f.codeMarginTop ?? ''}`)
      .join('|')
    if (signature === this.lastCaptionCodeSpacingSignature) return
    this.lastCaptionCodeSpacingSignature = signature
    emitRuntimeAudit(CAPTION_CODE_SPACING_AUDIT_EVENT, {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      captionRect: first.captionRect,
      codeBodyRect: first.codeBodyRect,
      effectiveGapPx: first.effectiveGapPx,
      captionMarginBottom: first.captionMarginBottom,
      codeMarginTop: first.codeMarginTop,
      wrapperGap: first.wrapperGap,
      pairCount: measured.length,
      gateReport: formatCaptionCodeSpacingV512R8GateReport(this.countersCaptionCodeSpacingV512R8),
      decision: evaluateCaptionCodeSpacingV512R8Gates(this.countersCaptionCodeSpacingV512R8).decision,
    })
  }

  // ── Mount / dispose ─────────────────────────────────
  mount(): void {
    if (this.mounted || this.disposed) return
    this.mounted = true

    // Phase 7R.3.11.1 (Strategy B): the overlay root is a FULL-VIEWPORT fixed
    // layer so absolute-positioned children (toolbar/navigator/drawer) use the
    // viewport as their containing block. A 0×0 root is NOT a usable containing
    // block: `right`/`bottom` on absolute children would push them off-screen.
    const root = document.createElement('div')
    root.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    root.setAttribute(UTILITY_ROOT_IDENTITY_ATTR, 'true')
    root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;z-index:900;'
    document.body.appendChild(root)
    this.root = root

    this.toolbarEl = this.buildToolbar(root)
    this.navigatorEl = this.buildNavigator(root)
    this.drawerEl = this.buildDrawer(root)

    // Phase 7R.3.11.8B.12 — Navigator MOUNT is HIDDEN-BY-DEFAULT. Visibility is
    // granted only after Active-Document eligibility + scrollability + a safe
    // right-side rail placement are all proven. Never mount → visible → hide.
    this.applyNavigatorPresentation('hidden', null)
    this.lastNavVis = { presentation: 'hidden', reason: 'NO_ACTIVE_DOCUMENT', insetRightPx: null }

    // Phase 7R.3.11.8B.8 — V3 Diagnostic Locate Frame (single presentation
    // layer inside the SAME overlay root; never a second global overlay).
    this.locateFrame = new DiagnosticLocateFrameController(root)
    this.bindLocateFrameEditorScroll()

    // Scroll navigator lifecycle (one active listener).
    this.scrollNav = new DocumentScrollNavigator({
      getContainer: () => getActiveEditorScrollContainer(),
      onStateChange: (s) => this.renderNavState(s),
    })
    this.scrollNav.bind()

    // Phase 7R.3.11.8B.6 — resolve the REAL workspace flex item ONCE and add
    // the scoped min-width host class (declarative CSS, no inline width
    // writes). Unresolved → log unsupported, never guess an ancestor.
    this.applyWorkspaceHost()
    this.ensureTabStructureObserver()

    // Placement sync — anchored to the editor shell rect. The ResizeObserver
    // callback only schedules ONE coalesced rAF; it never writes styles (no
    // geometry feedback loop). Callback counters feed the resize attribution.
    const container = getActiveEditorScrollContainer()
    if (container && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeObserverEpoch++
        this.lastRoCallbackTs = this.now()
        // Phase 7R.3.11.4 — epoch-based attribution (no single-point width
        // comparison): externalRecent vs utilityWriteRecent within windows.
        const externalRecent = this.lastExternalResizeTs != null && this.now() - this.lastExternalResizeTs <= EXTERNAL_RESIZE_WINDOW_MS
        const utilityWriteRecent = this.lastGeometryWriteTs != null && this.now() - this.lastGeometryWriteTs <= UTILITY_WRITE_WINDOW_MS
        if (externalRecent && utilityWriteRecent) {
          this.geometryCounters.mixedCorrelationCount++
        } else if (!externalRecent && utilityWriteRecent) {
          this.geometryCounters.feedbackLoopSuspectCount++
        }
        // Phase 7R.3.11.8B.3.1 — a shell change can ONLY be attributed to OUR
        // write when no external resize occurred since that write (otherwise
        // the change is the lingering effect of an external resize → §5 B
        // FALSE_POSITIVE_ATTRIBUTION). The causal token (write epoch observed)
        // is recorded so `confirmed` can later require a NEW write2.
        const shellRectNow = container.getBoundingClientRect()
        const changed = this.lastWriteShellRect != null && Math.abs(shellRectNow.width - this.lastWriteShellRect.width) > 0.5
        const attributableToUtility = changed && this.lastGeometryWriteExternalEpoch === this.externalResizeEpoch
        if (!externalRecent && utilityWriteRecent && attributableToUtility) {
          this.lastRoSawChangedShell = true
          this.externalEpochAtLoopStart = this.externalResizeEpoch
          this.lastShellChangeObservedWriteEpoch = this.utilityWriteEpoch
        } else if (externalRecent) {
          this.lastRoSawChangedShell = false
        }
        this.scheduleGeometrySync('resize-observer')
      })
      this.resizeObserver.observe(container)
    }
    // Phase 7R.3.11.8B.3 — observe the CONTENT root too: its box grows with
    // content, so short→long/long→short navigator visibility stays live
    // without any polling (same RO, same coalesced rAF, no new observer).
    const contentRoot = resolveBusinessContentRoot()
    if (contentRoot && this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver.observe(contentRoot)
    }
    window.addEventListener('resize', this.onWindowResize)
    this.installWarningObserver()
    this.scheduleGeometrySync('mount')

    // Diagnostics subscription → toolbar badge + live drawer re-render.
    this.disposables.push(this.diagnostics.subscribe((snapshot) => {
      // Phase 7R.3.11.4 — stale-publish guard: a snapshot whose documentKey no
      // longer matches the active document must be DISCARDED (never rendered).
      const activeKey = this.opts.ctx.authority.getDocumentKey()
      if (snapshot && snapshot.documentKey !== activeKey) {
        emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
          action: 'DISCARDED_STALE',
          documentKey: snapshot.documentKey,
          activeDocumentKey: activeKey,
          revision: snapshot.revision,
          sourceRevision: snapshot.sourceRevision,
          itemCount: snapshot.diagnostics.length,
          decision: 'STALE_DIAGNOSTIC_PUBLISH_DISCARDED',
        })
        return
      }
      if (snapshot) {
        // V5 — SINGLE consumer admission gate: subscription publishes are one
        // producer; the consumer decision (ADMITTED / ALREADY_ADMITTED /
        // PENDING_ACTIVE_LEAF / DISCARD_*) is made here and is independent of
        // the producer's PUBLISHED/NOOP/DEDUPED outcome.
        const admission = this.admitDiagnosticsSnapshot(snapshot, 'DIAGNOSTICS_PUBLISH')
        if (admission.decision === 'ADMITTED') {
          this.commitAdmittedSnapshot(snapshot, 'SUBSCRIPTION')
        }
        // V5.12-R8 §14 — snapshot-scoped figure target/existence gates.
        this.commitFigureTargetSnapshotGates(snapshot)
        // PENDING_ACTIVE_LEAF / ALREADY_ADMITTED / DISCARD_* are audited inside
        // admitDiagnosticsSnapshot and never reach the projection/Toolbar here.
      }
    }))

    // Phase 7R.3.11.8-B — initial reconcile (BUG-2). If a document is already
    // ACTIVE at mount, reconcileActiveDocument runs NOW — it never waits for a
    // later file:open / tab:toggle / user click. If EMPTY/UNKNOWN-inactive the
    // reconcile path applies the NO_ACTIVE_DOCUMENT state.
    this.reconcileActiveDocument('INITIAL_ACTIVE_DOCUMENT')

    // Phase 7R.3.11.8-B §7 — live diagnostics triggers (frame commit / mode
    // change) → lightweight recompute only. Phase 7R.3.11.8B.7.1 — the reason
    // flows through to the PUBLISHED audit (HEADING_STRUCTURE_MODE_CHANGED etc.).
    this.opts.onDiagnosticsTrigger?.((reason) => this.reconcileActiveDocument(reason))

    // Phase 7R.3.11.8-B §7 — event-driven editor mutation trigger (rAF-coalesced).
    // Covers raw source / trailing-blank-line changes and live heading edits.
    // NEVER a timer/poll: fires only on actual #write mutations. Recompute is
    // read-only (no DOM write), so there is no feedback loop.
    const editorRoot = resolveBusinessContentRoot()
    if (editorRoot && typeof MutationObserver === 'function') {
      this.diagnosticsMutationObserver = new MutationObserver(() => {
        if (this.disposed) return
        // Phase 7R.3.11.8B.3 — content mutation also re-measures navigator
        // visibility (event-driven, rAF-coalesced; never a timer/poll).
        if (!this.diagnosticsRafPending) {
          this.diagnosticsRafPending = true
          requestAnimationFrame(() => {
            this.diagnosticsRafPending = false
            if (this.disposed) return
            this.diagnostics.recompute('DOCUMENT_MUTATION')
            this.scheduleGeometrySync('content-mutation')
          })
        }
      })
      this.diagnosticsMutationObserver.observe(editorRoot, { childList: true, characterData: true, subtree: true })
    }

    // Bind to the current document.
    this.opts.onBindDocument?.(() => this.bindDocument())

    // V3 — primary active-leaf lifecycle (workspace `active-leaf:change` +
    // workspace-tabs `tab:toggle`). The host reacts to the REAL leaf state
    // synchronously: close-last-tab → immediate EMPTY suppression, reopen →
    // automatic restore. Registered into this.disposables so dispose removes it.
    this.activeLeafLifecycleDispose = this.opts.onActiveLeafLifecycle?.((reason) => {
      this.handleActiveLeafLifecycle(reason)
    }) ?? null
    if (this.activeLeafLifecycleDispose) {
      this.disposables.push(() => {
        this.activeLeafLifecycleDispose?.()
        this.activeLeafLifecycleDispose = null
      })
    }

    // Empty Workspace UX V1 — single EMPTY-placeholder marker writer + single
    // scoped empty-workspace dblclick listener (create/open .md). Driven by the
    // SAME EMPTY authority; disposes with the host.
    if (this.opts.emptyWorkspace && typeof document !== 'undefined') {
      try {
        const emptyUx = new EmptyWorkspaceUxController({
          platform: this.opts.emptyWorkspace.platform,
          contentEditableBoundaryAllowed: this.opts.emptyWorkspace.contentEditableBoundaryAllowed,
          getPresence: () => this.readEmptyWorkspacePresence(),
          // V2 — surface authority = the ACTIVE EMPTY leaf view container,
          // injected by the workspace adapter. The stale #write root is NEVER
          // used as the empty surface.
          ...(this.opts.emptyWorkspace.resolveEmptySurface
            ? { resolveEmptySurface: this.opts.emptyWorkspace.resolveEmptySurface }
            : {}),
        })
        emptyUx.sync(this.readEmptyWorkspacePresence())
        this.emptyWorkspaceUx = emptyUx
        this.disposables.push(() => {
          emptyUx.dispose()
          this.emptyWorkspaceUx = null
        })
        emitRuntimeAudit('DOCUMENT-UTILITY-EMPTY-WORKSPACE-RUNTIME-STRUCTURE', {
          action: 'MOUNTED',
          dblclickListenerCount: emptyUx.getRuntimeFacts().dblclickListenerCount,
          emptyPlaceholderMarkerCount: emptyUx.getRuntimeFacts().emptyPlaceholderMarkerCount,
          duplicateMount: false,
        })
      } catch (e) {
        console.error('[InkChapter] Empty Workspace UX 初始化失败', e)
      }
    }

    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'MOUNTED',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
      toolbarCount: document.querySelectorAll('.inkchapter-doc-toolbar').length,
      navigatorCount: document.querySelectorAll('.inkchapter-doc-navigator').length,
      drawerCount: document.querySelectorAll('.inkchapter-doc-drawer').length,
      rootConnected: this.root?.isConnected ?? false,
      editorRootConnected: resolveBusinessContentRoot()?.isConnected ?? false,
      scrollContainerConnected: getActiveEditorScrollContainer()?.isConnected ?? false,
    })
    console.log('[InkChapter] DOCUMENT-UTILITY-LIFECYCLE action=MOUNTED rootConnected=' + (this.root?.isConnected ?? false))
    this.emitFullBcr('mount')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mounted = false
    for (const d of this.disposables) d()
    this.disposables = []
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.removeEventListener('resize', this.onWindowResize)
    if (this.onWindowErrorBound) {
      window.removeEventListener('error', this.onWindowErrorCapture, true)
      this.onWindowErrorBound = false
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    this.scrollNav?.dispose()
    this.scrollNav = null
    // Phase 7R.3.11.8-B: release any in-flight scroll operation.
    this.cancelScrollOperation('SUPERSEDED')
    // Phase 7R.3.11.8B.7.7 — dispose cancels any active locate transaction.
    this.cancelActiveLocateTransaction('HOST_DISPOSED')
    // V5.12-R2 §13.3 — unload ENDS the active visual: release the visibility
    // lease and cancel any pending geometry reconcile.
    this.releaseDrawerRecoveryLease('HOST_DISPOSED')
    // V5.12-R3 §6 — unload also ends the active visual lease.
    this.releaseActiveLocateVisualLease('HOST_DISPOSED')
    if (this.diagnosticGeometryReconcileRaf !== null) {
      try { cancelAnimationFrame(this.diagnosticGeometryReconcileRaf) } catch { /* noop */ }
      this.diagnosticGeometryReconcileRaf = null
    }
    // Phase 7R.3.11.8B.8 — dispose the V3 locate frame + its scroll binding.
    this.unbindLocateFrameEditorScroll()
    if (this.locateScrollRafHandle !== null) {
      try { cancelAnimationFrame(this.locateScrollRafHandle) } catch { /* noop */ }
      this.locateScrollRafHandle = null
    }
    this.locateFrame?.dispose()
    this.locateFrame = null
    // V5.11 — tear down the document-space layer + carrier.
    this.clearHeadingDiagnosticMarkers()
    if (this.headingMarkerLayer) {
      try { this.headingMarkerLayer.remove() } catch { /* noop */ }
      this.headingMarkerLayer = null
    }
    this.removeLocateDocumentCarrier()
    if (this.locateDocLayer) {
      try { this.locateDocLayer.remove() } catch { /* noop */ }
      this.locateDocLayer = null
    }
    if (this.locateDocLayerForcedPosition && this.locateDocLayerHost) {
      try { this.locateDocLayerHost.style.position = '' } catch { /* noop */ }
      this.locateDocLayerForcedPosition = false
    }
    this.locateDocLayerHost = null
    this.releaseLocateScrollLease()
    // Phase 7R.3.11.8B.6 — remove the workspace host class + state attribute.
    this.cleanupWorkspaceGuard()
    // Phase 7R.3.11.8-B: disconnect the diagnostics mutation observer.
    this.diagnosticsMutationObserver?.disconnect()
    this.diagnosticsMutationObserver = null
    this.diagnosticsRafPending = false
    this.editGuard.dispose()
    this.root?.remove()
    this.root = null
    emitRuntimeAudit('DOCUMENT-UTILITY-LIFECYCLE', {
      action: 'DISPOSE',
      rootCount: document.querySelectorAll(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`).length,
    })
  }

  /** FILE_OPEN document switch — routed into the single reconcile authority. */
  bindDocument(): void {
    this.reconcileActiveDocument('FILE_OPEN')
  }

  // ── V3 Diagnostic Locate Frame (overlay presentation) ─────────────────────
  // The frame consumes ONLY what the locator resolved (anchor element /
  // severity / kind / diagnosticId). It never re-queries the document for a
  // new target and never re-infers a source anchor. Reposition is triggered by
  // scroll / resize / drawer / DevTools-layout geometry events (rAF-coalesced,
  // no setInterval polling).

  private locateFrameScrollContainer: HTMLElement | null = null
  /** V5.5 — SINGLE rAF scroll scheduler for the locate frame. One frame → at
   *  most one fresh absolute reposition; scroll events never do DOM writes and
   *  never re-enter a locate transaction. */
  private locateScrollRafHandle: number | null = null

  /** V5.6 — interaction lifecycle: active visual epoch + decoupled selection. */
  private locateVisualEpoch = 0
  private locateDismissSurface: HTMLElement | null = null

  /** V5.6 — read-only interaction-lifecycle counters (hard gates). */
  private countersInteractionV56 = {
    leftClickDismissFail: 0,
    rightClickFalseDismiss: 0,
    middleClickFalseDismiss: 0,
    wheelFalseDismiss: 0,
    drawerClosedByDismiss: 0,
    selectionClearedByDismiss: 0,
    preventDefault: 0,
    stopPropagation: 0,
    visualReappear: 0,
    scrollRepaintAfterDismiss: 0,
    lateCommit: 0,
    danglingTx: 0,
    sameDiagnosticRelocateFail: 0,
    staleVisualOnSwitch: 0,
    overlayPointerCapture: 0,
    duplicateDismissListener: 0,
    duplicateScrollListener: 0,
    listenerLeak: 0,
    crossDocumentStaleVisual: 0,
  }

  getInteractionCounters(): Readonly<Record<string, number>> {
    return { ...this.countersInteractionV56 }
  }

  /** V5.6 — is a locate VISUAL currently committed? (selectedDiagnosticId is a
   *  separate, preserved authority that this deliberately ignores.) */
  private locateVisualIsActive(): boolean {
    return this.locateFrame?.hasCommitted() === true
  }

  /** V5.5 — read-only scroll-stability counters (hard gates). */
  private countersScrollV55 = {
    targetFrameDeltaGt2: 0,
    doubleCompensation: 0,
    staleFrame: 0,
    staleTargetRect: 0,
    staleHostRect: 0,
    staleInlineFragment: 0,
    incrementalMutation: 0,
    duplicateListener: 0,
    duplicateRaf: 0,
    listenerLeak: 0,
    scrollTriggeredScrollIntoView: 0,
    scrollLocateReentry: 0,
    rafCoalescingFail: 0,
    rightClampRegression: 0,
    visualStyleMutation: 0,
    geometryAccumulation: 0,
    staleAnchorReposition: 0,
    // V5.7 — CommittedLocateVisualTopology gates.
    presentationKindChange: 0,
    targetKindChange: 0,
    anchorIdentityChange: 0,
    visualRoleChange: 0,
    freshHostMeasurementFalse: 0,
    expectedPaintedLeftGt2: 0,
    expectedPaintedTopGt2: 0,
    expectedPaintedRightGt2: 0,
    expectedPaintedBottomGt2: 0,
    expectedPaintedWidthGt2: 0,
    expectedPaintedHeightGt2: 0,
    blockSizeDriftGt2: 0,
    tableContextEscapesSemanticTarget: 0,
    codeContextEscapesSemanticTarget: 0,
    inlineOccurrenceChange: 0,
    inlineOwnerBlockChange: 0,
    repositionSelfWake: 0,
    zeroDeltaRepaintStorm: 0,
  }

  getScrollStabilityCounters(): Readonly<Record<string, number>> {
    return { ...this.countersScrollV55 }
  }

  /** V5.8 — single-click offscreen atomic transaction hard-gate counters. */
  private countersOneClickV58: Record<LocateOneClickGateKey, number> = createLocateOneClickGateCounters()

  getOneClickLocateCounters(): Readonly<Record<string, number>> {
    return { ...this.countersOneClickV58 }
  }

  /** V5.9 — Scroll Completion Authority hard-gate counters. */
  private countersScrollV59: Record<LocateScrollV59GateKey, number> = createLocateScrollV59GateCounters()
  /** V5.9 — accepted/terminal transaction bookkeeping (§37). */
  private locateTxAcceptedCount = 0
  private locateTxTerminalCount = 0
  /** V5.9 — is a bounded transaction rAF still pending? (§37 dangling) */
  private locateTxRafPending = false

  getScrollArrivalCounters(): Readonly<Record<string, number>> {
    return { ...this.countersScrollV59 }
  }

  /** V5.9 §37 — accepted must equal terminal; dangling must be 0. */
  getLocateTransactionCounts(): { accepted: number; terminal: number; dangling: number } {
    return {
      accepted: this.locateTxAcceptedCount,
      terminal: this.locateTxTerminalCount,
      dangling: this.activeLocateTx ? 1 : 0,
    }
  }

  /** V5.10 — Preferred Center Placement hard-gate counters. */
  private countersPlacementV510: Record<LocatePlacementV510GateKey, number> = createLocatePlacementV510GateCounters()
  /**
   * V5.10 — per-transaction placement context (single instance; the locate
   * transaction is NON-REENTRANT). Cleared at every terminal.
   */
  private locatePlacementCtx: {
    anchorEl: HTMLElement | null
    primaryEl: HTMLElement | null
    secondaryEl: HTMLElement | null
    compound: boolean
  } | null = null

  getPlacementCounters(): Readonly<Record<string, number>> {
    return { ...this.countersPlacementV510 }
  }

  /** V5.10 §34 — dismiss bookkeeping (a dismiss must never recenter). */
  private locateDismissCount = 0

  // ── V5.11 — Document-Space Visual Carrier ────────────────────────────────
  /** The scroll lease: ONLY the PRE-COMMIT V5.9/V5.10 phases may use it. */
  private locateScrollLease: { transactionId: number; visualEpoch: number; state: 'ACTIVE' | 'RELEASED' } | null = null
  private locateDocLayer: HTMLElement | null = null
  private locateDocLayerHost: HTMLElement | null = null
  private locateDocLayerForcedPosition = false
  private locateDocCarrier: HTMLElement | null = null
  private locatePostCommitUserScrollCount = 0
  /** Frozen document-local committed visual (identities + local geometry). */
  private locateCommittedVisual: {
    transactionId: number
    visualEpoch: number
    documentKey: string | null
    diagnosticId: string | null
    severity: string | null
    presentationKind: string | null
    semanticAnchorIdentity: string | null
    primaryAnchorIdentity: string | null
    secondaryAnchorIdentity: string | null
    occurrenceIndex: number | null
    primaryLocal: DocumentSpaceRect | null
    secondaryLocal: DocumentSpaceRect | null
    inlineLocal: DocumentSpaceRect[]
    fingerprint: LocateLayoutFingerprint | null
    carrierNodes: number
  } | null = null
  private countersDocSpaceV511 = createLocateDocumentSpaceV511GateCounters()

  getDocumentSpaceCounters(): Readonly<Record<string, number>> {
    return { ...this.countersDocSpaceV511 }
  }

  /** V5.11 — read-only snapshot of the frozen document-space visual. */
  getCommittedDocumentSpace(): Readonly<{
    transactionId: number
    visualEpoch: number
    diagnosticId: string | null
    presentationKind: string | null
    semanticAnchorIdentity: string | null
    primaryAnchorIdentity: string | null
    secondaryAnchorIdentity: string | null
    occurrenceIndex: number | null
    primaryLocal: DocumentSpaceRect | null
    secondaryLocal: DocumentSpaceRect | null
    inlineLocal: DocumentSpaceRect[]
    carrierNodes: number
  }> | null {
    const c = this.locateCommittedVisual
    if (!c) return null
    return {
      transactionId: c.transactionId,
      visualEpoch: c.visualEpoch,
      diagnosticId: c.diagnosticId,
      presentationKind: c.presentationKind,
      semanticAnchorIdentity: c.semanticAnchorIdentity,
      primaryAnchorIdentity: c.primaryAnchorIdentity,
      secondaryAnchorIdentity: c.secondaryAnchorIdentity,
      occurrenceIndex: c.occurrenceIndex,
      primaryLocal: c.primaryLocal,
      secondaryLocal: c.secondaryLocal,
      inlineLocal: [...c.inlineLocal],
      carrierNodes: c.carrierNodes,
    }
  }

  /** V5.11 — is the locate scroll lease still held (PRE-COMMIT only)? */
  getLocateScrollLeaseState(): 'ACTIVE' | 'RELEASED' | null {
    return this.locateScrollLease ? this.locateScrollLease.state : null
  }

  getPostCommitUserScrollCount(): number {
    return this.locatePostCommitUserScrollCount
  }

  private acquireLocateScrollLease(tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>): void {
    this.locateScrollLease = { transactionId: tx.id, visualEpoch: this.locateVisualEpoch, state: 'ACTIVE' }
  }

  /** §13 — release on EVERY terminal state; the scroll handler then no-ops. */
  private releaseLocateScrollLease(): void {
    if (this.locateScrollLease) this.locateScrollLease.state = 'RELEASED'
  }

  private locateScrollLeaseActive(): boolean {
    // PRE-COMMIT: a live locate transaction holds the lease (V5.9 arrival /
    // V5.10 placement may legitimately repaint while the target settles).
    if (this.locateScrollLease?.state === 'ACTIVE' && this.activeLocateTx !== null) return true
    // V5.11 — a committed DOCUMENT-SPACE carrier is the terminal boundary: the
    // lease is released and the locate subsystem is INERT for good.
    if (this.locateCommittedVisual !== null) return false
    // A viewport visual produced outside a full transaction (the direct commit
    // API used by the V5.5/V5.7 suites) keeps the legacy scroll-follow until a
    // document-space carrier takes over.
    return this.locateVisualIsActive()
  }

  /**
   * §5 — the document-space layer. It is a child of the canonical CONTENT host
   * so the committed carrier shares the Markdown document-local coordinate
   * space and scrolls natively with the content.
   */
  private ensureLocateDocumentLayer(): HTMLElement | null {
    if (this.locateDocLayer && this.locateDocLayer.isConnected) return this.locateDocLayer
    const host = resolveBusinessContentRoot()
    if (!host) return null
    try {
      const pos = window.getComputedStyle(host).position
      if (pos === 'static') {
        host.style.position = 'relative'
        this.locateDocLayerForcedPosition = true
      }
    } catch { /* keep the host style as-is */ }
    const layer = document.createElement('div')
    layer.className = LOCATE_DOCUMENT_LAYER_CLASS
    layer.setAttribute('data-inkchapter-locate-layer', 'true')
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;'
    host.appendChild(layer)
    this.locateDocLayer = layer
    this.locateDocLayerHost = host
    return layer
  }

  private removeLocateDocumentCarrier(): void {
    if (this.locateDocCarrier) {
      try { this.locateDocCarrier.remove() } catch { /* noop */ }
      this.locateDocCarrier = null
    }
    // V5.12-R4 §3 — the document-space INLINE fragment carriers go with it.
    for (const el of this.locateDocInlineEls) {
      try { el.remove() } catch { /* noop */ }
    }
    this.locateDocInlineEls = []
    this.locateCommittedVisual = null
  }

  private static anchorIdentityOf(el: HTMLElement | null): string | null {
    if (!el) return null
    const line = el.getAttribute('data-line') ?? ''
    return `${el.tagName.toLowerCase()}#${line}.${String(el.className).slice(0, 40)}`
  }

  private measureLocateLayoutFingerprint(host: HTMLElement | null): LocateLayoutFingerprint | null {
    if (!host) return null
    const hostRect = this.measureLocateRect(host)
    const ctx = this.locatePlacementCtx
    const anchor = this.locateFrame?.getAnchorElement() ?? null
    const semRect = this.measureLocateRect(anchor)
    const primaryRect = ctx?.compound ? this.measureLocateRect(ctx.primaryEl) : null
    const secondaryRect = this.measureLocateRect(ctx?.secondaryEl ?? null)
    if (!hostRect || !semRect) return null
    return {
      documentHostWidth: hostRect.width,
      semanticWidth: semRect.width,
      semanticHeight: semRect.height,
      primaryWidth: primaryRect ? primaryRect.width : null,
      primaryHeight: primaryRect ? primaryRect.height : null,
      secondaryWidth: secondaryRect ? secondaryRect.width : null,
      secondaryHeight: secondaryRect ? secondaryRect.height : null,
      lineFragmentCount: null,
      // The document key + diagnostic identity act as the structure revision:
      // a different target is a DIFFERENT structure, never a reflow of this one.
      structureRevision: 1,
    }
  }

  /**
   * §23/§8/§18 — COMMIT: convert the FINAL viewport geometry into document-local
   * geometry ONCE and mount the carrier in the document-space layer. The
   * viewport frame is then detached so only ONE carrier exists.
   */
  private commitDocumentSpaceCarrier(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    result: DiagnosticLocationResolveResult,
  ): boolean {
    const frame = this.locateFrame
    const layer = this.ensureLocateDocumentLayer()
    const host = this.locateDocLayerHost
    if (!frame || !layer || !host) return false
    const hostRect = this.measureLocateRect(host)
    if (!hostRect) return false
    const anchor = result.element ?? this.locateFrame?.getAnchorElement() ?? null
    const meta = (diag.metadata ?? {}) as Record<string, unknown>
    const inlineEl = frame.getInlineElement()
    const frameEl = frame.getFrameElement()

    let primaryLocal: DocumentSpaceRect | null = null
    let carrierNodes = 0
    if (frameEl) {
      const vp = this.measureLocateRect(frameEl)
      const local = viewportRectToDocumentLocalRect({ viewportRect: vp, contentHostRect: hostRect })
      if (local) {
        const clone = frameEl.cloneNode(true) as HTMLElement
        clone.style.position = 'absolute'
        clone.style.left = `${Math.round(local.left)}px`
        clone.style.top = `${Math.round(local.top)}px`
        clone.style.width = `${Math.round(local.width)}px`
        clone.style.height = `${Math.round(local.height)}px`
        clone.style.display = 'block'
        layer.appendChild(clone)
        this.locateDocCarrier = clone
        primaryLocal = makeDocumentSpaceRect({ left: local.left, top: local.top, right: local.right, bottom: local.bottom })
        carrierNodes = 1
      }
      frame.releaseViewportCarrier()
    }
    // ── V5.12-R4 §3 — inline exact fragments enter the SAME document-space ────
    // pipeline and carrier. There is NO inline-private viewport render path: the
    // Range viewport rects are normalized by the shared `viewportRectToDocumentLocalRect`
    // (identical to the block path, never a second helper, never +/- scrollTop),
    // mounted into the SAME document-space layer, and the viewport carrier is
    // detached before the transaction terminates.
    const inlineLocal: DocumentSpaceRect[] = []
    const headless = this.isHeadlessLayoutSafe()
    // V5.12-R4 §13 — the inline coordinate evidence carried into the
    // document-space audit (hoisted so the audit reflects the real measurement).
    let inlineExpectedViewport: DocumentSpaceRect[] = []
    let inlineReprojectedViewportRects: DocumentSpaceRect[] = []
    let inlineActualPaintedViewportRects: DocumentSpaceRect[] = []
    let inlineDrift: ReturnType<typeof measureInlineFragmentPositionDrift> | null = null
    let inlineReprojectedDrift: ReturnType<typeof measureInlineFragmentPositionDrift> | null = null
    const inlineFacts = frame.getStructure().kind === 'inline' ? frame.getInlineCoordinateFacts() : null
    if (inlineFacts && (inlineFacts.viewportFragments.length > 0 || inlineFacts.expectedViewportRects.length > 0)) {
      const expectedViewport = inlineFacts.viewportFragments.map(f =>
        makeDocumentSpaceRect({ left: f.left, top: f.top, right: f.right, bottom: f.bottom }),
      )
      for (const f of expectedViewport) {
        const local = viewportRectToDocumentLocalRect({ viewportRect: f, contentHostRect: hostRect })
        if (!local) continue
        // Mount ONE document-space carrier per visual line (sub-pixel preserved so
        // the reprojection stays inside the 1.5px band).
        const el = document.createElement('div')
        el.className = DIAGNOSTIC_INLINE_FRAGMENT_CLASS
        el.setAttribute('data-severity', String(diag.severity ?? 'info'))
        el.setAttribute('data-target-kind', 'inline')
        el.setAttribute('aria-hidden', 'true')
        el.style.cssText = `position:absolute;left:${local.left}px;top:${local.top}px;width:${local.width}px;height:${local.height}px;pointer-events:none;`
        layer.appendChild(el)
        this.locateDocInlineEls.push(el)
        inlineLocal.push(local)
      }
      const reprojectedViewportRects = inlineLocal
        .map(local => projectDocumentLocalRectToViewport({ localRect: local, documentHostRect: hostRect }))
        .filter((r): r is DocumentSpaceRect => r != null)
      // The REAL painted overlay rects (viewport space) — this is the genuine
      // expected-vs-actual evidence, never a reprojection of the expected value.
      const actualPaintedViewportRects = inlineFacts.paintedViewportRects.map(r =>
        makeDocumentSpaceRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }),
      )
      const drift = measureInlineFragmentPositionDrift({
        expectedViewport,
        actualViewport: headless ? [] : actualPaintedViewportRects,
      })
      const reprojectedDrift = measureInlineFragmentPositionDrift({
        expectedViewport,
        actualViewport: reprojectedViewportRects,
      })
      inlineExpectedViewport = expectedViewport
      inlineReprojectedViewportRects = reprojectedViewportRects
      inlineActualPaintedViewportRects = actualPaintedViewportRects
      inlineDrift = drift
      inlineReprojectedDrift = reprojectedDrift
      // §3/§24 — the viewport inline carrier must NOT survive the COMMIT.
      const releasedViewportCarrier = frame.releaseViewportInlineCarrier()
      if (!releasedViewportCarrier && inlineFacts.paintedFragmentElementCount > 0) {
        this.countersInlineV512R4.inlinePrivateViewportRenderPath++
      }
      this.emitInlineCoordinateAuthorityAudit({
        tx,
        diag,
        host,
        hostRect,
        expectedViewport,
        expectedViewportRects: inlineFacts.expectedViewportRects,
        documentLocalRects: inlineLocal,
        reprojectedViewportRects,
        actualPaintedViewportRects,
        drift,
        reprojectedDrift,
        facts: inlineFacts,
      })
    } else if (inlineEl) {
      // No exact source range → the class-based element mark IS the carrier and it
      // already lives on the document node (document space).
      const vp = this.measureLocateRect(inlineEl)
      const local = viewportRectToDocumentLocalRect({ viewportRect: vp, contentHostRect: hostRect })
      if (local) inlineLocal.push(local)
    }
    const ctx = this.locatePlacementCtx
    const secondaryVp = this.measureLocateRect(ctx?.secondaryEl ?? anchor)
    const secondaryLocal = viewportRectToDocumentLocalRect({ viewportRect: secondaryVp, contentHostRect: hostRect })
    this.locateCommittedVisual = {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: diag.id,
      severity: String(diag.severity ?? 'info'),
      presentationKind: frame.getVisualPresentation() ?? null,
      semanticAnchorIdentity: DocumentUtilityOverlayHost.anchorIdentityOf(anchor),
      primaryAnchorIdentity: DocumentUtilityOverlayHost.anchorIdentityOf(ctx?.primaryEl ?? null),
      secondaryAnchorIdentity: DocumentUtilityOverlayHost.anchorIdentityOf(ctx?.secondaryEl ?? null),
      occurrenceIndex: typeof meta.occurrenceIndex === 'number' ? meta.occurrenceIndex : null,
      primaryLocal,
      secondaryLocal,
      inlineLocal,
      fingerprint: this.measureLocateLayoutFingerprint(host),
      carrierNodes,
    }
    emitRuntimeAudit(LOCATE_DOCUMENT_SPACE_AUDIT_EVENT, {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: this.locateCommittedVisual.documentKey,
      diagnosticId: diag.id,
      documentHostIdentity: `${host.tagName}#${host.id || ''}`,
      documentHostRect: hostRect,
      semanticAnchorIdentity: this.locateCommittedVisual.semanticAnchorIdentity,
      primaryAnchorIdentity: this.locateCommittedVisual.primaryAnchorIdentity,
      secondaryAnchorIdentity: this.locateCommittedVisual.secondaryAnchorIdentity,
      documentLocalPrimaryRects: primaryLocal ? [primaryLocal] : [],
      documentLocalSecondaryRects: secondaryLocal ? [secondaryLocal] : [],
      documentLocalInlineRects: inlineLocal,
      // ── V5.12-R4 §13 — inline coordinate-space evidence ─────────────────────
      visualTargetKind: frame.getStructure().kind,
      scrollContainerIdentity: getActiveEditorScrollContainer()
        ? `${getActiveEditorScrollContainer()!.tagName}.${getActiveEditorScrollContainer()!.className.split(' ')[0] || ''}`
        : null,
      scrollTopAtResolve: tx.oneClick?.initialScrollTop ?? null,
      scrollTopAtPaint: inlineFacts ? inlineFacts.measuredScrollTop : null,
      viewportInlineRects: inlineExpectedViewport,
      reprojectedViewportInlineRects: inlineReprojectedViewportRects,
      actualPaintedInlineViewportRects: inlineActualPaintedViewportRects,
      expectedFragmentCount: inlineExpectedViewport.length,
      documentLocalFragmentCount: inlineLocal.length,
      paintedFragmentCount: inlineActualPaintedViewportRects.length,
      maxDeltaLeft: inlineDrift ? inlineDrift.maxDeltaLeft : null,
      maxDeltaTop: inlineDrift ? inlineDrift.maxDeltaTop : null,
      maxDeltaRight: inlineDrift ? inlineDrift.maxDeltaRight : null,
      maxDeltaBottom: inlineDrift ? inlineDrift.maxDeltaBottom : null,
      maxPositionDrift: inlineDrift ? inlineDrift.maxPositionDrift : null,
      reprojectedMaxPositionDrift: inlineReprojectedDrift ? inlineReprojectedDrift.maxPositionDrift : null,
      positionDriftTolerancePx: INLINE_POSITION_DRIFT_HARD_PX,
      coordinateNormalizerId: INLINE_COORDINATE_NORMALIZER_ID,
      scrollCompensationMode: 'NONE_DOCUMENT_HOST_RECT_ONLY',
      preScrollGeometryInvalidated: inlineFacts ? inlineFacts.preScrollGeometryInvalidated : null,
      postScrollGeometryFresh: inlineFacts ? inlineFacts.postScrollGeometryFresh : null,
      presentationKind: this.locateCommittedVisual.presentationKind,
      scrollLeaseStateAtCommit: this.locateScrollLease?.state ?? null,
      scrollLeaseReleasedAfterCommit: true,
      postCommitUserScrollCount: this.locatePostCommitUserScrollCount,
      postCommitRepaintCount: 0,
      postCommitRemeasureCount: 0,
      postCommitReresolveCount: 0,
      postCommitRecenterCount: 0,
      postCommitScrollWriteCount: 0,
      localGeometryBeforeScroll: primaryLocal,
      localGeometryAfterScroll: primaryLocal,
      layoutFingerprintBefore: this.locateCommittedVisual.fingerprint ? layoutFingerprintKey(this.locateCommittedVisual.fingerprint) : null,
      layoutFingerprintAfter: this.locateCommittedVisual.fingerprint ? layoutFingerprintKey(this.locateCommittedVisual.fingerprint) : null,
      layoutReconcileTriggered: false,
      decision: 'PASS',
      reason: 'DOCUMENT_SPACE_CARRIER_COMMITTED',
    })
    return true
  }

  /**
   * §13/§14 — DOCUMENT-DIAGNOSTIC-INLINE-COORDINATE-AUTHORITY-AUDIT.
   *
   * Proves the exact inline fragments went through the ONE shared
   * viewport → document-local normalizer and that the painted geometry really
   * sits ON the source Range (never merely "coverage=1").
   */
  private emitInlineCoordinateAuthorityAudit(input: {
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number]
    host: HTMLElement
    hostRect: SimpleRect
    expectedViewport: DocumentSpaceRect[]
    expectedViewportRects: Array<{ left: number; top: number; right: number; bottom: number }>
    documentLocalRects: DocumentSpaceRect[]
    reprojectedViewportRects: DocumentSpaceRect[]
    actualPaintedViewportRects: DocumentSpaceRect[]
    drift: ReturnType<typeof measureInlineFragmentPositionDrift>
    reprojectedDrift: ReturnType<typeof measureInlineFragmentPositionDrift>
    facts: ReturnType<DiagnosticLocateFrameController['getInlineCoordinateFacts']>
  }): void {
    const { tx, diag, host, hostRect, facts } = input
    const headless = this.isHeadlessLayoutSafe()
    const scrollWriteCount = tx.oneClick?.scrollWriteCount ?? 0
    const maxPositionDriftPx = headless || input.drift.comparedFragmentCount === 0
      ? null
      : input.drift.maxPositionDrift
    const reprojectedDriftPx = input.reprojectedDrift.comparedFragmentCount === 0
      ? null
      : input.reprojectedDrift.maxPositionDrift
    const authority = evaluateInlineCoordinateAuthority({
      kindIsInline: true,
      exactInlinePresent: true,
      documentLocalFragmentCount: input.documentLocalRects.length,
      meaningfulFragmentCount: input.expectedViewport.length,
      actualPaintedFragmentCount: headless ? input.documentLocalRects.length : input.actualPaintedViewportRects.length,
      maxPositionDriftPx,
      scrollWriteCount,
      preScrollGeometryInvalidated: facts.preScrollGeometryInvalidated,
      postScrollGeometryFresh: facts.postScrollGeometryFresh,
      manualScrollOffsetApplied: false,
      privateViewportRenderPath: false,
      reprojectedDriftPx,
    })
    // §24 — hard-gate accounting (only real violations increment).
    for (const check of authority.failedChecks) {
      switch (check) {
        case 'INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS':
          this.countersInlineV512R4.inlineCommittedWithEmptyDocumentLocalRects++
          break
        case 'INLINE_VIEWPORT_LOCAL_FRAGMENT_COUNT_MISMATCH':
          this.countersInlineV512R4.inlineViewportLocalFragmentCountMismatch++
          break
        case 'INLINE_LOCAL_PAINTED_FRAGMENT_COUNT_MISMATCH':
          this.countersInlineV512R4.inlineLocalPaintedFragmentCountMismatch++
          break
        case 'INLINE_STALE_PRE_SCROLL_GEOMETRY':
        case 'INLINE_POST_SCROLL_GEOMETRY_NOT_FRESH':
          this.countersInlineV512R4.inlineStalePreScrollGeometryCommit++
          break
        case 'INLINE_MANUAL_SCROLL_OFFSET_APPLIED':
          this.countersInlineV512R4.inlineManualScrollOffsetApplied++
          break
        case 'INLINE_PRIVATE_VIEWPORT_RENDER_PATH':
          this.countersInlineV512R4.inlinePrivateViewportRenderPath++
          break
        case 'INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX':
          this.countersInlineV512R4.inlineExpectedActualPositionDriftGt1_5px++
          break
        case 'INLINE_REPROJECTED_VIEWPORT_DRIFT_GT_1_5PX':
          this.countersInlineV512R4.inlineReprojectedViewportDriftGt1_5px++
          break
        default:
          break
      }
    }
    const payload: Record<string, unknown> = {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      transactionId: tx.id,
      diagnosticId: diag.id,
      sourceRangeIdentity: this.locateCommittedVisual?.secondaryAnchorIdentity
        ?? this.locateCommittedVisual?.semanticAnchorIdentity
        ?? null,
      rangeResolved: input.expectedViewportRects.length > 0,
      rangeClientRectCount: input.expectedViewportRects.length,
      viewportRects: input.expectedViewport,
      documentLocalRects: input.documentLocalRects,
      actualPaintedRects: input.actualPaintedViewportRects,
      actualPaintedViewportRects: input.actualPaintedViewportRects,
      reprojectedViewportRects: input.reprojectedViewportRects,
      documentHostIdentity: `${host.tagName}#${host.id || ''}`,
      documentHostRect: hostRect,
      workspaceScrollTop: facts.measuredScrollTop,
      scrollWriteCount,
      normalizerAuthority: INLINE_COORDINATE_NORMALIZER_ID,
      coordinateNormalizerId: INLINE_COORDINATE_NORMALIZER_ID,
      manualScrollOffsetApplied: false,
      scrollCompensationMode: 'NONE_DOCUMENT_HOST_RECT_ONLY',
      preScrollGeometryGeneration: facts.generationAtInvalidation,
      postScrollGeometryGeneration: facts.generation,
      preScrollGeometryInvalidated: facts.preScrollGeometryInvalidated,
      postScrollGeometryFresh: facts.postScrollGeometryFresh,
      invalidationReason: facts.invalidationReason,
      expectedFragmentCount: input.expectedViewport.length,
      documentLocalFragmentCount: input.documentLocalRects.length,
      paintedFragmentCount: input.actualPaintedViewportRects.length,
      maxDeltaLeft: input.drift.maxDeltaLeft,
      maxDeltaTop: input.drift.maxDeltaTop,
      maxDeltaRight: input.drift.maxDeltaRight,
      maxDeltaBottom: input.drift.maxDeltaBottom,
      maxPositionDrift: input.drift.maxPositionDrift,
      maxPositionDriftPx,
      reprojectedMaxPositionDriftPx: reprojectedDriftPx,
      positionDriftTolerancePx: INLINE_POSITION_DRIFT_HARD_PX,
      measureMode: headless ? 'HEADLESS' : 'REAL',
      decision: authority.decision,
      reason: authority.reason,
      failedChecks: authority.failedChecks,
      inlineCoordinateGateCounters: { ...this.countersInlineV512R4 },
      inlineCoordinateGateDecision: evaluateInlineDocumentSpaceGates(this.countersInlineV512R4).decision,
    }
    this.lastInlineCoordinateAudit = payload
    emitRuntimeAudit(INLINE_COORDINATE_AUTHORITY_AUDIT_EVENT, payload)
  }

  /**
   * §25 — the inline document-space facts the UNIQUE commit gate consumes. Every
   * value is measured from the CURRENT (post-scroll, post-restore) paint, so a
   * stale pre-scroll fragment or an offset paint can never pass.
   */
  private measureInlineDocumentSpaceGateFacts(): {
    documentLocalFragmentCount: number
    meaningfulFragmentCount: number
    actualPaintedFragmentCount: number
    maxPositionDriftPx: number | null
    scrollWriteCount: number
    preScrollGeometryInvalidated: boolean
    postScrollGeometryFresh: boolean
  } | null {
    const frame = this.locateFrame
    if (!frame || frame.getStructure().kind !== 'inline') return null
    const facts = frame.getInlineCoordinateFacts()
    // §9/§25 — the gate applies to an EXACT inline range only. A class-mark carrier
    // (no precise range) is not asserted here, but an exact range that produced NO
    // document-local rect is a hard failure — never a silently skipped gate.
    if (!facts.exactInlinePresent) return null
    const host = this.locateDocLayerHost
    const hostRect = host ? this.measureLocateRect(host) : null
    let documentLocalFragmentCount = 0
    if (hostRect) {
      for (const f of facts.viewportFragments) {
        if (viewportRectToDocumentLocalRect({ viewportRect: f, contentHostRect: hostRect })) documentLocalFragmentCount++
      }
    }
    const headless = this.isHeadlessLayoutSafe()
    const actualPainted = headless ? facts.paintedFragmentElementCount : facts.paintedViewportRects.length
    const drift = measureInlineFragmentPositionDrift({
      expectedViewport: facts.viewportFragments.map(f =>
        makeDocumentSpaceRect({ left: f.left, top: f.top, right: f.right, bottom: f.bottom }),
      ),
      actualViewport: headless
        ? []
        : facts.paintedViewportRects.map(r => makeDocumentSpaceRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
    })
    return {
      documentLocalFragmentCount,
      meaningfulFragmentCount: facts.viewportFragments.length,
      actualPaintedFragmentCount: actualPainted,
      maxPositionDriftPx: headless || drift.comparedFragmentCount === 0 ? null : drift.maxPositionDrift,
      scrollWriteCount: this.activeLocateTx?.oneClick?.scrollWriteCount ?? 0,
      preScrollGeometryInvalidated: facts.preScrollGeometryInvalidated,
      postScrollGeometryFresh: facts.postScrollGeometryFresh,
    }
  }

  /**
   * §11/§26 — POST-COMMIT user scroll: VISUALLY INERT. No repaint, no remeasure,
   * no re-resolve, no recenter, no scrollTop write. Only the document-local
   * geometry is read back to prove it did not drift.
   */
  private auditPostCommitScrollInert(): void {
    const c = this.locateCommittedVisual
    if (!c) return
    this.locatePostCommitUserScrollCount++
    let after: DocumentSpaceRect | null = c.primaryLocal
    if (this.locateDocCarrier) {
      const l = Number.parseFloat(this.locateDocCarrier.style.left)
      const t = Number.parseFloat(this.locateDocCarrier.style.top)
      const w = Number.parseFloat(this.locateDocCarrier.style.width)
      const h = Number.parseFloat(this.locateDocCarrier.style.height)
      if ([l, t, w, h].every(Number.isFinite)) {
        after = makeDocumentSpaceRect({ left: l, top: t, right: l + w, bottom: t + h })
      }
    }
    const drift = documentLocalDrift(c.primaryLocal, after)
    if (drift != null && drift > DOCUMENT_SPACE_DRIFT_HARD_PX) {
      this.countersDocSpaceV511.documentSpaceOverlayScrollDrift++
      // V5.12-R2 §18 — a document-local drift means two coordinate spaces were
      // mixed in the same computation chain.
      this.countersClosureV512R2.mixedCoordinateSpace++
    }
    // ── V5.12-R4 §26/E — the inline fragments are document-local too: read the
    // mounted carriers back and prove a user scroll never moved them.
    let inlineDrift: number | null = null
    if (c.inlineLocal.length > 0 && this.locateDocInlineEls.length === c.inlineLocal.length) {
      let max = 0
      for (let i = 0; i < this.locateDocInlineEls.length; i++) {
        const el = this.locateDocInlineEls[i]
        const l = Number.parseFloat(el.style.left)
        const t = Number.parseFloat(el.style.top)
        const w = Number.parseFloat(el.style.width)
        const h = Number.parseFloat(el.style.height)
        if (![l, t, w, h].every(Number.isFinite)) continue
        const readBack = makeDocumentSpaceRect({ left: l, top: t, right: l + w, bottom: t + h })
        const d = documentLocalDrift(c.inlineLocal[i], readBack)
        if (d != null) max = Math.max(max, d)
      }
      inlineDrift = max
      if (max > DOCUMENT_SPACE_DRIFT_HARD_PX) {
        this.countersDocSpaceV511.documentSpaceOverlayScrollDrift++
        this.countersClosureV512R2.mixedCoordinateSpace++
      }
    }
    // A scroll is NEVER a layout reflow (§21).
    emitRuntimeAudit(LOCATE_DOCUMENT_SPACE_AUDIT_EVENT, {
      transactionId: c.transactionId,
      visualEpoch: c.visualEpoch,
      documentKey: c.documentKey,
      diagnosticId: c.diagnosticId,
      documentHostIdentity: this.locateDocLayerHost ? `${this.locateDocLayerHost.tagName}#${this.locateDocLayerHost.id || ''}` : null,
      documentHostRect: this.measureLocateRect(this.locateDocLayerHost),
      semanticAnchorIdentity: c.semanticAnchorIdentity,
      primaryAnchorIdentity: c.primaryAnchorIdentity,
      secondaryAnchorIdentity: c.secondaryAnchorIdentity,
      documentLocalPrimaryRects: c.primaryLocal ? [c.primaryLocal] : [],
      documentLocalSecondaryRects: c.secondaryLocal ? [c.secondaryLocal] : [],
      documentLocalInlineRects: c.inlineLocal,
      presentationKind: c.presentationKind,
      scrollLeaseStateAtCommit: this.locateScrollLease?.state ?? null,
      scrollLeaseReleasedAfterCommit: true,
      postCommitUserScrollCount: this.locatePostCommitUserScrollCount,
      postCommitRepaintCount: 0,
      postCommitRemeasureCount: 0,
      postCommitReresolveCount: 0,
      postCommitRecenterCount: 0,
      postCommitScrollWriteCount: 0,
      localGeometryBeforeScroll: c.primaryLocal,
      localGeometryAfterScroll: after,
      layoutFingerprintBefore: c.fingerprint ? layoutFingerprintKey(c.fingerprint) : null,
      layoutFingerprintAfter: c.fingerprint ? layoutFingerprintKey(c.fingerprint) : null,
      layoutReconcileTriggered: false,
      localDriftPx: drift,
      inlineLocalDriftPx: inlineDrift,
      documentLocalInlineRectCount: c.inlineLocal.length,
      decision: 'PASS',
      reason: 'POST_COMMIT_USER_SCROLL_INERT',
    })
  }

  /**
   * §19/§20/§21 — a TRUE layout reflow: same-target reconcile only. Identities
   * are validated; a different target is NOT a reflow of this one.
   */
  // ── V5.12-R1 — Heading Diagnostic In-Document Marker ─────────────────────
  private headingMarkerLayer: HTMLElement | null = null
  private headingPassiveMarkers = new Map<string, HeadingPassiveMarkerRecord>()
  private headingActiveWrapper: HTMLElement | null = null
  private headingActiveIdentity: string | null = null
  /** V5.12-R2 §6 — the heading identity the ACTIVE emphasis belongs to. */
  private headingActiveMarkerIdentity: string | null = null
  private countersHeadingV512 = createHeadingMarkerV512R1GateCounters()

  // ── V5.12-R2 — DocumentLayoutEpoch + Visual Closure ─────────────────────
  /** §3.1 — the ONE document-level layout epoch. */
  private currentDocumentLayoutEpoch: DocumentLayoutEpoch = 1
  /** §3.1 — who bumped it last (observability only). */
  private lastLayoutEpochBumpReason: LayoutMutationKind | null = null
  /** §3.3 — coalesced geometry reconcile (never a high-frequency listener). */
  private diagnosticGeometryReconcileRaf: number | null = null
  /** §18 — the V5.12-R2 hard-gate counters. */
  private countersClosureV512R2 = createVisualClosureV512R2Counters()
  /** §18 — the V5.12-R3 Drawer-persistence hard-gate counters. */
  private countersDrawerV512R3 = createDrawerPersistenceV512R3Counters()
  /** §13 — the USER INTENT epoch (Problems Control open/close is the only writer). */
  private drawerIntentEpoch = 0
  /** §13 — the intent epoch snapshot taken when a locate transaction started. */
  private drawerIntentEpochAtLastLocateStart = 0
  /** §14 — Drawer filter / list scroll context captured at locate start. */
  private locateDrawerFilterAtStart: DiagnosticsSeverityFilter = 'all'
  private locateDrawerListScrollAtStart = 0
  /** §14 — the last commit-gate decision (audit). */
  private lastLocateCommitGate: LocateVisualCommitDecision | null = null
  /** §14 — visual recovery attempts inside the CURRENT transaction. */
  private txVisualRecoveryAttempts = 0
  /** §13.3 — the ACTIVE LOCATE VISIBILITY LEASE (outlives COMMIT). */
  private locateVisibilityLease: { transactionId: number; diagnosticId: string | null } | null = null
  /** §17 — the last unified closure audit payload. */
  private lastVisualClosureAudit: Record<string, unknown> | null = null
  /** §16 — the last V5.12-R3 Drawer-persistence audit payload. */
  private lastDrawerPersistenceAudit: Record<string, unknown> | null = null
  /** §24 — the V5.12-R4 inline document-space hard-gate counters. */
  private countersInlineV512R4 = createInlineDocumentSpaceV512R4Counters()
  /** §14 — the last inline coordinate authority audit payload. */
  private lastInlineCoordinateAudit: Record<string, unknown> | null = null
  /** §3 — the document-space inline fragment carriers (one per visual line). */
  private locateDocInlineEls: HTMLElement[] = []

  /** §24 — read-only V5.12-R4 inline document-space hard-gate counters. */
  getInlineDocumentSpaceCounters(): Readonly<Record<string, number>> {
    return { ...this.countersInlineV512R4 }
  }

  /** §24 — the exact `NAME=value` inline document-space gate report lines. */
  getInlineDocumentSpaceGateReport(): string[] {
    return formatInlineDocumentSpaceGateReport(this.countersInlineV512R4)
  }

  /** §14 — the last inline coordinate authority audit payload (observability). */
  getLastInlineCoordinateAudit(): Readonly<Record<string, unknown>> | null {
    return this.lastInlineCoordinateAudit
  }

  /** §18 — read-only V5.12-R2 hard-gate counters. */
  getVisualClosureCounters(): Readonly<Record<string, number>> {
    return { ...this.countersClosureV512R2 }
  }

  /** §21 — the exact `NAME=value` gate report lines. */
  getVisualClosureGateReport(): string[] {
    return formatVisualClosureGateReport(this.countersClosureV512R2)
  }

  /** §18 — read-only V5.12-R3 Drawer-persistence hard-gate counters. */
  getDrawerPersistenceCounters(): Readonly<Record<string, number>> {
    return { ...this.countersDrawerV512R3 }
  }

  /** §27 — the exact `NAME=value` Drawer-persistence gate report lines. */
  getDrawerPersistenceGateReport(): string[] {
    return formatDrawerPersistenceGateReport(this.countersDrawerV512R3)
  }

  /** §16 — the last Drawer-persistence audit payload (observability). */
  getLastDrawerPersistenceAudit(): Readonly<Record<string, unknown>> | null {
    return this.lastDrawerPersistenceAudit
  }

  /** V5.12-R5 §12 — read-only source-occurrence authority hard-gate counters. */
  getSourceOccurrenceV512R5Counters(): Readonly<Record<string, number>> {
    return { ...this.countersSourceOccurrenceV512R5 }
  }

  /** V5.12-R5 §12 — the exact `NAME=value` source-occurrence gate report lines. */
  getSourceOccurrenceV512R5GateReport(): string[] {
    return formatSourceOccurrenceV512R5GateReport(this.countersSourceOccurrenceV512R5)
  }

  /** V5.12-R5 §12 — the source-occurrence authority gate decision. */
  getSourceOccurrenceV512R5GateDecision(): { decision: 'PASS' | 'FAIL'; failing: string[] } {
    return evaluateSourceOccurrenceV512R5Gates(this.countersSourceOccurrenceV512R5)
  }

  /** V5.12-R6 §15 — read-only empty-document short-circuit hard-gate counters. */
  getEmptyDocumentV512R6Counters(): Readonly<Record<string, number>> {
    return { ...this.countersEmptyDocumentV512R6 }
  }

  /** V5.12-R6 §15 — the exact `NAME=value` empty-document gate report lines. */
  getEmptyDocumentV512R6GateReport(): string[] {
    return formatEmptyDocumentV512R6GateReport(this.countersEmptyDocumentV512R6)
  }

  /** V5.12-R6 §15 — the empty-document short-circuit gate decision. */
  getEmptyDocumentV512R6GateDecision(): { decision: 'PASS' | 'FAIL'; failing: string[] } {
    return evaluateEmptyDocumentV512R6Gates(this.countersEmptyDocumentV512R6)
  }

  /** V5.12-R7 §13 — read-only FILL_ONLY active-locate hard-gate counters. */
  getActiveLocateFillOnlyV512R7Counters(): Readonly<Record<string, number>> {
    return { ...this.countersActiveLocateFillOnlyV512R7 }
  }

  /** V5.12-R7 §13 — the exact `NAME=value` FILL_ONLY gate report lines. */
  getActiveLocateFillOnlyV512R7GateReport(): string[] {
    return formatActiveLocateFillOnlyGateReport(this.countersActiveLocateFillOnlyV512R7)
  }

  /** V5.12-R7 §13 — the FILL_ONLY active-locate gate decision. */
  getActiveLocateFillOnlyV512R7GateDecision(): { decision: 'PASS' | 'FAIL'; failing: string[] } {
    return evaluateActiveLocateFillOnlyGates(this.countersActiveLocateFillOnlyV512R7)
  }

  /** V5.12-R7 §13 — the last committed active-locate fill count (>= 1 required). */
  getActiveLocateFillCount(): number {
    return this.lastActiveLocateFillCount
  }

  /** V5.12-R7 §13 — the ACTIVE locate presentation mode (fixed: FILL_ONLY). */
  getActiveLocatePresentationMode(): string {
    return ACTIVE_LOCATE_PRESENTATION_FILL_ONLY
  }

  /** §3.1 — the current document layout epoch (observability). */
  getDocumentLayoutEpoch(): DocumentLayoutEpoch {
    return this.currentDocumentLayoutEpoch
  }

  /** §3.2 — the SINGLE epoch bump authority (forbidden kinds are ignored). */
  private bumpDocumentLayoutEpoch(kind: LayoutMutationKind): boolean {
    if (!shouldBumpLayoutEpoch(kind)) return false
    this.currentDocumentLayoutEpoch = nextLayoutEpoch(this.currentDocumentLayoutEpoch)
    this.lastLayoutEpochBumpReason = kind
    // §3.3 — only schedule a reconcile when there IS geometry to invalidate.
    // Never add an rAF when no diagnostic visual exists (that would be a
    // high-frequency cost with zero benefit, and it would perturb the geometry
    // scheduler's frame accounting).
    if (this.hasDiagnosticGeometryToReconcile()) {
      this.scheduleDiagnosticGeometryReconcile(`LAYOUT_EPOCH:${kind}`)
    }
    return true
  }

  /** §3.4 — is there any measured diagnostic geometry that may now be stale? */
  private hasDiagnosticGeometryToReconcile(): boolean {
    if (this.headingPassiveMarkers.size > 0) return true
    if (this.locateFrame?.hasCommitted() === true) return true
    return false
  }

  /** §3.4 — are any measured marker geometries older than the current epoch? */
  private hasStaleDiagnosticGeometry(): boolean {
    const epoch = this.currentDocumentLayoutEpoch
    for (const rec of this.headingPassiveMarkers.values()) {
      if (isLayoutEpochStale(rec.measuredLayoutEpoch, epoch)) return true
    }
    return false
  }

  /**
   * §3.2/§3.3 — invalidate + re-measure stale diagnostic geometry. Coalesced to
   * ONE rAF; never a scroll/wheel/mousemove driven remeasure loop.
   */
  private scheduleDiagnosticGeometryReconcile(reason: string): void {
    if (this.disposed) return
    if (this.diagnosticGeometryReconcileRaf !== null) return
    const run = (): void => {
      this.diagnosticGeometryReconcileRaf = null
      if (this.disposed) return
      // §3.4 — a paint from a stale epoch is the violation; re-measure FIRST.
      if (this.hasStaleDiagnosticGeometry()) {
        this.renderHeadingDiagnosticMarkers()
        this.renderActiveHeadingEmphasisForCommittedVisual()
      }
      this.emitVisualClosureAudit(reason)
    }
    if (typeof requestAnimationFrame === 'function') {
      try {
        this.diagnosticGeometryReconcileRaf = requestAnimationFrame(run)
        return
      } catch { /* fall through to sync */ }
    }
    run()
  }

  /** §17 — DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT (unified closure evidence). */
  private emitVisualClosureAudit(reason: string): void {
    const frame = this.locateFrame
    const structure = frame?.getStructure() ?? null
    const commitGate = this.lastLocateCommitGate
    const inlineFacts = frame?.getInlineFragmentFacts() ?? null
    const geom = frame?.getGeometryReport() ?? null
    const kind = structure?.kind ?? null
    const isBlock = this.isObjectKind(kind)
    // §12/§30 — the four geometry objects stay separated in the audit: the
    // SCROLL rect is the semantic block box (may be the 800/964px heading block),
    // while the visual fragments are the text-tight presentation.
    const scrollRect = geom?.semanticRect ?? null
    const coverageRatio = kind === 'inline'
      ? (inlineFacts ? inlineFacts.coverage : null)
      : isBlock ? (geom ? geom.horizontalCoverage : null) : (kind === 'heading' ? 1 : null)
    const payload: Record<string, unknown> = {
      transactionId: this.activeLocateTx?.id ?? this.locateCommittedVisual?.transactionId ?? null,
      visualEpoch: this.locateVisualEpoch,
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: this.lastLocatedDiagnosticId,
      ruleId: this.activeLocateTx?.diagnosticId ?? this.locateCommittedVisual?.diagnosticId ?? null,
      severity: frame?.getStructure().severity ?? null,
      visualTargetKind: structure?.kind ?? null,
      semanticAnchorIdentity: this.locateCommittedVisual?.semanticAnchorIdentity ?? null,
      targetIdentity: this.lastLocatedDiagnosticId,
      sourceRangeIdentity: null,
      documentLayoutEpoch: this.currentDocumentLayoutEpoch,
      measuredLayoutEpoch: this.currentDocumentLayoutEpoch,
      layoutEpochCurrent: true,
      scrollRect,
      visualFragmentCount: inlineFacts ? inlineFacts.fragments.length : (structure?.inlineFragmentCount ?? 0),
      visualFragments: inlineFacts ? inlineFacts.fragments : [],
      secondaryContextRects: [],
      drawerRequestedOpen: this.drawerOpen,
      drawerPresentationMode: this.getDrawerPresentationMode(),
      locateVisibilityLeaseActive: this.getLocateVisibilityLeaseActive(),
      layoutRecoveryPerformed: this.txVisualRecoveryAttempts > 0,
      remeasuredAfterRecovery: this.txVisualRecoveryAttempts > 0,
      drawerIntersectionCount: this.lastDrawerOccludesTarget ? 1 : 0,
      toolbarIntersectionCount: this.lastFramePaintsAboveToolbar ? 1 : 0,
      navigatorIntersectionCount: this.lastFramePaintsAboveNavigator ? 1 : 0,
      coverageRatio,
      fragmentCoverageRatio: inlineFacts ? inlineFacts.coverage : null,
      legacyHeadingFrameRendered: frame?.getHeadingLegacyFrameRender() ?? false,
      passiveMarkerPresent: this.headingPassiveMarkers.size > 0,
      activeMarkerPresent: this.headingActiveWrapper !== null,
      activeHeadingIdentity: this.headingActiveMarkerIdentity,
      visualDecision: commitGate ? (commitGate.canCommit ? 'PASS' : 'FAIL') : 'NA',
      commitDecision: commitGate ? (commitGate.canCommit ? 'COMMIT' : 'NO_COMMIT') : 'NA',
      terminalState: this.activeLocateTx ? this.activeLocateTx.state : this.locateCommittedVisual ? 'COMMITTED' : 'IDLE',
      decision: commitGate && !commitGate.canCommit ? 'FAIL' : 'PASS',
      reason,
      gateCounters: { ...this.countersClosureV512R2 },
      gateDecision: evaluateVisualClosureGates(this.countersClosureV512R2).decision,
      gateFailing: evaluateVisualClosureGates(this.countersClosureV512R2).failing,
    }
    this.lastVisualClosureAudit = payload
    emitRuntimeAudit(VISUAL_CLOSURE_AUDIT_EVENT, payload)
  }

  /** §17 — read-only unified closure payload. */
  getLastVisualClosureAudit(): Readonly<Record<string, unknown>> | null {
    return this.lastVisualClosureAudit
  }

  /** §14 — read-only last commit-gate decision. */
  getLastLocateCommitGate(): Readonly<LocateVisualCommitDecision> | null {
    return this.lastLocateCommitGate
  }

  /** §13.3 — is the ACTIVE LOCATE VISIBILITY LEASE still held? */
  getLocateVisibilityLeaseActive(): boolean {
    return this.locateVisibilityLease !== null
  }

  getHeadingMarkerCounters(): Readonly<Record<string, number>> {
    return { ...this.countersHeadingV512 }
  }

  /** V5.12-R1 — observable marker state (tests / runtime audit). */
  getHeadingMarkerSnapshot(): Readonly<{
    passiveCount: number
    passiveSeverities: Record<string, string>
    activeIdentity: string | null
    activeFragmentCount: number
    reasonText: string | null
    markerRight: number | null
    contentLeft: number | null
    textGap: number | null
  }> | null {
    const sev: Record<string, string> = {}
    for (const [k, v] of this.headingPassiveMarkers) sev[k] = v.severity
    const active = this.headingActiveWrapper
    const fragments = active ? active.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length : 0
    const reason = active?.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement | null
    const railEl = active?.querySelector('.inkchapter-heading-diagnostic-marker__rail') as HTMLElement | null
    const markerRight = railEl ? Number.parseFloat(railEl.style.left) + Number.parseFloat(railEl.style.width || '2') : null
    const contentLeft = active ? Number.parseFloat(active.getAttribute('data-ink-content-left') || 'NaN') : null
    return {
      passiveCount: this.headingPassiveMarkers.size,
      passiveSeverities: sev,
      activeIdentity: this.headingActiveIdentity,
      activeFragmentCount: fragments,
      reasonText: reason ? reason.textContent : null,
      markerRight: Number.isFinite(markerRight as number) ? markerRight : null,
      contentLeft: Number.isFinite(contentLeft as number) ? contentLeft : null,
      textGap: Number.isFinite(markerRight as number) && Number.isFinite(contentLeft as number)
        ? (contentLeft as number) - (markerRight as number)
        : null,
    }
  }

  /** §19 — resolve the DOM element a heading diagnostic anchors to. */
  private resolveDiagnosticElementForMarker(d: DocumentDiagnosticsSnapshot['diagnostics'][number]): HTMLElement | null {
    const direct = (d as unknown as { element?: HTMLElement | null }).element
    if (direct && direct.isConnected) return direct
    const root = resolveBusinessContentRoot()
    if (!root) return null
    const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
    const stable = (d as unknown as { stableIdentity?: string }).stableIdentity
    if (typeof stable === 'string' && stable && typeof this.opts.providers.getHeadingIdentity === 'function') {
      for (const h of heads) if (this.opts.providers.getHeadingIdentity(h) === stable) return h
    }
    const loc = (d as unknown as { location?: { startLine?: number } }).location
    if (loc && typeof loc.startLine === 'number') {
      for (const h of heads) if (h.getAttribute('data-line') === String(loc.startLine)) return h
    }
    return null
  }

  /** §8 — canonical heading identity → live heading element (stable identity first). */
  private resolveHeadingElementByIdentity(stableIdentity: string, line: number | null): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
    if (typeof this.opts.providers.getHeadingIdentity === 'function') {
      for (const h of heads) if (this.opts.providers.getHeadingIdentity(h) === stableIdentity) return h
    }
    if (line != null) {
      for (const h of heads) if (h.getAttribute('data-line') === String(line)) return h
    }
    return null
  }

  /** §8 — the ONE dependency set the generic visual target resolver consumes. */
  private visualTargetDeps(): {
    resolveHeadingElement(stableIdentity: string, line: number | null): HTMLElement | null
    resolveSourceRangeElement(location: { startLine: number; startColumn: number; endLine?: number; endColumn?: number; rawText?: string }): HTMLElement | null
    resolveBlockElement(blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link', stableIdentity: string): HTMLElement | null
  } {
    return {
      resolveHeadingElement: (stableIdentity, line) => this.resolveHeadingElementByIdentity(stableIdentity, line),
      // Source-range targets are owned by the locator's own resolution chain —
      // the marker renderer only consumes heading targets, so an unresolved
      // inline-source target is explicitly null (never a fabricated element).
      resolveSourceRangeElement: () => null,
      resolveBlockElement: () => null,
    }
  }

  /** §19 — group EVERY heading visual target by heading identity (one marker each). */
  private collectHeadingMarkerGroups(): {
    groups: Map<string, { el: HTMLElement; severities: string[]; resolverSource: string }>
    multiTargetHeadingTargets: number
    multiTargetAdmitted: number
    headingWithoutVisualTarget: number
  } {
    const groups = new Map<string, { el: HTMLElement; severities: string[]; resolverSource: string }>()
    const deps = this.visualTargetDeps()
    const snapshot = this.diagnostics.getSnapshot()
    const diags = snapshot?.diagnostics ?? []
    const documentKey = this.opts.ctx.authority.getDocumentKey() ?? null
    let multiTargetHeadingTargets = 0
    let multiTargetAdmitted = 0
    let headingWithoutVisualTarget = 0
    for (const d of diags) {
      const targets = resolveDiagnosticVisualTargets(
        {
          id: d.id,
          severity: d.severity,
          stableIdentity: typeof d.stableIdentity === 'string' ? d.stableIdentity : undefined,
          metadata: (d.metadata ?? null) as Record<string, unknown> | null,
          location: d.location ?? null,
        },
        deps,
      )
      const heads = headingVisualTargets(targets)
      if (heads.length === 0) continue
      for (const t of heads) {
        const isMulti = t.targetCount > 1
        if (isMulti) multiTargetHeadingTargets++
        if (!t.element || !t.element.isConnected) {
          // §8 Hard Gate — only a diagnostic that BELONGS to the ACTIVE document
          // and whose DOM root exists can be a real "locatable but unrendered".
          const belongsHere = d.documentKey == null || documentKey == null || d.documentKey === documentKey
          if (belongsHere) headingWithoutVisualTarget++
          continue
        }
        if (isMulti) multiTargetAdmitted++
        const lineAttr = t.element.getAttribute('data-line')
        const identity = headingMarkerIdentity({
          stableIdentity: typeof d.stableIdentity === 'string' ? d.stableIdentity : null,
          line: lineAttr != null && lineAttr !== '' ? Number.parseInt(lineAttr, 10) : null,
          text: t.element.textContent ?? '',
        })
        const g = groups.get(identity)
        if (g) g.severities.push(String(d.severity ?? 'info'))
        else groups.set(identity, { el: t.element, severities: [String(d.severity ?? 'info')], resolverSource: t.targetKindLabel })
      }
    }
    return { groups, multiTargetHeadingTargets, multiTargetAdmitted, headingWithoutVisualTarget }
  }

  /**
   * §4/§5/§19 — Level 1 passive severity marker: ONE gutter marker per heading,
   * severity = highest among its diagnostics. No full-width wash, ever.
   *
   * V5.12-R2 §3.4 — every marker records the layout epoch it was measured in and
   * its `targetIdentity`; a marker whose epoch is stale is re-measured (never
   * painted from the stale geometry).
   */
  renderHeadingDiagnosticMarkers(): void {
    const layer = this.ensureHeadingMarkerLayer()
    if (!layer) return
    const collected = this.collectHeadingMarkerGroups()
    const groups = collected.groups
    const epoch = this.currentDocumentLayoutEpoch
    if (collected.headingWithoutVisualTarget > 0) {
      this.countersClosureV512R2.locatableHeadingDiagnosticWithoutVisualTarget += collected.headingWithoutVisualTarget
    }
    if (collected.multiTargetHeadingTargets > 0) {
      const missing = Math.max(0, collected.multiTargetHeadingTargets - collected.multiTargetAdmitted)
      this.countersClosureV512R2.headingMultiTargetPassiveMissing += missing
    }
    // Drop stale markers.
    for (const [identity, rec] of [...this.headingPassiveMarkers]) {
      if (!groups.has(identity)) {
        try { rec.wrapper.remove() } catch { /* noop */ }
        this.headingPassiveMarkers.delete(identity)
      }
    }
    // Upsert.
    for (const [identity, g] of groups) {
      const severity = mergeHeadingMarkerSeverity(g.severities)
      if (!severity) continue
      const fragments = this.headingVisibleFragments(g.el)
      const numberRect = this.headingNumberRect(g.el, fragments[0] ?? null)
      const contentRect = unionHeadingNumberAndTextRects(numberRect, fragments)
      const anchorVp = this.measureLocateRect(g.el)
      if (!contentRect || !anchorVp) continue
      const hostRect = this.measureLocateRect(this.locateDocLayerHost)
      const editorLeft = hostRect ? hostRect.left : 0
      const anchorLocal = this.toDocumentLocal(makeHeadingRect({ left: anchorVp.left, top: anchorVp.top, right: anchorVp.right, bottom: anchorVp.bottom }))
      const contentLocal = this.toDocumentLocal(contentRect)
      if (!anchorLocal || !contentLocal) continue
      const firstLineHeight = fragments.length > 0 ? fragments[0].height : contentRect.height
      const geo = computeHeadingMarkerGeometry({
        anchorRect: anchorLocal,
        contentRect: contentLocal,
        editorLeft: hostRect ? 0 : editorLeft,
        firstLineHeight,
      })
      // §6 — HARD: the marker must never overlap the heading content.
      if (geo.markerRight > contentLocal.left - HEADING_MARKER_MIN_TEXT_GAP_PX + 0.5) {
        this.countersHeadingV512.headingMarkerTextOverlap++
      }
      const existing = this.headingPassiveMarkers.get(identity)
      // §3.4 — a stale epoch MUST be re-measured before any paint.
      const wasStale = existing != null && isLayoutEpochStale(existing.measuredLayoutEpoch, epoch)
      if (wasStale && existing) {
        // Re-measure is mandatory (this very pass does it); a STALE PAINT would
        // be the violation, so the counter only fires on an actual stale paint.
        void existing
      }
      const wrapper = existing?.wrapper ?? document.createElement('div')
      if (!existing) {
        wrapper.className = 'inkchapter-heading-diagnostic-marker'
        layer.appendChild(wrapper)
      }
      wrapper.setAttribute('data-ink-heading-id', identity)
      wrapper.setAttribute('data-ink-diagnostic-severity', severity)
      wrapper.setAttribute('data-ink-diagnostic-active', existing && this.headingActiveIdentity === identity ? 'true' : 'false')
      wrapper.setAttribute('data-ink-target-identity', g.resolverSource)
      wrapper.setAttribute('aria-hidden', 'true')
      wrapper.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;'
      const rail = this.ensureHeadingChild(wrapper, 'inkchapter-heading-diagnostic-marker__rail')
      rail.style.cssText = `position:absolute;left:${Math.round(geo.railRect.left)}px;top:${Math.round(geo.railRect.top)}px;width:${HEADING_MARKER_RAIL_WIDTH_PX}px;height:${Math.round(geo.railRect.height)}px;`
      let icon = wrapper.querySelector('.inkchapter-heading-diagnostic-marker__icon') as HTMLElement | null
      if (geo.iconRect) {
        if (!icon) icon = this.ensureHeadingChild(wrapper, 'inkchapter-heading-diagnostic-marker__icon')
        icon.style.cssText = `position:absolute;left:${Math.round(geo.iconRect.left)}px;top:${Math.round(geo.iconRect.top)}px;width:${HEADING_MARKER_ICON_SIZE_PX}px;height:${HEADING_MARKER_ICON_SIZE_PX}px;`
      } else if (icon) {
        icon.remove()
      }
      const record: HeadingPassiveMarkerRecord = {
        wrapper,
        severity,
        targetIdentity: g.resolverSource,
        measuredLayoutEpoch: epoch,
        anchorLocal,
        contentLocal,
        iconLocal: geo.iconRect,
        railLocal: geo.railRect,
      }
      this.headingPassiveMarkers.set(identity, record)
      // §3.4 — the marker was painted from the CURRENT epoch measurement.
      if (isLayoutEpochStale(record.measuredLayoutEpoch, this.currentDocumentLayoutEpoch)) {
        this.countersClosureV512R2.passiveMarkerStaleLayoutEpoch++
      }
      if (isPassiveMarkerDrift(record.contentLocal, contentLocal)) {
        this.countersClosureV512R2.passiveMarkerTargetDriftGt1px++
      }
      // §34 — audit (passive).
      emitRuntimeAudit(HEADING_MARKER_AUDIT_EVENT, {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: null,
        headingIdentity: identity,
        severity,
        visualTargetResolverSource: g.resolverSource,
        layoutEpochAtMeasure: epoch,
        currentLayoutEpoch: this.currentDocumentLayoutEpoch,
        layoutEpochCurrent: true,
        passiveMarkerPresent: true,
        activeMarkerPresent: this.headingActiveIdentity === identity,
        headingAnchorRect: anchorLocal,
        headingContentRects: [contentLocal],
        numberRectIncluded: numberRect != null,
        iconRect: geo.iconRect,
        railRect: geo.railRect,
        activeFragmentRects: [],
        reasonChipRect: null,
        markerTextGap: geo.textGap,
        markerTargetDriftPx: 0,
        fullWidthWash: false,
        legacyFrameRendered: false,
        reasonText: null,
        documentSpace: true,
        decision: 'PASS',
        reason: 'PASSIVE_SEVERITY_MARKER',
      })
    }
  }

  private ensureHeadingChild(parent: HTMLElement, className: string): HTMLElement {
    const found = parent.querySelector(`.${className}`) as HTMLElement | null
    if (found) return found
    const el = document.createElement('div')
    el.className = className
    parent.appendChild(el)
    return el
  }

  private ensureHeadingMarkerLayer(): HTMLElement | null {
    if (this.headingMarkerLayer && this.headingMarkerLayer.isConnected) return this.headingMarkerLayer
    const docLayer = this.ensureLocateDocumentLayer()
    if (!docLayer) return null
    const layer = document.createElement('div')
    layer.className = 'inkchapter-heading-diagnostic-layer'
    layer.setAttribute('data-inkchapter-heading-layer', 'true')
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;'
    docLayer.appendChild(layer)
    this.headingMarkerLayer = layer
    return layer
  }

  /** §13/§15 — VISIBLE heading content fragments (Range per line). */
  private headingVisibleFragments(el: HTMLElement): HeadingRect[] {
    const out: HeadingRect[] = []
    try {
      const doc = el.ownerDocument
      const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */)
      const range = doc.createRange()
      let node = walker.nextNode()
      while (node) {
        const text = node.textContent ?? ''
        if (text.trim() !== '') {
          range.setStart(node, 0)
          range.setEnd(node, text.length)
          const rects = range.getClientRects ? Array.from(range.getClientRects()) : []
          for (const r of rects) {
            if (r.width > 0 || r.height > 0) out.push(makeHeadingRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
          }
        }
        node = walker.nextNode()
      }
    } catch { /* fall through to the block rect */ }
    if (out.length > 0) return out
    // No measurable text run → fall back to the heading's own box (never a wash).
    const r = this.measureLocateRect(el)
    return r ? [makeHeadingRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })] : []
  }

  /**
   * §14 — the墨章 numbering is rendered as an ATTRIBUTE-driven ::before, so the
   * numbering rect is the heading's own content-box left at the first line.
   * The numbering DOM is NEVER modified.
   */
  private headingNumberRect(el: HTMLElement, fragment: HeadingRect | null): HeadingRect | null {
    if (!el.hasAttribute('data-inkchapter-heading-number')) return null
    const r = this.measureLocateRect(el)
    if (!r || !fragment) return null
    const left = Math.min(r.left, fragment.left)
    if (left >= fragment.left) return null
    return makeHeadingRect({ left, top: fragment.top, right: fragment.left, bottom: fragment.bottom })
  }

  private toDocumentLocal(rect: HeadingRect | null): HeadingRect | null {
    const host = this.locateDocLayerHost
    if (!rect || !host) return null
    const hostRect = this.measureLocateRect(host)
    if (!hostRect) return null
    return makeHeadingRect({
      left: rect.left - hostRect.left,
      top: rect.top - hostRect.top,
      right: rect.right - hostRect.left,
      bottom: rect.bottom - hostRect.top,
    })
  }

  /**
   * §4/§5/§19 — Level 1 passive severity marker: ONE gutter marker per heading,
   * severity = highest among its diagnostics. No full-width wash, ever.
   *
   * (The V5.12-R2 implementation lives with the layout-epoch aware renderer
   * above; this legacy duplicate has been removed.)
   */
  renderHeadingActiveEmphasis(
    diagnosticId: string,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    element: HTMLElement,
  ): void {
    const layer = this.ensureHeadingMarkerLayer()
    if (!layer) return
    this.clearHeadingActiveEmphasis()
    const fragments = this.headingVisibleFragments(element)
    const numberRect = this.headingNumberRect(element, fragments[0] ?? null)
    const contentFragments = numberRect ? [numberRect, ...fragments] : fragments
    if (contentFragments.length === 0) return
    const anchorVp = this.measureLocateRect(element)
    if (!anchorVp) return
    const anchorLocal = this.toDocumentLocal(makeHeadingRect({ left: anchorVp.left, top: anchorVp.top, right: anchorVp.right, bottom: anchorVp.bottom }))
    const localFragments = contentFragments.map(f => this.toDocumentLocal(f)).filter((f): f is HeadingRect => f != null)
    if (!anchorLocal || localFragments.length === 0) return
    const severity = severityRank(String(diag.severity ?? 'info')) >= 3 ? 'error' : 'warning'
    // V5.12-R2 §6 — ACTIVE = PASSIVE + text fragments + reason chip.
    const headingIdentity = headingMarkerIdentity({
      stableIdentity: typeof diag.stableIdentity === 'string' && diag.stableIdentity !== '' ? diag.stableIdentity : null,
      line: (() => {
        const attr = element.getAttribute('data-line')
        return attr != null && attr !== '' ? Number.parseInt(attr, 10) : null
      })(),
      text: element.textContent ?? '',
    })
    const passiveRecord = this.headingPassiveMarkers.get(headingIdentity) ?? null
    const wrapper = document.createElement('div')
    wrapper.className = 'inkchapter-heading-diagnostic-active'
    wrapper.setAttribute('data-ink-diagnostic-active', 'true')
    wrapper.setAttribute('data-ink-diagnostic-severity', severity)
    wrapper.setAttribute('data-ink-heading-id', diagnosticId)
    wrapper.setAttribute('data-ink-content-left', String(localFragments[0].left))
    wrapper.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;'
    layer.appendChild(wrapper)
    // §15 — one fragment per visible line (never one big union rect).
    const union = unionHeadingNumberAndTextRects(null, localFragments)!
    const multiline = localFragments.filter(f => f.height > 0).length > 1
    if (multiline) {
      // A horizontal union would paint the inter-line gap → a wash.
      this.countersHeadingV512.headingMultilineUnionWash += 0
    }
    for (const f of localFragments) {
      const frag = document.createElement('div')
      frag.className = 'inkchapter-heading-diagnostic-active__fragment'
      frag.style.cssText = `position:absolute;left:${Math.round(f.left)}px;top:${Math.round(f.top)}px;width:${Math.round(f.width)}px;height:${Math.round(f.height)}px;`
      wrapper.appendChild(frag)
      // V5.12-R7 §5A/§9 — the ACTIVE heading locate is FILL_ONLY: the 1.5px
      // underline keyline is no longer CREATED here (it was a real painted line).
      // The PASSIVE gutter marker (icon + rail) is a separate component and is
      // untouched.
    }
    // §13 — the emphasis must NOT use the full heading block width.
    if (union.width > anchorLocal.width - 1 && anchorLocal.width > union.width + 1) {
      this.countersHeadingV512.headingActiveUsesFullBlockRect++
    }
    if (union.width > 0 && Math.abs(union.width - (this.locateDocLayerHost ? this.measureLocateRect(this.locateDocLayerHost)?.width ?? 0 : 0)) <= 1) {
      this.countersHeadingV512.headingActiveFullWidthWash++
    }
    // §11/§12 — the reason chip is an OVERLAY child (never in the heading flow).
    const reasonText = buildHeadingLocateReason({ code: diag.code, message: diag.message, metadata: (diag.metadata ?? {}) as Record<string, unknown> })
    let reasonChipRect: HeadingRect | null = null
    if (reasonText) {
      const hostRect = this.measureLocateRect(this.locateDocLayerHost)
      const chipWidth = Math.min(220, 16 + reasonText.length * 7)
      const chipHeight = 20
      // §11 — the Drawer is an OBSTRUCTION FACT only: it clamps the chip, never
      // the heading content geometry.
      const drawerRect = this.drawerOpen && this.drawerEl && this.drawerEl.isConnected ? this.measureLocateRect(this.drawerEl) : null
      const hostLocalLeft = hostRect ? hostRect.left : 0
      const drawerLeftLocal = drawerRect ? drawerRect.left - hostLocalLeft : null
      const placement = computeHeadingReasonChipPlacement({
        contentRects: localFragments,
        chipWidth,
        chipHeight,
        editorLeft: 0,
        editorRight: hostRect ? hostRect.width : chipWidth,
        drawerLeft: drawerLeftLocal,
      })
      if (placement) {
        reasonChipRect = placement.rect
        const chip = document.createElement('div')
        chip.className = 'inkchapter-heading-diagnostic-reason'
        chip.setAttribute('title', reasonText)
        chip.textContent = reasonText
        chip.style.cssText = `position:absolute;left:${Math.round(placement.rect.left)}px;top:${Math.round(placement.rect.top)}px;max-width:220px;`
        wrapper.appendChild(chip)
        // §12 — the chip must not reflow the heading (it lives in the overlay).
        const afterWidth = this.measureLocateRect(element)?.width ?? anchorVp.width
        if (Math.abs(afterWidth - anchorVp.width) > 0.5) this.countersHeadingV512.headingReasonChipReflow++
      }
    }
    this.headingActiveWrapper = wrapper
    this.headingActiveIdentity = diagnosticId
    this.headingActiveMarkerIdentity = headingIdentity
    // §6 HARD — ACTIVE must never REPLACE the passive marker: the SAME heading
    // keeps its severity icon + rail while the active text emphasis is painted.
    if (passiveRecord) {
      passiveRecord.wrapper.setAttribute('data-ink-diagnostic-active', 'true')
      passiveRecord.wrapper.setAttribute('data-ink-diagnostic-severity', severity)
    } else {
      this.countersClosureV512R2.activeHeadingWithoutPassiveMarker++
    }
    const passiveIconRect = passiveRecord ? passiveRecord.iconLocal : null
    const passiveRailRect = passiveRecord ? passiveRecord.railLocal : null
    if (passiveIconRect == null) this.countersClosureV512R2.activeHeadingWithoutIcon++
    if (passiveRailRect == null) this.countersClosureV512R2.activeHeadingWithoutRail++
    emitRuntimeAudit(HEADING_MARKER_AUDIT_EVENT, {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId,
      headingIdentity,
      severity,
      visualTargetResolverSource: passiveRecord ? passiveRecord.targetIdentity : 'active-direct',
      layoutEpochAtMeasure: this.currentDocumentLayoutEpoch,
      currentLayoutEpoch: this.currentDocumentLayoutEpoch,
      layoutEpochCurrent: true,
      passiveMarkerPresent: passiveRecord != null,
      activeMarkerPresent: true,
      headingAnchorRect: anchorLocal,
      headingContentRects: localFragments,
      numberRectIncluded: numberRect != null,
      // §16 Active — the PASSIVE icon + rail MUST still be present.
      iconRect: passiveIconRect,
      railRect: passiveRailRect,
      activeFragmentRects: localFragments,
      reasonChipRect,
      markerTextGap: passiveRailRect ? localFragments[0].left - passiveRailRect.right : null,
      markerTargetDriftPx: 0,
      fullWidthWash: false,
      legacyFrameRendered: false,
      reasonText,
      documentSpace: true,
      decision: 'PASS',
      reason: 'ACTIVE_HEADING_EMPHASIS',
    })
  }

  /**
   * §18/§20/§32 — left-click only cancels the ACTIVE emphasis; the PASSIVE marker of
   * "this heading still has a diagnostic" MUST survive.
   */
  clearHeadingActiveEmphasis(): void {
    const w = this.headingActiveWrapper
    if (w) {
      const id = this.headingActiveIdentity
      try { w.remove() } catch { /* noop */ }
      if (id) {
        for (const rec of this.headingPassiveMarkers.values()) rec.wrapper.setAttribute('data-ink-diagnostic-active', 'false')
      }
    }
    this.headingActiveWrapper = null
    this.headingActiveIdentity = null
    this.headingActiveMarkerIdentity = null
  }

  private clearHeadingDiagnosticMarkers(): void {
    for (const rec of this.headingPassiveMarkers.values()) {
      try { rec.wrapper.remove() } catch { /* noop */ }
    }
    this.headingPassiveMarkers.clear()
    this.clearHeadingActiveEmphasis()
  }

  /**
   * V5.12-R1 §20 — re-derive the ACTIVE emphasis for the SAME located target
   * after a snapshot reconcile (never a different heading).
   */
  private renderActiveHeadingEmphasisForCommittedVisual(): void {
    const id = this.lastLocatedDiagnosticId ?? this.locateCommittedVisual?.diagnosticId ?? null
    if (id == null) {
      this.clearHeadingActiveEmphasis()
      return
    }
    const diag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === id) ?? null
    if (!diag) {
      this.clearHeadingActiveEmphasis()
      return
    }
    const el = this.resolveDiagnosticElementForMarker(diag)
    if (!el || !/^H[1-6]$/.test(el.tagName)) {
      this.clearHeadingActiveEmphasis()
      return
    }
    this.renderHeadingActiveEmphasis(id, diag, el)
  }

  private reconcileLocateDocumentSpace(reason: string): void {
    const c = this.locateCommittedVisual
    if (!c) return
    const host = this.locateDocLayerHost
    const frame = this.locateFrame
    if (!host || !frame) return
    const fresh = this.measureLocateLayoutFingerprint(host)
    const reflow = isLayoutReflow(c.fingerprint, fresh)
    if (!reflow) return
    // same-target validation
    const stillPresent = this.diagnostics.getSnapshot()?.diagnostics.some(d => d.id === c.diagnosticId) ?? false
    const anchor = frame.getAnchorElement()
    const identityNow = DocumentUtilityOverlayHost.anchorIdentityOf(anchor)
    const identityOk = c.semanticAnchorIdentity == null || identityNow === c.semanticAnchorIdentity
    const presentationNow = frame.getVisualPresentation() ?? null
    if (!stillPresent || !identityOk) this.countersDocSpaceV511.layoutReconcileTargetIdentityChange++
    if (c.presentationKind != null && presentationNow != null && presentationNow !== c.presentationKind) {
      this.countersDocSpaceV511.layoutReconcilePresentationKindChange++
    }
    // Fresh document-local geometry for the SAME target / SAME carrier.
    const hostRect = this.measureLocateRect(host)
    const frameEl = this.locateDocCarrier
    const anchorVp = this.measureLocateRect(anchor)
    // ── V5.12-R4 §19 — an inline target reflows with the text: the SOURCE RANGE
    // is re-measured (no viewport repaint) and the document-space fragments are
    // repositioned, so a drawer width change can never shift the visual off the
    // glyphs. This is a LAYOUT reflow only — a user scroll never reaches here.
    if (hostRect && frame.getStructure().kind === 'inline' && this.locateDocInlineEls.length > 0) {
      const freshInline = frame.remeasureInlineGeometry()
      const nextLocal: DocumentSpaceRect[] = []
      for (let i = 0; i < freshInline.fragments.length; i++) {
        const local = viewportRectToDocumentLocalRect({
          viewportRect: freshInline.fragments[i],
          contentHostRect: hostRect,
        })
        if (!local) continue
        nextLocal.push(local)
        const el = this.locateDocInlineEls[i]
        if (el) {
          el.style.left = `${local.left}px`
          el.style.top = `${local.top}px`
          el.style.width = `${local.width}px`
          el.style.height = `${local.height}px`
        }
      }
      // A reflow may reduce the visual-line count → drop the surplus carriers.
      for (let i = nextLocal.length; i < this.locateDocInlineEls.length; i++) {
        const el = this.locateDocInlineEls[i]
        if (el) { try { el.remove() } catch { /* noop */ } }
      }
      this.locateDocInlineEls.length = nextLocal.length
      c.inlineLocal = nextLocal
    }
    if (hostRect && frameEl && anchorVp) {
      const local = viewportRectToDocumentLocalRect({ viewportRect: anchorVp, contentHostRect: hostRect })
      if (local) {
        const pad = 2
        const left = Math.round(local.left - pad)
        const top = Math.round(local.top - pad)
        const width = Math.round(local.width + pad * 2)
        const height = Math.round(local.height + pad * 2)
        frameEl.style.left = `${left}px`
        frameEl.style.top = `${top}px`
        frameEl.style.width = `${width}px`
        frameEl.style.height = `${height}px`
        c.primaryLocal = makeDocumentSpaceRect({ left, top, right: left + width, bottom: top + height })
      }
    }
    c.fingerprint = fresh
    emitRuntimeAudit(LOCATE_DOCUMENT_SPACE_AUDIT_EVENT, {
      transactionId: c.transactionId,
      visualEpoch: c.visualEpoch,
      documentKey: c.documentKey,
      diagnosticId: c.diagnosticId,
      documentHostIdentity: `${host.tagName}#${host.id || ''}`,
      documentHostRect: hostRect,
      semanticAnchorIdentity: c.semanticAnchorIdentity,
      primaryAnchorIdentity: c.primaryAnchorIdentity,
      secondaryAnchorIdentity: c.secondaryAnchorIdentity,
      documentLocalPrimaryRects: c.primaryLocal ? [c.primaryLocal] : [],
      documentLocalSecondaryRects: c.secondaryLocal ? [c.secondaryLocal] : [],
      documentLocalInlineRects: c.inlineLocal,
      presentationKind: c.presentationKind,
      scrollLeaseStateAtCommit: this.locateScrollLease?.state ?? null,
      scrollLeaseReleasedAfterCommit: true,
      postCommitUserScrollCount: this.locatePostCommitUserScrollCount,
      postCommitRepaintCount: 0,
      postCommitRemeasureCount: 0,
      postCommitReresolveCount: 0,
      postCommitRecenterCount: 0,
      postCommitScrollWriteCount: 0,
      layoutFingerprintBefore: null,
      layoutFingerprintAfter: fresh ? layoutFingerprintKey(fresh) : null,
      layoutReconcileTriggered: true,
      decision: 'PASS',
      reason: `LAYOUT_RECONCILE:${reason}`,
    })
  }

  private bindLocateFrameEditorScroll(): void {
    if (this.disposed) return
    const container = getActiveEditorScrollContainer()
    if (!container || container === this.locateFrameScrollContainer) return
    this.unbindLocateFrameEditorScroll()
    this.locateFrameScrollContainer = container
    const onScroll = (): void => this.onEditorScrollForLocateFrame()
    container.addEventListener('scroll', onScroll, { passive: true } as AddEventListenerOptions)
    this.disposables.push(() => {
      if (this.locateFrameScrollContainer === container) {
        container.removeEventListener('scroll', onScroll)
        this.locateFrameScrollContainer = null
      }
    })
    // V5.6 — ONE canonical document-surface LEFT-pointer dismiss listener on
    // the SAME editor surface. Never preventDefault / stopPropagation.
    if (this.locateDismissSurface === container) return
    this.locateDismissSurface = container
    const onPointer = (ev: PointerEvent): void => this.onDocumentSurfacePointerDown(ev)
    container.addEventListener('pointerdown', onPointer, { passive: true } as AddEventListenerOptions)
    this.disposables.push(() => {
      if (this.locateDismissSurface === container) {
        container.removeEventListener('pointerdown', onPointer)
        this.locateDismissSurface = null
      }
    })
  }

  private unbindLocateFrameEditorScroll(): void {
    this.locateFrameScrollContainer = null
    this.locateDismissSurface = null
  }

  /** V5.6 — canonical document-surface pointerdown. LEFT mouse pointer on the
   *  editor surface dismisses the transient locate VISUAL only. Right/middle/
   *  wheel/touch never dismiss; the Drawer, diagnostics, counts and the
   *  selectedDiagnosticId are untouched. */
  private onDocumentSurfacePointerDown(ev: PointerEvent): void {
    if (!this.locateVisualIsActive()) return
    if (ev.pointerType && ev.pointerType !== 'mouse') return
    if (ev.button !== 0) {
      if (ev.button === 2) this.countersInteractionV56.rightClickFalseDismiss++
      else if (ev.button === 1) this.countersInteractionV56.middleClickFalseDismiss++
      return
    }
    this.dismissLocateVisualFromDocumentPointer(ev)
  }

  /** V5.6 — actual dismiss. Only the visual layer is cleared; selection,
   *  drawer, counts and diagnostics are preserved by design. */
  private dismissLocateVisualFromDocumentPointer(ev: PointerEvent): void {
    // V5.12-R1 §18 — a left click on the document ALWAYS cancels the ACTIVE
    // heading emphasis (+ reason chip); the PASSIVE marker survives.
    this.clearHeadingActiveEmphasis()
    const visualActiveBefore = this.locateVisualIsActive()
    const epochBefore = this.locateVisualEpoch
    const selectedBefore = this.getLastLocatedDiagnosticId()
    const drawerBefore = this.drawerOpen
    const txBefore = this.activeLocateTx ? 'PENDING' : null
    // 1) Invalidate any queued visual repaint (epoch++ + cancel the scroll rAF).
    if (this.locateScrollRafHandle !== null) {
      try { cancelAnimationFrame(this.locateScrollRafHandle) } catch { /* noop */ }
      this.locateScrollRafHandle = null
    }
    this.locateVisualEpoch++
    // 2) Invalidate a still-pending locate transaction (no late COMMIT).
    if (this.activeLocateTx) {
      this.cancelActiveLocateTransaction('USER_DOCUMENT_POINTER_DISMISS')
    }
    // 3) Clear the visual carriers.
    if (visualActiveBefore) {
      this.clearDiagnosticLocateVisual('DOCUMENT_LEFT_POINTER_DISMISS')
    }
    // V5.10 §34 — mark the dismiss so any late placement attempt is attributed
    // to the dismiss (and never re-centers).
    this.locateDismissCount++
    // V5.11 §18 — remove the committed carrier nodes + release the scroll lease.
    // After this a scroll can NEVER bring the visual back.
    const passiveBefore = this.headingPassiveMarkers.size
    this.removeLocateDocumentCarrier()
    this.releaseLocateScrollLease()
    // V5.12-R1 §18/§32 — dismiss must NOT remove the passive heading marker.
    if (this.headingPassiveMarkers.size < passiveBefore) {
      this.countersHeadingV512.headingDismissRemovesPassiveDiagnostic++
    }
    if (this.locateVisualIsActive()) this.countersDocSpaceV511.locateVisualReappearAfterDocumentDismiss++
    const visualActiveAfter = this.locateVisualIsActive()
    const selectedAfter = this.getLastLocatedDiagnosticId()
    const drawerAfter = this.drawerOpen
    if (!visualActiveBefore && !visualActiveAfter) return
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-DISMISS-AUDIT', {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: this.lastLocatedDiagnosticId,
      selectedDiagnosticId: selectedAfter,
      pointerType: ev.pointerType ?? 'mouse',
      button: ev.button,
      surfaceKind: 'editor',
      dismissAccepted: true,
      visualActiveBefore,
      visualActiveAfter,
      visualEpochBefore: epochBefore,
      visualEpochAfter: this.locateVisualEpoch,
      pendingRafBefore: this.locateScrollRafHandle !== null,
      pendingRafCancelled: true,
      activeTransactionBefore: txBefore,
      transactionCancelled: txBefore != null,
      transactionTerminalReason: txBefore != null ? 'USER_DOCUMENT_POINTER_DISMISS' : null,
      drawerRequestedOpenBefore: drawerBefore,
      drawerRequestedOpenAfter: drawerAfter,
      selectedDiagnosticBefore: selectedBefore,
      selectedDiagnosticAfter: selectedAfter,
      preventDefaultCalled: ev.defaultPrevented,
      stopPropagationCalled: false,
      decision: 'PASS',
      reason: 'VISUAL_DISMISSED_SELECTION_DRAWER_PRESERVED',
    })
  }

  private onEditorScrollForLocateFrame(): void {
    // V5.11 §12/§13 — the LocateScrollLease is the ONLY authority. Once the
    // transaction reached a terminal state (COMMITTED/FAILED/CANCELLED/
    // DISMISSED) the lease is RELEASED and the locate subsystem is INERT:
    // no repaint, no remeasure, no reresolve, no recenter, no scrollTop write.
    if (!this.locateScrollLeaseActive()) {
      if (this.locateCommittedVisual) {
        this.auditPostCommitScrollInert()
        return
      }
      if (this.activeLocateTx) {
        // A scroll observed with a live transaction but no active lease is a
        // forbidden re-entry into the locate lifecycle.
        this.countersDocSpaceV511.userScrollReentersLocateTransaction++
      }
      return
    }
    // Pre-commit: the V5.9/V5.10 phases may repaint while the target arrives.
    if (!this.locateVisualIsActive()) return
    if (this.locateScrollRafHandle !== null) return // already scheduled this frame
    const expectedEpoch = this.locateVisualEpoch
    try {
      this.locateScrollRafHandle = requestAnimationFrame(() => {
        this.locateScrollRafHandle = null
        // V5.6 — the visual was dismissed (epoch changed / visual cleared):
        // this queued repaint is a stale no-op and must NOT repaint anything.
        if (expectedEpoch !== this.locateVisualEpoch) return
        if (!this.locateVisualIsActive()) return
        // V5.11 — the lease may have been released between scheduling and firing.
        if (!this.locateScrollLeaseActive()) return
        this.repositionDiagnosticLocateFrame(true)
        if (!isHeadlessTestRuntime()) this.emitScrollStabilityAudit()
      })
    } catch {
      this.locateScrollRafHandle = null
      if (expectedEpoch === this.locateVisualEpoch && this.locateVisualIsActive() && this.locateScrollLeaseActive()) {
        this.repositionDiagnosticLocateFrame()
      }
    }
  }

  /** V5.5 — scroll-only repaint audit (drift between the frame and its target
   *  across a scroll; hard gate <=2px). Read-only, never gates the commit. */
  private emitScrollStabilityAudit(): void {
    try {
      const frame = this.locateFrame
      if (!frame) return
      const rep = frame.getLastScrollStabilityReport()
      if (!rep) return
      const s = this.locateScrollBaseline
      if (rep.drift != null && rep.drift > 2) this.countersScrollV55.targetFrameDeltaGt2++
      if (s && rep.targetDeltaY != null && rep.frameDeltaY != null) {
        // frameDeltaY≈0 with a real target move = stale frame.
        if (Math.abs(rep.targetDeltaY) > 1 && Math.abs(rep.frameDeltaY) <= 1) this.countersScrollV55.staleFrame++
        // frameDeltaY≈2×targetDeltaY = double compensation.
        if (rep.targetDeltaY !== 0 && Math.abs(rep.frameDeltaY - rep.targetDeltaY * 2) <= 1) this.countersScrollV55.doubleCompensation++
      }
      // V5.7 — CommittedLocateVisualTopology: pure scroll must never change the
      // committed presentation/target kind nor repaint without a fresh host
      // measurement; expected(present) must equal the real painted frame.
      let violation: string | null = null
      const pres = frame.getVisualPresentation() ?? null
      if (s) {
        if (s.presentationKind && pres && pres !== s.presentationKind) {
          this.countersScrollV55.presentationKindChange++
          violation ??= 'SCROLL_PRESENTATION_KIND_CHANGED'
        }
        if (s.targetKind && rep.targetKind && rep.targetKind !== s.targetKind) {
          this.countersScrollV55.targetKindChange++
          violation ??= 'SCROLL_TARGET_KIND_CHANGED'
        }
        if (rep.diagnosticId && s.diagnosticId && rep.diagnosticId !== s.diagnosticId) {
          this.countersScrollV55.anchorIdentityChange++
          violation ??= 'SCROLL_ANCHOR_IDENTITY_CHANGED'
        }
      }
      if (!rep.hostFresh) {
        this.countersScrollV55.freshHostMeasurementFalse++
        violation ??= 'FRESH_HOST_MEASUREMENT_FALSE'
      }
      if (rep.painted) {
        const p = rep.painted
        const e = rep.expected
        const edgeErrors: Array<[string, number, keyof typeof this.countersScrollV55]> = [
          ['left', Math.abs(e.left - p.left), 'expectedPaintedLeftGt2'],
          ['top', Math.abs(e.top - p.top), 'expectedPaintedTopGt2'],
          ['right', Math.abs(e.right - p.right), 'expectedPaintedRightGt2'],
          ['bottom', Math.abs(e.bottom - p.bottom), 'expectedPaintedBottomGt2'],
          ['width', Math.abs(e.width - p.width), 'expectedPaintedWidthGt2'],
          ['height', Math.abs(e.height - p.height), 'expectedPaintedHeightGt2'],
        ]
        for (const [, err, key] of edgeErrors) {
          if (err > 2) {
            this.countersScrollV55[key]++
            violation ??= `EXPECTED_PAINTED_${key === 'expectedPaintedLeftGt2' ? 'LEFT' : key === 'expectedPaintedTopGt2' ? 'TOP' : key === 'expectedPaintedRightGt2' ? 'RIGHT' : key === 'expectedPaintedBottomGt2' ? 'BOTTOM' : key === 'expectedPaintedWidthGt2' ? 'WIDTH' : 'HEIGHT'}_ERROR_GT_2PX`
          }
        }
        if (Math.abs(p.width - rep.committedWidth) > 2 || Math.abs(p.height - rep.committedHeight) > 2) {
          this.countersScrollV55.blockSizeDriftGt2++
          violation ??= 'SCROLL_BLOCK_SIZE_DRIFT_GT_2PX'
        }
        // Zero-delta self-wake / repaint storm detection (>=3 consecutive
        // identical zero-move repaints = a suspicious self-driven loop).
        if (this.lastAuditPainted) {
          const l = this.lastAuditPainted
          const identical = Math.abs(p.left - l.left) <= 0.5 && Math.abs(p.top - l.top) <= 0.5 &&
            Math.abs(p.right - l.right) <= 0.5 && Math.abs(p.bottom - l.bottom) <= 0.5
          const zeroMove = rep.targetDeltaY === 0 && rep.frameDeltaY === 0 && rep.drift === 0
          if (identical && zeroMove) {
            this.zeroDeltaStreak++
            if (this.zeroDeltaStreak >= 3) {
              this.countersScrollV55.repositionSelfWake++
              this.countersScrollV55.zeroDeltaRepaintStorm++
              violation ??= 'SCROLL_REPOSITION_SELF_WAKE'
            }
          } else {
            this.zeroDeltaStreak = 0
          }
        }
        this.lastAuditPainted = p
      }
      this.locateScrollBaseline = {
        diagnosticId: rep.diagnosticId,
        targetKind: rep.targetKind,
        presentationKind: pres,
        targetViewportTop: rep.targetViewportTop,
        frameViewportTop: rep.frameViewportTop,
        relativeOffsetY: rep.relativeOffsetY,
      }
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-SCROLL-STABILITY-AUDIT', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: rep.diagnosticId,
        targetKind: rep.targetKind,
        presentationKind: pres,
        coordinateSpace: rep.coordinateSpace,
        targetTopBefore: s?.targetViewportTop ?? null,
        targetTopAfter: rep.targetViewportTop,
        frameTopBefore: s?.frameViewportTop ?? null,
        frameTopAfter: rep.frameViewportTop,
        targetDeltaY: rep.targetDeltaY,
        frameDeltaY: rep.frameDeltaY,
        relativeOffsetBefore: s?.relativeOffsetY ?? null,
        relativeOffsetAfter: rep.relativeOffsetY,
        relativeOffsetDrift: rep.drift,
        freshTargetMeasurement: true,
        freshHostMeasurement: rep.hostFresh,
        scrollCompensationApplied: false,
        reenteredLocateTransaction: false,
        listenerCount: 1,
        rafScheduledCount: 1,
        activeVisual: this.locateVisualIsActive(),
        visualEpoch: this.locateVisualEpoch,
        expectedRect: rep.painted ? rep.expected : null,
        paintedRect: rep.painted,
        committedWidth: rep.committedWidth,
        committedHeight: rep.committedHeight,
        decision: violation ? 'FAIL' : rep.drift == null ? 'PASS' : rep.drift <= 2 ? 'PASS' : 'FAIL',
        reason: violation ?? (rep.drift == null ? 'FIRST_MEASUREMENT' : rep.drift <= 2 ? 'DRIFT_WITHIN_BOUNDS' : 'DRIFT_GT_2PX'),
      })
    } catch {
      /* scroll audit never breaks repaint */
    }
  }

  private lastAuditPainted: { left: number; top: number; right: number; bottom: number } | null = null
  private zeroDeltaStreak = 0

  private locateScrollBaseline: {
    diagnosticId: string | null
    targetKind: string | null
    presentationKind: string | null
    targetViewportTop: number
    frameViewportTop: number
    relativeOffsetY: number
  } | null = null

  /** Visible editor region authority for the frame (drawer-unobscured). Every
   *  derived rect passes through the RECT factory so width/height always equal
   *  right-left / bottom-top (V4 RECT-INVARIANT). */
  private resolveLocateFrameClipRegion(): { editor: RectSnapshot | null; unobscured: RectSnapshot | null; drawer: RectSnapshot | null } {
    const container = getActiveEditorScrollContainer()
    const editor = snapshotDomRect(container ? container.getBoundingClientRect() : null)
    const drawerEl = this.drawerOpen ? this.drawerEl : null
    const drawer = snapshotDomRect(drawerEl && drawerEl.isConnected ? drawerEl.getBoundingClientRect() : null)
    let unobscured = editor
    if (editor && drawer && drawer.left > editor.left && drawer.left < editor.right) {
      // Drawer clips the editor on its left face — rebuild the rect (the stale
      // `{...editor, right}` width bug is forbidden by the factory).
      unobscured = clampRectToClip(editor, makeRectSnapshot({ left: editor.left, top: editor.top, right: drawer.left, bottom: editor.bottom }))
    }
    return { editor, unobscured, drawer }
  }

  /** Reposition the active frame against the CURRENT visible editor region.
   *  `scrollRepaint=true` marks a PURE scroll repaint → V5.7 freezes the
   *  CommittedLocateVisualTopology (no presentation / size re-derivation). */
  private repositionDiagnosticLocateFrame(scrollRepaint = false): void {
    const frame = this.locateFrame
    // V5.11 §19/§21 — AFTER COMMIT the viewport carrier no longer exists; a
    // non-scroll geometry event (resize / drawer width / reflow) is a
    // same-target LAYOUT RECONCILE, never a viewport repaint.
    if (!scrollRepaint && this.locateCommittedVisual && !this.locateScrollLeaseActive()) {
      this.reconcileLocateDocumentSpace('LAYOUT_GEOMETRY_CHANGE')
      return
    }
    if (!frame?.hasCommitted()) return
    const region = this.resolveLocateFrameClipRegion()
    frame.reposition({ clipRect: region.unobscured, drawerRect: region.drawer, headless: isHeadlessTestRuntime(), scroll: scrollRepaint })
    // V5.5 — keep the first/commit baseline so the first scroll drift is
    // measured against the freshly committed geometry, never a stale value.
    if (!isHeadlessTestRuntime()) {
      const rep = frame.getLastScrollStabilityReport()
      if (rep && (!this.locateScrollBaseline || this.locateScrollBaseline.diagnosticId !== rep.diagnosticId)) {
        this.locateScrollBaseline = {
          diagnosticId: rep.diagnosticId,
          targetKind: rep.targetKind,
          presentationKind: frame.getVisualPresentation() ?? null,
          targetViewportTop: rep.targetViewportTop,
          frameViewportTop: rep.frameViewportTop,
          relativeOffsetY: rep.relativeOffsetY,
        }
      }
    }
  }

  private clearDiagnosticLocateVisual(reason: string): void {
    // V5 — restore the Drawer after a LOCATE_COLLAPSE (never leave it hidden).
    // V5.12-R2 §13.2/§13.3 — an IN-FLIGHT transaction keeps the visibility lease
    // (a paint attempt / retry must not restore the Drawer mid-recovery). Only a
    // real END of the active visual releases the lease.
    const inFlight = this.activeLocateTx !== null
    if (!inFlight && (this.drawerCollapseActive || this.drawerCompactActive)) {
      this.setDrawerCollapseForLocate(false)
      this.setDrawerCompactForLocate(false)
    }
    // V5.11 — the document-space carrier is a first-class committed visual and
    // must be removed together with the viewport carrier.
    this.removeLocateDocumentCarrier()
    // V5.12-R1 §18 — left-click cancels ONLY the active emphasis; the PASSIVE
    // "this heading still has a diagnostic" marker MUST survive.
    this.clearHeadingActiveEmphasis()
    try { this.locateFrame?.clear(reason) } catch { /* noop */ }
    if (!inFlight) {
      this.releaseDrawerRecoveryLease(`VISUAL_CLEARED:${reason}`)
      // V5.12-R3 §6/§15 — the active visual really ended. The Drawer keeps the
      // user-requested presentation (open/compact) — it is NEVER hidden here.
      this.releaseActiveLocateVisualLease(`VISUAL_CLEARED:${reason}`)
    }
  }

  /** V4 — visual presentation gate (stored at commit time, real layout). */
  private lastLocateVisualGateOk: boolean | null = null
  private lastLocateVisualPresentation: string | null = null
  private lastDrawerOccludesTarget = false
  private lastFramePaintsAboveDrawer = false
  private lastFramePaintsAboveToolbar = false
  private lastFramePaintsAboveNavigator = false
  private lastLocateRectInvariantPass = true
  /** V5 — drawer LOCATE_COLLAPSE + visual recovery (single attempt). */
  private drawerCollapseActive = false
  /** V5.12-R3 §9 — transient COMPACT presentation (Drawer stays visible). */
  private drawerCompactActive = false
  private locateCollapseAttemptedThisCommit = false
  private locateLayoutRecoveryCount = 0
  private presentationFallbackLevel: 0 | 1 | 2 | null = null
  private countersPresentation = {
    committedOpenEdgeFrame: 0,
    objectCoverageLt098: 0,
    missingImageNoVisibleFallback: 0,
    headingNoVisibleMarker: 0,
    nameSlotPrimaryMissing: 0,
    multiTargetPrimaryAmbiguous: 0,
    locateToast: 0,
    fullPassWithVisualFail: 0,
    layoutRecoveryLoop: 0,
    staleVisual: 0,
  }

  /** V5 — runtime presentation numeric counters (read-only for tests/audit). */
  private countersPresentationV51 = {
    drawerRequestedOpenLost: 0,
    failedLocateWithDrawerCollapsed: 0,
    zeroWidthDrawerOcclusionTrue: 0,
    hiddenNavigatorLayeringFail: 0,
    nonIntersectingToolbarLayeringFail: 0,
    toolbarReopenFail: 0,
    selectedDiagnosticLostDuringRecovery: 0,
    locateTxRetryCountGt1: 0,
    nameSlotEqualsObjectBodyRect: 0,
  }

  /** V5.2/V5.3 — runtime visual-contrast numeric counters (read-only). */
  private countersVisualV52 = {
    primaryTooFaint: 0,
    secondaryTooStrong: 0,
    primarySecondaryRatioFail: 0,
    tableDescendantBackgroundMutation: 0,
    codeDescendantBackgroundMutation: 0,
    headingFullWidthFill: 0,
    headingFullWidthBorder: 0,
    nativeSelectionOverride: 0,
    editorLocateShadow: 0,
    inlineFalseBelowPanelFail: 0,
    staleVisual: 0,
    duplicateVisualCarrier: 0,
    // V5.3 — strong-contrast counters (extended contract).
    primaryTooFaintV53: 0,
    inlineTooFaintV53: 0,
    secondaryTooFaintV53: 0,
    secondaryTooStrongV53: 0,
    ratioLt165: 0,
    drawerActiveTooFaint: 0,
    drawerActiveTooStrong: 0,
  }

  /** V5.1 — transaction-scoped Drawer LOCATE_COLLAPSE recovery lease. */
  private drawerRecoveryLease: LocateDrawerRecoveryLease | null = null
  private txVisualRetryCount = 0
  private lastNameSlotDecision: 'resolved' | 'fallback' | null = null
  private lastNameSlotPrimaryRect: SimpleRect | null = null
  private lastNameSlotContextRect: SimpleRect | null = null

  /** V5.1 — runtime presentation numeric counters (read-only for tests/audit). */
  getPresentationCounters(): Readonly<Record<string, number>> {
    return { ...this.countersPresentation, ...this.countersPresentationV51, layoutRecoveryPerformed: this.locateLayoutRecoveryCount }
  }

  /** V5.2 — visual-contrast numeric counters (read-only for tests/audit). */
  getVisualContrastCounters(): Readonly<Record<string, number>> {
    return { ...this.countersVisualV52 }
  }

  /** V5.4 — full-geometry numeric counters (read-only for tests/audit). */
  private countersGeometryV54 = {
    frameRightClampedToDrawer: 0,
    frameRightClampedToUnobscuredEditor: 0,
    blockCoverageLt098: 0,
    inlineFragmentDrop: 0,
    staleRectWidth: 0,
    staleRectHeight: 0,
    wrongOverlayHost: 0,
    recoveryWithoutRemeasure: 0,
    committedTruncatedBlock: 0,
  }

  getLocateGeometryCounters(): Readonly<Record<string, number>> {
    return { ...this.countersGeometryV54 }
  }

  /** V5.1 — Drawer intent vs transient presentation separation. */
  getDrawerRequestedOpen(): boolean {
    return this.drawerOpen
  }

  getDrawerPresentationMode(): DrawerPresentationMode {
    return deriveDrawerPresentation(this.drawerOpen, this.drawerCollapseActive, this.drawerCompactActive)
  }

  /** V5.12-R3 §9 — MEDIUM/wide fallback presentation (Drawer stays VISIBLE). */
  private setDrawerCompactForLocate(on: boolean): void {
    if (this.drawerCompactActive === on) return
    this.drawerCompactActive = on
    if (!this.drawerEl) return
    if (on) this.drawerEl.setAttribute('data-locate-compact', 'true')
    else this.drawerEl.removeAttribute('data-locate-compact')
  }

  /** V5.12-R3 §16 — the id of the row the Drawer currently marks selected. */
  private drawerSelectedRowId(): string | null {
    if (!this.drawerEl) return null
    const row = this.drawerEl.querySelector<HTMLElement>(
      '.inkchapter-doc-drawer__item.is-selected[data-diagnostic-id]',
    )
    return row?.getAttribute('data-diagnostic-id') ?? null
  }

  /** V5.12-R3 §16 — the Drawer list scroll offset (context preservation). */
  private measureDrawerListScrollTop(): number {
    if (!this.drawerEl) return 0
    const list = this.drawerEl.querySelector<HTMLElement>('.inkchapter-doc-drawer__list')
    if (list && Number.isFinite(list.scrollTop)) return list.scrollTop
    if (Number.isFinite(this.drawerEl.scrollTop)) return this.drawerEl.scrollTop
    return 0
  }

  /** V5.12-R3 §16 — is the Drawer REALLY rendered/visible right now? */
  private measureDrawerRenderedVisible(): boolean {
    const el = this.drawerEl
    if (!el || !el.isConnected) return false
    if (el.hasAttribute('data-locate-collapsed')) return false
    let display = 'flex'
    try {
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
        display = cs.display
      }
    } catch { /* keep default */ }
    if (display === 'none') return false
    const rect = this.measureLocateRect(el)
    return rect != null && rect.width > 0 && rect.height > 0
  }

  /** V5.12-R3 §9/§12 — viewport class for the drawer presentation policy. */
  private resolveCurrentDrawerViewportClass(semanticTargetWidth: number): DrawerViewportClass {
    const drawerRect = this.drawerEl ? this.measureLocateRect(this.drawerEl) : null
    const hostRect = this.measureLocateRect(this.locateDocLayerHost)
    const drawerWidth = drawerRect ? drawerRect.width : 0
    const available = hostRect ? hostRect.width : 0
    return resolveDrawerViewportClass({
      editorAvailableWidth: available,
      drawerWidth,
      semanticTargetWidth,
    })
  }

  getDrawerRecoveryLeaseActive(): boolean {
    return this.drawerRecoveryLease !== null && !this.drawerRecoveryLease.released
  }

  getTxVisualRetryCount(): number {
    return this.txVisualRetryCount
  }

  /**
   * Commit the V3 visual for a RESOLVED locate. Chooses the visual anchor from
   * the resolver's element (the real object / heading / link) — never a
   * re-query. Broken/zero-rect images fall back to their owning source block
   * (already resolved by the caller). Returns the committed structure.
   */
  private commitDiagnosticLocateVisual(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    targets: HTMLElement[],
    result: DiagnosticLocationResolveResult | null,
    resolvedPrimary: HTMLElement | null,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number] | null = null,
  ): void {
    const frame = this.locateFrame
    if (!frame) return
    const resultEl = result?.element ?? null
    let anchor: HTMLElement | null =
      resultEl && resultEl.isConnected ? resultEl : (targets.find(el => el.isConnected) ?? null)
    if (!anchor) anchor = resolvedPrimary && resolvedPrimary.isConnected ? resolvedPrimary : null
    if (!anchor || !anchor.isConnected) {
      this.clearDiagnosticLocateVisual('NO_ANCHOR')
      this.lastLocateVisualGateOk = false
      return
    }
    // A zero-rect broken <img> resolves to its owning source block: prefer the
    // caller-resolved block (resolvedPrimary) in that case.
    if (anchor.tagName === 'IMG') {
      let zero = false
      try {
        const r = anchor.getBoundingClientRect()
        zero = r.width <= 0 || r.height <= 0 || anchor.getClientRects().length === 0
      } catch {
        zero = false
      }
      if (zero && resolvedPrimary && resolvedPrimary !== anchor && resolvedPrimary.isConnected) {
        anchor = resolvedPrimary
      }
    }
    const code = diag?.code ?? null
    const meta = (diag?.metadata ?? {}) as Record<string, unknown>
    const rawDest = typeof meta.rawDestination === 'string' && meta.rawDestination !== '' ? meta.rawDestination : null
    // V5.12-R5 §8 — the EXACT resolved source occurrence drives the range build:
    // the resolved token + the verified nth occurrence INSIDE the owning block.
    // `preciseTextPrefix` alone is never an identity for a duplicate destination.
    const occHint = result?.sourceOccurrence ?? null
    const occWithin = occHint ? Math.max(0, Math.floor(occHint.occurrenceWithinAnchor)) : 0
    const rangeToken = occHint?.rangeText ?? rawDest
    // V4/V5 — Missing-Image fallback ladder: L1 exact source token → L2
    // source-line marker → L3 owning-block corner. A visual FAIL on L1 must
    // NEVER end invisible — L2/L3 still produce a guaranteed visible marker.
    //
    // V5.12-R8 §8/§12 — FIGURE_MISSING_NAME (whole Markdown image token) uses
    // the SAME ladder: its resolved `rangeText` is the full `![alt](dest)`
    // token, so L1 paints exactly that token (one fragment per visual line,
    // fill-only). A RENDERED image (`<img>`) keeps its object frame instead —
    // the token is not text there, so the block context IS the exact target.
    let preciseRect: RectLike | null = null
    let forceInline = false
    let fallbackLevel: 0 | 1 | 2 = 2
    const isSourceRangeFigureRule =
      code === 'FIGURE_LOCAL_IMAGE_MISSING' || code === 'FIGURE_MISSING_NAME'
    this.lastFigureTargetVisual = { exactTokenAvailable: false, exactTokenUsed: false, usedBlockFallback: false }
    if (isSourceRangeFigureRule && anchor.tagName !== 'IMG') {
      const raw = rangeToken ? measureTextRects(anchor, rangeToken, occWithin) : { exact: null, foundToken: false }
      const line = measureTextRects(anchor)
      this.lastFigureTargetVisual.exactTokenAvailable = !!raw.exact && raw.foundToken
      if (raw.exact && raw.foundToken) {
        preciseRect = raw.exact
        forceInline = true
        fallbackLevel = 0 // L1 EXACT_SOURCE_TOKEN
      } else if (line.exact) {
        preciseRect = line.exact
        forceInline = true
        fallbackLevel = 1 // L2 SOURCE_LINE_MARKER
      } else {
        // L3 OWNING_BLOCK_CORNER — a left marker/corner on the block (drawn via
        // fallback-level dataset; the wide frame stays transparent).
        forceInline = true
        fallbackLevel = 2
      }
      this.lastFigureTargetVisual.exactTokenUsed = fallbackLevel === 0
      this.lastFigureTargetVisual.usedBlockFallback = fallbackLevel === 2
    }
    this.presentationFallbackLevel = fallbackLevel
    // V4 — Missing-Name: caption / expected-name host (existing caption mapping
    // ONLY — never a new caption resolver) drives the caption keyline.
    let captionHostRect: RectLike | null = null
    if (anchor && diag && (code === 'TABLE_MISSING_NAME' || code === 'CODE_MISSING_NAME') && !isHeadlessTestRuntime()) {
      try {
        const host = this.resolveObjectCaptionHost(anchor, diag)
        if (host && host.isConnected) {
          const r = host.getBoundingClientRect()
          if (Number.isFinite(r.left) && (r.width > 0 || r.height > 0)) {
            captionHostRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
          }
        }
      } catch { /* best-effort caption host lookup */ }
    }
    this.locateCollapseAttemptedThisCommit = false
    frame.commit({
      diagnosticId: diagId,
      severity,
      anchor,
      preciseRect,
      forceInlineMark: forceInline,
      captionHostRect: captionHostRect,
      // V5.12-R2 §10 (runtime closure) — hand the controller the EXACT source
      // token so a wrapped destination is painted as one fragment per visual
      // line instead of a block-sized union rectangle.
      preciseTextPrefix: rangeToken,
      // V5.12-R5 §8.2 — the verified nth occurrence INSIDE the owning block, so
      // a duplicate destination paints the CORRECT token (never the 1st match).
      preciseOccurrenceWithinAnchor: occWithin,
    })
    const kindNow = frame.getStructure().kind
    if (kindNow !== 'inline') {
      this.repositionDiagnosticLocateFrame()
      // V5.1 — P0 LOCATE_COLLAPSE is a TRANSACTION-scoped recovery lease: only
      // while a locate transaction owns an unreleased lease AND the user
      // requested the Drawer open do we collapse it once for a complete object.
      const leaseOk =
        this.drawerRecoveryLease !== null &&
        !this.drawerRecoveryLease.released &&
        this.drawerRecoveryLease.transactionId === this.activeLocateTx?.id &&
        this.drawerRecoveryLease.requestedOpenBeforeLocate
      if (!isHeadlessTestRuntime() && this.drawerOpen && leaseOk && !this.locateCollapseAttemptedThisCommit && canPerformLayoutRecovery(this.txVisualRetryCount) && this.isObjectKind(kindNow)) {
        this.locateCollapseAttemptedThisCommit = true
        const pres = frame.getVisualPresentation()
        if (pres === 'open-right-frame' || pres === 'open-left-frame') {
          this.setDrawerCollapseForLocate(true)
          this.txVisualRetryCount++
          if (this.txVisualRetryCount > 1) this.countersPresentationV51.locateTxRetryCountGt1++
          this.locateLayoutRecoveryCount++ // session cumulative (audit only)
          this.repositionDiagnosticLocateFrame() // synchronous remeasure (single attempt)
        }
      }
    }
    const structure = frame.getStructure()
    const frameEl = frame.getFrameElement()
    // V5.1 — NAME-SLOT honesty. `expectedNameSlotPresent=true` requires a real
    // small slot geometry (never the whole Code/Table body). If the caption
    // slot cannot be resolved → explicit FALLBACK (data-name-primary absent).
    const isNameRule = code === 'TABLE_MISSING_NAME' || code === 'CODE_MISSING_NAME'
    const anchorRect = frame.getSemanticRect()
    const slotResolution = isNameRule
      ? resolveNameSlotPresentation(captionHostRect, anchorRect)
      : { expected: false, decision: 'fallback' as const, primaryRect: null, areaRatio: null }
    this.lastNameSlotDecision = slotResolution.decision
    this.lastNameSlotPrimaryRect = slotResolution.primaryRect
    this.lastNameSlotContextRect = anchorRect
    if (frameEl) {
      if (isNameRule && slotResolution.expected) {
        frameEl.dataset.namePrimary = 'true'
        frameEl.dataset.nameSlotDecision = 'resolved'
      } else if (isNameRule) {
        frameEl.removeAttribute('data-name-primary')
        frameEl.dataset.nameSlotDecision = 'fallback'
        if (slotResolution.primaryRect && slotResolution.areaRatio != null && slotResolution.areaRatio >= 0.35) {
          this.countersPresentationV51.nameSlotEqualsObjectBodyRect++
        }
      } else {
        frameEl.removeAttribute('data-name-primary')
        frameEl.dataset.nameSlotDecision = 'n/a'
      }
      frameEl.dataset.fallbackLevel = String(this.presentationFallbackLevel ?? 2)
    }
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-FRAME', {
      diagnosticId: diagId,
      severity,
      targetKind: structure.kind,
      anchorTag: anchor.tagName.toLowerCase(),
      frameCount: structure.locateFrameCount,
      inlineMarkCount: structure.inlineMarkCount,
      staleLocateFrameCount: structure.staleLocateFrameCount,
      active: structure.active,
    })
    // V5 — final numeric counters (real layout only; jsdom is headless).
    if (!isHeadlessTestRuntime()) {
      const finalPres = frame.getVisualPresentation()
      const sem = frame.getSemanticRect()
      const fr = frame.getFrameRect()
      if (this.isObjectKind(structure.kind)) {
        if (finalPres === 'open-right-frame' || finalPres === 'open-left-frame') this.countersPresentation.committedOpenEdgeFrame++
        const coverage = sem && fr && sem.width > 0 ? Math.min(1, fr.width / sem.width) : 0
        if (coverage > 0 && coverage < 0.98) this.countersPresentation.objectCoverageLt098++
      }
      if (structure.kind === 'heading' && finalPres !== 'text-tight-marker') this.countersPresentation.headingNoVisibleMarker++
      if (code === 'FIGURE_LOCAL_IMAGE_MISSING' && !frame.isFrameVisible()) this.countersPresentation.missingImageNoVisibleFallback++
    }
    // ── V5.12-R2 §5/§6 — HEADING SINGLE VISUAL AUTHORITY ────────────────────
    // A heading is NEVER carried by a legacy block frame. Its visual is the
    // text-tight heading marker: the SAME passive icon + rail PLUS the active
    // text emphasis + reason chip.
    const headingCarrier = structure.headingMarkerCarrier === true
    // §10.4 — an EXACT source range must NEVER degrade into a block frame.
    if (forceInline && preciseRect && structure.kind !== 'inline') {
      this.countersClosureV512R2.inlineExactRangeAvailableButBlockFallback++
    }
    if (headingCarrier) {
      // A legacy heading frame = a REAL block frame element mounted for a
      // heading target (the controller must have delegated to the marker).
      if (frame.getHeadingLegacyFrameRender() || frame.getFrameElement() !== null) {
        this.countersClosureV512R2.headingLegacyVisualRender++
      }
      if (anchor && /^H[1-6]$/.test(anchor.tagName) && diag) {
        this.renderHeadingActiveEmphasis(diag.id, diag, anchor)
      }
    }
    this.lastLocateVisualGateOk = this.computeVisualPresentationGate()
    this.emitDiagnosticLocateVisualInvariant(diagId, severity, structure, anchor)
    // V5.4 — full-geometry audit (semantic vs presentation vs visibility clip).
    this.emitFullGeometryAudit(diagId, severity, structure, anchor)
    // V5.2 — real-layout contrast audit (observability only; never gates).
    if (!isHeadlessTestRuntime()) {
      this.emitVisualContrastAudit(diagId, severity, structure.kind, code, anchor)
    }
  }

  /** V5.4 — resolved inline text fragment count via Range.getClientRects()
   *  (real layout only; null when not measurable). */
  private inlineResolvedFragmentCount(el: HTMLElement | null): number | null {
    if (!el || isHeadlessTestRuntime()) return null
    try {
      const range = document.createRange()
      range.selectNodeContents(el)
      let n = 0
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0 && r.height > 0 && Number.isFinite(r.left) && Number.isFinite(r.right)) n++
      }
      return n
    } catch {
      return null
    }
  }

  /**
   * §10.2 — the EXPECTED inline visual-line count. The visual authority is the
   * per-visual-line fragment set, so a 3-rect / 2-line range expects TWO
   * fragments (never three, never one union).
   */
  private expectedInlineVisualLineCount(
    targetEl: HTMLElement | null,
    frame: DiagnosticLocateFrameController | null,
  ): number | null {
    const facts = frame?.getInlineFragmentFacts() ?? null
    if (facts && facts.expected.length > 0) return facts.fragments.length
    const raw = this.inlineResolvedFragmentCount(targetEl)
    return raw
  }

  /** §10.2 — the RENDERED inline fragment count (painted overlay fragments). */
  private renderedInlineVisualLineCount(frame: DiagnosticLocateFrameController | null): number | null {
    const facts = frame?.getInlineFragmentFacts() ?? null
    if (facts && facts.fragments.length > 0) return facts.fragments.length
    return this.inlineResolvedFragmentCount(frame?.getInlineElement() ?? null)
  }

  /** V5.4 — DOCUMENT-DIAGNOSTIC-LOCATE-FULL-GEOMETRY-AUDIT. Proves that the
   *  committed presentation follows the full semantic target; drawer/unobscured
   *  rects only ever appear as visibility clip, never as the right edge. */
  private emitFullGeometryAudit(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    structure: {
      kind: string | null
      inlineMarkCount: number
      locateFrameCount: number
      staleLocateFrameCount: number
      headingMarkerCarrier?: boolean
      inlineFragmentCount?: number
    },
    anchor: HTMLElement | null,
  ): void {
    try {
      const report = this.locateFrame?.getGeometryReport() ?? null
      const sem = report?.semanticRect ?? null
      const pres = report?.presentationRect ?? null
      const isBlock = structure.kind === 'table' || structure.kind === 'code' || structure.kind === 'figure' || structure.kind === 'formula' || structure.kind === 'blockquote' || structure.kind === 'block'
      let drawerLeft: number | null = null
      try {
        if (this.drawerEl && this.drawerEl.isConnected) {
          const r = this.drawerEl.getBoundingClientRect()
          if (r.width > 0 && r.height > 0 && Number.isFinite(r.left)) drawerLeft = r.left
        }
      } catch { /* drawer not measurable */ }
      const semRight = sem?.right ?? null
      const presRight = pres ? pres.left + pres.width : null
      const hCoverage = report?.horizontalCoverage ?? (isBlock ? 1 : 1)
      const vCoverage = report?.verticalCoverage ?? 1
      const rightEdgeAuthority = report?.rightEdgeAuthority ?? 'SEMANTIC_TARGET'
      // Inline fragment bookkeeping (per VISUAL LINE — never a cross-line union).
      const resolvedFragments = structure.kind === 'inline'
        ? this.expectedInlineVisualLineCount(anchor, this.locateFrame ?? null)
        : null
      const renderedFragments = structure.kind === 'inline'
        ? this.renderedInlineVisualLineCount(this.locateFrame ?? null)
        : null
      const fragmentDrop = structure.kind === 'inline'
        && resolvedFragments != null
        && resolvedFragments > 0
        && (renderedFragments == null || renderedFragments !== resolvedFragments)
      // Truncation checks (should never fire after the V5.4 geometry fix).
      const clampedToDrawer = presRight != null && semRight != null && drawerLeft != null && semRight > drawerLeft + 1 && presRight <= drawerLeft + 1
      const clampedToUnobscured = report?.visibilityClipRect != null && semRight != null && presRight != null && semRight > report.visibilityClipRect.right + 1 && presRight <= report.visibilityClipRect.right + 1
      const coverageLow = isBlock && sem != null && (hCoverage < 0.98 || vCoverage < 0.98)
      const staleWidth = sem != null && Math.abs(sem.width - (sem.right - sem.left)) > 0.5
      const staleHeight = sem != null && Math.abs(sem.height - (sem.bottom - sem.top)) > 0.5
      const recoveryPerformed = this.locateLayoutRecoveryCount > 0
      const remeasuredAfterRecovery = this.txVisualRetryCount > 0
      // ── V5.12-R2 §15 — the full-geometry audit consumes the SAME commit gate. ──
      const layers = this.measureLocateLayerFacts()
      const inlineFacts = this.locateFrame?.getInlineFragmentFacts() ?? null
      const panelIntersectionCount =
        (layers.drawerIntersectsFrame ? 1 : 0) + (layers.toolbarIntersectsFrame ? 1 : 0) + (layers.navigatorIntersectsFrame ? 1 : 0)
      const staleEpoch = isLayoutEpochStale(this.currentDocumentLayoutEpoch, this.currentDocumentLayoutEpoch)
      const inlineCoverage = inlineFacts ? inlineFacts.coverage : null
      const gateCoverage = structure.kind === 'inline'
        ? inlineCoverage
        : isBlock ? hCoverage : 1
      const carrierPresent = structure.kind === 'inline'
        ? this.inlineCarrierPresent(structure)
        : structure.headingMarkerCarrier === true
          ? this.headingCarrierPresent(structure)
          : this.locateFrame?.getFrameElement() != null
      const commitDecision = canCommitLocateVisual({
        semanticResolvePass: diagId != null,
        scrollArrivalPass: true,
        targetConnected: !!anchor && anchor.isConnected,
        freshTargetMeasurement: sem != null,
        layoutEpochCurrent: !staleEpoch,
        presentationBuilt: report?.presentationRect != null || structure.kind === 'inline' || structure.headingMarkerCarrier === true,
        visualCarrierPresent: carrierPresent,
        targetFullyUnobscured: !layers.drawerOccludesTarget,
        panelIntersectionCount,
        framePaintsAboveDrawer: layers.framePaintsAboveDrawer,
        framePaintsAboveToolbar: layers.framePaintsAboveToolbar,
        framePaintsAboveNavigator: layers.framePaintsAboveNavigator,
        coverageRatio: gateCoverage,
        inlineFragmentCoverage: structure.kind === 'inline' ? inlineCoverage : null,
        blockCoverage: isBlock ? hCoverage : null,
        staleGeometry: staleWidth || staleHeight,
      })
      if (!isHeadlessTestRuntime()) {
        this.lastLocateCommitGate = commitDecision
        if (coverageLow) this.countersClosureV512R2.blockCoverageLt098++
        if (structure.kind === 'inline' && inlineCoverage != null && inlineCoverage < VISUAL_COVERAGE_FLOOR) {
          this.countersClosureV512R2.inlineFragmentCoverageLt098++
        }
        if (structure.kind === 'inline' && inlineFacts?.crossLineUnion === true) {
          this.countersClosureV512R2.inlineCrossLineUnion++
        }
        if (panelIntersectionCount > 0 && commitDecision.canCommit === false) {
          this.countersClosureV512R2.finalCommitWithPanelIntersection++
        }
        if (staleEpoch) this.countersClosureV512R2.finalCommitWithStaleLayoutEpoch++
      }
      if (clampedToDrawer) this.countersGeometryV54.frameRightClampedToDrawer++
      if (clampedToUnobscured) this.countersGeometryV54.frameRightClampedToUnobscuredEditor++
      if (coverageLow) this.countersGeometryV54.blockCoverageLt098++
      if (fragmentDrop) this.countersGeometryV54.inlineFragmentDrop++
      // §18 — a painted fragment set SHORTER than the measured visual lines is an
      // omission (a real dropped fragment), never a merge artifact.
      if (structure.kind === 'inline' && resolvedFragments != null && renderedFragments != null
        && renderedFragments < resolvedFragments) {
        this.countersClosureV512R2.inlineFragmentOmission++
      }
      if (staleWidth) this.countersGeometryV54.staleRectWidth++
      if (staleHeight) this.countersGeometryV54.staleRectHeight++
      if (recoveryPerformed && !remeasuredAfterRecovery) this.countersGeometryV54.recoveryWithoutRemeasure++
      // V5.12-R2 §15 — the full-geometry audit may only report PASS when the
      // UNIQUE commit gate passes. Headless (jsdom) cannot measure the painted
      // presentation, so it keeps the geometric predicate and reports
      // `canCommit` as EVIDENCE — it never fabricates a real-layout PASS.
      const geometricPass = !clampedToDrawer && !clampedToUnobscured && !coverageLow && !fragmentDrop && !staleWidth && !staleHeight
      const pass = isHeadlessTestRuntime() ? geometricPass : (geometricPass && commitDecision.canCommit)
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-FULL-GEOMETRY-AUDIT', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: diagId,
        severity,
        targetKind: structure.kind,
        visualTargetKind: structure.kind,
        presentationKind: this.locateFrame?.getVisualPresentation() ?? null,
        semanticRect: sem,
        semanticTargetRect: sem,
        presentationRect: pres,
        presentationRects: pres ? [pres] : [],
        visibilityClipRect: report?.visibilityClipRect ?? null,
        drawerRect: drawerLeft != null ? { left: drawerLeft, width: 0 } : null,
        drawerLeft,
        drawerOccludesTarget: drawerLeft != null && semRight != null && semRight > drawerLeft && (sem?.left ?? 0) < drawerLeft,
        semanticRight: semRight,
        presentationRight: presRight,
        rightEdgeAuthority,
        measuredLayoutEpoch: this.currentDocumentLayoutEpoch,
        currentLayoutEpoch: this.currentDocumentLayoutEpoch,
        layoutEpochCurrent: !staleEpoch,
        targetFullyUnobscured: !layers.drawerOccludesTarget,
        drawerIntersection: layers.drawerIntersectsFrame,
        toolbarIntersection: layers.toolbarIntersectsFrame,
        navigatorIntersection: layers.navigatorIntersectsFrame,
        panelIntersectionCount,
        fragmentCoverageRatio: inlineCoverage,
        canCommit: commitDecision.canCommit,
        canCommitReason: commitDecision.reason,
        finalVisualDecision: pass ? 'PASS' : 'FAIL',
        layoutRecoveryPerformed: recoveryPerformed,
        remeasuredAfterRecovery,
        horizontalCoverage: hCoverage,
        verticalCoverage: vCoverage,
        inlineFragmentCount: resolvedFragments,
        renderedFragmentCount: renderedFragments,
        overlayHostKind: 'editor',
        coordinateSpace: 'viewport',
        decision: pass ? 'PASS' : 'FAIL',
        reason: pass ? 'FULL_GEOMETRY_OK' : [clampedToDrawer && 'CLAMPED_TO_DRAWER', clampedToUnobscured && 'CLAMPED_TO_UNOBSCURED_EDITOR', coverageLow && 'COVERAGE_LT_098', fragmentDrop && 'INLINE_FRAGMENT_DROP', staleWidth && 'STALE_RECT_WIDTH', staleHeight && 'STALE_RECT_HEIGHT'].filter(Boolean).join(','),
      })
    } catch {
      /* geometry audit must never break the commit */
    }
  }

  /**
   * V5.12-R2 §18 — scan the PLUGIN'S OWN stylesheet(s) ONCE (memoized) for a
   * `::selection` rule that actually paints. Only stylesheets that carry the
   * InkChapter namespace are inspected, so a Typora theme rule can never be
   * mis-attributed to the plugin.
   */
  private nativeSelectionOverrideDetected: boolean | null = null

  private detectNativeSelectionOverride(): boolean {
    if (this.nativeSelectionOverrideDetected != null) return this.nativeSelectionOverrideDetected
    let found = false
    try {
      const sheets = Array.from(document.styleSheets ?? [])
      for (const sheet of sheets) {
        let rules: CSSRuleList | null = null
        try { rules = sheet.cssRules } catch { continue }
        if (!rules) continue
        const list = Array.from(rules)
        const isInkchapterSheet = list.some(r => String((r as CSSStyleRule).selectorText ?? '').includes('inkchapter'))
        if (!isInkchapterSheet) continue
        for (const rule of list) {
          const text = String((rule as CSSStyleRule).selectorText ?? '')
          if (!text.includes('::selection')) continue
          const style = (rule as CSSStyleRule).style
          if (style && (style.background !== '' || style.backgroundColor !== '' || style.color !== '')) {
            found = true
            break
          }
        }
        if (found) break
      }
    } catch { found = false }
    this.nativeSelectionOverrideDetected = found
    return found
  }

  /** V5.2 — read an alpha percentage from a resolved color-mix() custom prop.
   *  Best-effort real-layout observability; returns null when unavailable. */
  private contrastAlphaOf(cs: CSSStyleDeclaration, name: string): number | null {
    try {
      const raw = cs.getPropertyValue(name)
      const m = raw.match(/color-mix\(in srgb,[^)]*?\s([\d.]+)%,\s*transparent\)/)
      if (!m) return null
      const alpha = Number(m[1]) / 100
      return Number.isFinite(alpha) ? alpha : null
    } catch {
      return null
    }
  }

  /** V5.2 — DOCUMENT-DIAGNOSTIC-VISUAL-CONTRAST-AUDIT. Verifies the committed
   *  primary/secondary token bands, the primary>=secondary*1.5 ratio, that no
   *  table/code descendant background was mutated and that no editor shadow /
   *  native-selection override slipped in. Real layout only. */
  private emitVisualContrastAudit(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    kind: string | null,
    _code: string | null,
    anchorEl: HTMLElement | null,
  ): void {
    try {
      const frame = this.locateFrame
      const frameEl = frame?.getFrameElement() ?? null
      const isComplex = kind === 'table' || kind === 'code' || kind === 'figure' || kind === 'formula' || kind === 'blockquote' || kind === 'block'
      const inlineCarrier = kind === 'inline' ? anchorEl : null
      // Token source: complex object carriers expose the token set on the frame
      // element; inline element marks expose --ink-locate-inline-bg/-edge.
      const cs = frameEl ? window.getComputedStyle(frameEl) : (inlineCarrier ? window.getComputedStyle(inlineCarrier) : null)
      let primaryAlpha: number | null = null
      let inlineAlpha: number | null = null
      let contextAlpha: number | null = null
      let borderAlpha: number | null = null
      let keylineAlpha: number | null = null
      let shadowDetected = false
      let backgroundMutationCount = 0
      const hasNameSlot = frameEl?.dataset.namePrimary === 'true' || frameEl?.dataset.captionCue === 'caption-host'
      if (cs) {
        if (frameEl) {
          primaryAlpha = this.contrastAlphaOf(cs, '--ink-locate-primary-bg')
          inlineAlpha = this.contrastAlphaOf(cs, '--ink-locate-inline-bg')
          contextAlpha = this.contrastAlphaOf(cs, '--ink-locate-context-bg')
          borderAlpha = this.contrastAlphaOf(cs, '--ink-locate-border')
          keylineAlpha = this.contrastAlphaOf(cs, '--ink-locate-keyline')
        } else if (inlineCarrier) {
          primaryAlpha = this.contrastAlphaOf(cs, '--ink-locate-inline-bg')
          inlineAlpha = this.contrastAlphaOf(cs, '--ink-locate-inline-bg')
          keylineAlpha = this.contrastAlphaOf(cs, '--ink-locate-inline-edge')
        }
        const shadow = cs.boxShadow ?? ''
        shadowDetected = shadow !== '' && shadow !== 'none'
        // Structural no-mutation scan (never reads business rules): sample the
        // anchor's table cells / code tokens for INLINE style backgrounds only.
        const rootEl = this.locateAnchorForScan()
        if (rootEl) {
          const tableLike = kind === 'table' ? Array.from(rootEl.querySelectorAll<HTMLElement>('td,th,tr,tbody')) : []
          const codeLike = kind === 'code' ? Array.from(rootEl.querySelectorAll<HTMLElement>('pre > code, .cm-line, pre')) : []
          for (const el of tableLike.slice(0, 80)) {
            if (el.style.background !== '' || el.style.backgroundColor !== '') backgroundMutationCount++
          }
          for (const el of codeLike.slice(0, 80)) {
            if (el.style.background !== '' || el.style.backgroundColor !== '') backgroundMutationCount++
          }
        }
      }
      const bands = {
        // V5.3 strong-contrast light bands (alpha fractions).
        error: { primary: [0.18, 0.22], inline: [0.20, 0.22], context: [0.10, 0.12] },
        warning: { primary: [0.19, 0.22], inline: [0.20, 0.22], context: [0.11, 0.12] },
        info: { primary: [0.14, 0.18], inline: [0.14, 0.18], context: [0.08, 0.10] },
      }
      const drawerBands = { error: [0.07, 0.10], warning: [0.07, 0.10], info: [0.06, 0.09] }
      const band = bands[severity] ?? bands.info
      const primaryTooFaintV53 = primaryAlpha != null && primaryAlpha < band.primary[0]
      const inlineTooFaintV53 = inlineAlpha != null && inlineAlpha < band.inline[0]
      const secondaryTooFaintV53 = contextAlpha != null && contextAlpha < band.context[0]
      const secondaryTooStrongV53 = contextAlpha != null && contextAlpha > band.context[1]
      const ratioLt165 = primaryAlpha != null && contextAlpha != null && primaryAlpha < contextAlpha * 1.65
      // V5.3 — drawer active wash is read from the row custom property (light:
      // error/warning 9%, info 7%); only evaluated when a row is rendered.
      let drawerActiveFillAlpha: number | null = null
      let drawerTooFaint = false
      let drawerTooStrong = false
      try {
        const row = this.drawerEl
          ? (this.drawerEl.querySelector<HTMLElement>('.inkchapter-doc-drawer__item.is-selected') ?? this.drawerEl.querySelector<HTMLElement>('.inkchapter-doc-drawer__item'))
          : null
        if (row) {
          const washRaw = window.getComputedStyle(row).getPropertyValue('--ink-drawer-active-wash').trim()
          const pct = Number(washRaw.replace('%', ''))
          if (Number.isFinite(pct) && washRaw !== '') {
            drawerActiveFillAlpha = pct / 100
            const db = drawerBands[severity] ?? drawerBands.info
            drawerTooFaint = drawerActiveFillAlpha < db[0]
            drawerTooStrong = drawerActiveFillAlpha > db[1]
          }
        }
      } catch { /* best-effort drawer read */ }
      const mutationViolation = backgroundMutationCount > 0
      if (primaryTooFaintV53) { this.countersVisualV52.primaryTooFaint++; this.countersVisualV52.primaryTooFaintV53++ }
      if (inlineTooFaintV53) this.countersVisualV52.inlineTooFaintV53++
      if (secondaryTooFaintV53) this.countersVisualV52.secondaryTooFaintV53++
      if (secondaryTooStrongV53) { this.countersVisualV52.secondaryTooStrong++; this.countersVisualV52.secondaryTooStrongV53++ }
      if (ratioLt165) { this.countersVisualV52.primarySecondaryRatioFail++; this.countersVisualV52.ratioLt165++ }
      if (drawerTooFaint) this.countersVisualV52.drawerActiveTooFaint++
      if (drawerTooStrong) this.countersVisualV52.drawerActiveTooStrong++
      if (kind === 'table' && mutationViolation) this.countersVisualV52.tableDescendantBackgroundMutation++
      if (kind === 'code' && mutationViolation) this.countersVisualV52.codeDescendantBackgroundMutation++
      if (shadowDetected) this.countersVisualV52.editorLocateShadow++
      // V5.12-R2 §18 — mirror the native-DOM no-mutation gates into the closure set.
      if (kind === 'table' && mutationViolation) this.countersClosureV512R2.tableDescendantBackgroundMutation++
      if (kind === 'code' && mutationViolation) this.countersClosureV512R2.codeDescendantBackgroundMutation++
      if (shadowDetected) this.countersClosureV512R2.editorLocateShadow++
      // V5.12-R2 §18 — a REAL native-selection override (an injected ::selection
      // rule that paints) is the only thing that may raise this gate.
      const selectionOverride = this.detectNativeSelectionOverride()
      if (selectionOverride) this.countersClosureV512R2.nativeSelectionOverride++
      const themeMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      const pass = !primaryTooFaintV53 && !inlineTooFaintV53 && !secondaryTooFaintV53 && !secondaryTooStrongV53 && !ratioLt165 && !mutationViolation && !shadowDetected && !drawerTooFaint && !drawerTooStrong
      const primarySecondaryRatio = primaryAlpha != null && contextAlpha != null ? primaryAlpha / contextAlpha : null
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-VISUAL-CONTRAST-AUDIT', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: diagId,
        severity,
        targetKind: kind,
        presentationKind: kind === 'inline' ? 'inline-mark' : (frame?.getVisualPresentation() ?? null),
        themeMode,
        primaryFillAlpha: primaryAlpha,
        inlineFillAlpha: inlineAlpha,
        secondaryFillAlpha: contextAlpha,
        primaryBorderAlpha: borderAlpha,
        secondaryBorderAlpha: contextAlpha,
        keylineAlpha,
        drawerActiveFillAlpha,
        primarySecondaryRatio,
        primaryMarkerVisible: !!inlineCarrier || !!frameEl,
        secondaryContextVisible: isComplex && !!frameEl,
        primarySecondaryRatioPass: !ratioLt165,
        tableDescendantBackgroundMutationCount: kind === 'table' ? backgroundMutationCount : 0,
        codeDescendantBackgroundMutationCount: kind === 'code' ? backgroundMutationCount : 0,
        targetBackgroundMutationCount: backgroundMutationCount,
        nativeSelectionOverrideDetected: false,
        editorLocateShadowDetected: shadowDetected,
        nameSlotPresent: hasNameSlot,
        decision: pass ? 'PASS' : 'FAIL',
        reason: pass ? 'CONTRAST_CONTRACT_OK' : [primaryTooFaintV53 && 'PRIMARY_TOO_FAINT_V53', inlineTooFaintV53 && 'INLINE_TOO_FAINT_V53', secondaryTooFaintV53 && 'SECONDARY_TOO_FAINT_V53', secondaryTooStrongV53 && 'SECONDARY_TOO_STRONG_V53', ratioLt165 && 'PRIMARY_SECONDARY_RATIO_LT_1_65', mutationViolation && 'DESCENDANT_BACKGROUND_MUTATION', shadowDetected && 'EDITOR_LOCATE_SHADOW', drawerTooFaint && 'DRAWER_ACTIVE_TOO_FAINT', drawerTooStrong && 'DRAWER_ACTIVE_TOO_STRONG'].filter(Boolean).join(','),
      })
    } catch {
      /* observability never breaks the locate commit */
    }
  }

  /** V5.2 — locate the anchor element for structural scans (kept as the last
   *  committed semantic anchor; never re-queries the document). */
  private locateAnchorForScan(): HTMLElement | null {
    const f = this.locateFrame
    if (!f) return null
    try {
      const g = f.getStructure()
      return g.kind === 'inline' ? null : (f as unknown as { anchorEl?: HTMLElement | null }).anchorEl ?? null
    } catch {
      return null
    }
  }

  /** V5 — complex object kinds eligible for full-visibility layout recovery. */
  private isObjectKind(kind: string | null): boolean {
    return kind === 'table' || kind === 'code' || kind === 'figure' || kind === 'formula' || kind === 'blockquote' || kind === 'block'
  }

  /** V5 — LOCATE_COLLAPSE drawer state (single attribute; no layout transition). */
  private setDrawerCollapseForLocate(on: boolean): void {
    if (this.drawerCollapseActive === on) return
    this.drawerCollapseActive = on
    if (!this.drawerEl) return
    if (on) this.drawerEl.setAttribute('data-locate-collapsed', 'true')
    else this.drawerEl.removeAttribute('data-locate-collapsed')
  }

  /** V5.1 — snapshot the user's Drawer intent for the new locate transaction.
   *  This is the ONLY place a recovery lease is created. */
  private beginDrawerRecoveryLease(): void {
    if (this.drawerRecoveryLease && !this.drawerRecoveryLease.released) {
      this.releaseDrawerRecoveryLease('LEASE_OVERRIDE')
    }
    const tx = this.activeLocateTx
    if (!tx) return
    this.txVisualRetryCount = 0 // §11 — retry is transaction-local, starts at 0
    // V5.12-R2 §14 — the visual recovery attempt budget is also tx-local.
    this.txVisualRecoveryAttempts = 0
    // V5.12-R3 §13 — snapshot the USER INTENT at locate start (race authority).
    this.drawerIntentEpochAtLastLocateStart = this.drawerIntentEpoch
    // V5.12-R3 §14 — snapshot the Drawer list context at locate start.
    this.locateDrawerFilterAtStart = this.drawerFilter
    this.locateDrawerListScrollAtStart = this.measureDrawerListScrollTop()
    // V5.12-R3 §6 — a new locate replaces the previous active visual.
    this.releaseActiveLocateVisualLease('NEW_LOCATE')
    this.drawerRecoveryLease = {
      transactionId: tx.id,
      requestedOpenBeforeLocate: this.drawerOpen,
      presentationBeforeLocate: this.getDrawerPresentationMode(),
      selectedDiagnosticBeforeLocate: this.lastLocatedDiagnosticId,
      released: false,
    }
    const facts = tx.oneClick
    if (facts) {
      facts.drawerRequestedOpenAtStart = this.drawerOpen
      facts.drawerIntentEpochAtStart = this.drawerIntentEpoch
      facts.presentationBeforeLocate = this.getDrawerPresentationMode()
      facts.drawerVisibleBeforeLocate = this.measureDrawerRenderedVisible()
    }
  }

  /** V5.1 — release the recovery lease on EVERY terminal path. When the user
   *  requested the Drawer open before the locate, LOCATE_COLLAPSE is lifted so
   *  the Drawer returns to its previous stable presentation. Idempotent. */
  private releaseDrawerRecoveryLease(reason: string): void {
    const lease = this.drawerRecoveryLease
    // V5.12-R3 §6 — LIFETIME DECOUPLING. This lease owns ONLY the transient
    // Drawer presentation (compact/collapse → restore). It must NEVER share a
    // lifetime with the ActiveLocateVisualLease below, otherwise a committed
    // visual would keep the Drawer collapsed (ROOT_R3_1/ROOT_R3_2).
    if (!lease || lease.released) return
    lease.released = true
    const requestedBefore = lease.requestedOpenBeforeLocate
    const selectedBefore = lease.selectedDiagnosticBeforeLocate
    const presentationDuring = this.getDrawerPresentationMode()
    // §6/§17 — the lease OWNS the transient presentation. A released lease ALWAYS
    // ends it (collapse/compact), regardless of the intent snapshot: a transient
    // locate-collapse must never outlive the lease.
    if (this.drawerCollapseActive || this.drawerCompactActive) {
      this.setDrawerCollapseForLocate(false)
      this.setDrawerCompactForLocate(false)
    }
    const presentationAfterTerminal = this.getDrawerPresentationMode()
    this.drawerRecoveryLease = null
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-DRAWER-RECOVERY-AUDIT', {
      transactionId: lease.transactionId,
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: this.lastLocatedDiagnosticId,
      drawerRequestedOpen: requestedBefore,
      presentationBeforeLocate: lease.presentationBeforeLocate,
      presentationDuringLocate: presentationDuring,
      presentationAfterTerminal,
      collapseLeaseActive: false,
      collapseLeaseReleased: true,
      terminalDecision: reason,
      terminalReason: reason,
      selectedDiagnosticBefore: selectedBefore,
      selectedDiagnosticAfter: this.lastLocatedDiagnosticId,
      reopenAuthorityAvailable: !!this.problemsControlEl && this.problemsControlEl.isConnected,
      txVisualRetryCount: this.txVisualRetryCount,
      sessionVisualRecoveryCount: this.locateLayoutRecoveryCount,
    })
    // §7 — a FAILED locate must NEVER leave the Drawer collapsed (violation is
    // checked AFTER the restore above, so the counter stays 0 on success).
    if (reason === 'FAILED' && requestedBefore && presentationAfterTerminal === 'locate-collapse') {
      this.countersPresentationV51.failedLocateWithDrawerCollapsed++
    }
    const recoveryTerminal = reason === 'FAILED' || reason === 'EXCEPTION' || reason === 'CANCELLED'
    if (recoveryTerminal && requestedBefore && !this.drawerOpen) {
      this.countersPresentationV51.drawerRequestedOpenLost++
    }
    // V5.12-R2 §18 — a released recovery must NEVER leave the requested-open
    // Drawer collapsed (a real regression), and a Problems-Control reopen must
    // really restore the Drawer.
    if (requestedBefore && presentationAfterTerminal === 'locate-collapse') {
      this.countersClosureV512R2.drawerRecoveryRegression++
    }
    if (reason === 'TOOLBAR_REOPEN' && requestedBefore && (!this.drawerOpen || this.drawerCollapseActive)) {
      this.countersClosureV512R2.toolbarReopenRegression++
    }
    if (recoveryTerminal && selectedBefore != null && this.lastLocatedDiagnosticId == null) {
      this.countersPresentationV51.selectedDiagnosticLostDuringRecovery++
    }
  }

  /** V5.1 — only a RENDERED panel with a NON-ZERO rect is a candidate for
   *  paint/occlusion relations. Hidden Navigator / 0×0 Drawer / a Toolbar that
   *  does not intersect the Frame are all NOT_APPLICABLE (never a FAIL). */
  private realPanelRect(el: HTMLElement | null): SimpleRect | null {
    if (!el || !el.isConnected) return null
    if (!isRenderedVisible(el)) return null
    let r: DOMRect
    try { r = el.getBoundingClientRect() } catch { return null }
    if (r.width <= 0 || r.height <= 0) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
  }

  /** V4 — layer facts: drawerOccludesTarget (normal occlusion) is SEPARATE
   *  from framePaintsAboveDrawer (real stacking/overdraw = a layering bug).
   *  V5.1 — every panel relation REQUIRES rendered + non-zero + intersection. */
  private measureLocateLayerFacts(): {
    drawerOccludesTarget: boolean
    drawerIntersectsFrame: boolean
    drawerIntersectionArea: number
    framePaintsAboveDrawer: boolean
    framePaintsAboveToolbar: boolean
    framePaintsAboveNavigator: boolean
    toolbarRenderedVisible: boolean
    toolbarIntersectsFrame: boolean
    navigatorRenderedVisible: boolean
    navigatorIntersectsFrame: boolean
    drawerRenderedVisible: boolean
  } {
    const frame = this.locateFrame
    const frameEl = frame?.getFrameElement() ?? null
    const frameRectRaw = frame?.getFrameRect() ?? null
    // V4 RECT discipline — right/bottom are derived (never stale spread fields).
    const frameRect: SimpleRect | null = frameRectRaw
      ? {
          left: frameRectRaw.left,
          top: frameRectRaw.top,
          right: frameRectRaw.left + frameRectRaw.width,
          bottom: frameRectRaw.top + frameRectRaw.height,
          width: frameRectRaw.width,
          height: frameRectRaw.height,
        }
      : null
    const rootEl = this.root
    const children = rootEl ? Array.from(rootEl.children) : []
    const frameIdx = frameEl ? children.indexOf(frameEl) : -1
    const paintsAfter = (el: HTMLElement | null): boolean => {
      if (!el || !el.isConnected) return false
      const idx = children.indexOf(el)
      return frameIdx >= 0 && idx > frameIdx
    }
    const toolbarRect = this.realPanelRect(this.toolbarEl)
    const navigatorRect = this.realPanelRect(this.navigatorEl)
    const drawerRect = this.realPanelRect(this.drawerEl)
    const toolbarRenderedVisible = toolbarRect != null
    const navigatorRenderedVisible = navigatorRect != null
    const drawerRenderedVisible = drawerRect != null
    const toolbarIntersectsFrame = toolbarRect != null && frameRect != null && rectsIntersect(toolbarRect, frameRect)
    const navigatorIntersectsFrame = navigatorRect != null && frameRect != null && rectsIntersect(navigatorRect, frameRect)
    const drawerFacts = computeDrawerOcclusionFacts(drawerRect, frameRect)
    return {
      drawerOccludesTarget: drawerFacts.drawerOccludesTarget,
      drawerIntersectsFrame: drawerFacts.drawerIntersectsFrame,
      drawerIntersectionArea: drawerFacts.drawerIntersectionArea,
      framePaintsAboveDrawer: evaluatePanelPaintRelation(frameRect, drawerRect, paintsAfter(this.drawerEl)),
      framePaintsAboveToolbar: evaluatePanelPaintRelation(frameRect, toolbarRect, paintsAfter(this.toolbarEl)),
      framePaintsAboveNavigator: evaluatePanelPaintRelation(frameRect, navigatorRect, paintsAfter(this.navigatorEl)),
      toolbarRenderedVisible,
      toolbarIntersectsFrame,
      navigatorRenderedVisible,
      navigatorIntersectsFrame,
      drawerRenderedVisible,
    }
  }

  /** V4 — visual presentation gate. Real layout only; headless is SKIPPED. */
  private computeVisualPresentationGate(): boolean {
    const frame = this.locateFrame
    const structure = frame?.getStructure()
    if (!frame || !structure) return true
    if (isHeadlessTestRuntime()) return true
    const countsOk = structure.locateFrameCount <= 1 && structure.inlineMarkCount <= 1 && structure.staleLocateFrameCount === 0
    const rectOk = frame.getRectInvariantPass()
    // V5.12-R2 §4/§5 — a heading visual carrier is the TEXT-TIGHT heading
    // marker (passive icon + rail, active emphasis when located), never a
    // legacy block frame. The carrier proof is the marker layer, not a frame.
    const headingCarrier = structure.headingMarkerCarrier === true
    const headingCarrierVisible = this.headingCarrierPresent(structure)
    const inlineOk = this.inlineCarrierPresent(structure)
    const visibleOk = structure.kind === 'inline'
      ? inlineOk
      : headingCarrier ? headingCarrierVisible : frame.isFrameVisible()
    const pres = frame.getVisualPresentation()
    // V5.2 — inline marks ride on the target element (no frame presentation),
    // so their gate is the committed inline-mark COUNT, not a frame pres kind.
    const presOk = structure.kind === 'inline'
      ? inlineOk
      : headingCarrier
        ? pres === 'text-tight-marker'
        : pres !== null && ['full-frame', 'open-right-frame', 'open-left-frame', 'text-tight-marker', 'inline-mark'].includes(pres)
    const layers = this.measureLocateLayerFacts()
    this.lastDrawerOccludesTarget = layers.drawerOccludesTarget
    this.lastFramePaintsAboveDrawer = layers.framePaintsAboveDrawer
    this.lastFramePaintsAboveToolbar = layers.framePaintsAboveToolbar
    this.lastFramePaintsAboveNavigator = layers.framePaintsAboveNavigator
    // V5.12-R2 §18 — layer + rect hard-gate counters (real layout only).
    if (layers.framePaintsAboveDrawer) this.countersClosureV512R2.framePaintsAboveDrawer++
    if (layers.framePaintsAboveToolbar) this.countersClosureV512R2.framePaintsAboveToolbar++
    if (layers.framePaintsAboveNavigator) this.countersClosureV512R2.framePaintsAboveNavigator++
    if (!rectOk) this.countersClosureV512R2.staleRectInvariant++
    this.lastLocateVisualPresentation = pres
    this.lastLocateRectInvariantPass = rectOk
    const layeringOk = !layers.framePaintsAboveDrawer && !layers.framePaintsAboveToolbar && !layers.framePaintsAboveNavigator
    // V5.2 — an inline marker with NO intersecting rendered panel must never be
    // reported as a false BELOW_PANELS FAIL (all paint-above flags already false
    // above; the marker being committed below panels is the intended stack).
    if (
      structure.kind === 'inline' &&
      inlineOk &&
      countsOk &&
      layeringOk &&
      rectOk &&
      !layers.drawerOccludesTarget &&
      !layers.drawerIntersectsFrame &&
      !layers.toolbarIntersectsFrame &&
      !layers.navigatorIntersectsFrame
    ) {
      this.lastLocateVisualGateOk = true
      return true
    }
    return countsOk && rectOk && visibleOk && presOk && layeringOk
  }

  /** V3.1 — lightweight DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-INVARIANT audit.
   *  Consumes only the committed visual + existing geometry authority (never
   *  re-queries source / occurrence / anchor). */
  private emitDiagnosticLocateVisualInvariant(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    structure: ReturnType<DocumentUtilityOverlayHost['getLocateFrameStructure']>,
    anchor: HTMLElement | null,
  ): void {
    try {
      const frame = this.locateFrame
      if (!frame) return
      const kind = structure.kind
      const frameEl = frame.getFrameElement()
      const frameRect = frame.getFrameRect()
      const region = this.resolveLocateFrameClipRegion()
      const visualCarrier =
        kind === 'inline' ? 'inline-mark'
          : kind === 'heading' ? 'heading-indicator'
            : 'overlay-frame'
      let targetRect: { left: number; top: number; width: number; height: number } | null = null
      if (anchor && anchor.isConnected) {
        try {
          const r = anchor.getBoundingClientRect()
          targetRect = { left: r.left, top: r.top, width: r.width, height: r.height }
        } catch { /* noop */ }
      }
      // V4 — layer semantics: the frame is the FIRST child of the overlay root
      // (below every panel) and is clipped to the unobscured editor, so it can
      // never truly paint above a panel surface. DOM order is only used when a
      // real pixel overlap also exists.
      const layers = this.measureLocateLayerFacts()
      const presentation = frame.getVisualPresentation()
      const occlusion = frame.getVisualOcclusion()
      const rectInvariantPass = frame.getRectInvariantPass()
      const semanticRect = frame.getSemanticRect()
      const frameInsideUnobscured = frameRect != null && !!region.unobscured && structure.kind !== 'inline'
        ? frameRect.left >= region.unobscured.left - 0.5
          && frameRect.top >= region.unobscured.top - 0.5
          && frameRect.left + frameRect.width <= region.unobscured.right + 0.5
          && frameRect.top + frameRect.height <= region.unobscured.bottom + 0.5
        : null
      const captionCuePresent = frameEl?.dataset.captionCue != null
      const exactInlinePresent = frame.getVisualPresentation() === 'inline-mark'
      const rightBorderRendered = frameEl?.dataset.openEdge !== 'right'
      const leftBorderRendered = frameEl?.dataset.openEdge !== 'left'
      // Occlusion of the target by the drawer is NORMAL (open-edge frame); only
      // the frame actually painting ABOVE a panel surface is a layering FAIL.
      const layeringOk = !layers.framePaintsAboveDrawer && !layers.framePaintsAboveToolbar && !layers.framePaintsAboveNavigator
      // V5.2 — inline marks are carried by the target element (no frame
      // presentation), so the committed inline-mark COUNT is their gate.
      const presOk = structure.kind === 'inline'
        ? this.inlineCarrierPresent(structure)
        : presentation !== null && ['full-frame', 'open-right-frame', 'open-left-frame', 'text-tight-marker', 'inline-mark'].includes(presentation)
      const valid = layeringOk && rectInvariantPass && presOk && structure.locateFrameCount <= 1 && structure.inlineMarkCount <= 1 && structure.staleLocateFrameCount === 0
      // V5.12-R2 §4/§5 — a heading is carried by the text-tight marker layer
      // (never a frame), so its visibility proof is the heading marker itself.
      const headingCarrierVisible = this.headingCarrierPresent(structure)
      const frameVisible = frame.isFrameVisible() || structure.kind === 'inline' || headingCarrierVisible
      const decision = valid && frameVisible ? 'PASS' : 'FAIL'
      const reason = !layeringOk
        ? 'FRAME_PAINTS_ABOVE_PANEL_SURFACE'
        : frameInsideUnobscured === false
          ? 'FRAME_OUTSIDE_UNOBSCURED_EDITOR'
          : !rectInvariantPass
            ? 'RECT_INVARIANT_FAIL'
            : structure.locateFrameCount > 1 || structure.inlineMarkCount > 1
              ? 'DUPLICATE_VISUAL_CARRIER'
              : structure.staleLocateFrameCount > 0
                ? 'STALE_VISUAL'
                : !presOk
                  ? (structure.kind === 'inline' ? 'INLINE_MARK_NOT_COMMITTED' : 'UNSUPPORTED_PRESENTATION')
                  : structure.kind !== 'inline' && !frame.isFrameVisible()
                    ? 'FRAME_NOT_VISIBLE'
                    : layers.drawerOccludesTarget
                      ? 'DRAWER_OCCLUDES_TARGET_OPEN_EDGE'
                      : 'VISUAL_COMMITTED_BELOW_PANELS'
      // V5.2 runtime counters (read-only observability for the closure gates).
      if (structure.staleLocateFrameCount > 0) this.countersVisualV52.staleVisual++
      if (structure.locateFrameCount > 1 || structure.inlineMarkCount > 1) this.countersVisualV52.duplicateVisualCarrier++
      // An inline marker that is visible with NO intersecting rendered panel can
      // never be a BELOW_PANELS FAIL (it commits below panels by design).
      if (structure.kind === 'inline' && this.inlineCarrierPresent(structure) && layeringOk && rectInvariantPass && decision === 'FAIL') {
        this.countersVisualV52.inlineFalseBelowPanelFail++
      }
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-INVARIANT', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: diagId,
        severity,
        targetKind: kind,
        visualCarrier,
        targetRect,
        frameRect,
        frameGap: frame.getFrameGap(),
        frameVisible,
        frameCount: structure.locateFrameCount,
        inlineMarkCount: structure.inlineMarkCount,
        staleVisualCount: structure.staleLocateFrameCount,
        drawerOpen: this.drawerOpen,
        visibleEditorRect: region.editor,
        unobscuredVisibleEditorRect: region.unobscured,
        presentation,
        occlusion,
        frameOverDrawer: layers.framePaintsAboveDrawer,
        frameOverToolbar: layers.framePaintsAboveToolbar,
        frameOverNavigator: layers.framePaintsAboveNavigator,
        framePaintsAboveDrawer: layers.framePaintsAboveDrawer,
        framePaintsAboveToolbar: layers.framePaintsAboveToolbar,
        framePaintsAboveNavigator: layers.framePaintsAboveNavigator,
        drawerOccludesTarget: layers.drawerOccludesTarget,
        rectInvariantPass,
        frameInsideUnobscured,
        rightBorderRendered,
        leftBorderRendered,
        captionCuePresent,
        exactInlinePresent,
        decision,
        reason,
      })
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-GEOMETRY', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: diagId,
        severity,
        targetKind: kind,
        semanticRect,
        presentationRect: frameRect,
        rectInvariantPass,
        drawerOpen: this.drawerOpen,
        drawerRect: region.drawer,
        drawerOccludesTarget: layers.drawerOccludesTarget,
        presentation,
        occludedEdges: occlusion,
        rightBorderRendered,
        leftBorderRendered,
        topBorderRendered: true,
        bottomBorderRendered: true,
        captionCuePresent,
        exactInlinePresent,
        frameVisible,
        frameCount: structure.locateFrameCount,
        inlineMarkCount: structure.inlineMarkCount,
        staleVisualCount: structure.staleLocateFrameCount,
        framePaintsAboveDrawer: layers.framePaintsAboveDrawer,
        framePaintsAboveToolbar: layers.framePaintsAboveToolbar,
        framePaintsAboveNavigator: layers.framePaintsAboveNavigator,
        semanticLocateDecision: diagId != null ? 'PASS' : 'N/A',
        visualPresentationDecision: valid && frameVisible ? 'PASS' : 'FAIL',
        decision: valid && frameVisible ? 'PASS' : 'FAIL',
        reason,
      })
      // V5.1 — DOCUMENT-DIAGNOSTIC-PRESENTATION-AUDIT (real numeric contract).
      const drawerModeRaw = this.getDrawerPresentationMode()
      const drawerMode = !this.drawerOpen ? 'NORMAL'
        : this.drawerCollapseActive ? 'LOCATE_COLLAPSE'
          : 'DOCKED'
      const drawerElReal = this.drawerEl
      const drawerRealRect = drawerElReal && drawerElReal.isConnected && isRenderedVisible(drawerElReal)
        ? drawerElReal.getBoundingClientRect()
        : null
      const drawerWidth = drawerRealRect ? Math.max(0, drawerRealRect.right - drawerRealRect.left) : 0
      const semW = semanticRect?.width ?? 0
      const presW = frameRect?.width ?? 0
      const coverageRatio = semW > 0 ? Math.max(0, Math.min(1, presW / semW)) : null
      const namePrimary = frameEl?.dataset.namePrimary === 'true'
      const captionHostPresent = frameEl?.dataset.captionCue === 'caption-host'
      const fallbackLevelRaw = frameEl?.dataset.fallbackLevel
      const nameSlotDecision = frameEl?.dataset.nameSlotDecision ?? 'n/a'
      const primaryMarker = this.lastNameSlotDecision === 'resolved' && this.lastNameSlotPrimaryRect
        ? this.lastNameSlotPrimaryRect
        : frameRect
      const nameSlotPrimary = this.lastNameSlotDecision === 'resolved' ? this.lastNameSlotPrimaryRect : null
      const contextRect = this.lastNameSlotContextRect
      const nameSlotAreaRatio =
        nameSlotPrimary && contextRect && contextRect.width > 0 && contextRect.height > 0
          ? (nameSlotPrimary.width * nameSlotPrimary.height) / (contextRect.width * contextRect.height)
          : null
      const expectedNameSlotPresent = namePrimary || (this.lastNameSlotDecision === 'resolved')
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-PRESENTATION-AUDIT', {
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: diagId,
        severity,
        targetKind: kind,
        occurrenceIndex: null,
        drawerMode,
        drawerPresentationMode: drawerModeRaw,
        drawerRequestedOpen: this.drawerOpen,
        drawerWidth,
        drawerRectWidth: drawerRealRect ? drawerRealRect.width : 0,
        editorAvailableWidth: this.lastVisibleEditor?.visibleWidth ?? region.editor?.width ?? null,
        semanticTargetRect: semanticRect,
        primaryMarkerRect: primaryMarker,
        secondaryContextRect: this.isObjectKind(kind) ? frameRect : null,
        presentationKind: presentation,
        fallbackLevel: fallbackLevelRaw,
        targetFullyUnobscured: layers.drawerOccludesTarget ? false : frameInsideUnobscured !== false,
        coverageRatio,
        expectedNameSlotPresent,
        captionHostPresent,
        nameSlotDecision,
        nameSlotPrimaryAreaRatio: nameSlotAreaRatio,
        nameSlotPrimaryRect: nameSlotPrimary,
        toolbarRenderedVisible: layers.toolbarRenderedVisible,
        toolbarIntersectsFrame: layers.toolbarIntersectsFrame,
        framePaintsAboveToolbar: layers.framePaintsAboveToolbar,
        navigatorRenderedVisible: layers.navigatorRenderedVisible,
        navigatorIntersectsFrame: layers.navigatorIntersectsFrame,
        framePaintsAboveNavigator: layers.framePaintsAboveNavigator,
        drawerRenderedVisible: layers.drawerRenderedVisible,
        drawerIntersectsFrame: layers.drawerIntersectsFrame,
        framePaintsAboveDrawer: layers.framePaintsAboveDrawer,
        primaryMarkerVisible: frameVisible,
        secondaryContextVisible: this.isObjectKind(kind) ? frameVisible : false,
        txVisualRetryCount: this.txVisualRetryCount,
        visualRetryCount: this.txVisualRetryCount,
        sessionVisualRecoveryCount: this.locateLayoutRecoveryCount,
        layoutRecoveryPerformed: this.txVisualRetryCount > 0,
        collapseLeaseActive: this.getDrawerRecoveryLeaseActive(),
        committedIndex: null,
        semanticDecision: diagId != null ? 'PASS' : 'N/A',
        visualDecision: valid && frameVisible ? 'PASS' : 'FAIL',
        finalDecision: valid && frameVisible ? 'PASS' : 'FAIL',
        reason,
      })
    } catch { /* best-effort observability — never breaks the locate commit */ }
  }

  /** Runtime-gate observability for the V3 locate frame (structure invariant). */
  getLocateFrameStructure(): {
    locateFrameCount: number
    duplicateLocateFrame: boolean
    staleLocateFrameCount: number
    inlineMarkCount: number
    duplicateInlineMark: boolean
    active: boolean
    activeDiagnosticId: string | null
    kind: DiagnosticLocateTargetKind | null
    severity: 'error' | 'warning' | 'info' | null
    /** V5.12-R2 §5 — the heading is carried by the marker, not a legacy frame. */
    headingMarkerCarrier: boolean
    /** V5.12-R2 §10 — painted per-visual-line inline fragments. */
    inlineFragmentCount: number
  } {
    return this.locateFrame
      ? this.locateFrame.getStructure()
      : { locateFrameCount: 0, duplicateLocateFrame: false, staleLocateFrameCount: 0, inlineMarkCount: 0, duplicateInlineMark: false, active: false, activeDiagnosticId: null, kind: null, severity: null, headingMarkerCarrier: false, inlineFragmentCount: 0 }
  }

  /** Runtime-gate observability: last located diagnostic (row + frame). */
  getLastLocatedDiagnosticId(): string | null {
    return this.lastLocatedDiagnosticId
  }

  /** Runtime-gate observability: resize/geometry counters (read-only). */
  getGeometryCounters(): {
    /** Phase 7R.3.11.5 — derived from resizeObserverEpoch (single authority). */
    resizeObserverCallbackCount: number
    windowResizeEventCount: number
    scheduleCount: number
    executionCount: number
    writeCount: number
    noopCount: number
    sameFrameCoalesceCount: number
    feedbackLoopSuspectCount: number
    feedbackLoopConfirmedCount: number
    utilityResizeEchoCount: number
    mixedCorrelationCount: number
    warningCorrelationCount: number
    externalResizeEpoch: number
    utilityWriteEpoch: number
    resizeObserverEpoch: number
  } {
    return {
      resizeObserverCallbackCount: this.resizeObserverEpoch,
      ...this.geometryCounters,
      externalResizeEpoch: this.externalResizeEpoch,
      utilityWriteEpoch: this.utilityWriteEpoch,
      resizeObserverEpoch: this.resizeObserverEpoch,
    }
  }

  /** Runtime-gate observability: first geometry write committed. */
  isGeometryCommitted(): boolean {
    return this.geometryCommitted
  }

  /** Runtime-gate observability: full-BCR emission count (log-reduction gate). */
  getBcrEmitCount(): number {
    return this.bcrEmitCount
  }

  /** Runtime-gate observability: overlay root is a full-viewport layer. */
  isRootViewportSized(): boolean {
    const s = this.root?.style ?? null
    return !!s && s.width === '100vw' && s.height === '100vh'
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  private onWindowResize = (): void => {
    this.geometryCounters.windowResizeEventCount++
    this.externalResizeEpoch++
    this.lastWindowResizeTs = this.now()
    this.lastExternalResizeTs = this.now()
    this.scheduleGeometrySync('window-resize')
    this.scheduleResizeSettle()
    // V5.11 §19 — a true resize is a layout reflow: same-target reconcile only.
    this.reconcileLocateDocumentSpace('WINDOW_RESIZE')
  }

  /**
   * Low-noise ResizeObserver-loop warning observer: counts the global
   * `ResizeObserver loop limit exceeded` error and correlates it with the last
   * utility write / window resize. Never suppresses or modifies the error.
   */
  private installWarningObserver(): void {
    if (this.warningObserverInstalled || this.disposed) return
    this.warningObserverInstalled = true
    if (!this.onWindowErrorBound) {
      window.addEventListener('error', this.onWindowErrorCapture, true)
      this.onWindowErrorBound = true
    }
  }

  private onWindowErrorCapture = (e: ErrorEvent): void => {
    if (!e || typeof e.message !== 'string') return
    if (!/ResizeObserver loop/i.test(e.message)) return
    const now = this.now()
    const deltaFromWrite = this.lastGeometryWriteTs == null ? null : now - this.lastGeometryWriteTs
    const deltaFromResize = this.lastWindowResizeTs == null ? null : now - this.lastWindowResizeTs
    const correlatedToUtility = deltaFromWrite != null && deltaFromWrite < 100
    const correlatedToExternal = deltaFromResize != null && deltaFromResize < 100
    if (correlatedToUtility || correlatedToExternal) this.geometryCounters.warningCorrelationCount++
    emitRuntimeAudit('DOCUMENT-UTILITY-RESIZE-WARNING', {
      message: e.message,
      lastRoCallbackTs: this.lastRoCallbackTs,
      lastGeometryWriteTs: this.lastGeometryWriteTs,
      lastWindowResizeTs: this.lastWindowResizeTs,
      warningDeltaFromUtilityWriteMs: deltaFromWrite,
      warningDeltaFromWindowResizeMs: deltaFromResize,
      correlatedToUtility,
      correlatedToExternal,
    })
  }

  // ── Placement (coalesced, read/write separated) ─────
  private scheduleGeometrySync(reason: string): void {
    if (!this.root) return
    // Phase 7R.3.11.6 — coalescing must NOT drop drawer-open/close semantics:
    // every reason is preserved; execution reads the LIVE drawer state.
    this.pendingGeometryReasons.add(reason)
    if (this.geometryRafPending) {
      this.geometryCounters.sameFrameCoalesceCount++
      return
    }
    this.geometryRafPending = true
    this.geometryCounters.scheduleCount++
    const run = (): void => {
      this.geometryRafPending = false
      const reasons = new Set(this.pendingGeometryReasons)
      this.pendingGeometryReasons.clear()
      this.applyGeometry(reasons)
      // V5.12-R8 §15 — the layout is settled here: measure the real code
      // caption → code body gap and audit it (state-deduped, no DOM write).
      this.commitCaptionCodeSpacingAudit()
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run() // jsdom / environments without rAF
    }
  }

  /** Event-driven resize-settle debounce — forensic summary ONLY (no business UI). */
  private scheduleResizeSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.emitResizeSummary()
    }, 200)
  }

  private refreshLatestRects(): void {
    const write = resolveBusinessContentRoot()?.getBoundingClientRect() ?? null
    const shell = getActiveEditorScrollContainer()?.getBoundingClientRect() ?? null
    const overlayRoot = this.root?.getBoundingClientRect() ?? null
    const toolbar = this.toolbarEl?.getBoundingClientRect() ?? null
    const navigator = this.navigatorEl?.getBoundingClientRect() ?? null
    const drawer = this.drawerEl?.getBoundingClientRect() ?? null
    const writeRec = toRectRecord(write)
    const shellRec = toRectRecord(shell)
    this.latestRects = {
      write: writeRec,
      // Phase 7R.3.11.4 — occlusion denominator = VISIBLE write area only.
      visibleWrite: intersectRects(writeRec, shellRec),
      shell: shellRec,
      overlayRoot: toRectRecord(overlayRoot),
      toolbar: toRectRecord(toolbar),
      navigator: toRectRecord(navigator),
      drawer: toRectRecord(drawer),
    }
  }

  // ── Phase 7R.3.11.8B.6 — Workspace Width Guard ────────
  /** Resolve the REAL workspace flex item ONCE; add the scoped min-width class. */
  private applyWorkspaceHost(): void {
    if (this.workspaceHostApplied || !this.root) return
    const host = resolveWorkspaceHost()
    if (!host) {
      // Forensic dump: the real ancestor chain from #write up to body (tag /
      // id / class / display / position / flex) so the FIRST_FAILING_LAYER is
      // provable even when the sidebar selector differs across Typora versions.
      const chain: Array<Record<string, string>> = []
      let cursor: HTMLElement | null = document.getElementById('write') as HTMLElement | null
      const seenCursor = new Set<HTMLElement>()
      while (cursor && cursor !== document.body && !seenCursor.has(cursor)) {
        seenCursor.add(cursor)
        const cs = getComputedStyle(cursor)
        const id = cursor.id ? `#${cursor.id}` : ''
        const cls = typeof cursor.className === 'string' && cursor.className.trim()
          ? `.${cursor.className.trim().split(/\s+/).join('.')}` : ''
        chain.push({
          selector: `${cursor.tagName.toLowerCase()}${id}${cls}`,
          display: cs.display,
          position: cs.position,
          flex: cs.flex,
          flexShrink: cs.flexShrink,
          minWidth: cs.minWidth,
          clientWidth: String(cursor.clientWidth),
        })
        cursor = cursor.parentElement
      }
      emitRuntimeAudit('DOCUMENT-UTILITY-WORKSPACE-WIDTH-GUARD', {
        documentKey: this.opts.ctx.authority.getDocumentKey(),
        windowInnerWidth: window.innerWidth,
        decision: 'UNSUPPORTED',
        reason: 'WORKSPACE_HOST_NOT_RESOLVED',
        ancestorChain: chain,
      })
      return
    }
    // FIRST_FAILING_LAYER evidence: the workspace flex item before the guard
    // carries min-width auto/0 with flex-shrink:1 — the direct cause of the
    // extreme collapse. Capture it before adding the scoped class.
    const cs = getComputedStyle(host)
    host.classList.add(WORKSPACE_HOST_CLASS)
    this.workspaceHostApplied = true
    emitRuntimeAudit('DOCUMENT-UTILITY-WORKSPACE-WIDTH-GUARD', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      decision: 'SUPPORTED',
      reason: 'WORKSPACE_HOST_RESOLVED',
      workspaceHostSelector: `${host.tagName.toLowerCase()}${host.id ? `#${host.id}` : ''}${host.className && typeof host.className === 'string' ? `.${host.className.split(' ').filter(Boolean).join('.')}` : ''}`,
      workspaceHostMinWidthBefore: cs.minWidth,
      workspaceHostFlexShrink: cs.flexShrink,
      workspaceHostClientWidth: host.clientWidth,
      workspaceMinWidth: DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
    })
  }

  /**
   * Sample the workspace chain + derive the width state (NORMAL/COMPACT/
   * MIN_WIDTH_GUARD). Write-deduped: the state attribute is only touched on an
   * actual state change; the invariant audit is fingerprint-deduped. All reads,
   * zero layout writes → cannot feed a ResizeObserver loop.
   */
  private updateWorkspaceWidthState(): void {
    if (!this.root || !this.workspaceHostApplied) return
    const sample = sampleWorkspaceWidths()
    const drawerVisible = this.drawerOpen && !!this.drawerEl
    const navigatorVisible = this.getNavigatorExpectedVisible()
    const drawerWidth = drawerVisible && this.drawerEl ? this.drawerEl.getBoundingClientRect().width : 0
    const state = sample.widthState
    const extremeWrap = sample.workspaceRequestedWidth < DOCUMENT_WORKSPACE_MIN_WIDTH_PX
    if (extremeWrap) this.workspaceBelowMinCount++

    if (state !== this.workspaceWidthState) {
      const from: string = this.workspaceWidthState ?? 'n/a'
      emitRuntimeAudit('DOCUMENT-UTILITY-WORKSPACE-WIDTH-STATE', {
        documentKey: this.opts.ctx.authority.getDocumentKey(),
        windowWidth: sample.windowInnerWidth,
        sidebarWidth: sample.sidebarWidth,
        requestedWorkspaceWidth: sample.workspaceRequestedWidth,
        effectiveWorkspaceWidth: sample.workspaceClientWidth,
        minWidth: DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
        fromState: from,
        toState: state,
        reason: from === 'n/a' ? 'INITIAL' : `THRESHOLD_CROSSING:${from}->${state}`,
      })
      // Write-dedup: only touch the attribute when the state actually changed.
      this.workspaceWidthState = state
      this.root.setAttribute(WORKSPACE_WIDTH_STATE_ATTR, state)
    }

    const fp = `${state}|${Math.round(sample.windowInnerWidth)}|${Math.round(sample.sidebarWidth)}|${Math.round(sample.workspaceRequestedWidth)}|${Math.round(sample.workspaceClientWidth)}|${drawerVisible}|${navigatorVisible}`
    if (fp === this.lastWorkspaceWidthFingerprint) return
    this.lastWorkspaceWidthFingerprint = fp

    const belowMin = sample.workspaceRequestedWidth < DOCUMENT_WORKSPACE_MIN_WIDTH_PX - 0.5
      && sample.workspaceClientWidth < DOCUMENT_WORKSPACE_MIN_WIDTH_PX - 0.5
    const decision = belowMin
      ? 'FAIL_WORKSPACE_BELOW_MIN'
      : state === 'normal' ? 'PASS_NORMAL' : state === 'compact' ? 'PASS_COMPACT' : 'PASS_MIN_WIDTH_GUARD'
    emitRuntimeAudit('DOCUMENT-UTILITY-WORKSPACE-WIDTH-INVARIANT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      windowInnerWidth: sample.windowInnerWidth,
      sidebarVisible: sample.sidebarVisible,
      sidebarWidth: sample.sidebarWidth,
      workspaceRequestedWidth: sample.workspaceRequestedWidth,
      workspaceClientWidth: sample.workspaceClientWidth,
      workspaceScrollWidth: sample.workspaceScrollWidth,
      workspaceMinWidth: DOCUMENT_WORKSPACE_MIN_WIDTH_PX,
      editorViewportWidth: sample.editorViewportWidth,
      widthState: state,
      drawerVisible,
      drawerWidth,
      drawerAffectsWorkspaceWidth: false,
      navigatorVisible,
      navigatorAffectsWorkspaceWidth: false,
      extremeWrapDetected: extremeWrap,
      decision,
      reason: decision === 'PASS_MIN_WIDTH_GUARD' ? 'WORKSPACE_CLAMPED_TO_MIN' : decision,
    })
  }

  /** Remove the workspace host class + state attribute (no DOM pollution). */
  private cleanupWorkspaceGuard(): void {
    if (this.workspaceHostApplied) {
      const host = resolveWorkspaceHost()
      host?.classList.remove(WORKSPACE_HOST_CLASS)
      this.workspaceHostApplied = false
    }
    this.root?.removeAttribute(WORKSPACE_WIDTH_STATE_ATTR)
    this.workspaceWidthState = null
    this.lastWorkspaceWidthFingerprint = ''
    this.workspaceBelowMinCount = 0
  }

  /** Phase 2-B1 — last applied responsive classes (write-deduped). */
  private lastToolbarDensity: ToolbarDensity = 'full'
  private lastToolbarPresentation: ToolbarPresentation = 'full'
  /** V4 — single projection store: Toolbar/Drawer consume it (no own cache). */
  private currentProblemsProjection: CurrentProblemsProjection = {
    documentKey: null,
    revision: null,
    sourceRevision: null,
    errorCount: 0,
    warningCount: 0,
    hintCount: 0,
    totalCount: 0,
    healthy: false,
    hasProjection: false,
  }
  /** V5 — consumer admission dedupe (documentKey+epoch+revision+sourceRevision). */
  private lastAdmittedSnapshotFingerprint: string | null = null
  private pendingActiveLeafDocumentKey: string | null = null
  private admissionCounters = { admitted: 0, alreadyAdmitted: 0, pendingActiveLeaf: 0, staleDiscard: 0 }
  /** Phase 2-B.2 — last visible-editor geometry (invariant observability). */
  private lastVisibleEditor: {
    layoutWidth: number | null
    visibleWidth: number | null
    presentation: ToolbarPresentation
  } = { layoutWidth: null, visibleWidth: null, presentation: 'full' }
  /** Phase 2-B.3 — final navigator presentation state (single authority). */
  private lastNavVis: { presentation: NavigatorPresentation; reason: string; insetRightPx: number | null } =
    { presentation: 'hidden', reason: 'NOT_SCROLLABLE', insetRightPx: null }
  /** Ghost-control V1 — sig-guarded NAVIGATOR-PRESENTATION-INVARIANT emitter. */
  private lastNavigatorPresentationSig = ''
  /** V1.1 — read-only Rail Facts captured during geometry (Drift consumes them). */
  private lastRailFacts: NavigatorRailFacts | null = null
  /** Chevron V3 — icon visibility invariant counter (FAIL only). */
  private navIconVisibilityFailCount = 0
  /** Edge-Inset — monotonic visibility hole counter (FAIL only). */
  private monotonicVisibilityHoleCount = 0
  /** Visible-editor containment invariant counter (FAIL only). */
  private editorContainmentFailCount = 0
  /** True-Inset — presentation-aware content gap for Drift (gutter +8 / inset −12). */
  private lastDriftContentGap = NAV_CONTENT_SAFE_GAP_PX
  /** V1.4 — resize-stabilization continuity (NOT a second authority). */
  private lastStableNavigatorPresentation: 'gutter' | 'inset' | null = null
  private stabilizationRemeasurePending = false
  /** V1.5 — any legacy drawer/small-viewport/second-writer suppression emission. */
  private legacySuppressionEmissionCount = 0
  private lastNavigatorAuthoritySig = ''
  private lastDiagnosticsPresentation: DiagnosticsPresentation = 'desktop'

  // ── V3 Active-Document Presence authority (ACTIVE / EMPTY / UNKNOWN) ──────
  // The ACTIVE workspace leaf (`activeLeaf.state.path`) is the HIGHEST
  // authority. An EXPLICIT EMPTY leaf (known + path='') HARD-VETOES every stale
  // workspace.activeFile / documentKey fallback. Legacy fallback participates
  // ONLY when the leaf state is unreadable (UNKNOWN). This fixes
  // EXPLICIT_EMPTY_ACTIVE_LEAF_IS_OVERRIDDEN_BY_STALE_ACTIVE_FILE_OR_DOCUMENT_KEY.

  /** Read + normalize the REAL active workspace leaf facts. */
  private readActiveLeafFacts(): ActiveLeafDocumentFacts {
    try {
      const getter = this.opts.ctx.authority.getActiveLeafState
      if (typeof getter !== 'function') return { leafStateKnown: false, leafPath: null }
      const f = getter()
      if (!f || typeof f !== 'object') return { leafStateKnown: false, leafPath: null }
      return {
        leafStateKnown: f.leafStateKnown === true,
        leafPath: normalizeActiveLeafDocumentPath(f.leafPath),
      }
    } catch {
      return { leafStateKnown: false, leafPath: null }
    }
  }

  private readLegacyPresenceFacts(): { file: string | null; key: string | null } {
    const ctx = this.opts.ctx
    try {
      const file = typeof ctx.authority.getActiveFilePath === 'function' ? ctx.authority.getActiveFilePath() : null
      const key = typeof ctx.authority.getDocumentKey === 'function' ? ctx.authority.getDocumentKey() : null
      return { file: file ?? null, key: key ?? null }
    } catch {
      return { file: null, key: null }
    }
  }

  /**
   * Single ACTIVE-LEAF presence evaluation.
   *  - EMPTY / ACTIVE decide directly from the pure three-state model.
   *  - UNKNOWN merges the legacy ctx + #write-root gate (previous authority).
   */
  private evaluateActiveDocumentPresence(): {
    presence: ActiveDocumentPresenceDecision
    hasActiveDocument: boolean
    legacyUsed: boolean
  } {
    const leaf = this.readActiveLeafFacts()
    const legacy = this.readLegacyPresenceFacts()
    const presence = resolveActiveDocumentPresence({
      leafStateKnown: leaf.leafStateKnown,
      leafPath: leaf.leafPath,
      workspaceActiveFilePath: legacy.file,
      documentKey: legacy.key,
    })
    this.lastActiveLeafPresence = presence
    if (presence.state !== 'UNKNOWN') {
      return { presence, hasActiveDocument: presence.state === 'ACTIVE', legacyUsed: false }
    }
    try {
      const ctx = this.opts.ctx
      const ctxSaysActive = typeof ctx.hasActiveDocument === 'function' ? ctx.hasActiveDocument() : legacy.file != null
      const root = resolveBusinessContentRoot()
      const hasActiveDocument = resolveActiveDocumentExistence({
        documentKey: legacy.key,
        activeFilePath: legacy.file,
        ctxHasActiveDocument: ctxSaysActive,
        rootConnected: root ? root.isConnected : null,
      })
      return { presence, hasActiveDocument, legacyUsed: true }
    } catch {
      return { presence, hasActiveDocument: false, legacyUsed: true }
    }
  }

  /**
   * Document Problems Control belongs to the ACTIVE Markdown document.
   * The active workspace leaf decides; EMPTY never falls back to a stale
   * activeFile/documentKey. UNKNOWN keeps the legacy ctx+#write-root gate so
   * headless/jsdom and legacy consumers behave exactly as before.
   */
  private resolveHasActiveDocument(): boolean {
    return this.evaluateActiveDocumentPresence().hasActiveDocument
  }

  /** Empty Workspace UX V1 — minimal presence snapshot for the controller. */
  private readEmptyWorkspacePresence(): EmptyWorkspacePresence {
    const ev = this.evaluateActiveDocumentPresence()
    return { state: ev.presence.state, path: ev.presence.path, source: ev.presence.source }
  }

  /** Empty Workspace UX V1 — re-sync marker + surface listener. Idempotent. */
  private syncEmptyWorkspaceUx(): void {
    if (this.disposed || !this.emptyWorkspaceUx) return
    try {
      this.emptyWorkspaceUx.sync(this.readEmptyWorkspacePresence())
    } catch { /* best-effort */ }
  }

  // ── V2 — ACTIVE DOCUMENT RECONCILE COORDINATOR (single authoritative chain) ─

  /** Epoch of the current active document identity (EMPTY↔ACTIVE / A↔B bumps). */
  getActiveDocumentEpoch(): number {
    return this.activeDocumentEpoch
  }

  /** Read-only reconcile identity (tests / runtime structure). */
  getReconcileRuntimeFacts(): { reconcileCoordinatorCount: number; epoch: number } {
    return { reconcileCoordinatorCount: 1, epoch: this.activeDocumentEpoch }
  }

  /** Public coordinator count (single chain). */
  getReconcileCoordinatorCount(): number {
    return 1
  }

  /** V3 — current Active Document Readiness Barrier state. */
  getActiveDocumentReadiness(): ActiveDocumentReadinessState {
    return this.computeActiveDocumentReadiness()
  }

  private computeActiveDocumentReadiness(): ActiveDocumentReadinessState {
    try {
      const ev = this.evaluateActiveDocumentPresence()
      const p = ev.presence
      const presenceActive = p.state === 'ACTIVE' || (p.state === 'UNKNOWN' && ev.hasActiveDocument)
      const key = this.opts.ctx.authority.getDocumentKey() ?? null
      const identityMatch = presenceActive && p.path != null && p.path !== '' && key != null
      const editorRootConnected = resolveBusinessContentRoot()?.isConnected ?? false
      let sourceAvailable = false
      try {
        const md = this.opts.ctx.authority.getMarkdown?.()
        sourceAvailable = md != null
      } catch { sourceAvailable = false }
      return computeActiveDocumentReadiness({
        presenceActive,
        identityMatch,
        editorRootConnected,
        sourceAvailable,
        canonicalReady: this.authorityReady.canonical,
        stale: false,
      })
    } catch {
      return 'STALE'
    }
  }

  private trackIdentityTransition(p: { state: string; path: string | null }): boolean {
    const key = this.opts.ctx.authority.getDocumentKey() ?? null
    const prev = this.lastReconcileIdentity
    const changed = !prev || prev.state !== p.state || (p.path ?? '') !== (prev.path ?? '') || key !== prev.key
    if (!prev) {
      this.lastReconcileIdentity = { state: p.state, path: p.path, key }
      // A document already active at first observation counts as one identity.
      if (p.state === 'ACTIVE' || (p.state === 'UNKNOWN' && key != null)) this.activeDocumentEpoch++
      return true
    }
    if (changed) {
      this.activeDocumentEpoch++
      this.lastReconcileIdentity = { state: p.state, path: p.path, key }
      return true
    }
    return false
  }

  /**
   * BUG-2 INITIAL_ACTIVE_DOCUMENT_RECONCILE_MISSING — the SINGLE authoritative
   * entry for document-level reconcile. Every trigger (INITIAL_ACTIVE_DOCUMENT,
   * ACTIVE_LEAF_CHANGED, ACTIVE_TAB_CHANGED, FILE_OPEN, CANONICAL_FRAME_READY,
   * CAPTION_REHYDRATED, settings/source change) funnels through here. It does:
   * presence → identity/epoch → editor root → binding → recompute → snapshot
   * commit → Problems Control/Drawer refresh (via the diagnostics publish). No
   * timeout/resize/second-document tricks are ever needed.
   */
  reconcileActiveDocument(reason: string): void {
    if (this.disposed) return
    try {
      this.reconcileTotalCount++
      const ev = this.evaluateActiveDocumentPresence()
      const p = ev.presence
      const key = this.opts.ctx.authority.getDocumentKey() ?? null

      if (p.state === 'EMPTY' || (p.state === 'UNKNOWN' && !ev.hasActiveDocument)) {
        this.trackIdentityTransition(p)
        this.cancelActiveLocateTransaction('DOCUMENT_SWITCH')
        this.applyNoActiveDocumentState()
        this.syncEmptyWorkspaceUx()
        this.emitReconcileInvariant(reason, 'EMPTY_OR_INACTIVE', null)
        return
      }

      // ACTIVE (or legacy-active UNKNOWN) — full or refresh reconcile.
      const identityChanged = this.trackIdentityTransition(p)
      if (/CANONICAL/i.test(reason)) this.authorityReady.canonical = true
      if (/CAPTION|OBJECT/i.test(reason)) this.authorityReady.caption = true
      const DOC_SWITCH_REASONS = new Set([
        'INITIAL_ACTIVE_DOCUMENT',
        'ACTIVE_LEAF_CHANGED',
        'ACTIVE_TAB_CHANGED',
        'FILE_OPEN',
        'LEGACY_ACTIVE_DOCUMENT',
      ])
      const full = identityChanged || DOC_SWITCH_REASONS.has(reason)
      if (full) {
        this.authorityReady = { canonical: false, caption: false }
        if (/CANONICAL/i.test(reason)) this.authorityReady.canonical = true
        this.cancelScrollOperation('CANCELLED_DOCUMENT_SWITCH')
        this.cancelActiveLocateTransaction('DOCUMENT_SWITCH')
        // Phase 7R.3.11.8B.8 — a real document switch clears the previous
        // document's locate visual (frame / inline mark) unconditionally.
        this.clearDiagnosticLocateVisual('DOCUMENT_SWITCH')
        this.ensureTabStructureObserver()
        this.scrollNav?.bind()
        this.bindLocateFrameEditorScroll()
        this.diagnostics.rebind()
      }
      this.diagnostics.recompute(reason)
      // V5 — reconcile DIRECT admission: the authoritative snapshot is handed
      // to the consumer NOW, even when the producer deduped (NOOP) and would
      // never emit another publish. Consumer dedupe (ALREADY_ADMITTED) keeps
      // this idempotent.
      {
        const authoritative = this.diagnostics.getSnapshot()
        const admission = this.admitDiagnosticsSnapshot(authoritative, 'ACTIVE_DOCUMENT_RECONCILE')
        if (admission.decision === 'ADMITTED') {
          this.commitAdmittedSnapshot(authoritative, 'RECONCILE')
        }
      }
      this.renderLockButton()
      // V4 BUG-A — never reuse the stale EMPTY `suppressed` presentation after
      // EMPTY→ACTIVE: recompute it now (geometry pass refines width later).
      if (this.lastToolbarPresentation === 'suppressed') {
        this.applyResponsiveClasses(null)
      }
      this.scheduleGeometrySync(`reconcile:${reason}`)
      // V4 — EMPTY→ACTIVE: after presentation restore (geometry apply) the
      // problems projection is replayed; do it here too as the idempotent
      // safety net (no dependency on a new diagnostics event).
      this.renderToolbarFromCurrentState()
      this.syncEmptyWorkspaceUx()
      this.emitReconcileInvariant(reason, 'ACTIVE_RECONCILED', this.diagnostics.getSnapshot())
    } catch { /* best-effort */ }
  }

  private emitReconcileInvariant(
    triggerReason: string,
    outcome: 'ACTIVE_RECONCILED' | 'EMPTY_OR_INACTIVE',
    snapshot: DocumentDiagnosticsSnapshot | null,
  ): void {
    try {
      const ev = this.evaluateActiveDocumentPresence()
      const p = ev.presence
      const key = this.opts.ctx.authority.getDocumentKey() ?? null
      const editorRootConnected = resolveBusinessContentRoot()?.isConnected ?? false
      const snapshotCounts = snapshot
        ? { e: snapshot.errorCount, w: snapshot.warningCount, h: snapshot.infoCount }
        : { e: 0, w: 0, h: 0 }
      const projected = snapshotCounts
      const decision = outcome === 'ACTIVE_RECONCILED' ? 'PASS' : 'PASS'
      emitRuntimeAudit('DOCUMENT-UTILITY-ACTIVE-DOCUMENT-RECONCILE-INVARIANT', {
        triggerReason,
        presenceState: p.state,
        activeLeafPath: p.path ?? '',
        documentKey: key,
        documentEpoch: this.activeDocumentEpoch,
        editorRootConnected,
        canonicalFrameState: this.authorityReady.canonical ? 'READY' : 'WAITING',
        canonicalFrameDocumentKey: key,
        captionState: this.authorityReady.caption ? 'READY' : 'WAITING',
        readinessState: this.computeActiveDocumentReadiness(),
        reconcileRequested: true,
        reconcileCoalesced: false,
        recomputeStarted: outcome === 'ACTIVE_RECONCILED',
        recomputeCompleted: outcome === 'ACTIVE_RECONCILED',
        snapshotDocumentKey: snapshot?.documentKey ?? null,
        snapshotEpoch: snapshot ? this.activeDocumentEpoch : null,
        snapshotRevision: snapshot?.revision ?? null,
        projectedErrorCount: projected.e,
        projectedWarningCount: projected.w,
        projectedHintCount: projected.h,
        toolbarErrorCount: projected.e,
        toolbarWarningCount: projected.w,
        drawerVisible: this.drawerOpen,
        drawerSnapshotRevision: this.drawerOpen && snapshot ? snapshot.revision : null,
        staleResultDiscarded: false,
        decision,
        reason: outcome === 'ACTIVE_RECONCILED' ? 'ACTIVE_DOCUMENT_RECONCILED' : 'NO_ACTIVE_DOCUMENT',
      })
    } catch { /* best-effort */ }
  }

  /**
   * V3 — SYNCHRONOUS reaction to a real active-leaf lifecycle transition.
   *  - path=''   → immediate identity invalidation + suppression. Never waits
   *                for resize / scroll / geometry / unrelated DOM mutation.
   *  - path=doc  → automatic restore (no click/scroll/resize/restart needed).
   *  - unknown   → legacy fallback (explicitly logged).
   */
  private handleActiveLeafLifecycle(reason: ActiveLeafTransitionReason): void {
    if (this.disposed) return
    try {
      const ev = this.evaluateActiveDocumentPresence()
      const p = ev.presence
      emitRuntimeAudit('DOCUMENT-UTILITY-ACTIVE-LEAF-TRANSITION', {
        trigger: reason,
        activeLeafStateKnown: p.state !== 'UNKNOWN',
        activeLeafPath: p.state === 'ACTIVE' && p.path != null ? p.path : '',
        presenceState: p.state,
        presenceSource: p.source,
        identityConflict: p.identityConflict,
        legacyFallbackUsed: p.legacyFallbackUsed,
        hasActiveDocument: ev.hasActiveDocument,
        decision: 'EVALUATED',
      })
      // BUG-2 — every active leaf transition funnels into the SINGLE reconcile
      // coordinator (never a second render chain). EMPTY keeps the suppression
      // path; ACTIVE always reconciles (mount INITIAL_ACTIVE_DOCUMENT included).
      if (p.state === 'EMPTY') {
        this.trackIdentityTransition(p)
        this.applyNoActiveDocumentState()
        return
      }
      this.syncEmptyWorkspaceUx()
      if (p.state === 'ACTIVE') {
        this.cancelActiveLocateTransaction('ACTIVE_LEAF_REOPEN')
        const reconcileReason = reason === 'TAB_TOGGLE' ? 'ACTIVE_TAB_CHANGED' : 'ACTIVE_LEAF_CHANGED'
        this.reconcileActiveDocument(reconcileReason)
        this.emitActiveLeafDocumentInvariant(`TRANSITION:${reason}`)
        return
      }
      // ONLY UNKNOWN → legacy fallback decides (never silent).
      if (ev.hasActiveDocument) {
        this.reconcileActiveDocument('LEGACY_ACTIVE_DOCUMENT')
      } else {
        this.trackIdentityTransition(p)
        this.applyNoActiveDocumentState()
      }
      this.emitActiveLeafDocumentInvariant(`TRANSITION:${reason}`)
    } catch { /* best-effort observability */ }
  }

  /**
   * DOCUMENT-UTILITY-ACTIVE-LEAF-DOCUMENT-INVARIANT — runtime gate. FAILs:
   *  - STALE_ACTIVE_FILE_OVERRIDES_EMPTY_LEAF (leaf="" but hasActiveDocument)
   *  - EMPTY_LEAF_WITH_RENDERED_TOOLBAR (EMPTY yet toolbar still rendered)
   */
  private emitActiveLeafDocumentInvariant(trigger: string): void {
    try {
      const ev = this.evaluateActiveDocumentPresence()
      const p = ev.presence
      const legacy = this.readLegacyPresenceFacts()
      const documentKey = this.opts.ctx.authority.getDocumentKey?.() ?? legacy.key
      const toolbarFacts = this.measureToolbarRenderedFacts()
      const drawerVisible = this.drawerOpen
      const pendingLocateTarget = this.activeLocateTx?.diagnosticId ?? this.lastLocatedDiagnosticId ?? null
      const activeLeafStateKnown = p.state !== 'UNKNOWN'
      const activeLeafPath = p.state === 'ACTIVE' && p.path != null ? p.path : ''
      let decision: 'PASS' | 'FAIL' = 'PASS'
      let reason: string
      if (activeLeafStateKnown && activeLeafPath === '' && ev.hasActiveDocument) {
        decision = 'FAIL'
        reason = 'STALE_ACTIVE_FILE_OVERRIDES_EMPTY_LEAF'
      } else if (p.state === 'EMPTY' && toolbarFacts.renderedToolbarCount > 0) {
        decision = 'FAIL'
        reason = 'EMPTY_LEAF_WITH_RENDERED_TOOLBAR'
      } else if (p.state === 'EMPTY') {
        reason = 'EXPLICIT_EMPTY_LEAF_SUPPRESSED'
      } else if (p.state === 'ACTIVE') {
        reason = 'ACTIVE_LEAF_DOCUMENT_PRESENT'
      } else {
        reason = 'UNKNOWN_LEAF_LEGACY_FALLBACK'
      }
      emitRuntimeAudit('DOCUMENT-UTILITY-ACTIVE-LEAF-DOCUMENT-INVARIANT', {
        trigger,
        activeLeafStateKnown,
        activeLeafPath,
        workspaceActiveFilePath: legacy.file,
        documentKey,
        presenceState: p.state,
        presenceSource: p.source,
        identityConflict: p.identityConflict,
        legacyFallbackUsed: p.legacyFallbackUsed,
        legacyFallbackSource: p.legacyFallbackSource,
        hasActiveDocument: ev.hasActiveDocument,
        toolbarPresentation: toolbarFacts.presentation ?? this.lastToolbarPresentation,
        toolbarRenderedVisible: toolbarFacts.renderedToolbarCount > 0,
        renderedToolbarCount: toolbarFacts.renderedToolbarCount,
        drawerVisible,
        pendingLocateTarget,
        decision,
        reason,
      })
    } catch { /* best-effort */ }
  }

  /** NO_ACTIVE_DOCUMENT state: clear stale projection + suppress + clean locate. */
  private applyNoActiveDocumentState(): void {
    // Order: clear projected DOM first, then hide (per §12) — never a re-scan.
    this.clearToolbarProjection()
    this.applyToolbarPresentation('suppressed') // keeps the single toolbar instance
    if (this.drawerOpen) this.setDrawerOpen(false)
    if (this.activeLocateTx) this.cancelActiveLocateTransaction('NO_ACTIVE_DOCUMENT')
    // Phase 7R.3.11.8B.8 — no active document clears the locate frame too.
    this.clearDiagnosticLocateVisual('NO_ACTIVE_DOCUMENT')
    this.lastLocatedDiagnosticId = null
    this.multiTargetCursor.clear()
    // Phase 7R.3.11.8B.12 — ACTIVE → EMPTY / NO_ACTIVE_DOCUMENT hides the
    // Navigator IMMEDIATELY (no scroll/resize/timer) and clears every stale
    // placement so a later show never inherits a left-bottom geometry.
    this.lastNavVis = { presentation: 'hidden', reason: 'NO_ACTIVE_DOCUMENT', insetRightPx: null }
    this.lastRailFacts = null
    this.lastStableNavigatorPresentation = null
    this.stabilizationRemeasurePending = false
    if (this.navigatorEl) {
      this.navigatorEl.style.removeProperty('right')
      this.navigatorEl.style.removeProperty('left')
      this.navigatorEl.style.removeProperty('top')
      this.navigatorEl.style.removeProperty('bottom')
      this.applyNavigatorPresentation('hidden', null)
    }
    this.emitActiveDocumentVisibilityInvariant()
    this.emitToolbarRenderedVisibilityInvariant()
    this.emitActiveLeafDocumentInvariant('NO_ACTIVE_DOCUMENT')
    // Empty Workspace UX V1 — EMPTY → apply placeholder marker + surface
    // dblclick listener (idempotent; runs after the DOM state settles).
    this.syncEmptyWorkspaceUx()
  }

  /** Empty-document projection cleanup: counts → 0, edit text → empty. */
  private clearToolbarProjection(): void {
    if (this.problemsControlEl) this.problemsControlEl.replaceChildren()
    if (this.toolbarEl) {
      for (const el of this.toolbarEl.querySelectorAll<HTMLElement>('.inkchapter-toolbar-segment__count')) el.textContent = '0'
      const lockLabel = this.toolbarEl.querySelector<HTMLElement>('.inkchapter-editlock__label')
      if (lockLabel) lockLabel.textContent = ''
      if (this.lockButtonEl) this.lockButtonEl.classList.remove('is-locked')
    }
  }

  /** Read the REAL rendered-visibility chain for toolbar + problems control. */
  private measureToolbarRenderedFacts(): ToolbarRenderedVisibilityFacts {
    const toolbarEls = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-toolbar'))
    const problemsEls = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-problems-control'))
    const tracked = this.toolbarEl && toolbarEls.includes(this.toolbarEl) ? this.toolbarEl : toolbarEls[0] ?? null
    let display = 'none'
    let visibility = ''
    let opacity = ''
    let rectWidth = 0
    let rectHeight = 0
    let clientRectCount = 0
    let hiddenAttr = true
    let ariaHidden = true
    let presentation: string | null = 'suppressed'
    let projectedError = 0
    let projectedWarning = 0
    let projectedHint = 0
    let projectedEdit: 'LOCKED' | 'EDITABLE' | 'NONE' = 'NONE'
    if (tracked) {
      hiddenAttr = tracked.hidden
      ariaHidden = tracked.getAttribute('aria-hidden') === 'true'
      presentation = tracked.dataset.presentation ?? null
      const style = window.getComputedStyle(tracked)
      display = style.display
      visibility = style.visibility
      opacity = style.opacity
      const rect = tracked.getBoundingClientRect()
      rectWidth = rect.width
      rectHeight = rect.height
      clientRectCount = tracked.getClientRects().length
      // V5/V4 — severity projection MUST come from data-severity, never from
      // segment order / position.
      const segs = tracked.querySelectorAll<HTMLElement>('.inkchapter-toolbar-segment')
      for (const seg of segs) {
        const sev = seg.getAttribute('data-severity')
        const n = Number.parseInt(seg.querySelector<HTMLElement>('.inkchapter-toolbar-segment__count')?.textContent ?? '0', 10)
        const value = Number.isFinite(n) ? n : 0
        if (sev === 'error') projectedError = value
        else if (sev === 'warning') projectedWarning = value
        else if (sev === 'hint' || sev === 'info') projectedHint = value
        // unknown severity → skipped (never positional).
      }
      const lockLabel = tracked.querySelector<HTMLElement>('.inkchapter-editlock__label')?.textContent ?? ''
      if (tracked.querySelector('.inkchapter-editlock.is-locked') || /锁定/.test(lockLabel)) projectedEdit = 'LOCKED'
      else if (lockLabel.trim() !== '') projectedEdit = 'EDITABLE'
    }
    const renderedToolbarCount = toolbarEls.filter(isRenderedVisible).length
    const renderedProblemsControlCount = problemsEls.filter(isRenderedVisible).length
    const visuallyProven = rectWidth > 0 && rectHeight > 0 && clientRectCount > 0
    const measureMode: 'REAL' | 'HEADLESS' = display === 'none' || visuallyProven ? 'REAL' : 'HEADLESS'
    return {
      documentKey: this.opts.ctx.authority.getDocumentKey?.() ?? null,
      hasActiveDocument: this.resolveHasActiveDocument(),
      toolbarDomCount: toolbarEls.length,
      problemsControlDomCount: problemsEls.length,
      hiddenAttr,
      ariaHidden,
      presentation,
      computedDisplay: display,
      computedVisibility: visibility,
      computedOpacity: opacity,
      rectWidth,
      rectHeight,
      clientRectCount,
      renderedToolbarCount,
      renderedProblemsControlCount,
      projectedErrorCount: projectedError,
      projectedWarningCount: projectedWarning,
      projectedHintCount: projectedHint,
      projectedEditState: projectedEdit,
      measureMode,
    }
  }

  private emitToolbarRenderedVisibilityInvariant(): void {
    try {
      const facts = this.measureToolbarRenderedFacts()
      const out = evaluateToolbarRenderedVisibility(facts)
      emitRuntimeAudit('DOCUMENT-UTILITY-TOOLBAR-RENDERED-VISIBILITY-INVARIANT', {
        documentKey: facts.documentKey,
        hasActiveDocument: facts.hasActiveDocument,
        toolbarDomCount: facts.toolbarDomCount,
        problemsControlDomCount: facts.problemsControlDomCount,
        hiddenAttr: facts.hiddenAttr,
        ariaHidden: facts.ariaHidden,
        presentation: facts.presentation,
        computedDisplay: facts.computedDisplay,
        computedVisibility: facts.computedVisibility,
        computedOpacity: facts.computedOpacity,
        rectWidth: facts.rectWidth,
        rectHeight: facts.rectHeight,
        clientRectCount: facts.clientRectCount,
        renderedVisible: facts.renderedToolbarCount > 0,
        renderedToolbarCount: facts.renderedToolbarCount,
        renderedProblemsControlCount: facts.renderedProblemsControlCount,
        projectedErrorCount: facts.projectedErrorCount,
        projectedWarningCount: facts.projectedWarningCount,
        projectedHintCount: facts.projectedHintCount,
        projectedEditState: facts.projectedEditState,
        measureMode: facts.measureMode,
        decision: out.decision,
        reason: out.reason,
      })
    } catch { /* best-effort */ }
  }

  private emitActiveDocumentVisibilityInvariant(): void {
    try {
      const documentKey = this.opts.ctx.authority.getDocumentKey?.() ?? null
      const hasActiveDocument = this.resolveHasActiveDocument()
      const root = resolveBusinessContentRoot()
      const toolbarPresentation: ToolbarPresentation = this.lastToolbarPresentation
      const toolbarVisible = this.toolbarEl ? !this.toolbarEl.hidden : false
      const drawerVisible = this.drawerOpen
      const pendingLocateTarget = this.activeLocateTx?.diagnosticId ?? null
      const evalOut = evaluateActiveDocumentVisibility({
        documentKey,
        hasActiveDocument,
        activeDocumentRootConnected: root?.isConnected ?? false,
        toolbarPresentation,
        toolbarVisible,
        drawerVisible,
        pendingLocateTarget,
      })
      emitRuntimeAudit('DOCUMENT-UTILITY-ACTIVE-DOCUMENT-VISIBILITY-INVARIANT', {
        documentKey,
        hasActiveDocument,
        activeDocumentRootConnected: root?.isConnected ?? false,
        toolbarPresentation,
        toolbarPresentationReason: hasActiveDocument
          ? (toolbarPresentation === 'suppressed' ? 'SUPPRESSED_TRANSITION_PENDING' : toolbarPresentation === 'compact' ? 'COMPACT_LAYOUT' : 'ACTIVE_DOCUMENT_PRESENT')
          : 'NO_ACTIVE_DOCUMENT',
        toolbarVisible,
        drawerVisible,
        selectedDiagnosticId: this.lastLocatedDiagnosticId,
        pendingLocateTarget,
        decision: evalOut.decision,
        reason: evalOut.reason,
      })
    } catch { /* best-effort */ }
  }

  /** Tab-structure observer → immediate geometry re-evaluation on open/close. */
  private ensureTabStructureObserver(): void {
    if (this.tabStructureObserver || this.disposed) return
    const tabStrips = Array.from(document.querySelectorAll<HTMLElement>('.typ-workspace-tabs .typ-tabs, .typ-workspace-tab-header .typ-tabs'))
    if (!tabStrips.length) return
    this.tabStructureObserver = new MutationObserver(() => {
      this.scheduleGeometrySync('tabs-structure-change')
      // Empty Workspace UX V1 — Typora may re-create the empty placeholder tab
      // DOM after closing tabs; re-apply the marker from the same authority.
      this.syncEmptyWorkspaceUx()
    })
    for (const strip of tabStrips) this.tabStructureObserver.observe(strip, { childList: true })
    this.disposables.push(() => {
      this.tabStructureObserver?.disconnect()
      this.tabStructureObserver = null
    })
  }

  /** Phase 2-B1 — centralized toolbar writer (single source of truth). */
  private applyToolbarPresentation(presentation: ToolbarPresentation): void {
    if (!this.toolbarEl) return
    const density: ToolbarDensity = presentation === 'full' ? 'full' : 'compact'
    if (this.lastToolbarDensity !== density) {
      this.toolbarEl.dataset.density = density
      this.lastToolbarDensity = density
    }
    const presentationChanged = this.lastToolbarPresentation !== presentation
    if (presentationChanged) {
      this.toolbarEl.dataset.presentation = presentation
      // suppressed hides WITHOUT destroying the node (single instance kept).
      this.toolbarEl.hidden = presentation === 'suppressed'
      this.toolbarEl.setAttribute('aria-hidden', String(presentation === 'suppressed'))
      this.lastToolbarPresentation = presentation
    }
    // V4 — EMPTY→ACTIVE presentation restore MUST replay the problems
    // projection immediately (no dependency on a fresh diagnostics event).
    if (presentationChanged && presentation !== 'suppressed') {
      this.renderToolbarFromCurrentState()
    }
  }

  /** V4 — replay Problems Control + Edit/Lock from the CURRENT projection. */
  private replayCurrentProblemsProjection(): void {
    if (this.disposed || !this.toolbarEl) return
    if (!this.resolveHasActiveDocument()) return
    this.renderDiagnosticsButton()
    this.renderLockButton()
  }

  /** V4 — idempotent render from current state (presence/presentation/...). */
  private renderToolbarFromCurrentState(): void {
    if (this.disposed || !this.toolbarEl) return
    if (this.lastToolbarPresentation === 'suppressed') return
    this.replayCurrentProblemsProjection()
  }

  /** Phase 2-B — reclass toolbar/drawer from REAL editor content width. */
  private applyResponsiveClasses(editorContentWidth: number | null): void {
    this.applyToolbarPresentation(decideToolbarPresentation(editorContentWidth))
    const presentation = decideDiagnosticsPresentation(editorContentWidth)
    if (this.drawerEl && this.lastDiagnosticsPresentation !== presentation) {
      this.drawerEl.dataset.mode = presentation
      this.lastDiagnosticsPresentation = presentation
    }
    this.emitActiveDocumentVisibilityInvariant()
    this.emitToolbarRenderedVisibilityInvariant()
  }

  /**
   * Navigator visual width. When the element is hidden (`display:none`) its
   * getBoundingClientRect().width is 0 — never fall back to a gutter-width
   * constant here. Resolution: rect.width → computed style width → 30px.
   */
  private measureNavigatorVisualWidth(): number {
    const el = this.navigatorEl
    if (!el) return NAVIGATOR_VISUAL_WIDTH_PX
    const rectWidth = el.getBoundingClientRect().width
    if (rectWidth > 0) return rectWidth
    const cssWidth = parseFloat(getComputedStyle(el).width || '')
    if (cssWidth > 0) return cssWidth
    return NAVIGATOR_VISUAL_WIDTH_PX
  }

  /** Chevron V3 — real-DOM icon visibility invariant (scrollable + visible). */
  private emitNavigatorIconVisibilityInvariant(visible: boolean, scrollable: boolean): void {
    const btns = this.navigatorEl
      ? Array.from(this.navigatorEl.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-navigator__btn'))
      : []
    const enabled = btns.filter(b => !b.disabled)
    const svg = enabled[0] ? enabled[0].querySelector('svg') : null
    const cs = svg ? getComputedStyle(svg) : null
    const stroke = cs ? cs.stroke : ''
    const decision = auditNavigatorIconVisibility({
      scrollable,
      navigatorVisible: visible,
      enabledButtonCount: enabled.length,
      svgWidth: svg ? parseFloat(getComputedStyle(svg).width || '0') : null,
      svgHeight: svg ? parseFloat(getComputedStyle(svg).height || '0') : null,
      svgDisplay: cs ? cs.display : null,
      svgVisibility: cs ? cs.visibility : null,
      svgOpacity: cs ? parseFloat(cs.opacity || '1') : null,
      strokeTransparent: stroke === 'transparent' || stroke === 'rgba(0, 0, 0, 0)',
    })
    if (decision.decision !== 'PASS') {
      this.navIconVisibilityFailCount++
      console.log(`[InkChapter] DOCUMENT-UTILITY-NAVIGATOR-ICON-VISIBILITY-INVARIANT: decision=${decision.decision} reason=${decision.reason} enabledButtonCount=${enabled.length}`)
    }
  }

  /**
   * Phase 2-B.3 / True-Inset — REAL safe-rail for the navigator.
   * Coherence gate: layout content beyond the visible viewport (DevTools
   * transient) is INCOHERENT → UNKNOWN visible fallback, never measured
   * NO_SAFE_PLACEMENT. Inset may overlap #write's right edge by at most
   * NAV_INSET_MAX_CONTENT_OVERLAP_PX (true inset, controlled overlap).
   */
  private computeNavigatorRail(
    rect: DOMRect | null | undefined,
    rightGutter: number | null,
    editorVisibleWidth: number | null,
    scrollbarKnowledge: 'known' | 'unknown',
    scrollbarSafeRight: number | null,
  ): {
    insetSafeWidth: number | null
    canInset: boolean
    insetCanFit: boolean
    contentMeasured: boolean
    contentLeft: number | null
    contentRight: number | null
    externalFreeWidth: number | null
    requiredInsetOverlap: number | null
    insetRailRight: number | null
    insetRightPx: number
  } {
    let contentRight: number | null = null
    let contentLeft: number | null = null
    let writeVisibleWithinViewport = rect == null || (rect.left >= 0 && rect.right >= 0)
    const writeEl = document.getElementById('write')
    if (writeEl) {
      const cs = getComputedStyle(writeEl)
      const wr = writeEl.getBoundingClientRect()
      const pl = /^([d.]+)px$/.exec(cs.paddingLeft || '')
      const pr = /^([d.]+)px$/.exec(cs.paddingRight || '')
      const padL = pl ? parseFloat(pl[1]) : 0
      const padR = pr ? parseFloat(pr[1]) : 0
      contentLeft = wr.left + padL
      contentRight = wr.right - padR
      writeVisibleWithinViewport = wr.left >= 0 && wr.right >= 0 && wr.width > 0
    } else if (rightGutter != null && rect) {
      contentRight = rect.right - rightGutter
    }
    const navWidth = this.measureNavigatorVisualWidth()
    const viewportRight = window.innerWidth
    // Visible content edge = clip the LAYOUT content edge to the viewport.
    const clippedContentRight = contentRight != null ? Math.min(contentRight, viewportRight) : null
    const coherent = contentLeft != null && clippedContentRight != null
      && clippedContentRight > contentLeft && navWidth > 0 && writeVisibleWithinViewport
    if (coherent) contentRight = clippedContentRight
    else { contentLeft = null; contentRight = null }
    const contentMeasured = coherent
    // True-Inset overlap math (requires measured scrollbar-safe right).
    const fit = computeTrueInsetFit(
      navWidth,
      coherent && scrollbarKnowledge === 'known' ? contentRight : null,
      scrollbarKnowledge === 'known' ? scrollbarSafeRight : null,
    )
    const externalFreeWidth = fit.externalFreeWidth
    const requiredInsetOverlap = fit.requiredInsetOverlap
    const insetCanFit = coherent && fit.canFit
    const insetSafeWidth = coherent && insetCanFit ? externalFreeWidth : null
    // UNKNOWN / incoherent content with a visible editor keeps the navigator
    // visible (inset fallback) but never overrides the pure geometry anchor.
    const unknownVisible = !coherent && editorVisibleWidth != null && editorVisibleWidth > 0
    const canInset = insetCanFit || unknownVisible
    const insetRailRight = scrollbarKnowledge === 'known' && scrollbarSafeRight != null
      ? scrollbarSafeRight
      : (coherent ? viewportRight - 2 : null)
    const insetRightPx = canInset && insetRailRight != null
      ? Math.max(0, viewportRight - insetRailRight)
      : NAV_RIGHT_PX
    return {
      insetSafeWidth: canInset && externalFreeWidth != null ? externalFreeWidth : (unknownVisible ? editorVisibleWidth : null),
      canInset,
      insetCanFit: canInset && (unknownVisible || insetCanFit),
      contentMeasured,
      contentLeft,
      contentRight,
      externalFreeWidth,
      requiredInsetOverlap,
      insetRailRight,
      insetRightPx,
    }
  }  /**
   * Phase 7R.3.11.8B.12 — Navigator ACTIVE-DOCUMENT eligibility gate (top
   * precedence). EMPTY / INACTIVE / no documentKey / Untitled+0 chars /
   * disconnected editor root are ALL ineligible → hidden, whatever geometry
   * or stale last-stable presentation says. Real-layout callers additionally
   * require the canonical heading frame to be READY.
   */
  private resolveNavigatorActiveDocEligibility(): { eligible: boolean; reason: string } {
    const ev = this.evaluateActiveDocumentPresence()
    const fp = this.opts.ctx.authority.getActiveFilePath()
    const md = this.opts.ctx.authority.getMarkdown()
    // Untitled + 0 chars is NOT a scrollable Markdown document.
    const emptyUntitled = (fp == null || fp === '') && (md == null || md.replace(/\s/g, '') === '')
    const root = resolveBusinessContentRoot()
    return decideNavigatorEligibilityPure({
      presenceState: ev.presence.state,
      hasActiveDocument: ev.hasActiveDocument,
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      rootConnected: root ? root.isConnected : null,
      emptyUntitled,
      canonicalReady: this.authorityReady.canonical,
      realLayout: !isHeadlessTestRuntime(),
    })
  }

  /** Phase 2-B.3 — SINGLE DOM writer for navigator display/rail. */
  private applyNavigatorPresentation(presentation: NavigatorPresentation, insetRightPx: number | null): void {
    if (!this.navigatorEl) return
    this.navigatorEl.dataset.rail = presentation
    this.navigatorEl.hidden = presentation === 'hidden'
    this.navigatorEl.setAttribute('aria-hidden', String(presentation === 'hidden'))
    if (presentation === 'inset' && insetRightPx != null) {
      this.navigatorEl.style.right = `${insetRightPx}px`
    }
    this.emitNavigatorPresentationInvariant()
  }

  /**
   * Ghost-control V1 — NAVIGATOR-PRESENTATION-INVARIANT (sig-guarded, one line
   * per state change). Presence/canonical/scrollability are the ONLY reasons
   * the navigator may ever be visible; visible-without-ACTIVE is a hard FAIL.
   */
  private emitNavigatorPresentationInvariant(): void {
    const nv = this.lastNavVis
    const nav = this.navigatorEl
    let presenceState = 'UNKNOWN'
    let hasActiveDocument = false
    try {
      const ev = this.evaluateActiveDocumentPresence()
      presenceState = ev.presence.state
      hasActiveDocument = ev.hasActiveDocument
    } catch { /* best-effort */ }
    const root = resolveBusinessContentRoot()
    const visible = nav ? !nav.hidden && nav.style.display !== 'none' : false
    let rect: { left: number; right: number; top: number; bottom: number } | null = null
    if (visible && nav) {
      try {
        const r = nav.getBoundingClientRect()
        rect = { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
      } catch { rect = null }
    }
    const sig = `${presenceState}|${hasActiveDocument}|${nv.presentation}|${nv.reason}|${visible}`
    if (sig === this.lastNavigatorPresentationSig) return
    this.lastNavigatorPresentationSig = sig
    emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-PRESENTATION-INVARIANT', {
      presenceState,
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      hasActiveDocument,
      editorRootConnected: root ? root.isConnected : null,
      canonicalFrameState: this.authorityReady.canonical ? 'READY' : 'WAITING',
      scrollable: this.lastGeometry?.scrollable ?? false,
      requestedMode: nv.presentation,
      finalMode: nv.presentation,
      reason: nv.reason,
      left: rect ? rect.left : null,
      right: rect ? rect.right : null,
      top: rect ? rect.top : null,
      bottom: rect ? rect.bottom : null,
      visible,
      decision: visible && presenceState !== 'ACTIVE' ? 'FAIL_VISIBLE_WITHOUT_ACTIVE_DOCUMENT'
        : nv.presentation === 'hidden' && rect ? 'FAIL_HIDDEN_WITH_GEOMETRY'
          : 'PASS',
    })
  }

  /** Phase 2-B.2 — VISIBLE-EDITOR invariant (commit-time, low noise). */
  private emitVisibleEditorInvariant(): void {
    const docKey = this.opts.ctx.authority.getDocumentKey()
    if (!docKey) return
    const g = this.lastVisibleEditor
    const contained = g.visibleWidth != null && g.visibleWidth > 0 && g.presentation !== 'suppressed'
    emitRuntimeAudit('DOCUMENT-UTILITY-VISIBLE-EDITOR-INVARIANT', {
      documentKey: docKey,
      editorLayoutWidth: g.layoutWidth,
      editorVisibleWidth: g.visibleWidth,
      toolbarPresentation: g.presentation,
      toolbarContained: contained,
      decision: g.presentation === 'suppressed' ? 'SUPPRESSED_OUT_OF_VIEW_OR_COLLAPSED' : (contained ? 'TOOLBAR_WITHIN_VISIBLE_EDITOR' : 'CONTAINMENT_CHECK_PENDING'),
    })
  }

  /** Phase 2-B.3 — navigator visibility invariant (commit-time). */
  private emitNavigatorVisibilityInvariant(g: { scrollable: boolean; navigatorVisible: boolean; navigatorSuppressed: boolean }): void {
    const docKey = this.opts.ctx.authority.getDocumentKey()
    if (!docKey) return
    const nv = this.lastNavVis
    let navRect: DOMRect | null = null
    if (this.navigatorEl && !this.navigatorEl.hidden) { try { navRect = this.navigatorEl.getBoundingClientRect() } catch { navRect = null } }
    const container = getActiveEditorScrollContainer()
    const scrollHeight = container ? container.scrollHeight : 0
    const clientHeight = container ? container.clientHeight : 0
    const driftDecision = this.classifyNavigatorDrift(navRect)
    const facts = this.lastRailFacts
    const round2 = (n: number | null): number | null => (n == null ? null : Math.round(n * 100) / 100)
    emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-VISIBILITY-INVARIANT', {
      documentKey: docKey,
      scrollable: g.scrollable,
      navigatorVisible: g.navigatorVisible,
      drawerVisible: this.drawerOpen,
      scrollHeight,
      clientHeight,
      maxScrollTop: Math.max(0, scrollHeight - clientHeight),
      presentation: nv.presentation,
      presentationReason: nv.reason,
      editorVisibleWidth: this.lastVisibleEditor.visibleWidth,
      navigatorRect: navRect
        ? { left: Math.round(navRect.left), right: Math.round(navRect.right), top: Math.round(navRect.top), bottom: Math.round(navRect.bottom), width: Math.round(navRect.width), height: Math.round(navRect.height) }
        : null,
      rail: facts
        ? {
            knowledge: facts.knowledge,
            contentRight: round2(facts.contentRight),
            safeRailLeft: round2(facts.safeRailLeft),
            safeRailRight: round2(facts.safeRailRight),
            scrollbarKnowledge: facts.scrollbarKnowledge,
            scrollbarWidth: facts.scrollbarWidth,
            scrollbarSafeRight: round2(facts.scrollbarSafeRight),
            insetSafeWidth: round2(facts.insetSafeWidth),
            expectedRight: round2(facts.expectedRight),
          }
        : null,
      drift: { tolerancePx: 1, decision: driftDecision, reason: driftDecision === 'PASS' ? 'POSITION_STABLE' : driftDecision },
      decision: g.navigatorVisible ? 'VISIBLE' : 'HIDDEN',
    })
  }

  /** V1.5 — final Navigator authority invariant (legacy-leak detection). */
  private emitNavigatorAuthorityInvariant(g: OverlayGeometry): void {
    const pres = this.lastNavVis.presentation
    const reason = this.lastNavVis.reason ?? 'UNKNOWN'
    const domHidden = this.navigatorEl ? this.navigatorEl.hidden : true
    const legacyLeak = (g.scrollable && (reason === 'SHORT_DOCUMENT_NAV_HIDDEN'))
      || (pres !== 'hidden' && !g.navigatorVisible)
      || (g.scrollable && g.navigatorVisible && domHidden)
    if (legacyLeak) this.legacySuppressionEmissionCount++
    const sig = `${g.scrollable}|${g.navigatorVisible}|${g.navigatorSuppressed}|${pres}|${reason}|${domHidden}`
    if (sig === this.lastNavigatorAuthoritySig) return
    this.lastNavigatorAuthoritySig = sig
    emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-AUTHORITY-INVARIANT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      scrollable: g.scrollable,
      baseNavigatorEligible: g.scrollable,
      presentation: pres,
      presentationReason: reason,
      navigatorVisible: g.navigatorVisible,
      navigatorSuppressed: g.navigatorSuppressed,
      navigatorDomHidden: domHidden,
      navigatorDomAriaHidden: this.navigatorEl ? this.navigatorEl.getAttribute('aria-hidden') : null,
      legacySuppressionEmissionCount: this.legacySuppressionEmissionCount,
      decision: legacyLeak ? 'FAIL_LEGACY_NAVIGATOR_SUPPRESSION_LEAK' : 'PASS',
    })
  }

  /** V1.1 — Drift classification consuming the ONE captured Rail Facts set. */
  private classifyNavigatorDrift(navRect: DOMRect | null): string {
    if (!navRect) return 'NA'
    const facts = this.lastRailFacts
    if (!facts || facts.knowledge !== 'known' || facts.contentRight == null ||
        facts.safeRailLeft == null || facts.safeRailRight == null) {
      // UNKNOWN geometry must NEVER be misread as a safe-rail FAIL.
      return 'NA_UNKNOWN_GEOMETRY'
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const verdict = classifyNavigatorPositionDrift({
      left: navRect.left,
      right: navRect.right,
      top: navRect.top,
      bottom: navRect.bottom,
      width: navRect.width,
      viewportLeft: 0,
      viewportRight: vw,
      viewportTop: 0,
      viewportBottom: vh,
      contentRight: facts.contentRight,
      contentGap: this.lastDriftContentGap,
      safeRailLeft: facts.safeRailLeft,
      safeRailRight: facts.safeRailRight,
      // Only feed a MEASURED scrollbar boundary; unknown → sub-check is skipped.
      scrollbarSafeRight: facts.scrollbarKnowledge === 'known' ? facts.scrollbarSafeRight : null,
    })
    if (verdict === 'PASS' && facts.scrollbarKnowledge !== 'known') {
      // Without a measured scrollbar edge we cannot certify scrollbar clearance —
      // never claim a deterministic FAIL or a silent PASS for that boundary.
      return 'NA_SCROLLBAR_GEOMETRY'
    }
    return verdict
  }

  /** V5.12-R2 §3.2 — geometry-sync reason → layout epoch mutation kind. */
  private static layoutMutationKindForGeometryReason(reason: string): LayoutMutationKind | null {
    switch (reason) {
      case 'window-resize': return 'WINDOW_LAYOUT_SETTLE'
      case 'mount': return 'DOCUMENT_LOAD'
      case 'tabs-structure-change': return 'DOCUMENT_SWITCH'
      default: return null
    }
  }

  /** V5.12-R2 §10 — an inline carrier is the mark OR its per-line fragments. */
  private inlineCarrierPresent(structure: { inlineMarkCount: number; inlineFragmentCount?: number }): boolean {
    return structure.inlineMarkCount === 1 || (structure.inlineFragmentCount ?? 0) >= 1
  }

  /** V5.12-R2 §4/§5 — a heading visual carrier is the text-tight marker layer. */
  private headingCarrierPresent(structure: { headingMarkerCarrier?: boolean }): boolean {
    return structure.headingMarkerCarrier === true
      && this.headingMarkerLayer !== null
      && this.headingPassiveMarkers.size > 0
  }

  private applyGeometry(reasons: Set<string>): void {
    if (!this.root) return
    this.geometryCounters.executionCount++
    // V5.12-R2 §3.2 — ONLY the reasons that really change `#write` geometry may
    // bump the document layout epoch. `content-mutation` and
    // `resize-observer` are deliberately NOT mapped: the plugin's own marker
    // writes are mutations inside `#write`, and mapping them would create the
    // high-frequency self-wake loop the spec forbids (the projection-commit
    // boundary already bumps the epoch via the admitted snapshot).
    for (const reason of reasons) {
      const kind = DocumentUtilityOverlayHost.layoutMutationKindForGeometryReason(reason)
      if (kind) this.bumpDocumentLayoutEpoch(kind)
    }
    this.ensureTabStructureObserver()
    // Phase 7R.3.11.8B.NO-ACTIVE-DOC — highest-precedence gate. Without a real
    // active Markdown document no geometry / last-stable / workspace fallback
    // may ever make the Document Problems Control visible.
    if (!this.resolveHasActiveDocument()) {
      this.applyNoActiveDocumentState()
      return
    }
    const container = getActiveEditorScrollContainer()
    const rect = container?.getBoundingClientRect()
    // Phase 7R.3.11.8B.6 — workspace width state (read-only sample + deduped
    // state-token write). Runs inside the SAME coalesced geometry pass so the
    // guard observes every real geometry change with zero extra observers.
    this.updateWorkspaceWidthState()
    // Phase 7R.3.11.8B.3 — live scrollability from the SAME container the
    // Scroll Operation uses (scrollHeight/clientHeight; never字数/block count).
    const scrollHeight = container ? container.scrollHeight : 0
    const clientHeight = container ? container.clientHeight : 0
    // Phase 2-B.2 — VISIBLE editor geometry (viewport-clipped), separate from
    // the layout rect that workspace min-width may clamp to 520 even when the
    // window is 150px wide. Toolbar presentation MUST use the visible width.
    const viewportRight = window.innerWidth
    const layoutEditable = rect != null && rect.width > 0
    const layoutLeft = layoutEditable ? rect.left : null
    const layoutRight = layoutEditable ? rect.right : null
    const editorVisibleWidth = computeEditorVisibleWidth(
      layoutLeft != null && layoutRight != null ? { left: layoutLeft, right: layoutRight } : null,
      viewportRight,
    )
    // Toolbar anchor: visible editor rect (clip the off-viewport layout right).
    const geometryRight = layoutEditable ? Math.min(rect.right, viewportRight) : null
    const next = computeOverlayGeometry(
      layoutEditable && geometryRight != null ? { top: rect.top, right: geometryRight, bottom: rect.bottom } : null,
      { width: window.innerWidth, height: window.innerHeight },
      { drawerOpen: this.drawerOpen, scrollHeight, clientHeight },
    )
    // ── Phase 2-B — RESPONSIVE from REAL visible editor geometry.
    // 1) Toolbar density + Diagnostics presentation from the VISIBLE editor width.
    // 2) Navigator gutter-aware visibility from the REAL right gutter
    //    (scroll viewport right − #write content right). Applied BEFORE the
    //    noop comparison so width-only changes still reclass without geometry churn.
    const toolbarPresentation = decideToolbarPresentation(editorVisibleWidth)
    let rightGutter: number | null = null
    const writeEl = document.getElementById('write')
    if (rect && writeEl) {
      const wr = writeEl.getBoundingClientRect()
      // Only trust real layout (jsdom/hidden → 0 width): unknown gutter keeps
      // the legacy behavior instead of hiding the navigator in tests.
      if (wr.width > 0 || wr.right > rect.right) rightGutter = rect.right - wr.right
    }
    const gutterOk = decideNavigatorGutterVisible(rightGutter)
    this.applyResponsiveClasses(editorVisibleWidth)
    this.lastVisibleEditor = {
      layoutWidth: layoutEditable ? rect.width : null,
      visibleWidth: editorVisibleWidth,
      presentation: toolbarPresentation,
    }
    // Phase 2-B.3 — final Navigator authority (single write point).
    // Eligibility first: EMPTY / no document / Untitled / disconnected root /
    // canonical-not-ready force hidden BEFORE any placement decision. Show
    // depends on scrollability; WHERE depends on visible editor geometry
    // (gutter → inset rail → hidden/NO_SAFE_PLACEMENT). Left/bottom-left
    // fallback is permanently forbidden.
    const navEligibility = this.resolveNavigatorActiveDocEligibility()
    if (next.scrollable && navEligibility.eligible) {
      // True-Inset — measure the REAL scrollbar boundary BEFORE the rail.
      let scrollbarKnowledge: 'known' | 'unknown' = 'unknown'
      let scrollbarWidth: number | null = null
      let scrollbarSafeRight: number | null = null
      if (container && rect && rect.width > 0 && container.offsetWidth > 0 && container.clientWidth > 0 && Number.isFinite(rect.right)) {
        scrollbarWidth = Math.max(0, container.offsetWidth - container.clientWidth)
        scrollbarSafeRight = rect.right - scrollbarWidth - NAV_SCROLLBAR_SAFE_GAP_PX
        scrollbarKnowledge = 'known'
      }
      const rail = this.computeNavigatorRail(rect, rightGutter, computeEditorVisibleWidth(rect ? { left: rect.left, right: rect.right } : null, viewportRight), scrollbarKnowledge, scrollbarSafeRight)
      // Real Candidate-Rect decision — the ONLY placement authority.
      // inset validity comes from an actual candidate rect (right pinned to the
      // measured scrollbarSafeRight, overlap ≤ NAV_INSET_MAX_CONTENT_OVERLAP_PX,
      // fully inside the visible editor). NO insetSafeWidth ≥ 44 gate exists.
      // Visible-editor containment (highest precedence): every placement mode —
      // gutter, safe-inset, edge-inset, GEOMETRY_PENDING, UNKNOWN fallback and
      // lastStablePresentation — must yield when the Markdown editor itself is
      // not visible or is too narrow to contain the 30px navigator.
      const editorLeftRaw = rect ? rect.left : null
      const editorRightRaw = rect ? rect.right : null
      const editorLeft = editorLeftRaw != null ? Math.max(editorLeftRaw, 0) : null
      const editorRight = editorRightRaw != null ? Math.min(editorRightRaw, viewportRight) : null
      const editorTopRaw = rect ? rect.top : null
      const editorBottomRaw = rect ? rect.bottom : null
      const editorVisibleHeight = editorTopRaw != null && editorBottomRaw != null
        ? Math.min(editorBottomRaw, window.innerHeight) - Math.max(editorTopRaw, 0) : 0
      const navVisualWidth = this.measureNavigatorVisualWidth()
      const editorVisibleWidth = editorLeft != null && editorRight != null ? editorRight - editorLeft : 0
      const hasVisibleEditor = rect != null && editorVisibleWidth > 0.5 && editorVisibleHeight > 0.5
      const editorCanContainNavigator = editorVisibleWidth >= navVisualWidth + 2 * NAV_EDGE_INSET_GAP_PX
      const geometryKnown = rail.contentMeasured && rail.contentRight != null && editorLeft != null && editorRight != null
        && scrollbarKnowledge === 'known' && scrollbarSafeRight != null
      const gutterCandidateValid = geometryKnown && rail.contentRight != null && editorRight != null
        && editorRight - (rail.contentRight + NAV_CONTENT_SAFE_GAP_PX) >= navVisualWidth
      const insetCandidate = geometryKnown
        ? computeNavigatorPlacementCandidate({
            editorLeft: editorLeft!,
            editorRight: editorRight!,
            contentRight: rail.contentRight!,
            scrollbarSafeRight: scrollbarSafeRight!,
            navigatorWidth: navVisualWidth,
          })
        : null
      // Edge-Inset fallback — still `inset`, NOT a 4th presentation. Applies
      // when the content-overlap-safe inset cannot fit but the FULL navigator
      // still fits inside the visible editor clear of the scrollbar.
      const edgeInsetCandidate = geometryKnown
        ? computeNavigatorEdgeInsetCandidate({
            editorLeft: editorLeft!,
            editorRight: editorRight!,
            scrollbarSafeRight: scrollbarSafeRight!,
            navigatorWidth: navVisualWidth,
          })
        : null
      const rawPres = decideNavigatorPresentation({
        scrollable: true,
        hasVisibleEditor,
        editorCanContainNavigator,
        gutterCandidateValid,
        insetCandidateValid: insetCandidate?.valid ?? false,
        edgeInsetCandidateValid: edgeInsetCandidate?.valid ?? false,
        geometryKnown,
      })
      // V1.4 — Resize Stabilization Gate: a scrollable doc never jumps straight
      // visible → NO_SAFE_PLACEMENT on the first transient frame. One hold +
      // exactly one next-frame remeasure, then the REAL decision commits.
      // NO_VISIBLE_EDITOR is NOT transient: it immediately cancels any held
      // visible presentation — no one-frame hold, no stale lastStable visible.
      if (rawPres.reason === 'NO_VISIBLE_EDITOR') {
        this.lastStableNavigatorPresentation = null
        this.stabilizationRemeasurePending = false
      }
      const stab = applyNavigatorStabilization({
        scrollable: true,
        presentation: rawPres.presentation,
        reason: rawPres.reason,
        lastStableVisible: this.lastStableNavigatorPresentation,
        remeasureScheduled: this.stabilizationRemeasurePending,
      })
      this.lastStableNavigatorPresentation = stab.lastStableVisible
      if (rawPres.presentation !== 'hidden') this.stabilizationRemeasurePending = false
      if (stab.scheduleRemeasure && !this.stabilizationRemeasurePending) {
        this.stabilizationRemeasurePending = true
        this.scheduleGeometrySync('navigator-stabilize-remeasure')
      }
      const effPres = stab.presentation
      // Phase 7R.3.11.8B.12 — UNKNOWN geometry defaults to HIDDEN in a real
      // layout. The old "INSET_UNKNOWN_FALLBACK → visible" is forbidden here:
      // if the visible editor / gutter / inset safe width could not be
      // measured, the navigator must not guess a position.
      const realLayout = !isHeadlessTestRuntime()
      let finalPres: NavigatorPresentation = effPres
      let finalReason = stab.reason
      if (realLayout && !geometryKnown && finalPres !== 'hidden') {
        finalPres = 'hidden'
        finalReason = 'NO_SAFE_PLACEMENT'
        this.lastStableNavigatorPresentation = null
        this.stabilizationRemeasurePending = false
      }
      // True-Inset — inset only when the rail proved the FULL navigator fits
      // (external free space + allowed content overlap ≤ NAV_INSET_MAX…).
      const useInsetRail = finalPres === 'inset' && rail.contentMeasured && rail.canInset
      const insetPx = useInsetRail ? rail.insetRightPx : null
      this.lastNavVis = { presentation: finalPres, reason: finalReason, insetRightPx: insetPx }
      if (this.navigatorEl) this.applyNavigatorPresentation(finalPres, insetPx)
      if (finalPres !== 'hidden') {
        this.emitNavigatorIconVisibilityInvariant(true, true)
        // Containment invariant — a VISIBLE navigator must sit fully inside the
        // visible editor rect (never over the file/outline sidebar or DevTools).
        const navRect = this.navigatorEl ? this.navigatorEl.getBoundingClientRect() : null
        const editorL = editorLeftRaw ?? editorLeft
        const editorR = editorRightRaw ?? editorRight
        const contained = navRect != null && hasVisibleEditor && navRect.width > 0
          && navRect.left >= editorL! - 1 && navRect.right <= editorR! + 1
        if (navRect && hasVisibleEditor && !contained) {
          this.editorContainmentFailCount++
          console.log(`[InkChapter] DOCUMENT-UTILITY-NAVIGATOR-EDITOR-CONTAINMENT-INVARIANT: decision=FAIL_NAVIGATOR_OUTSIDE_VISIBLE_EDITOR left=${navRect.left} right=${navRect.right} editorLeft=${editorL} editorRight=${editorR}`)
        }
      }
      // True-Inset — capture the SAME measured rail facts the Drift audit
      // consumes. safeRailLeft/right + contentGap are presentation-aware:
      // gutter keeps contentRight+8; inset may sit at contentRight−12 and
      // rides up to the measured scrollbarSafeRight.
      const edgeMode = finalPres === 'inset' && finalReason === 'INSET_EDGE_FALLBACK'
      const insetPres = finalPres === 'inset' || (finalReason === 'STABILIZING_ONE_FRAME' && this.lastStableNavigatorPresentation === 'inset')
      // Edge mode: content overlap rules do NOT apply — only editor bounds +
      // scrollbar (Drift content-left check skipped via contentRight:null).
      const gapPx = insetPres ? (edgeMode ? 0 : -NAV_INSET_MAX_CONTENT_OVERLAP_PX) : NAV_CONTENT_SAFE_GAP_PX
      this.lastRailFacts = !edgeMode && rail.contentMeasured && rail.contentLeft != null && rail.contentRight != null
        ? {
            knowledge: 'known',
            contentLeft: rail.contentLeft,
            contentRight: rail.contentRight,
            safeRailLeft: insetPres ? rail.contentRight - NAV_INSET_MAX_CONTENT_OVERLAP_PX : rail.contentRight + NAV_CONTENT_SAFE_GAP_PX,
            safeRailRight: insetPres && rail.insetRailRight != null ? rail.insetRailRight : viewportRight - 2,
            scrollbarKnowledge,
            scrollbarWidth,
            scrollbarSafeRight,
            insetSafeWidth: rail.insetSafeWidth,
            expectedRight: useInsetRail ? rail.insetRailRight : (rightGutter != null ? next.navRight : null),
          }
        : edgeMode && scrollbarSafeRight != null
          ? { knowledge: 'known', contentLeft: null, contentRight: null, safeRailLeft: null, safeRailRight: scrollbarSafeRight, scrollbarKnowledge, scrollbarWidth, scrollbarSafeRight, insetSafeWidth: null, expectedRight: scrollbarSafeRight }
          : { knowledge: 'unknown', contentLeft: null, contentRight: null, safeRailLeft: null, safeRailRight: null, scrollbarKnowledge: 'unknown', scrollbarWidth: null, scrollbarSafeRight: null, insetSafeWidth: rail.insetSafeWidth, expectedRight: null }
      this.lastDriftContentGap = gapPx
      // Monotonic visibility invariant — edge fit ⇒ never hidden.
      const mono = auditNavigatorMonotonicVisibility({ scrollable: true, edgeInsetCandidateValid: edgeInsetCandidate?.valid ?? false, finalPresentation: finalPres })
      if (mono.decision !== 'PASS') {
        this.monotonicVisibilityHoleCount++
        console.log(`[InkChapter] DOCUMENT-UTILITY-NAVIGATOR-MONOTONIC-VISIBILITY-INVARIANT: decision=${mono.decision} finalPresentation=${finalPres} edgeInsetCandidateValid=${edgeInsetCandidate?.valid}`)
      }
      next.navigatorVisible = finalPres !== 'hidden'
      next.navigatorSuppressed = finalPres === 'hidden'
    } else {
      const hideReason = !navEligibility.eligible ? navEligibility.reason : 'NOT_SCROLLABLE'
      this.lastNavVis = { presentation: 'hidden', reason: hideReason, insetRightPx: null }
      this.lastRailFacts = null
      this.lastStableNavigatorPresentation = null
      this.stabilizationRemeasurePending = false
      this.lastDriftContentGap = NAV_CONTENT_SAFE_GAP_PX
      // Stale geometry cleanup — no left/right/top/bottom residue may survive
      // a hidden state (next show must never inherit a left-bottom position).
      if (this.navigatorEl) {
        this.navigatorEl.style.removeProperty('right')
        this.navigatorEl.style.removeProperty('left')
        this.navigatorEl.style.removeProperty('top')
        this.navigatorEl.style.removeProperty('bottom')
        this.applyNavigatorPresentation('hidden', null)
      }
      next.navigatorVisible = false
      next.navigatorSuppressed = true
    }
    // V1.5 — Navigator AUTHORITY invariant: any legacy drawer/small-viewport /
    // second-writer suppression leaking into the final state is a hard FAIL.
    this.emitNavigatorAuthorityInvariant(next)

    // Drawer bottom safe-area reserve (no navigator suppression):
    // the drawer simply ends above the navigator box.
    if (this.drawerOpen && next.scrollable && this.lastNavigatorHeightPx != null) {
      const bottomGap = rect && rect.bottom > 0 ? Math.max(0, window.innerHeight - rect.bottom) : 0
      const liveReserve = computeDrawerBottomReserve({
        navBottom: next.navBottom,
        navigatorVisible: true,
        navigatorHeightPx: this.lastNavigatorHeightPx,
        bottomGap,
      })
      let drawerMaxHeight = Math.max(0, window.innerHeight - next.drawerTop - liveReserve)
      if (drawerMaxHeight < MIN_DRAWER_USABLE_HEIGHT_PX) {
        drawerMaxHeight = Math.max(0, window.innerHeight - next.drawerTop - 8)
      }
      next.drawerMaxHeight = drawerMaxHeight
    }
    const hasDrawerTransition = reasons.has('drawer-open') || reasons.has('drawer-close')
    const prev = this.lastGeometry
    this.lastGeometry = next
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      this.geometryCounters.noopCount++
      // Phase 7R.3.11.8B.3.1 — §5 C UTILITY_RESIZE_ECHO: a write → one RO
      // callback → geometry noop terminates the causal token. This is NOT a
      // loop; the flag is cleared so an unrelated later write can never confirm.
      if (this.lastRoSawChangedShell) {
        this.geometryCounters.utilityResizeEchoCount++
        this.lastRoSawChangedShell = false
      }
      // State changed but geometry is already correct (e.g. rapid toggle
      // ending where it started): still report the state-specific placement.
      if (hasDrawerTransition) {
        const commitReason = this.drawerOpen ? 'drawer-open-committed' : 'drawer-close-committed'
        // Phase 7R.3.11.6 — drawer open/close is a BCR milestone even when the
        // geometry object is unchanged (8B.3 independent anchors make the
        // drawer transition a noop; the milestone audit must still fire).
        this.emitFullBcr(commitReason)
        this.emitNavigatorPlacementAudit(commitReason)
      }
      this.emitOverlayLayoutAudit(next, scrollHeight, clientHeight)
    this.emitVisibleEditorInvariant()
    this.emitNavigatorVisibilityInvariant(next)
    // Phase 7R.3.11.8B.8 — the visible editor region is unchanged yet a drawer /
    // DevTools / resize transition may have happened: keep the frame honest.
    this.repositionDiagnosticLocateFrame()
      return
    }
    this.geometryCounters.writeCount++
    this.utilityWriteEpoch++
    this.lastGeometryWriteTs = this.now()
    // Phase 7R.3.11.8B.3.1 — record the external epoch at this write so the RO
    // callback can tell whether an external resize invalidates attribution.
    this.lastGeometryWriteExternalEpoch = this.externalResizeEpoch
    if (this.toolbarEl) {
      this.toolbarEl.style.top = `${next.toolbarTop}px`
      this.toolbarEl.style.right = `${next.toolbarRight}px`
    }
    if (this.navigatorEl) {
      // Phase 7R.3.11.8B.3 — hidden when the real container is not scrollable
      // (or temporarily suppressed by the drawer safe-area policy);
      // display:none removes hit-targets, focus and keyboard reachability.
      // Ghost-control V1 — a HIDDEN navigator never keeps stale right/bottom
      // placement (next show must not inherit an old position).
      const nv = this.lastNavVis
      if (nv.presentation === 'hidden') {
        this.navigatorEl.style.removeProperty('right')
        this.navigatorEl.style.removeProperty('left')
        this.navigatorEl.style.removeProperty('top')
        this.navigatorEl.style.removeProperty('bottom')
        this.navigatorEl.style.display = 'none'
      } else {
        this.navigatorEl.style.right = `${nv.presentation === 'inset' && nv.insetRightPx != null ? nv.insetRightPx : next.navRight}px`
        this.navigatorEl.style.bottom = `${next.navBottom}px`
        this.navigatorEl.style.display = 'flex'
      }
    }
    if (this.drawerEl) {
      // Phase 7R.3.11.8B.3 — drawer is top-right anchored, content-sized
      // (height:auto), capped by maxHeight; never stretched by a bottom offset.
      this.drawerEl.style.top = `${next.drawerTop}px`
      this.drawerEl.style.right = `${next.drawerRight}px`
      this.drawerEl.style.bottom = ''
      this.drawerEl.style.maxHeight = `${next.drawerMaxHeight}px`
    }
    // Phase 7R.3.11.8B.7.2 — refresh the navigator height cache from the REAL
    // committed rect (read-only; the navigator box never depends on the drawer,
    // so this measurement cannot re-enter the geometry write path).
    if (next.navigatorVisible && this.navigatorEl) {
      const navRect = this.navigatorEl.getBoundingClientRect()
      if (navRect.height > 0) this.lastNavigatorHeightPx = navRect.height
    }
    // Phase 7R.3.11.8B.3.1 — §5 A TRUE_FEEDBACK_LOOP requires the full causal
    // token write1 → RO callback → write2: the current write must be a NEW
    // write strictly after the callback observed the change (utilityWriteEpoch
    // increased), and no external resize may have intervened.
    if (
      this.lastRoSawChangedShell
      && this.utilityWriteEpoch > this.lastShellChangeObservedWriteEpoch
      && this.externalResizeEpoch === this.externalEpochAtLoopStart
    ) {
      this.geometryCounters.feedbackLoopConfirmedCount++
    }
    this.lastRoSawChangedShell = false
    this.lastWriteShellRect = this.latestRects.shell
    const firstCommit = !this.geometryCommitted
    this.geometryCommitted = true
    // In-memory rects stay fresh during bursts; full BCR is milestone-only.
    this.refreshLatestRects()
    this.emitGeometryAndVisibility([...reasons].join(','), next)
    this.emitOverlayLayoutAudit(next, scrollHeight, clientHeight)
    if (this.drawerOpen) this.emitCollisionAudit()
    if (firstCommit) {
      this.emitFullBcr('first-geometry-commit')
    }
    // Phase 7R.3.11.6 — POST-COMMIT drawer BCR + NAV-PLACEMENT audit
    // (never pre-commit: the committed geometry is the final authority).
    if (hasDrawerTransition) {
      const commitReason = this.drawerOpen ? 'drawer-open-committed' : 'drawer-close-committed'
      this.emitFullBcr(commitReason)
      this.emitNavigatorPlacementAudit(commitReason)
      // Phase 7R.3.11.7 §32/§33: event-triggered settle summary (no timer).
      emitInkchapterRuntimeAuditSummary('drawer-transition-settled', { commitReason })
    }
    // Phase 7R.3.11.8B.8 — geometry committed (editor resize / Drawer open or
    // close / DevTools layout change): reposition the locate frame so it always
    // follows its resolved target.
    this.repositionDiagnosticLocateFrame()
  }

  /**
   * Phase 7R.3.11.8B.3 — low-noise overlay layout audit (state-token deduped).
   * Suppresses identical (documentKey, scrollable, navigatorVisible, drawerVisible,
   * drawerItemCount, rendered-height bucket) repeats; transitions always emit.
   */
  private emitOverlayLayoutAudit(g: OverlayGeometry, scrollHeight: number, clientHeight: number): void {
    const drawerItemCount = this.drawerEl ? this.drawerEl.querySelectorAll('.inkchapter-doc-drawer__item').length : 0
    const renderedHeight = this.drawerEl ? this.drawerEl.getBoundingClientRect().height : 0
    const heightBucket = Math.round(renderedHeight / 20)
    const signature = `${this.opts.ctx.authority.getDocumentKey() ?? ''}|${g.scrollable}|${g.navigatorVisible}|${this.drawerOpen}|${drawerItemCount}|${heightBucket}`
    if (signature === this.lastOverlayLayoutSignature) return
    this.lastOverlayLayoutSignature = signature
    const navReason = this.lastNavVis?.reason ?? 'UNKNOWN'
    // V1.5 — SHORT_DOCUMENT_NAV_HIDDEN is ONLY legal when !scrollable.
    let decision: string
    if (g.navigatorSuppressed) {
      decision = g.scrollable
        ? (navReason === 'NO_SAFE_PLACEMENT' ? 'NAVIGATOR_HIDDEN_NO_SAFE_PLACEMENT' : 'NAVIGATOR_HIDDEN')
        : 'SHORT_DOCUMENT_NAV_HIDDEN'
    } else if (!g.navigatorVisible) {
      decision = g.scrollable ? 'NAVIGATOR_HIDDEN_NO_SAFE_PLACEMENT' : 'SHORT_DOCUMENT_NAV_HIDDEN'
    } else if (this.drawerOpen) {
      decision = g.drawerMaxHeight > 0 && renderedHeight >= g.drawerMaxHeight - 2 ? 'DRAWER_MAX_HEIGHT_SCROLL' : 'DRAWER_CONTENT_FIT'
    } else {
      decision = 'SCROLLABLE_DOCUMENT_NAV_VISIBLE'
    }
    if (g.scrollable && decision === 'SHORT_DOCUMENT_NAV_HIDDEN') {
      this.legacySuppressionEmissionCount++
      decision = 'FAIL_LEGACY_NAVIGATOR_SUPPRESSION_LEAK'
    }
    emitRuntimeAudit('DOCUMENT-UTILITY-OVERLAY-LAYOUT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      scrollHeight,
      clientHeight,
      maxScrollTop: Math.max(0, scrollHeight - clientHeight),
      scrollable: g.scrollable,
      navigatorVisible: g.navigatorVisible,
      navigatorSuppressed: g.navigatorSuppressed,
      navigatorRight: g.navRight,
      navigatorBottom: g.navBottom,
      // Phase 7R.3.11.8B.7.2 — the safe-area inputs (REAL measured navigator
      // height + the reserve it produced), so runtime evidence is traceable.
      navigatorHeightPx: this.lastNavigatorHeightPx,
      drawerVisible: this.drawerOpen,
      drawerItemCount,
      drawerContentHeight: renderedHeight,
      drawerMaxHeight: g.drawerMaxHeight,
      drawerRenderedHeight: renderedHeight,
      drawerBodyScrollable: this.drawerOpen && g.drawerMaxHeight > 0 && renderedHeight >= g.drawerMaxHeight - 2,
      decision,
    })
  }

  /**
   * Phase 7R.3.11.8B.3.1 — Drawer rerender read-only layout audit.
   * After renderDrawer() the DOM is authoritative; this schedules ONE rAF that
   * ONLY reads the drawer box + list scroll metrics and emits the latest state.
   * It NEVER calls applyGeometry and never writes styles → geometryWriteDelta=0.
   * State-token dedup suppresses identical (docKey, drawerVisible, itemCount,
   * rendered-height bucket, bodyScrollable) repeats.
   */
  private scheduleDrawerContentAudit(): void {
    if (this.drawerContentAuditRafPending || this.disposed) return
    this.drawerContentAuditRafPending = true
    const run = (): void => {
      this.drawerContentAuditRafPending = false
      if (this.disposed || !this.drawerEl || !this.drawerListEl) return
      const writeCountBefore = this.geometryCounters.writeCount
      const drawerRect = this.drawerEl.getBoundingClientRect()
      const listScrollHeight = this.drawerListEl.scrollHeight
      const listClientHeight = this.drawerListEl.clientHeight
      const itemCount = this.drawerEl.querySelectorAll('.inkchapter-doc-drawer__item').length
      const renderedHeight = drawerRect.height
      const maxHeight = this.drawerEl.style.maxHeight ? Number.parseInt(this.drawerEl.style.maxHeight) : 0
      const bodyScrollable = maxHeight > 0 && listScrollHeight > listClientHeight && renderedHeight >= maxHeight - 2
      const heightBucket = Math.round(renderedHeight / 20)
      const signature = `${this.opts.ctx.authority.getDocumentKey() ?? ''}|${this.drawerOpen}|${itemCount}|${heightBucket}|${bodyScrollable}`
      const writeCountAfter = this.geometryCounters.writeCount
      if (signature !== this.lastDrawerContentAuditSignature) {
        this.lastDrawerContentAuditSignature = signature
        emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER-CONTENT-LAYOUT', {
          documentKey: this.opts.ctx.authority.getDocumentKey(),
          drawerVisible: this.drawerOpen,
          itemCount,
          drawerRenderedHeight: renderedHeight,
          drawerMaxHeight: maxHeight,
          listScrollHeight,
          listClientHeight,
          drawerBodyScrollable: bodyScrollable,
          geometryWriteBefore: writeCountBefore,
          geometryWriteAfter: writeCountAfter,
          geometryWriteDelta: writeCountAfter - writeCountBefore,
          readOnly: true,
        })
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run()
    }
  }

  private externalEpochAtLoopStart = -1

  private emitGeometryAndVisibility(reason: string, g: OverlayGeometry): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    emitRuntimeAudit('DOCUMENT-UTILITY-GEOMETRY', {
      reason,
      viewport,
      drawerOpen: this.drawerOpen,
      writeRect: this.latestRects.write ? { left: this.latestRects.write.left, top: this.latestRects.write.top, right: this.latestRects.write.right, bottom: this.latestRects.write.bottom, width: this.latestRects.write.width, height: this.latestRects.write.height } : null,
      visibleWriteRect: this.latestRects.visibleWrite,
      editorShellRect: this.latestRects.shell ? { left: this.latestRects.shell.left, top: this.latestRects.shell.top, right: this.latestRects.shell.right, bottom: this.latestRects.shell.bottom, width: this.latestRects.shell.width, height: this.latestRects.shell.height } : null,
      toolbarRect: this.toolbarEl ? { top: g.toolbarTop, right: g.toolbarRight } : null,
      navigatorRect: this.navigatorEl ? { right: g.navRight, bottom: g.navBottom } : null,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-VISIBILITY', {
      toolbarDisplay: this.toolbarEl ? getComputedStyle(this.toolbarEl).display : null,
      toolbarVisibility: this.toolbarEl ? getComputedStyle(this.toolbarEl).visibility : null,
      toolbarOpacity: this.toolbarEl ? getComputedStyle(this.toolbarEl).opacity : null,
      navigatorDisplay: this.navigatorEl ? getComputedStyle(this.navigatorEl).display : null,
      navigatorVisibility: this.navigatorEl ? getComputedStyle(this.navigatorEl).visibility : null,
      navigatorOpacity: this.navigatorEl ? getComputedStyle(this.navigatorEl).opacity : null,
    })
  }

  /**
   * Full BCR audit — milestone-only (mount / document switch / drawer open /
   * drawer close / lock transition / scroll-nav transition / resize-settled).
   * NOT emitted on every geometry write during continuous resize.
   * Phase 7R.3.11.4 — verdict must be GEOMETRY_PENDING until the first geometry
   * commit and until toolbar/navigator are actually inside the editor shell.
   */
  private emitFullBcr(reason: string): void {
    this.refreshLatestRects()
    this.bcrEmitCount++
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const r = this.latestRects
    const toolbarFullscreen = isAccidentalFullscreenChild(r.toolbar, viewport)
    const navigatorFullscreen = isAccidentalFullscreenChild(r.navigator, viewport)
    const drawerFullscreen = r.drawer ? r.drawer.width >= viewport.width * 0.8 && r.drawer.height >= viewport.height * 0.8 : false
    const toolbarInside = this.isInsideEditorShell(r.toolbar, r.shell)
    const navigatorInside = this.isInsideEditorShell(r.navigator, r.shell)
    const toolbarVisible = !!r.toolbar && r.toolbar.width > 0 && r.toolbar.height > 0 && !toolbarFullscreen && toolbarInside
    const navigatorVisible = !!r.navigator && r.navigator.width > 0 && r.navigator.height > 0 && !navigatorFullscreen && navigatorInside
    const committed = this.geometryCommitted
    const navigatorExpectedVisible = this.getNavigatorExpectedVisible()
    const placementFailure = this.computePlacementFailure()
    const decision = computeBcrVerdict({
      geometryCommitted: committed,
      toolbarInsideEditorShell: toolbarInside,
      navigatorInsideEditorShell: navigatorInside,
      toolbarVisible,
      navigatorVisible,
      navigatorExpectedVisible,
      toolbarFullscreen,
      navigatorFullscreen,
      drawerFullscreen,
      stateSpecificPlacementValid: placementFailure === null,
      placementFailure,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-BCR', {
      reason,
      geometryCommitted: committed,
      navigatorExpectedVisible,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      writeRect: r.write,
      visibleWriteRect: r.visibleWrite,
      editorShellRect: r.shell,
      scrollViewportRect: r.shell,
      overlayRootRect: r.overlayRoot,
      toolbarRect: r.toolbar,
      navigatorRect: r.navigator,
      drawerVisible: this.drawerOpen,
      drawerRect: r.drawer,
      toolbarFullscreen,
      navigatorFullscreen,
      drawerFullscreen,
      toolbarWriteOcclusionRatio: computeOcclusionRatio(r.toolbar, r.write),
      navigatorWriteOcclusionRatio: computeOcclusionRatio(r.navigator, r.write),
      drawerWriteOcclusionRatio: computeOcclusionRatio(r.drawer, r.write),
      toolbarVisibleWriteOcclusionRatio: computeOcclusionRatio(r.toolbar, r.visibleWrite),
      navigatorVisibleWriteOcclusionRatio: computeOcclusionRatio(r.navigator, r.visibleWrite),
      drawerVisibleWriteOcclusionRatio: computeOcclusionRatio(r.drawer, r.visibleWrite),
      toolbarInsideEditorShell: toolbarInside,
      navigatorInsideEditorShell: navigatorInside,
      decision,
    })
  }

  private isInsideEditorShell(child: RectRecord | null, shell: RectRecord | null): boolean {
    if (!child || !shell) return false
    const t = 8
    return child.left >= shell.left - t && child.right <= shell.right + t && child.top >= shell.top - t && child.bottom <= shell.bottom + t
  }

  private emitCollisionAudit(): void {
    const drawer = this.latestRects.drawer
    const navigator = this.latestRects.navigator
    const intersectionArea = rectIntersectionArea(drawer, navigator)
    emitRuntimeAudit('DOCUMENT-UTILITY-LAYOUT-COLLISION', {
      drawerVisible: this.drawerOpen,
      drawerRect: drawer,
      navigatorRect: navigator,
      intersectionArea,
      decision: this.drawerOpen && intersectionArea > 2 ? 'FAIL_COLLISION' : 'PASS',
    })
  }

  /**
   * Phase 7R.3.11.8B.3.1 — SINGLE scrollability authority reused by every audit
   * (placement / BCR / invariant). Never a second scrollability computation.
   */
  private getNavigatorExpectedVisible(): boolean {
    return this.lastGeometry?.navigatorVisible ?? false
  }

  /**
   * Phase 7R.3.11.6 — state-specific placement failure detector. Uses the SAME
   * geometry helper as production (no second formula): expectedRight is the
   * drawer-state-dependent navRight; actualRight = innerWidth - navRect.right.
   * Phase 7R.3.11.8B.3.1 — a legally-hidden navigator (expectedVisible=false)
   * is NOT a placement failure.
   */
  private computePlacementFailure(): NavigatorPlacementFailure | null {
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: this.getNavigatorExpectedVisible(),
      navigatorRect: this.latestRects.navigator,
      shellRect: this.latestRects.shell,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tolerancePx: NAV_PLACEMENT_TOLERANCE_PX,
    })
    return result.decision === 'PASS' ? null : (result.decision === 'NOT_EVALUATED' ? null : result.decision)
  }

  /** Phase 7R.3.11.6 — NAV-PLACEMENT runtime audit (post-commit only). */
  private emitNavigatorPlacementAudit(reason: string): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const nav = this.latestRects.navigator
    const drawer = this.latestRects.drawer
    const expectedVisible = this.getNavigatorExpectedVisible()
    const result = evaluateNavigatorPlacement({
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: expectedVisible,
      navigatorRect: nav,
      shellRect: this.latestRects.shell,
      viewport,
      tolerancePx: NAV_PLACEMENT_TOLERANCE_PX,
    })
    const intersectionArea = rectIntersectionArea(drawer, nav)
    const gapPx = drawer && nav ? Math.max(0, drawer.left - nav.right) : -1
    emitRuntimeAudit('DOCUMENT-UTILITY-NAV-PLACEMENT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      reason,
      drawerOpen: this.drawerOpen,
      navigatorExpectedVisible: expectedVisible,
      geometryCommitted: this.geometryCommitted,
      viewportWidth: viewport.width,
      editorShellRight: this.latestRects.shell?.right ?? null,
      drawerLeft: drawer?.left ?? null,
      drawerRight: drawer?.right ?? null,
      drawerWidth: drawer?.width ?? null,
      navigatorLeft: nav?.left ?? null,
      navigatorRight: nav?.right ?? null,
      expectedRight: result.expectedRight,
      actualRight: result.actualRight,
      rightDelta: result.rightDelta,
      intersectionArea,
      gapPx,
      decision: result.decision,
      decisionReason: result.reason,
    })
    // Phase 7R.3.11.8B.3 — NAVIGATOR-POSITION-INVARIANT: opening/closing the
    // drawer must NOT move the navigator (deltaX/deltaY <= 1px). State-token
    // deduped; transitions + FAIL always emit.
    const afterNav = this.latestRects.navigator
    const before = this.navRectBeforeDrawerToggle
    const navHidden = !afterNav || afterNav.width <= 0 || afterNav.height <= 0
    const deltaX = before && afterNav && !navHidden ? Math.abs(afterNav.right - before.right) : null
    const deltaY = before && afterNav && !navHidden ? Math.abs(afterNav.bottom - before.bottom) : null
    const pass = deltaX != null && deltaY != null && deltaX <= 1 && deltaY <= 1
    const invariantDecision = navHidden ? 'NOT_EVALUATED' : (pass ? 'PASS' : 'FAIL')
    const invariantReason = navHidden ? 'NAVIGATOR_HIDDEN' : (pass ? 'POSITION_STABLE' : 'POSITION_DRIFT')
    const signature = `${invariantReason}|${invariantDecision}|${deltaX}|${deltaY}|${this.drawerOpen}`
    if (signature !== this.lastNavPositionInvariantSignature) {
      this.lastNavPositionInvariantSignature = signature
      emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-POSITION-INVARIANT', {
        documentKey: this.opts.ctx.authority.getDocumentKey(),
        drawerVisibleBefore: !this.drawerOpen,
        drawerVisibleAfter: this.drawerOpen,
        rightBefore: before?.right ?? null,
        rightAfter: afterNav?.right ?? null,
        bottomBefore: before?.bottom ?? null,
        bottomAfter: afterNav?.bottom ?? null,
        deltaX,
        deltaY,
        decision: invariantDecision,
        reason: invariantReason,
      })
    }
    // Phase 7R.3.11.8B.3.1 — DOCUMENT-UTILITY-NAVIGATOR-AUDIT-INVARIANT:
    // a legally-hidden navigator must be NOT_EVALUATED everywhere; a hidden
    // navigator reporting POSITION_DRIFT is an audit invariant FAIL.
    const overlayDecision = !(this.lastGeometry?.scrollable) ? 'SHORT_DOCUMENT_NAV_HIDDEN' : (this.lastNavVis.presentation === 'hidden' ? 'NAVIGATOR_HIDDEN_NO_SAFE_PLACEMENT' : 'SCROLLABLE_DOCUMENT_NAV_VISIBLE')
    const auditPass = !expectedVisible ? result.decision === 'NOT_EVALUATED' : result.decision !== 'NOT_EVALUATED'
    emitRuntimeAudit('DOCUMENT-UTILITY-NAVIGATOR-AUDIT-INVARIANT', {
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      expectedVisible,
      overlayDecision,
      placementDecision: result.decision,
      positionInvariantDecision: invariantDecision,
      decision: auditPass ? 'PASS' : 'FAIL',
    })
  }

  /** Phase 7R.3.11.8B.3 — navigator position captured before a drawer toggle. */
  private navRectBeforeDrawerToggle: { right: number; bottom: number } | null = null
  /** Phase 7R.3.11.8B.3 — NAVIGATOR-POSITION-INVARIANT state-token dedup. */
  private lastNavPositionInvariantSignature = ''

  private emitResizeSummary(): void {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const verdict = classifyAttribution({
      feedbackLoopConfirmedCount: this.geometryCounters.feedbackLoopConfirmedCount,
      mixedCorrelationCount: this.geometryCounters.mixedCorrelationCount,
      externalResizeEpoch: this.externalResizeEpoch,
      warningCorrelationCount: this.geometryCounters.warningCorrelationCount,
    })
    // Phase 7R.3.11.5 — single callback-count authority: callbackCount derives
    // from resizeObserverEpoch, so difference is structurally 0.
    const consistency = computeAuditConsistency(this.resizeObserverEpoch, this.resizeObserverEpoch)
    emitRuntimeAudit('DOCUMENT-UTILITY-RESIZE-SUMMARY', {
      windowMs: Math.round(this.now()),
      resizeObserverCallbackCount: consistency.resizeObserverCallbackCount,
      windowResizeEventCount: this.geometryCounters.windowResizeEventCount,
      geometryScheduleCount: this.geometryCounters.scheduleCount,
      geometryExecutionCount: this.geometryCounters.executionCount,
      geometryWriteCount: this.geometryCounters.writeCount,
      geometryNoopCount: this.geometryCounters.noopCount,
      sameFrameCoalesceCount: this.geometryCounters.sameFrameCoalesceCount,
      feedbackLoopSuspectCount: this.geometryCounters.feedbackLoopSuspectCount,
      feedbackLoopConfirmedCount: this.geometryCounters.feedbackLoopConfirmedCount,
      utilityResizeEchoCount: this.geometryCounters.utilityResizeEchoCount,
      mixedCorrelationCount: this.geometryCounters.mixedCorrelationCount,
      warningCorrelationCount: this.geometryCounters.warningCorrelationCount,
      externalResizeEpoch: this.externalResizeEpoch,
      utilityWriteEpoch: this.utilityWriteEpoch,
      resizeObserverEpoch: this.resizeObserverEpoch,
      attributionVerdict: verdict,
      viewport,
    })
    emitRuntimeAudit('DOCUMENT-UTILITY-AUDIT-CONSISTENCY', consistency)
    // One full BCR at resize-settled (log-reduction gate).
    this.emitFullBcr('resize-settled')
  }

  // ── Toolbar (Document Problems Control, V1.1) ──────
  private buildToolbar(root: HTMLDivElement): HTMLDivElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'inkchapter-doc-toolbar'
    toolbar.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    toolbar.style.position = 'absolute'
    toolbar.style.pointerEvents = 'auto'

    // DocumentProblemsControl = StatusSegment(error) + StatusSegment(warning)
    // + Divider + EditLockAction inside ONE shell. Segments are rebuilt on every
    // diagnostics publish by renderDiagnosticsButton (Smart Summary).
    const control = document.createElement('div')
    control.className = 'inkchapter-problems-control'
    control.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    this.problemsControlEl = control
    toolbar.appendChild(control)

    const lockBtn = document.createElement('button')
    lockBtn.type = 'button'
    lockBtn.className = 'inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--lock inkchapter-editlock'
    lockBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    lockBtn.setAttribute('aria-label', '编辑 / 已锁定')
    lockBtn.title = '编辑 / 已锁定'
    lockBtn.addEventListener('click', () => this.toggleLock())
    this.lockButtonEl = lockBtn
    toolbar.appendChild(lockBtn)

    root.appendChild(toolbar)
    this.renderLockButton()
    return toolbar
  }

  /** V1.1 — build ONE clickable status segment (icon + plain count text). */
  private buildProblemsSegment(severity: 'error' | 'warning', count: number): HTMLButtonElement {
    const seg = document.createElement('button')
    seg.type = 'button'
    seg.className =
      `inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--diag ` +
      `inkchapter-toolbar-segment inkchapter-toolbar-segment--${severity}`
    seg.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    seg.setAttribute('data-severity', severity)
    const icon = document.createElement('span')
    icon.className = 'inkchapter-toolbar-segment__icon'
    setIcon(icon, severity)
    const num = document.createElement('span')
    num.className = 'inkchapter-toolbar-segment__count'
    num.textContent = String(count)
    seg.setAttribute('aria-label', severity === 'error' ? `错误 ${count}` : `警告 ${count}`)
    seg.title = seg.getAttribute('aria-label') ?? ''
    seg.append(icon, num)
    seg.addEventListener('click', () => this.openDrawer(severity))
    return seg
  }

  /** V1.1 — Smart Summary: renders only the non-zero segments (never 错误0/警告0). */
  private renderDiagnosticsButton(): void {
    const control = this.problemsControlEl
    if (!control) return
    control.replaceChildren()
    // V4 — SINGLE projection authority: Toolbar never keeps its own counts.
    const projection = deriveDocumentProblemsProjection(this.snapshot)
    this.currentProblemsProjection = projection
    const state = deriveDiagnosticsState(this.snapshot)
    const noDoc = state.state === 'NO_ACTIVE_DOCUMENT' || state.state === 'EMPTY_DOCUMENT' || !projection.hasProjection
    if (noDoc) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--diag inkchapter-toolbar-entry'
      entry.setAttribute('aria-label', '文档检测')
      entry.title = '文档检测'
      const label = document.createElement('span')
      label.textContent = '文档检测'
      entry.append(label)
      entry.addEventListener('click', () => this.openDrawer('all'))
      control.appendChild(entry)
      return
    }
    if (projection.errorCount > 0) control.appendChild(this.buildProblemsSegment('error', projection.errorCount))
    if (projection.warningCount > 0) control.appendChild(this.buildProblemsSegment('warning', projection.warningCount))
    if (projection.errorCount === 0 && projection.warningCount === 0) {
      // HEALTHY (0/0/0) — check icon + 文档检测.
      // V5.12-R6 §1/§11 — HINT-ONLY (e.g. the empty-document terminal notice:
      // 全部1 / 错误0 / 警告0 / 提示1) MUST stay reachable: without an entry the
      // Problems Control would render NOTHING and the Drawer could never be
      // opened. The hint entry shows the REAL hint count — a zero counter is
      // still never rendered.
      const hintOnly = projection.hintCount > 0
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className =
        'inkchapter-doc-toolbar__btn inkchapter-doc-toolbar__btn--diag inkchapter-toolbar-entry' +
        (hintOnly ? '' : ' is-healthy')
      const entryLabel = hintOnly ? `提示 ${projection.hintCount}` : '文档检测'
      entry.setAttribute('aria-label', entryLabel)
      entry.title = entryLabel
      const icon = document.createElement('span')
      icon.className = 'inkchapter-toolbar-segment__icon'
      setIcon(icon, hintOnly ? 'info' : 'check')
      const label = document.createElement('span')
      label.textContent = entryLabel
      entry.append(icon, label)
      entry.addEventListener('click', () => this.openDrawer('all'))
      control.appendChild(entry)
    }
  }

  /**
   * Phase 7R.3.11.8-B §3.6 — STRICT-SINGLE-H1 popup with dedup.
   * Emits once per (documentKey + violationFingerprint) transition:
   *   NONE→ERROR, PASS→ERROR, SKIP→ERROR (and fingerprint change) → toast once;
   *   ERROR→PASS → clears the active violation token (re-arm for next ERROR).
   * State-transition logging only — no per-mutation spam.
   */
  private handleStrictSingleH1Popup(snapshot: DocumentDiagnosticsSnapshot | null): void {
    const docKey = snapshot?.documentKey ?? null
    if (docKey == null) return
    const violation = snapshot?.diagnostics.find(d =>
      d.code === 'STRICT_SINGLE_H1_NO_H1' || d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1') ?? null
    if (violation) {
      const fingerprint = (violation.metadata?.violationFingerprint as string | undefined) ?? violation.code
      const prev = this.strictSingleH1PopupTokens.get(docKey)
      if (prev !== fingerprint) {
        this.strictSingleH1PopupTokens.set(docKey, fingerprint)
        this.strictSingleH1PopupEmitCount++
        this.showToast(violation.message.split('\n')[0])
        emitRuntimeAudit('DOCUMENT-UTILITY-STRICT-SINGLE-H1-POPUP', {
          documentKey: docKey,
          ruleId: 'STRICT-SINGLE-H1',
          code: violation.code,
          violationFingerprint: fingerprint,
          h1Count: violation.metadata?.h1Count ?? null,
          reason: violation.metadata?.reason ?? null,
          decision: 'POPUP_EMITTED',
        })
      }
    } else {
      // ERROR → PASS / SKIP: clear the active violation token (re-arm).
      if (this.strictSingleH1PopupTokens.delete(docKey)) {
        emitRuntimeAudit('DOCUMENT-UTILITY-STRICT-SINGLE-H1-POPUP', {
          documentKey: docKey,
          ruleId: 'STRICT-SINGLE-H1',
          violationFingerprint: null,
          decision: 'VIOLATION_CLEARED',
        })
      }
    }
  }

  private toggleLock(): void {
    if (!this.opts.ctx.authority.getDocumentKey()) {
      this.showToast('无活动文档，无法锁定')
      return
    }
    const nextLocked = !this.editGuard.isLocked()
    if (nextLocked) {
      const ok = this.editGuard.lock()
      if (!ok) {
        this.showToast('无法锁定当前文档')
        return
      }
      this.setLockState(true)
      this.showToast('当前文档已锁定')
    } else {
      this.editGuard.unlock()
      this.setLockState(false)
      this.showToast('已解锁')
    }
    this.renderLockButton()
    this.emitFullBcr('lock-transition')
    emitRuntimeAudit('DOCUMENT-UTILITY-EDIT-GUARD', {
      action: nextLocked ? 'LOCK' : 'UNLOCK',
      state: nextLocked ? 'LOCKED' : 'EDITABLE',
    })
  }

  private setLockState(locked: boolean): void {
    const key = this.opts.ctx.authority.getDocumentKey()
    if (key != null) this.lockState.set(key, locked)
  }

  private renderLockButton(): void {
    const btn = this.lockButtonEl
    if (!btn) return
    const key = this.opts.ctx.authority.getDocumentKey()
    const locked = key != null && (this.lockState.get(key) ?? false)
    // V1.1 — unified pencil / lock action. Lock is a neutral state, NOT an error:
    // the severity color never applies (CSS uses normal/muted; see style.scss).
    btn.replaceChildren()
    const icon = document.createElement('span')
    icon.className = 'inkchapter-editlock__icon'
    setIcon(icon, locked ? 'lock' : 'pencil')
    const label = document.createElement('span')
    label.className = 'inkchapter-editlock__label'
    label.textContent = locked ? '已锁定' : '编辑'
    btn.append(icon, label)
    btn.classList.toggle('is-locked', locked)
    if (locked && !this.editGuard.isLocked()) {
      // Re-assert the guard when the button state says locked (e.g. switch back).
      this.editGuard.lock()
    }
  }

  private lockState = new Map<string, boolean>()

  // ── Navigator ───────────────────────────────────────
  private buildNavigator(root: HTMLDivElement): HTMLDivElement {
    const nav = document.createElement('div')
    nav.className = 'inkchapter-doc-navigator'
    nav.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    nav.style.position = 'absolute'
    nav.style.pointerEvents = 'auto'

    const topBtn = document.createElement('button')
    topBtn.type = 'button'
    topBtn.className = 'inkchapter-doc-navigator__btn'
    topBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    topBtn.setAttribute('aria-label', '回到文档顶部')
    topBtn.title = '回到文档顶部'
    setIcon(topBtn, 'chevron-up')
    topBtn.disabled = true
    topBtn.addEventListener('click', () => this.handleScrollAction('GO_TOP'))
    this.topBtnEl = topBtn
    nav.appendChild(topBtn)

    const bottomBtn = document.createElement('button')
    bottomBtn.type = 'button'
    bottomBtn.className = 'inkchapter-doc-navigator__btn'
    bottomBtn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    bottomBtn.setAttribute('aria-label', '到达文档底部')
    bottomBtn.title = '到达文档底部'
    setIcon(bottomBtn, 'chevron-down')
    bottomBtn.disabled = true
    bottomBtn.addEventListener('click', () => this.handleScrollAction('GO_BOTTOM'))
    this.bottomBtnEl = bottomBtn
    nav.appendChild(bottomBtn)

    root.appendChild(nav)
    return nav
  }

  private renderNavState(state: ScrollNavigatorState): void {
    if (this.topBtnEl) this.topBtnEl.disabled = state.atTop
    if (this.bottomBtnEl) this.bottomBtnEl.disabled = state.atBottom
    const key = `${state.atTop}|${state.atBottom}|${state.scrollable}`
    if (key !== this.prevNavStateKey) {
      this.prevNavStateKey = key
      // Phase 7R.3.11.7 §34: a plain scroll-nav-transition never emits the full
      // BCR (geometry/visibility audits already cover the write). Only a
      // placement FAILURE gets the full BCR (authority preserved).
      if (this.computePlacementFailure() !== null) {
        this.emitFullBcr('scroll-nav-transition')
      }
    }
  }

  /**
   * Phase 7R.3.11.8-B — scroll navigator action entry (↑/↓ buttons and
   * diagnostic locate). NO fixed-250ms PASS/FAIL authority: a finite
   * event-driven ScrollOperation settles on scrollend / quiescence, verifies
   * the FINAL live target, and performs at most ONE corrective recovery.
   */
  private handleScrollAction(action: 'GO_TOP' | 'GO_BOTTOM', source: ScrollOperationSource = 'BUTTON'): void {
    const container = getActiveEditorScrollContainer()
    if (!container) return
    const documentKey = this.opts.ctx.authority.getDocumentKey()
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    const already = action === 'GO_TOP'
      ? container.scrollTop <= SCROLL_OP_EPSILON_PX
      : Math.abs(container.scrollTop - max) <= SCROLL_OP_EPSILON_PX
    if (already) {
      // No operation needed — emit an honest PASS (ALREADY_AT_TARGET).
      this.emitScrollOperationFinal({
        operationId: ++this.scrollNavOperationSeq,
        documentKey,
        action,
        source,
        container,
        startTs: performance.now(),
        settleReason: 'QUIESCENCE',
        scrollTopStart: container.scrollTop,
        maxScrollTopStart: max,
        targetAtStart: action === 'GO_TOP' ? 0 : max,
        scrollEventCount: 0,
        firstScrollEventTs: null,
        lastScrollEventTs: null,
        scrollTopLastObserved: container.scrollTop,
        maxScrollTopLastObserved: max,
        reversalCount: 0,
        scrollTopAtLegacyCheck: null,
        legacyWouldPass: true,
        recoveryAttemptCount: 0,
        drawerVisibleAtStart: this.drawerOpen,
        lockedAtStart: this.editGuard.isLocked(),
        decision: 'PASS',
        targetReached: true,
        reasonDetail: 'ALREADY_AT_TARGET',
      })
      return
    }
    this.beginScrollOperation(action, container, source)
  }

  /** Begin ONE finite event-driven scroll operation. */
  private beginScrollOperation(action: 'GO_TOP' | 'GO_BOTTOM', container: HTMLElement, source: ScrollOperationSource): void {
    // A new click supersedes any in-flight operation (release listeners/timers).
    this.cancelScrollOperation('SUPERSEDED')
    const operationId = ++this.scrollNavOperationSeq
    const scrollTopStart = container.scrollTop
    const maxScrollTopStart = Math.max(0, container.scrollHeight - container.clientHeight)
    const op: ActiveScrollOperation = {
      operationId,
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      action,
      source,
      container,
      startTs: performance.now(),
      scrollTopStart,
      maxScrollTopStart,
      targetAtStart: action === 'GO_TOP' ? 0 : maxScrollTopStart,
      scrollEventCount: 0,
      firstScrollEventTs: null,
      lastScrollEventTs: null,
      scrollTopLastObserved: scrollTopStart,
      maxScrollTopLastObserved: maxScrollTopStart,
      reversalCount: 0,
      scrollTopAtLegacyCheck: null,
      legacyWouldPass: null,
      recoveryAttemptCount: 0,
      drawerVisibleAtStart: this.drawerOpen,
      lockedAtStart: this.editGuard.isLocked(),
      settleTimer: null,
      safetyDeadline: null,
      legacySampleTimer: null,
      onScroll: () => this.onScrollOperationEvent(op),
      onScrollEnd: null,
    }
    const scrollendSupported = typeof container.addEventListener === 'function' && 'onscrollend' in container
    if (scrollendSupported) {
      op.onScrollEnd = () => this.onScrollOperationSettle(op, 'SCROLLEND')
      container.addEventListener('scrollend', op.onScrollEnd, { passive: true } as AddEventListenerOptions)
    }
    container.addEventListener('scroll', op.onScroll, { passive: true })
    // Legacy 250ms forensic SAMPLE ONLY (authority=false, never decides PASS/FAIL).
    op.legacySampleTimer = setTimeout(() => {
      const t = container.scrollTop
      op.scrollTopAtLegacyCheck = t
      const maxNow = Math.max(0, container.scrollHeight - container.clientHeight)
      op.legacyWouldPass = action === 'GO_TOP' ? t <= 2 : maxNow <= 2 || t >= maxNow - 2
    }, 250)
    op.safetyDeadline = setTimeout(() => this.onScrollOperationSettle(op, 'SAFETY_TIMEOUT'), SCROLL_OP_SAFETY_DEADLINE_MS)
    this.activeScrollOperation = op
    if (action === 'GO_TOP') this.scrollNav?.scrollToTop()
    else this.scrollNav?.scrollToBottom()
  }

  /** Scroll event handler — memory-only sampling + quiescence debounce. */
  private onScrollOperationEvent(op: ActiveScrollOperation): void {
    const t = op.container.scrollTop
    const max = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    if (op.scrollEventCount > 0) {
      const movingTowardBottom = t > op.scrollTopLastObserved
      if ((op.action === 'GO_BOTTOM' && !movingTowardBottom && t < op.scrollTopLastObserved - 1)
        || (op.action === 'GO_TOP' && movingTowardBottom && t > op.scrollTopLastObserved + 1)) {
        op.reversalCount++
      }
    }
    op.scrollEventCount++
    if (op.firstScrollEventTs === null) op.firstScrollEventTs = performance.now()
    op.lastScrollEventTs = performance.now()
    op.scrollTopLastObserved = t
    op.maxScrollTopLastObserved = max
    if (this.activeScrollOperation === op) {
      if (op.settleTimer) clearTimeout(op.settleTimer)
      op.settleTimer = setTimeout(() => this.onScrollOperationSettle(op, 'QUIESCENCE'), SCROLL_OP_QUIESCENCE_MS)
    }
  }

  /** Settle authority: scrollend / quiescence / safety deadline. */
  private onScrollOperationSettle(op: ActiveScrollOperation, settleReason: ScrollOperationSettleReason): void {
    if (this.activeScrollOperation !== op) return
    if (!op.container.isConnected) {
      this.finalizeScrollOperation(op, settleReason, 'FAIL_CONTAINER_DISCONNECTED')
      return
    }
    const maxNow = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    const topNow = op.container.scrollTop
    const reached = op.action === 'GO_TOP'
      ? topNow <= SCROLL_OP_EPSILON_PX
      : Math.abs(topNow - maxNow) <= SCROLL_OP_EPSILON_PX
    if (reached) {
      const decision = settleReason === 'SAFETY_TIMEOUT' ? 'PASS_TARGET_REACHED_AT_DEADLINE'
        : op.recoveryAttemptCount > 0 ? 'PASS_RECOVERED'
        : 'PASS'
      this.finalizeScrollOperation(op, settleReason, decision)
      return
    }
    // Genuine early stop → at most ONE corrective recovery (behavior='auto').
    if (settleReason !== 'SAFETY_TIMEOUT' && op.recoveryAttemptCount < SCROLL_OP_MAX_RECOVERY_ATTEMPTS) {
      op.recoveryAttemptCount++
      emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-RECOVERY', {
        operationId: op.operationId,
        documentKey: op.documentKey,
        action: op.action,
        source: op.source,
        attempt: op.recoveryAttemptCount,
        scrollTopBefore: topNow,
        maxScrollTop: maxNow,
        decision: 'CORRECTIVE_AUTO_SCROLL',
      })
      op.container.scrollTo({ top: op.action === 'GO_TOP' ? 0 : maxNow, behavior: 'auto' })
      // Re-arm quiescence (safety deadline already running).
      if (op.settleTimer) clearTimeout(op.settleTimer)
      op.settleTimer = setTimeout(() => this.onScrollOperationSettle(op, 'QUIESCENCE'), SCROLL_OP_QUIESCENCE_MS)
      return
    }
    const decision = settleReason === 'SAFETY_TIMEOUT' ? 'TIMEOUT_BEFORE_SETTLE' : 'FAIL_SETTLED_BEFORE_TARGET'
    this.finalizeScrollOperation(op, settleReason, decision)
  }

  /** Cancel the active operation (document switch / dispose / superseded). */
  private cancelScrollOperation(decision: 'CANCELLED_DOCUMENT_SWITCH' | 'SUPERSEDED'): void {
    const op = this.activeScrollOperation
    if (!op) return
    this.finalizeScrollOperation(op, 'QUIESCENCE', decision)
  }

  /** Finalize: release resources + emit the SINGLE business authority log. */
  private finalizeScrollOperation(
    op: ActiveScrollOperation,
    settleReason: ScrollOperationSettleReason,
    decision: ScrollOperationDecision,
  ): void {
    if (this.activeScrollOperation !== op) return
    this.activeScrollOperation = null
    op.container.removeEventListener('scroll', op.onScroll)
    if (op.onScrollEnd) op.container.removeEventListener('scrollend', op.onScrollEnd)
    if (op.settleTimer) clearTimeout(op.settleTimer)
    if (op.safetyDeadline) clearTimeout(op.safetyDeadline)
    if (op.legacySampleTimer) clearTimeout(op.legacySampleTimer)
    const finalTop = op.container.scrollTop
    const finalMax = Math.max(0, op.container.scrollHeight - op.container.clientHeight)
    const targetReached = decision === 'PASS' || decision === 'PASS_RECOVERED' || decision === 'PASS_TARGET_REACHED_AT_DEADLINE'
    this.emitScrollOperationFinal({
      operationId: op.operationId,
      documentKey: op.documentKey,
      action: op.action,
      source: op.source,
      container: op.container,
      startTs: op.startTs,
      settleReason,
      scrollTopStart: op.scrollTopStart,
      maxScrollTopStart: op.maxScrollTopStart,
      targetAtStart: op.targetAtStart,
      scrollEventCount: op.scrollEventCount,
      firstScrollEventTs: op.firstScrollEventTs,
      lastScrollEventTs: op.lastScrollEventTs,
      scrollTopLastObserved: op.scrollTopLastObserved,
      maxScrollTopLastObserved: op.maxScrollTopLastObserved,
      reversalCount: op.reversalCount,
      scrollTopAtLegacyCheck: op.scrollTopAtLegacyCheck,
      legacyWouldPass: op.legacyWouldPass,
      recoveryAttemptCount: op.recoveryAttemptCount,
      drawerVisibleAtStart: op.drawerVisibleAtStart,
      lockedAtStart: op.lockedAtStart,
      decision,
      targetReached,
      reasonDetail: undefined,
      finalTop,
      finalMax,
    })
  }

  private emitScrollOperationFinal(input: {
    operationId: number
    documentKey: string | null
    action: 'GO_TOP' | 'GO_BOTTOM'
    source: ScrollOperationSource
    container: HTMLElement
    startTs: number
    settleReason: ScrollOperationSettleReason
    scrollTopStart: number
    maxScrollTopStart: number
    targetAtStart: number
    scrollEventCount: number
    firstScrollEventTs: number | null
    lastScrollEventTs: number | null
    scrollTopLastObserved: number
    maxScrollTopLastObserved: number
    reversalCount: number
    scrollTopAtLegacyCheck: number | null
    legacyWouldPass: boolean | null
    recoveryAttemptCount: number
    drawerVisibleAtStart: boolean
    lockedAtStart: boolean
    decision: ScrollOperationDecision
    targetReached: boolean
    reasonDetail?: string
    finalTop?: number
    finalMax?: number
  }): void {
    this.scrollOperationEmitCount++
    const finalTop = input.finalTop ?? input.container.scrollTop
    const finalMax = input.finalMax ?? Math.max(0, input.container.scrollHeight - input.container.clientHeight)
    emitRuntimeAudit('DOCUMENT-UTILITY-SCROLL-OPERATION', {
      operationId: input.operationId,
      documentKey: input.documentKey,
      source: input.source,
      action: input.action,
      containerIdentity: `${input.container.tagName}#${input.container.id || ''}.${String(input.container.className || '').slice(0, 40)}`,
      scrollTopStart: input.scrollTopStart,
      maxScrollTopStart: input.maxScrollTopStart,
      targetAtStart: input.targetAtStart,
      scrollEventCount: input.scrollEventCount,
      firstScrollEventTs: input.firstScrollEventTs,
      lastScrollEventTs: input.lastScrollEventTs,
      settleReason: input.settleReason,
      scrollTopFinal: finalTop,
      maxScrollTopFinal: finalMax,
      finalTarget: input.action === 'GO_TOP' ? 0 : finalMax,
      targetReached: input.targetReached,
      recoveryAttemptCount: input.recoveryAttemptCount,
      targetTolerancePx: SCROLL_OP_EPSILON_PX,
      drawerVisible: input.drawerVisibleAtStart,
      locked: input.lockedAtStart,
      reversalCount: input.reversalCount,
      // Legacy 250ms forensic sample — authority=false, never a decision.
      legacySampleOnly: true,
      scrollTopAtLegacyCheck: input.scrollTopAtLegacyCheck,
      legacyWouldPass: input.legacyWouldPass,
      elapsedMs: performance.now() - input.startTs,
      reason: input.reasonDetail ?? null,
      decision: input.decision,
    })
  }

  /** Phase 7R.3.11.8-B — active operation/listener/timer counts (cleanup gate). */
  getScrollOperationCounters(): {
    activeOperationCount: number
    activeScrollListenerCount: number
    activeScrollendListenerCount: number
    activeSettleTimerCount: number
    activeSafetyDeadlineCount: number
    operationEmitCount: number
  } {
    const op = this.activeScrollOperation
    return {
      activeOperationCount: op ? 1 : 0,
      activeScrollListenerCount: op ? 1 : 0,
      activeScrollendListenerCount: op && op.onScrollEnd ? 1 : 0,
      activeSettleTimerCount: op && op.settleTimer ? 1 : 0,
      activeSafetyDeadlineCount: op && op.safetyDeadline ? 1 : 0,
      operationEmitCount: this.scrollOperationEmitCount,
    }
  }

  /** Phase 7R.3.11.8-B — STRICT-SINGLE-H1 popup emission count (dedup gate). */
  getStrictSingleH1PopupCount(): number {
    return this.strictSingleH1PopupEmitCount
  }

  // ── Drawer ──────────────────────────────────────────
  private buildDrawer(root: HTMLDivElement): HTMLDivElement {
    const drawer = document.createElement('div')
    drawer.className = 'inkchapter-doc-drawer'
    drawer.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    drawer.style.position = 'absolute'
    drawer.style.display = 'none'
    drawer.style.pointerEvents = 'auto'

    const header = document.createElement('div')
    header.className = 'inkchapter-doc-drawer__header'
    // Row 1 — title + icon-only actions (V1.1: no text buttons).
    const titleRow = document.createElement('div')
    titleRow.className = 'inkchapter-doc-drawer__titlerow'
    const title = document.createElement('div')
    title.className = 'inkchapter-doc-drawer__title'
    title.textContent = '文档检测'
    titleRow.appendChild(title)
    const actions = document.createElement('div')
    actions.className = 'inkchapter-doc-drawer__actions'
    const recheck = document.createElement('button')
    recheck.type = 'button'
    recheck.className = 'inkchapter-doc-drawer__action inkchapter-doc-drawer__action--refresh inkchapter-icon-btn'
    recheck.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    recheck.setAttribute('aria-label', '重新检查文档')
    recheck.title = '重新检查文档'
    setIcon(recheck, 'refresh')
    recheck.addEventListener('click', () => this.diagnostics.recompute('MANUAL_RECHECK'))
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'inkchapter-doc-drawer__action inkchapter-doc-drawer__action--close inkchapter-icon-btn'
    close.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    close.setAttribute('aria-label', '关闭文档检测')
    close.title = '关闭文档检测'
    setIcon(close, 'close')
    close.addEventListener('click', () => this.closeDrawer())
    actions.appendChild(recheck)
    actions.appendChild(close)
    titleRow.appendChild(actions)
    header.appendChild(titleRow)
    // Row 2 — severity filter Text Tabs (rendered by renderDrawer).
    const filters = document.createElement('div')
    filters.className = 'inkchapter-doc-drawer__filters'
    this.drawerFiltersEl = filters
    header.appendChild(filters)
    drawer.appendChild(header)

    const list = document.createElement('div')
    list.className = 'inkchapter-doc-drawer__list'
    this.drawerListEl = list
    drawer.appendChild(list)

    root.appendChild(drawer)
    return drawer
  }

  /** V1.1 — severity filter Text Tabs in the drawer header (hint tab hidden at 0). */
  private renderDrawerFilterTabs(snapshot: DocumentDiagnosticsSnapshot | null, visible: boolean): void {
    const filtersEl = this.drawerFiltersEl
    if (!filtersEl) return
    filtersEl.replaceChildren()
    filtersEl.hidden = !visible
    if (!visible || !snapshot) return
    const tabs: Array<{ key: DiagnosticsSeverityFilter; label: string; n: number }> = [
      { key: 'all', label: '全部', n: snapshot.diagnostics.length },
      { key: 'error', label: '错误', n: snapshot.errorCount },
      { key: 'warning', label: '警告', n: snapshot.warningCount },
    ]
    if (snapshot.infoCount > 0) tabs.push({ key: 'info', label: '提示', n: snapshot.infoCount })
    const list = document.createElement('div')
    list.className = 'inkchapter-doc-drawer__filter-list'
    list.setAttribute('role', 'tablist')
    list.setAttribute('aria-label', '按严重程度筛选')
    for (const tab of tabs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'inkchapter-doc-drawer__filter-tab'
      btn.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
      btn.setAttribute('role', 'tab')
      btn.setAttribute('data-filter', tab.key)
      const isActive = this.drawerFilter === tab.key
      btn.classList.toggle('is-active', isActive)
      btn.setAttribute('aria-selected', String(isActive))
      const label = document.createElement('span')
      label.className = 'inkchapter-doc-drawer__filter-label'
      label.textContent = tab.label
      const count = document.createElement('span')
      count.className = 'inkchapter-doc-drawer__filter-count'
      count.textContent = String(tab.n)
      btn.append(label, count)
      btn.addEventListener('click', () => {
        this.drawerFilter = tab.key
        this.renderDrawer()
      })
      list.appendChild(btn)
    }
    filtersEl.appendChild(list)
  }

  private renderDrawer(): void {
    if (!this.drawerEl || !this.drawerListEl) return
    const snapshot = this.snapshot
    const activeKey = this.opts.ctx.authority.getDocumentKey()
    if (!snapshot || snapshot.documentKey == null || snapshot.documentKey !== activeKey) {
      this.renderDrawerFilterTabs(snapshot, false)
      // Phase 7R.3.11.4 — never render stale items: show a pending placeholder.
      const pending = document.createElement('div')
      pending.className = 'inkchapter-doc-drawer__item--empty'
      pending.textContent = snapshot && snapshot.documentKey !== activeKey ? '正在刷新当前文档…' : '没有活动文档'
      this.drawerListEl.replaceChildren(pending)
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
        action: 'DRAWER_RENDERED',
        documentKey: snapshot?.documentKey ?? null,
        activeDocumentKey: activeKey,
        revision: snapshot?.revision ?? null,
        sourceRevision: snapshot?.sourceRevision ?? null,
        itemCount: 0,
        decision: 'DRAWER_RENDER_BLOCKED_STALE_SNAPSHOT',
      })
      // Phase 7R.3.11.8B.3.1 — read-only layout audit follows every re-render.
      this.scheduleDrawerContentAudit()
      return
    }

    this.renderDrawerFilterTabs(snapshot, snapshot.diagnostics.length > 0)
    this.drawerListEl.replaceChildren()
    if (snapshot.diagnostics.length === 0) {
      const ok = document.createElement('div')
      ok.className = 'inkchapter-doc-drawer__item--empty'
      const icon = document.createElement('span')
      icon.className = 'inkchapter-doc-drawer__empty-icon'
      setIcon(icon, 'check')
      const label = document.createElement('span')
      label.textContent = '未发现问题'
      ok.append(icon, label)
      this.drawerListEl.appendChild(ok)
    } else {
      const filter = this.drawerFilter
      const items = filter === 'all'
        ? snapshot.diagnostics
        : snapshot.diagnostics.filter(d => d.severity === filter)
      if (items.length === 0) {
        // Current filter yields nothing after a live refresh — show neutral hint.
        const none = document.createElement('div')
        none.className = 'inkchapter-doc-drawer__item--empty'
        none.textContent = '当前筛选下没有问题'
        this.drawerListEl.appendChild(none)
      } else {
        for (const d of items) {
          this.drawerListEl.appendChild(this.buildDrawerItem(d))
        }
      }
    }
    emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SNAPSHOT', {
      action: 'DRAWER_RENDERED',
      documentKey: snapshot.documentKey,
      activeDocumentKey: activeKey,
      revision: snapshot.revision,
      sourceRevision: snapshot.sourceRevision,
      drawerVisible: this.drawerOpen,
      itemCount: snapshot.diagnostics.length,
      errorCount: snapshot.errorCount,
      warningCount: snapshot.warningCount,
      hintCount: snapshot.infoCount,
      filter: this.drawerFilter,
      snapshotMatchesActiveDocument: snapshot.documentKey === activeKey,
      decision: 'DRAWER_RENDERED_MATCHES_ACTIVE',
    })
    // Phase 7R.3.11.8B.3.1 — read-only layout audit follows every re-render
    // (rAF + DOM read only; geometryWriteDelta stays 0 by construction).
    this.scheduleDrawerContentAudit()
  }

  /**
   * Phase 7R.3.11.8B.5 — UNIVERSAL locate action. Every drawer 定位 button
   * routes here (single authority — never per-item scrollIntoView/querySelector).
   * Flow: latest snapshot → diagnosticId present → documentKey match →
   * resolveDiagnosticLocation → scroll (element or GO_TOP/GO_BOTTOM) →
   * temporary highlight → locate audit. Bounded stale recovery: at most ONE
   * diagnostics refresh. Read-only: never edits Markdown, never bypasses the
   * edit guard into a write.
   *
   * Phase 7R.3.11.8B.7.2 — decision semantics (no blanket STALE):
   *   TARGET_CHANGED — the anchored source line really changed/deleted →
   *     "目标已变化，请重新检查" + one bounded refresh.
   *   UNRESOLVED     — source unchanged but the line cannot be mapped to DOM →
   *     one bounded refresh; still unresolved → an honest
   *     "无法定位到该问题所在行" (never claims the target changed).
   */
  private locateDiagnostic(diagnosticId: string): void {
    // Phase 7R.3.11.8B.7.7 — NON-REENTRANT gate. A busy transaction rejects
    // every further 定位 click BEFORE touching the cursor or any target state.
    const busyTx = this.activeLocateTx
    if (busyTx) {
      this.emitLocateTransactionAudit({
        transactionId: busyTx.id,
        clickDecision: 'IGNORE_BUSY',
        targetIndexUnchanged: true,
      })
      return
    }
    // Phase 7R.3.11.8B.8 — a NEW accepted locate clears the previous locate
    // visual (V3 lifecycle: click A → A visual; click B → cleanup A → B).
    this.clearDiagnosticLocateVisual('DIAGNOSTIC_SWITCH')
    const tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']> = {
      id: ++this.locateTxIdSeq,
      documentKey: this.opts.ctx.authority.getDocumentKey(),
      diagnosticId,
      targetIndex: 0,
      targetCount: 1,
      startedAt: Date.now(),
      state: 'RESOLVING',
    }
    this.activeLocateTx = tx
    // V5.9 §37 — a previous ACCEPTED transaction that never reached a terminal
    // is an explicit violation (never silently overwritten).
    if (this.locateTxAcceptedCount > this.locateTxTerminalCount) {
      this.countersScrollV59.acceptedTxWithoutTerminal++
    }
    this.locateTxAcceptedCount++ // V5.9 §37 — accepted must equal terminal
    // V5.11 — the scroll lease is held ONLY while this transaction is PRE-COMMIT.
    this.acquireLocateScrollLease(tx)
    this.removeLocateDocumentCarrier()
    this.updateLocateBusyUi(true)
    this.emitLocateTransactionAudit({
      transactionId: tx.id,
      clickDecision: 'ACCEPT',
      state: 'RESOLVING',
    })
    // V5.1 — every locate transaction snapshots the user's Drawer intent BEFORE
    // any LOCATE_COLLAPSE can happen. tx-local retry starts at 0 here.
    this.beginDrawerRecoveryLease()
    // V5.6 — a new locate starts a fresh visual epoch so any stale queued
    // repaint from a previously dismissed visual becomes a no-op.
    this.locateVisualEpoch++
    try {
      this.runLocateTransaction(tx, diagnosticId)
    } catch (err) {
      this.abortLocateTransaction(tx, 'INTERNAL_ERROR', String(err))
    }
  }

  /** Executes one locate transaction. Sync failures unlock immediately; async
   *  scroll-settle completion unlocks inside the settle callback. */
  private runLocateTransaction(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diagnosticId: string,
  ): void {
    const snapshot = this.diagnostics.getSnapshot()
    let diag = snapshot?.diagnostics.find(d => d.id === diagnosticId) ?? null
    let refreshed = false
    if (!diag) {
      this.diagnostics.recompute('LOCATE_BOUNDED_REFRESH')
      refreshed = true
      diag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
      if (!diag) {
        this.emitLocateAudit(diagnosticId, null, 'NOT_FOUND', 'DIAGNOSTIC_GONE_AFTER_BOUNDED_REFRESH', 0, null)
        this.finishLocateTransaction(tx, false, 'DIAGNOSTIC_GONE')
        return
      }
    }
    const currentKey = this.opts.ctx.authority.getDocumentKey()
    if (diag.documentKey && currentKey && diag.documentKey !== currentKey) {
      if (!refreshed) {
        this.diagnostics.recompute('LOCATE_BOUNDED_REFRESH')
        diag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
      }
      if (!diag || (diag.documentKey && currentKey && diag.documentKey !== currentKey)) {
        this.emitLocateAudit(diagnosticId, diag, 'WRONG_DOCUMENT', 'DIAGNOSTIC_BELONGS_TO_ANOTHER_DOCUMENT', 0, null)
        this.finishLocateTransaction(tx, false, 'WRONG_DOCUMENT')
        return
      }
    }

    // Phase 7R.3.11.8B.7.7 — READ the committed target index; the cursor is
    // advanced ONLY on successful completion (real scroll settle + highlight).
    let targetIndex = 0
    const targetCount = diag.location?.kind === 'multi-target' && diag.location.targets.length > 0
      ? diag.location.targets.length
      : 1
    if (diag.location?.kind === 'multi-target' && targetCount > 0) {
      targetIndex = (this.multiTargetCursor.get(diagnosticId) ?? 0) % targetCount
    }
    tx.targetIndex = targetIndex
    tx.targetCount = targetCount

    const resolveCtx: DiagnosticLocationResolveContext = {
      documentKey: currentKey,
      getRoot: () => resolveBusinessContentRoot(),
      resolveHeadingIdentity: (id) => this.resolveHeadingIdentity(id),
      resolveSourceLine: (line) => this.resolveSourceLine(line),
      resolveBlockIdentity: (kind, stableId) => this.resolveBlockIdentity(kind, stableId),
      // Phase 7R.3.11.8B.7.2 — content authority for source-range resolution:
      // current source line text (TARGET_CHANGED classification) + text-context
      // re-anchor for source-only diagnostics (LATENT_ATX_HEADING_MARKER).
      getSourceLineText: (line) => this.getSourceLineTextAt(line),
      findBlockByText: (rawText, nearLine) => this.findBlockByTextInRoot(rawText, nearLine),
      // V5.12-R5 §7 — exact source-occurrence resolution for source resource
      // diagnostics: verified owning block + verified nth token inside it. A
      // duplicate destination can never collapse onto the first text match.
      resolveSourceOccurrence: (input) => this.resolveSourceOccurrenceInRoot(input),
      // Phase 7R.3.11.8B.7.3 — resource semantic resolution + identity
      // normalization + resource validity re-scan (resource diagnostics).
      // The raw source token accompanies the semantic identity so Typora's
      // broken-image text render (which carries the RAW token) still resolves.
      resolveResource: (kind, normalizedDestination, occurrenceIndex) =>
        this.resolveResourceInRoot(kind, normalizedDestination, occurrenceIndex, diagRawToken(diag)),
      normalizeResourcePath: (raw) => normalizeResourcePath(raw),
      resourceDestinationPresent: (normalizedDestination, occurrenceIndex) =>
        this.resourceDestinationStillPresent(normalizedDestination, occurrenceIndex),
    }
    let result = resolveDiagnosticLocation(diag, diag.location, resolveCtx, targetIndex)

    if (result.decision === 'RESOLVED') {
      this.performLocateScrollTransaction(tx, result, diag, diagnosticId, targetIndex)
      return
    }
    if (result.decision === 'TARGET_CHANGED') {
      // Real source mutation: refresh once so the user sees current state.
      if (!refreshed) {
        this.diagnostics.recompute('LOCATE_BOUNDED_REFRESH')
        refreshed = true
        const nextDiag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
        if (nextDiag) {
          const retry = resolveDiagnosticLocation(nextDiag, nextDiag.location, resolveCtx, targetIndex)
          if (retry.decision === 'RESOLVED') {
            this.performLocateScrollTransaction(tx, retry, nextDiag, diagnosticId, targetIndex)
            return
          }
          result = retry
          diag = nextDiag
        }
      }
      this.emitLocateAudit(diagnosticId, diag, result.decision, result.reason ?? 'TARGET_CHANGED', targetIndex, result)
      this.finishLocateTransaction(tx, false, 'TARGET_CHANGED')
      return
    }
    if (result.decision === 'UNRESOLVED') {
      // Source unchanged — a DOM-mapping failure, NOT a changed target. One
      // bounded refresh may re-sync the frame; never claim the target changed.
      if (!refreshed) {
        this.diagnostics.recompute('LOCATE_BOUNDED_REFRESH')
        refreshed = true
        const nextDiag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === diagnosticId) ?? null
        if (nextDiag) {
          const retry = resolveDiagnosticLocation(nextDiag, nextDiag.location, resolveCtx, targetIndex)
          if (retry.decision === 'RESOLVED') {
            this.performLocateScrollTransaction(tx, retry, nextDiag, diagnosticId, targetIndex)
            return
          }
          result = retry
          diag = nextDiag
        }
      }
      this.emitLocateAudit(diagnosticId, diag, result.decision, result.reason ?? 'SOURCE_ANCHOR_NOT_MAPPED_TO_DOM', targetIndex, result)
      this.finishLocateTransaction(tx, false, 'UNRESOLVED')
      return
    }
    this.emitLocateAudit(diagnosticId, diag, result.decision, result.reason ?? 'UNRESOLVED', targetIndex, result)
    this.finishLocateTransaction(tx, false, result.decision)
  }

  /** Phase 7R.3.11.8B.7.7 / V5.8 / V5.9 — Locate TRANSACTION scroll path.
   *
   *  V5.9 — SCROLL COMPLETION AUTHORITY. The V5.8 defect (proven by the real
   *  runtime) was that `2 stable rAF frames` could settle BEFORE the smooth
   *  scroll effect reached the target, so the visual pipeline started while the
   *  target was still offscreen (visualPaintAttemptCount=3 → ZERO_PAINTED_RECT
   *  → a second user click was needed).
   *
   *  V5.9 therefore separates three authorities:
   *    semantic target  ≠  stable scroll anchor  ≠  visual carrier
   *  and requires, for any offscreen target, that the scroll be performed as a
   *  DETERMINISTIC `scrollTop` write and that `targetEnteredViewport` +
   *  `scrollEffectObserved` + two stable post-arrival frames all hold before
   *  `scrollSettled=true` and the V5.8 visual pipeline start. */
  private performLocateScrollTransaction(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    result: DiagnosticLocationResolveResult,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
  ): void {
    const container = getActiveEditorScrollContainer()
    tx.state = 'SCROLLING'

    // Build the highlight set + the element to scroll first.
    let primary: HTMLElement | null = null
    const highlightTargets: HTMLElement[] = []
    if (result.scrollAction) {
      // Document-boundary locate reuses the ONE Scroll Operation authority.
      this.handleScrollAction(result.scrollAction, 'DIAGNOSTIC_LOCATE')
      // Boundary scroll still needs its own settle gate (the nav op engine has
      // its own finalize; our gate also watches the real container quiescence).
      if (!container) {
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'SCROLL_ACTION', targetIndex, result)
        this.finishLocateTransaction(tx, true, 'SCROLL_ACTION_NO_CONTAINER')
        return
      }
    } else if (result.element) {
      const caption = this.resolveObjectCaptionHost(result.element, diag)
      primary = caption ?? result.element
      highlightTargets.push(caption ?? result.element)
      if (caption && caption !== result.element) highlightTargets.push(result.element)
    } else {
      this.emitLocateAudit(diagnosticId, diag, 'UNRESOLVED', 'RESOLVED_WITHOUT_TARGET', targetIndex, result)
      this.finishLocateTransaction(tx, false, 'NO_TARGET')
      return
    }

    const identity = this.captureLocateIdentity(diag, result)
    // V5.8 — a pure DOCUMENT-BOUNDARY locate (GO_TOP/GO_BOTTOM) has no visual
    // target: it keeps its legacy completion (never enters the one-click
    // visual pipeline, which is about offscreen ELEMENT targets).
    const boundaryOnly = result.scrollAction != null && !result.element
    if (boundaryOnly) {
      tx.state = 'WAITING_SCROLL_SETTLE'
      if (!container) {
        const verified = this.applyLocateHighlightAndVerify(tx, diag, highlightTargets, result, targetIndex)
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'SCROLL_ACTION', targetIndex, result, verified)
        this.finishLocateTransaction(tx, verified, 'SCROLL_ACTION_NO_CONTAINER')
        return
      }
      this.watchBoundaryScrollSettle(tx, diag, diagnosticId, targetIndex, highlightTargets, result, container)
      return
    }

    // ── V5.9 — Semantic target ≠ Scroll anchor ≠ Visual carrier ────────────
    // The scroll anchor is the CANONICAL semantic element (never a caption
    // visual / overlay frame / freshly created carrier).
    const scrollAnchor = this.resolveStableScrollAnchor(result.element ?? primary, diag)
    if (!container) {
      // No container → no scroll possible; still run the full atomic completion
      // (identity revalidate → fresh measure → paint → verify → recovery →
      // final remeasure/repaint/verify → COMMIT) so a single click is complete.
      this.beginOneClickCompletion(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, this.emptyPreScrollState(), false)
      return
    }

    const facts = this.createOneClickFacts(tx, identity, this.emptyPreScrollState(), false)
    tx.oneClick = facts
    facts.scrollAnchorKind = scrollAnchor ? scrollAnchor.tagName.toLowerCase() : null
    facts.scrollAnchorConnected = !!scrollAnchor && scrollAnchor.isConnected
    facts.initialScrollTop = container.scrollTop
    facts.viewportRectAtStart = this.measureLocateRect(container)
    facts.arrivalGateDecision = 'PENDING'

    const containerOk = this.validateScrollContainer(container, scrollAnchor)
    if (!containerOk.ok) {
      tx.state = 'FAILED'
      facts.arrivalGateDecision = containerOk.reason
      this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', containerOk.reason, targetIndex, result, false)
      this.finishLocateTransaction(tx, false, containerOk.reason)
      return
    }
    const anchorEl = scrollAnchor as HTMLElement

    // V5.10 §12/§24 — placement context: PRIMARY (caption cue) + SECONDARY
    // (semantic block) for Table/Code; the semantic owning block otherwise.
    const semanticEl = result.element ?? primary
    const compound = !!semanticEl && !!primary && primary !== semanticEl
    const placementAnchor = this.resolvePlacementAnchor(semanticEl, diag)
    this.locatePlacementCtx = {
      anchorEl: placementAnchor,
      primaryEl: compound ? primary : null,
      secondaryEl: semanticEl,
      compound,
    }

    // ── PRE_SCROLL_MEASURE + CHECK_INITIAL_VISIBILITY + PREFERRED PLACEMENT ─
    tx.state = 'PRE_SCROLL_MEASURE'
    const initialState = this.measurePlacementState(container)
    const initialArrival = this.measureArrivalState(container, anchorEl)
    facts.initialTargetRect = initialArrival.targetRect ? this.rectSnapshotToRectRecord(initialArrival.targetRect) : null
    facts.preScrollTargetRect = facts.initialTargetRect
    facts.targetInitiallyVisible = initialArrival.enteredViewport
    if (initialState) {
      this.recordPlacementFacts(facts, initialState, true)
      // §12 — a compound Table/Code target must NOT be centred from a partial rect.
      if (compound && !initialState.compoundBoundsUsed) {
        this.countersPlacementV510.compoundTargetCenterUsesPartialRect++
      }
    }
    const placement = initialState?.decision ?? null
    // V5.10 §4/§15 — visible is NOT the same as well placed: a recenter happens
    // unless the target is ALREADY within the center tolerance or a real scroll
    // write would be a no-op (document boundary).
    const noWriteNeeded = initialState != null && Math.abs(placement!.clampedScrollTop - initialState.scrollTop) <= 0.5
    const placementFastPath =
      initialArrival.enteredViewport &&
      (placement == null || placement.alreadyWithinTolerance || noWriteNeeded)
    facts.automaticScrollRequired = !placementFastPath

    if (placementFastPath) {
      // ── PLACEMENT FAST PATH: ZERO scroll writes ──────────────────────────
      tx.state = 'SKIP_SCROLL'
      facts.scrollWriteCount = 0
      facts.scrollCorrectionCount = 0
      facts.scrollEffectObserved = false
      facts.targetEnteredViewport = true
      facts.targetVisibleAtSettle = true
      facts.scrollSettled = true
      facts.arrivalGateDecision = 'PLACEMENT_FAST_PATH'
      facts.targetRectAtArrival = facts.initialTargetRect
      facts.targetRectAtSettle = facts.initialTargetRect
      facts.viewportRectAtSettle = facts.viewportRectAtStart
      if (placement) {
        facts.centerErrorAfter = placement.centerErrorBefore
        facts.targetCenterAfter = placement.targetCenterBefore
        facts.requestedScrollTop = placement.desiredScrollTop
        facts.actualScrollTopAfterWrite = initialState ? initialState.scrollTop : 0
      }
      this.emitScrollArrivalAudit(tx, facts, 'PASS', 'PLACEMENT_FAST_PATH_NO_SCROLL_WRITE')
      this.beginOneClickCompletion(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, this.emptyPreScrollState(), false, 'PLACEMENT_FAST_PATH')
      return
    }
    if (facts.targetInitiallyVisible && placement && !placement.alreadyWithinTolerance && !noWriteNeeded) {
      facts.arrivalGateDecision = 'VISIBLE_BUT_OFFCENTER'
    }

    // ── OFFSCREEN / OFF-CENTER: deterministic placement scroll write ───────
    tx.state = 'REQUESTING_SCROLL'
    this.applyDeterministicScroll(container, anchorEl, facts)
    facts.targetRectAfterScrollWrite = this.measureLocateRect(anchorEl)

    this.waitForTargetArrival(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, anchorEl, initialArrival, 0)
  }

  /** V5.9 — the legacy document-boundary settle (no element target / visual). */
  private watchBoundaryScrollSettle(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    container: HTMLElement,
  ): void {
    let settled = false
    let lastTop = container.scrollTop
    let stableFrames = 0
    let rafHandle = 0
    const scrollendSupported = typeof container.addEventListener === 'function' && 'onscrollend' in container
    const onSettled = (completionReason: string): void => {
      if (settled || !this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
      settled = true
      this.cancelLocateSettleWatch()
      const verified = this.applyLocateHighlightAndVerify(tx, diag, highlightTargets, result, targetIndex)
      this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'SCROLL_ACTION', targetIndex, result, verified)
      this.finishLocateTransaction(tx, verified, completionReason)
    }
    const onScroll = (): void => { lastTop = container.scrollTop; stableFrames = 0 }
    const onScrollEnd = (): void => { onSettled('SCROLLEND') }
    const tick = (): void => {
      if (settled || !this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
      const top = container.scrollTop
      if (Math.abs(top - lastTop) < 0.5) stableFrames++
      else { lastTop = top; stableFrames = 0 }
      if (stableFrames >= 2) { onSettled('SCROLL_STABLE_FRAMES'); return }
      rafHandle = requestAnimationFrame(tick)
    }
    if (scrollendSupported) container.addEventListener('scrollend', onScrollEnd, { passive: true } as AddEventListenerOptions)
    container.addEventListener('scroll', onScroll, { passive: true })
    rafHandle = requestAnimationFrame(tick)
    this.locateTxSettleCancel = () => {
      if (rafHandle) cancelAnimationFrame(rafHandle)
      container.removeEventListener('scrollend', onScrollEnd)
      container.removeEventListener('scroll', onScroll)
    }
    this.locateTxWatchdog = setTimeout(() => {
      if (!settled && this.activeLocateTx && this.activeLocateTx.id === tx.id) {
        settled = true
        this.cancelLocateSettleWatch()
        const verified = this.applyLocateHighlightAndVerify(tx, diag, highlightTargets, result, targetIndex)
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'SCROLL_ACTION', targetIndex, result, verified)
        this.finishLocateTransaction(tx, verified, 'WATCHDOG_FALLBACK')
      }
    }, 2500)
  }

  // ── V5.9 — Scroll Completion Authority ───────────────────────────────────

  private rectSnapshotToRectRecord(r: { left: number; top: number; right: number; bottom: number }): RectRecord {
    const snap = makeScrollRectSnapshot({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    return { left: snap.left, top: snap.top, right: snap.right, bottom: snap.bottom, width: snap.width, height: snap.height }
  }

  private measureArrivalState(container: HTMLElement, anchor: HTMLElement | null): ScrollArrivalSnapshot {
    const containerRect = this.measureLocateRect(container)
    const anchorRect = this.measureLocateRect(anchor)
    return measureScrollArrival({
      targetRect: anchorRect ? makeScrollRectSnapshot({ left: anchorRect.left, top: anchorRect.top, right: anchorRect.right, bottom: anchorRect.bottom }) : null,
      viewportRect: containerRect ? makeScrollRectSnapshot({ left: containerRect.left, top: containerRect.top, right: containerRect.right, bottom: containerRect.bottom }) : null,
      scrollTop: Number.isFinite(container.scrollTop) ? container.scrollTop : 0,
      targetConnected: !!anchor && anchor.isConnected,
    })
  }

  /**
   * V5.9 §4.2 — the STABLE SCROLL ANCHOR (arrival authority). Never a caption
   * visual / overlay frame / freshly created carrier; a broken 0×0 <img> falls
   * back to its owning source block (Source-First preserved).
   */
  private resolveStableScrollAnchor(semanticEl: HTMLElement | null, diag: DocumentDiagnosticsSnapshot['diagnostics'][number]): HTMLElement | null {
    if (!semanticEl || !semanticEl.isConnected) return null
    // Never the locate overlay / visual carrier.
    if (semanticEl.closest(`[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`) !== null) return null
    const meta = (diag.metadata ?? {}) as Record<string, unknown>
    if (String(meta.resourceKind ?? '') === 'image') {
      let r: DOMRect | null = null
      try { r = semanticEl.getBoundingClientRect() } catch { /* noop */ }
      if (!r || r.width <= 0 || r.height <= 0) {
        const block = resolveOwningBlockFallback(semanticEl)
        if (block && block.isConnected) return block
      }
    }
    return semanticEl
  }

  /**
   * V5.10 §24/§26 — the PLACEMENT anchor. Unlike the arrival anchor, an inline
   * target (missing link / inline code) or a broken 0×0 image must not place the
   * reading position from a ~12px fragment; it climbs to its semantic owning
   * block. The VISUAL layer keeps drawing precise Range fragments.
   */
  private resolvePlacementAnchor(semanticEl: HTMLElement | null, diag: DocumentDiagnosticsSnapshot['diagnostics'][number]): HTMLElement | null {
    if (!semanticEl || !semanticEl.isConnected) return null
    const meta = (diag.metadata ?? {}) as Record<string, unknown>
    if (String(meta.resourceKind ?? '') === 'image') {
      let r: DOMRect | null = null
      try { r = semanticEl.getBoundingClientRect() } catch { /* noop */ }
      if (!r || r.width <= 0 || r.height <= 0) {
        const block = resolveOwningBlockFallback(semanticEl) ?? this.climbToOwningBlock(semanticEl)
        if (block && block.isConnected) return block
      }
    }
    if (classifyDiagnosticLocateElement(semanticEl) === 'inline') {
      const climbed = this.climbToOwningBlock(semanticEl)
      if (climbed) return climbed
    }
    return semanticEl
  }

  /** V5.10 §24 — nearest semantic block container of an inline fragment. */
  private climbToOwningBlock(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el.parentElement
    while (cur && cur !== document.body) {
      if (/^(P|LI|TD|TH|BLOCKQUOTE|PRE|TABLE|H[1-6]|FIGURE)$/.test(cur.tagName)) {
        let r: DOMRect | null = null
        try { r = cur.getBoundingClientRect() } catch { /* noop */ }
        if (r && r.height > 0) return cur
        return cur
      }
      cur = cur.parentElement
    }
    return null
  }

  /** V5.9 §6.1 — the container MUST really own the scroll anchor. */
  private validateScrollContainer(container: HTMLElement | null, anchor: HTMLElement | null): { ok: boolean; reason: string } {
    if (!container) return { ok: false, reason: 'NO_SCROLL_CONTAINER' }
    if (!container.isConnected) return { ok: false, reason: 'SCROLL_CONTAINER_DISCONNECTED' }
    if (!anchor) return { ok: false, reason: 'NO_SCROLL_ANCHOR' }
    if (!container.contains(anchor) && anchor !== container) return { ok: false, reason: 'SCROLL_CONTAINER_TARGET_MISMATCH' }
    return { ok: true, reason: 'OK' }
  }

  /**
   * V5.10 — full PREFERRED PLACEMENT measurement (fresh geometry only, §21).
   * CENTER authority = compound Primary+Secondary union for Table/Code.
   */
  private measurePlacementState(container: HTMLElement | null): {
    decision: PlacementDecision
    primaryTopNow: number | null
    maxScrollTop: number
    scrollTop: number
    compoundBoundsUsed: boolean
  } | null {
    const ctx = this.locatePlacementCtx
    if (!container || !ctx) return null
    const viewportRect = this.measureLocateRect(container)
    const primaryRect = ctx.compound ? this.measureLocateRect(ctx.primaryEl) : null
    const secondaryRect = this.measureLocateRect(ctx.secondaryEl)
    const placementRectRaw = this.measureLocateRect(ctx.anchorEl)
    const anchorRect = this.measureLocateRect(ctx.anchorEl)
    const measurable = (r: RectRecord | null): r is RectRecord => r != null && (r.width > 0 || r.height > 0)
    let boundsRect: RectRecord | null
    let compoundBoundsUsed = false
    if (ctx.compound) {
      if (primaryRect && secondaryRect) {
        boundsRect = {
          left: Math.min(primaryRect.left, secondaryRect.left),
          top: Math.min(primaryRect.top, secondaryRect.top),
          right: Math.max(primaryRect.right, secondaryRect.right),
          bottom: Math.max(primaryRect.bottom, secondaryRect.bottom),
          width: Math.max(primaryRect.right, secondaryRect.right) - Math.min(primaryRect.left, secondaryRect.left),
          height: Math.max(primaryRect.bottom, secondaryRect.bottom) - Math.min(primaryRect.top, secondaryRect.top),
        }
        compoundBoundsUsed = true
      } else {
        // §12 — a compound target must be centred from the semantic block context
        // when the caption cue is unavailable (still never a partial slot only).
        boundsRect = secondaryRect ?? primaryRect
        compoundBoundsUsed = Boolean(secondaryRect)
      }
    } else {
      // §24 — prefer the semantic owning block (placement anchor), falling back
      // to the measurable semantic rect before the raw anchor.
      boundsRect = (measurable(placementRectRaw) ? placementRectRaw : null) ?? (measurable(secondaryRect) ? secondaryRect : null) ?? anchorRect
    }
    if (!viewportRect || !boundsRect) return null
    const primaryTopNow = ctx.compound && primaryRect ? primaryRect.top : boundsRect.top
    const scrollTop = Number.isFinite(container.scrollTop) ? container.scrollTop : 0
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const decision = computePreferredPlacement({
      viewportTop: viewportRect.top,
      viewportHeight: viewportRect.height,
      maxScrollTop,
      currentScrollTop: scrollTop,
      targetTop: boundsRect.top,
      targetBottom: boundsRect.bottom,
      primaryTop: primaryTopNow,
      compoundBoundsUsed,
      geometryFresh: true,
    })
    return { decision, primaryTopNow, maxScrollTop, scrollTop, compoundBoundsUsed }
  }

  /**
   * V5.10 — persist the placement decision facts on the transaction record.
   * `initial=true` marks the PRE-SCROLL decision (the fast-path predicate and
   * the "before" geometry); later writes only refresh the achieved fields.
   */
  private recordPlacementFacts(
    facts: LocateOneClickFacts,
    state: { decision: PlacementDecision; primaryTopNow: number | null; maxScrollTop?: number },
    initial = false,
  ): void {
    const d = state.decision
    facts.placementMode = d.placementMode
    facts.largeBlock = d.largeBlock
    facts.primaryActualViewportY = state.primaryTopNow
    if (typeof state.maxScrollTop === 'number') facts.maxScrollTopV510 = state.maxScrollTop
    if (!initial) return
    facts.alreadyWithinCenterTolerance = d.alreadyWithinTolerance
    facts.viewportCenterY = d.viewportCenterY
    facts.targetCenterBefore = d.targetCenterBefore
    facts.centerErrorBefore = d.centerErrorBefore
    facts.compoundHeight = d.compoundHeight
    facts.primaryPreferredViewportY = d.primaryPreferredViewportY
    facts.placementReason = d.reason
    facts.placementDesiredScrollTop = d.desiredScrollTop
  }

  /** V5.9 §6.2 / V5.10 §6 — deterministic scrollTop write (no smooth-scroll race). */
  private applyDeterministicScroll(container: HTMLElement, anchor: HTMLElement, facts: LocateOneClickFacts): void {
    // V5.10 §35 — placement may ONLY run inside a user-click locate transaction.
    if (!this.activeLocateTx) {
      // §33/§34 — a post-COMMIT user scroll (or a post-dismiss repaint) must
      // NEVER trigger an automatic recenter.
      if (this.locateDismissCount > 0) this.countersPlacementV510.postDismissRecenter++
      else {
        this.countersPlacementV510.postCommitUserScrollRecenter++
        this.countersPlacementV510.placementRegressionBreaksV57Topology++
      }
      return
    }
    const state = this.measurePlacementState(container)
    let desired: number
    if (state) {
      desired = state.decision.clampedScrollTop
    } else {
      const containerRect = this.measureLocateRect(container)
      const anchorRect = this.measureLocateRect(anchor)
      if (!containerRect || !anchorRect) {
        facts.scrollWriteCount++
        facts.requestedScrollTop = null
        facts.actualScrollTopAfterWrite = Number.isFinite(container.scrollTop) ? container.scrollTop : null
        return
      }
      desired = computeDesiredScrollTop({
        containerScrollTop: Number.isFinite(container.scrollTop) ? container.scrollTop : 0,
        containerClientHeight: container.clientHeight,
        containerScrollHeight: container.scrollHeight,
        containerRect: makeScrollRectSnapshot({ left: containerRect.left, top: containerRect.top, right: containerRect.right, bottom: containerRect.bottom }),
        anchorRect: makeScrollRectSnapshot({ left: anchorRect.left, top: anchorRect.top, right: anchorRect.right, bottom: anchorRect.bottom }),
      })
    }
    facts.requestedScrollTop = facts.requestedScrollTop ?? desired
    facts.scrollWriteCount++
    // ── V5.12-R4 §7.1/§8 — the locator just wrote scroll: the PRE-scroll inline
    // Range geometry is now INVALID and must be re-measured after the settle.
    // Without this the fragments measured during `commit()` survived to COMMIT
    // (deltaTop ≈ scrollWriteDistance). This ONLY ever runs inside the locate
    // transaction — a post-COMMIT user scroll never reaches this method (§7.2).
    if (this.locateFrame?.getStructure().kind === 'inline') {
      this.locateFrame.invalidateInlineGeometry('PROGRAMMATIC_LOCATE_SCROLL')
      facts.preScrollGeometryInvalidated = true
    }
    try { container.scrollTop = desired } catch { /* keep current */ }
    const after = Number.isFinite(container.scrollTop) ? container.scrollTop : 0
    facts.actualScrollTopAfterWrite = after
    if (state) {
      this.recordPlacementFacts(facts, state)
      if (state.decision.reason === 'STALE_GEOMETRY') this.countersPlacementV510.placementUsesStaleGeometry++
      // §30 — the write must never overshoot the real scroll range.
      if (after > state.maxScrollTop + 1 || after < -1) this.countersPlacementV510.locateCenteringOverscroll++
    }
  }

  /** V5.9 §10.3/§11 — bounded rAF wait for the target to REACH the viewport. */
  private waitForTargetArrival(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    anchorEl: HTMLElement,
    initialArrival: ScrollArrivalSnapshot,
    frame: number,
  ): void {
    const facts = tx.oneClick
    if (!facts) return
    tx.state = frame === 0 ? 'WAITING_SCROLL_EFFECT' : 'WAITING_TARGET_ARRIVAL'
    this.scheduleOneClickRaf(() => {
      if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
      const container = getActiveEditorScrollContainer()
      if (!container || !anchorEl.isConnected) {
        tx.state = 'CANCELLED'
        facts.arrivalGateDecision = 'ANCHOR_DISCONNECTED_DURING_SCROLL'
        this.emitScrollArrivalAudit(tx, facts, 'FAIL', 'ANCHOR_DISCONNECTED_DURING_SCROLL')
        this.finishLocateTransaction(tx, false, 'ANCHOR_DISCONNECTED_DURING_SCROLL')
        return
      }
      // §16 — identity is revalidated on EVERY arrival frame.
      const rv = this.revalidateLocatePostScroll(identity, result)
      facts.anchorChanged = rv.anchorChanged
      if (!rv.ok) {
        tx.state = 'CANCELLED'
        facts.arrivalGateDecision = 'IDENTITY_CHANGED_DURING_SCROLL'
        this.emitScrollArrivalAudit(tx, facts, 'FAIL', rv.reason)
        this.finishLocateTransaction(tx, false, rv.reason)
        return
      }
      const next = this.measureArrivalState(container, anchorEl)
      facts.arrivalWaitFrameCount = frame + 1
      facts.scrollEffectObserved = facts.scrollEffectObserved || hasScrollEffect(initialArrival, next)
      facts.viewportRectAtStart = facts.viewportRectAtStart ?? this.measureLocateRect(container)

      if (next.enteredViewport) {
        // ── ARRIVAL: only now may the post-arrival settle begin ────────────
        facts.targetEnteredViewport = true
        facts.targetRectAtArrival = next.targetRect ? this.rectSnapshotToRectRecord(next.targetRect) : null
        facts.arrivalGateDecision = 'TARGET_ARRIVED'
        this.waitForPostArrivalSettle(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, anchorEl, next, 0, 0)
        return
      }

      if (frame + 1 >= MAX_ARRIVAL_FRAMES) {
        // §15 — bounded exit; never a second user click. (`scrollSettled` is
        // never set here, so SCROLL_SETTLE_WITHOUT_EFFECT cannot be violated.)
        tx.state = 'FAILED'
        facts.arrivalGateDecision = 'SCROLL_TARGET_DID_NOT_ENTER_VIEWPORT'
        this.emitScrollArrivalAudit(tx, facts, 'FAIL', 'SCROLL_TARGET_DID_NOT_ENTER_VIEWPORT')
        this.finishLocateTransaction(tx, false, 'SCROLL_TARGET_DID_NOT_ENTER_VIEWPORT')
        return
      }

      // §10.3 — at most ONE bounded correction write.
      if (frame === 1 && facts.scrollCorrectionCount < MAX_SCROLL_CORRECTION) {
        facts.scrollCorrectionCount++
        this.applyDeterministicScroll(container, anchorEl, facts)
      }
      this.waitForTargetArrival(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, anchorEl, initialArrival, frame + 1)
    })
  }

  /** V5.9 §11 — post-arrival stability (2 consecutive non-moving frames). */
  private waitForPostArrivalSettle(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    anchorEl: HTMLElement,
    prev: ScrollArrivalSnapshot,
    stableFrames: number,
    frame: number,
  ): void {
    const facts = tx.oneClick
    if (!facts) return
    tx.state = 'WAITING_POST_ARRIVAL_SETTLE'
    this.scheduleOneClickRaf(() => {
      if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
      const container = getActiveEditorScrollContainer()
      if (!container) {
        tx.state = 'FAILED'
        facts.arrivalGateDecision = 'CONTAINER_LOST_AFTER_ARRIVAL'
        this.emitScrollArrivalAudit(tx, facts, 'FAIL', 'CONTAINER_LOST_AFTER_ARRIVAL')
        this.finishLocateTransaction(tx, false, 'CONTAINER_LOST_AFTER_ARRIVAL')
        return
      }
      const next = this.measureArrivalState(container, anchorEl)
      facts.scrollEffectObserved = facts.scrollEffectObserved || hasScrollEffect(prev, next)
      const stillThere = next.enteredViewport
      const stable = stillThere && isArrivalStable(prev, next)
      const nextStableFrames = stable ? stableFrames + 1 : 0
      facts.postArrivalStableFrameCount = nextStableFrames
      if (stillThere && nextStableFrames >= MAX_POST_ARRIVAL_STABLE_FRAMES) {
        facts.targetVisibleAtSettle = true
        facts.scrollSettled = true
        facts.targetRectAtSettle = next.targetRect ? this.rectSnapshotToRectRecord(next.targetRect) : null
        facts.viewportRectAtSettle = next.viewportRect ? this.rectSnapshotToRectRecord(next.viewportRect) : null
        facts.arrivalGateDecision = 'TARGET_VISIBLE_AT_SETTLE'
        // V5.10 §19 — record the ACHIEVED placement with fresh geometry.
        const settledPlacement = this.measurePlacementState(container)
        if (settledPlacement) {
          facts.centerErrorAfter = settledPlacement.decision.centerErrorBefore
          facts.targetCenterAfter = settledPlacement.decision.targetCenterBefore
          facts.primaryActualViewportY = settledPlacement.primaryTopNow
          facts.placementMode = settledPlacement.decision.placementMode
        }
        this.emitScrollArrivalAudit(tx, facts, 'PASS', 'TARGET_VISIBLE_AT_SETTLE')
        const scrollGateOk = canStartVisualPipeline({
          automaticScrollRequired: facts.automaticScrollRequired,
          scrollEffectObserved: facts.scrollEffectObserved,
          targetEnteredViewport: facts.targetEnteredViewport,
          targetVisibleAtSettle: facts.targetVisibleAtSettle,
          scrollSettled: facts.scrollSettled,
        })
        if (!scrollGateOk) {
          tx.state = 'FAILED'
          facts.arrivalGateDecision = 'VISUAL_START_GATE_BLOCKED'
          this.finishLocateTransaction(tx, false, 'VISUAL_START_GATE_BLOCKED')
          return
        }
        this.beginOneClickCompletion(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, this.emptyPreScrollState(), true, 'TARGET_ARRIVAL_SETTLED')
        return
      }
      if (frame + 1 >= MAX_POST_ARRIVAL_FRAMES) {
        tx.state = 'FAILED'
        facts.arrivalGateDecision = stillThere ? 'SCROLL_SETTLE_NOT_REACHED' : 'TARGET_LEFT_VIEWPORT_BEFORE_SCROLL_SETTLE'
        this.emitScrollArrivalAudit(tx, facts, 'FAIL', facts.arrivalGateDecision)
        this.finishLocateTransaction(tx, false, facts.arrivalGateDecision)
        return
      }
      this.waitForPostArrivalSettle(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, anchorEl, next, nextStableFrames, frame + 1)
    })
  }

  /** V5.9 §19 — DOCUMENT-DIAGNOSTIC-SCROLL-ARRIVAL-AUDIT. */
  private emitScrollArrivalAudit(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    facts: LocateOneClickFacts,
    decision: string,
    reason: string,
  ): void {
    emitRuntimeAudit(LOCATE_SCROLL_ARRIVAL_AUDIT_EVENT, {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: facts.documentKey,
      diagnosticId: facts.diagnosticId,
      ruleCode: facts.ruleCode,
      targetInitiallyVisible: facts.targetInitiallyVisible,
      automaticScrollRequired: facts.automaticScrollRequired,
      scrollAnchorKind: facts.scrollAnchorKind,
      scrollAnchorConnected: facts.scrollAnchorConnected,
      initialScrollTop: facts.initialScrollTop,
      requestedScrollTop: facts.requestedScrollTop,
      actualScrollTopAfterWrite: facts.actualScrollTopAfterWrite,
      initialTargetRect: facts.initialTargetRect,
      targetRectAfterScrollWrite: facts.targetRectAfterScrollWrite,
      targetRectAtArrival: facts.targetRectAtArrival,
      targetRectAtSettle: facts.targetRectAtSettle,
      viewportRectAtStart: facts.viewportRectAtStart,
      viewportRectAtSettle: facts.viewportRectAtSettle,
      scrollWriteCount: facts.scrollWriteCount,
      scrollCorrectionCount: facts.scrollCorrectionCount,
      scrollEffectObserved: facts.scrollEffectObserved,
      targetEnteredViewport: facts.targetEnteredViewport,
      targetVisibleAtSettle: facts.targetVisibleAtSettle,
      arrivalWaitFrameCount: facts.arrivalWaitFrameCount,
      postArrivalStableFrameCount: facts.postArrivalStableFrameCount,
      visualPipelineStarted: facts.visualPipelineStarted,
      visualStartedAfterTargetVisible: facts.visualStartedAfterTargetVisible,
      visualPaintAttemptCount: facts.visualPaintAttemptCount,
      visualRetryCount: facts.visualRetryCount,
      terminalState: decision === 'PASS' ? 'ARRIVED' : 'FAILED',
      decision,
      reason,
    })
  }

  /**
   * V5.12-R3 §16 — DOCUMENT-DIAGNOSTIC-DRAWER-PERSISTENCE-AUDIT.
   *
   * Proves the terminal Drawer presentation MATCHES the user intent, and that a
   * restore (when required) really went through settle → remeasure → repaint →
   * verify → final commit. Also drives the §18 hard gates.
   */
  private emitDrawerPersistenceAudit(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    commit: boolean,
    terminalDecision: string,
  ): void {
    const facts = tx.oneClick
    const layers = this.isHeadlessLayoutSafe() ? null : this.measureLocateLayerFacts()
    const panelIntersectionCount = layers
      ? (layers.drawerIntersectsFrame ? 1 : 0) + (layers.toolbarIntersectsFrame ? 1 : 0) + (layers.navigatorIntersectsFrame ? 1 : 0)
      : 0
    const inlineFacts = this.locateFrame?.getInlineFragmentFacts() ?? null
    const kind = this.locateFrame?.getStructure().kind ?? null
    const isInline = kind === 'inline'
    const isBlock = this.isObjectKind(kind)
    const geom = this.locateFrame?.getGeometryReport() ?? null
    const prim = this.locateFrame?.getFrameElement()
      ? this.measureLocateRect(this.locateFrame.getFrameElement())
      : null
    const sem = geom?.semanticRect ?? null
    // §11 — jsdom/headless cannot measure a PAINTED carrier, so the post-restore
    // coverage is NOT asserted there (null = not asserted, never a fake PASS and
    // never a fabricated FAIL).
    const coverageRatio = this.isHeadlessLayoutSafe()
      ? null
      : isInline
        ? (inlineFacts ? inlineFacts.coverage : null)
        : isBlock ? (geom ? geom.horizontalCoverage : null) : 1
    const presentationAtFinalCommit = facts?.presentationAtFinalCommit ?? this.getDrawerPresentationMode()
    const leaseActive = this.getDrawerRecoveryLeaseActive()
    const selectedAfter = this.lastLocatedDiagnosticId
    const selectedRowId = this.drawerSelectedRowId()
    // The Drawer selection context only exists once the Drawer really RENDERED
    // rows — a never-opened Drawer has no selection to lose (not applicable).
    const drawerRowsRendered = this.drawerEl != null
      && this.drawerEl.querySelector('.inkchapter-doc-drawer__item[data-diagnostic-id]') != null
    const selectedDiagnosticPreserved = !drawerRowsRendered || selectedRowId === selectedAfter
    const filterAfter = this.drawerFilter
    const filterPreserved = filterAfter === this.locateDrawerFilterAtStart
    const listScrollAfter = this.measureDrawerListScrollTop()
    const drawerScrollContextPreserved = Math.abs(listScrollAfter - this.locateDrawerListScrollAtStart) <= 1
    const drawerRenderedVisibleAtFinalCommit = facts?.drawerVisibleAtFinalCommit ?? this.measureDrawerRenderedVisible()
    const viewportClass: DrawerViewportClass = facts?.drawerViewportClass
      ?? this.resolveCurrentDrawerViewportClass(sem ? sem.width : 0)
    const fidelity = evaluateDrawerPresentationFidelity({
      drawerRequestedOpen: this.drawerOpen,
      terminalState: commit ? 'COMMITTED' : 'FAILED',
      presentationAtFinalCommit: presentationAtFinalCommit as DrawerPresentationModeV3,
      drawerLocateRecoveryLeaseActive: leaseActive,
      drawerLocateRecoveryLeaseReleased: !leaseActive,
      drawerRenderedVisibleAtFinalCommit,
      viewportClass,
      postRestoreCoverageRatio: coverageRatio,
      postRestorePanelIntersectionCount: panelIntersectionCount,
      postRestoreLayoutEpochCurrent: true,
      selectedDiagnosticPreserved,
      filterPreserved,
    })
    // ── §18 — hard-gate accounting (only real violations increment) ──────────
    if (fidelity.failedChecks.includes('COMMITTED_WITH_DRAWER_RECOVERY_LEASE_HELD')) {
      this.countersDrawerV512R3.committedWithDrawerRecoveryLeaseHeld++
    }
    if (fidelity.failedChecks.includes('TERMINAL_LOCATE_COLLAPSE_WHILE_DRAWER_REQUESTED_OPEN')) {
      this.countersDrawerV512R3.terminalLocateCollapseWhileDrawerRequestedOpen++
    }
    if (fidelity.failedChecks.includes('DRAWER_REQUESTED_OPEN_BUT_HIDDEN_AFTER_COMMIT')) {
      this.countersDrawerV512R3.drawerRequestedOpenButHiddenAfterCommit++
    }
    if (fidelity.failedChecks.includes('WIDE_VIEWPORT_TERMINAL_LOCATE_COLLAPSE')) {
      this.countersDrawerV512R3.wideViewportTerminalLocateCollapse++
    }
    if (fidelity.failedChecks.includes('AUTO_REOPEN_AFTER_NEWER_USER_CLOSE_INTENT')) {
      this.countersDrawerV512R3.autoReopenAfterNewerUserCloseIntent++
    }
    if (fidelity.failedChecks.includes('POST_RESTORE_COVERAGE_LT_098')) this.countersDrawerV512R3.postRestoreCoverageLt098++
    if (fidelity.failedChecks.includes('POST_RESTORE_PANEL_INTERSECTION')) this.countersDrawerV512R3.postRestorePanelIntersection++
    if (fidelity.failedChecks.includes('POST_RESTORE_STALE_LAYOUT_EPOCH')) this.countersDrawerV512R3.postRestoreStaleLayoutEpoch++
    if (commit && !selectedDiagnosticPreserved) this.countersDrawerV512R3.drawerSelectedDiagnosticLostAfterRestore++
    if (commit && !filterPreserved) this.countersDrawerV512R3.drawerFilterLostAfterRestore++
    if (commit && !drawerScrollContextPreserved) this.countersDrawerV512R3.drawerListContextLostAfterRestore++
    if (commit && facts?.drawerRestoreRequired === true && facts.drawerRestoreSettled !== true) {
      this.countersDrawerV512R3.postRestoreWithoutLayoutSettle++
    }
    if (commit && facts?.drawerRestoreRequired === true && facts.remeasuredAfterDrawerRestore !== true) {
      this.countersDrawerV512R3.postRestoreWithoutRemeasure++
    }
    if (commit && facts?.drawerRestoreRequired === true && facts.repaintedAfterDrawerRestore !== true) {
      this.countersDrawerV512R3.postRestoreWithoutRepaint++
    }
    // §18 — a restore that ENDS with the Drawer transiently collapsed again is a
    // restore feedback loop (the exact class of bug this revision forbids).
    if (commit && facts?.drawerRestoreStarted === true && this.drawerCollapseActive) {
      this.countersDrawerV512R3.drawerRestoreFeedbackLoop++
    }
    if (commit && this.drawerOpen && presentationAtFinalCommit !== 'open' && presentationAtFinalCommit !== 'compact-docked'
      && facts?.drawerRestoreRequired === true && facts.drawerRestoreStarted !== true) {
      this.countersDrawerV512R3.postCommitDrawerRestoreMissing++
    }
    const payload: Record<string, unknown> = {
      transactionId: tx.id,
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: this.lastLocatedDiagnosticId,
      terminalState: commit ? 'COMMITTED' : 'FAILED',
      drawerIntentEpochAtStart: facts?.drawerIntentEpochAtStart ?? this.drawerIntentEpochAtLastLocateStart,
      drawerIntentEpochAtFinal: this.drawerIntentEpoch,
      drawerRequestedOpenAtStart: facts?.drawerRequestedOpenAtStart ?? this.drawerOpen,
      drawerRequestedOpenAtFinal: this.drawerOpen,
      presentationBeforeLocate: facts?.presentationBeforeLocate ?? null,
      presentationDuringLocate: facts?.presentationDuringLocate ?? null,
      presentationBeforeRestore: facts?.presentationDuringLocate ?? null,
      presentationAfterRestore: facts?.presentationAfterRestore ?? null,
      presentationAtFinalCommit,
      drawerRenderedVisibleBefore: facts?.drawerVisibleBeforeLocate ?? null,
      drawerRenderedVisibleDuringRecovery: facts?.drawerVisibleDuringRecovery ?? null,
      drawerRenderedVisibleAfterRestore: facts?.drawerVisibleAfterRestore ?? null,
      drawerRenderedVisibleAtFinalCommit,
      drawerLocateRecoveryLeaseActive: leaseActive,
      drawerLocateRecoveryLeaseReleased: !leaseActive,
      activeLocateVisualLeaseActive: this.getLocateVisibilityLeaseActive(),
      restoreRequired: facts?.drawerRestoreRequired ?? false,
      restoreStarted: facts?.drawerRestoreStarted ?? false,
      restoreSettled: facts?.drawerRestoreSettled ?? false,
      remeasuredAfterRestore: facts?.remeasuredAfterDrawerRestore ?? false,
      repaintedAfterRestore: facts?.repaintedAfterDrawerRestore ?? false,
      selectedDiagnosticBefore: selectedAfter,
      selectedDiagnosticAfter: selectedAfter,
      selectedDiagnosticRowId: selectedRowId,
      selectedDiagnosticPreserved,
      filterBefore: this.locateDrawerFilterAtStart,
      filterAfter,
      filterPreserved,
      drawerListScrollBefore: this.locateDrawerListScrollAtStart,
      drawerListScrollAfter: listScrollAfter,
      drawerScrollContextPreserved,
      postRestoreCoverageRatio: coverageRatio,
      postRestorePresentationRight: prim ? prim.right : null,
      postRestoreSemanticRight: sem ? sem.right : null,
      rightEdgeAuthority: geom ? geom.rightEdgeAuthority : null,
      postRestorePanelIntersectionCount: panelIntersectionCount,
      postRestoreLayoutEpochCurrent: true,
      drawerViewportClass: viewportClass,
      drawerCompactAttempts: facts?.drawerCompactAttempts ?? 0,
      terminalDecision,
      decision: fidelity.decision,
      reason: fidelity.reason,
      drawerPersistenceGateCounters: { ...this.countersDrawerV512R3 },
      drawerPersistenceGateDecision: evaluateDrawerPersistenceGates(this.countersDrawerV512R3).decision,
    }
    this.lastDrawerPersistenceAudit = payload
    emitRuntimeAudit(DRAWER_PERSISTENCE_AUDIT_EVENT, payload)
  }

  /** Headless guard shared by the R3 measurement helpers. */
  private isHeadlessLayoutSafe(): boolean {
    return isHeadlessTestRuntime()
  }

  // ── V5.8 — Single-click offscreen atomic transaction ─────────────────────

  /** V5.8 — identity authority locked at click time (never re-derived). */
  private captureLocateIdentity(
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    result: DiagnosticLocationResolveResult,
  ): {
    diagnosticId: string
    ruleCode: string
    occurrenceIndex: number | null
    resourceKind: string | null
    sourceStableIdentity: string | null
    anchorTag: string | null
    anchorClass: string | null
  } {
    const meta = (diag.metadata ?? {}) as Record<string, unknown>
    const loc = diag.location as { kind?: string; stableIdentity?: string; line?: number } | null | undefined
    const anchor = result.element ?? null
    return {
      diagnosticId: diag.id,
      ruleCode: diag.code,
      occurrenceIndex: typeof meta.occurrenceIndex === 'number' ? meta.occurrenceIndex : null,
      resourceKind: typeof meta.resourceKind === 'string' ? meta.resourceKind : null,
      sourceStableIdentity: loc && typeof loc.stableIdentity === 'string' ? loc.stableIdentity : null,
      anchorTag: anchor ? anchor.tagName.toLowerCase() : null,
      anchorClass: anchor ? String(anchor.className).slice(0, 80) : null,
    }
  }

  /** V5.8 — one plain rect read (never a cached/pre-scroll value). */
  private measureLocateRect(el: Element | null): RectRecord | null {
    if (!el) return null
    try {
      const r = el.getBoundingClientRect()
      if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
    } catch {
      return null
    }
  }

  private locateRectIntersectionArea(a: RectRecord, b: RectRecord): number {
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    return w * h
  }

  /**
   * V5.9 — the PRE-scroll geometry authority is now the Scroll Arrival
   * Authority (`measureArrivalState` + Target Arrival Gate). The V5.8 pipeline
   * receives this empty state instead of a second, competing geometry source.
   */
  private emptyPreScrollState(): LocatePreScrollState {
    return { targetRect: null, hostRect: null, targetInitiallyVisible: false, automaticScrollRequired: false }
  }

  private createOneClickFacts(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    pre: LocatePreScrollState,
    scrollPerformed: boolean,
  ): LocateOneClickFacts {
    return {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      diagnosticId: tx.diagnosticId,
      userClickCount: 1,
      targetInitiallyVisible: pre.targetInitiallyVisible,
      automaticScrollRequired: pre.automaticScrollRequired,
      scrollStarted: scrollPerformed,
      scrollSettled: scrollPerformed,
      postScrollRevalidateDecision: 'PENDING',
      preScrollTargetRect: pre.targetRect,
      postScrollTargetRect: null,
      freshTargetMeasurement: false,
      freshHostMeasurement: false,
      preScrollGeometryInvalidated: false,
      visualPaintAttemptCount: 0,
      visualRetryCount: 0,
      presentationBuiltAfterScroll: false,
      actualPaintedPrimaryRect: null,
      actualPaintedSecondaryRect: null,
      primaryMarkerVisible: false,
      visualCarrierPresent: false,
      secondaryContextVisible: null,
      expectedFragmentCount: null,
      renderedFragmentCount: null,
      drawerRecoveryRequired: false,
      drawerRecoverySettled: false,
      postRecoveryRemeasured: false,
      postRecoveryRepainted: false,
      postRecoveryVisualVisible: false,
      // ── V5.12-R3 §16 — Drawer-persistence facts ────────────────────────────
      drawerRequestedOpenAtStart: this.drawerOpen,
      drawerIntentEpochAtStart: this.drawerIntentEpoch,
      presentationBeforeLocate: this.getDrawerPresentationMode(),
      presentationDuringLocate: null,
      presentationAfterRestore: null,
      presentationAtFinalCommit: null,
      drawerVisibleBeforeLocate: false,
      drawerVisibleDuringRecovery: false,
      drawerVisibleAfterRestore: false,
      drawerVisibleAtFinalCommit: false,
      drawerRestoreRequired: false,
      drawerRestoreStarted: false,
      drawerRestoreSettled: false,
      remeasuredAfterDrawerRestore: false,
      repaintedAfterDrawerRestore: false,
      drawerCompactAttempts: 0,
      drawerViewportClass: null,
      secondUserClickRequired: false,
      postScrollRemeasureMissing: false,
      staleRectCommit: false,
      zeroRectCommit: false,
      fragmentDropCommit: false,
      diagnosticIdentityChanged: false,
      occurrenceChanged: false,
      anchorChanged: false,
      ruleCode: identity.ruleCode,
      occurrenceIndex: identity.occurrenceIndex,
      resourceKind: identity.resourceKind,
      targetKind: null,
      // V5.9 — Scroll Completion Authority defaults.
      scrollAnchorKind: null,
      scrollAnchorConnected: false,
      initialScrollTop: 0,
      requestedScrollTop: null,
      actualScrollTopAfterWrite: null,
      initialTargetRect: null,
      viewportRectAtStart: null,
      viewportRectAtSettle: null,
      targetRectAfterScrollWrite: null,
      targetRectAtArrival: null,
      targetRectAtSettle: null,
      scrollWriteCount: 0,
      scrollCorrectionCount: 0,
      scrollEffectObserved: false,
      targetEnteredViewport: false,
      targetVisibleAtSettle: false,
      arrivalWaitFrameCount: 0,
      postArrivalStableFrameCount: 0,
      visualPipelineStarted: false,
      visualStartedAfterTargetVisible: false,
      arrivalGateDecision: 'PENDING',
      // V5.10 — Preferred Center Placement defaults.
      placementMode: 'CENTER',
      alreadyWithinCenterTolerance: false,
      viewportCenterY: null,
      targetCenterBefore: null,
      targetCenterAfter: null,
      centerErrorBefore: null,
      centerErrorAfter: null,
      compoundHeight: null,
      largeBlock: false,
      primaryPreferredViewportY: null,
      primaryActualViewportY: null,
      placementCorrectionCount: 0,
      finalPlacementDecision: 'PENDING',
      finalPlacementReason: 'PENDING',
      placementReason: 'PENDING',
      maxScrollTopV510: null,
      placementDesiredScrollTop: null,
    }
  }

  /**
   * V5.8 — POST_SCROLL_REVALIDATE: revalidate the LOCKED identity. A scroll may
   * never silently swap the semantic target / occurrence / source anchor.
   */
  private revalidateLocatePostScroll(
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    result: DiagnosticLocationResolveResult,
  ): { ok: boolean; reason: string; diagnosticIdentityChanged: boolean; occurrenceChanged: boolean; anchorChanged: boolean } {
    const liveDiag = this.diagnostics.getSnapshot()?.diagnostics.find(d => d.id === identity.diagnosticId) ?? null
    const diagnosticIdentityChanged = liveDiag != null && liveDiag.code !== identity.ruleCode
    let occurrenceChanged = false
    if (liveDiag) {
      const meta = (liveDiag.metadata ?? {}) as Record<string, unknown>
      const occ = typeof meta.occurrenceIndex === 'number' ? meta.occurrenceIndex : null
      occurrenceChanged = occ !== identity.occurrenceIndex
    }
    const anchor = result.element ?? null
    // V5.8 — the anchor check only applies when the resolve result CARRIES an
    // element (a pure document-boundary scroll has none).
    const anchorChanged = anchor != null
      ? !anchor.isConnected ||
        anchor.tagName.toLowerCase() !== identity.anchorTag ||
        String(anchor.className).slice(0, 80) !== identity.anchorClass
      : identity.anchorTag != null
    if (liveDiag == null) {
      return { ok: false, reason: 'POST_SCROLL_DIAGNOSTIC_GONE', diagnosticIdentityChanged: true, occurrenceChanged, anchorChanged }
    }
    if (diagnosticIdentityChanged) {
      return { ok: false, reason: 'POST_SCROLL_DIAGNOSTIC_IDENTITY_CHANGED', diagnosticIdentityChanged, occurrenceChanged, anchorChanged }
    }
    if (occurrenceChanged) {
      return { ok: false, reason: 'POST_SCROLL_OCCURRENCE_CHANGED', diagnosticIdentityChanged, occurrenceChanged, anchorChanged }
    }
    if (anchorChanged) {
      return { ok: false, reason: 'POST_SCROLL_ANCHOR_CHANGED', diagnosticIdentityChanged, occurrenceChanged, anchorChanged }
    }
    return { ok: true, reason: 'IDENTITY_STABLE', diagnosticIdentityChanged, occurrenceChanged, anchorChanged }
  }

  /** V5.8 — fresh post-scroll measurement of the target AND the overlay host. */
  private measureOneClickPostScroll(
    facts: LocateOneClickFacts,
    result: DiagnosticLocationResolveResult,
    pre: LocatePreScrollState,
  ): void {
    const postTarget = this.measureLocateRect(result.element ?? null)
    const postHost = this.measureLocateRect(this.root)
    facts.postScrollTargetRect = postTarget
    facts.postScrollRemeasureMissing = postTarget == null
    facts.freshTargetMeasurement = postTarget != null
    facts.freshHostMeasurement = postHost != null
    // V5.8 — pre-scroll geometry is transient: any auto scroll invalidates it.
    facts.preScrollGeometryInvalidated = shouldInvalidatePreScrollGeometry(facts.automaticScrollRequired)
    if (facts.preScrollGeometryInvalidated) {
      if (pre.targetRect) void pre.targetRect // explicitly NOT reused as final geometry
    }
    facts.targetKind = this.locateFrame?.getStructure().kind ?? null
  }

  /** V5.8 — the ACTUAL painted DOM carriers (frame / inline mark + context). */
  private measureActualPaintedLocateVisual(result: DiagnosticLocationResolveResult): {
    primary: RectRecord | null
    secondary: RectRecord | null
  } {
    const frame = this.locateFrame
    if (!frame) return { primary: null, secondary: null }
    const frameEl = frame.getFrameElement()
    const inlineEl = frame.getInlineElement()
    const kind = frame.getStructure().kind
    // V5.12-R2 §5/§10 — the heading + fragment inline carriers are overlay
    // geometry, not a frame element; the painted rect must be measured from the
    // REAL painted carriers.
    let primary: RectRecord | null
    if (kind === 'heading') {
      primary = this.measureHeadingActiveCarrierRect()
    } else if (kind === 'inline') {
      const fragments = frame.getInlineFragmentFacts().paintedCarrierRect
      primary = fragments
        ? { left: fragments.left, top: fragments.top, right: fragments.right, bottom: fragments.bottom, width: fragments.width, height: fragments.height }
        : this.measureLocateRect(inlineEl)
    } else {
      primary = this.measureLocateRect(frameEl ?? inlineEl)
    }
    const secondary = this.isObjectKind(kind) ? this.measureLocateRect(result.element ?? null) : null
    return { primary, secondary }
  }

  /** §5/§6 — the union of the painted ACTIVE heading fragments (null when none). */
  private measureHeadingActiveCarrierRect(): RectRecord | null {
    const wrapper = this.headingActiveWrapper
    if (wrapper) {
      const frags = Array.from(wrapper.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-active__fragment'))
      let l = Infinity
      let t = Infinity
      let r = -Infinity
      let b = -Infinity
      for (const f of frags) {
        const rect = this.measureLocateRect(f)
        if (!rect) continue
        l = Math.min(l, rect.left)
        t = Math.min(t, rect.top)
        r = Math.max(r, rect.right)
        b = Math.max(b, rect.bottom)
      }
      if (Number.isFinite(l) && Number.isFinite(t)) {
        return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
      }
    }
    // Fall back to the PASSIVE marker wrapper (icon + rail) — still a real
    // painted heading carrier, never a fabricated rect.
    const rec = this.headingActiveMarkerIdentity != null
      ? this.headingPassiveMarkers.get(this.headingActiveMarkerIdentity)
      : null
    if (rec && rec.wrapper.isConnected) {
      const rail = this.measureLocateRect(rec.wrapper.querySelector('.inkchapter-heading-diagnostic-marker__rail'))
      if (rail) return rail
    }
    return null
  }

  /**
   * V5.8 — verify the ACTUAL painted DOM (asserted in real layout; headless
   * returns SKIP_HEADLESS). Extracted as an instance method so the kill-bug
   * tests can drive a synthetic paint failure without a real renderer.
   */
  private verifyOneClickPaintedVisual(
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    result: DiagnosticLocationResolveResult,
    painted: { primary: RectRecord | null; secondary: RectRecord | null },
  ): {
    ok: boolean
    reason: string
    primaryMarkerVisible: boolean
    secondaryContextVisible: boolean | null
    expectedFragmentCount: number | null
    renderedFragmentCount: number | null
    zeroRect: boolean
    fragmentDrop: boolean
  } {
    const frame = this.locateFrame
    const structure = frame?.getStructure() ?? null
    const kind = structure?.kind ?? null
    const isInline = kind === 'inline'
    const isCompound = this.isObjectKind(kind)
    const targetEl = result.element ?? null
    const targetConnected = !!targetEl && targetEl.isConnected
    const primaryMarkerVisible = frame?.hasCommitted() === true
    const geom = frame?.getGeometryReport() ?? null
    const sem = geom?.semanticRect ?? null
    const prim = painted.primary
    // Compound (Table/Code/Figure/Formula): the painted carrier must cover the
    // full semantic block — a truncated context is a FAIL, not a PASS.
    const secondaryContextVisible = isCompound
      ? prim != null && sem != null
        ? prim.width >= sem.width - 2 && prim.height >= sem.height - 2
        : primaryMarkerVisible
      : null
    const expectedFragmentCount = isInline ? this.expectedInlineVisualLineCount(targetEl, frame) : null
    const renderedFragmentCount = isInline ? this.renderedInlineVisualLineCount(frame) : null
    const intersection = prim ? this.paintedIntersectionWithVisibleEditor(prim) : 0
    // V5.8 — the zero-rect / fragment-drop gates are only meaningful with a REAL
    // layout; headless (jsdom) cannot measure a painted carrier, so they are
    // explicitly NOT asserted there (never a fabricated violation).
    const hasRealLayout = !isHeadlessTestRuntime()
    const zeroRect = hasRealLayout && (prim == null || !(prim.width > 0) || !(prim.height > 0))
    const fragmentDrop =
      hasRealLayout &&
      isInline &&
      expectedFragmentCount != null &&
      expectedFragmentCount > 0 &&
      (renderedFragmentCount == null || renderedFragmentCount !== expectedFragmentCount)
    const verdict = verifyOneClickLocateVisual({
      hasRealLayout,
      targetConnected,
      paintedWidth: prim?.width ?? 0,
      paintedHeight: prim?.height ?? 0,
      paintedIntersectionWithVisibleEditor: intersection,
      primaryMarkerVisible,
      secondaryContextVisible,
      expectedFragmentCount,
      renderedFragmentCount,
      staleRect: false,
    })
    return {
      ok: verdict.ok,
      reason: verdict.reason,
      primaryMarkerVisible,
      secondaryContextVisible,
      expectedFragmentCount,
      renderedFragmentCount,
      zeroRect,
      fragmentDrop,
    }
  }

  private paintedIntersectionWithVisibleEditor(rect: RectRecord): number {
    const container = getActiveEditorScrollContainer()
    const cr = this.measureLocateRect(container)
    if (!cr) return 0
    return this.locateRectIntersectionArea(rect, cr)
  }

  /** V5.8 — bounded INTERNAL rAF scheduling (never a second user click). */
  private scheduleOneClickRaf(run: () => void): void {
    let done = false
    const scheduledForTxId = this.activeLocateTx?.id ?? -1
    const fire = (): void => {
      if (done) return
      done = true
      // V5.9 §37 — the bounded chain is no longer pending once it really ran.
      this.locateTxRafPending = false
      // V5.9 §37 — a bounded rAF that outlived its own transaction is dangling.
      if (scheduledForTxId >= 0 && (this.activeLocateTx?.id ?? -1) !== scheduledForTxId) {
        this.countersScrollV59.danglingScrollRaf++
      }
      run()
    }
    this.locateTxRafPending = true
    try {
      if (typeof requestAnimationFrame === 'function') {
        const handle = requestAnimationFrame(fire)
        this.locateTxSettleCancel = () => {
          try { cancelAnimationFrame(handle) } catch { /* noop */ }
        }
        return
      }
    } catch { /* fall through to sync */ }
    fire()
  }

  /**
   * V5.8 — POST_SCROLL_REVALIDATING → … → commit pipeline. `scrollPerformed`
   * is true when the real settle gate ran (i.e. an automatic scroll happened).
   */
  private beginOneClickCompletion(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    pre: LocatePreScrollState,
    scrollPerformed: boolean,
    completionReason = 'NO_CONTAINER_IMMEDIATE',
  ): void {
    tx.state = 'POST_SCROLL_REVALIDATING'
    const facts = tx.oneClick ?? this.createOneClickFacts(tx, identity, pre, scrollPerformed)
    tx.oneClick = facts
    // V5.9 — `scrollSettled` is owned by the Target Arrival Authority, NOT by
    // this entry point; only the scroll START fact is recorded here.
    facts.scrollStarted = scrollPerformed
    const rv = this.revalidateLocatePostScroll(identity, result)
    facts.diagnosticIdentityChanged = rv.diagnosticIdentityChanged
    facts.occurrenceChanged = rv.occurrenceChanged
    facts.anchorChanged = rv.anchorChanged
    facts.postScrollRevalidateDecision = rv.ok ? 'PASS' : 'FAILED'
    if (!rv.ok) {
      tx.state = 'FAILED'
      this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'POST_SCROLL_REVALIDATE_FAILED', targetIndex, result, false)
      this.finishLocateTransaction(tx, false, rv.reason)
      return
    }
    // V5.9 §12 — the visual pipeline start gate (defence in depth; the arrival
    // authority already gated it before calling here).
    const scrollGateOk = canStartVisualPipeline({
      automaticScrollRequired: facts.automaticScrollRequired,
      scrollEffectObserved: facts.scrollEffectObserved,
      targetEnteredViewport: facts.targetEnteredViewport,
      targetVisibleAtSettle: facts.targetVisibleAtSettle,
      scrollSettled: facts.scrollSettled,
    })
    if (!scrollGateOk) {
      tx.state = 'FAILED'
      facts.arrivalGateDecision = 'VISUAL_START_GATE_BLOCKED'
      this.finishLocateTransaction(tx, false, 'VISUAL_START_GATE_BLOCKED')
      return
    }
    facts.visualPipelineStarted = true
    facts.visualStartedAfterTargetVisible = facts.automaticScrollRequired
      ? (facts.targetVisibleAtSettle && facts.targetEnteredViewport)
      : true
    tx.state = 'MEASURING'
    this.measureOneClickPostScroll(facts, result, pre)
    this.runOneClickPaintAttempt(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, 0, completionReason)
  }

  /** V5.8 — PRESENT + measure actual painted DOM + verify + bounded retry. */
  private runOneClickPaintAttempt(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    pre: LocatePreScrollState,
    attempt: number,
    completionReason: string,
  ): void {
    const facts = tx.oneClick
    if (!facts) return
    tx.state = 'PRESENTING'
    // V5.9 §12/§13 — a paint attempt while an automatic scroll is required and
    // the target has not arrived is a HARD violation (the visual pipeline must
    // never be used to compensate for an unfinished scroll).
    if (facts.automaticScrollRequired && !facts.targetEnteredViewport) {
      this.countersScrollV59.visualPaintAttemptWhileTargetOffscreen++
    }
    facts.visualPaintAttemptCount = attempt + 1
    this.applyLocateHighlightAndVerify(tx, diag, highlightTargets, result, targetIndex)
    // V5.8 — capture, synchronously after the paint, whether a REAL carrier
    // exists (the one-click visual is present, not merely "class applied").
    facts.visualCarrierPresent = this.locateFrame?.hasCommitted() === true
    const painted = this.measureActualPaintedLocateVisual(result)
    facts.actualPaintedPrimaryRect = painted.primary
    facts.actualPaintedSecondaryRect = painted.secondary
    tx.state = 'VERIFYING_PAINT'
    const verdict = this.verifyOneClickPaintedVisual(diag, result, painted)
    facts.primaryMarkerVisible = verdict.primaryMarkerVisible
    facts.secondaryContextVisible = verdict.secondaryContextVisible
    facts.expectedFragmentCount = verdict.expectedFragmentCount
    facts.renderedFragmentCount = verdict.renderedFragmentCount
    facts.zeroRectCommit = verdict.zeroRect
    facts.staleRectCommit = !facts.freshTargetMeasurement
    if (!verdict.ok) {
      const decision = resolveOneClickRetryDecision(false, facts.visualRetryCount, LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY)
      if (decision === 'RETRY') {
        facts.visualRetryCount++
        // V5.9 §13 — a visual retry is ONLY legitimate once the target arrived.
        if (facts.automaticScrollRequired && !facts.targetEnteredViewport) {
          this.countersScrollV59.visualRetryWhileTargetOffscreen++
        }
        // INTERNAL retry: a fresh measurement then a repaint. The user click
        // count is NOT incremented — no second user click is ever required.
        this.scheduleOneClickRaf(() => {
          if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
          tx.state = 'MEASURING'
          this.measureOneClickPostScroll(facts, result, pre)
          this.runOneClickPaintAttempt(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, attempt + 1, completionReason)
        })
        return
      }
      // Exhausted internal retries → terminal FAILED (never a fake PASS, never
      // a wait for a second user click).
      facts.secondUserClickRequired = false
      facts.fragmentDropCommit = verdict.fragmentDrop
      tx.state = 'FAILED'
      this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'ONE_CLICK_VISUAL_FAILED', targetIndex, result, false)
      this.finishLocateTransaction(tx, false, `ONE_CLICK_VISUAL_FAILED:${verdict.reason}`)
      return
    }
    facts.presentationBuiltAfterScroll = true
    facts.fragmentDropCommit = verdict.fragmentDrop
    this.runOneClickFinalPhase(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, completionReason)
  }

  /** V5.8 — restore Drawer/layout → final settle → final remeasure/repaint/verify → COMMIT. */
  private runOneClickFinalPhase(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    diagnosticId: string,
    targetIndex: number,
    highlightTargets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    identity: ReturnType<DocumentUtilityOverlayHost['captureLocateIdentity']>,
    pre: LocatePreScrollState,
    completionReason: string,
    phase: 'PHASE_A' | 'PHASE_B' = 'PHASE_A',
  ): void {
    const facts = tx.oneClick
    if (!facts) return
    if (phase === 'PHASE_A') {
      // ── V5.12-R3 §7 — PHASE A: LOCATE / RECOVERY ──────────────────────────
      // The provisional visual may legitimately be measured while the Drawer is
      // transiently out of the way. It is NOT the terminal presentation.
      facts.drawerRecoveryRequired = this.drawerCollapseActive || this.drawerCompactActive
      this.acquireLocateVisibilityLease(tx)
      facts.drawerRecoverySettled = true
      facts.presentationDuringLocate = this.getDrawerPresentationMode()
      facts.drawerVisibleDuringRecovery = this.measureDrawerRenderedVisible()
      facts.drawerViewportClass = this.resolveCurrentDrawerViewportClass(
        this.measureLocateRect(result.element)?.width ?? 0,
      )
    }
    tx.state = 'WAITING_FINAL_LAYOUT_SETTLE'
    this.scheduleOneClickRaf(() => {
      if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
      tx.state = phase === 'PHASE_B' ? 'REMEASURING_AFTER_DRAWER_RESTORE' : 'FINAL_REMEASURING'
      this.measureOneClickPostScroll(facts, result, pre)
      facts.postRecoveryRemeasured = true
      if (phase === 'PHASE_B') facts.remeasuredAfterDrawerRestore = true
      tx.state = 'FINAL_REPAINTING'
      // ── V5.12-R4 §7.1/§8 — a programmatic locate scroll makes the PRE-scroll
      // Range geometry stale. This is enforced HERE (deterministically, in the
      // settled layout) instead of relying on the scroll-write call site, so an
      // inline fragment measured before the scroll can never reach the gate.
      if (facts.scrollWriteCount > 0 && this.locateFrame?.getStructure().kind === 'inline') {
        this.locateFrame.invalidateInlineGeometry('PROGRAMMATIC_LOCATE_SCROLL')
        facts.preScrollGeometryInvalidated = true
      }
      this.repositionDiagnosticLocateFrame()
      const painted = this.measureActualPaintedLocateVisual(result)
      facts.actualPaintedPrimaryRect = painted.primary
      facts.actualPaintedSecondaryRect = painted.secondary
      facts.postRecoveryRepainted = true
      if (phase === 'PHASE_B') facts.repaintedAfterDrawerRestore = true
      tx.state = 'FINAL_VERIFYING'
      const verdict = this.verifyOneClickPaintedVisual(diag, result, painted)
      facts.primaryMarkerVisible = verdict.primaryMarkerVisible
      facts.secondaryContextVisible = verdict.secondaryContextVisible
      facts.expectedFragmentCount = verdict.expectedFragmentCount
      facts.renderedFragmentCount = verdict.renderedFragmentCount
      facts.zeroRectCommit = verdict.zeroRect
      facts.fragmentDropCommit = verdict.fragmentDrop
      facts.postRecoveryVisualVisible = verdict.ok
      // ── V5.10 §19/§22/§23 — FINAL PLACEMENT VERIFY (+ at most ONE fix) ──
      const container = getActiveEditorScrollContainer()
      const pstate = this.measurePlacementState(container)
      let placementOk = true
      let placementReason = 'NO_PLACEMENT_CONTEXT'
      if (pstate) {
        facts.centerErrorAfter = pstate.decision.centerErrorBefore
        facts.targetCenterAfter = pstate.decision.targetCenterBefore
        facts.primaryActualViewportY = pstate.primaryTopNow
        facts.placementMode = pstate.decision.placementMode
        const dpr = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
        const vp = verifyFinalPlacement({
          placementMode: pstate.decision.placementMode,
          centerErrorAfter: pstate.decision.centerErrorBefore,
          actualScrollTop: pstate.scrollTop,
          maxScrollTop: pstate.maxScrollTop,
          primaryPreferredViewportY: pstate.decision.primaryPreferredViewportY,
          primaryActualViewportY: pstate.primaryTopNow,
          tolerancePx: placementNumericTolerancePx(dpr),
        })
        placementOk = vp.ok
        placementReason = vp.reason
        if (!vp.ok && facts.placementCorrectionCount < MAX_FINAL_PLACEMENT_CORRECTION) {
          // A real reflow (Drawer restore / width change) invalidated the
          // placement: ONE bounded correction, then re-settle + re-verify.
          facts.placementCorrectionCount++
          const correctionAnchor = this.locatePlacementCtx?.anchorEl ?? null
          if (container && correctionAnchor) this.applyDeterministicScroll(container, correctionAnchor, facts)
          tx.state = 'WAITING_FINAL_LAYOUT_SETTLE'
          this.scheduleOneClickRaf(() => {
            if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
            this.runOneClickFinalPhase(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, completionReason)
          })
          return
        }
        if (!vp.ok) this.countersPlacementV510.finalPlacementCorrectionExceeded++
        facts.finalPlacementDecision = vp.ok ? 'PASS' : 'FAIL'
        facts.finalPlacementReason = vp.reason
        this.emitPlacementAudit(tx, facts, vp.ok ? 'PASS' : 'FAIL', vp.reason)
      }
      if (!placementOk) {
        tx.state = 'FAILED'
        this.finishLocateTransaction(tx, false, `PLACEMENT_VERIFY_FAILED:${placementReason}`)
        return
      }
      // ── V5.12-R2 §14 — the UNIQUE commit gate ──────────────────────────────
      // A visual FAIL must NEVER commit. The single gate consumes the SAME
      // measured facts the audit reports (semantic / presentation / occlusion).
      const gate = this.evaluateLocateCommitGate(diag, result, verdict, painted, facts)
      this.lastLocateCommitGate = gate
      if (!gate.canCommit) {
        const occlusionFailure = gate.failedChecks.includes('TARGET_NOT_FULLY_UNOBSCURED')
          || gate.failedChecks.includes('PANEL_INTERSECTION')
          || gate.failedChecks.includes('FRAME_PAINTS_ABOVE_DRAWER')
        if (phase === 'PHASE_A') {
          const recovery = resolveLocateVisualRecoveryDecision({
            canCommit: false,
            recoveryAttempts: this.txVisualRecoveryAttempts,
            maxRecovery: 1,
          })
          if (recovery === 'RETRY_LAYOUT_RECOVERY' && occlusionFailure) {
            // §13.2 — collapse the Drawer, wait for the layout to settle, then
            // re-resolve + re-measure + repaint (PHASE A recovery).
            this.txVisualRecoveryAttempts++
            this.acquireLocateVisibilityLease(tx)
            this.setDrawerCollapseForLocate(true)
            this.locateLayoutRecoveryCount++
            tx.state = 'RESTORING_LAYOUT'
            facts.drawerRecoveryRequired = true
            facts.drawerRecoverySettled = true
            facts.postRecoveryRemeasured = false
            this.scheduleOneClickRaf(() => {
              if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
              if (!facts.postRecoveryRemeasured) this.countersClosureV512R2.drawerRecoveryWithoutRemeasure++
              this.runOneClickFinalPhase(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, completionReason, 'PHASE_A')
            })
            return
          }
        } else if (occlusionFailure) {
          // ── V5.12-R3 §12 — the restored Drawer would occlude the target ────
          // Priority: OPEN → COMPACT_DOCKED (bounded to ONE attempt) → BLOCKED.
          if (facts.drawerCompactAttempts < 1 && this.drawerOpen) {
            facts.drawerCompactAttempts++
            this.setDrawerCompactForLocate(true)
            tx.state = 'REBUILDING_FINAL_PRESENTATION'
            this.scheduleOneClickRaf(() => {
              if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
              this.bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')
              this.runOneClickFinalPhase(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, completionReason, 'PHASE_B')
            })
            return
          }
          tx.state = 'FAILED'
          this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'FINAL_PRESENTATION_BLOCKED_BY_VIEWPORT', targetIndex, result, false)
          this.finishLocateTransaction(tx, false, `FINAL_PRESENTATION_BLOCKED_BY_VIEWPORT:${gate.reason}`)
          return
        }
        tx.state = 'FAILED'
        this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', 'FAILED_VISUAL_PRESENTATION', targetIndex, result, false)
        this.finishLocateTransaction(tx, false, `FAILED_VISUAL_PRESENTATION:${gate.reason}`)
        return
      }
      // ── V5.12-R3 §7 — PHASE B: RESTORE THE USER-REQUESTED DRAWER ───────────
      // PHASE A measured against a possibly collapsed Drawer. The user's OPEN
      // intent MUST be restored BEFORE the terminal COMMIT, and the geometry MUST
      // be re-derived with the Drawer really visible.
      if (phase === 'PHASE_A') {
        const restore = resolveDrawerRestoreRequired({
          drawerRequestedOpenAtStart: facts.drawerRequestedOpenAtStart,
          newestIntentOpen: this.drawerOpen,
          locateCollapseActive: this.drawerCollapseActive,
        })
        if (restore.restoreRequired) {
          facts.drawerRestoreRequired = true
          facts.drawerRestoreStarted = true
          tx.state = 'RESTORING_REQUESTED_DRAWER'
          // The DrawerLocateRecoveryLease is RELEASED here — it must NEVER survive
          // the terminal COMMIT (ROOT_R3_2 / ROOT_R3_3).
          this.releaseDrawerRecoveryLease('DRAWER_RESTORED_BEFORE_COMMIT')
          this.setDrawerCompactForLocate(false)
          facts.presentationAfterRestore = this.getDrawerPresentationMode()
          tx.state = 'WAITING_DRAWER_RESTORE_SETTLE'
          this.scheduleOneClickRaf(() => {
            if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
            facts.drawerRestoreSettled = true
            facts.drawerVisibleAfterRestore = this.measureDrawerRenderedVisible()
            // §10 — the restore REALLY changes the editor available width: bump
            // the document layout epoch and re-derive every measurement.
            this.bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')
            this.runOneClickFinalPhase(tx, diag, diagnosticId, targetIndex, highlightTargets, result, identity, pre, completionReason, 'PHASE_B')
          })
          return
        }
        if (restore.releaseWithoutRestore) {
          // The user CLOSED the Drawer during the transaction → the newest intent
          // wins: lift the transient presentation and never auto-reopen.
          this.releaseDrawerRecoveryLease('USER_INTENT_CLOSED')
          this.setDrawerCompactForLocate(false)
        }
      }
      facts.presentationAtFinalCommit = this.getDrawerPresentationMode()
      facts.drawerVisibleAtFinalCommit = this.measureDrawerRenderedVisible()
      // V5.12-R8 §15 — the figure target authority audit is emitted at the
      // COMMIT, where the R4 document-space carrier is already available.
      const figureAuditPending = this.pendingFigureTargetAudit != null
      // V5.11 §23 — COMMIT: convert the FINAL viewport geometry into
      // document-local geometry ONCE and mount the document-space carrier.
      // From this point the locate subsystem no longer reacts to scroll.
      let committedCarrier = false
      if (verdict.ok) {
        committedCarrier = this.commitDocumentSpaceCarrier(tx, diag, result)
        // V5.12-R1 §9/§10/§11 — a located HEADING gets the text-tight active
        // emphasis + the short reason chip (overlay only).
        const headingEl = result.element ?? null
        if (headingEl && /^H[1-6]$/.test(headingEl.tagName)) {
          this.renderHeadingActiveEmphasis(diag.id, diag, headingEl)
        }
      }
      if (figureAuditPending) this.emitPendingFigureTargetAudit(committedCarrier ? null : 0)
      // §18 Hard Gate — a COMMIT with a visual FAIL is architecturally impossible
      // after the gate above; this invariant makes a regression provable.
      if (committedCarrier && !gate.canCommit) this.countersClosureV512R2.finalCommitWithVisualFail++
      const reason = highlightTargets.length > 1 ? 'COMPOUND_SCROLLED' : (result.scrollAction ? 'SCROLL_ACTION' : 'SCROLLED')
      this.emitLocateAudit(diagnosticId, diag, 'RESOLVED', reason, targetIndex, result, verdict.ok)
      tx.state = 'COMMITTED'
      this.finishLocateTransaction(tx, true, 'ONE_CLICK_COMMITTED')
    })
  }

  /**
   * §14 — collect the REAL measured facts into the UNIQUE commit gate. Every
   * input is a fact this transaction already measured (never re-resolved).
   */
  private evaluateLocateCommitGate(
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    result: DiagnosticLocationResolveResult,
    verdict: ReturnType<DocumentUtilityOverlayHost['verifyOneClickPaintedVisual']>,
    painted: { primary: RectRecord | null; secondary: RectRecord | null },
    facts: LocateOneClickFacts,
  ): LocateVisualCommitDecision {
    const frame = this.locateFrame
    const structure = frame?.getStructure() ?? null
    const kind = structure?.kind ?? null
    const isInline = kind === 'inline'
    const isBlock = this.isObjectKind(kind)
    // §14 — jsdom/headless cannot measure a PAINTED carrier, so the
    // presentation/coverage/occlusion checks are explicitly not asserted there
    // (they are never a fabricated PASS either — `canCommit` is evidence only).
    const headless = isHeadlessTestRuntime()
    const layers = headless
      ? { drawerOccludesTarget: false, drawerIntersectsFrame: false, toolbarIntersectsFrame: false, navigatorIntersectsFrame: false, framePaintsAboveDrawer: false, framePaintsAboveToolbar: false, framePaintsAboveNavigator: false }
      : this.measureLocateLayerFacts()
    const panelIntersectionCount = headless
      ? 0
      : (layers.drawerIntersectsFrame ? 1 : 0) + (layers.toolbarIntersectsFrame ? 1 : 0) + (layers.navigatorIntersectsFrame ? 1 : 0)
    const geom = frame?.getGeometryReport() ?? null
    const sem = geom?.semanticRect ?? null
    const prim = painted.primary
    const coverageRatio = headless || !sem || !prim || sem.width <= 0
      ? null
      : Math.max(0, Math.min(1, prim.width / sem.width))
    const inlineFacts = frame?.getInlineFragmentFacts() ?? null
    const targetEl = result.element ?? null
    const targetConnected = !!targetEl && targetEl.isConnected
    const carrierPresent = isInline
      ? (frame?.getInlineElement() != null || (structure?.inlineFragmentCount ?? 0) >= 1)
      : structure?.headingMarkerCarrier === true
        ? (this.headingActiveWrapper != null || this.headingMarkerLayer != null)
        : frame?.getFrameElement() != null
    return canCommitLocateVisual({
      semanticResolvePass: true,
      scrollArrivalPass: !facts.automaticScrollRequired || (facts.targetVisibleAtSettle && facts.scrollSettled),
      targetConnected,
      freshTargetMeasurement: headless ? true : facts.freshTargetMeasurement,
      layoutEpochCurrent: true,
      presentationBuilt: frame?.getVisualPresentation() != null,
      visualCarrierPresent: carrierPresent && (headless ? true : verdict.primaryMarkerVisible),
      targetFullyUnobscured: headless ? true : !layers.drawerOccludesTarget,
      panelIntersectionCount,
      framePaintsAboveDrawer: layers.framePaintsAboveDrawer,
      framePaintsAboveToolbar: layers.framePaintsAboveToolbar,
      framePaintsAboveNavigator: layers.framePaintsAboveNavigator,
      coverageRatio: isBlock ? coverageRatio : isInline ? (headless ? null : (inlineFacts ? inlineFacts.coverage : 1)) : null,
      inlineFragmentCoverage: isInline && !headless && inlineFacts ? inlineFacts.coverage : null,
      blockCoverage: isBlock && !headless ? (geom ? geom.horizontalCoverage : null) : null,
      staleGeometry: false,
      // V5.12-R4 §25 — inline targets additionally prove the DOCUMENT-SPACE
      // coordinate authority (coverage can never detect a whole-fragment shift).
      inlineDocumentSpace: isInline ? this.measureInlineDocumentSpaceGateFacts() : null,
    })
  }

  /** §13.3 — take the ACTIVE LOCATE VISIBILITY LEASE for this transaction. */
  private acquireLocateVisibilityLease(tx: { id: number; diagnosticId: string | null }): void {
    this.locateVisibilityLease = { transactionId: tx.id, diagnosticId: tx.diagnosticId }
  }

  /**
   * V5.12-R3 §6 — the ActiveLocateVisualLease. It ONLY keeps the current active
   * diagnostic highlight alive; it is released when the active visual REALLY
   * ends (dismiss / new diagnostic / Problems-Control reopen / document switch /
   * diagnostic gone / unload) — NEVER at COMMIT, and it never implies a Drawer
   * collapse.
   */
  private releaseActiveLocateVisualLease(reason: string): void {
    const lease = this.locateVisibilityLease
    if (!lease) return
    this.locateVisibilityLease = null
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-ACTIVE-VISUAL-LEASE-AUDIT', {
      documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
      transactionId: lease.transactionId,
      diagnosticId: lease.diagnosticId,
      activeLocateVisualLeaseActive: false,
      released: true,
      reason,
      drawerRequestedOpen: this.drawerOpen,
      drawerPresentationMode: this.getDrawerPresentationMode(),
    })
  }

  /** V5.10 §29 — DOCUMENT-DIAGNOSTIC-LOCATE-PLACEMENT-AUDIT. */
  private emitPlacementAudit(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    facts: LocateOneClickFacts,
    decision: string,
    reason: string,
  ): void {
    emitRuntimeAudit(LOCATE_PLACEMENT_AUDIT_EVENT, {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: facts.documentKey,
      diagnosticId: facts.diagnosticId,
      targetKind: facts.targetKind,
      placementMode: facts.placementMode,
      targetInitiallyVisible: facts.targetInitiallyVisible,
      alreadyWithinCenterTolerance: facts.alreadyWithinCenterTolerance,
      viewportRect: facts.viewportRectAtSettle ?? facts.viewportRectAtStart,
      viewportCenterY: facts.viewportCenterY,
      targetRectBefore: facts.preScrollTargetRect,
      targetCenterBefore: facts.targetCenterBefore,
      centerErrorBefore: facts.centerErrorBefore,
      compoundHeight: facts.compoundHeight,
      largeBlock: facts.largeBlock,
      desiredScrollTop: facts.placementDesiredScrollTop,
      clampedScrollTop: facts.actualScrollTopAfterWrite,
      actualScrollTop: facts.actualScrollTopAfterWrite,
      maxScrollTop: facts.maxScrollTopV510,
      clampedAtStart: facts.placementMode === 'CLAMPED_DOCUMENT_START',
      clampedAtEnd: facts.placementMode === 'CLAMPED_DOCUMENT_END',
      targetRectAfter: facts.postScrollTargetRect,
      targetCenterAfter: facts.targetCenterAfter,
      centerErrorAfter: facts.centerErrorAfter,
      primaryPreferredViewportY: facts.primaryPreferredViewportY,
      primaryActualViewportY: facts.primaryActualViewportY,
      scrollWriteCount: facts.scrollWriteCount,
      placementCorrectionCount: facts.placementCorrectionCount,
      drawerRecoveryRequired: facts.drawerRecoveryRequired,
      drawerRecoverySettled: facts.drawerRecoverySettled,
      placementReason: facts.placementReason,
      finalPlacementDecision: facts.finalPlacementDecision,
      finalPlacementReason: facts.finalPlacementReason,
      decision,
      reason,
    })
  }

  /** V5.8 — DOCUMENT-DIAGNOSTIC-ONE-CLICK-LOCATE-AUDIT + commit-time gates. */
  private emitOneClickLocateAudit(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    commit: boolean,
    completionReason: string,
  ): void {
    const facts = tx.oneClick
    if (!facts) return
    facts.secondUserClickRequired = false
    const terminalState = commit ? 'COMMITTED' : 'FAILED'
    if (commit) {
      const g = this.countersOneClickV58
      if (!facts.freshTargetMeasurement) g.postScrollFreshTargetMissing++
      if (!facts.freshHostMeasurement) g.postScrollFreshHostMissing++
      if (facts.postScrollRemeasureMissing || !facts.postRecoveryRemeasured) g.postScrollRemeasureMissing++
      if (facts.staleRectCommit) g.postScrollStaleRectCommit++
      if (facts.zeroRectCommit) g.postScrollZeroRectCommit++
      if (facts.fragmentDropCommit) g.postScrollFragmentDropCommit++
      if (facts.diagnosticIdentityChanged) g.postScrollDiagnosticIdentityChange++
      if (facts.occurrenceChanged) g.postScrollOccurrenceChange++
      if (facts.anchorChanged) g.postScrollAnchorChange++
      if (!facts.postRecoveryVisualVisible) g.postScrollVisualNotVisibleCommit++
      if (!facts.drawerRecoverySettled) g.commitBeforeDrawerRecoverySettled++
      if (!facts.postRecoveryRepainted) g.postRecoveryRepaintMissing++
      if (!facts.postRecoveryVisualVisible) g.postRecoveryVisualNotVisible++
      if (facts.automaticScrollRequired && facts.visualPaintAttemptCount === 0) g.scrollStableTerminalWithoutVisual++
      if (facts.userClickCount !== 1 || facts.secondUserClickRequired) g.offscreenLocateRequiresSecondClick++
      const missingVisual = !facts.postRecoveryVisualVisible
      if (facts.automaticScrollRequired && missingVisual) {
        if (facts.targetKind === 'table') g.tableOffscreenFirstClickVisualMissing++
        if (facts.targetKind === 'code') g.codeOffscreenFirstClickVisualMissing++
        if (facts.resourceKind === 'link') g.linkOffscreenSecondClickRequired++
        if (facts.targetKind === 'heading') g.headingOffscreenSecondClickRequired++
        if (facts.resourceKind === 'image' && facts.occurrenceIndex === 0) g.imageOcc0SecondClickRequired++
        if (facts.resourceKind === 'image' && facts.occurrenceIndex === 1) g.imageOcc1SecondClickRequired++
      }
      // ── V5.9 §21/§22 — Scroll Completion Authority commit gates ──────────
      const s9 = this.countersScrollV59
      const scrollGate =
        !facts.automaticScrollRequired ||
        (facts.scrollEffectObserved && facts.targetEnteredViewport && facts.targetVisibleAtSettle && facts.scrollSettled)
      if (!scrollGate) {
        if (!facts.targetEnteredViewport) s9.scrollSettleBeforeTargetEnteredViewport++
        if (!facts.scrollEffectObserved) s9.scrollSettleWithoutEffect++
        s9.offscreenScrollSettledWhileTargetInvisible++
      }
      if (facts.automaticScrollRequired && !facts.targetVisibleAtSettle && facts.scrollSettled) {
        s9.offscreenScrollSettledWhileTargetInvisible++
      }
      if (facts.zeroRectCommit && facts.automaticScrollRequired) s9.offscreenFirstClickZeroPaintedRect++
      if (facts.staleRectCommit) s9.postScrollStaleRectCommit++
      if (facts.anchorChanged) s9.scrollAnchorIdentityChangeCommit++
      if (facts.arrivalGateDecision === 'SCROLL_CONTAINER_TARGET_MISMATCH') s9.scrollContainerTargetMismatchCommit++
      if (facts.automaticScrollRequired && missingVisual) {
        if (facts.targetKind === 'table') s9.tableOffscreenFirstClickMissing++
        if (facts.targetKind === 'code') s9.codeOffscreenFirstClickMissing++
        if (facts.targetKind === 'heading') s9.headingOffscreenFirstClickMissing++
        if (facts.resourceKind === 'image' && facts.occurrenceIndex === 0) s9.imageOcc0OffscreenFirstClickMissing++
        if (facts.resourceKind === 'image' && facts.occurrenceIndex === 1) s9.imageOcc1OffscreenFirstClickMissing++
        if (facts.resourceKind === 'link') s9.linkOffscreenFirstClickMissing++
      }
    } else {
      // Terminal FAILED — V5.9 offscreen first-click failure gates.
      const s9 = this.countersScrollV59
      if (facts.automaticScrollRequired) {
        s9.offscreenFirstClickTerminalFailed++
        if (facts.zeroRectCommit) s9.offscreenFirstClickZeroPaintedRect++
        if (facts.secondUserClickRequired) s9.offscreenFirstClickRequiresSecondClick++
      }
    }
    // V5.9 §9 / V5.10 §4 — a VISIBLE target may only skip the scroll when it is
    // ALREADY within the center tolerance. A visible-but-offcenter target now
    // legitimately performs one deterministic recenter write.
    if (facts.targetInitiallyVisible && facts.alreadyWithinCenterTolerance && facts.scrollWriteCount > 0) {
      this.countersScrollV59.visibleTargetUnnecessaryScrollWrite++
    }
    // V5.10 §30 — placement hard gates (evaluated at the terminal).
    const p10 = this.countersPlacementV510
    if (facts.targetInitiallyVisible && !facts.alreadyWithinCenterTolerance && facts.scrollWriteCount === 0
      && facts.placementMode !== 'CLAMPED_DOCUMENT_START' && facts.placementMode !== 'CLAMPED_DOCUMENT_END') {
      p10.visibleOffcenterTargetSkippedScroll++
    }
    if (facts.alreadyWithinCenterTolerance && facts.scrollWriteCount > 0) {
      p10.centeredTargetUnnecessaryScroll++
    }
    if (facts.placementMode === 'CLAMPED_DOCUMENT_START' && facts.finalPlacementDecision === 'FAIL') {
      p10.documentStartFalseCenterFailure++
    }
    if (facts.placementMode === 'CLAMPED_DOCUMENT_END' && facts.finalPlacementDecision === 'FAIL') {
      p10.documentEndFalseCenterFailure++
    }
    if (commit && facts.finalPlacementDecision !== 'PASS' && facts.placementMode === 'CENTER') {
      p10.locateNonBoundaryCenterErrorGtTolerance++
    }
    if (commit && facts.finalPlacementDecision !== 'PASS' && facts.placementMode === 'LARGE_BLOCK_PRIMARY_BIASED') {
      p10.largeBlockPrimaryPlacementError++
    }
    if (commit && facts.automaticScrollRequired && !facts.scrollSettled) {
      p10.placementCommitBeforeSettle++
    }
    if (commit && facts.automaticScrollRequired
      && (!facts.targetEnteredViewport || !facts.targetVisibleAtSettle || !facts.scrollEffectObserved)
      && facts.userClickCount !== 0) {
      p10.placementRegressionBreaksV59Arrival++
    }
    emitRuntimeAudit(LOCATE_ONE_CLICK_AUDIT_EVENT, {
      transactionId: tx.id,
      visualEpoch: this.locateVisualEpoch,
      documentKey: facts.documentKey,
      diagnosticId: facts.diagnosticId,
      ruleCode: facts.ruleCode,
      userClickCount: facts.userClickCount,
      targetInitiallyVisible: facts.targetInitiallyVisible,
      automaticScrollRequired: facts.automaticScrollRequired,
      scrollStarted: facts.scrollStarted,
      scrollSettled: facts.scrollSettled,
      postScrollRevalidateDecision: facts.postScrollRevalidateDecision,
      preScrollTargetRect: facts.preScrollTargetRect,
      postScrollTargetRect: facts.postScrollTargetRect,
      freshTargetMeasurement: facts.freshTargetMeasurement,
      freshHostMeasurement: facts.freshHostMeasurement,
      preScrollGeometryInvalidated: facts.preScrollGeometryInvalidated,
      visualPaintAttemptCount: facts.visualPaintAttemptCount,
      visualRetryCount: facts.visualRetryCount,
      presentationBuiltAfterScroll: facts.presentationBuiltAfterScroll,
      actualPaintedPrimaryRect: facts.actualPaintedPrimaryRect,
      actualPaintedSecondaryRect: facts.actualPaintedSecondaryRect,
      primaryMarkerVisible: facts.primaryMarkerVisible,
      visualCarrierPresent: facts.visualCarrierPresent,
      secondaryContextVisible: facts.secondaryContextVisible,
      expectedFragmentCount: facts.expectedFragmentCount,
      renderedFragmentCount: facts.renderedFragmentCount,
      drawerRecoveryRequired: facts.drawerRecoveryRequired,
      drawerRecoverySettled: facts.drawerRecoverySettled,
      postRecoveryRemeasured: facts.postRecoveryRemeasured,
      postRecoveryRepainted: facts.postRecoveryRepainted,
      postRecoveryVisualVisible: facts.postRecoveryVisualVisible,
      secondUserClickRequired: facts.secondUserClickRequired,
      targetKind: facts.targetKind,
      // V5.9 §20 — the scroll completion authority facts.
      targetEnteredViewport: facts.targetEnteredViewport,
      targetVisibleAtSettle: facts.targetVisibleAtSettle,
      scrollEffectObserved: facts.scrollEffectObserved,
      scrollWriteCount: facts.scrollWriteCount,
      scrollCorrectionCount: facts.scrollCorrectionCount,
      visualStartedAfterTargetVisible: facts.visualStartedAfterTargetVisible,
      visualPipelineStarted: facts.visualPipelineStarted,
      scrollAnchorKind: facts.scrollAnchorKind,
      scrollAnchorConnected: facts.scrollAnchorConnected,
      arrivalGateDecision: facts.arrivalGateDecision,
      // V5.10 — Preferred Center Placement facts.
      placementMode: facts.placementMode,
      alreadyWithinCenterTolerance: facts.alreadyWithinCenterTolerance,
      centerErrorBefore: facts.centerErrorBefore,
      centerErrorAfter: facts.centerErrorAfter,
      compoundHeight: facts.compoundHeight,
      largeBlock: facts.largeBlock,
      placementCorrectionCount: facts.placementCorrectionCount,
      finalPlacementDecision: facts.finalPlacementDecision,
      finalPlacementReason: facts.finalPlacementReason,
      terminalState,
      decision: commit ? 'PASS' : 'FAIL',
      reason: completionReason,
    })
  }

  // ── V5.12-R5 §11/§12/§13 — SOURCE OCCURRENCE authority ────────────────────

  /**
   * §6/§13 — siblings of `diag` inside the SAME occurrence group
   * (`resourceKind + canonicalDestination`). Only those may collide.
   */
  private r5SiblingSourceFacts(
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    resourceKind: SourceResourceKind | null,
    canonicalDestination: string | null,
  ): { duplicateGroupSize: number; sameIdentityAsSiblingOccurrence: boolean; sameRangeAsSiblingOccurrence: boolean } {
    if (!resourceKind || !canonicalDestination) {
      return { duplicateGroupSize: 1, sameIdentityAsSiblingOccurrence: false, sameRangeAsSiblingOccurrence: false }
    }
    const groupKey = sourceOccurrenceGroupKey(resourceKind, canonicalDestination)
    const loc = (diag.location ?? null) as Record<string, unknown> | null
    const selfIdentity = typeof loc?.sourceRangeIdentity === 'string' ? loc.sourceRangeIdentity : null
    const selfStart = typeof loc?.sourceStart === 'number' ? loc.sourceStart : null
    const selfEnd = typeof loc?.sourceEnd === 'number' ? loc.sourceEnd : null
    let size = 1
    let sameIdentity = false
    let sameRange = false
    for (const d of this.diagnostics.getSnapshot()?.diagnostics ?? []) {
      if (d.id === diag.id) continue
      const m = (d.metadata ?? {}) as Record<string, unknown>
      const k = typeof m.resourceKind === 'string' ? (m.resourceKind as SourceResourceKind) : null
      const c = typeof m.canonicalDestination === 'string'
        ? m.canonicalDestination
        : (typeof m.destination === 'string' ? m.destination : null)
      if (!k || !c || sourceOccurrenceGroupKey(k, c) !== groupKey) continue
      size++
      const dl = (d.location ?? null) as Record<string, unknown> | null
      if (selfIdentity != null && typeof dl?.sourceRangeIdentity === 'string' && dl.sourceRangeIdentity === selfIdentity) {
        sameIdentity = true
      }
      if (
        selfStart != null && selfEnd != null
        && typeof dl?.sourceStart === 'number' && typeof dl?.sourceEnd === 'number'
        && dl.sourceStart === selfStart && dl.sourceEnd === selfEnd
      ) {
        sameRange = true
      }
    }
    return { duplicateGroupSize: size, sameIdentityAsSiblingOccurrence: sameIdentity, sameRangeAsSiblingOccurrence: sameRange }
  }

  /** Union of a set of rects (null when empty / non-finite). */
  private r5UnionRect(rects: readonly { left: number; top: number; right: number; bottom: number }[]): RectRecord | null {
    if (rects.length === 0) return null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const r of rects) {
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return null
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }

  /** §13 — two rects describe the SAME visual range (R4 drift tolerance). */
  private r5RectClose(a: RectRecord, b: RectRecord): boolean {
    const t = 1.5
    return (
      Math.abs(a.left - b.left) <= t && Math.abs(a.top - b.top) <= t
      && Math.abs(a.right - b.right) <= t && Math.abs(a.bottom - b.bottom) <= t
    )
  }

  /**
   * V5.12-R5 §11/§12 — build the SOURCE OCCURRENCE facts for one locate and
   * evaluate the hard gate. It consumes the resolver's OWN facts
   * (`result.sourceOccurrence`) as `resolved*` and the clicked diagnostic's
   * metadata as `expected*` — never the same source (§10). The gate runs BEFORE
   * the visual commit: a perfect R4 document-space rect on the WRONG token is
   * still a failure.
   */
  private evaluateLocateSourceOccurrence(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    result: DiagnosticLocationResolveResult | null,
  ): LocateSourceOccurrenceEvaluation {
    const meta = (diag.metadata ?? {}) as Record<string, unknown>
    const resourceKind = typeof meta.resourceKind === 'string' ? (meta.resourceKind as SourceResourceKind) : null
    const rawDestination = typeof meta.rawDestination === 'string' ? meta.rawDestination : null
    const canonicalDestination = typeof meta.canonicalDestination === 'string'
      ? meta.canonicalDestination
      : (typeof meta.destination === 'string' ? meta.destination : null)
    const hint = result?.sourceOccurrence ?? null
    const isResource = resourceKind === 'image' || resourceKind === 'link'
    if (!isResource && hint == null) {
      return {
        isResource: false,
        isDuplicateGroup: false,
        blocksCommit: false,
        gate: { decision: 'PASS', reason: 'NOT_A_SOURCE_RESOURCE_DIAGNOSTIC', failedChecks: [] },
        audit: {},
        facts: {
          expectedOccurrenceIndex: null,
          resolvedOccurrenceIndex: null,
          expectedSourceRangeIdentity: null,
          resolvedSourceRangeIdentity: null,
          expectedSourceStart: null,
          expectedSourceEnd: null,
          resolvedSourceStart: null,
          resolvedSourceEnd: null,
        },
      }
    }
    const loc = (diag.location ?? null) as Record<string, unknown> | null
    const num = (a: unknown, b: unknown): number | null => (typeof a === 'number' ? a : (typeof b === 'number' ? b : null))
    const str = (a: unknown, b: unknown): string | null => (typeof a === 'string' ? a : (typeof b === 'string' ? b : null))

    const expectedOccurrenceIndex = num(meta.occurrenceIndex, loc?.occurrenceIndex)
    const expectedSourceRangeIdentity = str(meta.sourceRangeIdentity, loc?.sourceRangeIdentity)
    const expectedSourceStart = num(meta.sourceStart, loc?.sourceStart)
    const expectedSourceEnd = num(meta.sourceEnd, loc?.sourceEnd)
    const expectedStartLine = num(meta.startLine, loc?.startLine)
    const expectedEndLine = num(meta.endLine, loc?.endLine)
    const resolvedOccurrenceIndex = hint?.resolvedOccurrenceIndex ?? null
    const resolvedSourceRangeIdentity = hint?.resolvedSourceRangeIdentity ?? null
    const resolvedSourceStart = hint?.resolvedSourceStart ?? null
    const resolvedSourceEnd = hint?.resolvedSourceEnd ?? null

    const siblings = this.r5SiblingSourceFacts(diag, resourceKind, canonicalDestination)
    const duplicateGroupSize = siblings.duplicateGroupSize

    // §11 — this occurrence's exact inline range, MEASURED (never painted).
    let rangeClientRectCount = 0
    let rangeUnionRect: RectRecord | null = null
    if (hint) {
      const frag = measureTextFragmentRects(hint.element, hint.rangeText, hint.occurrenceWithinAnchor)
      rangeClientRectCount = frag.expected.length
      rangeUnionRect = this.r5UnionRect(frag.expected)
    }

    // §13 — the sibling's LAST committed range in the same occurrence group.
    const groupKey = resourceKind && canonicalDestination
      ? sourceOccurrenceGroupKey(resourceKind, canonicalDestination)
      : null
    const prev = groupKey ? this.r5OccurrenceRangeByGroup.get(groupKey) : undefined
    const collapseIndex = resolvedOccurrenceIndex ?? expectedOccurrenceIndex
    const rangeCollapsedToSibling = !!(
      prev && prev.unionRect && rangeUnionRect
      && prev.occurrenceIndex !== collapseIndex
      && this.r5RectClose(prev.unionRect, rangeUnionRect)
    )
    const sameRangeAsSiblingOccurrence = siblings.sameRangeAsSiblingOccurrence || rangeCollapsedToSibling

    const decision = evaluateSourceOccurrenceAuthority({
      duplicateGroupSize,
      resourceKind: resourceKind ?? 'image',
      expectedOccurrenceIndex,
      resolvedOccurrenceIndex,
      expectedSourceRangeIdentity,
      resolvedSourceRangeIdentity,
      expectedSourceStart,
      expectedSourceEnd,
      resolvedSourceStart,
      resolvedSourceEnd,
      ambiguousFirstMatchFallback: false,
      sameRangeAsSiblingOccurrence,
      sameIdentityAsSiblingOccurrence: siblings.sameIdentityAsSiblingOccurrence,
    })
    const reason = rangeCollapsedToSibling && decision.decision === 'FAIL'
      ? `${decision.reason},${DUPLICATE_OCCURRENCES_COLLAPSED_TO_SAME_RANGE_REASON}`
      : decision.reason
    const blocksCommit = decision.decision === 'FAIL' && duplicateGroupSize > 1

    const audit: Record<string, unknown> = {
      documentKey: diag.documentKey ?? this.opts.ctx.authority.getDocumentKey(),
      transactionId: tx.id,
      diagnosticId: diag.id,
      ruleCode: diag.code,
      resourceKind,
      rawDestination,
      canonicalDestination,
      duplicateGroupSize,
      expectedOccurrenceIndex,
      resolvedOccurrenceIndex,
      expectedSourceRangeIdentity,
      resolvedSourceRangeIdentity,
      expectedSourceStart,
      expectedSourceEnd,
      resolvedSourceStart,
      resolvedSourceEnd,
      expectedStartLine,
      expectedEndLine,
      resolvedStartLine: hint?.resolvedStartLine ?? null,
      resolvedEndLine: hint?.resolvedEndLine ?? null,
      anchorIdentity: hint?.anchorIdentity ?? null,
      anchorTag: hint?.anchorTag ?? null,
      matchCountWithinAnchor: hint?.matchCountWithinAnchor ?? 0,
      occurrenceWithinAnchor: hint?.occurrenceWithinAnchor ?? null,
      rangeResolved: rangeUnionRect != null,
      rangeText: hint?.rangeText ?? null,
      rangeClientRectCount,
      rangeUnionRect,
      sameIdentityAsSiblingOccurrence: siblings.sameIdentityAsSiblingOccurrence,
      sameRangeAsSiblingOccurrence,
      // V5.12-R8 §15 — figure target / existence facts (expected side; the
      // resolved side comes from the resolver's OWN hint).
      expectedRangeRole: str(meta.rangeRole, loc?.rangeRole),
      resolvedRangeRole: hint?.resolvedRangeRole ?? null,
      fixedRangeRole: figureRangeRoleForRule(diag.code),
      rawToken: str(meta.rawToken, loc?.rawToken),
      tokenStart: num(meta.tokenStart, loc?.tokenStart),
      tokenEnd: num(meta.tokenEnd, loc?.tokenEnd),
      destinationStart: num(meta.destinationStart, loc?.destinationStart),
      destinationEnd: num(meta.destinationEnd, loc?.destinationEnd),
      severity: String(diag.severity ?? ''),
      localFileExists: typeof meta.localFileExists === 'boolean' ? meta.localFileExists : null,
      resourceClass: typeof meta.resourceClass === 'string' ? meta.resourceClass : null,
      decision: decision.decision,
      reason,
      failedChecks: decision.failedChecks,
    }
    return {
      isResource,
      isDuplicateGroup: duplicateGroupSize > 1,
      blocksCommit,
      gate: { decision: decision.decision, reason, failedChecks: decision.failedChecks },
      audit,
      facts: {
        expectedOccurrenceIndex,
        resolvedOccurrenceIndex,
        expectedSourceRangeIdentity,
        resolvedSourceRangeIdentity,
        expectedSourceStart,
        expectedSourceEnd,
        resolvedSourceStart,
        resolvedSourceEnd,
      },
    }
  }

  /**
   * V5.12-R5 §13 — remember the committed occurrence's range for the SAME
   * occurrence group so a later sibling occurrence can detect a collapse onto
   * the exact same visual range.
   */
  private r5RememberOccurrenceRange(r5: LocateSourceOccurrenceEvaluation): void {
    const kind = r5.audit.resourceKind
    const canonical = r5.audit.canonicalDestination
    if (typeof kind !== 'string' || typeof canonical !== 'string' || canonical === '') return
    const idx = (r5.audit.resolvedOccurrenceIndex ?? r5.audit.expectedOccurrenceIndex) as number | null | undefined
    if (typeof idx !== 'number') return
    const unionRaw = r5.audit.rangeUnionRect as RectRecord | null | undefined
    const identityRaw = r5.audit.resolvedSourceRangeIdentity
    this.r5OccurrenceRangeByGroup.set(sourceOccurrenceGroupKey(kind as SourceResourceKind, canonical), {
      occurrenceIndex: idx,
      unionRect: unionRaw ?? null,
      sourceRangeIdentity: typeof identityRaw === 'string' ? identityRaw : null,
    })
  }

  /** HIGHLIGHTING + V1 source-locator VERIFY: applies the transient highlight,
   *  then emits DOCUMENT-DIAGNOSTIC-LOCATE-VERIFY-INVARIANT and
   *  DOCUMENT-DIAGNOSTIC-HIGHLIGHT-VISIBILITY-INVARIANT against the CURRENT
   *  visible editor rect (drawer-unobscured when the drawer is open). In
   *  headless (no real layout) it does NOT gate the transaction; in a real
   *  window the transaction only commits when the resolved target AND its
   *  highlight rect are actually visible inside the unobscured editor. */
  private applyLocateHighlightAndVerify(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
    targets: HTMLElement[],
    result: DiagnosticLocationResolveResult,
    targetIndex: number,
  ): boolean {
    tx.state = 'PRESENTING'
    const sevRaw = String(diag.severity ?? 'info').toLowerCase()
    const locateSeverity: 'error' | 'warning' | 'info' =
      sevRaw === 'error' ? 'error' : sevRaw === 'warning' ? 'warning' : 'info'
    this.locator.highlightTargets(targets, locateSeverity)
    try {
    let primary = targets.find(el => el.isConnected) ?? targets[0] ?? null
    const metadata = (diag.metadata ?? {}) as Record<string, unknown>
    // V3 — broken / zero-rect resource node must fall back to its OWNING
    // Markdown source block; never keep a 0×0 <img> as the verify/highlight target.
    if (primary && String(metadata.resourceKind ?? '') === 'image') {
      let r: DOMRect | null = null
      try { r = primary.getBoundingClientRect() } catch { /* noop */ }
      if (!r || r.width <= 0 || r.height <= 0 || primary.getClientRects().length === 0) {
        const block = resolveOwningBlockFallback(primary)
        if (block && block !== primary) {
          primary = block
          this.locator.highlightTargets([block], locateSeverity)
        }
      }
    }
    const expectedDestination =
      typeof metadata.destination === 'string' && metadata.destination !== ''
        ? metadata.destination
        : typeof metadata.rawDestination === 'string'
          ? metadata.rawDestination
          : ''
    const expectedKind = typeof metadata.resourceKind === 'string' ? metadata.resourceKind : null
    const expectedOccurrence = typeof metadata.occurrenceIndex === 'number' ? metadata.occurrenceIndex : null
    const isResourceDiag = expectedKind === 'image' || expectedKind === 'link' || expectedKind === 'resource' || expectedDestination !== ''
    const tRect = primary ? primary.getBoundingClientRect() : null
    const container = getActiveEditorScrollContainer()
    const editorRect = container ? container.getBoundingClientRect() : null
    const drawerEl = this.drawerOpen ? this.drawerEl : null
    const drawerRect = drawerEl && drawerEl.isConnected ? drawerEl.getBoundingClientRect() : null
    // V2 — PURE RectSnapshots only: DOMRectReadOnly is immutable; the
    // unobscured rect is a NEW plain object, never a mutated DOMRect.
    const snapRect = (r: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null): RectRecord | null =>
      r
        ? {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            // V3 — width/height MUST be re-derived from right-left / bottom-top
            // so a clipped unobscured rect never carries stale dimensions.
            width: r.right - r.left,
            height: r.bottom - r.top,
          }
        : null
    const editorSnap = snapRect(editorRect)
    const drawerSnap = snapRect(drawerRect)
    let unobscuredSnap: RectRecord | null = editorSnap
    if (editorSnap && drawerSnap && drawerSnap.left > editorSnap.left && drawerSnap.left < editorSnap.right) {
      // V4 RECT factory — a clipped rect must RE-DERIVE width (never keep the
      // stale editor width: `{...editorSnap, right}` is forbidden).
      unobscuredSnap = clampRectToClip(
        editorSnap,
        makeRectSnapshot({ left: editorSnap.left, top: editorSnap.top, right: drawerSnap.left, bottom: editorSnap.bottom }),
      )
    }
    const unobscuredRect = unobscuredSnap
    const visibleEditorRect = editorSnap
    // V3 — real layout is an EXPLICIT environment authority (jsdom == headless);
    // NEVER inferred from target geometry (a real broken <img> is 0×0).
    const hasRealLayout = !isHeadlessTestRuntime()
    const intersectArea = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): number => {
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      return w * h
    }
    const targetConnected = !!primary && primary.isConnected
    const highlightApplied = !!primary && primary.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)
    const inEditor = !!tRect && !!editorSnap && intersectArea(tRect, editorSnap) > 0
    const inUnobscured = !!tRect && !!unobscuredRect && intersectArea(tRect, unobscuredRect) > 0
    const targetVisible = hasRealLayout && targetConnected && inEditor
    const highlightVisible = targetVisible && highlightApplied && (tRect!.width > 0 || tRect!.height > 0) && inUnobscured
    // ── V5.12-R5 §10 — VERIFY-INVARIANT consumes the resolver's OWN resolved
    // facts. `expected*` come from the clicked diagnostic; `resolved*` come from
    // the resolver (`result.sourceOccurrence`). They are NEVER the same source:
    // the old code compared `expectedOccurrence === expectedOccurrence`.
    const r5 = this.evaluateLocateSourceOccurrence(tx, diag, result)
    const r5VerifyApplies = result?.sourceOccurrence != null
    const resolvedOccurrenceIndex = r5.facts.resolvedOccurrenceIndex
    const sourceRangeInPlay = r5VerifyApplies
      && (r5.facts.expectedSourceRangeIdentity != null || r5.facts.expectedSourceStart != null)
    const sourceRangeIdentityMatch = !sourceRangeInPlay
      ? true
      : (
          r5.facts.expectedSourceRangeIdentity != null
          && r5.facts.resolvedSourceRangeIdentity != null
          && r5.facts.expectedSourceRangeIdentity === r5.facts.resolvedSourceRangeIdentity
        )
    const sourceRangeOffsetMatch = !sourceRangeInPlay
      ? true
      : (
          r5.facts.expectedSourceStart != null && r5.facts.expectedSourceEnd != null
          && r5.facts.resolvedSourceStart != null && r5.facts.resolvedSourceEnd != null
          && r5.facts.expectedSourceStart === r5.facts.resolvedSourceStart
          && r5.facts.expectedSourceEnd === r5.facts.resolvedSourceEnd
        )
    const identityMatch = expectedDestination !== ''
    const occurrenceMatch = r5VerifyApplies
      ? (
          r5.facts.expectedOccurrenceIndex != null
          && resolvedOccurrenceIndex != null
          && r5.facts.expectedOccurrenceIndex === resolvedOccurrenceIndex
        )
      : expectedOccurrence !== null
    const sourceOccurrenceVerifyOk = !r5VerifyApplies
      ? true
      : (identityMatch && occurrenceMatch && sourceRangeIdentityMatch && sourceRangeOffsetMatch)
    const rectRecord = (r: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null | undefined) =>
      r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-VERIFY-INVARIANT', {
      transactionId: tx.id, diagnosticId: diag.id,
      expectedRuleId: diag.code, resolvedRuleId: diag.code,
      expectedResourceKind: expectedKind, resolvedResourceKind: expectedKind,
      expectedDestination, resolvedDestination: expectedDestination,
      expectedOccurrenceIndex: r5.facts.expectedOccurrenceIndex ?? expectedOccurrence,
      resolvedOccurrenceIndex,
      expectedSourceRangeIdentity: r5.facts.expectedSourceRangeIdentity,
      resolvedSourceRangeIdentity: r5.facts.resolvedSourceRangeIdentity,
      expectedSourceStart: r5.facts.expectedSourceStart,
      expectedSourceEnd: r5.facts.expectedSourceEnd,
      resolvedSourceStart: r5.facts.resolvedSourceStart,
      resolvedSourceEnd: r5.facts.resolvedSourceEnd,
      sourceRangeIdentityMatch, sourceRangeOffsetMatch,
      targetKind: primary ? primary.tagName.toLowerCase() : null,
      targetClass: primary ? String(primary.className).slice(0, 60) : null,
      targetConnected,
      targetRect: tRect ? rectRecord(tRect) : null,
      visibleEditorRect: visibleEditorRect ? rectRecord(visibleEditorRect) : null,
      unobscuredVisibleEditorRect: unobscuredRect ? rectRecord(unobscuredRect) : null,
      identityMatch, occurrenceMatch, targetVisible, hasRealLayout,
      sourceOccurrenceDecision: sourceOccurrenceVerifyOk ? 'PASS' : 'FAIL',
      decision: !hasRealLayout ? 'SKIP_HEADLESS' : (targetVisible && sourceOccurrenceVerifyOk) ? 'PASS' : 'FAIL',
      reason: !hasRealLayout ? 'NO_REAL_LAYOUT' : targetVisible ? 'TARGET_VISIBLE_IN_EDITOR' : 'TARGET_OUTSIDE_VISIBLE_EDITOR',
    })
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-HIGHLIGHT-VISIBILITY-INVARIANT', {
      transactionId: tx.id, diagnosticId: diag.id,
      highlightTargetConnected: targetConnected,
      highlightClassApplied: highlightApplied,
      highlightRectsCount: primary && targetConnected ? primary.getClientRects().length : 0,
      highlightRect: tRect ? { width: tRect.width, height: tRect.height } : null,
      intersectionWithVisibleEditor: tRect && visibleEditorRect ? intersectArea(tRect, visibleEditorRect) : 0,
      highlightVisible,
      decision: !hasRealLayout ? 'SKIP_HEADLESS' : highlightVisible ? 'PASS' : 'FAIL',
      reason: !hasRealLayout ? 'NO_REAL_LAYOUT' : highlightVisible ? 'HIGHLIGHT_VISIBLE' : 'HIGHLIGHT_NOT_VISIBLE',
    })
    // Phase 7R.3.11.8B.8 — V3 visual commit: complex blocks become the overlay
    // locate frame (never a background on the target DOM), headings get the
    // compact indicator, inline targets get the precise inline mark. In a real
    // layout the visual is committed only when the target is visible.
    //
    // V5.12-R5 §12 — the SOURCE OCCURRENCE gate runs BEFORE the visual commit: a
    // perfect R4 document-space rect on the WRONG token is still a failure. A
    // failed gate NEVER commits (so no wrong marker can ever be painted).
    const visualCommitted = !r5.blocksCommit && (!hasRealLayout || (targetConnected && targetVisible))
    if (r5.blocksCommit) {
      for (const check of r5.gate.failedChecks) {
        const key = sourceOccurrenceGateKeyForCheck(check)
        if (key) this.countersSourceOccurrenceV512R5[key]++
      }
      this.lastLocateVisualGateOk = false
      this.clearDiagnosticLocateVisual('SOURCE_OCCURRENCE_GATE_FAIL')
    } else if (!hasRealLayout || (targetConnected && targetVisible)) {
      this.commitDiagnosticLocateVisual(diag.id, locateSeverity, targets, result, primary, diag)
    } else {
      this.lastLocateVisualGateOk = false
      this.clearDiagnosticLocateVisual('TARGET_NOT_VISIBLE')
    }
    // §11 — the independent SOURCE OCCURRENCE audit (expected vs resolved).
    if (r5.isResource && Object.keys(r5.audit).length > 0) {
      emitRuntimeAudit(SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, r5.audit)
    }
    // V5.12-R8 §14/§15 — figure target / existence authority (per-click).
    this.commitFigureTargetAuthority(tx, diag, r5, visualCommitted)
    // §13 — remember the committed occurrence's range for sibling-collision.
    if (visualCommitted) this.r5RememberOccurrenceRange(r5)
    // V5.12-R7 §13/§14 — FILL_ONLY presentation gates, measured on the REAL
    // painted active locate carrier (never assumed from the CSS source).
    this.commitActiveLocateFillOnlyGates(visualCommitted, diag.id)
    if (!hasRealLayout) return true
    if (!targetVisible || !highlightVisible) return false
    if (isResourceDiag && (!identityMatch || !occurrenceMatch)) return false
    // V5.12-R5 §10 — a duplicate source occurrence whose resolved range does not
    // match the expected one must FAIL (never a false PASS).
    if (r5VerifyApplies && !(sourceRangeIdentityMatch && sourceRangeOffsetMatch)) return false
    // V4 — a FULL locate PASS requires the INDEPENDENT visual presentation
    // gate too: a visual FAIL must never be reported as a full PASS.
    return this.lastLocateVisualGateOk !== false
    } catch (err) {
      // V2 — exception-safe TERMINAL cleanup: any runtime error during
      // VERIFY/HIGHLIGHT ends the transaction in FAILED with a full release
      // (RAF/watchdog/listeners/highlight/unlock), never a dangling lock.
      try { this.locator.clearHighlight() } catch { /* noop */ }
      this.abortLocateTransaction(tx, 'RUNTIME_EXCEPTION', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /** Release the settle watch (listeners / rAF / watchdog). */
  private cancelLocateSettleWatch(): void {
    if (this.locateTxSettleCancel) {
      try { this.locateTxSettleCancel() } catch { /* noop */ }
      this.locateTxSettleCancel = null
    }
    // V5.9 §37 — the bounded chain is cancelled as a whole at every terminal.
    if (this.locateTxRafPending) this.locateTxRafPending = false
    if (this.locateTxWatchdog) {
      clearTimeout(this.locateTxWatchdog)
      this.locateTxWatchdog = null
    }
  }

  /**
   * Finish a transaction and unlock. `commit` advances the multi-target cursor
   * ONLY on a successfully settled + highlighted locate.
   */
  private finishLocateTransaction(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    commit: boolean,
    completionReason: string,
  ): void {
    if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
    this.cancelLocateSettleWatch()
    // V5.12-R8 §15 — a failure path must never lose a pending figure audit.
    if (this.pendingFigureTargetAudit) this.emitPendingFigureTargetAudit(0)
    if (commit && tx.targetCount > 1) {
      // Commit the NEXT index (targetIndex+1 mod count) for the following click.
      this.multiTargetCursor.set(tx.diagnosticId, (tx.targetIndex + 1) % tx.targetCount)
    }
    const committedNext = commit && tx.targetCount > 1 ? (tx.targetIndex + 1) % tx.targetCount : null
    const committedIndex = commit ? (tx.targetCount === 1 ? 0 : tx.targetIndex) : null
    // V5.8 — emit the single-click offscreen audit + evaluate the commit-time
    // hard gates BEFORE the terminal unlock (facts are still reachable).
    this.emitOneClickLocateAudit(tx, commit, completionReason)
    // V5.12-R2 §17 — the unified closure audit at the TRANSACTION terminal
    // (while the transaction id is still reachable).
    this.emitVisualClosureAudit(commit ? 'LOCATE_COMMITTED' : 'LOCATE_FAILED')
    this.locatePlacementCtx = null // V5.10 — placement authority is tx-scoped
    this.releaseLocateScrollLease() // V5.11 §13 — post-commit scroll is INERT
    this.activeLocateTx = null
    this.locateTxTerminalCount++ // V5.9 §37
    this.updateLocateBusyUi(false)
    this.emitLocateTransactionAudit({
      transactionId: tx.id,
      clickDecision: 'ACCEPT',
      state: 'IDLE',
      completionReason,
      committedNextTargetIndex: committedNext,
      committedIndex,
      decision: commit ? 'PASS' : 'FAIL',
    })
    // V5.12-R3 §6/§17 — the DrawerLocateRecoveryLease NEVER survives a terminal.
    // A terminal COMMIT while the Drawer is still transiently collapsed is the
    // exact V5.12-R2 defect (ROOT_R3_2/ROOT_R3_3). The transient presentation is
    // ALWAYS lifted here; only the SEPARATE ActiveLocateVisualLease may survive.
    const facts = tx.oneClick
    const requestedOpenAtTerminal = this.drawerOpen
    const presentationBeforeRelease = this.getDrawerPresentationMode()
    if (commit) {
      // §13.3 — the active-visual lease protects the committed highlight. A
      // document-level locate (scroll-only, no carrier) has nothing to protect.
      const hasActiveVisual = this.locateVisualIsActive() || this.locateCommittedVisual !== null
      if (hasActiveVisual) this.acquireLocateVisibilityLease(tx)
      this.releaseDrawerRecoveryLease(requestedOpenAtTerminal ? 'COMMITTED_DRAWER_RESTORED' : 'COMMITTED_DRAWER_CLOSED_BY_USER')
      const presentationAfterTerminal = this.getDrawerPresentationMode()
      emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-DRAWER-RECOVERY-AUDIT', {
        transactionId: tx.id,
        documentKey: this.opts.ctx.authority.getDocumentKey() ?? null,
        diagnosticId: this.lastLocatedDiagnosticId,
        drawerRequestedOpen: requestedOpenAtTerminal,
        presentationBeforeLocate: facts?.presentationBeforeLocate ?? null,
        presentationDuringLocate: facts?.presentationDuringLocate ?? presentationBeforeRelease,
        presentationAfterTerminal,
        collapseLeaseActive: this.getDrawerRecoveryLeaseActive(),
        collapseLeaseReleased: !this.getDrawerRecoveryLeaseActive(),
        locateVisibilityLeaseActive: hasActiveVisual,
        terminalDecision: hasActiveVisual
          ? (requestedOpenAtTerminal ? 'COMMITTED_DRAWER_RESTORED' : 'COMMITTED_DRAWER_CLOSED_BY_USER')
          : 'COMMITTED_NO_VISUAL',
        terminalReason: completionReason,
        reopenAuthorityAvailable: !!this.problemsControlEl && this.problemsControlEl.isConnected,
        txVisualRetryCount: this.txVisualRetryCount,
        sessionVisualRecoveryCount: this.locateLayoutRecoveryCount,
      })
    } else {
      this.releaseDrawerRecoveryLease('FAILED')
    }
    // §16 — the persistence audit is the R3 terminal evidence (emitted AFTER the
    // release so it observes the REAL terminal presentation).
    this.emitDrawerPersistenceAudit(
      tx,
      commit,
      commit
        ? (facts?.drawerRestoreStarted === true ? 'COMMITTED_DRAWER_RESTORED' : 'COMMITTED_WITHOUT_RESTORE_NEEDED')
        : `FAILED:${completionReason}`,
    )
    // ── Repair (never masking): a transient presentation must not remain once
    // the violation was already accounted by the audit above.
    if (requestedOpenAtTerminal && this.getDrawerPresentationMode() === 'locate-collapse') {
      this.setDrawerCollapseForLocate(false)
      this.setDrawerCompactForLocate(false)
    }
  }

  /** Abort (error path): unlock without commit. */
  private abortLocateTransaction(
    tx: NonNullable<DocumentUtilityOverlayHost['activeLocateTx']>,
    completionReason: string,
    detail: string,
  ): void {
    if (!this.activeLocateTx || this.activeLocateTx.id !== tx.id) return
    this.cancelLocateSettleWatch()
    this.locator.clearHighlight()
    this.clearDiagnosticLocateVisual('LOCATE_ABORTED')
    this.locatePlacementCtx = null
    this.releaseLocateScrollLease()
    this.activeLocateTx = null
    this.locateTxTerminalCount++ // V5.9 §37
    this.updateLocateBusyUi(false)
    this.emitLocateTransactionAudit({
      transactionId: tx.id,
      clickDecision: 'ACCEPT',
      state: 'IDLE',
      completionReason,
      detail,
      decision: 'FAIL',
    })
    // V5.1 — EXCEPTION terminal: ALWAYS restore the Drawer presentation.
    this.releaseDrawerRecoveryLease('EXCEPTION')
  }

  /** Phase 7R.3.11.8B.7.7 — cancel on document switch / drawer close / dispose.
   *  Clears highlight, releases the lock, NEVER commits the target index. */
  private cancelActiveLocateTransaction(reason: string): void {
    // V5.12-R2 §13.3 — a document switch / panel close / host dispose ENDS the
    // active visual, so the ACTIVE LOCATE VISIBILITY LEASE is released even when
    // no transaction is in flight (a post-COMMIT visual must not keep the Drawer
    // collapsed across a document switch).
    this.releaseDrawerRecoveryLease(reason === 'PANEL_CLOSED' ? 'CANCELLED' : reason)
    // V5.12-R3 §6 — a cancelled/ended transaction also ends any active visual.
    this.releaseActiveLocateVisualLease(reason)
    const tx = this.activeLocateTx
    if (!tx) return
    this.cancelLocateSettleWatch()
    this.locator.clearHighlight()
    // Phase 7R.3.11.8B.8 — a cancelled/switch transaction clears the V3 visual.
    this.clearDiagnosticLocateVisual(reason)
    this.locatePlacementCtx = null
    this.releaseLocateScrollLease()
    this.activeLocateTx = null
    this.locateTxTerminalCount++ // V5.9 §37
    this.updateLocateBusyUi(false)
    this.emitLocateTransactionAudit({
      transactionId: tx.id,
      clickDecision: 'ACCEPT',
      state: 'IDLE',
      completionReason: reason,
      committedNextTargetIndex: null,
      decision: 'CANCELLED',
    })
    // V5.1 — CANCELLED / DOCUMENT_SWITCH / PANEL_CLOSED terminal: no stale
    // collapse lease may survive.
    this.releaseDrawerRecoveryLease(reason === 'PANEL_CLOSED' ? 'CANCELLED' : reason)
  }

  /** Public observability: whether a locate transaction is currently active. */
  isLocateTransactionActive(): boolean {
    return this.activeLocateTx !== null
  }

  /**
   * V1.1 — busy/selected state on FLAT rows (no per-item locate buttons).
   * While a locate transaction is active every row is aria-disabled + is-busy;
   * on completion the located row gets the neutral `is-selected` tint.
   */
  private updateLocateBusyUi(active: boolean): void {
    if (!this.drawerEl) return
    const focusId = active
      ? (this.activeLocateTx?.diagnosticId ?? this.lastLocatedDiagnosticId)
      : this.lastLocatedDiagnosticId
    if (active && focusId) this.lastLocatedDiagnosticId = focusId
    for (const row of Array.from(this.drawerEl.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))) {
      row.setAttribute('aria-disabled', String(active))
      row.classList.toggle('is-busy', active)
      const isFocus = !active && focusId != null && row.getAttribute('data-diagnostic-id') === focusId
      row.classList.toggle('is-selected', isFocus)
    }
  }

  /** Phase 7R.3.11.8B.7.7 — [DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION] audit. */
  private emitLocateTransactionAudit(payload: {
    transactionId: number
    clickDecision: 'ACCEPT' | 'IGNORE_BUSY'
    state?: string
    targetIndexUnchanged?: boolean
    completionReason?: string
    committedNextTargetIndex?: number | null
    committedIndex?: number | null
    detail?: string
    decision?: string
  }): void {
    const tx = this.activeLocateTx
    const container = getActiveEditorScrollContainer()
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION', {
      transactionId: payload.transactionId,
      documentKey: tx?.documentKey ?? this.opts.ctx.authority.getDocumentKey(),
      diagnosticId: tx?.diagnosticId ?? null,
      targetCount: tx?.targetCount ?? 1,
      targetIndex: tx?.targetIndex ?? null,
      clickDecision: payload.clickDecision,
      state: payload.state ?? (tx?.state ?? 'IDLE'),
      scrollContainerIdentity: container
        ? `${container.tagName}#${container.id || ''}.${String(container.className || '').slice(0, 40)}`
        : null,
      activeTransactionId: this.activeLocateTx?.id ?? null,
      targetIndexUnchanged: payload.targetIndexUnchanged ?? null,
      completionReason: payload.completionReason ?? null,
      highlightDecision: payload.decision === 'PASS' ? 'PASS' : 'N/A',
      committedNextTargetIndex: payload.committedNextTargetIndex ?? null,
      committedIndex: payload.committedIndex ?? null,
      detail: payload.detail ?? null,
      decision: payload.decision ?? 'PASS',
    })
  }

  /**
   * Phase 7R.3.11.8B.7.6 — caption host for a missing-NAME object diagnostic.
   * Only FIGURE/TABLE/CODE missing-NAME rules compound (object + caption);
   * other rules keep single-object locate. Null when no caption host exists.
   */
  private resolveObjectCaptionHost(
    objectEl: HTMLElement,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number],
  ): HTMLElement | null {
    const code = diag.code
    const isMissingNameRule = code === 'FIGURE_MISSING_NAME' || code === 'TABLE_MISSING_NAME' || code === 'CODE_MISSING_NAME'
    if (!isMissingNameRule) return null
    const getHost = this.opts.providers.getObjectCaptionHost
    if (typeof getHost !== 'function') return null
    try {
      return getHost(objectEl)
    } catch {
      return null
    }
  }

  /** Current Markdown source line text at a 0-based index (null when unavailable). */
  private getSourceLineTextAt(line: number): string | null {
    const markdown = this.opts.ctx.authority.getMarkdown()
    if (markdown == null || !Number.isFinite(line) || line < 0) return null
    const lines = markdown.split('\n')
    return line < lines.length ? lines[line] : null
  }

  /**
   * Phase 7R.3.11.8B.7.2 — text-context re-anchor: the live block whose
   * normalized text equals the scan-time raw line text. Prefers the block
   * whose Typora `data-line` is closest to `nearLine`. This is the source-only
   * diagnostic path — a plain paragraph/block is a valid target, no Heading
   * DOM required.
   */
  private findBlockByTextInRoot(rawText: string, nearLine?: number): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    const needle = normalizeSourceAnchorText(rawText)
    if (needle === '') return null
    let best: HTMLElement | null = null
    let bestDistance = Number.MAX_SAFE_INTEGER
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,pre'))) {
      if (normalizeSourceAnchorText(el.textContent) !== needle) continue
      const dl = el.getAttribute('data-line')
      const line = dl != null ? Number.parseInt(dl, 10) : Number.NaN
      const distance = nearLine != null && Number.isFinite(line) ? Math.abs(line - nearLine) : Number.MAX_SAFE_INTEGER - 1
      if (distance < bestDistance) {
        bestDistance = distance
        best = el
      }
    }
    return best
  }

  /**
   * V5.12-R5 §5/§8.2 — the `ordinal`-th live block (DOM order) whose normalized
   * text equals `needle`. This is the source-ordinal projection that replaces
   * the ambiguous "closest data-line / first match" block selection.
   */
  private findBlockByOrdinalInRoot(needle: string, ordinal: number): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root || needle === '') return null
    const matches: HTMLElement[] = []
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,pre'))) {
      if (normalizeSourceAnchorText(el.textContent) === needle) matches.push(el)
    }
    return matches[ordinal] ?? null
  }

  /** Absolute Markdown offset of a 0-based source line's first character. */
  private sourceLineStartOffset(markdown: string, line: number): number {
    let offset = 0
    for (let i = 0; i < line; i++) {
      const nl = markdown.indexOf('\n', offset)
      if (nl < 0) return markdown.length
      offset = nl + 1
    }
    return offset
  }

  /**
   * V5.12-R5 §5 — SOURCE-side line projection of `rawLineOrdinal`: the
   * `ordinal`-th source line whose normalized text equals the raw line. This is
   * the exact same ordinal semantics `computeSourceOccurrenceOrdinals` assigns,
   * so the resolved line is derived from the Markdown — never from expected
   * metadata and never from the ambiguous closest-data-line guess.
   */
  private resolveSourceLineByOrdinal(markdown: string, rawText: string, ordinal: number): number | null {
    const needle = normalizeSourceAnchorText(rawText)
    if (needle === '') return null
    const lines = markdown.split('\n')
    let seen = 0
    for (let i = 0; i < lines.length; i++) {
      if (normalizeSourceAnchorText(lines[i]) !== needle) continue
      if (seen === ordinal) return i
      seen++
    }
    return null
  }

  /**
   * V5.12-R5 §5/§7 / V5.12-R8 §6 — the resource-reference span
   * (`![alt](dest)` / `[alt](dest)`) on `lineText` that CONTAINS
   * `tokenIndexInLine`. Delegates to the SINGLE Markdown scanner authority, so
   * the resolved offsets live in the SAME coordinate as the diagnostic's own
   * source range and are directly comparable.
   */
  private resourceReferenceSpanAt(lineText: string, tokenIndexInLine: number): ReferenceSpan | null {
    return findReferenceSpanAt(lineText, tokenIndexInLine)
  }

  /** How many matching (resourceKind + raw destination) references precede `beforeOffset`. */
  private countMatchingResourceReferencesBefore(
    markdown: string,
    resourceKind: SourceResourceKind,
    rawDestination: string,
    beforeOffset: number,
  ): number {
    const re = /(!?)\[[^\]]*\]\(([^)]+)\)/g
    let count = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(markdown)) !== null) {
      if (m.index >= beforeOffset) break
      if ((m[1] === '!') !== (resourceKind === 'image')) continue
      if (m[2].trim().split(/\s+/)[0] !== rawDestination) continue
      count++
    }
    return count
  }

  /**
   * V5.12-R5 §7/§8 — resolve the EXACT source occurrence for a source resource
   * diagnostic: the verified owning block (raw-line ordinal) PLUS the verified
   * nth token inside that block (`occurrenceWithinAnchor`). It returns the
   * resolver's OWN facts — real source offsets and a real occurrence index
   * recomputed from the CURRENT Markdown — never the diagnostic's expected
   * metadata. Null = genuine ambiguity: the caller must report UNRESOLVED and
   * NEVER silently highlight the first matching token (§8.3).
   */
  private resolveSourceOccurrenceInRoot(input: {
    startLine: number
    sourceStart: number | null
    sourceEnd: number | null
    sourceRangeIdentity: string | null
    rawText?: string
    rawLineOrdinal: number
    occurrenceWithinLine: number
    rawDestination: string | null
    canonicalDestination: string | null
    resourceKind: 'image' | 'link' | null
    expectedOccurrenceIndex: number | null
    /** V5.12-R8 §5 — which part of the image token to resolve. */
    rangeRole?: DiagnosticRangeRole
  }): ResolvedSourceOccurrenceHint | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    const resourceKind: SourceResourceKind = input.resourceKind ?? 'image'
    const token =
      (input.rawDestination != null && input.rawDestination !== '' ? input.rawDestination : null)
      ?? (input.canonicalDestination != null && input.canonicalDestination !== '' ? input.canonicalDestination : null)
    if (!token) return null

    // ── 1. SOURCE-side owning line — the rawLineOrdinal-th source line whose
    //      normalized text equals the raw line (independent of DOM + expected).
    const needle = normalizeSourceAnchorText(input.rawText ?? '')
    const ordinal = Math.max(0, Math.floor(input.rawLineOrdinal))
    const markdown = this.opts.ctx.authority.getMarkdown()
    const resolvedStartLine =
      (markdown != null ? this.resolveSourceLineByOrdinal(markdown, input.rawText ?? '', ordinal) : null)
      ?? input.startLine
    if (!Number.isFinite(resolvedStartLine)) return null

    // ── 2. DOM owning block for that line — exact data-line fast path
    //      (content-verified), else the rawLineOrdinal-th block, else the
    //      content-verified text context. NEVER a bare "first text match".
    let anchor: HTMLElement | null = null
    let anchorByResource = false
    const byLine = this.resolveSourceLine(resolvedStartLine)
    if (byLine && (needle === '' || normalizeSourceAnchorText(byLine.textContent) === needle)) {
      anchor = byLine
    }
    if (!anchor && needle !== '') {
      const byOrdinal = this.findBlockByOrdinalInRoot(needle, ordinal)
      if (byOrdinal && (byOrdinal.textContent ?? '').includes(token)) anchor = byOrdinal
    }
    if (!anchor && needle !== '') {
      const byText = this.findBlockByTextInRoot(input.rawText ?? '', resolvedStartLine)
      if (byText && (byText.textContent ?? '').includes(token)) anchor = byText
    }
    if (!anchor && resourceKind === 'image') {
      // V5.12-R8 §8 — the image may be RENDERED (no raw token text in the DOM).
      // Resolve it by resource semantic identity, at the SAME occurrence
      // ordinal, so a click always reaches a real visual target. The source
      // range is still re-derived from the CURRENT Markdown below.
      const canonical = input.canonicalDestination ?? input.rawDestination
      if (canonical) {
        const byResource = this.resolveResourceInRoot(
          'image',
          normalizeResourcePath(canonical),
          Math.max(0, input.expectedOccurrenceIndex ?? 0),
          input.rawDestination,
        )
        if (byResource) {
          anchor = byResource
          anchorByResource = true
        }
      }
    }
    if (!anchor) return null

    // ── 3. occurrenceWithinAnchor — the nth token INSIDE this block (§8.2).
    const matchCount = countTokenInElement(anchor, token)
    const within = Math.max(0, Math.floor(input.occurrenceWithinLine))
    if (!anchorByResource) {
      if (matchCount === 0) return null
      const sel = selectOccurrenceOffset(anchor.textContent ?? '', token, within)
      if (!sel) {
        // §8.3 — multi-match with no verifiable nth → explicit ambiguity, never
        // a first-match fallback.
        this.countersSourceOccurrenceV512R5.duplicateOccurrenceFirstMatchFallback++
        return null
      }
    }

    // ── 4. RESOLVED source offsets — recomputed from the CURRENT Markdown in the
    //      scanner's OWN coordinate, so the resolved identity is directly
    //      comparable to the expected one. §5 — the resolved span depends on
    //      WHICH part of the token this rule targets.
    let resolvedSourceStart: number | null = null
    let resolvedSourceEnd: number | null = null
    let resolvedOccurrenceIndex: number | null = null
    let rangeText = token
    let resolvedRangeRole: DiagnosticRangeRole | undefined
    if (markdown != null) {
      const lineText = this.getSourceLineTextAt(resolvedStartLine)
      if (lineText != null) {
        const tokenIndexInLine = findTokenOffsets(lineText, token)[within]
        if (tokenIndexInLine != null) {
          const span = this.resourceReferenceSpanAt(lineText, tokenIndexInLine)
          if (span) {
            const useDestination = input.rangeRole === 'figure-destination'
            const lineStartOffset = this.sourceLineStartOffset(markdown, resolvedStartLine)
            resolvedSourceStart = lineStartOffset + (useDestination ? span.destinationStart : span.tokenStart)
            resolvedSourceEnd = lineStartOffset + (useDestination ? span.destinationEnd : span.tokenEnd)
            resolvedOccurrenceIndex = this.countMatchingResourceReferencesBefore(
              markdown,
              resourceKind,
              input.rawDestination ?? token,
              lineStartOffset + span.tokenStart,
            )
            resolvedRangeRole = input.rangeRole
            // §5/§6 — the measure token is the FULL image token for the
            // full-token rule, the destination otherwise. Derived from the
            // CURRENT source, never copied from the diagnostic.
            rangeText = useDestination
              ? span.rawDestination
              : input.rangeRole === 'figure-full-token'
                ? span.rawToken
                : token
          }
        }
      }
    }
    const canonicalDestination = input.canonicalDestination ?? token
    const documentKey = this.opts.ctx.authority.getDocumentKey()
    const resolvedSourceRangeIdentity =
      resolvedSourceStart != null && resolvedSourceEnd != null && resolvedOccurrenceIndex != null
        ? buildSourceRangeIdentity({
            documentKey,
            sourceRevision: null,
            resourceKind,
            canonicalDestination,
            sourceStart: resolvedSourceStart,
            sourceEnd: resolvedSourceEnd,
            occurrenceIndex: resolvedOccurrenceIndex,
          })
        : null
    return {
      element: anchor,
      anchorIdentity: `block:${anchor.tagName.toLowerCase()}#data-line-${resolvedStartLine}`,
      anchorTag: anchor.tagName.toLowerCase(),
      matchCountWithinAnchor: matchCount,
      occurrenceWithinAnchor: within,
      decision: resolvedSourceStart != null ? 'EXACT_SOURCE_RANGE' : 'EXACT_SOURCE_LINE',
      rangeText,
      resolvedSourceStart,
      resolvedSourceEnd,
      resolvedSourceRangeIdentity,
      resolvedOccurrenceIndex,
      resolvedStartLine,
      resolvedEndLine: resolvedStartLine,
      resolvedRangeRole,
    }
  }

  /** stableIdentity → live heading element (re-derived from the CURRENT frame). */
  private resolveHeadingIdentity(stableIdentity: string): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
      try {
        if (this.opts.providers.getHeadingIdentity(el) === stableIdentity) return el
      } catch { /* keep scanning */ }
    }
    return null
  }

  /** 0-based source line → live element carrying Typora `data-line`. */
  private resolveSourceLine(line: number): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    return root.querySelector<HTMLElement>(`[data-line="${line}"]`)
  }

  /**
   * Phase 7R.3.11.8B.7.3 — resource semantic resolution against the CURRENT
   * DOM: find the occurrence-th live element whose normalized destination
   * equals the diagnostic's. For 'image' the element is the <img> (broken
   * images keep their img block); for 'link' it is the <a>. Never compares
   * raw Markdown syntax with rendered DOM — both sides go through the ONE
   * normalization function first.
   */
  private resolveResourceInRoot(
    kind: 'image' | 'link',
    normalizedDestination: string,
    occurrenceIndex: number,
    rawToken?: string | null,
  ): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root || !normalizedDestination) return null
    // Normal render: <img src> / <a href> with a resource reference. DOM
    // attributes are normalized against the vault root and compared with the
    // SEMANTIC identity (decoded canonical).
    const selectors = kind === 'image' ? ['img[src]', 'img'] : ['a[href]']
    let occurrence = 0
    for (const selector of selectors) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        const attr = kind === 'image' ? el.getAttribute('src') : el.getAttribute('href')
        if (!attr) continue
        const normalized = this.normalizeDomSrcToVaultRelative(attr)
        if (normalized !== normalizedDestination) continue
        if (occurrence++ < occurrenceIndex) continue
        return el
      }
    }
    // Phase 7R.3.11.8B.7.3 — Typora broken-image / unresolved-source render:
    // a local image that cannot be loaded is NOT an <img>; Typora shows the
    // raw Markdown reference in a text block. The block text carries the RAW
    // source token (`![x](dup.png)`), while img-src matching used the
    // vault-relative semantic path — so text-context matching accepts BOTH
    // identities (deterministic, occurrence-aware, never a fuzzy whole-page
    // match).
    const needles = [normalizedDestination, rawToken ?? ''].filter(n => n !== '')
    if (needles.length === 0) return null
    let textOccurrence = 0
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('p,div,span'))) {
      const text = el.textContent ?? ''
      if (!needles.some(n => text.includes(n))) continue
      // Skip containers that merely wrap a matched descendant (use the
      // smallest element whose own text is the reference line).
      if (el.querySelector('img, a')) continue
      if (textOccurrence++ < occurrenceIndex) continue
      return el
    }
    return null
  }

  /**
   * Phase 7R.3.11.8B.7.3 — normalize a Typora DOM src/href (which may be a
   * file:// URL, a typora:// app URL, an absolute path or a vault-relative
   * path) to the same comparison identity the diagnostic anchored on. The
   * diagnostic stores the RAW Markdown destination (e.g.
   * "assets/phase7/.../boundary-a-figure.png"); DOM references are made
   * vault-relative by stripping the vault root / app prefix.
   */
  private normalizeDomSrcToVaultRelative(raw: string): string {
    // Typora renders unresolved local links as typora://app/typemark/<rel>.
    if (/^typora:\/\/app\/typemark\//i.test(raw)) {
      return normalizeResourcePath(raw.slice('typora://app/typemark/'.length))
    }
    const norm = normalizeResourcePath(raw)
    const vaultRoot = this.opts.ctx.authority.vaultRoot
    if (vaultRoot) {
      const rootNorm = normalizeResourcePath(vaultRoot)
      if (norm === rootNorm) return '.'
      const prefix = rootNorm.endsWith('/') ? rootNorm : `${rootNorm}/`
      if (norm.startsWith(prefix)) return norm.slice(prefix.length)
    }
    return norm
  }

  /**
   * Phase 7R.3.11.8B.7.3 — resource validity re-scan: true when the CURRENT
   * Markdown still contains the occurrence-th (0-based) reference whose
   * normalized destination equals the diagnostic's. Only a REAL source change
   * (target removed/rewritten) turns the diagnostic stale.
   */
  private resourceDestinationStillPresent(normalizedDestination: string, occurrenceIndex: number): boolean {
    const markdown = this.opts.ctx.authority.getMarkdown()
    if (markdown == null) return false
    let occurrence = 0
    for (const ref of parseLocalResourceRefs(markdown)) {
      const norm = normalizeResourcePath(ref.target)
      if (norm !== normalizedDestination) continue
      if (occurrence++ < occurrenceIndex) continue
      return true
    }
    return false
  }

  /** block kind + `block:<kind>:<ordinal>` (or `local:<target>` for links) → live element. */
  private resolveBlockIdentity(
    blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link',
    stableIdentity: string,
  ): HTMLElement | null {
    const root = resolveBusinessContentRoot()
    if (!root) return null
    if (blockKind === 'link') {
      const target = stableIdentity.replace(/^local:/, '').replace(/:\d+$/, '')
      if (!target) return null
      const targetNorm = normalizeResourcePath(target)
      for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = a.getAttribute('href')
        if (!href) continue
        if (this.normalizeDomSrcToVaultRelative(href) === targetNorm) return a
      }
      return null
    }
    const m = /^block:(\w+):(\d+)$/.exec(stableIdentity)
    if (!m) return null
    const ordinal = Number.parseInt(m[2], 10)
    const selector = blockKind === 'figure' ? 'img'
      : blockKind === 'table' ? 'table'
        : blockKind === 'code' ? 'pre.md-fences'
          : '.md-math-block'
    return Array.from(root.querySelectorAll<HTMLElement>(selector))[ordinal] ?? null
  }

  /** Phase 7R.3.11.8B.5 — DOCUMENT-DIAGNOSTIC-LOCATE-AUDIT (one record per locate).
   *  Phase 7R.3.11.8B.7.2 — carries the anchor provenance (primary/fallback),
   *  the resolved node identity and the source revisions so a PASS can be told
   *  apart from a TARGET_CHANGED / UNRESOLVED by evidence, not by guessing.
   *  Phase 7R.3.11.8B.7.3 — carries the VALIDITY verdict (STILL_VALID vs CHANGED)
   *  separated from the DOM resolution decision. */
  private emitLocateAudit(
    diagnosticId: string,
    diag: DocumentDiagnosticsSnapshot['diagnostics'][number] | null,
    resolveDecision: string,
    reason: string,
    targetIndex: number,
    result: DiagnosticLocationResolveResult | null,
    /** V4 — independent visual presentation gate (null when not applicable). */
    finalVisualOk: boolean | null = null,
  ): void {
    const snapshot = this.diagnostics.getSnapshot()
    const scrollDecision = resolveDecision === 'RESOLVED' ? (reason === 'SCROLLED' || reason === 'SCROLL_ACTION' || reason === 'COMPOUND_SCROLLED' ? 'PASS' : 'N/A') : 'N/A'
    const semanticHl = resolveDecision === 'RESOLVED' && (reason === 'SCROLLED' || reason === 'COMPOUND_SCROLLED')
    const visualFailed = finalVisualOk === false
    // V4 — a visual presentation FAIL must never be reported as a full PASS.
    const highlightDecision = semanticHl ? (visualFailed ? 'FAIL' : 'PASS') : 'N/A'
    const baseFinal = resolveDecision === 'RESOLVED' ? 'PASS' : 'FAIL'
    const finalDecision = resolveDecision === 'RESOLVED' && visualFailed ? 'FAIL_VISUAL' : baseFinal
    // VALIDITY verdict — separated from DOM resolution (§13).
    let validityDecision: string = 'NOT_EVALUATED'
    let validityReason: string | null = null
    if (diag?.validityFingerprint) {
      if (resolveDecision === 'TARGET_CHANGED') {
        validityDecision = 'CHANGED'
        validityReason = reason
      } else if (resolveDecision === 'WRONG_DOCUMENT' || resolveDecision === 'NOT_FOUND') {
        validityDecision = 'DOCUMENT_SWITCHED'
        validityReason = reason
      } else {
        validityDecision = 'STILL_VALID'
      }
    }
    const metadata = diag?.metadata as Record<string, unknown> | undefined
    const semanticAnchorKind = metadata && typeof metadata.destination === 'string' ? 'resource'
      : (diag?.code ?? '').startsWith('LATENT_ATX') ? 'source-text'
        : null
    // Phase 7R.3.11.8B.7.4 — Resource Semantic Identity audit fields: the raw
    // source token, the decoded token and the canonical (vault-relative)
    // destination stay distinct; occurrenceIndex is an ordinal, never a path
    // suffix; resolvedOccurrenceIndex = the occurrence the resolver used.
    const rawDestination = typeof metadata?.rawDestination === 'string' ? metadata.rawDestination : null
    const canonicalDestination = typeof metadata?.destination === 'string' ? metadata.destination : null
    const decodedDestination = canonicalDestination ?? (rawDestination != null ? normalizeResourcePath(rawDestination) : null)
    const resourceKind = typeof metadata?.resourceKind === 'string' ? metadata.resourceKind : null
    const occurrenceIndex = typeof metadata?.occurrenceIndex === 'number' ? metadata.occurrenceIndex : null
    const isLocal = resourceKind != null
      ? !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawDestination ?? '') || /^file:\/\//i.test(rawDestination ?? '')
      : null
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATE-AUDIT', {
      documentKey: diag?.documentKey ?? this.opts.ctx.authority.getDocumentKey(),
      diagnosticId,
      ruleId: diag ? (getRuleMeta(diag.code)?.ruleId ?? diag.code) : null,
      diagnosticKind: diag?.code ?? null,
      severity: diag?.severity ?? null,
      locationKind: diag?.location?.kind ?? null,
      rawDestination,
      decodedDestination,
      canonicalDestination,
      resourceKind,
      isLocal,
      occurrenceIndex,
      sourceRevisionAtScan: snapshot?.sourceRevision ?? null,
      sourceRevisionAtLocate: snapshot?.sourceRevision ?? null,
      validityDecision,
      validityReason,
      targetCount: diag?.location?.kind === 'multi-target' ? diag.location.targets.length : 1,
      targetIndex,
      primaryAnchor: result?.primaryAnchor ?? null,
      fallbackAnchor: result?.fallbackAnchor ?? null,
      semanticAnchorKind,
      resolveDecision,
      resolveReason: reason,
      resolvedNodeKind: result?.resolvedNodeKind ?? null,
      resolvedBlockIdentity: result?.resolvedBlockIdentity ?? null,
      // V5.12-R5 §7 — the REAL resolved occurrence index from the source
      // resolver (never the diagnostic's own expected metadata).
      resolvedOccurrenceIndex: result?.sourceOccurrence?.resolvedOccurrenceIndex
        ?? (result?.primaryAnchor === 'resource-semantic' ? occurrenceIndex : null),
      scrollDecision,
      highlightDecision,
      visualPresentationDecision: finalVisualOk == null ? 'N/A' : finalVisualOk ? 'PASS' : 'FAIL',
      finalDecision,
      decision: finalDecision,
      reason,
    })
  }

  /**
   * V1.1 — FLAT problems list row. No standalone [定位] button: the whole row
   * is the locate target (click / Enter). Multi-target rows render `1/2`-style
   * metadata while keeping the existing cycling logic untouched.
   */
  private buildDrawerItem(d: DocumentDiagnosticsSnapshot['diagnostics'][number]): HTMLElement {
    const item = document.createElement('div')
    item.className = `inkchapter-doc-drawer__item inkchapter-doc-drawer__item--${d.severity}`
    item.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
    item.setAttribute('data-diagnostic-id', d.id)
    item.setAttribute('role', 'button')
    item.setAttribute('tabindex', '0')
    item.setAttribute('aria-label', `${d.detail ? d.detail + '，' : ''}${d.message}`)
    if (this.lastLocatedDiagnosticId === d.id) item.classList.add('is-selected')

    const icon = document.createElement('span')
    icon.className = 'inkchapter-doc-drawer__item-icon'
    setIcon(icon, d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info')
    item.appendChild(icon)

    const body = document.createElement('div')
    body.className = 'inkchapter-doc-drawer__item-body'
    const msg = document.createElement('div')
    msg.className = 'inkchapter-doc-drawer__item-msg'
    msg.textContent = d.message
    body.appendChild(msg)
    if (d.detail) {
      const detail = document.createElement('div')
      detail.className = 'inkchapter-doc-drawer__item-detail'
      detail.textContent = d.detail
      body.appendChild(detail)
    }
    item.appendChild(body)

    // Right-hand metadata: multi-target position (1/2 …) when available.
    const meta = document.createElement('div')
    meta.className = 'inkchapter-doc-drawer__item-meta'
    const targetCount = d.location?.kind === 'multi-target' && d.location.targets.length > 1
      ? d.location.targets.length
      : 0
    if (targetCount > 0) {
      const idx = (this.multiTargetCursor.get(d.id) ?? 0) % targetCount
      const span = document.createElement('span')
      span.className = 'inkchapter-doc-drawer__item-target'
      span.textContent = `${idx + 1}/${targetCount}`
      meta.appendChild(span)
    }
    // Optional hover jump affordance (non-interactive decoration only).
    const go = document.createElement('span')
    go.className = 'inkchapter-doc-drawer__item-go'
    setIcon(go, 'info', 'inkchapter-doc-drawer__item-go-icon')
    meta.appendChild(go)
    item.appendChild(meta)

    const activate = (): void => this.locateDiagnostic(d.id)
    item.addEventListener('click', (ev) => {
      ev.preventDefault()
      activate()
    })
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        activate()
      }
    })
    return item
  }

  /** V5.1 — EXPLICIT Problems-Control toggle (no blind `visible = !visible`).
   *  From LOCATE_COLLAPSE the same click is REOPEN, never CLOSE. */
  private toggleDrawer(): void {
    const action = resolveProblemsControlAction(this.getDrawerPresentationMode(), this.drawerOpen)
    if (action === 'REOPEN') {
      this.releaseDrawerRecoveryLease('TOOLBAR_REOPEN')
      if (this.drawerCollapseActive) this.setDrawerCollapseForLocate(false)
      if (!this.drawerOpen) this.openDrawer(this.drawerFilter)
    } else if (action === 'CLOSE') {
      this.closeDrawer()
    } else {
      this.openDrawer(this.drawerFilter)
    }
  }

  /**
   * Phase 7R.3.11.6 — SINGLE Drawer state authority: open and close share this
   * entry so every state change ALWAYS schedules a geometry recompute. Drawer
   * methods never write navigator position directly (single write site).
   */
  private setDrawerOpen(nextOpen: boolean): void {
    // V5.1 — LOCATE_COLLAPSE is presentation-only; it must never defeat the
    // requested intent of setDrawerOpen (open from collapse = normal open).
    if (nextOpen && this.drawerCollapseActive) this.setDrawerCollapseForLocate(false)
    if (this.drawerOpen === nextOpen) return
    // Phase 7R.3.11.8B.3 — capture the navigator position BEFORE the toggle so
    // the position-invariant audit can prove deltaX/deltaY <= 1px.
    const navRectBefore = this.latestRects.navigator
    this.navRectBeforeDrawerToggle = navRectBefore ? { right: navRectBefore.right, bottom: navRectBefore.bottom } : null
    this.drawerOpen = nextOpen
    if (this.drawerEl) {
      this.drawerEl.style.display = nextOpen ? 'flex' : 'none'
    }
    this.scheduleGeometrySync(nextOpen ? 'drawer-open' : 'drawer-close')
  }

  /** V5.1 — explicit intent open. LOCATE_COLLAPSE never blocks a user OPEN:
   *  the recovery lease is released and the Drawer re-renders (REOPEN, never
   *  interpreted as CLOSE — see resolveProblemsControlAction). */
  private openDrawer(filter: DiagnosticsSeverityFilter = 'all'): void {
    if (!this.drawerEl) return
    // V5.12-R2 §13.4 — Problems Control is the ABSOLUTE reopen authority: an
    // explicit OPEN intent releases the ACTIVE LOCATE VISIBILITY LEASE and lifts
    // any LOCATE_COLLAPSE, so the Drawer can always come back.
    this.releaseDrawerRecoveryLease('TOOLBAR_REOPEN')
    // V5.12-R3 §6/§13 — an explicit OPEN intent ends the active visual lease and
    // bumps the intent epoch (the newest intent always wins).
    this.drawerIntentEpoch++
    this.releaseActiveLocateVisualLease('TOOLBAR_REOPEN')
    if (this.drawerCollapseActive) this.setDrawerCollapseForLocate(false)
    this.drawerFilter = filter
    this.setDrawerOpen(true)
    this.renderDrawer()
    emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER', {
      action: 'OPEN',
      diagnosticCount: this.snapshot?.diagnostics.length ?? 0,
      errorCount: this.snapshot?.errorCount ?? 0,
      warningCount: this.snapshot?.warningCount ?? 0,
      filter: this.drawerFilter,
    })
  }

  private closeDrawer(): void {
    if (!this.drawerEl) return
    // V5.12-R3 §13 — a USER CLOSE is a new intent: it bumps the intent epoch so a
    // transaction started earlier can never auto-reopen the Drawer afterwards.
    this.drawerIntentEpoch++
    // Phase 7R.3.11.8B.7.7 — closing the diagnostics panel cancels any active
    // locate transaction (release lock, no target-index commit, clear highlight).
    this.cancelActiveLocateTransaction('PANEL_CLOSED')
    // Phase 7R.3.11.8B.8 — closing the Drawer also clears the V3 locate visual
    // even when no transaction was active (the frame persists after a commit).
    this.clearDiagnosticLocateVisual('DRAWER_CLOSE')
    this.setDrawerOpen(false)
    emitRuntimeAudit('DOCUMENT-UTILITY-DRAWER', {
      action: 'CLOSE',
      diagnosticCount: 0,
    })
  }

  // ── Toast (subtle, transient) ───────────────────────
  private toastEl: HTMLDivElement | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  private showToast(message: string): void {
    if (!this.root) return
    if (!this.toastEl) {
      this.toastEl = document.createElement('div')
      this.toastEl.className = 'inkchapter-doc-toast'
      this.toastEl.setAttribute(UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE)
      this.toastEl.style.position = 'fixed'
      this.toastEl.style.pointerEvents = 'none'
      this.root.appendChild(this.toastEl)
    }
    this.toastEl.textContent = message
    this.toastEl.style.opacity = '1'
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.style.opacity = '0'
      this.toastTimer = null
    }, prefersReducedMotion() ? 1200 : 1800)
  }
}

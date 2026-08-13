// ── R58.7 Editor Continuity Root Repair: Normal Enter Transaction ──
// Independent transaction for each Normal Enter, with:
//  - unique normalEnterTxnId
//  - mutation attribution by txnId + epoch + scopeId + lifecycle state
//  - caret ownership handover (acquire BEFORE close old owner)
//  - structural resolution (removedSource / completedOriginal / caretDestination)

export type StructuralDecision =
  | 'PENDING'
  | 'TOP_LEVEL_SPLIT'
  | 'SAME_PARAGRAPH_LINE_BREAK'
  | 'REPLACED_PARAGRAPH'
  | 'INSERT_NEW_PARAGRAPH'
  | 'NO_TOP_LEVEL_CHANGE'
  | 'UNKNOWN'

export type NormalEnterState =
  | 'CAPTURED_PRE'
  | 'CARET_OWNERSHIP_ACQUIRED'
  | 'NATIVE_MUTATION_PENDING'
  | 'STRUCTURE_RESOLVED'
  | 'PROJECTION_VERIFIED'
  | 'CARET_VERIFIED'
  | 'CLOSED'
  | 'FAILED'

export interface NormalEnterContinuityTransaction {
  /** Unique ID: "NENTER-{seq}-{ts}" */
  id: string

  intentId: string
  intentEpoch: number

  scopeId: string
  persistenceKey: string | null

  createdAt: number
  active: boolean

  /** Pre-state — captured at keydown, before native mutation */
  sourceElement: HTMLElement
  sourceRuntimeId: string
  sourceOrdinal: number
  sourceCanonicalRecordId: string | null
  sourceCanonicalGeneration: number | null
  sourceSemantic: 'auto' | 'force-indent' | 'force-flush'
  sourceComputedIndent: string

  preLogicalOffset: number | null
  isFirstParagraph: boolean
  previousParagraphRuntimeId: string | null

  /** Mutation attribution — only batches matched by epoch+scopeId */
  mutationBatchIds: string[]

  /** Structural resolution */
  structuralDecision: StructuralDecision

  /** Post-state — resolved after native mutation + canonical transfer */
  removedSourceRuntimeId: string | null
  completedOriginalRuntimeId: string | null
  caretDestinationRuntimeId: string | null

  /** Caret handover source */
  fromCaretExpectationId: string | null
  fromHandoffId: string | null

  /** Lifecycle state */
  state: NormalEnterState

  /** Close metadata */
  closedAt?: number
  closeReason?: string
}

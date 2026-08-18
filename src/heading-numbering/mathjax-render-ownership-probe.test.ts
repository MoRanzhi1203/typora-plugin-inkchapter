// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

/**
 * Unit tests for MathJax Render Ownership Authority classification (v2.5.7-R5.2).
 *
 * Tests the ownership CASE classifier logic (CASE A/B/C/D/E).
 * The actual probe requires real MathJax runtime; this test validates
 * the classification function with mock inputs.
 */

type OwnershipCase = 'A' | 'B' | 'C' | 'D' | 'E'

interface ClassifyInput {
  registryItemCount: number
  formula0HostMathItemCount: number
  formula1HostMathItemCount: number
  formula0VisualMjxCount: number
  formula1VisualMjxCount: number
  formula0OwnershipCandidateCount: number
  formula1OwnershipCandidateCount: number
  bodyMathItemCount: number
  editorRootMathItemCount: number
}

function classifyOwnership(input: ClassifyInput): {
  ownershipCase: OwnershipCase
  classification: string
  startupDocumentOwnsFormula0: boolean
  startupDocumentOwnsFormula1: boolean
} {
  const {
    registryItemCount,
    formula0HostMathItemCount,
    formula1HostMathItemCount,
    formula0VisualMjxCount,
    formula1VisualMjxCount,
    formula0OwnershipCandidateCount,
    formula1OwnershipCandidateCount,
  } = input

  // CASE C: Unique MathItem exists for each formula.
  if (formula0OwnershipCandidateCount === 1 && formula1OwnershipCandidateCount === 1) {
    return {
      ownershipCase: 'C',
      classification: 'R5_PRECHECK_IMPLEMENTATION_BUG',
      startupDocumentOwnsFormula0: true,
      startupDocumentOwnsFormula1: true,
    }
  }
  // CASE B: Registry exists, host getMathItemsWithin=0, but ownership candidates exist.
  if (registryItemCount > 0 && formula0HostMathItemCount === 0 && formula1HostMathItemCount === 0 && (formula0OwnershipCandidateCount > 0 || formula1OwnershipCandidateCount > 0)) {
    return {
      ownershipCase: 'B',
      classification: 'MATHITEM_CONTAINER_BOUNDARY_MISMATCH',
      startupDocumentOwnsFormula0: formula0OwnershipCandidateCount > 0,
      startupDocumentOwnsFormula1: formula1OwnershipCandidateCount > 0,
    }
  }
  // CASE A: Registry empty, visible mjx output exists.
  if (registryItemCount === 0 && (formula0VisualMjxCount > 0 || formula1VisualMjxCount > 0)) {
    return {
      ownershipCase: 'A',
      classification: 'TYPOORA_VISIBLE_MATH_NOT_OWNED_BY_STARTUP_DOCUMENT_REGISTRY',
      startupDocumentOwnsFormula0: false,
      startupDocumentOwnsFormula1: false,
    }
  }
  // CASE D: Registry exists but ownership ambiguous.
  if (registryItemCount > 0) {
    return {
      ownershipCase: 'D',
      classification: 'STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS',
      startupDocumentOwnsFormula0: formula0OwnershipCandidateCount > 0,
      startupDocumentOwnsFormula1: formula1OwnershipCandidateCount > 0,
    }
  }
  // CASE E: Fallback.
  return {
    ownershipCase: 'E',
    classification: 'MATHJAX_REGISTRY_INTROSPECTION_UNAVAILABLE',
    startupDocumentOwnsFormula0: false,
    startupDocumentOwnsFormula1: false,
  }
}

describe('Ownership Classification (v2.5.7-R5.2)', () => {
  it('CASE A: body=0, write=0, host0=0, host1=0, visible0=1, visible1=1 → TYPOORA_VISIBLE_MATH_NOT_OWNED_BY_STARTUP_DOCUMENT_REGISTRY', () => {
    const result = classifyOwnership({
      registryItemCount: 0,
      formula0HostMathItemCount: 0,
      formula1HostMathItemCount: 0,
      formula0VisualMjxCount: 1,
      formula1VisualMjxCount: 1,
      formula0OwnershipCandidateCount: 0,
      formula1OwnershipCandidateCount: 0,
      bodyMathItemCount: 0,
      editorRootMathItemCount: 0,
    })
    expect(result.ownershipCase).toBe('A')
    expect(result.classification).toBe('TYPOORA_VISIBLE_MATH_NOT_OWNED_BY_STARTUP_DOCUMENT_REGISTRY')
    expect(result.startupDocumentOwnsFormula0).toBe(false)
    expect(result.startupDocumentOwnsFormula1).toBe(false)
  })

  it('CASE B: registryCount=2, hostCount=0, only one formula has ownership candidate → MATHITEM_CONTAINER_BOUNDARY_MISMATCH', () => {
    const result = classifyOwnership({
      registryItemCount: 2,
      formula0HostMathItemCount: 0,
      formula1HostMathItemCount: 0,
      formula0VisualMjxCount: 1,
      formula1VisualMjxCount: 1,
      formula0OwnershipCandidateCount: 1,
      formula1OwnershipCandidateCount: 0,
      bodyMathItemCount: 2,
      editorRootMathItemCount: 2,
    })
    expect(result.ownershipCase).toBe('B')
    expect(result.classification).toBe('MATHITEM_CONTAINER_BOUNDARY_MISMATCH')
    expect(result.startupDocumentOwnsFormula0).toBe(true)
    expect(result.startupDocumentOwnsFormula1).toBe(false)
  })

  it('CASE C: formula0Unique=1, formula1Unique=1 → R5_PRECHECK_IMPLEMENTATION_BUG', () => {
    const result = classifyOwnership({
      registryItemCount: 2,
      formula0HostMathItemCount: 0,
      formula1HostMathItemCount: 0,
      formula0VisualMjxCount: 1,
      formula1VisualMjxCount: 1,
      formula0OwnershipCandidateCount: 1,
      formula1OwnershipCandidateCount: 1,
      bodyMathItemCount: 2,
      editorRootMathItemCount: 2,
    })
    expect(result.ownershipCase).toBe('C') // CASE C has priority over B
    expect(result.classification).toBe('R5_PRECHECK_IMPLEMENTATION_BUG')
  })

  it('CASE D: registryCount>0, no clear ownership candidate → STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS', () => {
    const result = classifyOwnership({
      registryItemCount: 3,
      formula0HostMathItemCount: 0,
      formula1HostMathItemCount: 0,
      formula0VisualMjxCount: 1,
      formula1VisualMjxCount: 1,
      formula0OwnershipCandidateCount: 0,
      formula1OwnershipCandidateCount: 0,
      bodyMathItemCount: 3,
      editorRootMathItemCount: 3,
    })
    expect(result.ownershipCase).toBe('D')
    expect(result.classification).toBe('STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS')
  })

  it('CASE D: registryCount>0, ownershipCandidateCount>1 but not unique → STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS', () => {
    const result = classifyOwnership({
      registryItemCount: 3,
      formula0HostMathItemCount: 1,
      formula1HostMathItemCount: 1,
      formula0VisualMjxCount: 1,
      formula1VisualMjxCount: 1,
      formula0OwnershipCandidateCount: 2, // >1, not unique
      formula1OwnershipCandidateCount: 2,
      bodyMathItemCount: 3,
      editorRootMathItemCount: 3,
    })
    expect(result.ownershipCase).toBe('D')
    expect(result.classification).toBe('STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS')
  })

  it('CASE E: no registry, no visible output → MATHJAX_REGISTRY_INTROSPECTION_UNAVAILABLE', () => {
    const result = classifyOwnership({
      registryItemCount: 0,
      formula0HostMathItemCount: 0,
      formula1HostMathItemCount: 0,
      formula0VisualMjxCount: 0,
      formula1VisualMjxCount: 0,
      formula0OwnershipCandidateCount: 0,
      formula1OwnershipCandidateCount: 0,
      bodyMathItemCount: 0,
      editorRootMathItemCount: 0,
    })
    expect(result.ownershipCase).toBe('E')
    expect(result.classification).toBe('MATHJAX_REGISTRY_INTROSPECTION_UNAVAILABLE')
  })
})
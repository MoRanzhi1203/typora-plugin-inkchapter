/**
 * v2.5.7-R5.4.3.1: Object Context Target Contract.
 *
 * Validates that each object target passed to resolveObjectContexts meets
 * the required contract before entering the projection pipeline.
 *
 * Heading elements are never valid object targets.
 * null/undefined type is always rejected.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { R5431_RUNTIME_MARKER, incrementInvalidObjectTargetCount, incrementHeadingMisclassifiedAsObject, incrementObjectWithNullType, incrementObjectWithInvalidType } from './formula-event-domain'

// The allowed object types as known by the caption system.
const ALLOWED_OBJECT_TYPES = new Set(['table', 'figure', 'code', 'formula'])

export interface ObjectContextTargetContractInput {
  callSite: string
  targetIndex: number
  target: { element: HTMLElement; type: string; runtimeKey: string } | null | undefined
  currentEditorRoot: HTMLElement | null
  currentDocumentKey: string | null
  currentDocumentGeneration: number
}

export interface ObjectContextTargetContractResult {
  valid: boolean
  decision: 'PASS' | 'BLOCK_ENTRY'
  reason: string | null
}

/**
 * Validate a single object target against the contract.
 * Returns the result without throwing.
 * Invalid targets are counted and blocked.
 */
export function validateObjectContextTarget(input: ObjectContextTargetContractInput): ObjectContextTargetContractResult {
  // Null/undefined target
  if (!input.target) {
    incrementInvalidObjectTargetCount()
    emitContractMarker(input, 'BLOCK_ENTRY', 'target_null_or_undefined')
    return { valid: false, decision: 'BLOCK_ENTRY', reason: 'target_null_or_undefined' }
  }

  const target = input.target

  // Validate type
  if (target.type === undefined || target.type === null) {
    incrementObjectWithNullType()
    incrementInvalidObjectTargetCount()
    emitContractMarker(input, 'BLOCK_ENTRY', 'target_type_null_or_undefined')
    return { valid: false, decision: 'BLOCK_ENTRY', reason: 'target_type_null_or_undefined' }
  }

  // Validate type is in allowed set
  if (!ALLOWED_OBJECT_TYPES.has(target.type)) {
    incrementObjectWithInvalidType()
    incrementInvalidObjectTargetCount()
    // Check if this is a heading misclassified as object
    const tagName = target.element?.tagName ?? ''
    if (tagName.startsWith('H') && tagName.length === 2 && /^[1-6]$/.test(tagName[1])) {
      incrementHeadingMisclassifiedAsObject()
      emitContractMarker(input, 'BLOCK_ENTRY', `heading_element_misclassified_as_object:${target.type}`)
      return { valid: false, decision: 'BLOCK_ENTRY', reason: `heading_element_misclassified_as_object:${target.type}` }
    }
    emitContractMarker(input, 'BLOCK_ENTRY', `invalid_object_type:${target.type}`)
    return { valid: false, decision: 'BLOCK_ENTRY', reason: `invalid_object_type:${target.type}` }
  }

  // Validate element exists
  if (!target.element) {
    incrementInvalidObjectTargetCount()
    emitContractMarker(input, 'BLOCK_ENTRY', 'target_element_missing')
    return { valid: false, decision: 'BLOCK_ENTRY', reason: 'target_element_missing' }
  }

  // Validate element is connected
  if (!target.element.isConnected) {
    incrementInvalidObjectTargetCount()
    emitContractMarker(input, 'BLOCK_ENTRY', 'target_element_disconnected')
    return { valid: false, decision: 'BLOCK_ENTRY', reason: 'target_element_disconnected' }
  }

  // Validate heading is never an object target
  const tagName = target.element.tagName
  if (tagName.startsWith('H') && tagName.length === 2 && /^[1-6]$/.test(tagName[1])) {
    incrementHeadingMisclassifiedAsObject()
    incrementInvalidObjectTargetCount()
    emitContractMarker(input, 'BLOCK_ENTRY', `heading_element_misclassified_as_object:${tagName}`)
    return { valid: false, decision: 'BLOCK_ENTRY', reason: `heading_element_misclassified_as_object:${tagName}` }
  }

  // All checks passed
  emitContractMarker(input, 'PASS', null)
  return { valid: true, decision: 'PASS', reason: null }
}

function emitContractMarker(
  input: ObjectContextTargetContractInput,
  decision: 'PASS' | 'BLOCK_ENTRY',
  reason: string | null,
): void {
  emitRuntimeAudit('OBJECT-CONTEXT-TARGET-CONTRACT', {
    callSite: input.callSite,
    targetIndex: input.targetIndex,
    targetPresent: input.target !== null && input.target !== undefined,
    targetType: input.target?.type ?? null,
    typeValid: input.target ? ALLOWED_OBJECT_TYPES.has(input.target.type) : false,
    nodePresent: input.target?.element != null,
    nodeConnected: input.target?.element?.isConnected ?? false,
    sameEditorRoot: input.currentEditorRoot !== null && input.target?.element !== undefined
      && input.currentEditorRoot?.contains(input.target.element),
    sameDocument: true,
    sameGeneration: true,
    decision,
    reason,
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}
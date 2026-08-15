/**
 * EmptySpecial Runtime Test Hook — one-shot controlled failure injection.
 *
 * TS1-Fix3 closure infrastructure: exercises the Failed-Txn failure path in a
 * REAL runtime WITHOUT changing production business behavior.
 *
 * Safety contract (HARD):
 *  - default disabled (no config file → no effect)
 *  - only armed in the test vault + explicit config + document match + remaining>0
 *  - only overrides the effective visual-verify result (original → false)
 *  - never writes Markdown / Selection / DOM / canonical / sidecar
 *  - never focuses or touches caret
 */

import * as fs from 'fs'
import * as path from 'path'

export type EmptySpecialTestHookName =
  | 'FORCE_VISUAL_VERIFY_FAIL_ONCE'
  | 'FORCE_CARET_GEOMETRY_FAIL_ONCE'

/** On-disk one-shot config: <vault>/.typora/inkchapter/runtime-test-hook.json */
export interface EmptySpecialTestHookFile {
  hook?: string
  document?: string
  remaining?: number
}

export interface EmptySpecialTestHookEvaluateInput {
  hook: string | null
  configuredDocument: string | null
  activeDocumentKey: string | null
  activeFilePath: string | null
  remaining: number
  isTestVault: boolean
  originalVisualVerify: boolean
}

export interface EmptySpecialTestHookEvaluateResult {
  armed: boolean
  consumed: boolean
  reason: string | null
  originalVisualVerify: boolean
  effectiveVisualVerify: boolean
  remainingBefore: number
  remainingAfter: number
}

const SUPPORTED_VISUAL_HOOK: string = 'FORCE_VISUAL_VERIFY_FAIL_ONCE'

export function isTestVaultRoot(vaultRoot: string | null | undefined): boolean {
  if (!vaultRoot) return false
  const norm = vaultRoot.replace(/\\/g, '/')
  return /(^|\/)test\/vault(\/|$)/i.test(norm)
}

export function isTestVaultPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  const norm = filePath.replace(/\\/g, '/')
  return /test\/vault/i.test(norm)
}

export function resolveHookConfigPath(vaultRoot: string | null | undefined): string | null {
  if (!vaultRoot) return null
  return path.join(vaultRoot, '.typora', 'inkchapter', 'runtime-test-hook.json')
}

export function readEmptySpecialTestHookFile(vaultRoot: string | null | undefined): EmptySpecialTestHookFile | null {
  const p = resolveHookConfigPath(vaultRoot)
  if (!p) return null
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as EmptySpecialTestHookFile
    return null
  } catch {
    return null
  }
}

export function writeEmptySpecialTestHookFile(
  vaultRoot: string | null | undefined,
  config: EmptySpecialTestHookFile,
): boolean {
  const p = resolveHookConfigPath(vaultRoot)
  if (!p) return false
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Pure decision: should the one-shot visual-verify failure hook fire?
 * Never throws; returns a structured decision. Only `FORCE_VISUAL_VERIFY_FAIL_ONCE`
 * is implemented (first version).
 */
export function evaluateEmptySpecialTestHook(
  input: EmptySpecialTestHookEvaluateInput,
): EmptySpecialTestHookEvaluateResult {
  const base: EmptySpecialTestHookEvaluateResult = {
    armed: false,
    consumed: false,
    reason: null,
    originalVisualVerify: input.originalVisualVerify,
    effectiveVisualVerify: input.originalVisualVerify,
    remainingBefore: input.remaining,
    remainingAfter: input.remaining,
  }

  if (!input.isTestVault) return { ...base, reason: 'NOT_TEST_VAULT' }
  if (input.hook !== SUPPORTED_VISUAL_HOOK) return { ...base, reason: 'HOOK_NOT_CONFIGURED' }
  if (!(typeof input.remaining === 'number' && input.remaining > 0)) return { ...base, reason: 'REMAINING_ZERO' }

  const activeDoc = input.activeDocumentKey ?? input.activeFilePath ?? ''
  if (input.configuredDocument && !String(activeDoc).includes(input.configuredDocument)) {
    return { ...base, reason: 'DOCUMENT_MISMATCH' }
  }

  return {
    armed: true,
    consumed: true,
    reason: null,
    originalVisualVerify: input.originalVisualVerify,
    effectiveVisualVerify: false,
    remainingBefore: input.remaining,
    remainingAfter: input.remaining - 1,
  }
}

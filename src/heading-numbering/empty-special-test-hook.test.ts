// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  evaluateEmptySpecialTestHook,
  isTestVaultRoot,
  isTestVaultPath,
} from './empty-special-test-hook'

function input(overrides = {}) {
  return {
    hook: 'FORCE_VISUAL_VERIFY_FAIL_ONCE',
    configuredDocument: 'r58-empty-special-failure-path-01.md',
    activeDocumentKey: 'r58-empty-special-failure-path-01.md',
    activeFilePath: 'D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/r58-empty-special-failure-path-01.md',
    remaining: 1,
    isTestVault: true,
    originalVisualVerify: true,
    ...overrides,
  }
}

describe('FAILHOOK — EmptySpecial one-shot runtime test hook', () => {
  it('FAILHOOK-1: default disabled → armed=false', () => {
    const r = evaluateEmptySpecialTestHook(input({ hook: null, remaining: 0 }))
    expect(r.armed).toBe(false)
    expect(r.consumed).toBe(false)
    expect(r.effectiveVisualVerify).toBe(true)
  })

  it('FAILHOOK-2: only FORCE_VISUAL_VERIFY_FAIL_ONCE is supported', () => {
    const r = evaluateEmptySpecialTestHook(input({ hook: 'UNKNOWN_HOOK' }))
    expect(r.armed).toBe(false)
    expect(r.reason).toBe('HOOK_NOT_CONFIGURED')
  })

  it('FAILHOOK-3: remaining=0 → REMAINING_ZERO', () => {
    const r = evaluateEmptySpecialTestHook(input({ remaining: 0 }))
    expect(r.armed).toBe(false)
    expect(r.reason).toBe('REMAINING_ZERO')
  })

  it('FAILHOOK-4: document mismatch → DOCUMENT_MISMATCH', () => {
    const r = evaluateEmptySpecialTestHook(input({
      configuredDocument: 'other.md',
      activeDocumentKey: 'r58-empty-special-failure-path-01.md',
    }))
    expect(r.armed).toBe(false)
    expect(r.reason).toBe('DOCUMENT_MISMATCH')
  })

  it('FAILHOOK-5: not test vault → NOT_TEST_VAULT', () => {
    const r = evaluateEmptySpecialTestHook(input({ isTestVault: false }))
    expect(r.armed).toBe(false)
    expect(r.reason).toBe('NOT_TEST_VAULT')
  })

  it('FAILHOOK-6: armed → consumed → effectiveVisualVerify=false, remaining decremented', () => {
    const r = evaluateEmptySpecialTestHook(input())
    expect(r.armed).toBe(true)
    expect(r.consumed).toBe(true)
    expect(r.originalVisualVerify).toBe(true)
    expect(r.effectiveVisualVerify).toBe(false)
    expect(r.remainingBefore).toBe(1)
    expect(r.remainingAfter).toBe(0)
  })

  it('FAILHOOK-7: not armed never changes effective visual verify', () => {
    const r = evaluateEmptySpecialTestHook(input({ hook: null, originalVisualVerify: true }))
    expect(r.effectiveVisualVerify).toBe(true)
  })

  it('FAILHOOK-8: isTestVaultRoot / isTestVaultPath recognize test/vault', () => {
    expect(isTestVaultRoot('D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault')).toBe(true)
    expect(isTestVaultRoot('D:\\some\\other\\vault')).toBe(false)
    expect(isTestVaultPath('D:/TyporaPluginProjects/typora-plugin-inkchapter/test/vault/a.md')).toBe(true)
  })
})

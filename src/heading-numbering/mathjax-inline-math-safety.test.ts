// @vitest-environment jsdom
/**
 * R12 — MathJax render-input hook must NEVER inject a display tag into an
 * INLINE math render call.
 *
 * Root-cause guard: the hook correlates block Formula plans by TeX source hash.
 * An inline formula whose TeX is identical to a block formula (e.g. `$a = 1$`
 * next to `$$ a = 1 $$`) used to receive `\tag{1-1}`, which MathJax rejects in
 * inline mode — the inline formula then renders blank / as an error.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureMathJaxRenderInputHook,
  getMathJaxHookCallStats,
  isMathJaxRenderInputHookInstalled,
  uninstallMathJaxRenderInputHook,
} from './mathjax-render-input-hook'
import type { FormulaProjectionController } from './formula-projection-controller'

type Tex2Svg = (tex: unknown, options?: unknown) => unknown

interface FakeMathJax {
  tex2svgPromise: Tex2Svg
  tex2svg?: Tex2Svg
}

function installFakeMathJax(impl: (tex: string, options?: unknown) => Promise<unknown>): FakeMathJax {
  const fake: FakeMathJax = {
    tex2svgPromise: ((tex, options) => impl(String(tex), options)) as Tex2Svg,
  }
  ;(globalThis as unknown as { MathJax?: FakeMathJax }).MathJax = fake
  return fake
}

function fakeController(host: HTMLElement): FormulaProjectionController {
  return {
    inventory: () => ({ planCount: 1, uniqueSourceHashCount: 1, expectedPlanCount: 1 }),
    prepareTransientRenderInput: (tex: string) => {
      if (tex.trim() !== 'a = 1') {
        return { tex, injected: false, authority: 'defer', sourceHash: 'h-other' }
      }
      return {
        tex: `${tex}\\tag{1-1}`,
        injected: true,
        authority: 'inkchapter-native-transient',
        sourceHash: 'h-a1',
        planSetEpoch: 1,
        activationId: 1,
        signatureHash: 'sig',
        host,
      }
    },
    getPlan: () => ({ formulaRuntimeKey: 'formula:1', rawNumber: '1-1', renderedNumber: '(1-1)' }),
    getPlanBySourceHash: () => undefined,
    getHostBySourceHash: () => null,
    isCurrentActivation: () => true,
    markStaleActivationCommitIgnored: () => undefined,
  } as unknown as FormulaProjectionController
}

function installHook(): void {
  const host = document.createElement('div')
  host.className = 'md-math-block'
  document.body.appendChild(host)
  const installed = ensureMathJaxRenderInputHook({
    getLiveContext: () => ({ documentKey: 'doc.md', controller: fakeController(host), headingSnapshotRevision: 1 }),
  })
  expect(installed).toBe(true)
}

afterEach(() => {
  uninstallMathJaxRenderInputHook()
  delete (globalThis as unknown as { MathJax?: unknown }).MathJax
  document.body.innerHTML = ''
})

describe('MathJax hook — inline formula safety', () => {
  it('does not inject a display tag into an inline render call', async () => {
    const calls: Array<{ tex: string; options?: unknown }> = []
    installFakeMathJax(async (tex, options) => {
      calls.push({ tex, options })
      return { rendered: tex }
    })
    installHook()

    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    await M.tex2svgPromise('a = 1', { display: false })

    expect(calls).toHaveLength(1)
    expect(calls[0].tex).not.toContain('\\tag')
  })

  it('still injects the semantic tag into a display (block) render call', async () => {
    const calls: Array<{ tex: string; options?: unknown }> = []
    installFakeMathJax(async (tex, options) => {
      calls.push({ tex, options })
      return { rendered: tex }
    })
    installHook()

    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    await M.tex2svgPromise('a = 1', { display: true })

    expect(calls).toHaveLength(1)
    expect(calls[0].tex).toBe('a = 1\\tag{1-1}')
  })

  it('retries the ORIGINAL input when the tagged render rejects', async () => {
    const calls: string[] = []
    installFakeMathJax(async (tex) => {
      calls.push(tex)
      if (tex.includes('\\tag')) throw new Error('tag not allowed in inline mode')
      return { rendered: tex }
    })
    installHook()

    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    const result = await M.tex2svgPromise('a = 1', { display: true })

    expect(calls).toEqual(['a = 1\\tag{1-1}', 'a = 1'])
    expect(result).toEqual({ rendered: 'a = 1' })
  })

  it('retries when MathJax RESOLVES with an error node (no rejection)', async () => {
    const calls: string[] = []
    installFakeMathJax(async (tex) => {
      calls.push(tex)
      if (tex.includes('\\tag')) {
        const error = document.createElement('mjx-container')
        const merror = document.createElement('mjx-merror')
        merror.setAttribute('data-mjx-error', 'tag not allowed in inline mode')
        error.appendChild(merror)
        return error
      }
      return { rendered: tex }
    })
    installHook()

    const before = getMathJaxHookCallStats().fallbackCount
    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    const result = await M.tex2svgPromise('a = 1', { display: true })

    expect(calls).toEqual(['a = 1\\tag{1-1}', 'a = 1'])
    expect(result).toEqual({ rendered: 'a = 1' })
    expect(getMathJaxHookCallStats().fallbackCount).toBe(before + 1)
  })

  it('does not inject into a SYNC tex2svg inline call (editor preview path)', () => {
    const calls: Array<{ tex: string; options?: unknown }> = []
    const fake: FakeMathJax = {
      tex2svgPromise: (tex => Promise.resolve({ rendered: tex })) as Tex2Svg,
      tex2svg: ((tex, options) => {
        calls.push({ tex: String(tex), options })
        return { rendered: tex }
      }) as Tex2Svg,
    }
    ;(globalThis as unknown as { MathJax?: FakeMathJax }).MathJax = fake
    installHook()

    fake.tex2svg!('a = 1', { display: false })

    expect(calls).toHaveLength(1)
    expect(calls[0].tex).not.toContain('\\tag')
  })

  it('still injects when Typora omits display (block render path)', async () => {
    const calls: string[] = []
    installFakeMathJax(async (tex) => {
      calls.push(tex)
      return { rendered: tex }
    })
    installHook()

    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    await M.tex2svgPromise('a = 1')

    expect(calls).toEqual(['a = 1\\tag{1-1}'])
  })

  it('counts inline skips and display modes without injecting tags', async () => {
    installFakeMathJax(async (tex) => ({ rendered: tex }))
    installHook()

    const before = getMathJaxHookCallStats()
    const M = (globalThis as unknown as { MathJax: FakeMathJax }).MathJax
    await M.tex2svgPromise('a = 1', { display: false })
    await M.tex2svgPromise('E = mc^2', { display: false })
    await M.tex2svgPromise('a = 1')

    const after = getMathJaxHookCallStats()
    expect(after.displayFalseCount - before.displayFalseCount).toBe(2)
    expect(after.inlineSkippedCount - before.inlineSkippedCount).toBe(2)
    expect(after.displayUnknownCount - before.displayUnknownCount).toBe(1)
    expect(after.injectedCount - before.injectedCount).toBe(1)
  })

  it('restores the original MathJax entry points on uninstall', async () => {
    const fake = installFakeMathJax(async (tex) => ({ rendered: tex }))
    const originalPromise = fake.tex2svgPromise
    installHook()

    expect(isMathJaxRenderInputHookInstalled()).toBe(true)
    uninstallMathJaxRenderInputHook()

    expect(isMathJaxRenderInputHookInstalled()).toBe(false)
    expect(fake.tex2svgPromise).toBe(originalPromise)
    await fake.tex2svgPromise('a = 1', { display: false })
  })
})

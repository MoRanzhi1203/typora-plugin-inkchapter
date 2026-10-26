// @vitest-environment node
/**
 * P0 §7.1 — 构建 fail-fast 门禁（可判错）。
 *
 * 历史事故：曾删除 `NAVIGATION_AUDIT_KEYS` 导致 `tsc` 与定向测试失败，但 esbuild
 * 仍成功产出文件 → 构建“绿灯”掩盖了类型错误。为防回归，本测试断言：
 *   1. `build:dev` / `build` 脚本必须在调用 `node build.js` **之前**先跑 typecheck；
 *   2. `typecheck` 脚本存在且为 `tsc --noEmit`；
 *   3. 历史被误删的导出 `NAVIGATION_AUDIT_KEYS` 仍存在且覆盖要求的导航键。
 *
 * 任一断言失败即证明构建门禁被回退（曾在真实事故中发生）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

interface Pkg { scripts?: Record<string, string> }

function readPkg(): Pkg {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as Pkg
}

describe('P0 §7.1 构建 fail-fast 门禁', () => {
  it('build:dev / build 必须先 typecheck 再 build.js（tsc 失败不得被 esbuild 掩盖）', () => {
    const scripts = readPkg().scripts ?? {}
    for (const name of ['build:dev', 'build']) {
      const s = scripts[name]
      expect(s, `${name} 缺失`).toBeTruthy()
      const typecheckAt = s.indexOf('typecheck')
      const buildAt = s.indexOf('build.js')
      expect(typecheckAt, `${name} 未包含 typecheck`).toBeGreaterThan(-1)
      expect(buildAt, `${name} 未包含 build.js`).toBeGreaterThan(-1)
      expect(typecheckAt, `${name} 中 typecheck 必须早于 build.js`).toBeLessThan(buildAt)
    }
  })

  it('存在独立的 typecheck 脚本且使用 tsc --noEmit', () => {
    const scripts = readPkg().scripts ?? {}
    expect(scripts.typecheck ?? '').toContain('tsc')
    expect(scripts.typecheck ?? '').toContain('--noEmit')
  })

  it('REGRESSION GUARD：NAVIGATION_AUDIT_KEYS 导出仍存在且覆盖方向/Home/End/翻页', async () => {
    const mod = await import('../document-utilities/document-diagnostic-caret-isolation-v1')
    const keys = mod.NAVIGATION_AUDIT_KEYS
    expect(Array.isArray(keys)).toBe(true)
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(keys as readonly string[]).toContain(k)
    }
  })
})

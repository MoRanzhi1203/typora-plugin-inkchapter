import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = process.cwd()

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

/** The compiled plugin subclass region around the onload entry. */
function pluginEntrySnippet(bundle: string): string {
  const marker = bundle.indexOf('INKCHAPTER-BOOT-ONLOAD-START')
  if (marker < 0) return ''
  return bundle.slice(Math.max(0, marker - 600), Math.min(bundle.length, marker + 200))
}

describe('Phase 6.0R plugin constructor / bundle boot compatibility', () => {
  it('BOOT-T1: authoritative production build is node build.js --prod, not Rollup ES5 downlevel', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toBe('node build.js --prod')
  })

  it('BOOT-T1/T3: production bundle keeps native class inheritance and has no illegal base apply/call', () => {
    const bundle = read('dist/main.js')
    // The illegal ES5 __extends helper and its _super.apply/_super.call are the root cause.
    expect(bundle).not.toContain('__extends')
    expect(bundle).not.toContain('_super')
    expect(bundle).not.toContain('Plugin.apply')
    expect(bundle).not.toContain('Plugin.call')
    expect(bundle).not.toContain('.apply(this,arguments)')
    expect(bundle).not.toContain('Object.setPrototypeOf')

    const snippet = pluginEntrySnippet(bundle)
    expect(snippet).toContain('INKCHAPTER-BOOT-ONLOAD-START')
    // Native class + super() (not a downleveled IIFE).
    expect(snippet).toContain('class extends')
    expect(snippet).toContain('super(')
  })

  it('BOOT-T2: subclass extends the externalized runtime core Plugin (no bundled duplicate core)', () => {
    const bundle = read('dist/main.js')
    // The loader exposes the runtime core via this symbol; the plugin must consume it,
    // not bundle a second incompatible Plugin implementation.
    expect(bundle).toContain('Symbol.for("typora-plugin-core@v2")')

    // The runtime core actually loaded by the vault is a native-class core.
    const core = read('node_modules/@typora-community-plugin/core/dist/core.js')
    expect(core).toContain('class extends')
    expect(core).not.toContain('__extends')
    expect(core).not.toContain('Object.setPrototypeOf')
  })

  it('BOOT-T4: onload entry is reachable with explicit boot markers', () => {
    const source = read('src/main.ts')
    expect(source).toContain('INKCHAPTER-BOOT-ONLOAD-START')
    expect(source).toContain('INKCHAPTER-BOOT-ONLOAD-SUCCESS')
  })

  it('BOOT-T5: module load and constructor success are distinct from runtime ready', () => {
    const source = read('src/main.ts')
    // Module load and constructor success must be observable before onload, so a
    // moduleLoad=true / constructor=false state can never be read as runtime-ready.
    expect(source).toContain('INKCHAPTER-BOOT-MODULE-LOAD')
    expect(source).toContain('INKCHAPTER-BOOT-CONSTRUCTOR-SUCCESS')
  })
})

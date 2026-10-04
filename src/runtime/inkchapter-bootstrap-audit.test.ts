import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_AUDIT_EVENT,
  resolveBootstrapProvenance,
  resolveUserLevelAuditDir,
} from './inkchapter-bootstrap-audit'

const base = {
  processId: 4321,
  pluginId: 'ranzhi.inkchapter',
  buildMarker: 'build-x',
  runtimeModulePath: null,
  frameworkReportedPluginRoot: null,
  frameworkReportedPluginId: null,
  userHome: 'C:/Users/Someone',
}

describe('InkChapter global bootstrap provenance (V1 §A)', () => {
  it('BOOT-1: a global bundle path classifies as loadSource=GLOBAL', () => {
    const r = resolveBootstrapProvenance({
      ...base,
      runtimeModulePath: 'C:/Users/Someone/.typora/community-plugins/plugins/ranzhi.inkchapter/main.js',
    })
    expect(r.entryModuleEvaluated).toBe(true)
    expect(r.loadSource).toBe('GLOBAL')
    expect(r.actualPluginRoot).toBe('C:/Users/Someone/.typora/community-plugins/plugins/ranzhi.inkchapter')
    expect(r.actualManifestPath).toBe(`${r.actualPluginRoot}/manifest.json`)
    expect(r.decision).toBe('PASS')
  })

  it('BOOT-2: a vault-local bundle path classifies as loadSource=VAULT_LOCAL', () => {
    const r = resolveBootstrapProvenance({
      ...base,
      runtimeModulePath: 'D:/proj/test/vault/.typora/plugins/dist/main.js',
    })
    expect(r.loadSource).toBe('VAULT_LOCAL')
  })

  it('BOOT-3: an unknown executing path is never reported as GLOBAL', () => {
    const r = resolveBootstrapProvenance({ ...base, runtimeModulePath: null })
    expect(r.loadSource).toBe('UNKNOWN')
    expect(r.actualBundlePath).toBeNull()
    expect(r.decision).toBe('UNKNOWN')
  })

  it('BOOT-4: the audit dir is USER-LEVEL (no vault/workspace dependency)', () => {
    expect(resolveUserLevelAuditDir('C:/Users/Someone')).toBe(
      path.join('C:/Users/Someone', '.typora', 'inkchapter', 'audit'),
    )
    expect(resolveUserLevelAuditDir('')).toBeNull()
    expect(resolveUserLevelAuditDir(null)).toBeNull()
    expect(BOOTSTRAP_AUDIT_EVENT).toBe('INKCHAPTER-BOOTSTRAP-AUDIT')
  })

  it('BOOT-5: the module hardcodes NO absolute user/project path', () => {
    const src = readFileSync('src/runtime/inkchapter-bootstrap-audit.ts', 'utf8')
    expect(/C:\\+Users/i.test(src)).toBe(false)
    expect(/D:\\+TyporaPluginProjects/i.test(src)).toBe(false)
    expect(/test[\\/]+vault/i.test(src)).toBe(false)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildInkChapterGlobalLoadAudit,
  GLOBAL_PLUGIN_LAYOUT,
  INKCHAPTER_PLUGIN_ID,
  normalizeAuthorityPath,
  resolveDocumentDirectory,
  resolveInkChapterPathAuthority,
  toInkChapterDocumentContext,
} from './inkchapter-path-authority'

const base = {
  userHome: 'C:/Users/Someone',
  reportedInstallRoot: null,
  documentPath: null,
  workspaceRoot: null,
  vaultRoot: null,
  localDotTyporaPresent: false,
  localInkChapterPluginPresent: false,
}

describe('InkChapter path authority (global closure V1.1 §5-§10)', () => {
  it('GP-AUTH-1: global install root is resolved from the injected user home (no hardcode)', () => {
    const a = resolveInkChapterPathAuthority(base)
    expect(a.installRootAuthority).toBe('USER_HOME_COMMUNITY_PLUGINS')
    expect(a.globalPluginRoot).toBe(`C:/Users/Someone/${GLOBAL_PLUGIN_LAYOUT}/${INKCHAPTER_PLUGIN_ID}`)
    expect(a.globalMainPath).toBe(`${a.globalPluginRoot}/main.js`)
    expect(a.globalStylePath).toBe(`${a.globalPluginRoot}/style.css`)
    expect(a.pluginLoadMode).toBe('global')
  })

  it('GP-AUTH-2: a framework-reported install root wins', () => {
    const a = resolveInkChapterPathAuthority({ ...base, reportedInstallRoot: 'D:/plugins/ranzhi.inkchapter' })
    expect(a.installRootAuthority).toBe('FRAMEWORK_REPORTED')
    expect(a.globalPluginRoot).toBe('D:/plugins/ranzhi.inkchapter')
  })

  it('GP-AUTH-3: single-file mode — document path, no workspace, no vault', () => {
    const a = resolveInkChapterPathAuthority({ ...base, documentPath: 'D:/AnyFolder/a.md' })
    expect(a.documentDir).toBe('D:/AnyFolder')
    expect(a.workspaceRoot).toBeNull()
    expect(a.vaultRoot).toBeNull()
    expect(a.documentPath).toBe('D:/AnyFolder/a.md')
    expect(a.pluginLoadMode).toBe('global')
  })

  it('GP-AUTH-4: nested directory keeps the DOCUMENT-CENTRIC resource base', () => {
    const a = resolveInkChapterPathAuthority({
      ...base,
      documentPath: 'D:/Docs/Research/2026/Paper/chapter/part/a.md',
    })
    expect(a.documentDir).toBe('D:/Docs/Research/2026/Paper/chapter/part')
  })

  it('GP-AUTH-5: a nested file inside a vault root does NOT redefine the document dir', () => {
    const a = resolveInkChapterPathAuthority({
      ...base,
      documentPath: 'D:/Docs/Research/2026/Paper/a.md',
      workspaceRoot: 'D:/Docs/Research',
      vaultRoot: 'D:/Docs/Research',
    })
    expect(a.documentDir).toBe('D:/Docs/Research/2026/Paper')
    expect(a.vaultRoot).toBe('D:/Docs/Research')
    // document dir and vault root are distinct authorities, never conflated
    expect(a.documentDir).not.toBe(a.vaultRoot)
  })

  it('GP-AUTH-6: space + unicode paths survive resolution', () => {
    const a = resolveInkChapterPathAuthority({
      ...base,
      userHome: 'C:/Users/墨染 止',
      documentPath: 'C:/我的 笔记/论文/一、背景.md',
    })
    expect(a.globalPluginRoot).toBe(`C:/Users/墨染 止/${GLOBAL_PLUGIN_LAYOUT}/${INKCHAPTER_PLUGIN_ID}`)
    expect(a.documentDir).toBe('C:/我的 笔记/论文')
  })

  it('GP-AUTH-7: a local test-vault install is reported as test-vault mode', () => {
    const a = resolveInkChapterPathAuthority({
      ...base,
      documentPath: 'D:/proj/test/vault/docs/a.md',
      localDotTyporaPresent: true,
      localInkChapterPluginPresent: true,
    })
    expect(a.pluginLoadMode).toBe('test-vault')
    expect(a.localDotTyporaPresent).toBe(true)
  })

  it('GP-AUTH-8: the global-load audit reports the external-directory expectation', () => {
    const a = resolveInkChapterPathAuthority({ ...base, documentPath: 'D:/External/a.md' })
    const audit = buildInkChapterGlobalLoadAudit(a, true, 1)
    expect(audit.localDotTyporaPresent).toBe(false)
    expect(audit.localInkChapterPluginPresent).toBe(false)
    expect(audit.globalPluginLoaded).toBe(true)
    expect(audit.pluginLoadMode).toBe('global')
    expect(audit.decision).toBe('PASS')
    expect(audit.reason).toBe('GLOBAL_PLUGIN_LOADED_WITHOUT_LOCAL_DOT_TYPORA')
  })

  it('GP-AUTH-9: helpers normalise separators and reject blanks', () => {
    expect(normalizeAuthorityPath('D:\\Docs\\')).toBe('D:/Docs')
    expect(normalizeAuthorityPath('   ')).toBeNull()
    expect(normalizeAuthorityPath(null)).toBeNull()
    expect(resolveDocumentDirectory('a.md')).toBeNull()
    expect(resolveDocumentDirectory('/a.md')).toBe('/')
  })

  it('GP-AUTH-11: DocumentContext field set is split, vaultRoot may be null (§6)', () => {
    const a = resolveInkChapterPathAuthority({ ...base, documentPath: 'D:/AnyFolder/a.md' })
    const dc = toInkChapterDocumentContext(a)
    expect(dc.documentPath).toBe('D:/AnyFolder/a.md')
    expect(dc.documentDir).toBe('D:/AnyFolder')
    expect(dc.workspaceRoot).toBeNull()
    expect(dc.vaultRoot).toBeNull()
    expect(dc.pluginInstallRoot).toBe(a.globalPluginRoot)
    expect(dc.pluginLoadMode).toBe('global')
  })

  it('GP-AUTH-10: the module hardcodes NO absolute user/project path (gate=0)', () => {
    const src = readFileSync('src/runtime/inkchapter-path-authority.ts', 'utf8')
    expect(/C:\\+Users/i.test(src)).toBe(false)
    expect(/D:\\+TyporaPluginProjects/i.test(src)).toBe(false)
    expect(/test[\\/]+vault/i.test(src)).toBe(false)
    expect(src.includes('ranzhi.inkchapter')).toBe(true)
  })
})

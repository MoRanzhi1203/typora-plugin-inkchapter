/**
 * DOCVIEW-* / PATH-* / Clipboard targeted tests for the Document View context.
 *
 * Pure path semantics — no DOM / typora. All paths are Windows style.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDocumentViewContext,
  computeRelativeInsideRoot,
  isPathInsideRoot,
  normalizeRelativeForClipboard,
  isUnsavedTabId,
  looksLikeSavedFilePath,
  REASON_UNSAVED,
  REASON_OUTSIDE_ROOT,
  REASON_NO_ROOT,
  REASON_FILE_MISSING,
  type DocumentViewContextInput,
} from './document-view-context'

const W_VAULT = 'D:\\TyporaPluginProjects\\typora-plugin-inkchapter\\test\\vault'

function ctx(tabId: string | null, opts: Partial<DocumentViewContextInput> = {}): ReturnType<typeof resolveDocumentViewContext> {
  return resolveDocumentViewContext({
    tabId,
    fileTreeRoot: opts.fileTreeRoot ?? null,
    fileExists: opts.fileExists ?? (() => true),
  })
}

describe('DOCVIEW-1/2 target = right-clicked tab (never the active doc)', () => {
  it('resolves the RIGHT-CLICKED tab path, independent of any active doc', () => {
    const a = ctx('D:\\vault\\a.md', { fileTreeRoot: 'D:\\vault' })
    const b = ctx('D:\\vault\\sub\\b.md', { fileTreeRoot: 'D:\\vault' })
    expect(a.absolutePath).toBe('D:\\vault\\a.md')
    expect(b.absolutePath).toBe('D:\\vault\\sub\\b.md')
    expect(a.relativePath).toBe('a.md')
    expect(b.relativePath).toBe('sub/b.md')
  })
})

describe('DOCVIEW-3 unsaved tab', () => {
  it('empty/Untitled id → every path action disabled, close-all still enabled', () => {
    for (const id of ['', 'typ://core.empty', null]) {
      const c = ctx(id)
      expect(c.isSavedDocument).toBe(false)
      expect(c.absolutePath).toBeNull()
      expect(c.canCopyAbsolutePath).toBe(false)
      expect(c.canCopyRelativePath).toBe(false)
      expect(c.canRevealInFileTree).toBe(false)
      expect(c.canRevealInExplorer).toBe(false)
      expect(c.canCloseAllTabs).toBe(true)
      expect(c.disabledReason.copyAbsolutePath).toBe(REASON_UNSAVED)
      expect(c.disabledReason.revealInFileTree).toBe(REASON_UNSAVED)
    }
  })
})

describe('DOCVIEW-4 duplicate basenames in different directories', () => {
  it('path identity, not basename, disambiguates', () => {
    const one = ctx('D:\\vault\\dir1\\README.md', { fileTreeRoot: 'D:\\vault' })
    const two = ctx('D:\\vault\\dir2\\README.md', { fileTreeRoot: 'D:\\vault' })
    expect(one.relativePath).toBe('dir1/README.md')
    expect(two.relativePath).toBe('dir2/README.md')
    expect(one.absolutePath).not.toBe(two.absolutePath)
  })
})

describe('DOCVIEW-5 no file-tree root (single-file mode)', () => {
  it('copy absolute + explorer enabled; relative/tree disabled with no-root reason', () => {
    const c = ctx('D:\\outside\\a.md', { fileTreeRoot: null })
    expect(c.fileTreeRoot).toBeNull()
    expect(c.canCopyAbsolutePath).toBe(true)
    expect(c.canRevealInExplorer).toBe(true)
    expect(c.canCopyRelativePath).toBe(false)
    expect(c.canRevealInFileTree).toBe(false)
    expect(c.disabledReason.copyRelativePath).toBe(REASON_NO_ROOT)
    expect(c.disabledReason.revealInFileTree).toBe(REASON_NO_ROOT)
  })
})

describe('DOCVIEW-6 file outside current file-tree root', () => {
  it('copy absolute + explorer enabled; relative/tree disabled with outside-root reason', () => {
    const c = ctx('D:\\other-vault\\a.md', { fileTreeRoot: 'D:\\vault' })
    expect(c.canCopyAbsolutePath).toBe(true)
    expect(c.canRevealInExplorer).toBe(true)
    expect(c.canCopyRelativePath).toBe(false)
    expect(c.canRevealInFileTree).toBe(false)
    expect(c.disabledReason.copyRelativePath).toBe(REASON_OUTSIDE_ROOT)
    expect(c.disabledReason.revealInFileTree).toBe(REASON_OUTSIDE_ROOT)
  })
})

describe('PATH-1 nested file', () => {
  it('produces runtime/smoke/Document-Test.md (normalized /)', () => {
    const c = ctx(`${W_VAULT}\\runtime\\smoke\\Document-Test.md`, { fileTreeRoot: W_VAULT })
    expect(c.relativePath).toBe('runtime/smoke/Document-Test.md')
  })
})

describe('PATH-2 root filename', () => {
  it('produces a.md', () => {
    const c = ctx(`${W_VAULT}\\a.md`, { fileTreeRoot: W_VAULT })
    expect(c.relativePath).toBe('a.md')
  })
})

describe('PATH-3 Windows separator normalization', () => {
  it('relative path for clipboard only contains /', () => {
    const rel = computeRelativeInsideRoot(W_VAULT, `${W_VAULT}\\dir\\nested\\x.md`)
    expect(rel).toBe('dir\\nested\\x.md')
    expect(rel!.includes('/')).toBe(false)
    expect(normalizeRelativeForClipboard(rel!)).toBe('dir/nested/x.md')
    expect(normalizeRelativeForClipboard('a\\b')).toBe('a/b')
    expect(normalizeRelativeForClipboard('a/b')).toBe('a/b')
  })
})

describe('PATH-4 sibling prefix collision (vault vs vault2)', () => {
  it('never treats a sibling-prefixed folder as inside', () => {
    expect(isPathInsideRoot('C:\\work\\vault', 'C:\\work\\vault2\\a.md')).toBe(false)
    expect(isPathInsideRoot('C:\\work\\vault', 'C:\\work\\vault\\a.md')).toBe(true)
    const c = ctx('C:\\work\\vault2\\a.md', { fileTreeRoot: 'C:\\work\\vault' })
    expect(c.isInsideFileTreeRoot).toBe(false)
    expect(c.relativePath).toBeNull()
  })
})

describe('PATH-5 outside root', () => {
  it('never yields ../../ outside.md', () => {
    const rel = computeRelativeInsideRoot('D:\\vault', 'D:\\outside.md')
    expect(rel).toBeNull()
    const c = ctx('D:\\outside.md', { fileTreeRoot: 'D:\\vault' })
    expect(c.relativePath).toBeNull()
    expect(c.canCopyRelativePath).toBe(false)
  })

  it('cross-drive file is never inside', () => {
    expect(isPathInsideRoot('D:\\vault', 'C:\\vault\\a.md')).toBe(false)
  })
})

describe('PATH-6 no root / PATH-7 unsaved', () => {
  it('null root yields null relative; unsaved id yields null relative', () => {
    expect(computeRelativeInsideRoot('', 'D:\\vault\\a.md')).toBeNull()
    expect(computeRelativeInsideRoot('D:\\vault', '')).toBeNull()
    expect(ctx(null, { fileTreeRoot: 'D:\\vault' }).relativePath).toBeNull()
    expect(ctx('', { fileTreeRoot: 'D:\\vault' }).relativePath).toBeNull()
    expect(ctx('typ://x', { fileTreeRoot: 'D:\\vault' }).relativePath).toBeNull()
  })
})

describe('tab id classifiers', () => {
  it('isUnsavedTabId / looksLikeSavedFilePath', () => {
    expect(isUnsavedTabId('')).toBe(true)
    expect(isUnsavedTabId(null)).toBe(true)
    expect(isUnsavedTabId('typ://core.empty')).toBe(true)
    expect(isUnsavedTabId('D:\\vault\\a.md')).toBe(false)
    expect(looksLikeSavedFilePath('')).toBe(false)
    expect(looksLikeSavedFilePath('D:\\vault\\a.md')).toBe(true)
    expect(looksLikeSavedFilePath('relative.md')).toBe(false)
  })
})

describe('missing file guards (unsaved/outside/deleted boundaries)', () => {
  it('copy absolute stays enabled for a deleted file; tree/explorer disabled with reason', () => {
    const c = resolveDocumentViewContext({
      tabId: `${W_VAULT}\\gone.md`,
      fileTreeRoot: W_VAULT,
      fileExists: () => false,
    })
    expect(c.canCopyAbsolutePath).toBe(true)
    expect(c.canCopyRelativePath).toBe(true) // path math is independent of fs
    expect(c.canRevealInFileTree).toBe(false)
    expect(c.canRevealInExplorer).toBe(false)
    expect(c.disabledReason.revealInFileTree).toBe(REASON_FILE_MISSING)
    expect(c.disabledReason.revealInExplorer).toBe(REASON_FILE_MISSING)
  })

  it('root itself is never a document (empty relative → null)', () => {
    expect(computeRelativeInsideRoot(W_VAULT, W_VAULT)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  canonicalPathForCompare,
  collectDroppedFilePaths,
  fileUriToPath,
  isExternalFileDrag,
  isInternalFileTreeDrag,
  isMarkdownPath,
  isPathInsideRoot,
  isSamePath,
  resolveDropDirectory,
  resolveModifiedState,
  shouldWarnStaleDragOut,
  uniqueFileName,
} from './file-transfer-policy'

const ROOT = 'D:\\vault'

describe('file-transfer-policy · path safety', () => {
  it('accepts the root itself and descendants', () => {
    expect(isPathInsideRoot(ROOT, ROOT)).toBe(true)
    expect(isPathInsideRoot(ROOT, 'D:\\vault\\docs')).toBe(true)
    expect(isPathInsideRoot(ROOT, 'D:\\vault\\docs\\a.md')).toBe(true)
  })

  it('does not treat a sibling prefix as a descendant', () => {
    expect(isPathInsideRoot(ROOT, 'D:\\vault2')).toBe(false)
    expect(isPathInsideRoot(ROOT, 'D:\\vault2\\a.md')).toBe(false)
    expect(isPathInsideRoot(ROOT, 'D:\\other\\a.md')).toBe(false)
    expect(isPathInsideRoot(ROOT, 'D:\\vault\\..\\escape\\a.md')).toBe(false)
  })

  it('compares paths case-insensitively on Windows', () => {
    if (process.platform !== 'win32') return
    expect(isSamePath('D:\\Vault\\A.md', 'd:\\vault\\a.md')).toBe(true)
    expect(canonicalPathForCompare('D:\\Vault\\A.md')).toBe(canonicalPathForCompare('d:\\vault\\a.md'))
  })

  it('recognises markdown extensions only', () => {
    expect(isMarkdownPath('a.md')).toBe(true)
    expect(isMarkdownPath('a.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a.txt')).toBe(false)
    expect(isMarkdownPath('a.md.bak')).toBe(false)
    expect(isMarkdownPath('')).toBe(false)
  })
})

describe('file-transfer-policy · drag classification', () => {
  it('classifies Explorer drops by the Files type', () => {
    expect(isExternalFileDrag(['Files'])).toBe(true)
    expect(isExternalFileDrag(['Files', 'text/uri-list'])).toBe(true)
    expect(isExternalFileDrag(['file', 'text/plain'])).toBe(false)
    expect(isExternalFileDrag([])).toBe(false)
  })

  it('classifies internal Typora tree drags without Files', () => {
    expect(isInternalFileTreeDrag(['file', 'text/plain'])).toBe(true)
    expect(isInternalFileTreeDrag(['Files'])).toBe(false)
    expect(isInternalFileTreeDrag([])).toBe(false)
  })
})

describe('file-transfer-policy · dropped paths', () => {
  it('reads Electron File.path values', () => {
    const paths = collectDroppedFilePaths({
      files: [
        { path: 'D:\\src\\a.md' },
        { path: 'D:\\src\\b.markdown' },
      ],
    })
    expect(paths).toEqual(['D:\\src\\a.md', 'D:\\src\\b.markdown'])
  })

  it('falls back to text/uri-list when File.path is unavailable', () => {
    const paths = collectDroppedFilePaths({
      files: [],
      getData: format => format === 'text/uri-list'
        ? 'file:///D:/src/a.md\r\nfile:///D:/src/b%20c.md\r\n# comment'
        : '',
    })
    expect(paths).toEqual(['D:\\src\\a.md', 'D:\\src\\b c.md'])
  })

  it('deduplicates paths', () => {
    const paths = collectDroppedFilePaths({
      files: [{ path: 'D:\\src\\a.md' }, { path: 'D:\\src\\a.md' }],
    })
    expect(paths).toHaveLength(1)
  })

  it('parses Windows file URIs', () => {
    expect(fileUriToPath('file:///D:/a/b.md')).toBe('D:\\a\\b.md')
    expect(fileUriToPath('https://example.com/a.md')).toBeNull()
  })
})

describe('file-transfer-policy · drop target', () => {
  it('uses a directory node as the destination', () => {
    expect(resolveDropDirectory('D:\\vault\\docs', true, ROOT)).toBe('D:\\vault\\docs')
  })

  it('uses the parent directory for a file node', () => {
    expect(resolveDropDirectory('D:\\vault\\docs\\a.md', false, ROOT)).toBe('D:\\vault\\docs')
  })

  it('falls back to the vault root', () => {
    expect(resolveDropDirectory(null, true, ROOT)).toBe('D:\\vault')
  })

  it('rejects a node outside the vault (directory traversal)', () => {
    expect(resolveDropDirectory('D:\\other\\docs', true, ROOT)).toBeNull()
    expect(resolveDropDirectory('D:\\vault\\..\\other\\docs', true, ROOT)).toBeNull()
  })

  it('rejects everything when no vault is open', () => {
    expect(resolveDropDirectory('D:\\vault\\docs', true, null)).toBeNull()
  })
})

describe('file-transfer-policy · drag-out warnings and naming', () => {
  it('warns only when the dragged file is the modified active document', () => {
    expect(shouldWarnStaleDragOut('D:\\vault\\a.md', 'D:\\vault\\a.md', true)).toBe(true)
    expect(shouldWarnStaleDragOut('D:\\vault\\a.md', 'D:\\vault\\a.md', false)).toBe(false)
    expect(shouldWarnStaleDragOut('D:\\vault\\a.md', 'D:\\vault\\b.md', true)).toBe(false)
  })

  it('builds numbered conflict names preserving the extension', () => {
    expect(uniqueFileName('note.md', 1)).toBe('note.md')
    expect(uniqueFileName('note.md', 2)).toBe('note (2).md')
    expect(uniqueFileName('note.markdown', 3)).toBe('note (3).markdown')
  })
})

describe('file-transfer-policy · modified state resolution', () => {
  it('trusts hasMidified when it is true', () => {
    expect(resolveModifiedState(true, '# a', '# a')).toEqual({ modified: true, source: 'hasMidified' })
  })

  it('falls back to savedContent when hasMidified lags behind', () => {
    expect(resolveModifiedState(false, '# a\n\n', '# a')).toEqual({ modified: true, source: 'savedContent' })
    expect(resolveModifiedState(undefined, 'x', 'y')).toEqual({ modified: true, source: 'savedContent' })
  })

  it('normalizes CRLF so line endings alone are not a modification', () => {
    expect(resolveModifiedState(false, 'a\r\nb', 'a\nb')).toEqual({ modified: false, source: 'none' })
  })

  it('returns false when content is equal or unavailable', () => {
    expect(resolveModifiedState(false, 'a', 'a')).toEqual({ modified: false, source: 'none' })
    expect(resolveModifiedState(false, null, 'a')).toEqual({ modified: false, source: 'none' })
    expect(resolveModifiedState(false, 'a', undefined)).toEqual({ modified: false, source: 'none' })
  })
})

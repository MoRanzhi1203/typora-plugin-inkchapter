import { describe, it, expect } from 'vitest'
import { NativeDragBridge, type LstatLike } from './native-drag-bridge'

const ROOT = 'D:\\vault'
const DOC = 'D:\\vault\\note.md'

function lstatOf(kind: 'file' | 'symlink' | 'missing'): (filePath: string) => LstatLike {
  return () => {
    if (kind === 'missing') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return {
      isFile: () => kind === 'file',
      isSymbolicLink: () => kind === 'symlink',
    }
  }
}

describe('NativeDragBridge · capability probe', () => {
  it('reports the Typora-native IPC drag-out path as delegated', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      getElectron: () => ({ ipcRenderer: { send: () => undefined } }),
    })
    const capability = bridge.probe()

    expect(capability.platform).toBe('win32')
    expect(capability.electronReachable).toBe(true)
    expect(capability.ipcRendererAvailable).toBe(true)
    expect(capability.nativeDragOut).toBe('DELEGATED_TO_TYPORA')
    expect(capability.sourceCopyGuarantee).toBe('OS_DELEGATED')
  })

  it('marks drag-out unavailable when the renderer bridge is missing', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      getElectron: () => null,
    })
    const capability = bridge.probe()

    expect(capability.electronReachable).toBe(false)
    expect(capability.ipcRendererAvailable).toBe(false)
    expect(capability.nativeDragOut).toBe('UNAVAILABLE')
    expect(capability.fallback.length).toBeGreaterThan(0)
  })

  it('treats macOS as delegated through the Typora bridge', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'darwin',
      getElectron: () => null,
    })
    expect(bridge.probe().nativeDragOut).toBe('DELEGATED_TO_TYPORA')
  })
})

describe('NativeDragBridge · drag-source safety inspection', () => {
  it('detects a normal file with no warning', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: lstatOf('file'),
    })
    const inspection = bridge.inspect(DOC, DOC, false)

    expect(inspection).toMatchObject({ exists: true, isFile: true, symlink: false })
    expect(bridge.warningFor(inspection)).toBeNull()
  })

  it('warns when the active document has unsaved modifications', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: lstatOf('file'),
    })
    const inspection = bridge.inspect(DOC, DOC, true)

    expect(inspection.staleDueToUnsavedChanges).toBe(true)
    expect(bridge.warningFor(inspection)).toContain('未保存修改')
  })

  it('warns about symlink drag-outs', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: lstatOf('symlink'),
    })
    const inspection = bridge.inspect(DOC, null, false)

    expect(inspection.symlink).toBe(true)
    expect(bridge.warningFor(inspection)).toContain('符号链接')
  })

  it('warns when the source file no longer exists', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: lstatOf('missing'),
    })
    const inspection = bridge.inspect(DOC, null, false)

    expect(inspection.exists).toBe(false)
    expect(bridge.warningFor(inspection)).toContain('不存在')
  })

  it('does not warn for a different modified document', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: lstatOf('file'),
    })
    const inspection = bridge.inspect('D:\\vault\\other.md', DOC, true)
    expect(inspection.staleDueToUnsavedChanges).toBe(false)
  })

  it('never throws when lstat fails unexpectedly', () => {
    const bridge = new NativeDragBridge({
      getPlatform: () => 'win32',
      lstatSync: () => { throw new Error('EACCES') },
    })
    expect(() => bridge.inspect(DOC, DOC, false)).not.toThrow()
    expect(bridge.inspect(DOC, DOC, false).exists).toBe(false)
  })

  it('compares document identity', () => {
    const bridge = new NativeDragBridge({ getPlatform: () => 'win32' })
    if (process.platform === 'win32') {
      expect(bridge.isSameDocument('D:\\Vault\\A.md', 'd:\\vault\\a.md')).toBe(true)
    } else {
      expect(bridge.isSameDocument(DOC, DOC)).toBe(true)
    }
    expect(bridge.isSameDocument(ROOT, DOC)).toBe(false)
  })
})

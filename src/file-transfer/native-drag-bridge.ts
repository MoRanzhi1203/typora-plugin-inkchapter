/**
 * NativeDragBridge —— 原生 OS 拖出的能力探测与安全观察。
 *
 * 审计结论（见 Typora 1.6.7 `resources/appsrc/window/frame.js`）：
 *   文件树节点 `.file-node-content[draggable=true]` 的 dragstart 由 Typora 自己处理：
 *     `setDraggingItem(path, isDirectory, event)`
 *       → Windows/Linux: `reqnode("electron").ipcRenderer.send("ondragstart", path, icon)`
 *       → macOS: `bridge.callHandler("controller.startDrag", path)`
 *   即**拖出使用 Typora 的原生 IPC 拖拽**，不是 HTML5 自定义拖拽。插件在渲染进程
 *   无法、也不需要重复发送 `ondragstart`（重复发送会启动第二次拖拽）。
 *
 * 因此本桥接器只做两件事：
 *   1. 探测渲染进程是否仍能访问 Typora 的原生 electron 桥（能力矩阵输入）；
 *   2. 在 dragstart 时检查源文件：不存在 / 符号链接 / 当前文档有未保存修改。
 *
 * 明确限制：Electron `webContents.startDrag` 只接受 file + icon，不接受 dropEffect；
 * 目标资源管理器是否「复制」由 Windows 与用户按键（Shift 会移动）决定。插件无法
 * 在源端强制 copy，故不宣称 100% 保证——该子项标记 PARTIAL/BLOCKED（见最终报告）。
 */
import * as fs from 'fs'
import {
  shouldWarnStaleDragOut,
  isSamePath as defaultIsSamePath,
} from './file-transfer-policy'

export interface ElectronRendererLike {
  ipcRenderer?: {
    send?: (channel: string, ...args: unknown[]) => void
  }
}

export interface LstatLike {
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface NativeDragBridgeDeps {
  /** 返回 Typora 注入的 renderer-side electron 对象；不可用时返回 null。 */
  getElectron?: () => ElectronRendererLike | null
  getPlatform?: () => string
  lstatSync?: (filePath: string) => LstatLike
  isSamePath?: (a: string | null | undefined, b: string | null | undefined) => boolean
}

export type NativeDragOutStatus = 'DELEGATED_TO_TYPORA' | 'UNAVAILABLE'

export interface NativeDragCapability {
  platform: string
  electronReachable: boolean
  ipcRendererAvailable: boolean
  nativeDragOut: NativeDragOutStatus
  /** 源端无法强制 copy；目标端默认复制，Shift 会移动。 */
  sourceCopyGuarantee: 'OS_DELEGATED'
  reason: string
  fallback: string
}

export interface DragSourceInspection {
  path: string
  exists: boolean
  isFile: boolean
  symlink: boolean
  staleDueToUnsavedChanges: boolean
}

const FALLBACK_HINT = '如需确保副本：先 Ctrl+S 保存，再在标签右键菜单使用「复制完整路径 / 在文件资源管理器中显示」，或另存副本后拖出。'

function defaultGetElectron(): ElectronRendererLike | null {
  try {
    const globalScope = globalThis as { reqnode?: unknown }
    if (typeof globalScope.reqnode !== 'function') return null
    return (globalScope.reqnode as (id: string) => unknown)('electron') as ElectronRendererLike
  } catch {
    return null
  }
}

function defaultLstatSync(filePath: string): LstatLike {
  return fs.lstatSync(filePath)
}

export class NativeDragBridge {

  private readonly getElectron: () => ElectronRendererLike | null
  private readonly getPlatform: () => string
  private readonly lstatSync: (filePath: string) => LstatLike
  private readonly isSamePath: (a: string | null | undefined, b: string | null | undefined) => boolean

  constructor(deps: NativeDragBridgeDeps = {}) {
    this.getElectron = deps.getElectron ?? defaultGetElectron
    this.getPlatform = deps.getPlatform ?? (() => process.platform)
    this.lstatSync = deps.lstatSync ?? defaultLstatSync
    this.isSamePath = deps.isSamePath ?? defaultIsSamePath
  }

  probe(): NativeDragCapability {
    const platform = this.getPlatform()
    let electron: ElectronRendererLike | null = null
    try {
      electron = this.getElectron()
    } catch {
      electron = null
    }
    const electronReachable = electron !== null
    const ipcRendererAvailable = electronReachable && typeof electron?.ipcRenderer?.send === 'function'
    const delegated = platform === 'win32' || platform === 'linux'
      ? ipcRendererAvailable
      : platform === 'darwin'

    return {
      platform,
      electronReachable,
      ipcRendererAvailable,
      nativeDragOut: delegated ? 'DELEGATED_TO_TYPORA' : 'UNAVAILABLE',
      sourceCopyGuarantee: 'OS_DELEGATED',
      reason: delegated
        ? 'Typora 文件树 dragstart 已通过原生 IPC 启动 OS 文件拖拽；墨章只观察、不改写。'
        : '未探测到 Typora 原生拖拽通道；请使用右键「复制路径 / 在资源管理器中显示」。',
      fallback: FALLBACK_HINT,
    }
  }

  /** 只读检查拖出来源；任何异常都收敛为 exists=false，绝不影响原生拖拽。 */
  inspect(
    sourcePath: string,
    activeDocumentPath: string | null | undefined,
    activeDocumentModified: boolean,
  ): DragSourceInspection {
    let exists = false
    let isFile = false
    let symlink = false
    try {
      const stat = this.lstatSync(sourcePath)
      exists = true
      isFile = stat.isFile()
      symlink = stat.isSymbolicLink()
    } catch {
      exists = false
    }
    return {
      path: sourcePath,
      exists,
      isFile,
      symlink,
      staleDueToUnsavedChanges: shouldWarnStaleDragOut(
        activeDocumentPath,
        sourcePath,
        activeDocumentModified,
      ),
    }
  }

  /** 返回应提示给用户的文案；无需提示时返回 null。 */
  warningFor(inspection: DragSourceInspection): string | null {
    if (!inspection.exists) {
      return '墨章：源文件不存在，拖出的副本可能无法创建'
    }
    if (inspection.symlink) {
      return '墨章：拖出的是符号链接；目标端复制的是链接路径，行为由系统决定'
    }
    if (inspection.staleDueToUnsavedChanges) {
      return '墨章：当前文档有未保存修改；拖出的副本只包含磁盘上已保存的内容，请先保存（Ctrl+S）'
    }
    return null
  }

  /** 当前是否为同一个文档（供宿主判断告警去重）。 */
  isSameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
    return this.isSamePath(a, b)
  }
}

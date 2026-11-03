/**
 * 操作系统原生目录选择（Windows）。
 *
 * 不使用未验证的 Electron renderer 接口：通过独立 PowerShell 进程调用
 * System.Windows.Forms.FolderBrowserDialog，返回用户选择的绝对路径。
 * 用户取消或任何失败都返回 null，由调用方决定提示文案。
 */

import { execFile } from 'child_process'

const POWERSHELL_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = $env:INKCHAPTER_FOLDER_DESC',
  '$dialog.ShowNewFolderButton = $true',
  'if ($env:INKCHAPTER_FOLDER_INITIAL) { $dialog.SelectedPath = $env:INKCHAPTER_FOLDER_INITIAL }',
  '$result = $dialog.ShowDialog()',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
].join('; ')

export interface FolderPickerOptions {
  description?: string
  initialDirectory?: string
  /** 超时（毫秒），默认 5 分钟。 */
  timeoutMs?: number
}

export function isNativeFolderPickerAvailable(): boolean {
  return process.platform === 'win32'
}

/** 纯函数：解析 PowerShell 输出；取消时输出为空。 */
export function parseFolderPickerOutput(stdout: string | null | undefined): string | null {
  if (typeof stdout !== 'string') return null
  const value = stdout.replace(/\r/g, '').trim()
  return value ? value : null
}

export function pickFolderNative(options: FolderPickerOptions = {}): Promise<string | null> {
  if (!isNativeFolderPickerAvailable()) return Promise.resolve(null)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INKCHAPTER_FOLDER_DESC: options.description ?? '选择墨章图片图库目录',
    INKCHAPTER_FOLDER_INITIAL: options.initialDirectory?.trim() ?? '',
  }

  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', POWERSHELL_SCRIPT],
      { env, windowsHide: true, timeout: options.timeoutMs ?? 5 * 60 * 1000, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        resolve(parseFolderPickerOutput(stdout))
      },
    )
  })
}

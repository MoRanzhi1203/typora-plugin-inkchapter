/**
 * 操作系统原生图片文件选择（Windows）。
 *
 * 与目录选择一致：不依赖未验证的 Electron renderer 接口，通过独立
 * PowerShell 进程调用 System.Windows.Forms.OpenFileDialog。
 * 用户取消或任何失败都返回 null，由调用方决定提示文案。
 */

import { execFile } from 'child_process'

const POWERSHELL_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
  '$dialog.Title = $env:INKCHAPTER_FILE_DESC',
  '$dialog.Filter = $env:INKCHAPTER_FILE_FILTER',
  '$dialog.Multiselect = $false',
  'if ($env:INKCHAPTER_FILE_INITIAL) { $dialog.InitialDirectory = $env:INKCHAPTER_FILE_INITIAL }',
  '$result = $dialog.ShowDialog()',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
].join('; ')

const IMAGE_FILE_FILTER =
  '图片|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.avif;*.svg|所有文件|*.*'

export interface ImageFilePickerOptions {
  description?: string
  initialDirectory?: string
  /** 超时（毫秒），默认 5 分钟。 */
  timeoutMs?: number
}

export function isNativeImageFilePickerAvailable(): boolean {
  return process.platform === 'win32'
}

/** 纯函数：解析 PowerShell 输出；取消时输出为空。 */
export function parseImageFilePickerOutput(stdout: string | null | undefined): string | null {
  if (typeof stdout !== 'string') return null
  const value = stdout.replace(/\r/g, '').trim()
  return value ? value : null
}

export function pickImageFileNative(options: ImageFilePickerOptions = {}): Promise<string | null> {
  if (!isNativeImageFilePickerAvailable()) return Promise.resolve(null)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INKCHAPTER_FILE_DESC: options.description ?? '选择要上传的图片',
    INKCHAPTER_FILE_FILTER: IMAGE_FILE_FILTER,
    INKCHAPTER_FILE_INITIAL: options.initialDirectory?.trim() ?? '',
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
        resolve(parseImageFilePickerOutput(stdout))
      },
    )
  })
}

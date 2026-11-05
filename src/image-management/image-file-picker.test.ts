import { describe, it, expect } from 'vitest'
import { parseImageFilePickerOutput } from './image-file-picker'

describe('parseImageFilePickerOutput', () => {
  it('returns a trimmed absolute path', () => {
    expect(parseImageFilePickerOutput('D:\\pictures\\a.png\r\n')).toBe('D:\\pictures\\a.png')
  })

  it('returns null when the dialog is cancelled or output is missing', () => {
    expect(parseImageFilePickerOutput('')).toBeNull()
    expect(parseImageFilePickerOutput('   ')).toBeNull()
    expect(parseImageFilePickerOutput(null)).toBeNull()
    expect(parseImageFilePickerOutput(undefined)).toBeNull()
  })
})

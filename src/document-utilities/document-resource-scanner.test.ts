import { describe, it, expect } from 'vitest'
import {
  classifyResourceClass,
  isLocalResourceDestination,
  parseImageSourceOccurrences,
  parseLocalLinkTargets,
} from './document-resource-scanner'

describe('classifyResourceClass', () => {
  it('treats Windows absolute paths as local, not remote', () => {
    expect(classifyResourceClass('C:\\Users\\me\\Pictures\\a.png')).toBe('local')
    expect(classifyResourceClass('D:/notes/images/a.png')).toBe('local')
  })

  it('keeps URL, data and anchor classification unchanged', () => {
    expect(classifyResourceClass('https://example.test/a.png')).toBe('remote')
    expect(classifyResourceClass('http://example.test/a.png')).toBe('remote')
    expect(classifyResourceClass('data:image/png;base64,AAAA')).toBe('data')
    expect(classifyResourceClass('#section')).toBe('other')
    expect(classifyResourceClass('assets/a.png')).toBe('local')
  })
})

describe('isLocalResourceDestination', () => {
  it('accepts relative paths and Windows absolute paths', () => {
    expect(isLocalResourceDestination('assets/a.png')).toBe(true)
    expect(isLocalResourceDestination('C:\\Users\\me\\a.png')).toBe(true)
    expect(isLocalResourceDestination('D:/a.png')).toBe(true)
  })

  it('rejects remote, data and anchor destinations', () => {
    expect(isLocalResourceDestination('https://example.test/a.png')).toBe(false)
    expect(isLocalResourceDestination('data:image/png;base64,AAAA')).toBe(false)
    expect(isLocalResourceDestination('#section')).toBe(false)
    expect(isLocalResourceDestination('')).toBe(false)
  })
})

describe('image occurrence parsing for pasted Windows paths', () => {
  it('keeps the pasted absolute path and marks it local', () => {
    const markdown = '![image-20261103210839457](C:\\Users\\me\\AppData\\Roaming\\Typora\\typora-user-images\\image-20261103210839457.png)'
    const occurrences = parseImageSourceOccurrences(markdown)
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].isLocal).toBe(true)
    expect(occurrences[0].resourceClass).toBe('local')
    expect(occurrences[0].rawDestination).toBe('C:\\Users\\me\\AppData\\Roaming\\Typora\\typora-user-images\\image-20261103210839457.png')
  })

  it('includes pasted Windows paths in the local link target scan', () => {
    const markdown = '![a](C:/images/a.png)'
    const targets = parseLocalLinkTargets(markdown)
    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(typeof target === 'string' ? target : target.target).toBe('C:/images/a.png')
  })
})

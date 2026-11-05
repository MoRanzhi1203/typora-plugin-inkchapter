import { describe, it, expect } from 'vitest'
import {
  classifyUploadThrownError,
  detectUploadServiceConflict,
  evaluatePicGoResult,
  parseTyporaImagePreferences,
  UPLOAD_CONFLICT_MESSAGE,
} from './image-upload-policy'

function hexOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('hex')
}

describe('evaluatePicGoResult', () => {
  it('accepts the first publicly reachable URL', () => {
    expect(evaluatePicGoResult([{ imgUrl: 'https://example.test/a.png' }])).toEqual({
      ok: true,
      url: 'https://example.test/a.png',
    })
    expect(evaluatePicGoResult([{ url: 'https://example.test/b.png' }])).toEqual({
      ok: true,
      url: 'https://example.test/b.png',
    })
  })

  it('keeps scanning until a valid URL is found', () => {
    expect(evaluatePicGoResult([
      { imgUrl: 'http://127.0.0.1/a.png' },
      { imgUrl: 'https://example.test/ok.png' },
    ])).toEqual({ ok: true, url: 'https://example.test/ok.png' })
  })

  it('treats empty output and empty URLs as failures', () => {
    expect(evaluatePicGoResult([])).toEqual({ ok: false, errorCode: 'PICGO_EMPTY_RESULT' })
    expect(evaluatePicGoResult([{ imgUrl: '' }])).toEqual({ ok: false, errorCode: 'PICGO_EMPTY_RESULT' })
    expect(evaluatePicGoResult(null)).toEqual({ ok: false, errorCode: 'PICGO_EMPTY_RESULT' })
  })

  it('rejects local, private and non-http URLs even if PicGo returns them', () => {
    expect(evaluatePicGoResult([{ imgUrl: 'http://127.0.0.1/a.png' }])).toEqual({
      ok: false,
      errorCode: 'PICGO_INVALID_URL',
    })
    expect(evaluatePicGoResult([{ imgUrl: 'file:///C:/a.png' }])).toEqual({
      ok: false,
      errorCode: 'PICGO_INVALID_URL',
    })
  })
})

describe('classifyUploadThrownError', () => {
  it('maps file system errors to stable codes without exposing paths', () => {
    expect(classifyUploadThrownError(new Error('ENOENT: no such file'))).toBe('FILE_NOT_FOUND')
    expect(classifyUploadThrownError(new Error('EACCES: permission denied'))).toBe('FILE_NOT_READABLE')
    expect(classifyUploadThrownError(new Error('network down'))).toBe('PICGO_UNAVAILABLE')
  })

  it('uses the error code when the message is generic', () => {
    expect(classifyUploadThrownError({ code: 'FILE_NOT_FOUND', message: 'file not found: D:/a.png' }))
      .toBe('FILE_NOT_FOUND')
    expect(classifyUploadThrownError({ code: 'FILE_NOT_READABLE', message: 'read failed' }))
      .toBe('FILE_NOT_READABLE')
    expect(classifyUploadThrownError(new Error('file not found: D:/a.png'))).toBe('FILE_NOT_FOUND')
    expect(classifyUploadThrownError(new Error('not a regular file: D:/a.png'))).toBe('FILE_NOT_READABLE')
  })
})

describe('parseTyporaImagePreferences', () => {
  it('decodes the hex-encoded profile and recognises upload mode', () => {
    const raw = hexOf({ image_save_location: 'ipic', image_uploader: 'picgo-cli' })
    expect(parseTyporaImagePreferences(raw)).toEqual({ insertMode: 'upload', uploader: 'picgo-cli' })
  })

  it('accepts plain JSON and treats other locations as local', () => {
    const raw = JSON.stringify({ image_save_location: './${filename}' })
    expect(parseTyporaImagePreferences(raw)).toEqual({ insertMode: 'local', uploader: null })
  })

  it('returns unknown for malformed or missing data', () => {
    expect(parseTyporaImagePreferences(null)).toEqual({ insertMode: 'unknown', uploader: null })
    expect(parseTyporaImagePreferences('zzzz')).toEqual({ insertMode: 'unknown', uploader: null })
    expect(parseTyporaImagePreferences('{}')).toEqual({ insertMode: 'unknown', uploader: null })
  })
})

describe('detectUploadServiceConflict', () => {
  it('flags upload mode with service none', () => {
    const result = detectUploadServiceConflict({
      uploadService: 'none',
      preferences: { insertMode: 'upload', uploader: 'picgo-cli' },
    })
    expect(result.hasConflict).toBe(true)
    expect(result.message).toBe(UPLOAD_CONFLICT_MESSAGE)
  })

  it('stays silent for github service or local insert mode', () => {
    expect(detectUploadServiceConflict({
      uploadService: 'github',
      preferences: { insertMode: 'upload', uploader: 'picgo-cli' },
    }).hasConflict).toBe(false)
    expect(detectUploadServiceConflict({
      uploadService: 'none',
      preferences: { insertMode: 'local', uploader: null },
    }).hasConflict).toBe(false)
    expect(detectUploadServiceConflict({
      uploadService: 'none',
      preferences: { insertMode: 'unknown', uploader: null },
    }).hasConflict).toBe(false)
  })
})

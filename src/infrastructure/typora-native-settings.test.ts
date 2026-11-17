/**
 * R13 — Typora native math preference reader.
 *
 * The real root cause of "inline formulas do not render" in Typora 1.6.7 is the
 * native preference (`enable_inline_math` / `strict_mode`), not the numbering
 * algorithm. These tests pin the read-only decoding contract used by the
 * settings hint and the runtime acceptance.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  decodeTyporaProfileData,
  describeTyporaInlineMathHint,
  readTyporaNativeMathSettings,
  resetTyporaNativeMathSettingsCache,
} from './typora-native-settings'

const tempDirs: string[] = []

function writeProfile(payload: Record<string, unknown>, encoding: 'hex' | 'json' = 'hex'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkchapter-profile-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'profile.data')
  const json = JSON.stringify(payload)
  fs.writeFileSync(file, encoding === 'hex' ? Buffer.from(json, 'utf8').toString('hex') : json, 'utf8')
  return file
}

afterEach(() => {
  resetTyporaNativeMathSettingsCache()
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe('Typora native math settings', () => {
  it('decodes the hex-encoded profile Typora 1.6.7 writes', () => {
    const decoded = decodeTyporaProfileData(Buffer.from('{"strict_mode":false,"enable_inline_math":true}', 'utf8').toString('hex'))
    expect(decoded).toEqual({ strict_mode: false, enable_inline_math: true })
  })

  it('decodes legacy raw JSON profiles', () => {
    expect(decodeTyporaProfileData('{"strict_mode":true}')).toEqual({ strict_mode: true })
  })

  it('returns null for unreadable payloads', () => {
    expect(decodeTyporaProfileData('')).toBeNull()
    expect(decodeTyporaProfileData('not-hex')).toBeNull()
    expect(decodeTyporaProfileData('7b')).toBeNull()
  })

  it('reads inline math disabled + strict mode from the profile', () => {
    const file = writeProfile({ strict_mode: true, enable_inline_math: false, auto_numbering_for_math: '' })
    const settings = readTyporaNativeMathSettings(file)

    expect(settings.available).toBe(true)
    expect(settings.strictMode).toBe(true)
    expect(settings.inlineMathEnabled).toBe(false)
    expect(settings.autoNumberingForMath).toBe('')
  })

  it('reports inline math enabled with strict mode off', () => {
    const file = writeProfile({ strict_mode: false, enable_inline_math: true })
    const settings = readTyporaNativeMathSettings(file)

    expect(settings.inlineMathEnabled).toBe(true)
    expect(settings.strictMode).toBe(false)
    expect(describeTyporaInlineMathHint(settings)).toBeNull()
  })

  it('explains BOTH native blockers when inline math is missing', () => {
    const file = writeProfile({ strict_mode: true })
    const hint = describeTyporaInlineMathHint(readTyporaNativeMathSettings(file))

    expect(hint).toContain('行内公式')
    expect(hint).toContain('严格模式')
  })

  it('stays silent when the profile cannot be read (never guesses)', () => {
    const settings = readTyporaNativeMathSettings(path.join(os.tmpdir(), 'inkchapter-missing-profile', 'profile.data'))
    expect(settings.available).toBe(false)
    expect(describeTyporaInlineMathHint(settings)).toBeNull()
  })
})

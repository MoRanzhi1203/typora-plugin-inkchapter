import type { NumberTokenStyle } from './heading-types'

/** Format a numeric counter into a display token based on the specified style. */
export function formatToken(n: number, style: NumberTokenStyle): string {
  if (n < 1) return '0'

  switch (style) {
    case 'arabic': return String(n)
    case 'chinese': return toChinese(n)
    case 'chinese-financial': return toChineseFinancial(n)
    case 'roman-upper': return toRoman(n, true)
    case 'roman-lower': return toRoman(n, false)
    case 'alpha-upper': return toAlpha(n, true)
    case 'alpha-lower': return toAlpha(n, false)
    case 'circled': return toCircled(n)
  }
}

// ── Chinese numerals ────────────────────────────────────

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CHINESE_UNITS = ['', '十', '百', '千']
const CHINESE_BIG_UNITS = ['', '万', '亿', '兆']

function toChinese(n: number): string {
  if (n < 1) return '零'
  if (n <= 9999) return toChineseBlock(n)
  return toChineseLarge(n)
}

function toChineseBlock(n: number): string {
  if (n === 0) return ''
  const parts: string[] = []
  let unitIdx = 0
  let hasZero = false
  let temp = n

  while (temp > 0) {
    const digit = temp % 10
    if (digit === 0) {
      if (parts.length > 0) hasZero = true
    } else {
      if (hasZero && parts.length > 0) { parts.unshift('零'); hasZero = false }
      parts.unshift(CHINESE_UNITS[unitIdx])
      parts.unshift(CHINESE_DIGITS[digit])
      hasZero = false
    }
    unitIdx++
    temp = Math.floor(temp / 10)
  }
  // Clean up: "一十" → "十"
  let result = parts.join('')
  if (result.startsWith('一十')) result = result.slice(1)
  return result
}

function toChineseLarge(n: number): string {
  const parts: string[] = []
  let unitIdx = 0
  let hasNonZero = false

  while (n > 0) {
    const block = n % 10000
    if (block > 0) {
      const blockStr = toChineseBlock(block)
      parts.unshift(CHINESE_BIG_UNITS[unitIdx])
      parts.unshift(blockStr)
      hasNonZero = true
    } else if (hasNonZero) {
      parts.unshift('零')
    }
    unitIdx++
    n = Math.floor(n / 10000)
  }

  return parts.join('').replace(/零+$/, '')
}

// ── Chinese financial (大写) ─────────────────────────────

const FINANCIAL_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const FINANCIAL_UNITS = ['', '拾', '佰', '仟']
const FINANCIAL_BIG_UNITS = ['', '万', '亿', '兆']

function toChineseFinancial(n: number): string {
  if (n < 1) return '零'
  if (n <= 9999) return toFinancialBlock(n)
  return toFinancialLarge(n)
}

function toFinancialBlock(n: number): string {
  if (n === 0) return ''
  const parts: string[] = []
  let unitIdx = 0
  let temp = n

  while (temp > 0) {
    const digit = temp % 10
    if (digit > 0) {
      parts.unshift(FINANCIAL_UNITS[unitIdx])
      parts.unshift(FINANCIAL_DIGITS[digit])
    } else if (parts.length > 0 && !parts[0].startsWith('零')) {
      parts.unshift('零')
    }
    unitIdx++
    temp = Math.floor(temp / 10)
  }
  return parts.join('').replace(/零$/, '')
}

function toFinancialLarge(n: number): string {
  const parts: string[] = []
  let unitIdx = 0
  let hasNonZero = false

  while (n > 0) {
    const block = n % 10000
    if (block > 0) {
      parts.unshift(FINANCIAL_BIG_UNITS[unitIdx])
      parts.unshift(toFinancialBlock(block))
      hasNonZero = true
    } else if (hasNonZero) {
      if (!parts[0].startsWith('零')) parts.unshift('零')
    }
    unitIdx++
    n = Math.floor(n / 10000)
  }

  return parts.join('').replace(/零+$/, '')
}

// ── Roman numerals ───────────────────────────────────────

const ROMAN_VALUES: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

function toRoman(n: number, upper: boolean): string {
  if (n < 1) return '0'
  if (n > 3999) return String(n) // fallback

  let result = ''
  let remaining = n
  for (const [value, symbol] of ROMAN_VALUES) {
    while (remaining >= value) {
      result += symbol
      remaining -= value
    }
  }
  return upper ? result : result.toLowerCase()
}

// ── Alpha (Excel-style) ──────────────────────────────────

function toAlpha(n: number, upper: boolean): string {
  if (n < 1) return '0'
  const base = upper ? 65 : 97 // 'A' or 'a'
  let result = ''
  let remaining = n
  while (remaining > 0) {
    remaining--
    result = String.fromCharCode(base + (remaining % 26)) + result
    remaining = Math.floor(remaining / 26)
  }
  return result
}

// ── Circled numbers ──────────────────────────────────────

// Unicode circled numbers: ① (U+2460) to ⑳ (U+2473), then ㉑... up to ㊿ (U+3251-U+32BF)
function toCircled(n: number): string {
  if (n < 1) return '0'
  // ① = U+2460 for 1
  if (n <= 20) return String.fromCharCode(0x2460 + n - 1)
  // Circled 21-35: U+3251 - U+325F  (㉑ = U+3251)
  if (n <= 35) return String.fromCharCode(0x3251 + n - 21)
  // Circled 36-50: U+32B1 - U+32BF
  if (n <= 50) return String.fromCharCode(0x32B1 + n - 36)
  // Fallback to arabic
  return String(n)
}

// ── Validation ───────────────────────────────────────────

const VALID_TOKEN_STYLES: Set<string> = new Set([
  'arabic', 'chinese', 'chinese-financial',
  'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower', 'circled',
])

export function isValidTokenStyle(s: string): s is NumberTokenStyle {
  return VALID_TOKEN_STYLES.has(s)
}

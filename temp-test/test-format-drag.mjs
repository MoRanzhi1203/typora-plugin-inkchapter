/**
 * Pure function tests — run: node temp-test/test-format-drag.mjs
 */

// Inline the pure functions (copy from format-drag-utils.ts)
function moveSegmentToResolvedIndex(items, fromIndex, targetIndexAfterRemoval) {
  if (fromIndex < 0 || fromIndex >= items.length) return [...items]
  const next = []
  for (let i = 0; i < items.length; i++) {
    if (i !== fromIndex) next.push(items[i])
  }
  const target = Math.max(0, Math.min(targetIndexAfterRemoval, next.length))
  next.splice(target, 0, items[fromIndex])
  return next
}

function normalizeFormatAfterDrag(format, currentLevel, hiddenLevels) {
  const cleaned = []
  const seenLevels = new Set()

  for (const seg of format) {
    if (seg.type === 'level-reference') {
      if (hiddenLevels.has(seg.level)) continue
      if (seg.level > currentLevel) continue
      if (seenLevels.has(seg.level)) continue
      seenLevels.add(seg.level)
      cleaned.push({ ...seg })
    } else {
      const trimmed = seg.value.trim()
      if (trimmed.length === 0) continue
      const last = cleaned[cleaned.length - 1]
      if (last && last.type === 'literal') {
        last.value += trimmed
      } else {
        cleaned.push({ type: 'literal', value: trimmed })
      }
    }
  }

  if (!cleaned.some(s => s.type === 'level-reference' && s.level === currentLevel)) {
    cleaned.push({ type: 'level-reference', level: currentLevel })
  }

  return cleaned
}

// ── Test helpers ────────────────────────────────────
let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log('PASS:', msg)
    passed++
  } else {
    console.error('FAIL:', msg)
    failed++
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── moveSegmentToResolvedIndex ───────────────────────
console.log('\n── moveSegmentToResolvedIndex ──')

assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 0, 2), ['B','C','A']),
  'first to end: [A,B,C] from=0 target=2 → [B,C,A]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 2, 0), ['C','A','B']),
  'last to first: [A,B,C] from=2 target=0 → [C,A,B]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 0, 1), ['B','A','C']),
  'first to middle: [A,B,C] from=0 target=1 → [B,A,C]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 1, 2), ['A','C','B']),
  'middle to end: [A,B,C] from=1 target=2 → [A,C,B]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B'], 0, 1), ['B','A']),
  'swap two: [A,B] from=0 target=1 → [B,A]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B'], 1, 0), ['B','A']),
  'swap two reverse: [A,B] from=1 target=0 → [B,A]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C','D'], 0, 3), ['B','C','D','A']),
  '4 elem first to last: [A,B,C,D] from=0 target=3 → [B,C,D,A]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C','D'], 3, 0), ['D','A','B','C']),
  '4 elem last to first: [A,B,C,D] from=3 target=0 → [D,A,B,C]',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 0, 0), ['A','B','C']),
  'same position (start): no change',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B','C'], 2, 2), ['A','B','C']),
  'same position (end): no change',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B'], -1, 0), ['A','B']),
  'illegal fromIndex=-1 returns unchanged',
)
assert(
  deepEqual(moveSegmentToResolvedIndex(['A','B'], 5, 0), ['A','B']),
  'illegal fromIndex=5 returns unchanged',
)

// Immutability
const orig = ['A','B','C']
const moved = moveSegmentToResolvedIndex(orig, 0, 2)
assert(orig[0] === 'A' && orig[1] === 'B' && orig[2] === 'C', 'original array not mutated')
assert(moved[0] === 'B' && moved[1] === 'C' && moved[2] === 'A', 'moved result correct')

// Single element
assert(deepEqual(moveSegmentToResolvedIndex(['A'], 0, 0), ['A']), 'single element: no change')

// ── normalizeFormatAfterDrag ────────────────────────
console.log('\n── normalizeFormatAfterDrag ──')

const emptySet = new Set()

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [{ type: 'literal', value: ' ' }, { type: 'level-reference', level: 3 }],
      3,
      emptySet,
    ),
    [{ type: 'level-reference', level: 3 }],
  ),
  'empty literal removed',
)

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'literal', value: 'ab' },
        { type: 'literal', value: 'cd' },
        { type: 'level-reference', level: 3 },
      ],
      3,
      emptySet,
    ),
    [
      { type: 'literal', value: 'abcd' },
      { type: 'level-reference', level: 3 },
    ],
  ),
  'adjacent literals merged: ab+cd → abcd',
)

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [{ type: 'literal', value: 'text' }],
      2,
      emptySet,
    ),
    [
      { type: 'literal', value: 'text' },
      { type: 'level-reference', level: 2 },
    ],
  ),
  'current level ref added when missing',
)

const hiddenH1 = new Set([1])
assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'level-reference', level: 1 },
        { type: 'literal', value: '.' },
        { type: 'level-reference', level: 2 },
      ],
      2,
      hiddenH1,
    ),
    [
      { type: 'literal', value: '.' },
      { type: 'level-reference', level: 2 },
    ],
  ),
  'hidden L1 removed, separator preserved',
)

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'level-reference', level: 2 },
        { type: 'level-reference', level: 2 },
        { type: 'level-reference', level: 3 },
      ],
      3,
      emptySet,
    ),
    [
      { type: 'level-reference', level: 2 },
      { type: 'level-reference', level: 3 },
    ],
  ),
  'duplicate L2 removed',
)

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'level-reference', level: 4 },
        { type: 'level-reference', level: 3 },
      ],
      3,
      emptySet,
    ),
    [{ type: 'level-reference', level: 3 }],
  ),
  'future level L4 removed (current=H3)',
)

// Order preservation
assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'level-reference', level: 3 },
        { type: 'literal', value: '.' },
        { type: 'level-reference', level: 2 },
      ],
      3,
      emptySet,
    ),
    [
      { type: 'level-reference', level: 3 },
      { type: 'literal', value: '.' },
      { type: 'level-reference', level: 2 },
    ],
  ),
  'order preserved: [L3].[L2] stays as-is',
)

assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'literal', value: '第' },
        { type: 'level-reference', level: 3 },
        { type: 'literal', value: '章' },
      ],
      3,
      emptySet,
    ),
    [
      { type: 'literal', value: '第' },
      { type: 'level-reference', level: 3 },
      { type: 'literal', value: '章' },
    ],
  ),
  'non-adjacent literals remain separate',
)

const hidden1and2 = new Set([1, 2])
assert(
  deepEqual(
    normalizeFormatAfterDrag(
      [
        { type: 'level-reference', level: 1 },
        { type: 'literal', value: '.' },
        { type: 'level-reference', level: 2 },
        { type: 'literal', value: '.' },
        { type: 'level-reference', level: 3 },
      ],
      3,
      hidden1and2,
    ),
    [
      { type: 'literal', value: '..' },
      { type: 'level-reference', level: 3 },
    ],
  ),
  'hidden L1+L2 removed, separator dots merged',
)

// ── Summary ─────────────────────────────────────────
console.log('\n============================')
console.log('  PASSED: ' + passed)
console.log('  FAILED: ' + failed)
console.log('  TOTAL:  ' + (passed + failed))
console.log('============================')

if (failed > 0) process.exit(1)

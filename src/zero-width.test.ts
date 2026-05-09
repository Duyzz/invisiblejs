import { describe, it, expect } from 'vitest'
import { ZeroWidth } from './zero-width'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const ZW_CODEPOINTS = new Set([0x200b, 0x200c, 0x200d, 0x2060])

/** True when every code point is one of the four zero-width characters */
function isAllZeroWidth(s: string): boolean {
  for (const ch of s) {
    if (!ZW_CODEPOINTS.has(ch.codePointAt(0)!)) return false
  }
  return true
}

// ─────────────────────────────────────────────
// encode()
// ─────────────────────────────────────────────

describe('ZeroWidth encode()', () => {
  const zw = new ZeroWidth()

  it('produces only zero-width characters', () => {
    const encoded = zw.encode('hello world')
    expect(isAllZeroWidth(encoded)).toBe(true)
  })

  it('encodes an empty string (MAGIC-only + delimiters)', () => {
    const encoded = zw.encode('')
    expect(isAllZeroWidth(encoded)).toBe(true)
    // 8 (delimiter) + 4 MAGIC bytes × 4 chars + 8 (delimiter) = 32 chars
    expect([...encoded].length).toBe(32)
  })

  it('each data byte produces exactly 4 zero-width chars', () => {
    // 'A' is 1 UTF-8 byte → total = 8 + (4+1)*4 + 8 = 36
    const encoded = zw.encode('A')
    expect([...encoded].length).toBe(36)
  })

  it('is deterministic — same input gives same output', () => {
    const zw2 = new ZeroWidth()
    expect(zw.encode('repeat')).toBe(zw2.encode('repeat'))
  })

  it('different inputs produce different outputs', () => {
    expect(zw.encode('aaa')).not.toBe(zw.encode('bbb'))
  })
})

// ─────────────────────────────────────────────
// decode()
// ─────────────────────────────────────────────

describe('ZeroWidth decode()', () => {
  const zw = new ZeroWidth()

  it('roundtrips ASCII text', () => {
    const result = zw.decode(zw.encode('Hello, World!'))
    expect(result).toEqual({ ok: 'Hello, World!' })
  })

  it('roundtrips multi-byte Unicode (emoji)', () => {
    const result = zw.decode(zw.encode('🎉🦄🌍'))
    expect(result).toEqual({ ok: '🎉🦄🌍' })
  })

  it('roundtrips CJK characters', () => {
    const result = zw.decode(zw.encode('你好世界'))
    expect(result).toEqual({ ok: '你好世界' })
  })

  it('roundtrips empty string', () => {
    const result = zw.decode(zw.encode(''))
    expect(result).toEqual({ ok: '' })
  })

  it('roundtrips a long payload', () => {
    const long = 'x'.repeat(500)
    const result = zw.decode(zw.encode(long))
    expect(result).toEqual({ ok: long })
  })

  it('roundtrips mixed scripts and special characters', () => {
    const input = 'Hello مرحبا こんにちは 🚀\n\ttabs & "quotes"'
    const result = zw.decode(zw.encode(input))
    expect(result).toEqual({ ok: input })
  })

  it('returns invalid_signature when decoded with a different seed', () => {
    const zwA = new ZeroWidth('seed-A')
    const zwB = new ZeroWidth('seed-B')
    const encoded = zwA.encode('secret')
    const result = zwB.decode(encoded)
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('returns invalid_invisible_character for visible text input', () => {
    const result = zw.decode('normal visible text')
    expect(result).toHaveProperty('error', 'invalid_invisible_character')
  })

  it('returns invalid_signature for an empty string', () => {
    const result = zw.decode('')
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('returns invalid_invisible_character for char count not divisible by 4', () => {
    // 3 valid ZW chars — not a multiple of 4
    const truncated = '\u200B\u200C\u200D'
    const result = zw.decode(truncated)
    expect(result).toHaveProperty('error', 'invalid_invisible_character')
  })

  it('returns invalid_signature for payload shorter than MAGIC (< 16 ZW chars)', () => {
    // 4 ZW chars = 1 byte, which is less than 4-byte MAGIC
    const short = '\u200B\u200B\u200B\u200B'
    const result = zw.decode(short)
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('returns invalid_invisible_character for mixed valid/invalid chars', () => {
    // 'A' is not a zero-width character
    const mixed = '\u200BA\u200C\u200D'
    const result = zw.decode(mixed)
    expect(result).toHaveProperty('error', 'invalid_invisible_character')
  })
})

// ─────────────────────────────────────────────
// extract()
// ─────────────────────────────────────────────

describe('ZeroWidth extract()', () => {
  const zw = new ZeroWidth()

  it('finds the invisible payload in a mixed string', () => {
    const hidden = zw.encode('peek-a-boo')
    const mixed = `Visible text ${hidden} more visible`
    const extracted = zw.extract(mixed)
    expect(extracted).toBe(hidden)
  })

  it('returns null when no payload is present', () => {
    expect(zw.extract('plain text, nothing hidden here')).toBeNull()
  })

  it('does NOT find a payload encoded with a different seed', () => {
    const zwOther = new ZeroWidth('other-seed')
    const hidden = zwOther.encode('stealth')
    const mixed = `prefix ${hidden} suffix`
    expect(zw.extract(mixed)).toBeNull()
  })

  it('is idempotent — extract from pure encoded string returns the string', () => {
    const encoded = zw.encode('idempotent')
    expect(zw.extract(encoded)).toBe(encoded)
  })

  it('extracts from a string with multiple visible segments', () => {
    const hidden = zw.encode('secret')
    const mixed = `before${hidden}after`
    const result = zw.decodeFrom(mixed)
    expect(result).toEqual({ ok: 'secret' })
  })

  it('handles payload at the very start of the string', () => {
    const hidden = zw.encode('first')
    const mixed = `${hidden}trailing text`
    expect(zw.extract(mixed)).toBe(hidden)
  })

  it('handles payload at the very end of the string', () => {
    const hidden = zw.encode('last')
    const mixed = `leading text${hidden}`
    expect(zw.extract(mixed)).toBe(hidden)
  })

  it('handles stray zero-width characters that are not a valid payload', () => {
    // Some random ZW chars without the proper delimiter + MAGIC structure
    const stray = '\u200B\u200C\u200D\u2060'
    const mixed = `text with ${stray} stray zero-widths`
    expect(zw.extract(mixed)).toBeNull()
  })
})

// ─────────────────────────────────────────────
// decodeFrom()
// ─────────────────────────────────────────────

describe('ZeroWidth decodeFrom()', () => {
  const zw = new ZeroWidth()

  it('extracts and decodes from a mixed string in one call', () => {
    const mixed = `Hello, ${zw.encode('world')}!`
    const result = zw.decodeFrom(mixed)
    expect(result).toEqual({ ok: 'world' })
  })

  it('returns invisible_not_found when there is no payload', () => {
    const result = zw.decodeFrom('no hidden data here')
    expect(result).toHaveProperty('error', 'invisible_not_found')
  })

  it('decodes emoji payload from mixed text', () => {
    const mixed = `Check this out: ${zw.encode('🎉🦄')} cool right?`
    const result = zw.decodeFrom(mixed)
    expect(result).toEqual({ ok: '🎉🦄' })
  })
})

// ─────────────────────────────────────────────
// Seed isolation
// ─────────────────────────────────────────────

describe('ZeroWidth seed isolation', () => {
  it('two instances with the same seed produce identical output', () => {
    const a = new ZeroWidth('my-seed')
    const b = new ZeroWidth('my-seed')
    expect(a.encode('data')).toBe(b.encode('data'))
  })

  it('two instances with different seeds produce different output', () => {
    const a = new ZeroWidth('seed-1')
    const b = new ZeroWidth('seed-2')
    expect(a.encode('data')).not.toBe(b.encode('data'))
  })

  it('default seed is consistent across instances', () => {
    const a = new ZeroWidth()
    const b = new ZeroWidth()
    expect(a.encode('consistency')).toBe(b.encode('consistency'))
  })

  it('seed A cannot decode what seed B encoded', () => {
    const a = new ZeroWidth('alpha')
    const b = new ZeroWidth('beta')
    const encoded = a.encode('classified')
    const result = b.decode(encoded)
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('seed A cannot extract what seed B encoded from mixed text', () => {
    const a = new ZeroWidth('alpha')
    const b = new ZeroWidth('beta')
    const mixed = `visible ${a.encode('hidden')} text`
    expect(b.decodeFrom(mixed)).toHaveProperty('error', 'invisible_not_found')
  })
})

// ─────────────────────────────────────────────
// 2-bit packing correctness
// ─────────────────────────────────────────────

describe('ZeroWidth 2-bit packing', () => {
  it('output length = 2×delimiter + (MAGIC + data) × 4', () => {
    const zw = new ZeroWidth()
    // 'AB' = 2 UTF-8 bytes, MAGIC = 4 bytes → 6 bytes × 4 = 24 ZW chars + 16 delimiter chars
    const encoded = zw.encode('AB')
    expect([...encoded].length).toBe(8 + (4 + 2) * 4 + 8)
  })

  it('does not use U+FEFF (BOM)', () => {
    const zw = new ZeroWidth()
    const encoded = zw.encode('test string with various bytes 🔥')
    for (const ch of encoded) {
      expect(ch.codePointAt(0)).not.toBe(0xfeff)
    }
  })

  it('all output characters are from the expected set', () => {
    const zw = new ZeroWidth()
    const encoded = zw.encode('comprehensive test 日本語 العربية')
    for (const ch of encoded) {
      expect(ZW_CODEPOINTS.has(ch.codePointAt(0)!)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('ZeroWidth edge cases', () => {
  const zw = new ZeroWidth()

  it('handles null bytes in the output correctly', () => {
    // String with explicit null character
    const input = 'a\0b'
    const result = zw.decode(zw.encode(input))
    expect(result).toEqual({ ok: input })
  })

  it('handles all 256 byte values via binary-safe roundtrip', () => {
    // Create a string that exercises all single-byte UTF-8 values (0x00–0x7F)
    // Values 0x80–0xFF are multi-byte in UTF-8, so we test the printable ASCII range
    const chars = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('')
    const result = zw.decode(zw.encode(chars))
    expect(result).toEqual({ ok: chars })
  })

  it('roundtrips newlines and control characters', () => {
    const input = 'line1\nline2\r\nline3\ttab'
    const result = zw.decode(zw.encode(input))
    expect(result).toEqual({ ok: input })
  })

  it('roundtrips a string that contains zero-width characters as data', () => {
    // The *data* itself contains ZW chars — these become UTF-8 bytes that get encoded
    const input = 'before\u200Bafter'
    const result = zw.decode(zw.encode(input))
    expect(result).toEqual({ ok: input })
  })

  it('handles surrogate-pair emoji correctly', () => {
    // 4-byte UTF-8 sequences
    const input = '👨‍👩‍👧‍👦'
    const result = zw.decode(zw.encode(input))
    expect(result).toEqual({ ok: input })
  })
})

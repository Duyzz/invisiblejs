import { describe, it, expect } from 'vitest'
import { Invisible } from './index'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const ENTRY = 0xe0100
const ENTRY_END = 0xe01ff

/** True when every code point is in the variation-selector-17–256 block */
function isAllInvisible(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp < ENTRY || cp > ENTRY_END) return false
  }
  return true
}

// ─────────────────────────────────────────────
// encode()
// ─────────────────────────────────────────────

describe('encode()', () => {
  const iv = new Invisible()

  it('produces only invisible Unicode variation selectors', () => {
    const encoded = iv.encode('hello world')
    expect(isAllInvisible(encoded)).toBe(true)
  })

  it('encodes an empty string to a non-empty magic-only sequence', () => {
    const encoded = iv.encode('')
    // 4-byte MAGIC → 4 invisible chars
    expect([...encoded].length).toBe(4)
    expect(isAllInvisible(encoded)).toBe(true)
  })

  it('is deterministic — same input gives same output', () => {
    const iv2 = new Invisible()
    expect(iv.encode('repeat')).toBe(iv2.encode('repeat'))
  })

  it('different inputs produce different outputs', () => {
    expect(iv.encode('aaa')).not.toBe(iv.encode('bbb'))
  })
})

// ─────────────────────────────────────────────
// decode()
// ─────────────────────────────────────────────

describe('decode()', () => {
  const iv = new Invisible()

  it('roundtrips ASCII text', () => {
    const result = iv.decode(iv.encode('Hello, World!'))
    expect(result).toEqual({ ok: 'Hello, World!' })
  })

  it('roundtrips multi-byte Unicode (emoji)', () => {
    const result = iv.decode(iv.encode('🎉🦄🌍'))
    expect(result).toEqual({ ok: '🎉🦄🌍' })
  })

  it('roundtrips CJK characters', () => {
    const result = iv.decode(iv.encode('你好世界'))
    expect(result).toEqual({ ok: '你好世界' })
  })

  it('roundtrips empty string', () => {
    const result = iv.decode(iv.encode(''))
    expect(result).toEqual({ ok: '' })
  })

  it('roundtrips a long payload', () => {
    const long = 'x'.repeat(500)
    const result = iv.decode(iv.encode(long))
    expect(result).toEqual({ ok: long })
  })

  it('returns invalid_signature when decoded with a different seed', () => {
    const ivA = new Invisible('seed-A')
    const ivB = new Invisible('seed-B')
    const encoded = ivA.encode('secret')
    const result = ivB.decode(encoded)
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('returns invalid_invisible_character for non-variation-selector input', () => {
    const result = iv.decode('normal visible text')
    expect(result).toHaveProperty('error', 'invalid_invisible_character')
  })

  it('returns invalid_signature for an empty string', () => {
    const result = iv.decode('')
    expect(result).toHaveProperty('error', 'invalid_signature')
  })

  it('returns invalid_signature for a payload shorter than MAGIC (3 chars)', () => {
    // Build 3 valid-range invisible chars that won't match the MAGIC signature
    const fake = String.fromCodePoint(ENTRY, ENTRY + 1, ENTRY + 2)
    const result = iv.decode(fake)
    expect(result).toHaveProperty('error', 'invalid_signature')
  })
})

// ─────────────────────────────────────────────
// extract()
// ─────────────────────────────────────────────

describe('extract()', () => {
  const iv = new Invisible()

  it('finds the invisible payload in a mixed string', () => {
    const hidden = iv.encode('peek-a-boo')
    const mixed = `Visible text ${hidden} more visible`
    const extracted = iv.extract(mixed)
    expect(extracted).toBe(hidden)
  })

  it('returns null when no payload is present', () => {
    expect(iv.extract('plain text, nothing hidden here')).toBeNull()
  })

  it('does NOT find a payload encoded with a different seed', () => {
    const ivOther = new Invisible('other-seed')
    const hidden = ivOther.encode('stealth')
    const mixed = `prefix ${hidden} suffix`
    // default-seed Invisible should not find the other-seed payload
    expect(iv.extract(mixed)).toBeNull()
  })

  it('is idempotent — extract from pure encoded string returns the string', () => {
    const encoded = iv.encode('idempotent')
    expect(iv.extract(encoded)).toBe(encoded)
  })
})

// ─────────────────────────────────────────────
// decodeFrom()
// ─────────────────────────────────────────────

describe('decodeFrom()', () => {
  const iv = new Invisible()

  it('extracts and decodes from a mixed string in one call', () => {
    const mixed = `Hello, ${iv.encode('world')}!`
    const result = iv.decodeFrom(mixed)
    expect(result).toEqual({ ok: 'world' })
  })

  it('returns invisible_not_found when there is no payload', () => {
    const result = iv.decodeFrom('no hidden data here')
    expect(result).toHaveProperty('error', 'invisible_not_found')
  })
})

// ─────────────────────────────────────────────
// Seed isolation
// ─────────────────────────────────────────────

describe('seed isolation', () => {
  it('two instances with the same seed produce identical output', () => {
    const a = new Invisible('my-seed')
    const b = new Invisible('my-seed')
    expect(a.encode('data')).toBe(b.encode('data'))
  })

  it('two instances with different seeds produce different output', () => {
    const a = new Invisible('seed-1')
    const b = new Invisible('seed-2')
    expect(a.encode('data')).not.toBe(b.encode('data'))
  })

  it('default seed is consistent across instances', () => {
    const a = new Invisible()
    const b = new Invisible()
    expect(a.encode('consistency')).toBe(b.encode('consistency'))
  })
})

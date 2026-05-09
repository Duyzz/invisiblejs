const ENTRY_CODEPOINT = 0xe0100

type DecodeResult =
  | { ok: string }
  | {
      error:
        | 'invisible_not_found'
        | 'invalid_invisible_character'
        | 'invalid_signature'
        | 'invalid_utf8'
    }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

class Invisible {
  // "IV1\0" — format magic + version byte
  private readonly MAGIC = new Uint8Array([0x49, 0x56, 0x31, 0x00])

  // Full 32-bit hash split into 4 keystream bytes, rotated per position
  private readonly keyBytes: Uint8Array

  // Regex anchored to the encoded MAGIC prefix for this specific seed
  private readonly extractRE: RegExp

  constructor(seed: string = 'default-seed') {
    const h = this.hashSeed(seed)
    this.keyBytes = new Uint8Array([
      (h >>> 24) & 0xff,
      (h >>> 16) & 0xff,
      (h >>> 8) & 0xff,
      h & 0xff,
    ])

    // Encode each MAGIC byte with its keystream byte → the exact code points
    // that will appear at the start of every payload encoded by this instance.
    const magicPattern = Array.from(this.MAGIC)
      .map((b, i) => `\\u{${(ENTRY_CODEPOINT + (b ^ this.keyBytes[i % 4])).toString(16)}}`)
      .join('')

    // Match: magic prefix (4 chars) + any remaining variation selectors
    this.extractRE = new RegExp(`${magicPattern}[\\u{E0100}-\\u{E01FF}]*`, 'gu')
  }

  encode(input: string): string {
    const data = encoder.encode(input)

    const payload = new Uint8Array(this.MAGIC.length + data.length)
    payload.set(this.MAGIC, 0)
    payload.set(data, this.MAGIC.length)

    const result: string[] = []

    for (let i = 0; i < payload.length; i++) {
      const obfuscated = payload[i] ^ this.keyBytes[i % 4]
      result.push(String.fromCodePoint(ENTRY_CODEPOINT + obfuscated))
    }

    return result.join('')
  }

  decode(input: string): DecodeResult {
    const bytes: number[] = []

    let i = 0
    for (const char of input) {
      const code = char.codePointAt(0)!
      const val = code - ENTRY_CODEPOINT

      if (val < 0 || val > 255) {
        return { error: 'invalid_invisible_character' }
      }

      bytes.push(val ^ this.keyBytes[i % 4])
      i++
    }

    if (bytes.length < this.MAGIC.length) {
      return { error: 'invalid_signature' }
    }

    for (let j = 0; j < this.MAGIC.length; j++) {
      if (bytes[j] !== this.MAGIC[j]) {
        return { error: 'invalid_signature' }
      }
    }

    try {
      const decoded = decoder.decode(new Uint8Array(bytes.slice(this.MAGIC.length)))
      return { ok: decoded }
    } catch {
      return { error: 'invalid_utf8' }
    }
  }

  /**
   * Extracts the first hidden payload from a mixed string by matching the
   * seed-specific encoded MAGIC prefix. Only sequences produced by this
   * Invisible instance (same seed) will be found.
   *
   * @returns The invisible character sequence, or null if no valid payload found.
   */
  extract(input: string): string | null {
    this.extractRE.lastIndex = 0
    const match = this.extractRE.exec(input)
    return match ? match[0] : null
  }

  /**
   * Convenience method: extracts invisible characters from a mixed string and decodes them.
   * Equivalent to calling extract() then decode().
   */
  decodeFrom(input: string): DecodeResult {
    const invisible = this.extract(input)
    if (!invisible) return { error: 'invisible_not_found' }
    return this.decode(invisible)
  }

  // FNV-1a 32-bit hash over Unicode code points (not UTF-16 code units)
  private hashSeed(seed: string): number {
    let h = 2166136261 >>> 0
    for (const char of seed) {
      const cp = char.codePointAt(0)!
      h ^= cp
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
}

export { Invisible }
export type { DecodeResult }

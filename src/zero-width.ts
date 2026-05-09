/**
 * ZeroWidth — 2-bit packed zero-width Unicode steganography codec.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * UNICODE CHARACTER CHOICES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This codec uses four zero-width characters that are widely supported across
 * browsers, messaging platforms, and text editors while remaining invisible
 * to users:
 *
 *   U+200B  Zero Width Space       — common word-break hint
 *   U+200C  Zero Width Non-Joiner  — prevents ligatures (used in Arabic/Indic)
 *   U+200D  Zero Width Joiner      — joins characters (emoji ZWJ sequences)
 *   U+2060  Word Joiner            — invisible no-break hint
 *
 * Notably, U+FEFF (BOM / Zero Width No-Break Space) is deliberately excluded.
 * When U+FEFF appears at the start of a document, many systems interpret it as
 * a Byte Order Mark and silently strip it. This makes it unreliable as a data
 * carrier. U+2060 serves the same semantic purpose without the BOM ambiguity.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * BIT-PACKING LOGIC
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Each byte is split into four 2-bit groups, MSB-first:
 *
 *   Byte 0xCA = 1100_1010
 *   Group 0 (bits 7-6): 11  → U+2060
 *   Group 1 (bits 5-4): 00  → U+200B
 *   Group 2 (bits 3-2): 10  → U+200D
 *   Group 3 (bits 1-0): 10  → U+200D
 *
 * This yields 4 zero-width characters per byte — a 2× improvement over the
 * 1-bit-per-character approach (which requires 8 characters per byte).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * XOR KEYSTREAM BEHAVIOR
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The constructor derives a 32-bit FNV-1a hash from the seed string and splits
 * it into four key bytes. During encoding, each payload byte (including MAGIC)
 * is XOR'd with keyBytes[i % 4], where `i` is the byte index.
 *
 * This provides seed-specific obfuscation: the same plaintext encoded with
 * different seeds produces completely different zero-width sequences. The MAGIC
 * bytes are also XOR'd, so the extract() regex is seed-specific — it will only
 * match payloads produced by instances with the same seed.
 *
 * NOTE: This is NOT cryptographic encryption. It is lightweight obfuscation to
 * prevent trivial detection and ensure seed isolation between instances.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * EXTRACTION STRATEGY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * When a payload is embedded into visible text, we need a way to find where
 * the invisible sequence starts and ends. Unlike the variation-selector codec
 * (which uses a dedicated Unicode block), zero-width characters can appear
 * naturally in text (e.g., U+200D in emoji ZWJ sequences like 👨‍👩‍👧).
 *
 * To solve this, we wrap each payload with an invisible DELIMITER sequence:
 *
 *   DELIMITER = U+200B U+2060 U+200B U+2060 U+200C U+200D U+200C U+200D
 *
 * This 8-character sequence is chosen because:
 *   1. It uses an alternating pattern (200B-2060-200B-2060-200C-200D-200C-200D)
 *      that is extremely unlikely to appear in natural text or valid payloads.
 *   2. It does not correspond to any valid 2-byte XOR'd data pattern in practice.
 *   3. It serves as both a start and end marker, making regex extraction reliable.
 *
 * The extraction regex is built as:
 *   <DELIMITER><seed-specific MAGIC prefix (16 chars)><payload chars*><DELIMITER>
 *
 * This ensures that extract() only matches payloads from the same seed.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WIRE FORMAT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   [DELIMITER][MAGIC (4 bytes = 16 ZW chars)][DATA (N bytes = 4N ZW chars)][DELIMITER]
 *
 * The MAGIC bytes ("ZW1\0") are always present and validated during decode.
 * The DELIMITER is stripped before decoding the inner payload.
 */

type DecodeResult =
  | { ok: string }
  | {
      error:
        | 'invisible_not_found'
        | 'invalid_invisible_character'
        | 'invalid_signature'
        | 'invalid_utf8'
    }

// ─────────────────────────────────────────────────────────────────────────────
// Zero-width character ↔ bit-pair mapping
// ─────────────────────────────────────────────────────────────────────────────

/** Bit pair "00" → Zero Width Space */
const ZW_00 = '\u200B'
/** Bit pair "01" → Zero Width Non-Joiner */
const ZW_01 = '\u200C'
/** Bit pair "10" → Zero Width Joiner */
const ZW_10 = '\u200D'
/** Bit pair "11" → Word Joiner */
const ZW_11 = '\u2060'

/**
 * Lookup table: index 0–3 → corresponding zero-width character.
 * Indexed by the 2-bit value of each bit pair.
 */
const PAIR_TO_CHAR: readonly string[] = [ZW_00, ZW_01, ZW_10, ZW_11]

/**
 * Reverse lookup: code point → 2-bit value (0–3).
 * Only the four valid zero-width code points are mapped.
 */
const CODEPOINT_TO_PAIR: ReadonlyMap<number, number> = new Map([
  [0x200b, 0b00],
  [0x200c, 0b01],
  [0x200d, 0b10],
  [0x2060, 0b11],
])

// ─────────────────────────────────────────────────────────────────────────────
// Delimiter — marks payload boundaries in mixed text
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8-character delimiter using an alternating pattern that cannot appear in
 * valid encoded data. The pattern ABAB-CDCD (where A=200B, B=2060, C=200C,
 * D=200D) is structurally distinct from any 2-byte XOR output.
 */
const DELIMITER = `${ZW_00}${ZW_11}${ZW_00}${ZW_11}${ZW_01}${ZW_10}${ZW_01}${ZW_10}`

/**
 * Escaped delimiter for use in RegExp construction.
 * Each character is expressed as a \uXXXX escape.
 */
const DELIMITER_RE_ESCAPED =
  '\\u200B\\u2060\\u200B\\u2060\\u200C\\u200D\\u200C\\u200D'

// ─────────────────────────────────────────────────────────────────────────────
// Shared encoder/decoder instances
// ─────────────────────────────────────────────────────────────────────────────

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

// ─────────────────────────────────────────────────────────────────────────────
// ZeroWidth class
// ─────────────────────────────────────────────────────────────────────────────

class ZeroWidth {
  // "ZW1\0" — format magic + version byte (distinct from the Invisible class's "IV1\0")
  private readonly MAGIC = new Uint8Array([0x5a, 0x57, 0x31, 0x00])

  /**
   * 4-byte rotating XOR key derived from the FNV-1a hash of the seed.
   * Each payload byte at index `i` is XOR'd with keyBytes[i % 4].
   */
  private readonly keyBytes: Uint8Array

  /**
   * Seed-specific regex that matches a delimited payload in mixed text.
   * Pattern: DELIMITER + encoded MAGIC (16 ZW chars) + more ZW chars + DELIMITER
   */
  private readonly extractRE: RegExp

  constructor(seed: string = 'default-seed') {
    // Derive the 4-byte XOR keystream from the seed
    const h = this.hashSeed(seed)
    this.keyBytes = new Uint8Array([
      (h >>> 24) & 0xff,
      (h >>> 16) & 0xff,
      (h >>> 8) & 0xff,
      h & 0xff,
    ])

    // Pre-compute the zero-width representation of the XOR'd MAGIC bytes.
    // This becomes the seed-specific prefix that extract() searches for.
    const magicZW = Array.from(this.MAGIC)
      .map((b, i) => this.byteToZW(b ^ this.keyBytes[i % 4]))
      .join('')

    // Escape each MAGIC zero-width character for use in a regex
    const magicPattern = [...magicZW]
      .map((ch) => `\\u${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`)
      .join('')

    // Zero-width payload character class: matches any of the four ZW characters
    const zwCharClass = '[\\u200B\\u200C\\u200D\\u2060]'

    // Full extraction regex:
    //   DELIMITER → MAGIC (16 chars) → zero or more ZW chars → DELIMITER
    this.extractRE = new RegExp(
      `${DELIMITER_RE_ESCAPED}${magicPattern}${zwCharClass}*${DELIMITER_RE_ESCAPED}`,
      'gu'
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Encode a UTF-8 string into an invisible zero-width character sequence.
   *
   * Wire format:
   *   [DELIMITER][MAGIC XOR'd (16 ZW chars)][DATA XOR'd (4N ZW chars)][DELIMITER]
   *
   * @param input - The plaintext string to encode.
   * @returns A string of zero-width characters (invisible when rendered).
   */
  encode(input: string): string {
    const data = textEncoder.encode(input)

    // Build the full payload: MAGIC + data
    const payload = new Uint8Array(this.MAGIC.length + data.length)
    payload.set(this.MAGIC, 0)
    payload.set(data, this.MAGIC.length)

    // Encode each byte as 4 zero-width characters with XOR obfuscation
    const parts: string[] = []
    for (let i = 0; i < payload.length; i++) {
      const obfuscated = payload[i] ^ this.keyBytes[i % 4]
      parts.push(this.byteToZW(obfuscated))
    }

    // Wrap in delimiters for extraction from mixed text
    return DELIMITER + parts.join('') + DELIMITER
  }

  /**
   * Decode a pure zero-width character sequence back to a UTF-8 string.
   *
   * Expects the raw payload without delimiters — if delimiters are present,
   * they are automatically stripped. Use decodeFrom() for mixed text.
   *
   * @param input - A zero-width encoded string (with or without delimiters).
   * @returns DecodeResult with either the decoded string or an error.
   */
  decode(input: string): DecodeResult {
    // Strip delimiters if present
    let payload = input
    if (payload.startsWith(DELIMITER)) {
      payload = payload.slice(DELIMITER.length)
    }
    if (payload.endsWith(DELIMITER)) {
      payload = payload.slice(0, -DELIMITER.length)
    }

    // Convert zero-width characters to an array of code points
    const chars = [...payload]

    // Each byte requires exactly 4 zero-width characters
    if (chars.length % 4 !== 0) {
      return { error: 'invalid_invisible_character' }
    }

    // Empty input can't contain the MAGIC header
    if (chars.length === 0) {
      return { error: 'invalid_signature' }
    }

    // Decode each group of 4 zero-width characters into one byte
    const bytes: number[] = []
    for (let i = 0; i < chars.length; i += 4) {
      const byteResult = this.zwToByte(chars[i], chars[i + 1], chars[i + 2], chars[i + 3])
      if (byteResult === null) {
        return { error: 'invalid_invisible_character' }
      }

      // De-obfuscate with the rotating XOR key
      const byteIndex = i / 4
      bytes.push(byteResult ^ this.keyBytes[byteIndex % 4])
    }

    // Validate the MAGIC signature
    if (bytes.length < this.MAGIC.length) {
      return { error: 'invalid_signature' }
    }

    for (let j = 0; j < this.MAGIC.length; j++) {
      if (bytes[j] !== this.MAGIC[j]) {
        return { error: 'invalid_signature' }
      }
    }

    // Decode the remaining bytes as UTF-8
    try {
      const decoded = textDecoder.decode(new Uint8Array(bytes.slice(this.MAGIC.length)))
      return { ok: decoded }
    } catch {
      return { error: 'invalid_utf8' }
    }
  }

  /**
   * Extract the first hidden payload from a mixed visible/invisible string.
   *
   * Searches for the seed-specific MAGIC prefix bracketed by delimiters.
   * Only sequences produced by a ZeroWidth instance with the same
   * seed will be matched.
   *
   * @param input - A string that may contain embedded invisible data.
   * @returns The full invisible payload (with delimiters), or null if not found.
   */
  extract(input: string): string | null {
    this.extractRE.lastIndex = 0
    const match = this.extractRE.exec(input)
    return match ? match[0] : null
  }

  /**
   * Convenience method: extracts and decodes a hidden payload in one step.
   * Equivalent to calling extract() then decode().
   *
   * @param input - A string that may contain embedded invisible data.
   * @returns DecodeResult with either the decoded string or an error.
   */
  decodeFrom(input: string): DecodeResult {
    const invisible = this.extract(input)
    if (!invisible) return { error: 'invisible_not_found' }
    return this.decode(invisible)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert a single byte to 4 zero-width characters using 2-bit packing.
   *
   * Splits the byte into four 2-bit groups (MSB-first) and maps each group
   * to the corresponding zero-width character:
   *
   *   bits 7-6 → PAIR_TO_CHAR[group0]
   *   bits 5-4 → PAIR_TO_CHAR[group1]
   *   bits 3-2 → PAIR_TO_CHAR[group2]
   *   bits 1-0 → PAIR_TO_CHAR[group3]
   */
  private byteToZW(byte: number): string {
    return (
      PAIR_TO_CHAR[(byte >> 6) & 0b11] +
      PAIR_TO_CHAR[(byte >> 4) & 0b11] +
      PAIR_TO_CHAR[(byte >> 2) & 0b11] +
      PAIR_TO_CHAR[byte & 0b11]
    )
  }

  /**
   * Convert 4 zero-width characters back to a single byte.
   *
   * Each character is mapped to its 2-bit value via CODEPOINT_TO_PAIR,
   * then the four values are packed MSB-first into one byte.
   *
   * @returns The reconstructed byte (0–255), or null if any character is invalid.
   */
  private zwToByte(c0: string, c1: string, c2: string, c3: string): number | null {
    const p0 = CODEPOINT_TO_PAIR.get(c0.codePointAt(0)!)
    const p1 = CODEPOINT_TO_PAIR.get(c1.codePointAt(0)!)
    const p2 = CODEPOINT_TO_PAIR.get(c2.codePointAt(0)!)
    const p3 = CODEPOINT_TO_PAIR.get(c3.codePointAt(0)!)

    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
      return null
    }

    return (p0 << 6) | (p1 << 4) | (p2 << 2) | p3
  }

  /**
   * FNV-1a 32-bit hash over Unicode code points (not UTF-16 code units).
   *
   * Iterates via for-of to correctly handle surrogate pairs (e.g., emoji).
   * Returns an unsigned 32-bit integer.
   */
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

export { ZeroWidth }
export type { DecodeResult }

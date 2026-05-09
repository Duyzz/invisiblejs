# invisiblejs

> Embed hidden UTF-8 strings inside any text using invisible Unicode characters.

`invisiblejs` provides two steganography codecs that hide data in plain sight using different invisible Unicode character strategies:

| Codec | Characters | Density | Best For |
|---|---|---|---|
| **`Invisible`** | Variation Selectors (`U+E0100–U+E01FF`) | 1 char/byte | Maximum compatibility |
| **`ZeroWidth`** | Zero-width chars (`U+200B`, `U+200C`, `U+200D`, `U+2060`) | 4 chars/byte | Platforms that strip variation selectors |

Both codecs share the same API, use XOR obfuscation with a seed-derived keystream, and include a MAGIC signature for integrity verification.

## Features

- 🔤 **Invisible** — payload characters are zero-width and visually silent
- 🔑 **Seed-keyed** — different seeds produce different, incompatible encodings
- ✅ **Integrity check** — MAGIC signature detects wrong-seed decodes immediately
- 🌍 **Full UTF-8 support** — encode any Unicode string including emoji
- 📦 **Zero dependencies** — pure TypeScript, no runtime deps
- 🔄 **Two codecs** — choose between variation-selector and zero-width encoding

## Installation

```bash
npm install invisiblejs
```

## Quick Start

### Invisible (Variation Selectors)

```ts
import { Invisible } from 'invisiblejs'

const iv = new Invisible('my-secret-seed')

// Encode a secret message into invisible characters
const hidden = iv.encode('top secret')

// Embed them into ordinary visible text
const post = `Check out this tweet! ${hidden} #invisible`

// Later — extract and decode
const result = iv.decodeFrom(post)
if ('ok' in result) {
  console.log(result.ok) // → "top secret"
}
```

### ZeroWidth (Zero-Width Characters)

```ts
import { ZeroWidth } from 'invisiblejs'

const zw = new ZeroWidth('my-secret-seed')

// Same API — encode into zero-width characters
const hidden = zw.encode('top secret')

// Embed into visible text
const post = `Nothing to see here ${hidden} just a normal message`

// Extract and decode
const result = zw.decodeFrom(post)
if ('ok' in result) {
  console.log(result.ok) // → "top secret"
}
```

## API

Both `Invisible` and `ZeroWidth` share an identical API:

### `new Invisible(seed?: string)` / `new ZeroWidth(seed?: string)`

Creates a new instance. The `seed` string determines the XOR keystream and the MAGIC signature embedded at the start of every payload.

- **Default seed**: `'default-seed'`
- Two instances sharing the same seed can encode/decode each other's output.
- Instances with different seeds **cannot** decode each other's output (returns `invalid_signature`).
- `Invisible` and `ZeroWidth` use different character sets and are **not interchangeable**, even with the same seed.

---

### `encode(input: string): string`

Encodes `input` into a sequence of invisible Unicode characters.

```ts
const invisible = iv.encode('hello')
// Invisible:          string of chars in U+E0100–U+E01FF range
// ZeroWidth: string of U+200B, U+200C, U+200D, U+2060
```

---

### `decode(input: string): DecodeResult`

Decodes a string that consists **entirely** of invisible characters (as produced by `encode()`).

```ts
const result = iv.decode(invisible)
if ('ok' in result) {
  console.log(result.ok) // decoded string
} else {
  console.error(result.error) // error code
}
```

---

### `extract(input: string): string | null`

Extracts the first invisible payload from a **mixed** string (visible + invisible characters). Only payloads produced by an instance with the **same seed** will be found.

Returns `null` if no matching payload is found.

```ts
const mixed = `Normal text ${iv.encode('secret')} more text`
const payload = iv.extract(mixed) // → invisible string
```

---

### `decodeFrom(input: string): DecodeResult`

Convenience method — calls `extract()` then `decode()` in one step.

```ts
const result = iv.decodeFrom(mixed)
// { ok: 'secret' }  or  { error: 'invisible_not_found' }
```

---

## Error Types

`decode()` and `decodeFrom()` return a discriminated union:

```ts
type DecodeResult =
  | { ok: string }
  | { error:
      | 'invisible_not_found'        // decodeFrom: no payload in the string
      | 'invalid_invisible_character' // input contains unexpected characters
      | 'invalid_signature'           // MAGIC mismatch — wrong seed or corrupt data
      | 'invalid_utf8'                // payload bytes are not valid UTF-8
    }
```

## How It Works

### Invisible (Variation Selectors)

1. **Seed hashing** — the seed is hashed with FNV-1a 32-bit into a 4-byte keystream.
2. **Payload construction** — `MAGIC (4 bytes) || UTF-8(input)`.
3. **XOR obfuscation** — each byte is XORed with a rotating keystream byte.
4. **Mapping** — obfuscated byte `b` → code point `U+E0100 + b` (range 0–255 → `U+E0100–U+E01FF`).
5. **Extraction** — the encoded MAGIC prefix is used as a regex anchor.

### ZeroWidth (Zero-Width 2-Bit Packing)

1. **Seed hashing** — same FNV-1a 32-bit → 4-byte keystream.
2. **Payload construction** — `MAGIC (4 bytes) || UTF-8(input)`.
3. **XOR obfuscation** — each byte is XORed with a rotating keystream byte.
4. **2-bit packing** — each byte is split into four 2-bit groups (MSB-first), mapped to zero-width characters:
   - `00` → `U+200B` (Zero Width Space)
   - `01` → `U+200C` (Zero Width Non-Joiner)
   - `10` → `U+200D` (Zero Width Joiner)
   - `11` → `U+2060` (Word Joiner)
5. **Delimiter wrapping** — payloads are wrapped in a unique 8-character delimiter sequence for reliable extraction from mixed text.
6. **Extraction** — delimiter + seed-specific MAGIC prefix used as regex anchor.

> **Note:** `U+FEFF` (BOM) is deliberately avoided — many systems strip it when it appears at the start of text.

## Choosing a Codec

| Consideration | `Invisible` | `ZeroWidth` |
|---|---|---|
| **Output size** | 1 char per byte (most compact) | 4 chars per byte + delimiters |
| **Character range** | Supplementary plane (`U+E0100+`) | BMP zero-width (`U+200x`) |
| **Platform support** | Most environments | Better on platforms that strip variation selectors |
| **Natural occurrence** | Variation selectors are rare in text | Zero-width chars appear in emoji/Arabic/Indic text |
| **Extraction** | Regex on unique codepoint range | Delimiter-based boundary markers |

## License

MIT

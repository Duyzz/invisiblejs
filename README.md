# invisiblejs

> Embed hidden UTF-8 strings inside any text using invisible Unicode variation selectors.

`invisiblejs` uses the Unicode **Variation Selector Supplement** block (`U+E0100–U+E01FF`) — characters that are present in text but render invisibly in virtually all environments — to carry a secret, obfuscated payload alongside ordinary visible text.

Each byte of your payload is XOR-obfuscated with a rotating keystream derived from a seed string, and a 4-byte MAGIC signature is prepended so that only the holder of the matching seed can extract and verify the data.

## Features

- 🔤 **Invisible** — payload characters are zero-width and visually silent
- 🔑 **Seed-keyed** — different seeds produce different, incompatible encodings
- ✅ **Integrity check** — MAGIC signature detects wrong-seed decodes immediately
- 🌍 **Full UTF-8 support** — encode any Unicode string including emoji
- 📦 **Zero dependencies** — pure TypeScript, no runtime deps

## Installation

```bash
npm install invisiblejs
```

## Quick Start

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

## API

### `new Invisible(seed?: string)`

Creates a new instance. The `seed` string determines the XOR keystream and the MAGIC signature embedded at the start of every payload.

- **Default seed**: `'default-seed'`
- Two instances sharing the same seed can encode/decode each other's output.
- Instances with different seeds **cannot** decode each other's output (returns `invalid_signature`).

---

### `encode(input: string): string`

Encodes `input` into a sequence of invisible Unicode characters.

```ts
const iv = new Invisible('seed')
const invisible = iv.encode('hello')
// → string of invisible chars only (U+E0100–U+E01FF range)
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
      | 'invisible_not_found'       // decodeFrom: no payload in the string
      | 'invalid_invisible_character' // input contains non-variation-selector chars
      | 'invalid_signature'          // MAGIC mismatch — wrong seed or corrupt data
      | 'invalid_utf8'               // payload bytes are not valid UTF-8
    }
```

## How It Works

1. **Seed hashing** — the seed is hashed with FNV-1a 32-bit into a 4-byte keystream.
2. **Payload construction** — `MAGIC (4 bytes) || UTF-8(input)`.
3. **XOR obfuscation** — each byte is XORed with a rotating keystream byte.
4. **Mapping** — obfuscated byte `b` → code point `U+E0100 + b` (always in range 0–255 → U+E0100–U+E01FF).
5. **Extraction** — the encoded MAGIC prefix is used as a regex anchor, so only payloads from the matching seed are found.

## License

MIT

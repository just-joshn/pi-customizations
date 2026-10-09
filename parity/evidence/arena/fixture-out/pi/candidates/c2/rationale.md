# parseQuery rationale

Design: one index-based pass over the string, tracking pair start and the first '=' position; at each '&' (or end) the pair is sliced and decoded. No `split`.
A hand-written decoder handles '+' and `%XX`, assembling UTF-8 bytes into code points; invalid hex, truncated sequences, bad continuation bytes, overlong forms, surrogates and >U+10FFFF stay literal.
Result is `Object.create(null)`, so `__proto__`/`constructor` are ordinary keys.

## Rejected
- `split('&')` / `split('=')`: allocates arrays, and `split('=')` drops the "first '=' only" rule unless patched.
- `decodeURIComponent` with try/catch: throws on one bad sequence, so the whole component would be left undecoded (or a partially-valid string lost); can't keep only the malformed part literal.
- `URLSearchParams`: replaces malformed sequences with U+FFFD, not literal; not a plain null-prototype record.
- `TextDecoder` on collected bytes: emits U+FFFD for invalid bytes instead of keeping literal text.
- Regex tokenizing: harder to reason about, and offers no gain over a scanner.
- `{}` with `hasOwnProperty` guards or `Map`: the first is error-prone with `__proto__`; a Map doesn't match the required Record shape.
- Decoding '+' after percent-decoding: would turn `%2B` into a space.

# parseQuery — structural rationale

## Approach chosen: normalize → split → decode → accumulate

1. **Normalize input** early: `null` / `undefined` / non-string / `""` / `"?"` → `{}`. Strip one leading `?`.
2. **Split on `&`**, skip empty segments (so trailing/leading/`&&` ampersands never invent an empty key).
3. **Split each segment on the first `=`** only. No `=` means value `""` (bare flags). Empty value after `=` is also `""`.
4. **Decode** key and value with a dedicated form-urlencoded helper (`+` → space, then `decodeURIComponent`, with a safe walk fallback that never throws).
5. **Accumulate** into `Record<string, string[]>`: first sighting creates a one-element array; repeats `push` in encounter order.

This keeps a single linear pipeline with one invariant (values are always arrays) enforced at the only write site.

## Alternatives considered and rejected

| Alternative | Why rejected |
| --- | --- |
| Wrap `URLSearchParams` / `new URL(...)` | Convenient, but behavior for bare flags, empty keys, and malformed `%` is browser/Node-specific and harder to pin to this contract without post-processing. Pulls API surface we do not need. |
| Regex that matches `([^&=]+)(?:=([^&]*))?` globally | Compact, but empty segments, empty keys, and decoding edge cases get buried in the regex; harder for a maintainer to extend (e.g. multi-value separators) without breaking invariants. |
| Mutating a shared decode-in-place buffer / dual maps | Overkill for this size; complicates the “always `string[]`” rule. |
| Fail-hard `decodeURIComponent` only | Violates the safe-decoding requirement on malformed `%` sequences. |
| Byte-wise `String.fromCharCode(parseInt(hex))` fallback | Does not reassemble UTF-8 multi-byte sequences; can corrupt valid encodings adjacent to bad spans. Prefer shrinking `%HH` runs through `decodeURIComponent` or leaving spans as-is. |

## Extensibility notes

- Decoding is isolated in `decodeComponent` / `decodeComponentSafe`, so changing encoding rules does not touch accumulation.
- The accumulate step is the only place arrays are created or extended — future options (e.g. `unique`, last-wins) can branch there without changing the parse loop.
- Empty-segment skipping is explicit; if empty keys from `=value` should later be dropped, that is one guard next to key write.

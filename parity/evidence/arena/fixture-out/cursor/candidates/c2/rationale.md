# parseQuery — structural rationale (c2)

## Approach chosen

A **four-stage pipeline** of small pure helpers:

1. **normalize** — nullish/empty → `""`; strip one leading `?`
2. **tokenize** — `split("&")`, skip empty segments (stray `?` / `&`)
3. **split pair** — first `=` only; no `=` ⇒ value `""`
4. **decode + accumulate** — form-urlencoded decode per component; append to `string[]` in encounter order

`parseQuery` is the only export; helpers stay file-private so invariants (always arrays, safe decode, ignore lone empty keys) live in one place. A future maintainer can swap decode rules, add a key transform, or change accumulation without rewriting the loop shape.

## Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **`URLSearchParams`** | Behavior for missing `=`, empty keys, and malformed `%` varies by engine/version; harder to guarantee `string[]` values and safe non-throwing decode. Extra surface for a pure helper. |
| **Single regex / one mega-function** | Dense and brittle; extending (e.g. nested keys, custom decode) invites invariant breakage. |
| **Immutable `reduce` rebuilding the object each key** | Clear but O(n²) allocations for repeated keys; no API benefit over a fresh local accumulator. |
| **Byte-walker custom UTF-8 decoder** | Overkill vs `decodeURIComponent` + run-based fallback; more code to keep correct. |

## Invariants the structure protects

- Values are always `string[]`.
- Empty input / `"?"` / nullish → `{}` (no `""` key).
- Empty segments from `&` are skipped; explicit `flag` or `a=` still yield `[""]`.
- Decode never throws on bad percent sequences.

# parseQuery rationale (c1: split/map/reduce)

Pipeline: strip one leading `?`, `split('&')`, filter empty pairs, map to `[key, value]` (split at first `=` via `indexOf`), reduce into a null-prototype object of arrays.

Decoding: `+` -> space first, then each run of valid `%XX` escapes is decoded with `decodeURIComponent`; if a run is invalid UTF-8 the run stays literal. Malformed `%` (e.g. `%zz`, trailing `%`) never matches the regex, so it is kept as-is. `%2B` stays `+` because `+` replacement happens before percent-decoding.

Safety: accumulator is `Object.create(null)`, so `__proto__`/`constructor` are ordinary keys.

## Rejected alternatives
- `URLSearchParams`: handles most cases but is not "pure" string logic, returns non-plain structure, and replaces invalid UTF-8 with U+FFFD rather than keeping it literal.
- Whole-string `decodeURIComponent` in try/catch: one bad sequence would leave the entire string undecoded.
- Per-character manual decoder: more code, more bug surface, no benefit.
- `split('=')` then rejoin: needless; `indexOf` is clearer for first-`=` split.
- Plain `{}` accumulator with `hasOwnProperty` checks: `__proto__` assignment still hazardous.
- Imperative for-loop: valid, but the task asked for functional style.

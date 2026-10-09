# parseQuery arena synthesis

## Base
**c2** — named normalize → tokenize → `splitPair` → decode/accumulate pipeline; own-property-safe accumulation. Cross-judge totals: c2 29, c1 28; parent agreed on maintainer-extendability.

## Grafts
| Graft | Source | Why |
| --- | --- | --- |
| Shrinking `%HH` walk (`decodeComponentSafe` / `isHex`) in place of regex whole-run fallback | **c1** | Recovers valid percent-sequences adjacent to malformed UTF-8; still never throws |
| `typeof qs !== "string"` → empty body (no `String(qs)` coercion) | **c1** | Matches nullish/empty/`?` → `{}` contract; avoids surprising coercion of numbers/objects |

## Rejections
| Idea | Source | Why rejected |
| --- | --- | --- |
| Monolithic inline normalize/split/accumulate in `parseQuery` | c1 | Weaker extension seams than c2’s helpers |
| Regex `/(?:%[0-9A-Fa-f]{2})+/g` decode fallback | c2 | Leaves entire failed runs undecoded |
| `String(qs)` for non-strings | c2 | Diverges from strict empty handling |
| Optional “accumulate helper / comment only” note | judge optional | No behavioral gain |
| `Object.create(null)` accumulator | neither (shared weakness note) | Not present in either candidate; out of graft scope for this pass |

## Convergence
Candidates shared the same pipeline *shape* but diverged on helper extraction and decode fallback quality — grafts were needed; not a no-graft convergence.

## Verification
Ran Node ESM assertions against `synthesized/parseQuery.js` from the fixture cwd: empty/nullish/non-string/`?`; multi-value order; bare keys / `a=`; first-`=` split; `+` and UTF-8 decode; malformed `%` non-throw; `toString` key own-property push. All passed.

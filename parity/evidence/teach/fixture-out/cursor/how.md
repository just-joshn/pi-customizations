### Overview

`src/clamp.js` is a tiny ES module that exports one function, `clamp(n, lo, hi)`. It forces a number into the closed interval `[lo, hi]`: below `lo` you get `lo`, above `hi` you get `hi`, otherwise you get `n` unchanged.

It exists so call sites can ask for a bounded value once instead of repeating `Math.min` / `Math.max` (or equivalent if/returns) everywhere. In this fixture app it is the entire product surface—there are no callers, tests, or other modules.

### Key Concepts

- **Closed interval `[lo, hi]`**: inclusive on both ends. Values equal to `lo` or `hi` pass through.
- **Three-way branch**: compare against the floor, then the ceiling, then identity. Order matters only for clarity; with a well-ordered range the two inequality checks don’t overlap for a single `n`.

### How It Works

Callers import `clamp` and pass three values: the candidate `n`, lower bound `lo`, and upper bound `hi`.

1. If `n < lo`, return `lo`.
2. Else if `n > hi`, return `hi`.
3. Else return `n`.

That’s the whole runtime path—no side effects, no coercion, no validation that `lo <= hi`. The module’s JSDoc states the intent (bound to `[lo, hi]`, shared helper so sites stay thin); the body is the two early returns plus the pass-through.

There is no diagram worth drawing: one pure function, one decision tree of three outcomes.

### Where Things Live

| Path | Role |
|------|------|
| `README.md` | Names the fixture and points at `clamp` |
| `src/clamp.js` | Sole implementation; `export function clamp` |

### Gotchas

- **No range sanity check**: if `lo > hi`, every `n` fails both “in range” paths in a confusing way (e.g. anything below `lo` returns `lo`, which may still be above `hi`). Callers are expected to pass a sensible interval.
- **No type guarding**: non-numbers follow ordinary JS `<` / `>` rules (`NaN` comparisons are false, so `NaN` falls through to `return n`).
- **Fixture only**: nothing in this tree imports or tests `clamp`; it’s held out for `/teach` how/why grounding, not a production subsystem.

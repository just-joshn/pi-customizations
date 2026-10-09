# clamp rationale (c1)

## Approach

Early-return branching: compare `n` against `lo` then `hi`, otherwise return `n`.

## Alternatives considered

- **Nested `Math.min` / `Math.max`** (`Math.min(hi, Math.max(lo, n))`): idiomatic and compact, but hides the bound logic in call nesting. Rejected in favor of explicit comparisons.
- **Nested ternaries**: one expression, harder to scan than two early returns. Rejected for readability.
- **Sort-and-pick-middle** (`[n, lo, hi].sort(...)[1]`): clever but wrong for NaN/comparator edge cases and slower. Rejected as fragile.

Committed to branching so the control flow matches the clamp contract directly.

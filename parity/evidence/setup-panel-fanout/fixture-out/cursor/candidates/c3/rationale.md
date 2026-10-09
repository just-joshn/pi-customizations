# clamp rationale (c3)

## Approach

Nested `Math.min` / `Math.max`: raise `n` to at least `lo` with `Math.max(lo, n)`, then cap at `hi` with `Math.min(hi, ...)`. One expression, no branches. Exported as CommonJS `{ clamp }`.

## Alternatives considered and rejected

1. **Early-return branching** (`if (n < lo) return lo; …`) — clear control flow, but already used by sibling candidates; rejected to keep this candidate structurally distinct.
2. **Nested ternaries** (`n < lo ? lo : n > hi ? hi : n`) — same comparison logic as branching in denser form; rejected as neither as explicit as `if` nor as compact as Math composition.
3. **Sort-and-pick-middle** (`[n, lo, hi].sort((a, b) => a - b)[1]`) — cute, but wrong under NaN and needless allocation; rejected as fragile.

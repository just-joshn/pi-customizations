# clamp rationale

Chosen: `Math.min(Math.max(n, min(lo,hi)), max(lo,hi))` — pure composition of
Math.min/Math.max. Branch-free, single expression, always returns a number,
propagates NaN naturally, and tolerates swapped bounds.

Rejected:
- Ternary/if chains (`n < lo ? lo : n > hi ? hi : n`): branchy, returns NaN
  inconsistently depending on comparison order, and not the requested design.
- Sort-based (`[lo, n, hi].sort(...)[1]`): allocates an array, slower, obscure.
- Throwing when lo > hi: stricter, but swapping is more forgiving for a helper.
- Number coercion/validation: extra surface; Math.min/max already coerce to numbers.

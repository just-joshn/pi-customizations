# c2: explicit branches with validation

- Non-number or NaN inputs throw (TypeError/RangeError) rather than silently returning NaN.
- Swapped bounds (lo > hi) are normalized by swapping, so the result is always within [min, max].
- Plain if/return branches; no Math.min/Math.max.

## Rejected alternatives
- `Math.min(Math.max(n, lo), hi)`: propagates NaN silently and gives wrong results for swapped bounds.
- Returning NaN on invalid input: hides bugs; callers expect a number.
- Throwing on swapped bounds: swapping is harmless and more forgiving.
- Coercing with Number(): masks type errors (e.g. null -> 0).

# How: src/clamp.js

`clamp(n, lo, hi)` bounds a value to the inclusive interval [lo, hi] (src/clamp.js:1-6).

1. If n < lo, return lo.
2. Else if n > hi, return hi.
3. Else return n unchanged.

Details:
- Bounds are inclusive. Values equal to a bound pass through.
- lo === hi always returns that bound.
- lo > hi is not validated. Values below lo return lo, values above hi return hi, values in between return lo (the lower check wins).
- NaN fails both comparisons and is returned unchanged.
- No coercion or type validation. JS comparison rules apply.

Where things live: README.md:3-4 (intent), src/clamp.js:1-2 (doc comment), src/clamp.js:3-7 (implementation).

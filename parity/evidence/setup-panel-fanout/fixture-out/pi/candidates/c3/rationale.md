# clamp rationale (c3: median-of-three)

Approach: clamp(n, lo, hi) is the median of [n, lo, hi]; sort numerically and take index 1.
For lo <= hi this equals the clamped value. NaN is checked explicitly because a comparator
with NaN returns NaN and gives an inconsistent sort order.

Rejected:
- `Math.min(Math.max(n, lo), hi)`: the obvious approach, but not structurally distinct.
- Ternary/if chain: same reason; also more branches.
- Curried `clamp(lo, hi)(n)`: changes the required signature `clamp(n, lo, hi)`.
- Default sort without comparator: sorts lexicographically, so [5, 10, 1] would be wrong.

Caveat: if lo > hi the median is not a meaningful clamp (it returns the middle value); inputs are assumed ordered.
Sorting 3 elements costs more than min/max, which is acceptable for a clarity-first variant.

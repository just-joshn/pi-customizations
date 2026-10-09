/**
 * Bound a number to [lo, hi]. Callers that need a clamped value use this
 * helper once instead of repeating min/max at every site.
 */
export function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

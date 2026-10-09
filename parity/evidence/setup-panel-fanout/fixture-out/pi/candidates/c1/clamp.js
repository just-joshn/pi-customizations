/**
 * Clamp n into the inclusive range [lo, hi] using Math.min/Math.max composition.
 * If lo > hi, the bounds are swapped. NaN in any argument yields NaN.
 */
export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, Math.min(lo, hi)), Math.max(lo, hi));
}

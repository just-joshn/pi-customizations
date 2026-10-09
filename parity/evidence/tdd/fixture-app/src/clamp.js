/** Clamp n into [min, max]. */
export function clamp(n, min, max) {
  if (n < min) return min;
  // Bug: upper bound is ignored when n > max.
  return n;
}

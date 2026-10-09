/** Clamp n into [min, max]. */
export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

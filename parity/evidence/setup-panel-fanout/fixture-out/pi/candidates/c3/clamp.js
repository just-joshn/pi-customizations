/**
 * Clamp n into [lo, hi] as the median of [n, lo, hi].
 * Assumes lo <= hi. NaN inputs yield NaN.
 */
export const clamp = (n, lo, hi) => {
  const values = [n, lo, hi];
  if (values.some(Number.isNaN)) return NaN;
  return values.sort((a, b) => a - b)[1];
};

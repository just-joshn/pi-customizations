export function clamp(n, lo, hi) {
  if (typeof n !== 'number' || typeof lo !== 'number' || typeof hi !== 'number') {
    throw new TypeError('clamp: n, lo, hi must be numbers');
  }
  if (Number.isNaN(n) || Number.isNaN(lo) || Number.isNaN(hi)) {
    throw new RangeError('clamp: NaN is not allowed');
  }
  if (lo > hi) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Returns the value, or throws so the test fails loudly when it is missing. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

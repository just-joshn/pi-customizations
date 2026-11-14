export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test fixture');
  return value;
}

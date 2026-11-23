function isDouble<T>(_value: unknown): _value is T {
  return true;
}

export function double<T>(value: unknown): T {
  if (!isDouble<T>(value)) {
    throw new Error('unreachable: test double is always accepted');
  }
  return value;
}

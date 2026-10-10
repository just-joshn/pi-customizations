function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function pythonSorted(values: Iterable<string>): string[] {
  return Array.from(values, (value) => ({ value, points: Array.from(value, (char) => char.codePointAt(0) ?? 0) }))
    .sort((left, right) => compare(left.points, right.points))
    .map(({ value }) => value);
}

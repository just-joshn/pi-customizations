/**
 * Python built-in behavior that ported Aider code depends on, including the exceptions Aider
 * raises by accident. The class names match Python's so oracle comparisons line up, and so a
 * caller can tell an edit-format `ValueError` from a crash the way Aider's `except` clauses do.
 */

export class IndexError extends Error {
  override get name(): string {
    return this.constructor.name;
  }
}

export class AttributeError extends Error {
  override get name(): string {
    return this.constructor.name;
  }
}

/** Python's `items[index]` on a list of strings, including negative indices and `IndexError`. */
export function pyIndex(items: readonly string[], index: number): string {
  const item = items.at(index);
  if (item === undefined) throw new IndexError('list index out of range');
  return item;
}

/** Python's string ordering, which compares code points where JavaScript compares UTF-16 units. */
export function compareCodePoints(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** Python's `sorted(set(values))` for strings. */
export const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareCodePoints);

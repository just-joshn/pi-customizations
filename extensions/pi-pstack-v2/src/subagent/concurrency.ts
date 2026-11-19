/**
 * Run `fn` over `items` with at most `concurrency` calls in flight. Results keep
 * the order of `items`.
 */
export async function mapWithConcurrencyLimit<TIn, TOut>(items: readonly TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const claim = (): number => nextIndex++;

  const drain = async (done: readonly (readonly [number, TOut])[]): Promise<(readonly [number, TOut])[]> => {
    const current = claim();
    if (current >= items.length) return [...done];
    const value = await fn(items[current] as TIn, current);
    return drain([...done, [current, value] as const]);
  };

  const batches = await Promise.all(Array.from({ length: limit }, () => drain([])));
  const byIndex = new Map(batches.flat());
  return items.map((_, index) => byIndex.get(index) as TOut);
}

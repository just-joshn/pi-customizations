/**
 * Run `fn` over `items` with at most `concurrency` calls in flight. Results keep
 * the order of `items`.
 */
export async function mapWithConcurrencyLimit<TIn, TOut>(items: readonly TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const entries = items.map((item, index) => [index, item] as const);
  let nextIndex = 0;
  const claim = (): (typeof entries)[number] | undefined => entries[nextIndex++];

  const drain = async (done: readonly (readonly [number, TOut])[]): Promise<(readonly [number, TOut])[]> => {
    const entry = claim();
    if (!entry) return [...done];
    const [index, item] = entry;
    const value = await fn(item, index);
    return drain([...done, [index, value] as const]);
  };

  const batches = await Promise.all(Array.from({ length: limit }, () => drain([])));
  return batches
    .flat()
    .toSorted(([a], [b]) => a - b)
    .map(([, value]) => value);
}

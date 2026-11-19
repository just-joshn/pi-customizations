export type Attempt<T> = { value: T; error?: undefined } | { value?: undefined; error: Error };

// Runs `run` and reports a thrown Error as a value, so callers can branch on it.
// Anything thrown that is not an Error still fails loudly, as a bare rethrow would.
export async function attempt<T>(run: () => T | Promise<T>): Promise<Attempt<T>> {
  const [outcome] = await Promise.allSettled([Promise.resolve().then(run)]);
  if (outcome.status === "fulfilled") return { value: outcome.value };
  if (outcome.reason instanceof Error) return { error: outcome.reason };
  console.error("A non-Error was thrown:", outcome.reason);
  throw new Error(`A non-Error was thrown: ${String(outcome.reason)}`, { cause: outcome.reason });
}

const ABORTED_MESSAGE = 'Request was aborted';

/**
 * Waits `ms`, or rejects at once when `signal` aborts. The abort listener is gone when the wait ends,
 * so a long-lived signal does not collect one listener per wait.
 */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(new Error(ABORTED_MESSAGE));
    return promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(new Error(ABORTED_MESSAGE));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
  return promise;
}

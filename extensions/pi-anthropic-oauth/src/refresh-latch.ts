/** In-process singleflight. Concurrent callers share one attempt. */
export function createRefreshLatch<T>() {
  let inflight: Promise<T> | undefined;
  return {
    run(work: () => Promise<T>): Promise<T> {
      if (inflight) return inflight;
      const pending = work();
      inflight = pending;
      const clear = () => {
        if (inflight === pending) inflight = undefined;
      };
      void pending.then(clear, clear);
      return pending;
    },
  };
}

import type { AgentSession } from '@earendil-works/pi-coding-agent';

export function workerControl(session: AgentSession, signal: AbortSignal | undefined) {
  let stopped = false;
  let listening = true;
  const failures: string[] = [];
  const pending = new Set<Promise<void>>();
  const abort = () => {
    const operation = Promise.resolve().then(() => session.abort()).catch(error => {
      failures.push(`Worker abort failed: ${String(error)}`);
      try { session.dispose(); }
      catch (disposeError) { failures.push(`Worker disposal failed: ${String(disposeError)}`); }
    });
    pending.add(operation);
    void operation.then(() => pending.delete(operation));
  };
  const stop = () => { if (!listening || stopped) return; stopped = true; abort(); };
  const unsubscribe = session.subscribe(event => {
    if (stopped && event.type === 'agent_start') abort();
  });
  signal?.addEventListener('abort', stop, { once: true });
  return {
    stop, stopped: () => stopped,
    async drain() { await Promise.all(pending); return failures.slice(); },
    unsubscribe() { listening = false; signal?.removeEventListener('abort', stop); unsubscribe(); },
  };
}

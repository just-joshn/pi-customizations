import type { AgentSession, AgentSessionEventListener } from '@earendil-works/pi-coding-agent';

export type Escalation = Readonly<{ taskId: string; log: (message: string) => void; killAfterMs?: number; overdueAfterMs?: number }>;
export const killAfterMs = 10000;
export const overdueAfterMs = 30000;

function stopEscalator(session: AgentSession, failures: string[], plan: Escalation | undefined) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let overdue = false;
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };
  const start = () => {
    clear();
    overdue = false;
    if (!plan) return;
    const kill = setTimeout(() => {
      plan.log(`killEscalation: task ${plan.taskId} still unsettled ${plan.killAfterMs ?? killAfterMs}ms after kill; killed process groups of 1 agent(s)`);
      try {
        session.dispose();
      } catch (error) {
        failures.push(`Worker disposal failed: ${String(error)}`);
      }
    }, plan.killAfterMs ?? killAfterMs);
    const late = setTimeout(() => {
      overdue = true;
      plan.log(`killEscalation: task ${plan.taskId} loop never settled after kill — record retained as its stop handle; TaskStop re-fires, session restart is the final recovery`);
    }, plan.overdueAfterMs ?? overdueAfterMs);
    timers = [kill, late];
  };
  return { start, clear, overdue: () => overdue };
}

function abortSession(session: AgentSession, failures: string[], pending: Set<Promise<void>>): void {
  const operation = Promise.resolve()
    .then(() => session.abort())
    .catch((error) => {
      failures.push(`Worker abort failed: ${String(error)}`);
      try {
        session.dispose();
      } catch (disposeError) {
        failures.push(`Worker disposal failed: ${String(disposeError)}`);
      }
    });
  pending.add(operation);
  void operation.then(() => pending.delete(operation));
}

export function workerControl(session: AgentSession, signal: AbortSignal | undefined, observe?: AgentSessionEventListener, escalation?: Escalation) {
  let stopped = false;
  let listening = true;
  const failures: string[] = [];
  const pending = new Set<Promise<void>>();
  const abort = () => abortSession(session, failures, pending);
  const escalator = stopEscalator(session, failures, escalation);
  const stop = () => {
    if (!listening || (stopped && !escalator.overdue())) return;
    stopped = true;
    abort();
    escalator.start();
  };
  const unsubscribe = session.subscribe((event) => {
    if (!listening) return;
    if (stopped) {
      if (event.type === 'agent_start') abort();
      return;
    }
    observe?.(event);
  });
  signal?.addEventListener('abort', stop, { once: true });
  return {
    stop,
    stopped: () => stopped,
    async drain() {
      await Promise.all(pending);
      return failures.slice();
    },
    unsubscribe() {
      listening = false;
      escalator.clear();
      signal?.removeEventListener('abort', stop);
      unsubscribe();
    },
  };
}

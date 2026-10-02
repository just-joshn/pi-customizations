import type { AgentSession, AgentSessionEventListener } from '@earendil-works/pi-coding-agent';
import { type AbortInfo, type AbortReason, abortInfo, normalizeAbortReason } from './subagents/abort-reasons.ts';

export type Escalation = Readonly<{ foreground?: boolean; onAbort?: (info: AbortInfo) => void; taskId: string; log: (message: string) => void; killGroups?: () => number; killAfterMs?: number; overdueAfterMs?: number }>;
export const killAfterMs = 10000;
export const overdueAfterMs = 30000;

export function waitFor<T>(completion: Promise<T>, signal: AbortSignal | undefined, cancelled: string): Promise<T> {
  if (!signal) return completion;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error(cancelled));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    completion.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function launchSignal(signal: AbortSignal | undefined, background: boolean): AbortSignal | undefined {
  if (!signal?.aborted) return signal;
  if (background && normalizeAbortReason(signal.reason) === 'interrupt') return undefined;
  throw new DOMException('Task launch was aborted before startup.', 'AbortError');
}

function stopEscalator(session: AgentSession, failures: string[], plan: Escalation | undefined, abort: () => void) {
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
      abort();
      const agents = plan.killGroups?.() ?? 1;
      plan.log(`killEscalation: task ${plan.taskId} still unsettled ${plan.killAfterMs ?? killAfterMs}ms after kill; killed process groups of ${agents} agent(s)`);
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
  let info: AbortInfo | undefined;
  let listening = true;
  const failures: string[] = [];
  const pending = new Set<Promise<void>>();
  const abort = () => abortSession(session, failures, pending);
  const escalator = stopEscalator(session, failures, escalation, abort);
  const stop = (reason: AbortReason, parentSignal: boolean) => {
    if (!listening || (stopped && !escalator.overdue())) return;
    if (!stopped) {
      info = abortInfo(reason, parentSignal && (escalation?.foreground ?? false));
      escalation?.onAbort?.(info);
    }
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
  const signalAbort = () => stop(abortInfo(signal?.reason, false).reason, true);
  signal?.addEventListener('abort', signalAbort, { once: true });
  if (signal?.aborted) signalAbort();
  return {
    stop: (reason: AbortReason = 'user-cancel') => stop(reason, false),
    stopped: () => stopped,
    abortInfo: () => info,
    async drain() {
      await Promise.all(pending);
      return failures.slice();
    },
    unsubscribe() {
      listening = false;
      escalator.clear();
      signal?.removeEventListener('abort', signalAbort);
      unsubscribe();
    },
  };
}

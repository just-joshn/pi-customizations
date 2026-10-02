import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent';

const closing = new WeakMap<AgentSessionRuntime, Promise<void>>();

async function shutDown(runtime: AgentSessionRuntime): Promise<void> {
  const failures: unknown[] = [];
  const unsubscribe = runtime.session.extensionRunner.onError((error) => failures.push(error.error));
  try {
    await runtime.dispose();
  } catch (error) {
    failures.push(error);
  } finally {
    unsubscribe();
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('; '));
}

/** Shuts a child runtime down once, however many callers ask. The runtime emits session_shutdown before it disposes the session, and handler failures surface here. */
export function closeRuntime(runtime: AgentSessionRuntime): Promise<void> {
  const pending = closing.get(runtime) ?? shutDown(runtime);
  closing.set(runtime, pending);
  return pending;
}

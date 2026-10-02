import type { AgentSession } from '@earendil-works/pi-coding-agent';

const closing = new WeakMap<AgentSession, Promise<void>>();

async function shutDown(session: AgentSession): Promise<void> {
  const failures: unknown[] = [];
  const unsubscribe = session.extensionRunner.onError((error) => failures.push(error.error));
  try {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  } catch (error) {
    failures.push(error);
  } finally {
    unsubscribe();
    try {
      session.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('; '));
}

/** Shuts a child session down once, however many callers ask. */
export function closeSession(session: AgentSession): Promise<void> {
  const pending = closing.get(session);
  if (pending) return pending;
  const operation = shutDown(session);
  closing.set(session, operation);
  return operation;
}

import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const stopPendingEvent = 'pstack:subagent-stop-pending';

const StopPending = Type.Object({ agentId: Type.String({ minLength: 1 }) });

export function stopPendingFor(payload: unknown, agentId: string | undefined): boolean {
  return agentId !== undefined && Check(StopPending, payload) && payload.agentId === agentId;
}

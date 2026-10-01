import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

const StopControl = Type.Object(
  {
    type: Type.Literal('stop_task'),
    task_id: Type.String({ minLength: 1 }),
    request_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

function failure(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }], details: { status: 'failed' as const, message } };
}

export function registerStopControl(pi: Pick<ExtensionAPI, 'events'>, stop: (reference: string) => Promise<unknown>): () => void {
  let active = true;
  const off = pi.events.on('pstack:subagent-control', async (request: unknown) => {
    if (!Check(StopControl, request)) {
      pi.events.emit('pstack:subagent-control-result', { result: failure('Invalid stop_task control message.') });
      return;
    }
    let result: unknown;
    try {
      result = await stop(request.task_id);
    } catch (error) {
      result = failure(`Stop control failed: ${String(error)}`);
    }
    if (active) pi.events.emit('pstack:subagent-control-result', { ...(request.request_id !== undefined ? { request_id: request.request_id } : {}), result });
  });
  return () => {
    active = false;
    off();
  };
}

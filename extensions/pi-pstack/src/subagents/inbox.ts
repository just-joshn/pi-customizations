import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';

export const inboxChannel = 'copilot:inbox';
const Payload = Type.Object({ message: Type.String() });
export const SendInboxSchema = Type.Object({ message: Type.String({ minLength: 1, description: 'One short message for the agent that started you.' }) }, { additionalProperties: false });
const Details = Type.Object({ delivered: Type.Boolean() });

export function inboxMessage(payload: unknown): string | undefined {
  return Check(Payload, payload) ? payload.message : undefined;
}

type Emit = (channel: string, data: unknown) => void;

/** The tool a sidekick uses to reach its parent. Outside a sidekick there is no parent to reach. */
export function sendInboxTool(emit: Emit, isChild: () => boolean): ToolDefinition<typeof SendInboxSchema, Static<typeof Details>> {
  return {
    name: 'send_inbox',
    label: 'Send inbox',
    description: 'Send one short message to the agent that started you. Only sidekicks can use it.',
    promptSnippet: 'Send a message to the agent that started you',
    parameters: SendInboxSchema,
    outputSchema: Details,
    exposure: 'direct',
    annotations: { openWorldHint: false },
    execute: async (_id, params) => {
      if (!isChild()) throw new Error('send_inbox is only available to sidekicks.');
      emit(inboxChannel, { message: params.message });
      return { content: [{ type: 'text', text: 'Message sent.' }], details: { delivered: true } };
    },
  };
}

import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from '@earendil-works/pi-ai';

export interface StreamRun {
  readonly events: readonly AssistantMessageEvent[];
  readonly message: AssistantMessage;
}

export async function collect(stream: AssistantMessageEventStream): Promise<StreamRun> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, message: await stream.result() };
}

export function textOf(message: AssistantMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

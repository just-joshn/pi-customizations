import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type BridgedEvent = Readonly<{ type: string; data: Readonly<Record<string, unknown>>; ephemeral?: true }>;

type Content = string | ReadonlyArray<{ type: string; text?: string }>;

export function textOf(content: Content): string {
  if (typeof content === 'string') return content;
  return content.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n');
}

function messageEvent(role: string, content: Content): BridgedEvent | undefined {
  if (role === 'assistant') return { type: 'assistant.message', data: { content: textOf(content) } };
  if (role === 'user') return { type: 'user.message', data: { content: textOf(content) } };
  return undefined;
}

function deltaOf(event: Extract<AgentSessionEvent, { type: 'message_update' }>): BridgedEvent | undefined {
  const update = event.assistantMessageEvent;
  return update.type === 'text_delta' ? { type: 'assistant.message_delta', data: { delta: update.delta }, ephemeral: true } : undefined;
}

function toolEvent(event: Extract<AgentSessionEvent, { type: 'tool_execution_start' | 'tool_execution_end' }>): BridgedEvent | undefined {
  if (event.parentToolCallId !== undefined) return undefined;
  if (event.type === 'tool_execution_start') return { type: 'tool.execution_start', data: { toolCallId: event.toolCallId, toolName: event.toolName, arguments: event.args } };
  return { type: 'tool.execution_complete', data: { toolCallId: event.toolCallId, toolName: event.toolName, success: !event.isError } };
}

/** Maps pi child session events onto the Reference Assistant events the bridge copies to the parent stream, numbering the turns it sees. */
export class EventBridge {
  private turn = -1;

  translate(event: AgentSessionEvent): BridgedEvent | undefined {
    switch (event.type) {
      case 'turn_start':
        this.turn += 1;
        return { type: 'assistant.turn_start', data: { turnId: String(this.turn) } };
      case 'turn_end':
        return { type: 'assistant.turn_end', data: { turnId: String(this.turn) } };
      case 'message_end':
        return messageEvent(event.message.role, 'content' in event.message ? event.message.content : '');
      case 'message_update':
        return deltaOf(event);
      case 'tool_execution_start':
      case 'tool_execution_end':
        return toolEvent(event);
      default:
        return undefined;
    }
  }
}

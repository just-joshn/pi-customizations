export interface UsageCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

type ContentBlockStart = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, never> };

type BlockDelta = { type: 'text_delta'; text: string } | { type: 'thinking_delta'; thinking: string } | { type: 'signature_delta'; signature: string } | { type: 'input_json_delta'; partial_json: string };

export type WireStopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export type AnthropicEvent =
  | { type: 'message_start'; message: { id: string; model: string; usage: UsageCounts } }
  | { type: 'content_block_start'; index: number; content_block: ContentBlockStart }
  | { type: 'content_block_delta'; index: number; delta: BlockDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: WireStopReason }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

export const DEFAULT_USAGE: UsageCounts = {
  input_tokens: 10,
  output_tokens: 0,
  cache_read_input_tokens: 4,
  cache_creation_input_tokens: 2,
};

export function frame(event: AnthropicEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function frames(events: readonly AnthropicEvent[]): string {
  return events.map(frame).join('');
}

export function messageStart(usage: UsageCounts = DEFAULT_USAGE): AnthropicEvent {
  return { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-6', usage } };
}

export function finish(stopReason: WireStopReason, outputTokens = 7): readonly AnthropicEvent[] {
  return [{ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: outputTokens } }, { type: 'message_stop' }];
}

export function textBlock(index: number, text: string): readonly AnthropicEvent[] {
  return [
    { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index },
  ];
}

export function toolUseBlock(index: number, id: string, name: string, jsonChunks: readonly string[]): readonly AnthropicEvent[] {
  return [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
    ...jsonChunks.map((partial_json): AnthropicEvent => ({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } })),
    { type: 'content_block_stop', index },
  ];
}

export function textMessage(text: string, usage: UsageCounts = DEFAULT_USAGE): readonly AnthropicEvent[] {
  return [messageStart(usage), ...textBlock(0, text), ...finish('end_turn')];
}

export function toolUseMessage(id: string, name: string, jsonChunks: readonly string[]): readonly AnthropicEvent[] {
  return [messageStart(), ...toolUseBlock(0, id, name, jsonChunks), ...finish('tool_use')];
}

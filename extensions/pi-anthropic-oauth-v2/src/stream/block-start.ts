import type Anthropic from '@anthropic-ai/sdk';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import { fromClaudeCodeName } from '../tools/names.ts';
import { type ContentBlock, type StreamContext, type StreamState, type StreamStep, unchanged, withOpenBlock } from './state.ts';

type StartedBlock = {
  readonly block: ContentBlock;
  readonly eventType: 'text_start' | 'thinking_start' | 'toolcall_start';
};

function toStartedBlock(start: Anthropic.Beta.BetaRawContentBlockStartEvent['content_block'], context: StreamContext): StartedBlock | undefined {
  if (start.type === 'text') return { block: { type: 'text', text: '' }, eventType: 'text_start' };
  if (start.type === 'thinking') return { block: { type: 'thinking', thinking: '', thinkingSignature: '' }, eventType: 'thinking_start' };
  if (start.type === 'tool_use') {
    const name = context.isOAuth ? fromClaudeCodeName(start.name, context.tools) : start.name;
    return { block: { type: 'toolCall', id: start.id, name, arguments: {} }, eventType: 'toolcall_start' };
  }
  return undefined;
}

export function startBlock(state: StreamState, event: Anthropic.Beta.BetaRawContentBlockStartEvent, context: StreamContext): StreamStep {
  const started = toStartedBlock(event.content_block, context);
  if (!started) return unchanged(state);
  const contentIndex = state.output.content.length;
  const output = { ...state.output, content: [...state.output.content, started.block] };
  const blocks = withOpenBlock(state.blocks, event.index, { contentIndex, json: '' });
  const startEvent: AssistantMessageEvent = { type: started.eventType, contentIndex, partial: output };
  return { state: { output, blocks }, events: [startEvent] };
}

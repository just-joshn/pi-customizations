import type { StopReason as AnthropicStopReason, MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages.js';
import type { StopReason } from '@earendil-works/pi-ai';
import { updateBlock } from './block-delta.ts';
import { startBlock } from './block-start.ts';
import { stopBlock } from './block-stop.ts';
import { type StreamContext, type StreamState, type StreamStep, unchanged } from './state.ts';
import { toUsage } from './usage.ts';

const STOP_REASONS: Readonly<Partial<Record<AnthropicStopReason, StopReason>>> = {
  end_turn: 'stop',
  pause_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'toolUse',
};

export const mapStopReason = (reason: AnthropicStopReason): StopReason => STOP_REASONS[reason] ?? 'error';

export function reduceEvent(state: StreamState, event: MessageStreamEvent, context: StreamContext): StreamStep {
  switch (event.type) {
    case 'message_start':
      return unchanged({ ...state, output: { ...state.output, usage: toUsage(context.model, event.message.usage) } });
    case 'content_block_start':
      return startBlock(state, event, context);
    case 'content_block_delta':
      return updateBlock(state, event);
    case 'content_block_stop':
      return stopBlock(state, event);
    case 'message_delta': {
      const stopReason = event.delta.stop_reason ? mapStopReason(event.delta.stop_reason) : state.output.stopReason;
      return unchanged({ ...state, output: { ...state.output, stopReason, usage: toUsage(context.model, event.usage) } });
    }
    default:
      return unchanged(state);
  }
}

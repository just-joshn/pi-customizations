import type Anthropic from '@anthropic-ai/sdk';
import type { StopReason } from '@earendil-works/pi-ai';
import { updateBlock } from './block-delta.ts';
import { startBlock } from './block-start.ts';
import { stopBlock } from './block-stop.ts';
import { type StreamContext, type StreamState, type StreamStep, unchanged } from './state.ts';
import { toUsage } from './usage.ts';

const STOP_REASONS: Readonly<Partial<Record<Anthropic.Beta.BetaStopReason, StopReason>>> = {
  end_turn: 'stop',
  pause_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'toolUse',
  model_context_window_exceeded: 'length',
};

const REFUSAL_MESSAGE = 'The model refused to complete the request';

type MessageDelta = Anthropic.Beta.BetaRawMessageDeltaEvent;

export const mapStopReason = (reason: Anthropic.Beta.BetaStopReason): StopReason => STOP_REASONS[reason] ?? 'error';

function applyMessageDelta(state: StreamState, event: MessageDelta, context: StreamContext): StreamState['output'] {
  const { stop_reason: reason, stop_details: details } = event.delta;
  const stopReason = reason ? mapStopReason(reason) : state.output.stopReason;
  const refusal = details?.type === 'refusal' ? { errorMessage: details.explanation || REFUSAL_MESSAGE } : {};
  return { ...state.output, ...refusal, stopReason, usage: toUsage(context.model, event.usage) };
}

export function reduceEvent(state: StreamState, event: Anthropic.Beta.BetaRawMessageStreamEvent, context: StreamContext): StreamStep {
  switch (event.type) {
    case 'message_start':
      return unchanged({ ...state, output: { ...state.output, usage: toUsage(context.model, event.message.usage) } });
    case 'content_block_start':
      return startBlock(state, event, context);
    case 'content_block_delta':
      return updateBlock(state, event);
    case 'content_block_stop':
      return stopBlock(state, event);
    case 'message_delta':
      return unchanged({ ...state, output: applyMessageDelta(state, event, context) });
    default:
      return unchanged(state);
  }
}

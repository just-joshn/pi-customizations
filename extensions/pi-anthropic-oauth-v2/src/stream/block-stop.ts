import type Anthropic from '@anthropic-ai/sdk';
import { type AssistantMessageEvent, parseToolCallArguments } from '@earendil-works/pi-ai';
import { type ContentBlock, replaceBlock, type StreamState, type StreamStep, unchanged, withoutOpenBlock } from './state.ts';

function finishBlock(state: StreamState, contentIndex: number, block: ContentBlock, json: string): StreamStep {
  if (block.type === 'text') {
    return { state, events: [{ type: 'text_end', contentIndex, content: block.text, partial: state.output }] };
  }
  if (block.type === 'thinking') {
    return { state, events: [{ type: 'thinking_end', contentIndex, content: block.thinking, partial: state.output }] };
  }
  const toolCall = { ...block, ...parseToolCallArguments(json) };
  const output = replaceBlock(state.output, contentIndex, toolCall);
  const event: AssistantMessageEvent = { type: 'toolcall_end', contentIndex, toolCall, partial: output };
  return { state: { ...state, output }, events: [event] };
}

export function stopBlock(state: StreamState, event: Anthropic.Beta.BetaRawContentBlockStopEvent): StreamStep {
  const open = state.blocks.get(event.index);
  const block = open ? state.output.content[open.contentIndex] : undefined;
  if (!open || !block) return unchanged(state);
  return finishBlock({ ...state, blocks: withoutOpenBlock(state.blocks, event.index) }, open.contentIndex, block, open.json);
}

import type Anthropic from '@anthropic-ai/sdk';
import { parseStreamingJson } from '@earendil-works/pi-ai';
import { type ContentBlock, type OpenBlock, replaceBlock, type StreamState, type StreamStep, unchanged, withOpenBlock } from './state.ts';

type DeltaEvent = Anthropic.Beta.BetaRawContentBlockDeltaEvent;
type Delta = DeltaEvent['delta'];

type DeltaTarget = {
  readonly state: StreamState;
  readonly index: number;
  readonly open: OpenBlock;
  readonly block: ContentBlock;
};

function appendText({ state, open, block }: DeltaTarget, text: string): StreamStep {
  if (block.type !== 'text') return unchanged(state);
  const output = replaceBlock(state.output, open.contentIndex, { ...block, text: block.text + text });
  return { state: { ...state, output }, events: [{ type: 'text_delta', contentIndex: open.contentIndex, delta: text, partial: output }] };
}

function appendThinking({ state, open, block }: DeltaTarget, thinking: string): StreamStep {
  if (block.type !== 'thinking') return unchanged(state);
  const output = replaceBlock(state.output, open.contentIndex, { ...block, thinking: block.thinking + thinking });
  return { state: { ...state, output }, events: [{ type: 'thinking_delta', contentIndex: open.contentIndex, delta: thinking, partial: output }] };
}

function appendSignature({ state, open, block }: DeltaTarget, signature: string): StreamStep {
  if (block.type !== 'thinking') return unchanged(state);
  const output = replaceBlock(state.output, open.contentIndex, { ...block, thinkingSignature: (block.thinkingSignature || '') + signature });
  return { state: { ...state, output }, events: [] };
}

function appendArguments({ state, index, open, block }: DeltaTarget, partialJson: string): StreamStep {
  if (block.type !== 'toolCall') return unchanged(state);
  const json = open.json + partialJson;
  const output = replaceBlock(state.output, open.contentIndex, { ...block, arguments: parseStreamingJson(json) });
  const blocks = withOpenBlock(state.blocks, index, { ...open, json });
  return { state: { output, blocks }, events: [{ type: 'toolcall_delta', contentIndex: open.contentIndex, delta: partialJson, partial: output }] };
}

function applyDelta(target: DeltaTarget, delta: Delta): StreamStep {
  if (delta.type === 'text_delta') return appendText(target, delta.text);
  if (delta.type === 'thinking_delta') return appendThinking(target, delta.thinking);
  if (delta.type === 'signature_delta') return appendSignature(target, delta.signature);
  if (delta.type === 'input_json_delta') return appendArguments(target, delta.partial_json);
  return unchanged(target.state);
}

export function updateBlock(state: StreamState, event: DeltaEvent): StreamStep {
  const open = state.blocks.get(event.index);
  const block = open ? state.output.content[open.contentIndex] : undefined;
  if (!open || !block) return unchanged(state);
  return applyDelta({ state, index: event.index, open, block }, event.delta);
}

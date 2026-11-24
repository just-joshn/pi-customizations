import { expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, SMALL_CONTEXT_WINDOW } from '../src/constants.ts';
import { EMPTY_TURN, reduceTurn, REFUSAL_MESSAGE, type TurnAction, type TurnState } from '../src/stream-state.ts';
import type { ToolBridgeCall } from '../src/types.ts';

const bash: ToolBridgeCall = { piTool: 'bash', arguments: { command: 'ls' }, agyTool: 'run_command', callId: 'c1' };
const read: ToolBridgeCall = { piTool: 'read', arguments: { path: 'a.ts' }, agyTool: 'view_file', callId: 'c2' };

function apply(actions: readonly TurnAction[]): TurnState {
  return actions.reduce(reduceTurn, EMPTY_TURN);
}

it('appends text onto the open text block and starts a new one after another type', () => {
  const state = apply([
    { kind: 'text', delta: 'hel' },
    { kind: 'text', delta: 'lo' },
    { kind: 'thinking', delta: 'plan' },
    { kind: 'text', delta: 'again' },
  ]);
  expect(state.blocks).toEqual([
    { type: 'text', text: 'hello' },
    { type: 'thinking', thinking: 'plan' },
    { type: 'text', text: 'again' },
  ]);
  expect(state.stopReason).toBe('pending');
});

it('appends thinking the same way', () => {
  const state = apply([
    { kind: 'thinking', delta: 'a' },
    { kind: 'thinking', delta: 'b' },
    { kind: 'text', delta: 'c' },
    { kind: 'thinking', delta: 'd' },
  ]);
  expect(state.blocks).toEqual([
    { type: 'thinking', thinking: 'ab' },
    { type: 'text', text: 'c' },
    { type: 'thinking', thinking: 'd' },
  ]);
});

it('always appends a tool block', () => {
  const state = apply([
    { kind: 'text', delta: 'look' },
    { kind: 'tool', call: bash },
    { kind: 'tool', call: read },
  ]);
  expect(state.blocks).toEqual([
    { type: 'text', text: 'look' },
    { type: 'toolCall', call: bash },
    { type: 'toolCall', call: read },
  ]);
});

it('maps each stop reason onto the Pi stop Pi should report', () => {
  expect(apply([{ kind: 'stop', reason: 'end_turn' }]).stopReason).toBe('stop');
  expect(
    apply([
      { kind: 'tool', call: bash },
      { kind: 'stop', reason: 'end_turn' },
    ]).stopReason,
  ).toBe('toolUse');
  expect(apply([{ kind: 'stop', reason: 'max_tokens' }]).stopReason).toBe('length');
  expect(apply([{ kind: 'stop', reason: 'cancelled' }]).stopReason).toBe('aborted');
  const refusal = apply([{ kind: 'stop', reason: 'refusal' }]);
  expect(refusal.stopReason).toBe('error');
  expect(refusal.errorMessage).toBe(REFUSAL_MESSAGE);
});

it('records a failure as an error and leaves usage as the only post-settle change', () => {
  const failed = apply([
    { kind: 'text', delta: 'partial' },
    { kind: 'fail', message: 'down' },
  ]);
  expect(failed.stopReason).toBe('error');
  expect(failed.errorMessage).toBe('down');
  const withUsage = reduceTurn(failed, { kind: 'usage', contextSize: DEFAULT_CONTEXT_WINDOW });
  expect(withUsage.contextSize).toBe(DEFAULT_CONTEXT_WINDOW);
  expect(withUsage.stopReason).toBe('error');
  expect(withUsage.blocks).toEqual(failed.blocks);
  expect(reduceTurn(EMPTY_TURN, { kind: 'usage', contextSize: SMALL_CONTEXT_WINDOW }).contextSize).toBe(SMALL_CONTEXT_WINDOW);
});

it('drops content, stops, and failures once the turn has settled', () => {
  const settled = apply([
    { kind: 'tool', call: bash },
    { kind: 'stop', reason: 'end_turn' },
  ]);
  expect(reduceTurn(settled, { kind: 'text', delta: 'late' })).toEqual(settled);
  expect(reduceTurn(settled, { kind: 'thinking', delta: 'late' })).toEqual(settled);
  expect(reduceTurn(settled, { kind: 'tool', call: read })).toEqual(settled);
  expect(reduceTurn(settled, { kind: 'stop', reason: 'max_tokens' })).toEqual(settled);
  expect(reduceTurn(settled, { kind: 'fail', message: 'late' })).toEqual(settled);
});

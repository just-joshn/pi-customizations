import { expect, test } from 'vitest';
import { defaultLastTurnWarning, TurnLimit } from '../src/subagents/turn-limit.ts';

test('turns that call no tools never count', () => {
  const limit = new TurnLimit(1);
  expect([limit.onTurnEnd(0), limit.onTurnEnd(0)]).toEqual(['continue', 'continue']);
});

test('the warning comes one turn before the stop', () => {
  const limit = new TurnLimit(3);
  expect([limit.onTurnEnd(1), limit.onTurnEnd(2), limit.onTurnEnd(1), limit.onTurnEnd(1)]).toEqual(['continue', 'warn', 'stop', 'stop']);
});

test('a limit of one stops after the first tool turn', () => {
  expect(new TurnLimit(1).onTurnEnd(1)).toBe('stop');
});

test('the note names the limit and the default warning asks for the report', () => {
  expect(new TurnLimit(7).note()).toBe('Note: this agent stopped at its 7-turn limit, so the text above may be partial.');
  expect(new TurnLimit(2).warning).toBe(defaultLastTurnWarning);
  expect(new TurnLimit(2, 'custom').warning).toBe('custom');
});

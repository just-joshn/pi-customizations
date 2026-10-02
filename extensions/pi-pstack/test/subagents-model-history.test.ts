import { expect, test } from 'vitest';
import { ModelHistory } from '../src/subagents/model-history.ts';

test('model history preserves model transitions while collapsing adjacent repeats', () => {
  const history = new ModelHistory(['a', 'a']);
  const initial = history.snapshot();
  history.record('b');
  history.record('b');
  history.record('a');
  expect(initial).toEqual(['a']);
  expect(history.snapshot()).toEqual(['a', 'b', 'a']);
  expect(history.snapshot()).not.toBe(history.snapshot());
});

test('an empty history records every model chosen through the extension listener', () => {
  const history = new ModelHistory();
  const listeners = new Map<string, (event: { model: { provider: string; id: string } }) => void>();
  history.extensionFactory()({
    on: (name: string, handler: (event: { model: { provider: string; id: string } }) => void) => listeners.set(name, handler),
  } as never);
  const select = listeners.get('model_select');
  expect(select).toBeDefined();
  select?.({ model: { provider: 'github-copilot', id: 'gpt-5' } });
  select?.({ model: { provider: 'anthropic', id: 'claude' } });
  expect(history.snapshot()).toEqual(['github-copilot/gpt-5', 'anthropic/claude']);
});

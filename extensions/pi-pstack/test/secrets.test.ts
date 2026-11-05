import { expect, test, vi } from 'vitest';
import { MaskedInput } from '../src/secrets.ts';

test('the masked field shows dots, never the typed or pasted characters, and Enter returns the value', () => {
  const done = vi.fn();
  const input = new MaskedInput('Secret requested: token', done);
  input.handleInput('ab');
  input.handleInput('\x7f');
  input.handleInput('\x1b[200~xoxb-123\n\x1b[201~');
  const screen = input.render(80).join('\n');
  expect(screen).not.toContain('xoxb');
  expect(screen).toContain('> •••••••••\n');
  input.handleInput('\r');
  expect(done).toHaveBeenCalledWith('axoxb-123');
});

test('Escape cancels without a value', () => {
  const done = vi.fn();
  new MaskedInput('t', done).handleInput('secret\x1b');
  expect(done).toHaveBeenCalledWith(undefined);
});

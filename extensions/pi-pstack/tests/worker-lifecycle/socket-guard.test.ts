import { expect, test } from 'vitest';
import { workerSocket } from '../../src/workers.ts';

test('tests run on a private tmux server and can never resolve the real pstack server', () => {
  expect(process.env['PSTACK_TMUX_SOCKET']).toMatch(/^pstack-test-/);
  expect(workerSocket()).toBe(process.env['PSTACK_TMUX_SOCKET']);
  expect(() => workerSocket('pstack')).toThrow(/must not use the real pstack tmux server/);
});

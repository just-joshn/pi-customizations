import { expect, test } from 'vitest';
import { interactionFamily } from './families/interaction.ts';
import type { RunView } from './lib/view.ts';

const typed = interactionFamily.checks.find((entry) => entry.id === 'worker-interaction.typed-prompt-reaches-the-transcript');
const result = (command: string, name = 'bash') =>
  typed?.run({
    runs: [{ id: 'r', workers: [{ id: 'w', assignment: { kind: 'pi' }, state: { tmuxSession: 't' }, session: { messages: [{ role: 'user', order: 1, text: 'PANE-PROMPT-7f3a' }], toolCalls: [{ order: 2, name, args: { command } }] } }] }],
  } as unknown as RunView);

test('a readonly worker runs the requested command through its shell', () => {
  expect(result('sleep 6', 'bash_readonly')).toMatchObject({ ok: true });
  expect(result('sleep 6', 'read')).toMatchObject({ ok: false });
});

test('the requested long command can report its exit status afterwards', () => {
  expect(result('sleep 6; echo "exit=$?"')).toMatchObject({ ok: true });
});

test.each(['sleep 60', 'echo sleep 6', 'true; sleep 6', 'sleep 6x'])('a different leading command is rejected: %s', (command) => {
  expect(result(command)).toMatchObject({ ok: false });
});

import { expect, test } from 'vitest';
import { modeDeclared } from './families/pr-shared.ts';
import type { RunView } from './lib/view.ts';

const result = (declaration: number, poll: number) =>
  modeDeclared('mode', { file: 'poteto-mode/playbooks/babysit.md', anchor: 'Declare the mode' }, 'threads-only').run({
    prompt: 'address the bugbot comments on PR 71',
    runs: [{ todoText: '' }],
    parent: { messages: [{ role: 'assistant', order: declaration, text: 'I am using threads-only mode.' }], toolCalls: [{ name: 'bash', order: poll, args: { command: 'gh pr view 71' } }] },
  } as unknown as RunView);
test('a mode declared in chat before polling satisfies the playbook', () => {
  expect(result(1, 2)).toMatchObject({ ok: true });
});
test('a late chat declaration still fails', () => {
  expect(result(2, 1)).toMatchObject({ ok: false });
});

import { expect, test } from 'vitest';
import { babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import type { RunView } from './lib/view.ts';

test.for([false, true])('a known watcher can be reused after a successful inspect without a file grep (error=%s)', (error) => {
  const view = {
    runs: [{ id: 'r', workers: [{ id: 'w', state: { kind: 'watch' }, assignment: { role: 'watcher', kind: 'watch', watch: { argv: ['--pr', '16'] } } }] }],
    parent: {
      messages: [
        { order: 0, role: 'user', text: 'babysit PR 16' },
        { order: 2, role: 'user', text: 'babysit PR 16' },
      ],
      toolCalls: [
        { order: 1, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: '/repo/workers/w/assignment.json' } },
        { order: 3, name: 'pstack_worker', args: { action: 'inspect', workerId: 'w', runId: 'r' }, resultText: 'Worker w: running', isError: error },
      ],
    },
  } as unknown as RunView;
  expect(babysitSingleWatcherFamily.checks.find((entry) => entry.id === 'babysit.single.the-second-request-armed-no-second-watcher')?.run(view)).toMatchObject({ ok: !error });
});

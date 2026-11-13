import { expect, test } from 'vitest';
import { concurrencyFamily } from './families/concurrency.ts';
import type { RunView } from './lib/view.ts';

function view(): RunView {
  const workers = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    dir: `/missing/workers/${id}`,
    worktree: `/trees/${id}`,
    assignment: { role: 'general', model: 'sim/one', workspace: { inputCommit: 'base' } },
    state: { model: { provider: 'sim', id: 'one' }, tmuxSession: `t-${id}`, sessionFile: `${id}.jsonl`, settles: [{ phase: 'idle', at: '2026-01-01T00:00:05Z' }] },
    session: { models: ['sim/one'], file: `session_${id}.jsonl`, cwd: `/trees/${id}` },
  }));
  return {
    driver: 'real',
    runs: [{ id: 'chosen-run', workers, events: workers.map((worker) => ({ kind: 'spawn', workerId: worker.id, ts: '2026-01-01T00:00:00Z' })) }],
    parent: {
      toolCalls: [
        ...workers.map((worker) => ({ name: 'pstack_worker', order: 1, args: { action: 'spawn', assignmentPath: `/missing/workers/${worker.id}/assignment.json` } })),
        { name: 'pstack_worker', order: 2, at: '2026-01-01T00:00:01Z', args: { action: 'inspect' } },
      ],
    },
    git: { branchCommits: Object.fromEntries(workers.map((worker) => [`pstack-run/chosen-run/${worker.id}`, ['commit']])), worktrees: workers.map((worker) => ({ branch: `pstack-run/chosen-run/${worker.id}` })) },
  } as unknown as RunView;
}
const run = (suffix: string, value = view()) => concurrencyFamily.checks.find((entry) => entry.id === `worker-concurrency.${suffix}`)?.run(value);

test.each(['spawn-does-not-block', 'distinct-resolved-models', 'distinct-sessions-and-panes', 'distinct-worktrees-and-branches', 'assignments-differ-only-where-intended'])(
  'observed concurrency does not need scripted markers: %s',
  (suffix) => {
    expect(run(suffix)).toMatchObject({ ok: true });
  },
);
test('assignment reasoning suffixes do not change model identity', () => {
  const value = view();
  for (const worker of value.runs[0]?.workers ?? []) worker.assignment['model'] = 'sim/one:low';
  expect(run('distinct-resolved-models', value)).toMatchObject({ ok: true });
  const first = value.runs[0]?.workers[0];
  if (first !== undefined) first.assignment['model'] = 'sim/other:low';
  expect(run('distinct-resolved-models', value)).toMatchObject({ ok: false });
});

test('missing pane environment evidence is inconclusive, not a fabricated failure or pass', () => {
  expect(run('workers-get-their-own-pane-env')).toHaveProperty('inconclusive');
});
test('mismatched models, shared sessions, and different inputs still fail', () => {
  const value = view();
  const worker = value.runs[0]?.workers[0];
  if (worker === undefined || worker.state === null) throw new Error('Missing worker');
  worker.assignment['model'] = 'sim/other';
  expect(run('distinct-resolved-models', value)).toMatchObject({ ok: false });
  worker.state['tmuxSession'] = 't-b';
  expect(run('distinct-sessions-and-panes', value)).toMatchObject({ ok: false });
  (worker.assignment['workspace'] as { inputCommit: string }).inputCommit = 'other';
  expect(run('assignments-differ-only-where-intended', value)).toMatchObject({ ok: false });
});

import { expect, test } from 'vitest';
import { autopilotFullFamily } from './families/pr-autopilot.ts';
import type { RunView } from './lib/view.ts';

const check = (id: string, view: unknown) => autopilotFullFamily.checks.find((entry) => entry.id === id)!.run(view as RunView);
test('hourly watch ignores re-collects of idle workers but not newly steered work', () => {
  const dir = '/repo/workers/tick';
  const owner = { id: 'owner', dir: '/repo/workers/owner', assignment: { role: 'owner' } };
  const watcher = { id: 'tick', dir, assignment: { role: 'watcher', kind: 'watch', watch: { argv: ['sleep', '3600'], cwd: '/repo' } } };
  const calls = [
    { order: 1, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `${owner.dir}/assignment.json` } },
    { order: 2, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `${dir}/assignment.json` } },
    { order: 4, name: 'pstack_worker', args: { action: 'abort', runId: 'r', workerId: 'tick' } },
    { order: 5, name: 'pstack_worker', args: { action: 'collect', runId: 'r', workerId: 'owner' } },
  ];
  const view = { repo: '/repo', runs: [{ id: 'r', workers: [owner, watcher] }], parent: { toolCalls: calls, messages: [{ order: 3, customType: 'pstack-worker', details: { runId: 'r', workerId: 'owner', phase: 'idle' } }] } };
  expect(check('autopilot.full.hourly-watch-loop-armed-on-the-go', view)).toMatchObject({ ok: true });
  calls.push({ order: 3.5, name: 'pstack_worker', args: { action: 'steer', runId: 'r', workerId: 'owner' } });
  expect(check('autopilot.full.hourly-watch-loop-armed-on-the-go', view)).toMatchObject({ ok: false });
});

test('catch-up covers topics without requiring the playbook vocabulary', () => {
  const reply = 'PR 31 and PR 32 merged. Both passed independent checks. No gates were loosened, so no extra sign-off was needed. Decisions waiting on you: none. Remaining work: none.';
  const view = { parent: { toolCalls: [{ name: 'read', args: { path: '/pkg/generated/skills/ketchup/SKILL.md' }, order: 0, resultText: 'skill' }], messages: [{ role: 'assistant', order: 1, text: reply }] } };
  expect(check('autopilot.full.reply-catches-the-operator-up', view)).toMatchObject({ ok: true });
  view.parent.messages[0]!.text = 'PR 31 and PR 32 merged.';
  expect(check('autopilot.full.reply-catches-the-operator-up', view)).toMatchObject({ ok: false });
});

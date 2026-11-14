import { expect, test } from 'vitest';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import { WATCH_PR } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test('each PR has a successful watcher without requiring one watcher for the program', () => {
  const workers = [51, 52].map((pr) => ({ id: `watch-${pr}`, assignment: { kind: 'watch', role: 'watcher', watch: { argv: [WATCH_PR, '--pr', String(pr)] } }, state: { exit: { code: 0 } } }));
  const view = { runs: [{ workers }], parent: { toolCalls: [] } } as unknown as RunView;
  const check = orchestrateFamily.checks.find((entry) => entry.id === 'orchestrate.a-watch-loop-follows-the-pr');
  if (check === undefined) throw new Error('Missing watcher check');
  expect(check.run(view)).toMatchObject({ ok: true });
  for (const worker of workers) worker.assignment.watch.argv.unshift('/usr/bin/env', 'PATH=/fixture/bin:/usr/bin');
  expect(check.run(view)).toMatchObject({ ok: true });
  const first = workers[0];
  if (first === undefined) throw new Error('Missing watcher');
  first.assignment.watch.argv = ['/usr/bin/env', 'PATH=/fixture/bin:/usr/bin', 'sh', '-c', `while true; do ${WATCH_PR} --pr 51; done`];
  expect(check.run(view)).toMatchObject({ ok: false });
  workers.pop();
  expect(check.run(view)).toMatchObject({ ok: false });
});

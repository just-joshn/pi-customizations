import { expect, test } from 'vitest';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import { WATCH_PR } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test('each PR has a successful watcher without requiring one watcher for the program', () => {
  const workers = [51, 52].map((pr) => ({ id: `watch-${pr}`, assignment: { kind: 'watch', role: 'watcher', watch: { argv: [WATCH_PR, '--pr', String(pr)] } }, state: { exit: { code: 0 } } }));
  const view = { runs: [{ workers }], parent: { toolCalls: [] } } as unknown as RunView;
  const check = orchestrateFamily.checks.find((entry) => entry.id === 'orchestrate.a-watch-loop-follows-the-pr')!;
  expect(check.run(view)).toMatchObject({ ok: true });
  workers.pop();
  expect(check.run(view)).toMatchObject({ ok: false });
});

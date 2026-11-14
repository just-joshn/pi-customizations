import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { createTodo, readTodoLedger, replaceTodoLedger } from '../../src/todo.ts';
import { PINNED_REVISION, todoChecks } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

test.for(['missing-run', 'missing-todo'])('a missing TODO prerequisite fails once, not as six derived claims (%s)', (mode) => {
  const view = { runs: mode === 'missing-run' ? [] : [{ id: 'r', todoText: null, workers: [], steps: [], receipts: [] }], todoHistory: {}, parent: { toolCalls: [] } } as unknown as RunView;
  for (const check of todoChecks({ playbook: 'feature' })) {
    const result = check.run(view);
    if (check.id.endsWith('run-from-playbook')) expect(result).toMatchObject({ ok: false });
    else if (check.id.endsWith('parent-sole-writer')) expect(result).toMatchObject({ ok: true });
    else expect(result).toHaveProperty('inconclusive');
  }
});

test('actual unresolved steps and recorded bad initial states remain independently assessable', () => {
  const run = {
    id: 'r',
    runJson: { schemaVersion: 1, playbook: 'feature', upstreamRevision: PINNED_REVISION, title: 'work' },
    todoText: `Source playbook: feature.md\nUpstream revision: ${PINNED_REVISION}`,
    steps: [{ n: 1, state: 'pending' }],
    workers: [],
    receipts: [],
  };
  const initial = createTodo('work', 'feature', PINNED_REVISION, readFileSync(new URL('../../vendor/upstream-pstack/skills/poteto-mode/playbooks/feature.md', import.meta.url)));
  const ledger = readTodoLedger(initial).map((entry) => ({ ...entry, status: 'passed' as const }));
  const view = { runs: [run], todoHistory: { r: [{ text: replaceTodoLedger(initial, ledger) }] } } as unknown as RunView;
  const checks = todoChecks({ playbook: 'feature' });
  expect(checks.find((check) => check.id.endsWith('every-step-resolved'))?.run(view)).toMatchObject({ ok: false });
  const missingTodo = { ...view, runs: [{ ...run, todoText: null }] } as unknown as RunView;
  expect(checks.find((check) => check.id.endsWith('initial-states-open'))?.run(missingTodo)).toMatchObject({ ok: false });
});

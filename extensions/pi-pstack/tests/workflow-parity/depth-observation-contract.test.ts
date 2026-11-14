import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import { orchestrateSubFamily } from './families/pr-orchestrate-sub.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import { required } from './lib/required.ts';
import type { RunView } from './lib/view.ts';

test('missing unrequested runtime-depth probes are inconclusive, not failed observations', () => {
  const view = { runs: [], parent: { file: '/session', messages: [], toolCalls: [] }, sandbox: '/nonexistent' } as unknown as RunView;
  const check = orchestrateSubFamily.checks.find((entry) => entry.id === 'orchestrate.sub.each-leaf-ran-at-the-depth-the-spawn-tree-gives-it');
  expect(check?.run(view)).toHaveProperty('inconclusive');
});

test('a reported wrong depth still fails while absent runtime reports stay inconclusive', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'depth-contract-'));
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), '{"prs":{"51":{"author":"a"},"52":{"author":"b"}}}');
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), '');
    const workers = ['a', 'b'].map((id) => ({ id, assignment: { role: 'owner' }, report: '' }));
    const view = { sandbox, runs: [{ workers }], parent: { toolCalls: [] } } as unknown as RunView;
    const check = orchestrateFamily.checks.find((entry) => entry.id === 'orchestrate.owners-sit-two-levels-down-and-cannot-spawn');
    expect(check?.run(view)).toHaveProperty('inconclusive');
    for (const worker of workers) worker.report = 'depth=2';
    expect(check?.run(view)).toMatchObject({ ok: true });
    required(workers[0]).report = 'depth=4';
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

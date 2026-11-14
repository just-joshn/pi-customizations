import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { ownerWorkers, responsibleWorker } from './families/pr-autopilot.ts';
import { verifierFor } from './families/pr-shipping.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function view(duplicate = false, role = 'owner'): RunView {
  const sandbox = mkdtempSync(join(tmpdir(), 'responsibility-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: { 31: { author: 'a' }, 32: { author: 'b' } } }));
  writeFileSync(
    join(forgeDirOf(sandbox), 'actions.jsonl'),
    [
      { kind: 'comment', pr: 31, worker: 'a' },
      { kind: 'comment', pr: 32, worker: 'b' },
    ]
      .map((action) => JSON.stringify(action))
      .join('\n'),
  );
  const workers = ['a', 'b', ...(duplicate ? ['a-copy'] : [])].map((id) => ({ id, brief: 'Own PR 31. Another owner owns PR 32.', assignment: { workerId: id === 'a-copy' ? 'a' : id, role } }));
  return { sandbox, runs: [{ workers }] } as unknown as RunView;
}
test('forge authorship binds an owner even when its brief mentions the sibling PR', () => {
  expect(responsibleWorker(view(), 'owner', 31)?.id).toBe('a');
  expect(responsibleWorker(view(), 'owner', 32)?.id).toBe('b');
});
test('a poteto worker that authored the PR is its owner regardless of the role label', () => {
  const value = view(false, 'poteto');
  expect(responsibleWorker(value, 'owner', 31)?.id).toBe('a');
  expect(ownerWorkers(value).map((worker) => worker.id)).toEqual(['a', 'b']);
  const worker = value.runs[0]?.workers[0];
  if (worker === undefined) throw new Error('missing fixture worker');
  worker.assignment['workerId'] = 'unrelated';
  expect(responsibleWorker(value, 'owner', 31)).toBeUndefined();
  expect(ownerWorkers(value).map((entry) => entry.id)).toEqual(['b']);
});

test('posting responsibility binds verifiers without interpreting sibling mentions', () => {
  expect(verifierFor(view(false, 'verifier'), 31)?.id).toBe('a');
  expect(verifierFor(view(true, 'verifier'), 31)).toBeUndefined();
});
test('two assignments claiming the same observed owner stay ambiguous', () => {
  expect(responsibleWorker(view(true), 'owner', 31)).toBeUndefined();
});

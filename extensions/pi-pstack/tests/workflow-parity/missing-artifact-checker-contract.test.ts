import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { autopilotLanesFamily, autopilotStackFamily } from './families/pr-autopilot.ts';
import { babysitFamilies } from './families/pr-babysit.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

test('missing owner trails and dangling reports fail without checker exceptions', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'missing-artifacts-'));
  const dir = join(sandbox, 'owner');
  try {
    mkdirSync(dir);
    symlinkSync(join(dir, 'out/report.md'), join(dir, 'report.md'));
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), '{"repo":{"trunk":"main"},"prs":{"33":{"number":33,"author":"owner","head":"feat-table","base":"main"}}}');
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), '');
    const view = { sandbox, base: 'a'.repeat(40), runs: [{ id: 'run', workers: [{ id: 'owner', dir, assignment: { role: 'owner' } }], receipts: [] }], parent: { toolCalls: [], messages: [] } } as unknown as RunView;
    const checks = [...autopilotStackFamily.checks, ...autopilotLanesFamily.checks].filter((entry) => /owners-push-their-own|a-loosened-gate-got/.test(entry.id));
    for (const result of evaluate(checks, view)) {
      expect(result.verdict).toBe('FAIL');
      expect(result.evidence).not.toMatch(/checker threw/);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('two watcher identities fail the second-request check instead of throwing', () => {
  const workers = ['one', 'two'].map((id) => ({ id, assignment: { kind: 'watch', watch: { argv: ['watch-pr', '--pr', '16'] } }, state: { kind: 'watch' } }));
  const view = { runs: [{ id: 'run', workers }], parent: { messages: [{ role: 'user', order: 0, text: 'babysit' }, { role: 'user', order: 3, text: 'again' }], toolCalls: [{ order: 1, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: '/workers/one/assignment.json' }, resultText: '', isError: false }] } } as unknown as RunView;
  const checks = babysitFamilies.flatMap((family) => family.checks).filter((entry) => entry.id === 'babysit.single.the-second-request-armed-no-second-watcher');
  expect(evaluate(checks, view)[0]).toMatchObject({ verdict: 'FAIL' });
  expect(evaluate(checks, view)[0]?.evidence).not.toMatch(/checker threw/);
});

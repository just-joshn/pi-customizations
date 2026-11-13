import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
function view(): RunView {
  const sandbox = mkdtempSync(join(tmpdir(), 'orchestrate-contract-'));
  roots.push(sandbox);
  const dir = forgeDirOf(sandbox);
  mkdirSync(dir, { recursive: true });
  const prs = [51, 52].map((number) => ({ number, author: `owner-${number}`, head: number === 51 ? 'feat-greet-orch' : 'feat-shout-orch' }));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: Object.fromEntries(prs.map((pr) => [pr.number, pr])) }));
  writeFileSync(
    join(dir, 'actions.jsonl'),
    prs
      .flatMap((pr) => [
        { kind: 'ref-create', ref: `refs/heads/${pr.head}`, worker: pr.author },
        { kind: 'create', tool: 'gh', pr: pr.number, worker: pr.author },
      ])
      .map((action) => JSON.stringify(action))
      .join('\n'),
  );
  return {
    sandbox,
    driver: 'real',
    runs: [
      {
        workers: prs.map((pr) => ({
          id: pr.author,
          assignment: { role: 'owner' },
          brief: `Goal: build PR ${pr.number}. Scope: write only src/module.js and test/module.test.js. Evidence: npm test must pass. Never merge before authorization or touch other paths.`,
        })),
      },
    ],
    parent: { toolCalls: [] },
  } as unknown as RunView;
}
const run = (suffix: string, value: RunView) => orchestrateFamily.checks.find((entry) => entry.id === `orchestrate.${suffix}`)?.run(value);
test('a healthy real program does not need an artificially stalled third owner', () => {
  expect(run('one-owner-per-pr-the-only-writer-of-its-branch', view())).toMatchObject({ ok: true });
  expect(run('kickoffs-name-evidence-paths-and-forbidden-actions', view())).toMatchObject({ ok: true });
  expect(run('a-stalled-worker-is-judged-by-its-side-effects-aborted-and-replaced-with-a-consolidated-kickoff', view())).toHaveProperty('skip');
});
test('copied assignments cannot create an ambiguous owner identity', () => {
  const value = view();
  const workers = value.runs[0]?.workers;
  const owner = workers?.[0];
  if (owner === undefined || workers === undefined) throw new Error('Missing owner');
  owner.assignment['workerId'] = owner.id;
  const duplicate = structuredClone(owner);
  duplicate.id = 'copied-directory';
  workers.push(duplicate);
  expect(run('one-owner-per-pr-the-only-writer-of-its-branch', value)).toMatchObject({ ok: false });
});
test('a kickoff without evidence and path limits still fails', () => {
  const value = view();
  const owner = value.runs[0]?.workers[0];
  if (owner === undefined) throw new Error('Missing owner');
  owner.brief = 'Build PR 51.';
  expect(run('kickoffs-name-evidence-paths-and-forbidden-actions', value)).toMatchObject({ ok: false });
});
test('orchestrate does not invent a forge-resolution instruction absent from its playbook', () => {
  expect(orchestrateFamily.checks.some((entry) => entry.id === 'orchestrate.forge-resolved-once-gh-fallback-recorded')).toBe(false);
});

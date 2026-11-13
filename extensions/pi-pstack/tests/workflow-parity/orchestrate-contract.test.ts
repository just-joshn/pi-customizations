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
test('two passing verifier lanes satisfy one independent verifier requirement', () => {
  const value = view();
  const prs = [51, 52].map((number) => ({ number, author: `owner-${number}`, mergedHead: `head-${number}` }));
  writeFileSync(join(forgeDirOf(value.sandbox), 'state.json'), JSON.stringify({ prs: Object.fromEntries(prs.map((pr) => [pr.number, pr])) }));
  writeFileSync(join(forgeDirOf(value.sandbox), 'actions.jsonl'), prs.map((pr) => JSON.stringify({ kind: 'merge', pr: pr.number, worker: pr.author, head: pr.mergedHead })).join('\n'));
  for (const worker of value.runs[0]?.workers ?? []) worker.assignment['model'] = 'sim/claude-owner';
  const workers = value.runs[0]?.workers;
  for (const pr of prs)
    for (const lane of ['gates', 'live'])
      workers?.push({
        id: `v-${pr.number}-${lane}`,
        assignment: { role: 'verifier', model: 'sim/openai-verifier', workspace: { mode: 'container', inputCommit: pr.mergedHead } },
        report: `VERDICT PASS ${pr.mergedHead}`,
      } as unknown as RunView['runs'][number]['workers'][number]);
  expect(run('each-pr-has-a-verifier-on-another-family-and-merges-follow-the-verdict', value)).toMatchObject({ ok: true });
  for (const worker of workers ?? []) if (worker.assignment['role'] === 'verifier') worker.assignment['model'] = 'sim/claude-owner';
  expect(run('each-pr-has-a-verifier-on-another-family-and-merges-follow-the-verdict', value)).toMatchObject({ ok: false });
});

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
test('separate live reads and collected workers need no scripted report template', () => {
  const value = view();
  const root = join(value.sandbox, 'run');
  mkdirSync(root);
  writeFileSync(join(root, 'notes.md'), '# Notes\nBoth items landed.\n');
  const current = value.runs[0];
  if (current === undefined) throw new Error('Missing run');
  current.dir = root;
  current.decisions = [['landed']];
  value.parent.messages = [{ order: 10, role: 'assistant', text: 'Both PRs landed. Nothing dropped. No decisions waiting.' }];
  value.parent.toolCalls = [51, 52].flatMap((number, index) => [
    { order: index * 2, name: 'bash', args: { command: `gh pr view ${number} --json state; gh pr checks ${number}` }, resultText: 'MERGED', isError: false },
    { order: index * 2 + 1, name: 'pstack_worker', args: { action: 'collect', workerId: `owner-${number}` }, resultText: `Worker owner-${number} settled (idle).`, isError: false },
  ]);
  expect(run('live-state-is-read-and-every-worker-is-accounted-for', value)).toMatchObject({ ok: true });
  const last = value.parent.toolCalls.at(-1);
  if (last === undefined) throw new Error('Missing collect');
  last.args['action'] = 'abort';
  last.resultText = 'Aborted worker owner-52.';
  expect(run('live-state-is-read-and-every-worker-is-accounted-for', value)).toMatchObject({ ok: true });
  value.parent.toolCalls.pop();
  expect(run('live-state-is-read-and-every-worker-is-accounted-for', value)).toMatchObject({ ok: false });
});

test('orchestrate does not invent a forge-resolution instruction absent from its playbook', () => {
  expect(orchestrateFamily.checks.some((entry) => entry.id === 'orchestrate.forge-resolved-once-gh-fallback-recorded')).toBe(false);
});

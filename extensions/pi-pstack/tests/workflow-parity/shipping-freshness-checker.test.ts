import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { shippingFreshnessFamily } from './families/pr-shipping.ts';
import { bareOf, forgeDirOf, patchIdOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test.for([true, false])('a changed patch can land only after fresh verification (%s)', (fresh) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'freshness-checker-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'parity@example.test');
    git('config', 'user.name', 'Parity');
    const commit = (file: string, text: string) => {
      writeFileSync(join(repo, file), text);
      git('add', file);
      git('commit', '-qm', file);
      return git('rev-parse', 'HEAD');
    };
    commit('base', 'base');
    const old = [commit('one', 'one'), commit('two', 'two'), commit('three', 'three')];
    git('checkout', '-q', 'main~3');
    commit('trunk', 'trunk');
    const heads: string[] = [];
    for (const [index, sha] of old.entries()) {
      if (index < 2) git('cherry-pick', sha);
      else commit('three', 'changed three');
      heads.push(git('rev-parse', 'HEAD'));
      git('branch', `s-${index + 1}`);
    }
    mkdirSync(join(sandbox, 'forge'));
    git('clone', '-q', '--bare', repo, bareOf(sandbox));
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    const state = {
      repo: { trunk: 'main' },
      prs: Object.fromEntries(
        heads.map((head, index) => [21 + index, { number: 21 + index, author: `owner-${index}`, head: `s-${index + 1}`, base: 'main', baseAtStart: index === 0 ? 'main' : `s-${index}`, state: 'MERGED', mergedHead: head }]),
      ),
    };
    const verdict = (index: number, head: string) => ({ kind: 'comment', pr: 21 + index, worker: `v${index}`, body: `PSTACK-VERDICT: PASS head=${head} verifier=v${index} patch=${patchIdOf(bareOf(sandbox), head)}` });
    const actions = [
      ...old.map((sha, index) => verdict(index, sha)),
      ...heads.map((_, index) => ({ kind: 'force-push', actor: 'operator-sim', ref: `refs/heads/s-${index + 1}` })),
      ...(fresh ? [verdict(2, heads[2] as string)] : []),
      ...heads.flatMap((head, index) => [...(index === 0 ? [] : [{ kind: 'edit-base', pr: 21 + index, from: `s-${index}`, to: 'main' }, { kind: 'force-push', ref: `refs/heads/s-${index + 1}`, old: head, worker: '', actor: '' }]), { kind: 'merge', pr: 21 + index, head }]),
    ];
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify(state));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
    const view = {
      sandbox,
      runs: [],
      parent: { messages: [], toolCalls: heads.map((_, index) => ({ name: 'bash', order: index, args: { command: `gh pr view ${21 + index} --json baseRefName,state,mergedAt` }, resultText: '', isError: false })) },
    } as unknown as RunView;
    const leaseCommands = [1, 2].map((index) => ({ name: 'bash', order: 4 + index, args: { command: `git push origin HEAD:refs/heads/s-${index + 1} --force-with-lease=s-${index + 1}:${heads[index]}` }, resultText: '', isError: false }));
    view.parent.toolCalls.push(...leaseCommands);
    const check = (suffix: string) => shippingFreshnessFamily.checks.find((entry) => entry.id === `ship.fresh.${suffix}`)?.run(view);
    expect(check('the-chain-rebase-moved-every-head-and-changed-one-patch')).toMatchObject({ ok: true });
    expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: fresh });
    expect(check('a-kept-verdict-survives-a-new-sha-and-a-changed-patch-is-not-merged')).toMatchObject({ ok: fresh });
    expect(check('only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease')).toMatchObject({ ok: fresh });
    for (const call of leaseCommands) call.args.command = call.args.command.replace(/--force-with-lease=\S+/, '--force');
    expect(check('only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease')).toMatchObject({ ok: false });
    const comparison = { name: 'bash', order: -1, args: { command: 'for c in old head; do git show "$c" | git patch-id --stable; done' }, resultText: old.flatMap((sha, index) => [sha, heads[index] as string].map((head) => `${head} ${patchIdOf(bareOf(sandbox), head)}`)).join('\n'), isError: false };
    view.parent.toolCalls.unshift(comparison);
    expect(check('the-parent-compared-patch-ids-before-trusting-a-verdict')).toMatchObject({ ok: true });
    comparison.resultText = 'PR 21 verdict-sha=old head=new same-patch\nPR 22 verdict-sha=old head=new same-patch\nPR 23 verdict-sha=old head=new changed-patch';
    expect(check('the-parent-compared-patch-ids-before-trusting-a-verdict')).toMatchObject({ ok: true });
    comparison.resultText = '';
    expect(check('the-parent-compared-patch-ids-before-trusting-a-verdict')).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

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
      ...heads.flatMap((head, index) => [
        ...(index === 0
          ? []
          : [
              { kind: 'edit-base', pr: 21 + index, from: `s-${index}`, to: 'main' },
              { kind: 'force-push', ref: `refs/heads/s-${index + 1}`, old: head, worker: '', actor: '' },
            ]),
        { kind: 'merge', pr: 21 + index, head },
      ]),
    ];
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify(state));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
    const view = {
      sandbox,
      runs: [],
      parent: {
        messages: [],
        toolCalls: heads.map((_, index) => ({
          name: 'bash',
          order: index,
          args: {
            command:
              index === 1
                ? `gh pr view 22 --json baseRefName,state --jq '.state+" base="+.baseRefName'`
                : index === 2
                  ? `for n in 23; do gh pr view $n --json number,state,baseRefName --jq '"PR "+(.number|tostring)+" "+.state+" base="+.baseRefName'; done`
                  : `gh pr view ${21 + index} --json baseRefName,state,mergeCommit; gh pr view 99 --json state,baseRefName`,
          },
          resultText:
            index === 1
              ? 'MERGED base=main\n'
              : index === 2
                ? 'PR 23 MERGED base=main\n'
                : `Merged pull request\n${JSON.stringify({ state: 'MERGED', baseRefName: 'main', mergeCommit: { oid: heads[index] } }, null, 2)}\n{"state":"OPEN","baseRefName":"main"}\n`,
          isError: false,
        })),
      },
    } as unknown as RunView;
    const leaseCommands = [1, 2].map((index) => ({ name: 'bash', order: 4 + index, args: { command: `git push origin HEAD:refs/heads/s-${index + 1} --force-with-lease=s-${index + 1}:${heads[index]}` }, resultText: '', isError: false }));
    view.parent.toolCalls.push(...leaseCommands);
    view.parent.toolCalls.unshift({ name: 'bash', order: -1, args: { command: 'gh pr view 21 --json baseRefName,state' }, resultText: '{"state":"OPEN","baseRefName":"main"}', isError: false });
    const check = (suffix: string) => shippingFreshnessFamily.checks.find((entry) => entry.id === `ship.fresh.${suffix}`)?.run(view);
    expect(check('the-chain-rebase-moved-every-head-and-changed-one-patch')).toMatchObject({ ok: true });
    expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: fresh });
    for (const call of view.parent.toolCalls.filter((entry) => String(entry.args['command']).includes('gh pr view 21 ') && /"state"\s*:\s*"MERGED"/.test(entry.resultText))) {
      const original = String(call.args['command']);
      call.args['command'] = original.replace('baseRefName,', '');
      expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: false });
      call.args['command'] = original;
      const originalResult = call.resultText;
      call.resultText = originalResult.replace('"MERGED"', '"OPEN"').replace('"state":"OPEN"', '"state":"MERGED"');
      expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: false });
      call.resultText = originalResult;
    }
    for (const call of view.parent.toolCalls.filter((entry) => String(entry.args['command']).includes('gh pr view 22 --json'))) {
      const original = call.resultText;
      call.resultText = 'OPEN base=main';
      expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: false });
      call.resultText = 'MERGED base=side';
      expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: false });
      call.resultText = original;
    }
    for (const call of view.parent.toolCalls.filter((entry) => String(entry.args['command']).includes('gh pr view $n'))) {
      const original = call.resultText;
      call.resultText = 'PR 99 MERGED base=main';
      expect(check('only-the-patches-a-verdict-covers-merged')).toMatchObject({ ok: false });
      call.resultText = original;
    }
    expect(check('a-kept-verdict-survives-a-new-sha-and-a-changed-patch-is-not-merged')).toMatchObject({ ok: fresh });
    expect(check('only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease')).toMatchObject({ ok: fresh });
    for (const call of leaseCommands) call.args.command = call.args.command.replace(/--force-with-lease=\S+/, '--force');
    expect(check('only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease')).toMatchObject({ ok: false });
    const watcher = { id: 'queue', assignment: { kind: 'watch', watch: { argv: ['--queued-stack', '--stack-prs', '21,22,23'] } }, state: { kind: 'watch', exit: { code: 0 } } };
    const watched = { ...view, runs: [...view.runs, { id: 'watch-run', workers: [watcher] }] } as unknown as RunView;
    const watchCheck = shippingFreshnessFamily.checks.find((entry) => entry.id === 'ship.fresh.ceiling-watched-until-COMPLETE');
    expect(watchCheck?.run(watched)).toMatchObject({ ok: fresh });
    watcher.state.exit.code = 2;
    expect(watchCheck?.run(watched)).toMatchObject({ ok: false });
    if (fresh) {
      const report = {
        role: 'assistant',
        order: 20,
        text: 'The run covered PR 21 through PR 23. PR 23 was the ceiling. All three are merged. Each PR reads MERGED with base main. PR 21: PASS from v0. PR 22: PASS from v1. PR 23: PASS from v2. The changed patch got a fresh verdict. Next gap: none.',
      };
      view.parent.messages.push(report);
      expect(check('reply-says-the-changed-patch-needs-a-fresh-verdict')).toMatchObject({ ok: true });
      const originalReport = report.text;
      report.text = originalReport.replace('PR 23 was the ceiling.', '');
      expect(check('reply-says-the-changed-patch-needs-a-fresh-verdict')).toMatchObject({ ok: false });
      report.text = originalReport.replace('from v2', '');
      expect(check('reply-says-the-changed-patch-needs-a-fresh-verdict')).toMatchObject({ ok: false });
    }
    const comparison = {
      name: 'bash',
      order: -1,
      args: { command: 'for c in old head; do git show "$c" | git patch-id --stable; done' },
      resultText: old.flatMap((sha, index) => [sha, heads[index] as string].map((head) => `${head} ${patchIdOf(bareOf(sandbox), head)}`)).join('\n'),
      isError: false,
    };
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

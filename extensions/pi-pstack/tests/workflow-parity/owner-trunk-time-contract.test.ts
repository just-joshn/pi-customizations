import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotLanesFamily } from './families/pr-autopilot.ts';
import { bareOf, forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test('an owner starts on forge trunk at spawn time, not sandbox base or later trunk', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'owner-trunk-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'parity@example.test');
    git('config', 'user.name', 'Parity');
    const commit = (text: string) => {
      writeFileSync(join(repo, 'file'), text);
      git('add', '.');
      git('commit', '-qm', text);
      return git('rev-parse', 'HEAD');
    };
    const base = commit('base');
    const trunk = commit('forge trunk');
    git('branch', 'feat-table');
    const later = commit('later trunk');
    mkdirSync(join(sandbox, 'forge'));
    git('clone', '-q', '--bare', repo, bareOf(sandbox));
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), '{"repo":{"trunk":"main"},"prs":{"33":{"number":33,"author":"owner","head":"feat-table","base":"main","state":"OPEN"}}}');
    writeFileSync(
      join(forgeDirOf(sandbox), 'actions.jsonl'),
      [
        { kind: 'create', tool: 'gh', pr: 33, worker: 'owner', run: 'run', container: true },
        { kind: 'push', ref: 'refs/heads/main', old: trunk, new: later, ts: '2026-11-14T03:00:00Z' },
      ]
        .map((action) => JSON.stringify(action))
        .join('\n'),
    );
    const worker = { id: 'owner', dir: '/owner', assignment: { role: 'owner', workspace: { mode: 'container', inputCommit: trunk }, capabilities: { forge: true, env: 'minimal', externalWrite: false } }, session: { cwd: '/tmp/workspace' } };
    const view = {
      sandbox,
      base,
      runs: [{ id: 'run', workers: [worker] }],
      parent: { toolCalls: [{ name: 'pstack_worker', args: { action: 'spawn', assignmentPath: '/owner/assignment.json' }, at: '2026-11-14T02:00:00Z' }] },
    } as unknown as RunView;
    const check = autopilotLanesFamily.checks.find((entry) => entry.id === 'autopilot.lanes.one-container-owner-for-the-pr');
    const result = check?.run(view);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    worker.assignment.workspace.inputCommit = base;
    expect(check?.run(view)).toMatchObject({ ok: false });
    worker.assignment.workspace.inputCommit = later;
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

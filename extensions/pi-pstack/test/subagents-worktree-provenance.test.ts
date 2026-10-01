import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
type Details = { agentId: string; worktreePath?: string; worktreeBranch?: string; requestedIsolation?: string; effectiveIsolation?: string };

function initGit(dir: string, ignore = '') {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'n');
  if (ignore) execFileSync('sh', ['-c', `printf '%s\\n' '${ignore}' > .gitignore`], { cwd: dir });
  git('add', '.');
  git('commit', '-qm', 'init');
  return git;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await workerFixture();
  try {
    await run(fixture);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
}

async function defineIsolated(dir: string, isolation: string) {
  await mkdir(join(dir, '.pi/agents'), { recursive: true });
  await writeFile(join(dir, '.pi/agents/isolated.md'), `---\nname: isolated\ndescription: isolated agent\nisolation: ${isolation}\n---\nComplete the task.`);
  clearAgentCache();
}

async function agent(fixture: Fixture, params: Record<string, unknown>): Promise<Details> {
  return (await fixture.call('Agent', { description: 'probe', run_in_background: false, ...params })).details as Details;
}

test('[C55] a child shell cd changes neither the caller cwd nor later child commands', async () => {
  await withFixture(async (fixture) => {
    const before = process.cwd();
    await agent(fixture, { prompt: 'CWD_ESCAPE' });
    expect((await readFile(join(fixture.dir, 'cwd-probe.txt'), 'utf8')).trim()).toBe(realpathSync(fixture.dir));
    expect(process.cwd()).toBe(before);
    expect(fixture.session.extensionRunner.createContext().cwd).toBe(fixture.dir);
  });
});

test('[C55] an isolated child shell cd stays inside its worktree', async () => {
  await withFixture(async (fixture) => {
    initGit(fixture.dir);
    const done = await agent(fixture, { prompt: 'CWD_ESCAPE', isolation: 'worktree' });
    expect(done.worktreePath).toMatch(/\.pi\/worktrees\/agent-[0-9a-f]{8}$/);
    expect((await readFile(join(done.worktreePath ?? '', 'cwd-probe.txt'), 'utf8')).trim()).toBe(done.worktreePath);
    expect(existsSync(join(fixture.dir, 'cwd-probe.txt'))).toBe(false);
  });
});

test('[C53] definition isolation applies when the call names none', async () => {
  await withFixture(async (fixture) => {
    initGit(fixture.dir);
    await defineIsolated(fixture.dir, 'worktree');
    const done = await agent(fixture, { prompt: 'WORKTREE_WRITE', subagent_type: 'isolated' });
    expect(done).toMatchObject({ requestedIsolation: 'worktree', effectiveIsolation: 'worktree' });
    expect(existsSync(join(fixture.dir, 'child-change.txt'))).toBe(false);
  });
});

test('[C53] explicit isolation overrides the definition isolation', async () => {
  await withFixture(async (fixture) => {
    initGit(fixture.dir);
    await defineIsolated(fixture.dir, 'worktree');
    const done = await agent(fixture, { prompt: 'WORKTREE_WRITE', subagent_type: 'isolated', isolation: 'remote' });
    expect(done).toMatchObject({ requestedIsolation: 'remote', effectiveIsolation: 'worktree' });
  });
});

test('[C53] explicit worktree isolation is enforced over a definition that would run locally', async () => {
  await withFixture(async (fixture) => {
    await defineIsolated(fixture.dir, 'remote');
    expect(await agent(fixture, { prompt: 'hello', subagent_type: 'isolated' })).toMatchObject({ requestedIsolation: 'remote', effectiveIsolation: 'local' });
    await expect(agent(fixture, { prompt: 'hello', subagent_type: 'isolated', isolation: 'worktree' })).rejects.toThrow(/^Cannot create agent worktree: not in a git repository/);
  });
});

test('[C61] a child-created ignored file keeps the worktree and is returned for follow-up', async () => {
  await withFixture(async (fixture) => {
    initGit(fixture.dir, '*.env');
    const done = await agent(fixture, { prompt: 'IGNORED_WRITE', isolation: 'worktree' });
    expect(await readFile(join(done.worktreePath ?? '', 'secret.env'), 'utf8')).toBe('TOKEN=child');
    expect((await fixture.call('TaskOutput', { task_id: done.agentId })).details).toMatchObject({ worktreeCleanlyRemoved: false, worktreePath: done.worktreePath });
  });
});

test('[C56] a retained worktree records checkout, base commit and request provenance', async () => {
  await withFixture(async (fixture) => {
    const git = initGit(fixture.dir);
    const done = await agent(fixture, { prompt: 'WORKTREE_WRITE', isolation: 'worktree' });
    const record = (await fixture.call('TaskOutput', { task_id: done.agentId })).details;
    expect(record).toMatchObject({
      spawnedWithWorktree: true,
      worktreePath: done.worktreePath,
      worktreeBranch: done.worktreeBranch,
      worktreeRepoRoot: realpathSync(fixture.dir),
      worktreeBaseCommit: git('rev-parse', 'HEAD'),
      requestedIsolation: 'worktree',
    });
    expect(record).not.toHaveProperty('parentAgentId');
  });
});

test('[C56] clean removal clears the binding but keeps request provenance', async () => {
  await withFixture(async (fixture) => {
    initGit(fixture.dir);
    const done = await agent(fixture, { prompt: 'hello', isolation: 'remote' });
    const record = (await fixture.call('TaskOutput', { task_id: done.agentId })).details;
    expect(record).toMatchObject({ spawnedWithWorktree: true, worktreeCleanlyRemoved: true, requestedIsolation: 'remote' });
    expect(record).not.toHaveProperty('worktreePath');
    expect(record).not.toHaveProperty('worktreeBranch');
  });
});

test('[C56] a nested child records the spawning agent as its parent', async () => {
  await withFixture(async (fixture) => {
    const done = await agent(fixture, { prompt: 'SPAWN_AGENT' });
    const record = (await fixture.call('TaskOutput', { task_id: done.agentId })).details as { sessionFile: string };
    const entries = (await readFile(record.sessionFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; customType?: string; data?: { parentAgentId?: string; description?: string } });
    const nested = entries.findLast((entry) => entry.customType === 'pstack-task')?.data;
    expect(nested).toMatchObject({ description: 'nested depth', parentAgentId: done.agentId });
  });
});

test('[C52] a configured WorktreeCreate hook supplies the checkout outside git and the Agent keeps it', async () => {
  await withFixture(async (fixture) => {
    const hooked = join(fixture.dir, 'hooked');
    const settings = JSON.parse(await readFile(join(fixture.dir, 'settings.json'), 'utf8'));
    const hooks = { WorktreeCreate: [{ hooks: [{ type: 'command', command: `mkdir -p ${hooked} && echo ${hooked}` }] }] };
    await writeFile(join(fixture.dir, 'settings.json'), JSON.stringify({ ...settings, hooks }));
    const done = await agent(fixture, { prompt: 'WORKTREE_WRITE', isolation: 'worktree' });
    const path = realpathSync(hooked);
    expect(done).toMatchObject({ worktreePath: path, requestedIsolation: 'worktree', effectiveIsolation: 'worktree' });
    expect(done).not.toHaveProperty('worktreeBranch');
    expect(await readFile(join(path, 'child-change.txt'), 'utf8')).toBe('isolated-change');
    expect((await fixture.call('TaskOutput', { task_id: done.agentId })).details).toMatchObject({ cwd: path, spawnedWithWorktree: true, worktreeHookBased: true, worktreeCleanlyRemoved: false, worktreePath: path });
    expect(fixture.subagentLogs).toContain(`Hook-based agent worktree kept at: ${path}`);
    await fixture.call('SendMessage', { to: done.agentId, message: 'resume hooked' });
    expect((await fixture.call('TaskOutput', { task_id: done.agentId, block: true })).details).toMatchObject({ status: 'settled', cwd: path });
  });
});

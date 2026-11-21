import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { checkCommandGuard } from '../src/guards.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

describe('checkCommandGuard', () => {
  test('blocks staging TODO.md or .pi/TODO.md directly or via git add -A when TODO.md exists', () => {
    expect(checkCommandGuard('git add TODO.md', world.cwd)).toContain('never be staged');
    expect(checkCommandGuard('git add .pi/TODO.md', world.cwd)).toContain('never be staged');
    expect(checkCommandGuard('git add -A', world.cwd)).toBeUndefined();
    writeFileSync(join(world.cwd, 'TODO.md'), '- [ ] task\n');
    expect(checkCommandGuard('git add -A', world.cwd)).toContain('Stage explicit paths');
    expect(checkCommandGuard('git add src/index.ts', world.cwd)).toBeUndefined();
  });

  test('blocks force-push to main/master and git -C bypasses, while allowing feature-branch --force-with-lease chained with git checkout main', () => {
    expect(checkCommandGuard('git push --force origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git push -f origin master', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git -C subrepo push -f origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git -C subrepo add TODO.md', world.cwd)).toContain('never be staged');
    expect(checkCommandGuard('git push --force-with-lease origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git push --force-with-lease origin feat/my-branch', world.cwd)).toBeUndefined();
    expect(checkCommandGuard('git push --force-with-lease origin feat/x && git checkout main', world.cwd)).toBeUndefined();
  });

  test('blocks -C worktree broad add, +refspec force-push, combined/quoted/global flags, and ignores quoted commit/echo text', () => {
    const subrepo = join(world.cwd, 'subrepo');
    mkdirSync(join(subrepo, '.pi'), { recursive: true });
    writeFileSync(join(subrepo, 'TODO.md'), '- [ ] worktree task\n');
    expect(checkCommandGuard('git -C subrepo add -A', world.cwd)).toContain('Stage explicit paths');
    expect(checkCommandGuard('git -C subrepo add -Av', world.cwd)).toContain('Stage explicit paths');
    expect(checkCommandGuard('git -C subrepo add ./', world.cwd)).toContain('Stage explicit paths');

    writeFileSync(join(subrepo, '.pi', 'TODO.md'), '- [ ] pi todo\n');
    expect(checkCommandGuard('git -C subrepo add .pi', world.cwd)).toContain('never be staged');

    expect(checkCommandGuard('git push origin +main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git push origin +HEAD:main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git push -uf origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git push -f origin "main"', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git --no-pager push -f origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('git --no-pager add TODO.md', world.cwd)).toContain('never be staged');

    expect(checkCommandGuard('git commit -m "guard git push -f origin main"', world.cwd)).toBeUndefined();
    expect(checkCommandGuard('echo "git add TODO.md"', world.cwd)).toBeUndefined();
  });
});

describe('checkCommandGuard implicit branch push', () => {
  test('blocks implicit-branch force-push when current HEAD is main/master and allows it on feature branches', () => {
    const mainRepo = join(world.cwd, 'main-repo');
    mkdirSync(join(mainRepo, '.git'), { recursive: true });
    writeFileSync(join(mainRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect(checkCommandGuard('git push --force', mainRepo)).toContain('shared trunk');
    expect(checkCommandGuard('git push -f origin', mainRepo)).toContain('shared trunk');

    const featureRepo = join(world.cwd, 'feature-repo');
    mkdirSync(join(featureRepo, '.git'), { recursive: true });
    writeFileSync(join(featureRepo, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    expect(checkCommandGuard('git push --force-with-lease', featureRepo)).toBeUndefined();
  });

  test('blocks HEAD/+HEAD, --all/--mirror, push options, env prefixes, cd chains, git stage, broad pathspecs, and subdir repo-root TODO.md', () => {
    const mainRepo = join(world.cwd, 'main-repo');
    mkdirSync(join(mainRepo, '.git'), { recursive: true });
    mkdirSync(join(mainRepo, 'src'), { recursive: true });
    writeFileSync(join(mainRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(mainRepo, 'TODO.md'), '- [ ] task\n');

    expect(checkCommandGuard('git push --force origin HEAD', mainRepo)).toContain('shared trunk');
    expect(checkCommandGuard('git push origin +HEAD', mainRepo)).toContain('shared trunk');
    expect(checkCommandGuard('git push -o skip-ci --force origin', mainRepo)).toContain('shared trunk');
    expect(checkCommandGuard('HUSKY=0 git push -f origin main', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('cd main-repo && git push --force', world.cwd)).toContain('shared trunk');
    expect(checkCommandGuard('GIT_TERMINAL_PROMPT=0 git add TODO.md', mainRepo)).toContain('never be staged');
    expect(checkCommandGuard('git stage TODO.md', mainRepo)).toContain('never be staged');
    expect(checkCommandGuard('git add *', mainRepo)).toContain('Stage explicit paths');
    expect(checkCommandGuard('git add :/', mainRepo)).toContain('Stage explicit paths');
    expect(checkCommandGuard('git add -A', join(mainRepo, 'src'))).toContain('Stage explicit paths');

    const featureRepo = join(world.cwd, 'feature-repo');
    mkdirSync(join(featureRepo, '.git'), { recursive: true });
    writeFileSync(join(featureRepo, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    expect(checkCommandGuard('git push --force --all', featureRepo)).toContain('shared trunk');
    expect(checkCommandGuard('git push --force --mirror', featureRepo)).toContain('shared trunk');
    expect(checkCommandGuard('git push --repo=origin --force main', featureRepo)).toContain('shared trunk');
  });
});

describe('tool_call guard integration', () => {
  test('blocks bash and tmux_run calls that violate pstack safety invariants', async () => {
    const blockedBash = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'g1', toolName: 'bash', input: { command: 'git add TODO.md' } });
    expect(blockedBash).toMatchObject({ block: true });

    const blockedTmux = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'g2', toolName: 'tmux_run', input: { name: 'push', command: 'git push --force origin main' } });
    expect(blockedTmux).toMatchObject({ block: true });

    const allowed = await host.fire('tool_call', { type: 'tool_call', toolCallId: 'g3', toolName: 'bash', input: { command: 'git status' } });
    expect(allowed).toBeUndefined();
  });
});

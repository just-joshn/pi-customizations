import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAgentCheckout, finalizeCheckout } from '../src/subagents/worktree-hooks.ts';

let root = '';
let home = '';
let agentDir = '';
let project = '';
let target = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-wt-hooks-')));
  home = join(root, 'home');
  agentDir = join(root, 'agent');
  project = join(root, 'project');
  target = join(root, 'hook-checkout');
  for (const dir of [home, agentDir, project, target]) mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function configure(file: string, command: string) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [{ type: 'command', command }] }] } }));
}

function context(trusted = true) {
  return { cwd: project, sessionId: 'parent-session', transcriptPath: '/t/parent.jsonl', trusted, home, agentDir, log: () => {} };
}

test('[C52] a user WorktreeCreate hook receives the hook input on stdin and its stdout path becomes the checkout', async () => {
  configure(join(home, '.claude/settings.json'), `cat > ${join(root, 'input.json')}; echo ${target}`);
  expect(await createAgentCheckout(context(), 'abc123')).toEqual({ hookBased: true, path: target });
  expect(JSON.parse(readFileSync(join(root, 'input.json'), 'utf8'))).toEqual({
    session_id: 'parent-session',
    transcript_path: '/t/parent.jsonl',
    cwd: project,
    hook_event_name: 'WorktreeCreate',
    name: 'agent-abc123',
  });
});

test.for([
  { source: 'pi agent settings', file: () => join(agentDir, 'settings.json') },
  { source: 'project .claude settings', file: () => join(project, '.claude/settings.json') },
  { source: 'project .claude local settings', file: () => join(project, '.claude/settings.local.json') },
  { source: 'project .pi settings', file: () => join(project, '.pi/settings.json') },
])('[C52] a WorktreeCreate hook from $source is honoured', async ({ file }) => {
  configure(file(), `echo ${target}`);
  expect(await createAgentCheckout(context(), 'src1')).toEqual({ hookBased: true, path: target });
});

test('[C52] a relative hook path resolves against the caller cwd', async () => {
  mkdirSync(join(project, 'rel-checkout'));
  configure(join(home, '.claude/settings.json'), 'echo rel-checkout');
  expect(await createAgentCheckout(context(), 'rel1')).toEqual({ hookBased: true, path: join(project, 'rel-checkout') });
});

test('[C52] a project hook in an untrusted workspace refuses instead of falling back to git', async () => {
  configure(join(project, '.claude/settings.json'), `echo ${target}`);
  await expect(createAgentCheckout(context(false), 'untrusted1')).rejects.toThrow('WorktreeCreate hook failed: hook is configured but did not run (workspace not trusted or matcher mismatch)');
});

test('[C52] a hook that succeeds without a path is a precondition failure', async () => {
  configure(join(home, '.claude/settings.json'), 'true');
  await expect(createAgentCheckout(context(), 'empty1')).rejects.toThrow('WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)');
});

test('[C52] a failing hook reports its command and output', async () => {
  configure(join(home, '.claude/settings.json'), 'echo boom >&2; exit 3');
  await expect(createAgentCheckout(context(), 'fail1')).rejects.toThrow('WorktreeCreate hook failed: echo boom >&2; exit 3: boom');
});

test('[C52] a dotted absolute hook path is rejected', async () => {
  configure(join(home, '.claude/settings.json'), `echo ${project}/../hook-checkout`);
  await expect(createAgentCheckout(context(), 'dots1')).rejects.toThrow(
    `Cannot use the WorktreeCreate hook's worktree: the hook emitted a path with dot segments (${project}/../hook-checkout). The symlink screen cannot verify a dotted spelling — have the hook emit a normalized (dot-free) absolute path and retry.`,
  );
});

test('[C52] without hooks a git repository gets a git worktree', async () => {
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=n', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: project });
  const checkout = await createAgentCheckout(context(), 'git1');
  expect(checkout).toMatchObject({ path: join(project, '.pi/worktrees/agent-git1'), branch: 'worktree-agent-git1', repoRoot: project });
  expect(await finalizeCheckout(checkout, () => {})).toEqual({ kept: false });
});

test('[C52] a hook-based checkout has an unknown baseline and is always kept', async () => {
  const logs: string[] = [];
  expect(await finalizeCheckout({ hookBased: true, path: target }, (message) => logs.push(message))).toEqual({ kept: true, path: target });
  expect(existsSync(target)).toBe(true);
  expect(logs).toEqual([`Hook-based agent worktree kept at: ${target}`]);
});

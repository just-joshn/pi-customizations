#!/usr/bin/env bun
/**
 * Adversarial: does cancelling worktree creation delete a branch the run did not create, and with
 * it the work that branch alone holds?
 *
 * Every possible 3-hex branch suffix for one description is pre-created, each on its own commit.
 * The extension keeps branches after `/tasks prune`, so this name space is reachable. A slow
 * `git worktree add` then fails because the branch exists; the abort races the failure check and
 * cleanup runs `git branch -D` on a branch this run never created.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSubagentWorktree, slugifyWorktreeLabel } from '../../src/worktree.ts';

const REAL_GIT = '/usr/bin/git';
const root = mkdtempSync(join(tmpdir(), 'pi-subagents-branch-delete-'));
console.log(`evidence root: ${root}`);
const repo = join(root, 'repo');
const bin = join(root, 'bin');
const worktreeRoot = join(root, 'worktrees');
const flag = join(root, 'add-started');
mkdirSync(repo);
mkdirSync(bin);

const git = (args: string[], input?: string): string => execFileSync(REAL_GIT, args, { cwd: repo, encoding: 'utf8', ...(input === undefined ? {} : { input }) });
git(['init', '-q', '.']);
git(['config', 'user.email', 'a@b.c']);
git(['config', 'user.name', 'T']);
writeFileSync(join(repo, 'README.md'), 'base\n');
git(['add', '.']);
git(['commit', '-qm', 'base']);

const description = 'Shared isolated job';
const slug = slugifyWorktreeLabel(description);
const prefix = 'pi-subagents';

// One independent commit per possible branch suffix, so a deleted branch takes unique work with it.
const stream: string[] = [];
for (let value = 0; value < 0x1000; value += 1) {
  const suffix = value.toString(16).padStart(3, '0');
  const message = `work on ${suffix}\n`;
  const content = `content ${suffix}\n`;
  stream.push(
    `commit refs/heads/${prefix}/${slug}-${suffix}`,
    `mark :${value + 1}`,
    'author T <a@b.c> 1000000000 +0000',
    'committer T <a@b.c> 1000000000 +0000',
    `data ${Buffer.byteLength(message)}`,
    message.trimEnd(),
    `M 644 inline ${suffix}.txt`,
    `data ${Buffer.byteLength(content)}`,
    content.trimEnd(),
    '',
  );
}
git(['fast-import', '--quiet'], `${stream.join('\n')}\n`);

const before = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}/`]).trim().split('\n');
console.log(`pre-created user branches=${before.length}; tip commit of first=${git(['rev-parse', before[0] ?? '']).trim().slice(0, 12)}`);

const shim = join(bin, 'git');
writeFileSync(shim, ['#!/bin/sh', 'if [ "$3" = "worktree" ] && [ "$4" = "add" ]; then', '  : > "$SLOW_FLAG"', '  sleep 3', 'fi', `exec ${REAL_GIT} "$@"`, ''].join('\n'));
chmodSync(shim, 0o755);
process.env['PATH'] = `${bin}:${process.env['PATH'] ?? ''}`;
process.env['SLOW_FLAG'] = flag;

const controller = new AbortController();
const pending = createSubagentWorktree({
  cwd: repo,
  description,
  agentId: '00000000-0000-4000-8000-000000000000',
  sessionDir: undefined,
  root: worktreeRoot,
  branchPrefix: prefix,
  signal: controller.signal,
});

const start = Date.now();
while (!existsSync(flag) && Date.now() - start < 10_000) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
console.log(`addStarted=${existsSync(flag)}; aborting`);
controller.abort();
const result = await pending;
console.log('result:', JSON.stringify(result));

const after = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}/`]).trim().split('\n');
const deleted = before.filter((name) => !after.includes(name));
console.log(`after=${after.length} deleted=${JSON.stringify(deleted)}`);
if (deleted.length > 0) {
  const fsck = execFileSync(REAL_GIT, ['fsck', '--unreachable', '--no-reflogs'], { cwd: repo, encoding: 'utf8' });
  const lost = fsck.includes('unreachable commit');
  console.log(`deleted branch tip is now unreachable under any ref: ${lost}`);
  console.log('FAIL: cancelling worktree creation deleted a branch the run did not create');
  process.exitCode = 1;
} else {
  console.log('PASS: no pre-existing branch was deleted');
}

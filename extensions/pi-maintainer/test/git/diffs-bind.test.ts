import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

function envOf() {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

test('commit-message diffs include staged and unstaged changes against HEAD', {
  meta: {
    aider: ['test_repo/TestRepo.test_diffs_nonempty_repo'],
    evidence: ['ev-git/probe/detached-branch-diff'],
  },
}, async () => {
  const root = await tempDir('git-diffs-ne-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'foo.txt', '', 'initial');
  await commitFile(root, 'bar.txt', '', 'initial');
  await writeFile(join(root, 'foo.txt'), 'index\n');
  await isolatedExec({ command: 'git', args: ['add', '--', 'foo.txt'], cwd: root }, envOf());
  await writeFile(join(root, 'bar.txt'), 'workingdir\n');
  const git = policyIn(root, host);
  const diffs = await git.getDiffs();
  expect(diffs).toContain('index');
  expect(diffs).toContain('workingdir');
});

test('commit-message diffs keep non-ASCII working-tree bytes for the model prompt', { meta: { aider: ['test_repo/TestRepo.test_diffs_with_single_byte_encoding'] } }, async () => {
  const root = await tempDir('git-diffs-enc-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'foo.txt', 'index\n', 'seed');
  await writeFile(join(root, 'foo.txt'), 'АБВ\n');
  const git = policyIn(root, host);
  const diffs = await git.getDiffs(['foo.txt']);
  expect(diffs).toContain('index');
  expect(diffs).toContain('АБВ');
  expect(() => Buffer.from(diffs, 'utf8').toString('utf8')).not.toThrow();
});

test('unborn-branch diffs use cached and working-tree diffs without a HEAD comparison', {
  meta: {
    aider: ['test_repo/TestRepo.test_diffs_empty_repo'],
    evidence: ['ev-git/probe/unborn-branch-diff'],
  },
}, async () => {
  const root = await tempDir('git-diffs-empty-');
  const host = recordingHost();
  await initRepo(root);
  await writeFile(join(root, 'foo.txt'), 'index\n');
  await isolatedExec({ command: 'git', args: ['add', '--', 'foo.txt'], cwd: root }, envOf());
  await writeFile(join(root, 'foo.txt'), 'workingdir\n');
  const git = policyIn(root, host);
  const diffs = await git.getDiffs();
  expect(diffs).toContain('index');
  expect(diffs).toContain('workingdir');
});

test('detached HEAD diffs use cached plus working-tree paths rather than active-branch HEAD', {
  meta: {
    aider: ['test_repo/TestRepo.test_diffs_detached_head'],
    evidence: ['ev-git/probe/detached-branch-diff'],
  },
}, async () => {
  const root = await tempDir('git-diffs-detach-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'foo.txt', '', 'foo');
  await commitFile(root, 'bar.txt', '', 'bar');
  await commitFile(root, 'baz.txt', '', 'baz');
  await isolatedExec({ command: 'git', args: ['checkout', 'HEAD^'], cwd: root }, envOf());
  await writeFile(join(root, 'foo.txt'), 'index\n');
  await isolatedExec({ command: 'git', args: ['add', '--', 'foo.txt'], cwd: root }, envOf());
  await writeFile(join(root, 'bar.txt'), 'workingdir\n');
  const git = policyIn(root, host);
  const diffs = await git.getDiffs();
  expect(diffs).toContain('index');
  expect(diffs).toContain('workingdir');
});

test('diffCommits returns the patch between two revisions', {
  meta: {
    aider: ['test_repo/TestRepo.test_diffs_between_commits'],
  },
}, async () => {
  const root = await tempDir('git-diffs-between-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'foo.txt', 'one\n', 'initial');
  await writeFile(join(root, 'foo.txt'), 'two\n');
  await isolatedExec({ command: 'git', args: ['add', '--', 'foo.txt'], cwd: root }, envOf());
  await isolatedExec({ command: 'git', args: ['commit', '-m', 'second'], cwd: root }, envOf());
  const git = policyIn(root, host);
  const diffs = await git.diffCommits('HEAD~1', 'HEAD');
  expect(diffs).toContain('two');
});

test('/diff uses HEAD^ with fewer than two message checkpoints and the second-last checkpoint otherwise', { meta: { aider: ['test_commands/TestCommands.test_cmd_diff'] } }, async () => {
  const root = await tempDir('git-diffs-cmd-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'test_file.txt', 'Initial content\n', 'Initial commit');
  await writeFile(join(root, 'test_file.txt'), 'Modified content');
  const git = policyIn(root, host, {}, { generateCommitMessage: async () => 'Canned commit message' });
  await git.commitDirty('Canned commit message');
  const first = await git.diffForDisplay();
  expect(first.kind).toBe('diff');
  if (first.kind === 'diff') {
    expect(first.text).toContain('-Initial content');
    expect(first.text).toContain('+Modified content');
  }

  await writeFile(join(root, 'test_file.txt'), 'Further modified content');
  await git.commitDirty('second');
  await writeFile(join(root, 'test_file.txt'), 'Final modified content');
  await git.commitDirty('third');
  const head = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root }, envOf())).stdout.trim();
  const parent = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD^'], cwd: root }, envOf())).stdout.trim();
  const earlier = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD~2'], cwd: root }, envOf())).stdout.trim();
  await git.noteMessageCheckpoint(earlier);
  await git.noteMessageCheckpoint(parent);
  await git.noteMessageCheckpoint(head);
  const second = await git.diffForDisplay();
  expect(second.kind).toBe('diff');
  if (second.kind === 'diff') {
    expect(second.baseline.startsWith(parent.slice(0, 7))).toBe(true);
    expect(second.text).toContain('Final modified content');
  }
});

test('an untracked file is described as Added and the commit includes it', {
  meta: { evidence: ['ev-git/probe/new-unstaged-file-message-input'] },
}, async () => {
  const root = await tempDir('git-diffs-untracked-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'seed.txt', 's\n', 'seed');
  await writeFile(join(root, 'brandnew.txt'), 'content not present in pre-stage diff\n');
  const prompts: string[] = [];
  const git = policyIn(
    root,
    host,
    {},
    {
      generateCommitMessage: async (request) => {
        prompts.push(request.user);
        return 'feat: add brandnew';
      },
    },
  );
  expect(await git.getDiffs(['brandnew.txt'])).toBe('Added brandnew.txt\n');
  const result = await git.autoCommit(new Set(['brandnew.txt']), { kind: 'conversation', text: 'add the file' });
  expect(result).toMatchObject({ kind: 'committed' });
  expect(prompts[0]).toContain('# Diffs:\nAdded brandnew.txt\n');
  const show = await isolatedExec({ command: 'git', args: ['show', 'HEAD:brandnew.txt'], cwd: root }, envOf());
  expect(show.stdout).toBe('content not present in pre-stage diff\n');
});

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

test('undo refuses without a repository, on the first commit, and when HEAD is not a session commit', { meta: { aider: ['test_commands/TestCommands.test_cmd_undo_on_first_commit'] } }, async () => {
  const bare = await tempDir('git-undo-bare-');
  const bareHost = recordingHost();
  expect(await policyIn(bare, bareHost).undo()).toEqual({ kind: 'disabled' });

  const root = await tempDir('git-undo-first-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'a\n', 'first');
  const git = policyIn(root, host);
  const first = await git.undo();
  expect(first).toEqual({ kind: 'refused', message: 'This is the first commit in the repository. Cannot undo.' });

  await writeFile(join(root, 'a.txt'), 'b\n');
  const committed = await git.autoCommit(new Set(['a.txt']), { kind: 'conversation', text: 'change' }, undefined);
  expect(committed.kind).toBe('committed');
  const foreign = await policyIn(root, host, {}, { sessionCommitHashes: new Set() }).undo();
  expect(foreign).toEqual({ kind: 'refused', message: 'The last commit was not made by aider in this chat session.' });
});

test('undo refuses when a changed file is dirty after the session commit', { meta: { aider: ['test_commands/TestCommands.test_cmd_undo_with_dirty_files_not_in_last_commit'] } }, async () => {
  const root = await tempDir('git-undo-dirty-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'a\n', 'first');
  await writeFile(join(root, 'a.txt'), 'b\n');
  const hashes = new Set<string>();
  const git = policyIn(root, host, {}, { sessionCommitHashes: hashes });
  const committed = await git.autoCommit(new Set(['a.txt']), { kind: 'conversation', text: 'change' });
  expect(committed.kind).toBe('committed');
  await writeFile(join(root, 'a.txt'), 'dirty-again\n');
  const refused = await git.undo();
  expect(refused).toEqual({
    kind: 'refused',
    message: 'The file a.txt has uncommitted changes. Please stash them before undoing.',
  });
});

test('undo checks out files from the parent, soft-resets, and reports Removed', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_undo_with_newly_committed_file'],
    evidence: ['ev-git/probe/undo-preserves-unrelated-dirt'],
  },
}, async () => {
  const root = await tempDir('git-undo-ok-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'a\n', 'first');
  await writeFile(join(root, 'a.txt'), 'b\n');
  const hashes = new Set<string>();
  const git = policyIn(
    root,
    host,
    {},
    {
      sessionCommitHashes: hashes,
      generateCommitMessage: async () => 'feat: bump a',
    },
  );
  const committed = await git.autoCommit(new Set(['a.txt']), { kind: 'conversation', text: 'change' });
  expect(committed.kind).toBe('committed');
  if (committed.kind !== 'committed') throw new Error('expected commit');
  await writeFile(join(root, 'unrelated.txt'), 'unrelated dirty\n');
  const undone = await git.undo();
  expect(undone).toMatchObject({
    kind: 'removed',
    hash: committed.hash,
    message: 'feat: bump a',
  });
  if (undone.kind !== 'removed') throw new Error('expected removed');
  expect(undone.nowAt?.message).toBe('first');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const head = await isolatedExec({ command: 'git', args: ['show', 'HEAD:a.txt'], cwd: root }, env);
  expect(head.stdout).toBe('a\n');
  expect(await readFile(join(root, 'unrelated.txt'), 'utf8')).toBe('unrelated dirty\n');
});

test('undo refuses a session commit that added a file', {
  meta: { evidence: ['ev-git/probe/undo-refuses-added-file'] },
}, async () => {
  const root = await tempDir('git-undo-added-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'a\n', 'first');
  await writeFile(join(root, 'new.txt'), 'added\n');
  const hashes = new Set<string>();
  const git = policyIn(root, host, {}, { sessionCommitHashes: hashes, generateCommitMessage: async () => 'feat: add file' });
  expect(await git.autoCommit(new Set(['new.txt']), { kind: 'conversation', text: 'add' })).toMatchObject({ kind: 'committed' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const before = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root }, env)).stdout.trim();
  expect(await git.undo()).toEqual({ kind: 'refused', message: 'The file new.txt was not in the repository in the previous commit. Cannot undo safely.' });
  expect((await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root }, env)).stdout.trim()).toBe(before);
});

test('undo refuses when the local origin branch reference equals HEAD', {
  meta: { evidence: ['ev-git/probe/undo-remote-tracking-equality-guard'] },
}, async () => {
  const root = await tempDir('git-undo-origin-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'a\n', 'first');
  await writeFile(join(root, 'a.txt'), 'b\n');
  const git = policyIn(root, host, {}, { sessionCommitHashes: new Set<string>(), generateCommitMessage: async () => 'feat: bump a' });
  expect(await git.autoCommit(new Set(['a.txt']), { kind: 'conversation', text: 'change' })).toMatchObject({ kind: 'committed' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const branch = (await isolatedExec({ command: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: root }, env)).stdout.trim();
  const head = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root }, env)).stdout.trim();
  await isolatedExec({ command: 'git', args: ['update-ref', `refs/remotes/origin/${branch}`, head], cwd: root }, env);
  expect(await git.undo()).toEqual({ kind: 'refused', message: 'The last commit has already been pushed to the origin. Undoing is not possible.' });
  expect((await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: root }, env)).stdout.trim()).toBe(head);
});

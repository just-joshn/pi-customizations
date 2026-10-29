import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { buildCommitMessageRequest } from '../../src/git/commit-message.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

test('commit message generation sends the commit diff and the chat context', { meta: { aider: ['test_repo/TestRepo.test_get_commit_message'] } }, async () => {
  const seen: { system: string; user: string }[] = [];
  const root = await tempDir('git-msg-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.py', 'one\n', 'seed');
  await writeFile(join(root, 'a.py'), 'two\n');
  const git = policyIn(
    root,
    host,
    {},
    {
      generateCommitMessage: async (request) => {
        seen.push(request);
        return 'feat: update a.py';
      },
    },
  );
  const result = await git.autoCommit(new Set(['a.py']), { kind: 'conversation', text: 'USER: please change a\n' });
  expect(result.kind).toBe('committed');
  expect(seen).toHaveLength(1);
  expect(seen[0]?.user).toContain('USER: please change a');
  expect(seen[0]?.user).toContain('# Diffs:');
  expect(seen[0]?.user).toMatch(/a\.py|two|one/);
  expect(seen[0]?.system).toContain('one-line Git commit messages');
});

test('a commit stages and commits the whole content of named files', { meta: { aider: ['test_coder/TestCoder.test_only_commit_gpt_edited_file'] } }, async () => {
  const root = await tempDir('git-whole-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'edited.py', 'old\n', 'seed');
  await commitFile(root, 'other.py', 'keep\n', 'other');
  await writeFile(join(root, 'edited.py'), 'new whole file\n');
  await writeFile(join(root, 'other.py'), 'also dirty\n');
  const git = policyIn(root, host, {}, { generateCommitMessage: async () => 'feat: edit one file' });
  const result = await git.autoCommit(new Set(['edited.py']), { kind: 'conversation', text: 'edit edited.py' });
  expect(result).toMatchObject({ kind: 'committed', message: 'feat: edit one file' });
  expect(await readFile(join(root, 'edited.py'), 'utf8')).toBe('new whole file\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const show = await isolatedExec({ command: 'git', args: ['show', 'HEAD:edited.py'], cwd: root }, env);
  expect(show.stdout).toBe('new whole file\n');
  const status = await isolatedExec({ command: 'git', args: ['status', '--porcelain', '--', 'other.py'], cwd: root }, env);
  expect(status.stdout.trim().length).toBeGreaterThan(0);
});

test('buildCommitMessageRequest places context above the diffs block', () => {
  const request = buildCommitMessageRequest('diff text', 'chat context here');
  expect(request.user.startsWith('chat context here\n# Diffs:\n')).toBe(true);
  expect(request.user).toContain('diff text');
});

test('a commit without named files includes tracked changes and staged additions but not untracked files', {
  meta: { evidence: ['ev-git/probe/all-file-commit-uses-tracked-changes-and-staged-additions'] },
}, async () => {
  const root = await tempDir('git-all-files-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.txt', 'baseline\n', 'baseline');
  await commitFile(root, 'staged.txt', 'before\n', 'staged seed');
  await writeFile(join(root, 'a.txt'), 'tracked change\n');
  await writeFile(join(root, 'staged.txt'), 'included\n');
  await isolatedExec({ command: 'git', args: ['add', '--', 'staged.txt'], cwd: root }, Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)));
  await writeFile(join(root, 'untracked.txt'), 'excluded\n');
  const git = policyIn(root, host);
  expect(await git.commitDirty('all tracked')).toMatchObject({ kind: 'committed' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const showTracked = await isolatedExec({ command: 'git', args: ['show', 'HEAD:a.txt'], cwd: root }, env);
  expect(showTracked.stdout).toBe('tracked change\n');
  const showStaged = await isolatedExec({ command: 'git', args: ['show', 'HEAD:staged.txt'], cwd: root }, env);
  expect(showStaged.stdout).toBe('included\n');
  const tree = await isolatedExec({ command: 'git', args: ['ls-tree', '--name-only', 'HEAD'], cwd: root }, env);
  expect(tree.stdout.split('\n')).not.toContain('untracked.txt');
});

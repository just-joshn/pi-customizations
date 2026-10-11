import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

test('tracked inventory merges committed blobs and index entries without unstaged untracked files', {
  meta: { aider: ['test_repo/TestRepo.test_get_tracked_files', 'test_repo/TestRepo.test_get_tracked_files_with_new_staged_file'] },
}, async () => {
  const root = await tempDir('git-inventory-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'README.md', 'hi\n', 'added');
  await mkdir(join(root, 'subdir'), { recursive: true });
  await writeFile(join(root, 'subdir/nested.txt'), 'n\n');
  await writeFile(join(root, 'untracked.txt'), 'u\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
  await isolatedExec({ command: 'git', args: ['add', '--', 'subdir/nested.txt'], cwd: root }, env);

  const git = policyIn(root, host);
  expect(git.repoRoot()).toBe(root);
  const tracked = await git.trackedFiles();
  expect(tracked).toEqual(expect.arrayContaining(['README.md', 'subdir/nested.txt']));
  expect(tracked).not.toContain('untracked.txt');
});

test('aiderignore excludes matching tracked paths from inventory', { meta: { aider: ['test_repo/TestRepo.test_get_tracked_files_with_aiderignore'] } }, async () => {
  const root = await tempDir('git-ignore-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'keep.py', 'k\n', 'keep');
  await writeFile(join(root, 'skip.py'), 's\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
  await isolatedExec({ command: 'git', args: ['add', '--', 'skip.py'], cwd: root }, env);
  await writeFile(join(root, '.aiderignore'), 'skip.py\n');

  const tracked = await policyIn(root, host).trackedFiles();
  expect(tracked).toContain('keep.py');
  expect(tracked).not.toContain('skip.py');
});

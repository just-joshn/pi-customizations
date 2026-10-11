import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { effectiveDirtyCommits } from '../../src/git/options.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

test('turning automatic commits off also turns dirty commits off', { meta: { aider: ['test_coder/TestCoder.test_allowed_to_edit_dirty'] } }, () => {
  expect(effectiveDirtyCommits(false, true)).toBe(false);
  expect(effectiveDirtyCommits(true, true)).toBe(true);
  expect(effectiveDirtyCommits(true, false)).toBe(false);
});

test('dirty paths are announced and checkpointed before edits when dirty commits are on', { meta: { aider: ['test_coder/TestCoder.test_gpt_edit_to_dirty_file'] } }, async () => {
  const root = await tempDir('git-dirty-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'target.py', 'before\n', 'seed');
  await writeFile(join(root, 'target.py'), 'dirty\n');
  const git = policyIn(root, host);
  expect(await git.needsDirtyCommit('target.py')).toBe(true);
  expect(host.outputs).toContain('Committing target.py before applying edits.');
  const checkpoint = await git.dirtyCommit(new Set(['target.py']));
  expect(checkpoint).toEqual({ kind: 'protected' });
  expect(await git.needsDirtyCommit('target.py')).toBe(false);
});

test('dirtyCommit is disabled when automatic commits forced dirty commits off', async () => {
  const root = await tempDir('git-dirty-off-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'target.py', 'before\n', 'seed');
  await writeFile(join(root, 'target.py'), 'dirty\n');
  const git = policyIn(root, host, { autoCommits: false, dirtyCommits: true });
  expect(await git.needsDirtyCommit('target.py')).toBe(false);
  expect(await git.dirtyCommit(new Set(['target.py']))).toEqual({ kind: 'disabled' });
});

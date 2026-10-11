import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { absRootPath, addableRelativeFiles, allRelativeFiles, type ChatFiles } from '../../src/core/chat-files.ts';
import { addFiles, type SelectionEnv, type SelectionState } from '../../src/edit/selection.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { resolveAiderIgnorePath } from '../../src/git/policy.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

test('isGitIgnored matches git check-ignore for paths rejected from inventory and edits', {
  meta: {
    aider: ['test_coder/TestCoder.test_skip_gitignored_files_on_init', 'test_coder/TestCoder.test_allowed_to_edit', 'test_main/TestMain.test_add_command_gitignore_files_flag', 'test_main/TestMain.test_argv_file_respects_git'],
  },
}, async () => {
  const root = await tempDir('git-filter-gitignore-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'keep.py', 'k\n');
  await writeFile(join(root, '.gitignore'), 'secret.env\n');
  await writeFile(join(root, 'secret.env'), 'x=1\n');
  const git = policyIn(root, host);
  expect(await git.isGitIgnored('secret.env')).toBe(true);
  expect(await git.isGitIgnored('keep.py')).toBe(false);
  expect(await git.isIgnored('secret.env')).toBe(false);
});

test('aiderignore excludes matching tracked paths and marks them policy-ignored', {
  meta: {
    aider: ['test_repo/TestRepo.test_get_tracked_files_with_aiderignore', 'test_coder/TestCoder.test_skip_aiderignored_files'],
    evidence: ['ev-git/probe/aiderignore-cache-deletion'],
  },
}, async () => {
  const root = await tempDir('git-filter-aiderignore-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'keep.py', 'k\n', 'keep');
  await writeFile(join(root, 'skip.py'), 's\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
  await isolatedExec({ command: 'git', args: ['add', '--', 'skip.py'], cwd: root }, env);
  await writeFile(join(root, '.aiderignore'), 'skip.py\n');

  const git = policyIn(root, host);
  const tracked = await git.trackedFiles();
  expect(tracked).toContain('keep.py');
  expect(tracked).not.toContain('skip.py');
  expect(await git.isIgnored('skip.py')).toBe(true);
  expect(await git.isIgnored('keep.py')).toBe(false);
  expect(await git.isGitIgnored('skip.py')).toBe(false);
});

test('subtree-only inventory and isIgnored stay under the cwd tree', {
  meta: {
    aider: ['test_repo/TestRepo.test_subtree_only', 'test_repo/TestRepo.test_get_tracked_files_from_subdir', 'test_coder/TestCoder.test_coder_from_coder_with_subdir', 'test_main/TestMain.test_main_with_subdir_repo_fnames'],
    evidence: ['ev-git/probe/subtree-filtering'],
  },
}, async () => {
  const root = await tempDir('git-filter-subtree-');
  const host = recordingHost();
  await initRepo(root);
  await mkdir(join(root, 'subdir'), { recursive: true });
  await mkdir(join(root, 'another_subdir'), { recursive: true });
  await commitFile(root, 'root.txt', 'r\n', 'root');
  await writeFile(join(root, 'subdir/subdir_file.txt'), 's\n');
  await writeFile(join(root, 'another_subdir/another_file.txt'), 'a\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
  await isolatedExec({ command: 'git', args: ['add', '--', 'subdir/subdir_file.txt', 'another_subdir/another_file.txt'], cwd: root }, env);
  await isolatedExec({ command: 'git', args: ['commit', '-m', 'more'], cwd: root }, env);

  const git = policyIn(root, host, { subtreeOnly: true }, { cwd: join(root, 'subdir') });
  const tracked = await git.trackedFiles();
  expect(tracked).toEqual(['subdir/subdir_file.txt']);
  expect(await git.isIgnored('subdir/subdir_file.txt')).toBe(false);
  expect(await git.isIgnored('root.txt')).toBe(true);
  expect(await git.isIgnored('another_subdir/another_file.txt')).toBe(true);
});

test('configured aiderignore path resolves relative to the git root and filters inventory', { meta: { aider: ['test_main/TestMain.test_resolve_aiderignore_path'] } }, async () => {
  expect(resolveAiderIgnorePath('/tmp/test/.aiderignore')).toBe('/tmp/test/.aiderignore');
  expect(resolveAiderIgnorePath('.aiderignore', '/path/to/git/root')).toBe('/path/to/git/root/.aiderignore');
  expect(resolveAiderIgnorePath('.aiderignore')).toBe('.aiderignore');

  const root = await tempDir('git-filter-aiderignore-path-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'keep.py', 'k\n', 'keep');
  await writeFile(join(root, 'skip.py'), 's\n');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const { isolatedExec } = await import('../../src/core/isolated-exec.ts');
  await isolatedExec({ command: 'git', args: ['add', '--', 'skip.py'], cwd: root }, env);
  await writeFile(join(root, 'custom.ignore'), 'skip.py\n');

  const tracked = await policyIn(root, host, { aiderIgnore: 'custom.ignore' }).trackedFiles();
  expect(tracked).toContain('keep.py');
  expect(tracked).not.toContain('skip.py');
});

test('addable relative files are filtered inventory minus editable and read-only chat files', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_add_read_only_file', 'test_commands/TestCommands.test_cmd_read_only_from_working_dir'] },
}, async () => {
  const root = '/repo';
  const files: ChatFiles = {
    editable: new Set([absRootPath(root, 'inchat.py')]),
    readOnly: new Set([absRootPath(root, 'notes.md')]),
  };
  const git = {
    trackedFiles: async () => ['inchat.py', 'notes.md', 'other.py', 'pkg/mod.py'],
  };
  expect(await addableRelativeFiles(root, files, git)).toEqual(['other.py', 'pkg/mod.py']);
});

test('without a repository relative inventory is limited to in-chat editable files', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_read_only_file'] } }, async () => {
  const root = '/repo';
  const files: ChatFiles = {
    editable: new Set([absRootPath(root, 'b.py'), absRootPath(root, 'a.py')]),
    readOnly: new Set([absRootPath(root, 'ro.py')]),
  };
  expect(await allRelativeFiles(root, files, { trackedFiles: async () => null })).toEqual(['a.py', 'b.py']);
  expect(await addableRelativeFiles(root, files, { trackedFiles: async () => null })).toEqual([]);
});

test('add refuses gitignored paths and skips aiderignored paths with Aider warnings', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_add_gitignored_file', 'test_commands/TestCommands.test_cmd_add_aiderignored_file'] },
}, async () => {
  const root = await tempDir('git-filter-add-policy-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'keep.py', 'k\n', 'keep');
  await writeFile(join(root, '.gitignore'), '*.ignored\n');
  await writeFile(join(root, 'test.ignored'), 'ignored\n');
  await writeFile(join(root, '.aiderignore'), 'skip_me.py\n');
  await writeFile(join(root, 'skip_me.py'), 's\n');

  const git = policyIn(root, host);
  const tree = createWorkingTree({ notices: host });
  const env: SelectionEnv = { root, host, tree, git, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };

  expect(await git.isGitIgnored('test.ignored')).toBe(true);
  const afterGitignore = await addFiles('test.ignored', empty, env);
  expect(afterGitignore.editable).toEqual([]);
  expect(host.errors.some((text) => text.startsWith("Can't add ") && text.endsWith(' which is in gitignore') && text.includes('test.ignored'))).toBe(true);

  const afterAiderignore = await addFiles('skip_me.py', empty, env);
  expect(afterAiderignore.editable).toEqual([]);
  expect(host.warnings.some((text) => text.includes('Skipping') && text.includes('skip_me.py') && text.includes('aiderignore or --subtree-only'))).toBe(true);
});

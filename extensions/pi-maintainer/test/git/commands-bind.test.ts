import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { absRootPath } from '../../src/core/chat-files.ts';
import type { CommandEnv } from '../../src/core/command.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { addFiles, dropMatches, type SelectionEnv, type SelectionState } from '../../src/edit/selection.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation } from '../../src/feature.ts';
import { gitCommands } from '../../src/git/commands.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

function envOf() {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function commandEnv(root: string, host: ReturnType<typeof recordingHost>, git: ReturnType<typeof policyIn>): CommandEnv {
  const snapshot = {
    schema: 1 as const,
    kind: 'snapshot' as const,
    root,
    mode: 'whole' as const,
    phase: { kind: 'main' as const },
    files: { editable: [] as string[], readOnly: [] as string[] },
    originalReadOnly: [] as string[],
    returnMode: null,
    ignoredMentions: [] as string[],
    neverAsk: [] as string[],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [] as string[],
    lifecycle: { kind: 'active' as const, userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [] as string[], writtenPaths: [] as string[], waitingFor: null },
  };
  return {
    host,
    snapshot,
    save: () => {},
    tree: createWorkingTree({ notices: host }),
    git,
    map: disabledRepositoryContext,
    lint: disabledValidation,
    testCmd: null,
    lintCmds: new Map(),
    autoCommits: true,
    supportsImages: true,
    sendUserMessage: async () => {},
    setPhysicalModel: async () => false,
    findPhysicalModel: () => null,
    defaultEditFormat: () => 'whole',
  };
}

test('/git runs argv git with GIT_EDITOR=true from process cwd and shows combined output', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_git'],
    evidence: ['ev-git/probe/raw-git-command-execution'],
  },
}, async () => {
  const root = await tempDir('git-cmd-git-');
  const host = recordingHost();
  await initRepo(root);
  await writeFile(join(root, 'test.txt'), 'test');
  const previous = process.cwd();
  process.chdir(root);
  onTestFinished(() => process.chdir(previous));
  const git = policyIn(root, host);
  const env = commandEnv(root, host, git);
  const run = gitCommands.find((command) => command.name === 'git');
  expect(run).toBeDefined();
  await run?.run('add test.txt', env);
  await run?.run('commit -a -m msg', env);
  const listed = await isolatedExec({ command: 'git', args: ['ls-files'], cwd: root }, envOf());
  expect(listed.stdout).toContain('test.txt');
  expect(host.outputs.join('\n').length).toBeGreaterThan(0);
});

test('/commit commits dirty working-tree changes with an optional message', { meta: { aider: ['test_commands/TestCommands.test_cmd_commit'] } }, async () => {
  const root = await tempDir('git-cmd-commit-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'test.txt', 'test', 'initial');
  await writeFile(join(root, 'test.txt'), 'new');
  const git = policyIn(root, host);
  const env = commandEnv(root, host, git);
  const run = gitCommands.find((command) => command.name === 'commit');
  await run?.run('Test commit message', env);
  const status = await isolatedExec({ command: 'git', args: ['status', '--porcelain'], cwd: root }, envOf());
  expect(status.stdout.trim()).toBe('');
  const log = await isolatedExec({ command: 'git', args: ['log', '-1', '--pretty=%s'], cwd: root }, envOf());
  expect(log.stdout.trim()).toBe('Test commit message');
});

test('/add from a subdirectory resolves paths relative to the repository root', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_from_subdir'] } }, async () => {
  const root = await tempDir('git-cmd-subdir-');
  const host = recordingHost();
  await initRepo(root);
  await mkdir(join(root, 'subdir'), { recursive: true });
  await mkdir(join(root, 'anotherdir'), { recursive: true });
  await commitFile(root, 'one.py', '', 'added');
  await commitFile(root, 'subdir/two.py', '', 'added');
  await commitFile(root, 'anotherdir/three.py', '', 'added');
  const git = policyIn(root, host);
  const tree = createWorkingTree({ notices: host });
  const selectionEnv: SelectionEnv = { root, host, tree, git, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
  const withThree = await addFiles('anotherdir/three.py', empty, selectionEnv);
  const withGlob = await addFiles('*.py', withThree, selectionEnv);
  expect(withGlob.editable).toContain(absRootPath(root, 'one.py'));
  expect(withGlob.editable).not.toContain(absRootPath(root, 'subdir/two.py'));
  expect(withGlob.editable).toContain(absRootPath(root, 'anotherdir/three.py'));
});

test('/add expands a git-tracked directory whose name contains glob metacharacters', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_dirname_with_special_chars_git'] } }, async () => {
  const root = await tempDir('git-cmd-brackets-');
  const host = recordingHost();
  await initRepo(root);
  await mkdir(join(root, 'with[brackets]'), { recursive: true });
  await commitFile(root, 'with[brackets]/filename.txt', '', 'init');
  const git = policyIn(root, host);
  const tree = createWorkingTree({ notices: host });
  const selectionEnv: SelectionEnv = { root, host, tree, git, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
  const added = await addFiles('with[brackets]', empty, selectionEnv);
  expect(added.editable).toContain(absRootPath(root, 'with[brackets]/filename.txt'));
});

test('/add and /drop admit untracked files without staging them into git', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_drop_untracked_files'] } }, async () => {
  const root = await tempDir('git-cmd-untracked-');
  const host = recordingHost();
  await initRepo(root);
  await writeFile(join(root, 'test.txt'), '');
  const git = policyIn(root, host);
  const tree = createWorkingTree({ notices: host });
  const selectionEnv: SelectionEnv = { root, host, tree, git, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
  const added = await addFiles('test.txt', empty, selectionEnv);
  expect(added.editable).toEqual([absRootPath(root, 'test.txt')]);
  const listed = await isolatedExec({ command: 'git', args: ['ls-files'], cwd: root }, envOf());
  expect(listed.stdout).not.toContain('test.txt');
  const dropped = await dropMatches('test.txt', added, selectionEnv);
  expect(dropped.editable).toEqual([]);
});

test('/add from a nested cwd admits an untracked file under that subdirectory', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_from_subdir_again'] } }, async () => {
  const root = await tempDir('git-cmd-side-');
  const host = recordingHost();
  await initRepo(root);
  await mkdir(join(root, 'side_dir'), { recursive: true });
  await writeFile(join(root, 'side_dir/temp.txt'), '');
  const git = policyIn(root, host);
  const tree = createWorkingTree({ notices: host });
  const selectionEnv: SelectionEnv = { root, host, tree, git, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
  const added = await addFiles('side_dir/temp.txt', empty, selectionEnv);
  expect(added.editable).toEqual([absRootPath(root, 'side_dir/temp.txt')]);
});

test('gitCommands registers git, commit, and diff through the feature command list', () => {
  expect(gitCommands.map((command) => command.name).sort()).toEqual(['commit', 'diff', 'git']);
  expect(disabledGitPolicy.getDiffs).toBeTypeOf('function');
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { diffFormat } from '../../src/edit/feature.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledRepositoryContext, disabledValidation, type EditCandidate, type EditContext, type EditIntent, type GitPolicy } from '../../src/feature.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

type Upsert = readonly [string | null, EditIntent | null];

function snapshot(root: string): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: [], readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
  };
}

/** A controller over the real Git policy with a diff reply and a live edit lifecycle. */
function controllerFor(root: string, host: Host, git: GitPolicy, editable: string[] = []) {
  const tree = createWorkingTree({ notices: host });
  const controller = new ExchangeController(
    { ...snapshot(root), mode: 'diff', files: { editable, readOnly: [] } },
    {
      ports: {
        edit: {
          formats: new Map([['diff', diffFormat]]),
          requestedFormat: 'diff',
          initialFiles: { editable: [], readOnly: [] },
          messageFile: null,
          applyFile: null,
          dryRun: false,
          yesAlways: null,
          autoAcceptArchitect: true,
          editorModel: null,
          chatLanguage: null,
          editorEditFormat: 'editor-whole',
          tree,
        },
        git,
        map: disabledRepositoryContext,
        lint: disabledValidation,
      },
      host,
      source: {
        get: async () => ({
          mainSystem: 'MAIN',
          systemReminder: 'REMINDER',
          exampleMessages: [] as const,
          filesContentPrefix: 'EDITABLE',
          filesContentAssistantReply: 'Ok.',
          filesNoFullFiles: 'NONE',
          filesNoFullFilesWithRepoMap: '',
          filesNoFullFilesWithRepoMapReply: '',
          readOnlyFilesPrefix: 'READ ONLY',
          filesContentGptEditsNoRepo: 'I updated the files.',
        }),
      },
      append: () => {},
      suggestShellCommands: false,
    },
  );
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: [],
    absRootPath: (path) => absRootPath(root, path),
    tree,
    notices: host,
  };
  return { controller, tree, context };
}

test('gitignored paths are skipped with the Aider skip warning', { meta: { aider: ['test_coder/TestCoder.test_skip_gitignored_files_on_init'] } }, async () => {
  const root = await tempDir('git-auth-ignore-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'tracked.py', 't\n');
  await writeFile(join(root, '.gitignore'), 'secret.env\n');
  await writeFile(join(root, 'secret.env'), 'x=1\n');
  const git = policyIn(root, host);
  expect(await git.isGitIgnored('secret.env')).toBe(true);

  const tree = createWorkingTree({ notices: host });
  const controller = new ExchangeController(snapshot(root), {
    ports: {
      edit: {
        formats: new Map(),
        requestedFormat: null,
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: false,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-whole',
        tree,
      },
      git,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: {
      get: async () => {
        throw new Error('unused');
      },
    },
    append: () => {},
    suggestShellCommands: false,
  });
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: [],
    absRootPath: (path) => absRootPath(root, path),
    tree,
    notices: host,
  };
  const candidate = (path: string): EditCandidate<Upsert> => ({
    edit: [path, { kind: 'update', path }],
    intent: { kind: 'update', path },
  });
  const prepared = await controller.prepareToEdit([candidate('secret.env'), candidate('tracked.py')], context);
  expect(host.warnings).toContain('Skipping edits to secret.env that matches gitignore spec.');
  expect(prepared.map((entry) => entry.edit[0])).toEqual(['tracked.py']);
});

test('an untracked approved path is staged when automatic commits are on', { meta: { aider: ['test_coder/TestCoder.test_new_file_edit_one_commit'] } }, async () => {
  const root = await tempDir('git-auth-stage-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'seed.txt', 's\n');
  await mkdir(join(root, 'nested'), { recursive: true });
  const git = policyIn(root, host);
  expect(await git.needToAdd('nested/new.txt')).toBe(true);
  const abs = join(root, 'nested/new.txt');
  await writeFile(abs, '');
  await git.stageNewFile(abs);
  const tracked = await git.trackedFiles();
  expect(tracked).toContain('nested/new.txt');
});

test('stageNewFile is a no-op when automatic commits are off', async () => {
  const root = await tempDir('git-auth-nostage-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'seed.txt', 's\n');
  const git = policyIn(root, host, { autoCommits: false });
  const abs = join(root, 'fresh.txt');
  await writeFile(abs, 'x\n');
  await git.stageNewFile(abs);
  expect(await git.trackedFiles()).not.toContain('fresh.txt');
});

test('only in-chat paths are approved for editing, and a declined path stays out of the chat', {
  meta: { aider: ['test_coder/TestCoder.test_allowed_to_edit_no'] },
}, async () => {
  const root = await tempDir('git-auth-decline-');
  const base = recordingHost();
  const questions: string[] = [];
  const host = {
    ...base,
    confirm: async (request: { question: string }) => {
      questions.push(request.question);
      return false;
    },
  };
  await initRepo(root);
  await commitFile(root, 'repo.txt', 'r\n', 'seed');
  await commitFile(root, 'added.txt', 'a\n', 'seed');
  const staged: string[] = [];
  const dirty: string[][] = [];
  const git: GitPolicy = {
    ...policyIn(root, host),
    stageNewFile: async (path) => {
      staged.push(path);
    },
    dirtyCommit: async (paths) => {
      dirty.push([...paths]);
      return { kind: 'protected' };
    },
  };
  const { controller, context } = controllerFor(root, host, git, [absRootPath(root, 'added.txt')]);
  const candidate = (path: string): EditCandidate<Upsert> => ({ edit: [path, { kind: 'update', path }], intent: { kind: 'update', path } });
  const prepared = await controller.prepareToEdit([candidate('added.txt'), candidate('repo.txt'), candidate('new.txt')], context);
  expect(prepared.map((entry) => entry.edit[0])).toEqual(['added.txt']);
  expect(questions).toEqual(['Allow edits to file that has not been added to the chat?', 'Create new file?']);
  expect(controller.snapshot.files.editable).toEqual([absRootPath(root, 'added.txt')]);
  expect(staged).toEqual([]);
  expect(dirty.flat()).toEqual([]);
});

test('editing an untracked existing file stages and commits it with an Added commit diff', {
  meta: { aider: ['test_coder/TestCoder.test_gpt_edit_to_existing_file_not_in_repo'] },
}, async () => {
  const root = await tempDir('git-auth-existing-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'other.txt', 'other\n', 'initial');
  await writeFile(join(root, 'file.txt'), 'one\n');
  const prompts: string[] = [];
  const git = policyIn(
    root,
    host,
    {},
    {
      generateCommitMessage: async (request) => {
        prompts.push(request.user);
        return 'feat: edit file';
      },
    },
  );
  const { controller } = controllerFor(root, host, git, [absRootPath(root, 'file.txt')]);
  const reply = 'file.txt\n<<<<<<< SEARCH\none\n=======\ntwo\n>>>>>>> REPLACE\n';
  const decision = await controller.completeReply({ kind: 'complete', id: 'reply-1', text: reply });
  expect(decision.continue).toBe(false);
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('two\n');
  expect(prompts[0]).toContain('Added file.txt');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const show = await isolatedExec({ command: 'git', args: ['show', 'HEAD:file.txt'], cwd: root }, env);
  expect(show.stdout).toBe('two\n');
});

test('an already tracked subdirectory file is never staged again', {
  meta: { aider: ['test_main/TestMain.test_main_with_empty_git_dir_new_subdir_file'] },
}, async () => {
  const root = await tempDir('git-auth-subdir-');
  const host = recordingHost();
  await initRepo(root);
  await mkdir(join(root, 'subdir'), { recursive: true });
  await commitFile(root, 'subdir/foo.txt', 'x\n');
  const git = policyIn(root, host);
  expect(await git.needToAdd('subdir/foo.txt')).toBe(false);
  expect(await git.trackedFiles()).toContain('subdir/foo.txt');
  const staged: string[] = [];
  const wrapped: GitPolicy = {
    ...git,
    stageNewFile: async (path) => {
      staged.push(path);
    },
  };
  const { controller, context } = controllerFor(root, host, wrapped, [absRootPath(root, 'subdir/foo.txt')]);
  const prepared = await controller.prepareToEdit([{ edit: ['subdir/foo.txt', { kind: 'update', path: 'subdir/foo.txt' }], intent: { kind: 'update', path: 'subdir/foo.txt' } }], context);
  expect(prepared).toHaveLength(1);
  expect(staged).toEqual([]);
});

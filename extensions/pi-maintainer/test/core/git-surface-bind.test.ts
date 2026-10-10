import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { ValueError } from '../../src/edit/errors.ts';
import { addFiles, type SelectionEnv, type SelectionState } from '../../src/edit/selection.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type EditFormat, type GitPolicy, registerEditFormat } from '../../src/feature.ts';

type Upsert = readonly [string, { readonly kind: 'upsert'; readonly path: string }];

const prompts = {
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
};

function baseSnapshot(root: string, overrides: Partial<Snapshot> = {}): Snapshot {
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
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
    ...overrides,
  };
}

async function exchangeHarness(options: {
  readonly snapshot: (root: string) => Snapshot;
  readonly git?: Partial<GitPolicy>;
  readonly format?: EditFormat<Upsert>;
  readonly confirm?: (request: { question: string; subject?: string | null }) => Promise<boolean>;
}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'git-surface-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const confirms: { question: string; subject?: string | null }[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => {
      confirms.push({ question: request.question, subject: request.subject ?? null });
      return options.confirm?.(request) ?? true;
    },
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const format = registerEditFormat(
    options.format ?? {
      name: 'whole',
      prompts: 'whole',
      editIntent: (edit) => edit[1],
      getEdits: (content) => {
        if (content === 'MALFORMED') throw new ValueError('bad');
        const path = content.trim().split('\n')[0] ?? content.trim();
        return [[path, { kind: 'upsert' as const, path }]];
      },
      applyEditsDryRun: (edits) => [...edits],
      applyEdits: async (edits, context) => {
        for (const [path] of edits) await context.tree.write(context.absRootPath(path), 'after\n');
      },
    },
  );
  const git: GitPolicy = { ...disabledGitPolicy, ...options.git };
  const controller = new ExchangeController(options.snapshot(root), {
    ports: {
      edit: {
        formats: new Map([
          ['whole', format],
          ['editor-whole', format],
        ]),
        requestedFormat: 'whole',
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: false,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-whole',
        tree: createWorkingTree({ notices: host }),
      },
      git,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: false,
  });
  return { root, controller, confirms, host };
}

test(
  'tracked reply mentions are offered one by one and approved adds reflect without applying edits',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_check_for_filename_mentions', 'test_coder/TestCoder.test_check_for_file_mentions_with_mocked_confirm'],
    },
  },
  async () => {
    const h = await exchangeHarness({
      git: { trackedFiles: async () => ['file1.txt', 'file2.py'] },
      snapshot: (root) =>
        baseSnapshot(root, {
          files: { editable: [absRootPath(root, 'chat.txt')], readOnly: [] },
        }),
      confirm: async (request) => request.subject === 'file1.txt',
    });
    await writeFile(join(h.root, 'chat.txt'), 'chat\n');
    await writeFile(join(h.root, 'file1.txt'), 'one\n');
    await writeFile(join(h.root, 'file2.py'), 'two\n');
    await h.controller.projectRequest({
      messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
      projection: [],
      supportsImages: false,
    });
    const decision = await h.controller.completeReply({
      kind: 'complete',
      id: 'reply-1',
      text: 'Please check file1.txt and file2.py\n```\nshould-not-apply\n```\n',
    });
    expect(h.confirms).toEqual([
      { question: 'Add file to the chat?', subject: 'file1.txt' },
      { question: 'Add file to the chat?', subject: 'file2.py' },
    ]);
    expect(decision.continue).toBe(true);
    expect(decision.dialogue.some((fact) => fact.purpose === 'reflection' && fact.text.includes('I added these files to the chat: file1.txt'))).toBe(true);
    expect(h.controller.snapshot.files.editable).toEqual([absRootPath(h.root, 'chat.txt'), absRootPath(h.root, 'file1.txt')]);
    expect(h.controller.snapshot.ignoredMentions).toEqual(['file2.py']);
    expect(await readFile(join(h.root, 'chat.txt'), 'utf8')).toBe('chat\n');
    expect(await readFile(join(h.root, 'file1.txt'), 'utf8')).toBe('one\n');
  },
);

test(
  'add refuses a non-image path outside the root with Aider text when automatic commits are on',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_add_from_outside_root', 'test_commands/TestCommands.test_cmd_add_from_outside_git'],
    },
  },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-surface-add-')));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-')));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    const errors: string[] = [];
    const host: Host = {
      output: () => {},
      warning: () => {},
      error: (text) => {
        errors.push(text);
      },
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    };
    const file = join(outside, 'ext.txt');
    await writeFile(file, 'x\n');
    const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
    const envOn: SelectionEnv = {
      root,
      host,
      tree: createWorkingTree({ notices: host }),
      git: { ...disabledGitPolicy, repoRoot: () => root, trackedFiles: async () => [] },
      autoCommits: true,
      supportsImages: true,
    };
    const refused = await addFiles(file, empty, envOn);
    expect(refused.editable).toEqual([]);
    expect(errors).toEqual([`Can not add ${file}, which is not within ${root}`]);

    errors.length = 0;
    const envOff: SelectionEnv = { ...envOn, autoCommits: false };
    const admitted = await addFiles(file, empty, envOff);
    expect(admitted.editable).toEqual([file]);
    expect(errors).toEqual([]);
  },
);

test(
  'after the editor finishes, its assistant commit hashes are assigned back to the architect coder',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_architect_coder_auto_accept_true'],
    },
  },
  async () => {
    const h = await exchangeHarness({
      git: {
        autoCommit: async () => ({ kind: 'committed', hash: 'abc1234', message: 'editor change' }),
      },
      snapshot: (root) =>
        baseSnapshot(root, {
          mode: 'editor-whole',
          phase: {
            kind: 'editor',
            format: 'editor-whole',
            parentMode: 'architect',
            parentModel: { provider: 'test', id: 'scripted' },
            architectReplyId: 'arch-1',
          },
          files: { editable: [absRootPath(root, 'hello.txt')], readOnly: [] },
          assistantCommits: ['prior'],
        }),
    });
    await writeFile(join(h.root, 'hello.txt'), 'before\n');
    await h.controller.projectRequest({
      messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
      projection: [],
      supportsImages: false,
    });
    const decision = await h.controller.completeReply({ kind: 'complete', id: 'editor-1', text: 'hello.txt' });
    expect(await readFile(join(h.root, 'hello.txt'), 'utf8')).toBe('after\n');
    expect(h.controller.snapshot).toMatchObject({
      mode: 'architect',
      phase: { kind: 'main' },
      assistantCommits: ['prior', 'abc1234'],
    });
    expect(decision.dialogue.some((fact) => fact.purpose === 'architect-return')).toBe(true);
  },
);

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { ValueError } from '../../src/edit/errors.ts';
import { architectFormat, askFormat, editorWholeFormat } from '../../src/edit/modes.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type EditFormat, type GitPolicy, registerEditFormat, type Validation } from '../../src/feature.ts';

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

function snapshot(root: string, editable: string[], mode: Snapshot['mode'] = 'whole'): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode,
    phase: { kind: 'main' },
    files: { editable, readOnly: [] },
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
  };
}

async function harness(
  options: {
    readonly format?: EditFormat<Upsert>;
    readonly git?: Partial<GitPolicy>;
    readonly lint?: Partial<Validation>;
    readonly confirm?: (request: { question: string }) => Promise<boolean>;
    readonly editable?: string[];
    readonly dryRun?: boolean;
    readonly mode?: Snapshot['mode'];
    readonly formats?: ReadonlyMap<string, EditFormat<Upsert> | typeof askFormat | typeof architectFormat | typeof editorWholeFormat>;
    readonly suggestShellCommands?: boolean;
    readonly autoAcceptArchitect?: boolean;
  } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lint-lifecycle-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const commits: Array<{ paths: string[]; context: string }> = [];
  const lintCalls: string[][] = [];
  const shellCalls: string[][] = [];
  const testCalls: number[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => options.confirm?.(request) ?? true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const format = registerEditFormat(
    options.format ?? {
      name: 'whole',
      prompts: 'whole',
      editIntent: (edit) => edit[1],
      getEdits: (content) => {
        if (content === 'MALFORMED') throw new ValueError('No filename provided before ``` in file listing');
        return [[content.trim(), { kind: 'upsert' as const, path: content.trim() }]];
      },
      applyEditsDryRun: (edits) => [...edits],
      applyEdits: async (edits, context) => {
        for (const [path] of edits) {
          await context.tree.write(context.absRootPath(path), 'after\n');
        }
      },
    },
  );
  const dryRun = options.dryRun ?? false;
  const tree = createWorkingTree({ notices: host, dryRun });
  const git: GitPolicy = {
    ...disabledGitPolicy,
    ...options.git,
    autoCommit: async (paths, context, signal) => {
      commits.push({ paths: [...paths].map(String).sort(), context: context.kind });
      return options.git?.autoCommit?.(paths, context, signal) ?? { kind: 'committed', hash: 'abc', message: context.kind };
    },
  };
  const lint: Validation = {
    ...disabledValidation,
    ...options.lint,
    lintEdited: async (paths, signal) => {
      lintCalls.push([...paths].map(String).sort());
      return options.lint?.lintEdited?.(paths, signal) ?? { kind: 'passed' };
    },
    runSuggestedShell: async (commands, signal) => {
      shellCalls.push([...commands]);
      return options.lint?.runSuggestedShell?.(commands, signal) ?? { kind: 'ran' };
    },
    testEdited: async (signal) => {
      testCalls.push(1);
      return options.lint?.testEdited?.(signal) ?? { kind: 'not-run' };
    },
  };
  const editable = (options.editable ?? ['target.txt']).map((path) => absRootPath(root, path));
  for (const path of editable) await writeFile(path, 'before\n');
  const mode = options.mode ?? 'whole';
  const formats =
    options.formats ??
    new Map([
      ['whole', format],
      ['ask', askFormat],
      ['architect', architectFormat],
      ['editor-whole', editorWholeFormat],
    ]);
  const controller = new ExchangeController(snapshot(root, editable, mode), {
    ports: {
      edit: {
        formats: formats as never,
        requestedFormat: mode,
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun,
        yesAlways: true,
        autoAcceptArchitect: options.autoAcceptArchitect ?? true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-whole',
        tree,
      },
      git,
      map: disabledRepositoryContext,
      lint,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: options.suggestShellCommands ?? false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { root, controller, commits, lintCalls, shellCalls, testCalls, editable };
}

test('automatic lint selects authorized prepare targets not a git dirty listing', async () => {
  const h = await harness({
    editable: ['good.txt', 'other.txt'],
    format: {
      name: 'whole',
      prompts: 'whole',
      editIntent: (edit) => edit[1],
      getEdits: () => [
        ['good.txt', { kind: 'upsert', path: 'good.txt' }],
        ['other.txt', { kind: 'upsert', path: 'other.txt' }],
      ],
      applyEditsDryRun: (edits) => [...edits],
      applyEdits: async (_edits, context) => {
        await context.tree.write(context.absRootPath('good.txt'), 'ok\n');
        await context.tree.write(context.absRootPath('other.txt'), 'ok\n');
      },
    },
    git: {
      // Dirty files that must not become the lint selection.
      trackedFiles: async () => ['unrelated-dirty.txt'],
    },
  });
  await h.controller.completeReply({ kind: 'complete', id: 'reply-1', text: 'RUN' });
  expect(h.lintCalls).toEqual([['good.txt', 'other.txt']]);
});

test('dry-run still lints the authorized edit-target set without writing', async () => {
  const h = await harness({
    dryRun: true,
    lint: { lintEdited: async () => ({ kind: 'passed' }) },
  });
  await h.controller.completeReply({ kind: 'complete', id: 'reply-dry', text: 'target.txt' });
  expect(h.lintCalls).toEqual([['target.txt']]);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ preparedTargets: ['target.txt'], writtenPaths: [] });
  expect(h.commits.filter((entry) => entry.context === 'linter')).toEqual([]);
});

test('post-lint commit uses Ran the linter context whether diagnostics were produced', async () => {
  for (const outcome of [{ kind: 'passed' as const }, { kind: 'failed' as const, report: 'lint found issues' }]) {
    const h = await harness({
      lint: { lintEdited: async () => outcome },
      confirm: async () => false,
    });
    await h.controller.completeReply({ kind: 'complete', id: `reply-${outcome.kind}`, text: 'target.txt' });
    expect(h.commits.map((entry) => entry.context)).toEqual(['conversation', 'linter']);
  }
});

test('a new user binding clears edit tracking and the shared reflection budget', async () => {
  const h = await harness({
    lint: { lintEdited: async () => ({ kind: 'failed', report: 'lint found issues' }) },
  });
  await h.controller.completeReply({ kind: 'complete', id: 'reply-lint', text: 'target.txt' });
  expect(h.controller.snapshot.lifecycle).toMatchObject({ reflectionsSent: 1, preparedTargets: ['target.txt'] });
  h.controller.bindUser(['user-1', 'user-2'], { provider: 'test', id: 'scripted' }, 'user');
  expect(h.controller.snapshot.lifecycle).toEqual({
    kind: 'active',
    userEntries: ['user-2'],
    reflectionsSent: 0,
    preparedTargets: [],
    writtenPaths: [],
    waitingFor: null,
  });
});

test('lint test and malformed reflections share one three-request budget', async () => {
  const h = await harness({
    lint: {
      lintEdited: async () => ({ kind: 'failed', report: 'lint found issues' }),
      testEdited: async () => ({ kind: 'failed', report: 'test found issues' }),
    },
  });
  const first = await h.controller.completeReply({ kind: 'complete', id: 'reply-malformed', text: 'MALFORMED' });
  expect(first.continue).toBe(true);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ reflectionsSent: 1 });

  h.controller.save({
    ...h.controller.snapshot,
    lifecycle: { ...h.controller.snapshot.lifecycle, kind: 'active', waitingFor: null } as Snapshot['lifecycle'],
  });
  const second = await h.controller.completeReply({ kind: 'complete', id: 'reply-lint', text: 'target.txt' });
  expect(second.continue).toBe(true);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ reflectionsSent: 2 });

  h.controller.save({
    ...h.controller.snapshot,
    lifecycle: {
      kind: 'active',
      userEntries: ['user-1'],
      reflectionsSent: 2,
      preparedTargets: [],
      writtenPaths: [],
      waitingFor: null,
    },
  });
  // Force a test-only reflection without re-linting by skipping edit targets.
  const testOnly = await h.controller.reflect('test found issues', 'reply-test', []);
  expect(testOnly.continue).toBe(true);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ reflectionsSent: 3 });

  const stopped = await h.controller.completeReply({ kind: 'complete', id: 'reply-stop', text: 'MALFORMED' });
  expect(stopped.continue).toBe(false);
});

test('applySavedResponse applies edits and bypasses lint shell and test validation', async () => {
  const h = await harness({
    lint: {
      lintEdited: async () => ({ kind: 'failed', report: 'should not run' }),
      testEdited: async () => ({ kind: 'failed', report: 'should not run' }),
    },
    suggestShellCommands: true,
  });
  await h.controller.applySavedResponse('target.txt');
  expect(h.lintCalls).toEqual([]);
  expect(h.shellCalls).toEqual([]);
  expect(h.testCalls).toEqual([]);
  expect(h.commits).toEqual([]);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ preparedTargets: ['target.txt'] });
});

test('ask mode produces no edits and skips automatic lint', async () => {
  const h = await harness({ mode: 'ask' });
  const decision = await h.controller.completeReply({
    kind: 'complete',
    id: 'reply-ask',
    text: 'target.txt\n```\nafter\n```\n',
  });
  expect(decision).toEqual({ dialogue: [], continue: false });
  expect(h.lintCalls).toEqual([]);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ preparedTargets: [], writtenPaths: [] });
});

test('architect editor path still runs lint validation after the editor applies', async () => {
  const h = await harness({
    mode: 'architect',
    autoAcceptArchitect: true,
    lint: { lintEdited: async () => ({ kind: 'passed' }) },
  });
  const plan = await h.controller.completeReply({ kind: 'complete', id: 'reply-arch', text: 'Update target.txt' });
  expect(plan.continue).toBe(true);
  expect(h.controller.snapshot).toMatchObject({ mode: 'editor-whole', phase: { kind: 'editor' } });
  await h.controller.completeReply({
    kind: 'complete',
    id: 'reply-editor',
    text: 'target.txt\n```\nafter\n```\n',
  });
  expect(h.lintCalls).toEqual([['target.txt']]);
  expect(h.controller.snapshot).toMatchObject({ mode: 'architect', phase: { kind: 'main' } });
});

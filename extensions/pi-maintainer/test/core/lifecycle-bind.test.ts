import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { ValueError } from '../../src/edit/errors.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type EditFormat, type GitPolicy, registerEditFormat, type Validation } from '../../src/feature.ts';

type Upsert = readonly [string, { readonly kind: 'upsert'; readonly path: string }];

const EDIT_ERRORS_URL = 'https://aider.chat/docs/troubleshooting/edit-errors.html';

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

function snapshot(root: string, editable: string[] = []): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable, readOnly: [] },
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
  };
}

async function harness(
  options: { readonly format?: EditFormat<Upsert>; readonly git?: Partial<GitPolicy>; readonly lint?: Partial<Validation>; readonly confirm?: (request: { question: string }) => Promise<boolean>; readonly editable?: string[] } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lifecycle-bind-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const commits: Array<{ paths: string[]; context: string }> = [];
  const dirtyBatches: string[][] = [];
  const lintCalls: string[][] = [];
  const host: Host = {
    output: (text) => {
      outputs.push(text);
    },
    warning: (text) => {
      warnings.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
    confirm: async (request) => options.confirm?.(request) ?? true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const steps: string[] = [];
  const format = registerEditFormat(
    options.format ?? {
      name: 'whole',
      prompts: 'whole',
      editIntent: (edit) => edit[1],
      getEdits: (content) => {
        steps.push('parse');
        if (content === 'MALFORMED') throw new ValueError('No filename provided before ``` in file listing');
        if (content === 'NONE') return [];
        return [[content.trim(), { kind: 'upsert' as const, path: content.trim() }]];
      },
      applyEditsDryRun: (edits) => {
        steps.push('preflight');
        return [...edits];
      },
      applyEdits: async (edits, context) => {
        steps.push('apply');
        for (const [path] of edits) {
          await context.tree.write(context.absRootPath(path), 'after\n');
        }
      },
    },
  );
  const tree = createWorkingTree({ notices: host });
  const git: GitPolicy = {
    ...disabledGitPolicy,
    ...options.git,
    dirtyCommit: async (paths, signal) => {
      dirtyBatches.push([...paths].sort());
      return options.git?.dirtyCommit?.(paths, signal) ?? { kind: 'disabled' };
    },
    autoCommit: async (paths, context, signal) => {
      commits.push({ paths: [...paths].map(String).sort(), context: context.kind });
      return options.git?.autoCommit?.(paths, context, signal) ?? { kind: 'disabled' };
    },
  };
  const lint: Validation = {
    ...disabledValidation,
    ...options.lint,
    lintEdited: async (paths, signal) => {
      lintCalls.push([...paths].map(String).sort());
      return options.lint?.lintEdited?.(paths, signal) ?? { kind: 'disabled' };
    },
  };
  const editable = (options.editable ?? ['target.txt']).map((path) => absRootPath(root, path));
  for (const path of editable) await writeFile(path, 'before\n');
  const controller = new ExchangeController(snapshot(root, editable), {
    ports: {
      edit: {
        formats: new Map([['whole', format]]),
        requestedFormat: 'whole',
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
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
      lint,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { root, controller, host, outputs, warnings, errors, commits, dirtyBatches, lintCalls, steps, editable };
}

test('complete reply parses preflights authorizes then applies in that order', async () => {
  const h = await harness({
    git: { needsDirtyCommit: async () => true },
  });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-1', text: 'target.txt' });
  expect(h.steps).toEqual(['parse', 'preflight', 'apply']);
  expect(h.dirtyBatches).toEqual([['target.txt']]);
  expect(await readFile(join(h.root, 'target.txt'), 'utf8')).toBe('after\n');
  expect(decision.continue).toBe(false);
});

test('a ValueError prints the edit-format notice URL and error then reflects', async () => {
  const h = await harness();
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-bad', text: 'MALFORMED' });
  expect(h.errors).toEqual(['The LLM did not conform to the edit format.', 'No filename provided before ``` in file listing']);
  expect(h.outputs).toContain(EDIT_ERRORS_URL);
  expect(decision.continue).toBe(true);
  expect(decision.dialogue.map((fact) => fact.text)).toContain('No filename provided before ``` in file listing');
  expect(h.controller.snapshot.lifecycle).toMatchObject({ kind: 'active', reflectionsSent: 1 });
});

test('a fourth reflection stops with the three-reflection warning', async () => {
  const h = await harness();
  h.controller.save({
    ...h.controller.snapshot,
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 3, preparedTargets: [], writtenPaths: [], waitingFor: null },
  });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-4', text: 'MALFORMED' });
  expect(decision.continue).toBe(false);
  expect(h.warnings).toContain('Only 3 reflections allowed, stopping.');
});

test('auto-commit and lint ports receive only successfully written paths', { meta: { evidence: ['ev-edit/patch-lifecycle/reported-edited'] } }, async () => {
  const h = await harness({
    git: { needsDirtyCommit: async () => true },
    lint: { lintEdited: async () => ({ kind: 'disabled' }) },
    format: {
      name: 'whole',
      prompts: 'whole',
      editIntent: (edit) => edit[1],
      getEdits: () => [
        ['good.txt', { kind: 'upsert', path: 'good.txt' }],
        ['bad.txt', { kind: 'upsert', path: 'bad.txt' }],
      ],
      applyEditsDryRun: (edits) => [...edits],
      applyEdits: async (_edits, context) => {
        await context.tree.write(context.absRootPath('good.txt'), 'ok\n');
        throw new Error('second write failed');
      },
    },
    editable: ['good.txt', 'bad.txt'],
  });
  await h.controller.completeReply({ kind: 'complete', id: 'reply-partial', text: 'RUN' });
  expect(h.outputs).toEqual(['bad.txt good.txt', 'Applied edit to good.txt']);
  expect(h.commits).toEqual([{ paths: ['good.txt'], context: 'conversation' }]);
  expect(h.lintCalls).toEqual([]);
  expect(h.controller.snapshot.lifecycle).toMatchObject({ preparedTargets: ['good.txt', 'bad.txt'], writtenPaths: [absRootPath(h.root, 'good.txt')] });
});

test('a failed lint report reflects after confirmation', async () => {
  const h = await harness({
    lint: { lintEdited: async () => ({ kind: 'failed', report: 'lint found issues' }) },
    confirm: async () => true,
  });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-lint', text: 'target.txt' });
  expect(h.lintCalls).toEqual([['target.txt']]);
  expect(decision.continue).toBe(true);
  expect(decision.dialogue.map((fact) => fact.text)).toContain('lint found issues');
  expect(h.commits.map((entry) => entry.context)).toEqual(['conversation', 'linter']);
});

test('incomplete replies apply no edits and skip follow-up ports', async () => {
  const h = await harness({ git: { needsDirtyCommit: async () => true } });
  for (const reason of ['length', 'aborted', 'error'] as const) {
    h.controller.save(snapshot(h.root, h.editable));
    await h.controller.projectRequest({
      messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
      projection: [],
      supportsImages: false,
    });
    const decision = await h.controller.completeReply({ kind: 'incomplete', id: `reply-${reason}`, reason });
    expect(decision).toEqual({ dialogue: [], continue: false });
    expect(await readFile(join(h.root, 'target.txt'), 'utf8')).toBe('before\n');
  }
  expect(h.steps).toEqual([]);
  expect(h.commits).toEqual([]);
  expect(h.lintCalls).toEqual([]);
});

test('a successful reply moves history and emits the no-repo saved notice', async () => {
  const h = await harness();
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-ok', text: 'target.txt' });
  expect(h.controller.snapshot.historyThrough).toBe('reply-ok');
  expect(decision.dialogue).toEqual([{ text: 'I updated the files.', ack: 'Ok.', purpose: 'saved', reply: 'reply-ok' }]);
});

test('a new user binding clears reflection and edit tracking', async () => {
  const h = await harness();
  h.controller.save({
    ...h.controller.snapshot,
    lifecycle: {
      kind: 'active',
      userEntries: ['user-1'],
      reflectionsSent: 3,
      preparedTargets: ['old.txt'],
      writtenPaths: [absRootPath(h.root, 'old.txt')],
      waitingFor: 'reply-old',
    },
  });
  h.controller.bindUser(['user-1', 'user-2'], { provider: 'test', id: 'scripted' }, 'user');
  expect(h.controller.snapshot.lifecycle).toEqual({
    kind: 'active',
    userEntries: ['user-2'],
    reflectionsSent: 0,
    preparedTargets: [],
    writtenPaths: [],
    waitingFor: null,
  });
  expect(h.controller.snapshot.lastUserEntry).toBe('user-2');
});

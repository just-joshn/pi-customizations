import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { formatFilesForInput } from '../../src/core/chat-file-listing.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, registerEditFormat } from '../../src/feature.ts';

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

test('plain mode lists read-only first with (read only) then editable paths', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_false'] },
}, () => {
  expect(
    formatFilesForInput({
      relFnames: ['file1.txt', 'file[markup].txt', 'ro_file.txt'],
      relReadOnlyFnames: ['ro_file.txt'],
      pretty: false,
      root: '/tmp/root',
    }),
  ).toBe('ro_file.txt (read only)\nfile1.txt\nfile[markup].txt\n');
});

test('pretty mode with no files prints nothing', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_no_files'] },
}, () => {
  expect(formatFilesForInput({ relFnames: [], relReadOnlyFnames: [], pretty: true, root: '/tmp/root' })).toBe('');
});

test('pretty mode editable-only columns omit the Editable label', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_editable_only'] },
}, () => {
  expect(
    formatFilesForInput({
      relFnames: ['edit1.txt', 'edit[markup].txt'],
      relReadOnlyFnames: [],
      pretty: true,
      root: '/tmp/root',
    }),
  ).toBe('edit1.txt edit[markup].txt\n');
});

test('pretty mode read-only-only columns use the Readonly label', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_readonly_only'] },
}, () => {
  expect(
    formatFilesForInput({
      relFnames: ['ro1.txt', 'ro[markup].txt'],
      relReadOnlyFnames: ['ro1.txt', 'ro[markup].txt'],
      pretty: true,
      root: '/tmp/root',
    }),
  ).toBe('Readonly: ro1.txt ro[markup].txt\n');
});

test('pretty mode mixed files label Readonly then Editable', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_mixed_files'] },
}, () => {
  expect(
    formatFilesForInput({
      relFnames: ['edit1.txt', 'edit[markup].txt', 'ro1.txt', 'ro[markup].txt'],
      relReadOnlyFnames: ['ro1.txt', 'ro[markup].txt'],
      pretty: true,
      root: '/tmp/root',
    }),
  ).toBe('Readonly: ro1.txt ro[markup].txt\nEditable: edit1.txt edit[markup].txt\n');
});

async function harness(options: { readonly pretty?: boolean; readonly editable?: string[]; readonly readOnly?: string[] } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ui-chat-listing-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const outputs: string[] = [];
  const host: Host = {
    output: (text) => {
      outputs.push(text);
    },
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const editable = (options.editable ?? ['edit.txt']).map((path) => absRootPath(root, path));
  const readOnly = (options.readOnly ?? ['ro.txt']).map((path) => absRootPath(root, path));
  for (const path of [...editable, ...readOnly]) await writeFile(path, 'body\n');
  const snapshot: Snapshot = {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable, readOnly },
    originalReadOnly: [...readOnly],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
  };
  const format = registerEditFormat({
    name: 'whole',
    prompts: 'whole',
    editIntent: (edit: readonly [string, { readonly kind: 'upsert'; readonly path: string }]) => edit[1],
    getEdits: () => [],
    applyEditsDryRun: (edits: readonly unknown[]) => [...edits],
    applyEdits: async () => {},
  });
  const controller = new ExchangeController(snapshot, {
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
        tree: createWorkingTree({ notices: host }),
      },
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: false,
    pretty: options.pretty ?? false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { outputs, root };
}

test('projectRequest emits the plain chat-file listing before the model prompt', {
  meta: {
    aider: [
      'test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_false',
      'aider/coders/base_coder.py:898-910',
    ],
  },
}, async () => {
  const { outputs } = await harness({ pretty: false, editable: ['edit.txt'], readOnly: ['ro.txt'] });
  expect(outputs).toContain('ro.txt (read only)\nedit.txt');
});

test('projectRequest emits pretty Readonly and Editable columns when both kinds exist', {
  meta: {
    aider: [
      'test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_mixed_files',
      'aider/coders/base_coder.py:898-910',
    ],
  },
}, async () => {
  const { outputs } = await harness({ pretty: true, editable: ['edit.txt'], readOnly: ['ro.txt'] });
  expect(outputs).toContain('Readonly: ro.txt\nEditable: edit.txt');
});

test('projectRequest skips listing when the chat has no files', {
  meta: { aider: ['test_io/TestInputOutputFormatFiles.test_format_files_for_input_pretty_true_no_files'] },
}, async () => {
  const { outputs } = await harness({ pretty: true, editable: [], readOnly: [] });
  expect(outputs.filter((line) => line.includes('Readonly:') || line.includes('(read only)'))).toEqual([]);
});

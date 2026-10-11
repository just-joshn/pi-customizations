import { access, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { diffFormat } from '../../src/edit/feature.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation } from '../../src/feature.ts';

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

function snapshot(root: string): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'diff',
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
  };
}

async function harness() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dry-run-report-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'chat.txt'), 'keep\n');
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
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
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const tree = createWorkingTree({ dryRun: true, notices: host });
  const controller = new ExchangeController(snapshot(root), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: true,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-diff',
        tree,
      },
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'create', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { root, controller, outputs, warnings, errors };
}

test('dry-run empty-SEARCH new file reports Did not apply without writing or reflecting', {
  meta: {
    aider: ['test_editblock/TestUtils.test_full_edit_dry_run', 'test_wholefile/TestWholeFileCoder.test_no_files_new_file_should_ask'],
  },
}, async () => {
  const h = await harness();
  const reply = `new.txt
<<<<<<< SEARCH
=======
created
>>>>>>> REPLACE
`;
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-1', text: reply });
  expect(h.outputs).toContain('Did not apply edit to new.txt (--dry-run)');
  expect(h.errors).toEqual([]);
  expect(decision.continue).toBe(false);
  expect(decision.dialogue.filter((fact) => fact.purpose === 'reflection')).toEqual([]);
  await expect(access(join(h.root, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(h.root)).toEqual(['chat.txt']);
});

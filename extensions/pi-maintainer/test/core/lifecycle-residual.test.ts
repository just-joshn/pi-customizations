import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import type { CommandEnv } from '../../src/core/command.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import { routeEntryActions } from '../../src/core/route-entry.ts';
import { editCommands } from '../../src/edit/commands.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type GitPolicy, registerEditFormat, type UndoResult } from '../../src/feature.ts';
import { defined } from '../support/defined.ts';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root: '/repo',
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: [], readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: { provider: 'p', id: 'gpt-3.5' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
    ...overrides,
  };
}

function commandEnv(git: GitPolicy): { readonly env: CommandEnv; readonly errors: string[]; readonly outputs: string[] } {
  const errors: string[] = [];
  const outputs: string[] = [];
  const snapshot = baseSnapshot();
  const env = {
    host: {
      output: (text: string) => outputs.push(text),
      warning() {},
      error: (text: string) => errors.push(text),
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    },
    get snapshot() {
      return snapshot;
    },
    save() {},
    tree: {
      read: async () => null,
      write: async () => {},
      exists: async () => false,
      touch: async () => true,
      remove: async () => {},
      mkdir: async () => {},
    },
    git,
    autoCommits: true,
    supportsImages: true,
    sendUserMessage: async () => {},
    setPhysicalModel: async () => true,
    findPhysicalModel: () => null,
    defaultEditFormat: () => 'whole' as const,
  } as unknown as CommandEnv;
  return { env, errors, outputs };
}

test('direct route entry skips exchange binding and mention preprocessing', () => {
  expect(routeEntryActions('direct')).toEqual({ bindExchange: false, preprocessMentions: false });
  expect(routeEntryActions('user')).toEqual({ bindExchange: true, preprocessMentions: true });
  expect(routeEntryActions('continuation')).toEqual({ bindExchange: true, preprocessMentions: false });
  expect(routeEntryActions('retry')).toEqual({ bindExchange: true, preprocessMentions: false });
});

test('an unbound idle exchange refuses automatic reflection follow-ups', async () => {
  const format = registerEditFormat({
    name: 'whole',
    prompts: 'whole',
    editIntent: () => null,
    getEdits: () => [],
    applyEditsDryRun: (edits) => [...edits],
    applyEdits: async () => {},
  });
  const host = { output() {}, warning() {}, error() {}, confirm: async () => true, select: async () => undefined, exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }) };
  const controller = new ExchangeController(baseSnapshot(), {
    ports: {
      edit: {
        formats: new Map([['whole', format]]),
        requestedFormat: null,
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: false,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        editorEditFormat: 'editor-whole',
        chatLanguage: null,
        tree: createWorkingTree({ notices: host }),
      },
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: {
      get: async () => ({
        mainSystem: 'MAIN',
        systemReminder: '',
        exampleMessages: [],
        filesContentPrefix: '',
        filesContentAssistantReply: 'Ok.',
        filesNoFullFiles: '',
        filesNoFullFilesWithRepoMap: '',
        filesNoFullFilesWithRepoMapReply: '',
        readOnlyFilesPrefix: '',
        filesContentGptEditsNoRepo: '',
      }),
    },
    append() {},
    suggestShellCommands: false,
  });
  const decision = await controller.completeReply({ kind: 'complete', id: 'reply-1', text: 'malformed' });
  expect(decision).toEqual({ dialogue: [], continue: false });
  expect(controller.snapshot.lifecycle).toEqual({ kind: 'idle' });
});

test('/undo dispatches to the git port and surfaces a disabled refusal', async () => {
  const undo = editCommands.find((command) => command.name === 'undo');
  expect(undo).toBeDefined();
  let calls = 0;
  const git: GitPolicy = {
    ...disabledGitPolicy,
    undo: async () => {
      calls += 1;
      return { kind: 'disabled' };
    },
  };
  const { env, errors, outputs } = commandEnv(git);
  await defined(undo).run('', env);
  expect(calls).toBe(1);
  expect(errors).toEqual(['No git repository found.']);
  expect(outputs).toEqual([]);
});

test('/undo surfaces a restoration result from the git port without edit-layer restore', async () => {
  const undo = editCommands.find((command) => command.name === 'undo');
  const result: UndoResult = {
    kind: 'removed',
    hash: 'abc1234',
    message: 'aider: edited foo.py',
    nowAt: { hash: 'def5678', message: 'prior' },
  };
  let calls = 0;
  const git: GitPolicy = {
    ...disabledGitPolicy,
    undo: async () => {
      calls += 1;
      return result;
    },
  };
  const { env, errors, outputs } = commandEnv(git);
  await defined(undo).run('', env);
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
  expect(outputs).toEqual(['Removed: abc1234 aider: edited foo.py', 'Now at:  def5678 prior']);
  const commandsSource = readFileSync(join(packageRoot, 'src/edit/commands.ts'), 'utf8');
  expect(commandsSource).not.toMatch(/checkout|reset\s+--soft|HEAD~1/);
  expect(commandsSource).toContain('env.git.undo');
});

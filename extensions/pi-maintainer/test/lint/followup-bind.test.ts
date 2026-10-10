import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { diffFormat } from '../../src/edit/feature.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, type GitPolicy } from '../../src/feature.ts';
import { createValidation } from '../../src/lint/validation.ts';

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

function snapshot(root: string, editable: string[]): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'diff',
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

const SEARCH_REPLACE = `target.txt
<<<<<<< SEARCH
before
=======
after
>>>>>>> REPLACE
`;

const BASH_REPLY = `${SEARCH_REPLACE}

\`\`\`bash
echo hi
\`\`\`
`;

test('edited files are auto-committed before lint runs', async () => {
  const root = await tempRoot('lint-commit-before-');
  await writeFile(join(root, 'target.txt'), 'before\n');
  const order: string[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => false,
    select: async () => undefined,
    exec: async (request) => {
      order.push(`exec:${request.command}`);
      return { stdout: '', stderr: '', code: 0, killed: false };
    },
  };
  const git: GitPolicy = {
    ...disabledGitPolicy,
    autoCommit: async () => {
      order.push('commit');
      return { kind: 'committed', hash: 'deadbee', message: 'edit' };
    },
  };
  const base = createValidation({
    host,
    root,
    autoLint: true,
    autoTest: false,
    lintCmds: new Map([[null, 'true']]),
    testCmd: null,
  });
  const lint = {
    ...base,
    lintEdited: async (paths: ReadonlySet<string | null>, signal?: AbortSignal) => {
      order.push('lint');
      return base.lintEdited(paths, signal);
    },
  };
  const controller = new ExchangeController(snapshot(root, [absRootPath(root, 'target.txt')]), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
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
      lint,
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
        filesContentGptEditsNoRepo: 'saved',
      }),
    },
    append: () => {},
    suggestShellCommands: false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  await controller.completeReply({ kind: 'complete', id: 'reply-1', text: SEARCH_REPLACE });
  expect(order[0]).toBe('commit');
  expect(order).toContain('lint');
  expect(order.indexOf('commit')).toBeLessThan(order.indexOf('lint'));
});

test('after edits, lint then shell then test follow when each is enabled', async () => {
  const root = await tempRoot('lint-order-');
  await writeFile(join(root, 'target.txt'), 'before\n');
  const order: string[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => {
      order.push(`confirm:${request.question}`);
      return true;
    },
    select: async () => undefined,
    exec: async (request) => {
      order.push(`exec:${[request.command, ...request.args].join(' ')}`);
      return { stdout: 'ok\n', stderr: '', code: 0, killed: false };
    },
  };
  const lint = createValidation({
    host,
    root,
    autoLint: true,
    autoTest: true,
    lintCmds: new Map([[null, 'true']]),
    testCmd: 'true',
  });
  const wrapped = {
    ...lint,
    lintEdited: async (paths: ReadonlySet<string | null>, signal?: AbortSignal) => {
      order.push('lint');
      return lint.lintEdited(paths, signal);
    },
    runSuggestedShell: async (commands: readonly string[], signal?: AbortSignal) => {
      order.push('shell');
      return lint.runSuggestedShell(commands, signal);
    },
    testEdited: async (signal?: AbortSignal) => {
      order.push('test');
      return lint.testEdited(signal);
    },
  };
  const controller = new ExchangeController(snapshot(root, [absRootPath(root, 'target.txt')]), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
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
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint: wrapped,
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
        filesContentGptEditsNoRepo: null,
      }),
    },
    append: () => {},
    suggestShellCommands: true,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  await controller.completeReply({ kind: 'complete', id: 'reply-1', text: BASH_REPLY });
  expect(order.filter((step) => step === 'lint' || step === 'shell' || step === 'test')).toEqual(['lint', 'shell', 'test']);
});

test('a failed test report reflects after confirmation', async () => {
  const root = await tempRoot('lint-reflect-test-');
  await writeFile(join(root, 'target.txt'), 'before\n');
  const questions: string[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => {
      questions.push(request.question);
      return true;
    },
    select: async () => undefined,
    exec: async () => ({ stdout: 'FAIL\n', stderr: '', code: 1, killed: false }),
  };
  const lint = createValidation({
    host,
    root,
    autoLint: false,
    autoTest: true,
    lintCmds: new Map(),
    testCmd: 'false',
  });
  const controller = new ExchangeController(snapshot(root, [absRootPath(root, 'target.txt')]), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
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
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint,
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
        filesContentGptEditsNoRepo: null,
      }),
    },
    append: () => {},
    suggestShellCommands: false,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  const decision = await controller.completeReply({ kind: 'complete', id: 'reply-1', text: SEARCH_REPLACE });
  expect(questions).toContain('Attempt to fix test errors?');
  expect(decision.continue).toBe(true);
  expect(decision.dialogue.some((fact) => fact.text.includes('false'))).toBe(true);
});

test('auto-lint off skips lintEdited work and auto-test off skips testEdited work', async () => {
  const root = await tempRoot('lint-flags-');
  await mkdir(root, { recursive: true });
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => {
      throw new Error('exec should not run when auto flags are off');
    },
  };
  const lint = createValidation({
    host,
    root,
    autoLint: false,
    autoTest: false,
    lintCmds: new Map([[null, 'false']]),
    testCmd: 'false',
  });
  expect(await lint.lintEdited(new Set(['a.py']))).toEqual({ kind: 'not-run' });
  expect(await lint.testEdited()).toEqual({ kind: 'not-run' });
});

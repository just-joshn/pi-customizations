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
        filesContentGptEditsNoRepo: '',
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

const BASH_ONLY = '```bash\necho hi\n```\n';
const PY_REPLY = `target.py
<<<<<<< SEARCH
before
=======
after
>>>>>>> REPLACE
`;

/** A controller over real lint validation that records each shell/lint/test command it runs. */
async function followupHarness(options: {
  readonly autoLint: boolean;
  readonly autoTest: boolean;
  readonly lintCmd: string | null;
  readonly testCmd: string | null;
  readonly lintExit?: number;
  readonly answer?: (question: string) => boolean;
}) {
  const root = await tempRoot('lint-follow-');
  await writeFile(join(root, 'target.py'), 'before\n');
  const runs: { kind: string; command: string }[] = [];
  const questions: string[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async (request) => {
      questions.push(request.question);
      return options.answer?.(request.question) ?? true;
    },
    select: async () => undefined,
    exec: async (request) => {
      const shell = request.command === '/bin/sh' ? String(request.args[1] ?? '') : `${request.command} ${request.args.join(' ')}`;
      const kind = shell.startsWith('lint-cmd') ? 'lint' : shell.startsWith('test-cmd') ? 'test' : 'shell';
      runs.push({ kind, command: shell });
      if (kind === 'lint') return { stdout: options.lintExit === 0 ? '' : 'target.py:1: problem\n', stderr: '', code: options.lintExit ?? 1, killed: false };
      return { stdout: '', stderr: '', code: 0, killed: false };
    },
  };
  const lint = createValidation({
    host,
    root,
    autoLint: options.autoLint,
    autoTest: options.autoTest,
    lintCmds: options.lintCmd ? new Map([[null, options.lintCmd]]) : new Map(),
    testCmd: options.testCmd,
  });
  const controller = new ExchangeController(snapshot(root, [absRootPath(root, 'target.py')]), {
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
        filesContentGptEditsNoRepo: '',
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
  return { root, controller, runs, questions };
}

test('both passing checks produce no repair request', {
  meta: { evidence: ['ev-lint/orchestration/both-checks-pass'] },
}, async () => {
  const h = await followupHarness({ autoLint: true, autoTest: true, lintCmd: 'lint-cmd', testCmd: 'test-cmd', lintExit: 0 });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-pass', text: BASH_ONLY + PY_REPLY });
  expect(h.runs.map((run) => run.kind)).toEqual(['lint', 'shell', 'test']);
  expect(h.questions).not.toContain('Attempt to fix lint errors?');
  expect(h.questions).not.toContain('Attempt to fix test errors?');
  expect(decision.continue).toBe(false);
});

test('an accepted lint failure defers the shell and test follow-ups', {
  meta: { evidence: ['ev-lint/orchestration/accepted-lint-failure-defers-test'] },
}, async () => {
  const h = await followupHarness({ autoLint: true, autoTest: true, lintCmd: 'lint-cmd', testCmd: 'test-cmd', answer: () => true });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-lint', text: BASH_ONLY + PY_REPLY });
  expect(h.runs.map((run) => run.kind)).toEqual(['lint']);
  expect(h.questions).toContain('Attempt to fix lint errors?');
  expect(decision.continue).toBe(true);
  expect(decision.dialogue.some((fact) => fact.text.includes('target.py:1: problem'))).toBe(true);
});

test('a declined lint failure continues to the shell and test follow-ups', {
  meta: { evidence: ['ev-lint/orchestration/declined-lint-failure-runs-test'] },
}, async () => {
  const h = await followupHarness({ autoLint: true, autoTest: true, lintCmd: 'lint-cmd', testCmd: 'test-cmd', answer: (question) => question !== 'Attempt to fix lint errors?' });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-declined', text: BASH_ONLY + PY_REPLY });
  expect(h.runs.map((run) => run.kind)).toEqual(['lint', 'shell', 'test']);
  expect(decision.continue).toBe(false);
});

test('a reply with no edits runs suggested shell commands but no lint or test', {
  meta: { evidence: ['ev-lint/orchestration/no-edits-no-checks'] },
}, async () => {
  const h = await followupHarness({ autoLint: true, autoTest: true, lintCmd: 'lint-cmd', testCmd: 'test-cmd' });
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-shell', text: BASH_ONLY });
  expect(h.runs.map((run) => run.kind)).toEqual(['shell']);
  expect(h.runs[0]?.command).toBe('echo hi');
  expect(decision.continue).toBe(false);
});

test('automatic lint off runs the test follow-up while automatic test off still lints', {
  meta: { evidence: ['ev-lint/orchestration/disabled-lint-runs-test', 'ev-lint/orchestration/disabled-test-still-lints'] },
}, async () => {
  const noLint = await followupHarness({ autoLint: false, autoTest: true, lintCmd: 'lint-cmd', testCmd: 'test-cmd' });
  await noLint.controller.completeReply({ kind: 'complete', id: 'reply-no-lint', text: BASH_ONLY + PY_REPLY });
  expect(noLint.runs.map((run) => run.kind)).toEqual(['shell', 'test']);

  const noTest = await followupHarness({ autoLint: true, autoTest: false, lintCmd: 'lint-cmd', testCmd: 'test-cmd', answer: (question) => question !== 'Attempt to fix lint errors?' });
  await noTest.controller.completeReply({ kind: 'complete', id: 'reply-no-test', text: BASH_ONLY + PY_REPLY });
  expect(noTest.runs.map((run) => run.kind)).toEqual(['lint', 'shell']);
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
        filesContentGptEditsNoRepo: '',
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

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import type { CommandEnv } from '../../src/core/command.ts';
import type { Host } from '../../src/core/host.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type Validation } from '../../src/feature.ts';
import { lintCommands } from '../../src/lint/commands.ts';
import { lintFeature } from '../../src/lint/feature.ts';
import { formatRunOutput } from '../../src/lint/run-output.ts';
import { selectLintRelativeFiles } from '../../src/lint/select-files.ts';
import { createValidation } from '../../src/lint/validation.ts';
import { defined } from '../support/defined.ts';

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function initRepo(root: string): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  for (const args of [['init'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test']]) {
    const outcome = await isolatedExec({ command: 'git', args, cwd: root }, env);
    expect(outcome.code).toBe(0);
  }
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

function commandEnv(options: {
  readonly root: string;
  readonly host: Host;
  readonly editable?: string[];
  readonly lint?: Validation;
  readonly testCmd?: string | null;
  readonly lintCmds?: ReadonlyMap<string | null, string>;
  readonly gitRoot?: string | null;
  readonly messages?: string[];
}): CommandEnv {
  const messages = options.messages ?? [];
  return {
    host: options.host,
    snapshot: snapshot(
      options.root,
      (options.editable ?? []).map((path) => absRootPath(options.root, path)),
    ),
    save() {},
    tree: createWorkingTree({ notices: options.host }),
    git: {
      ...disabledGitPolicy,
      repoRoot: () => (options.gitRoot === undefined ? options.root : options.gitRoot),
    },
    map: disabledRepositoryContext,
    lint: options.lint ?? disabledValidation,
    testCmd: options.testCmd ?? null,
    lintCmds: options.lintCmds ?? new Map(),
    autoCommits: true,
    supportsImages: true,
    sendUserMessage: async (text) => {
      messages.push(text);
    },
    setPhysicalModel: async () => false,
    findPhysicalModel: () => null,
    defaultEditFormat: () => 'whole',
  };
}

function recordingHost(execImpl?: Host['exec']): { readonly host: Host; readonly outputs: string[]; readonly warnings: string[]; readonly errors: string[]; readonly confirms: { question: string; explicitYesRequired?: boolean }[] } {
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const confirms: { question: string; explicitYesRequired?: boolean }[] = [];
  return {
    outputs,
    warnings,
    errors,
    confirms,
    host: {
      output: (text) => outputs.push(text),
      warning: (text) => warnings.push(text),
      error: (text) => errors.push(text),
      confirm: async (request) => {
        confirms.push({ question: request.question, ...(request.explicitYesRequired !== undefined ? { explicitYesRequired: request.explicitYesRequired } : {}) });
        return true;
      },
      select: async () => undefined,
      exec:
        execImpl ??
        (async () => ({
          stdout: '',
          stderr: '',
          code: 0,
          killed: false,
        })),
    },
  };
}

test('lint feature registers /lint and /test slash commands', () => {
  expect(lintFeature.commands.map((command) => command.name).sort()).toEqual(['lint', 'test']);
});

test('selectLintRelativeFiles prefers explicit filenames, then chat files, then dirty files', () => {
  expect(selectLintRelativeFiles({ explicit: ['a.py'], chatFiles: ['b.py'], dirtyFiles: ['c.py'] })).toEqual(['a.py']);
  expect(selectLintRelativeFiles({ explicit: [], chatFiles: ['b.py'], dirtyFiles: ['c.py'] })).toEqual(['b.py']);
  expect(selectLintRelativeFiles({ explicit: [], chatFiles: [], dirtyFiles: ['c.py', 'd.py'] })).toEqual(['c.py', 'd.py']);
  expect(selectLintRelativeFiles({ explicit: [], chatFiles: [], dirtyFiles: [] })).toEqual([]);
});

test('/lint requires a repository and lints dirty files when chat is empty', { meta: { aider: ['test_commands/TestCommands.test_cmd_lint_with_dirty_file'] } }, async () => {
  const root = await tempRoot('lint-cmd-dirty-');
  await initRepo(root);
  await writeFile(join(root, 'dirty.py'), 'x = 1\n');
  const envBase = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  await isolatedExec({ command: 'git', args: ['add', 'dirty.py'], cwd: root }, envBase);
  await isolatedExec({ command: 'git', args: ['commit', '-m', 'add'], cwd: root }, envBase);
  await writeFile(join(root, 'dirty.py'), 'x = 2\n');

  const linted: string[] = [];
  const { host, errors, warnings } = recordingHost(async (request) => {
    if (request.command === 'git' && request.args[0] === 'diff') {
      const cached = request.args.includes('--cached');
      return { stdout: cached ? '' : 'dirty.py\n', stderr: '', code: 0, killed: false };
    }
    if (request.command === '/bin/sh') {
      linted.push(String(request.args[1]));
      return { stdout: '', stderr: '', code: 0, killed: false };
    }
    return { stdout: '', stderr: '', code: 0, killed: false };
  });
  const lint = createValidation({
    host,
    root,
    autoLint: true,
    autoTest: false,
    lintCmds: new Map([[null, 'echo-lint']]),
    testCmd: null,
  });
  const env = commandEnv({ root, host, lint, lintCmds: new Map([[null, 'echo-lint']]), editable: [] });
  const run = lintCommands.find((command) => command.name === 'lint');
  await defined(run).run('', env);
  expect(errors).toEqual([]);
  expect(warnings).toEqual([]);
  expect(linted.some((command) => command.includes('dirty.py'))).toBe(true);

  const noRepo = recordingHost();
  await defined(run).run(
    '',
    commandEnv({
      root,
      host: noRepo.host,
      gitRoot: null,
      lint,
      lintCmds: new Map([[null, 'echo-lint']]),
    }),
  );
  expect(noRepo.errors).toEqual(['No git repository found.']);
});

test('/lint uses explicit filenames before chat files', async () => {
  const root = await tempRoot('lint-cmd-explicit-');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.py'), 'a\n');
  await writeFile(join(root, 'b.py'), 'b\n');
  const linted: string[] = [];
  const { host } = recordingHost(async (request) => {
    if (request.command === '/bin/sh') {
      linted.push(String(request.args[1]));
      return { stdout: '', stderr: '', code: 0, killed: false };
    }
    return { stdout: '', stderr: '', code: 0, killed: false };
  });
  const lintCmds = new Map<string | null, string>([[null, 'true']]);
  const lint = createValidation({ host, root, autoLint: true, autoTest: false, lintCmds, testCmd: null });
  const run = lintCommands.find((command) => command.name === 'lint');
  await defined(run).run(
    'a.py',
    commandEnv({
      root,
      host,
      editable: ['b.py'],
      lint,
      lintCmds,
    }),
  );
  expect(linted).toHaveLength(1);
  expect(linted[0]).toContain('a.py');
  expect(linted[0]).not.toContain('b.py');
});

test('/test with neither argument nor configured command is a silent noop', { meta: { evidence: ['ev-lint/probe/no-test-command-noop'] } }, async () => {
  let execCount = 0;
  const { host, outputs, errors } = recordingHost(async () => {
    execCount += 1;
    return { stdout: '', stderr: '', code: 0, killed: false };
  });
  const messages: string[] = [];
  const lint = createValidation({ host, root: '/tmp', autoLint: false, autoTest: false, lintCmds: new Map(), testCmd: null });
  const run = lintCommands.find((command) => command.name === 'test');
  await defined(run).run('', commandEnv({ root: '/tmp', host, lint, testCmd: null, messages }));
  expect(execCount).toBe(0);
  expect(outputs).toEqual([]);
  expect(errors).toEqual([]);
  expect(messages).toEqual([]);
});

test('/test runs the configured command and on failure adds repair output to chat', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_test_returns_output_on_failure'],
    evidence: ['ev-lint/probe/test-failure-output-in-chat', 'ev-lint/probe/test-success-output-not-in-chat'],
  },
}, async () => {
  const root = await tempRoot('lint-cmd-test-');
  const messages: string[] = [];
  const { host, outputs } = recordingHost(async () => ({
    stdout: '',
    stderr: 'error output\n',
    code: 1,
    killed: false,
  }));
  const lint = createValidation({
    host,
    root,
    autoLint: false,
    autoTest: false,
    lintCmds: new Map(),
    testCmd: "echo 'error output' >&2 && exit 1",
  });
  const run = lintCommands.find((command) => command.name === 'test');
  await defined(run).run('', commandEnv({ root, host, lint, testCmd: "echo 'error output' >&2 && exit 1", messages }));
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('error output');
  expect(messages[0]).toBe(formatRunOutput("echo 'error output' >&2 && exit 1", 'error output\n'));
  expect(outputs.some((line) => line.startsWith('Added ') && line.includes('of output to the chat.'))).toBe(true);

  const okMessages: string[] = [];
  const okHost = recordingHost(async () => ({ stdout: 'ok\n', stderr: '', code: 0, killed: false }));
  const okLint = createValidation({
    host: okHost.host,
    root,
    autoLint: false,
    autoTest: false,
    lintCmds: new Map(),
    testCmd: 'true',
  });
  await defined(run).run('', commandEnv({ root, host: okHost.host, lint: okLint, testCmd: 'true', messages: okMessages }));
  expect(okMessages).toEqual([]);
});

test('runSuggestedShell confirms each block, skips comments, and offers add-output-to-chat', { meta: { aider: ['base_coder.py:2434-2485'] } }, async () => {
  const root = await tempRoot('lint-shell-approve-');
  const ran: string[] = [];
  const { host, confirms, outputs } = recordingHost(async (request) => {
    if (request.command === '/bin/sh') {
      ran.push(String(request.args[1]));
      return { stdout: `out:${request.args[1]}\n`, stderr: '', code: 0, killed: false };
    }
    return { stdout: '', stderr: '', code: 0, killed: false };
  });
  const lint = createValidation({
    host,
    root,
    autoLint: false,
    autoTest: false,
    lintCmds: new Map(),
    testCmd: null,
  });
  const outcome = await lint.runSuggestedShell(['# comment\necho one\necho two']);
  expect(confirms[0]).toEqual({ question: 'Run shell commands?', explicitYesRequired: true });
  expect(confirms.some((entry) => entry.question === 'Add command output to the chat?')).toBe(true);
  expect(ran).toEqual(['echo one', 'echo two']);
  expect(outcome).toEqual({
    kind: 'ran',
    output: 'Output from echo one\nout:echo one\n\nOutput from echo two\nout:echo two\n\n',
  });
  expect(outputs.some((line) => /^Added \d+ lines of output to the chat\.$/.test(line))).toBe(true);

  const single = recordingHost(async () => ({ stdout: 'hi\n', stderr: '', code: 0, killed: false }));
  const singleLint = createValidation({
    host: single.host,
    root,
    autoLint: false,
    autoTest: false,
    lintCmds: new Map(),
    testCmd: null,
  });
  await singleLint.runSuggestedShell(['echo hi']);
  expect(single.confirms[0]?.question).toBe('Run shell command?');
  expect(single.confirms[0]?.explicitYesRequired).toBe(true);
});

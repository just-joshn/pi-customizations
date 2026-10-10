import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import type { Host } from '../../src/core/host.ts';
import { lintFile, relativeLintName } from '../../src/lint/linter.ts';
import { lintOptions } from '../../src/lint/options.ts';
import { runLintTestOneshot } from '../../src/lint/oneshot.ts';
import { createValidation } from '../../src/lint/validation.ts';

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

function hostStub(overrides: Partial<Host> = {}): Host {
  return {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => false,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    ...overrides,
  };
}

test(
  '--lint and --test are boolean oneshot startup flags; --test-cmd remains the command string',
  {
    meta: {
      aider: ['test_main/TestMain.test_lint_option', 'args.py:526-565'],
      evidence: ['ev-lint/oneshot/test-exit'],
    },
  },
  () => {
    expect(lintOptions.lint.kind).toBe('boolean');
    expect(lintOptions.lint.defaultValue).toBe(false);
    expect(lintOptions.lint.negatable).toBe(false);
    expect(lintOptions.test.kind).toBe('boolean');
    expect(lintOptions.test.defaultValue).toBe(false);
    expect(lintOptions.test.negatable).toBe(false);
    expect(lintOptions.testCmd.kind).toBe('string');
    expect(lintOptions.testCmd.defaultValue).toBeNull();
  },
);

test('startup --test without --test-cmd exits 1 before running tests', async () => {
  const errors: string[] = [];
  let ranTest = false;
  const result = await runLintTestOneshot({
    lint: false,
    test: true,
    testCmd: null,
    runLintWorkflow: async () => {},
    runTestCommand: async () => {
      ranTest = true;
      return { childFailed: false, repairText: null };
    },
    error: (msg) => errors.push(msg),
    placeholder: null,
  });
  expect(result).toEqual({ kind: 'exit', status: 1 });
  expect(errors).toEqual(['No --test-cmd provided.']);
  expect(ranTest).toBe(false);
});

test('startup --lint runs the lint workflow then exits 0 before optional commit', async () => {
  const order: string[] = [];
  const result = await runLintTestOneshot({
    lint: true,
    test: false,
    testCmd: null,
    runLintWorkflow: async () => {
      order.push('lint');
    },
    runTestCommand: async () => {
      order.push('test');
      return { childFailed: false, repairText: null };
    },
    error: () => {},
    placeholder: null,
  });
  expect(result).toEqual({ kind: 'exit', status: 0 });
  expect(order).toEqual(['lint']);
});

test(
  'startup --test ignores repair feedback for model fixing unless placeholder is set; child failure is not process exit status',
  {
    meta: {
      aider: ['main.py:1053-1073,1272-1274'],
      evidence: ['ev-lint/oneshot/test-exit'],
    },
  },
  async () => {
    const fixing: string[] = [];
    const result = await runLintTestOneshot({
      lint: false,
      test: true,
      testCmd: 'printf known-test-failure; exit 7',
      runLintWorkflow: async () => {},
      runTestCommand: async (cmd) => {
        expect(cmd).toBe('printf known-test-failure; exit 7');
        return { childFailed: true, repairText: 'I ran this test command, which failed:\n\nprintf known-test-failure; exit 7\n' };
      },
      error: () => {},
      placeholder: null,
      runPlaceholder: async (text) => {
        fixing.push(text);
      },
    });
    expect(result).toEqual({ kind: 'exit', status: 0 });
    expect(fixing).toEqual([]);

    const withPlaceholder = await runLintTestOneshot({
      lint: false,
      test: true,
      testCmd: 'false',
      runLintWorkflow: async () => {},
      runTestCommand: async () => ({ childFailed: true, repairText: 'repair' }),
      error: () => {},
      placeholder: "What's wrong? Fix",
      runPlaceholder: async (text) => {
        fixing.push(text);
      },
    });
    expect(withPlaceholder).toEqual({ kind: 'exit', status: 0 });
    expect(fixing).toEqual(["What's wrong? Fix"]);
  },
);

test('lint and test CheckOutcome kinds distinguish clean, unsupported, unreadable, unavailable, and missing command', async () => {
  const root = await tempRoot('lint-ambiguous-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  await writeFile(join(root, 'notes.xyz'), 'plain\n');
  const errors: string[] = [];
  const host = hostStub({
    error: (msg) => errors.push(msg),
    exec: async (request) => {
      const shell = request.args[1] ?? '';
      if (shell.includes('boom')) throw new Error('exec unavailable');
      if (shell.includes('fail')) return { stdout: 'sample.py:1: err\n', stderr: '', code: 1, killed: false };
      return { stdout: '', stderr: '', code: 0, killed: false };
    },
  });

  const clean = await lintFile(join(root, 'sample.py'), {
    host,
    root,
    lintCmds: new Map([['python', 'ok-lint']]),
  });
  expect(clean).toEqual({ kind: 'clean' });

  const unsupported = await lintFile(join(root, 'notes.xyz'), {
    host,
    root,
    lintCmds: new Map([[null, 'fail']]),
  });
  expect(unsupported).toEqual({ kind: 'unsupported' });

  const unreadable = await lintFile(join(root, 'missing.py'), {
    host,
    root,
    lintCmds: new Map([['python', 'ok-lint']]),
  });
  expect(unreadable.kind).toBe('unreadable');
  expect(errors.some((msg) => msg.includes('Unable to read'))).toBe(true);

  const unavailable = await lintFile(join(root, 'sample.py'), {
    host,
    root,
    lintCmds: new Map([['python', 'boom']]),
  });
  expect(unavailable.kind).toBe('unavailable');

  const failed = await lintFile(join(root, 'sample.py'), {
    host,
    root,
    lintCmds: new Map([['python', 'fail']]),
  });
  expect(failed.kind).toBe('failed');
  if (failed.kind === 'failed') expect(failed.report).toContain('sample.py:1: err');

  const validation = createValidation({
    host,
    root,
    autoLint: true,
    autoTest: true,
    lintCmds: new Map([['python', 'ok-lint']]),
    testCmd: null,
  });
  expect(await validation.lintEdited(new Set(['notes.xyz']))).toEqual({ kind: 'not-run' });
  expect(await validation.lintEdited(new Set(['sample.py']))).toEqual({ kind: 'passed' });
  expect(await validation.testEdited()).toEqual({ kind: 'not-run' });

  const withTest = createValidation({
    host: hostStub({
      exec: async () => ({ stdout: 'ok\n', stderr: '', code: 0, killed: false }),
    }),
    root,
    autoLint: false,
    autoTest: true,
    lintCmds: new Map(),
    testCmd: 'true',
  });
  expect(await withTest.testEdited()).toEqual({ kind: 'passed' });
});

test(
  'relativeLintName with null root preserves the incoming path object (Aider get_rel_fname quirk)',
  {
    meta: {
      aider: ['test_linter/TestLinter.test_get_rel_fname', 'linter.py:21-80,80-116'],
      evidence: ['ev-lint/probe/python-root-path', 'ev-lint/probe/python-root-path~2'],
    },
  },
  () => {
    const pathObj = { toString: () => '/abs/file.py' };
    expect(relativeLintName(pathObj, null)).toBe(pathObj);
    expect(relativeLintName('/repo/src/a.py', '/repo')).toBe('src/a.py');
  },
);

test('custom lint command that rewrites the file leaves repair markers on initially read bytes', async () => {
  const root = await tempRoot('lint-stale-');
  const target = join(root, 'sample.py');
  await writeFile(target, 'line-one\nline-two\nline-three\n');
  const host = hostStub({
    exec: async (request) => {
      const shell = request.args[1] ?? '';
      if (shell.includes('mutate-lint')) {
        await writeFile(target, 'CHANGED\nCHANGED\nCHANGED\n');
        return { stdout: 'sample.py:2: error\n', stderr: '', code: 1, killed: false };
      }
      return { stdout: '', stderr: '', code: 0, killed: false };
    },
  });

  const outcome = await lintFile(target, {
    host,
    root,
    lintCmds: new Map([['python', 'mutate-lint']]),
  });
  expect(outcome.kind).toBe('failed');
  if (outcome.kind !== 'failed') return;
  expect(outcome.report).toContain('2█line-two');
  expect(outcome.report).not.toContain('2█CHANGED');
  expect(await readFile(target, 'utf8')).toBe('CHANGED\nCHANGED\nCHANGED\n');
});

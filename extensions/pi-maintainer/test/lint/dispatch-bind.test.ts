import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';
import type { Host } from '../../src/core/host.ts';
import { findFilenamesAndLinenums, lintFile } from '../../src/lint/linter.ts';
import { lintOptions } from '../../src/lint/options.ts';
import { parseLintCmds } from '../../src/lint/parse-lint-cmds.ts';
import { shellQuote } from '../../src/lint/shell.ts';
import { defined } from '../support/defined.ts';

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

function recordingHost(runs: string[]): Host {
  return {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => false,
    select: async () => undefined,
    exec: async (request) => {
      runs.push(`${request.command} ${request.args.join(' ')}`);
      const shell = request.args[1] ?? '';
      if (shell.includes('fail-lint')) {
        return { stdout: 'sample.py:2: error\n', stderr: '', code: 1, killed: false };
      }
      if (shell.includes('ok-lint')) {
        return { stdout: 'should be discarded\n', stderr: '', code: 0, killed: false };
      }
      if (shell.includes('unknown-bin')) {
        return { stdout: '', stderr: 'unknown-bin: not found\n', code: 127, killed: false };
      }
      return { stdout: '', stderr: '', code: 0, killed: false };
    },
  };
}

test('the linter reads UTF-8, dispatches Python, and reports paths relative to its root', {
  meta: { aider: ['test_linter/TestLinter.test_init'] },
}, async () => {
  const root = await tempRoot('lint-init-');
  await writeFile(join(root, 'café.py'), 'π = 1\n');
  const runs: string[] = [];
  const base = recordingHost(runs);
  const host = {
    ...base,
    exec: async (request: Parameters<Host['exec']>[0]) => {
      runs.push(`${request.command} ${request.args.join(' ')}`);
      return { stdout: 'café.py:1: bad\n', stderr: '', code: 1, killed: false };
    },
  };
  const outcome = await lintFile(join(root, 'café.py'), { host, root, lintCmds: new Map([['python', 'fail-lint']]) });
  expect(runs[0]).toContain(shellQuote('café.py'));
  expect(outcome.kind).toBe('failed');
  if (outcome.kind === 'failed') expect(outcome.report).toContain('1█π = 1');
});

test('parse_lint_cmds maps language prefixes, unprefixed None, strips, and last key wins', {
  meta: { aider: ['test_linter/TestLinter.test_set_linter'] },
}, () => {
  const mapped = parseLintCmds(['python: flake8', 'eslint', 'python: ruff ', 'javascript: eslint --fix', '']);
  expect([...mapped.entries()]).toEqual([
    ['python', 'ruff'],
    [null, 'eslint'],
    ['javascript', 'eslint --fix'],
  ]);
});

test('without explicit override, filename recognition precedes the global command', async () => {
  const root = await tempRoot('lint-prec-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  await writeFile(join(root, 'notes.xyz'), 'plain\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([
    [null, 'ok-lint'],
    ['python', 'lang-python'],
  ]);

  const py = await lintFile(join(root, 'sample.py'), { host, root, lintCmds });
  expect(py).toEqual({ kind: 'clean' });
  expect(runs.some((run) => run.includes('ok-lint') && run.includes('sample.py'))).toBe(true);
  expect(runs.some((run) => run.includes('lang-python'))).toBe(false);

  runs.length = 0;
  const skipped = await lintFile(join(root, 'notes.xyz'), { host, root, lintCmds });
  expect(skipped).toEqual({ kind: 'unsupported' });
  expect(runs).toEqual([]);
});

test('language-specific command is used when no global command is configured', async () => {
  const root = await tempRoot('lint-lang-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'ok-lint']]);

  expect(await lintFile(join(root, 'sample.py'), { host, root, lintCmds })).toEqual({ kind: 'clean' });
  expect(runs.some((run) => run.includes('ok-lint') && run.includes(shellQuote('sample.py')))).toBe(true);
});

test('unknown extensions produce no lint report under automatic and global-command dispatch', {
  meta: { evidence: ['ev-lint/probe/unknown-extension-skipped', 'ev-lint/probe/global-unknown-extension-skipped', 'ev-lint/probe/typescript-skipped'] },
}, async () => {
  const root = await tempRoot('lint-skip-');
  await writeFile(join(root, 'readme.md'), '# hi\n');
  await writeFile(join(root, 'broken.ts'), 'const x: = ;\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([[null, 'fail-lint']]);

  expect(await lintFile(join(root, 'readme.md'), { host, root, lintCmds })).toEqual({ kind: 'unsupported' });
  expect(runs).toEqual([]);

  expect(await lintFile(join(root, 'readme.md'), { host, root, lintCmds: new Map() })).toEqual({ kind: 'unsupported' });
  expect(await lintFile(join(root, 'broken.ts'), { host, root, lintCmds: new Map([['python', 'fail-lint']]) })).toEqual({ kind: 'unsupported' });
  expect(runs).toEqual([]);
});

test('custom lint appends one oslex-quoted relative path and discards exit-zero output', {
  meta: {
    aider: ['test_linter/TestLinter.test_run_cmd'],
    evidence: ['ev-lint/probe/custom-success-output-discarded', 'ev-lint/probe/custom-failure-diagnostic', 'ev-lint/probe/custom-failure-empty-output'],
  },
}, async () => {
  const root = await tempRoot('lint-append-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'ok-lint --strict']]);

  expect(await lintFile(join(root, 'sample.py'), { host, root, lintCmds })).toEqual({ kind: 'clean' });
  const shell = runs[0] ?? '';
  expect(shell).toContain(`ok-lint --strict ${shellQuote('sample.py')}`);
  expect(shell).not.toContain('should be discarded');
});

test('nonzero custom lint output becomes diagnostic context with extracted lines', {
  meta: {
    aider: ['test_linter/TestLinter.test_run_cmd', 'test_linter/TestLinter.test_run_cmd_with_errors', 'test_linter/TestLinter.test_run_cmd_with_special_chars'],
    evidence: ['ev-lint/probe/custom-failure-diagnostic'],
  },
}, async () => {
  const root = await tempRoot('lint-diag-');
  await writeFile(join(root, 'sample.py'), 'a\nb\nc\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'fail-lint']]);

  const outcome = await lintFile(join(root, 'sample.py'), { host, root, lintCmds });
  expect(outcome.kind).toBe('failed');
  if (outcome.kind !== 'failed') return;
  expect(outcome.report).toContain('# Fix any errors below, if possible.');
  expect(outcome.report).toContain('## Running: fail-lint');
  expect(outcome.report).toContain('sample.py:2: error');
  expect(outcome.report).toContain('## See relevant line below marked with █.');
  expect(outcome.report).toContain('2█b');

  const special = 'src/(main)/product/[id]/page.tsx';
  const specialRoot = await tempRoot('lint-special-');
  await mkdir(join(specialRoot, 'src', '(main)', 'product', '[id]'), { recursive: true });
  await writeFile(join(specialRoot, special), 'x\n');
  const specialRuns: string[] = [];
  const specialHost = recordingHost(specialRuns);
  const specialOutcome = await lintFile(join(specialRoot, special), { host: specialHost, root: specialRoot, lintCmds: new Map([[null, 'fail-lint']]) });
  expect(specialRuns[0]).toContain(shellQuote(special));
  expect(specialOutcome).toMatchObject({ kind: 'failed' });
  if (specialOutcome.kind === 'failed') expect(specialOutcome.report).toContain('sample.py:2: error');

  const emptyRoot = await tempRoot('lint-empty-');
  await writeFile(join(emptyRoot, 'valid.py'), 'x = 1\n');
  const emptyRuns: string[] = [];
  const emptyHost = recordingHost(emptyRuns);
  const emptyHostWithEmptyFailure = {
    ...emptyHost,
    exec: async (request: Parameters<Host['exec']>[0]) => {
      emptyRuns.push(`${request.command} ${request.args.join(' ')}`);
      return { stdout: '', stderr: '', code: 7, killed: false };
    },
  };
  const emptyOutcome = await lintFile(join(emptyRoot, 'valid.py'), { host: emptyHostWithEmptyFailure, root: emptyRoot, lintCmds: new Map([[null, 'fail-empty']]) });
  expect(emptyOutcome.kind).toBe('failed');
  if (emptyOutcome.kind === 'failed') expect(emptyOutcome.report).toContain(`## Running: fail-empty ${shellQuote('valid.py')}`);
});
test('find_filenames_and_linenums extracts one-based line sets with word-boundary filename matches', {
  meta: { evidence: ['ev-lint/probe/diagnostic-line-extraction'] },
}, () => {
  const text = 'ignore sample.pyx:9\nsample.py:2: err\nsample.py:4: other\nother.py:3: skip\n';
  const found = findFilenamesAndLinenums(text, ['sample.py']);
  expect([...defined(found.get('sample.py'))].sort((a, b) => a - b)).toEqual([2, 4]);
  expect(found.has('other.py')).toBe(false);
  const probe = findFilenamesAndLinenums('a.py:2: bad\na.py:2: bad\na.py:7: bad\nother.py:9: bad', ['a.py']);
  expect([...defined(probe.get('a.py'))].sort((a, b) => a - b)).toEqual([2, 7]);
});

test('explicit lint command bypasses unknown-file skipping and can still fail', {
  meta: { evidence: ['ev-lint/probe/explicit-unknown-command-fails-in-context-renderer'] },
}, async () => {
  const root = await tempRoot('lint-explicit-');
  await writeFile(join(root, 'notes.xyz'), 'plain\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>();

  const outcome = await lintFile(join(root, 'notes.xyz'), {
    host,
    root,
    lintCmds,
    explicitCmd: 'unknown-bin',
  });
  expect(runs.some((run) => run.includes('unknown-bin') && run.includes(shellQuote('notes.xyz')))).toBe(true);
  expect(outcome.kind).toBe('failed');
  if (outcome.kind !== 'failed') return;
  expect(outcome.report).toContain('# Fix any errors below, if possible.');
  expect(outcome.report).toContain('## Running: unknown-bin');
  expect(outcome.report).toContain('unknown-bin: not found');
});

test('--lint is a boolean one-shot flag and language checkers use --lint-cmd', () => {
  expect(lintOptions.lint.kind).toBe('boolean');
  expect(lintOptions.lint.negatable).toBe(false);
  expect(lintOptions.lint.defaultValue).toBe(false);
  expect(lintOptions.lintCmd.kind).toBe('list');
  expect(lintOptions.lintCmd.name).toBe('lint-cmd');

  const guidePath = fileURLToPath(new URL('../../docs/usage/lint-test.md', import.meta.url));
  const guide = readFileSync(guidePath, 'utf8');
  expect(guide).toContain('`--lint`');
  expect(guide).toContain('`--lint-cmd "language: command"`');
  expect(guide).not.toMatch(/--lint\s+"language:/);
});

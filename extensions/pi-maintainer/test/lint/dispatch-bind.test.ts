import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

import type { Host } from '../../src/core/host.ts';
import { findFilenamesAndLinenums, lintFile } from '../../src/lint/linter.ts';
import { lintOptions } from '../../src/lint/options.ts';
import { parseLintCmds } from '../../src/lint/parse-lint-cmds.ts';
import { shellQuote } from '../../src/lint/shell.ts';

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

test('parse_lint_cmds maps language prefixes, unprefixed None, strips, and last key wins', () => {
  const mapped = parseLintCmds([
    'python: flake8',
    'eslint',
    'python: ruff ',
    'javascript: eslint --fix',
    '',
  ]);
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
  expect(py).toBeNull();
  expect(runs.some((run) => run.includes('ok-lint') && run.includes('sample.py'))).toBe(true);
  expect(runs.some((run) => run.includes('lang-python'))).toBe(false);

  runs.length = 0;
  const skipped = await lintFile(join(root, 'notes.xyz'), { host, root, lintCmds });
  expect(skipped).toBeNull();
  expect(runs).toEqual([]);
});

test('language-specific command is used when no global command is configured', async () => {
  const root = await tempRoot('lint-lang-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'ok-lint']]);

  expect(await lintFile(join(root, 'sample.py'), { host, root, lintCmds })).toBeNull();
  expect(runs.some((run) => run.includes('ok-lint') && run.includes(shellQuote('sample.py')))).toBe(true);
});

test('unknown extensions produce no lint report under automatic and global-command dispatch', async () => {
  const root = await tempRoot('lint-skip-');
  await writeFile(join(root, 'readme.md'), '# hi\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([[null, 'fail-lint']]);

  expect(await lintFile(join(root, 'readme.md'), { host, root, lintCmds })).toBeNull();
  expect(runs).toEqual([]);
});

test('custom lint appends one oslex-quoted relative path and discards exit-zero output', async () => {
  const root = await tempRoot('lint-append-');
  await writeFile(join(root, 'sample.py'), 'x = 1\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'ok-lint --strict']]);

  expect(await lintFile(join(root, 'sample.py'), { host, root, lintCmds })).toBeNull();
  const shell = runs[0] ?? '';
  expect(shell).toContain(`ok-lint --strict ${shellQuote('sample.py')}`);
  expect(shell).not.toContain('should be discarded');
});

test('nonzero custom lint output becomes diagnostic context with extracted lines', async () => {
  const root = await tempRoot('lint-diag-');
  await writeFile(join(root, 'sample.py'), 'a\nb\nc\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>([['python', 'fail-lint']]);

  const report = await lintFile(join(root, 'sample.py'), { host, root, lintCmds });
  expect(report).toContain('# Fix any errors below, if possible.');
  expect(report).toContain('## Running: fail-lint');
  expect(report).toContain('sample.py:2: error');
  expect(report).toContain('## See relevant line below marked with █.');
  expect(report).toContain('2█b');
});

test('find_filenames_and_linenums extracts one-based line sets with word-boundary filename matches', () => {
  const text = 'ignore sample.pyx:9\nsample.py:2: err\nsample.py:4: other\nother.py:3: skip\n';
  const found = findFilenamesAndLinenums(text, ['sample.py']);
  expect([...found.get('sample.py')!].sort((a, b) => a - b)).toEqual([2, 4]);
  expect(found.has('other.py')).toBe(false);
});

test('explicit lint command bypasses unknown-file skipping and can still fail', async () => {
  const root = await tempRoot('lint-explicit-');
  await writeFile(join(root, 'notes.xyz'), 'plain\n');
  const runs: string[] = [];
  const host = recordingHost(runs);
  const lintCmds = new Map<string | null, string>();

  const report = await lintFile(join(root, 'notes.xyz'), {
    host,
    root,
    lintCmds,
    explicitCmd: 'unknown-bin',
  });
  expect(runs.some((run) => run.includes('unknown-bin') && run.includes(shellQuote('notes.xyz')))).toBe(true);
  expect(report).toContain('# Fix any errors below, if possible.');
  expect(report).toContain('## Running: unknown-bin');
  expect(report).toContain('unknown-bin: not found');
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

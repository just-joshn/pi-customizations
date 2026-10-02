import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const run = promisify(execFile);
const script = new URL('../scripts/check-native-parity.mjs', import.meta.url).pathname;
const testFile = new URL('./parity-contracts.test.ts', import.meta.url).pathname;
const source = '## Native behavior\nRequired contract.\n';
const present = { type: 'quote', path: 'src/workers.ts', quote: 'registerWorkers(pi: ExtensionAPI)' };
const clause = { id: 'L2.1', lines: [2, 2], requirement: 'Required contract.', kind: 'behavior', verdict: 'verified', checks: [present] };

async function gate(clauses: unknown[], extra: string[] = [], report?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-parity-gate-'));
  try {
    const reference = join(directory, 'reference.md');
    await writeFile(reference, source);
    await mkdir(join(directory, 'parity/clauses'), { recursive: true });
    await writeFile(join(directory, 'parity/reference.json'), JSON.stringify({ source: reference, sha256: createHash('sha256').update(source).digest('hex'), slices: [{ id: 's1', from: 1, to: 3 }] }));
    await writeFile(join(directory, 'parity/clauses/s1.json'), JSON.stringify(clauses));
    const args = [script, '--parity', join(directory, 'parity'), ...extra];
    if (report) {
      await writeFile(join(directory, 'report.json'), JSON.stringify(report));
      args.push('--report', join(directory, 'report.json'));
    }
    return await run(process.execPath, args).then(
      ({ stdout }) => ({ code: 0, stdout }),
      (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const passing = (status: string) => ({ testResults: [{ name: testFile, assertionResults: [{ fullName: 'a verified behavior clause with a native check has no findings', status }] }] });
const testCheck = { type: 'test', path: 'test/parity-contracts.test.ts', name: 'a verified behavior clause with a native check has no findings' };

test('a fully covered clause whose quote exists in a native file passes', async () => {
  expect(await gate([clause])).toEqual({ code: 0, stdout: '1 clauses in 1 slices (verified 1). 0 findings.\n' });
});

test('a quote absent from the cited native file fails the gate', async () => {
  const result = await gate([{ ...clause, checks: [{ ...present, quote: 'this sentence is not in workers' }] }]);
  expect(result).toEqual({ code: 1, stdout: '1 clauses in 1 slices (verified 1). 1 findings.\nL2.1 quote not found in src/workers.ts: "this sentence is not in workers"\n' });
});

test('a reference line without a clause fails the gate', async () => {
  expect((await gate([])).stdout).toContain('s1 leaves 1 reference lines without a clause: 2.');
});

test('upstream text cannot stand in for native evidence', async () => {
  const result = await gate([{ ...clause, checks: [{ type: 'quote', path: 'upstream/skills/poteto-mode/SKILL.md', quote: 'disable-model-invocation: true' }] }]);
  expect(result.stdout).toContain('L2.1 quote check cites non-native upstream/skills/poteto-mode/SKILL.md.');
});

test('an external-service clause keeps the gate failing with its reason', async () => {
  const result = await gate([{ ...clause, verdict: 'external', note: 'Needs a live Slack workspace.' }]);
  expect(result).toMatchObject({ code: 1, stdout: expect.stringContaining('L2.1 is external: Needs a live Slack workspace.') });
});

test('an external-service clause stops blocking when the caller allows externals', async () => {
  const result = await gate([{ ...clause, verdict: 'external', note: 'Needs a live Slack workspace.' }], ['--allow-external']);
  expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('L2.1 is external: Needs a live Slack workspace.') });
});

test('a gap still blocks when the caller allows externals', async () => {
  const result = await gate([{ ...clause, verdict: 'gap', note: 'GAP: missing. FIX: add it.' }], ['--allow-external']);
  expect(result.code).toBe(1);
});

test('a test check passes only when the named test passed in the report', async () => {
  const withTest = { ...clause, runtime: true, checks: [present, testCheck] };
  expect((await gate([withTest], [], passing('passed'))).code).toBe(0);
  expect((await gate([withTest], [], passing('failed'))).stdout).toContain('L2.1 test did not pass: test/parity-contracts.test.ts > a verified behavior clause with a native check has no findings');
});

test('a commit check must name a commit that exists with the cited subject', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'pstack-parity-repo-'));
  try {
    await run('git', ['-C', repo, 'init', '-q']);
    await run('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'feat: original subject']);
    const { stdout } = await run('git', ['-C', repo, 'rev-parse', 'HEAD']);
    const fact = { ...clause, kind: 'fact', checks: [{ type: 'commit', repo, rev: stdout.trim(), subject: 'original subject' }] };
    expect((await gate([fact])).code).toBe(0);
    expect((await gate([{ ...fact, checks: [{ ...fact.checks[0], subject: 'rewritten' }] }])).stdout).toContain(`L2.1 commit ${stdout.trim()} with subject "rewritten" not found.`);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a bun test check reads the shipped helper suite results', async () => {
  const helper = { type: 'test', runner: 'bun', path: 'skills/poteto-mode/scripts/orch/orch.test.ts', name: 'Store initializes an idempotent plain-file store and releases its lock' };
  const withHelper = { ...clause, runtime: true, checks: [present, helper] };
  expect((await gate([withHelper])).code).toBe(0);
  expect((await gate([{ ...withHelper, checks: [present, { ...helper, name: 'Store invents a feature' }] }])).stdout).toContain('L2.1 test did not pass: skills/poteto-mode/scripts/orch/orch.test.ts > Store invents a feature');
}, 60000);

test('file and source-file checks require the file in the matching location', async () => {
  const fact = { ...clause, kind: 'fact', checks: [{ type: 'source-file', path: 'upstream/LICENSE' }] };
  expect((await gate([fact])).code).toBe(0);
  expect((await gate([{ ...fact, checks: [{ type: 'source-file', path: 'upstream/MISSING' }] }])).stdout).toContain('L2.1 cites missing file upstream/MISSING.');
  expect((await gate([{ ...clause, checks: [{ type: 'file', path: 'upstream/LICENSE' }] }])).stdout).toContain('L2.1 file check cites non-native upstream/LICENSE.');
});

test('a bun test check under test/helpers reads that file and only that file', async () => {
  const native = { type: 'test', runner: 'bun', path: 'test/helpers/overlays.test.ts', name: 'every helper overlay edit is present in the shipped helper file' };
  const withNative = { ...clause, runtime: true, checks: [present, native] };
  expect((await gate([withNative])).code).toBe(0);
  expect((await gate([{ ...withNative, checks: [present, { ...native, name: 'no such overlay test' }] }])).stdout).toContain('L2.1 test did not pass: test/helpers/overlays.test.ts > no such overlay test');
}, 60000);

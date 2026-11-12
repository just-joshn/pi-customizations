import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { type MiniRoot, miniRoot, PKG } from './helpers.ts';

let mini: MiniRoot;
let fakeBin = '';
afterEach(() => {
  mini?.cleanup();
  if (fakeBin) rmSync(fakeBin, { recursive: true, force: true });
  fakeBin = '';
});

const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: mini.root, encoding: 'utf8' });
const commitAll = (message: string) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

const complete = (tests: Record<string, string>, over: Record<string, unknown> = {}) => {
  const count = (s: string) => Object.values(tests).filter((v) => v === s).length;
  return {
    success: count('failed') === 0,
    startTime: 1_700_000_000_000,
    numTotalTestSuites: 1,
    numTotalTests: Object.keys(tests).length,
    numPassedTests: count('passed'),
    numFailedTests: count('failed'),
    numPendingTests: count('skipped'),
    testResults: [{ name: 'tests/t.test.ts', status: count('failed') ? 'failed' : 'passed', assertionResults: Object.entries(tests).map(([fullName, status]) => ({ fullName, status })) }],
    ...over,
  };
};

interface Fake {
  report?: unknown;
  rawReport?: string;
  exit?: number;
  signal?: boolean;
  touchWhileRunning?: string;
}

/** `npx vitest run --reporter=json --outputFile=<path>` replaced by a script that writes the given report and exits as told. */
function build(fake: Fake, ...extra: string[]) {
  fakeBin ||= mkdtempSync(join(tmpdir(), 'pstack-fake-npx-'));
  const reportFile = join(fakeBin, 'report.json');
  if (fake.rawReport !== undefined) writeFileSync(reportFile, fake.rawReport);
  else if (fake.report !== undefined) writeFileSync(reportFile, JSON.stringify(fake.report));
  const hasReport = fake.report !== undefined || fake.rawReport !== undefined;
  writeFileSync(
    join(fakeBin, 'npx'),
    `#!/bin/sh
for a in "$@"; do case "$a" in --outputFile=*) out="\${a#--outputFile=}";; esac; done
${hasReport ? `cp '${reportFile}' "$out"` : ''}
${fake.touchWhileRunning ? `echo changed >> '${join(mini.root, fake.touchWhileRunning)}'` : ''}
${fake.signal ? 'kill -9 $$' : ''}
exit ${fake.exit ?? 0}
`,
  );
  chmodSync(join(fakeBin, 'npx'), 0o755);
  const r = spawnSync(process.execPath, [join(PKG, 'scripts/build-parity-manifest.mjs'), '--root', mini.root, '--no-docs', ...extra], { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env['PATH']}` } });
  return { status: r.status, stderr: r.stderr };
}
const gate = () => {
  const r = spawnSync(process.execPath, [join(PKG, 'scripts/check-release.mjs'), '--root', mini.root], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
};
const manifestPath = () => join(mini.root, 'generated/parity-manifest.json');
const manifest = () => JSON.parse(readFileSync(manifestPath(), 'utf8'));
const saved = () => join(mini.root, 'parity-results/local/vitest.json');
const importReport = () => spawnSync(process.execPath, [join(PKG, 'scripts/build-parity-manifest.mjs'), '--root', mini.root, '--no-docs', '--results', saved()], { encoding: 'utf8' });
const passing = { 'suite passes': 'passed' };

const repo = () => {
  mini = miniRoot();
  execFileSync('git', ['init', '-q'], { cwd: mini.root });
  commitAll('revision A');
};

describe('a report is attributed to the code it ran against, never to the checkout that imports it', () => {
  test('a run at A saved with its sidecar opens the gate at A', () => {
    repo();
    expect(build({ report: complete(passing) }, '--save', saved()).status).toBe(0);
    expect(existsSync(saved().replace(/\.json$/, '.identity.json'))).toBe(true);
    expect(gate().status, gate().stderr).toBe(0);
  });

  test('the saved report and sidecar imported at the same revision still open the gate', () => {
    repo();
    build({ report: complete(passing) }, '--save', saved());
    rmSync(manifestPath());
    const r = importReport();
    expect(r.status, r.stderr).toBe(0);
    expect(manifest().runs[0]).toMatchObject({ resultsSource: 'local', dirty: false });
    expect(gate().status, gate().stderr).toBe(0);
  });

  test('an A report imported at B without its sidecar cannot open the gate', () => {
    repo();
    build({ report: complete(passing) }, '--save', saved());
    rmSync(saved().replace(/\.json$/, '.identity.json'));
    mini.write('tests/t.test.ts', '// revision B');
    commitAll('revision B');
    const r = importReport();
    expect(r.status, r.stderr).toBe(0);
    expect(manifest().runs[0]).toMatchObject({ commit: null, sourceDigest: null, platform: null });
    const g = gate();
    expect(g.status).toBe(1);
    expect(g.stderr).toContain('no source digest recorded');
  });

  test('the sidecar from A imported at B is stale', () => {
    repo();
    build({ report: complete(passing) }, '--save', saved());
    mini.write('tests/t.test.ts', '// revision B');
    commitAll('revision B');
    const r = importReport();
    expect(r.status, r.stderr).toBe(0);
    const g = gate();
    expect(g.status).toBe(1);
    expect(g.stderr).toContain('stale, it ran against code that has since changed');
  });

  test('a run on a tree with uncommitted changes is recorded dirty and the gate rejects it', () => {
    repo();
    mini.write('tests/t.test.ts', '// uncommitted');
    expect(build({ report: complete(passing) }).status).toBe(0);
    const g = gate();
    expect(g.status).toBe(1);
    expect(g.stderr).toContain('uncommitted changes');
  });

  test('a source file that appears while Vitest runs is not attributed to the revision', () => {
    repo();
    const r = build({ report: complete(passing), touchWhileRunning: 'tests/appeared.test.ts' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('tests/appeared.test.ts');
    expect(existsSync(manifestPath())).toBe(false);
  });

  test('a result file a test writes under parity-results while Vitest runs is a legitimate artifact', () => {
    repo();
    execFileSync('mkdir', ['-p', join(mini.root, 'parity-results/local')]);
    const r = build({ report: complete(passing), touchWhileRunning: 'parity-results/local/artifact.json' });
    expect(r.status, r.stderr).toBe(0);
  });

  test('code that changes while Vitest runs is not attributed to either revision', () => {
    repo();
    const r = build({ report: complete(passing), touchWhileRunning: 'tests/t.test.ts' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('the code changed while Vitest ran');
    expect(existsSync(manifestPath())).toBe(false);
  });
});

describe('a Vitest run is accepted only when it finished and reported completely', () => {
  const aborts: [string, Fake, string][] = [
    ['a signal', { report: complete(passing), signal: true }, 'killed by SIGKILL'],
    ['an exit other than 0 or 1', { report: complete(passing), exit: 2 }, 'Vitest exited 2'],
    ['no report', { exit: 0 }, 'wrote no JSON report'],
    ['a truncated report', { rawReport: JSON.stringify(complete(passing)).slice(0, 40) }, 'not valid JSON'],
    ['a report without numTotalTests', { report: { ...complete(passing), numTotalTests: undefined } }, 'incomplete'],
    ['a report with no tests', { report: complete({}) }, 'executed no tests'],
    ['a report listing fewer tests than it counts', { report: complete(passing, { numTotalTests: 3 }) }, 'lists 1 test(s) of 3'],
    ['success:false with exit 0', { report: complete(passing, { success: false }) }, 'exited 0 but its report records failures'],
    ['exit 0 with a failed test', { report: complete({ 'suite fails': 'failed' }) }, 'exited 0 but its report records failures'],
    ['exit 1 with success:false and no failure to name', { report: complete(passing, { success: false }), exit: 1 }, 'names no failed test'],
    ['exit 1 with a report that says success', { report: complete(passing), exit: 1 }, 'says it succeeded'],
    ['aggregate counts that contradict the listed statuses', { report: complete(passing, { numPassedTests: 0 }) }, 'counts 0 passed, 0 failed, 0 skipped but lists 1 passed, 0 failed, 0 skipped'],
    [
      'a skipped count with no skipped test listed',
      { report: complete({ 'suite passes': 'passed', 'suite skips': 'skipped' }, { numPassedTests: 2, numPendingTests: 0 }) },
      'counts 2 passed, 0 failed, 0 skipped but lists 1 passed, 0 failed, 1 skipped',
    ],
  ];
  test.each(aborts)('%s aborts the build and writes nothing', (_name, fake, message) => {
    repo();
    const r = build(fake, '--save', saved());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(existsSync(manifestPath())).toBe(false);
    expect(existsSync(saved())).toBe(false);
  });

  test('a report whose suite count includes describe blocks, as real Vitest reports do, is complete', () => {
    repo();
    const r = build({ report: complete(passing, { numTotalTestSuites: 3 }) });
    expect(r.status, r.stderr).toBe(0);
  });

  test('exit 1 with a complete report counts its failures and closes the gate', () => {
    repo();
    const r = build({ report: complete({ 'suite passes': 'passed', 'suite fails': 'failed' }), exit: 1 });
    expect(r.status, r.stderr).toBe(0);
    expect(manifest().runs[0]).toMatchObject({ failedTests: 1 });
    const g = gate();
    expect(g.status).toBe(1);
    expect(g.stderr).toContain('failed in the recorded run');
  });
});

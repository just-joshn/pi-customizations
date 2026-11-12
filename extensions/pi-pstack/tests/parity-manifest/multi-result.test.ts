import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { evaluate, mergeOutcomes, sourceDigest } from '../../scripts/parity-lib.mjs';
import { type MiniRoot, miniRoot, script, SKILL } from './helpers.ts';

let mini: MiniRoot;
afterEach(() => mini?.cleanup());

const linuxOnly = { id: 'BEH-LINUX', title: 'L', specSection: '15.1', source: { file: SKILL, lines: [3, 4], anchor: 'Stop at the line' }, observable: 'o', invariants: ['i'], piMechanism: 'm', dependencies: [], prerequisites: [], applicability: { mandatory: true }, platforms: ['linux'], verification: 'v', tests: ['pass'] };
const anywhere = { ...linuxOnly, id: 'BEH-ANY', platforms: undefined };

const report = (name: string, status: string) => ({ numTotalTests: 1, testResults: [{ name: 'tests/t.test.ts', status: 'passed', assertionResults: [{ fullName: name, status }] }] });
const record = (platforms?: string[]) => ({ id: 'R', kind: 'behavioral', applicability: { mandatory: true }, platforms, tests: [{ file: 'tests/t.test.ts', name: 't' }] });
const merged = (platforms: string[] | undefined, runs: [string, string][]) =>
  evaluate(
    [record(platforms)],
    runs.map(([platform, status]) => ({ report: report('t', status), identity: { platform } })),
    '/x',
  )[0]!;

describe('merging result files per test', () => {
  test('a skip on the host plus a pass on the targeted platform is PASS', () => {
    expect(merged(['linux'], [['darwin', 'skipped'], ['linux', 'passed']]).status).toBe('PASS');
  });

  test('a pass on a platform the requirement does not target does not count', () => {
    const r = merged(['linux'], [['darwin', 'passed']]);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.results[0]!.outcome).toBe('missing');
  });

  test('a skip on the targeted platform stays INCONCLUSIVE even beside a pass elsewhere', () => {
    expect(merged(['linux'], [['darwin', 'passed'], ['linux', 'skipped']]).status).toBe('INCONCLUSIVE');
  });

  test('a failure on any platform is FAIL, targeted or not', () => {
    expect(merged(['linux'], [['darwin', 'failed'], ['linux', 'passed']]).status).toBe('FAIL');
    expect(merged(['linux'], [['linux', 'failed'], ['darwin', 'passed']]).status).toBe('FAIL');
    expect(merged(undefined, [['darwin', 'passed'], ['linux', 'failed']]).status).toBe('FAIL');
  });

  test('a requirement without a target platform passes on any platform that ran the test', () => {
    expect(merged(undefined, [['darwin', 'passed'], ['linux', 'skipped']]).status).toBe('PASS');
  });

  test('each test merges on its own', () => {
    const two = { testResults: [{ name: 'tests/t.test.ts', status: 'passed', assertionResults: [{ fullName: 'a', status: 'passed' }, { fullName: 'b', status: 'skipped' }] }] };
    const linux = { testResults: [{ name: 'tests/t.test.ts', status: 'passed', assertionResults: [{ fullName: 'a', status: 'skipped' }, { fullName: 'b', status: 'passed' }] }] };
    const rec = { ...record(['linux']), tests: ['a', 'b'].map((name) => ({ file: 'tests/t.test.ts', name })) };
    const [r] = evaluate([rec], [{ report: two, identity: { platform: 'darwin' } }, { report: linux, identity: { platform: 'linux' } }], '/x');
    expect(r!.status).toBe('INCONCLUSIVE');
    expect(mergeOutcomes(rec, [{ platform: 'linux', outcome: 'passed' }])).toBe('passed');
  });
});

describe('the build script and the release gate with a CI result', () => {
  const setup = () => {
    mini = miniRoot({ behavioral: [linuxOnly, anywhere] });
    execFileSync('git', ['init', '-q'], { cwd: mini.root });
    execFileSync('git', ['add', '-A'], { cwd: mini.root });
    const local = mini.report({ 'suite passes': 'skipped' });
    const ci = join(mini.root, 'ci.json');
    writeFileSync(ci, JSON.stringify(report('suite passes', 'passed')));
    const identity = { platform: 'linux', commit: 'c'.repeat(40), sourceDigest: sourceDigest(mini.root), runUrl: 'https://github.com/o/r/actions/runs/1' };
    writeFileSync(join(mini.root, 'ci.identity.json'), JSON.stringify(identity));
    return { local, ci, identity };
  };
  const build = (...files: string[]) => script('build-parity-manifest.mjs', ['--root', mini.root, ...files.flatMap((f) => ['--results', f]), '--no-docs']);
  const manifest = () => JSON.parse(readFileSync(join(mini.root, 'generated/parity-manifest.json'), 'utf8'));
  const gate = () => script('check-release.mjs', ['--root', mini.root]);

  test('the host result alone leaves the Linux requirement INCONCLUSIVE; adding the CI result makes it PASS and records both identities', () => {
    const { local, ci } = setup();
    expect(build(local).status).toBe(0);
    expect(manifest().requirements.find((r: { id: string }) => r.id === 'BEH-LINUX').status).toBe('INCONCLUSIVE');
    expect(build(local, ci).status).toBe(0);
    const m = manifest();
    expect(m.requirements.find((r: { id: string }) => r.id === 'BEH-LINUX').status).toBe('PASS');
    expect(m.runs.map((r: { platform: string }) => r.platform)).toEqual([process.platform, 'linux']);
    expect(m.runs[1]).toMatchObject({ resultsSource: 'ci', commit: 'c'.repeat(40), runUrl: 'https://github.com/o/r/actions/runs/1' });
  });

  test('a CI result without an identity file is attributed to this host, so it cannot satisfy a Linux requirement', () => {
    const { ci } = setup();
    writeFileSync(join(mini.root, 'ci.identity.json'), '{}');
    const r = build(ci);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('identity is missing');
  });

  test('the gate accepts the merged manifest', () => {
    const { local, ci } = setup();
    build(local, ci);
    expect(gate().status, gate().stderr).toBe(0);
  });

  test('the gate rejects a CI result recorded against code that has since changed', () => {
    const { local, ci } = setup();
    build(local, ci);
    writeFileSync(join(mini.root, 'tests/t.test.ts'), '// changed');
    execFileSync('git', ['add', '-A'], { cwd: mini.root });
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('stale, it ran against code that has since changed');
  });

  test('the gate rejects a CI result with no run URL', () => {
    const { local, ci } = setup();
    build(local, ci);
    const path = join(mini.root, 'generated/parity-manifest.json');
    const m = manifest();
    delete m.runs[1].runUrl;
    writeFileSync(path, JSON.stringify(m));
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('without its run URL is unattributed');
  });

  test('the gate rejects an outcome edited to hide a failure on one platform', () => {
    const { local, ci } = setup();
    writeFileSync(join(mini.root, 'ci.json'), JSON.stringify(report('suite passes', 'failed')));
    build(local, ci);
    const path = join(mini.root, 'generated/parity-manifest.json');
    const m = manifest();
    for (const r of m.requirements) for (const t of r.results ?? []) if (t.outcome === 'failed') t.outcome = 'passed';
    for (const r of m.requirements) if (r.status === 'FAIL') r.status = 'PASS';
    writeFileSync(path, JSON.stringify(m));
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('the outcome was edited by hand');
  });
});

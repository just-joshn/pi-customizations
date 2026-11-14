import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { absentLinkedTests } from '../../scripts/parity-lib.mjs';
import { type MiniRoot, miniRoot, PKG, script } from './helpers.ts';

let mini: MiniRoot;
afterEach(() => mini?.cleanup());

const link = (name: string) => ({ id: 'R', tests: [{ file: 'tests/t.test.ts', name }] });
const reported = (...names: string[]) => ({ testResults: [{ name: 'tests/t.test.ts', status: 'passed', assertionResults: names.map((fullName) => ({ fullName, status: 'passed' })) }] });

describe('a requirement that links a test the suite no longer has', () => {
  test('is a defect when the file ran and no test in it has that name, as after a rename', () => {
    expect(absentLinkedTests([link('the old name')], reported('the new name'), '/x')).toEqual([expect.stringContaining('R: links "the old name" in tests/t.test.ts')]);
  });

  test('is fine when the test ran, even when it was skipped', () => {
    const skipped = { testResults: [{ name: 'tests/t.test.ts', status: 'passed', assertionResults: [{ fullName: 'a test', status: 'skipped' }] }] };
    expect(absentLinkedTests([link('a test')], skipped, '/x')).toEqual([]);
  });

  test('is fine in a report that never ran its file, which is a missing result and not a rename', () => {
    expect(absentLinkedTests([link('a test')], { testResults: [] }, '/x')).toEqual([]);
  });

  test('is fine when another run of the platforms has the name', () => {
    const runs = [
      { report: reported('other'), identity: { platform: 'darwin' } },
      { report: reported('a test'), identity: { platform: 'linux' } },
    ];
    expect(absentLinkedTests([link('a test')], runs, '/x')).toEqual([]);
  });

  test('a local report keeps its execution root when imported from another checkout', () => {
    mini = miniRoot();
    const path = mini.report({ 'suite passes': 'passed' });
    const report = JSON.parse(readFileSync(path, 'utf8'));
    report.testResults[0].name = '/original-checkout/tests/t.test.ts';
    mini.write('parity-results/local/vitest-report.json', JSON.stringify(report));
    mini.write('parity-results/local/vitest-report.identity.json', JSON.stringify({ resultsSource: 'local', root: '/original-checkout', platform: process.platform, commit: '0'.repeat(40), dirty: false, sourceDigest: '0'.repeat(64) }));
    const result = spawnSync(process.execPath, [join(PKG, 'scripts/build-parity-manifest.mjs'), '--root', mini.root, '--results', path, '--no-docs'], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(mini.root, 'generated/parity-manifest.json'), 'utf8'));
    expect(manifest.requirements.every((r: { status: string }) => r.status === 'PASS')).toBe(true);
  });

  test('stops the manifest builder, which writes nothing', () => {
    mini = miniRoot();
    const r = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report({ 'a renamed test': 'passed' }), '--no-docs']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('links "suite passes" in tests/t.test.ts');
    expect(r.stderr).toContain('not in the suite; nothing written');
  });
});

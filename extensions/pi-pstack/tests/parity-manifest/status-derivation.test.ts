import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { deriveStatus, evaluate } from '../../scripts/parity-lib.mjs';
import { type MiniRoot, miniRoot, script } from './helpers.ts';

let mini: MiniRoot;
afterEach(() => mini?.cleanup());

const record = (tests: string[], extra: object = {}) => ({ id: 'R', kind: 'behavioral', applicability: { mandatory: true }, tests: tests.map((name) => ({ file: 'tests/t.test.ts', name })), ...extra });
const report = (tests: Record<string, string>, suiteStatus = 'passed') => ({ testResults: [{ name: 'tests/t.test.ts', status: suiteStatus, assertionResults: Object.entries(tests).map(([fullName, status]) => ({ fullName, status })) }] });
const run = (tests: string[], results: Record<string, string>, extra: object = {}) => evaluate([record(tests, extra)], report(results), '/x')[0]!;

describe('status derivation', () => {
  const results = { 'a passed test': 'passed', 'a failed test': 'failed', 'a skipped test': 'skipped', 'another passed test': 'passed' };

  test('PASS only when every linked test ran and passed', () => {
    expect(run(['a passed test', 'another passed test'], results).status).toBe('PASS');
  });

  test('FAIL when any linked test failed, even beside a pass', () => {
    const r = run(['a passed test', 'a failed test'], results);
    expect(r.status).toBe('FAIL');
    expect(r.reason).toContain('a failed test');
  });

  test('INCONCLUSIVE when a linked test was skipped', () => {
    expect(run(['a passed test', 'a skipped test'], results).status).toBe('INCONCLUSIVE');
  });

  test('INCONCLUSIVE when a linked test is missing from the run', () => {
    const r = run(['a passed test', 'a test nobody wrote'], results);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.reason).toContain('missing');
  });

  test('INCONCLUSIVE when no test is linked', () => {
    const r = run([], results);
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.reason).toBe('no test is linked');
  });

  test('FAIL beats INCONCLUSIVE when one linked test failed and another is missing', () => {
    expect(run(['a failed test', 'a test nobody wrote'], results).status).toBe('FAIL');
  });

  test('a declared coverage gap keeps an all-green requirement INCONCLUSIVE', () => {
    const r = run(['a passed test'], results, { coverageGap: 'no end-to-end run' });
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.reason).toContain('no end-to-end run');
  });

  test('a test file that failed to load fails its linked requirements instead of hiding as missing', () => {
    const r = evaluate([record(['a passed test'])], report({}, 'failed'), '/x')[0]!;
    expect(r.status).toBe('FAIL');
  });

  test('a duplicated test name passes only when every instance passed', () => {
    const dup = {
      testResults: [
        {
          name: 'tests/t.test.ts',
          status: 'passed',
          assertionResults: [
            { fullName: 'twice', status: 'passed' },
            { fullName: 'twice', status: 'skipped' },
          ],
        },
      ],
    };
    expect(evaluate([record(['twice'])], dup, '/x')[0]!.status).toBe('INCONCLUSIVE');
  });

  test('a not-applicable requirement is N/A whatever its tests did', () => {
    expect(deriveStatus({ applicability: { mandatory: false, justification: 'why' }, tests: [] }, []).status).toBe('N/A');
  });

  test('the build script derives the same statuses from a fixture vitest JSON file', () => {
    mini = miniRoot();
    for (const [name, tests, expected] of [
      ['all pass', { 'suite passes': 'passed' }, 'PASS'],
      ['one fails', { 'suite passes': 'failed' }, 'FAIL'],
      ['one skipped', { 'suite passes': 'skipped' }, 'INCONCLUSIVE'],
      ['absent', { unrelated: 'passed' }, 'INCONCLUSIVE'],
    ] as const) {
      const out = join(mini.root, `manifest-${name}.json`);
      const r = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report(tests), '--out', out, '--no-docs']);
      expect(r.status, r.stderr).toBe(0);
      const manifest = JSON.parse(readFileSync(out, 'utf8'));
      expect(manifest.requirements.find((x: { id: string }) => x.id === 'BEH-ONE').status, name).toBe(expected);
      expect(manifest.run.startedAt).toBe('2023-11-14T22:13:20.000Z');
    }
  });
});

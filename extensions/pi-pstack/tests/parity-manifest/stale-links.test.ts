import { afterEach, describe, expect, test } from 'vitest';
import { absentLinkedTests } from '../../scripts/parity-lib.mjs';
import { type MiniRoot, miniRoot, script } from './helpers.ts';

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

  test('stops the manifest builder, which writes nothing', () => {
    mini = miniRoot();
    const r = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report({ 'a renamed test': 'passed' }), '--no-docs']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('links "suite passes" in tests/t.test.ts');
    expect(r.stderr).toContain('not in the suite; nothing written');
  });
});

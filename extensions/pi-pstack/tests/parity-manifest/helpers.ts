import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PKG } from '../skill-parity/helpers.ts';

export { PKG };
export const script = (name: string, args: string[]) => {
  const r = spawnSync(process.execPath, [join(PKG, 'scripts', name), ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export const SKILL = 'vendor/upstream-pstack/skills/x/SKILL.md';
export const SKILL_TEXT = '# X\n\nDo the thing.\nStop at the line.\n';

export interface MiniRoot {
  root: string;
  cleanup: () => void;
  write: (path: string, text: string) => void;
  report: (tests: Record<string, string>) => string;
}

/** A one-skill package: a lock, a dependency manifest, one structural rule and one behavioral record. */
export function miniRoot(overrides: { behavioral?: object[]; extraFiles?: Record<string, string> } = {}): MiniRoot {
  const root = mkdtempSync(join(tmpdir(), 'pstack-mini-'));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const files: Record<string, string> = { [SKILL]: SKILL_TEXT, ...overrides.extraFiles };
  for (const [path, text] of Object.entries(files)) write(path, text);
  write('generated/upstream-lock.json', JSON.stringify({ repository: 'r', revision: 'a'.repeat(40), counts: {}, files: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha(t)])) }));
  write('generated/dependency-manifest.json', JSON.stringify({ skills: [{ name: 'x', required: true }], requiredTeamKit: [] }));
  write(
    'requirements/requirements.json',
    JSON.stringify({
      schemaVersion: 1,
      tests: {
        pass: { file: 'tests/t.test.ts', name: 'suite passes' },
        fail: { file: 'tests/t.test.ts', name: 'suite fails' },
        skip: { file: 'tests/t.test.ts', name: 'suite skipped' },
        gone: { file: 'tests/t.test.ts', name: 'suite was deleted' },
      },
      structural: [{ id: 'skill', match: '^pstack:skills/.+$', kind: 'primary-skill', title: 'Skill', specSection: '4.1', observable: 'The skill {file} ships.', invariants: ['i'], piMechanism: 'm', tests: ['pass'], verification: 'v' }],
      behavioral: overrides.behavioral ?? [
        {
          id: 'BEH-ONE',
          title: 'One',
          specSection: '12',
          source: { file: SKILL, lines: [3, 4], anchor: 'Stop at the line' },
          observable: 'o',
          invariants: ['i'],
          piMechanism: 'm',
          dependencies: [],
          prerequisites: [],
          applicability: { mandatory: true },
          verification: 'v',
          tests: ['pass'],
        },
      ],
    }),
  );
  write('tests/t.test.ts', '// fixture');
  const report = (tests: Record<string, string>) => {
    const path = join(root, 'vitest-report.json');
    writeFileSync(
      path,
      JSON.stringify({
        startTime: 1_700_000_000_000,
        numTotalTests: Object.keys(tests).length,
        testResults: [{ name: join(root, 'tests/t.test.ts'), status: 'passed', assertionResults: Object.entries(tests).map(([fullName, status]) => ({ fullName, status })) }],
      }),
    );
    return path;
  };
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }), write, report };
}

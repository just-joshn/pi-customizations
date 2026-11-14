import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { sourceDigest, toolchain } from '../../scripts/parity-lib.mjs';
import type { ZipRegister } from '../../scripts/zip-contract.mjs';
import { zipRequirementDigest } from '../../scripts/zip-contract.mjs';
import { PKG } from '../skill-parity/helpers.ts';

export { PKG };

/** The execution-time sidecar a real run leaves beside its report, for fixtures whose report stands for tests that just ran against this tree. */
const attributeReports = (args: string[]) => {
  const root = args[args.indexOf('--root') + 1];
  if (!root) return;
  const digest = sourceDigest(root);
  if (!digest) return;
  args.forEach((a, i) => {
    const sidecar = args[i + 1]?.replace(/\.json$/, '.identity.json');
    if (a === '--results' && sidecar && !(existsSync(sidecar) && JSON.parse(readFileSync(sidecar, 'utf8')).resultsSource !== 'local'))
      writeFileSync(sidecar, JSON.stringify({ resultsSource: 'local', platform: process.platform, commit: '0'.repeat(40), dirty: false, sourceDigest: digest }));
  });
};

export const script = (name: string, args: string[]) => {
  if (name === 'build-parity-manifest.mjs') {
    attributeReports(args);
    const root = args[args.indexOf('--root') + 1];
    if (root && !args.includes('--zip-evidence')) args = [...args, '--zip-evidence', zipFixture(root)];
  }
  const r = spawnSync(process.execPath, [join(PKG, 'scripts', name), ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const zipRegister = (): ZipRegister => JSON.parse(readFileSync(join(PKG, 'requirements/requirements.json'), 'utf8')).zip;

export function zipFixture(root: string, piVersion = toolchain().piVersion): string {
  const zip: ZipRegister = JSON.parse(readFileSync(join(root, 'requirements/requirements.json'), 'utf8')).zip;
  const directory = join(root, 'parity-results/zip');
  mkdirSync(directory, { recursive: true });
  const artifact = 'synthetic acceptance output for the miniature test package\n';
  writeFileSync(join(directory, 'output.txt'), artifact);
  const path = join(root, 'parity-results/zip-evidence.json');
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      sourceDigest: sourceDigest(root),
      upstreamRevision: zip.upstreamRevision,
      piVersion,
      requirements: zip.requirements.map((r) => ({
        id: r.id,
        requirementDigest: zipRequirementDigest(r),
        verdict: 'PASS',
        stimulus: r.stimulus,
        expected: r.evidence,
        command: 'synthetic acceptance fixture',
        observed: artifact,
        artifacts: [{ path: 'zip/output.txt', sha256: sha(artifact) }],
      })),
    }),
  );
  return path;
}

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
  write('generated/upstream-lock.json', JSON.stringify({ repository: 'r', revision: zipRegister().upstreamRevision, counts: {}, files: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha(t)])) }));
  write('generated/dependency-manifest.json', JSON.stringify({ skills: [{ name: 'x', required: true }], requiredTeamKit: [] }));
  write(
    'requirements/requirements.json',
    JSON.stringify({
      schemaVersion: 1,
      zip: zipRegister(),
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
  write('.gitignore', 'parity-results/\n');
  write('tests/t.test.ts', '// fixture');
  const report = (tests: Record<string, string>) => {
    mkdirSync(join(root, 'parity-results/local'), { recursive: true });
    const path = join(root, 'parity-results/local/vitest-report.json');
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

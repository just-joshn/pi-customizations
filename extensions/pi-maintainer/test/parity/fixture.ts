import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Type from 'typebox';
import { Value } from 'typebox/value';
import { onTestFinished } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const vitestPath = join(dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))), 'vitest.mjs');
export const testUnit = 'aider-test/test_coder/TestCoder.test_edit';
export const docUnit = 'edit/fixture/p1';
export const row = {
  id: 'edit.fixture.result',
  feature: 'edit',
  behavior: 'The editable value is returned to the caller.',
  aider: ['aider/coder.py:1-2'],
  kind: 'parity',
  status: 'verified',
  pi: ['turn_end'],
  src: ['src/value.ts'],
  tests: ['test/value.test.ts::returns the editable value'],
};

export async function json(root: string, path: string, value: unknown) {
  await put(root, path, JSON.stringify(value));
}

export async function put(root: string, path: string, value: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), value);
}

async function evidence(root: string) {
  const files = {
    'Aider-Precise-Code-Editing-Evidence/probes.json': {},
    'Aider-Precise-Code-Editing-Evidence/cli-apply-results.json': [],
    'Aider-Precise-Code-Editing-Evidence/patch-lifecycle.json': {},
    'aider-git-architecture-evidence-2026-10-09/probe-results.json': { experiments: [] },
    'Aider-Automated-Linting-Testing-Evidence/probe-results.json': { cases: [] },
    'Aider-Automated-Linting-Testing-Evidence/orchestration-results.json': { cases: [] },
    'Aider-Automated-Linting-Testing-Evidence/oneshot-test-cli-result.json': {},
    'aider-repository-map-evidence/probe-results.json': { provider_tags: [], map_with_chat_file: '', global_map: '', refresh_files_stale_until_forced: '', forced_map: '', zero_budget_disables_map: '' },
    'aider-repository-map-evidence/query-results.json': { languages: [] },
  };
  for (const [path, value] of Object.entries(files)) await json(root, `sources/${path}`, value);
  await put(root, 'sources/aider-repository-map-evidence/boundary-results.txt', '{}');
  await put(root, 'sources/aider-repository-map-evidence/julia-feature-result.txt', 'fixture');
}

async function pins(root: string) {
  const documents = { edit: 'edit.md', git: 'git.md', map: 'map.md', lint: 'lint.md' };
  const text = '# Fixture\n\nThe editable value is returned.\n';
  for (const name of Object.values(documents)) await put(root, `sources/${name}`, text);
  await json(root, 'parity/sources.json', {
    documentsDir: join(root, 'sources'),
    documents,
    documentSha256: Object.fromEntries(Object.keys(documents).map((name) => [name, createHash('sha256').update(text).digest('hex')])),
    aider: { checkout: join(root, 'aider'), testModules: ['test_coder'] },
    testModuleOwners: {},
  });
  await put(root, 'aider/tests/basic/test_coder.py', 'class TestCoder:\n    def test_edit(self):\n        assert editable_value() == 2\n');
  await json(root, 'parity/test-owners.json', { [testUnit]: 'edit' });
}

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-parity-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await cp(join(packageRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
  await symlink(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  await json(root, 'package.json', { type: 'module' });
  await put(root, 'vitest.config.ts', "export default { test: { environment: 'node', globals: false, pool: 'forks', isolate: true } };\n");
  await pins(root);
  await evidence(root);
  await json(root, 'parity/ledger.json', { rows: [row] });
  const census = spawnSync(process.execPath, ['scripts/census.mjs', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PI_MAINTAINER_SOURCES: join(root, 'sources'), AIDER_CHECKOUT: join(root, 'aider') },
  });
  if (census.status !== 0) throw new Error(census.stderr);
  const units = Value.Parse(Type.Array(Type.Object({ id: Type.String() })), JSON.parse(census.stdout));
  const coverage = Object.fromEntries(units.map(({ id }) => [id, id === docUnit || id === testUnit ? { rows: [row.id] } : { nonclaim: 'provenance', note: 'Fixture for another slice.' }]));
  await json(root, 'parity/coverage.json', coverage);
  await put(root, 'src/value.ts', 'export const editableValue = () => 2;\n');
  await put(
    root,
    'test/value.test.ts',
    `import { test, expect } from 'vitest';\nimport { editableValue } from '../src/value.ts';\ntest('returns the editable value', { meta: { aider: ['test_coder/TestCoder.test_edit'] } }, () => { expect(editableValue()).toBe(2); });\n`,
  );
  return { root, coverage };
}

export async function unboundFixture(tag: 'aider' | 'evidence') {
  const initial = await fixture();
  const unit = tag === 'aider' ? testUnit : 'ev-edit/probe/fixture';
  if (tag === 'evidence') await json(initial.root, 'sources/Aider-Precise-Code-Editing-Evidence/probes.json', { fixture: { value: 2 } });
  const coverage = { ...initial.coverage, [unit]: { rows: [row.id] } };
  await json(initial.root, 'parity/coverage.json', coverage);
  const retained = tag === 'aider' ? {} : { aider: [testUnit.slice('aider-test/'.length)] };
  await put(
    initial.root,
    'test/value.test.ts',
    `import { expect, test } from 'vitest'; import { editableValue } from '../src/value.ts'; test('returns the editable value', { meta: ${JSON.stringify(retained)} }, () => expect(editableValue()).toBe(2));\n`,
  );
  const metadata = { [tag]: [tag === 'aider' ? unit.slice('aider-test/'.length) : unit] };
  return { ...initial, coverage, unit, metadata };
}

export function gate(root: string, args: string[] = [], bin?: string) {
  const { PATH: inheritedPath } = process.env;
  const result = spawnSync(process.execPath, ['scripts/check-parity.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PI_MAINTAINER_SOURCES: join(root, 'sources'), AIDER_CHECKOUT: join(root, 'aider'), ...(bin ? { PATH: `${bin}:${inheritedPath}` } : {}) },
  });
  if (result.error) throw result.error;
  return { code: result.status, output: result.stdout + result.stderr };
}

export function capture(root: string) {
  const result = spawnSync('bun', ['x', 'vitest', 'run', '--reporter=json', '--outputFile=saved.json'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
}

export async function runner(root: string, fault: string) {
  const bin = join(root, 'bin');
  await put(
    root,
    'bin/bun',
    `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
const result = spawnSync(process.execPath, [${JSON.stringify(vitestPath)}, ...process.argv.slice(4)], { stdio: 'inherit' });
const report = process.argv.find(a => a.startsWith('--outputFile=')).slice('--outputFile='.length);
${fault}
process.exit(result.status ?? 1);
`,
  );
  await chmod(join(bin, 'bun'), 0o755);
  return bin;
}
